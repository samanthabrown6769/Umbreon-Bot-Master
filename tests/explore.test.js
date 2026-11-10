const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const Database = require('better-sqlite3');
const data = require('../exploreData');
const renderer = require('../exploreRenderer');
const chests = require('../exploreChests');

const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');
function extract(start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `Could not extract ${start}`);
  return source.slice(first, last);
}

function patreonPerks() {
  const dbSource = fs.readFileSync(require.resolve('../db.js'), 'utf8');
  const start = dbSource.indexOf('const NO_PATREON_PERKS =');
  const end = dbSource.indexOf('\nconst BASE_INCENSE_CHARGES', start);
  return vm.runInNewContext(`${dbSource.slice(start, end)}\n({ none: NO_PATREON_PERKS, tiers: PATREON_TIER_PERKS })`);
}

test('Explore chests spawn within reach, last 5–15 movements, and have one-time special rewards', () => {
  for (const value of [0, 0.1, 0.5, 0.999999]) {
    const chest = chests.spawnExploreChest(128, 128, 608, 608, 32, () => value);
    assert.ok(chest.x >= 0 && chest.x <= 608 && chest.y >= 0 && chest.y <= 608);
    assert.ok(Math.max(Math.abs(chest.x - 128), Math.abs(chest.y - 128)) <= 128);
    assert.ok(chest.x !== 128 || chest.y !== 128);
    assert.equal(chest.stepsRemaining, 5 + Math.floor(value * 11));
  }
  const basic = [{ field: 'repels', min: 1, max: 1 }];
  const select = (user, ...rolls) => chests.chooseExploreChestReward(user, basic, () => rolls.shift());
  assert.equal(select({}, 0).special, 'shiny');
  assert.equal(select({}, 0.009999).special, 'shiny');
  assert.equal(select({}, 0.01).special, 'amulet');
  assert.equal(select({}, 0.019999).special, 'amulet');
  assert.equal(select({}, 0.02, 0, 0).field, 'repels');
  assert.equal(select({ explore_shiny_charm: 1 }, 0, 0, 0).field, 'repels');
  assert.equal(select({ explore_amulet_coin: 1 }, 0.01, 0, 0).field, 'repels');
});

test('Explore reward bonuses add to existing Amulet and Shiny totals without modifying shop counts', () => {
  const dbSource = fs.readFileSync(require.resolve('../db.js'), 'utf8');
  const section = (start, end) => dbSource.slice(dbSource.indexOf(start), dbSource.indexOf(end, dbSource.indexOf(start)));
  const user = { amulet_coins: 10, shiny_charms: 5, explore_amulet_coin: 1, explore_shiny_charm: 1, black_market_charm: 0 };
  const ctx = vm.createContext({
    getUser: () => user, getPlayerClan: () => null,
    getClanPerkMultipliers: () => ({ amuletCoins: 2, srBonus: 3 }),
    getPatreonPerks: () => ({ amuletCoins: 4, shinyCharms: 1 }),
  });
  vm.runInContext(section('function getAmuletCoinBoost(', '\nfunction awardCoinsWithBoost('), ctx);
  vm.runInContext(section('function getTotalEffectiveShinyBonus(', '\n// perkCatches'), ctx);
  assert.equal(ctx.getAmuletCoinBoost('user').totalEffective, 17);
  assert.equal(ctx.getAmuletCoinBoost('user').owned, 10);
  assert.equal(ctx.getTotalEffectiveShinyBonus('user'), 10);
  assert.equal(user.amulet_coins, 10);
  assert.equal(user.shiny_charms, 5);
});

test('Explore catch bonuses exclude clan perks but retain Patreon and channel bonuses', () => {
  const ctx = vm.createContext({ getExploreCatchRate: data.getExploreCatchRate, HELD_ITEM_CATCH_RATES: { Rare: { pb: 25 } },
    PREMIERBALL_RATES: {} });
  vm.runInContext(extract('function getEncounterCatchBonus(', '\nfunction getCatchCoinReward('), ctx);
  const ball = { bonus: 0 };
  const explore = { isExplore: true };
  const ordinary = { isExplore: false };
  assert.equal(ctx.getEncounterCatchBonus(explore, 20, 5), 5);
  assert.equal(ctx.getEncounterCatchBonus(ordinary, 20, 5), 25);
  assert.equal(ctx.getBallCatchRate('pb', ball, explore, 'Rare', 42,
    ctx.getEncounterCatchBonus(explore, 20, 5), 3), 50);
  assert.equal(ctx.getBallCatchRate('pb', ball, { isExplore: true, heldItem: 'Seed' }, 'Rare', 42,
    ctx.getEncounterCatchBonus(explore, 20, 5), 3), 33);
  assert.equal(ctx.getBallCatchRate('pb', ball, { heldItem: 'Seed' }, 'Rare', 42,
    ctx.getEncounterCatchBonus(ordinary, 20, 5), 3), 53);
  assert.equal(ctx.getBallCatchRate('pb', ball, ordinary, 'Rare', 42,
    ctx.getEncounterCatchBonus(ordinary, 20, 5), 3), 70);
});

test('Explore encounters skip held-item rolls and faction-hunt bonuses without removing base faction points', () => {
  let rolls = 0;
  const ctx = vm.createContext({
    target: { isExplore: true, speciesId: 25 }, userId: 'trainer', mode: 'catch', counterSource: null,
    rollWildHeldItem: () => { rolls += 1; return { name: 'Seed', emoji: '🌱' }; },
    getPokemonFactionTeam: (id) => id === 25 ? { id: 'rocket', emoji: '🚀' } : null,
    getUserFaction: () => ({ faction_key: 'rocket' }),
    getFactionCatchPoints: () => 100,
    selectedBall: 'pb', catchDisplayRarity: 'Common',
    addFactionPoints: (_id, points, options) => { ctx.points = points; ctx.speciesId = options.speciesId; },
  });
  vm.runInContext(extract('  if (!target.isExplore && !target.heldItem && !target.heldItemRolled) {', '\n  const user = getUser(userId);'), ctx);
  assert.equal(rolls, 0);
  assert.equal(ctx.target.heldItem, undefined);
  vm.runInContext(extract('function factionLogoPrefix(', '\nfunction heldItemEncounterHint('), ctx);
  assert.equal(ctx.factionLogoPrefix(ctx.target), '');
  const factionCatch = extract('    const catchFaction = getUserFaction(userId);', '\n    trackClanActivity(');
  vm.runInContext(`{ ${factionCatch} }`, ctx);
  assert.equal(ctx.points, 100);
  assert.equal(ctx.speciesId, null);
  ctx.target = { speciesId: 25 };
  vm.runInContext(extract('  if (!target.isExplore && !target.heldItem && !target.heldItemRolled) {', '\n  const user = getUser(userId);'), ctx);
  assert.equal(rolls, 1);
  assert.equal(ctx.target.heldItem, 'Seed');
  assert.equal(ctx.factionLogoPrefix(ctx.target), '🚀 ');
  vm.runInContext(`{ ${factionCatch} }`, ctx);
  assert.equal(ctx.speciesId, 25);
});

test('Explore map selectors choose the exact map and reject invalid choices', () => {
  for (const [args, mapKey, backgroundIndex] of [
    [['gm', '1'], 'grass', 0], [['GM', '2'], 'grass', 1],
    [['fm', '1'], 'fire', 0], [['wm', '1'], 'water', 0],
    [[], 'grass', null], [['grass'], 'grass', null], [['fire'], 'fire', null], [['water'], 'water', null],
  ]) {
    assert.deepEqual(data.selectExploreMap(args), { mapKey, backgroundIndex });
  }
  for (const args of [['gm'], ['gm', '0'], ['gm', '3'], ['fm', '2'], ['wm', '2'], ['wm', '1', 'extra'], ['__proto__', '1']]) {
    assert.equal(data.selectExploreMap(args), null);
  }
});

test('Explore testing access grants only the specified testers and bot admins', () => {
  const context = vm.createContext({ isBotAdmin: (message) => message.author.id === 'admin' });
  vm.runInContext(extract('const EXPLORE_TESTER_IDS =', '\nfunction hasCooldownExemption('), context);
  for (const id of ['1352997432929288194', '378623134816927745', '183625933041827840', 'admin']) {
    assert.equal(context.isExploreTester({ author: { id } }), true);
  }
  assert.equal(context.isExploreTester({ author: { id: 'other' } }), false);
});

test('Explore catalog pools use matching types and exclude special and event-only species', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE pokemon_forms (
    id INTEGER, species_id INTEGER, species_name TEXT, name TEXT, rarity TEXT, types TEXT,
    is_default INTEGER, is_legendary INTEGER, is_mythical INTEGER
  )`);
  const insert = db.prepare('INSERT INTO pokemon_forms VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const row of [
    [1, 1, 'Bulbasaur', 'Bulbasaur', 'Uncommon', '["grass","poison"]', 1, 0, 0],
    [2, 2, 'Oddish', 'Oddish', 'Common', '["grass","poison"]', 1, 0, 0],
    [3, 3, 'Charmander', 'Charmander', 'Uncommon', '["fire"]', 1, 0, 0],
    [4, 4, 'Squirtle', 'Squirtle', 'Uncommon', '["water"]', 1, 0, 0],
    [5, 5, 'Reserved', 'Reserved', 'Common', '["grass"]', 1, 0, 0],
    [6, 6, 'Legend', 'Legend', 'Legendary', '["grass"]', 1, 1, 0],
    [7, 7, 'Mythical', 'Mythical', 'Common', '["grass"]', 1, 0, 1],
    [8, 8, 'Event', 'Event', 'Common', '["grass"]', 1, 0, 0],
    [9, 9, 'Mega', 'Mega', 'Mega', '["grass"]', 1, 0, 0],
    [10, 10, 'Form', 'Form', 'Common', '["grass"]', 0, 0, 0],
  ]) insert.run(...row);
  let eventActive = true;
  const context = vm.createContext({
    db, Date, EXPLORE_MAPS: data.EXPLORE_MAPS, SPECIAL_SPAWN_RESERVED_SPECIES: ['Reserved'],
    isEventOpen: () => eventActive, halloweenEvent: {}, getEventPokemonKey: (row) => row.name === 'Event',
  });
  vm.runInContext(extract('const exploreCatalogCache =', '\nconst EXPLORE_GOLDEN_CHANCE'), context);
  const ids = (map) => Array.from(context.getExploreCatalogEntries(map), (row) => row.species_id);
  assert.deepEqual(ids('grass'), [1, 2]);
  assert.deepEqual(ids('fire'), [3]);
  assert.deepEqual(ids('water'), [4]);
  eventActive = false;
  assert.deepEqual(ids('grass'), [1, 2, 8]);
  assert.throws(() => context.getExploreCatalogEntries('invalid'), /Unknown Explore map/);
  db.close();
});

test('Explore merges configured map Pokémon with typed catalog entries without duplicates', () => {
  const math = Object.create(Math);
  let roll = 0;
  math.random = () => roll;
  const context = vm.createContext({
    Math: math, EXPLORE_EXCLUSIVES: { grass: [[1, 'Uncommon', false]] },
    getExploreCatalogEntries: () => [
      { species_id: 1, rarity: 'Uncommon' }, { species_id: 2, rarity: 'Common' },
    ],
    db: { prepare: () => ({ get: (id) => ({
      id, species_id: id, slug: `pokemon-${id}`, name: `Pokemon ${id}`, species_name: `Pokemon ${id}`,
      rarity: 'Common', types: '["grass"]', is_default: 1,
    }) }) },
  });
  vm.runInContext(extract('const EXPLORE_GOLDEN_CHANCE', '\nfunction rollExploreEncounter('), context);
  roll = 59 / 140;
  assert.equal(context.rollExploreExclusive('grass').dex, 1);
  roll = 60 / 140;
  const ordinary = context.rollExploreExclusive('grass');
  assert.equal(ordinary.dex, 2);
  assert.equal(ordinary.canShiny, true);
});

test('provided Pokémon emojis map to the correct normal and Golden variants', () => {
  const context = vm.createContext({});
  vm.runInContext(extract('const POKEMON_SPRITE_EMOJIS =', '\nfunction formatFactionFavorites('), context);
  const normal = {
    bulbasaur: '1569731188774404146', charmander: '1569731185532215349', squirtle: '1569731183041052754',
    chikorita: '1569731181480513647', cyndaquil: '1569731179911839846', totodile: '1569731177303113768',
    treecko: '1569731174816022688', torchic: '1569731171347075092', mudkip: '1569731168088232066',
    turtwig: '1569731166573957222', chimchar: '1569731164971995176', piplup: '1569731162727776287',
    snivy: '1569731160832082025', tepig: '1569731158680543344', oshawott: '1569731157006753902',
    chespin: '1569731154871844944', fennekin: '1569731151688368268', froakie: '1569731145548046506',
    rowlet: '1569731143824052364', litten: '1569731141785755809', popplio: '1569731140267548782',
    grookey: '1569731138501611591', scorbunny: '1569731136739876874', sobble: '1569731134701707364',
    sprigatito: '1569731132793163787', fuecoco: '1569731131551649813', quaxly: '1569731130016407653',
  };
  const golden = {
    treecko: '1569731127269392447', litten: '1569731124777717823', piplup: '1569731123251122196',
    chinchou: '1569731121153966200', munchlax: '1569731119342030888',
  };
  for (const [name, id] of Object.entries(normal)) assert.match(context.getPokemonSpriteEmoji({ name }), new RegExp(id));
  for (const [name, id] of Object.entries(golden)) assert.match(context.getPokemonSpriteEmoji({ name, isGolden: true }), new RegExp(id));
  assert.match(context.getPokemonSpriteEmoji({ name: 'Sprigatito', isShiny: true }), /1567588638194409512/);
});

test('Patreon tiers provide the requested Explore limits and Golden bonus', () => {
  const perks = patreonPerks();
  assert.equal(perks.none.exploreSteps, 0);
  assert.equal(perks.none.exploreSeconds, 0);
  for (const [tier, [steps, seconds]] of Object.entries({
    common: [500, 90], uncommon: [2500, 100], rare: [4000, 120], superRare: [4500, 150],
    legendary: [5000, 180], shiny: [5500, 210], golden: [6000, 240],
  })) {
    assert.equal(perks.tiers[tier].exploreSteps, steps);
    assert.equal(perks.tiers[tier].exploreSeconds, seconds);
    assert.equal(perks.tiers[tier].goldenBoost, tier === 'golden' ? 0.25 : 0);
  }
});

test('Explore step status matches the rolling reset and current tier', () => {
  const now = 100000000;
  const user = { has_patreon: 1, explore_steps_today: 600, last_explore_reset: now - 1000 };
  assert.deepEqual(data.getExploreStepStatus(user, { exploreSteps: 500 }, now), {
    limit: 500, used: 600, resetAt: now - 1000 + 86400000,
  });
  assert.deepEqual(data.getExploreStepStatus(user, { exploreSteps: 2500 }, now + 86400000), {
    limit: 2500, used: 0, resetAt: null,
  });
  user.has_patreon = 0;
  assert.equal(data.getExploreStepStatus(user, { exploreSteps: 500 }, now).limit, 0);
});

test('Explore overworld abilities apply their own rates and repel only Common encounters', () => {
  const abilityCtx = vm.createContext({});
  vm.runInContext(extract('function getOverworldEncounterMultiplier(', '\nfunction getFishingAbilityMultiplier('), abilityCtx);
  assert.equal(abilityCtx.getExploreEncounterMultiplier('arena-trap'), 1.1);
  assert.equal(abilityCtx.getExploreEncounterMultiplier('no-guard'), 1.1);
  assert.equal(abilityCtx.getExploreEncounterMultiplier('illuminate'), 2);
  assert.equal(abilityCtx.getExploreEncounterMultiplier('swarm'), 1.5);
  let rolls = [];
  const math = Object.create(Math);
  math.random = () => { assert.ok(rolls.length); return rolls.shift(); };
  const context = vm.createContext({
    Math: math, EXPLORE_EXCLUSIVES: { grass: [[1, 'Common', false], [2, 'Uncommon', false]] },
    getExploreCatalogEntries: () => [],
    EXPLORE_GOLDENS: {}, db: { prepare: () => ({ get: (id) => ({
      id, species_id: id, slug: `pokemon-${id}`, name: `Pokemon ${id}`, species_name: `Pokemon ${id}`,
      rarity: 'Common', types: '["normal"]', is_default: 1,
    }) }) },
    getUser: () => ({ has_patreon: 0 }), getPatreonPerks: () => ({ shinyRatePct: 0, goldenBoost: 0 }),
    getTotalEffectiveShinyBonus: () => 0, BASE_SHINY_RATE: 0.001, PATREON_SHINY_RATE: 0.002,
    HARD_RARITY_USER_IDS: new Set(), HARD_RARITY_RATE_MULTIPLIER: 1,
    EGG_ONLY_SHINY_SPECIES_KEYS: new Set(), FISH_ONLY_SHINY_KEYS: new Set(),
    advanceEncounterPity: () => { throw new Error('Repelled encounter must not advance shiny pity'); },
    resetEncounterPity: () => {}, FULL_ODDS_SHINY_PITY_LIMIT: 750,
  });
  vm.runInContext(extract('const EXPLORE_GOLDEN_CHANCE', '\nfunction getEventPokemonKey('), context);
  for (const ability of ['intimidate', 'keen-eye']) {
    rolls = [0, 0.299999];
    assert.equal(context.rollExploreEncounter('user', 'grass', 0, ability), null);
    rolls = [0, 0.3];
    assert.equal(context.rollExploreEncounter('user', 'grass', 0, ability).speciesId, 1);
    rolls = [0.99];
    assert.equal(context.rollExploreEncounter('user', 'grass', 0, ability).speciesId, 2);
  }
  rolls = [0];
  assert.equal(context.rollExploreEncounter('user', 'grass', 0, 'frisk').speciesId, 1);
});

test('Golden Patreon applies a 25% relative bonus to fishing, swap and promo rates', () => {
  let goldenBoost = 0;
  const ctx = vm.createContext({
    getPatreonPerks: () => ({ goldenBoost }), getPlayerClan: () => null,
    getClanPerkMultipliers: () => ({ prBonus: 0 }), INCENSE_BOOST: 1.1,
    FISH_EXCLUSIVE_GOLDEN_DENOMINATOR: 5000, isPlayerBonusActive: () => false,
    userId: 'trainer', multiplier: 1, goldenBonus: 1, swapBonus: 1,
  });
  vm.runInContext(extract('function getPromoChanceMultiplier(', '\n// Battles and egg hatches'), ctx);
  const fishExpression = extract('const goldenFishingChance =', '\n      if (rod.name');
  const swapExpression = extract('const goldenChance = Math.min(1, multiplier * goldenBonus', '\n          const exclusiveShinyHits');
  const rates = () => ({
    fish: vm.runInContext(`(() => { ${fishExpression}\nreturn goldenFishingChance; })()`, ctx),
    swap: vm.runInContext(`${swapExpression}\ngoldenChance`, vm.createContext({
      Math, multiplier: 1, goldenBonus: 1, swapBonus: 1, swapPerks: { goldenBoost },
    })),
    promo: ctx.getPromoChanceMultiplier('trainer', false),
  });
  const baseline = rates();
  goldenBoost = 0.25;
  const boosted = rates();
  for (const activity of ['fish', 'swap', 'promo']) {
    assert.ok(Math.abs(boosted[activity] - baseline[activity] * 1.25) < 1e-12, activity);
  }
});

test('Golden fishing does not consume an unseen wild or event pity encounter', () => {
  let spawnCalls = 0;
  let random = 0;
  const math = Object.create(Math);
  math.random = () => random;
  const ctx = vm.createContext({
    Math: math, userId: 'trainer', rod: { name: 'Golden Rod' },
    getPatreonPerks: () => ({ goldenBoost: 0 }), isPlayerBonusActive: () => false,
    FISH_EXCLUSIVE_GOLDEN_DENOMINATOR: 5000, FISH_EXCLUSIVE_GOLDENS: ['Poliwag'],
    getSpecialSpawnPokemon: (name) => ({ name }), roleChanceBoost: 0,
    getChannelCatchRateBoost: () => 0, message: { guildId: 'guild', channelId: 'channel' },
    rollSpawn: () => { spawnCalls += 1; return { name: 'Ordinary' }; },
  });
  const code = extract('const goldenFishingChance =', '\n      return await askForBall(');
  const fish = () => vm.runInContext(`(() => { ${code}\nreturn fishingTarget; })()`, ctx);
  assert.equal(fish().isGolden, true);
  assert.equal(spawnCalls, 0);
  random = 0.9;
  assert.equal(fish().name, 'Ordinary');
  assert.equal(spawnCalls, 1);
});

test('ordinary encounter and swap pools allow regular Explore species but protect exclusive Shinies', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE pokemon_forms (
    id INTEGER, species_id INTEGER, species_name TEXT, evolution_chain_id INTEGER, is_default INTEGER,
    rarity TEXT, is_water INTEGER, name TEXT, slug TEXT, base_hp INTEGER, base_atk INTEGER,
    base_def INTEGER, base_spd INTEGER, types TEXT, is_legendary INTEGER, is_mythical INTEGER
  )`);
  const insert = db.prepare(`INSERT INTO pokemon_forms VALUES
    (?, ?, ?, ?, 1, 'Uncommon', ?, ?, ?, 50, 50, 50, 50, ?, 0, 0)`);
  for (const [map, entries] of Object.entries(data.EXPLORE_EXCLUSIVES)) {
    entries.forEach(([id], index) => {
      const chain = id === 902 ? 999 : (map === 'grass' ? 100 : map === 'fire' ? 200 : 300) + Math.floor(index / 3);
      const name = `Pokemon ${id}`;
      insert.run(id, id, name, chain, map === 'water' ? 1 : 0, name, `pokemon-${id}`, map === 'water' ? '["water"]' : '["fire"]');
    });
  }
  const context = vm.createContext({
    db, EXPLORE_EXCLUSIVE_SHINY_IDS: data.EXPLORE_EXCLUSIVE_SHINY_IDS,
    BASE_SPAWN_RESERVED_SPECIES: ['Base exclusive'],
    EGG_ONLY_SPECIES: ['Egg exclusive'],
    PALDEA_LEGENDARY_SPECIES: ['Legendary exclusive'],
  });
  vm.runInContext(extract('const exploreShinyIds =', '\nconst { createTopggWebhookServer'), context);
  const excluded = vm.runInContext('SPECIAL_SPAWN_RESERVED_SPECIES', context);
  const exploreShinies = vm.runInContext('EXPLORE_EXCLUSIVE_SHINY_SPECIES', context);
  for (const id of data.EXPLORE_EXCLUSIVE_SPECIES_IDS) {
    assert.ok(!excluded.includes(`Pokemon ${id}`), `regular species ${id} is not Explore-exclusive`);
    assert.equal(exploreShinies.includes(`Pokemon ${id}`), data.EXPLORE_EXCLUSIVE_SHINY_IDS.has(id));
  }
  for (const name of ['Base exclusive', 'Egg exclusive', 'Legendary exclusive']) {
    assert.ok(excluded.includes(name));
  }
  const dbSource = fs.readFileSync(require.resolve('../db.js'), 'utf8');
  const start = dbSource.indexOf('function getRandomPokemon(');
  const end = dbSource.indexOf('\nlet raritySettingsCache', start);
  let candidates = [];
  Object.assign(context, {
    randomPokemonCache: new Map(), RANDOM_POKEMON_CACHE_MS: 5000, STARTER_SPAWN_WEIGHT: 6,
    getStarterChainIds: () => new Set(),
    getCachedPokemonForm: (id) => db.prepare('SELECT * FROM pokemon_forms WHERE id = ?').get(id),
    pickWeighted: (rows) => { candidates = Array.from(rows, (row) => row.species_id); return rows[0]; },
  });
  vm.runInContext(dbSource.slice(start, end), context);
  context.getRandomPokemon('Uncommon', false, true, true, [], excluded);
  assert.equal(candidates.length, 73);
  assert.ok(candidates.includes(1) && candidates.includes(4) && candidates.includes(7));
  assert.ok(candidates.includes(902));
  context.getRandomPokemon('Uncommon', true, true, true, [], excluded);
  assert.equal(candidates.length, 25);
  assert.ok(candidates.includes(7) && !candidates.includes(1) && candidates.includes(902));
  Object.assign(context, {
    getSwapExcludedSpecies: () => excluded,
    NON_SPAWN_SHINY_SPECIES: ['Other shiny exclusive'],
  });
  vm.runInContext(extract('function getSwapRewardExcludedSpecies(', '\nfor (const event of ALL_EVENTS)'), context);
  const regularSwap = context.getSwapRewardExcludedSpecies(false);
  const shinySwap = context.getSwapRewardExcludedSpecies(true);
  assert.ok(!regularSwap.includes('Pokemon 1'));
  assert.ok(shinySwap.includes('Pokemon 1'));
  assert.ok(!shinySwap.includes('Pokemon 2'));
  assert.ok(shinySwap.includes('Other shiny exclusive'));
  db.close();
});

test('wild starter encounters retain Explore shiny exclusivity without consuming pity', () => {
  let speciesId = 1;
  let forcedEvent = false;
  let shinyPityAdvances = 0;
  let shinyPityResets = 0;
  const selections = [];
  const math = Object.create(Math);
  math.random = () => 0;
  const ctx = vm.createContext({
    Math: math,
    consumeIncenseCharge: () => false, consumePokeradarCharge: () => false,
    isEventOpen: () => forcedEvent, halloweenEvent: { id: 'event' },
    eventSpawnEntries: [{ ids: [1], shiny: true, fish: true }],
    getUser: () => ({ event_ticket: forcedEvent, has_patreon: 0 }),
    getPlayerClan: () => null, getClanPerkMultipliers: () => ({ erBonus: 0 }),
    getTotalEffectiveShinyBonus: () => 0, getPatreonPerks: () => ({ eventShinyPct: 0, shinyRatePct: 0 }),
    consumeEncounterModifier: () => 'normal', getChamberSpawnSpecies: () => [],
    getRaritySettings: () => [{ name: 'Common', spawn_weight: 1, pokemon_count: 1 }],
    advanceEventSpawnPity: () => 0, resetEventSpawnPity: () => {},
    advanceEncounterPity: () => 0, resetEncounterPity: () => {},
    advanceWildShinyPity: () => { shinyPityAdvances += 1; return 2000; },
    resetWildShinyPity: () => { shinyPityResets += 1; },
    rollSpecialLegendarySpawn: () => null, getActiveHuntTarget: () => null,
    chooseEncounterRarity: () => 'Common', getEncounterRarityRate: () => 1,
    formatPercent: () => '100%', getEventPokemonKey: () => null,
    isEventShinyTarget: () => false, isEventChecklistSpawn: () => false,
    getRandomPokemon: (_rarity, water, _gmax, _mega, _forms, excluded, ids) => {
      selections.push({ water, excluded });
      const id = ids ? ids[0] : speciesId;
      return { id, speciesId: id, name: `Pokemon ${id}`, speciesName: `Pokemon ${id}`, rarity: 'Common' };
    },
    pickWeighted: (entries) => entries[0],
    SPECIAL_SPAWN_RESERVED_SPECIES: ['Other exclusive'],
    EXPLORE_EXCLUSIVE_SHINY_IDS: data.EXPLORE_EXCLUSIVE_SHINY_IDS,
    EVENT_NON_FISH_SPECIES: [], EVENT_FISH_SPAWN_FORM_IDS: [], eventSpawnFormIds: [],
    EGG_ONLY_SHINY_SPECIES_KEYS: new Set(), FISH_ONLY_SHINY_KEYS: new Set(),
    FISH_PATREON_ONLY_SHINY_KEYS: new Set(),
    HARD_RARITY_USER_IDS: new Set(), HARD_RARITY_RATE_MULTIPLIER: 1,
    isPlayerBonusActive: () => false, getEventSpawnChance: () => 1,
    EVENT_SPAWN_PITY_MIN: 100, EVENT_SPAWN_PITY_LIMIT: 250, LEGENDARY_SPAWN_PITY_LIMIT: 167,
    LEGENDARY_BASE_CHANCE: 1 / 167, LEGENDARY_GOLDEN_RAZZ_CHANCE: 1 / 125,
    FULL_ODDS_SHINY_PITY_LIMIT: 750, WILD_SHINY_PITY_MIN: 1000, WILD_SHINY_PITY_LIMIT: 2000,
    DAILY_HUNT_SPAWN_BOOST_CHANCE: 0.25,
    EVENT_TICKET_SHINY_RATES: { standard: { event: 0.01, nonEvent: 0.001 }, patreon: { event: 0.02, nonEvent: 0.002 } },
    BASE_SHINY_RATE: 0.001, PATREON_SHINY_RATE: 0.002, CATCHBOT_SHINY_MULTIPLIER: 0.25, INCENSE_BOOST: 1.1,
  });
  vm.runInContext(extract('function rollSpawn(', '\nconst EXPLORE_GOLDEN_CHANCE'), ctx);
  for (const [pool, id] of [['land', 1], ['water', 7]]) {
    speciesId = id;
    const result = ctx.rollSpawn(pool, 'user', pool === 'water' ? { enablesShiny: true, baseShinyRate: 0.001 } : null);
    assert.equal(result.isShiny, false);
    assert.equal(Boolean(result.isGolden), false);
    assert.equal(selections.at(-1).water, pool === 'water');
    assert.deepEqual([...selections.at(-1).excluded], ['Other exclusive']);
  }
  assert.equal(shinyPityAdvances, 0);
  assert.equal(shinyPityResets, 0);
  speciesId = 2;
  assert.equal(ctx.rollSpawn('land', 'user').isShiny, true);
  assert.equal(shinyPityAdvances, 1);
  assert.equal(shinyPityResets, 1);
  ctx.rollSpawn('land', 'user', null, { catchbot: true });
  assert.deepEqual([...selections.at(-1).excluded], ['Other exclusive']);
  forcedEvent = true;
  ctx.advanceEventSpawnPity = () => 100;
  assert.equal(ctx.rollSpawn('land', 'user').isShiny, true);
});

test('wild Shiny and event pity windows are independent and enforce exact boundaries', () => {
  let shinyCount = 0;
  let eventCount = 0;
  let eventActive = false;
  let speciesId = 2;
  let random = 0;
  const math = Object.create(Math);
  math.random = () => random;
  const ctx = vm.createContext({
    Math: math, consumeIncenseCharge: () => false, consumePokeradarCharge: () => false,
    isEventOpen: () => eventActive, halloweenEvent: { id: 'event' },
    eventSpawnEntries: [{ ids: [1], shiny: true, fish: true }],
    getUser: () => ({ event_ticket: eventActive, has_patreon: 0 }),
    getPlayerClan: () => null, getClanPerkMultipliers: () => ({ erBonus: 0 }),
    getTotalEffectiveShinyBonus: () => 0, getPatreonPerks: () => ({ eventShinyPct: 0, shinyRatePct: 0 }),
    consumeEncounterModifier: () => 'normal', getChamberSpawnSpecies: () => [],
    getRaritySettings: () => [{ name: 'Common', spawn_weight: 1, pokemon_count: 1 }],
    advanceEventSpawnPity: () => ++eventCount, resetEventSpawnPity: () => { eventCount = 0; },
    advanceEncounterPity: () => 0, resetEncounterPity: () => {},
    advanceWildShinyPity: () => ++shinyCount, resetWildShinyPity: () => { shinyCount = 0; },
    rollSpecialLegendarySpawn: () => null, getActiveHuntTarget: () => null,
    chooseEncounterRarity: () => 'Common', getEncounterRarityRate: () => 1,
    formatPercent: () => '100%', getEventPokemonKey: () => null,
    isEventShinyTarget: (p) => p.id === 1, isEventChecklistSpawn: () => false,
    getRandomPokemon: (_rarity, _water, _gmax, _mega, _forms, _excluded, ids) => {
      const id = ids ? ids[0] : speciesId;
      return { id, speciesId: id, name: `Pokemon ${id}`, speciesName: `Pokemon ${id}`, rarity: 'Common' };
    },
    pickWeighted: (entries) => entries[0],
    SPECIAL_SPAWN_RESERVED_SPECIES: [], EXPLORE_EXCLUSIVE_SHINY_IDS: new Set([1]),
    EVENT_NON_FISH_SPECIES: [], EVENT_FISH_SPAWN_FORM_IDS: [], eventSpawnFormIds: [],
    EGG_ONLY_SHINY_SPECIES_KEYS: new Set(), FISH_ONLY_SHINY_KEYS: new Set(),
    FISH_PATREON_ONLY_SHINY_KEYS: new Set(), HARD_RARITY_USER_IDS: new Set(),
    HARD_RARITY_RATE_MULTIPLIER: 1, isPlayerBonusActive: () => false, getEventSpawnChance: () => 0.01,
    EVENT_SPAWN_PITY_MIN: 100, EVENT_SPAWN_PITY_LIMIT: 250,
    LEGENDARY_SPAWN_PITY_LIMIT: 167, LEGENDARY_BASE_CHANCE: 1 / 167,
    LEGENDARY_GOLDEN_RAZZ_CHANCE: 1 / 125, WILD_SHINY_PITY_MIN: 1000, WILD_SHINY_PITY_LIMIT: 2000,
    DAILY_HUNT_SPAWN_BOOST_CHANCE: 0.25,
    EVENT_TICKET_SHINY_RATES: { standard: { event: 0.01, nonEvent: 0.001 }, patreon: { event: 0.02, nonEvent: 0.002 } },
    BASE_SHINY_RATE: 0.001, PATREON_SHINY_RATE: 0.002, CATCHBOT_SHINY_MULTIPLIER: 0.25, INCENSE_BOOST: 1.1,
  });
  vm.runInContext(extract('function rollSpawn(', '\nconst EXPLORE_GOLDEN_CHANCE'), ctx);
  const rod = { enablesLegendary: false, enablesShiny: true, baseShinyRate: 0.001 };
  shinyCount = 998;
  assert.equal(ctx.rollSpawn('land', 'user').isShiny, false);
  assert.equal(shinyCount, 999);
  assert.equal(ctx.rollSpawn('water', 'user', rod).isShiny, true);
  assert.equal(shinyCount, 0);
  shinyCount = 1998;
  random = 0.9;
  assert.equal(ctx.rollSpawn('land', 'user').isShiny, false);
  assert.equal(shinyCount, 1999);
  assert.equal(ctx.rollSpawn('water', 'user', rod).isShiny, true);
  assert.equal(shinyCount, 0);
  shinyCount = 999;
  speciesId = 1;
  assert.equal(ctx.rollSpawn('land', 'user').isShiny, false);
  assert.equal(shinyCount, 999);
  speciesId = 2;
  assert.equal(ctx.rollSpawn('water', 'user', { enablesShiny: false }).isShiny, false);
  assert.equal(shinyCount, 999);
  shinyCount = 10;
  eventActive = true;
  eventCount = 98;
  random = 0;
  assert.equal(ctx.rollSpawn('water', 'user', rod).isEventSpawn, undefined);
  assert.equal(eventCount, 99);
  assert.equal(ctx.rollSpawn('water', 'user', rod).isEventSpawn, true);
  assert.equal(eventCount, 0);
  assert.equal(shinyCount, 11);
  shinyCount = 10;
  eventCount = 249;
  random = 0.9;
  const event = ctx.rollSpawn('water', 'user', rod);
  assert.equal(event.isEventSpawn, true);
  assert.equal(event.isShiny, true);
  assert.equal(shinyCount, 10);
  assert.equal(eventCount, 0);
  eventActive = false;
  shinyCount = 998;
  ctx.rollSpecialLegendarySpawn = () => ({ name: 'Special', isShiny: true });
  assert.equal(ctx.rollSpawn('land', 'user').isShiny, false);
  assert.equal(shinyCount, 999);
  assert.equal(ctx.rollSpawn('land', 'user').isShiny, true);
  assert.equal(shinyCount, 0);
  shinyCount = 1999;
  ctx.rollSpecialLegendarySpawn = () => ({ name: 'Special', isShiny: false });
  assert.equal(ctx.rollSpawn('land', 'user').isShiny, true);
  assert.equal(shinyCount, 0);
});

test('checklist displays Explore usage, reset and access status', async () => {
  const { EmbedBuilder } = require('discord.js');
  const now = Date.now();
  const user = {
    has_patreon: 1, patreon_tier: 'common', explore_steps_today: 123, last_explore_reset: now - 1000,
    last_daily: 0, last_vote_at: 0, catchbot_end: 0, hunt_target_id: 0, hunt_completed: 0,
  };
  const payloads = [];
  const context = vm.createContext({
    command: 'cl', args: [], userId: 'trainer', PREFIX: '.', Date, Math, Number, Infinity, EmbedBuilder,
    message: { author: { username: 'Trainer', displayAvatarURL: () => 'https://example.test/a.png' },
      reply: async (value) => { payloads.push(value); } },
    getUser: () => user, getPatreonPerks: () => ({ exploreSteps: 500 }), getExploreStepStatus: data.getExploreStepStatus,
    getDailyResetDay: () => 1, getNextDailyReset: () => now + 86400000,
    getCatchbotData: () => ({}), getUserQuests: () => [],
    db: { prepare: () => ({ get: () => null }) },
  });
  vm.runInContext(`async function run() { ${extract("    if (command === 'checklist' || command === 'cl') {", "\n    if (command === 'trade'")} }`, context);
  await context.run();
  assert.match(payloads.at(-1).embeds[0].data.description, /Explore steps: \*\*123\/500\*\* — resets/);
  user.last_explore_reset = now - 86400000;
  await context.run();
  assert.match(payloads.at(-1).embeds[0].data.description, /Explore steps: \*\*0\/500\*\*/);
  user.has_patreon = 0;
  await context.run();
  assert.match(payloads.at(-1).embeds[0].data.description, /Explore requires an active Patreon tier/);
});

test('Explore draws each supplied map at its aspect ratio with the selected trainer icon', async () => {
  const originalFetch = global.fetch;
  const icon = createCanvas(4, 4);
  const iconCtx = icon.getContext('2d');
  iconCtx.fillStyle = '#ff00ff';
  iconCtx.fillRect(0, 0, 4, 4);
  let fetches = 0;
  const chestIcon = createCanvas(4, 4);
  chestIcon.getContext('2d').fillStyle = '#00ff00';
  chestIcon.getContext('2d').fillRect(0, 0, 4, 4);
  global.fetch = async () => {
    fetches += 1;
    const image = fetches === 1 ? icon : chestIcon;
    return { ok: true, arrayBuffer: async () => image.toBuffer('image/png') };
  };
  try {
    for (const [map, theme] of Object.entries(data.EXPLORE_MAPS)) {
      for (let variant = 0; variant < theme.images.length; variant += 1) {
        const png = await renderer.renderExploreMap(map, 48, 64, 'https://example.test/icon.png', variant);
        const image = await loadImage(png);
        assert.equal(image.width, 640);
        assert.equal(image.height, Math.round(640 * theme.images[variant].height / theme.images[variant].width));
        const result = createCanvas(image.width, image.height);
        const context = result.getContext('2d');
        context.drawImage(image, 0, 0);
        assert.deepEqual([...context.getImageData(50, 66, 1, 1).data], [255, 0, 255, 255]);
        const original = await loadImage(require('node:path').join(__dirname, '..', 'assets', 'explore', theme.images[variant].file));
        const expected = createCanvas(image.width, image.height);
        const expectedCtx = expected.getContext('2d');
        expectedCtx.imageSmoothingEnabled = false;
        expectedCtx.drawImage(original, 0, 0, image.width, image.height);
        assert.deepEqual([...context.getImageData(5, 5, 1, 1).data], [...expectedCtx.getImageData(5, 5, 1, 1).data]);
      }
    }
    assert.equal(fetches, 1);
    const chestMap = await loadImage(await renderer.renderExploreMap('grass', 48, 64, 'https://example.test/icon.png', 0, { x: 80, y: 64 }));
    const chestCanvas = createCanvas(chestMap.width, chestMap.height);
    const chestContext = chestCanvas.getContext('2d');
    chestContext.drawImage(chestMap, 0, 0);
    assert.deepEqual([...chestContext.getImageData(85, 68, 1, 1).data], [0, 255, 0, 255]);
    const occupiedMap = await loadImage(await renderer.renderExploreMap('grass', 48, 64, 'https://example.test/icon.png', 0, { x: 48, y: 64 }));
    chestContext.drawImage(occupiedMap, 0, 0);
    assert.deepEqual([...chestContext.getImageData(50, 66, 1, 1).data], [255, 0, 255, 255]);
    assert.deepEqual([...chestContext.getImageData(66, 66, 1, 1).data], [0, 255, 0, 255]);
    assert.equal(fetches, 2);
    await assert.rejects(renderer.renderExploreMap('missing', 0, 0, 'x'), /Unknown Explore map/);
    await assert.rejects(renderer.renderExploreMap('grass', 0, 0, null), /No trainer icon/);
    global.fetch = async () => ({ ok: false, status: 404 });
    await assert.rejects(renderer.renderExploreMap('grass', 0, 0, 'https://example.test/missing.png'), /HTTP 404/);
    global.fetch = async () => ({ ok: true, arrayBuffer: async () => icon.toBuffer('image/png') });
    await renderer.renderExploreMap('grass', 0, 0, 'https://example.test/missing.png');
  } finally {
    global.fetch = originalFetch;
  }
});

test('Explore uses map data, configured shiny eligibility and Patreon rates', () => {
  const math = Object.create(Math);
  let rolls = [];
  math.random = () => {
    assert.ok(rolls.length, 'Unexpected random roll');
    return rolls.shift();
  };
  let perks = { shinyRatePct: 0, goldenBoost: 0 };
  const ctx = vm.createContext({
    Math: math, EXPLORE_EXCLUSIVES: data.EXPLORE_EXCLUSIVES, EXPLORE_GOLDENS: data.EXPLORE_GOLDENS,
    getExploreCatalogEntries: () => [],
    db: { prepare: () => ({ get: (id) => ({
      id, species_id: id, slug: `pokemon-${id}`, name: `Pokemon ${id}`, species_name: `Pokemon ${id}`,
      rarity: 'Common', types: '["normal"]', is_default: 1,
    }) }) },
    getUser: () => ({ has_patreon: 0 }), getPatreonPerks: () => perks,
    getTotalEffectiveShinyBonus: () => 0, BASE_SHINY_RATE: 0.01, PATREON_SHINY_RATE: 0.02,
    HARD_RARITY_USER_IDS: new Set(), HARD_RARITY_RATE_MULTIPLIER: 1,
    EGG_ONLY_SHINY_SPECIES_KEYS: new Set(), FISH_ONLY_SHINY_KEYS: new Set(),
    advanceEncounterPity: () => 1, resetEncounterPity: () => {},
    FULL_ODDS_SHINY_PITY_LIMIT: 750,
  });
  vm.runInContext(extract('const EXPLORE_GOLDEN_CHANCE', '\nfunction getEventPokemonKey('), ctx);
  for (const [map, expected] of [['grass', 1], ['fire', 4], ['water', 7]]) {
    rolls = [0, 0.5];
    const result = ctx.rollExploreEncounter('user', map);
    assert.equal(result.speciesId, expected);
    assert.equal(result.isShiny, false);
    assert.equal(result.isExplore, true);
  }
  // The second grass entry cannot be shiny, even when the shiny roll succeeds.
  rolls = [0.08];
  assert.equal(ctx.rollExploreEncounter('user', 'grass').isShiny, false);
  perks = { shinyRatePct: 50, goldenBoost: 0.25 };
  rolls = [0, 0.014];
  assert.equal(ctx.rollExploreEncounter('user', 'grass').isShiny, true);
  // Select Treecko, then use a roll between the normal and boosted Golden chances.
  rolls = [0.26, 0.0055];
  const golden = ctx.rollExploreEncounter('user', 'grass');
  assert.equal(golden.speciesId, 252);
  assert.equal(golden.isGolden, true);
  rolls = [0.26, 0.00625, 0.9];
  assert.equal(Boolean(ctx.rollExploreEncounter('user', 'grass').isGolden), false);
  perks = { shinyRatePct: 0, goldenBoost: 0 };
  rolls = [0.26, 0.005, 0.9];
  assert.equal(Boolean(ctx.rollExploreEncounter('user', 'grass').isGolden), false);
  perks = { shinyRatePct: 50, goldenBoost: 0.25 };
  const weights = { Uncommon: 60, Rare: 30, 'Super Rare': 10 };
  for (const [map, entries] of Object.entries(data.EXPLORE_EXCLUSIVES)) {
    const total = entries.reduce((sum, entry) => sum + weights[entry[1]], 0);
    let previous = 0;
    for (const [id, rarity, shiny] of entries) {
      const selection = (previous + weights[rarity] / 2) / total;
      previous += weights[rarity];
      rolls = [selection, ...(data.EXPLORE_GOLDENS[map] === id ? [0.9] : []), ...(shiny ? [0] : [])];
      const result = ctx.rollExploreEncounter('user', map);
      assert.equal(result.speciesId, id);
      assert.equal(result.rarity, rarity);
      assert.equal(result.isShiny, shiny);
      assert.equal(rolls.length, 0);
      if (data.EXPLORE_GOLDENS[map] === id) {
        rolls = [selection, 0];
        const goldenResult = ctx.rollExploreEncounter('user', map);
        assert.equal(goldenResult.speciesId, id);
        assert.equal(goldenResult.isGolden, true);
        assert.equal(goldenResult.isShiny, false);
      }
    }
  }
  assert.throws(() => ctx.rollExploreEncounter('user', 'invalid'), /No Pokémon configured/);
});

test('Explore session selects maps, enforces Patreon limits and preserves encounter modifiers', async () => {
  const events = new EventEmitter();
  const user = { has_patreon: 1, patreon_tier: 'common', explore_steps_today: 0, last_explore_reset: Date.now(),
    grazz_buff_encounters: 5, repel_encounters: 7,
    coins: 0, shiny_charms: 5, amulet_coins: 10, explore_shiny_charm: 0, explore_amulet_coin: 0,
    pokeballs: 2, greatballs: 0, ultraballs: 0, premierballs: 0, masterballs: 0 };
  const payloads = [];
  let endPromise;
  let cancelled = false;
  let collectorOptions;
  const collector = {
    on(name, fn) { events.on(name, fn); return this; },
    stop(reason) {
      endPromise = events.listeners('end')[0](null, reason);
      events.removeAllListeners();
    },
  };
  const msg = {
    author: { id: 'trainer' }, guildId: 'guild', channelId: 'channel',
    reply: async (payload) => {
      payloads.push(payload);
      return { edit: async (p) => { payloads.push(p); }, createMessageComponentCollector: (options) => { collectorOptions = options; return collector; } };
    },
  };
  let rollAbility;
  let shinyBoost;
  let encounterVariant = {};
  let nextRolls = [];
  let rewardChoice = 'shiny';
  let chestLifetime = 5;
  const rendered = [];
  const tierPerks = patreonPerks();
  const math = Object.create(Math);
  math.random = () => nextRolls.length ? nextRolls.shift() : 0;
  const ctx = vm.createContext({
    Math: math, Date, console, require: () => ({
      ...renderer, renderExploreMap: async (map, x, y, icon, variant) => {
        rendered.push({ map, variant });
        return Buffer.from('image');
      },
    }), Buffer, ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ComponentType,
    command: 'explore', args: ['gm', '2'], message: msg, userId: 'trainer', PREFIX: '.',
    selectExploreMap: data.selectExploreMap, getExploreStepStatus: data.getExploreStepStatus,
    CHEST_EMOJI: chests.CHEST_EMOJI, CHEST_SPAWN_CHANCE: 0,
    spawnExploreChest: (x, y) => ({ x, y: y - 32, stepsRemaining: chestLifetime }),
    chooseExploreChestReward: (current, loot) => {
      if (rewardChoice === 'shiny' && !current.explore_shiny_charm) return { special: 'shiny' };
      if (rewardChoice === 'amulet' && !current.explore_amulet_coin) return { special: 'amulet' };
      return { ...loot[0], quantity: 500 };
    },
    db: { transaction: (fn) => ({ immediate: fn }) },
    isExploreTester: (message) => message.isAdmin === true,
    EMOJIS: { pokecoin: 'coin', pokeball: 'pokeball', greatball: 'greatball', ultraball: 'ultraball', rarecandy: 'candy', repel: 'repel', shinyCharm: 'charm', amuletcoin: 'amulet' },
    getPokemonSpriteEmoji: (pokemon) => pokemon.isShiny ? ':shiny:' : pokemon.isGolden ? ':golden:' : ':pokemon:',
    activeExploreSessions: new Set(), BALL_CONFIG: Object.fromEntries(
      [['pb', 'pokeballs'], ['gb', 'greatballs'], ['ub', 'ultraballs'], ['prb', 'premierballs'], ['mb', 'masterballs']]
        .map(([key, column]) => [key, { column, buttonEmoji: '🔴' }])
    ),
    getUser: () => user, updateUser: (_id, fields) => Object.assign(user, fields),
    getPatreonPerks: () => tierPerks.tiers[user.patreon_tier] || tierPerks.none,
    incrementUser: (_id, fields) => { for (const [key, amount] of Object.entries(fields)) user[key] += amount; },
    getTrainerIconUrl: () => 'trainer-icon', resolveLeadOverworldAbility: async () => 'frisk',
    getExploreEncounterMultiplier: (ability) => { rollAbility = ability; return 1; },
    getChannelCatchRateBoost: () => 5,
    rollExploreEncounter: (_id, map, boost) => {
      shinyBoost = boost;
      return { name: 'Bulbasaur', rarity: 'Uncommon', isExplore: true, map, ...encounterVariant };
    },
    rollWildHeldItem: () => { throw new Error('Explore must not roll held items'); },
    getDisplayRarity: (rarity) => rarity,
    getRarityEmojis: () => '',
    askForBall: async (_message, _id, wild, _mode, options) => {
      assert.equal(wild.overworldAbility, 'frisk');
      assert.equal(wild.heldItem, undefined);
      options.inline.onSpawn({ title: 'Encounter details' });
      options.inline.onCancelReady(() => { cancelled = true; });
      options.onHandler(async (interaction) => {
        await interaction.deferUpdate();
        options.onHandler(null);
        options.inline.onCatch(wild, 123);
        await options.inline.onEdit('Caught Bulbasaur!');
      });
    },
    replyToInteractionFailure: async (_interaction, text) => { throw new Error(text); },
  });
  vm.runInContext(`async function run() { ${extract("    if (command === 'explore' || command === 'exp') {", "\n    if (command === 'team') {")} }`, ctx);
  await ctx.run();
  assert.match(payloads[0], /approved testers only/);
  assert.equal(ctx.activeExploreSessions.size, 0);
  ctx.command = 'exp';
  await ctx.run();
  assert.match(payloads.at(-1), /approved testers only/);
  ctx.command = 'explore';
  payloads.length = 0;
  msg.isAdmin = true;
  user.patreon_tier = null;
  await ctx.run();
  assert.match(payloads.at(-1), /requires an active Patreon tier/);
  assert.equal(ctx.activeExploreSessions.size, 0);
  user.patreon_tier = 'common';
  user.has_patreon = 0;
  await ctx.run();
  assert.match(payloads.at(-1), /requires an active Patreon tier/);
  user.has_patreon = 1;
  ctx.args = ['fm', '2'];
  await ctx.run();
  assert.match(payloads.at(-1), /Usage/);
  ctx.args = ['gm', '2'];
  payloads.length = 0;
  await ctx.run();
  assert.match(payloads[0].content, /Grass Map 2.*0\/500/);
  assert.deepEqual(rendered.at(-1), { map: 'grass', variant: 1 });
  assert.equal(ctx.activeExploreSessions.has('trainer'), true);
  await ctx.run();
  assert.match(payloads.at(-1), /already have an active Explore session/);
  const click = async (id, actor = 'trainer') => {
    const replies = [];
    await events.listeners('collect')[0]({
      user: { id: actor }, customId: id,
      reply: async (value) => replies.push(value),
      deferUpdate: async () => {},
    });

    return replies;
  };
  assert.match((await click('exp_up', 'other'))[0].content, /own adventure/);
  await click('exp_up');
  assert.equal(user.explore_steps_today, 1);
  assert.equal(user.grazz_buff_encounters, 5);
  assert.equal(user.repel_encounters, 7);
  assert.equal(rollAbility, 'frisk');
  assert.equal(shinyBoost, 5);
  assert.match(payloads.at(-1).content, /Bulbasaur/);
  assert.equal(payloads.at(-1).components[0].components[1].data.disabled, false);
  user.explore_steps_today = 500;
  assert.match((await click('exp_down'))[0].content, /all of your exploring steps/);
  assert.equal(cancelled, false);
  user.explore_steps_today = 1;
  await click('exp_search');
  assert.match(payloads.at(-1).content, /no chest at your position/);
  assert.equal(payloads.at(-1).components[0].components[3].data.disabled, false);
  nextRolls = [0.9, 0.9];
  await click('exp_down');
  assert.equal(cancelled, true);
  assert.match(payloads.at(-1).content, /No Pokémon appeared/);
  assert.match((await click('exp_ball:pb'))[0].content, /no wild Pokémon/);
  cancelled = false;
  await click('exp_up');
  await click('exp_ball:pb');
  assert.match(payloads.at(-1).content, /Caught Bulbasaur/);
  await click('exp_down');
  await click('exp_ball:pb');
  encounterVariant = { isShiny: true };
  await click('exp_up');
  await click('exp_ball:pb');
  encounterVariant = {};
  await click('exp_run');
  await endPromise;
  assert.ok(payloads.at(-1).content.includes('<:caught:1560340176713031711> Pokémon caught (3): :pokemon:² :shiny:¹'));
  assert.ok(payloads.at(-1).content.includes(`${chests.CHEST_EMOJI} Items found (0): None`));
  assert.ok(payloads.at(-1).content.includes('coin Coins earned: **369**'));
  assert.equal(payloads.at(-1).components.length, 0);
  assert.equal(ctx.activeExploreSessions.has('trainer'), false);
  assert.equal(cancelled, false);

  const mockedSprite = ctx.getPokemonSpriteEmoji;
  const spriteContext = vm.createContext({});
  vm.runInContext(extract('const POKEMON_SPRITE_EMOJIS =', '\nfunction formatFactionFavorites('), spriteContext);
  ctx.getPokemonSpriteEmoji = spriteContext.getPokemonSpriteEmoji;
  user.explore_steps_today = 0;
  await ctx.run();
  await click('exp_up');
  await click('exp_ball:pb');
  await click('exp_down');
  await click('exp_ball:pb');
  encounterVariant = { name: 'Unknown Pokémon' };
  await click('exp_up');
  await click('exp_ball:pb');
  await click('exp_run');
  await endPromise;
  assert.ok(payloads.at(-1).content.includes('Pokémon caught (3): <:bulbasaur:1569731188774404146>² Unknown Pokémon¹'));
  ctx.getPokemonSpriteEmoji = mockedSprite;
  encounterVariant = {};

  for (const variant of [{ isShiny: true }, { isGolden: true }, { rarity: 'Legendary' }, {}]) {
    encounterVariant = variant;
    user.explore_steps_today = 0;
    await ctx.run();
    await click('exp_up');
    assert.match(payloads.at(-1).content, /:(?:pokemon|shiny|golden): \*\*Bulbasaur\*\*/);
    assert.equal(payloads.at(-1).embeds.length, Object.keys(variant).length ? 1 : 0);
    await click('exp_ball:pb');
    assert.equal(payloads.at(-1).embeds.length, 0);
    await click('exp_run');
    await endPromise;
  }
  encounterVariant = {};
  user.explore_steps_today = 0;
  await ctx.run();
  await click('exp_search');
  assert.match(payloads.at(-1).content, /no chest at your position/);
  await click('exp_run');
  await endPromise;

  for (const [choice, expected] of [['shiny', 'charm'], ['amulet', 'amulet'], ['shiny', 'coin']]) {
    rewardChoice = choice;
    user.explore_steps_today = 0;
    ctx.CHEST_SPAWN_CHANCE = 0.1;
    await ctx.run();
    nextRolls = [0, 0.9];
    await click('exp_up');
    assert.match(payloads.at(-1).content, /Chest on the map/);
    ctx.CHEST_SPAWN_CHANCE = 0;
    nextRolls = [0.9];
    await click('exp_up');
    assert.match(payloads.at(-1).content, /press 🔍 to open/);
    await click('exp_search');
    assert.match(payloads.at(-1).content, new RegExp(`found ${expected}`));
    assert.doesNotMatch(payloads.at(-1).content, /Chest on the map/);
    await click('exp_run');
    await endPromise;
  }
  assert.equal(user.explore_shiny_charm, 1);
  assert.equal(user.explore_amulet_coin, 1);
  assert.equal(user.shiny_charms, 5);
  assert.equal(user.amulet_coins, 10);
  rewardChoice = 'basic';
  ctx.chooseExploreChestReward = (_current, loot) => ({ ...loot[1], quantity: 3 });
  user.explore_steps_today = 0;
  await ctx.run();
  for (let i = 0; i < 2; i += 1) {
    ctx.CHEST_SPAWN_CHANCE = 0.1;
    nextRolls = [0, 0.9];
    await click('exp_up');
    ctx.CHEST_SPAWN_CHANCE = 0;
    nextRolls = [0.9];
    await click('exp_up');
    await click('exp_search');
  }
  await click('exp_run');
  await endPromise;
  assert.ok(payloads.at(-1).content.includes(`${chests.CHEST_EMOJI} Items found (6): pokeball⁶`));
  chestLifetime = 2;
  ctx.CHEST_SPAWN_CHANCE = 0.1;
  user.explore_steps_today = 0;
  await ctx.run();
  nextRolls = [0, 0.9];
  await click('exp_up');
  assert.match(payloads.at(-1).content, /Chest on the map/);
  ctx.CHEST_SPAWN_CHANCE = 0;
  nextRolls = [0.9];
  await click('exp_right');
  assert.match(payloads.at(-1).content, /Chest on the map/);
  nextRolls = [0.9];
  await click('exp_right');
  assert.doesNotMatch(payloads.at(-1).content, /Chest on the map/);
  await click('exp_run');
  await endPromise;
  chestLifetime = 5;

  user.explore_steps_today = 500;
  await ctx.run();
  assert.equal(payloads.at(-1).components[0].components[0].data.disabled, true);
  assert.match((await click('exp_up'))[0].content, /all of your exploring steps/);
  assert.equal(user.explore_steps_today, 500);
  await click('exp_run');
  await endPromise;

  user.explore_steps_today = 0;
  user.patreon_tier = 'golden';
  ctx.args = ['wm', '1'];
  await ctx.run();
  assert.match(payloads.at(-1).content, /Water Map 1.*0\/6000/);
  assert.deepEqual(rendered.at(-1), { map: 'water', variant: 0 });
  await click('exp_up');
  collector.stop('time');
  await endPromise;
  assert.equal(cancelled, true);
  assert.equal(ctx.activeExploreSessions.has('trainer'), false);
  assert.match(payloads.at(-1).content, /session has ended/);
  for (const [tier, [steps, seconds]] of Object.entries({
    common: [500, 90], uncommon: [2500, 100], rare: [4000, 120], superRare: [4500, 150],
    legendary: [5000, 180], shiny: [5500, 210], golden: [6000, 240],
  })) {
    user.patreon_tier = tier;
    user.explore_steps_today = steps - 1;
    await ctx.run();
    assert.equal(collectorOptions.time, seconds * 1000);
    assert.match(payloads.at(-1).content, new RegExp(`Session: \\*\\*${seconds} seconds\\*\\*`));
    await click('exp_search');
    assert.match(payloads.at(-1).content, new RegExp(`${steps}/${steps}`));
    assert.match((await click('exp_search'))[0].content, /all of your exploring steps/);
    assert.equal(user.explore_steps_today, steps);
    await click('exp_run');
    await endPromise;
  }
  user.patreon_tier = 'common';
  user.explore_steps_today = 0;
  for (const [args, map, variant] of [
    [['gm', '1'], 'grass', 0], [['gm', '2'], 'grass', 1], [['fm', '1'], 'fire', 0], [['wm', '1'], 'water', 0],
  ]) {
    ctx.args = args;
    await ctx.run();
    assert.deepEqual(rendered.at(-1), { map, variant });
    await click('exp_run');
    await endPromise;
  }
  await ctx.run();
  user.has_patreon = 0;
  assert.match((await click('exp_search'))[0].content, /requires an active Patreon tier/);
  assert.equal(user.explore_steps_today, 0);
  await click('exp_run');
  await endPromise;
});

test('Explore exclusives command lists map-specific shiny and Golden species', async () => {
  const Database = require('better-sqlite3');
  const { EmbedBuilder } = require('discord.js');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE pokemon_forms (species_id INTEGER, name TEXT, is_default INTEGER, id INTEGER)');
  const insert = db.prepare('INSERT INTO pokemon_forms VALUES (?, ?, 1, ?)');
  for (const id of data.EXPLORE_EXCLUSIVE_SPECIES_IDS) insert.run(id, `Pokemon ${id}`, id);
  const ctx = vm.createContext({
    db, EmbedBuilder, EXPLORE_MAPS: data.EXPLORE_MAPS, EXPLORE_EXCLUSIVES: data.EXPLORE_EXCLUSIVES,
    EXPLORE_GOLDENS: data.EXPLORE_GOLDENS, command: 'excl', args: ['explore'], PREFIX: '.',
    message: { reply: async (payload) => payload },
  });
  vm.runInContext(`async function run() { ${extract("    if (command === 'excl') {", "\n    if (command === 'vote') {")} }`, ctx);
  const embed = (await ctx.run()).embeds[0].toJSON();
  assert.match(embed.description, /bot admins and approved testers/);
  assert.equal(embed.fields.length, 3);
  for (const [index, [map, entries]] of Object.entries(Object.entries(data.EXPLORE_EXCLUSIVES))) {
    const value = embed.fields[index].value;
    for (const [id, , shiny] of entries) {
      if (shiny) assert.match(value, new RegExp(`Pokemon ${id}(?:,|\\n)`));
    }
    assert.match(value, new RegExp(`\\*\\*Golden:\\*\\* Pokemon ${data.EXPLORE_GOLDENS[map]}`));
  }
  db.close();
});

test('Premierballs catch event shinies at 100% including held items and Explore', () => {
  const ctx = vm.createContext({ getExploreCatchRate: data.getExploreCatchRate });
  vm.runInContext(extract('const HELD_ITEM_CATCH_RATES =', '\nfunction '), ctx);
  vm.runInContext(extract('const PREMIERBALL_RATES =', '\nfunction getCatchCoinReward('), ctx);
  for (const heldItem of [null, 'Nugget']) {
    for (const isExplore of [false, true]) {
      const target = { isShiny: true, isEventShiny: true, heldItem, isExplore };
      assert.equal(ctx.getBallCatchRate('prb', { bonus: 50 }, target, 'Shiny', 10, 0, 0), 100);
    }
  }
  assert.equal(ctx.getBallCatchRate('pb', { bonus: 0 },
    { isShiny: true, isEventShiny: true, heldItem: 'Nugget' }, 'Shiny', 10, 0, 0), 10);
  assert.equal(ctx.getBallCatchRate('prb', { bonus: 50 },
    { isShiny: true, heldItem: 'Nugget' }, 'Shiny', 10, 0, 0), 50);
  assert.equal(ctx.getBallCatchRate('prb', { bonus: 50 },
    { isShiny: false }, 'Rare', 10, 0, 0), 87);
});
