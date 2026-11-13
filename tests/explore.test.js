const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder } = require('discord.js');
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
  for (const [roll, key, field] of [
    [0.02, 'scanner', 'explore_scanner'],
    [0.03, 'ring', 'explore_item_ring'],
    [0.04, 'dowsing', 'explore_dowsing_machine'],
    [0.05, 'pack', 'explore_large_pack'],
  ]) {
    assert.equal(select({}, roll).special, key);
    assert.equal(select({}, roll + 0.009999).special, key);
    assert.equal(select({ [field]: 1 }, roll, 0, 0).field, 'repels');
  }
  assert.equal(select({}, 0.06, 0, 0).field, 'repels');
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

test('Explore unlock fields migrate existing users and persist independently', () => {
  const dbSource = fs.readFileSync(require.resolve('../db.js'), 'utf8');
  const db = new Database(':memory:');
  db.exec("CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users (id) VALUES ('trainer')");
  const ctx = vm.createContext({ db });
  vm.runInContext(
    dbSource.slice(dbSource.indexOf('const userDefinitions ='), dbSource.indexOf('\nconst catchDefinitions ='))
      + '\n' + dbSource.slice(dbSource.indexOf('function ensureColumns('), dbSource.indexOf('\ndb.exec(`', dbSource.indexOf('function ensureColumns(')))
      + '\nensureColumns("users", Object.fromEntries(Object.values(items).map(item => [item.field, userDefinitions[item.field]])));',
    Object.assign(ctx, { items: chests.EXPLORE_ITEMS })
  );
  const fields = Object.values(chests.EXPLORE_ITEMS).map((item) => item.field);
  for (const field of fields) {
    assert.equal(db.prepare(`SELECT ${field} FROM users WHERE id = ?`).get('trainer')[field], 0);
    db.prepare(`UPDATE users SET ${field} = 1 WHERE id = ?`).run('trainer');
  }
  assert.deepEqual(fields.map((field) => db.prepare(`SELECT ${field} FROM users WHERE id = ?`).get('trainer')[field]), [1, 1, 1, 1]);
  db.close();
});

test('Explore unlock item info reports ownership and how each item works', async () => {
  const user = {};
  const ctx = vm.createContext({
    command: 'item', args: [], userId: 'trainer', getUser: () => user,
    EXPLORE_ITEMS: chests.EXPLORE_ITEMS, CHEST_EMOJI: chests.CHEST_EMOJI, EmbedBuilder, PREFIX: '.',
    message: { reply: async (payload) => payload },
  });
  const prefix = extract("    if ((command === 'item' || command === 'i') && args[0]?.toLowerCase() === 'info') {",
    '\n        const vitamin = findVitamin(query);');
  vm.runInContext(`async function info() { ${prefix}\n} } }`, ctx);
  for (const item of Object.values(chests.EXPLORE_ITEMS)) {
    ctx.args = ['info', item.name.replace(/ /g, '').toLowerCase()];
    user[item.field] = 0;
    let embed = (await ctx.info()).embeds[0].toJSON();
    assert.ok(embed.description.includes(`0x ${item.name}`));
    assert.ok(embed.description.includes(item.description));
    assert.match(embed.description, /1% chance, one-time unlock/);
    user[item.field] = 1;
    embed = (await ctx.info()).embeds[0].toJSON();
    assert.ok(embed.description.includes(`1x ${item.name}`));
  }
});

test('Explore unlocks and their ownership are shown in the utility bag', () => {
  const bagUser = { exp_share_owned: 0, rare_candies: 0, double_xp_charges: 0,
    shiny_charms: 0, quest_reset_scrolls: 0, explore_scanner: 1, explore_item_ring: 0,
    explore_dowsing_machine: 1, explore_large_pack: 0 };
  const ctx = vm.createContext({
    EmbedBuilder, bagUser, ownedItems: new Map(), targetId: 'trainer', totalPages: 6, PREFIX: '.',
    targetUser: { username: 'Trainer', displayAvatarURL: () => 'https://example.test/avatar.png' },
    getAmuletCoinBoost: () => ({ owned: 0, explore: 0 }), EVOLUTION_ITEMS: {},
    FUN_ITEM_EMOJIS: { 'Sitrus Berry': 'berry', Leftovers: 'leftovers' }, RESEARCH_HELD_ITEMS: [],
    BATTLE_HELD_ITEM_DETAILS: [], EMOJIS: { expshare: 'share', rarecandy: 'candy', shinyCharm: 'charm', amuletcoin: 'coin' },
    EXP_CANDY_EMOJIS: {}, ENCOUNTER_ITEM_BAG_ENTRIES: [['Item', 'Item', 'item']], EXPLORE_ITEMS: chests.EXPLORE_ITEMS,
  });
  vm.runInContext(`${extract('      const buildBagEmbed = (page) => {', '\n      const buildBagButtons =')}\nthis.buildBagEmbed = buildBagEmbed;`, ctx);
  const field = ctx.buildBagEmbed(2).toJSON().fields.find((entry) => entry.name === 'Explore');
  for (const item of Object.values(chests.EXPLORE_ITEMS)) {
    assert.ok(field.value.includes(`${item.emoji} **${bagUser[item.field]}x** ${item.name}`));
  }
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

test('rare spawn announcements forward caught Explore rarities and describe swaps accurately', async () => {
  const sent = [];
  const logged = [];
  const adminSources = [];
  const errors = [];
  let hidden = false;
  const ctx = vm.createContext({
    EmbedBuilder, Date,
    console: { error: (...args) => errors.push(args) },
    getEventPokemonKey: () => null,
    notifyAdminOfRareSpawn: async (_guild, _user, _pokemon, source) => { adminSources.push(source); },
    logRareSpawn: (entry) => logged.push(entry),
    resolveAnnouncementChannels: async () => ['channel'],
    getAllRareSpawnAnnouncementChannels: () => ['channel'],
    getDisplayRarity: (rarity) => rarity,
    getPokemonSpriteEmoji: () => ':sprite:',
    getRarityEmojis: () => ':rarity:',
    EMOJIS: { golden: ':golden:' }, EVENT_EMBED_COLOR: 1, RARITY_COLORS: { shiny: 2 },
    getRarityColor: () => 3,
    db: { prepare: () => ({ get: () => ({ count: 2 }) }) },
    client: { user: { username: 'Bot', displayAvatarURL: () => 'https://example.com/avatar.png' } },
    getRareSpawnNameHidden: () => hidden,
    getGoldenSpriteUrl: (id) => `https://example.com/${id}.png`,
    getPokemonShowdownSprite: () => null,
    sendToChannels: async (_channels, payload) => { sent.push(payload.embeds[0].toJSON()); return true; },
  });
  vm.runInContext(extract('async function announceRareSpawn(', '\nasync function announceBattleIconDrop('), ctx);
  const guild = { id: 'guild' };
  const user = { id: 'trainer', username: 'Ash' };
  const pokemon = { id: 5, speciesId: 25, name: 'Pikachu', rarity: 'Uncommon', slug: 'pikachu', isExplore: true };
  for (const variant of [{ isShiny: true }, { rarity: 'Legendary' }, { isGolden: true }]) {
    await ctx.announceRareSpawn(guild, user, { ...pokemon, ...variant }, '.explore', { activity: 'explore' });
    assert.match(sent.at(-1).title, /Ash explored and found/);
  }
  assert.equal(sent.length, 3);
  assert.equal(logged.length, 3);
  assert.deepEqual(adminSources, ['.explore', '.explore', '.explore']);
  assert.equal(sent[2].image.url, 'https://example.com/25.png');
  hidden = true;
  await ctx.announceRareSpawn(guild, user, { ...pokemon, isShiny: true }, '.swap', { activity: 'swap' });
  assert.match(sent.at(-1).title, /somebody swapped for a/);
  hidden = false;
  await ctx.announceRareSpawn(guild, user, { ...pokemon, isShiny: true }, '.p');
  assert.match(sent.at(-1).title, /Ash has found a/);
  await ctx.announceRareSpawn(guild, user, pokemon, '.explore', { activity: 'explore' });
  assert.equal(sent.length, 5);
  assert.equal(errors.length, 0);

  const catchFlow = extract('async function askForBall(', '\nconst TYPE_EFFECTIVENESS');
  assert.match(catchFlow, /target\.isExplore \? `\$\{PREFIX\}explore`/);
  assert.match(catchFlow, /isFishing \? `\$\{PREFIX\}f` : `\$\{PREFIX\}p`/);
  assert.match(catchFlow, /activity: target\.isExplore \? 'explore' : 'found'/);
  assert.match(catchFlow, /if \(inline\?\.onSpawn\) inline\.onSpawn\(embed\)/);
  const swapFlow = extract("    if (command === 'swap'", "\n    if (command === 'collection'");
  assert.match(swapFlow, /activity: 'swap'/);
});

test('rare Pokémon receipt logs include the recipient, Pokémon, method, and configured channel', async () => {
  const channelIds = [];
  const messages = [];
  const ctx = vm.createContext({
    client: {
      channels: {
        fetch: async (channelId) => {
          channelIds.push(channelId);
          return {
            isTextBased: () => true,
            send: async (payload) => messages.push(payload),
          };
        },
      },
    },
    console: { error: (...args) => { throw new Error(args.join(' ')); } },
  });
  vm.runInContext(
    extract('const RARE_SPAWN_LOG_CHANNEL_ID', '\nasync function notifyAdminIfRareGrant('),
    ctx
  );
  await ctx.notifyAdminOfRareSpawn(
    { id: 'guild', name: 'Test Server' },
    { id: 'trainer', username: 'Ash' },
    { name: 'Pikachu', rarity: 'Legendary', isShiny: true },
    '.p',
    false
  );
  assert.deepEqual(channelIds, ['1570468169422864485']);
  assert.match(messages[0].content, /Ash.*Pikachu/);
  assert.match(messages[0].content, /Method: `\.p`/);
});

test('Explore map selectors choose the exact map and reject invalid choices', () => {
  for (const [args, mapKey, backgroundIndex] of [
    [['gm', '1'], 'grass', 0], [['GM', '2'], 'grass', 1],
    [['fm', '1'], 'fire', 0], [['fm', '2'], 'fire', 1],
    [['wm', '1'], 'water', 0], [['wm', '2'], 'water', 1],
    [[], 'grass', null], [['grass'], 'grass', null], [['fire'], 'fire', null], [['water'], 'water', null],
  ]) {
    assert.deepEqual(data.selectExploreMap(args), { mapKey, backgroundIndex });
  }
  for (const args of [['gm'], ['gm', '0'], ['gm', '3'], ['gm', '4'], ['fm', '3'], ['wm', '3'], ['wm', '1', 'extra'], ['__proto__', '1']]) {
    assert.equal(data.selectExploreMap(args), null);
  }
  assert.equal(data.EXPLORE_MAPS.fire.images[0].file, 'fire-1-replacement.png');
  assert.equal(data.EXPLORE_MAPS.fire.images[1].file, 'fire-3.png');
  assert.equal(data.EXPLORE_MAPS.water.images[1].file, 'water-2-replacement.png');
  assert.deepEqual(renderer.getExploreMapSize('fire', 0), { width: 640, height: 490 });
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

test('Explore Legendary pools use matching default forms from Generations 1–4', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE pokemon_forms (
    id INTEGER, species_id INTEGER, species_name TEXT, name TEXT, rarity TEXT, types TEXT,
    is_default INTEGER, is_legendary INTEGER, is_mythical INTEGER
  )`);
  const insert = db.prepare('INSERT INTO pokemon_forms VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const row of require('../data/pokemon-catalog.json')) {
    insert.run(row.id, row.species_id, row.species_name, row.name, row.rarity, row.types,
      row.is_default, row.is_legendary, row.is_mythical);
  }
  const context = vm.createContext({
    db, Date, EXPLORE_MAPS: data.EXPLORE_MAPS, SPECIAL_SPAWN_RESERVED_SPECIES: [],
    isEventOpen: () => false, halloweenEvent: {}, getEventPokemonKey: () => null,
  });
  vm.runInContext(extract('const exploreCatalogCache =', '\nconst EXPLORE_GOLDEN_CHANCE'), context);
  const entries = (map) => Array.from(context.getExploreLegendaryEntries(map));
  assert.deepEqual(entries('grass'), []);
  assert.deepEqual(entries('fire').map((row) => row.species_id), [146, 244, 250, 485]);
  assert.deepEqual(entries('water').map((row) => row.species_id), [245, 382, 484]);
  for (const map of ['fire', 'water']) {
    for (const row of entries(map)) {
      assert.equal(row.is_default, 1);
      assert.equal(row.is_mythical, 0);
      assert.ok(row.species_id <= 493 && JSON.parse(row.types).includes(map));
    }
  }
  assert.throws(() => context.getExploreLegendaryEntries('invalid'), /Unknown Explore map/);
  db.close();
});

test('Explore Legendary roll has a 1/666 boundary and allows eligible Shinies', () => {
  const math = Object.create(Math);
  let rolls = [];
  math.random = () => { assert.ok(rolls.length); return rolls.shift(); };
  const legendary = { id: 146, species_id: 146, name: 'Moltres', species_name: 'Moltres',
    rarity: 'Legendary', types: '["fire","flying"]', is_default: 1, is_legendary: 1 };
  const ctx = vm.createContext({
    Math: math, EXPLORE_EXCLUSIVES: { fire: [[4, 'Uncommon', false]] },
    getExploreLegendaryEntries: () => [legendary], getExploreCatalogEntries: () => [],
    EXPLORE_GOLDENS: {},
    db: { prepare: () => ({ get: () => ({ id: 4, species_id: 4, name: 'Charmander',
      species_name: 'Charmander', rarity: 'Uncommon', types: '["fire"]', is_default: 1 }) }) },
    getUser: () => ({ has_patreon: 0 }), getPatreonPerks: () => ({ shinyRatePct: 0, goldenBoost: 0 }),
    getTotalEffectiveShinyBonus: () => 0, BASE_SHINY_RATE: 0.01, PATREON_SHINY_RATE: 0.02,
    HARD_RARITY_USER_IDS: new Set(), HARD_RARITY_RATE_MULTIPLIER: 1,
    EGG_ONLY_SHINY_SPECIES_KEYS: new Set(), FISH_ONLY_SHINY_KEYS: new Set(),
    advanceEncounterPity: () => 1, resetEncounterPity: () => {}, FULL_ODDS_SHINY_PITY_LIMIT: 2000,
  });
  vm.runInContext(extract('const LEGENDARY_BASE_CHANCE =', '\n// A hunt') + '\n'
    + extract('const EXPLORE_GOLDEN_CHANCE', '\nfunction getEventPokemonKey('), ctx);
  rolls = [1 / 666 - 0.0000001, 0, 0];
  const shiny = ctx.rollExploreEncounter('user', 'fire');
  assert.equal(shiny.speciesId, 146);
  assert.equal(shiny.rarity, 'Legendary');
  assert.equal(shiny.isShiny, true);
  assert.equal(shiny.isExplore, true);
  rolls = [1 / 666, 0];
  assert.equal(ctx.rollExploreEncounter('user', 'fire').speciesId, 4);
});

test('battle icon announcements use persisted trainer win counts', async () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE battle_icon_trainer_wins (
    user_id TEXT NOT NULL, npc_index INTEGER NOT NULL, wins INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, npc_index)
  )`);
  const dbSource = fs.readFileSync(require.resolve('../db.js'), 'utf8');
  const start = dbSource.indexOf('function recordBattleIconTrainerWin(');
  const end = dbSource.indexOf('\nconst ICON_DROP_TEST_USER_ID', start);
  const ctx = vm.createContext({ db, assertUserId: (id) => assert.ok(id), Number });
  vm.runInContext(dbSource.slice(start, end), ctx);
  ctx.recordBattleIconTrainerWin('user', 3);
  ctx.recordBattleIconTrainerWin('user', 3);
  ctx.recordBattleIconTrainerWin('user', 4);
  assert.equal(ctx.getBattleIconTrainerWins('user', 3), 2);
  assert.equal(ctx.getBattleIconTrainerWins('user', 4), 1);
  assert.equal(ctx.getBattleIconTrainerWins('other', 3), 0);
  const payloads = [];
  Object.assign(ctx, {
    EmbedBuilder, Date, console, getAllRareSpawnAnnouncementChannels: () => ['channel'],
    resolveAnnouncementChannels: async () => ['channel'], getNpcTrainerName: () => 'Brock',
    getNpcIconEmojiOrBlank: () => '🪨', getRareSpawnNameHidden: () => false,
    client: { user: { username: 'Bot', displayAvatarURL: () => 'https://example.com/icon.png' } },
    getNpcIconUrl: () => null, sendToChannels: async (_channels, payload) => payloads.push(payload),
  });
  vm.runInContext(extract('async function announceBattleIconDrop(', '\nasync function sendRareSpawnChannelEmbed('), ctx);
  await ctx.announceBattleIconDrop({ id: 'guild' }, { id: 'user', username: 'Ash' }, 3);
  assert.match(payloads[0].embeds[0].toJSON().description, /tracked since this update: \*\*2\*\*/);
  const chamber = extract('async function runMegaChamberGauntlet(', '\nasync function run');
  assert.match(chamber, /recordBattleIconTrainerWin\(userId, iconIndex\)/);
  const league = extract('async function runLeagueChallenge(', '\nasync function ');
  assert.match(league, /recordBattleIconTrainerWin\(userId, challengeIconIndex\)/);
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

test('Explore step status follows the daily reset and current tier', () => {
  const { getDailyResetDay, getNextDailyReset } = require('../db');
  const now = 100000000;
  const user = { has_patreon: 1, explore_steps_today: 600, last_explore_reset: now - 1000 };
  assert.deepEqual(data.getExploreStepStatus(user, { exploreSteps: 500 }, now, getDailyResetDay, getNextDailyReset), {
    limit: 500, used: 600, resetAt: getNextDailyReset(now),
  });
  assert.deepEqual(data.getExploreStepStatus(
    user, { exploreSteps: 2500 }, now + 86400000, getDailyResetDay, getNextDailyReset
  ), {
    limit: 2500, used: 0, resetAt: getNextDailyReset(now + 86400000),
  });
  const beforeReset = Date.parse('2026-11-10T04:59:00Z');
  user.last_explore_reset = Date.parse('2026-11-09T23:00:00Z');
  assert.equal(data.getExploreStepStatus(
    user, { exploreSteps: 500 }, beforeReset, getDailyResetDay, getNextDailyReset
  ).used, 600);
  const afterReset = Date.parse('2026-11-10T05:01:00Z');
  assert.deepEqual(data.getExploreStepStatus(
    user, { exploreSteps: 500 }, afterReset, getDailyResetDay, getNextDailyReset
  ), {
    limit: 500, used: 0, resetAt: Date.parse('2026-11-11T05:00:00Z'),
  });
  user.has_patreon = 0;
  assert.equal(data.getExploreStepStatus(
    user, { exploreSteps: 500 }, now, getDailyResetDay, getNextDailyReset
  ).limit, 0);
});

test('Explore step counter resets on the daily boundary even before 24 hours elapse', () => {
  const { getDailyResetDay } = require('../db');
  const user = {
    explore_steps_today: 600,
    last_explore_reset: Date.parse('2026-11-09T23:00:00Z'),
  };
  const updates = [];
  let now = Date.parse('2026-11-10T04:59:00Z');
  const context = vm.createContext({
    Date: { now: () => now },
    userId: 'trainer',
    getUser: () => user,
    getDailyResetDay,
    updateUser: (_userId, fields) => {
      updates.push(fields);
      Object.assign(user, fields);
    },
  });
  const readSteps = extract('      const readSteps = () => {', '\n      let x =');
  const readStepsFunction = vm.runInContext(`(() => { ${readSteps}; return readSteps; })()`, context);
  readStepsFunction();
  assert.equal(user.explore_steps_today, 600);
  assert.equal(updates.length, 0);

  now = Date.parse('2026-11-10T05:01:00Z');
  assert.equal(readStepsFunction(), 0);
  assert.equal(user.explore_steps_today, 0);
  assert.equal(user.last_explore_reset, now);
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
    getExploreCatalogEntries: () => [], getExploreLegendaryEntries: () => [],
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

test('wild starter encounters retain Explore shiny exclusivity', () => {
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
    EVENT_SPAWN_PITY_MIN: 300, EVENT_SPAWN_PITY_LIMIT: 500, LEGENDARY_SPAWN_PITY_LIMIT: 167,
    LEGENDARY_BASE_CHANCE: 1 / 167, LEGENDARY_GOLDEN_RAZZ_CHANCE: 1 / 125,
    FULL_ODDS_SHINY_PITY_LIMIT: 750, WILD_SHINY_PITY_MIN: 1000, WILD_SHINY_PITY_LIMIT: 2000,
    DAILY_HUNT_SPAWN_BOOST_CHANCE: 0.1,
    EVENT_TICKET_SHINY_RATES: { standard: { event: 0.01, nonEvent: 0.001 }, patreon: { event: 0.02, nonEvent: 0.002 } },
    BASE_SHINY_RATE: 0.001, PATREON_SHINY_RATE: 0.002, CATCHBOT_SHINY_MULTIPLIER: 0.25, INCENSE_BOOST: 1.1,
    CATCHBOT_RARITY_WEIGHTS: { Common: 55 }, CATCHBOT_SHINY_DENOMINATORS: [100000],
    CATCHBOT_LEGENDARY_DENOMINATORS: [6666],
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
  assert.equal(shinyPityAdvances, 0);
  assert.equal(shinyPityResets, 0);
  ctx.rollSpawn('land', 'user', null, { catchbot: true });
  assert.deepEqual([...selections.at(-1).excluded], ['Other exclusive']);
  forcedEvent = true;
  ctx.advanceEventSpawnPity = () => 300;
  assert.equal(ctx.rollSpawn('land', 'user').isShiny, true);
});

test('wild Shiny and event rolls do not use old pity counters', () => {
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
    HARD_RARITY_RATE_MULTIPLIER: 1, isPlayerBonusActive: () => false, getEventSpawnChance: () => 1 / 500,
    EVENT_SPAWN_PITY_MIN: 300, EVENT_SPAWN_PITY_LIMIT: 500,
    LEGENDARY_SPAWN_PITY_LIMIT: 167, LEGENDARY_BASE_CHANCE: 1 / 167,
    LEGENDARY_GOLDEN_RAZZ_CHANCE: 1 / 125, WILD_SHINY_PITY_MIN: 1000, WILD_SHINY_PITY_LIMIT: 2000,
    DAILY_HUNT_SPAWN_BOOST_CHANCE: 0.1,
    EVENT_TICKET_SHINY_RATES: { standard: { event: 0.01, nonEvent: 0.001 }, patreon: { event: 0.02, nonEvent: 0.002 } },
    BASE_SHINY_RATE: 0.001, PATREON_SHINY_RATE: 0.002, CATCHBOT_SHINY_MULTIPLIER: 0.25, INCENSE_BOOST: 1.1,
  });
  vm.runInContext(extract('function rollSpawn(', '\nconst EXPLORE_GOLDEN_CHANCE'), ctx);
  const rod = { enablesLegendary: false, enablesShiny: true, baseShinyRate: 0.001 };
  shinyCount = 998;
  assert.equal(ctx.rollSpawn('land', 'user').isShiny, true);
  assert.equal(shinyCount, 998);
  assert.equal(ctx.rollSpawn('water', 'user', rod).isShiny, true);
  assert.equal(shinyCount, 998);
  random = 0.9;
  assert.equal(ctx.rollSpawn('land', 'user').isShiny, false);
  assert.equal(ctx.rollSpawn('water', 'user', rod).isShiny, false);
  shinyCount = 999;
  speciesId = 1;
  assert.equal(ctx.rollSpawn('land', 'user').isShiny, false);
  assert.equal(shinyCount, 999);
  speciesId = 2;
  assert.equal(ctx.rollSpawn('water', 'user', { enablesShiny: false }).isShiny, false);
  assert.equal(shinyCount, 999);
  shinyCount = 10;
  eventActive = true;
  eventCount = 298;
  random = 0;
  assert.equal(ctx.rollSpawn('water', 'user', rod).isEventSpawn, true);
  assert.equal(eventCount, 298);
  assert.equal(shinyCount, 10);
  shinyCount = 10;
  eventCount = 499;
  random = 0.9;
  const event = ctx.rollSpawn('water', 'user', rod);
  assert.equal(event.isEventSpawn, undefined);
  assert.equal(event.isShiny, false);
  assert.equal(shinyCount, 10);
  assert.equal(eventCount, 499);
  eventActive = false;
  shinyCount = 998;
  ctx.rollSpecialLegendarySpawn = () => ({ name: 'Special', isShiny: true });
  assert.equal(ctx.rollSpawn('land', 'user').isShiny, true);
  assert.equal(shinyCount, 998);
  shinyCount = 1999;
  ctx.rollSpecialLegendarySpawn = () => ({ name: 'Special', isShiny: false });
  assert.equal(ctx.rollSpawn('land', 'user').isShiny, false);
  assert.equal(shinyCount, 1999);
});

test('checklist displays Explore usage, reset and access status', async () => {
  const { EmbedBuilder } = require('discord.js');
  const { getDailyResetDay, getNextDailyReset } = require('../db');
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
    getDailyResetDay, getNextDailyReset,
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

test('Explore zooms each map and follows the trainer without cropping the map world', async () => {
  const originalFetch = global.fetch;
  const icon = createCanvas(4, 4);
  const iconCtx = icon.getContext('2d');
  iconCtx.fillStyle = '#ff00ff';
  iconCtx.fillRect(0, 0, 4, 4);
  iconCtx.clearRect(0, 0, 2, 4);
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
        const { width, height } = renderer.getExploreMapSize(map, variant);
        const original = await loadImage(require('node:path').join(__dirname, '..', 'assets', 'explore', theme.images[variant].file));
        const background = createCanvas(width, height);
        const backgroundCtx = background.getContext('2d');
        backgroundCtx.imageSmoothingEnabled = false;
        backgroundCtx.drawImage(original, 0, 0, width, height);
        for (const [x, y] of [[304, Math.floor(height / 2) - 16], [0, 0], [width - 32, height - 32]]) {
          const image = await loadImage(await renderer.renderExploreMap(map, x, y, 'https://example.test/icon.png', variant));
          assert.equal(image.width, 640);
          assert.equal(image.height, 480);
          const result = createCanvas(image.width, image.height);
          const context = result.getContext('2d');
          context.drawImage(image, 0, 0);
          const viewX = Math.max(0, Math.min(width - 320, x + 16 - 160));
          const viewY = Math.max(0, Math.min(height - 240, y + 16 - 120));
          const expected = createCanvas(640, 480);
          const expectedCtx = expected.getContext('2d');
          expectedCtx.imageSmoothingEnabled = false;
          expectedCtx.scale(2, 2);
          expectedCtx.translate(-viewX, -viewY);
          expectedCtx.drawImage(background, 0, 0);
          for (const [px, py] of [[200, 80], [440, 80], [200, 400], [440, 400]]) {
            assert.deepEqual([...context.getImageData(px, py, 1, 1).data], [...expectedCtx.getImageData(px, py, 1, 1).data]);
          }
          const size = map === 'water' && variant === 1 ? 40 : 24;
          const trainerX = Math.max(0, Math.min(width - size, x + (32 - size) / 2));
          const trainerY = Math.max(0, Math.min(height - size, y + 32 - size));
          assert.deepEqual([...context.getImageData(
            Math.floor((trainerX + size * 0.75 - viewX) * 2), Math.floor((trainerY + size / 2 - viewY) * 2), 1, 1
          ).data], [255, 0, 255, 255]);
        }
      }
    }
    assert.equal(fetches, 1);
    const chestMap = await loadImage(await renderer.renderExploreMap('grass', 48, 64, 'https://example.test/icon.png', 0, { x: 80, y: 64 }));
    const chestCanvas = createCanvas(chestMap.width, chestMap.height);
    const chestContext = chestCanvas.getContext('2d');
    chestContext.drawImage(chestMap, 0, 0);
    assert.deepEqual([...chestContext.getImageData(206, 140, 1, 1).data], [0, 255, 0, 255]);
    const occupiedMap = await loadImage(await renderer.renderExploreMap('grass', 48, 64, 'https://example.test/icon.png', 0, { x: 48, y: 64 }));
    chestContext.drawImage(occupiedMap, 0, 0);
    assert.deepEqual([...chestContext.getImageData(100, 140, 1, 1).data], [0, 255, 0, 255]);
    assert.deepEqual([...chestContext.getImageData(135, 160, 1, 1).data], [255, 0, 255, 255]);
    assert.deepEqual([...chestContext.getImageData(100, 190, 1, 1).data], [0, 255, 0, 255]);
    const emptyMap = await loadImage(await renderer.renderExploreMap('grass', 48, 64, 'https://example.test/icon.png', 0));
    const emptyCanvas = createCanvas(emptyMap.width, emptyMap.height);
    const emptyContext = emptyCanvas.getContext('2d');
    emptyContext.drawImage(emptyMap, 0, 0);
    assert.deepEqual([...chestContext.getImageData(160, 130, 1, 1).data], [...emptyContext.getImageData(160, 130, 1, 1).data]);
    const rightEdge = await loadImage(await renderer.renderExploreMap('grass', 608, 64, 'https://example.test/icon.png', 0, { x: 608, y: 64 }));
    chestContext.drawImage(rightEdge, 0, 0);
    assert.deepEqual([...chestContext.getImageData(580, 140, 1, 1).data], [0, 255, 0, 255]);
    assert.deepEqual([...chestContext.getImageData(620, 160, 1, 1).data], [255, 0, 255, 255]);
    const centered = await loadImage(await renderer.renderExploreMap('grass', 304, 200, 'https://example.test/icon.png', 0));
    chestContext.drawImage(centered, 0, 0);
    assert.deepEqual([...chestContext.getImageData(330, 240, 1, 1).data], [255, 0, 255, 255]);
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

test('only the requested Explore maps use smaller trainer icons', async () => {
  const originalFetch = global.fetch;
  const icon = createCanvas(4, 4);
  icon.getContext('2d').fillStyle = '#ff00ff';
  icon.getContext('2d').fillRect(0, 0, 4, 4);
  global.fetch = async () => ({ ok: true, arrayBuffer: async () => icon.toBuffer('image/png') });
  try {
    for (const [map, variant, size] of [
      ['grass', 0, 24], ['grass', 1, 24], ['fire', 0, 24],
      ['fire', 1, 24], ['water', 0, 24], ['water', 1, 40],
    ]) {
      const { height } = renderer.getExploreMapSize(map, variant);
      const image = await loadImage(await renderer.renderExploreMap(
        map, 304, Math.floor(height / 2) - 16, 'https://example.test/size-icon.png', variant
      ));
      const canvas = createCanvas(image.width, image.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const left = 320 - size;
      const top = 272 - 2 * size;
      for (const [x, y] of [[left, top], [left + 2 * size - 1, top + 2 * size - 1]]) {
        assert.deepEqual([...ctx.getImageData(x, y, 1, 1).data], [255, 0, 255, 255]);
      }
      for (const [x, y] of [[left - 1, top], [left, top - 1], [left + 2 * size, top]]) {
        assert.notDeepEqual([...ctx.getImageData(x, y, 1, 1).data], [255, 0, 255, 255]);
      }
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test('Explore scales trainer icons while preserving their proportions', async () => {
  const originalFetch = global.fetch;
  const icons = {
    'https://example.test/tall.png': [4, 8],
    'https://example.test/wide.png': [8, 4],
  };
  global.fetch = async (url) => {
    const [width, height] = icons[url];
    const icon = createCanvas(width, height);
    const ctx = icon.getContext('2d');
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(0, 0, width, height);
    return { ok: true, arrayBuffer: async () => icon.toBuffer('image/png') };
  };
  try {
    for (const [url, inside, outside] of [
      ['https://example.test/tall.png', [[116, 144], [139, 191]], [[115, 144], [140, 191]]],
      ['https://example.test/wide.png', [[104, 168], [151, 191]], [[103, 168], [151, 167]]],
    ]) {
      const image = await loadImage(await renderer.renderExploreMap('grass', 48, 64, url));
      const canvas = createCanvas(image.width, image.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      for (const [x, y] of inside) {
        assert.deepEqual([...ctx.getImageData(x, y, 1, 1).data], [255, 0, 255, 255]);
      }
      for (const [x, y] of outside) {
        assert.notDeepEqual([...ctx.getImageData(x, y, 1, 1).data], [255, 0, 255, 255]);
      }
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test('Explore keeps the trainer visible at map edges without changing movement bounds', async () => {
  const originalFetch = global.fetch;
  const icon = createCanvas(4, 4);
  icon.getContext('2d').fillStyle = '#ff00ff';
  icon.getContext('2d').fillRect(0, 0, 4, 4);
  global.fetch = async () => ({ ok: true, arrayBuffer: async () => icon.toBuffer('image/png') });
  try {
    const { width, height } = renderer.getExploreMapSize('grass', 0);
    assert.equal(renderer.TRAINER_WIDTH, 32);
    assert.equal(renderer.TRAINER_HEIGHT, 32);
    for (const [x, y, left, top] of [
      [0, 0, 8, 16],
      [304, 224, 296, 224],
      [width - 32, height - 32, 584, 432],
    ]) {
      const image = await loadImage(await renderer.renderExploreMap('grass', x, y, 'https://example.test/square.png'));
      const canvas = createCanvas(640, 480);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      for (const [px, py] of [[left, top], [left + 47, top + 47]]) {
        assert.deepEqual([...ctx.getImageData(px, py, 1, 1).data], [255, 0, 255, 255]);
      }
      if (left > 0) assert.notDeepEqual([...ctx.getImageData(left - 1, top, 1, 1).data], [255, 0, 255, 255]);
      if (top > 0) assert.notDeepEqual([...ctx.getImageData(left, top - 1, 1, 1).data], [255, 0, 255, 255]);
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test('Fire Map 1 blocks lava and movement across it', () => {
  const { width, height } = renderer.getExploreMapSize('fire', 0);
  const map = data.EXPLORE_MAPS.fire.images[0];
  for (const [sourceX, sourceY] of [[320, 20], [320, 80], [320, 130], [320, 160]]) {
    const x = sourceX * width / map.width - 16;
    const y = sourceY * height / map.height - 16;
    assert.equal(renderer.isExploreMoveBlocked('fire', 0, x - 32, y, x, y), true);
    assert.equal(renderer.isExploreMoveBlocked('fire', 0, x - 80, y, x + 80, y), true);
  }
  assert.equal(renderer.isExploreMoveBlocked('fire', 0, 304, 200, 304, 200), false);
  assert.equal(renderer.isExploreMoveBlocked('fire', 0, 304, 200, 304, 140), true);
  assert.equal(renderer.isExploreMoveBlocked('fire', 0, 100, 200, 132, 200), false);
  assert.equal(renderer.isExploreMoveBlocked('grass', 0, 300, 160, 332, 192), false);
  assert.equal(renderer.isExploreMoveBlocked('water', 0, 300, 160, 332, 192), false);
});

test('Fire Maps block lava while leaving their starts accessible', () => {
  const targets = [
    { lava: [[320, 20], [320, 80], [320, 130], [320, 160]] },
    { lava: [[65, 75], [177, 86], [210, 248], [145, 312], [250, 312], [200, 330]] },
  ];
  for (const [variant, target] of targets.entries()) {
    const map = data.EXPLORE_MAPS.fire.images[variant];
    const { width, height } = renderer.getExploreMapSize('fire', variant);
    for (const [reason, points] of Object.entries(target)) {
      for (const [sourceX, sourceY] of points) {
        const x = sourceX * width / map.width - 16;
        const y = sourceY * height / map.height - 16;
        assert.equal(renderer.getExploreMoveBlockReason('fire', variant, x - 80, y, x + 80, y), reason);
      }
    }
    const startX = Math.floor((width - renderer.TRAINER_WIDTH) * map.startX);
    const startY = Math.floor((height - renderer.TRAINER_HEIGHT) * map.startY);
    assert.equal(renderer.getExploreMoveBlockReason('fire', variant, startX, startY, startX, startY), null);
    assert.ok([[32, 0], [-32, 0], [0, 32], [0, -32]]
      .some(([dx, dy]) => !renderer.isExploreMoveBlocked('fire', variant, startX, startY, startX + dx, startY + dy)));
  }
  assert.equal(renderer.getExploreMoveBlockReason('grass', 0, 300, 160, 332, 192), null);
});

test('Fire Map 2 stairs can be crossed in both directions', () => {
  const map = data.EXPLORE_MAPS.fire.images[1];
  const { width, height } = renderer.getExploreMapSize('fire', 1);
  for (const [sourceX, top, bottom] of [[120, 129, 159], [328, 193, 223]]) {
    const x = sourceX * width / map.width - 16;
    const y1 = top * height / map.height - 32;
    const y2 = bottom * height / map.height;
    assert.equal(renderer.getExploreMoveBlockReason('fire', 1, x, y1, x, y2), null);
    assert.equal(renderer.getExploreMoveBlockReason('fire', 1, x, y2, x, y1), null);
  }
});

test('Explore chests only spawn in positions reachable around lava within four moves', () => {
  const canMove = (x, y, nextX, nextY) =>
    !renderer.isExploreMoveBlocked('fire', 0, x, y, nextX, nextY);
  const start = { x: 304, y: 230 };
  const { width, height } = renderer.getExploreMapSize('fire', 0);
  let frontier = [start];
  const reachable = new Set([`${start.x},${start.y}`]);
  for (let distance = 0; distance < 4; distance += 1) {
    const next = [];
    for (const point of frontier) {
      for (const dx of [-32, 0, 32]) {
        for (const dy of [-32, 0, 32]) {
          const x = point.x + dx;
          const y = point.y + dy;
          const key = `${x},${y}`;
          if (x < 0 || x > width - 32 || y < 0 || y > height - 32
              || reachable.has(key) || !canMove(point.x, point.y, x, y)) continue;
          reachable.add(key);
          next.push({ x, y });
        }
      }
    }
    frontier = next;
  }
  for (let i = 0; i < 100; i += 1) {
    const chest = chests.spawnExploreChest(start.x, start.y, width - 32, height - 32, 32, () => i / 100, canMove);
    assert.ok(reachable.has(`${chest.x},${chest.y}`));
    assert.equal(canMove(chest.x, chest.y, chest.x, chest.y), true);
    assert.notDeepEqual({ x: chest.x, y: chest.y }, start);
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
    getExploreCatalogEntries: () => [], getExploreLegendaryEntries: () => [],
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
  assert.match(source, /const EXPLORE_GOLDEN_CHANCE = 1 \/ 5000;/);
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
  rolls = [0.26, 0.00024];
  const golden = ctx.rollExploreEncounter('user', 'grass');
  assert.equal(golden.speciesId, 252);
  assert.equal(golden.isGolden, true);
  rolls = [0.26, 0.00026, 0.9];
  assert.equal(Boolean(ctx.rollExploreEncounter('user', 'grass').isGolden), false);
  perks = { shinyRatePct: 0, goldenBoost: 0 };
  rolls = [0.26, 0.0002, 0.9];
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
  let clockOffset = 0;
  class TestDate extends Date { static now() { return Date.now() + clockOffset; } }
  const rendered = [];
  const tierPerks = patreonPerks();
  const { getDailyResetDay, getNextDailyReset } = require('../db');
  const math = Object.create(Math);
  math.random = () => nextRolls.length ? nextRolls.shift() : 0;
  const ctx = vm.createContext({
    Math: math, Date: TestDate, console, require: () => ({
      ...renderer, renderExploreMap: async (map, x, y, icon, variant) => {
        rendered.push({ map, variant });
        return Buffer.from('image');
      },
    }), Buffer, ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ComponentType,
    command: 'explore', args: ['gm', '2'], message: msg, userId: 'trainer', PREFIX: '.',
    selectExploreMap: data.selectExploreMap, getExploreStepStatus: data.getExploreStepStatus,
    getDailyResetDay, getNextDailyReset,
    CHEST_EMOJI: chests.CHEST_EMOJI, CHEST_SPAWN_CHANCE: 0, EXPLORE_ITEMS: chests.EXPLORE_ITEMS,
    spawnExploreChest: (x, y) => ({ x, y: y - 32, stepsRemaining: chestLifetime }),
    chooseExploreChestReward: (current, loot) => {
      if (rewardChoice === 'shiny' && !current.explore_shiny_charm) return { special: 'shiny' };
      if (rewardChoice === 'amulet' && !current.explore_amulet_coin) return { special: 'amulet' };
      if (chests.EXPLORE_ITEMS[rewardChoice] && !current[chests.EXPLORE_ITEMS[rewardChoice].field]) return { special: rewardChoice };
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
    RARITY_EMOJIS: { uncommon: ':uncommon:', rare: ':rare:', shiny: ':shiny-rarity:' },
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
      assert.equal(options.counterSource, 'explore');
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
  ctx.args = ['fm', '4'];
  await ctx.run();
  assert.match(payloads.at(-1), /Usage/);
  ctx.args = ['gm', '2'];
  payloads.length = 0;
  await ctx.run();
  assert.match(payloads[0].content, /Grass Map 2.*0\/500/);
  assert.doesNotMatch(payloads[0].content, /Session:.*seconds/);
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
  assert.match(payloads.at(-1).content, /❗ :uncommon: :pokemon: \*\*Bulbasaur\*\* appeared!/);
  assert.doesNotMatch(payloads.at(-1).content, /\*\*Uncommon\*\*/);
  assert.doesNotMatch(payloads.at(-1).content, /\([^)]*\)/);
  assert.doesNotMatch(payloads.at(-1).content, /throw a ball with the buttons on the right/i);
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
  assert.doesNotMatch(payloads.at(-1).content, /Session:.*seconds/);
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
    assert.doesNotMatch(payloads.at(-1).content, /chest appeared/i);
    ctx.CHEST_SPAWN_CHANCE = 0;
    nextRolls = [0.9];
    await click('exp_up');
    assert.match(payloads.at(-1).content, /Press 🔍 to open/);
    await click('exp_search');
    assert.match(payloads.at(-1).content, new RegExp(`found ${expected}`));
    assert.doesNotMatch(payloads.at(-1).content, /Press 🔍 to open/);
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
  assert.doesNotMatch(payloads.at(-1).content, /chest appeared/i);
  ctx.CHEST_SPAWN_CHANCE = 0;
  nextRolls = [0.9];
  await click('exp_right');
  assert.doesNotMatch(payloads.at(-1).content, /chest appeared/i);
  nextRolls = [0.9];
  await click('exp_right');
  assert.doesNotMatch(payloads.at(-1).content, /chest disappeared/i);
  await click('exp_run');
  await endPromise;
  chestLifetime = 5;

  for (const [key, item] of Object.entries(chests.EXPLORE_ITEMS)) {
    rewardChoice = key;
    ctx.chooseExploreChestReward = (current) => ({ special: key });
    user.explore_steps_today = 0;
    ctx.CHEST_SPAWN_CHANCE = 0.1;
    await ctx.run();
    nextRolls = [0, 0.9];
    await click('exp_up');
    ctx.CHEST_SPAWN_CHANCE = 0;
    nextRolls = [0.9];
    await click('exp_up');
    await click('exp_search');
    assert.equal(user[item.field], 1);
    assert.ok(payloads.at(-1).content.includes(`1x ${item.name}`));
    if (key === 'scanner') assert.match(payloads.at(-1).content, /90 seconds left/);
    await click('exp_run');
    await endPromise;
  }
  user.explore_steps_today = 0;
  ctx.CHEST_SPAWN_CHANCE = 0.1;
  chestLifetime = 5;
  await ctx.run();
  assert.match(payloads.at(-1).content, /90 seconds left/);
  nextRolls = [0.105, 0.9];
  await click('exp_up');
  assert.match(payloads.at(-1).content, /A chest appeared on the map/);
  ctx.CHEST_SPAWN_CHANCE = 0;
  for (let i = 0; i < 8; i += 1) {
    nextRolls = [0.9];
    await click(i % 2 === 0 ? 'exp_right' : 'exp_left');
    if (i === 7) assert.match(payloads.at(-1).content, /disappear in 2 movements/);
  }
  nextRolls = [0.9];
  await click('exp_right');
  assert.doesNotMatch(payloads.at(-1).content, /disappeared/);
  clockOffset = 76000;
  nextRolls = [0.9];
  await click('exp_left');
  assert.match(payloads.at(-1).content, /14 seconds left ❗❗/);
  assert.match(payloads.at(-1).content, /The chest disappeared/);
  await click('exp_run');
  await endPromise;
  clockOffset = 0;
  user.explore_steps_today = 0;
  ctx.CHEST_SPAWN_CHANCE = 0.1;
  await ctx.run();
  nextRolls = [0.11, 0.9];
  await click('exp_up');
  assert.doesNotMatch(payloads.at(-1).content, /A chest appeared/);
  nextRolls = [0.109999, 0.9];
  await click('exp_right');
  assert.match(payloads.at(-1).content, /A chest appeared/);
  await click('exp_run');
  await endPromise;
  for (const item of Object.values(chests.EXPLORE_ITEMS)) user[item.field] = 0;
  ctx.CHEST_SPAWN_CHANCE = 0;

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

  const findObstaclePath = (variant, reason) => {
    const map = data.EXPLORE_MAPS.fire.images[variant];
    const { width, height } = renderer.getExploreMapSize('fire', variant);
    const startX = Math.floor((width - renderer.TRAINER_WIDTH) * map.startX);
    const startY = Math.floor((height - renderer.TRAINER_HEIGHT) * map.startY);
    const moves = [
      ['exp_up', 0, -32], ['exp_down', 0, 32], ['exp_left', -32, 0], ['exp_right', 32, 0],
      ['exp_nw', -32, -32], ['exp_ne', 32, -32], ['exp_sw', -32, 32], ['exp_se', 32, 32],
    ];
    const queue = [{ x: startX, y: startY, path: [] }];
    const visited = new Set([`${startX},${startY}`]);
    for (let i = 0; i < queue.length; i++) {
      const { x, y, path } = queue[i];
      for (const [id, dx, dy] of moves) {
        const nextX = Math.max(0, Math.min(width - renderer.TRAINER_WIDTH, x + dx));
        const nextY = Math.max(0, Math.min(height - renderer.TRAINER_HEIGHT, y + dy));
        if (nextX === x && nextY === y) continue;
        const blocked = renderer.getExploreMoveBlockReason('fire', variant, x, y, nextX, nextY);
        if (blocked === reason) return [...path, id];
        const key = `${nextX},${nextY}`;
        if (!blocked && !visited.has(key)) {
          visited.add(key);
          queue.push({ x: nextX, y: nextY, path: [...path, id] });
        }
      }
    }
    throw new Error(`No reachable ${reason} on Fire Map ${variant + 1}`);
  };
  for (const variant of [0, 1]) {
    const obstacles = [['lava', "That's too spicy for a swim"]];
    for (const [reason, text] of obstacles) {
      ctx.args = ['fm', String(variant + 1)];
      user.explore_steps_today = 0;
      ctx.CHEST_SPAWN_CHANCE = 0;
      await ctx.run();
      const path = findObstaclePath(variant, reason);
      for (const move of path.slice(0, -1)) await click(move);
      cancelled = false;
      const before = user.explore_steps_today;
      assert.equal((await click(path.at(-1)))[0].content, text);
      assert.equal(user.explore_steps_today, before);
      assert.equal(cancelled, false);
      await click('exp_search');
      assert.equal(user.explore_steps_today, before + 1);
      await click('exp_run');
      await endPromise;
    }
  }

  ctx.args = ['wm', '1'];
  for (const [tier, [steps, seconds]] of Object.entries({
    common: [500, 90], uncommon: [2500, 100], rare: [4000, 120], superRare: [4500, 150],
    legendary: [5000, 180], shiny: [5500, 210], golden: [6000, 240],
  })) {
    user.patreon_tier = tier;
    user.explore_steps_today = steps - 1;
    await ctx.run();
    assert.ok(collectorOptions.time > seconds * 1000 - 1000 && collectorOptions.time <= seconds * 1000);
    assert.doesNotMatch(payloads.at(-1).content, /Session:.*seconds/);
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
    [['gm', '1'], 'grass', 0], [['gm', '2'], 'grass', 1],
    [['fm', '1'], 'fire', 0], [['fm', '2'], 'fire', 1],
    [['wm', '1'], 'water', 0], [['wm', '2'], 'water', 1],
  ]) {
    ctx.args = args;
    await ctx.run();
    assert.deepEqual(rendered.at(-1), { map, variant });
    if (map === 'water' && variant === 1) {
      const before = user.explore_steps_today;
      await click('exp_up');
      assert.equal(user.explore_steps_today, before + 1);
    }
    await click('exp_run');
    await endPromise;
  }
  for (const [map, variant] of [['grass', 1], ['fire', 1], ['water', 1]]) {
    ctx.args = [map];
    nextRolls = [0.999];
    await ctx.run();
    assert.deepEqual(rendered.at(-1), { map, variant });
    await click('exp_run');
    await endPromise;
  }
  user.explore_steps_today = 0;
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
