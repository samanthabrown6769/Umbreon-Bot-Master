const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Database = require('better-sqlite3');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder } = require('discord.js');
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

test('server-wide channel boosts apply automatically and stack with manual boosts', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE channel_catch_rate_boosts (
      user_id TEXT NOT NULL, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL,
      PRIMARY KEY (user_id, guild_id, channel_id)
    )`);
    const ctx = vm.createContext({ db, assertUserId: (id) => assert.ok(id) });
    vm.runInContext(extract(dbSource, 'const GUILD_CHANNEL_CATCH_RATE_BOOSTS =', '\nfunction getPokemonFormBySlug('), ctx);
    const server = '1560102297198006274';
    const otherBoostedServer = '1565161395496943709';
    for (const channel of ['existing-channel', 'new-channel']) {
      assert.equal(ctx.getChannelCatchRateBoost('user', server, channel), 5);
      assert.equal(ctx.getChannelCatchRateBoost('another-user', server, channel), 5);
    }
    assert.equal(ctx.getChannelCatchRateBoost('user', otherBoostedServer, 'channel'), 5);
    assert.equal(ctx.getChannelCatchRateBoost('user', 'other-server', 'channel'), 0);
    assert.equal(ctx.addChannelCatchRateBoost('owner', server, 'existing-channel'), 'added');
    assert.equal(ctx.getChannelCatchRateBoost('another-user', server, 'existing-channel'), 10);
    assert.equal(ctx.getChannelCatchRateBoost('another-user', server, 'new-channel'), 5);
    assert.equal(ctx.setChannelCatchRateBoost('owner', server, 'existing-channel', false), true);
    assert.equal(ctx.getChannelCatchRateBoost('user', server, 'existing-channel'), 5);

    const rateCtx = vm.createContext({
      Math: Object.assign(Object.create(Math), { random: () => 1.02 / 167 }),
      LEGENDARY_BASE_CHANCE: 1 / 167, LEGENDARY_GOLDEN_RAZZ_CHANCE: 1 / 125,
      HARD_RARITY_USER_IDS: new Set(), HARD_RARITY_RATE_MULTIPLIER: 1,
      ENCOUNTER_RARITY_WEIGHTS: { normal: { Common: 1 } },
    });
    vm.runInContext(extract(indexSource, 'function chooseEncounterRarity(', '\nfunction getRandomLegendaryFromGenerations('), rateCtx);
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
    getChannelCatchRateBoost: (userId, guildId) => guildId === '1560102297198006274' ? 5 : 0,
    UNLIMITED_CHANNEL_BOOSTER_IDS: new Set(),
  });
  vm.runInContext(`async function run(message, args) {
    const command = 'channel'; const userId = 'user'; ${source}
  }`, ctx);
  const message = {
    guildId: '1560102297198006274', channelId: 'channel',
    author: { username: 'Trainer' }, reply: async (payload) => payload,
  };
  let payload = await ctx.run(message, ['boost']);
  let embed = payload.embeds[0].toJSON();
  assert.match(embed.description, /not manually boosted/);
  assert.match(embed.fields.find((field) => field.name === 'Current channel').value, /\+5 percentage points.*\+5% relative.*server-wide/);
  message.guildId = 'other-server';
  payload = await ctx.run(message, ['boost']);
  embed = payload.embeds[0].toJSON();
  assert.match(embed.fields.find((field) => field.name === 'Current channel').value, /No channel or server-wide/);
  message.guildId = null;
  payload = await ctx.run(message, ['boost']);
  assert.equal(payload.embeds[0].toJSON().fields.some((field) => field.name === 'Current channel'), false);
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
  const eventSource = extract(indexSource, 'const EVENT_SPAWN_ODDS =', '\nlet eventSpawnFormIds');
  let roll = 0;
  const math = Object.create(Math);
  math.random = () => roll;
  const ctx = vm.createContext({
    Math: math, LEGENDARY_BASE_CHANCE: 1 / 167,
    LEGENDARY_GOLDEN_RAZZ_CHANCE: 1 / 125, HARD_RARITY_USER_IDS: new Set(),
    HARD_RARITY_RATE_MULTIPLIER: 1, ENCOUNTER_RARITY_WEIGHTS: { normal: { Common: 1 } },
  });
  vm.runInContext(`${legendarySource}\n${eventSource}`, ctx);
  roll = 0.0015;
  assert.equal(ctx.chooseEncounterRarity('normal', false, 0), 'Legendary');
  roll = 1 / 167;
  assert.equal(ctx.chooseEncounterRarity('normal', false, 0), 'Common');
  assert.equal(ctx.getEventSpawnChance(), 1 / 500);
  assert.equal(ctx.getEventSpawnChance(50), 1.5 / 500);
  assert.match(indexSource, /const EVENT_SPAWN_ODDS = 500;/);
  assert.match(indexSource, /const EVENT_SPAWN_PITY_MIN = 300;/);
  assert.match(indexSource, /const EVENT_SPAWN_PITY_LIMIT = 500;/);
  assert.match(indexSource, /const WILD_SHINY_PITY_MIN = 1000;/);
  assert.match(indexSource, /const WILD_SHINY_PITY_LIMIT = 2000;/);
  assert.match(indexSource, /const LEGENDARY_BASE_CHANCE = 1 \/ 167;/);
  assert.match(indexSource, /const LEGENDARY_SPAWN_PITY_LIMIT = 167;/);
  assert.match(indexSource, /const LEGENDARY_GOLDEN_RAZZ_CHANCE = 1 \/ 125;/);
  assert.match(indexSource, /const BASE_SHINY_RATE = 1 \/ 1000;/);
  assert.match(indexSource, /const FULL_ODDS_SHINY_PITY_LIMIT = 750;/);
  assert.match(indexSource, /const PATREON_SHINY_RATE = 1 \/ 500;/);
  assert.match(indexSource, /patreon: \{ event: 1 \/ 50, nonEvent: 1 \/ 250 \}/);
  assert.match(indexSource, /standard: \{ event: 1 \/ 100, nonEvent: 1 \/ 500 \}/);
  assert.match(indexSource, /name: 'Good Rod',\s+baseShinyRate: 1 \/ 1250,/);
  assert.match(indexSource, /name: 'Super Rod',\s+baseShinyRate: 1 \/ 625,/);
  assert.match(indexSource, /name: 'Golden Rod',\s+baseShinyRate: 1 \/ 625,/);
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

test('Grimer and Muk use their supplied shiny sprite emojis', () => {
  const spriteMap = extract(indexSource, 'const POKEMON_SPRITE_EMOJIS = Object.freeze(', '\nconst EXACT_ONLY_SPRITE_KEYS');
  const exactOnly = extract(indexSource, 'const EXACT_ONLY_SPRITE_KEYS =', '\nfunction getPokemonSpriteEmoji(');
  const ctx = vm.createContext({});
  vm.runInContext(
    `${spriteMap}\n${exactOnly}\n${extract(indexSource, 'function getPokemonSpriteEmoji(', '\nfunction formatFactionFavorites(')}`,
    ctx
  );
  assert.equal(ctx.getPokemonSpriteEmoji({ name: 'Grimer', isShiny: true }), '<:SGrimer:1569451545236611152>');
  assert.equal(ctx.getPokemonSpriteEmoji({ name: 'Muk', isShiny: true }), '<:SMuk:1569451543160430724>');
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
    CREATE TABLE catches (id INTEGER PRIMARY KEY, user_id TEXT, pokemon_id INTEGER, is_shiny INTEGER, rarity TEXT);
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
    INSERT INTO catches VALUES (1, 'trainer', 1, 1, 'Legendary');
    INSERT INTO catches VALUES (2, 'other', 2, 0, 'Common');
    INSERT INTO users VALUES ('trainer', 10, 5, 2, 1), ('other', 1, 1, 0, 0);
    INSERT INTO user_items VALUES ('trainer', 'Candy', 2);
    INSERT INTO pokemon_gifts VALUES ('other', 'trainer');
  `);
  const ctx = vm.createContext({ db });
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
  assert.match(indexSource, /box\.rarity, false, true, true, \[\], box\.excludedSpeciesNames \|\| \[\]/);
  db.close();
});

test('starter and Daily Hunt encounters use their increased spawn chances', () => {
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
  roll = 0.2;
  assert.equal(ctx.getRandomPokemon('Uncommon').name, 'Litten');

  const huntChanceContext = vm.createContext({});
  vm.runInContext(
    extract(indexSource, 'const DAILY_HUNT_SPAWN_BOOST_CHANCE =', '\nfunction getActiveHuntTarget'),
    huntChanceContext
  );
  assert.equal(vm.runInContext('DAILY_HUNT_SPAWN_BOOST_CHANCE', huntChanceContext), 0.25);
  db.close();
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
  vm.runInContext(extract(indexSource, 'function rollSpawn(', '\nfunction isEventChecklistSpawn('), ctx);
  const rod = { enablesLegendary: true, enablesShiny: true, baseShinyRate: 1 / 1000 };
  rolls = [0.0015, 0.9];
  assert.equal(ctx.rollSpawn('water', 'user', rod).rarity, 'Legendary');
  rolls = [1 / 167, 0.9, 0.9];
  assert.equal(ctx.rollSpawn('water', 'user', rod).rarity, 'Common');
  rolls = [0.00015, 0.9];
  assert.equal(ctx.rollSpawn('water', 'user', rod, { catchbot: true }).rarity, 'Legendary');
  rolls = [1 / 1670 + 1e-10, 0.9, 0.9];
  assert.equal(ctx.rollSpawn('water', 'user', rod, { catchbot: true }).rarity, 'Common');
  rolls = [1 / 1670 + 1e-10, 0.9, 0.9];
  assert.equal(ctx.rollSpawn('land', 'user', null, { catchbot: true }).rarity, 'Common');
  rolls = [0.5, 0.5, 0.000999];
  assert.equal(ctx.rollSpawn('water', 'user', rod).isShiny, true);
  rolls = [0.5, 0.5, 0.001];
  assert.equal(ctx.rollSpawn('water', 'user', rod).isShiny, false);
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
  let eventSpawnPity = 299;
  let encounterPity = { legendary: 0, shiny: 0 };
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
    advanceEventSpawnPity: () => { eventSpawnPity += 1; return eventSpawnPity; },
    resetEventSpawnPity: () => { eventSpawnPity = 0; },
    advanceEncounterPity: (_userId, category) => { encounterPity[category] += 1; return encounterPity[category]; },
    resetEncounterPity: (_userId, category) => { encounterPity[category] = 0; },
    advanceWildShinyPity: () => { encounterPity.shiny += 1; return encounterPity.shiny + 1000; },
    resetWildShinyPity: () => { encounterPity.shiny = 0; },
    HARD_RARITY_USER_IDS: new Set(), HARD_RARITY_RATE_MULTIPLIER: 1,
    getRaritySettings: () => raritySettings,
    getRandomPokemon: (rarity, water, a, b, excluded, species, ids) => {
      const id = ids ? ids[0] : 4;
      return { id, name: names[id], speciesName: names[id], rarity: rarity || 'Common' };
    },
    SPECIAL_SPAWN_RESERVED_SPECIES: [], EXPLORE_EXCLUSIVE_SHINY_IDS: new Set(),
    EVENT_NON_FISH_SPECIES: [],
    EVENT_FISH_SPAWN_FORM_IDS: [], eventSpawnFormIds: [],
    LEGENDARY_BASE_CHANCE: 1 / 167,
    LEGENDARY_GOLDEN_RAZZ_CHANCE: 1 / 125,
    LEGENDARY_SPAWN_PITY_LIMIT: 167,
    FULL_ODDS_SHINY_PITY_LIMIT: 750,
    WILD_SHINY_PITY_MIN: 1000, WILD_SHINY_PITY_LIMIT: 2000,
    EVENT_TICKET_SHINY_RATES: {
      standard: { event: 0.01, nonEvent: 0.001 }, patreon: { event: 0.02, nonEvent: 0.002 },
    },
    BASE_SHINY_RATE: 0.001, PATREON_SHINY_RATE: 0.002,
    CATCHBOT_SHINY_MULTIPLIER: 0.25, INCENSE_BOOST: 1.1,
    EGG_ONLY_SHINY_SPECIES_KEYS: new Set(), FISH_ONLY_SHINY_KEYS: new Set(),
    FISH_PATREON_ONLY_SHINY_KEYS: new Set(),
  });
  vm.runInContext(
    extract(indexSource, 'const EVENT_SPAWN_ODDS =', '\nlet eventSpawnFormIds')
      + '\n' + extract(indexSource, 'function rollSpawn(', '\nconst EXPLORE_GOLDEN_CHANCE')
      + '\n' + extract(indexSource, 'function getEventPokemonKey(', '\nfunction getRarityInfo('),
    ctx
  );
  const rod = { enablesLegendary: true, enablesShiny: true, baseShinyRate: 0.001 };
  const fishEvent = (selectionRoll, options = {}) => {
    eventSpawnPity = 299;
    rolls = [0, selectionRoll];
    return ctx.rollSpawn('water', 'user', rod, options);
  };
  eventSpawnPity = 299;
  rolls = [1 / 500 - 1e-10, 0];
  assert.equal(ctx.rollSpawn('water', 'user', rod).id, 1);
  eventSpawnPity = 299;
  rolls = [(1 + 5 / 100) / 500 - 1e-10, 0];
  assert.equal(ctx.rollSpawn('water', 'user', rod, { roleChanceBoost: 5 }).id, 1);
  eventSpawnPity = 299;
  rolls = [(1 + 5 / 100) / 500, 0.5, 0.1, 0.001];
  assert.equal(ctx.rollSpawn('water', 'user', rod, { roleChanceBoost: 5 }).id, 4);
  assert.equal(fishEvent(0.52).id, 2);
  assert.deepEqual(selectedWeights, [1 / 0.95, 1]);
  bonusActive = true;
  const boundary = 1.25 / (1.25 + 0.95);
  assert.equal(fishEvent(boundary - 1e-8).id, 1);
  assert.equal(fishEvent(boundary + 1e-8).id, 2);
  assert.equal(fishEvent(0.9).id, 2);
  eventSpawnPity = 299;
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
    fishEvent(0);
    const weight = baseline * (tier ? 2 : 1) * (1 + eventPct / 100) / (1 - charm / 100);
    assert.ok(Math.abs(selectedWeights[0] - weight) < 1e-12, `${tier} event shiny weight`);
    assert.equal(selectedWeights[1], 1, `${tier} regular event weight`);
    const ordinaryChance = (tier ? 0.002 : 0.001) * (1 + ordinaryPct / 100) / (1 - charm / 100);
    eventSpawnPity = 299;
    rolls = [1 / 500, 0.5, ordinaryChance - 1e-10];
    assert.equal(ctx.rollSpawn('water', 'user', rod).isShiny, true, `${tier} ordinary shiny below threshold`);
    eventSpawnPity = 299;
    rolls = [1 / 500, 0.5, ordinaryChance + 1e-10];
    assert.equal(ctx.rollSpawn('water', 'user', rod).isShiny, false, `${tier} ordinary shiny above threshold`);
  }
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

  // A non-event encounter at the ordinary shiny threshold stays non-shiny.
  eventSpawnPity = 299;
  rolls = [1 / 500, 0.5, 0.001];
  assert.equal(ctx.rollSpawn('water', 'user', rod).isShiny, false);
  ticket = false;
  rolls = [0.5, 0.001];
  assert.equal(ctx.rollSpawn('water', 'user', rod).isShiny, false);
  ticket = true;
  eventOpen = false;
  rolls = [0.5, 0.001];
  assert.equal(ctx.rollSpawn('water', 'user', rod).isShiny, false);
  eventOpen = true;
  rolls = [0.5, 0.00025];
  assert.equal(ctx.rollSpawn('water', 'user', rod, { catchbot: true }).isShiny, false);

  eventSpawnPity = 0;
  for (let encounter = 1; encounter < 500; encounter += 1) {
    rolls = encounter < 300 ? [0.5, 1] : [0.5, 0.5, 1];
    assert.equal(ctx.rollSpawn('water', 'user', rod).id, 4);
  }
  assert.equal(eventSpawnPity, 499);
  rolls = [0];
  assert.equal(ctx.rollSpawn('water', 'user', rod).id, 1);
  assert.equal(eventSpawnPity, 0);

  ticket = false;
  raritySettings = [
    { name: 'Common', spawn_weight: 1, pokemon_count: 1 },
    { name: 'Legendary', spawn_weight: 1, pokemon_count: 1 },
  ];
  encounterPity = { legendary: 166, shiny: 999 };
  ctx.rollEncounterLegendary = () => ({ id: 5, name: 'Legendary', speciesName: 'Legendary', rarity: 'Legendary' });
  rolls = [0.5];
  const guaranteedEncounter = ctx.rollSpawn('water', 'user', {
    enablesLegendary: true, enablesShiny: true, baseShinyRate: 0.001,
  });
  assert.equal(guaranteedEncounter.rarity, 'Legendary');
  assert.equal(guaranteedEncounter.isShiny, true);
  assert.deepEqual(encounterPity, { legendary: 0, shiny: 0 });
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

test('Simple Beam affects world boss stat changes across switches and damaging moves', () => {
  const math = Object.create(Math);
  math.random = () => 0.5;
  const acid = { name: 'Acid Spray', type: 'poison', power: 40, category: 'special' };
  const pool = [{ id: 1, name: 'Boss', baseHp: 50, baseAtk: 50, baseDef: 50, baseSpd: 50 }];
  const ctx = vm.createContext({
    Math: math, battleFx: battle, WORLD_BOSS_POOL: pool, WORLD_BOSS_DUMMY_HP: 1600,
    WORLD_BOSS_PLAYER_DAMAGE_MULTIPLIER: 0.5, EMOJIS: {},
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

  const normal = battleContext();
  battle.performMove(normal, { mon: normal.player, side: 'player' }, { mon: normal.enemy, side: 'enemy' },
    { name: 'Simple Beam', accuracy: 100, power: 0 }, () => {});
  assert.equal(normal.enemy.ability, undefined);
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

test('cooldown exemption toggle is self-only, restricted, and applies to eligible commands', async () => {
  const users = {
    exempt: { cooldown_exemption_disabled: 0 },
    admin: { cooldown_exemption_disabled: 0 },
    ordinary: { cooldown_exemption_disabled: 0 },
  };
  const ctx = vm.createContext({
    COOLDOWN_EXEMPT_USER_IDS: new Set(['exempt']),
    isConfiguredBotAdmin: (message) => message.author.id === 'admin',
    getUser: (id) => users[id],
    updateUser: (id, values) => Object.assign(users[id], values),
    PREFIX: '.',
  });
  vm.runInContext(
    extract(indexSource, 'function hasCooldownExemption(', '\nfunction applyGuaranteedPveBattleWin(')
      + `\nasync function toggle(message, userId, args) {
        const command = 'admin';
        ${extract(indexSource, "    if (command === 'admin' && args[0]?.toLowerCase() === 'toggle'", "\n    if (command === 'admin' || command === 'admingive')")}
      }`,
    ctx
  );
  const message = (id) => ({ author: { id }, reply: (text) => text });
  assert.equal(ctx.hasCooldownExemption('exempt'), true);
  assert.equal(ctx.isEncounterCooldownExempt(message('admin'), 'admin'), true);
  assert.equal(ctx.hasCooldownExemption('admin'), false);
  assert.match(await ctx.toggle(message('ordinary'), 'ordinary', ['toggle', 'cooldown', 'off']), /Only users/);
  assert.match(await ctx.toggle(message('exempt'), 'exempt', ['toggle', 'cooldown', 'off', 'ordinary']), /Usage/);
  assert.match(await ctx.toggle(message('exempt'), 'exempt', ['toggle', 'cooldown', 'on']), /now \*\*on/);
  assert.equal(ctx.hasCooldownExemption('exempt'), false);
  assert.equal(ctx.isEncounterCooldownExempt(message('exempt'), 'exempt'), false);
  assert.match(await ctx.toggle(message('exempt'), 'exempt', ['toggle', 'cooldown', 'off']), /now \*\*off/);
  assert.equal(ctx.hasCooldownExemption('exempt'), true);
  await ctx.toggle(message('admin'), 'admin', ['toggle', 'cooldown', 'on']);
  assert.equal(ctx.isEncounterCooldownExempt(message('admin'), 'admin'), false);
  await ctx.toggle(message('admin'), 'admin', ['toggle', 'cooldown', 'off']);
  assert.equal(ctx.isEncounterCooldownExempt(message('admin'), 'admin'), true);
  assert.equal(users.ordinary.cooldown_exemption_disabled, 0);
  assert.match(indexSource, /const cooldownExempt = hasCooldownExemption\(userId\);/);
  assert.equal((indexSource.match(/const cooldownExempt = isEncounterCooldownExempt\(message, userId\);/g) || []).length, 2);
  assert.match(dbSource, /cooldown_exemption_disabled: 'INTEGER NOT NULL DEFAULT 0'/);
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
  assert.equal(db.prepare('SELECT event_ticket FROM users').get().event_ticket, 0);
  db.prepare("DELETE FROM event_announcement_channels WHERE event_id='new'").run();
  vm.runInContext('refreshCurrentEvent();', context);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM event_announcement_channels WHERE event_id='new'").get().n, 0);
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
    syncDuplicateCatchState: () => {}, recordPokemonSeen: () => {},
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
    syncDuplicateCatchState: () => {}, recordPokemonSeen: () => {},
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
    syncDuplicateCatchState: () => {}, recordPokemonSeen: () => {},
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
  assert.equal(db.prepare("SELECT enabled FROM autospawn_channels WHERE guild_id='other'").get().enabled, 0);
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

test('scheduled autospawns preserve chat progress and disallowed servers cannot spawn', async () => {
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
  assert.equal(sent, 2);
  const secondGuildId = '1566723679994380288';
  const secondConfig = { guild_id: secondGuildId, channel_id: 'new-allowed-channel', message_count: 0, message_target: 15 };
  await ctx.triggerAutoSpawn(
    { ...channel, id: secondConfig.channel_id, guildId: secondGuildId },
    secondConfig,
    { count: 0, nextTarget: 15, active: false }
  );
  assert.equal(sent, 3);
  db.close();
});

test('scheduler ignores other servers and the chat counter triggers at 500', async () => {
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
  const guild = { id: guildId, channels: { cache: new Map([[channel.id, channel]]) } };
  const fetched = [];
  ctx.client.guilds.fetch = async (id) => { fetched.push(id); return guild; };
  ctx.getAllAutoSpawnChannels = () => [
    { guild_id: 'other', channel_id: 'other-channel', message_count: 0, message_target: 15 },
    { guild_id: guildId, channel_id: channel.id, message_count: 499, message_target: 500 },
  ];
  db.prepare('UPDATE autospawn_channels SET message_count=499 WHERE guild_id=?').run(guildId);
  await ctx.runScheduledAutospawns();
  assert.deepEqual(fetched, [guildId]);
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

test('autospawn command requires a bot admin and an allowed server', async () => {
  const source = extract(indexSource, "    if (command === 'autospawn') {", "\n    if (command === 'lottery'");
  const ctx = vm.createContext({
    AUTOSPAWN_GUILD_IDS: new Set(['1560102297198006274', '1566723679994380288']),
    isBotAdmin: (message) => message.isAdmin, PREFIX: '.', ChannelType: { GuildText: 0 },
    setAutoSpawnChannel: () => { ctx.setCalled = true; }, autospawnStates: new Map(),
  });
  vm.runInContext(`async function run(message, args) { const command = 'autospawn'; ${source} }`, ctx);
  const message = {
    guildId: '1560102297198006274', isAdmin: false, member: { permissions: { has: () => true } },
    channel: { guildId: '1560102297198006274', type: 0, id: 'channel' },
    mentions: { channels: { first: () => null } }, reply: (text) => text,
  };
  assert.match(await ctx.run(message, ['set']), /Only bot admins/);
  message.isAdmin = true;
  message.guildId = 'other';
  assert.match(await ctx.run(message, ['set']), /designated server/);
  assert.equal(ctx.setCalled, undefined);
  message.guildId = '1566723679994380288';
  message.channel.guildId = message.guildId;
  assert.match(await ctx.run(message, ['set']), /15–500/);
  assert.equal(ctx.setCalled, true);
  ctx.setCalled = false;
  message.guildId = '1560102297198006274';
  message.channel.guildId = message.guildId;
  assert.match(await ctx.run(message, ['set']), /15–500/);
  assert.equal(ctx.setCalled, true);
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
      moves TEXT, caught_ball TEXT);
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
  assert.equal(ctx.getUser('new').total_catches, 3);
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
