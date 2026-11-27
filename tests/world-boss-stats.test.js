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
      items_json TEXT DEFAULT '', pokemon_drop INTEGER DEFAULT 0, coins_awarded INTEGER, bonus_pokemon_json TEXT DEFAULT '[]',
      PRIMARY KEY (boss_id, user_id));
  `);
  return db;
}

test('Eternamax daily spawn claims allow one Boss Coin and one automatic spawn per UTC day', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE eternamax_daily_spawn_claims (
        utc_day TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('boss_coin', 'automatic')),
        PRIMARY KEY (utc_day, source)
      );
    `);
    const ctx = vm.createContext({ db, Date, TypeError });
    vm.runInContext(
      extract(dbSource, 'function getEternamaxSpawnUtcDay(', '\nconst WORLD_BOSS_REGISTRATION_DURATION_MS'),
      ctx
    );
    const beforeUtcMidnight = Date.UTC(2026, 10, 23, 23, 59);
    const afterUtcMidnight = Date.UTC(2026, 10, 24, 0, 1);
    assert.equal(ctx.claimDailyEternamaxSpawn('boss_coin', beforeUtcMidnight), true);
    assert.equal(ctx.claimDailyEternamaxSpawn('boss_coin', beforeUtcMidnight), false);
    assert.equal(ctx.claimDailyEternamaxSpawn('automatic', beforeUtcMidnight), true);
    assert.equal(ctx.isDailyEternamaxSpawnClaimed('boss_coin', beforeUtcMidnight), true);
    assert.equal(ctx.claimDailyEternamaxSpawn('boss_coin', afterUtcMidnight), true);
    assert.throws(() => ctx.claimDailyEternamaxSpawn('admin', afterUtcMidnight), /source must be/);
  } finally { db.close(); }
});

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

test('bonus Pokémon history migration preserves old rewards and is repeatable', () => {
  const db = new Database(':memory:');
  try {
    db.exec("CREATE TABLE world_boss_rewards (boss_id INTEGER, user_id TEXT); INSERT INTO world_boss_rewards VALUES (1, 'alice')");
    const migration = extract(dbSource, "if (!worldBossRewardColumns.has('bonus_pokemon_json')) {",
      '\ndb.exec(`\n  INSERT OR IGNORE INTO world_boss_contributions');
    for (let i = 0; i < 2; i++) {
      const worldBossRewardColumns = new Set(db.prepare('PRAGMA table_info(world_boss_rewards)').all().map((column) => column.name));
      vm.runInNewContext(migration, { db, worldBossRewardColumns });
    }
    assert.equal(db.prepare('SELECT bonus_pokemon_json FROM world_boss_rewards').get().bonus_pokemon_json, '[]');
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

test('specified users cannot receive either Eternamax boss drop but still receive other rewards', () => {
  const excluded = [
    '983343425225105408', '865912695621681152', '1382212053778960414', '130226338769403904',
  ];
  const players = [...excluded, '412568898177728512', 'eligible'];
  for (const [bossName, isShiny, isEternamax] of [
    ['Eternatus-Eternamax', false, true],
    ['Shiny Eternatus-Eternamax', true, true],
    ['Charizard Gmax', false, false],
  ]) {
    const db = setupDatabase();
    try {
      db.prepare('INSERT INTO world_boss VALUES (1, ?, 0, 100, 0, 0, ?)').run(bossName, players[0]);
      const insertDamage = db.prepare('INSERT INTO boss_damage VALUES (?, ?, ?)');
      players.forEach((id, index) => insertDamage.run(id, 100 - index, index));
      let rolls = 0;
      const math = Object.create(Math);
      math.random = () => rolls++ % 14 === 1 ? 0 : 0.99;
      const saved = [];
      const seen = [];
      const ctx = vm.createContext({
        db, Math: math,
        WORLD_BOSS_POOL: [{
          name: bossName, catchName: isEternamax ? 'Eternatus-Eternamax' : 'Charizard Gmax',
          formId: isEternamax ? 10190 : 1, rarity: 'Gmax', catchRarity: 'Gmax', isShiny,
        }],
        BOXES: {}, trackClanActivity: () => {}, recordPokemonSeen: (...args) => seen.push(args),
        addFactionPoints: () => 0, incrementUser: () => {},
        awardCoinsWithBoost: (_id, amount) => ({ finalAmount: amount }),
        isPlayerBonusActive: () => false, rollWorldBossExtraDrops: () => [],
        saveCatch: (id, pokemon, shiny) => saved.push({ id, formId: pokemon.id, shiny }),
      });
      vm.runInContext(extract(dbSource, 'function getBossLeaderboard(', '\nfunction getUnclaimedWorldBossReward('), ctx);
      const result = ctx.distributeWorldBossRewards(1);
      const expectedDrops = isEternamax ? ['eligible'] : players;
      assert.deepEqual(Array.from(result.drops), expectedDrops);
      assert.deepEqual(saved.map(({ id }) => id), expectedDrops);
      assert.ok(saved.every((entry) => entry.shiny === isShiny));
      assert.equal(seen.length, players.length);
      const rewards = db.prepare('SELECT user_id, pokemon_drop, coins_awarded FROM world_boss_rewards ORDER BY rank').all();
      assert.deepEqual(rewards.map((reward) => reward.pokemon_drop), players.map((id) => Number(expectedDrops.includes(id))));
      assert.deepEqual(rewards.map((reward) => reward.coins_awarded), [30000, 12000, 12000, 12000, 12000, 12000]);
    } finally { db.close(); }
  }
});

test('bonus Pokémon roll independently with MVP and World Boss bonuses and persist for claims', () => {
  const db = setupDatabase();
  try {
    db.exec(`
      CREATE TABLE pokemon_forms (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, rarity TEXT,
        base_hp INTEGER, base_atk INTEGER, base_def INTEGER, base_spd INTEGER, is_default INTEGER);
      INSERT INTO world_boss VALUES (1, 'Charizard Gmax', 0, 100, 0, 0, NULL);
      INSERT INTO boss_damage VALUES ('alice', 60, 1), ('bob', 40, 2);
    `);
    const formIds = [95, 131, 187, 216, 241, 335, 336, 357, 415, 433, 599];
    const insertForm = db.prepare('INSERT INTO pokemon_forms VALUES (?, ?, ?, ?, 40, 50, 60, 70, 1)');
    for (const id of formIds) insertForm.run(id, `Pokemon ${id}`, `pokemon-${id}`, 'Common');
    const randomValues = [
      0.99, 0.99, 0.000375, 0.00075, ...Array(9).fill(0.000749), 0.99,
      0.99, 0.99, 0.000124, 0.000249, ...Array(9).fill(0.00025), 0.99,
    ];
    const math = Object.create(Math);
    math.random = () => {
      assert.ok(randomValues.length, 'Unexpected random roll');
      return randomValues.shift();
    };
    const saved = [];
    const seen = [];
    const ctx = vm.createContext({
      db, Math: math, assertUserId: () => {},
      WORLD_BOSS_POOL: [{ name: 'Charizard Gmax', catchName: 'Charizard Gmax', formId: 1, rarity: 'Gmax' }],
      BOXES: {}, trackClanActivity: () => {}, recordPokemonSeen: (...args) => seen.push(args),
      addFactionPoints: () => 0, incrementUser: () => ({ world_bosses_fought: 1 }),
      awardCoinsWithBoost: (_id, amount) => ({ finalAmount: amount }),
      isPlayerBonusActive: () => true, rollWorldBossExtraDrops: () => [],
      saveGoldenCatch: (userId, pokemon) => saved.push({ userId, pokemon, variant: 'golden' }),
      saveCatch: (userId, pokemon, shiny) => saved.push({ userId, pokemon, variant: shiny ? 'shiny' : 'normal' }),
    });
    vm.runInContext(extract(dbSource, 'function getBossLeaderboard(', '\n// XS, S and M only'), ctx);
    vm.runInContext(extract(dbSource, 'function claimWorldBossReward(', '\ndb.exec(`\n  CREATE TABLE IF NOT EXISTS pokemon_gifts'), ctx);
    const result = ctx.distributeWorldBossRewards(1);
    assert.equal(randomValues.length, 0);
    assert.equal(result.drops.length, 0);
    assert.equal(result.bonusPokemonDrops.length, 11);
    assert.deepEqual(saved.filter((entry) => entry.userId === 'alice').map((entry) => entry.pokemon.id), formIds.slice(2));
    assert.deepEqual(saved.filter((entry) => entry.userId === 'bob').map((entry) => [entry.pokemon.id, entry.variant]),
      [[95, 'golden'], [131, 'shiny']]);
    assert.equal(saved[0].pokemon.baseDef, 60);
    assert.ok(seen.some(([id, formId, shiny, golden]) => id === 'bob' && formId === 95 && !shiny && golden));
    const claim = ctx.claimWorldBossReward('bob');
    const recorded = JSON.parse(claim.record.bonus_pokemon_json);
    assert.deepEqual(recorded.map((entry) => [entry.id, entry.isGolden, entry.isShiny]),
      [[95, true, false], [131, false, true]]);
    assert.equal(ctx.claimWorldBossReward('bob'), null);
    assert.equal(saved.length, 11);
  } finally { db.close(); }
});

test('a missing bonus form rolls back the entire World Boss reward', () => {
  const db = setupDatabase();
  try {
    db.exec(`
      CREATE TABLE pokemon_forms (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, rarity TEXT,
        base_hp INTEGER, base_atk INTEGER, base_def INTEGER, base_spd INTEGER, is_default INTEGER);
      CREATE TABLE saved_pokemon (user_id TEXT, pokemon_id INTEGER);
      INSERT INTO pokemon_forms VALUES (95, 'Onix', 'onix', 'Rare', 35, 45, 160, 70, 1);
      INSERT INTO world_boss VALUES (1, 'Charizard Gmax', 0, 100, 0, 0, NULL);
      INSERT INTO boss_damage VALUES ('alice', 100, 1);
    `);
    const rolls = [0.99, 0.99, 0, 0];
    const math = Object.create(Math);
    math.random = () => rolls.shift();
    const ctx = vm.createContext({
      db, Math: math, assertUserId: () => {},
      WORLD_BOSS_POOL: [{ name: 'Charizard Gmax', catchName: 'Charizard Gmax', formId: 1, rarity: 'Gmax' }],
      BOXES: {}, trackClanActivity: () => {}, recordPokemonSeen: () => {}, addFactionPoints: () => 0,
      incrementUser: () => {}, awardCoinsWithBoost: (_id, amount) => ({ finalAmount: amount }),
      isPlayerBonusActive: () => false,
      saveGoldenCatch: (id, pokemon) => db.prepare('INSERT INTO saved_pokemon VALUES (?, ?)').run(id, pokemon.id),
    });
    vm.runInContext(extract(dbSource, 'function getBossLeaderboard(', '\nfunction getUnclaimedWorldBossReward('), ctx);
    assert.throws(() => ctx.distributeWorldBossRewards(1), /Missing World Boss bonus Pokémon form 131/);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM saved_pokemon').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM world_boss_rewards').get().count, 0);
    assert.equal(db.prepare('SELECT rewards_claimed FROM world_boss').get().rewards_claimed, 0);
  } finally { db.close(); }
});

test('provided World Boss reward sprite emojis preserve variant and form distinctions', () => {
  const ctx = vm.createContext({});
  vm.runInContext(extract(indexSource, 'const POKEMON_SPRITE_EMOJIS =', '\nfunction formatFactionFavorites('), ctx);
  const shiny = {
    lapras: '1573100226305196244', hoppip: '1573100223884951552', teddiursa: '1573100221418709022',
    miltank: '1573100219187597342', zangoose: '1573100217132126348', seviper: '1573100214565216397',
    tropius: '1573100211943772221', combee: '1573100209167405127', chingling: '1573100206138986516',
    klink: '1573100203760951346',
  };
  for (const [name, id] of Object.entries(shiny)) {
    assert.match(ctx.getPokemonSpriteEmoji({ name, isShiny: true }), new RegExp(`:${id}>$`));
  }
  assert.equal(ctx.getPokemonSpriteEmoji({ name: 'Onix', isGolden: true }), '<:gonix:1573100201831436398>');
  assert.equal(ctx.getPokemonSpriteEmoji({ name: 'Lapras Gmax', isShiny: true }),
    '<:sgmaxlapras:1573093915848998952>');
});

test('new Pokémon sprite emojis preserve existing variants and distinguish Mega Metagross', () => {
  const ctx = vm.createContext({});
  vm.runInContext(extract(indexSource, 'const POKEMON_SPRITE_EMOJIS =', '\nfunction formatFactionFavorites('), ctx);
  const shiny = {
    Magby: '<:smagby:1573354894289674260>', Mudkip: '<:smudkip:1573354896286163114>',
    Aron: '<:saron:1573354898869981304>', Piplup: '<:spiplup:1573354901101350912>',
    Staraptor: '<:sstaraptor:1573354902917222510>', Bronzor: '<:sbronzor:1573354905098256424>',
    Sandile: '<:ssandile:1573354907572895785>', Ducklett: '<:sducklett:1573354910433673459>',
    Galvantula: '<:sgalvantula:1573354913436799096>', Joltik: '<:sjoltik:1573354915529756833>',
    Shelmet: '<:sshelmet:1573354917760868473>', Larvesta: '<:slarvesta:1573354920055275601>',
    Skitty: '<:sskitty:1573354922215215246>', Minun: '<:sminun:1573354924526403737>',
    'Mega Metagross': '<:smegametagross:1573354926606917753>',
    'Metagross Mega': '<:smegametagross:1573354926606917753>',
    Metagross: '<:smetagross:1573354928511131749>', Metang: '<:smetang:1573354930540904589>',
    Beldum: '<:sbeldum:1573354932822741022>', Pancham: '<:spancham:1573354935033266236>',
    Buizel: '<:sbuizel:1573354937386012712>', Swadloon: '<:sswadloon:1573354939340689538>',
    Bunnelby: '<:sbunnelby:1573354941421191168>', Swirlix: '<:sswirlix:1573354943425945752>',
    'Hakamo-o': '<:shakamoo:1573354945867026432>',
  };
  for (const [name, emoji] of Object.entries(shiny)) {
    assert.equal(ctx.getPokemonSpriteEmoji({ name, isShiny: true }), emoji, name);
  }
  assert.equal(ctx.getPokemonSpriteEmoji({ name: 'Wynaut', isGolden: true }), '<:gwynaut:1573354947771371601>');
  assert.equal(ctx.getPokemonSpriteEmoji({ name: 'Frogadier' }), '<:frogadier:1573354950073786438>');
  assert.equal(ctx.getPokemonSpriteEmoji({ name: 'Aron', isGolden: true }), '<:9304:1562208128618209310>');
  assert.equal(ctx.getPokemonSpriteEmoji({ name: 'Mudkip' }), '<:mudkip:1569731168088232066>');
  assert.equal(ctx.getPokemonSpriteEmoji({ name: 'Piplup' }), '<:piplup:1569731162727776287>');
  assert.equal(ctx.getPokemonSpriteEmoji({ name: 'Piplup', isGolden: true }), '<:GPiplup:1569731123251122196>');
});

test('claim displays and logs the boss and each bonus Pokémon together', async () => {
  const logged = [];
  let payload;
  const bonus = [
    { id: 95, name: 'Onix', slug: 'onix', rarity: 'Golden', isGolden: true, isShiny: false },
    { id: 131, name: 'Lapras', slug: 'lapras', rarity: 'Super Rare', isGolden: false, isShiny: true },
  ];
  const ctx = vm.createContext({
    command: 'wb', args: ['claim'], userId: 'alice', PREFIX: '.', EmbedBuilder,
    EMOJIS: { pokecoin: '🪙' }, HELD_ITEM_EMOJI: '📦', WORLD_BOSS_EMOJI: '⚔️',
    WORLD_BOSS_POOL: [{ name: 'Shiny Charizard Gmax', catchName: 'Charizard Gmax',
      formId: 1, isShiny: true, catchRarity: 'Gmax' }],
    claimWorldBossReward: () => ({
      record: { boss_name: 'Shiny Charizard Gmax', boss_id: 1, coins: 30000, rank: 1,
        total_players: 1, damage: 100, max_hp: 100, bonus_pokemon_json: JSON.stringify(bonus) },
      items: [], bossesFought: 1, pokemonDrop: true,
    }),
    message: { guild: {}, author: { id: 'alice' }, reply: async (value) => { payload = value; } },
    getItemEmoji: () => '', notifyAdminIfRareGrant: async (...args) => logged.push(args),
  });
  vm.runInContext(extract(indexSource, 'function parseWorldBossBonusPokemon(', '\nasync function handleWorldBossStats('), ctx);
  const branch = extract(indexSource,
    "    if (command === 'worldboss' || command === 'wb') {",
    "      if (subCommand === 'spawn')") + '    }\n';
  await vm.runInContext(`(async () => {\n${branch}\n})()`, ctx);
  const description = payload.embeds[0].toJSON().description;
  assert.match(description, /Shiny Charizard Gmax/);
  assert.match(description, /Golden Onix/);
  assert.match(description, /Shiny Lapras/);
  assert.equal(logged.length, 3);
  assert.equal(logged[1][2].rarity, 'Golden');
  assert.equal(logged[1][5], true);
  assert.equal(logged[2][4], true);
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
  const bonusPokemon = [
    { id: 95, name: 'Onix', slug: 'onix', rarity: 'Golden', isGolden: true, isShiny: false },
    ...Array.from({ length: 12 }, (_, i) => ({
      id: 200 + i, name: `Bonus${i}`, slug: `bonus${i}`, rarity: 'Common', isGolden: false, isShiny: true,
    })),
  ];
  const ctx = vm.createContext({
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder, WORLD_BOSS_POOL: pool,
    EMOJIS: { pokecoin: '🪙', gmax: '<:gmax:1558841134996791387>', golden: '<:golden:1559951535062909128>',
      shiny: '<:shiny:1558841136905326784>' },
    HELD_ITEM_EMOJI: '<:helditem:1561412843272937472>',
    getPokemonSpriteEmoji: () => '', getItemEmoji: () => '', console,
    getWorldBossStats: () => ({
      contributions: [{ boss_name: 'Mon0 Gmax', fights: 2, damage: 40 }, { boss_name: 'Shiny Mon0 Gmax', fights: 1, damage: 5 }],
      rewards: [
        { boss_name: 'Shiny Mon0 Gmax', rank: 1, coins: 30000, coins_awarded: 45000, pokemon_drop: 1,
          bonus_pokemon_json: JSON.stringify(bonusPokemon),
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
  assert.equal(first.fields.length, 4);
  assert.ok(first.fields.every((field) => field.value.length <= 1024));
  assert.equal(payloads[0].components[0].toJSON().components.length, 3);
  let denied;
  await handlers.collect({ user: { id: 'other' }, reply: async (payload) => { denied = payload; } });
  assert.equal(denied.ephemeral, true);
  const press = async (action) => handlers.collect({ user: { id: 'alice' }, customId: `wbstats:${action}`,
    update: async (payload) => payloads.push(payload) });
  await press('pokemon');
  const pokemonPage = payloads.at(-1);
  const pokemonDescription = pokemonPage.embeds[0].toJSON().description;
  assert.match(pokemonDescription, /<:gmax:1558841134996791387> Boss Pokémon received: 2/);
  assert.match(pokemonDescription, /<:golden:1559951535062909128> Golden Pokémon received: 1/);
  assert.match(pokemonDescription, /<:shiny:1558841136905326784> Shiny Pokémon received: 13/);
  assert.match(pokemonDescription, /<:caught:1560340176713031711> Total Pokémon received: 15/);
  const pokemonButtons = pokemonPage.components[0].toJSON().components;
  assert.equal(pokemonButtons.length, 5);
  assert.equal(pokemonButtons[1].emoji.id, '1560340176713031711');
  assert.equal(pokemonButtons[2].emoji.id, '1561412843272937472');
  assert.equal(pokemonButtons[3].emoji.name, '◀️');
  assert.equal(pokemonButtons[4].emoji.name, '▶️');
  await press('next');
  assert.match(payloads.at(-1).embeds[0].toJSON().footer.text, /Page 2\/2/);
  await press('items');
  const itemsPage = payloads.at(-1).embeds[0].toJSON();
  assert.match(itemsPage.description, /PokéCoins rewarded: 57,000/);
  assert.match(itemsPage.description, /Items rewarded: 31/);
  assert.match(itemsPage.description, /Mega Rare items rewarded: 1/);
  assert.match(itemsPage.footer.text, /Older coin rewards/);
  assert.match(itemsPage.fields.map((field) => field.value).join('\n'), /Item 14/);
  assert.equal(payloads.at(-1).components[0].toJSON().components.length, 3);
  await press('basic');
  assert.match(payloads.at(-1).embeds[0].toJSON().fields.at(-1).value, /Mon30/);
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
    EMOJIS: { pokecoin: '🪙' }, HELD_ITEM_EMOJI: '<:helditem:1561412843272937472>',
    getPokemonSpriteEmoji: () => '<:sgmaxurshifushinglestrike:1573093823238897725>',
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
  for (const payload of payloads) {
    assert.ok(payload.embeds[0].toJSON().fields.every((field) => field.value.length <= 1024));
  }
  assert.equal(payloads[0].components[0].toJSON().components.length, 3);
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
  vm.runInContext(extract(indexSource, 'async function handleWorldBossHighscores(', '\nfunction isBotAdmin('), ctx);
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
  assert.match(first.footer.text, /Page 1\/7/);
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
