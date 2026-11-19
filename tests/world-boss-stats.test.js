const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Database = require('better-sqlite3');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder } = require('discord.js');

const dbSource = fs.readFileSync(require.resolve('../db.js'), 'utf8');
const indexSource = fs.readFileSync(require.resolve('../index.js'), 'utf8');

function extract(source, start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `Could not extract ${start}`);
  return source.slice(first, last);
}

function setupDatabase() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE world_boss (id INTEGER PRIMARY KEY, name TEXT, current_hp INTEGER, max_hp INTEGER,
      is_active INTEGER, rewards_claimed INTEGER DEFAULT 0, spawned_by TEXT);
    CREATE TABLE boss_damage (user_id TEXT PRIMARY KEY, damage INTEGER, last_hit INTEGER);
    CREATE TABLE world_boss_contributions (boss_id INTEGER, user_id TEXT, boss_name TEXT,
      damage INTEGER, PRIMARY KEY (boss_id, user_id));
    CREATE TABLE world_boss_rewards (boss_id INTEGER, user_id TEXT, boss_name TEXT, max_hp INTEGER,
      damage INTEGER, rank INTEGER, total_players INTEGER, coins INTEGER, claimed INTEGER DEFAULT 0,
      items_json TEXT DEFAULT '', pokemon_drop INTEGER DEFAULT 0, coins_awarded INTEGER,
      PRIMARY KEY (boss_id, user_id));
  `);
  return db;
}

test('historical rewards and the latest raid backfill contributions without duplication', () => {
  const db = setupDatabase();
  try {
    db.exec(`
      INSERT INTO world_boss VALUES (1, 'Old', 0, 100, 0, 1, NULL), (2, 'Current', 50, 100, 1, 0, NULL);
      INSERT INTO world_boss_rewards (boss_id, user_id, boss_name, max_hp, damage, rank, total_players, coins)
        VALUES (1, 'alice', 'Old', 100, 100, 1, 1, 30000);
      INSERT INTO boss_damage VALUES ('alice', 50, 1);
    `);
    const migration = extract(dbSource,
      'db.exec(`\n  INSERT OR IGNORE INTO world_boss_contributions',
      '\nconst worldBossPostPrimaryKey');
    vm.runInNewContext(migration, { db });
    vm.runInNewContext(migration, { db });
    assert.deepEqual(db.prepare('SELECT boss_id, damage FROM world_boss_contributions ORDER BY boss_id').all(),
      [{ boss_id: 1, damage: 100 }, { boss_id: 2, damage: 50 }]);
  } finally { db.close(); }
});

test('damage contributions survive raid replacement and roll back with failed attacks', () => {
  const db = setupDatabase();
  try {
    db.exec("INSERT INTO world_boss VALUES (1, 'Charizard Gmax', 100, 100, 1, 0, NULL)");
    const ctx = vm.createContext({ db, assertUserId: () => {} });
    vm.runInContext(extract(dbSource, 'function recordWorldBossFight(', '\nconst ETERNATUS_WORLD_BOSS_DROP_EXCLUDED_USER_IDS'), ctx);
    vm.runInContext(extract(dbSource, 'function getWorldBossStats(', '\n// XS, S and M only'), ctx);
    ctx.recordWorldBossFight('bob', 1);
    ctx.recordWorldBossFight('bob', 1);
    assert.equal(ctx.getWorldBossStats('bob').contributions[0].fights, 1);
    assert.equal(ctx.getWorldBossStats('bob').contributions[0].damage, 0);
    assert.throws(() => ctx.recordWorldBossFight('bob', 99), /does not exist/);
    assert.equal(ctx.applyWorldBossDamage('alice', 1, 40, 1).damage, 20);
    assert.equal(ctx.applyWorldBossDamage('alice', 1, 20, 2).damage, 10);
    db.exec(`
      UPDATE world_boss SET is_active = 0 WHERE id = 1;
      DELETE FROM boss_damage;
      INSERT INTO world_boss VALUES (2, 'Shiny Charizard Gmax', 100, 100, 1, 0, NULL);
    `);
    ctx.applyWorldBossDamage('alice', 2, 20, 3);
    assert.equal(ctx.getWorldBossStats('alice').contributions.reduce((sum, row) => sum + row.damage, 0), 40);
    assert.equal(ctx.getWorldBossStats('alice').contributions.length, 2);
    db.exec("CREATE TRIGGER reject_contribution BEFORE UPDATE ON world_boss_contributions BEGIN SELECT RAISE(ABORT, 'rejected'); END");
    assert.throws(() => ctx.applyWorldBossDamage('alice', 2, 20, 4), /rejected/);
    assert.equal(db.prepare('SELECT current_hp FROM world_boss WHERE id = 2').get().current_hp, 90);
    assert.equal(db.prepare("SELECT damage FROM boss_damage WHERE user_id = 'alice'").get().damage, 10);
  } finally { db.close(); }
});

test('reward stats store actual boosted coins including the spawner bonus exactly once', () => {
  const db = setupDatabase();
  try {
    db.exec(`
      INSERT INTO world_boss VALUES (1, 'Charizard Gmax', 0, 100, 0, 0, 'bob');
      INSERT INTO boss_damage VALUES ('alice', 60, 1), ('bob', 40, 2);
    `);
    const math = Object.create(Math);
    math.random = () => 0.99;
    const ctx = vm.createContext({
      db, Math: math, assertUserId: () => {},
      WORLD_BOSS_POOL: [{ name: 'Charizard Gmax', catchName: 'Charizard Gmax', formId: 1, rarity: 'Gmax' }],
      BOXES: {}, trackClanActivity: () => {}, recordPokemonSeen: () => {}, addFactionPoints: () => 0,
      incrementUser: () => {}, awardCoinsWithBoost: (_id, amount) => ({ finalAmount: amount * 2 }),
      isPlayerBonusActive: () => false, rollWorldBossExtraDrops: () => [],
    });
    vm.runInContext(extract(dbSource, 'function getBossLeaderboard(', '\nfunction getUnclaimedWorldBossReward('), ctx);
    ctx.distributeWorldBossRewards(1);
    assert.deepEqual(db.prepare('SELECT user_id, rank, coins, coins_awarded FROM world_boss_rewards ORDER BY rank').all(), [
      { user_id: 'alice', rank: 1, coins: 30000, coins_awarded: 60000 },
      { user_id: 'bob', rank: 2, coins: 12000, coins_awarded: 60000 },
    ]);
    assert.equal(ctx.distributeWorldBossRewards(1), null);
  } finally { db.close(); }
});

test('stats pages aggregate rewards, paginate and restrict controls to their owner', async () => {
  const handlers = {};
  const payloads = [];
  const collector = { on: (event, handler) => { handlers[event] = handler; } };
  const sent = { createMessageComponentCollector: () => collector, edit: async (payload) => payloads.push(payload) };
  const forms = Array.from({ length: 33 }, (_, i) => ({
    formId: i + 1, formSlug: `mon${i}-gmax`, name: `Mon${i} Gmax`, catchName: `Mon${i} Gmax`,
  }));
  const pool = forms.flatMap((form) => [form, { ...form, name: `Shiny ${form.name}`, isShiny: true }]);
  const items = Array.from({ length: 15 }, (_, i) => ({ name: `Item ${i}`, amount: 2 }));
  const ctx = vm.createContext({
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder, WORLD_BOSS_POOL: pool,
    EMOJIS: { pokecoin: '🪙' }, getPokemonSpriteEmoji: () => '', getItemEmoji: () => '', console,
    getWorldBossStats: () => ({
      contributions: [{ boss_name: 'Mon0 Gmax', fights: 2, damage: 40 }, { boss_name: 'Shiny Mon0 Gmax', fights: 1, damage: 5 }],
      rewards: [
        { boss_name: 'Shiny Mon0 Gmax', rank: 1, coins: 30000, coins_awarded: 45000, pokemon_drop: 1,
          items_json: JSON.stringify([...items, { name: 'Metronome', amount: 1 }, { name: 'Faction Points', amount: 100 }]) },
        { boss_name: 'Mon0 Gmax', rank: 2, coins: 12000, coins_awarded: null, pokemon_drop: 1, items_json: '' },
      ],
    }),
  });
  vm.runInContext(extract(indexSource, 'function summarizeWorldBossStats(', '\nfunction isBotAdmin('), ctx);
  await ctx.handleWorldBossStats({ author: { id: 'alice', username: 'Alice' },
    reply: async (payload) => { payloads.push(payload); return sent; } }, 'alice');
  const first = payloads[0].embeds[0].toJSON();
  assert.match(first.description, /World Bosses fought: 3/);
  assert.match(first.description, /Lifetime DMG dealt: 45/);
  assert.match(first.fields[0].value, /Mon0: 2 \/ 1/);
  assert.equal(first.fields.length, 3);
  assert.ok(first.fields.every((field) => field.value.length <= 1024));
  let denied;
  await handlers.collect({ user: { id: 'other' }, reply: async (payload) => { denied = payload; } });
  assert.equal(denied.ephemeral, true);
  const press = async (action) => handlers.collect({ user: { id: 'alice' }, customId: `wbstats:${action}`,
    update: async (payload) => payloads.push(payload) });
  await press('pokemon');
  assert.match(payloads.at(-1).embeds[0].toJSON().description, /Shiny Pokémon received: 1/);
  await press('items');
  const itemsPage = payloads.at(-1).embeds[0].toJSON();
  assert.match(itemsPage.description, /PokéCoins rewarded: 57,000/);
  assert.match(itemsPage.description, /Items rewarded: 31/);
  assert.match(itemsPage.description, /Mega Rare items rewarded: 1/);
  assert.match(itemsPage.footer.text, /Older coin rewards/);
  await press('next');
  assert.match(payloads.at(-1).embeds[0].toJSON().footer.text, /Page 2\/2/);
  await press('basic');
  await press('next');
  assert.match(payloads.at(-1).embeds[0].toJSON().fields[0].value, /Mon30/);
});

test('both stats aliases work without an active boss', async () => {
  const branch = extract(indexSource,
    "    if (command === 'worldboss' || command === 'wb') {",
    "      if (subCommand === 'claim')") + '    }\n';
  const run = vm.runInNewContext(`(async (command, args, message, userId, handleWorldBossStats) => {\n${branch}\n})`);
  for (const command of ['wb', 'worldboss']) {
    for (const subcommand of ['stats', 's']) {
      assert.equal(await run(command, [subcommand], {}, 'alice', (_message, id) => `stats:${id}`), 'stats:alice');
    }
  }
});

test('boss columns stay within Discord field limits for long names and large counts', async () => {
  const forms = Array.from({ length: 20 }, (_, i) => ({
    formId: i + 1, formSlug: `mon${i}-gmax`,
    name: `${'Long name '.repeat(8)}${i} Gmax`, catchName: `${'Long name '.repeat(8)}${i} Gmax`,
  }));
  const pool = forms.flatMap((form) => [form, { ...form, name: `Shiny ${form.name}`, isShiny: true }]);
  const handlers = {};
  const payloads = [];
  const ctx = vm.createContext({
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder, WORLD_BOSS_POOL: pool,
    EMOJIS: { pokecoin: '🪙' }, getPokemonSpriteEmoji: () => '<:sgmaxurshifushinglestrike:1573093823238897725>',
    getItemEmoji: () => '', console,
    getWorldBossStats: () => ({
      contributions: pool.map((entry) => ({ boss_name: entry.name, fights: 999999999, damage: 1 })), rewards: [],
    }),
  });
  vm.runInContext(extract(indexSource, 'function summarizeWorldBossStats(', '\nfunction isBotAdmin('), ctx);
  await ctx.handleWorldBossStats({ author: { username: 'Alice' }, reply: async (payload) => {
    payloads.push(payload);
    return { createMessageComponentCollector: () => ({ on: (event, handler) => { handlers[event] = handler; } }) };
  } }, 'alice');
  await handlers.collect({ user: { id: 'alice' }, customId: 'wbstats:next',
    update: async (payload) => payloads.push(payload) });
  for (const payload of payloads) {
    assert.ok(payload.embeds[0].toJSON().fields.every((field) => field.value.length <= 1024));
  }
  assert.match(payloads[1].embeds[0].toJSON().footer.text, /Page 2\//);
});

test('highscores rank independent MVP and damage totals and limit results to 100', () => {
  const db = setupDatabase();
  try {
    const contribution = db.prepare('INSERT INTO world_boss_contributions VALUES (?, ?, ?, ?)');
    const reward = db.prepare(`
      INSERT INTO world_boss_rewards (boss_id, user_id, boss_name, max_hp, damage, rank, total_players, coins)
      VALUES (?, ?, 'Boss', 100, 10, ?, 2, 0)
    `);
    db.transaction(() => {
      for (let i = 0; i < 105; i++) contribution.run(1, `user${String(i).padStart(3, '0')}`, 'Boss', i);
      contribution.run(2, 'user000', 'Boss', 20);
      reward.run(1, 'user000', 1);
      reward.run(2, 'user000', 1);
      reward.run(3, 'user000', 2);
      reward.run(1, 'user001', 1);
      reward.run(2, 'user002', 1);
      reward.run(3, 'no-contribution', 1);
    })();
    const ctx = vm.createContext({ db });
    vm.runInContext(extract(dbSource, 'function getWorldBossHighscores(', '\n// XS, S and M only'), ctx);
    const rows = ctx.getWorldBossHighscores();
    assert.equal(rows.length, 100);
    assert.deepEqual(rows.slice(0, 4), [
      { user_id: 'user000', mvps: 2, victories: 3, damage: 20 },
      { user_id: 'user002', mvps: 1, victories: 1, damage: 2 },
      { user_id: 'user001', mvps: 1, victories: 1, damage: 1 },
      { user_id: 'no-contribution', mvps: 1, victories: 1, damage: 0 },
    ]);
    assert.equal(rows[4].user_id, 'user104');
    assert.equal(rows.some((row) => row.user_id === 'user003'), false);
  } finally { db.close(); }
});

test('highscore snapshots refresh at five minutes and after a backward clock change', () => {
  let queries = 0;
  const ctx = vm.createContext({ getWorldBossHighscores: () => [{ user_id: String(++queries) }] });
  vm.runInContext(extract(indexSource, 'const WORLD_BOSS_HIGHSCORES_REFRESH_MS', '\nasync function handleWorldBossHighscores('), ctx);
  assert.equal(ctx.getCachedWorldBossHighscores(1000)[0].user_id, '1');
  assert.equal(ctx.getCachedWorldBossHighscores(300999)[0].user_id, '1');
  assert.equal(ctx.getCachedWorldBossHighscores(301000)[0].user_id, '2');
  assert.equal(ctx.getCachedWorldBossHighscores(500)[0].user_id, '3');
});

test('highscores show ranks and 15-player pages, protect controls, and handle empty results', async () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({
    user_id: String(100000000000000000n + BigInt(i)), mvps: 100 - i, victories: 1000 - i, damage: 50000 - i,
  }));
  const handlers = {};
  const payloads = [];
  let currentRows = rows;
  const ctx = vm.createContext({
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder, console,
    getWorldBossHighscores: () => currentRows,
    getTrainerIconEmoji: () => '<:longtrainericonxxxxxxxxxxxxxxxxx:12345678901234567890>',
  });
  vm.runInContext(extract(indexSource, 'const WORLD_BOSS_HIGHSCORES_REFRESH_MS', '\nfunction isBotAdmin('), ctx);
  const message = {
    reply: async (payload) => {
      payloads.push(payload);
      return {
        createMessageComponentCollector: () => ({ on: (event, handler) => { handlers[event] = handler; } }),
        edit: async (next) => payloads.push(next),
      };
    },
  };
  await ctx.handleWorldBossHighscores(message, rows[30].user_id);
  const first = payloads[0].embeds[0].toJSON();
  assert.match(first.description, /#31/);
  assert.match(first.footer.text, /Page 1\/7.*5 minutes/);
  assert.equal(first.fields[0].value.split('\n').length, 15);
  assert.ok(first.fields.every((field) => field.value.length <= 1024));
  assert.match(first.fields[1].value, /100 in 1,000 victories/);
  assert.match(first.fields[2].value, /50,000 DMG/);
  let denied;
  await handlers.collect({ user: { id: 'other' }, reply: async (payload) => { denied = payload; } });
  assert.equal(denied.ephemeral, true);
  for (let i = 0; i < 6; i++) {
    await handlers.collect({ user: { id: rows[30].user_id }, customId: 'wbhs:next',
      update: async (payload) => payloads.push(payload) });
  }
  const last = payloads.at(-1).embeds[0].toJSON();
  assert.match(last.footer.text, /Page 7\/7/);
  assert.equal(last.fields[0].value.split('\n').length, 10);
  assert.equal(payloads.at(-1).components[0].toJSON().components[1].disabled, true);
  assert.equal(payloads[0].allowedMentions.parse.length, 0);

  currentRows = [];
  ctx.getCachedWorldBossHighscores(Date.now() + 300001);
  await ctx.handleWorldBossHighscores(message, 'unranked');
  const empty = payloads.at(-1).embeds[0].toJSON();
  assert.match(empty.description, /not ranked/);
  assert.match(empty.fields[0].value, /No World Boss battles/);
});

test('both highscore aliases work without an active boss', async () => {
  const branch = extract(indexSource,
    "    if (command === 'worldboss' || command === 'wb') {",
    "      if (subCommand === 'claim')") + '    }\n';
  const run = vm.runInNewContext(`(async (command, args, message, userId, handleWorldBossHighscores) => {\n${branch}\n})`);
  for (const command of ['wb', 'worldboss']) {
    for (const subcommand of ['hs', 'highscore']) {
      assert.equal(await run(command, [subcommand], {}, 'alice', (_message, id) => `highscores:${id}`), 'highscores:alice');
    }
  }
});
