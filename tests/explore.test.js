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

const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');
function extract(start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `Could not extract ${start}`);
  return source.slice(first, last);
}

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
    advanceEncounterPity: (_userId, kind) => {
      if (kind === 'shiny') { shinyPityAdvances += 1; return 750; }
      return 0;
    },
    resetEncounterPity: (_userId, kind) => { if (kind === 'shiny') shinyPityResets += 1; },
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
    EVENT_SPAWN_PITY_LIMIT: 100, LEGENDARY_SPAWN_PITY_LIMIT: 167,
    LEGENDARY_BASE_CHANCE: 1 / 167, LEGENDARY_GOLDEN_RAZZ_CHANCE: 1 / 125,
    FULL_ODDS_SHINY_PITY_LIMIT: 750, DAILY_HUNT_SPAWN_BOOST_CHANCE: 0.25,
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
  assert.equal(ctx.rollSpawn('land', 'user').isShiny, true);
});

test('Explore draws each supplied map at its aspect ratio with the selected trainer icon', async () => {
  const originalFetch = global.fetch;
  const icon = createCanvas(4, 4);
  const iconCtx = icon.getContext('2d');
  iconCtx.fillStyle = '#ff00ff';
  iconCtx.fillRect(0, 0, 4, 4);
  let fetches = 0;
  global.fetch = async () => {
    fetches += 1;
    return { ok: true, arrayBuffer: async () => icon.toBuffer('image/png') };
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

test('Explore session handles movement, encounter, catch, summary and ownership', async () => {
  const events = new EventEmitter();
  const user = { has_patreon: 1, explore_steps_today: 0, last_explore_reset: Date.now(),
    pokeballs: 2, greatballs: 0, ultraballs: 0, premierballs: 0, masterballs: 0 };
  const payloads = [];
  let endPromise;
  let cancelled = false;
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
      return { edit: async (p) => { payloads.push(p); }, createMessageComponentCollector: () => collector };
    },
  };
  let rollAbility;
  let shinyBoost;
  const math = Object.create(Math);
  math.random = () => 0;
  const ctx = vm.createContext({
    Math: math, Date, console, require: () => ({
      ...renderer, renderExploreMap: async () => Buffer.from('image'),
    }), Buffer, ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ComponentType,
    command: 'explore', args: ['grass'], message: msg, userId: 'trainer', PREFIX: '.',
    isBotAdmin: (message) => message.isAdmin === true,
    activeExploreSessions: new Set(), BALL_CONFIG: Object.fromEntries(
      [['pb', 'pokeballs'], ['gb', 'greatballs'], ['ub', 'ultraballs'], ['prb', 'premierballs'], ['mb', 'masterballs']]
        .map(([key, column]) => [key, { column, buttonEmoji: '🔴' }])
    ),
    getUser: () => user, updateUser: (_id, fields) => Object.assign(user, fields),
    incrementUser: (_id, fields) => { for (const [key, amount] of Object.entries(fields)) user[key] += amount; },
    getTrainerIconUrl: () => 'trainer-icon', resolveLeadOverworldAbility: async () => 'frisk',
    getOverworldEncounterMultiplier: (ability) => { rollAbility = ability; return 1; },
    getChannelCatchRateBoost: () => 5,
    rollExploreEncounter: (_id, map, boost) => {
      shinyBoost = boost;
      return { name: 'Bulbasaur', rarity: 'Uncommon', isExplore: true, map };
    },
    rollWildHeldItem: () => ({ name: 'Seed', emoji: '🌱' }),
    getDisplayRarity: (rarity) => rarity, heldItemNameMarker: () => '',
    getRarityEmojis: () => '', factionLogoPrefix: () => '',
    askForBall: async (_message, _id, wild, _mode, options) => {
      assert.equal(wild.overworldAbility, 'frisk');
      assert.equal(wild.friskReveal, true);
      assert.equal(wild.heldItemRolled, true);
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
  assert.match(payloads[0], /bot admins only/);
  assert.equal(ctx.activeExploreSessions.size, 0);
  ctx.command = 'exp';
  await ctx.run();
  assert.match(payloads.at(-1), /bot admins only/);
  ctx.command = 'explore';
  payloads.length = 0;
  msg.isAdmin = true;
  await ctx.run();
  assert.match(payloads[0].content, /0\/1000/);
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
  assert.equal(rollAbility, 'frisk');
  assert.equal(shinyBoost, 5);
  assert.match(payloads.at(-1).content, /Bulbasaur/);
  assert.match((await click('exp_down'))[0].content, /before moving/);
  await click('exp_ball:pb');
  assert.match(payloads.at(-1).content, /Caught Bulbasaur/);
  await click('exp_run');
  await endPromise;
  assert.match(payloads.at(-1).content, /Pokémon caught \(1\): Bulbasaur/);
  assert.match(payloads.at(-1).content, /Items found \(1\): 1x Seed/);
  assert.match(payloads.at(-1).content, /Coins earned: \*\*123\*\*/);
  assert.equal(payloads.at(-1).components.length, 0);
  assert.equal(ctx.activeExploreSessions.has('trainer'), false);
  assert.equal(cancelled, false);

  user.explore_steps_today = 1000;
  await ctx.run();
  assert.equal(payloads.at(-1).components[0].components[0].data.disabled, true);
  assert.match((await click('exp_up'))[0].content, /all of your exploring steps/);
  assert.equal(user.explore_steps_today, 1000);
  await click('exp_run');
  await endPromise;

  user.explore_steps_today = 0;
  await ctx.run();
  await click('exp_up');
  collector.stop('time');
  await endPromise;
  assert.equal(cancelled, true);
  assert.equal(ctx.activeExploreSessions.has('trainer'), false);
  assert.match(payloads.at(-1).content, /session has ended/);
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
  assert.match(embed.description, /bot admins only/);
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
