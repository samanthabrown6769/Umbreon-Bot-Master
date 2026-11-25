const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Database = require('better-sqlite3');
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, Collection, ComponentType, EmbedBuilder, MessageMentions, PermissionsBitField,
} = require('discord.js');
const battle = require('../battle-effects');
const { BOXES } = require('../boxes');
const { pickWeighted } = require('../spawn-weights');

const indexSource = fs.readFileSync(require.resolve('../index.js'), 'utf8');
const dbSource = fs.readFileSync(require.resolve('../db.js'), 'utf8');
const promoSource = fs.readFileSync(require.resolve('../promo.js'), 'utf8');

function extract(source, start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `Could not extract ${start}`);
  return source.slice(first, last);
}

function mon(name, types) {
  return { name, types, hp: 100, max_hp: 100, atk: 50, def: 50, spd: 50, level: 50 };
}

test('perfect IVs boost the calculated stat after variant bonuses', () => {
  const ctx = vm.createContext({ SHINY_STAT_MULTIPLIER: 1.05 });
  vm.runInContext(extract(dbSource, 'function calculateStat(', '\nconst DUPLICATE_CATCH_STATE_FIELDS'), ctx);
  for (const isHp of [false, true]) {
    for (const [shiny, golden, rarity] of [
      [false, false, 'Common'], [true, false, 'Common'], [false, true, 'Common'],
      [false, false, 'Gem'], [true, true, 'Gem'],
    ]) {
      const oldStat = (iv) => {
        const points = 2 * 83 + iv + Math.floor(132 / 4);
        const base = Math.floor(points * 73 / 100) + (isHp ? 73 + 10 : 5);
        const variant = base + (golden ? 10 : 0) + (rarity === 'Gem' ? 5 : 0);
        return shiny ? Math.floor(variant * 1.05) : variant;
      };
      assert.equal(ctx.calculateStat(83, 30, 73, isHp, shiny, 132, golden, rarity), oldStat(30));
      assert.equal(ctx.calculateStat(83, 31, 73, isHp, shiny, 132, golden, rarity),
        Math.floor(oldStat(31) * 11 / 10));
    }
  }
});

test('gameplay override users have a displayed and applied 100% catch rate', () => {
  const overrideIds = new Set(['537500331953881088', '1573782664773767301']);
  const ctx = vm.createContext({ GUARANTEED_CATCH_RATE_USER_IDS: overrideIds });
  vm.runInContext(
    extract(indexSource, 'function getBallCatchRate(', '\nfunction getCatchChance('),
    ctx
  );
  const ball = { catchChance: 27 };
  const target = { isShiny: false };
  for (const id of overrideIds) {
    assert.equal(ctx.getBallCatchRate('pb', ball, target, 'Common', 27, 0, 0, id), 100);
  }
  assert.equal(ctx.getBallCatchRate('pb', ball, target, 'Common', 27, 0, 0, '1514082847609061541'), 27);
  assert.equal(ctx.getBallCatchRate('pb', ball, target, 'Common', 27, 0, 0, 'ordinary'), 27);
});

test('encounter rate text on spawn embeds rounds down fractional rates', () => {
  const ctx = vm.createContext({
    getRaritySettings: () => [
      { name: 'Common', encounter_rate: 24.9, catch_chance: 30 },
    ],
  });
  vm.runInContext(extract(indexSource, 'function getRarityInfo(', '\nconst PREMIERBALL_RATES'), ctx);
  assert.equal(ctx.getRarityInfo('Common').rateText, '24% encounter rate');
});

test('perfect IV migration updates existing stats once and preserves fainted HP', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE migration_flags (name TEXT PRIMARY KEY);
      CREATE TABLE pokemon_forms (id INTEGER PRIMARY KEY, base_hp INTEGER, base_atk INTEGER,
        base_def INTEGER, base_spd INTEGER);
      INSERT INTO pokemon_forms VALUES (1, 80, 90, 100, 110);
      CREATE TABLE catches (id INTEGER PRIMARY KEY, pokemon_id INTEGER, level INTEGER, hp INTEGER,
        max_hp INTEGER, atk INTEGER, def INTEGER, spd INTEGER, hp_iv INTEGER, atk_iv INTEGER,
        def_iv INTEGER, spd_iv INTEGER, ev_hp INTEGER, ev_atk INTEGER, ev_def INTEGER, ev_spe INTEGER,
        is_shiny INTEGER, is_golden INTEGER, rarity TEXT);
      INSERT INTO catches VALUES
        (1, 1, 100, 100, 201, 216, 235, 255, 31, 31, 30, 30, 0, 0, 0, 0, 0, 0, 'Common'),
        (2, 1, 100, 0, 211, 226, 246, 266, 31, 31, 31, 31, 0, 0, 0, 0, 0, 1, 'Gem'),
        (3, 1, 100, 100, 201, 215, 235, 255, 30, 30, 30, 30, 0, 0, 0, 0, 0, 0, 'Common'),
        (4, 1, 100, 0, 211, 226, 246, 266, 31, 31, 31, 31, 0, 0, 0, 0, 1, 0, 'Common');
    `);
    const ctx = vm.createContext({ db, SHINY_STAT_MULTIPLIER: 1.05 });
    vm.runInContext(extract(dbSource, 'function calculateStat(', '\nconst DUPLICATE_CATCH_STATE_FIELDS'), ctx);
    vm.runInContext(extract(dbSource, 'function applyShinyStatBonus()', '\nreconcileDuplicateCatchStates();'), ctx);
    const get = (id) => db.prepare('SELECT * FROM catches WHERE id = ?').get(id);
    const first = get(1);
    assert.equal(first.max_hp, ctx.calculateStat(80, 31, 100, true));
    assert.equal(first.hp, Math.round(100 / 201 * first.max_hp));
    assert.equal(first.atk, ctx.calculateStat(90, 31, 100));
    assert.equal(first.def, 235);
    assert.equal(first.spd, 255);
    assert.equal(get(2).hp, 0);
    assert.equal(get(2).atk, ctx.calculateStat(90, 31, 100, false, false, 0, true, 'Gem'));
    assert.equal(get(4).hp, 0);
    assert.equal(get(4).atk, ctx.calculateStat(90, 31, 100, false, true));
    assert.equal(get(3).atk, 215);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM migration_flags').get().count, 1);
    db.prepare('UPDATE catches SET atk = 777 WHERE id = 1').run();
    ctx.migratePerfectIvStats();
    assert.equal(get(1).atk, 777);
  } finally { db.close(); }
});

test('perfect IV migration rolls back stat updates and its flag on failure', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE migration_flags (name TEXT PRIMARY KEY);
      CREATE TABLE pokemon_forms (id INTEGER PRIMARY KEY, base_hp INTEGER, base_atk INTEGER, base_def INTEGER, base_spd INTEGER);
      INSERT INTO pokemon_forms VALUES (1, 50, 50, 50, 50);
      CREATE TABLE catches (id INTEGER PRIMARY KEY, pokemon_id INTEGER, level INTEGER, hp INTEGER, max_hp INTEGER,
        atk INTEGER, def INTEGER, spd INTEGER, hp_iv INTEGER, atk_iv INTEGER, def_iv INTEGER, spd_iv INTEGER,
        ev_hp INTEGER, ev_atk INTEGER, ev_def INTEGER, ev_spe INTEGER, is_shiny INTEGER, is_golden INTEGER, rarity TEXT);
      INSERT INTO catches VALUES (1, 1, 50, 100, 100, 100, 100, 100, 31, 31, 31, 31, 0, 0, 0, 0, 0, 0, 'Common');
      CREATE TRIGGER reject_flag BEFORE INSERT ON migration_flags BEGIN SELECT RAISE(ABORT, 'test failure'); END;
    `);
    const ctx = vm.createContext({ db, SHINY_STAT_MULTIPLIER: 1.05 });
    vm.runInContext(extract(dbSource, 'function calculateStat(', '\nconst DUPLICATE_CATCH_STATE_FIELDS'), ctx);
    vm.runInContext(extract(dbSource, 'function migratePerfectIvStats()', '\nmigratePerfectIvStats();'), ctx);
    assert.throws(() => ctx.migratePerfectIvStats(), /test failure/);
    assert.equal(db.prepare('SELECT atk FROM catches').get().atk, 100);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM migration_flags').get().count, 0);
  } finally { db.close(); }
});

test('special battle EV contributions also receive the perfect IV bonus', () => {
  const attacker = { ...mon('attacker', ['normal']), level: 100, atk: 110, ev_spa: 200, spa_iv: 31 };
  const defender = { ...mon('defender', ['normal']), level: 100, def: 110, ev_spdef: 200, spdef_iv: 31 };
  const field = battle.createField();
  let result = battle.damageStats(attacker, defender, { category: 'special' }, field);
  assert.equal(result.atk, 165);
  assert.equal(result.def, 165);
  result = battle.damageStats(attacker, defender, { category: 'physical' }, field);
  assert.equal(result.atk, 110);
  assert.equal(result.def, 110);
  attacker.spa_iv = 30;
  defender.spdef_iv = 30;
  result = battle.damageStats(attacker, defender, { category: 'special' }, field);
  assert.equal(result.atk, 160);
  assert.equal(result.def, 160);
});

test('lottery draw selects all winners from ticket-weighted entries', () => {
  const smallTicketHolderId = 'small-ticket-holder';
  const adminIds = new Set(['admin-one', 'admin-two']);
  const endsAt = Date.parse('2026-11-16T01:00:00Z');
  const setup = (deadline, entries, random = 0) => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE lottery_state (id INTEGER PRIMARY KEY, jackpot INTEGER, ends_at INTEGER);
      CREATE TABLE lottery_tickets (user_id TEXT PRIMARY KEY, ticket_count INTEGER);
      CREATE TABLE lottery_user_stats (user_id TEXT PRIMARY KEY, wins_first INTEGER DEFAULT 0,
        wins_second INTEGER DEFAULT 0, wins_third INTEGER DEFAULT 0, lifetime_winnings INTEGER DEFAULT 0,
        lifetime_tickets INTEGER DEFAULT 0);
      CREATE TABLE users (id TEXT PRIMARY KEY, lotteries_won INTEGER DEFAULT 0);
      CREATE TABLE pokemon_forms (id INTEGER, species_id INTEGER, is_default INTEGER, name TEXT,
        base_hp INTEGER, base_atk INTEGER, base_def INTEGER, base_spd INTEGER);
      INSERT INTO pokemon_forms VALUES (133, 133, 1, 'Eevee', 1, 1, 1, 1);
    `);
    db.prepare('INSERT INTO lottery_state VALUES (1, 1000, ?)').run(deadline);
    for (const [id, count] of entries) {
      db.prepare('INSERT INTO lottery_tickets VALUES (?, ?)').run(id, count);
      db.prepare('INSERT INTO users (id) VALUES (?)').run(id);
      db.prepare('INSERT INTO lottery_user_stats (user_id, lifetime_tickets) VALUES (?, ?)').run(id, count);
    }
    const saved = [];
    const warnings = [];
    const math = Object.create(Math);
    math.random = () => random;
    const context = vm.createContext({
      db, Math: math, Date, console: { warn: (text) => warnings.push(text) },
      LOTTERY_FIRST_PLACE_EXCLUDED_USER_ID: smallTicketHolderId,
      LOTTERY_NON_WINNER_USER_IDS: adminIds,
      LOTTERY_SCHEDULE: { 0: { name: 'Golden Eevee', speciesId: 133 } },
      LOTTERY_TICKET_PRICE: 10000, LOTTERY_BASE_JACKPOT: 5000000,
      getLotteryState: () => db.prepare('SELECT * FROM lottery_state').get(),
      getNextLotteryDrawTime: (now) => now + 86400000,
      getUser: () => {}, getUserLotteryStats: () => {},
      awardCoinsWithBoost: (_id, amount) => ({ finalAmount: amount }),
      saveGoldenCatch: (id) => saved.push(id),
    });
    vm.runInContext(extract(dbSource, 'function drawLottery(', '\nfunction setAutoSpawnChannel('), context);
    return { db, context, saved, warnings };
  };
  const entries = [
    ['other', 100],
    [smallTicketHolderId, 1],
    ['third', 2],
    ['admin-one', 200],
    ['admin-two', 300],
  ];
  let state = setup(endsAt, entries);
  try {
    assert.equal(state.context.drawLottery(endsAt - 1).error, 'not_due');
    const result = state.context.drawLottery(Date.parse('2026-11-17T06:00:00Z'));
    assert.deepEqual(Array.from(result.winners, (winner) => winner.userId), ['other', smallTicketHolderId, 'third']);
    assert.equal(result.winners.some((winner) => adminIds.has(winner.userId)), false);
    assert.equal(result.totalTickets, 603);
    assert.equal(result.goldenPrize.name, 'Golden Eevee');
    assert.equal(result.scheduledAt, endsAt);
    assert.deepEqual(state.saved, ['other']);
    assert.equal(state.db.prepare('SELECT wins_first FROM lottery_user_stats WHERE user_id = ?').get('other').wins_first, 1);
    assert.equal(state.db.prepare('SELECT COUNT(*) AS n FROM lottery_tickets').get().n, 0);
    assert.equal(state.warnings.length, 0);
  } finally { state.db.close(); }
});

test('reply mentions do not become command targets unless explicitly mentioned', () => {
  const ctx = vm.createContext({});
  vm.runInContext(extract(indexSource, 'function ignoreImplicitReplyMention(', '\nconst originalResolveBody'), ctx);
  const replied = { id: '1258056251967930409' };
  const other = { id: '1258056251967930410' };
  const users = new Collection([[replied.id, replied], [other.id, other]]);
  const client = { users: { cache: users, _add: (user) => user } };
  const check = (content, mentioned, repliedUser) => {
    const message = { content, client, guild: null };
    message.mentions = new MessageMentions(message, new Collection(mentioned.map((user) => [user.id, user])),
      [], false, [], repliedUser);
    ctx.ignoreImplicitReplyMention(message);
    return [...message.mentions.users.keys()];
  };
  assert.deepEqual(check('.profile', [replied], replied), []);
  assert.deepEqual(check('.profile', [replied], null), []);
  assert.deepEqual(check(`.profile <@${other.id}>`, [replied, other], replied), [other.id]);
  assert.deepEqual(check(`.profile <@!${replied.id}>`, [replied], replied), [replied.id]);
  assert.deepEqual(check(`.profile <@${other.id}>`, [other], null), [other.id]);
});

test('admin buddy info dispatches to the requested user profile', async () => {
  const targetId = '1258056251967930409';
  const pokemon = {
    id: 12, pokemon_id: 150, species_id: 150, name: 'Mega Mewtwo Y', slug: 'mewtwo-mega-y',
    ever_buddy: 1, level: 100, experience: 75000000, types: '[]',
    atk_iv: 1, def_iv: 1, hp_iv: 1, spa_iv: 1, spdef_iv: 1, spd_iv: 1,
  };
  const replies = [];
  const lookups = [];
  const ctx = vm.createContext({
    command: 'admin', args: ['bud', 'info', targetId, 'mega-mewtwo-y'],
    userId: 'admin', buddyProfileOwnerId: 'admin', buddyProfileAdminView: false,
    isBotAdmin: () => true, PREFIX: '.', console, EmbedBuilder, ActionRowBuilder,
    ButtonBuilder, ButtonStyle, ComponentType, EMOJIS: {}, EV_STATS: [], EV_TOTAL_LIMIT: 510,
    db: { prepare: () => ({ get: (id) => id === targetId }) },
    findUserPokemonMatches: (owner, query) => { lookups.push([owner, query]); return [pokemon]; },
    getUserBuddy: (owner, id) => owner === targetId && id === pokemon.id ? pokemon : null,
    fetchPokemonAbilities: async () => [], experienceForNextLevel: () => 0,
    getPatreonPerks: () => ({}), getEvolutionRoute: () => [], getPokemonShowdownSprite: () => null,
    getRarityEmojis: () => '', getTypeEmoji: () => '',
    message: { author: { id: 'admin', username: 'Admin' }, mentions: { users: new Collection() },
      reply: async (payload) => {
        replies.push(payload);
        return { createMessageComponentCollector: () => ({ on: () => {} }) };
      } },
  });
  const admin = extract(indexSource, '    adminCommands: if (command', "\n    if (command === 'worldboss'");
  const buddy = extract(indexSource, "    if (command === 'buddy' || command === 'bud') {",
    "\n    if (command === 'faction'");
  vm.runInContext(`async function run() { ${admin}\n${buddy}\n}`, ctx);
  await ctx.run();
  assert.deepEqual(lookups, [[targetId, 'mega-mewtwo-y']]);
  assert.match(replies[0].embeds[0].toJSON().title, /1258056251967930409.*Mega Mewtwo Y/);
  assert.deepEqual(replies[0].components[0].toJSON().components.map((button) => button.custom_id),
    ['buddy-info:view-moves']);

  ctx.command = 'admin';
  ctx.args = ['buddy', 'info', `<@${targetId}>`, 'mega-mewtwo-y'];
  await ctx.run();
  assert.deepEqual(lookups.at(-1), [targetId, 'mega-mewtwo-y']);
  assert.equal(replies.length, 2);

  ctx.command = 'admin';
  ctx.args = ['buddy', 'info', `<@${targetId}>`, 'mega-mewtwo-y'];
  ctx.isBotAdmin = () => false;
  await ctx.run();
  assert.match(replies.at(-1), /do not have permission/);
  assert.equal(lookups.length, 2);
});

test('stats reports users without an existing profile without creating one', async () => {
  const replies = [];
  let summaryCalls = 0;
  const targetId = '123456789012345';
  const context = vm.createContext({
    PREFIX: '.',
    resolveCommandUser: async () => ({ user: { id: targetId } }),
    db: {
      prepare: (query) => {
        assert.equal(query, 'SELECT 1 FROM users WHERE id = ?');
        return { get: (id) => {
          assert.equal(id, targetId);
          return undefined;
        } };
      },
    },
    getUserStatsSummary: () => { summaryCalls++; },
  });
  const statsCommand = extract(indexSource, 'async function handleStatsCommand(', '\nclient.on(\'interactionCreate\'');
  vm.runInContext(statsCommand, context);
  const result = await context.handleStatsCommand(
    { reply: async (text) => { replies.push(text); return text; } },
    [`<@${targetId}>`]
  );
  assert.equal(result, `<@${targetId}> does not have a profile.`);
  assert.deepEqual(replies, [`<@${targetId}> does not have a profile.`]);
  assert.equal(summaryCalls, 0);
});

test('ordinary admin catches use normal rates while shared admin spawns stay guaranteed', async () => {
  const spawnOptions = [];
  const encounterOptions = [];
  const ctx = vm.createContext({
    command: 'p', args: [], userId: 'regular-admin',
    message: { author: { id: 'regular-admin', username: 'Admin' }, guildId: 'guild', channelId: 'channel',
      reply: async (text) => text },
    isBotAdmin: () => true, isConfiguredBotAdmin: () => true,
    catchCooldowns: new Set(), fishCooldowns: new Set(),
    isCooldownExemptUser: () => false,
    consumeCooldownMachineForEarlyUse: () => false, getCooldownReadyTimestamp: () => 'later',
    scheduleCooldownNotification: () => ({}), POKEMON_COOLDOWN_MS: 8000, PREFIX: '.',
    getUser: () => ({ grazz_buff_encounters: 0 }), getRoleEncounterBoost: async () => 0,
    getMessageChannelCatchRateBoost: () => 0, getMessageIncenseScope: (message) => message.guildId,
    rollSpawn: (_pool, _user, _rod, options) => {
      spawnOptions.push(options);
      return { name: 'Test' };
    },
    getFishingRod: () => ({ name: 'Rod', baseSpawnChance: 0, pullWaitMs: 20000 }),
    getPatreonPerks: () => ({ fishingBoost: 0, goldenBoost: 0 }),
    resolveLeadOverworldAbility: async () => null, getFishingAbilityMultiplier: () => 1,
    FISH_EXCLUSIVE_GOLDEN_DENOMINATOR: 1000, isPlayerBonusActive: () => false,
    resolvePokemonForm: () => ({ id: 1, name: 'Test', rarity: 'Common', types: '[]' }),
    WILD_HELD_ITEM_GROUPS: [{ name: 'Item', emoji: ':item:' }],
    RESEARCH_HOLDABLE_ITEM_NAMES: [], RESEARCH_ITEM_EMOJIS: {}, RESEARCH_VALUABLES: [], RESEARCH_RELICS: [],
    activeRegularEncounters: new Set(),
    reserveRegularEncounter: () => () => {},
    askForBall: async (_message, _userId, _target, _mode, options) => {
      encounterOptions.push(options);
      return options;
    },
  });
  vm.runInContext(extract(indexSource, 'function startPokemonCooldown(', '\nasync function fetchPokemonAbilities('), ctx);
  vm.runInContext(`async function run() { ${extract(indexSource, "    if (command === 'pokemon' || command === 'p') {", "\n    if (command === 'clan') {")} }`, ctx);
  assert.notEqual((await ctx.run()).guaranteedCatch, true);
  assert.equal(encounterOptions.at(-1).timeoutMs, 7000);
  assert.equal('useSpawnPity' in spawnOptions.at(-1), false);
  ctx.command = 'fish';
  assert.notEqual((await ctx.run()).guaranteedCatch, true);
  assert.equal(encounterOptions.at(-1).timeoutMs, 10000);
  assert.equal('useSpawnPity' in spawnOptions.at(-1), false);
  assert.match(await ctx.run(), /fish again later/);
  ctx.command = 'p';
  ctx.args = ['admin', 'Test'];
  assert.match(await ctx.run(), /catch again later/);
  ctx.catchCooldowns.clear();
  const shared = await ctx.run();
  assert.equal(shared.guaranteedCatch, true);
  assert.equal(shared.allowAnyUserCatch, true);
  assert.equal(encounterOptions.at(-1).timeoutMs, 7000);
  ctx.args = ['admin', 'helditem', 'Test'];
  assert.match(await ctx.run(), /catch again later/);
  ctx.catchCooldowns.clear();
  assert.equal((await ctx.run()).guaranteedCatch, true);
  assert.equal(encounterOptions.at(-1).timeoutMs, 7000);

  const prefix = extract(indexSource, 'async function askForBall(', '\n  const overworldAbility =');
  vm.runInContext(`${prefix}\n  return guaranteedCatch;\n}`, ctx);
  assert.equal(await ctx.askForBall(null, ctx.userId, {}, 'catch'), false);
  assert.equal(await ctx.askForBall(null, ctx.userId, {}, 'catch', { guaranteedCatch: true, allowAnyUserCatch: true }), true);
});

test('regular encounters block both spawn commands until finished without bypassing cooldowns', async () => {
  const replies = [];
  let endEncounter;
  let rollFails = false;
  const ctx = vm.createContext({
    command: 'p', args: [], userId: 'player',
    message: { author: { id: 'player', username: 'Player' }, guildId: 'guild', channelId: 'channel',
      reply: async (text) => { replies.push(text); return text; } },
    isConfiguredBotAdmin: () => false,
    catchCooldowns: new Set(), fishCooldowns: new Set(),
    isCooldownExemptUser: () => false,
    isEncounterCooldownExemptUser: () => false,
    consumeCooldownMachineForEarlyUse: () => false, getCooldownReadyTimestamp: () => 'later',
    scheduleCooldownNotification: () => ({}), POKEMON_COOLDOWN_MS: 8000, PREFIX: '.',
    getUser: () => ({ grazz_buff_encounters: 0 }), getRoleEncounterBoost: async () => {
      if (rollFails) throw new Error('spawn failed');
      return 0;
    },
    getMessageChannelCatchRateBoost: () => 0, getMessageIncenseScope: (message) => message.guildId,
    rollSpawn: () => ({ name: 'Test' }),
    getFishingRod: () => ({ name: 'Rod', cooldownMs: 20000, baseSpawnChance: 1, pullWaitMs: 20000 }),
    getPatreonPerks: () => ({ fishingBoost: 0, goldenBoost: 0 }),
    resolveLeadOverworldAbility: async () => null, getFishingAbilityMultiplier: () => 1,
    FISH_EXCLUSIVE_GOLDEN_DENOMINATOR: 1000, isPlayerBonusActive: () => false,
    askForBall: async (_message, _userId, _target, _mode, options) => { endEncounter = options.onEnd; },
  });
  vm.runInContext(extract(indexSource, 'const activeRegularEncounters = new Set();', '\nconst activeLeagueBattles'), ctx);
  vm.runInContext(extract(indexSource, 'function startPokemonCooldown(', '\nasync function fetchPokemonAbilities('), ctx);
  vm.runInContext(`async function run() { ${extract(indexSource, "    if (command === 'pokemon' || command === 'p') {", "\n    if (command === 'clan') {")} }`, ctx);
  await ctx.run();
  ctx.command = 'fish';
  await ctx.run();
  assert.match(replies.at(-1), /Finish your current/);
  assert.equal(ctx.fishCooldowns.size, 0);
  endEncounter();
  ctx.command = 'p';
  await ctx.run();
  assert.match(replies.at(-1), /catch again later/);
  ctx.catchCooldowns.clear();
  rollFails = true;
  await assert.rejects(ctx.run(), /spawn failed/);
  ctx.catchCooldowns.clear();
  rollFails = false;
  await ctx.run();
  endEncounter();
  ctx.command = 'fish';
  await ctx.run();
  assert.equal(ctx.fishCooldowns.has(ctx.userId), true);
  endEncounter();
  await ctx.run();
  assert.match(replies.at(-1), /fish again later/);
  ctx.catchCooldowns.clear();
  ctx.fishCooldowns.clear();
  const exemptIds = new Set(['537500331953881088', '1573782664773767301']);
  ctx.isEncounterCooldownExemptUser = (id) => exemptIds.has(id);
  for (const id of exemptIds) {
    ctx.userId = id;
    ctx.message.author.id = id;
    await ctx.run();
    assert.equal(ctx.catchCooldowns.has(id), false);
    endEncounter();
    ctx.command = 'fish';
    await ctx.run();
    assert.equal(ctx.fishCooldowns.has(id), false);
    endEncounter();
    ctx.command = 'p';
  }
  const cooldownReenabledId = '1514082847609061541';
  ctx.userId = cooldownReenabledId;
  ctx.message.author.id = cooldownReenabledId;
  await ctx.run();
  assert.equal(ctx.catchCooldowns.has(cooldownReenabledId), true);
  endEncounter();
  ctx.command = 'fish';
  await ctx.run();
  assert.equal(ctx.fishCooldowns.has(cooldownReenabledId), true);
  endEncounter();
  ctx.catchCooldowns.clear();
  ctx.fishCooldowns.clear();
  ctx.command = 'fish';
  ctx.fishCooldowns.clear();
  ctx.isConfiguredBotAdmin = () => false;
  ctx.getFishingRod = () => ({ name: 'Rod', cooldownMs: 20000, baseSpawnChance: 0, pullWaitMs: 20000 });
  await ctx.run();
  assert.match(replies.at(-1), /nothing bit/);
  ctx.command = 'p';
  await ctx.run();
  assert.doesNotMatch(replies.at(-1), /Finish your current/);
});

test('Diveball text alias resolves to the fishing-only ball and supports retrying empty balls', async () => {
  const ctx = vm.createContext({ BALL_CONFIG: { pb: {}, dv: { fishingOnly: true } } });
  vm.runInContext(extract(indexSource, 'function getTextBallKey(', '\nconst BALLDEX_BALLS'), ctx);
  assert.equal(ctx.getTextBallKey(' DB '), 'dv');
  assert.equal(ctx.getTextBallKey('dv'), 'dv');
  const filter = extract(indexSource, '      filter: (response) => (allowAnyUserCatch || response.author.id === userId)', '\n      time: timeoutMs,');
  ctx.userId = 'player';
  ctx.allowAnyUserCatch = false;
  ctx.isFishing = true;
  vm.runInContext(`function makeFilter() { return { ${filter} }; }`, ctx);
  const response = { author: { id: 'player' }, content: 'db' };
  assert.equal(ctx.makeFilter().filter(response), true);
  ctx.isFishing = false;
  assert.equal(ctx.makeFilter().filter(response), false);
  assert.doesNotMatch(extract(indexSource, '    : message.channel.createMessageCollector({', '\n  if (inline?.onCancelReady)'), /max:/);
});

test('encounter lock releases on resolution or expiry, not when an empty ball is selected', async () => {
  const handlers = {};
  const actions = [];
  let releaseCount = 0;
  let resolveCatch;
  const ctx = vm.createContext({
    activeCatchEncounters: new Map(), spawnMessage: { id: 'spawn', edit: async () => {} },
    BALL_CONFIG: { dv: { fishingOnly: true } }, isFishing: true, allowAnyUserCatch: false, userId: 'player',
    onHandler: null, target: { name: 'Test' }, console,
    buttonCollector: { on: (event, fn) => { handlers[`button-${event}`] = fn; }, stop: () => {} },
    textCollector: { on: (event, fn) => { handlers[`text-${event}`] = fn; }, stop: () => {} },
    onEnd: () => { releaseCount++; },
    getTextBallKey: (text) => text.toLowerCase() === 'db' ? 'dv' : text.toLowerCase(),
    message: { channel: { send: async () => {} } },
    handleCatch: async (ball) => {
      actions.push(ball);
      if (actions.length === 1) {
        vm.runInContext('actionTaken = false', ctx);
      } else {
        await new Promise((resolve) => { resolveCatch = resolve; });
      }
    },
  });
  vm.runInContext('let actionTaken = false; let encounterClosed = false;', ctx);
  vm.runInContext(extract(indexSource, "  textCollector.on('collect'", '\n}\n\nconst TYPE_EFFECTIVENESS'), ctx);
  await handlers['text-collect']({ content: 'db', author: { id: 'player' } });
  assert.deepEqual(actions, ['dv']);
  assert.equal(releaseCount, 0);
  const pending = handlers['text-collect']({ content: 'db', author: { id: 'player' } });
  await handlers['button-end']([], 'time');
  assert.equal(releaseCount, 0);
  resolveCatch();
  await pending;
  assert.equal(releaseCount, 1);
  vm.runInContext('actionTaken = false; encounterClosed = false;', ctx);
  await handlers['button-end']([], 'time');
  assert.equal(releaseCount, 2);
});

test('button catches release the encounter lock after processing, but allow retrying empty balls', async () => {
  const encounters = new Map();
  let releaseCount = 0;
  let finishCatch;
  let hasBall = false;
  const ctx = vm.createContext({
    activeCatchEncounters: encounters,
    spawnMessage: { id: 'spawn', edit: async () => {} },
    BALL_CONFIG: { pb: {} }, isFishing: false, allowAnyUserCatch: false, userId: 'player',
    onEnd: () => { releaseCount++; },
    handleCatch: async () => {
      if (!hasBall) {
        vm.runInContext('actionTaken = false', ctx);
        return;
      }
      await new Promise((resolve) => { finishCatch = resolve; });
    },
    console,
  });
  vm.runInContext('let actionTaken = false; let encounterClosed = false;', ctx);
  vm.runInContext(extract(indexSource, '  activeCatchEncounters.set(spawnMessage.id,', '\n  if (onHandler)'), ctx);
  const interaction = { customId: 'catch:pb', user: { id: 'player' }, deferred: true };
  await encounters.get('spawn')(interaction);
  assert.equal(releaseCount, 0);
  hasBall = true;
  const pending = encounters.get('spawn')(interaction);
  assert.equal(releaseCount, 0);
  finishCatch();
  await pending;
  assert.equal(releaseCount, 1);
});

test('failed catches show the Pokémon image at the bottom of one encounter embed', async () => {
  const edits = [];
  const ctx = vm.createContext({
    isSuccess: false,
    userId: 'trainer',
    target: { id: 1, name: 'Combee', rarity: 'Uncommon', isShiny: false, isGolden: false },
    catcher: { username: 'Trainer' },
    ball: { name: 'Pokeball', image: 'pokeball.png', emoji: '🔴' },
    catchDisplayRarity: 'Uncommon',
    rarityData: { rateText: '30% encounter rate' },
    tracksRarityStreak: true,
    currentStreak: 9,
    playerRoll: 77,
    targetRate: 70,
    resultNinjaBoostText: '',
    image: 'https://example.test/combee.png',
    EmbedBuilder,
    halloweenEvent: {},
    EVENT_EMBED_COLOR: 0xabcdef,
    isEventOpen: () => false,
    isEventChecklistSpawn: () => false,
    getRarityColor: () => 0x123456,
    getRarityEmojis: () => '',
    factionLogoPrefix: () => '',
    heldItemEncounterHint: () => '',
    recordPokemonSeen: () => {},
    resetRarityStreaks: () => {},
    getRemainingBalls: () => 'Pokeballs: 79 • Greatballs: 106',
    editEncounter: async (payload) => edits.push(payload),
  });
  const failedCatch = extract(indexSource, '    if (!isSuccess) {', '\n    const { finalAmount: coinsEarned }');
  vm.runInContext(`async function run() { ${failedCatch} }`, ctx);

  await ctx.run();

  assert.equal(edits.length, 1);
  assert.equal(edits[0].content, '');
  assert.equal(edits[0].embeds.length, 1);
  const embed = edits[0].embeds[0].toJSON();
  assert.equal(embed.author.name, '❌ Trainer used a Pokeball!');
  assert.match(embed.description, /Your Uncommon streak of 9 has been reset!/);
  assert.equal(embed.image.url, 'https://example.test/combee.png');
  assert.equal(embed.thumbnail, undefined);
  assert.doesNotMatch(embed.description, /Patreon catch rate/);
  ctx.resultNinjaBoostText = ' (+5% Patreon catch rate)';
  await ctx.run();
  assert.match(edits[1].embeds[0].toJSON().description, /Your catch rate: \*\*70%\*\* \(\+5% Patreon catch rate\)/);
});

test('failed catch processing reuses the encounter rarity-streak state', async () => {
  const edits = [];
  const context = vm.createContext({
    activeCatchEncounters: new Map(),
    actionTaken: false,
    allowAnyUserCatch: false,
    buttonCollector: { stop: () => {} },
    textCollector: { stop: () => {} },
    BALL_CONFIG: { pb: { column: 'pokeballs', name: 'Pokéball', image: 'pokeball.png', emoji: '🔴' } },
    db: { transaction: (callback) => ({ immediate: callback }) },
    getUser: () => ({ pokeballs: 5, greatballs: 0, ultraballs: 0, masterballs: 0, premierballs: 0 }),
    incrementUser: () => {},
    getPatreonPerks: () => ({ catchBoost: 0 }),
    getBallCatchRate: () => 0,
    getCatchingCharmCritChance: () => 0,
    getCatchCoinReward: () => 1,
    recordPokemonSeen: () => {},
    resetRarityStreaks: () => {},
    EmbedBuilder,
    isEventOpen: () => false,
    halloweenEvent: {},
    isEventChecklistSpawn: () => false,
    getRarityColor: () => 0x123456,
    getRarityEmojis: () => '',
    factionLogoPrefix: () => '',
    heldItemEncounterHint: () => '',
    spawnMessage: { id: 'spawn', edit: async (payload) => edits.push(payload) },
    inline: null,
    interaction: null,
    message: { author: { username: 'Trainer' } },
    target: { id: 1, name: 'Combee', rarity: 'Uncommon', isShiny: false, isGolden: false },
    catchDisplayRarity: 'Uncommon',
    rarityData: { rateText: '30% encounter rate' },
    ninjaBoostText: '',
    guaranteedCatch: false,
    encounterCatchBonus: 0,
    channelCatchRateBoost: 0,
    isFishing: false,
    image: null,
    NON_STREAK_RARITIES: new Set(),
    Math: Object.assign(Object.create(Math), { random: () => 0.5 }),
    getRemainingBalls: () => 'Pokéballs: 5',
    userId: 'trainer',
  });
  vm.runInContext(
    'const tracksRarityStreak = true; const currentStreak = 9;',
    context
  );
  vm.runInContext(extract(indexSource, '  async function handleCatch(', '\n  textCollector.on('), context);

  const result = await context.handleCatch('pb', null, true, { id: 'trainer', username: 'Trainer' });

  assert.equal(result, false);
  assert.match(edits[0].embeds[0].toJSON().description, /Your Uncommon streak of 9 has been reset!/);
});

test('successful catches and spawn encounters show the Pokémon image in one embed', () => {
  const successContext = vm.createContext({
    EmbedBuilder,
    isEventOpen: () => false,
    halloweenEvent: {},
    isEventChecklistSpawn: () => false,
    getRarityColor: () => 0x123456,
    catcher: { username: 'Trainer' },
    ball: { name: 'Pokeball', image: 'pokeball.png', emoji: '🔴' },
    target: { name: 'Combee', rarity: 'Uncommon', isShiny: false, isGolden: false },
    factionLogoPrefix: () => '',
    getPokemonSpriteEmoji: () => '',
    criticalCatch: false,
    ballSaved: false,
    catchDisplayRarity: 'Uncommon',
    rarityData: { rateText: '30% encounter rate' },
    tracksRarityStreak: true,
    nextStreak: 2,
    streakRewardText: '',
    isNewDexEntry: false,
    huntRewardText: '',
    ancientFossilDropText: '',
    arceusPlateDropText: '',
    targetRate: 70,
    resultNinjaBoostText: '',
    playerRoll: 77,
    remainingBalls: 'Pokeballs: 79',
    isFishing: false,
    EMOJIS: { pokecoin: '💰' },
    coinsEarned: 5,
    image: 'https://example.test/combee.png',
  });
  const successEmbedCode = extract(
    indexSource,
    '    const successEmbed = new EmbedBuilder()',
    '\n    const experienceLines = []'
  );
  vm.runInContext(`function buildSuccessEmbed() { ${successEmbedCode} return successEmbed.toJSON(); }`, successContext);
  const successEmbed = successContext.buildSuccessEmbed();
  assert.equal(successEmbed.author.name, '✅ Trainer used a Pokeball!');
  assert.match(successEmbed.description, /You caught a \*\*Combee\*\*/);
  assert.equal(successEmbed.image.url, 'https://example.test/combee.png');
  assert.equal(successEmbed.thumbnail, undefined);
  assert.doesNotMatch(successEmbed.description, /Patreon catch rate/);
  successContext.resultNinjaBoostText = ' (+5% Patreon catch rate)';
  assert.match(successContext.buildSuccessEmbed().description, /Your catch rate: 70% \(\+5% Patreon catch rate\)/);
  successContext.isFishing = true;
  successContext.EMOJIS.fishingtoken = '🎣';
  successContext.fishingTokensEarned = 1;
  assert.equal(successContext.buildSuccessEmbed().image.url, 'https://example.test/combee.png');

  const spawnContext = vm.createContext({
    EmbedBuilder,
    userId: 'trainer',
    message: { author: { username: 'Trainer' } },
    ICONS: { grass: '🌿' },
    user: { pokeballs: 5, greatballs: 4, ultraballs: 3, masterballs: 1, premierballs: 2 },
    isFishing: false,
    guaranteedCatch: false,
    encounterCatchBonus: 0,
    channelCatchRateBoost: 0,
    allowAnyUserCatch: false,
    HELD_ITEM_EMOJI: '🧰',
    factionLogoPrefix: () => '',
    getPokemonSpriteEmoji: () => '',
    isEventOpen: () => false,
    halloweenEvent: {},
    isEventChecklistSpawn: () => false,
    getRarityColor: () => 0x123456,
    EVENT_EMBED_COLOR: 0xabcdef,
    getTrainerIconUrl: () => 'https://example.test/trainer.png',
    catchDisplayRarity: 'Uncommon',
    rarityData: { rateText: '30% encounter rate' },
    catchRateText: 'Ball catch rates',
    target: { id: 1, name: 'Combee', rarity: 'Uncommon', isShiny: false, isGolden: false, types: ['bug'] },
    tracksRarityStreak: true,
    currentStreak: 3,
    formatTypes: () => 'Bug',
    buildRareEncounterAlert: () => null,
    buildHeldItemEncounterAlert: () => null,
    buildFactionEncounterAlert: () => null,
    getPokemonShowdownSprite: () => 'https://example.test/combee.png',
    getGoldenSpriteUrl: () => 'https://example.test/golden-combee.png',
    FISHING_COOLDOWN_MS: 1,
    EMOJIS: { oldrod: 'old', goodRod: 'good', superRod: 'super', goldenRod: 'golden' },
    inline: null,
  });
  vm.runInContext(extract(indexSource, 'const ROD_CONFIGS =', '\nconst EMOJIS ='), spawnContext);
  const spawnEmbedCode = extract(
    indexSource,
    '  const spawnFoundText =',
    '\n  const ballOrder = getBallButtonOrder(userId);'
  );
  const encounterCode = extract(indexSource, 'async function askForBall(', '\nasync function ');
  vm.runInContext(`function buildSpawnEmbed() { ${spawnEmbedCode} return embed.toJSON(); }`, spawnContext);
  const spawnEmbed = spawnContext.buildSpawnEmbed();
  assert.equal(spawnEmbed.author.name, '🌿 Trainer found a wild Pokémon!');
  assert.match(spawnEmbed.description, /Combee\*\* appeared!/);
  assert.doesNotMatch(spawnEmbed.description, /🎟️/);
  assert.equal(spawnEmbed.image.url, 'https://example.test/combee.png');
  assert.equal(spawnEmbed.thumbnail, undefined);
  spawnContext.isFishing = true;
  for (const [rod, emoji] of [['Old Rod', 'old'], ['Good Rod', 'good'], ['Super Rod', 'super'], ['Golden Rod', 'golden']]) {
    spawnContext.user.fish_rods = rod;
    const fishingSpawnEmbed = spawnContext.buildSpawnEmbed();
    assert.equal(fishingSpawnEmbed.author.name, '🎣 Trainer found a wild Pokémon!');
    assert.ok(fishingSpawnEmbed.description.includes(`${emoji} Rod used: **${rod}**`));
    assert.equal(fishingSpawnEmbed.image.url, 'https://example.test/combee.png');
  }
  spawnContext.target.isGolden = true;
  assert.equal(spawnContext.buildSpawnEmbed().image.url, 'https://example.test/golden-combee.png');

  const spawnSend = extract(indexSource, 'const spawnMessage = inline', '\n  if (cooldownState');
  assert.match(spawnSend, /content: spawnBallDexIcons/);
  assert.match(spawnSend, /embeds: \[embed\]/);
  const catchEdit = extract(indexSource, 'await editEncounter({\n      content: [ballDexIcons', '\n    });');
  assert.match(encounterCode, /const ballDexIcons = inline \? '' : getBallDexIconsForCatch/);
  assert.match(catchEdit, /content: \[ballDexIcons, experienceMessage, levelUpMessage\]/);
  assert.match(catchEdit, /embeds: \[successEmbed\]/);
});

test('catch result displays the applicable Patreon boost, including for shared catches', () => {
  const ctx = vm.createContext({
    allowAnyUserCatch: false, ninjaBoostText: ' (+5% Patreon catch rate)',
    userId: 'catcher', getPatreonPerks: () => ({ catchBoost: 0 }),
  });
  vm.runInContext(extract(indexSource, 'function formatPatreonCatchBoost(', '\nfunction getBallCatchRate('), ctx);
  const resultBoost = extract(indexSource, '    const resultNinjaBoostText =', '\n    const used =');
  vm.runInContext(`function getResultBoost() { ${resultBoost} return resultNinjaBoostText; }`, ctx);
  assert.equal(ctx.getResultBoost(), ' (+5% Patreon catch rate)');
  ctx.allowAnyUserCatch = true;
  assert.equal(ctx.getResultBoost(), '');
  ctx.getPatreonPerks = () => ({ catchBoost: 5 });
  assert.equal(ctx.getResultBoost(), ' (+5% Patreon catch rate)');
});

test('clan leave requires confirmation and notifies its leader', async () => {
  const edits = [];
  const dms = [];
  const errors = [];
  const events = {};
  const leaveCalls = [];
  const clan = { id: 1, name: 'Team', leader_id: 'owner' };
  let result = { clan };
  let fail = false;
  const confirmation = {
    createMessageComponentCollector: () => ({
      on: (event, handler) => { events[event] = handler; },
      stop: () => {},
    }),
    edit: async (payload) => edits.push(payload),
  };
  const ctx = vm.createContext({
    subcommand: 'leave', userId: 'member', playerClan: clan, PREFIX: '.',
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType,
    leaveClan: (...args) => { leaveCalls.push(args); return result; },
    message: { author: { username: 'Trainer' }, reply: async () => confirmation },
    client: { users: { fetch: async (id) => ({ send: async (text) => {
      if (fail) throw new Error('DM closed');
      dms.push([id, text]);
    } }) } },
    console: { error: (...args) => errors.push(args) },
  });
  vm.runInContext(`async function run() { ${extract(indexSource, "      if (subcommand === 'leave') {", "\n      if (subcommand === 'kick') {")} }`, ctx);
  const interaction = (id, customId) => ({
    user: { id }, customId,
    deferUpdate: async () => {},
    reply: async (payload) => payload,
  });

  await ctx.run();
  assert.equal(leaveCalls.length, 0);
  const denied = await events.collect(interaction('other', 'clan-leave:confirm'));
  assert.equal(denied.ephemeral, true);
  assert.equal(leaveCalls.length, 0);
  await events.collect(interaction('member', 'clan-leave:cancel'));
  assert.equal(leaveCalls.length, 0);
  assert.match(edits.at(-1).content, /cancelled/);

  await ctx.run();
  await events.end([], 'time');
  await events.collect(interaction('member', 'clan-leave:confirm'));
  assert.equal(leaveCalls.length, 0);
  assert.match(edits.at(-1).content, /expired/);

  await ctx.run();
  await events.collect(interaction('member', 'clan-leave:confirm'));
  assert.deepEqual(leaveCalls[0], ['member', 1]);
  assert.equal(dms[0][0], 'owner');
  assert.match(dms[0][1], /Trainer.*member.*Team/);
  assert.match(edits.at(-1).content, /You left/);
  await events.collect(interaction('member', 'clan-leave:confirm'));
  assert.equal(leaveCalls.length, 1);

  result = { error: 'clan_changed' };
  await ctx.run();
  await events.collect(interaction('member', 'clan-leave:confirm'));
  assert.match(edits.at(-1).content, /membership changed/);
  assert.equal(dms.length, 1);
  result = { error: 'leader' };
  await ctx.run();
  await events.collect(interaction('member', 'clan-leave:confirm'));
  assert.match(edits.at(-1).content, /leaders cannot leave/);
  assert.equal(dms.length, 1);
  result = { clan };
  fail = true;
  await ctx.run();
  await events.collect(interaction('member', 'clan-leave:confirm'));
  assert.equal(errors.length, 1);
  assert.match(edits.at(-1).content, /could not DM/);
});

test('clan leave rejects a confirmation for a previous clan', () => {
  const db = new Database(':memory:');
  try {
    let clan = { id: 2, leader_id: 'owner' };
    const ctx = vm.createContext({ db, getPlayerClan: () => clan });
    vm.runInContext(extract(dbSource, 'function leaveClan(', '\nfunction kickClanMember('), ctx);
    assert.equal(ctx.leaveClan('member', 1).error, 'clan_changed');
    clan = { id: 1, leader_id: 'member' };
    assert.equal(ctx.leaveClan('member', 1).error, 'leader');
  } finally {
    db.close();
  }
});

test('Balldex resolves form names and regular, shiny and Golden Dex numbers to shared species progress', async () => {
  const { getPokemonDexNumbers, getGoldenDexNumber } = require('../pokemon-dex-numbers');
  const forms = require('../data/pokemon-catalog.json');
  const replies = [];
  const user = { id: 'user', username: 'Trainer', displayAvatarURL: () => 'https://example.com/avatar.png' };
  const ctx = vm.createContext({
    command: 'bd', args: [], PREFIX: '.', EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType,
    db: { prepare: (sql) => ({ all: () => sql.includes('is_default = 1') ? forms.filter((form) => form.is_default) : forms }) },
    getPokemonDexNumbers, getGoldenDexNumber,
    findPokemonForms: (query) => forms.filter((form) => form.name.toLowerCase().includes(query.toLowerCase())),
    BALLDEX_BALLS: [
      { key: 'pb', locked: 'locked', unlocked: 'unlocked' },
      { key: 'gb', locked: 'locked', unlocked: 'unlocked' },
    ],
    getBallDexCaughtMap: () => new Map([[658, new Set(['pb'])], [37, new Set(['gb'])]]),
    getPokemonSpriteEmoji: () => '',
    message: { author: user, mentions: { users: { first: () => null } },
      reply: async (payload) => {
        replies.push(payload);
        return { createMessageComponentCollector: () => ({ on: () => {} }) };
      } },
  });
  vm.runInContext(
    extract(indexSource, 'function resolvePokemonForm(', '\nfunction getHuntTargetSprite(')
      + '\n' + extract(indexSource, 'function getPokemonFormDexNumber(', '\nfunction findBossCoinTemplate(')
      + '\n' + extract(indexSource, 'function formatBallDexRow(', '\nfunction getBallDexIconsForCatch('),
    ctx
  );
  vm.runInContext(`async function run() { ${extract(indexSource, "    if (command === 'balldex' ||", "\n    if (command === '")} }`, ctx);
  const run = async (...args) => { ctx.args = args; await ctx.run(); return replies.at(-1); };
  for (const query of [['7540'], ['7541'], ['Greninja', 'Ash']]) {
    const response = await run(...query);
    assert.equal(response.embeds, undefined);
    assert.match(response.content, /\*\*Greninja Ash #7540\*\* unlockedlocked `\[1\/2\]`/);
    assert.match(response.content, /All forms and variants share species progress/);
  }
  const base = await run('658');
  assert.match(base.content, /\*\*Greninja #658\*\* unlockedlocked `\[1\/2\]`/);
  const regional = await run('7719');
  assert.match(regional.content, /\*\*Alolan Vulpix #/);
  assert.match(regional.content, /lockedunlocked `\[1\/2\]`/);
  assert.match(await run('999999999'), /No Pokémon found/);
  assert.match(await run('status'), /Completed balldexes/);
  const allPokemon = await run();
  assert.equal(allPokemon.embeds, undefined);
  assert.equal((allPokemon.content.match(/\*\*[^*]+ #\d+\*\*/g) || []).length, 6);
});

test('collection commands resolve normal, shiny and Golden Dex numbers to the correct variants', async () => {
  const { getPokemonDexNumbers, getGoldenDexNumber } = require('../pokemon-dex-numbers');
  const { parseAmount } = require('../amounts');
  const forms = require('../data/pokemon-catalog.json')
    .filter((pokemon) => ['bulbasaur', 'vulpix-alola'].includes(pokemon.slug));
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE pokemon_forms (
      id INTEGER PRIMARY KEY, species_id INTEGER, species_name TEXT, name TEXT, slug TEXT,
      is_default INTEGER, rarity TEXT
    );
    CREATE TABLE catches (user_id TEXT, pokemon_id INTEGER, name TEXT, is_shiny INTEGER, is_golden INTEGER);
    CREATE TABLE global_collections (
      id INTEGER PRIMARY KEY, user_id TEXT, pokemon_id INTEGER, is_shiny INTEGER, is_golden INTEGER,
      pokemon_name TEXT, buy_price INTEGER, is_private INTEGER, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, pokemon_id, is_shiny, is_golden)
    );
  `);
  const insertForm = db.prepare('INSERT INTO pokemon_forms VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const form of forms) {
    insertForm.run(form.id, form.species_id, form.species_name, form.name, form.slug, form.is_default, form.rarity);
  }
  db.prepare('INSERT INTO catches VALUES (?, ?, ?, ?, ?)').run('user', 1, 'Bulbasaur', 0, 1);
  const replies = [];
  const ctx = vm.createContext({
    db, command: 'coll', args: [], userId: 'user', PREFIX: '.', EmbedBuilder, parseAmount,
    EMOJIS: { pokecoin: 'coin' }, getPokemonDexNumbers, getGoldenDexNumber,
    marketDexNumbersByFormId: null, assertUserId: () => {},
    findPokemonForms: (query) => forms.filter((form) => form.name.toLowerCase().includes(query.toLowerCase())),
    getRarityEmojis: () => '',
    message: { author: { id: 'user', username: 'Trainer' }, mentions: { users: { first: () => null } },
      reply: async (payload) => { replies.push(payload); return payload; } },
  });
  vm.runInContext(extract(indexSource, 'function resolvePokemonForm(', '\nfunction getHuntTargetSprite(')
    + '\n' + extract(indexSource, 'function getDexQueryMarketVariant(', '\nfunction getPokemonFormDexNumber(')
    + '\n' + extract(indexSource, 'function getCollectionDexNumber(', '\nfunction '), ctx);
  vm.runInContext(extract(dbSource, 'function getUserRegisteredCollections(', '\nfunction setGiveawayChannel('), ctx);
  vm.runInContext(`async function collection() { ${extract(indexSource, "    if (command === 'collection' ||", "\n    if (command === 'token'")} }`, ctx);
  const run = async (...args) => { ctx.args = args; await ctx.collection(); return replies.at(-1); };
  await run('register', '9001');
  assert.match(replies.at(-1), /Golden Bulbasaur/);
  await run('register', 'golden', 'bulbasaur');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM global_collections').get().n, 1);
  await run('register', '001');
  await run('register', '1001');
  await run('register', '7719');
  const rows = db.prepare('SELECT pokemon_id, is_shiny, is_golden FROM global_collections ORDER BY id').all();
  assert.deepEqual(rows, [
    { pokemon_id: 1, is_shiny: 0, is_golden: 1 },
    { pokemon_id: 1, is_shiny: 0, is_golden: 0 },
    { pokemon_id: 1, is_shiny: 1, is_golden: 0 },
    { pokemon_id: 10103, is_shiny: 0, is_golden: 1 },
  ]);
  await run('register', 'golden', '9001');
  await run('register', 'golden', '9001', '20k');
  assert.equal(db.prepare('SELECT buy_price FROM global_collections WHERE pokemon_id = 1 AND is_golden = 1').get().buy_price, 20000);
  await run('register', 'shiny', '1001');
  assert.match(replies.at(-1), /Shiny Bulbasaur/);
  await run('update', '9001', '25k');
  assert.equal(db.prepare('SELECT buy_price FROM global_collections WHERE pokemon_id = 1 AND is_golden = 1').get().buy_price, 25000);
  const viewed = await run('view', '9001');
  const description = viewed.embeds[0].toJSON().description;
  assert.match(description, /#9001 Golden Bulbasaur/);
  assert.match(description, /Count: `1`/);
  await run('private', '9001');
  assert.equal(db.prepare('SELECT is_private FROM global_collections WHERE pokemon_id = 1 AND is_golden = 1').get().is_private, 1);
  await run('delete', '9001');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM global_collections WHERE pokemon_id = 1').get().n, 2);
  db.close();
});

test('swap names and variant dex numbers select the same owned variant', () => {
  const { getPokemonDexNumbers, getGoldenDexNumber, isGoldenDexNumber, isGoldenFormSupported } = require('../pokemon-dex-numbers');
  const forms = require('../data/pokemon-catalog.json').filter((pokemon) => pokemon.slug === 'umbreon');
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, buddy_catch_id INTEGER);
      INSERT INTO users VALUES ('user', NULL);
      CREATE TABLE pokemon_forms (id INTEGER, species_id INTEGER, species_name TEXT, name TEXT, slug TEXT, is_default INTEGER, rarity TEXT);
      CREATE TABLE catches (id INTEGER, user_id TEXT, pokemon_id INTEGER, name TEXT, is_shiny INTEGER, is_golden INTEGER, in_team INTEGER);
      INSERT INTO catches VALUES (1, 'user', 197, 'Umbreon', 0, 0, 0),
        (2, 'user', 197, 'Umbreon', 1, 0, 0), (3, 'user', 197, 'Umbreon', 0, 1, 0);
    `);
    const form = forms[0];
    db.prepare('INSERT INTO pokemon_forms VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(form.id, form.species_id, form.species_name, form.name, form.slug, form.is_default, form.rarity);
    const ctx = vm.createContext({
      db, assertUserId: () => {}, getGoldenDexNumber, isGoldenDexNumber, isGoldenFormSupported,
      getPokemonDexNumbersForForms: () => getPokemonDexNumbers(forms),
      sortedNameWords: (name) => name.toLowerCase().split(/\s+/).sort().join(' '),
    });
    vm.runInContext(extract(dbSource, 'function findOwnedPokemonRows(', '\nfunction findUserPokemonMatches('), ctx);
    for (const [query, id] of [['umbreon', 1], ['197', 1], ['shiny umbreon', 2],
      ['1197', 2], ['golden umbreon', 3], ['9197', 3]]) {
      assert.equal(ctx.findOwnedPokemonRows('user', query)[0]?.id, id, query);
    }
    assert.equal(ctx.findOwnedPokemonRows('user', 'golden 197').length, 0);
  } finally { db.close(); }
});

test('swap rejects a variant prefix with any numeric dex input', async () => {
  const swapBranch = extract(indexSource, "    if (command === 'swap' || command === 'sw'", "\n    if (command === 'collection'");
  const guard = extract(swapBranch, '        const pokemonName = args.join', '\n        if (!pokemonName');
  const ctx = vm.createContext({ args: [], PREFIX: '.', message: { reply: async (text) => text } });
  vm.runInContext(`async function checkSwapInput() { ${guard}\n return 'accepted'; }`, ctx);
  for (const input of ['golden 197', 'golden 9197', 'shiny 1197']) {
    ctx.args = input.split(' ');
    assert.match(await ctx.checkSwapInput(), /variant Pokédex number/);
  }
  for (const input of ['golden umbreon', '9197', '197']) {
    ctx.args = input.split(' ');
    assert.equal(await ctx.checkSwapInput(), 'accepted');
  }
});

test('released and swapped Pokémon credit each open chamber atomically', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, buddy_catch_id INTEGER);
      INSERT INTO users VALUES ('user', NULL);
      CREATE TABLE pokemon_forms (id INTEGER PRIMARY KEY, species_id INTEGER);
      INSERT INTO pokemon_forms VALUES (1, 150), (2, 42);
      CREATE TABLE catches (id INTEGER PRIMARY KEY, user_id TEXT, pokemon_id INTEGER, name TEXT,
        rarity TEXT, is_shiny INTEGER, is_golden INTEGER, in_team INTEGER, is_locked INTEGER, is_fav INTEGER);
      INSERT INTO catches VALUES (1, 'user', 1, 'Mewtwo', 'Common', 0, 0, 0, 0, 0),
        (2, 'user', 1, 'Mewtwo', 'Common', 0, 0, 0, 0, 0),
        (3, 'user', 1, 'Mewtwo', 'Common', 1, 0, 0, 0, 0),
        (4, 'user', 1, 'Mewtwo', 'Common', 0, 1, 0, 0, 0),
        (5, 'user', 1, 'Mewtwo', 'Common', 0, 0, 0, 1, 0),
        (6, 'user', 2, 'Other', 'Common', 0, 0, 0, 0, 0);
      CREATE TABLE mega_chambers (user_id TEXT, chamber_key TEXT, sacrifices INTEGER, clears INTEGER,
        PRIMARY KEY (user_id, chamber_key));
      INSERT INTO mega_chambers VALUES ('user', 'x', 7, 2);
    `);
    let paymentWorks = true;
    const ctx = vm.createContext({
      db, userId: 'user', now: 1,
      CHAMBER_CONFIG: { x: { key: 'x', pokemonId: 150 }, y: { key: 'y', pokemonId: 150 }, closed: { key: 'closed', pokemonId: 150 } },
      isChamberOpen: (chamber) => chamber.key !== 'closed',
      getReleaseProtectionReason: (pokemon) => pokemon.is_golden ? 'protected' : null,
      getDisplayRarity: () => 'Common', RELEASE_PAYOUTS: { common: 10 },
      grantRotomItemDrops: () => [], awardCoinsWithBoost: (_id, value) => ({ finalAmount: value }),
      findOwnedPokemonRows: (_userId, query) => db.prepare('SELECT * FROM catches WHERE id = ?').all(Number(query)),
      getUser: () => ({ coins: 0, swaps_today: 0, last_swap_reset: 0 }),
      getDailyResetDay: () => 0, getUserItems: () => [{ item_name: 'Swap Ticket', amount: 1 }],
      getPatreonPerks: () => ({ swapDiscount: 0, goldenBoost: 0 }),
      getSwapMultiplier: () => 1, isPlayerBonusActive: () => false,
      SWAP_EXCLUSIVE_SHINIES: [], takeUserItem: () => paymentWorks,
      incrementUser: () => {}, trackClanActivity: () => {}, rollSwapRarity: () => 'Common',
      getSwapRewardExcludedSpecies: () => [], getRandomPokemon: () => ({ id: 2 }),
      saveCatch: () => {}, recordPokemonSeen: () => {},
      Math: Object.assign(Object.create(Math), { random: () => 0.9 }),
    });
    vm.runInContext(extract(indexSource, 'function releaseCatchIds(', '\nfunction createReleaseAnnouncement('), ctx);
    const swapBranch = extract(indexSource, "    if (command === 'swap' || command === 'sw'", "\n    if (command === 'collection'");
    vm.runInContext(`function swapForTest(pokemonName) {
      ${extract(swapBranch, '        const result = db.transaction(() => {', '\n        if (result.error === \'pokemon_not_found\')')}
      return result;
    }`, ctx);
    assert.equal(ctx.releaseCatchIds('user', [1, 2, 5, 6]).released.length, 3);
    assert.deepEqual(db.prepare('SELECT chamber_key, sacrifices, clears FROM mega_chambers ORDER BY chamber_key').all(),
      [{ chamber_key: 'x', sacrifices: 9, clears: 2 }, { chamber_key: 'y', sacrifices: 2, clears: 0 }]);
    ctx.swapForTest('3');
    assert.equal(db.prepare("SELECT sacrifices FROM mega_chambers WHERE chamber_key = 'x'").get().sacrifices, 10);
    paymentWorks = false;
    assert.throws(() => ctx.swapForTest('4'), /inventory changed/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM catches WHERE id = 4').get().n, 1);
    assert.equal(db.prepare("SELECT sacrifices FROM mega_chambers WHERE chamber_key = 'x'").get().sacrifices, 10);
    paymentWorks = true;
    ctx.swapForTest('4');
    assert.equal(db.prepare("SELECT sacrifices FROM mega_chambers WHERE chamber_key = 'x'").get().sacrifices, 11);
  } finally { db.close(); }
});

test('daily swap tickets are announced at the start of the swap response', async () => {
  const replies = [];
  const ctx = vm.createContext({
    claimDailySwapTickets: () => 2,
    getUser: () => ({ last_swap_reset: 0, swaps_today: 0 }),
    getDailyResetDay: () => 0,
    getSwapMultiplier: () => 1,
    getNextDailyReset: () => 0,
    getUserItems: () => [],
    getPatreonPerks: () => ({ swapDiscount: 0 }),
    PREFIX: '.',
    EMOJIS: { golden: '✨', pokecoin: '🪙' },
    EmbedBuilder,
  });
  const swapBranch = extract(indexSource, "    if (command === 'swap' || command === 'sw'", "\n    if (command === 'collection'");
  vm.runInContext(`async function run(message) {
    const command = 'swap'; const args = []; const userId = 'trainer'; ${swapBranch}
  }`, ctx);
  const message = {
    reply: async (payload) => {
      replies.push(payload);
      return payload;
    },
  };

  await ctx.run(message);

  assert.equal(replies.length, 1);
  assert.match(replies[0].content, /^You received your daily \[🎟️\]\(https:\/\/discord\.com\/assets\/dde8a9804160342c\.svg\) \*\*2x\*\* swap tokens!/);
  assert.equal(replies[0].embeds.length, 1);
});

test('CatchBot claims award catches without advancing quests for legacy or current runs', async () => {
  const cbBranch = extract(indexSource, "    if (command === 'cb' || command === 'catchbot') {",
    "\n    if (command === '");
  const claimBranch = extract(cbBranch, "      if (subcommand === 'claim') {",
    "\n      if (subcommand && subcommand !== 'status')");
  for (const legacy of [true, false]) {
    let saved = 0;
    let summary;
    const user = { catchbot_end: legacy ? 1 : 0 };
    const ctx = vm.createContext({
      subcommand: 'claim', cb: { running_until: legacy ? 0 : 1, luck_lvl: 0 },
      user, userId: 'user', now: 1000, message: { author: {}, reply: async () => {} }, PREFIX: '.',
      db: { transaction: (fn) => ({ immediate: fn }) },
      getUser: () => user, updateUser: (_id, fields) => Object.assign(user, fields),
      getRoleEncounterBoost: async () => 0, CB_CONFIG: { luck: { getStat: () => 0 } },
      rollCatchbotGoldenExclusive: () => null,
      rollCatchbotSpawn: () => ({ id: 1, name: 'Test', rarity: 'Common', isShiny: false }),
      saveCatch: () => { saved++; }, trackClanActivity: () => {}, incrementUser: () => {},
      isEventOpen: () => false, halloweenEvent: {}, awardCoinsWithBoost: () => ({ finalAmount: 300 }),
      claimCatchbotRun: () => ({ pokemonPerHour: 2, hours: 1, luckLevel: 0 }),
      recordCatchbotResults: () => {},
      sendCatchbotClaimPages: async (_message, _title, _pokemon, text) => { summary = text; },
      announceRareSpawn: async () => {}, announceEventCatch: async () => {},
      advanceQuestProgress: () => { throw new Error('CatchBot must not advance quests'); },
      EMOJIS: { pokecoin: 'coin' }, console,
    });
    vm.runInContext(`async function claim() { ${claimBranch} }`, ctx);
    await ctx.claim();
    assert.equal(saved, legacy ? 4 : 2);
    assert.match(summary, legacy ? /300 PokéCoins/ : /2 Pokémon/);
  }
});

test('Bisharp evolves into Kingambit at level 50', () => {
  const rules = require('../data/pokemon-evolution-rules.json').filter((rule) => rule.fromSpeciesId === 625);
  const row = { form_species: 625, name: 'Bisharp', level: 49, is_shiny: 1 };
  const ctx = vm.createContext({
    db: { transaction: (fn) => ({ immediate: fn }) }, assertUserId: () => {},
    findOwnedPokemonRows: () => [row], friendshipEvolutionRules: new Map(),
    levelEvolutionRules: new Map([[625, rules]]), TIME_LEVEL_EVOLUTIONS: {},
    resolveSpeciesEvolution: (_from, to) => to === 983 ? { name: 'Kingambit' } : null,
    applyPokemonEvolution: (_userId, pokemon, target) => ({ to: target.name, isShiny: Boolean(pokemon.is_shiny) }),
  });
  vm.runInContext(extract(dbSource, 'function evolvePokemonByLevel(', '\nconst moveInfoData'), ctx);
  assert.equal(ctx.evolvePokemonByLevel('user', 'bisharp').requiredLevel, 50);
  row.level = 50;
  assert.equal(ctx.evolvePokemonByLevel('user', 'bisharp').to, 'Kingambit');
  assert.equal(ctx.evolvePokemonByLevel('user', 'bisharp').isShiny, true);
});

test('Pokédex card displays the selected variant Dex number', () => {
  const dexCard = extract(indexSource, 'const dexCard = (pokemon) => {', '\n      const formRows =');
  assert.match(dexCard, /const dexNumber = goldenEntry[\s\S]*?shinyEntry \? shinyDexNumber : regularDexNumber;/);
  assert.match(dexCard, /\{ name: 'Dex Number', value: `#\$\{dexNumber\}`/);
});

test('sent and claimed gifts display each Pokémon rarity and variant emblem', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, buddy_catch_id INTEGER);
    INSERT INTO users VALUES ('sender', NULL);
    CREATE TABLE saved_teams (user_id TEXT, pokemon_ids TEXT, is_defending INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE catches (id INTEGER PRIMARY KEY, user_id TEXT, pokemon_id INTEGER, name TEXT,
      rarity TEXT, is_shiny INTEGER, is_golden INTEGER, caught_ball TEXT, in_team INTEGER);
    INSERT INTO catches VALUES
      (1, 'sender', 1, 'Bulbasaur', 'Common', 0, 0, 'pb', 0),
      (2, 'sender', 2, 'Mewtwo', 'Legendary', 0, 0, 'pb', 0),
      (3, 'sender', 1, 'Bulbasaur', 'Common', 1, 0, 'pb', 0),
      (4, 'sender', 1, 'Bulbasaur', 'Common', 0, 1, 'pb', 0);
  `);
  const gifts = [
    { id: 1, name: 'Bulbasaur', rarity: 'Common', is_shiny: 0, is_golden: 0 },
    { id: 2, name: 'Mewtwo', rarity: 'Legendary', is_shiny: 0, is_golden: 0 },
    { id: 3, name: 'Bulbasaur', rarity: 'Common', is_shiny: 1, is_golden: 0 },
    { id: 4, name: 'Bulbasaur', rarity: 'Common', is_shiny: 0, is_golden: 1 },
  ];
  const replies = [];
  const adminAlerts = [];
  const recipient = { id: 'recipient', username: 'Recipient', bot: false };
  const ctx = vm.createContext({
    db, PREFIX: '.', console, parseAmount: Number,
    client: { users: { fetch: async () => recipient } },
    getTransferEligibilityError: () => null,
    parseTradeMonInput: (query) => ({ index: Number(query) - 1 }),
    resolveTradeSpec: (spec) => {
      const gift = gifts[spec.index];
      return { form: { id: gift.id === 2 ? 2 : 1, name: gift.name },
        isShiny: Boolean(gift.is_shiny), isGolden: Boolean(gift.is_golden) };
    },
    sendPokemonGift: () => ({}), notifyAdminIfRareGrant: async (...args) => adminAlerts.push(args),
    getRarityEmojis: (rarity, _name, shiny, golden) => golden ? '[golden]' : shiny ? '[shiny]' : `[${rarity}]`,
    claimPokemonGifts: () => gifts.map((gift) => ({ ...gift, sender_id: 'sender' })),
    makeEmbed: (title, description) => ({ title, description }),
    message: { author: { username: 'Sender' }, guild: {},
      mentions: { users: { first: () => recipient } }, reply: async (value) => { replies.push(value); return value; } },
  });
  vm.runInContext(extract(indexSource, 'function getTradeableCatchRows(', '\n// Splits')
    + '\n' + extract(indexSource, 'function getGiftTarget(', '\nasync function handleTrade('), ctx);
  await ctx.handleGift(ctx.message, 'sender',
    ['recipient', '1', 'x', '1', '2', 'x', '1', '3', 'x', '1', '4', 'x', '1']);
  assert.match(replies.at(-1).content, /\[Common\] Bulbasaur/);
  assert.match(replies.at(-1).content, /\[Legendary\] Mewtwo/);
  assert.match(replies.at(-1).content, /\[shiny\] Bulbasaur/);
  assert.match(replies.at(-1).content, /\[golden\] Bulbasaur/);
  await ctx.handleGift(ctx.message, 'recipient', ['claim']);
  const claimed = replies.at(-1).embeds[0].description;
  assert.match(claimed, /\[Common\] Bulbasaur/);
  assert.match(claimed, /\[Legendary\] Mewtwo/);
  assert.match(claimed, /\[shiny\] Bulbasaur/);
  assert.match(claimed, /\[golden\] Bulbasaur/);
  assert.equal(adminAlerts.length, 0);
  db.close();
});

test('gift selection ignores remembered World Boss teams but protects active and saved teams', async () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, buddy_catch_id INTEGER);
      INSERT INTO users VALUES ('sender', NULL);
      CREATE TABLE saved_teams (user_id TEXT, pokemon_ids TEXT, is_defending INTEGER);
      INSERT INTO saved_teams VALUES
        ('sender', '[1]', 2), ('sender', '[2]', 0), ('sender', '[3]', 1);
      CREATE TABLE catches (id INTEGER PRIMARY KEY, user_id TEXT, pokemon_id INTEGER, name TEXT,
        rarity TEXT, is_shiny INTEGER, is_golden INTEGER, caught_ball TEXT, in_team INTEGER);
      INSERT INTO catches VALUES
        (1, 'sender', 20015, 'Arceus Ghost', 'Legendary', 0, 0, 'pb', 0),
        (2, 'sender', 20015, 'Arceus Ghost', 'Legendary', 0, 0, 'pb', 0),
        (3, 'sender', 20015, 'Arceus Ghost', 'Legendary', 0, 0, 'pb', 0),
        (4, 'sender', 20015, 'Arceus Ghost', 'Legendary', 0, 0, 'pb', 1);
    `);
    const sent = [];
    const replies = [];
    const recipient = { id: 'recipient', username: 'Recipient', bot: false };
    const ctx = vm.createContext({
      db, PREFIX: '.', console, parseAmount: Number,
      client: { users: { fetch: async () => recipient } },
      getTransferEligibilityError: () => null,
      parseTradeMonInput: () => ({}),
      resolveTradeSpec: () => ({ form: { id: 20015, name: 'Arceus Ghost' }, isShiny: false, isGolden: false }),
      sendPokemonGift: (_sender, _recipient, id) => { sent.push(id); return {}; },
      notifyAdminIfRareGrant: async () => {}, getRarityEmojis: () => '',
      message: { author: { username: 'Sender' }, guild: {},
        mentions: { users: { first: () => recipient } }, reply: async (value) => replies.push(value) },
    });
    vm.runInContext(extract(indexSource, 'function getTradeableCatchRows(', '\n// Splits')
      + '\n' + extract(indexSource, 'function getGiftTarget(', '\nasync function handleTrade('), ctx);
    await ctx.handleGift(ctx.message, 'sender', ['recipient', 'Arceus', 'Ghost', 'x', '2']);
    assert.match(replies.at(-1), /only have \*\*1\*\* giftable.*active team or saved teams/);
    assert.deepEqual(sent, []);
    await ctx.handleGift(ctx.message, 'sender', ['recipient', 'Arceus', 'Ghost', 'x', 'all']);
    assert.deepEqual(sent, [1]);
  } finally { db.close(); }
});

test('gift transfer allows remembered World Boss team members but protects saved teams', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, buddy_catch_id INTEGER);
      INSERT INTO users VALUES ('sender', NULL);
      CREATE TABLE catches (id INTEGER PRIMARY KEY, user_id TEXT, pokemon_id INTEGER, name TEXT,
        rarity TEXT, is_shiny INTEGER, is_golden INTEGER, caught_ball TEXT, in_team INTEGER,
        hp_iv INTEGER, atk_iv INTEGER, def_iv INTEGER, spa_iv INTEGER, spdef_iv INTEGER, spd_iv INTEGER);
      INSERT INTO catches VALUES
        (1, 'sender', 20015, 'Arceus Ghost', 'Legendary', 0, 0, 'pb', 0, 1, 1, 1, 1, 1, 1),
        (2, 'sender', 20015, 'Arceus Ghost', 'Legendary', 0, 0, 'pb', 0, 1, 1, 1, 1, 1, 1),
        (3, 'sender', 20015, 'Arceus Ghost', 'Legendary', 0, 0, 'pb', 1, 1, 1, 1, 1, 1, 1);
      CREATE TABLE saved_teams (user_id TEXT, pokemon_ids TEXT, is_defending INTEGER);
      INSERT INTO saved_teams VALUES ('sender', '[1]', 2), ('sender', '[2]', 0);
      CREATE TABLE pokemon_gifts (id INTEGER PRIMARY KEY, sender_id TEXT, recipient_id TEXT, pokemon_id INTEGER,
        name TEXT, rarity TEXT, is_shiny INTEGER, is_golden INTEGER, caught_ball TEXT,
        hp_iv INTEGER, atk_iv INTEGER, def_iv INTEGER, spa_iv INTEGER, spdef_iv INTEGER, spd_iv INTEGER);
      CREATE TABLE pokemon_gift_history (gift_id INTEGER, sender_id TEXT, recipient_id TEXT, name TEXT,
        is_shiny INTEGER, is_golden INTEGER);
    `);
    const ctx = vm.createContext({ db, assertUserId: () => {}, saveCatchStateSnapshot: () => {} });
    vm.runInContext(extract(dbSource, 'function sendPokemonGift(', '\n// kind:'), ctx);
    assert.equal(ctx.sendPokemonGift('sender', 'recipient', 2).error, 'in_saved_team');
    assert.equal(ctx.sendPokemonGift('sender', 'recipient', 3).error, 'in_team');
    assert.equal(ctx.sendPokemonGift('sender', 'recipient', 1).giftId, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pokemon_gifts').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM catches WHERE id = 1').get().n, 0);
  } finally { db.close(); }
});

function challengerContext(extra = {}) {
  const ctx = vm.createContext({
    NPC_CAMPAIGN: Array.from({ length: 120 }, (_, index) => ({ name: `Campaign ${index + 1}` })),
    NPC_SPECIAL_BATTLES: Array.from({ length: 100 }, (_, index) => ({ name: `Special ${index + 1}` })),
    CHAMBER_ICON_ENTRIES: [], CHAMBER_NPC_ID_START: 600,
    resolvePokemonForm: () => ({ id: 1 }), ...extra,
  });
  vm.runInContext(extract(indexSource, 'const CHALLENGER_STAT_MULTIPLIERS', '\nconst GOLDEN_TIMBURR_EMOJI'), ctx);
  vm.runInContext(extract(indexSource, 'function getNpcChallenge(', '\nfunction formatBattleStatsDate('), ctx);
  return ctx;
}

test('admin grants and trainers equip challenger icons by displayed NPC number', async () => {
  const unlocked = new Set();
  const replies = [];
  let selected = null;
  const user = { id: 'target' };
  const ctx = challengerContext({
    command: 'admin', subtype: 'icon', args: [], userId: 'target', battleSub: 'set-icon', PREFIX: '.',
    message: { mentions: { users: { first: () => user } }, reply: async (payload) => replies.push(payload) },
    client: { users: { fetch: async () => user } }, EmbedBuilder, DEFAULT_TRAINER_ICONS: {},
    unlockBattleIcon: (_id, index) => { const added = !unlocked.has(index); unlocked.add(index); return added; },
    getUnlockedBattleIcons: () => [...unlocked],
    setSelectedBattleIcon: (_id, index) => { selected = index; },
    getNpcIconUrl: () => 'https://example.com/icon.png',
  });
  vm.runInContext(`async function grant() { ${extract(indexSource, "      if (command === 'admin' && (subtype === 'icon'", "\n      if (command === 'admin' && subtype === 'giveaway'")} }`, ctx);
  vm.runInContext(`async function equip() { ${extract(indexSource, "      if (battleSub === 'set-icon'", "\n      if (battleSub === 'exp'")} }`, ctx);
  const definitions = vm.runInContext('CHALLENGER_DEFINITION_LIST', ctx);
  for (const challenge of definitions) {
    ctx.args = ['icon', 'target', String(challenge.challengerId)];
    await ctx.grant();
    const expected = ctx.getBattleStatsChallenge(String(challenge.challengerId)).index;
    assert.ok(unlocked.has(expected), `grant ${challenge.challengerId}`);
    assert.match(replies.at(-1).embeds[0].toJSON().description, new RegExp(challenge.name));
    ctx.args = ['set-icon', String(challenge.challengerId)];
    await ctx.equip();
    assert.equal(selected, expected, `equip ${challenge.challengerId}`);
  }
  const challenger = definitions.find((entry) => entry.challengerId === 200);
  ctx.args = ['icon', 'target', challenger.name];
  await ctx.grant();
  assert.match(replies.at(-1).embeds[0].toJSON().description, /already has/);
  ctx.args = ['icon', 'target', '9999'];
  await ctx.grant();
  assert.match(replies.at(-1), /No battle icon matches/);
});

test('challenger quest wins count only their specified invited NPC tiers', () => {
  const recorded = [];
  const ctx = challengerContext({
    challenge: null, userId: 'user', message: { channel: {} },
    advanceQuestProgress: (_id, event) => { recorded.push(event); return []; },
    announceQuestCompletions: () => {},
  });
  vm.runInContext(`function recordVictory() { ${extract(indexSource, '          const normalizedChallengeName =', '\n          log.push(challenge.expBattle')} }`, ctx);
  const definitions = vm.runInContext('CHALLENGER_DEFINITION_LIST', ctx);
  const groups = {
    basic_challenger: [208, 207, 206, 210, 209],
    boss_challenger: [202, 203, 204, 205, 200, 201],
    master_challenger: [211, 212, 213],
  };
  for (const [category, ids] of Object.entries(groups)) {
    for (const id of ids) {
      ctx.challenge = definitions.find((entry) => entry.challengerId === id);
      assert.ok(ctx.challenge, `missing challenger ${id}`);
      ctx.recordVictory();
      assert.deepEqual(Array.from(recorded.at(-1).battleCategories), [category], `challenger ${id}`);
    }
  }
  for (const [name, category] of [['Gym Leader Brock', 'gym_leader'], ['Elite Four Lorelei', 'elite_four'], ['Champion Lance', 'champion']]) {
    ctx.challenge = { name };
    ctx.recordVictory();
    assert.deepEqual(Array.from(recorded.at(-1).battleCategories), [category]);
  }
});

test('cooldown notification modes persist and react to the encounter instead of sending a message', async () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE bot_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const timers = [];
  const reactions = [];
  const sent = [];
  const ctx = vm.createContext({
    db, assertUserId: () => {}, console, PREFIX: '.', EMOJIS: { cooldownMachine: 'machine' },
    cooldownEndsAt: { p: new Map(), f: new Map(), battle: new Map() },
    pokemonCooldownStates: { p: new Map(), f: new Map() },
    getUser: () => ({ cooldown_machine_catch_charges: 0 }),
    setTimeout: (callback, delay) => { const timer = { callback, delay }; timers.push(timer); return timer; },
    clearTimeout: () => {},
  });
  vm.runInContext(extract(dbSource, 'function getCooldownNotificationMode(', '\nfunction getRareSpawnNameHidden('), ctx);
  vm.runInContext(extract(indexSource, 'function scheduleCooldownNotification(', '\nfunction getCooldownReadyTimestamp('), ctx);
  assert.equal(ctx.getCooldownNotificationMode('u'), 'ping');
  ctx.setCooldownNotificationMode('u', 'react');
  assert.equal(ctx.getCooldownNotificationMode('u'), 'react');
  assert.throws(() => ctx.setCooldownNotificationMode('u', 'invalid'), /notification mode/);
  const cooldowns = new Set(['u']);
  const source = { react: async () => reactions.push('command') };
  const spawn = { react: async (emoji) => reactions.push(emoji) };
  const state = ctx.scheduleCooldownNotification(cooldowns, 'u', 'Trainer',
    { send: async (payload) => sent.push(payload) }, 1000, 'p', source);
  const encounter = vm.createContext({
    cooldownState: state, inline: null, message: { channel: { send: async () => spawn } },
    spawnFoundText: 'spawn', spawnBallDexIcons: '', embed: {}, ballRows: [],
  });
  vm.runInContext(`async function postSpawn() { ${extract(indexSource, '  const spawnMessage = inline', '\n  const buttonCollector = inline')} }`, encounter);
  await encounter.postSpawn();
  assert.equal(timers[0].delay, 1000);
  timers[0].callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(reactions, ['✅']);
  assert.equal(cooldowns.has('u'), false);
  assert.equal(sent.length, 0);
  ctx.getUser = () => ({ cooldown_machine_catch_charges: 1 });
  const machine = ctx.scheduleCooldownNotification(new Set(['u']), 'u', 'Trainer',
    { send: async (payload) => sent.push(payload) }, 1000, 'p', source);
  machine.notificationMessage = spawn;
  assert.equal(timers.at(-1).delay, 500);
  timers.at(-1).callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(reactions, ['✅', '✅']);
  assert.equal(timers.at(-1).delay, 500);
  ctx.setCooldownNotificationMode('u', 'username');
  ctx.scheduleCooldownNotification(new Set(['u']), 'u', 'Trainer',
    { send: async (payload) => sent.push(payload) }, 1000, 'battle', source);
  timers.at(-1).callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(sent[0].content, /\*\*Trainer\*\*/);
  assert.deepEqual(Array.from(sent[0].allowedMentions.parse), []);
  db.close();
});

test('cooldown exemptions skip encounter timers while other users can use Cooldown Machines', () => {
  let now = 10000;
  const user = { cooldown_machine_catch_charges: 1, cooldown_machine_fish_charges: 1 };
  const exemptIds = new Set(['1514082847609061541', '537500331953881088', '1573782664773767301']);
  const encounterExemptIds = new Set(['537500331953881088', '1573782664773767301']);
  const ctx = vm.createContext({
    Date: class extends Date { static now() { return now; } },
    COOLDOWN_EXEMPT_USER_IDS: exemptIds,
    ENCOUNTER_COOLDOWN_EXEMPT_USER_IDS: encounterExemptIds,
    catchCooldowns: new Set(), fishCooldowns: new Set(),
    cooldownEndsAt: { p: new Map(), f: new Map(), battle: new Map() },
    pokemonCooldownStates: { p: new Map(), f: new Map() },
    POKEMON_COOLDOWN_MS: 8000, getUser: () => user,
    incrementUser: (_id, changes) => {
      for (const [field, amount] of Object.entries(changes)) user[field] += amount;
    },
    setTimeout: () => ({}), clearTimeout: () => {}, getCooldownNotificationMode: () => 'ping',
    console, PREFIX: '.', EMOJIS: { cooldownMachine: 'machine' },
  });
  vm.runInContext(extract(indexSource, 'function isCooldownExemptUser(', '\nconst catchCooldowns'), ctx);
  vm.runInContext(extract(indexSource, 'function scheduleCooldownNotification(', '\nasync function fetchPokemonAbilities('), ctx);
  const message = { author: { username: 'Admin' }, channel: {} };
  for (const id of encounterExemptIds) {
    assert.equal(ctx.startPokemonCooldown(message, id).exempt, true);
    assert.equal(ctx.catchCooldowns.has(id), false);
  }
  const restoredId = '1514082847609061541';
  assert.equal(ctx.isCooldownExemptUser(restoredId), true);
  assert.equal(ctx.isEncounterCooldownExemptUser(restoredId), false);
  assert.ok(ctx.startPokemonCooldown(message, restoredId));
  assert.equal(ctx.catchCooldowns.has(restoredId), true);

  const id = 'ordinary';
  assert.ok(ctx.startPokemonCooldown(message, id));
  now += 3999;
  assert.equal(ctx.startPokemonCooldown(message, id), null);
  assert.equal(user.cooldown_machine_catch_charges, 1);
  now += 1;
  assert.ok(ctx.startPokemonCooldown(message, id));
  assert.equal(user.cooldown_machine_catch_charges, 0);
  assert.equal(ctx.startPokemonCooldown(message, id), null);
  now += 8000;
  assert.ok(ctx.startPokemonCooldown(message, id));

  ctx.fishCooldowns.add(id);
  ctx.scheduleCooldownNotification(ctx.fishCooldowns, id, 'Admin', {}, 20000, 'f', message);
  now += 9999;
  assert.equal(ctx.consumeCooldownMachineForEarlyUse(id, 'f', ctx.fishCooldowns), false);
  now += 1;
  assert.equal(ctx.consumeCooldownMachineForEarlyUse(id, 'f', ctx.fishCooldowns), true);
  assert.equal(user.cooldown_machine_fish_charges, 0);
});

test('cooldown toggle offers all three modes and only its owner can change them', async () => {
  let mode = 'ping';
  const events = {};
  const replies = [];
  const ctx = vm.createContext({
    command: 'toggle', args: ['cooldown'], userId: 'u', PREFIX: '.',
    getCooldownNotificationMode: () => mode,
    setCooldownNotificationMode: (_id, selected) => { mode = selected; },
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder, console,
    message: { reply: async (payload) => {
      replies.push(payload);
      return { createMessageComponentCollector: () => ({ on: (name, fn) => { events[name] = fn; } }),
        edit: async () => {} };
    } },
  });
  vm.runInContext(`async function run() { ${extract(indexSource, "    if (command === 'toggle') {", "\n    if (command === 'perks'")} }`, ctx);
  await ctx.run();
  assert.deepEqual(replies[0].components[0].toJSON().components.map((button) => button.label), ['Ping', 'Username', 'React']);
  const denied = [];
  await events.collect({ user: { id: 'other' }, customId: 'toggle_cooldown_mode:react',
    reply: async (payload) => denied.push(payload) });
  assert.equal(mode, 'ping');
  assert.match(denied[0].content, /Only the user/);
  let updated;
  await events.collect({ user: { id: 'u' }, customId: 'toggle_cooldown_mode:react',
    update: async (payload) => { updated = payload; } });
  assert.equal(mode, 'react');
  assert.match(updated.embeds[0].toJSON().description, /\*\*react\*\*/);
});

test('World Boss reminder is scheduled 20 seconds before battle and is sent only once per server', async () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE bot_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const timers = [];
  const sent = [];
  const boss = { id: 7, name: 'Eternamax Eternatus', registration_ends_at: Date.now() + 120000 };
  let activeBoss = boss;
  const ctx = vm.createContext({
    db, console, Date, WORLD_BOSS_GUILD_ID: 'guild', WORLD_BOSS_PING_ROLE_ID: 'boss-role',
    ETERNAMAX_PING_ROLE_ID: 'eternamax-role',
    client: { channels: { fetch: async () => ({ guildId: 'guild', isTextBased: () => true,
      send: async (payload) => sent.push(payload) }) } },
    getActiveWorldBoss: () => activeBoss,
    getWorldBossAnnouncementPosts: () => [{ guild_id: 'guild', channel_id: 'channel' }],
    setTimeout: (callback, delay) => { const timer = { callback, delay, unref() {} }; timers.push(timer); return timer; },
    clearTimeout: () => {}, updateWorldBossAnnouncement: async () => {}, createWorldBossEmbed: () => ({}),
  });
  vm.runInContext(extract(indexSource, 'function getWorldBossPingRoles(', '\nasync function postWorldBossAnnouncementToChannel('), ctx);
  vm.runInContext(extract(indexSource, 'const WORLD_BOSS_PROGRESS_INTERVAL_MS', '\n// Coalesces boss HP refreshes'), ctx);
  ctx.scheduleWorldBossRegistrationClose(boss);
  assert.ok(timers[0].delay <= 100000 && timers[0].delay > 99000);
  timers[0].callback();
  await new Promise((resolve) => setImmediate(resolve));
  await ctx.remindWorldBossRegistrationClosing(boss);
  assert.equal(sent.length, 1);
  assert.match(sent[0].content, /<@&boss-role> <@&eternamax-role>/);
  assert.ok(sent[0].content.includes(`The battle against **${boss.name}** begins <t:${Math.floor(boss.registration_ends_at / 1000)}:R>!`));
  assert.doesNotMatch(sent[0].content, /registration closes/i);
  assert.deepEqual(Array.from(sent[0].allowedMentions.roles), ['boss-role', 'eternamax-role']);
  activeBoss = null;
  await ctx.remindWorldBossRegistrationClosing({ ...boss, id: 8 });
  assert.equal(sent.length, 1);
  db.close();
});

test('World Boss spawn announcement pings the configured roles', async () => {
  const sent = [];
  const savedPosts = [];
  const channel = {
    id: 'channel',
    guildId: 'guild',
    isTextBased: () => true,
    permissionsFor: () => ({ has: () => true }),
    send: async (payload) => {
      sent.push(payload);
      return { id: 'post' };
    },
  };
  const ctx = vm.createContext({
    client: { user: {} },
    PermissionsBitField,
    WORLD_BOSS_GUILD_ID: 'guild',
    WORLD_BOSS_PING_ROLE_ID: 'boss-role',
    ETERNAMAX_PING_ROLE_ID: 'eternamax-role',
    createWorldBossEmbed: () => ({}),
    setWorldBossAnnouncementPost: (...args) => savedPosts.push(args),
  });
  vm.runInContext(
    extract(indexSource, 'function getWorldBossPingRoles(', '\nasync function postWorldBossAnnouncementToChannel('),
    ctx
  );
  const channelPost = extract(
    indexSource,
    'async function postWorldBossAnnouncementToChannel(',
    '\nasync function announceWorldBossEverywhere('
  );
  vm.runInContext(channelPost, ctx);

  await ctx.postWorldBossAnnouncementToChannel(
    { id: 'guild', members: { me: {} } },
    channel,
    { id: 7, name: 'Eternamax Eternatus' }
  );

  assert.equal(sent.length, 1);
  assert.equal(sent[0].content, '<@&boss-role> <@&eternamax-role>');
  assert.deepEqual(Array.from(sent[0].allowedMentions.roles), ['boss-role', 'eternamax-role']);
  assert.deepEqual(savedPosts, [[7, 'guild', 'channel', 'post']]);
});

test('PC dex sort orders displayed numbers across favorites and variants and works with rarity buttons', async () => {
  const entries = [
    { id: 3, pokemon_id: 25, name: 'Pikachu', rarity: 'Common', dex_number: 25, is_favorite: 1, is_shiny: 0, is_golden: 0 },
    { id: 2, pokemon_id: 1, name: 'Bulbasaur', rarity: 'Common', dex_number: 1, is_favorite: 0, is_shiny: 0, is_golden: 0 },
    { id: 1, pokemon_id: 1, name: 'Bulbasaur', rarity: 'Shiny', dex_number: 1001, is_favorite: 0, is_shiny: 1, is_golden: 0 },
  ];
  const events = {};
  const replies = [];
  const edits = [];
  const user = { id: 'u', username: 'Trainer', displayAvatarURL: () => 'https://example.com/avatar.png' };
  const panel = { createMessageComponentCollector: () => ({ on: (name, fn) => { events[name] = fn; } }),
    edit: async (payload) => edits.push(payload) };
  const ctx = vm.createContext({
    command: 'pc', args: ['dex'], userId: 'u', adminPcLookup: false, PREFIX: '.',
    message: { author: user, mentions: { users: { first: () => null } },
      reply: async (payload) => { replies.push(payload); return panel; } },
    db: { prepare: (sql) => ({ all: () => sql.includes('FROM catches c') ? entries.map((entry) => ({ ...entry })) : [] }) },
    getDexIndexOffset: () => 1000, getPokemonDexNumbers: () => new Map(),
    getRaritySettings: () => [{ name: 'Common' }, { name: 'Shiny' }],
    getDisplayRarity: (rarity) => rarity, getPokemonSpriteEmoji: () => '',
    RARITY_EMOJIS: {}, MEGA_SPECIES_EMOJIS: {}, EMOJIS: {},
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder, console,
  });
  vm.runInContext(`async function run() { ${extract(indexSource, "    if (command === 'box' || command === 'pc') {", "\n    if ((command === 'item'")} }`, ctx);
  await ctx.run();
  const initial = replies[0].embeds[0].toJSON();
  assert.match(initial.footer.text, /Sorted by: Dex/);
  assert.ok(initial.fields[0].value.indexOf('0001') < initial.fields[0].value.indexOf('0025'));
  assert.ok(initial.fields[0].value.indexOf('0025') < initial.fields[0].value.indexOf('1001'));
  await events.collect({ user, customId: 'box:rarity:shiny', deferUpdate: async () => {} });
  assert.match(edits[0].embeds[0].toJSON().fields[0].value, /1001/);
  assert.doesNotMatch(edits[0].embeds[0].toJSON().fields[0].value, /0025/);
  await events.collect({ user, customId: 'box:sort', deferUpdate: async () => {} });
  assert.match(edits[1].embeds[0].toJSON().footer.text, /Sorted by: Rarity/);
});

test('clan stats shortcuts select the same periods as their full names', async () => {
  const seen = [];
  const ctx = vm.createContext({
    args: [], userId: 'user', PREFIX: '.', playerClan: { id: 1, name: 'Clan' },
    client: { emojis: { cache: { find: () => null } } },
    EMOJIS: { oldrod: ':rod:', pokeEgg: ':egg:' }, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
    getClanActivityStats: (_clan, period, category) => {
      seen.push([period, category]);
      return { rows: [], totals: { catches: 0, fishes: 0, hatches: 0, swaps: 0, catchbot: 0, battles: 0 }, end: Date.now(), memberCount: 0 };
    },
    message: { reply: async () => ({ createMessageComponentCollector: () => ({ on: () => {} }) }) },
  });
  vm.runInContext(`async function statsCommand() {
    const subcommand = 'stats';
    ${extract(indexSource, "      if (subcommand === 'stats') {", "\n      if (subcommand === 'members') {")}
  }`, ctx);
  for (const [short, full] of [['d', 'daily'], ['w', 'weekly'], ['m', 'monthly'], ['y', 'yearly']]) {
    ctx.args = ['stats', short, 'fishes'];
    await ctx.statsCommand();
    ctx.args = ['stats', full, 'fishes'];
    await ctx.statsCommand();
    assert.deepEqual(seen.slice(-2), [[full, 'fishes'], [full, 'fishes']]);
  }
});

test('clan joining by name is disabled in favor of invitations', async () => {
  let lookups = 0;
  let joins = 0;
  const ctx = vm.createContext({
    args: ['join', 'Some Clan'],
    userId: 'user',
    subcommand: 'join',
    playerClan: null,
    getClanByName: () => { lookups += 1; return { id: 1 }; },
    joinClan: () => { joins += 1; return {}; },
  });
  vm.runInContext(`async function joinCommand(message) {
    ${extract(indexSource, "      if (subcommand === 'join') {", "\n      if (subcommand === 'leave') {")}
  }`, ctx);

  const reply = await ctx.joinCommand({ reply: async (content) => content });
  assert.match(reply, /Joining by clan name is disabled/);
  assert.equal(lookups, 0);
  assert.equal(joins, 0);
});

test('bare clan-name lookup is restricted to bot admins', () => {
  const requestedNames = [];
  const clan = { id: 2, name: 'Mewtwos Multiverse' };
  const ctx = vm.createContext({
    args: ['Mewtwos', 'Multiverse'],
    subcommand: 'mewtwos',
    playerClan: null,
    message: { reply: (content) => content },
    isBotAdmin: () => ctx.isAdmin,
    isAdmin: false,
    getClanByName: (name) => {
      requestedNames.push(name);
      return clan;
    },
  });
  vm.runInContext(`function bareClanLookup() {
    ${extract(indexSource, "      const clanQuery = subcommand === 'info'", "\n      const members = getClanMembers(clan.id);")}
    return clan;
  }`, ctx);

  assert.equal(ctx.bareClanLookup(), 'Only bot admins can view another clan by name.');
  assert.deepEqual(requestedNames, []);

  ctx.isAdmin = true;
  assert.equal(ctx.bareClanLookup(), clan);
  assert.deepEqual(requestedNames, ['Mewtwos Multiverse']);
});

test('counters advance and reset only after a successful catch', async () => {
  const calls = [];
  const ctx = vm.createContext({
    isSuccess: false, userId: 'user', catcher: { username: 'Trainer' }, guaranteedCatch: false,
    target: { id: 1, name: 'Test', rarity: 'Common', isShiny: false },
    counterSource: 'pokemon', catchDisplayRarity: 'Common', selectedBall: 'pb',
    ball: { name: 'Pokéball', emoji: ':ball:', column: 'pokeballs', image: 'poke.png' },
    rarityData: { rateText: 'rate' }, playerRoll: 99, targetRate: 1, baseCoinsEarned: 1, image: null, allowAnyUserCatch: false,
    EmbedBuilder, EMOJIS: {}, HELD_ITEM_EMOJI: ':held:', halloweenEvent: {}, EVENT_EMBED_COLOR: 1,
    isEventOpen: () => false, isEventChecklistSpawn: () => false, getRarityColor: () => 1,
    getRarityEmojis: () => '', factionLogoPrefix: () => '', heldItemEncounterHint: () => '',
    getRemainingBalls: () => '', editEncounter: async () => {},
    recordPokemonSeen: () => {}, resetRarityStreaks: () => {}, getCatchCoinReward: () => 1,
    awardCoinsWithBoost: () => ({ finalAmount: 1 }), getPatreonPerks: () => ({ quickHands: 0 }),
    db: { prepare: () => ({ get: () => null }) }, saveCatch: () => {},
    recordDailyCatch: () => {}, addUserItem: () => {},
    recordWildEncounterCounter: (_id, source) => calls.push(`catch:${source}`),
    recordHeldItemEncounterCounter: () => calls.push('item:advance'),
    resetHeldItemEncounterCounter: () => calls.push('item:reset'),
    resetEncounterCounters: (_id, source, categories) => { calls.push(`reset:${source}:${categories.join(',')}`); return []; },
    recordEventSpawnCatch: (_id, _name, isEvent) => calls.push(`event:${isEvent}`),
  });
  vm.runInContext(`async function catchOutcome() {
    ${extract(indexSource, '    if (!isSuccess) {', '\n    const eggAbilityBoost =')}
  }`, ctx);
  await ctx.catchOutcome();
  assert.deepEqual(calls, []);
  ctx.isSuccess = true;
  await ctx.catchOutcome();
  assert.deepEqual(calls, ['catch:pokemon', 'item:advance', 'reset:pokemon:', 'event:false']);
  calls.length = 0;
  ctx.target.spawnPity = { source: 'pokemon', outcomes: [{ category: 'shiny', spawned: true }] };
  await ctx.catchOutcome();
  assert.deepEqual(calls, ['catch:pokemon', 'item:advance', 'reset:pokemon:', 'event:false']);
  calls.length = 0;
  ctx.counterSource = 'explore';
  ctx.target = { id: 1, name: 'Test', rarity: 'Legendary', isShiny: true, isGolden: true };
  await ctx.catchOutcome();
  assert.deepEqual(calls, ['catch:explore', 'reset:explore:legendary,shiny,golden']);
  calls.length = 0;
  ctx.counterSource = 'fishing';
  ctx.target = { id: 1, name: 'Test', rarity: 'Common', heldItem: 'Item', isEventSpawn: true };
  await ctx.catchOutcome();
  assert.deepEqual(calls, ['catch:fishing', 'item:advance', 'item:reset']);
  calls.length = 0;
  ctx.target = { id: 1, name: 'Event Legend', rarity: 'Legendary', isShiny: true, isEventSpawn: true };
  await ctx.catchOutcome();
  assert.deepEqual(calls, ['catch:fishing', 'item:advance']);
  calls.length = 0;
  ctx.target = { id: 1, name: 'Golden Magikarp', rarity: 'Golden', isGolden: true };
  await ctx.catchOutcome();
  assert.deepEqual(calls, ['catch:fishing', 'item:advance', 'reset:fishing:golden']);
  calls.length = 0;
  ctx.target.isEventSpawn = true;
  await ctx.catchOutcome();
  assert.deepEqual(calls, ['catch:fishing', 'item:advance', 'reset:fishing:golden']);
  calls.length = 0;
  ctx.target = { id: 1, name: 'Event Legend', rarity: 'Legendary', isShiny: true, isEventSpawn: true };
  ctx.counterSource = 'pokemon';
  await ctx.catchOutcome();
  assert.deepEqual(calls, ['catch:pokemon', 'item:advance', 'event:true']);
});

test('transferred form stats do not inherit another form of the same species', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE catches (
      id INTEGER PRIMARY KEY, user_id TEXT, pokemon_id INTEGER,
      is_shiny INTEGER DEFAULT 0, is_golden INTEGER DEFAULT 0,
      level INTEGER DEFAULT 1, experience INTEGER DEFAULT 0,
      hp_iv INTEGER DEFAULT 0, atk_iv INTEGER DEFAULT 0, def_iv INTEGER DEFAULT 0,
      spa_iv INTEGER DEFAULT 0, spdef_iv INTEGER DEFAULT 0, spd_iv INTEGER DEFAULT 0,
      friendship INTEGER DEFAULT 0, ev_hp INTEGER DEFAULT 0, ev_atk INTEGER DEFAULT 0,
      ev_def INTEGER DEFAULT 0, ev_spa INTEGER DEFAULT 0, ev_spdef INTEGER DEFAULT 0, ev_spe INTEGER DEFAULT 0,
      rarity TEXT, hp INTEGER, max_hp INTEGER, atk INTEGER, def INTEGER, spd INTEGER,
      moves TEXT DEFAULT '[]', sketched_moves TEXT DEFAULT '[]'
    );
    CREATE TABLE pokemon_forms (
      id INTEGER PRIMARY KEY, species_id INTEGER, base_hp INTEGER, base_atk INTEGER,
      base_def INTEGER, base_spd INTEGER
    );
    INSERT INTO pokemon_forms VALUES (150, 150, 106, 110, 90, 130), (10201, 150, 106, 190, 100, 130);
    INSERT INTO catches (id, user_id, pokemon_id, level, experience, rarity)
    VALUES (1, 'recipient', 150, 100, 5000000, 'Legendary'),
      (2, 'recipient', 10201, 1, 0, 'Mega');
  `);
  const ctx = vm.createContext({
    db,
    assertUserId: (userId) => assert.equal(userId, 'recipient'),
    getCatchStateSnapshot: () => null,
    calculateStat: (base, iv, level, isHp, isShiny, ev, isGolden, rarity) => base + iv + level + ev,
    EV_STATS: ['hp', 'atk', 'def', 'spa', 'spdef', 'spe'],
    Math: { floor: Math.floor, random: () => 0 },
  });
  vm.runInContext(extract(dbSource, 'function rebaseTransferredPokemon(', '\n// Brings every group'), ctx);

  assert.equal(ctx.rebaseTransferredPokemon('recipient', 2), true);
  const transferred = db.prepare('SELECT level, atk, hp_iv FROM catches WHERE id = 2').get();
  assert.equal(transferred.level, 1);
  assert.equal(transferred.hp_iv, 0);
  assert.equal(transferred.atk, 191);
  db.close();
});

test('Role Play is available to Bulbapedia level, egg and tutor learners, including form overrides', () => {
  const pokemonMovesData = require('../data/pokemon-moves.json');
  const pokemonCatalog = require('../data/pokemon-catalog.json');
  const moveInfoData = require('../data/move-info.json');
  const specialMoveLearners = Object.fromEntries(Object.entries(require('../data/special-move-learners.json'))
    .map(([move, ids]) => [move, new Set(ids)]));
  const ctx = vm.createContext({
    pokemonMovesData, pokemonCatalog, moveInfoData, specialMoveLearners,
    expandedPokemonMoves: require('../data/expanded-pokemon-moves.json'),
  });
  vm.runInContext(extract(dbSource, 'const FORM_EXTRA_MOVES =', '\nfunction setBuddyMoves('), ctx);
  vm.runInContext(extract(dbSource, 'function findMoveInfo(', '\n// Admin tool:'), ctx);
  for (const [species, form] of [[64, 64], [96, 96], [35, 35], [37, 10103], [386, 10001], [899, 899]]) {
    assert.ok(ctx.getSpeciesLearnset(species, form).includes('role-play'));
  }
  assert.ok(!ctx.getSpeciesLearnset(133, 133).includes('role-play'));
  assert.ok(ctx.findMoveInfo('role play').learners.includes('Clefairy'));
  assert.ok(ctx.findMoveInfo('roleplay').learners.includes('Wyrdeer'));
  assert.ok(pokemonMovesData.moves['role-play']);
  assert.ok(ctx.getSpeciesLearnset(25, 25).includes('pay-day'));
  assert.ok(ctx.getSpeciesLearnset(6, 10196).includes('power-up-punch'));
  assert.ok(!ctx.getSpeciesLearnset(1, 1).includes('pay-day'));
  assert.ok(ctx.findMoveInfo('payday').learners.includes('Pikachu'));
  assert.ok(ctx.findMoveInfo('power-up-punch').learners.includes('Charizard'));
});

test('Vaporeon can learn supported TM, HM, tutor and inherited moves from past generations', () => {
  const ctx = vm.createContext({
    pokemonMovesData: require('../data/pokemon-moves.json'),
    pokemonCatalog: require('../data/pokemon-catalog.json'),
    moveInfoData: require('../data/move-info.json'),
    expandedPokemonMoves: require('../data/expanded-pokemon-moves.json'),
    specialMoveLearners: Object.fromEntries(
      Object.entries(require('../data/special-move-learners.json'))
        .map(([move, ids]) => [move, new Set(ids)])
    ),
  });
  vm.runInContext(extract(dbSource, 'const FORM_EXTRA_MOVES =', '\nfunction setBuddyMoves('), ctx);
  vm.runInContext(extract(dbSource, 'function findMoveInfo(', '\n// Admin tool:'), ctx);

  const learnset = ctx.getSpeciesLearnset(134, 134);
  for (const move of [
    'focus-energy', 'captivate', 'toxic', 'bubble-beam', 'strength', 'dive',
    'heal-bell', 'signal-beam', 'refresh', 'synchronoise', 'pay-day',
  ]) {
    assert.ok(learnset.includes(move), move);
    assert.ok(ctx.pokemonMovesData.moves[move], `${move} has battle data`);
    assert.ok(ctx.findMoveInfo(move).learners.includes('Vaporeon'), `${move} learner list`);
  }
  assert.ok(!ctx.getSpeciesLearnset(1, 1).includes('signal-beam'));
});

test('expanded move learnsets support player battles, pre-evolutions and regional forms', () => {
  const pokemonMovesData = require('../data/pokemon-moves.json');
  const expandedPokemonMoves = require('../data/expanded-pokemon-moves.json');
  const specialMoveLearners = Object.fromEntries(
    Object.entries(require('../data/special-move-learners.json'))
      .map(([move, ids]) => [move, new Set(ids)])
  );
  let pokemon = { pokemon_id: 1, species_id: 1, moves: '["cut","tackle"]', sketched_moves: '[]' };
  const evolutionWrites = [];
  const moveWrites = [];
  const ctx = vm.createContext({
    pokemonMovesData, expandedPokemonMoves, specialMoveLearners,
    pokemonCatalog: require('../data/pokemon-catalog.json'),
    moveInfoData: require('../data/move-info.json'),
    assertUserId: () => {},
    db: {
      prepare: (sql) => ({
        get: () => pokemon,
        run: (...args) => (sql.includes('sketched_moves') ? evolutionWrites : moveWrites).push(args),
      }),
      transaction: (fn) => ({ immediate: fn }),
    },
    getUser: () => ({ buddy_catch_id: 1, coins: 100000 }),
    getBuddyMoveChangeCost: () => 50000,
    incrementUser: () => {},
    syncDuplicateCatchState: () => {},
    getGigantamaxMoves: () => [],
    restrictStyleExclusiveMoves: (moves) => moves,
    getPokemonMove: (name) => pokemonMovesData.moves[name],
    console,
  });
  vm.runInContext(extract(dbSource, 'const FORM_EXTRA_MOVES =', '\nfunction setBuddyMoves('), ctx);
  vm.runInContext(extract(dbSource, 'function parseSketchedMoves(', '\n// Smeargle'), ctx);
  vm.runInContext(extract(indexSource, 'function getEquippedBattleMovesBase(', '\nconst GAUNTLET_POKEMON_IDS'), ctx);
  vm.runInContext(extract(dbSource, 'function carryOverEvolutionMoves(', '\nfunction prepareEvolutionHeldItems('), ctx);
  vm.runInContext(extract(dbSource, 'function findMoveInfo(', '\n// Admin tool:'), ctx);
  vm.runInContext(extract(dbSource, 'function setBuddyMoveSlot(', '\nfunction deleteBuddyMoveSlot('), ctx);

  const bulbasaur = ctx.getPokemonLearnset(1, 'user').moves;
  assert.ok(bulbasaur.includes('cut'));
  assert.ok(bulbasaur.includes('toxic'));
  assert.ok(!bulbasaur.includes('flamethrower'));
  assert.ok(!bulbasaur.includes('bide'));
  assert.deepEqual(Array.from(ctx.getEquippedBattleMovesBase(pokemon, 1, 1), (move) => move.name),
    ['Cut', 'Tackle', 'Double-Edge', 'Power Whip']);
  const result = ctx.setBuddyMoveSlot('user', 1, 'toxic');
  assert.equal(result.moves[0], 'toxic');
  assert.equal(JSON.parse(moveWrites[0][0])[0], 'toxic');
  assert.ok(ctx.findMoveInfo('cut').learners.includes('Bulbasaur'));
  ctx.carryOverEvolutionMoves('user', { id: 1 }, { id: 2, species_id: 2 });
  assert.equal(evolutionWrites.length, 0);
  pokemon.moves = '["psychic-terrain"]';
  ctx.carryOverEvolutionMoves('user', { id: 1 }, { id: 2, species_id: 2 });
  assert.deepEqual(JSON.parse(evolutionWrites[0][0]), ['psychic-terrain']);
  pokemon = { pokemon_id: 134, species_id: 134, moves: '[]', sketched_moves: '[]' };
  assert.ok(ctx.getPokemonLearnset(1, 'user').moves.includes('refresh'));
  pokemon = { pokemon_id: 10100, species_id: 26, moves: '[]', sketched_moves: '[]' };
  assert.ok(ctx.getPokemonLearnset(1, 'user').moves.includes('psychic-terrain'));
  assert.ok(!ctx.getPokemonLearnset(1, 'user').moves.some((move) => move.startsWith('g-max-')));
  pokemon = { pokemon_id: 10104, species_id: 38, moves: '[]', sketched_moves: '[]' };
  assert.ok(ctx.getPokemonLearnset(1, 'user').moves.includes('freeze-dry'));
  assert.ok(!ctx.getPokemonLearnset(1, 'user').moves.includes('psychic-terrain'));
  pokemon = { pokemon_id: 38, species_id: 38, moves: '[]', sketched_moves: '[]' };
  assert.ok(!ctx.getPokemonLearnset(1, 'user').moves.includes('freeze-dry'));
});

test('Eevee evolves with every specified stone from inventory or while held', async () => {
  const { EVOLUTION_ITEMS, findEvolutionItem } = require('../evolution-items');
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, buddy_catch_id INTEGER);
    INSERT INTO users VALUES ('user',1);
    CREATE TABLE pokemon_forms (
      id INTEGER PRIMARY KEY, species_id INTEGER, species_name TEXT, name TEXT, slug TEXT,
      rarity TEXT, is_default INTEGER, base_hp INTEGER, base_atk INTEGER, base_def INTEGER, base_spd INTEGER
    );
    CREATE TABLE catches (
      id INTEGER PRIMARY KEY, user_id TEXT, pokemon_id INTEGER, name TEXT, is_shiny INTEGER, is_golden INTEGER,
      rarity TEXT, held_item TEXT, friendship INTEGER, level INTEGER, experience INTEGER, hp_iv INTEGER, atk_iv INTEGER,
      def_iv INTEGER, spa_iv INTEGER, spdef_iv INTEGER, spd_iv INTEGER, ev_hp INTEGER, ev_atk INTEGER,
      ev_def INTEGER, ev_spa INTEGER, ev_spdef INTEGER, ev_spe INTEGER, hp INTEGER, max_hp INTEGER,
      atk INTEGER, def INTEGER, spd INTEGER, moves TEXT, sketched_moves TEXT, in_team INTEGER DEFAULT 0, team_slot INTEGER
    );
    CREATE TABLE user_items (user_id TEXT, item_name TEXT, amount INTEGER, PRIMARY KEY (user_id, item_name));
    CREATE TABLE user_pokemon_state_snapshots (user_id TEXT, pokemon_id INTEGER, is_shiny INTEGER, is_golden INTEGER);
  `);
  const targets = [
    ['Water Stone', 134, 'Vaporeon'], ['Thunder Stone', 135, 'Jolteon'],
    ['Fire Stone', 136, 'Flareon'], ['Grass Stone', 470, 'Leafeon'],
    ['Ice Stone', 471, 'Glaceon'], ['Dusk Stone', 197, 'Umbreon'],
    ['Dawn Stone', 196, 'Espeon'], ['Shiny Stone', 700, 'Sylveon'],
  ];
  const insertForm = db.prepare('INSERT INTO pokemon_forms VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  for (const [id, name] of [[133, 'Eevee'], ...targets.map(([, id, name]) => [id, name])]) {
    insertForm.run(id, id, name, name, name.toLowerCase(), 'Common', 1, 50, 50, 50, 50);
  }
  const ctx = vm.createContext({
    db, EVOLUTION_ITEMS, findEvolutionItem, BATTLE_HELD_ITEM_NAMES: new Set(),
    findBattleHeldItem: () => null, assertUserId: () => {}, calculateStat: () => 10,
    syncEvolvedCatchState: () => false, syncDuplicateCatchState: () => {},
    carryOverEvolutionMoves: () => {}, recordPokemonSeen: () => {},
    addUserItem: (id, name) => db.prepare(`
      INSERT INTO user_items VALUES (?,?,1)
      ON CONFLICT(user_id,item_name) DO UPDATE SET amount=amount+1
    `).run(id, name),
    sortedNameWords: (name) => String(name || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).sort().join(' '),
    friendshipEvolutionRules: new Map(require('../data/pokemon-friendship-evolutions.json')
      .filter((rule) => rule.fromSpeciesId === 133).map((rule) => [133, [rule]])),
    levelEvolutionRules: new Map([[133, require('../data/pokemon-evolution-rules.json')
      .filter((rule) => rule.fromSpeciesId === 133)]]), TIME_LEVEL_EVOLUTIONS: {},
  });
  vm.runInContext(extract(dbSource, 'function takeUserItem(', '\nconst PLAYER_BONUSES'), ctx);
  vm.runInContext(extract(dbSource, 'function resolveSpeciesEvolution(', '\n// Equipped moves'), ctx);
  vm.runInContext(extract(dbSource, 'function prepareEvolutionHeldItems(', '\nfunction findUserPokemonMatches('), ctx);
  vm.runInContext(extract(dbSource, 'function holdEvolutionItem(', '\n// Compact next-step evolution options'), ctx);
  vm.runInContext(extract(dbSource, 'function evolvePokemonByLevel(', '\nconst moveInfoData'), ctx);
  const reset = () => {
    db.exec(`DELETE FROM catches; DELETE FROM user_items;
      INSERT INTO catches (id,user_id,pokemon_id,name,is_shiny,is_golden,rarity,friendship,level,experience,
        hp_iv,atk_iv,def_iv,spa_iv,spdef_iv,spd_iv,ev_hp,ev_atk,ev_def,ev_spa,ev_spdef,ev_spe,
        hp,max_hp,atk,def,spd,moves,sketched_moves,in_team,team_slot)
      VALUES (1,'user',133,'Eevee',0,0,'Common',255,30,0,0,0,0,0,0,0,0,0,0,0,0,0,10,10,10,10,10,'[]','[]',1,1);`);
  };
  for (const [query, , name] of targets) {
    const item = findEvolutionItem(query);
    reset();
    assert.equal(ctx.evolvePokemonByLevel('user', 'eevee').error, 'cannot_evolve_by_level');
    assert.equal(ctx.evolvePokemonWithItem('user', 'eevee', query).error, 'no_item');
    db.prepare('INSERT INTO user_items VALUES (?,?,1)').run('user', item);
    assert.equal(ctx.evolvePokemonWithItem('user', 'eevee', query).to, name);
    assert.equal(db.prepare('SELECT amount FROM user_items WHERE item_name=?').get(item).amount, 0);

    reset();
    db.prepare('INSERT INTO user_items VALUES (?,?,1)').run('user', item);
    assert.equal(ctx.holdEvolutionItem('user', query, 'eevee').itemName, item);
    assert.equal(db.prepare('SELECT held_item FROM catches WHERE id=1').get().held_item, item);
    assert.equal(ctx.unholdEvolutionItem('user', 'eevee', query).itemName, item);
    assert.equal(db.prepare('SELECT amount FROM user_items WHERE item_name=?').get(item).amount, 1);
    ctx.holdEvolutionItem('user', query, 'eevee');
    assert.equal(ctx.evolvePokemonWithItem('user', 'eevee').to, name);
    const evolved = db.prepare('SELECT held_item, level, in_team, team_slot FROM catches WHERE id=1').get();
    assert.deepEqual(evolved, { held_item: null, level: 30, in_team: 1, team_slot: 1 });
    assert.equal(db.prepare('SELECT amount FROM user_items WHERE item_name=?').get(item).amount, 0);
  }

  reset();
  db.prepare('INSERT INTO user_items VALUES (?,?,1)').run('user', 'Leaf Stone');
  Object.assign(ctx, {
    userId: 'user', PREFIX: '.', action: 'give', args: ['give', 'grass', 'stone', '1'],
    findUserItemName: findEvolutionItem, findBox: () => null,
    TEAM_MEDALLION_ITEM: 'Team Medallion', FACTION_NON_HOLDABLE_ITEMS: new Set(), VITAMIN_ITEMS: {},
    getUserTeam: () => db.prepare('SELECT * FROM catches WHERE user_id=? AND in_team=1').all('user'),
    findUserPokemonMatches: () => [],
    teamPokemonLabel: (pokemon) => pokemon.name, message: { reply: (content) => content },
  });
  vm.runInContext(`async function teamItemCommand() {
    ${extract(indexSource, "      if (action === 'take') {", "\n      if (action === 'add' || action === 'remove') {")}
  }`, ctx);
  assert.match(await ctx.teamItemCommand(), /Gave \*\*1x Leaf Stone\*\*/);
  ctx.action = 'take';
  ctx.args = ['take', 'grass', 'stone', 'eevee'];
  assert.match(await ctx.teamItemCommand(), /Took \*\*Leaf Stone\*\*/);
  assert.equal(db.prepare('SELECT amount FROM user_items').get().amount, 1);
  assert.equal(db.prepare('SELECT held_item FROM catches WHERE id=1').get().held_item, null);

  ctx.action = 'give';
  ctx.args = ['give', 'grass', 'stone', '1'];
  await ctx.teamItemCommand();
  Object.assign(ctx, {
    command: 'evolve', args: [], getUserBuddy: () => db.prepare('SELECT * FROM catches WHERE id=1').get(),
    getRarityEmojis: () => '', getRarityColor: () => 0, getGoldenSpriteUrl: () => null,
    getPokemonShowdownSprite: () => null, EmbedBuilder,
  });
  vm.runInContext(extract(indexSource, '    const parseEvolutionArguments =', '\n    const parseMegaStoneArguments'), ctx);
  vm.runInContext(`async function evolutionCommand() {
    ${extract(indexSource, "    if (command === 'evolve' ||", "\n    if (command === 'hold') {")}
  }`, ctx);
  await ctx.evolutionCommand();
  assert.equal(db.prepare('SELECT name, held_item FROM catches WHERE id=1').get().name, 'Leafeon');
  assert.equal(db.prepare('SELECT held_item FROM catches WHERE id=1').get().held_item, null);

  reset();
  db.prepare('INSERT INTO user_items VALUES (?,?,1)').run('user', 'Dusk Stone');
  ctx.command = 'use';
  ctx.args = ['dusk', 'stone', 'eevee'];
  await ctx.evolutionCommand();
  assert.equal(db.prepare('SELECT name FROM catches WHERE id=1').get().name, 'Umbreon');
  assert.equal(db.prepare('SELECT amount FROM user_items').get().amount, 0);
  db.close();
});

test('vitamins raise the correct buddy EV, refresh stats and sync copies without power-item bonuses', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE pokemon_forms (id INTEGER PRIMARY KEY, base_hp INTEGER, base_atk INTEGER, base_def INTEGER, base_spd INTEGER);
    INSERT INTO pokemon_forms VALUES (1, 50, 50, 50, 50);
    CREATE TABLE catches (
      id INTEGER PRIMARY KEY, user_id TEXT, pokemon_id INTEGER, name TEXT, rarity TEXT, is_shiny INTEGER,
      is_golden INTEGER, level INTEGER, experience INTEGER, hp_iv INTEGER, atk_iv INTEGER, def_iv INTEGER,
      spa_iv INTEGER, spdef_iv INTEGER, spd_iv INTEGER, ev_hp INTEGER, ev_atk INTEGER, ev_def INTEGER,
      ev_spa INTEGER, ev_spdef INTEGER, ev_spe INTEGER, hp INTEGER, max_hp INTEGER, atk INTEGER, def INTEGER,
      spd INTEGER, moves TEXT, sketched_moves TEXT, friendship INTEGER, held_item TEXT, ability TEXT
    );
    INSERT INTO catches VALUES
      (1,'user',1,'Buddy','Common',0,0,100,0,0,0,0,0,0,0,0,0,0,0,0,0,210,210,105,105,105,'[]','[]',0,'Power Bracer',NULL),
      (2,'user',1,'Buddy','Common',0,0,100,0,0,0,0,0,0,0,0,0,0,0,0,0,210,210,105,105,105,'[]','[]',0,'Power Bracer',NULL);
    CREATE TABLE user_items (user_id TEXT, item_name TEXT, amount INTEGER);
  `);
  const ctx = vm.createContext({
    db, assertUserId: () => {}, getUser: () => ({ buddy_catch_id: 1 }),
    POWER_ITEM_EVS: { 'Power Bracer': 'atk' }, SHINY_STAT_MULTIPLIER: 1.1,
    parseSketchedMoves: (value) => JSON.parse(value || '[]'),
    getUserItemAmount: (id, name) => db.prepare('SELECT amount FROM user_items WHERE user_id=? AND item_name=?').get(id, name)?.amount || 0,
  });
  vm.runInContext(extract(dbSource, 'const EV_STATS =', '\n// Startup self-heal:'), ctx);
  vm.runInContext(extract(dbSource, 'function takeUserItem(', '\nconst PLAYER_BONUSES'), ctx);
  vm.runInContext(extract(dbSource, 'function awardPokemonEvs(', '\nfunction setCatchTeamStatus('), ctx);
  for (const [name, stat] of [
    ['Zinc', 'spdef'], ['Protein', 'atk'], ['Iron', 'def'],
    ['HP Up', 'hp'], ['Carbos', 'spe'], ['Calcium', 'spa'],
  ]) {
    db.prepare('INSERT INTO user_items VALUES (?,?,?)').run('user', name, 1);
    const result = ctx.useBuddyVitamin('user', name);
    assert.equal(result.gained, 10);
    assert.equal(result.stat, stat);
    const rows = db.prepare(`SELECT ev_${stat} AS ev FROM catches ORDER BY id`).all();
    assert.deepEqual(rows.map((row) => row.ev), [10, 10]);
    assert.equal(db.prepare('SELECT amount FROM user_items WHERE item_name=?').get(name).amount, 0);
    if (name === 'Zinc') assert.equal(db.prepare('SELECT ev_atk FROM catches WHERE id=1').get().ev_atk, 0);
  }
  const buddy = db.prepare('SELECT * FROM catches WHERE id=1').get();
  assert.equal(buddy.max_hp, 212);
  assert.equal(buddy.atk, 107);
  assert.equal(buddy.def, 107);
  assert.equal(buddy.spd, 107);
  const field = battle.createField();
  const specialMove = { category: 'special' };
  const untrained = { ...buddy, ev_spa: 0, ev_spdef: 0 };
  const trainedStats = battle.damageStats(buddy, buddy, specialMove, field);
  const untrainedStats = battle.damageStats(untrained, untrained, specialMove, field);
  assert.ok(trainedStats.atk > untrainedStats.atk);
  assert.ok(trainedStats.def > untrainedStats.def);
  const [training] = ctx.awardPokemonEvs('user', [1], 'spe', 9);
  assert.equal(training.bonus.gained, 8);
  assert.equal(db.prepare('SELECT ev_atk FROM catches WHERE id=1').get().ev_atk, 18);
  db.close();
});

test('vitamins consume only useful quantities, respect EV caps and reject missing inventory', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE pokemon_forms (id INTEGER PRIMARY KEY, base_hp INTEGER, base_atk INTEGER, base_def INTEGER, base_spd INTEGER);
    INSERT INTO pokemon_forms VALUES (1,50,50,50,50);
    CREATE TABLE catches (
      id INTEGER PRIMARY KEY, user_id TEXT, pokemon_id INTEGER, name TEXT, rarity TEXT, is_shiny INTEGER,
      is_golden INTEGER, level INTEGER, hp_iv INTEGER, atk_iv INTEGER, def_iv INTEGER, spd_iv INTEGER,
      ev_hp INTEGER, ev_atk INTEGER, ev_def INTEGER, ev_spa INTEGER, ev_spdef INTEGER, ev_spe INTEGER,
      hp INTEGER, max_hp INTEGER, atk INTEGER, def INTEGER, spd INTEGER, held_item TEXT
    );
    INSERT INTO catches VALUES (1,'user',1,'Buddy','Common',0,0,100,0,0,0,0,0,250,0,0,0,0,200,210,105,105,105,NULL);
    CREATE TABLE user_items (user_id TEXT, item_name TEXT, amount INTEGER);
    INSERT INTO user_items VALUES ('user','Protein',3), ('user','Iron',2);
  `);
  const ctx = vm.createContext({
    db, assertUserId: () => {}, getUser: () => ({ buddy_catch_id: 1 }),
    POWER_ITEM_EVS: {}, SHINY_STAT_MULTIPLIER: 1.1, syncDuplicateCatchState: () => {},
    getUserItemAmount: (id, name) => db.prepare('SELECT amount FROM user_items WHERE user_id=? AND item_name=?').get(id, name)?.amount || 0,
  });
  vm.runInContext(extract(dbSource, 'const EV_STATS =', '\nconst DUPLICATE_CATCH_STATE_FIELDS'), ctx);
  vm.runInContext(extract(dbSource, 'function takeUserItem(', '\nconst PLAYER_BONUSES'), ctx);
  vm.runInContext(extract(dbSource, 'function awardPokemonEvs(', '\nfunction setCatchTeamStatus('), ctx);
  const result = ctx.useBuddyVitamin('user', 'Protein', 'all');
  assert.equal(result.gained, 2);
  assert.equal(result.used, 1);
  assert.equal(db.prepare("SELECT amount FROM user_items WHERE item_name='Protein'").get().amount, 2);
  assert.equal(ctx.useBuddyVitamin('user', 'Protein').error, 'ev_limit');
  assert.equal(ctx.useBuddyVitamin('user', 'Iron', 3).error, 'not_enough_items');
  assert.equal(db.prepare("SELECT amount FROM user_items WHERE item_name='Iron'").get().amount, 2);
  db.prepare('UPDATE catches SET ev_hp=248 WHERE id=1').run();
  const capped = ctx.useBuddyVitamin('user', 'Iron', 'all');
  assert.equal(capped.gained, 10);
  assert.equal(capped.used, 1);
  assert.equal(ctx.useBuddyVitamin('user', 'Iron').error, 'ev_limit');
  db.close();
});

test('Patreon shop buys vitamins by ID or name and charges 20 tokens each', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, patreon_tokens INTEGER);
    INSERT INTO users VALUES ('user', 100);
    CREATE TABLE user_items (user_id TEXT, item_name TEXT, amount INTEGER);
  `);
  const ctx = vm.createContext({
    db, userId: 'user', PREFIX: '.', EMOJIS: { patreonToken: ':token:' },
    getUser: (id) => db.prepare('SELECT * FROM users WHERE id=?').get(id),
    incrementUser: (id, fields) => db.prepare('UPDATE users SET patreon_tokens=patreon_tokens+? WHERE id=?').run(fields.patreon_tokens, id),
    addUserItem: (id, name, amount) => db.prepare('INSERT INTO user_items VALUES (?,?,?)').run(id, name, amount),
    parseAmount: Number, getItemEmoji: () => ':vitamin:',
    message: { reply: (content) => content },
  });
  vm.runInContext(extract(dbSource, 'const VITAMIN_ITEMS =', '\nfunction calculateStat('), ctx);
  vm.runInContext(extract(indexSource, 'function findVitamin(', '\nconst ARCEUS_PLATES'), ctx);
  vm.runInContext(
    `function purchase(purchaseArgs) { ${extract(indexSource, '      const vitaminById =', '\n      const threeWordItem =')} }`,
    ctx
  );
  assert.match(ctx.purchase(['105', '2']), /2x :vitamin: Zinc/);
  assert.match(ctx.purchase(['hp', 'up', '3']), /3x :vitamin: HP Up/);
  assert.equal(db.prepare("SELECT patreon_tokens FROM users WHERE id='user'").get().patreon_tokens, 0);
  assert.equal(db.prepare("SELECT amount FROM user_items WHERE item_name='HP Up'").get().amount, 3);
  assert.match(ctx.purchase(['zinc']), /costs/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM user_items').get().count, 2);
  db.close();
});

test('vitamin use accepts multiword names and all, and the token market displays its emoji', async () => {
  const used = [];
  const ctx = vm.createContext({
    command: 'use', args: ['hp', 'up', 'all'], userId: 'user', PREFIX: '.',
    parseAmount: Number, getItemEmoji: () => ':hpup:', EV_STAT_LABELS: { hp: 'HP' },
    useBuddyVitamin: (...args) => { used.push(args); return { used: 2, pokemon: 'Buddy', stat: 'hp', before: 0, after: 20, gained: 20 }; },
    message: { reply: (content) => content },
  });
  vm.runInContext(extract(dbSource, 'const VITAMIN_ITEMS =', '\nfunction calculateStat('), ctx);
  vm.runInContext(extract(indexSource, 'function findVitamin(', '\nconst ARCEUS_PLATES'), ctx);
  vm.runInContext(
    `function run() { ${extract(indexSource, "    if (command === 'use') {\n      const twoWordVitamin", "\n    if (command === 'use' && /^exp")} }`,
    ctx
  );
  assert.match(ctx.run(), /HP EVs \*\*0\*\* → \*\*20\*\*/);
  assert.deepEqual(used[0], ['user', 'HP Up', 'all']);
  const tokenCtx = vm.createContext({
    EmbedBuilder, EMOJIS: { patreonToken: '<:patreontoken:1560376902374522980>', pokecoin: ':coin:' },
    stats: { volume: 0, average_price: 0 }, monthName: 'November', view: 'sell', PREFIX: '.', userId: 'user',
    getPatreonTokenOrderBook: () => [], describeOrders: () => 'No orders',
    getUser: () => ({ coins: 0, patreon_tokens: 0 }),
  });
  vm.runInContext(
    `${extract(indexSource, '      const buildTokenEmbed =', '\n      const buildTokenButtons =')}\nglobalThis.embed = buildTokenEmbed();`,
    tokenCtx
  );
  const embed = tokenCtx.embed.toJSON();
  assert.match(embed.thumbnail.url, /1560376902374522980\.png/);
  assert.match(embed.fields.at(-1).value, /<:patreontoken:1560376902374522980>/);
});

test('revoked admins lose built-in and environment-configured access', () => {
  const context = vm.createContext({
    process: { env: { ADMIN_IDS: '183625933041827840,1352997432929288194,extra-admin' } },
  });
  vm.runInContext(extract(indexSource, 'function isConfiguredBotAdminId(', '\nasync function sendPagedEmbeds('), context);
  for (const id of ['183625933041827840', '1352997432929288194']) {
    assert.equal(context.isConfiguredBotAdmin({ author: { id } }), false);
    assert.equal(vm.runInContext(`WORLD_BOSS_SPAWN_ALLOWED_USER_IDS.has('${id}')`, context), false);
  }
  for (const id of ['378623134816927745', 'extra-admin']) {
    assert.equal(context.isConfiguredBotAdmin({ author: { id } }), true);
  }
  assert.equal(context.isConfiguredBotAdmin({ author: { id: '426946381098254336' } }), false);
  assert.equal(vm.runInContext("WORLD_BOSS_SPAWN_ALLOWED_USER_IDS.has('426946381098254336')", context), false);
  assert.equal(context.isConfiguredBotAdmin({ author: { id: 'other' } }), false);
});

test('revoked admins are denied admin, admin spawn, and admin boss commands', async () => {
  const context = vm.createContext({
    process: { env: { ADMIN_IDS: '183625933041827840,1352997432929288194' } },
    userId: '183625933041827840',
    message: { author: { id: '183625933041827840' }, reply: async (text) => text },
  });
  vm.runInContext(
    extract(indexSource, 'function isConfiguredBotAdminId(', '\nasync function sendPagedEmbeds(') +
    '\nfunction isBotAdmin(message) { return isConfiguredBotAdmin(message); }',
    context
  );
  const admin = extract(indexSource, "    adminCommands: if (command === 'admin' || command === 'admingive') {",
    '\n      const subtype =');
  const spawn = extract(indexSource, "    if (command === 'pokemon' || command === 'p') {",
    '\n        const heldItemSpawn =');
  const boss = extract(indexSource, "    if (\n      command === 'adminboss'",
    '\n      const query =');
  vm.runInContext(`
    async function adminCommand() { const command = 'admin'; ${admin} } }
    async function adminSpawn() { const command = 'p'; const args = ['admin']; ${spawn} } } }
    async function adminBoss() { const command = 'adminboss'; const args = []; ${boss} } }
  `, context);
  for (const id of ['183625933041827840', '1352997432929288194']) {
    context.userId = id;
    context.message.author.id = id;
    for (const command of ['adminCommand', 'adminSpawn', 'adminBoss']) {
      assert.match(await context[command](), /Only a configured bot admin|do not have permission/);
    }
  }
});

test('admin command attempts are classified and logged with their original text', async () => {
  const sent = [];
  const context = vm.createContext({
    client: { channels: { fetch: async (id) => ({
      isTextBased: () => true,
      send: async (payload) => sent.push({ id, payload }),
    }) } },
    console,
  });
  vm.runInContext(
    extract(indexSource, 'const BOT_LOG_CHANNEL_ID', '\nasync function notifyAdminOfRareSpawn('),
    context
  );
  for (const [command, args] of [
    ['admin', ['pc']], ['admingive', ['boss']], ['adminboss', []],
    ['p', ['ADMIN']], ['pokemon', ['admin']],
    ['gstart', ['pokemon']], ['giveaway', ['set']], ['lot', ['channel']],
  ]) {
    assert.equal(context.isAdminCommand(command, args), true);
  }
  assert.equal(context.isAdminCommand('p', []), false);
  assert.equal(context.isAdminCommand('autospawn', ['set']), false);
  assert.equal(context.isAdminCommand('lottery', ['buy']), false);
  await context.sendAdminCommandLog({
    content: '.admin pokemon <@123> shiny Mew',
    author: { id: '123', username: 'Trainer' },
    guild: { id: '456', name: 'Server' },
  });
  assert.equal(sent[0].id, '1572366596524081192');
  assert.equal(sent[0].payload.embeds[0].description, '.admin pokemon <@123> shiny Mew');
  assert.match(sent[0].payload.embeds[0].fields[0].value, /Trainer \(123\)/);
  assert.equal(sent[0].payload.allowedMentions.parse.length, 0);
});

test('selected users only log admin ban and wipe commands', () => {
  const context = vm.createContext({});
  vm.runInContext(
    extract(indexSource, 'const ADMIN_COMMAND_LOG_EXEMPT_USER_IDS', '\nasync function sendAdminCommandLog('),
    context
  );
  const message = (id) => ({ author: { id } });

  for (const id of ['1514082847609061541']) {
    assert.equal(context.shouldLogAdminCommand(message(id), 'admin', ['coins']), false);
    assert.equal(context.shouldLogAdminCommand(message(id), 'admin', ['unban']), false);
    assert.equal(context.shouldLogAdminCommand(message(id), 'admin', ['BAN']), true);
    assert.equal(context.shouldLogAdminCommand(message(id), 'admin', ['wipe']), true);
    assert.equal(context.shouldLogAdminCommand(message(id), 'adminboss', []), false);
  }
  assert.equal(context.shouldLogAdminCommand(message('426946381098254336'), 'admin', ['coins']), true);
  assert.equal(context.shouldLogAdminCommand(message('other'), 'admin', ['coins']), true);
});

test('automated command patterns are logged to the configured channel rather than sent by DM', async () => {
  const sent = [];
  const context = vm.createContext({
    process: { env: {} }, PREFIX: '.',
    client: { channels: { fetch: async (id) => ({
      isTextBased: () => true,
      send: async (payload) => sent.push({ id, payload }),
    }) } },
  });
  vm.runInContext(
    extract(indexSource, 'const BOT_LOG_CHANNEL_ID', '\nconst AUCTION_ANNOUNCEMENT_CHANNEL_ID') +
      extract(indexSource, 'const USER_COMMAND_GAP_MS', '\nfunction isCommandThrottled('),
    context,
  );
  let activity;
  for (let i = 0; i < 6; i++) {
    activity = context.recordCommandCadence({
      author: { id: '123', username: 'Trainer' }, content: '.catch',
      guild: { id: '456', name: 'Server' }, createdTimestamp: 10000 + i * 1000,
    });
  }
  await context.logCommandCadence('123', activity);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].id, '1572366596524081192');
  assert.match(sent[0].payload.content, /Username: Trainer\nUser ID: 123\nServer: Server \(456\)/);
  assert.match(sent[0].payload.content, /Pattern: \.catch repeated 6 times/);
  assert.equal(sent[0].payload.allowedMentions.parse.length, 0);
  context.client.channels.fetch = async () => null;
  await assert.rejects(context.logCommandCadence('123', activity), /not a text channel/);
});

test('guild join logs identify recent bot inviters and report unavailable audit logs', async () => {
  const messages = [];
  const warnings = [];
  const context = vm.createContext({
    client: {
      user: { id: 'bot' },
      channels: { fetch: async (id) => ({
        isTextBased: () => true, send: async (payload) => messages.push({ id, payload }),
      }) },
      users: { fetch: async () => { throw new Error('Guild join reports must not be sent by DM'); } },
    },
    AuditLogEvent: { BotAdd: 'bot-add' },
    BLOCKED_GUILD_IDS: new Set(),
    console: { warn: (...args) => warnings.push(args), error: (...args) => { throw new Error(args.join(' ')); } },
    Date,
    setTimeout: (callback) => callback(),
  });
  vm.runInContext(
    extract(indexSource, 'const BOT_LOG_CHANNEL_ID', '\nconst AUCTION_ANNOUNCEMENT_CHANNEL_ID') +
      extract(indexSource, 'async function reportGuildJoin(', "\nclient.on('guildCreate'"),
    context,
  );
  const guild = {
    id: '456', name: 'Server', memberCount: 42,
    fetchOwner: async () => ({ id: 'owner', user: { username: 'Owner' } }),
    fetchAuditLogs: async () => ({
      entries: [
        { target: { id: 'other' }, createdTimestamp: Date.now(), executor: { id: 'wrong', username: 'Wrong' } },
        { target: { id: 'bot' }, createdTimestamp: Date.now(), executor: { id: '123', username: 'Inviter' } },
      ],
    }),
  };
  await context.reportGuildJoin(guild);
  assert.equal(messages[0].id, '1572366596524081192');
  assert.match(messages[0].payload.content, /Server.*456/);
  assert.match(messages[0].payload.content, /Added by: Inviter \(`123`\)/);
  assert.match(messages[0].payload.content, /Owner: Owner \(`owner`\)/);
  guild.fetchAuditLogs = async () => ({
    entries: [{ target: { id: 'bot' }, createdTimestamp: Date.now() - 600000, executor: { id: 'old', username: 'Old' } }],
  });
  await context.reportGuildJoin(guild);
  assert.match(messages[1].payload.content, /Added by: Unknown \(no recent bot-add audit log entry\)/);
  guild.fetchAuditLogs = async () => { throw new Error('Missing Access'); };
  await context.reportGuildJoin(guild);
  assert.match(messages[2].payload.content, /Added by: Unknown \(audit log unavailable\)/);
  assert.equal(warnings.length, 1);
});

test('CatchBot Pokémon, cost, and duration upgrade prices double at every level', () => {
  const ctx = vm.createContext({});
  vm.runInContext(
    `${extract(dbSource, 'const catchbotUpgradeCost =', '\nconst userDefinitions =')}\nglobalThis.testCB_CONFIG = CB_CONFIG;`,
    ctx,
  );
  assert.equal(ctx.testCB_CONFIG.pokemon.costForLvl(0), 5000);
  assert.equal(ctx.testCB_CONFIG.pokemon.costForLvl(9), 2560000);
  assert.equal(ctx.testCB_CONFIG.cost.costForLvl(0), 1000);
  assert.equal(ctx.testCB_CONFIG.cost.costForLvl(9), 512000);
  assert.equal(ctx.testCB_CONFIG.duration.costForLvl(0), 1500);
  assert.equal(ctx.testCB_CONFIG.duration.costForLvl(10), 1536000);
  assert.equal(ctx.testCB_CONFIG.luck.getStat(1), 1);
  assert.equal(ctx.testCB_CONFIG.luck.getStat(10), 10);
  assert.equal(ctx.testCB_CONFIG.luck.costForLvl(1), 2500000);
});

test('Explore, held-item and event catch counters advance and reset independently', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE user_encounter_counters (
        user_id TEXT NOT NULL, source TEXT NOT NULL, category TEXT NOT NULL,
        encounters_since INTEGER NOT NULL DEFAULT 0, last_caught_at INTEGER,
        last_pokemon TEXT, last_catcher_id TEXT,
        PRIMARY KEY (user_id, source, category)
      );
      CREATE TABLE user_event_spawn_counters (
        user_id TEXT PRIMARY KEY, encounters_since INTEGER NOT NULL DEFAULT 0,
        last_caught_at INTEGER, last_pokemon TEXT
      );
      CREATE TABLE user_explore_encounter_counters (
        user_id TEXT NOT NULL, category TEXT NOT NULL, encounters_since INTEGER NOT NULL DEFAULT 0,
        last_caught_at INTEGER, last_pokemon TEXT, PRIMARY KEY (user_id, category)
      );
      CREATE TABLE user_held_item_counters (
        user_id TEXT PRIMARY KEY, encounters_since INTEGER NOT NULL DEFAULT 0,
        last_found_at INTEGER, last_pokemon TEXT, last_rarity TEXT, last_item TEXT
      );
    `);
    const ctx = vm.createContext({
      db,
      assertUserId: (userId) => assert.equal(typeof userId, 'string'),
      initializeEncounterCounter: db.prepare(`
        INSERT OR IGNORE INTO user_encounter_counters (user_id, source, category) VALUES (?, ?, ?)
      `),
      initializeExploreEncounterCounter: db.prepare(`
        INSERT OR IGNORE INTO user_explore_encounter_counters (user_id, category) VALUES (?, ?)
      `),
    });
    vm.runInContext(
      `${extract(dbSource, 'function recordWildEncounterCounter(', '\nfunction getNextDailyReset(')}
       globalThis.testCounters = {
         recordWildEncounterCounter, resetEncounterCounters, getEncounterCounters,
         recordHeldItemEncounterCounter, resetHeldItemEncounterCounter, getHeldItemEncounterCounter,
         recordEventSpawnCatch, getEventSpawnCatch,
       };`,
      ctx,
    );

    ctx.testCounters.recordWildEncounterCounter('trainer', 'explore');
    ctx.testCounters.recordWildEncounterCounter('trainer', 'explore');
    ctx.testCounters.recordWildEncounterCounter('trainer', 'pokemon');
    ctx.testCounters.recordWildEncounterCounter('trainer', 'fishing');
    ctx.testCounters.resetEncounterCounters('trainer', 'explore', ['golden'], 'Treecko', 123);
    const explore = ctx.testCounters.getEncounterCounters('trainer');
    assert.equal(explore.find((counter) => counter.source === 'explore' && counter.category === 'golden').encounters_since, 0);
    assert.equal(explore.find((counter) => counter.source === 'explore' && counter.category === 'golden').last_pokemon, 'Treecko');
    assert.equal(explore.find((counter) => counter.source === 'explore' && counter.category === 'shiny').encounters_since, 2);
    assert.equal(explore.find((counter) => counter.source === 'pokemon' && counter.category === 'shiny').encounters_since, 1);
    assert.equal(explore.find((counter) => counter.source === 'fishing' && counter.category === 'shiny').encounters_since, 1);
    assert.equal(explore.find((counter) => counter.source === 'fishing' && counter.category === 'golden').encounters_since, 1);
    ctx.testCounters.resetEncounterCounters('trainer', 'fishing', ['golden'], 'Magikarp', 234);
    ctx.testCounters.recordWildEncounterCounter('trainer', 'pokemon');
    let fishingGolden = ctx.testCounters.getEncounterCounters('trainer')
      .find((counter) => counter.source === 'fishing' && counter.category === 'golden');
    assert.equal(fishingGolden.encounters_since, 0);
    assert.equal(fishingGolden.last_pokemon, 'Magikarp');
    assert.equal(fishingGolden.last_caught_at, 234);
    ctx.testCounters.recordWildEncounterCounter('trainer', 'fishing');
    fishingGolden = ctx.testCounters.getEncounterCounters('trainer')
      .find((counter) => counter.source === 'fishing' && counter.category === 'golden');
    assert.equal(fishingGolden.encounters_since, 1);
    assert.equal(ctx.testCounters.getEncounterCounters('trainer')
      .find((counter) => counter.source === 'fishing' && counter.category === 'shiny').encounters_since, 2);

    ctx.testCounters.recordHeldItemEncounterCounter('trainer');
    ctx.testCounters.recordHeldItemEncounterCounter('trainer');
    ctx.testCounters.resetHeldItemEncounterCounter('trainer', 'Spearow', 'Rare', 'Nugget', 456);
    let heldItem = ctx.testCounters.getHeldItemEncounterCounter('trainer');
    assert.equal(heldItem.encounters_since, 0);
    assert.equal(heldItem.last_found_at, 456);
    assert.equal(heldItem.last_pokemon, 'Spearow');
    assert.equal(heldItem.last_item, 'Nugget');
    ctx.testCounters.recordHeldItemEncounterCounter('trainer');
    heldItem = ctx.testCounters.getHeldItemEncounterCounter('trainer');
    assert.equal(heldItem.encounters_since, 1);

    db.prepare('INSERT INTO user_event_spawn_counters (user_id, encounters_since) VALUES (?, ?)').run('trainer', 552);
    ctx.testCounters.recordWildEncounterCounter('trainer', 'pokemon');
    ctx.testCounters.recordWildEncounterCounter('trainer', 'fishing');
    assert.equal(ctx.testCounters.getEventSpawnCatch('trainer').encounters_since, 552);
    const recordCatch = extract(indexSource,
      "    if (counterSource === 'pokemon') {\n      recordEventSpawnCatch",
      '\n    const eggAbilityBoost');
    ctx.userId = 'trainer';
    ctx.isEventOpen = () => true;
    ctx.halloweenEvent = {};
    ctx.isEventChecklistSpawn = (pokemon) => pokemon.name === 'Checklist Pokémon';
    ctx.target = { name: 'Pikachu', isEventSpawn: false };
    ctx.counterSource = 'pokemon';
    vm.runInContext(recordCatch, ctx);
    assert.equal(ctx.testCounters.getEventSpawnCatch('trainer').encounters_since, 553);
    for (const source of ['fishing', 'explore', null]) {
      ctx.counterSource = source;
      vm.runInContext(recordCatch, ctx);
      assert.equal(ctx.testCounters.getEventSpawnCatch('trainer').encounters_since, 553);
    }
    ctx.target = { name: 'Event Pokémon', isEventSpawn: true };
    ctx.counterSource = 'pokemon';
    vm.runInContext(recordCatch, ctx);
    assert.equal(ctx.testCounters.getEventSpawnCatch('trainer').encounters_since, 0);
    assert.equal(ctx.testCounters.getEventSpawnCatch('trainer').last_pokemon, 'Event Pokémon');
    ctx.target = { name: 'Pikachu', isEventSpawn: false };
    vm.runInContext(recordCatch, ctx);
    assert.equal(ctx.testCounters.getEventSpawnCatch('trainer').encounters_since, 1);
    ctx.target = { name: 'Checklist Pokémon', isEventSpawn: false };
    vm.runInContext(recordCatch, ctx);
    assert.equal(ctx.testCounters.getEventSpawnCatch('trainer').encounters_since, 0);
    ctx.isEventOpen = () => false;
    vm.runInContext(recordCatch, ctx);
    assert.equal(ctx.testCounters.getEventSpawnCatch('trainer').encounters_since, 1);
  } finally {
    db.close();
  }
});

test('.co renders aligned Pokémon, Fishing, Explore, and held-item columns', async () => {
  const encounterCounters = [
    { source: 'pokemon', category: 'legendary', encounters_since: 10, last_caught_at: 100, last_pokemon: 'Mewtwo' },
    { source: 'pokemon', category: 'shiny', encounters_since: 20, last_caught_at: 200, last_pokemon: 'Pikachu' },
    { source: 'fishing', category: 'legendary', encounters_since: 30, last_caught_at: 300, last_pokemon: 'Kyogre' },
    { source: 'fishing', category: 'shiny', encounters_since: 40, last_caught_at: 400, last_pokemon: 'Magikarp' },
    { source: 'fishing', category: 'golden', encounters_since: 45, last_caught_at: 450, last_pokemon: 'Clamperl' },
    { source: 'explore', category: 'golden', encounters_since: 50, last_caught_at: 500, last_pokemon: 'Treecko' },
    { source: 'explore', category: 'shiny', encounters_since: 60, last_caught_at: 600, last_pokemon: 'Bulbasaur' },
    { source: 'explore', category: 'legendary', encounters_since: 70, last_caught_at: 700, last_pokemon: 'Mew' },
  ];
  const ctx = vm.createContext({
    command: 'co',
    userId: 'trainer',
    EmbedBuilder,
    HELD_ITEM_EMOJI: '🎒',
    EMOJIS: { eventticket: '🎟️' },
    getEncounterCounters: () => encounterCounters,
    getHeldItemEncounterCounter: () => ({
      encounters_since: 8, last_found_at: 800, last_pokemon: 'Smeargle', last_rarity: 'Rare', last_item: 'Nugget',
    }),
    getEventSpawnCatch: () => ({ encounters_since: 9, last_caught_at: 900, last_pokemon: 'Eevee' }),
    getRarityEmojis: () => '⭐',
    message: { author: { username: 'Trainer' }, reply: async (payload) => payload },
  });
  vm.runInContext(
    `async function run() {
      ${extract(indexSource, "    if (command === 'counters' || command === 'co') {", "\n    if (command === 'streak' || command === 'streaks') {")}
    }`,
    ctx,
  );
  const response = await ctx.run();
  const embed = response.embeds[0].toJSON();
  assert.equal(embed.fields.length, 3);
  assert.match(embed.description, /<:magnifyingglass:1569838771791466546> - Explore Counters/);
  assert.match(embed.description, /Event tracks Pokémon catches since the last event catch/);
  assert.match(embed.fields[0].value, /Item found/);
  assert.match(embed.fields[1].value, /8 - ⭐ Smeargle \(Nugget\)/);
  assert.match(embed.fields[0].value, /Golden spawn/);
  assert.match(embed.fields[0].value, /<:oldrod:1560319797265301534> ⭐ Golden spawn/);
  assert.match(embed.fields[1].value, /45 - ⭐ Clamperl/);
  assert.equal(embed.fields[0].value.split('\n').length, embed.fields[1].value.split('\n').length);
  assert.equal(embed.fields[1].value.split('\n').length, embed.fields[2].value.split('\n').length);
});

test('encounter counter migration preserves existing data and permits Golden fishing counters', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE user_encounter_counters (
        user_id TEXT NOT NULL, source TEXT NOT NULL CHECK (source IN ('pokemon', 'fishing')),
        category TEXT NOT NULL CHECK (category IN ('legendary', 'shiny')),
        encounters_since INTEGER NOT NULL DEFAULT 0, last_caught_at INTEGER,
        last_pokemon TEXT, last_catcher_id TEXT, PRIMARY KEY (user_id, source, category)
      );
      INSERT INTO user_encounter_counters VALUES ('trainer', 'fishing', 'shiny', 23, 123, 'Magikarp', 'trainer');
    `);
    const migration = extract(dbSource, 'const encounterCounterSql =', "\ndb.exec('DROP TABLE IF EXISTS user_event_spawn_catches')");
    vm.runInNewContext(migration, { db });
    vm.runInNewContext(migration, { db });
    assert.deepEqual(db.prepare('SELECT * FROM user_encounter_counters').get(), {
      user_id: 'trainer', source: 'fishing', category: 'shiny', encounters_since: 23,
      last_caught_at: 123, last_pokemon: 'Magikarp', last_catcher_id: 'trainer',
    });
    db.prepare("INSERT INTO user_encounter_counters (user_id, source, category) VALUES (?, 'fishing', 'golden')")
      .run('trainer');
  } finally { db.close(); }
});

test('buddy history defaults to descending EXP', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE catches (
        user_id TEXT, id INTEGER, pokemon_id INTEGER, is_shiny INTEGER, is_golden INTEGER,
        hp_iv INTEGER, atk_iv INTEGER, def_iv INTEGER, spa_iv INTEGER, spdef_iv INTEGER, spd_iv INTEGER,
        level INTEGER, experience INTEGER, ever_buddy INTEGER
      );
      INSERT INTO catches VALUES
        ('trainer', 1, 1, 0, 0, 10, 10, 10, 10, 10, 10, 100, 10, 1),
        ('trainer', 2, 2, 0, 0, 10, 10, 10, 10, 10, 10, 10, 100, 1),
        ('trainer', 3, 3, 0, 0, 10, 10, 10, 10, 10, 10, 50, 50, 1);
    `);
    const ctx = vm.createContext({
      db,
      assertUserId: (userId) => assert.equal(typeof userId, 'string'),
      getUser: () => ({ buddy_catch_id: null }),
    });
    vm.runInContext(
      `${extract(dbSource, 'function getUserBuddyHistory(', '\nfunction getUserTeam(')}
       globalThis.testBuddyHistory = getUserBuddyHistory;`,
      ctx,
    );
    assert.deepEqual([...ctx.testBuddyHistory('trainer').map((pokemon) => pokemon.experience)], [100, 50, 10]);
  } finally {
    db.close();
  }
});

test('buddy info move details are view-only while the active buddy move page keeps its commands', () => {
  const source = extract(indexSource, 'function createBuddyMovesEmbed(', '\nconst activeTradeLocks');
  const ctx = vm.createContext({
    EmbedBuilder,
    MOVES_PER_PAGE: 10,
    PREFIX: '.',
    EMOJIS: { pokecoin: '🪙' },
    getPokemonMove: (name) => ({ name, type: 'normal', power: 40, accuracy: 100 }),
    getTypeEmoji: (type) => type,
    isMaxMove: () => false,
  });
  vm.runInContext(source, ctx);
  const pokemon = { name: 'Testmon' };
  const learnset = { moves: ['tackle'], pokemon: {} };
  const viewOnly = ctx.createBuddyMovesEmbed(pokemon, learnset, [], 0, 0, true).toJSON();
  assert.match(viewOnly.description, /tackle/);
  assert.match(viewOnly.description, /View-only/);
  assert.doesNotMatch(viewOnly.description, /move replace/);

  const editable = ctx.createBuddyMovesEmbed(pokemon, learnset, [], 0, 50000).toJSON();
  assert.match(editable.description, /move replace/);
});

test('market sale history returns only the latest sale', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE market_sales (
        id INTEGER PRIMARY KEY, pokemon_id INTEGER, is_shiny INTEGER, is_golden INTEGER,
        sale_price INTEGER, quantity INTEGER, sold_at TEXT
      );
      INSERT INTO market_sales VALUES
        (1, 25, 0, 0, 100, 1, '2026-11-08'),
        (2, 25, 0, 0, 200, 2, '2026-11-09'),
        (3, 25, 0, 0, 450, 3, '2026-11-10');
    `);
      const ctx = vm.createContext({ db });
    vm.runInContext(
      `${extract(dbSource, 'function getMarketSaleHistory(', '\nfunction getUserMarketSaleSummary(')}
       globalThis.testMarketHistory = getMarketSaleHistory;`,
      ctx,
    );
    const history = ctx.testMarketHistory(25);
    assert.equal(history.sale_count, 3);
    assert.deepEqual([...history.recent], [{ sale_price: 450, quantity: 3, sold_at: '2026-11-10' }]);
  } finally {
    db.close();
  }
});

test('CatchBot reset clears only CatchBot fields for an existing user', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY, catchbot_runs INTEGER, catchbot_end INTEGER,
        coins INTEGER, total_catches INTEGER
      );
      CREATE TABLE catchbot_data (
        user_id TEXT PRIMARY KEY, spent_upgrades INTEGER, pokemon_lvl INTEGER, cost_lvl INTEGER,
        duration_lvl INTEGER, luck_lvl INTEGER, c_caught INTEGER, u_caught INTEGER,
        r_caught INTEGER, sr_caught INTEGER, l_caught INTEGER, s_caught INTEGER,
        g_caught INTEGER, golden_caught INTEGER, running_until INTEGER, hours_running INTEGER,
        completion_notified_until INTEGER
      );
      CREATE TABLE clan_members (user_id TEXT PRIMARY KEY, catches INTEGER, catchbot INTEGER);
      CREATE TABLE clan_activity_periods (user_id TEXT, catches INTEGER, catchbot INTEGER);
      INSERT INTO users VALUES ('target', 19, 123, 5000, 40), ('other', 7, 456, 9000, 80);
      INSERT INTO catchbot_data VALUES ('target', 10, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 123, 2, 123);
      INSERT INTO catchbot_data VALUES ('other', 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 456, 1, 456);
      INSERT INTO clan_members VALUES ('target', 31, 2), ('other', 41, 3);
      INSERT INTO clan_activity_periods VALUES ('target', 15, 5), ('other', 16, 6);
    `);
    const ctx = vm.createContext({ db, assertUserId: (id) => assert.equal(typeof id, 'string') });
    vm.runInContext(
      extract(dbSource, 'function resetCatchbotData(', '\nconst questTemplatesPath ='),
      ctx,
    );

    assert.equal(ctx.resetCatchbotData('target'), true);
    assert.deepEqual(db.prepare('SELECT * FROM users WHERE id = ?').get('target'), {
      id: 'target', catchbot_runs: 0, catchbot_end: 0, coins: 5000, total_catches: 40,
    });
    assert.deepEqual(db.prepare('SELECT * FROM catchbot_data WHERE user_id = ?').get('target'), {
      user_id: 'target', spent_upgrades: 0, pokemon_lvl: 0, cost_lvl: 0, duration_lvl: 0,
      luck_lvl: 0, c_caught: 0, u_caught: 0, r_caught: 0, sr_caught: 0, l_caught: 0,
      s_caught: 0, g_caught: 0, golden_caught: 0, running_until: 0, hours_running: 0,
      completion_notified_until: 0,
    });
    assert.deepEqual(db.prepare('SELECT * FROM clan_members WHERE user_id = ?').get('target'), {
      user_id: 'target', catches: 31, catchbot: 0,
    });
    assert.deepEqual(db.prepare('SELECT * FROM clan_activity_periods WHERE user_id = ?').get('target'), {
      user_id: 'target', catches: 15, catchbot: 0,
    });
    assert.equal(ctx.resetCatchbotData('missing'), false);
    assert.deepEqual(db.prepare('SELECT * FROM users WHERE id = ?').get('other'), {
      id: 'other', catchbot_runs: 7, catchbot_end: 456, coins: 9000, total_catches: 80,
    });
  } finally {
    db.close();
  }
});

test('server-wide channel boosts stay capped in the designated server and stack elsewhere', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE channel_catch_rate_boosts (
      user_id TEXT NOT NULL, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL,
      PRIMARY KEY (user_id, guild_id, channel_id)
    )`);
    const server = '1560102297198006274';
    const otherBoostedServer = '1565161395496943709';
    db.prepare('INSERT INTO channel_catch_rate_boosts (user_id, guild_id, channel_id) VALUES (?, ?, ?)')
      .run('owner', server, 'existing-channel');
    const ctx = vm.createContext({ db, assertUserId: (id) => assert.ok(id) });
    vm.runInContext(extract(dbSource, 'const GUILD_CHANNEL_CATCH_RATE_BOOSTS =', '\nfunction getPokemonFormBySlug('), ctx);
    for (const channel of ['existing-channel', 'new-channel']) {
      assert.equal(ctx.getChannelCatchRateBoost('user', server, channel), 5);
      assert.equal(ctx.getChannelCatchRateBoost('another-user', server, channel), 5);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM channel_catch_rate_boosts WHERE guild_id = ?').get(server).count, 0);
    assert.equal(ctx.addChannelCatchRateBoost('owner', server, 'new-channel'), 'already');
    assert.equal(ctx.getChannelCatchRateBoost('another-user', server, 'new-channel'), 5);
    assert.equal(ctx.getChannelCatchRateBoost('user', otherBoostedServer, 'channel'), 5);
    assert.equal(ctx.getChannelCatchRateBoost('user', 'other-server', 'channel'), 0);
    assert.equal(ctx.addChannelCatchRateBoost('owner', otherBoostedServer, 'channel'), 'added');
    assert.equal(ctx.getChannelCatchRateBoost('another-user', otherBoostedServer, 'channel'), 10);
    assert.equal(ctx.setChannelCatchRateBoost('owner', otherBoostedServer, 'channel', false), true);
    assert.equal(ctx.getChannelCatchRateBoost('user', otherBoostedServer, 'channel'), 5);

    const rateCtx = vm.createContext({
      Math: Object.assign(Object.create(Math), { random: () => 1.02 / 167 }),
      LEGENDARY_BASE_CHANCE: 1 / 167, LEGENDARY_GOLDEN_RAZZ_CHANCE: 1 / 125,
      HARD_RARITY_USER_IDS: new Set(), HARD_RARITY_RATE_MULTIPLIER: 1,
      ENCOUNTER_RARITY_WEIGHTS: { normal: { Common: 1 } },
    });
    vm.runInContext(extract(indexSource, 'function getChanceFromFlooredOdds(', '\nconst EVENT_SPAWN_ODDS') + '\n'
      + extract(indexSource, 'function chooseEncounterRarity(', '\nfunction getRandomLegendaryFromGenerations('), rateCtx);
    vm.runInContext(extract(indexSource, 'function getCatchChance(', '\nfunction getCatchCoinReward('), rateCtx);
    const boost = ctx.getChannelCatchRateBoost('user', server, 'new-channel');
    assert.equal(rateCtx.getCatchChance(50, 0, 0, boost), 55);
    assert.equal(rateCtx.chooseEncounterRarity('normal', false, boost), 'Legendary');
    assert.equal(rateCtx.chooseEncounterRarity('normal', false, 0), 'Common');
  } finally {
    db.close();
  }
});

test('channel boost command shows the current automatic boost separately from manual channels', async () => {
  const source = extract(indexSource, "    if (command === 'channel') {", "\n    if (command === 'rarespawn')");
  const ctx = vm.createContext({
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType,
    client: { guilds: { cache: new Map() } },
    getBoostedChannels: () => [],
    getMessageChannelCatchRateBoost: (_userId, message) => message.guildId === '1560102297198006274' || !message.guildId ? 5 : 0,
    UNLIMITED_CHANNEL_BOOSTER_IDS: new Set(),
  });
  vm.runInContext(`async function run(message, args) {
    const command = 'channel'; const userId = 'user'; ${source}
  }`, ctx);
  let payload;
  const message = {
    guildId: '1560102297198006274', channelId: 'channel',
    author: { username: 'Trainer' }, reply: async (value) => { payload = value; return {}; },
  };
  await ctx.run(message, ['boost']);
  let embed = payload.embeds[0].toJSON();
  assert.match(embed.description, /not manually boosted/);
  assert.match(embed.fields.find((field) => field.name === 'Current channel').value, /\+5 percentage points.*\+5% relative.*server-wide/);
  message.guildId = 'other-server';
  await ctx.run(message, ['boost']);
  embed = payload.embeds[0].toJSON();
  assert.match(embed.fields.find((field) => field.name === 'Current channel').value, /No channel or server-wide/);
  message.guildId = null;
  await ctx.run(message, ['boost']);
  const dmField = payload.embeds[0].toJSON().fields.find((field) => field.name === 'Your DM channel');
  assert.match(dmField.value, /\+5 percentage points.*\+5% relative.*in this DM/);
});

test('DMs get the automatic Legendary+ rate boost and a private incense scope', () => {
  const ctx = vm.createContext({
    PATREON_TIER_ORDER: ['common', 'uncommon', 'rare', 'superRare', 'legendary', 'shiny', 'golden'],
    getUser: (userId) => ({ patreon_tier: userId === 'legendary' ? 'legendary' : 'rare' }),
    getChannelCatchRateBoost: (userId, guildId, channelId) =>
      guildId === '@me' && channelId === 'dm-channel' ? 2 : 0,
  });
  vm.runInContext(
    extract(indexSource, 'const DIRECT_MESSAGE_CHANNEL_GUILD_ID =', '\nconst WORLD_BOSS_SPAWN_ALLOWED_USER_IDS'),
    ctx
  );
  assert.equal(ctx.getMessageChannelCatchRateBoost('legendary', { guildId: null, channelId: 'dm-channel' }), 7);
  assert.equal(ctx.getMessageChannelCatchRateBoost('rare', { guildId: null, channelId: 'dm-channel' }), 2);
  assert.equal(ctx.getMessageChannelCatchRateBoost('legendary', { guildId: 'server', channelId: 'dm-channel' }), 0);
  assert.equal(ctx.getMessageIncenseScope({ guildId: 'server', author: { id: 'alice' } }), 'server');
  assert.equal(ctx.getMessageIncenseScope({ guildId: null, author: { id: 'alice' } }), 'dm:alice');
});

test('incense can be activated with charges scoped to the invoking DM', async () => {
  const start = indexSource.indexOf("    if (command === 'incense' || command === 'inc') {");
  const end = indexSource.indexOf("\n\n    if (command === 'doublexp'", start);
  assert.ok(start >= 0 && end > start);
  const changes = [];
  const context = vm.createContext({
    command: 'inc', args: ['2'], userId: 'alice', BASE_INCENSE_CHARGES: 100,
    EMOJIS: { incense: ':incense:' }, PREFIX: '.',
    PATREON_TIER_ORDER: ['common', 'uncommon', 'rare', 'superRare', 'legendary', 'shiny', 'golden'],
    getPatreonPerks: () => ({ incenseBonus: 0 }), parseAmount: Number,
    db: { transaction: (callback) => callback },
    getUserItems: () => [{ item_name: 'Incense', amount: 2 }],
    takeUserItem: () => true,
    addIncenseCharges: (...args) => changes.push(['charges', ...args]),
    recordIncenseContribution: (...args) => changes.push(['contribution', ...args]),
    getIncenseCharges: () => 200,
    message: {
      guildId: null, guild: null, channelId: 'dm-channel', author: { id: 'alice' },
      reply: async (content) => content,
    },
  });
  const scopeHelpers = extract(
    indexSource,
    'const DIRECT_MESSAGE_CHANNEL_GUILD_ID =',
    '\nconst WORLD_BOSS_SPAWN_ALLOWED_USER_IDS'
  );
  vm.runInContext(
    `${scopeHelpers}\nasync function run() { ${indexSource.slice(start, end)} }`,
    context
  );
  const reply = await context.run();
  assert.deepEqual(changes, [
    ['charges', 'dm:alice', 200],
    ['contribution', 'dm:alice', 'alice', 2, 200],
  ]);
  assert.match(reply, /Your DM channel now has \*\*200\*\* charges/);
});

test('DM battles and Egg hatches consume incense from the private DM scope', async () => {
  const consumeScopes = [];
  const context = vm.createContext({
    getActivePromos: () => [{ drops: { egg: {} } }],
    consumeIncenseCharge: (scope) => { consumeScopes.push(scope); return true; },
    getPromoChanceMultiplier: (_userId, incenseActive) => (incenseActive ? 1.1 : 1),
    rollPromoItemDrop: () => false,
    console: { error: (...args) => { throw new Error(args.join(' ')); } },
  });
  const scopeHelpers = extract(
    indexSource,
    'const DIRECT_MESSAGE_CHANNEL_GUILD_ID =',
    '\nconst WORLD_BOSS_SPAWN_ALLOWED_USER_IDS'
  );
  const promoDrops = extract(
    indexSource,
    'async function rollActivityPromoDrops(',
    '\nasync function announcePromoClaim('
  );
  vm.runInContext(`${scopeHelpers}\n${promoDrops}`, context);
  await context.rollActivityPromoDrops({ id: 'alice' }, null, {}, 'egg');
  assert.deepEqual(consumeScopes, ['dm:alice']);
});

test('claiming a promo Golden Pokémon records it as seen', () => {
  const seen = [];
  const form = {
    id: 123, name: 'Promo Pokémon', species_name: 'Promo Pokémon', base_hp: 50,
    base_atk: 50, base_def: 50, base_spd: 50,
  };
  const ctx = vm.createContext({
    userId: 'trainer',
    promo: { costCoins: 500, costItems: 2, itemName: 'Promo Token', speciesId: 123 },
    getUser: () => ({ coins: 1000 }),
    db: {
      prepare: (sql) => ({
        get: () => sql.includes('user_items') ? { amount: 2 } : form,
      }),
      transaction: (callback) => ({ immediate: callback }),
    },
    incrementUser: () => {},
    takeUserItem: () => true,
    saveGoldenCatch: () => {},
    recordPokemonSeen: (...args) => seen.push(args),
  });
  const claimHelper = extract(
    indexSource,
    '      const promoItemCount =',
    '\n      const buildClaimEmbed ='
  );
  const result = vm.runInContext(`${claimHelper}\nclaimPromo(promo)`, ctx);

  assert.equal(result.form, form);
  assert.deepEqual(seen, [['trainer', 123, false, true]]);
});

test('promo scheduling respects its start and end timestamps', () => {
  const ctx = vm.createContext({ Date });
  vm.runInContext(extract(promoSource, 'function isPromoActive(', '\n// Reads promo.json'), ctx);
  const promo = {
    startsAt: '2026-11-24T05:00:00.000Z',
    endsAt: '2026-11-29T05:00:00.000Z',
  };
  assert.equal(ctx.isPromoActive(promo, Date.parse('2026-11-24T04:59:59.999Z')), false);
  assert.equal(ctx.isPromoActive(promo, Date.parse('2026-11-24T05:00:00.000Z')), true);
  assert.equal(ctx.isPromoActive(promo, Date.parse('2026-11-29T04:59:59.999Z')), true);
  assert.equal(ctx.isPromoActive(promo, Date.parse('2026-11-29T05:00:00.000Z')), false);
});

function battleContext() {
  const player = mon('Attacker', ['psychic']);
  const enemy = mon('Defender', ['ghost']);
  return {
    field: battle.createField(), log: [], player, enemy, turn: 0,
    calc: () => 10,
    typeEff: (type, types) => type === 'normal' && types.includes('ghost') ? 0 : 1,
    typeChart: {}, party: { player: [player], enemy: [enemy] },
  };
}

test('Corrosion bypasses poison-type immunities but not other protections', () => {
  const ctx = battleContext();
  const player = { mon: ctx.player, side: 'player' };
  const enemy = { mon: ctx.enemy, side: 'enemy' };
  const toxic = { name: 'Toxic', type: 'poison', power: 0, category: 'status', accuracy: 100 };
  const use = () => battle.performMove(ctx, player, enemy, toxic, () => {});
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    for (const type of ['steel', 'poison']) {
      ctx.enemy.types = [type];
      ctx.player.ability = null;
      use();
      assert.equal(battle.fx(ctx.enemy).status, null);
      ctx.player.ability = 'Corrosion';
      use();
      assert.equal(battle.fx(ctx.enemy).status, 'tox');
      battle.cureStatus(ctx.enemy);
    }
    ctx.enemy.ability = 'Immunity';
    use();
    assert.equal(battle.fx(ctx.enemy).status, null);
    ctx.enemy.ability = null;
    ctx.field.sides.enemy.safeguard = 2;
    use();
    assert.equal(battle.fx(ctx.enemy).status, null);
    ctx.field.sides.enemy.safeguard = 0;
    battle.fx(ctx.enemy).sub = 10;
    use();
    assert.equal(battle.fx(ctx.enemy).status, null);
    battle.fx(ctx.enemy).sub = 0;
    ctx.player.ability = null;
    use();
    assert.equal(battle.fx(ctx.enemy).status, null);
  } finally { Math.random = originalRandom; }
});

test('Focus Energy stacks critical stages, respects abilities, and passes or clears on switching', () => {
  const ctx = battleContext();
  const player = { mon: ctx.player, side: 'player' };
  const enemy = { mon: ctx.enemy, side: 'enemy' };
  const focus = { name: 'Focus Energy', power: 0, category: 'status' };
  const attack = { name: 'Tackle', type: 'normal', power: 40, category: 'physical', accuracy: 100 };
  const use = () => battle.performMove(ctx, player, enemy, focus, () => {});
  use();
  assert.equal(battle.fx(ctx.player).focus, 2);
  assert.equal(battle.abilities.critChance(ctx.player, ctx.enemy, 0.0625, 2), 0.5);
  ctx.player.ability = 'Super Luck';
  assert.equal(battle.abilities.critChance(ctx.player, ctx.enemy, 0.0625, 2), 1);
  ctx.enemy.ability = 'Battle Armor';
  assert.equal(battle.abilities.critChance(ctx.player, ctx.enemy, 0.0625, 2), 0);
  ctx.enemy.ability = null;
  use();
  use();
  assert.equal(battle.fx(ctx.player).focus, 4);
  assert.match(battle.summarize(ctx.player), /CRIT \+4/);
  assert.equal(battle.abilities.critChance(ctx.player, ctx.enemy, 0.0625, 4), 1);
  ctx.enemy.types = ['normal'];
  const originalRandom = Math.random;
  Math.random = () => 0.9;
  try {
    battle.performMove(ctx, player, enemy, attack, () => {});
    assert.equal(ctx.enemy.hp, 85);
    ctx.enemy.ability = 'Shell Armor';
    battle.performMove(ctx, player, enemy, attack, () => {});
    assert.equal(ctx.enemy.hp, 75);
  } finally { Math.random = originalRandom; }
  const passed = battle.takeBatonState(ctx.player);
  const bench = mon('Bench', ['normal']);
  battle.onSwitchOut(ctx, ctx.player, 'player');
  battle.giveBatonState(bench, passed);
  assert.equal(battle.fx(ctx.player).focus, 0);
  assert.equal(battle.fx(bench).focus, 4);
  battle.onSwitchOut(ctx, bench, 'player');
  assert.equal(battle.fx(bench).focus, 0);
});

test('coin moves scatter on successful hits and pay once on collection', () => {
  const ctx = battleContext();
  ctx.enemy.types = ['normal'];
  const player = { mon: ctx.player, side: 'player' };
  const enemy = { mon: ctx.enemy, side: 'enemy' };
  const move = (name, type = 'normal', accuracy = 100) => ({ name, type, power: 40, category: 'physical', accuracy });
  const use = (m, a = player, b = enemy) => battle.performMove(ctx, a, b, m, () => {});
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    use(move('Pay Day'));
    use(move('Make It Rain', 'steel'));
    use(move('Pay Day'), enemy, player);
    assert.equal(ctx.field.scatteredCoins, 750);
    battle.fx(ctx.enemy).protect = 'protect';
    use(move('Pay Day'));
    battle.fx(ctx.enemy).protect = null;
    battle.fx(ctx.enemy).sub = 20;
    use(move('Pay Day'));
    battle.fx(ctx.enemy).sub = 0;
    ctx.enemy.types = ['ghost'];
    use(move('Pay Day'));
    ctx.enemy.types = ['normal'];
    use(move('Pay Day', 'normal', 1));
    ctx.worldBoss = true;
    use(move('Pay Day'));
    assert.equal(ctx.field.scatteredCoins, 750);

    ctx.player.held_item = 'Luck Incense';
    battle.onSwitchIn(ctx, ctx.player, 'player', () => {});
    let paid = 0;
    const vmCtx = vm.createContext({
      EMOJIS: { pokecoin: '$' },
      awardCoinsWithBoost: (_id, amount) => { paid += amount; return { finalAmount: amount }; },
    });
    vm.runInContext(extract(indexSource, 'function collectScatteredBattleCoins(', '\nasync function runPlayerSpar('), vmCtx);
    assert.match(vmCtx.collectScatteredBattleCoins('user', ctx.field, ctx.log), /1,500/);
    assert.equal(vmCtx.collectScatteredBattleCoins('user', ctx.field, ctx.log), '');
    assert.equal(paid, 1500);
  } finally { Math.random = originalRandom; }
});

test('Insomnia and Own Tempo prevent and cure their conditions when gained', () => {
  const ctx = battleContext();
  const player = { mon: ctx.player, side: 'player' };
  const enemy = { mon: ctx.enemy, side: 'enemy' };
  const use = (name, a = player, b = enemy) =>
    battle.performMove(ctx, a, b, { name, power: 0, category: 'status', accuracy: 100 }, () => {});
  ctx.enemy.ability = 'Insomnia';
  use('Hypnosis');
  assert.equal(battle.fx(ctx.enemy).status, null);
  ctx.enemy.hp = 50;
  use('Rest', enemy, player);
  assert.equal(ctx.enemy.hp, 50);
  assert.equal(battle.fx(ctx.enemy).status, null);
  ctx.player.ability = 'Pressure';
  battle.fx(ctx.player).status = 'slp';
  battle.fx(ctx.player).sleep = 2;
  use('Skill Swap', enemy, player);
  assert.equal(ctx.player.ability, 'Insomnia');
  assert.equal(battle.fx(ctx.player).status, null);

  ctx.player.ability = 'Own Tempo';
  ctx.enemy.ability = 'Pressure';
  battle.fx(ctx.enemy).confuse = 3;
  use('Skill Swap');
  assert.equal(battle.fx(ctx.enemy).confuse, 0);
  use('Confuse Ray');
  assert.equal(battle.fx(ctx.enemy).confuse, 0);
  ctx.player.gender = 'male';
  ctx.enemy.gender = 'female';
  use('Attract');
  assert.equal(battle.fx(ctx.enemy).attract, ctx.player);
  battle.abilities.entry(ctx, { mon: { ...ctx.player, ability: 'Intimidate' }, side: 'player' }, enemy, () => {});
  assert.equal(battle.fx(ctx.enemy).stages.atk, 0);
});

test('Skill Swap activates gained abilities and restores each original ability on switching', () => {
  const ctx = battleContext();
  ctx.player.ability = 'Pressure';
  ctx.enemy.ability = 'Intimidate';
  battle.performMove(ctx, { mon: ctx.player, side: 'player' }, { mon: ctx.enemy, side: 'enemy' },
    { name: 'Skill Swap', power: 0, category: 'status' }, () => {});
  assert.equal(ctx.player.ability, 'Intimidate');
  assert.equal(ctx.enemy.ability, 'Pressure');
  assert.equal(battle.fx(ctx.enemy).stages.atk, -1);
  battle.onSwitchOut(ctx, ctx.player, 'player');
  assert.equal(ctx.player.ability, 'Pressure');
  assert.equal(ctx.enemy.ability, 'Pressure');
  battle.onSwitchOut(ctx, ctx.enemy, 'enemy');
  assert.equal(ctx.enemy.ability, 'Intimidate');
});

test('Stench gives eligible damaging hits a non-stacking flinch chance', () => {
  const ctx = battleContext();
  ctx.player.ability = 'Stench';
  const move = { name: 'Tackle', type: 'normal', power: 40, category: 'physical', accuracy: 100 };
  ctx.enemy.types = ['normal'];
  const originalRandom = Math.random;
  Math.random = () => 0.09;
  try {
    battle.performMove(ctx, { mon: ctx.player, side: 'player' }, { mon: ctx.enemy, side: 'enemy' }, move, () => {});
    assert.equal(battle.fx(ctx.enemy).flinch, true);
    battle.fx(ctx.enemy).flinch = false;
    ctx.enemy.ability = 'Shield Dust';
    battle.performMove(ctx, { mon: ctx.player, side: 'player' }, { mon: ctx.enemy, side: 'enemy' }, move, () => {});
    assert.equal(battle.fx(ctx.enemy).flinch, false);
    ctx.enemy.ability = null;
    ctx.player.held_item = "King's Rock";
    let rolls = 0;
    Math.random = () => { rolls += 1; return 0.5; };
    battle.applyFlinchEffect(ctx.player, ctx.enemy, move, 1, () => {});
    assert.equal(rolls, 1);
    rolls = 0;
    battle.applyFlinchEffect(ctx.player, ctx.enemy, { ...move, name: 'Rock Slide' }, 1, () => {});
    assert.equal(rolls, 1);
    assert.equal(battle.fx(ctx.enemy).flinch, false);
    Math.random = () => 0.2;
    battle.applyFlinchEffect(ctx.player, ctx.enemy, { ...move, name: 'Rock Slide' }, 1, () => {});
    assert.equal(battle.fx(ctx.enemy).flinch, true);
  } finally { Math.random = originalRandom; }
});

test('Geomancy charges, locks the next action, and respects interruption and Power Herb', () => {
  const ctx = battleContext();
  const geomancy = { name: 'Geomancy', type: 'fairy', power: 0, category: 'status' };
  const coil = { name: 'Coil', type: 'poison', power: 0, category: 'status' };
  const player = { mon: ctx.player, side: 'player', move: geomancy };
  const enemy = { mon: ctx.enemy, side: 'enemy', move: coil };
  battle.runAction(ctx, player, enemy);
  assert.equal(battle.fx(ctx.player).stages.spa, 0);
  assert.equal(battle.fx(ctx.player).chargingMove, geomancy);
  battle.runAction(ctx, { ...player, move: coil }, enemy);
  assert.deepEqual([battle.fx(ctx.player).stages.spa, battle.fx(ctx.player).stages.spdef,
    battle.fx(ctx.player).stages.spe, battle.fx(ctx.player).stages.atk], [2, 2, 2, 0]);
  battle.runAction(ctx, player, enemy);
  battle.fx(ctx.player).flinch = true;
  battle.runAction(ctx, player, enemy);
  assert.equal(battle.fx(ctx.player).chargingMove, null);
  ctx.player.held_item = 'Power Herb';
  battle.runAction(ctx, player, enemy);
  assert.equal(battle.fx(ctx.player).stages.spa, 4);
  battle.runAction(ctx, player, enemy);
  assert.equal(battle.fx(ctx.player).stages.spa, 4);
  assert.equal(battle.fx(ctx.player).chargingMove, geomancy);
});

test('Octolock traps its target and ends with its source while respecting stat-drop immunity', () => {
  const ctx = battleContext();
  ctx.enemy.types = ['normal'];
  const use = () => battle.performMove(ctx, { mon: ctx.player, side: 'player' }, { mon: ctx.enemy, side: 'enemy' },
    { name: 'Octolock', power: 0, category: 'status', accuracy: 100 }, () => {});
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    ctx.enemy.ability = 'Clear Body';
    use();
    assert.equal(battle.isOctolocked(ctx.enemy, ctx.player), true);
    battle.endOfTurn(ctx);
    assert.equal(battle.fx(ctx.enemy).stages.def, 0);
    ctx.enemy.ability = null;
    battle.endOfTurn(ctx);
    assert.equal(battle.fx(ctx.enemy).stages.spdef, -1);
    battle.onSwitchOut(ctx, ctx.player, 'player');
    assert.equal(battle.isOctolocked(ctx.enemy, ctx.player), false);
    battle.endOfTurn(ctx);
    assert.equal(battle.fx(ctx.enemy).stages.spdef, -1);
    battle.fx(ctx.enemy).sub = 10;
    use();
    assert.equal(battle.fx(ctx.enemy).octolock, null);
    battle.fx(ctx.enemy).sub = 0;
    ctx.enemy.types = ['ghost'];
    use();
    assert.equal(battle.fx(ctx.enemy).octolock, null);
  } finally { Math.random = originalRandom; }
});

test('Baton Pass switches before the slower foe acts and passes effects before entry abilities', () => {
  const ctx = battleContext();
  const bench = mon('Bench', ['normal']);
  bench.ability = 'Intrepid Sword';
  ctx.party.player.push(bench);
  ctx.player.spd = 100;
  ctx.enemy.spd = 10;
  ctx.enemy.types = ['normal'];
  battle.fx(ctx.player).stages.atk = 2;
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    battle.runTurn(ctx, { name: 'Baton Pass', power: 0, category: 'status' },
      { name: 'Tackle', type: 'normal', power: 40, category: 'physical', accuracy: 100 });
    assert.equal(ctx.player.hp, 100);
    const state = battle.takeBatonState(ctx.player);
    battle.onSwitchOut(ctx, ctx.player, 'player');
    ctx.player = bench;
    battle.giveBatonState(bench, state);
    battle.onSwitchIn(ctx, bench, 'player', () => {});
    battle.resumeBatonTurn(ctx);
    assert.equal(bench.hp, 90);
    assert.equal(battle.fx(bench).stages.atk, 3);
    assert.equal(ctx.field.pendingBatonTurn, null);
  } finally { Math.random = originalRandom; }
});

test('World Boss damage uses accuracy stages and Skill Swap reports an ability-free boss', () => {
  const math = Object.create(Math);
  math.random = () => 0.75;
  const move = { name: 'Tackle', type: 'normal', power: 40, category: 'physical', accuracy: 60 };
  const boss = { id: 42, name: 'Boss' };
  const pokemon = { ...mon('Raider', ['normal']), id: 1, team_slot: 1 };
  let hits = 0;
  const ctx = vm.createContext({
    Math: math, battleFx: battle, WORLD_BOSS_POOL: [{ id: 1, name: 'Boss', baseHp: 50, baseAtk: 50, baseDef: 50, baseSpd: 50 }],
    WORLD_BOSS_DUMMY_HP: 1600, WORLD_BOSS_PLAYER_DAMAGE_MULTIPLIER: 0.25, EMOJIS: {},
    db: { prepare: () => ({ get: () => ({ types: '["normal"]' }) }) },
    createBattleField: battle.createField, combatStats: () => ({}),
    getWorldBossTeamMoves: (team) => team.map((entry) => ({ pokemon: entry, teamIndex: 0, types: ['normal'], moves: [move] })),
    getHeldItemMoveType: (_name, type) => type, isPlateItem: () => false,
    getHeldItemDamageMultiplier: () => 1, typeEffectiveness: () => 1,
    CHOICE_ATTACK_ITEMS: new Set(), CHOICE_SPECIAL_ATTACK_ITEMS: new Set(),
    applyWorldBossDamage: (_userId, _bossId, damage) => { hits += 1; return { damage, defeated: false, boss }; },
  });
  vm.runInContext(extract(indexSource, 'function getWorldBossBattle(', '\nconst WORLD_BOSS_PROGRESS_INTERVAL_MS'), ctx);
  const state = { pokemon, hp: 100, types: ['normal'], moves: [move], teamStates: new Map() };
  const bs = ctx.getWorldBossBattle(state, boss);
  const fight = { ...battleContext(), worldBoss: true, player: bs.mon, enemy: bs.boss, field: bs.field };
  assert.equal(ctx.runWorldBossMove('user', [pokemon], boss, 0, 0, 1, bs.mon, bs.boss, fight).damage, 0);
  assert.equal(hits, 0);
  battle.performMove(fight, { mon: bs.mon, side: 'player' }, { mon: bs.boss, side: 'enemy' },
    { name: 'Coil', power: 0, category: 'status' }, () => {});
  assert.ok(ctx.runWorldBossMove('user', [pokemon], boss, 0, 0, 1, bs.mon, bs.boss, fight).damage > 0);
  assert.equal(hits, 1);
  battle.performMove(fight, { mon: bs.mon, side: 'player' }, { mon: bs.boss, side: 'enemy' },
    { name: 'Focus Energy', power: 0, category: 'status' }, () => {});
  assert.doesNotMatch(ctx.runWorldBossMove('user', [pokemon], boss, 0, 0, 1, bs.mon, bs.boss, fight).battleLog[0], /CRITICAL/);
  battle.performMove(fight, { mon: bs.mon, side: 'player' }, { mon: bs.boss, side: 'enemy' },
    { name: 'Focus Energy', power: 0, category: 'status' }, () => {});
  assert.match(ctx.runWorldBossMove('user', [pokemon], boss, 0, 0, 1, bs.mon, bs.boss, fight).battleLog[0], /CRITICAL/);
  bs.boss.ability = 'Battle Armor';
  assert.doesNotMatch(ctx.runWorldBossMove('user', [pokemon], boss, 0, 0, 1, bs.mon, bs.boss, fight).battleLog[0], /CRITICAL/);
  bs.boss.ability = null;
  bs.mon.ability = 'Insomnia';
  const logs = [];
  battle.performMove(fight, { mon: bs.mon, side: 'player' }, { mon: bs.boss, side: 'enemy' },
    { name: 'Skill Swap', power: 0, category: 'status' }, (text) => logs.push(text));
  assert.match(logs.at(-1), /World Boss has no ability/);
  assert.equal(bs.mon.ability, 'Insomnia');
});

test('World Boss battles carry perfect special IVs and apply them to special damage', () => {
  const math = Object.create(Math);
  math.random = () => 0.75;
  const move = { name: 'Swift', type: 'normal', power: 60, category: 'special' };
  const boss = { id: 42, name: 'Boss' };
  const pokemon = { ...mon('Raider', ['normal']), id: 1, level: 100, atk: 110,
    ev_spa: 200, ev_spdef: 200, spa_iv: 31, spdef_iv: 31 };
  const ctx = vm.createContext({
    Math: math, battleFx: battle, WORLD_BOSS_POOL: [{ id: 1, name: 'Boss', baseHp: 50, baseAtk: 50, baseDef: 50, baseSpd: 50 }],
    WORLD_BOSS_DUMMY_HP: 1600, WORLD_BOSS_PLAYER_DAMAGE_MULTIPLIER: 0.25,
    db: { prepare: () => ({ get: () => ({ types: '["normal"]' }) }) },
    createBattleField: battle.createField, combatStats: () => ({}),
    getWorldBossTeamMoves: (team) => team.map((entry) => ({ pokemon: entry, teamIndex: 0, types: ['normal'], moves: [move] })),
    getHeldItemMoveType: (_name, type) => type, isPlateItem: () => false,
    getHeldItemDamageMultiplier: () => 1, typeEffectiveness: () => 1,
    CHOICE_ATTACK_ITEMS: new Set(), CHOICE_SPECIAL_ATTACK_ITEMS: new Set(),
    applyWorldBossDamage: (_userId, _bossId, damage) => ({ damage, defeated: false, boss }),
  });
  vm.runInContext(extract(indexSource, 'function getWorldBossBattle(', '\nconst WORLD_BOSS_PROGRESS_INTERVAL_MS'), ctx);
  const bs = ctx.getWorldBossBattle({ pokemon, hp: 100, types: ['normal'], moves: [move] }, boss);
  assert.equal(bs.mon.spa_iv, 31);
  assert.equal(bs.mon.spdef_iv, 31);
  const boosted = ctx.runWorldBossMove('user', [pokemon], boss, 0, 0).damage;
  pokemon.spa_iv = 30;
  const unboosted = ctx.runWorldBossMove('user', [pokemon], boss, 0, 0).damage;
  assert.ok(boosted > unboosted);
});

test('World Boss Baton Pass resumes the counterattack against the selected replacement', async () => {
  const source = extract(indexSource, "      if (action === 'choose') {", '\n      const pokemonId = Number(parts[3]);');
  const old = { ...mon('Old', ['normal']), id: 1, team_slot: 1 };
  const next = { ...mon('Next', ['normal']), id: 2, team_slot: 2, ability: 'Intrepid Sword' };
  const bossMon = mon('Boss', ['normal']);
  const switchedBoss = mon('Boss', ['normal']);
  const field = battle.createField();
  const oldBattle = { mon: old, boss: bossMon, field, turn: 1 };
  battle.fx(old).stages.atk = 2;
  battle.fx(old).octolock = { source: bossMon };
  const teamStates = new Map();
  const playerState = { pokemon: old, hp: 100, battle: oldBattle, batonPass: true, teamStates };
  const players = new Map([['user', playerState]]);
  const events = [];
  const interaction = {
    user: { id: 'user' }, message: { id: 'panel' },
    deferUpdate: async () => events.push('deferred'),
    editReply: async (payload) => events.push(payload),
  };
  const ctx = vm.createContext({
    action: 'choose', parts: ['worldboss', 'choose', '42', '2'], playerTeam: [old, next],
    playerState, playerId: 'user', teamStatesByPlayer: new Map([['user', teamStates]]),
    faintedTeam: new Set(), players, battleFx: battle, boss: { id: 42 }, currentBoss: { name: 'Boss' },
    bossMessage: { id: 'post' }, interaction, PREFIX: '.',
    isWorldBossTeamFainted: () => false,
    getWorldBossTeamMoves: (team) => team.map((pokemon) => ({ types: pokemon.types, moves: [{ name: 'Tackle' }] })),
    attachBattleAbilities: async () => {},
    getWorldBossBattle: (state) => {
      state.battle = { mon: state.pokemon, boss: switchedBoss, field, turn: 1 };
      return state.battle;
    },
    worldBossCtx: (bs, log) => ({ ...battleContext(), player: bs.mon, enemy: bs.boss, field: bs.field, log }),
    runWorldBossCounterattack: (bs, state, _boss, attack) => {
      events.push('counterattack');
      assert.equal(bs.mon, next);
      assert.equal(battle.fx(next).stages.atk, 3);
      assert.equal(battle.isOctolocked(next, switchedBoss), true);
      state.hp -= 10;
      attack.battleLog.push('Counterattack!');
    },
    createWorldBossPanelEmbed: (_boss, details) => details,
    createWorldBossPlayerMoveRows: () => [], createWorldBossSwitchRows: () => [],
    createWorldBossForfeitRow: () => [], createWorldBossPlayerSelectRows: () => [],
  });
  vm.runInContext(`async function run() { ${source} }`, ctx);
  await ctx.run();
  assert.equal(events[0], 'deferred');
  assert.equal(events[1], 'counterattack');
  assert.match(events[2].embeds[0].log.at(-1), /Counterattack/);
  assert.equal(players.get('user').hp, 90);
});

test('World Boss counterattack respects evasion and Miracle Eye', () => {
  const math = Object.create(Math);
  math.random = () => 0.2;
  const player = mon('Raider', ['normal']);
  const bossMon = mon('Boss', ['normal']);
  const move = { name: 'Tackle', type: 'normal', power: 40, category: 'physical', accuracy: 100 };
  bossMon.moves = [move];
  const bs = { mon: player, boss: bossMon, field: battle.createField(), turn: 1 };
  const playerState = { hp: 100 };
  const boss = { id: 42, name: 'Boss' };
  battle.fx(player).stages.eva = 6;
  const ctx = vm.createContext({
    Math: math, battleFx: battle, WORLD_BOSS_POOL: [{ id: 1, name: 'Boss' }],
    WORLD_BOSS_COUNTER_DAMAGE_MULTIPLIER: 1, WORLD_BOSS_CHIP_PER_HP: 1,
    db: { prepare: () => ({ get: () => ({ species_id: 1 }) }) },
    worldBossCtx: (_bs, log) => ({ ...battleContext(), player, enemy: bossMon, field: bs.field, log }),
    chooseEnemyMove: () => move, typeEffectiveness: () => 1,
    calculateMoveDamage: () => 10, getActiveWorldBoss: () => null,
  });
  vm.runInContext(extract(indexSource, 'function runWorldBossCounterattack(', '\nconst WORLD_BOSS_PROGRESS_INTERVAL_MS'), ctx);
  const attack = { defeated: false, battleLog: [] };
  ctx.runWorldBossCounterattack(bs, playerState, boss, attack, 'user', boss);
  assert.equal(playerState.hp, 100);
  assert.match(attack.battleLog.join(' '), /missed/);
  battle.fx(player).miracleEye = true;
  ctx.runWorldBossCounterattack(bs, playerState, boss, attack, 'user', boss);
  assert.equal(playerState.hp, 90);
  battle.fx(bossMon).focus = 2;
  ctx.runWorldBossCounterattack(bs, playerState, boss, attack, 'user', boss);
  assert.equal(playerState.hp, 75);
  assert.match(attack.battleLog.at(-1), /critical hit/);
  player.ability = 'Shell Armor';
  ctx.runWorldBossCounterattack(bs, playerState, boss, attack, 'user', boss);
  assert.equal(playerState.hp, 65);
});

test('Oblivion Wing heals three quarters of actual damage without overhealing', () => {
  const ctx = battleContext();
  const attacker = { mon: ctx.player, side: 'player' };
  const defender = { mon: ctx.enemy, side: 'enemy' };
  const move = { name: 'Oblivion Wing', type: 'flying', power: 80, category: 'special', accuracy: 100 };
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    ctx.player.hp = 40;
    battle.performMove(ctx, attacker, defender, move, () => {});
    assert.equal(ctx.player.hp, 47);
    ctx.enemy.hp = 4;
    battle.performMove(ctx, attacker, defender, move, () => {});
    assert.equal(ctx.player.hp, 50);
    ctx.player.hp = 99;
    ctx.enemy.hp = 100;
    battle.performMove(ctx, attacker, defender, move, () => {});
    assert.equal(ctx.player.hp, 100);
  } finally {
    Math.random = originalRandom;
  }
});

test('inventory selects the equipped fishing rod emoji', () => {
  const ctx = vm.createContext({
    FISHING_COOLDOWN_MS: 1,
    EMOJIS: { oldrod: 'old', goodRod: 'good', superRod: 'super', goldenRod: 'golden' },
  });
  vm.runInContext(extract(indexSource, 'const ROD_CONFIGS =', '\nconst EMOJIS ='), ctx);
  for (const [name, emoji] of [['Old Rod', 'old'], ['Good Rod', 'good'], ['Super Rod', 'super'], ['Golden Rod', 'golden']]) {
    assert.equal(ctx.getFishingRodEmoji({ fish_rods: name }), emoji);
  }
  assert.match(indexSource, /\$\{getFishingRodEmoji\(bagUser\)\} \*\*\$\{bagUser\.fish_rods\}\*\*/);
});

test('admin Pokémon grants count each regular, shiny and Golden copy as seen and owned', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE pokemon_forms (
      id INTEGER, species_id INTEGER, name TEXT, slug TEXT, is_default INTEGER, rarity TEXT,
      base_hp INTEGER, base_atk INTEGER, base_def INTEGER, base_spd INTEGER
    );
    INSERT INTO pokemon_forms VALUES (1,1,'Bulbasaur','bulbasaur',1,'Common',45,49,49,45);
    CREATE TABLE catches (user_id TEXT, pokemon_id INTEGER, is_shiny INTEGER, is_golden INTEGER);
    CREATE TABLE pokemon_user_seen_counts (
      user_id TEXT, pokemon_id INTEGER, is_shiny INTEGER, is_golden INTEGER, seen_count INTEGER,
      PRIMARY KEY (user_id, pokemon_id, is_shiny, is_golden)
    );
  `);
  const save = (userId, pokemon, shiny, golden) => db.prepare('INSERT INTO catches VALUES (?,?,?,?)')
    .run(userId, pokemon.id, shiny ? 1 : 0, golden ? 1 : 0);
  const ctx = vm.createContext({
    db, assertUserId: () => {}, subtype: 'pokemon', action: '', args: [], rawTargetId: '123',
    target: { id: '123' }, PREFIX: '.', EMOJIS: { golden: 'golden' },
    message: { author: { username: 'Admin' }, content: '.admin pokemon', guild: null, reply: async (value) => value },
    client: { users: { fetch: async (id) => ({ id }) } },
    getPokemonDexNumbers: () => new Map([[1, { dexNumber: 1, shinyDexNumber: 1001 }]]),
    isGoldenDexNumber: (number) => number === 9001,
    isGoldenFormSupported: () => true, getGoldenDexNumber: () => 9001,
    findPokemonForms: (name) => db.prepare('SELECT * FROM pokemon_forms WHERE lower(name) = ?').all(name.toLowerCase()),
    saveCatch: (userId, pokemon, shiny) => save(userId, pokemon, shiny, false),
    saveGoldenCatch: (userId, pokemon) => save(userId, pokemon, false, true),
    notifyAdminIfRareGrant: async () => {}, formatPokemonReward: (pokemon) => pokemon.name,
  });
  vm.runInContext(extract(dbSource, 'function recordPokemonSeen(', '\nfunction getUserBuddyHistory('), ctx);
  vm.runInContext(`async function run() { ${extract(indexSource,
    "      if (['pokemon', 'mon', 'p'].includes(subtype)) {",
    "\n      return message.reply(\`Invalid sub-command.")} }`, ctx);
  ctx.args = ['pokemon', '123', 'Bulbasaur', '2', 'shiny'];
  await ctx.run();
  ctx.args = ['pokemon', '123', '9001', 'shiny'];
  await ctx.run();
  ctx.action = 'multi';
  ctx.args = ['pokemon', 'multi', '123', 'Bulbasaur,', 'golden Bulbasaur,', 'shiny Bulbasaur'];
  await ctx.run();
  assert.deepEqual(db.prepare(`SELECT is_shiny, is_golden, seen_count FROM pokemon_user_seen_counts
    ORDER BY is_golden, is_shiny`).all(), [
    { is_shiny: 0, is_golden: 0, seen_count: 1 },
    { is_shiny: 1, is_golden: 0, seen_count: 3 },
    { is_shiny: 0, is_golden: 1, seen_count: 2 },
  ]);
  assert.deepEqual(db.prepare(`SELECT is_shiny, is_golden, COUNT(*) AS count FROM catches
    GROUP BY is_shiny, is_golden ORDER BY is_golden, is_shiny`).all().map((row) => row.count), [1, 3, 2]);
  db.close();
});

test('weather and terrain modify move accuracy and power', () => {
  const ctx = battleContext();
  ctx.calc = (move) => move.power;
  const player = { mon: ctx.player, side: 'player' };
  const enemy = { mon: ctx.enemy, side: 'enemy' };
  const earthquake = { name: 'Earthquake', type: 'ground', power: 100, category: 'physical', accuracy: 100 };
  ctx.field.terrain = 'grassy';
  battle.performMove(ctx, player, enemy, earthquake, () => {});
  assert.equal(ctx.enemy.hp, 50);

  ctx.enemy.hp = 100;
  ctx.field.terrain = null;
  const thunder = { name: 'Thunder', type: 'electric', power: 100, category: 'special', accuracy: 70 };
  const originalRandom = Math.random;
  Math.random = () => 0.9;
  try {
    ctx.field.weather = 'rain';
    battle.performMove(ctx, player, enemy, thunder, () => {});
    assert.ok(ctx.enemy.hp < 100);
    ctx.enemy.hp = 100;
    ctx.field.weather = null;
    battle.performMove(ctx, player, enemy, thunder, () => {});
    assert.equal(ctx.enemy.hp, 100);
  } finally {
    Math.random = originalRandom;
  }
});

test('chamber species has 2.5 times the selection weight', () => {
  const species = ['ordinary', 'chamber'];
  let boosted = 0;
  for (let i = 0; i < 7000; i += 1) {
    const chosen = pickWeighted(species, (value) => value === 'chamber' ? 2.5 : 1, () => (i + 0.5) / 7000);
    if (chosen === 'chamber') boosted += 1;
  }
  assert.equal(boosted, 5000);
  assert.throws(() => pickWeighted([], () => 1), RangeError);
});

test('only open Mega Chambers contribute boosted species, without duplicates', () => {
  const event = { id: 'event', startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-30T00:00:00Z' };
  const ctx = vm.createContext({
    ALL_EVENTS: [event],
    CHAMBER_CONFIG: {
      first: { pokemonId: 150, eventId: 'event', closesAfterEvent: 'event' },
      duplicate: { pokemonId: 150, eventId: 'event', closesAfterEvent: 'event' },
      closed: { pokemonId: 1, closesWith: 'event' },
    },
    Date: class extends Date { static now() { return Date.parse('2026-11-08T00:00:00Z'); } },
  });
  vm.runInContext(extract(indexSource, 'function isChamberOpen(', '\nconst { parseAmount }'), ctx);
  assert.deepEqual(Array.from(ctx.getChamberSpawnSpecies()), [150]);
});

test('ordinary Legendary and event rolls use the requested base thresholds', () => {
  const legendarySource = extract(indexSource, 'function chooseEncounterRarity(', '\nfunction getRandomLegendaryFromGenerations(');
  const eventSource = extract(indexSource, 'function getChanceFromFlooredOdds(', '\nlet eventSpawnFormIds');
  let roll = 0;
  const math = Object.create(Math);
  math.random = () => roll;
  const ctx = vm.createContext({
    Math: math, HARD_RARITY_USER_IDS: new Set(),
    HARD_RARITY_RATE_MULTIPLIER: 1, ENCOUNTER_RARITY_WEIGHTS: { normal: { Common: 1 } },
  });
  vm.runInContext(`${extract(indexSource, 'const LEGENDARY_BASE_CHANCE =', '\n// A hunt')}
    ${legendarySource}\n${eventSource}`, ctx);
  roll = 1 / 333 - 1e-10;
  assert.equal(ctx.chooseEncounterRarity('normal', false, 0), 'Legendary');
  roll = 1 / 333;
  assert.equal(ctx.chooseEncounterRarity('normal', false, 0), 'Common');
  roll = 1 / 250 - 1e-10;
  assert.equal(ctx.chooseEncounterRarity('normal', true, 0), 'Legendary');
  roll = 1 / 250;
  assert.equal(ctx.chooseEncounterRarity('normal', true, 0), 'Common');
  assert.equal(ctx.getEventSpawnChance(), 1 / 222);
  assert.equal(ctx.getEventSpawnChance(50), 1 / 148);
  assert.equal(ctx.getEventSpawnChance(0, 30, true), 1 / 100);
  assert.equal(ctx.getEventSpawnChance(50, 30, true), 1 / 66);
  const shinyRate = 0.001 * 1.5 * (1 / (1 - 1 / 100));
  assert.equal(ctx.getChanceFromFlooredOdds(shinyRate), 1 / 660);
});

test('full-odds shiny rolls use each trainer tier and charm without Patreon base doubling', () => {
  let rolls = [];
  const math = Object.create(Math);
  math.random = () => {
    assert.ok(rolls.length, 'Unexpected shiny-roll random value');
    return rolls.shift();
  };
  const users = {
    standard: { patreon_tier: null, has_patreon: 0, shiny_charms: 0 },
    common: { patreon_tier: 'common', has_patreon: 1, shiny_charms: 0 },
    legendary: { patreon_tier: 'legendary', has_patreon: 1, shiny_charms: 0 },
    shiny: { patreon_tier: 'shiny', has_patreon: 1, shiny_charms: 0 },
    extra: { patreon_tier: 'common', has_patreon: 1, shiny_charms: 3 },
  };
  const ctx = vm.createContext({
    Math: math, getUser: (id) => users[id], getPlayerClan: () => null,
    getClanPerkMultipliers: () => ({ srBonus: 0, erBonus: 0 }),
    consumeIncenseCharge: () => false, consumePokeradarCharge: () => false,
    isEventOpen: () => true, halloweenEvent: {},
    eventSpawnEntries: [{ ids: [2], shiny: true, fish: false }],
    getEventSpawnChance: () => 1 / 400, isPlayerBonusActive: () => false,
    isEventChecklistSpawn: () => false, isEventShinyTarget: () => false,
    getEventPokemonKey: () => null,
    consumeEncounterModifier: () => 'normal', getChamberSpawnSpecies: () => [],
    rollSpecialLegendarySpawn: () => null, getActiveHuntTarget: () => null,
    chooseEncounterRarity: () => 'Common', getEncounterRarityRate: () => 1,
    formatPercent: () => '100%', getRandomPokemon: () => ({
      id: 1, speciesId: 1, name: 'Test', speciesName: 'Test', rarity: 'Common',
    }),
    SPECIAL_SPAWN_RESERVED_SPECIES: [], EXPLORE_EXCLUSIVE_SHINY_IDS: new Set(),
    EGG_ONLY_SHINY_SPECIES_KEYS: new Set(), FISH_ONLY_SHINY_KEYS: new Set(),
    FISH_PATREON_ONLY_SHINY_KEYS: new Set(), HARD_RARITY_USER_IDS: new Set(),
    HARD_RARITY_RATE_MULTIPLIER: 1, DAILY_HUNT_SPAWN_BOOST_CHANCE: 0.1,
    eventSpawnFormIds: [], EVENT_FISH_SPAWN_FORM_IDS: [], INCENSE_BOOST: 1.1,
  });
  vm.runInContext(
    extract(dbSource, 'const NO_PATREON_PERKS =', '\nconst BASE_INCENSE_CHARGES') + '\n'
    + extract(dbSource, 'function getPatreonPerks(', '\ndb.exec(') + '\n'
    + extract(dbSource, 'function getTotalEffectiveShinyBonus(', '\n// Amethyst and Onyx') + '\n'
    + extract(indexSource, 'function getChanceFromFlooredOdds(', '\nconst EVENT_SPAWN_ODDS') + '\n'
    + extract(indexSource, 'const BASE_SHINY_RATE =', '\nconst CATCHBOT_GOLDEN_BASE_CHANCE') + '\n'
    + extract(indexSource, 'function rollSpawn(', '\nconst EXPLORE_GOLDEN_CHANCE'),
    ctx
  );
  for (const [user, chance] of [
    ['standard', 1 / 3000], ['common', 1 / 2400], ['legendary', 1 / 2000],
    ['shiny', 1 / 1980], ['extra', 1.25 / (3000 * 0.97)], ['standard', 1 / 3000],
  ]) {
    for (const ticket of [0, 1]) {
      users[user].event_ticket = ticket;
      rolls = ticket ? [0.5, 0.5, chance - 1e-12] : [0.5, chance - 1e-12];
      assert.equal(ctx.rollSpawn('land', user).isShiny, true, `${user}, ticket ${ticket}`);
      rolls = ticket ? [0.5, 0.5, chance + 1e-12] : [0.5, chance + 1e-12];
      assert.equal(ctx.rollSpawn('land', user).isShiny, false, `${user}, ticket ${ticket}`);
    }
  }
});

test('event spawn pity is persistent and isolated by event and trainer', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE event_spawn_pity (
      event_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      encounters_since_spawn INTEGER NOT NULL DEFAULT 0 CHECK (encounters_since_spawn >= 0),
      PRIMARY KEY (event_id, user_id)
    )
  `);
  const ctx = vm.createContext({ db });
  vm.runInContext(
    extract(dbSource, 'function advanceEventSpawnPity(', '\nfunction trackEventCatch('),
    ctx
  );

  assert.equal(ctx.advanceEventSpawnPity('event-a', 'user-a'), 1);
  assert.equal(ctx.advanceEventSpawnPity('event-a', 'user-a'), 2);
  assert.equal(ctx.advanceEventSpawnPity('event-a', 'user-b'), 1);
  assert.equal(ctx.advanceEventSpawnPity('event-b', 'user-a'), 1);
  ctx.resetEventSpawnPity('event-a', 'user-a');
  assert.equal(ctx.advanceEventSpawnPity('event-a', 'user-a'), 1);
  db.close();
});

test('Legendary and full-odds Shiny pity is persistent, separate, and resettable', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE encounter_spawn_pity (
      user_id TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('legendary', 'shiny')),
      encounters_since_spawn INTEGER NOT NULL DEFAULT 0 CHECK (encounters_since_spawn >= 0),
      PRIMARY KEY (user_id, category)
    )
  `);
  const ctx = vm.createContext({ db, assertUserId: () => {} });
  vm.runInContext(
    extract(dbSource, 'function advanceEncounterPity(', '\nfunction trackEventCatch('),
    ctx
  );

  for (let encounter = 0; encounter < 332; encounter += 1) {
    ctx.advanceEncounterPity('trainer', 'legendary');
  }
  assert.equal(ctx.advanceEncounterPity('trainer', 'legendary'), 333);
  for (let encounter = 0; encounter < 749; encounter += 1) {
    ctx.advanceEncounterPity('trainer', 'shiny');
  }
  assert.equal(ctx.advanceEncounterPity('trainer', 'shiny'), 750);
  assert.equal(ctx.advanceEncounterPity('other-trainer', 'shiny'), 1);
  ctx.resetEncounterPity('trainer', 'legendary');
  assert.equal(ctx.advanceEncounterPity('trainer', 'legendary'), 1);
  db.close();
});

test('wild shiny pity persists independently from Explore pity and resets per trainer', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE wild_shiny_spawn_pity (
    user_id TEXT PRIMARY KEY, encounters_since_spawn INTEGER NOT NULL DEFAULT 0
  )`);
  const ctx = vm.createContext({ db, assertUserId: () => {} });
  vm.runInContext(extract(dbSource, 'function advanceWildShinyPity(', '\nfunction trackEventCatch('), ctx);
  assert.equal(ctx.advanceWildShinyPity('trainer'), 1);
  assert.equal(ctx.advanceWildShinyPity('trainer'), 2);
  assert.equal(ctx.advanceWildShinyPity('other'), 1);
  ctx.resetWildShinyPity('trainer');
  assert.equal(ctx.advanceWildShinyPity('trainer'), 1);
  assert.equal(ctx.advanceWildShinyPity('other'), 2);
  db.close();
});

test('repels increase Rare and Super Rare odds while preserving total encounter rate', () => {
  const weightsSource = extract(indexSource, 'const ENCOUNTER_RARITY_WEIGHTS =', '\nconst LEGENDARY_GENERATION_ORDER');
  const rateSource = extract(indexSource, 'function getEncounterRarityRate(', '\nfunction formatEncounterWeights(');
  const ctx = vm.createContext({});
  vm.runInContext(`${weightsSource}\n${rateSource}\nglobalThis.testWeights = ENCOUNTER_RARITY_WEIGHTS;`, ctx);

  for (const [modifier, baseRare, baseSuperRare] of [
    ['repel', 31, 3],
    ['super_repel', 35, 4],
    ['max_repel', 39, 5],
  ]) {
    const weights = ctx.testWeights[modifier];
    assert.equal(weights.Rare, baseRare * 1.5);
    assert.equal(weights['Super Rare'], baseSuperRare * 1.5);
    assert.ok(ctx.getEncounterRarityRate(modifier, 'Rare') > baseRare / 99);
    assert.ok(ctx.getEncounterRarityRate(modifier, 'Super Rare') > baseSuperRare / 99);
  }
  assert.equal(ctx.getEncounterRarityRate('honey', 'Rare'), 8 / 99);
});

test('Grimer, Muk, and Walking Wake use their supplied sprite emojis', () => {
  const spriteMap = extract(indexSource, 'const POKEMON_SPRITE_EMOJIS = Object.freeze(', '\nconst EXACT_ONLY_SPRITE_KEYS');
  const exactOnly = extract(indexSource, 'const EXACT_ONLY_SPRITE_KEYS =', '\nfunction getPokemonSpriteEmoji(');
  const ctx = vm.createContext({});
  vm.runInContext(
    `${spriteMap}\n${exactOnly}\n${extract(indexSource, 'function getPokemonSpriteEmoji(', '\nfunction formatFactionFavorites(')}`,
    ctx
  );
  assert.equal(ctx.getPokemonSpriteEmoji({ name: 'Grimer', isShiny: true }), '<:SGrimer:1569451545236611152>');
  assert.equal(ctx.getPokemonSpriteEmoji({ name: 'Muk', isShiny: true }), '<:SMuk:1569451543160430724>');
  assert.equal(ctx.getPokemonSpriteEmoji({ name: 'Walking Wake' }), '<:WalkingWake:1568037632376569968>');
  assert.equal(ctx.getPokemonSpriteEmoji({ name: 'Walking Wake', isShiny: true }), '<:SWalkingWake:1568037630292140142>');
});

test('repel all resolves to every owned Repel and is not accepted for other modifiers', () => {
  const source = extract(
    indexSource,
    'function parseEncounterModifierAmount(',
    '\nfunction chooseEncounterRarity('
  );
  const ctx = vm.createContext({ parseAmount: Number });
  vm.runInContext(source, ctx);

  assert.equal(ctx.parseEncounterModifierAmount('repel', 'all', 4), 4);
  assert.equal(ctx.parseEncounterModifierAmount('repel', '2', 4), 2);
  assert.equal(ctx.parseEncounterModifierAmount('repel', undefined, 4), 1);
  assert.ok(Number.isNaN(ctx.parseEncounterModifierAmount('super_repel', 'all', 4)));
});

test('wiping a trainer clears catches, stats and snapshots while preserving clan lifetime totals', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE clans (
      id INTEGER PRIMARY KEY, name TEXT, clan_rank TEXT, treasury INTEGER DEFAULT 0,
      bonus_catches INTEGER DEFAULT 0, bonus_fishes INTEGER DEFAULT 0,
      bonus_hatches INTEGER DEFAULT 0, bonus_swaps INTEGER DEFAULT 0,
      bonus_catchbot INTEGER DEFAULT 0, bonus_battles INTEGER DEFAULT 0
    );
    CREATE TABLE clan_members (
      user_id TEXT PRIMARY KEY, clan_id INTEGER, catches INTEGER DEFAULT 0, fishes INTEGER DEFAULT 0,
      hatches INTEGER DEFAULT 0, swaps INTEGER DEFAULT 0, catchbot INTEGER DEFAULT 0,
      battles INTEGER DEFAULT 0, donated_coins INTEGER DEFAULT 0
    );
    CREATE TABLE clan_activity_periods (
      clan_id INTEGER, user_id TEXT, period TEXT, period_start INTEGER,
      catches INTEGER DEFAULT 0, fishes INTEGER DEFAULT 0
    );
    CREATE TABLE catches (
      id INTEGER PRIMARY KEY, user_id TEXT, pokemon_id INTEGER, is_shiny INTEGER, rarity TEXT,
      counted_as_catch INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE users (id TEXT PRIMARY KEY, total_catches INTEGER, unique_caught_base INTEGER,
      shiny_catches INTEGER, legendaries_caught INTEGER);
    CREATE TABLE user_items (user_id TEXT, item_name TEXT, amount INTEGER);
    CREATE TABLE user_pokemon_state_snapshots (user_id TEXT);
    CREATE TRIGGER catch_snapshot BEFORE DELETE ON catches BEGIN
      INSERT INTO user_pokemon_state_snapshots VALUES (OLD.user_id);
    END;
    CREATE TABLE pokemon_gifts (sender_id TEXT, recipient_id TEXT);
    INSERT INTO clans (id, name, clan_rank) VALUES (1, 'Test Clan', 'starter');
    INSERT INTO clan_members VALUES ('trainer', 1, 10, 3, 4, 5, 6, 7, 8);
    INSERT INTO clan_activity_periods VALUES (1, 'trainer', 'weekly', 1, 10, 0);
    INSERT INTO catches VALUES (1, 'trainer', 1, 1, 'Legendary', 1);
    INSERT INTO catches VALUES (2, 'other', 2, 0, 'Common', 1);
    INSERT INTO users VALUES ('trainer', 10, 5, 2, 1), ('other', 1, 1, 0, 0);
    INSERT INTO user_items VALUES ('trainer', 'Candy', 2);
    INSERT INTO pokemon_gifts VALUES ('other', 'trainer');
  `);
  const ctx = vm.createContext({ db, auctions: {
    settle: () => {}, cancelLeadingBids: () => {}, confiscate: () => 0,
  } });
  vm.runInContext(
    extract(dbSource, 'function wipeUserData(', '\nfunction deleteClanByName('),
    ctx
  );
  vm.runInContext(
    `${extract(dbSource, 'function getClanPeriodBounds(', '\nfunction getClanActivityStats(')}\n` +
      extract(dbSource, 'function getClanHighScores(', '\nfunction createClan('),
    ctx
  );

  ctx.wipeUserData('trainer');

  const clan = db.prepare('SELECT * FROM clans WHERE id = 1').get();
  const member = db.prepare('SELECT * FROM clan_members WHERE user_id = ?').get('trainer');
  assert.deepEqual(
    [clan.bonus_catches, clan.bonus_fishes, clan.bonus_hatches, clan.bonus_swaps, clan.bonus_catchbot, clan.bonus_battles],
    [13, 3, 4, 5, 6, 7]
  );
  assert.deepEqual(
    [member.catches, member.fishes, member.hatches, member.swaps, member.catchbot, member.battles, member.donated_coins],
    [0, 0, 0, 0, 0, 0, 0]
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM clan_activity_periods WHERE user_id = ?').get('trainer').count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM catches WHERE user_id = ?').get('trainer').count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM catches WHERE user_id = ?').get('other').count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM user_pokemon_state_snapshots WHERE user_id = ?').get('trainer').count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM pokemon_gifts').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users WHERE id = ?').get('trainer').count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM user_items WHERE user_id = ?').get('trainer').count, 0);
  ctx.getUser = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id)
    || { total_catches: 0, unique_caught_base: 0, shiny_catches: 0, legendaries_caught: 0 };
  vm.runInContext(extract(dbSource, 'function getUserStatsSummary(', '\ntry {'), ctx);
  const stats = ctx.getUserStatsSummary('trainer');
  assert.deepEqual([stats.lifetimeCaught, stats.uniqueInBox, stats.shiniesCaught, stats.legendariesCaught], [0, 0, 0, 0]);
  assert.equal(ctx.getClanHighScores('catches')[0].score, 13);
  assert.equal(ctx.getClanHighScores('fishes')[0].score, 3);
  assert.equal(ctx.getClanHighScores('hatches')[0].score, 4);
  assert.equal(ctx.getClanHighScores('swaps')[0].score, 5);
  assert.equal(ctx.getClanHighScores('catchbot')[0].score, 6);
  db.close();
});

test('trades retain held items for the sender without duplicating shared items', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE catches (id INTEGER PRIMARY KEY, user_id TEXT, pokemon_id INTEGER,
      is_shiny INTEGER, is_golden INTEGER, held_item TEXT);
    INSERT INTO catches VALUES
      (1,'a',1,0,0,'Nugget'), (2,'a',1,0,0,'Nugget'),
      (3,'a',1,1,0,'Leftovers'), (4,'b',1,0,0,'Silk Scarf'),
      (5,'a',2,0,0,NULL);
  `);
  const returned = [];
  const ctx = vm.createContext({ db, addUserItem: (user, item) => returned.push([user, item]) });
  vm.runInContext(extract(indexSource, 'function prepareTradeHeldItems(', '\nasync function handleNameTrade('), ctx);
  ctx.prepareTradeHeldItems([
    { from: 'a', pokemon: { id: 1 } }, { from: 'a', pokemon: { id: 3 } },
    { from: 'a', pokemon: { id: 5 } }, { from: 'b', pokemon: { id: 4 } },
  ]);
  assert.deepEqual(returned, [['a', 'Leftovers'], ['b', 'Silk Scarf']]);
  assert.equal(db.prepare('SELECT held_item FROM catches WHERE id = 2').get().held_item, 'Nugget');
  for (const id of [1, 3, 4, 5]) {
    assert.equal(db.prepare('SELECT held_item FROM catches WHERE id = ?').get(id).held_item, null);
  }
  db.prepare("UPDATE catches SET user_id = 'b' WHERE id = 1").run();
  ctx.prepareTradeHeldItems([{ from: 'a', pokemon: { id: 2 } }]);
  assert.deepEqual(returned, [['a', 'Leftovers'], ['b', 'Silk Scarf'], ['a', 'Nugget']]);
  for (const start of ['async function handleNameTrade(', 'function executeMultiTrade(', 'async function handleTrade(']) {
    const flow = extract(indexSource, start, '\nasync function ');
    assert.match(flow, /prepareTradeHeldItems\(/);
  }
  db.close();
});

test('multi-trade returns the last shared item once and preserves recipient equipment', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE catches (id INTEGER PRIMARY KEY, user_id TEXT, pokemon_id INTEGER,
      is_shiny INTEGER, is_golden INTEGER, held_item TEXT);
    CREATE TABLE users (id TEXT PRIMARY KEY, buddy_catch_id INTEGER);
    CREATE TABLE items (user_id TEXT, item TEXT);
    INSERT INTO users VALUES ('a', NULL), ('b', NULL);
    INSERT INTO catches VALUES (1,'a',1,0,0,'Nugget'), (2,'a',1,0,0,'Nugget'),
      (3,'b',1,0,0,'Leftovers');
  `);
  const ctx = vm.createContext({
    db, getTransferEligibilityError: () => null, getTradeBalances: () => ({ coins: 0, tokens: 0 }),
    addUserItem: (id, item) => db.prepare('INSERT INTO items VALUES (?, ?)').run(id, item),
    getTradeableCatchRows: (id) => db.prepare('SELECT * FROM catches WHERE user_id = ? ORDER BY id').all(id),
    recordPokemonTradeStats: () => {}, rebaseTransferredPokemon: () => {},
    syncNewCatchState: (id, catchId) => {
      const copy = db.prepare('SELECT held_item FROM catches WHERE user_id = ? AND id != ? ORDER BY id LIMIT 1').get(id, catchId);
      if (copy) db.prepare('UPDATE catches SET held_item = ? WHERE id = ?').run(copy.held_item, catchId);
    },
  });
  vm.runInContext(extract(indexSource, 'function prepareTradeHeldItems(', '\nasync function handleNameTrade('), ctx);
  vm.runInContext(extract(indexSource, 'function executeMultiTrade(', '\nasync function handleMultiTrade('), ctx);
  const session = { sides: [
    { user: { id: 'a', username: 'A' }, coins: 0, tokens: 0,
      pokemon: new Map([['one', { name: 'One', amount: 2 }]]) },
    { user: { id: 'b', username: 'B' }, coins: 0, tokens: 0, pokemon: new Map() },
  ] };
  assert.equal(ctx.executeMultiTrade(session), null);
  assert.deepEqual(db.prepare('SELECT user_id, item FROM items').all(), [{ user_id: 'a', item: 'Nugget' }]);
  assert.deepEqual(db.prepare('SELECT held_item FROM catches WHERE user_id = ? ORDER BY id').all('b'),
    [{ held_item: 'Leftovers' }, { held_item: 'Leftovers' }, { held_item: 'Leftovers' }]);
  db.close();
});

test('spawn selection applies chamber weights and Legendary Box exclusions', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE pokemon_forms (
      id INTEGER PRIMARY KEY, species_id INTEGER, evolution_chain_id INTEGER, is_default INTEGER,
      rarity TEXT, is_water INTEGER, name TEXT, species_name TEXT
    );
    INSERT INTO pokemon_forms VALUES (1,1,1,1,'Common',0,'Ordinary','Ordinary');
    INSERT INTO pokemon_forms VALUES (2,2,2,1,'Common',0,'Chamber','Chamber');
    INSERT INTO pokemon_forms VALUES (3,2,2,0,'Common',0,'Chamber Alternate','Chamber');
    INSERT INTO pokemon_forms VALUES (1001,1001,1001,1,'Legendary',0,'Wo Chien','Wo Chien');
    INSERT INTO pokemon_forms VALUES (898,898,898,1,'Legendary',0,'Calyrex','Calyrex');
  `);
  let roll = 0;
  const math = Object.create(Math);
  math.random = () => roll;
  const ctx = vm.createContext({
    db, Math: math, pickWeighted: (candidates, weightOf) => pickWeighted(candidates, weightOf, () => roll),
    randomPokemonCache: new Map(), RANDOM_POKEMON_CACHE_MS: 5000,
    getStarterChainIds: () => new Set(), STARTER_SPAWN_WEIGHT: 1,
    getCachedPokemonForm: (id) => ({ ...db.prepare('SELECT * FROM pokemon_forms WHERE id=?').get(id), types: '["normal"]' }),
  });
  vm.runInContext(extract(dbSource, 'function getRandomPokemon(', '\nlet raritySettingsCache'), ctx);
  roll = 0.3;
  assert.equal(ctx.getRandomPokemon('Common', false, true, true, [], [], null, [2]).speciesId, 2);
  assert.equal(ctx.getRandomPokemon('Common', false, true, true, [], [], null, []).speciesId, 1);
  assert.equal(ctx.getRandomPokemon('Common', false, true, true, []).id, 1);
  assert.equal(
    ctx.getRandomPokemon('Legendary', false, true, true, [], BOXES['Legendary Box'].excludedSpeciesNames).speciesId,
    898
  );
  assert.match(indexSource, /box\.rarity, false, true, true, \[\],\s*\[\.\.\.SPECIAL_SPAWN_RESERVED_SPECIES, \.\.\.\(box\.excludedSpeciesNames \|\| \[\]\)\]/);
  db.close();
});

test('starter and Daily Hunt encounters use their configured spawn chances', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE pokemon_forms (
      id INTEGER PRIMARY KEY, species_id INTEGER, evolution_chain_id INTEGER, is_default INTEGER,
      rarity TEXT, is_water INTEGER, name TEXT, species_name TEXT, slug TEXT,
      base_hp INTEGER, base_atk INTEGER, base_def INTEGER, base_spd INTEGER, types TEXT,
      is_legendary INTEGER, is_mythical INTEGER
    );
    INSERT INTO pokemon_forms VALUES
      (1,1,1,1,'Uncommon',0,'Ordinary','Ordinary','ordinary',50,50,50,50,'["normal"]',0,0),
      (725,725,375,1,'Uncommon',0,'Litten','Litten','litten',50,50,50,50,'["fire"]',0,0);
  `);
  let roll = 0;
  const math = Object.create(Math);
  math.random = () => roll;
  const ctx = vm.createContext({
    db, Math: math, pickWeighted: (candidates, weightOf) => pickWeighted(candidates, weightOf, () => roll),
    randomPokemonCache: new Map(), RANDOM_POKEMON_CACHE_MS: 5000,
    getStarterChainIds: () => new Set([375]),
    getCachedPokemonForm: (id) => db.prepare('SELECT * FROM pokemon_forms WHERE id=?').get(id),
  });
  vm.runInContext(extract(dbSource, 'const STARTER_SPECIES_NAMES =', '\nconst RANDOM_POKEMON_CACHE_MS'), ctx);
  vm.runInContext(extract(dbSource, 'function getRandomPokemon(', '\nlet raritySettingsCache'), ctx);
  roll = 0.1;
  assert.equal(ctx.getRandomPokemon('Uncommon').name, 'Ordinary');
  roll = 0.6;
  assert.equal(ctx.getRandomPokemon('Uncommon').name, 'Litten');

  const huntChanceContext = vm.createContext({});
  vm.runInContext(
    extract(indexSource, 'const DAILY_HUNT_SPAWN_BOOST_CHANCE =', '\nfunction getActiveHuntTarget'),
    huntChanceContext
  );
  assert.equal(vm.runInContext('DAILY_HUNT_SPAWN_BOOST_CHANCE', huntChanceContext), 0.1);
  db.close();
});

test('wild and fishing rolls ignore saved pity guarantees', () => {
  let pityCalls = 0;
  const math = Object.create(Math);
  math.random = () => 0.999999;
  const ctx = vm.createContext({
    Math: math,
    consumeIncenseCharge: () => false, consumePokeradarCharge: () => false,
    isEventOpen: () => true, halloweenEvent: { id: 'event' },
    eventSpawnEntries: [{ ids: [7], shiny: false, fish: false }],
    getUser: () => ({ event_ticket: 1, has_patreon: 0 }),
    getClanPerkMultipliers: () => ({ erBonus: 0 }),
    getTotalEffectiveShinyBonus: () => 0,
    getPatreonPerks: () => ({ shinyRatePct: 0, eventShinyPct: 0 }),
    consumeEncounterModifier: () => 'normal', getChamberSpawnSpecies: () => [],
    getRaritySettings: () => [
      { name: 'Common', spawn_weight: 1, pokemon_count: 1 },
      { name: 'Legendary', spawn_weight: 1, pokemon_count: 1 },
    ],
    rollSpecialLegendarySpawn: () => null, getActiveHuntTarget: () => null,
    getLegendaryEncounterRateText: () => '', getEncounterRarityRate: () => 1,
    formatPercent: () => '100%', getEventPokemonKey: () => null,
    isEventShinyTarget: () => false, isEventChecklistSpawn: () => false,
    BASE_SHINY_RATE: 1 / 3000,
    getRandomPokemon: (rarity) => ({
      id: 2, speciesId: 2, speciesName: 'Test', name: 'Test', rarity: rarity || 'Common', types: [],
    }),
    SPECIAL_SPAWN_RESERVED_SPECIES: [], EXPLORE_EXCLUSIVE_SHINY_IDS: new Set(),
    EVENT_NON_FISH_SPECIES: [], EVENT_FISH_SPAWN_FORM_IDS: [], eventSpawnFormIds: [],
    EGG_ONLY_SHINY_SPECIES_KEYS: new Set(), FISH_ONLY_SHINY_KEYS: new Set(),
    FISH_PATREON_ONLY_SHINY_KEYS: new Set(), HARD_RARITY_USER_IDS: new Set(),
    HARD_RARITY_RATE_MULTIPLIER: 1, isPlayerBonusActive: () => false,
    DAILY_HUNT_SPAWN_BOOST_CHANCE: 0, INCENSE_BOOST: 1.1,
    EVENT_TICKET_SHINY_RATES: { standard: { event: 0.01, nonEvent: 0.001 }, patreon: { event: 0.02, nonEvent: 0.002 } },
    ENCOUNTER_RARITY_WEIGHTS: { normal: { Common: 1 } },
    getWildSpawnGuarantee: () => { pityCalls++; return { encounters_since_spawn: 10000, threshold_fraction: 0 }; },
    initializeWildSpawnGuarantees: () => { pityCalls++; },
    recordWildSpawnGuarantees: () => { pityCalls++; },
  });
  const source = [
    extract(indexSource, 'function getChanceFromFlooredOdds(', '\nlet eventSpawnFormIds'),
    extract(indexSource, 'const LEGENDARY_BASE_CHANCE =', '\n// A hunt'),
    extract(indexSource, 'function chooseEncounterRarity(', '\nfunction getRandomLegendaryFromGenerations('),
    extract(indexSource, 'function rollSpawn(', '\nfunction isEventChecklistSpawn('),
  ].join('\n');
  vm.runInContext(source, ctx);

  const land = ctx.rollSpawn('land', 'trainer', null, { useSpawnPity: true });
  const fishing = ctx.rollSpawn('water', 'trainer', { enablesLegendary: true, enablesShiny: true }, { useSpawnPity: true });
  for (const spawn of [land, fishing]) {
    assert.equal(spawn.isEventSpawn, undefined);
    assert.equal(spawn.rarity, 'Common');
    assert.equal(spawn.isShiny, false);
    assert.equal(spawn.spawnPity, undefined);
  }
  assert.equal(pityCalls, 0);
});

test('fishing and CatchBot apply the Legendary base rate and CatchBot modifier', () => {
  let rolls = [];
  const math = Object.create(Math);
  math.random = () => rolls.shift() ?? 0.9;
  const ctx = vm.createContext({
    Math: math, consumeIncenseCharge: () => false, consumePokeradarCharge: () => false,
    isEventOpen: () => false, halloweenEvent: {}, eventSpawnEntries: [],
    getUser: () => ({ has_patreon: 0 }), getPlayerClan: () => null,
    getClanPerkMultipliers: () => ({ erBonus: 0 }), getTotalEffectiveShinyBonus: () => 0,
    getChamberSpawnSpecies: () => [], getEventPokemonKey: () => null,
    isEventShinyTarget: () => false, isEventChecklistSpawn: () => false,
    getPatreonPerks: () => ({ shinyRatePct: 0, eventShinyPct: 0 }),
    isPlayerBonusActive: () => false, HARD_RARITY_USER_IDS: new Set(), HARD_RARITY_RATE_MULTIPLIER: 1,
    advanceEncounterPity: () => 0, resetEncounterPity: () => {},
    advanceWildShinyPity: () => 1000, resetWildShinyPity: () => {},
    getRaritySettings: () => [
      { name: 'Common', spawn_weight: 1, pokemon_count: 1 },
      { name: 'Legendary', spawn_weight: 1, pokemon_count: 1 },
    ],
    getRandomPokemon: (rarity) => ({ id: 1, speciesName: rarity, name: rarity, rarity, types: [] }),
    SPECIAL_SPAWN_RESERVED_SPECIES: [], EXPLORE_EXCLUSIVE_SHINY_IDS: new Set(),
    EVENT_NON_FISH_SPECIES: [], EVENT_FISH_SPAWN_FORM_IDS: [],
    eventSpawnFormIds: [], getEventSpawnChance: () => 1 / 500,
    LEGENDARY_BASE_CHANCE: 1 / 167, LEGENDARY_GOLDEN_RAZZ_CHANCE: 1 / 125,
    LEGENDARY_SPAWN_PITY_LIMIT: 167, FULL_ODDS_SHINY_PITY_LIMIT: 750,
    WILD_SHINY_PITY_MIN: 1000, WILD_SHINY_PITY_LIMIT: 2000,
    EVENT_TICKET_SHINY_RATES: { standard: { event: 0, nonEvent: 0 }, patreon: { event: 0, nonEvent: 0 } },
    BASE_SHINY_RATE: 1 / 1000, PATREON_SHINY_RATE: 1 / 500,
    CATCHBOT_SHINY_MULTIPLIER: 0.25, INCENSE_BOOST: 1.1,
    EGG_ONLY_SHINY_SPECIES_KEYS: new Set(), FISH_ONLY_SHINY_KEYS: new Set(),
    FISH_PATREON_ONLY_SHINY_KEYS: new Set(),
  });
  vm.runInContext(
    extract(indexSource, 'function getChanceFromFlooredOdds(', '\nconst EVENT_SPAWN_ODDS') + '\n'
    + extract(indexSource, 'const CATCHBOT_GOLDEN_BASE_CHANCE =', '\nconst GRAZZ_ENCOUNTERS_PER_BERRY'),
    ctx,
  );
  vm.runInContext(
    extract(indexSource, 'function getChanceFromFlooredOdds(', '\nconst EVENT_SPAWN_ODDS') + '\n'
    + extract(indexSource, 'function rollSpawn(', '\nfunction isEventChecklistSpawn('), ctx
  );
  const rod = { enablesLegendary: true, enablesShiny: true, baseShinyRate: 1 / 1000 };
  rolls = [0.0015, 0.9];
  assert.equal(ctx.rollSpawn('water', 'user', rod).rarity, 'Legendary');
  rolls = [1 / 167, 0.9, 0.9];
  assert.equal(ctx.rollSpawn('water', 'user', rod).rarity, 'Common');
  rolls = [1 / 6666 - 1e-9, 0.9];
  assert.equal(ctx.rollSpawn('water', 'user', rod, { catchbot: true }).rarity, 'Legendary');
  rolls = [1 / 6666 + 1e-9, 0.9, 0.9];
  assert.equal(ctx.rollSpawn('water', 'user', rod, { catchbot: true }).rarity, 'Common');
});

test('CatchBot uses configured rarity weights, odds, and per-level Luck bonuses', () => {
  let rolls = [];
  const math = Object.create(Math);
  math.random = () => rolls.shift() ?? 0.9;
  const ctx = vm.createContext({
    Math: math, consumeIncenseCharge: () => false, consumePokeradarCharge: () => false,
    isEventOpen: () => false, halloweenEvent: {}, eventSpawnEntries: [],
    getUser: () => ({ has_patreon: 0 }), getPlayerClan: () => null,
    getClanPerkMultipliers: () => ({ erBonus: 0 }), getTotalEffectiveShinyBonus: () => 0,
    getChamberSpawnSpecies: () => [], getEventPokemonKey: () => null,
    isEventShinyTarget: () => false, isEventChecklistSpawn: () => false,
    getPatreonPerks: () => ({ shinyRatePct: 0, eventShinyPct: 0 }),
    isPlayerBonusActive: () => false, HARD_RARITY_USER_IDS: new Set(), HARD_RARITY_RATE_MULTIPLIER: 1,
    advanceEncounterPity: () => 0, resetEncounterPity: () => {},
    advanceWildShinyPity: () => 0, resetWildShinyPity: () => {},
    getRaritySettings: () => [
      { name: 'Common', spawn_weight: 1, pokemon_count: 1 },
      { name: 'Uncommon', spawn_weight: 1, pokemon_count: 1 },
      { name: 'Rare', spawn_weight: 1, pokemon_count: 1 },
      { name: 'Super Rare', spawn_weight: 1, pokemon_count: 1 },
      { name: 'Legendary', spawn_weight: 1, pokemon_count: 1 },
    ],
    getRandomPokemon: (rarity) => ({ id: 1, speciesId: 1, speciesName: rarity, name: rarity, rarity, types: [] }),
    SPECIAL_SPAWN_RESERVED_SPECIES: [], EXPLORE_EXCLUSIVE_SHINY_IDS: new Set(),
    EVENT_NON_FISH_SPECIES: [], EVENT_FISH_SPAWN_FORM_IDS: [], eventSpawnFormIds: [],
    getEventSpawnChance: () => 1 / 500,
    LEGENDARY_BASE_CHANCE: 1 / 167, LEGENDARY_GOLDEN_RAZZ_CHANCE: 1 / 125,
    LEGENDARY_SPAWN_PITY_LIMIT: 167, FULL_ODDS_SHINY_PITY_LIMIT: 750,
    WILD_SHINY_PITY_MIN: 1000, WILD_SHINY_PITY_LIMIT: 2000,
    EVENT_TICKET_SHINY_RATES: { standard: { event: 0, nonEvent: 0 }, patreon: { event: 0, nonEvent: 0 } },
    BASE_SHINY_RATE: 1 / 1000, PATREON_SHINY_RATE: 1 / 500,
    INCENSE_BOOST: 1.1, EGG_ONLY_SHINY_SPECIES_KEYS: new Set(), FISH_ONLY_SHINY_KEYS: new Set(),
    FISH_PATREON_ONLY_SHINY_KEYS: new Set(),
  });
  vm.runInContext(
    extract(indexSource, 'const CATCHBOT_GOLDEN_BASE_CHANCE =', '\nconst GRAZZ_ENCOUNTERS_PER_BERRY'),
    ctx,
  );
  vm.runInContext(extract(indexSource, 'function rollSpawn(', '\nfunction isEventChecklistSpawn('), ctx);

  for (const [weightRoll, expectedRarity] of [
    [0.54, 'Common'],
    [0.56, 'Uncommon'],
    [0.82, 'Rare'],
    [0.99, 'Super Rare'],
  ]) {
    rolls = [0.9, weightRoll, 0.9];
    assert.equal(ctx.rollSpawn('water', 'user', null, { catchbot: true }).rarity, expectedRarity);
  }

  rolls = [1 / 6666 - 1e-9, 0.9];
  assert.equal(ctx.rollSpawn('water', 'user', null, { catchbot: true }).rarity, 'Legendary');
  rolls = [1 / 6666 + 1e-9, 0.2, 0.9];
  assert.notEqual(ctx.rollSpawn('water', 'user', null, { catchbot: true }).rarity, 'Legendary');
  rolls = [1 / 5000 - 1e-9, 0.9];
  assert.equal(
    ctx.rollSpawn('water', 'user', null, { catchbot: true, catchbotLuckLevel: 10 }).rarity,
    'Legendary',
  );

  rolls = [0.9, 0.2, 0.000013];
  assert.equal(ctx.rollSpawn('water', 'user', null, { catchbot: true }).isShiny, false);
  rolls = [0.9, 0.2, 0.000013];
  assert.equal(
    ctx.rollSpawn('water', 'user', null, { catchbot: true, catchbotLuckLevel: 10 }).isShiny,
    true,
  );

  const goldenRolls = [];
  const goldenMath = Object.create(Math);
  goldenMath.random = () => goldenRolls.shift() ?? 0;
  const goldenCtx = vm.createContext({
    Math: goldenMath,
    CATCHBOT_GOLDEN_EXCLUSIVES: [{ name: 'Aron', types: '[]' }],
  });
  vm.runInContext(
    extract(indexSource, 'const CATCHBOT_GOLDEN_BASE_CHANCE =', '\nconst GRAZZ_ENCOUNTERS_PER_BERRY'),
    goldenCtx,
  );
  vm.runInContext(
    extract(indexSource, 'function rollCatchbotGoldenExclusive(', '\nfunction getSwapMultiplier('),
    goldenCtx,
  );
  goldenCtx.CB_CONFIG = { luck: { maxLvl: 10 } };
  goldenRolls.push(0.0000041);
  assert.equal(goldenCtx.rollCatchbotGoldenExclusive(0), null);
  goldenRolls.push(0.0000051);
  assert.equal(goldenCtx.rollCatchbotGoldenExclusive(10), null);
  goldenRolls.push(0.0000049, 0);
  assert.equal(goldenCtx.rollCatchbotGoldenExclusive(10).isGolden, true);
});

test('checklist shiny bonus weights only eligible event spawns', () => {
  let rolls = [];
  let bonusActive = false;
  let eventOpen = true;
  let ticket = true;
  let patreon = false;
  let eventShinyPct = 0;
  let shinyBonus = 0;
  let clanEventBonus = 0;
  let incense = false;
  let pokeradar = false;
  let selectedWeights = [];
  let tierPerks = null;
  let raritySettings = [{ name: 'Common', spawn_weight: 1, pokemon_count: 1 }];
  const configuredPerks = vm.runInNewContext(
    extract(dbSource, 'const NO_PATREON_PERKS =', '\nconst BASE_INCENSE_CHARGES')
      + '\n({ tiers: PATREON_TIER_PERKS, none: NO_PATREON_PERKS })'
  );
  const math = Object.create(Math);
  math.random = () => {
    assert.ok(rolls.length, 'Unexpected random roll');
    return rolls.shift();
  };
  const entries = [
    { ids: [1], shiny: true, fish: true },
    { ids: [2], shiny: false, fish: true },
    { ids: [3], shiny: true, fish: false },
  ];
  const names = { 1: 'Shiny target', 2: 'Regular target', 3: 'Land target', 4: 'Ordinary' };
  const event = { pokemon: [
    { key: 'shiny', shiny: true, matchNames: ['Shiny target'] },
    { key: 'regular', shiny: false, matchNames: ['Regular target'] },
    { key: 'land', shiny: true, matchNames: ['Land target'] },
  ] };
  const ctx = vm.createContext({
    Math: math, pickWeighted: (pool, weightOf) => {
      selectedWeights = Array.from(pool, weightOf);
      return pickWeighted(pool, weightOf, math.random);
    },
    consumeIncenseCharge: () => incense, consumePokeradarCharge: () => pokeradar,
    isEventOpen: () => eventOpen, halloweenEvent: event, eventSpawnEntries: entries,
    getUser: () => ({ event_ticket: ticket, has_patreon: patreon }),
    getPlayerClan: () => null, getClanPerkMultipliers: () => ({ erBonus: clanEventBonus }),
    getTotalEffectiveShinyBonus: () => shinyBonus + (tierPerks ? tierPerks.shinyCharms : 0),
    getChamberSpawnSpecies: () => [],
    consumeEncounterModifier: () => 'normal', rollSpecialLegendarySpawn: () => null,
    getPatreonPerks: () => tierPerks || { shinyRatePct: 0, eventShinyPct },
    isPlayerBonusActive: (key) => key === 'shiny' && bonusActive,
    HARD_RARITY_USER_IDS: new Set(), HARD_RARITY_RATE_MULTIPLIER: 1,
    getRaritySettings: () => raritySettings,
    getRandomPokemon: (rarity, water, a, b, excluded, species, ids) => {
      const id = ids ? ids[0] : 4;
      return { id, name: names[id], speciesName: names[id], rarity: rarity || 'Common' };
    },
    SPECIAL_SPAWN_RESERVED_SPECIES: [], EXPLORE_EXCLUSIVE_SHINY_IDS: new Set(),
    EVENT_NON_FISH_SPECIES: [],
    EVENT_FISH_SPAWN_FORM_IDS: [], eventSpawnFormIds: [],
    LEGENDARY_BASE_CHANCE: 1 / 666,
    LEGENDARY_GOLDEN_RAZZ_CHANCE: 1 / 500,
    EVENT_TICKET_SHINY_RATES: {
      standard: { event: 0.01, nonEvent: 0.001 }, patreon: { event: 0.02, nonEvent: 0.002 },
    },
    BASE_SHINY_RATE: 1 / 1500, INCENSE_BOOST: 1.1,
    CATCHBOT_RARITY_WEIGHTS: { Common: 55 },
    CATCHBOT_SHINY_DENOMINATORS: [100000],
    CATCHBOT_LEGENDARY_DENOMINATORS: [6666],
    EGG_ONLY_SHINY_SPECIES_KEYS: new Set(), FISH_ONLY_SHINY_KEYS: new Set(),
    FISH_PATREON_ONLY_SHINY_KEYS: new Set(),
  });
  vm.runInContext(
    extract(indexSource, 'function getChanceFromFlooredOdds(', '\nlet eventSpawnFormIds')
      + '\n' + extract(indexSource, 'function rollSpawn(', '\nconst EXPLORE_GOLDEN_CHANCE')
      + '\n' + extract(indexSource, 'function getEventPokemonKey(', '\nfunction getRarityInfo('),
    ctx
  );
  const rod = { enablesLegendary: true, enablesShiny: true, baseShinyRate: 1 / 1250 };
  const fishEvent = (selectionRoll, options = {}) => {
    rolls = [0, selectionRoll];
    return ctx.rollSpawn('water', 'user', rod, options);
  };
  rolls = [1 / 400 - 1e-10, 0];
  assert.equal(ctx.rollSpawn('water', 'user', rod).id, 1);
  rolls = [ctx.getEventSpawnChance(5) - 1e-10, 0];
  assert.equal(ctx.rollSpawn('water', 'user', rod, { roleChanceBoost: 5 }).id, 1);
  rolls = [ctx.getEventSpawnChance(5), 0.5, 0.1, 0.001];
  assert.equal(ctx.rollSpawn('water', 'user', rod, { roleChanceBoost: 5 }).id, 4);
  assert.equal(fishEvent(0.52).id, 2);
  assert.deepEqual(selectedWeights, [1 / 0.95, 1]);
  bonusActive = true;
  const boundary = 1.25 / (1.25 + 0.95);
  assert.equal(fishEvent(boundary - 1e-8).id, 1);
  assert.equal(fishEvent(boundary + 1e-8).id, 2);
  assert.equal(fishEvent(0.9).id, 2);
  rolls = [0, 0.99];
  assert.equal(ctx.rollSpawn('land', 'user').id, 3);

  bonusActive = false;
  const baseline = 1 / 0.95;
  for (const [tier, eventPct, ordinaryPct, charm] of [
    [null, 0, 0, 0],
    ['common', 5, 25, 0],
    ['uncommon', 5, 25, 0],
    ['rare', 5, 25, 0],
    ['superRare', 5, 25, 0],
    ['legendary', 30, 50, 0],
    ['shiny', 30, 50, 1],
    ['golden', 30, 50, 1],
  ]) {
    tierPerks = tier ? configuredPerks.tiers[tier] : configuredPerks.none;
    patreon = Boolean(tier);
    assert.equal(tierPerks.eventShinyPct, eventPct, `${tier} event perk`);
    assert.equal(tierPerks.shinyRatePct, ordinaryPct, `${tier} ordinary shiny perk`);
    assert.equal(tierPerks.shinyCharms, charm, `${tier} shiny charms`);
    const eventChance = ctx.getEventSpawnChance(0, eventPct);
    rolls = [eventChance - 1e-12, 0];
    assert.equal(ctx.rollSpawn('water', 'user', rod).isEventSpawn, true, `${tier} event below threshold`);
    rolls = [eventChance + 1e-12, 0.5, 1];
    assert.equal(ctx.rollSpawn('water', 'user', rod).isEventSpawn, undefined, `${tier} event above threshold`);
    fishEvent(0);
    const weight = baseline * (tier ? 2 : 1) * (1 + eventPct / 100) / (1 - charm / 100);
    assert.ok(Math.abs(selectedWeights[0] - weight) < 1e-12, `${tier} event shiny weight`);
    assert.equal(selectedWeights[1], 1, `${tier} regular event weight`);
    const ordinaryChance = ctx.getChanceFromFlooredOdds(
      rod.baseShinyRate * (1 + ordinaryPct / 100) / (1 - charm / 100)
    );
    rolls = [eventChance, 0.5, ordinaryChance - 1e-10];
    assert.equal(ctx.rollSpawn('water', 'user', rod).isShiny, true, `${tier} ordinary shiny below threshold`);
    rolls = [eventChance, 0.5, ordinaryChance + 1e-10];
    assert.equal(ctx.rollSpawn('water', 'user', rod).isShiny, false, `${tier} ordinary shiny above threshold`);
  }
  tierPerks = configuredPerks.tiers.legendary;
  bonusActive = true;
  const globalBoostEventChance = ctx.getEventSpawnChance(0, tierPerks.eventShinyPct, true);
  rolls = [globalBoostEventChance - 1e-12, 0];
  assert.equal(ctx.rollSpawn('water', 'user', rod).isEventSpawn, true);
  rolls = [globalBoostEventChance + 1e-12, 0.5, 1];
  assert.equal(ctx.rollSpawn('water', 'user', rod).isEventSpawn, undefined);
  bonusActive = false;
  tierPerks = null;
  patreon = true;
  fishEvent(0);
  assert.ok(Math.abs(selectedWeights[0] - baseline * 2) < 1e-12);
  patreon = false;
  eventShinyPct = 5;
  fishEvent(0);
  assert.ok(Math.abs(selectedWeights[0] - baseline * 1.05) < 1e-12);
  eventShinyPct = 0;
  clanEventBonus = 20;
  fishEvent(0);
  assert.ok(Math.abs(selectedWeights[0] - baseline / 0.8) < 1e-12);
  clanEventBonus = 0;
  shinyBonus = 10;
  fishEvent(0);
  assert.ok(Math.abs(selectedWeights[0] - baseline / 0.9) < 1e-12);
  shinyBonus = 0;
  fishEvent(0, { channelRateBoost: 5 });
  assert.ok(Math.abs(selectedWeights[0] - baseline * 1.05) < 1e-12);
  incense = true;
  fishEvent(0);
  assert.ok(Math.abs(selectedWeights[0] - baseline * 1.1) < 1e-12);
  incense = false;
  pokeradar = true;
  fishEvent(0);
  assert.ok(Math.abs(selectedWeights[0] - baseline * 1.1) < 1e-12);
  pokeradar = false;
  patreon = true;
  eventShinyPct = 30;
  shinyBonus = 10;
  clanEventBonus = 20;
  incense = true;
  pokeradar = true;
  ctx.HARD_RARITY_USER_IDS.add('user');
  ctx.HARD_RARITY_RATE_MULTIPLIER = 0.5;
  bonusActive = true;
  fishEvent(0, { channelRateBoost: 5 });
  const expectedWeight = 2 * 1.3 / 0.7 / 0.95 * 1.25 * 0.5 * 1.05 * 1.1 * 1.1;
  assert.ok(Math.abs(selectedWeights[0] - expectedWeight) < 1e-12);
  assert.equal(selectedWeights[1], 1);
  patreon = false;
  eventShinyPct = 0;
  shinyBonus = 0;
  clanEventBonus = 0;
  incense = false;
  pokeradar = false;
  ctx.HARD_RARITY_USER_IDS.clear();
  ctx.HARD_RARITY_RATE_MULTIPLIER = 1;
  bonusActive = false;

  // A non-event encounter at the ordinary shiny threshold stays non-shiny.
  rolls = [1 / 200 + 1e-10, 0.5, 0.001];
  assert.equal(ctx.rollSpawn('water', 'user', rod).isShiny, false);
  ticket = false;
  rolls = [0.5, 0.001];
  assert.equal(ctx.rollSpawn('water', 'user', rod).isShiny, false);
  ticket = true;
  eventOpen = false;
  rolls = [0.5, 0.001];
  assert.equal(ctx.rollSpawn('water', 'user', rod).isShiny, false);
  eventOpen = true;
  rolls = [0.5, 0.00001];
  assert.equal(ctx.rollSpawn('water', 'user', rod, { catchbot: true }).isShiny, false);
});

test('Future Sight resolves two turns later and does not hit a replacement after a faint', () => {
  const move = { name: 'Future Sight', type: 'psychic', power: 100, category: 'special', accuracy: 100 };
  let ctx = battleContext();
  battle.performMove(ctx, { mon: ctx.player, side: 'player' }, { mon: ctx.enemy, side: 'enemy' }, move, () => {});
  battle.endOfTurn(ctx);
  battle.endOfTurn(ctx);
  assert.equal(ctx.enemy.hp, 100);
  battle.endOfTurn(ctx);
  assert.equal(ctx.enemy.hp, 90);

  ctx = battleContext();
  battle.performMove(ctx, { mon: ctx.player, side: 'player' }, { mon: ctx.enemy, side: 'enemy' }, move, () => {});
  battle.endOfTurn(ctx);
  ctx.enemy.hp = 0;
  ctx.enemy = mon('Replacement', ['normal']);
  battle.endOfTurn(ctx);
  battle.endOfTurn(ctx);
  assert.equal(ctx.enemy.hp, 100);
});

test('normal moves do not damage Ghost types unless Scrappy applies', () => {
  const move = { name: 'Last Resort', type: 'normal', power: 100, category: 'physical', accuracy: 100 };
  const ctx = battleContext();
  battle.performMove(ctx, { mon: ctx.player, side: 'player' }, { mon: ctx.enemy, side: 'enemy' }, move, () => {});
  assert.equal(ctx.enemy.hp, 100);
  ctx.player.ability = 'Scrappy';
  battle.performMove(ctx, { mon: ctx.player, side: 'player' }, { mon: ctx.enemy, side: 'enemy' }, move, () => {});
  assert.ok(ctx.enemy.hp < 100);
});

test('Miracle Eye marks the target until it switches, bypassing Dark immunity and positive evasion', () => {
  const ctx = battleContext();
  ctx.enemy.types = ['dark', 'poison'];
  ctx.typeEff = (type, types) => type === 'psychic'
    ? (types.includes('dark') ? 0 : types.includes('poison') ? 2 : 1) : 1;
  ctx.calc = (move, _atk, _def, types) => 10 * ctx.typeEff(move.type, types);
  const psychic = { name: 'Psychic', type: 'psychic', power: 90, category: 'special', accuracy: 100 };
  const eye = { name: 'Miracle Eye', type: 'psychic', power: 0, category: 'status', accuracy: 100 };
  const player = { mon: ctx.player, side: 'player' };
  const enemy = { mon: ctx.enemy, side: 'enemy' };
  const logs = [];
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    battle.performMove(ctx, player, enemy, psychic, (text) => logs.push(text));
    assert.equal(ctx.enemy.hp, 100);
    battle.fx(ctx.enemy).stages.eva = 6;
    battle.performMove(ctx, player, enemy, eye, (text) => logs.push(text));
    assert.equal(battle.fx(ctx.enemy).miracleEye, true);
    assert.equal(battle.fx(ctx.enemy).stages.eva, 0);
    const doubleTeam = { name: 'Double Team', type: 'normal', power: 0, category: 'status', accuracy: 100 };
    battle.performMove(ctx, enemy, player, doubleTeam, (text) => logs.push(text));
    assert.equal(battle.fx(ctx.enemy).stages.eva, 0);
    battle.fx(ctx.enemy).stages.eva = -2;
    battle.performMove(ctx, enemy, player, doubleTeam, (text) => logs.push(text));
    assert.equal(battle.fx(ctx.enemy).stages.eva, -2);
    battle.performMove(ctx, player, enemy, { name: 'Topsy-Turvy', type: 'dark', power: 0, category: 'status', accuracy: 100 }, (text) => logs.push(text));
    assert.equal(battle.fx(ctx.enemy).stages.eva, -2);
    battle.fx(ctx.player).stages.eva = 3;
    battle.performMove(ctx, player, enemy, { name: 'Heart Swap', type: 'psychic', power: 0, category: 'status', accuracy: 100 }, (text) => logs.push(text));
    assert.equal(battle.fx(ctx.enemy).stages.eva, -2);
    assert.equal(battle.fx(ctx.player).stages.eva, -2);
    battle.performMove(ctx, player, enemy, eye, (text) => logs.push(text));
    assert.match(logs.at(-1), /failed/i);
    battle.performMove(ctx, player, enemy, psychic, (text) => logs.push(text));
    assert.equal(ctx.enemy.hp, 80);
    battle.onSwitchIn(ctx, ctx.enemy, 'enemy', () => {});
    assert.equal(battle.fx(ctx.enemy).miracleEye, false);
    battle.performMove(ctx, enemy, player, doubleTeam, (text) => logs.push(text));
    assert.equal(battle.fx(ctx.enemy).stages.eva, -1);
    battle.performMove(ctx, player, enemy, psychic, (text) => logs.push(text));
    assert.equal(ctx.enemy.hp, 80);
  } finally {
    Math.random = originalRandom;
  }
});

test('Miracle Eye also resets negative evasion stages', () => {
  const ctx = battleContext();
  battle.fx(ctx.enemy).stages.eva = -3;
  battle.performMove(ctx, { mon: ctx.player, side: 'player' }, { mon: ctx.enemy, side: 'enemy' },
    { name: 'Miracle Eye', type: 'psychic', power: 0, category: 'status', accuracy: 100 }, () => {});
  assert.equal(battle.fx(ctx.enemy).stages.eva, 0);
});

test('Simple Beam affects world boss stat changes across switches and damaging moves', () => {
  const math = Object.create(Math);
  math.random = () => 0.5;
  const acid = { name: 'Acid Spray', type: 'poison', power: 40, category: 'special' };
  const pool = [{ id: 1, name: 'Boss', baseHp: 50, baseAtk: 50, baseDef: 50, baseSpd: 50 }];
  const ctx = vm.createContext({
    Math: math, battleFx: battle, WORLD_BOSS_POOL: pool, WORLD_BOSS_DUMMY_HP: 1600,
    WORLD_BOSS_PLAYER_DAMAGE_MULTIPLIER: 0.25, EMOJIS: {},
    db: { prepare: () => ({ get: () => ({ types: '["normal"]' }) }) },
    createBattleField: battle.createField, combatStats: () => ({}),
    getWorldBossTeamMoves: (team) => team.map((pokemon) => ({
      pokemon, teamIndex: 0, types: ['poison'], moves: [acid],
    })),
    getHeldItemMoveType: (_name, type) => type, isPlateItem: () => false,
    getHeldItemDamageMultiplier: () => 1, typeEffectiveness: () => 1,
    CHOICE_ATTACK_ITEMS: new Set(), CHOICE_SPECIAL_ATTACK_ITEMS: new Set(),
    applyWorldBossDamage: (_userId, _bossId, damage) => ({ damage, defeated: false, boss: { name: 'Boss' } }),
  });
  vm.runInContext(extract(indexSource, 'function getWorldBossBattle(', '\nconst WORLD_BOSS_PROGRESS_INTERVAL_MS'), ctx);
  const teamStates = new Map();
  const pokemon = { ...mon('Raider', ['poison']), id: 1, team_slot: 1 };
  const state = { pokemon, hp: 100, types: ['poison'], moves: [acid], teamStates };
  const boss = { id: 42, name: 'Boss' };
  const bs = ctx.getWorldBossBattle(state, boss);
  const moveCtx = { ...battleContext(), worldBoss: true, player: bs.mon, enemy: bs.boss, field: bs.field };
  const logs = [];
  battle.performMove(moveCtx, { mon: bs.mon, side: 'player' }, { mon: bs.boss, side: 'enemy' },
    { name: 'Simple Beam', accuracy: 100, power: 0 }, (text) => logs.push(text));
  assert.equal(bs.boss.ability, 'Simple');
  const second = ctx.getWorldBossBattle({ ...state, pokemon: { ...pokemon, id: 2 } }, boss);
  assert.equal(second.boss.ability, 'Simple');
  const firstHit = ctx.runWorldBossMove('user', [pokemon], boss, 0, 0, 1, bs.mon, second.boss, moveCtx);
  const secondHit = ctx.runWorldBossMove('user', [pokemon], boss, 0, 0, 1, bs.mon, second.boss, moveCtx);
  assert.match(firstHit.battleLog[0], /harshly fell/);
  assert.equal(secondHit.damage, firstHit.damage * 3);
  assert.equal(vm.runInContext('worldBossDefenceDrops.get("42:user").spdef', ctx), -6);
  const untrained = ctx.runWorldBossMove('untrained', [pokemon], boss, 0, 0);
  const trained = ctx.runWorldBossMove('trained', [{ ...pokemon, ev_spa: 40 }], boss, 0, 0);
  assert.ok(trained.damage > untrained.damage);

  const oblivionWing = { name: 'Oblivion Wing', type: 'flying', power: 80, category: 'special' };
  ctx.getWorldBossTeamMoves = (team) => team.map((entry) => ({
    pokemon: entry, teamIndex: 0, types: ['poison'], moves: [oblivionWing],
  }));
  bs.mon.hp = 1;
  bs.mon.max_hp = 10000;
  const drainingHit = ctx.runWorldBossMove('draining', [pokemon], boss, 0, 0, 1, bs.mon, bs.boss, moveCtx);
  assert.equal(bs.mon.hp, 1 + Math.max(1, Math.floor(drainingHit.damage * 0.75)));

  const surf = { name: 'Surf', type: 'water', power: 90, category: 'special' };
  const thunderbolt = { name: 'Thunderbolt', type: 'electric', power: 90, category: 'special' };
  ctx.getWorldBossTeamMoves = (team) => team.map((entry) => ({
    pokemon: entry, teamIndex: 0, types: ['poison'], moves: [surf],
  }));
  moveCtx.field.weather = null;
  const clearWeather = ctx.runWorldBossMove('clear-weather', [pokemon], boss, 0, 0, 1, bs.mon, bs.boss, moveCtx);
  moveCtx.field.weather = 'rain';
  const rainy = ctx.runWorldBossMove('rainy-weather', [pokemon], boss, 0, 0, 1, bs.mon, bs.boss, moveCtx);
  assert.equal(clearWeather.damage, 87);
  assert.equal(rainy.damage, 131);

  ctx.getWorldBossTeamMoves = (team) => team.map((entry) => ({
    pokemon: entry, teamIndex: 0, types: ['poison'], moves: [thunderbolt],
  }));
  moveCtx.field.weather = null;
  moveCtx.field.terrain = 'electric';
  const terrainBoosted = ctx.runWorldBossMove('electric-terrain', [pokemon], boss, 0, 0, 1, bs.mon, bs.boss, moveCtx);
  assert.equal(terrainBoosted.damage, 114);

  const normal = battleContext();
  battle.performMove(normal, { mon: normal.player, side: 'player' }, { mon: normal.enemy, side: 'enemy' },
    { name: 'Simple Beam', accuracy: 100, power: 0 }, () => {});
  assert.equal(normal.enemy.ability, undefined);

  const psychic = { name: 'Psychic', type: 'psychic', power: 90, category: 'special' };
  ctx.db = { prepare: () => ({ get: () => ({ types: '["dark","poison"]' }) }) };
  ctx.typeEffectiveness = (type, types) => type === 'psychic' && types.includes('dark') ? 0 : 1;
  ctx.getWorldBossTeamMoves = (team) => team.map((entry) => ({
    pokemon: entry, teamIndex: 0, types: ['psychic'], moves: [psychic],
  }));
  assert.equal(ctx.runWorldBossMove('user', [pokemon], boss, 0, 0, 1, bs.mon, bs.boss, moveCtx).error, 'no_effect');
  battle.performMove(moveCtx, { mon: bs.mon, side: 'player' }, { mon: bs.boss, side: 'enemy' },
    { name: 'Miracle Eye', accuracy: 100, power: 0 }, () => {});
  assert.ok(ctx.runWorldBossMove('user', [pokemon], boss, 0, 0, 1, bs.mon, bs.boss, moveCtx).damage > 0);
});

test('NPC coin rewards are halved for first clears, rematches, challengers and Volo', () => {
  const math = Object.create(Math);
  let rolls = [];
  math.random = () => {
    assert.ok(rolls.length, 'Unexpected NPC reward roll');
    return rolls.shift();
  };
  const ctx = vm.createContext({
    Math: math,
    CHALLENGER_TIERS: { basic: { coins: [5000, 10000] } },
    awardCoinsWithBoost: (userId, amount) => ({ finalAmount: amount * 2 }),
    clearLeagueChallenge: (userId, index, amount) => amount * 2,
  });
  const rewardCode = extract(indexSource, '        let rematchCoins = 0;', '\n        if (reward === false)');
  vm.runInContext(
    extract(indexSource, 'function halveNpcCoinReward(', '\nconst CHALLENGER_TIERS')
      + `\nfunction calculateNpcRewards(challenge, isRematch, luckIncenseMultiplier) {
        const userId = 'user', challengeIndex = 0;
        ${rewardCode}
        return { reward, rematchCoins, voloCoins, challengerCoins };
      }`,
    ctx
  );
  assert.equal(ctx.calculateNpcRewards({ reward: 5000 }, false, 1).reward, 2500);
  assert.equal(ctx.calculateNpcRewards({ reward: 5000 }, false, 2).reward, 5000);
  rolls = [0.9];
  const rematch = ctx.calculateNpcRewards({ reward: 5000 }, true, 1);
  assert.equal(rematch.rematchCoins, 625);
  assert.equal(rematch.reward, 1250);
  rolls = [0];
  assert.equal(ctx.calculateNpcRewards({ invited: true, special: true, challengerTier: 'basic' }, true, 1).challengerCoins, 2500);
  rolls = [0.99999];
  assert.equal(ctx.calculateNpcRewards({ invited: true, special: true, challengerTier: 'basic' }, true, 2).challengerCoins, 10000);
  rolls = [0, 0.9];
  assert.equal(ctx.calculateNpcRewards({ volo: true, special: true }, true, 1).voloCoins, 5000);
  rolls = [0.99999, 0.9];
  assert.equal(ctx.calculateNpcRewards({ volo: true, special: true }, true, 2).voloCoins, 30000);
  assert.equal(ctx.calculateNpcRewards({ special: true }, true, 1).reward, 0);
  assert.equal(ctx.halveNpcCoinReward(1), 1);
  assert.equal(ctx.halveNpcCoinReward(0), 0);
  assert.match(indexSource, /Rematch won![\s\S]*?\$\{reward\.toLocaleString\(\)\}/);
});

test('battle cooldown is bypassed only for configured users', async () => {
  const notifications = [];
  let teamReady = true;
  const exemptIds = new Set(['1514082847609061541', '537500331953881088', '1573782664773767301']);
  const ctx = vm.createContext({
    battleCooldowns: new Set(), BATTLE_COOLDOWN_MS: 45000,
    COOLDOWN_EXEMPT_USER_IDS: exemptIds,
    getCooldownReadyTimestamp: () => 'later',
    getUserTeam: () => teamReady ? [{}] : [],
    runLeagueChallenge: async () => 'started',
    scheduleCooldownNotification: (_cooldowns, id) => notifications.push(id),
    console,
  });
  vm.runInContext(extract(indexSource, 'function isCooldownExemptUser(', '\nconst catchCooldowns'), ctx);
  vm.runInContext(extract(indexSource, 'function startLeagueChallengeWithCooldown(', '\nconst ROD_CONFIGS'), ctx);
  const message = { author: { username: 'Trainer' }, channel: {}, reply: (text) => text };
  for (const id of exemptIds) {
    assert.equal(await ctx.startLeagueChallengeWithCooldown(message, id, 0, []), 'started');
    assert.equal(await ctx.startLeagueChallengeWithCooldown(message, id, 0, []), 'started');
  }
  assert.deepEqual(notifications, []);
  assert.equal(await ctx.startLeagueChallengeWithCooldown(message, 'ordinary', 0, []), 'started');
  assert.match(await ctx.startLeagueChallengeWithCooldown(message, 'ordinary', 0, []), /battle again later/);
  assert.deepEqual(notifications, ['ordinary']);
  teamReady = false;
  assert.equal(await ctx.startLeagueChallengeWithCooldown(message, 'no-team', 0, []), 'started');
  assert.equal(ctx.battleCooldowns.has('no-team'), false);
});

test('configured users bypass faction-change cooldown but not other faction requirements', () => {
  const exemptIds = new Set(['1514082847609061541', '537500331953881088', '1573782664773767301']);
  const faction = { user_id: '537500331953881088', faction_key: 'rocket', last_changed_at: 1000 };
  const updates = [];
  const ctx = vm.createContext({
    COOLDOWN_EXEMPT_USER_IDS: exemptIds,
    FACTION_TEAMS: { rocket: {}, aqua: {} },
    FACTION_CHANGE_COOLDOWN_MS: 30 * 24 * 60 * 60 * 1000,
    TEAM_MEDALLION_ITEM: 'Team Medallion',
    assertUserId: () => {},
    takeUserItem: () => true,
    db: {
      transaction: (callback) => ({ immediate: callback }),
      prepare: (sql) => sql.startsWith('SELECT')
        ? { get: () => faction }
        : { run: (...args) => updates.push(args) },
    },
  });
  vm.runInContext(
    extract(dbSource, 'function changeUserFaction(', '\nfunction getFactionGoldenPurchase('),
    ctx
  );

  assert.equal(ctx.changeUserFaction('537500331953881088', 'aqua', 1001).faction, ctx.FACTION_TEAMS.aqua);
  assert.equal(updates.length, 1);
  faction.faction_key = 'rocket';
  const cooldown = ctx.changeUserFaction('ordinary', 'aqua', 1001);
  assert.equal(cooldown.error, 'cooldown');
  assert.equal(cooldown.cooldownUntil, 30 * 24 * 60 * 60 * 1000 + 1000);
  assert.equal(updates.length, 1);
});

test('configured users bypass the swap command cooldown without changing other users', () => {
  let now = 5000;
  const replies = [];
  const timeouts = [];
  const exemptIds = new Set(['1514082847609061541', '537500331953881088', '1573782664773767301']);
  const ctx = vm.createContext({
    Date: class extends Date { static now() { return now; } },
    SWAP_COOLDOWN_MS: 3000,
    swapCooldowns: new Map([...exemptIds].map((id) => [id, 10000])),
    COOLDOWN_EXEMPT_USER_IDS: exemptIds,
    message: { reply: (text) => { replies.push(text); return text; } },
    setTimeout: (_callback, delay) => {
      const timer = { delay, unref() {} };
      timeouts.push(timer);
      return timer;
    },
  });
  vm.runInContext(extract(indexSource, 'function isCooldownExemptUser(', '\nconst catchCooldowns'), ctx);
  const cooldownBlock = extract(
    indexSource,
    '        const swapNow = Date.now();',
    '\n        const now = Date.now();'
  );
  vm.runInContext(`function runCooldown(userId) { ${cooldownBlock} return 'allowed'; }`, ctx);

  for (const id of exemptIds) assert.equal(ctx.runCooldown(id), 'allowed');
  assert.equal(ctx.swapCooldowns.size, exemptIds.size);
  assert.deepEqual(replies, []);
  assert.equal(timeouts.length, 0);
  ctx.swapCooldowns.set('ordinary', 10000);
  assert.match(ctx.runCooldown('ordinary'), /swap again/);
  assert.deepEqual(replies, ['⏳ You can swap again <t:10:R>.']);
});

test('Patreon reward wait starts on activation, survives tier changes and restarts on reactivation', () => {
  let now = 1000000000;
  const user = { patreon_tier: null, has_patreon: 0, patreon_rewards_available_at: 0 };
  const ctx = vm.createContext({
    Date: class extends Date { static now() { return now; } },
    PATREON_TIER_ROLES: [
      { key: 'rare', roleId: 'rare' }, { key: 'common', roleId: 'common' },
    ],
    getUser: () => user,
    updateUser: (id, updates) => Object.assign(user, updates),
    patreonTierSyncedAt: new Map(),
    getPatreonPerks: () => ({}), buildPatreonWelcomeEmbed: () => ({}),
    client: { users: { fetch: async () => ({ send: async () => {} }) } },
  });
  vm.runInContext(extract(indexSource, 'function syncPatreonTier(', '\nasync function getPatreonTier('), ctx);
  ctx.syncPatreonTier('user', new Set(['common']));
  assert.equal(user.patreon_rewards_available_at, now + 86400000);
  now += 1000;
  ctx.syncPatreonTier('user', new Set(['rare']));
  assert.equal(user.patreon_rewards_available_at, 1000000000 + 86400000);
  ctx.syncPatreonTier('user', new Set());
  assert.equal(user.patreon_rewards_available_at, 0);
  now += 1000;
  ctx.syncPatreonTier('user', new Set(['common']));
  assert.equal(user.patreon_rewards_available_at, now + 86400000);
  user.patreon_rewards_available_at = 0;
  ctx.syncPatreonTier('user', new Set(['rare']));
  assert.equal(user.patreon_rewards_available_at, 0);
});

test('unavailable support server does not clear an existing Patreon tier', async () => {
  const user = { patreon_tier: 'common', has_patreon: 1, patreon_rewards_available_at: 123 };
  const ctx = vm.createContext({
    client: { guilds: { cache: new Map() } }, ENCOUNTER_BOOST_GUILD_ID: 'support',
    PATREON_TIER_ROLES: [{ key: 'common', name: 'Common', roleId: 'common' }],
    EMOJIS: { common: '⭐' }, console: { warn: () => {} },
    getUser: () => user,
    syncPatreonTier: () => { throw new Error('Should not clear an unverified tier'); },
  });
  vm.runInContext(extract(indexSource, 'async function getPatreonTier(', "\nclient.on('guildMemberUpdate'"), ctx);
  const tier = await ctx.getPatreonTier('user');
  assert.equal(tier.key, 'common');
  assert.equal(user.patreon_rewards_available_at, 123);
});

test('Patreon daily rewards wait 24 hours while the normal daily remains available', () => {
  const perks = { dailyCoinMult: 2, dailyCoins: 5000, dailyTokens: 1 };
  const ctx = vm.createContext({
    getPatreonPerks: () => perks,
    awardCoinsWithBoost: (id, coins) => ({ finalAmount: coins }),
    incrementUser: (id, values) => ctx.increments.push(values),
    increments: [],
  });
  const dailyCode = extract(indexSource, '        const dailyPerks = getPatreonPerks(userId);', '\n        for (const [boxName, quantity]');
  vm.runInContext(`function dailyReward(now, currentUser) {
    const userId = 'user';
    const rewards = { coins: 1000 };
    ${dailyCode}
    return rewards;
  }`, ctx);
  let rewards = ctx.dailyReward(99, { patreon_tier: 'common', patreon_rewards_available_at: 100 });
  assert.equal(rewards.coins, 1000);
  assert.equal(rewards.patreonRewardsAvailableAt, 100);
  assert.equal(rewards.patreonCoins, 0);
  assert.equal(rewards.patreonTokens, 0);
  assert.equal(ctx.increments.length, 0);
  rewards = ctx.dailyReward(100, { patreon_tier: 'common', patreon_rewards_available_at: 100 });
  assert.equal(rewards.coins, 2000);
  assert.equal(rewards.patreonCoins, 5000);
  assert.equal(rewards.patreonTokens, 1);
  assert.equal(ctx.increments.length, 1);
});

test('monthly Patreon snapshot ignores the daily wait and remains fixed and idempotent', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE patreon_monthly_sent (user_id TEXT, month_key TEXT, PRIMARY KEY (user_id, month_key));
    CREATE TABLE patreon_monthly_snapshots (month_key TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
    CREATE TABLE patreon_monthly_recipients (month_key TEXT, user_id TEXT, tier TEXT, PRIMARY KEY (month_key, user_id));
  `);
  const user = { patreon_tier: 'common', patreon_rewards_available_at: 101 };
  let grants = 0;
  const ctx = vm.createContext({
    db, getUser: () => user, assertUserId: () => {},
    PATREON_TIER_PERKS: { common: { monthly: { coins: 10, masterballs: 1, rare_candies: 1, eggs: 1 } } },
    incrementUser: () => { grants += 1; }, addUserItem: () => {},
  });
  vm.runInContext(extract(dbSource, 'function savePatreonMonthlySnapshot(', '\nfunction getPatreonUserIds('), ctx);
  assert.equal(ctx.getPatreonMonthlySnapshot('2026-11'), null);
  assert.equal(ctx.savePatreonMonthlySnapshot('2026-11', [{ userId: 'user', tier: 'common' }], 100), true);
  assert.equal(ctx.savePatreonMonthlySnapshot('2026-11', [{ userId: 'other', tier: 'common' }], 101), false);
  user.patreon_tier = null;
  assert.ok(ctx.grantPatreonMonthly('user', '2026-11').reward);
  assert.equal(ctx.grantPatreonMonthly('user', '2026-11').error, 'already_sent');
  assert.equal(ctx.grantPatreonMonthly('other', '2026-11').error, 'not_in_snapshot');
  assert.equal(grants, 1);
  assert.throws(() => ctx.savePatreonMonthlySnapshot('2026-12', [{ userId: 'user', tier: 'invalid' }], 100));
  assert.equal(ctx.getPatreonMonthlySnapshot('2026-12'), null);
  assert.equal(ctx.savePatreonMonthlySnapshot('2026-12', [], 100), true);
  assert.equal(ctx.getPatreonMonthlySnapshot('2026-12').length, 0);
  db.close();
});

test('monthly distribution retries the original role snapshot after a role transfer', async () => {
  let members = new Map([['first', { id: 'first', roles: { cache: new Set(['role']) } }]]);
  let snapshot = null;
  const grants = [];
  let failOnce = true;
  const ctx = vm.createContext({
    Date: class extends Date { static now() { return Date.parse('2026-12-01T03:00:00Z'); } },
    getPatreonMonthlySnapshot: () => snapshot,
    savePatreonMonthlySnapshot: (month, recipients) => { snapshot = recipients; },
    ENCOUNTER_BOOST_GUILD_ID: 'support',
    PATREON_TIER_ROLES: [{ key: 'common', name: 'Common', roleId: 'role' }],
    client: {
      guilds: { cache: new Map([['support', { members: { fetch: async () => members } }]]) },
      users: { fetch: async () => ({ send: async () => {} }) },
      channels: { fetch: async () => ({ send: async () => {} }) },
    },
    grantPatreonMonthly: (userId) => {
      if (failOnce) { failOnce = false; throw new Error('temporary'); }
      grants.push(userId);
      return { reward: {} };
    },
    EmbedBuilder, monthlyRewardLines: () => [], console: { error: () => {} },
  });
  vm.runInContext(
    extract(indexSource, 'const PATREON_PAYOUT_UTC_OFFSET_HOURS', '\nconst MEGA_STONE_EMOJIS'),
    ctx
  );
  await ctx.runPatreonMonthlyPayout();
  members = new Map([['second', { id: 'second', roles: { cache: new Set(['role']) } }]]);
  await ctx.runPatreonMonthlyPayout();
  assert.deepEqual(grants, ['first']);
});

test('event rollover retains configured announcement channels and does not undo opt-outs', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (event_ticket INTEGER, event_reg_claimed INTEGER, event_gold_claimed INTEGER);
    CREATE TABLE active_event_state (id INTEGER PRIMARY KEY, event_id TEXT);
    CREATE TABLE event_announcement_channels (event_id TEXT, guild_id TEXT, channel_id TEXT, PRIMARY KEY(event_id, guild_id));
    CREATE TABLE event_checklist_announcement_events (event_id TEXT PRIMARY KEY, targets_prepared INTEGER NOT NULL DEFAULT 0);
    INSERT INTO users VALUES (1, 1, 1);
    INSERT INTO active_event_state VALUES (1, 'old');
    INSERT INTO event_announcement_channels VALUES ('old', 'guild', 'eventspawns');
  `);
  const next = { id: 'new' };
  const context = vm.createContext({
    db, ALL_EVENTS: [{ id: 'old' }, next], getCurrentEvent: () => next,
    halloweenEvent: next, eventSpawnEntries: [1], buildEventSpawnData: () => {}, console,
  });
  const source = extract(indexSource, 'function refreshCurrentEvent()', '\nrefreshCurrentEvent();');
  vm.runInContext(`${source}\nrefreshCurrentEvent();`, context);
  assert.equal(db.prepare("SELECT channel_id FROM event_announcement_channels WHERE event_id='new'").get().channel_id, 'eventspawns');
  assert.equal(db.prepare("SELECT targets_prepared FROM event_checklist_announcement_events WHERE event_id='new'").get().targets_prepared, 0);
  assert.equal(db.prepare('SELECT event_ticket FROM users').get().event_ticket, 0);
  db.prepare("DELETE FROM event_announcement_channels WHERE event_id='new'").run();
  vm.runInContext('refreshCurrentEvent();', context);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM event_announcement_channels WHERE event_id='new'").get().n, 0);
  db.close();
});

test('new event checklists post once per configured channel and retry failures', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE event_announcement_channels (event_id TEXT, guild_id TEXT, channel_id TEXT, PRIMARY KEY(event_id, guild_id));
    CREATE TABLE event_checklist_announcement_events (event_id TEXT PRIMARY KEY, targets_prepared INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE event_checklist_announcement_targets (event_id TEXT, guild_id TEXT, sent INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(event_id, guild_id));
    INSERT INTO event_checklist_announcement_events VALUES ('november-part-2-2026', 0);
    INSERT INTO event_announcement_channels VALUES
      ('november-part-2-2026', 'one', 'channel-one'),
      ('november-part-2-2026', 'two', 'channel-two');
  `);
  const sent = [];
  let eventOpen = false;
  let failSecond = true;
  const ctx = vm.createContext({
    db, EmbedBuilder, EVENT_EMBED_COLOR: 0xabcdef,
    halloweenEvent: require('../events/november-part-2-2026'),
    isEventOpen: () => eventOpen,
    getPokemonSpriteEmoji: () => '',
    resolveAnnouncementChannels: async (rows) => rows,
    sendToChannels: async ([channel], payload) => {
      sent.push({ channel: channel.channel_id, embed: payload.embeds[0].toJSON() });
      if (channel.guild_id === 'two' && failSecond) return false;
      return true;
    },
  });
  vm.runInContext(
    extract(indexSource, 'let eventChecklistAnnouncementInProgress =', '\nasync function announceEventCatch('),
    ctx
  );
  db.prepare('DELETE FROM event_checklist_announcement_events').run();
  eventOpen = true;
  await ctx.sendEventChecklistAnnouncements();
  assert.equal(sent.length, 0);
  db.prepare("INSERT INTO event_checklist_announcement_events VALUES ('november-part-2-2026', 0)").run();
  eventOpen = false;
  await ctx.sendEventChecklistAnnouncements();
  assert.equal(sent.length, 0);
  assert.equal(db.prepare('SELECT targets_prepared FROM event_checklist_announcement_events').get().targets_prepared, 0);

  eventOpen = true;
  await ctx.sendEventChecklistAnnouncements();
  assert.deepEqual(sent.map((entry) => entry.channel), ['channel-one', 'channel-two']);
  assert.equal(sent[0].embed.title, 'November Part 2 Event Checklist');
  assert.match(sent[0].embed.description, /Shiny Gastly/);
  assert.match(sent[0].embed.description, /WalkingWake/);
  assert.match(sent[0].embed.description, /Turquoise Rookidee/);
  assert.match(sent[0].embed.description, /`\.e cl`/);

  db.prepare("INSERT INTO event_announcement_channels VALUES ('november-part-2-2026', 'three', 'channel-three')").run();
  db.prepare("UPDATE event_announcement_channels SET channel_id = 'channel-updated' WHERE guild_id = 'two'").run();
  failSecond = false;
  await ctx.sendEventChecklistAnnouncements();
  await ctx.sendEventChecklistAnnouncements();
  assert.deepEqual(sent.map((entry) => entry.channel), ['channel-one', 'channel-two', 'channel-updated']);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM event_checklist_announcement_targets WHERE sent = 1').get().count, 2);
  db.close();
});

test('a completed event reward is granted once and announces the claim', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, event_ticket INTEGER, event_reg_claimed INTEGER, event_gold_claimed INTEGER);
    CREATE TABLE event_catches (event_id TEXT, user_id TEXT, pokemon_key TEXT);
    CREATE TABLE rewards (user_id TEXT, pokemon TEXT);
    INSERT INTO users VALUES ('user',1,0,0);
    INSERT INTO event_catches VALUES ('event','user','one');
  `);
  const event = {
    id: 'event', name: 'Test event', pokemon: [{ key: 'one' }], checklistTargets: { regular: null },
    rewards: { full: { pokemonSlug: 'reward', displayName: 'Reward', announcementName: 'Reward', shiny: false } },
    emojis: { claimFull: 'X' },
  };
  let announcements = 0;
  const context = vm.createContext({
    db, halloweenEvent: event, getUser: (id) => db.prepare('SELECT * FROM users WHERE id=?').get(id),
    getUserEventProgress: () => new Set(['one']), getUserEventCatchCounts: () => new Map(),
    isEventOpen: () => true, createEventLinkRow: () => null,
    getPokemonFormBySlug: () => ({ id: 1, name: 'Reward' }),
    updateUser: (id, fields) => db.prepare('UPDATE users SET event_gold_claimed=? WHERE id=?').run(fields.event_gold_claimed, id),
    saveCatch: (id, pokemon) => db.prepare('INSERT INTO rewards VALUES (?,?)').run(id, pokemon.name),
    announceEventChecklistCompletion: async () => { announcements += 1; },
    notifyAdminIfRareGrant: async () => {},
    formatPokemonReward: (pokemon) => pokemon.name, PREFIX: '.',
  });
  vm.runInContext(extract(indexSource, 'async function handleEventCommand(', '\nasync function getUsernameById('), context);
  const message = { guild: {}, author: {}, channel: {}, reply: (content) => content };
  const first = await context.handleEventCommand(message, 'user', ['claim'], true);
  const second = await context.handleEventCommand(message, 'user', ['cl', 'claim']);
  assert.match(first, /Reward Claimed/);
  assert.match(second, /No checklist reward is ready/);
  assert.equal(announcements, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM rewards').get().n, 1);
  db.close();
});

test('World Boss team types respect Ghost Arceus and held plates', () => {
  const source = extract(indexSource, 'function getBattleTypes(', '\nfunction getEquippedBattleMovesBase(');
  const ctx = vm.createContext({
    isPlateItem: (item) => item === 'Spooky Plate',
    TYPE_BOOSTING_HELD_ITEMS: { 'Spooky Plate': 'ghost' },
  });
  vm.runInContext(source, ctx);
  assert.equal(ctx.getBattleTypes({}, { species_id: 493, types: '["ghost"]' })[0], 'ghost');
  assert.equal(ctx.getBattleTypes({ held_item: 'Spooky Plate' }, { species_id: 493, types: '["normal"]' })[0], 'ghost');
});

test('forfeit confirmation and cancellation preserve the other World Boss controls', async () => {
  const source = extract(indexSource, 'async function handleForfeitPrompt(', '\nfunction makeSparButtons(');
  const ctx = vm.createContext({ ActionRowBuilder, ButtonBuilder, ButtonStyle });
  vm.runInContext(source, ctx);
  const wrap = (rows) => rows.map((row) => {
    const data = row.toJSON();
    return { components: data.components.map((button) => ({ customId: button.custom_id, toJSON: () => button })) };
  });
  let rows = [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('worldboss:forfeit:1').setLabel('Forfeit Battle').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('worldboss:restore:1').setLabel('Restore').setStyle(ButtonStyle.Success)
  )];
  const run = async (customId) => ctx.handleForfeitPrompt({
    customId, message: { components: wrap(rows) }, update: async (payload) => { rows = payload.components; },
  }, 'worldboss:forfeit:1', 'worldboss:forfeit-confirm:1', 'worldboss:forfeit-cancel:1');
  await run('worldboss:forfeit:1');
  assert.deepEqual(rows[0].toJSON().components.map((button) => button.custom_id),
    ['worldboss:forfeit-confirm:1', 'worldboss:forfeit-cancel:1', 'worldboss:restore:1']);
  await run('worldboss:forfeit-cancel:1');
  assert.deepEqual(rows[0].toJSON().components.map((button) => button.custom_id),
    ['worldboss:forfeit:1', 'worldboss:restore:1']);
});

test('evolution keeps held items on original forms and preserves target-form items', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE pokemon_forms (id INTEGER PRIMARY KEY, base_hp INTEGER, base_atk INTEGER, base_def INTEGER, base_spd INTEGER);
    CREATE TABLE user_pokemon_state_snapshots (user_id TEXT, pokemon_id INTEGER, is_shiny INTEGER, is_golden INTEGER);
    CREATE TABLE catches (
      id INTEGER PRIMARY KEY, user_id TEXT, pokemon_id INTEGER, name TEXT, is_shiny INTEGER, is_golden INTEGER,
      rarity TEXT, held_item TEXT, level INTEGER, experience INTEGER, hp_iv INTEGER, atk_iv INTEGER,
      def_iv INTEGER, spa_iv INTEGER, spdef_iv INTEGER, spd_iv INTEGER, ev_hp INTEGER, ev_atk INTEGER,
      ev_def INTEGER, ev_spa INTEGER, ev_spdef INTEGER, ev_spe INTEGER, hp INTEGER, max_hp INTEGER,
      atk INTEGER, def INTEGER, spd INTEGER, in_team INTEGER DEFAULT 0, team_slot INTEGER
    );
    INSERT INTO pokemon_forms VALUES (16, 40, 45, 40, 56);
    INSERT INTO catches (id,user_id,pokemon_id,is_shiny,is_golden,rarity,held_item,level)
      VALUES (1,'user',16,0,0,'Common','Nugget',10), (2,'user',16,0,0,'Common','Nugget',10),
        (3,'user',17,0,0,'Uncommon','Leftovers',10);
  `);
  const source = extract(dbSource, 'function prepareEvolutionHeldItems(', '\nfunction applyPokemonEvolution(');
  const evolution = extract(dbSource, 'function applyPokemonEvolution(', '\nfunction ');
  const ctx = vm.createContext({
    db, calculateStat: () => 10, carryOverEvolutionMoves: () => {},
    syncEvolvedCatchState: () => false, recordPokemonSeen: () => {},
  });
  vm.runInContext(source, ctx);
  vm.runInContext(evolution, ctx);
  const original = db.prepare('SELECT * FROM catches WHERE id=1').get();
  ctx.applyPokemonEvolution('user', original, { id: 17, name: 'Pidgeotto', rarity: 'Common' });
  const remaining = db.prepare('SELECT held_item, level FROM catches WHERE id = 2').get();
  assert.equal(remaining.held_item, 'Nugget');
  assert.equal(remaining.level, 1);
  assert.equal(db.prepare('SELECT held_item FROM catches WHERE id = 1').get().held_item, 'Leftovers');
  assert.equal(db.prepare('SELECT held_item FROM catches WHERE id = 3').get().held_item, 'Leftovers');
  db.close();
});

test('Golden Munchlax cannot evolve into Snorlax, while regular Munchlax can', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE pokemon_forms (id INTEGER PRIMARY KEY, species_id INTEGER, slug TEXT, is_default INTEGER);
    INSERT INTO pokemon_forms VALUES (446, 446, 'munchlax', 1), (143, 143, 'snorlax', 1);
  `);
  const ctx = vm.createContext({ db });
  vm.runInContext(extract(dbSource, 'function resolveSpeciesEvolution(', '\nfunction resolveItemEvolution('), ctx);
  const goldenMunchlax = {
    form_rarity: 'Golden', form_default: 1, form_slug: 'munchlax', is_golden: 1,
  };
  const regularMunchlax = { ...goldenMunchlax, form_rarity: 'Rare', is_golden: 0 };
  assert.equal(ctx.resolveSpeciesEvolution(446, 143, goldenMunchlax), null);
  assert.equal(ctx.resolveSpeciesEvolution(446, 143, regularMunchlax).slug, 'snorlax');
  db.close();
});

test('evolution preserves a last original copy holding its item and consumes evolution items', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE pokemon_forms (id INTEGER PRIMARY KEY, base_hp INTEGER, base_atk INTEGER, base_def INTEGER, base_spd INTEGER);
    CREATE TABLE user_pokemon_state_snapshots (user_id TEXT, pokemon_id INTEGER, is_shiny INTEGER, is_golden INTEGER);
    CREATE TABLE catches (
      id INTEGER PRIMARY KEY, user_id TEXT, pokemon_id INTEGER, name TEXT, is_shiny INTEGER, is_golden INTEGER,
      rarity TEXT, held_item TEXT, level INTEGER, experience INTEGER, hp_iv INTEGER, atk_iv INTEGER,
      def_iv INTEGER, spa_iv INTEGER, spdef_iv INTEGER, spd_iv INTEGER, ev_hp INTEGER, ev_atk INTEGER,
      ev_def INTEGER, ev_spa INTEGER, ev_spdef INTEGER, ev_spe INTEGER, hp INTEGER, max_hp INTEGER,
      atk INTEGER, def INTEGER, spd INTEGER, in_team INTEGER DEFAULT 0, team_slot INTEGER
    );
    INSERT INTO pokemon_forms VALUES (16,40,45,40,56), (19,30,30,30,30);
    INSERT INTO catches (id,user_id,pokemon_id,name,is_shiny,is_golden,rarity,held_item,level,in_team,team_slot)
      VALUES (1,'user',16,'Pidgey',0,0,'Common','Nugget',10,1,1),
        (2,'user',19,'Base',0,0,'Common','Link Cable',10,0,NULL),
        (3,'user',19,'Base',0,0,'Common','Link Cable',10,0,NULL);
  `);
  const ctx = vm.createContext({
    db, calculateStat: () => 10, carryOverEvolutionMoves: () => {},
    syncEvolvedCatchState: () => false, recordPokemonSeen: () => {},
  });
  vm.runInContext(extract(dbSource, 'function prepareEvolutionHeldItems(', '\nfunction applyPokemonEvolution('), ctx);
  vm.runInContext(extract(dbSource, 'function applyPokemonEvolution(', '\nfunction '), ctx);
  ctx.applyPokemonEvolution('user', db.prepare('SELECT * FROM catches WHERE id=1').get(),
    { id: 17, name: 'Pidgeotto', rarity: 'Uncommon' });
  const original = db.prepare('SELECT * FROM catches WHERE pokemon_id=16').get();
  assert.equal(original.held_item, 'Nugget');
  assert.equal(original.level, 1);
  assert.equal(original.in_team, 0);
  assert.equal(original.team_slot, null);
  assert.equal(db.prepare('SELECT held_item FROM catches WHERE id=1').get().held_item, null);
  ctx.applyPokemonEvolution('user', db.prepare('SELECT * FROM catches WHERE id=2').get(),
    { id: 20, name: 'Evolved', rarity: 'Rare' }, 'Link Cable', true);
  assert.equal(db.prepare('SELECT held_item FROM catches WHERE id=3').get().held_item, null);
  assert.equal(db.prepare('SELECT held_item FROM catches WHERE id=2').get().held_item, null);
  db.close();
});

test('Mega Evolution preserves the original item and an existing Mega form item', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE pokemon_forms (
      id INTEGER PRIMARY KEY, species_id INTEGER, species_name TEXT, name TEXT, slug TEXT, rarity TEXT,
      is_default INTEGER, base_hp INTEGER, base_atk INTEGER, base_def INTEGER, base_spd INTEGER
    );
    INSERT INTO pokemon_forms VALUES (1,1,'Venusaur','Venusaur','venusaur','Rare',1,80,82,83,80),
      (2,1,'Venusaur','Mega Venusaur','venusaur-mega','Mega',0,80,100,123,80);
    CREATE TABLE catches (
      id INTEGER PRIMARY KEY, user_id TEXT, pokemon_id INTEGER, name TEXT, is_shiny INTEGER, is_golden INTEGER,
      rarity TEXT, held_item TEXT, level INTEGER, experience INTEGER, hp_iv INTEGER, atk_iv INTEGER,
      def_iv INTEGER, spa_iv INTEGER, spdef_iv INTEGER, spd_iv INTEGER, ev_hp INTEGER, ev_atk INTEGER,
      ev_def INTEGER, ev_spa INTEGER, ev_spdef INTEGER, ev_spe INTEGER, hp INTEGER, max_hp INTEGER,
      atk INTEGER, def INTEGER, spd INTEGER, in_team INTEGER DEFAULT 0, team_slot INTEGER
    );
    INSERT INTO catches (id,user_id,pokemon_id,name,is_shiny,is_golden,rarity,held_item,level)
      VALUES (1,'user',1,'Venusaur',0,0,'Rare','Nugget',10), (2,'user',2,'Mega Venusaur',0,0,'Mega','Leftovers',10);
    CREATE TABLE user_items (user_id TEXT, item_name TEXT, amount INTEGER);
    INSERT INTO user_items VALUES ('user','Mega Bracelet',1);
    CREATE TABLE mega_stones (user_id TEXT, stone_name TEXT, amount INTEGER);
    INSERT INTO mega_stones VALUES ('user','Venusaurite',1);
    CREATE TABLE user_pokemon_state_snapshots (user_id TEXT, pokemon_id INTEGER, is_shiny INTEGER, is_golden INTEGER);
  `);
  const ctx = vm.createContext({
    db, assertUserId: () => {}, getMegaStoneForForm: () => 'Venusaurite', calculateStat: () => 10,
    syncEvolvedCatchState: () => false, recordPokemonSeen: () => {},
    getPokemonDexNumbersForForms: () => new Map([[2, { dexNumber: 2 }]]),
  });
  vm.runInContext(extract(dbSource, 'function prepareEvolutionHeldItems(', '\nfunction applyPokemonEvolution('), ctx);
  vm.runInContext(extract(dbSource, 'function megaEvolvePokemon(', '\nconst ROTOM_ITEMS'), ctx);
  const result = ctx.megaEvolvePokemon('user', 'venusaur');
  assert.equal(result.pokemon.held_item, 'Leftovers');
  assert.equal(db.prepare('SELECT held_item FROM catches WHERE id=1').get().held_item, 'Leftovers');
  const base = db.prepare('SELECT held_item, level FROM catches WHERE pokemon_id=1').get();
  assert.equal(base.held_item, 'Nugget');
  assert.equal(base.level, 1);
  assert.equal(db.prepare('SELECT amount FROM mega_stones').get().amount, 0);
  db.close();
});

test('regular and Mega Evolution preserve existing target profiles, including snapshots', () => {
  for (const mega of [false, true]) {
    for (const profile of ['copy', 'snapshot', 'none']) {
      const db = new Database(':memory:');
      db.exec(`
        CREATE TABLE pokemon_forms (
          id INTEGER PRIMARY KEY, species_id INTEGER, species_name TEXT, name TEXT, slug TEXT,
          rarity TEXT, is_default INTEGER, base_hp INTEGER, base_atk INTEGER, base_def INTEGER, base_spd INTEGER
        );
        INSERT INTO pokemon_forms VALUES (1,1,'Venusaur','Venusaur','venusaur','Rare',1,80,82,83,80),
          (2,1,'Venusaur','Mega Venusaur','venusaur-mega','Mega',0,80,100,123,80);
        CREATE TABLE catches (
          id INTEGER PRIMARY KEY, user_id TEXT, pokemon_id INTEGER, name TEXT, is_shiny INTEGER DEFAULT 0,
          is_golden INTEGER DEFAULT 0, rarity TEXT, held_item TEXT, level INTEGER DEFAULT 1,
          experience INTEGER DEFAULT 0, hp_iv INTEGER DEFAULT 1, atk_iv INTEGER DEFAULT 2,
          def_iv INTEGER DEFAULT 3, spa_iv INTEGER DEFAULT 2, spdef_iv INTEGER DEFAULT 3,
          spd_iv INTEGER DEFAULT 4, ev_hp INTEGER DEFAULT 0, ev_atk INTEGER DEFAULT 0,
          ev_def INTEGER DEFAULT 0, ev_spa INTEGER DEFAULT 0, ev_spdef INTEGER DEFAULT 0,
          ev_spe INTEGER DEFAULT 0, hp INTEGER DEFAULT 10, max_hp INTEGER DEFAULT 10,
          atk INTEGER DEFAULT 10, def INTEGER DEFAULT 10, spd INTEGER DEFAULT 10,
          friendship INTEGER DEFAULT 0, moves TEXT DEFAULT '[]', sketched_moves TEXT DEFAULT '[]',
          ability TEXT, in_team INTEGER DEFAULT 0, team_slot INTEGER
        );
        CREATE TABLE user_pokemon_state_snapshots (
          user_id TEXT, pokemon_id INTEGER, is_shiny INTEGER, is_golden INTEGER,
          level INTEGER, experience INTEGER, hp_iv INTEGER, atk_iv INTEGER, def_iv INTEGER,
          spa_iv INTEGER, spdef_iv INTEGER, spd_iv INTEGER, friendship INTEGER, moves TEXT, sketched_moves TEXT,
          ev_hp INTEGER, ev_atk INTEGER, ev_def INTEGER, ev_spa INTEGER, ev_spdef INTEGER, ev_spe INTEGER
        );
        CREATE TABLE user_items (user_id TEXT, item_name TEXT, amount INTEGER);
        INSERT INTO user_items VALUES ('user','Mega Bracelet',1);
        CREATE TABLE mega_stones (user_id TEXT, stone_name TEXT, amount INTEGER);
        INSERT INTO mega_stones VALUES ('user','Venusaurite',1);
        INSERT INTO catches (id,user_id,pokemon_id,name,rarity,level,experience,hp_iv)
          VALUES (1,'user',1,'Venusaur','Rare',10,100,5);
      `);
      if (profile === 'copy') {
        db.prepare(`INSERT INTO catches (id,user_id,pokemon_id,name,rarity,level,experience,hp_iv,moves)
          VALUES (2,'user',2,'Mega Venusaur','Mega',100,5000,25,'["target-move"]')`).run();
      } else if (profile === 'snapshot') {
        db.prepare(`INSERT INTO user_pokemon_state_snapshots VALUES
          ('user',2,0,0,100,5000,25,2,3,2,3,4,0,'["target-move"]','[]',0,0,0,0,0,0)`).run();
      }
      const ctx = vm.createContext({
        db, assertUserId: () => {}, getUser: () => ({ buddy_catch_id: 1 }),
        calculateStat: () => 10, parseSketchedMoves: (raw) => JSON.parse(raw || '[]'),
        EV_STATS: ['hp', 'atk', 'def', 'spa', 'spdef', 'spe'],
        carryOverEvolutionMoves: () => {}, recordPokemonSeen: () => {},
        getMegaStoneForForm: () => 'Venusaurite',
        getPokemonDexNumbersForForms: () => new Map([[2, { dexNumber: 2 }]]),
      });
      vm.runInContext(
        extract(dbSource, 'function getCatchStateSnapshot(', '\nconst EV_STATS')
        + '\n' + extract(dbSource, 'const DUPLICATE_CATCH_STATE_FIELDS', '\n// Startup self-heal')
        + '\n' + extract(dbSource, 'function syncNewCatchState(', '\n// Brings every group')
        + '\n' + extract(dbSource, 'function prepareEvolutionHeldItems(', '\nfunction holdEvolutionItem(')
        + '\n' + extract(dbSource, 'function megaEvolvePokemon(', '\nconst ROTOM_ITEMS'), ctx);
      const result = mega
        ? ctx.megaEvolvePokemon('user', 'venusaur')
        : ctx.applyPokemonEvolution('user', db.prepare('SELECT * FROM catches WHERE id=1').get(),
          db.prepare('SELECT * FROM pokemon_forms WHERE id=2').get());
      assert.equal(result.error, undefined);
      if (!mega) assert.equal(result.targetProfilePreserved, profile !== 'none');
      const evolved = db.prepare('SELECT level, experience, hp_iv, moves FROM catches WHERE id=1').get();
      if (profile === 'none') {
        assert.deepEqual(evolved, { level: 10, experience: 100, hp_iv: 5, moves: '[]' });
      } else {
        assert.deepEqual(evolved, { level: 100, experience: 5000, hp_iv: 25, moves: '["target-move"]' });
      }
      if (profile === 'copy') {
        assert.deepEqual(db.prepare('SELECT level, experience, hp_iv, moves FROM catches WHERE id=2').get(), evolved);
      }
      db.close();
    }
  }
});

function autospawnContext() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE autospawn_channels (guild_id TEXT PRIMARY KEY, channel_id TEXT, enabled INTEGER, message_count INTEGER, message_target INTEGER);
    INSERT INTO autospawn_channels VALUES ('1560102297198006274','allowed-channel',1,12,500);
    INSERT INTO autospawn_channels VALUES ('1566723679994380288','new-allowed-channel',1,0,15);
    INSERT INTO autospawn_channels VALUES ('other','other-channel',1,3,20);
    CREATE TABLE pokemon_forms (name TEXT, is_default INTEGER);
    INSERT INTO pokemon_forms VALUES ('Decoy',1);
  `);
  let roll = 0;
  const math = Object.create(Math);
  math.random = () => roll;
  const progress = [];
  const ctx = vm.createContext({
    db, Math: math, console, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder,
    setAutoSpawnProgress: (guildId, count, target) => {
      progress.push({ guildId, count, target });
      db.prepare('UPDATE autospawn_channels SET message_count=?, message_target=? WHERE guild_id=?').run(count, target, guildId);
    },
    getAutoSpawnChannel: (id) => db.prepare('SELECT * FROM autospawn_channels WHERE guild_id=? AND enabled=1').get(id),
    getAllAutoSpawnChannels: () => db.prepare('SELECT * FROM autospawn_channels WHERE enabled=1').all(),
    getChamberSpawnSpecies: () => [], SPECIAL_SPAWN_RESERVED_SPECIES: [],
    getRaritySettings: () => [
      { name: 'Common', spawn_weight: 1, pokemon_count: 1 },
      { name: 'Legendary', spawn_weight: 100, pokemon_count: 1 },
      { name: 'Shiny', spawn_weight: 100, pokemon_count: 1 },
      { name: 'Event Shiny', spawn_weight: 100, pokemon_count: 1 },
    ],
    getRandomPokemon: (rarity) => ({ id: 1, name: rarity, rarity, slug: rarity, isShiny: true }),
    getDisplayRarity: (rarity) => rarity, getRarityEmojis: () => '', getRarityColor: () => 0,
    getPokemonShowdownSprite: () => null,
    client: { guilds: { fetch: async () => { throw new Error('Unexpected guild fetch'); } } },
  });
  vm.runInContext(extract(indexSource, 'const autospawnStates = new Map();', '\nasync function runLotteryDrawIfDue()'), ctx);
  return { ctx, db, progress, setRoll: (value) => { roll = value; } };
}

test('autospawn targets include 500 and only that chat target rolls a Legendary', () => {
  const { ctx, db, setRoll } = autospawnContext();
  assert.equal(db.prepare("SELECT enabled FROM autospawn_channels WHERE guild_id='other'").get().enabled, 1);
  assert.equal(db.prepare("SELECT enabled FROM autospawn_channels WHERE guild_id='1560102297198006274'").get().enabled, 1);
  assert.equal(db.prepare("SELECT enabled FROM autospawn_channels WHERE guild_id='1566723679994380288'").get().enabled, 1);
  setRoll(0);
  assert.equal(ctx.getAutospawnThreshold(), 15);
  setRoll(0.999999);
  assert.equal(ctx.getAutospawnThreshold(), 500);
  assert.equal(ctx.createAutoSpawnState({ guild_id: '1560102297198006274', message_target: 500, message_count: 12 }).nextTarget, 500);
  for (const threshold of [15, 30, 45, 60, 499, 500]) {
    const target = ctx.rollAutospawnTarget({ messageThreshold: threshold });
    assert.equal(target.rarity === 'Legendary', threshold === 500);
    assert.equal(target.isShiny, false);
  }
  const scheduled = ctx.rollAutospawnTarget();
  assert.equal(scheduled.rarity, 'Common');
  assert.equal(scheduled.isShiny, false);
  ctx.getRandomPokemon = () => ({ rarity: 'Legendary' });
  assert.throws(() => ctx.rollAutospawnTarget({ messageThreshold: 499 }), /No eligible Super Rare/);
  ctx.getRandomPokemon = () => ({ rarity: 'Common' });
  assert.throws(() => ctx.rollAutospawnTarget({ messageThreshold: 500 }), /No eligible Legendary/);
  db.close();
});

test('scheduled autospawns preserve chat progress and work in any configured server', async () => {
  const { ctx, db } = autospawnContext();
  const config = { guild_id: '1560102297198006274', channel_id: 'allowed-channel', message_count: 12, message_target: 500 };
  const state = ctx.createAutoSpawnState(config);
  let sent = 0;
  const channel = {
    id: 'allowed-channel', guildId: config.guild_id,
    send: async () => {
      sent += 1;
      return { createMessageComponentCollector: () => ({ on: () => {} }) };
    },
  };
  await ctx.triggerAutoSpawn(channel, config, state);
  assert.equal(sent, 1);
  assert.equal(state.count, 12);
  assert.equal(state.nextTarget, 500);
  assert.equal(db.prepare('SELECT message_count FROM autospawn_channels WHERE guild_id=?').get(config.guild_id).message_count, 12);
  state.active = false;
  await ctx.triggerAutoSpawn(channel, config, state, { messageThreshold: 500 });
  assert.equal(state.count, 0);
  assert.equal(state.nextTarget, 15);
  state.active = false;
  await ctx.triggerAutoSpawn({ ...channel, guildId: 'other' }, { ...config, guild_id: 'other' }, state);
  ctx.trackAutoSpawnMessage({ guild: { id: 'other' } });
  assert.equal(sent, 3);
  const secondGuildId = '1566723679994380288';
  const secondConfig = { guild_id: secondGuildId, channel_id: 'new-allowed-channel', message_count: 0, message_target: 15 };
  await ctx.triggerAutoSpawn(
    { ...channel, id: secondConfig.channel_id, guildId: secondGuildId },
    secondConfig,
    { count: 0, nextTarget: 15, active: false }
  );
  assert.equal(sent, 4);
  db.close();
});

test('scheduler processes all enabled servers and the chat counter triggers at 500', async () => {
  const { ctx, db } = autospawnContext();
  const guildId = '1560102297198006274';
  const titles = [];
  const channel = {
    id: 'allowed-channel', guildId, isTextBased: () => true,
    send: async ({ embeds }) => {
      titles.push(embeds[0].toJSON().title);
      return { createMessageComponentCollector: () => ({ on: () => {} }) };
    },
  };
  const guild = {
    id: guildId,
    channels: {
      cache: new Map([[channel.id, channel]]),
      fetch: async (channelId) => channelId === channel.id ? channel : null,
    },
  };
  const fetched = [];
  ctx.client.guilds.fetch = async (id) => { fetched.push(id); return guild; };
  ctx.getAllAutoSpawnChannels = () => [
    { guild_id: 'other', channel_id: 'other-channel', message_count: 0, message_target: 15 },
    { guild_id: guildId, channel_id: channel.id, message_count: 499, message_target: 500 },
  ];
  db.prepare('UPDATE autospawn_channels SET message_count=499 WHERE guild_id=?').run(guildId);
  await ctx.runScheduledAutospawns();
  assert.deepEqual(fetched, ['other', guildId]);
  assert.match(titles[0], /Common/);
  vm.runInContext(`autospawnStates.get('${guildId}').active = false`, ctx);
  ctx.trackAutoSpawnMessage({ guild });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(titles[1], /Legendary/);
  assert.equal(db.prepare('SELECT message_count FROM autospawn_channels WHERE guild_id=?').get(guildId).message_count, 0);
  db.close();
});

test('catching an autospawn awards the Pokémon without advancing eggs', async () => {
  const { ctx, db } = autospawnContext();
  const guildId = '1560102297198006274';
  const handlers = {};
  let choices;
  let saved = 0;
  let eggProgress = 0;
  ctx.saveCatch = () => { saved += 1; };
  ctx.advanceEggCatchProgress = () => { eggProgress += 1; };
  ctx.hasEggBoostAbility = async () => true;
  ctx.trackClanActivity = () => {};
  ctx.announceRareSpawn = async () => {};
  ctx.factionLogoPrefix = () => '';
  ctx.PREFIX = '.';
  db.exec('CREATE TABLE catches (user_id TEXT, pokemon_id INTEGER, is_shiny INTEGER, is_golden INTEGER)');
  const channel = {
    id: 'allowed-channel', guildId,
    send: async (payload) => {
      choices = payload.components[0].toJSON().components;
      return { createMessageComponentCollector: () => ({ on: (event, fn) => { handlers[event] = fn; }, stop: () => {} }) };
    },
  };
  const state = ctx.createAutoSpawnState({ guild_id: guildId, message_count: 0, message_target: 15 });
  await ctx.triggerAutoSpawn(channel, { guild_id: guildId }, state);
  const button = choices.find((choice) => choice.label === 'Common');
  let updated = false;
  await handlers.collect({
    customId: button.custom_id, user: { id: 'player', username: 'Player' }, guild: {}, channel,
    update: async () => { updated = true; }, reply: async (payload) => { throw new Error(payload.content); },
  });
  assert.equal(saved, 1);
  assert.equal(eggProgress, 0);
  assert.equal(updated, true);
  const normalCatch = extract(indexSource, 'async function askForBall(', '\nasync function ');
  assert.match(normalCatch, /advanceEggCatchProgress\(userId, 1, message\.channel, eggAbilityBoost\)/);
  db.close();
});

test('autospawn command is available to server members in any server', async () => {
  const source = extract(indexSource, "    if (command === 'autospawn') {", "\n    if (command === 'lottery'");
  const ctx = vm.createContext({
    PREFIX: '.', ChannelType: { GuildText: 0 },
    setAutoSpawnChannel: () => { ctx.setCalled = true; }, autospawnStates: new Map(),
  });
  vm.runInContext(`async function run(message, args) { const command = 'autospawn'; ${source} }`, ctx);
  const message = {
    guildId: 'other', member: { permissions: { has: () => true } },
    channel: { guildId: 'other', type: 0, id: 'channel' },
    mentions: { channels: { first: () => null } }, reply: (text) => text,
  };
  assert.match(await ctx.run(message, ['set']), /15–500/);
  assert.equal(ctx.setCalled, true);
});

test('World Boss registration servers include the added guild', () => {
  const ctx = vm.createContext({});
  vm.runInContext(
    extract(indexSource, "const WORLD_BOSS_GUILD_ID =", '\nconst WORLD_BOSS_EMOJI'),
    ctx
  );
  assert.equal(vm.runInContext("WORLD_BOSS_GUILD_IDS.has('1560102297198006274')", ctx), true);
  assert.equal(vm.runInContext("WORLD_BOSS_GUILD_IDS.has('1570468039206506546')", ctx), true);
  assert.equal(vm.runInContext("WORLD_BOSS_GUILD_IDS.has('other')", ctx), false);
});

test('World Boss progress edits are coalesced and throttled', async () => {
  const timers = [];
  const announcementUpdates = [];
  const raidEdits = [];
  const boss = { id: 1 };
  const ctx = vm.createContext({
    setTimeout: (callback, delay) => {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    },
    clearTimeout: () => {},
    getActiveWorldBoss: () => boss,
    createWorldBossEmbed: () => ({}),
    activeWorldBossPosts: new Map([
      [1, new Map([
        ['post', { message: { edit: async (payload) => raidEdits.push(payload) } }],
      ])],
    ]),
    updateWorldBossAnnouncement: async (...args) => announcementUpdates.push(args),
  });
  vm.runInContext(
    extract(indexSource, 'const WORLD_BOSS_PROGRESS_INTERVAL_MS', '\nfunction cancelWorldBossProgressUpdate('),
    ctx
  );
  for (let i = 0; i < 10; i += 1) ctx.scheduleWorldBossProgressUpdate(boss.id, {});
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 15000);
  await timers[0].callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(announcementUpdates.length, 1);
  assert.equal(raidEdits.length, 1);
});

test('wild item rolls use 5% for Pokémon and fishing encounters while retaining boosts', () => {
  const math = Object.create(Math);
  let rolls = [];
  math.random = () => {
    assert.ok(rolls.length, 'Unexpected random roll');
    return rolls.shift();
  };
  const ordinary = { name: 'Stone' };
  const researchItem = { name: 'Vest', requiresRelicExchange: true };
  const relic = { name: 'Relic' };
  const valuable = { name: 'Nugget' };
  let relicActive = false;
  const ctx = vm.createContext({
    Math: math, Date,
    WILD_HELD_ITEMS_BY_SPECIES: new Map([['test', [ordinary]], ['research', [researchItem]]]),
    getUser: () => ({ research_relic_unlock_until: relicActive ? Date.now() + 10000 : 0 }),
    getUserItems: () => [], RESEARCH_RELICS: [relic],
    RESEARCH_DROP_VALUABLES: ['Nugget'], RESEARCH_VALUABLES: [valuable],
  });
  vm.runInContext(
    extract(indexSource, 'const WILD_HELD_ITEM_SPAWN_CHANCE =', '\nconst RESEARCH_RELIC_COOLDOWN_MS')
      + '\n' + extract(indexSource, 'function rollWildHeldItem(', '\nconst FACTION_CATCH_POINTS'),
    ctx
  );
  const roll = (source, values, target = { speciesName: 'Test' }, research = false) => {
    rolls = values;
    return ctx.rollWildHeldItem(target, 'trainer', research, source);
  };
  for (const source of ['pokemon', 'fishing']) {
    assert.equal(roll(source, [0, 0.049999]), ordinary);
    assert.equal(roll(source, [0, 0.05]), null);
  }
  assert.equal(roll(null, [0, 0.099999]), ordinary);
  assert.equal(roll(null, [0, 0.1]), null);
  assert.equal(roll('pokemon', [0, 0.0599], { speciesName: 'Test', overworldAbility: 'compound-eyes' }), ordinary);
  assert.equal(roll('pokemon', [0, 0.0601], { speciesName: 'Test', overworldAbility: 'compound-eyes' }), null);
  assert.equal(roll('pokemon', [0, 0.0649], { speciesName: 'Test', researchToolBoosts: { fluffyTail: true } }), ordinary);
  assert.equal(roll('pokemon', [0, 0.0651], { speciesName: 'Test', researchToolBoosts: { fluffyTail: true } }), null);
  assert.equal(roll('pokemon', [0.0499, 0], { speciesName: 'Other' }, true), relic);
  assert.equal(roll('pokemon', [0.05, 0.0499, 0], { speciesName: 'Other' }, true), valuable);
  assert.equal(roll('pokemon', [0.05, 0.05], { speciesName: 'Other' }, true), null);
  relicActive = true;
  assert.equal(roll('pokemon', [0, 0.05, 0.0499, 0], { speciesName: 'Research' }, true), researchItem);
  assert.equal(roll('pokemon', [0, 0.05, 0.05, 0.05, 0.05], { speciesName: 'Research' }, true), null);
});

test('wild encounter item rolls receive their Pokémon or fishing source', () => {
  const calls = [];
  const ctx = vm.createContext({
    target: { speciesName: 'Test' }, userId: 'trainer', mode: 'catch', counterSource: 'pokemon',
    rollWildHeldItem: (...args) => { calls.push(args); return null; },
  });
  const snippet = extract(indexSource, '  if (!target.isExplore && !target.heldItem && !target.heldItemRolled) {', '\n  const user = getUser(userId);');
  for (const [mode, source] of [['catch', 'pokemon'], ['fish', 'fishing'], ['catch', null]]) {
    ctx.mode = mode;
    ctx.counterSource = source;
    vm.runInContext(snippet, ctx);
  }
  assert.deepEqual(calls.map((args) => [args[2], args[3]]), [
    [true, 'pokemon'], [false, 'fishing'], [false, null],
  ]);
});

test('held-item encounters identify the item only with Frisk and do not alone trigger rare advice', () => {
  const hint = extract(indexSource, 'function heldItemEncounterHint(', '\n// Held-item emoji');
  const advice = extract(indexSource, 'function buildRareEncounterAlert(', '\nasync function askForBall(');
  const ctx = vm.createContext({
    HELD_ITEM_EMOJI: 'item', EmbedBuilder,
    isEventOpen: () => false, isEventChecklistSpawn: () => false, halloweenEvent: {},
    getBallCatchRate: () => 100, getCollectionDexNumber: () => 42,
    getRarityEmojis: () => '✨', getRarityColor: () => 0x123456,
    BALL_CONFIG: { pb: { emoji: 'ball', name: 'Poké Ball' } },
    getMarketSaleHistory: () => ({ recent: [{ sale_price: 400, quantity: 2, sold_at: '2026-11-07 18:00:00' }] }),
    EMOJIS: { pokecoin: 'coin' },
  });
  vm.runInContext(`${hint}\n${advice}`, ctx);
  const target = { heldItem: 'Nugget', rarity: 'Common', name: 'Pokemon', id: 1 };
  const options = { userId: '123', catchDisplayRarity: 'Common', rarityData: { catchChance: 1 }, catchBonus: 0 };
  assert.equal(ctx.buildRareEncounterAlert(target, options), null);
  assert.match(ctx.heldItemEncounterHint(target), /holding an item/);
  assert.doesNotMatch(ctx.heldItemEncounterHint(target), /Nugget/);
  assert.match(ctx.heldItemEncounterHint({ ...target, friskReveal: true }), /Nugget/);
  assert.equal(ctx.heldItemEncounterHint({ friskReveal: true }), '');
  const heldAlert = ctx.buildHeldItemEncounterAlert(target, '123');
  assert.equal(heldAlert.content, '<@123> the Pokémon is holding item an item!');
  assert.deepEqual(Array.from(heldAlert.allowedMentions.users), ['123']);
  assert.doesNotMatch(heldAlert.content, /Nugget/);
  assert.match(ctx.buildHeldItemEncounterAlert({ ...target, friskReveal: true, heldItemEmoji: 'coin' }, '123').content, /coin \*\*Nugget\*\*/);
  assert.equal(ctx.buildHeldItemEncounterAlert({ friskReveal: true }, '123'), null);
  const alert = ctx.buildRareEncounterAlert({ ...target, rarity: 'Legendary' }, options);
  assert.match(alert.content, /<@123> a Legendary Pokémon/);
  assert.match(alert.embeds[0].toJSON().title, /Pokemon #42/);
  assert.match(alert.embeds[0].toJSON().description, /Value as of <t:1794074400:R>/);
  assert.match(alert.embeds[0].toJSON().description, /coin 200/);
  assert.match(alert.embeds[0].toJSON().description, /Poké Ball — 100% catch rate/);
  assert.match(indexSource, /friskReveal: String\(overworldAbility\)\.toLowerCase\(\) === 'frisk'/);
});

test('rare encounter alerts handle shiny, event, no sales, and shared encounters', () => {
  const ctx = vm.createContext({
    EmbedBuilder, halloweenEvent: {}, EVENT_EMBED_COLOR: 0xabcdef,
    isEventOpen: () => true, isEventChecklistSpawn: (target) => !!target.event,
    getBallCatchRate: () => 10, getCollectionDexNumber: (target) => target.is_shiny ? 101 : 100,
    getRarityEmojis: () => '✨', getRarityColor: () => 0x123456,
    BALL_CONFIG: { mb: { emoji: 'master', name: 'Master Ball' } },
    getMarketSaleHistory: () => ({ recent: [] }), EMOJIS: { pokecoin: 'coin' },
  });
  vm.runInContext(extract(indexSource, 'function buildRareEncounterAlert(', '\nasync function askForBall('), ctx);
  const options = { userId: '123', catchDisplayRarity: 'Shiny', rarityData: { catchChance: 1 }, allowAnyUserCatch: true };
  const shiny = ctx.buildRareEncounterAlert({ id: 1, name: 'Diglett', rarity: 'Common', isShiny: true }, options);
  assert.match(shiny.content, /a Shiny Pokémon/);
  assert.match(shiny.embeds[0].toJSON().title, /Shiny Diglett #101/);
  assert.match(shiny.embeds[0].toJSON().description, /No recorded sales/);
  assert.match(shiny.embeds[0].toJSON().description, /Master Ball — 100% catch rate/);
  assert.match(shiny.embeds[0].toJSON().description, /initiator/);
  const event = ctx.buildRareEncounterAlert({ id: 1, name: 'Diglett', rarity: 'Common', event: true }, options);
  assert.match(event.content, /an? event Pokémon/);
  assert.equal(event.embeds[0].toJSON().color, 0xabcdef);
  const encounter = extract(indexSource, 'async function askForBall(', '\nasync function ');
  assert.match(encounter, /message\.channel\.send\(rareAlert\)/);
  assert.match(encounter, /message\.channel\.send\(heldItemAlert\)/);
  assert.match(encounter, /message\.channel\.send\(factionAlert\)/);
  assert.doesNotMatch(encounter, /embed\.addFields\([\s\S]*?Market last sold/);
});

test('faction hunt alerts use the daily species mapping and mention the trainer', () => {
  const ctx = vm.createContext({
    getPokemonFactionTeam: (id) => id === 25 ? { id: 'rocket', emoji: '🚀' } : null,
  });
  vm.runInContext(extract(indexSource, 'function buildFactionEncounterAlert(', '\n// Held-item emoji'), ctx);
  const alert = ctx.buildFactionEncounterAlert({ speciesId: 25 }, '123');
  assert.equal(alert.content, '<@123> the Pokémon is a 🚀 faction hunt!');
  assert.deepEqual(Array.from(alert.allowedMentions.users), ['123']);
  assert.equal(ctx.buildFactionEncounterAlert({ species_id: 25 }, '123').content, alert.content);
  assert.equal(ctx.buildFactionEncounterAlert({ speciesId: 26 }, '123'), null);
  assert.equal(ctx.buildFactionEncounterAlert({ speciesId: 25, isExplore: true }, '123'), null);
});

test('held-item list groups all owned Pokémon by item and pages without counting shared copies twice', async () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE catches (user_id TEXT, pokemon_id INTEGER, name TEXT, is_shiny INTEGER, is_golden INTEGER, held_item TEXT)`);
  const insert = db.prepare('INSERT INTO catches VALUES (?, ?, ?, ?, ?, ?)');
  for (let i = 0; i < 12; i += 1) insert.run('user', i + 1, `Mon${i}`, 0, 0, 'Ability Shield');
  insert.run('user', 1, 'Mon0', 0, 0, 'Ability Shield');
  insert.run('user', 1, 'Mon0', 1, 0, 'Ability Shield');
  insert.run('other', 99, 'Other', 0, 0, 'Ability Shield');
  insert.run('user', 90, 'No item', 0, 0, null);
  for (let i = 0; i < 18; i += 1) insert.run('user', 100 + i, `Pokemon${i}`, 0, 0, `Item ${String(i).padStart(2, '0')}`);
  const handlers = {};
  let initial;
  const sent = {
    createMessageComponentCollector: () => ({ on: (event, handler) => { handlers[event] = handler; } }),
    edit: async () => {},
  };
  const message = {
    author: { id: 'user', displayAvatarURL: () => 'https://example.com/avatar.png' },
    reply: async (payload) => { initial = payload; return sent; },
  };
  const ctx = vm.createContext({
    db, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ComponentType: { Button: 2 }, PREFIX: '.', console,
    getItemEmoji: () => '🎁',
    getPokemonSpriteEmoji: (pokemon) => pokemon.name === 'Mon1' ? '' : `:${pokemon.name}:`,
  });
  vm.runInContext(extract(indexSource, 'async function showHeldItemList(', '\nconst autospawnStates'), ctx);
  await ctx.showHeldItemList(message, 'user');
  const first = initial.embeds[0].toJSON();
  assert.equal(first.author.name, "Your Pokémon's Held Items");
  assert.equal(first.fields.length, 18);
  assert.match(first.fields[0].name, /Ability Shield \(13\)/);
  assert.match(first.fields[0].value, /Showing 10 of 13 Pokémon/);
  assert.match(first.fields[0].value, /Mon1/);
  assert.match(first.footer.text, /Page 1\/2/);
  let denied;
  await handlers.collect({ user: { id: 'other' }, reply: async (payload) => { denied = payload; } });
  assert.equal(denied.ephemeral, true);
  let updated;
  await handlers.collect({
    user: { id: 'user' }, customId: 'helditems:next',
    update: async (payload) => { updated = payload; },
  });
  assert.equal(updated.embeds[0].toJSON().fields.length, 1);
  assert.match(updated.embeds[0].toJSON().footer.text, /Page 2\/2/);
  db.close();
});

test('held-item list handles empty collections separately from favorite-team listing', async () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE catches (user_id TEXT, pokemon_id INTEGER, name TEXT, is_shiny INTEGER, is_golden INTEGER, held_item TEXT)');
  let payload;
  const ctx = vm.createContext({ db, EmbedBuilder, PREFIX: '.', getItemEmoji: () => '', getPokemonSpriteEmoji: () => '' });
  vm.runInContext(extract(indexSource, 'async function showHeldItemList(', '\nconst autospawnStates'), ctx);
  await ctx.showHeldItemList({
    author: { displayAvatarURL: () => 'https://example.com/avatar.png' },
    reply: async (value) => { payload = value; return {}; },
  }, 'user');
  assert.match(payload.embeds[0].toJSON().description, /None of your Pokémon/);
  assert.equal(payload.components.length, 0);
  assert.match(indexSource, /action === 'list' && args\[1\]\?\.toLowerCase\(\) === 'items' && args\.length === 2/);
  assert.match(indexSource, /if \(command === 't'\) command = 'team'/);
  db.close();
});

test('new accounts start the seven-day clock and only actual catches count toward transfers', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, joined_at INTEGER DEFAULT 0, transfer_account_created_at INTEGER NOT NULL DEFAULT 0,
      transfer_wild_catches INTEGER NOT NULL DEFAULT 0, total_catches INTEGER NOT NULL DEFAULT 0,
      shiny_catches INTEGER NOT NULL DEFAULT 0, buddy_catch_id INTEGER);
    INSERT INTO users (id) VALUES ('legacy');
    CREATE TABLE pokemon_forms (id INTEGER PRIMARY KEY, species_id INTEGER);
    INSERT INTO pokemon_forms VALUES (1, 25);
    CREATE TABLE catches (id INTEGER PRIMARY KEY, user_id TEXT, pokemon_id INTEGER, name TEXT, rarity TEXT, is_shiny INTEGER,
      is_golden INTEGER, level INTEGER, hp_iv INTEGER, atk_iv INTEGER, def_iv INTEGER, spa_iv INTEGER, spdef_iv INTEGER,
      spd_iv INTEGER, hp INTEGER, max_hp INTEGER, atk INTEGER, def INTEGER, spd INTEGER, in_team INTEGER, team_slot INTEGER,
      moves TEXT, caught_ball TEXT, counted_as_catch INTEGER NOT NULL DEFAULT 1);
  `);
  const now = 1800000000000;
  const ctx = vm.createContext({
    db, legacyUserIdColumn: false, Date: class extends Date { static now() { return now; } },
    incrementableUserFields: new Set(['total_catches', 'shiny_catches', 'transfer_wild_catches']),
    calculateStat: () => 10, getSpeciesLearnset: () => [], syncNewCatchState: () => {}, recordPokemonSeen: () => {},
  });
  vm.runInContext(extract(dbSource, 'function assertUserId(', '\n// One-time fix: joined_at'), ctx);
  vm.runInContext(extract(dbSource, 'function incrementUser(', '\nfunction grantGlobalUserReward('), ctx);
  vm.runInContext(extract(dbSource, 'function saveCatch(', '\n// abilityBoost:'), ctx);
  assert.equal(ctx.getUser('legacy').transfer_account_created_at, 0);
  assert.equal(ctx.getUser('new').transfer_account_created_at, now);
  ctx.saveCatch('new', { id: 1, name: 'Pikachu' }, false, false);
  assert.equal(ctx.getUser('new').transfer_wild_catches, 0);
  ctx.saveCatch('new', { id: 1, name: 'Pikachu' }, false, true);
  assert.equal(ctx.getUser('new').transfer_wild_catches, 1);
  ctx.saveCatch('new', { id: 1, name: 'Pikachu' }, false, true, false, 'mb', false);
  assert.equal(ctx.getUser('new').transfer_wild_catches, 1);
  ctx.saveCatch('new', { id: 1, name: 'Shiny Mewtwo', rarity: 'Legendary' }, true, false, false, null, false, false);
  assert.equal(ctx.getUser('new').total_catches, 3);
  assert.equal(ctx.getUser('new').shiny_catches, 0);
  assert.equal(db.prepare('SELECT counted_as_catch FROM catches WHERE name = ?').get('Shiny Mewtwo').counted_as_catch, 0);
  db.close();
});

test('claiming a gifted shiny legendary adds it to the box without recording it as seen', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE pokemon_gifts (
      id INTEGER PRIMARY KEY, recipient_id TEXT, sender_id TEXT, pokemon_id INTEGER, name TEXT, rarity TEXT,
      is_shiny INTEGER, is_golden INTEGER, caught_ball TEXT
    );
    INSERT INTO pokemon_gifts VALUES (1, 'recipient', 'sender', 150, 'Mewtwo', 'Legendary', 1, 0, 'mb');
    CREATE TABLE pokemon_gift_history (gift_id INTEGER PRIMARY KEY, claimed_at TEXT);
  `);
  const saveCalls = [];
  const seen = [];
  const ctx = vm.createContext({
    db,
    assertUserId: () => {},
    saveCatch: (...args) => { saveCalls.push(args); return 42; },
    rebaseTransferredPokemon: () => {},
    syncNewCatchState: () => {},
    recordPokemonSeen: (...args) => seen.push(args),
  });
  vm.runInContext(
    extract(dbSource, 'function getUserGifts(', '\n// Claims pending gifts')
      + '\n' + extract(dbSource, 'function claimPokemonGifts(', '\nconst BASE_MARKET_LISTING_LIMIT'),
    ctx
  );

  ctx.claimPokemonGifts('recipient');

  assert.equal(saveCalls.length, 1);
  assert.deepEqual(saveCalls[0].slice(2), [true, false, false, 'mb', false, false]);
  assert.deepEqual(seen, []);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM pokemon_gifts').get().count, 0);
  db.close();
});

test('gifted shinies and legendaries are excluded from caught stats', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE catches (
      user_id TEXT, pokemon_id INTEGER, is_shiny INTEGER, rarity TEXT, counted_as_catch INTEGER NOT NULL DEFAULT 1
    );
    INSERT INTO catches VALUES
      ('trainer', 150, 1, 'Legendary', 1),
      ('trainer', 150, 1, 'Legendary', 0);
  `);
  const user = {
    total_catches: 0, unique_caught_base: 0, shiny_catches: 0, legendaries_caught: 0,
  };
  const ctx = vm.createContext({
    db,
    getUser: () => user,
    assertUserId: () => {},
  });
  vm.runInContext(extract(dbSource, 'function getUserStatsSummary(', '\ntry {'), ctx);

  const summary = ctx.getUserStatsSummary('trainer');

  assert.deepEqual(
    [summary.lifetimeCaught, summary.shiniesCaught, summary.legendariesCaught],
    [1, 1, 1]
  );
  db.close();
});

test('received Pokémon in trades count toward lifetime, Shiny, and Legendary stats', () => {
  const increments = [];
  const ctx = vm.createContext({
    assertUserId: () => {},
    incrementUser: (userId, fields) => increments.push({ userId, fields }),
  });
  vm.runInContext(
    extract(dbSource, 'function recordPokemonTradeStats(', '\n// abilityBoost:'),
    ctx
  );

  ctx.recordPokemonTradeStats('recipient', { rarity: 'Legendary', is_shiny: 1 });
  ctx.recordPokemonTradeStats('recipient', { rarity: 'Common', is_shiny: 0 });
  assert.deepEqual(JSON.parse(JSON.stringify(increments)), [
    { userId: 'recipient', fields: { total_catches: 1, shiny_catches: 1, legendaries_caught: 1 } },
    { userId: 'recipient', fields: { total_catches: 1, shiny_catches: 0, legendaries_caught: 0 } },
  ]);
  assert.match(indexSource, /recordPokemonTradeStats\(targetUser\.id, yourMon\)/);
  assert.match(indexSource, /recordPokemonTradeStats\(userId, theirMon\)/);
  assert.match(indexSource, /recordPokemonTradeStats\(move\.to, pokemon\)/);
});

test('transfer eligibility uses 500 wild catches or exactly seven days for both players', () => {
  const now = 1800000000000;
  const week = 7 * 24 * 60 * 60 * 1000;
  const users = {
    legacy: { transfer_account_created_at: 0, transfer_wild_catches: 0 },
    young: { transfer_account_created_at: now - week + 1, transfer_wild_catches: 499, total_catches: 9999 },
    old: { transfer_account_created_at: now - week, transfer_wild_catches: 0 },
    caught: { transfer_account_created_at: now, transfer_wild_catches: 500 },
  };
  const ctx = vm.createContext({ getUser: (id) => users[id] });
  vm.runInContext(extract(indexSource, 'const TRANSFER_MIN_CATCHES', '\nasync function handleNameTrade('), ctx);
  assert.equal(ctx.getTransferEligibilityError(['legacy', 'caught'], now), null);
  assert.equal(ctx.getTransferEligibilityError(['old', 'caught'], now), null);
  const error = ctx.getTransferEligibilityError(['caught', 'young'], now);
  assert.match(error, /<@young>: 499\/500 wild catches/);
  assert.match(error, /7 days/);
  assert.equal(ctx.getTransferEligibilityError(['young'], now + 1), null);
});

test('trades and Pokémon gifts reject ineligible accounts, but fun-item gifts remain available', async () => {
  const reason = '❌ eligibility denied';
  const target = { id: 'target', bot: false };
  let eligibilityChecks = 0;
  const message = {
    mentions: { users: { first: () => target } },
    reply: async (value) => value,
  };
  const ctx = vm.createContext({
    getTransferEligibilityError: () => {
      eligibilityChecks += 1;
      return reason;
    },
    client: { users: { fetch: async () => target } },
    getGiftTarget: () => 'target', PREFIX: '.',
    parseAmount: Number,
    FUN_ITEM_EMOJIS: { Candy: '🍬' },
    takeUserItem: () => true,
    addUserItem: () => [],
    announceQuestCompletions: () => {},
    db: { transaction: (callback) => ({ immediate: callback }) },
  });
  vm.runInContext(extract(indexSource, 'async function handleGift(', '\nasync function handleTrade('), ctx);
  vm.runInContext(extract(indexSource, 'async function handleTrade(', '\nasync function '), ctx);
  for (const args of [['@target', 'pikachu', 'eevee'], ['@target', '-m'], ['@target', 'pikachu']]) {
    assert.equal((await ctx.handleTrade(message, 'sender', args)).content, reason);
  }
  assert.equal((await ctx.handleGift(message, 'sender', ['@target', 'pikachu'])).content, reason);
  const giveSource = extract(indexSource, "    if (command === 'give') {", '\n  } catch (error) {');
  vm.runInContext(`async function handleGive(message, userId, args) { const command = 'give'; ${giveSource} }`, ctx);
  ctx.EMOJIS = { pokecoin: 'coin', patreonToken: 'token' };
  const checksBeforeGive = eligibilityChecks;
  assert.equal((await ctx.handleGive(message, 'sender', ['coins', '5'])).content, reason);
  assert.equal((await ctx.handleGive(message, 'sender', ['tokens', '5'])).content, reason);
  assert.match((await ctx.handleGive(message, 'sender', ['Candy', '5'])).content, /You gave \*\*5x Candy\*\*/);
  assert.equal(eligibilityChecks, checksBeforeGive + 2);
});

test('.give limits PokéCoins to 50 million per transfer without restricting tokens or items', async () => {
  const { parseAmount } = require('../amounts');
  const target = { id: 'target', bot: false };
  const users = {
    sender: { coins: 200_000_000, patreon_tokens: 100_000_000 },
    target: { coins: 0, patreon_tokens: 0 },
  };
  const ctx = vm.createContext({
    PREFIX: '.', EMOJIS: { pokecoin: 'coin', patreonToken: 'token' }, parseAmount,
    FUN_ITEM_EMOJIS: { Candy: 'candy' },
    getUser: (id) => users[id],
    incrementUser: (id, changes) => {
      for (const [field, value] of Object.entries(changes)) users[id][field] += value;
    },
    getTransferEligibilityError: () => null,
    takeUserItem: () => true, addUserItem: () => [], announceQuestCompletions: () => {},
    db: { transaction: (callback) => ({ immediate: callback }) },
  });
  const source = extract(indexSource, "    if (command === 'give') {", '\n  } catch (error) {');
  vm.runInContext(`async function handleGive(message, userId, args) { const command = 'give'; ${source} }`, ctx);
  const message = { mentions: { users: { first: () => target } }, reply: async (value) => value };
  for (const args of [['coins', '50000001'], ['50.000001m'], ['pokecoins', '1b']]) {
    const result = await ctx.handleGive(message, 'sender', args);
    assert.match(result, /50,000,000.*\.trade/);
    assert.equal(users.sender.coins, 200_000_000);
    assert.equal(users.target.coins, 0);
  }
  assert.match((await ctx.handleGive(message, 'sender', ['coins', '50m'])).content, /50,000,000 PokéCoins/);
  assert.equal(users.sender.coins, 150_000_000);
  assert.equal(users.target.coins, 50_000_000);
  assert.match((await ctx.handleGive(message, 'sender', ['49,999,999'])).content, /49,999,999 PokéCoins/);
  assert.equal(users.target.coins, 99_999_999);
  assert.match((await ctx.handleGive(message, 'sender', ['tokens', '60m'])).content, /60,000,000x Patreon/);
  assert.equal(users.target.patreon_tokens, 60_000_000);
  assert.match((await ctx.handleGive(message, 'sender', ['Candy', '60m'])).content, /60,000,000x Candy/);
});

test('Pokémon transfer paths do not count as fun-item quest progress', () => {
  const transferFlows = [
    extract(indexSource, 'async function handleNameTrade(', '\nconst MULTI_TRADE_MAX_SPECIES'),
    extract(indexSource, 'async function handleGift(', '\nasync function handleTrade('),
    extract(indexSource, 'function executeMultiTrade(', '\nasync function handleMultiTrade('),
  ];
  for (const flow of transferFlows) {
    assert.doesNotMatch(flow, /addUserItem|advanceQuestProgress/);
  }
  assert.doesNotMatch(
    extract(dbSource, 'function recordPokemonTradeStats(', '\n// abilityBoost:'),
    /itemCounts|advanceQuestProgress/
  );
});

test('multi-trade rechecks eligibility before moving balances or Pokémon', () => {
  const db = new Database(':memory:');
  const ctx = vm.createContext({ db, getTransferEligibilityError: () => 'not eligible' });
  vm.runInContext(extract(indexSource, 'function executeMultiTrade(', '\nasync function handleMultiTrade('), ctx);
  assert.equal(ctx.executeMultiTrade({ sides: [{ user: { id: 'one' } }, { user: { id: 'two' } }] }), 'not eligible');
  db.close();
});
