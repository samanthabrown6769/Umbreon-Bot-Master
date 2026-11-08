const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Database = require('better-sqlite3');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder } = require('discord.js');
const battle = require('../battle-effects');
const { pickWeighted } = require('../spawn-weights');

const indexSource = fs.readFileSync(require.resolve('../index.js'), 'utf8');
const dbSource = fs.readFileSync(require.resolve('../db.js'), 'utf8');

function extract(source, start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `Could not extract ${start}`);
  return source.slice(first, last);
}

function mon(name, types) {
  return { name, types, hp: 100, max_hp: 100, atk: 50, def: 50, spd: 50, level: 50 };
}

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
  const eventSource = extract(indexSource, 'function getEventSpawnChance(', '\nlet eventSpawnFormIds');
  let roll = 0;
  const math = Object.create(Math);
  math.random = () => roll;
  const ctx = vm.createContext({
    Math: math, EVENT_SPAWN_ODDS: 1500, LEGENDARY_BASE_CHANCE: 1 / 1000,
    LEGENDARY_GOLDEN_RAZZ_CHANCE: 1 / 760, HARD_RARITY_USER_IDS: new Set(),
    HARD_RARITY_RATE_MULTIPLIER: 1, ENCOUNTER_RARITY_WEIGHTS: { normal: { Common: 1 } },
  });
  vm.runInContext(`${legendarySource}\n${eventSource}`, ctx);
  roll = 0.000999;
  assert.equal(ctx.chooseEncounterRarity('normal', false, 0), 'Legendary');
  roll = 0.001;
  assert.equal(ctx.chooseEncounterRarity('normal', false, 0), 'Common');
  assert.equal(ctx.getEventSpawnChance(), 1 / 1500);
  assert.equal(ctx.getEventSpawnChance(50), 1.5 / 1500);
  assert.match(indexSource, /const BASE_SHINY_RATE = 1 \/ 2500;/);
});

test('spawn selection applies chamber weights within the eligible rarity pool', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE pokemon_forms (
      id INTEGER PRIMARY KEY, species_id INTEGER, evolution_chain_id INTEGER, is_default INTEGER,
      rarity TEXT, is_water INTEGER, name TEXT, species_name TEXT
    );
    INSERT INTO pokemon_forms VALUES (1,1,1,1,'Common',0,'Ordinary','Ordinary');
    INSERT INTO pokemon_forms VALUES (2,2,2,1,'Common',0,'Chamber','Chamber');
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
    getRaritySettings: () => [
      { name: 'Common', spawn_weight: 1, pokemon_count: 1 },
      { name: 'Legendary', spawn_weight: 1, pokemon_count: 1 },
    ],
    getRandomPokemon: (rarity) => ({ id: 1, speciesName: rarity, name: rarity, rarity, types: [] }),
    SPECIAL_SPAWN_RESERVED_SPECIES: [], EVENT_NON_FISH_SPECIES: [], EVENT_FISH_SPAWN_FORM_IDS: [],
    eventSpawnFormIds: [], EVENT_SPAWN_ODDS: 1500, getEventSpawnChance: () => 1 / 1500,
    LEGENDARY_BASE_CHANCE: 1 / 1000, LEGENDARY_GOLDEN_RAZZ_CHANCE: 1 / 760,
    EVENT_TICKET_SHINY_RATES: { standard: { event: 0, nonEvent: 0 }, patreon: { event: 0, nonEvent: 0 } },
    BASE_SHINY_RATE: 1 / 2500, PATREON_SHINY_RATE: 1 / 1250,
    CATCHBOT_SHINY_MULTIPLIER: 0.25, INCENSE_BOOST: 1.1,
    EGG_ONLY_SHINY_SPECIES_KEYS: new Set(), FISH_ONLY_SHINY_KEYS: new Set(),
    FISH_PATREON_ONLY_SHINY_KEYS: new Set(),
  });
  vm.runInContext(extract(indexSource, 'function rollSpawn(', '\nfunction isEventChecklistSpawn('), ctx);
  const rod = { enablesLegendary: true, enablesShiny: true, baseShinyRate: 1 / 2500 };
  rolls = [0.000999, 0.9];
  assert.equal(ctx.rollSpawn('water', 'user', rod).rarity, 'Legendary');
  rolls = [0.001, 0.9, 0.9];
  assert.equal(ctx.rollSpawn('water', 'user', rod).rarity, 'Common');
  rolls = [0.000099, 0.9];
  assert.equal(ctx.rollSpawn('water', 'user', rod, { catchbot: true }).rarity, 'Legendary');
  rolls = [0.0001, 0.9, 0.9];
  assert.equal(ctx.rollSpawn('water', 'user', rod, { catchbot: true }).rarity, 'Common');
  rolls = [0.5, 0.5, 0.000399];
  assert.equal(ctx.rollSpawn('water', 'user', rod).isShiny, true);
  rolls = [0.5, 0.5, 0.0004];
  assert.equal(ctx.rollSpawn('water', 'user', rod).isShiny, false);
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

test('resetting pre-evolution copies leaves their held items equipped', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE pokemon_forms (id INTEGER PRIMARY KEY, base_hp INTEGER, base_atk INTEGER, base_def INTEGER, base_spd INTEGER);
    CREATE TABLE user_pokemon_state_snapshots (user_id TEXT, pokemon_id INTEGER, is_shiny INTEGER, is_golden INTEGER);
    CREATE TABLE catches (
      id INTEGER PRIMARY KEY, user_id TEXT, pokemon_id INTEGER, name TEXT, is_shiny INTEGER, is_golden INTEGER,
      rarity TEXT, held_item TEXT, level INTEGER, experience INTEGER, hp_iv INTEGER, atk_iv INTEGER,
      def_iv INTEGER, spa_iv INTEGER, spdef_iv INTEGER, spd_iv INTEGER, ev_hp INTEGER, ev_atk INTEGER,
      ev_def INTEGER, ev_spa INTEGER, ev_spdef INTEGER, ev_spe INTEGER, hp INTEGER, max_hp INTEGER,
      atk INTEGER, def INTEGER, spd INTEGER
    );
    INSERT INTO pokemon_forms VALUES (16, 40, 45, 40, 56);
    INSERT INTO catches (id,user_id,pokemon_id,is_shiny,is_golden,rarity,held_item,level)
      VALUES (1,'user',16,0,0,'Common','Nugget',10), (2,'user',16,0,0,'Common','Nugget',10);
  `);
  const source = extract(dbSource, 'function resetPreEvolutionCopies(', '\nfunction applyPokemonEvolution(');
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
  assert.equal(db.prepare('SELECT held_item FROM catches WHERE id = 1').get().held_item, 'Nugget');
  db.close();
});

function autospawnContext() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE autospawn_channels (guild_id TEXT PRIMARY KEY, channel_id TEXT, enabled INTEGER, message_count INTEGER, message_target INTEGER);
    INSERT INTO autospawn_channels VALUES ('1560102297198006274','allowed-channel',1,12,500);
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

test('autospawn command requires a bot admin and the designated server', async () => {
  const source = extract(indexSource, "    if (command === 'autospawn') {", "\n    if (command === 'lottery'");
  const ctx = vm.createContext({
    AUTOSPAWN_GUILD_ID: '1560102297198006274',
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
  message.guildId = '1560102297198006274';
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

test('trade, gift and give reject ineligible accounts before initiating transfers', async () => {
  const reason = '❌ eligibility denied';
  const target = { id: 'target', bot: false };
  const message = {
    mentions: { users: { first: () => target } },
    reply: async (value) => value,
  };
  const ctx = vm.createContext({
    getTransferEligibilityError: () => reason,
    client: { users: { fetch: async () => target } },
    getGiftTarget: () => 'target', PREFIX: '.',
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
  assert.equal((await ctx.handleGive(message, 'sender', ['coins', '5'])).content, reason);
  assert.equal((await ctx.handleGive(message, 'sender', ['tokens', '5'])).content, reason);
  assert.equal((await ctx.handleGive(message, 'sender', ['Candy', '5'])).content, reason);
});

test('multi-trade rechecks eligibility before moving balances or Pokémon', () => {
  const db = new Database(':memory:');
  const ctx = vm.createContext({ db, getTransferEligibilityError: () => 'not eligible' });
  vm.runInContext(extract(indexSource, 'function executeMultiTrade(', '\nasync function handleMultiTrade('), ctx);
  assert.equal(ctx.executeMultiTrade({ sides: [{ user: { id: 'one' } }, { user: { id: 'two' } }] }), 'not eligible');
  db.close();
});
