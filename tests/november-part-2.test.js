const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Database = require('better-sqlite3');
const { EmbedBuilder } = require('discord.js');
const catalog = require('../data/pokemon-catalog.json');
const rarities = require('../data/pokemon-rarities.json');
const referenceForms = require('../pokemon-database/formes.json');
const event = require('../events/november-part-2-2026');
const previousEvent = require('../events/november-2026');
const { getCurrentEvent } = require('../events');
const { loadPokemonDatabase } = require('../pokemon-database');
const { getPokemonDexNumbers, isGoldenDexNumber } = require('../pokemon-dex-numbers');
const { getPokemonShowdownSprite } = require('../pokemon-sprites');
const { appendCustomPokemonForms } = require('../scripts/pokemon-custom-forms');

const dbSource = fs.readFileSync(require.resolve('../db.js'), 'utf8');
const indexSource = fs.readFileSync(require.resolve('../index.js'), 'utf8');
test('Enamorus Incarnate uses its normal and shiny Showdown sprites', () => {
  assert.equal(
    getPokemonShowdownSprite('enamorus-incarnate'),
    'https://play.pokemonshowdown.com/sprites/ani/enamorus.gif'
  );
  assert.equal(
    getPokemonShowdownSprite('enamorus-incarnate', true),
    'https://play.pokemonshowdown.com/sprites/ani-shiny/enamorus.gif'
  );
});

const checklistSlugs = [
  'gastly', 'weedle', 'swinub', 'deerling-winter', 'delibird', 'oricorio-baile',
  'growlithe-hisui', 'walking-wake', 'castform-snowy', 'zigzagoon-galar',
  'necrozma-dusk', 'necrozma-dawn',
];
const turquoiseForms = [
  ['turquoise-rookidee', 10821, 'Rookidee'],
  ['turquoise-corvisquire', 10822, 'Corvisquire'],
  ['turquoise-corviknight', 10823, 'Corviknight'],
];

function extract(source, start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Could not extract ${start}`);
  return source.slice(first, last);
}

function catalogDatabase() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE pokemon_forms (
    id INTEGER PRIMARY KEY, species_id INTEGER, species_name TEXT, name TEXT,
    slug TEXT, is_default INTEGER, rarity TEXT
  )`);
  const insert = db.prepare('INSERT INTO pokemon_forms VALUES (?, ?, ?, ?, ?, ?, ?)');
  const overrides = loadPokemonDatabase();
  for (const form of catalog) {
    const data = overrides.get(form.slug);
    insert.run(form.id, form.species_id, form.species_name, data?.name || form.name,
      form.slug, form.is_default, data?.rarity || form.rarity);
  }
  return db;
}

test('November Part 2 starts at the previous event boundary and runs for three weeks', () => {
  const start = Date.parse(event.startsAt);
  const end = Date.parse(event.endsAt);
  assert.equal(event.startsAt, previousEvent.endsAt);
  assert.equal(event.startsAt, '2026-11-25T05:00:00.000Z');
  assert.equal(event.endsAt, '2026-12-16T05:00:00.000Z');
  assert.equal(end - start, 21 * 24 * 60 * 60 * 1000);
  assert.equal(getCurrentEvent(start - 1).id, previousEvent.id);
  assert.equal(getCurrentEvent(start).id, event.id);
  assert.equal(getCurrentEvent(end - 1).id, event.id);
  const ctx = vm.createContext({});
  vm.runInContext(extract(indexSource, 'function isEventOpen(', '\n// Resolves configured announcement'), ctx);
  assert.equal(ctx.isEventOpen(event, start - 1), false);
  assert.equal(ctx.isEventOpen(event, start), true);
  assert.equal(ctx.isEventOpen(event, end - 1), true);
  assert.equal(ctx.isEventOpen(event, end), false);
});

test('all event checklist entries resolve to the requested spawn forms and register catches', () => {
  const db = catalogDatabase();
  try {
    db.exec(`
      CREATE TABLE event_pokemon (event_id TEXT, pokemon_key TEXT, name TEXT, match_names TEXT,
        shiny INTEGER, PRIMARY KEY (event_id, pokemon_key));
      CREATE TABLE event_catches (event_id TEXT, user_id TEXT, pokemon_key TEXT, catch_count INTEGER DEFAULT 1,
        PRIMARY KEY (event_id, user_id, pokemon_key));
    `);
    let ticket = true;
    const ctx = vm.createContext({
      db, getUser: () => ({ event_ticket: ticket }), halloweenEvent: event,
      eventSpawnFormIds: [], eventSpawnEntries: [], EVENT_FISH_SPECIES: new Set(),
      EVENT_NON_FISH_SPECIES: [], EVENT_FISH_SPAWN_FORM_IDS: [],
    });
    vm.runInContext(extract(dbSource, 'function findPokemonForms(', '\nconst SPECIAL_SPAWN_RESERVED_SPECIES'), ctx);
    vm.runInContext(extract(dbSource, 'function registerEvent(', '\nfunction advanceEventSpawnPity('), ctx);
    vm.runInContext(extract(dbSource, 'function trackEventCatch(', '\nfunction getPlayerClan('), ctx);
    vm.runInContext(extract(indexSource, 'const eventSpeciesName =', '\ndb.exec(`CREATE TABLE IF NOT EXISTS active_event_state'), ctx);
    vm.runInContext(extract(indexSource, 'function getEventPokemonKey(', '\nfunction getRarityInfo('), ctx);
    ctx.registerEvent(event);
    ctx.buildEventSpawnData(event);
    assert.equal(event.pokemon.length, 12);
    assert.equal(ctx.eventSpawnEntries.length, 12);
    assert.equal(event.checklistTargets.full, 12);
    for (let i = 0; i < checklistSlugs.length; i++) {
      const form = db.prepare('SELECT * FROM pokemon_forms WHERE slug = ?').get(checklistSlugs[i]);
      assert.deepEqual(Array.from(ctx.eventSpawnEntries[i].ids), [form.id], checklistSlugs[i]);
      const shiny = i < 6;
      assert.equal(ctx.eventSpawnEntries[i].shiny, shiny);
      assert.equal(ctx.getEventPokemonKey({ name: form.name, isShiny: shiny }), event.pokemon[i].key);
      assert.equal(ctx.getEventPokemonKey({ name: form.name, isShiny: !shiny }), null);
      assert.equal(ctx.recordEventCatch(event.id, 'user', form.name, !shiny), null);
      if (i === 0) {
        ticket = false;
        assert.equal(ctx.recordEventCatch(event.id, 'user', form.name, shiny), null);
        ticket = true;
      }
      const result = ctx.recordEventCatch(event.id, 'user', form.name, shiny);
      assert.equal(result.added, true);
      assert.equal(result.progressCount, i + 1);
      assert.equal(ctx.recordEventCatch(event.id, 'user', form.name, shiny).added, false);
    }
    assert.equal(ctx.getUserEventProgress(event.id, 'user').size, 12);
    const wake = db.prepare("SELECT id FROM pokemon_forms WHERE slug = 'walking-wake'").get();
    assert.deepEqual(Array.from(ctx.EVENT_FISH_SPAWN_FORM_IDS), [wake.id]);
    assert.equal(ctx.eventSpawnEntries[5].patreonOnly, true);
    assert.equal(ctx.eventSpawnEntries[7].fishOnly, true);
    assert.equal(ctx.eventSpawnEntries[7].fish, true);
  } finally {
    db.close();
  }
});

test('only Patreon ticket holders spawn Shiny Oricorio and Walking Wake spawns only while fishing', () => {
  const db = catalogDatabase();
  try {
    let ticket = true;
    let patreon = false;
    let preferredId = null;
    let ordinaryId = 1;
    let selectedPool = [];
    const math = Object.create(Math);
    math.random = () => 0;
    const ctx = vm.createContext({
      db, Math: math, halloweenEvent: event,
      eventSpawnFormIds: [], eventSpawnEntries: [], EVENT_FISH_SPECIES: new Set(),
      EVENT_NON_FISH_SPECIES: [], EVENT_FISH_SPAWN_FORM_IDS: [],
      getUser: () => ({ event_ticket: ticket, has_patreon: patreon }),
      isEventOpen: () => true, consumeIncenseCharge: () => false, consumePokeradarCharge: () => false,
      getClanPerkMultipliers: () => ({ erBonus: 0 }), getTotalEffectiveShinyBonus: () => 0,
      consumeEncounterModifier: () => 'normal', getChamberSpawnSpecies: () => [],
      getPatreonPerks: () => ({ eventShinyPct: 0, shinyRatePct: 0 }),
      isPlayerBonusActive: () => false, getEventSpawnChance: () => 1,
      getRaritySettings: () => [{ name: 'Common', spawn_weight: 1, pokemon_count: 1 }],
      rollSpecialLegendarySpawn: () => null, getActiveHuntTarget: () => null,
      chooseEncounterRarity: () => 'Common', getEncounterRarityRate: () => 1, formatPercent: () => '100%',
      getChanceFromFlooredOdds: (chance) => chance,
      pickWeighted: (pool) => {
        selectedPool = Array.from(pool);
        return selectedPool.find((entry) => entry.ids.includes(preferredId)) || selectedPool[0];
      },
      getRandomPokemon: (_rarity, _water, _gmax, _mega, _allowed, _excluded, ids) => {
        const form = db.prepare('SELECT * FROM pokemon_forms WHERE id = ?').get(ids ? ids[0] : ordinaryId);
        return { id: form.id, name: form.name, speciesId: form.species_id,
          speciesName: form.species_name, rarity: form.rarity };
      },
      SPECIAL_SPAWN_RESERVED_SPECIES: [], EXPLORE_EXCLUSIVE_SHINY_IDS: new Set(),
      EGG_ONLY_SHINY_SPECIES_KEYS: new Set(), FISH_ONLY_SHINY_KEYS: new Set(),
      FISH_PATREON_ONLY_SHINY_KEYS: new Set(), HARD_RARITY_USER_IDS: new Set(),
      HARD_RARITY_RATE_MULTIPLIER: 1, DAILY_HUNT_SPAWN_BOOST_CHANCE: 0.1,
      EVENT_TICKET_SHINY_RATES: { standard: { event: 0.01, nonEvent: 0.001 }, patreon: { event: 0.02 } },
      BASE_SHINY_RATE: 1 / 3000, INCENSE_BOOST: 1.1,
      LEGENDARY_BASE_CHANCE: 1 / 333, LEGENDARY_GOLDEN_RAZZ_CHANCE: 1 / 250,
    });
    vm.runInContext(extract(dbSource, 'function findPokemonForms(', '\nconst SPECIAL_SPAWN_RESERVED_SPECIES'), ctx);
    vm.runInContext(extract(indexSource, 'const eventSpeciesName =', '\ndb.exec(`CREATE TABLE IF NOT EXISTS active_event_state'), ctx);
    vm.runInContext(extract(indexSource, 'function getEventPokemonKey(', '\nfunction getRarityInfo('), ctx);
    vm.runInContext(extract(indexSource, 'function rollSpawn(', '\nconst exploreCatalogCache'), ctx);
    ctx.buildEventSpawnData(event);
    const oricorio = db.prepare("SELECT id FROM pokemon_forms WHERE slug = 'oricorio-baile'").get().id;
    const wake = db.prepare("SELECT id FROM pokemon_forms WHERE slug = 'walking-wake'").get().id;
    const rod = { enablesShiny: false, enablesLegendary: false, baseShinyRate: 0 };

    preferredId = oricorio;
    assert.notEqual(ctx.rollSpawn('land', 'user').id, oricorio);
    assert.equal(selectedPool.some((entry) => entry.ids.includes(oricorio)), false);
    assert.equal(selectedPool.some((entry) => entry.ids.includes(wake)), false);
    patreon = true;
    const shiny = ctx.rollSpawn('land', 'user');
    assert.equal(shiny.id, oricorio);
    assert.equal(shiny.isShiny, true);
    assert.equal(selectedPool.some((entry) => entry.ids.includes(wake)), false);
    preferredId = wake;
    for (const membership of [false, true]) {
      patreon = membership;
      const fishing = ctx.rollSpawn('water', 'user', rod);
      assert.equal(fishing.id, wake);
      assert.equal(fishing.isShiny, false);
      assert.deepEqual(selectedPool.map((entry) => entry.ids[0]), [wake]);
    }
    ticket = false;
    patreon = true;
    selectedPool = [];
    assert.notEqual(ctx.rollSpawn('land', 'user').id, oricorio);
    assert.notEqual(ctx.rollSpawn('water', 'user', rod).id, wake);
    assert.equal(selectedPool.length, 0);
    ordinaryId = oricorio;
    for (const membership of [false, true]) {
      patreon = membership;
      assert.equal(ctx.rollSpawn('land', 'user').isShiny, false);
      assert.equal(ctx.rollSpawn('water', 'user', { enablesShiny: true, enablesLegendary: true,
        baseShinyRate: 1 / 625 }).isShiny, false);
    }
  } finally {
    db.close();
  }
});

test('the designated user cannot spawn the final missing event checklist Pokémon', () => {
  const blockedUserId = '130226338769403904';
  const event = {
    id: 'test-event',
    pokemon: [
      { key: 'caught', matchNames: ['Caught Mon'], shiny: false },
      { key: 'last', matchNames: ['Last Mon'], shiny: false },
    ],
  };
  const eventSpawnEntries = event.pokemon.map((pokemon, index) => ({
    key: pokemon.key,
    ids: [index + 1],
    matchNames: pokemon.matchNames,
    shiny: false,
    fish: false,
    fishOnly: false,
    patreonOnly: false,
  }));
  const selectedPools = [];
  let progress = new Set(['caught']);
  const math = Object.create(Math);
  math.random = () => 0;
  const ctx = vm.createContext({
    Math: math,
    halloweenEvent: event,
    eventSpawnEntries,
    getUser: () => ({ event_ticket: 1, has_patreon: 0 }),
    getUserEventProgress: (_eventId, userId) => userId === blockedUserId ? progress : new Set(),
    isEventOpen: () => true,
    consumeIncenseCharge: () => false,
    consumePokeradarCharge: () => false,
    getClanPerkMultipliers: () => ({ erBonus: 0 }),
    getTotalEffectiveShinyBonus: () => 0,
    consumeEncounterModifier: () => 'normal',
    getChamberSpawnSpecies: () => [],
    getPatreonPerks: () => ({ eventShinyPct: 0, shinyRatePct: 0 }),
    isPlayerBonusActive: () => false,
    getEventSpawnChance: () => 1,
    pickWeighted: (entries) => {
      selectedPools.push(Array.from(entries, (entry) => entry.key));
      return entries.find((entry) => entry.key === 'last') || entries[0];
    },
    getRandomPokemon: (_rarity, _water, _gmax, _mega, _allowed, _excluded, ids) => {
      const entry = eventSpawnEntries.find((candidate) => candidate.ids[0] === ids[0]);
      return { id: ids[0], speciesId: ids[0], name: entry.matchNames[0], speciesName: entry.matchNames[0], rarity: 'Common' };
    },
    isEventChecklistSpawn: () => true,
    EVENT_TICKET_SHINY_RATES: { standard: { event: 0.01 }, patreon: { event: 0.02 } },
    HARD_RARITY_USER_IDS: new Set(),
    HARD_RARITY_RATE_MULTIPLIER: 1,
    BASE_SHINY_RATE: 1 / 3000,
    getChanceFromFlooredOdds: (chance) => chance,
  });
  vm.runInContext(
    extract(indexSource, 'function getEventPokemonKey(', '\nfunction getRarityInfo(') +
      '\n' + extract(indexSource, 'function rollSpawn(', '\nfunction isEventChecklistSpawn('),
    ctx
  );

  assert.equal(ctx.rollSpawn('land', blockedUserId).id, 1);
  assert.deepEqual(selectedPools[0], ['caught']);
  progress = new Set();
  assert.equal(ctx.rollSpawn('land', blockedUserId).id, 2);
  assert.deepEqual(selectedPools[1], ['caught', 'last']);
});

test('event checklist displays the requested Patreon and fishing labels with progress', async () => {
  const ctx = vm.createContext({
    halloweenEvent: event, EmbedBuilder, EVENT_EMBED_COLOR: 0x123456,
    client: { user: { displayAvatarURL: () => 'https://example.com/avatar.png' } },
    getUser: () => ({ event_ticket: 1, event_gold_claimed: 0 }),
    getUserEventProgress: () => new Set(['s_oricorio', 'walking_wake']),
    getUserEventCatchCounts: () => new Map([['s_oricorio', 1], ['walking_wake', 2]]),
    isEventOpen: () => true, createEventLinkRow: () => null,
  });
  vm.runInContext(extract(indexSource, 'const POKEMON_SPRITE_EMOJIS =', '\nfunction formatFactionFavorites('), ctx);
  vm.runInContext(extract(indexSource, 'async function handleEventCommand(', '\nasync function getUsernameById('), ctx);
  const payload = await ctx.handleEventCommand({ reply: (value) => value }, 'user', ['cl']);
  const description = payload.embeds[0].toJSON().description;
  assert.ok(description.includes('✅ <:soricorio:1573347784462172321> Shiny Oricorio <:patreonlogo:1573357109058470039> — **1** caught'));
  assert.ok(description.includes('✅ <:WalkingWake:1568037632376569968> Walking Wake (`.fish`) — **2** caught'));
  assert.ok(description.includes('<:sgastly:1573347794121523250> Shiny Gastly — **0** caught'));
});

test('the full checklist grants one Gem Turquoise Rookidee only after all 12 catches', async () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, event_ticket INTEGER, event_reg_claimed INTEGER, event_gold_claimed INTEGER);
      CREATE TABLE event_catches (event_id TEXT, user_id TEXT, pokemon_key TEXT);
      INSERT INTO users VALUES ('user', 1, 0, 0);
    `);
    const insert = db.prepare('INSERT INTO event_catches VALUES (?, ?, ?)');
    for (const pokemon of event.pokemon.slice(0, 11)) insert.run(event.id, 'user', pokemon.key);
    const rewards = [];
    let announcements = 0;
    const ctx = vm.createContext({
      db, halloweenEvent: event,
      getUser: (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id),
      getUserEventProgress: (id, user) => new Set(db.prepare(
        'SELECT pokemon_key FROM event_catches WHERE event_id = ? AND user_id = ?'
      ).all(id, user).map((row) => row.pokemon_key)),
      getUserEventCatchCounts: () => new Map(),
      isEventOpen: () => true, createEventLinkRow: () => null,
      getPokemonFormBySlug: (slug) => catalog.find((form) => form.slug === slug),
      updateUser: (id, fields) => db.prepare('UPDATE users SET event_gold_claimed = ? WHERE id = ?')
        .run(fields.event_gold_claimed, id),
      saveCatch: (id, pokemon, shiny) => rewards.push({ id, pokemon, shiny }),
      announceEventChecklistCompletion: async () => { announcements++; },
      notifyAdminIfRareGrant: async () => {}, formatPokemonReward: (pokemon) => pokemon.name, PREFIX: '.',
    });
    vm.runInContext(extract(indexSource, 'async function handleEventCommand(', '\nasync function getUsernameById('), ctx);
    const message = { guild: {}, author: {}, channel: {}, reply: (content) => content };
    assert.match(await ctx.handleEventCommand(message, 'user', ['claim'], true), /No checklist reward is ready/);
    insert.run(event.id, 'user', event.pokemon[11].key);
    assert.match(await ctx.handleEventCommand(message, 'user', ['claim'], true), /Reward Claimed/);
    assert.match(await ctx.handleEventCommand(message, 'user', ['claim'], true), /No checklist reward is ready/);
    assert.equal(rewards.length, 1);
    assert.equal(rewards[0].pokemon.slug, 'turquoise-rookidee');
    assert.equal(rewards[0].pokemon.rarity, 'Gem');
    assert.equal(rewards[0].shiny, false);
    assert.equal(announcements, 1);
  } finally {
    db.close();
  }
});

test('Turquoise forms retain unique Dex numbers, sprites, and existing form numbering', () => {
  const additions = new Set(turquoiseForms.map(([slug]) => slug));
  const baseline = catalog.filter((form) => !additions.has(form.slug));
  const oldNumbers = getPokemonDexNumbers(baseline);
  const numbers = getPokemonDexNumbers(catalog);
  for (const form of baseline) assert.deepEqual(numbers.get(form.id), oldNumbers.get(form.id), form.slug);

  const customSlugs = new Set(require('../data/custom-pokemon-forms.json').map((form) => form.slug));
  const regenerated = catalog.filter((form) => !customSlugs.has(form.slug));
  appendCustomPokemonForms(regenerated);
  for (const [slug, dexNumber, species] of turquoiseForms) {
    const form = catalog.find((entry) => entry.slug === slug);
    assert.deepEqual(regenerated.find((entry) => entry.slug === slug), form);
    assert.equal(numbers.get(form.id).dexNumber, dexNumber);
    assert.ok(numbers.get(form.id).shinyDexNumber == null);
    assert.equal(isGoldenDexNumber(dexNumber), false);
    assert.deepEqual(catalog.filter((entry) => {
      const dex = numbers.get(entry.id);
      return dex.dexNumber === dexNumber || dex.shinyDexNumber === dexNumber;
    }).map((entry) => entry.slug), [slug]);
    const url = `https://res.cloudinary.com/apffqia5/image/upload/v1795184766/${species}_Animated.gif`;
    assert.equal(getPokemonShowdownSprite(slug), url);
    assert.equal(referenceForms.find((entry) => entry.slug === slug).animated_sprite, url);
    assert.equal(rarities.find((entry) => entry.id === form.id).rarity, 'Gem');
  }
});

test('Turquoise evolution follows standard levels and preserves its Gem form', () => {
  const db = catalogDatabase();
  try {
    const rules = require('../data/pokemon-evolution-rules.json');
    const levelEvolutionRules = new Map();
    for (const rule of rules) {
      const entries = levelEvolutionRules.get(rule.fromSpeciesId) || [];
      entries.push(rule);
      levelEvolutionRules.set(rule.fromSpeciesId, entries);
    }
    let row;
    const ctx = vm.createContext({
      db, levelEvolutionRules, friendshipEvolutionRules: new Map(), TIME_LEVEL_EVOLUTIONS: {},
      assertUserId: () => {}, findOwnedPokemonRows: () => [row],
      applyPokemonEvolution: (_user, _row, target) => ({ to: target.name, rarity: target.rarity }),
    });
    vm.runInContext(extract(dbSource, 'function resolveSpeciesEvolution(', '\nfunction resolveItemEvolution('), ctx);
    vm.runInContext(extract(dbSource, 'function evolvePokemonByLevel(', '\nconst moveInfoData'), ctx);
    for (const [source, target, level] of [
      ['turquoise-rookidee', 'Turquoise Corvisquire', 18],
      ['turquoise-corvisquire', 'Turquoise Corviknight', 38],
      ['rookidee', 'Corvisquire', 18],
      ['corvisquire', 'Corviknight', 38],
    ]) {
      const form = db.prepare('SELECT * FROM pokemon_forms WHERE slug = ?').get(source);
      row = { name: form.name, form_slug: form.slug, form_species: form.species_id,
        form_default: form.is_default, form_rarity: form.rarity, level: level - 1 };
      assert.equal(ctx.evolvePokemonByLevel('user', source).requiredLevel, level);
      row.level = level;
      const result = ctx.evolvePokemonByLevel('user', source);
      assert.equal(result.to, target);
      if (source.startsWith('turquoise-')) assert.equal(result.rarity, 'Gem');
    }
  } finally {
    db.close();
  }
});

test('requested event, Turquoise and Topaz sprite emojis resolve', () => {
  const ctx = vm.createContext({});
  vm.runInContext(extract(indexSource, 'const POKEMON_SPRITE_EMOJIS =', '\nfunction formatFactionFavorites('), ctx);
  const emojis = [
    ['Gastly', true, '1573347794121523250'], ['Weedle', true, '1573347791672184894'],
    ['Swinub', true, '1573347789478297681'], ['Delibird', true, '1573347786781364234'],
    ['Oricorio Baile', true, '1573347784462172321'], ['Hisuian Growlithe', false, '1573347781656182955'],
    ['Walking Wake', false, '1568037632376569968'], ['Castform Snowy', false, '1573347776979402882'],
    ['Galarian Zigzagoon', false, '1573347774651703541'], ['Necrozma Duskmane', false, '1573347772327927828'],
    ['Necrozma Dawnwings', false, '1573347770167861318'],
    ['Deerling Winter', false, '1575024179567140874'], ['Deerling Winter', true, '1575024177323319353'],
    ['Turquoise Rookidee', false, '1573347766271352903'], ['Turquoise Corvisquire', false, '1573347764157415474'],
    ['Turquoise Corviknight', false, '1573347761972060220'], ['Topaz Teddiursa', false, '1573347758558023860'],
    ['Topaz Ursaring', false, '1573347754678296596'],
  ];
  for (const [name, isShiny, id] of emojis) {
    assert.match(ctx.getPokemonSpriteEmoji({ name, isShiny }), new RegExp(`:${id}>$`), name);
  }
  assert.equal(ctx.getPokemonSpriteEmoji({ name: 'Deerling Winter' }), '<:6329:1575024179567140874>');
  assert.equal(ctx.getPokemonSpriteEmoji({ name: 'Deerling Winter', isShiny: true }), '<:6330:1575024177323319353>');
  assert.equal(ctx.getPokemonSpriteEmoji({ name: 'Topaz Teddiursa' }), '<:10217:1573347758558023860>');
  assert.equal(ctx.getPokemonSpriteEmoji({ name: 'Topaz Ursaring' }), '<:10216:1573347754678296596>');
});

test('November Part 2 chambers open and close with the event and award the correct stones', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE pokemon_forms (id INTEGER PRIMARY KEY, species_id INTEGER, is_default INTEGER, is_legendary INTEGER);
      INSERT INTO pokemon_forms VALUES (381, 381, 1, 1), (460, 460, 1, 0), (229, 229, 1, 0), (6, 6, 1, 0);
      CREATE TABLE mega_chambers (user_id TEXT, chamber_key TEXT, sacrifices INTEGER, clears INTEGER,
        PRIMARY KEY (user_id, chamber_key));
      CREATE TABLE mega_stones (user_id TEXT, stone_name TEXT, amount INTEGER,
        PRIMARY KEY (user_id, stone_name));
    `);
    let now = Date.parse(event.startsAt) - 1;
    const ctx = vm.createContext({
      db, ALL_EVENTS: [previousEvent, event],
      Date: class extends Date { static now() { return now; } },
      assertUserId: () => {}, getPatreonPerks: () => null,
      awardCoinsWithBoost: (_id, amount) => ({ finalAmount: amount }), incrementUser: () => {},
    });
    vm.runInContext(`${extract(dbSource, 'const CHAMBER_CONFIG =', '\nfunction getUserChambers(')}
      this.chambers = CHAMBER_CONFIG;`, ctx);
    vm.runInContext(extract(indexSource, 'function isChamberOpen(', '\nconst { parseAmount }'), ctx);
    vm.runInContext(extract(indexSource, 'function creditChamberSacrifice(', '\nfunction createReleaseAnnouncement('), ctx);
    vm.runInContext(extract(dbSource, 'function getChamberRequirement(', '\nfunction megaEvolvePokemon('), ctx);
    const expected = [
      ['latios', 9, 381, 'latios-mega', 'Latiosite', 5],
      ['abomasnow', 10, 460, 'abomasnow-mega', 'Abomasite', 10],
      ['houndoom', 11, 229, 'houndoom-mega', 'Houndoominite', 10],
      ['charizardx', 12, 6, 'charizard-mega-x', 'Charizardite X', 10],
    ];
    const forms = loadPokemonDatabase();
    for (const [key, id, species, slug, stone] of expected) {
      const chamber = ctx.chambers[key];
      assert.equal(chamber.id, id);
      assert.equal(chamber.pokemonId, species);
      assert.equal(chamber.megaSlug, slug);
      assert.equal(chamber.rewardStone, stone);
      const form = catalog.find((entry) => entry.slug === slug);
      assert.equal(form.species_id, species);
      assert.equal(forms.get(slug).rarity, 'Mega');
      assert.equal(ctx.getMegaStoneForForm(form), stone);
      assert.equal(ctx.isChamberOpen(chamber, now), false);
      ctx.creditChamberSacrifice('user', species);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM mega_chambers').get().count, 0);
    assert.equal(ctx.isChamberOpen(ctx.chambers.mewtwox, now), true);
    now++;
    assert.equal(ctx.isChamberOpen(ctx.chambers.mewtwox, now), false);
    assert.deepEqual(Array.from(ctx.getChamberSpawnSpecies()), expected.map((entry) => entry[2]));
    for (const [key, , species, , stone, required] of expected) {
      const chamber = ctx.chambers[key];
      assert.equal(ctx.isChamberOpen(chamber, now), true);
      assert.equal(ctx.getChamberRequirement(chamber), required);
      for (let i = 0; i < required; i++) ctx.creditChamberSacrifice('user', species);
      const reward = ctx.completeMegaChamber('user', key);
      assert.equal(reward.stone, stone);
      assert.equal(reward.remainingSacrifices, 0);
      assert.equal(db.prepare('SELECT amount FROM mega_stones WHERE user_id = ? AND stone_name = ?')
        .get('user', stone).amount, 1);
      assert.equal(ctx.completeMegaChamber('user', key).error, 'not_ready');
      assert.equal(ctx.isChamberOpen(chamber, Date.parse(event.endsAt) - 1), true);
      assert.equal(ctx.isChamberOpen(chamber, Date.parse(event.endsAt)), false);
    }
    now = Date.parse(event.endsAt);
    ctx.creditChamberSacrifice('user', 381);
    assert.equal(db.prepare("SELECT sacrifices FROM mega_chambers WHERE chamber_key = 'latios'").get().sacrifices, 0);
  } finally {
    db.close();
  }
});

test('clearing either Mewtwo chamber consumes the shared Mewtwo sacrifice run', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE pokemon_forms (id INTEGER PRIMARY KEY, species_id INTEGER, is_default INTEGER, is_legendary INTEGER);
      INSERT INTO pokemon_forms VALUES (150, 150, 1, 1);
      CREATE TABLE mega_chambers (user_id TEXT, chamber_key TEXT, sacrifices INTEGER, clears INTEGER,
        PRIMARY KEY (user_id, chamber_key));
      INSERT INTO mega_chambers VALUES ('user', 'mewtwox', 5, 0), ('user', 'mewtwoy', 5, 0);
      CREATE TABLE mega_stones (user_id TEXT, stone_name TEXT, amount INTEGER,
        PRIMARY KEY (user_id, stone_name));
    `);
    const ctx = vm.createContext({
      db, assertUserId: () => {}, getPatreonPerks: () => null,
      awardCoinsWithBoost: (_id, amount) => ({ finalAmount: amount }), incrementUser: () => {},
    });
    vm.runInContext(`${extract(dbSource, 'const CHAMBER_CONFIG =', '\nfunction getUserChambers(')}
      this.chambers = CHAMBER_CONFIG;`, ctx);
    vm.runInContext(extract(dbSource, 'function getChamberRequirement(', '\nfunction megaEvolvePokemon('), ctx);

    const reward = ctx.completeMegaChamber('user', 'mewtwoy');
    assert.equal(reward.stone, 'Mewtwonite Y');
    assert.equal(reward.remainingSacrifices, 0);
    assert.deepEqual(db.prepare(`
      SELECT chamber_key, sacrifices, clears FROM mega_chambers ORDER BY chamber_key
    `).all(), [
      { chamber_key: 'mewtwox', sacrifices: 0, clears: 0 },
      { chamber_key: 'mewtwoy', sacrifices: 0, clears: 1 },
    ]);
    assert.equal(ctx.completeMegaChamber('user', 'mewtwox').error, 'not_ready');
  } finally {
    db.close();
  }
});

test('chamber battles accept their displayed numbers and full multiword names', async () => {
  const ctx = vm.createContext({
    command: 'mc', userId: 'user', PREFIX: '.',
    message: { reply: (content) => content },
    getUserChambers: () => Object.fromEntries(['latios', 'abomasnow', 'houndoom', 'charizardx']
      .map((key) => [key, { sacrifices: 10, clears: 0 }])),
    getChamberRequirement: () => 1,
    isChamberOpen: (chamber) => chamber.eventId === event.id,
    runMegaChamberGauntlet: (_message, _user, chamber) => chamber.key,
  });
  vm.runInContext(`${extract(dbSource, 'const CHAMBER_CONFIG =', '\n// Every Mega Stone')}
    this.CHAMBER_CONFIG = CHAMBER_CONFIG;`, ctx);
  const branch = extract(indexSource, "    if (command === 'mc' || command === 'megachamber') {",
    "\n    if (command === 'mega') {");
  vm.runInContext(`async function runChamber(args) { ${branch} }`, ctx);
  for (const [query, expected] of [
    ['9', 'latios'], ['10', 'abomasnow'], ['11', 'houndoom'], ['12', 'charizardx'],
    ['mega latios', 'latios'], ['Mega Charizard X', 'charizardx'],
    ['charizard x', 'charizardx'], ['charizardx', 'charizardx'], ['charizard', 'charizardx'],
  ]) {
    assert.equal(await ctx.runChamber(['battle', ...query.split(' ')]), expected);
  }
  assert.match(await ctx.runChamber(['battle', 'invalid']), /9\|10\|11\|12/);
});

test('requested chamber Pokémon emojis distinguish base, Mega, shiny and Gmax forms', () => {
  const ctx = vm.createContext({});
  vm.runInContext(extract(indexSource, 'const POKEMON_SPRITE_EMOJIS =', '\nfunction formatFactionFavorites('), ctx);
  const variants = [
    ['Mega Charizard X', false, '1573352645047885824'], ['Mega Charizard Y', false, '1573352647149228163'],
    ['Mega Charizard Y', true, '1573352649477193900'], ['Mega Charizard X', true, '1573352651763097740'],
    ['Charizard', true, '1573352654250184814'], ['Charmeleon', true, '1573352656779346010'],
    ['Charmander', true, '1573352658972966923'], ['Mega Houndoom', true, '1573352661816840333'],
    ['Houndoom', true, '1573352674177458216'], ['Houndour', true, '1573352676811477042'],
    ['Mega Houndoom', false, '1573352679285981274'], ['Houndoom', false, '1573352681542656061'],
    ['Houndour', false, '1573352683509653626'], ['Mega Abomasnow', true, '1573352685300613131'],
    ['Mega Abomasnow', false, '1573352687708405942'], ['Abomasnow', true, '1573352689738453122'],
    ['Abomasnow', false, '1573352692015697930'], ['Snover', true, '1573352694549315684'],
    ['Snover', false, '1573352698277924984'], ['Mega Latios', true, '1573352701239107654'],
    ['Mega Latios', false, '1573352703264956536'], ['Latios', true, '1573352705169035425'],
    ['Charmander', false, '1569731185532215349'], ['Latios', false, '1567608114994348102'],
    ['Charizard Gmax', true, '1573093969338835035'],
  ];
  for (const [name, isShiny, id] of variants) {
    assert.match(ctx.getPokemonSpriteEmoji({ name, isShiny }), new RegExp(`:${id}>$`), name);
    if (name.startsWith('Mega ')) {
      const suffix = name.slice(5);
      const [species, variant] = suffix.split(' ');
      const catalogName = `${species} Mega${variant ? ` ${variant}` : ''}`;
      assert.match(ctx.getPokemonSpriteEmoji({ name: catalogName, isShiny }), new RegExp(`:${id}>$`), catalogName);
    }
  }
});
