const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const {
  getPokemonDexNumbers,
  getGoldenDexNumber,
  isGoldenFormSupported,
  isGoldenDexNumber,
} = require('./pokemon-dex-numbers');
const { EVOLUTION_ITEMS, findEvolutionItem } = require('./evolution-items');
const { BATTLE_HELD_ITEM_NAMES, POWER_ITEM_EVS, findBattleHeldItem } = require('./held-item-effects');
const { BOXES, VOTE_BOXES } = require('./boxes');
const { getPromoItemNames } = require('./promo');
const { setSpriteOverrides } = require('./pokemon-sprites');
const { loadPokemonDatabase, updatePokemonDatabaseOverride } = require('./pokemon-database');
const {
  RESEARCH_HELD_ITEMS,
  RESEARCH_ITEM_NAMES,
  RESEARCH_RELICS,
} = require('./research-data');

const db = new Database(path.join(__dirname, 'pokemon.sqlite'));
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS bot_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS user_encounter_counters (
    user_id TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('pokemon', 'fishing')),
    category TEXT NOT NULL CHECK (category IN ('legendary', 'shiny')),
    encounters_since INTEGER NOT NULL DEFAULT 0,
    last_caught_at INTEGER,
    last_pokemon TEXT,
    last_catcher_id TEXT,
    PRIMARY KEY (user_id, source, category)
  );
  CREATE TABLE IF NOT EXISTS daily_catch_counts (
    reset_day INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    catches INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (reset_day, user_id)
  );
`);
const initializeEncounterCounter = db.prepare(`
  INSERT OR IGNORE INTO user_encounter_counters (user_id, source, category)
  VALUES (?, ?, ?)
`);

// G-Max moves are exclusive to their matching Gigantamax forms (Bulbapedia: G-Max Move).
const GMAX_MOVES_BY_FORM = Object.freeze({
  'venusaur-gmax': 'g-max-vine-lash',
  'charizard-gmax': 'g-max-wildfire',
  'blastoise-gmax': 'g-max-cannonade',
  'butterfree-gmax': 'g-max-befuddle',
  'pikachu-gmax': 'g-max-volt-crash',
  'meowth-gmax': 'g-max-gold-rush',
  'machamp-gmax': 'g-max-chi-strike',
  'gengar-gmax': 'g-max-terror',
  'kingler-gmax': 'g-max-foam-burst',
  'lapras-gmax': 'g-max-resonance',
  'eevee-gmax': 'g-max-cuddle',
  'snorlax-gmax': 'g-max-replenish',
  'garbodor-gmax': 'g-max-malodor',
  'melmetal-gmax': 'g-max-meltdown',
  'rillaboom-gmax': 'g-max-drum-solo',
  'cinderace-gmax': 'g-max-fireball',
  'inteleon-gmax': 'g-max-hydrosnipe',
  'corviknight-gmax': 'g-max-wind-rage',
  'orbeetle-gmax': 'g-max-gravitas',
  'drednaw-gmax': 'g-max-stonesurge',
  'coalossal-gmax': 'g-max-volcalith',
  'flapple-gmax': 'g-max-tartness',
  'appletun-gmax': 'g-max-sweetness',
  'sandaconda-gmax': 'g-max-sandblast',
  'toxtricity-amped-gmax': 'g-max-stun-shock',
  'toxtricity-low-key-gmax': 'g-max-stun-shock',
  'centiskorch-gmax': 'g-max-centiferno',
  'hatterene-gmax': 'g-max-smite',
  'grimmsnarl-gmax': 'g-max-snooze',
  'alcremie-gmax': 'g-max-finale',
  'copperajah-gmax': 'g-max-steelsurge',
  'duraludon-gmax': 'g-max-depletion',
  'urshifu-single-strike-gmax': 'g-max-one-blow',
  'urshifu-rapid-strike-gmax': 'g-max-rapid-flow',
});
const MAX_MOVES_BY_TYPE = Object.freeze({
  normal: 'max-strike',
  fighting: 'max-knuckle',
  flying: 'max-airstream',
  poison: 'max-ooze',
  ground: 'max-quake',
  rock: 'max-rockfall',
  bug: 'max-flutterby',
  ghost: 'max-phantasm',
  steel: 'max-steelspike',
  fire: 'max-flare',
  water: 'max-geyser',
  grass: 'max-overgrowth',
  electric: 'max-lightning',
  psychic: 'max-mindstorm',
  ice: 'max-hailstorm',
  dragon: 'max-wyrmwind',
  dark: 'max-darkness',
  fairy: 'max-starfall',
});

// Urshifu's G-Max moves are style-exclusive: One Blow for Single Strike, Rapid Flow for Rapid Strike.
const STYLE_EXCLUSIVE_MOVES = { 'g-max-one-blow': 'single-strike', 'g-max-rapid-flow': 'rapid-strike' };

function restrictStyleExclusiveMoves(moves, formId) {
  if (!moves.some((move) => STYLE_EXCLUSIVE_MOVES[move])) return moves;
  const slug = Number.isSafeInteger(formId)
    ? db.prepare('SELECT slug FROM pokemon_forms WHERE id = ?').get(formId)?.slug || ''
    : '';
  return moves.filter((move) => !STYLE_EXCLUSIVE_MOVES[move] || slug.includes(STYLE_EXCLUSIVE_MOVES[move]));
}

function getGigantamaxMoves(speciesId, formId = null) {
  if (!Number.isSafeInteger(speciesId) || speciesId <= 0
      || !Number.isSafeInteger(formId) || formId <= 0) return [];
  const form = db.prepare(`
    SELECT slug, types FROM pokemon_forms
    WHERE id = ? AND species_id = ? AND rarity = 'Gmax'
  `).get(formId, speciesId);
  if (!form) return [];
  const types = JSON.parse(form.types);
  if (!Array.isArray(types) || types.some((type) => typeof type !== 'string')) {
    throw new Error(`Invalid type data for Gigantamax form "${form.slug}".`);
  }
  const gmaxMove = GMAX_MOVES_BY_FORM[form.slug.toLowerCase()];
  const maxMoves = types.map((type) => MAX_MOVES_BY_TYPE[type.toLowerCase()])
    .filter(Boolean)
    .flatMap((move) => [move, `${move}-special`]);
  return [...new Set([gmaxMove, ...maxMoves].filter(Boolean))];
}

function getGigantamaxMoveLearners(moveName) {
  if (typeof moveName !== 'string' || !moveName.trim()) return [];
  const moveSlug = moveName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    .replace(/-(physical|special)$/, (match) => (match === '-special' ? '-special' : ''));
  const baseSlug = moveSlug.replace(/-special$/, '');
  const maxType = Object.entries(MAX_MOVES_BY_TYPE)
    .find(([, move]) => move === baseSlug)?.[0];
  const gmaxForms = db.prepare(`
    SELECT name, slug, types FROM pokemon_forms
    WHERE rarity = 'Gmax'
    ORDER BY species_id, id
  `).all();
  return gmaxForms.filter((form) => {
    if (GMAX_MOVES_BY_FORM[form.slug.toLowerCase()] === moveSlug) return true;
    if (!maxType) return false;
    const types = JSON.parse(form.types);
    if (!Array.isArray(types) || types.some((type) => typeof type !== 'string')) {
      throw new Error(`Invalid type data for Gigantamax form "${form.slug}".`);
    }
    return types.some((type) => type.toLowerCase() === maxType);
  }).map((form) => form.name);
}

function getCooldownNotificationMode(userId) {
  assertUserId(userId);
  const mode = db.prepare(
    'SELECT value FROM bot_settings WHERE key = ?'
  ).get(`cooldown_notification_mode:${userId}`)?.value || 'ping';
  if (!['ping', 'username'].includes(mode)) {
    throw new Error(`Unknown cooldown notification mode "${mode}".`);
  }
  return mode;
}

function setCooldownNotificationMode(userId, mode) {
  assertUserId(userId);
  if (!['ping', 'username'].includes(mode)) {
    throw new TypeError('Cooldown notification mode must be "ping" or "username".');
  }
  db.prepare(`
    INSERT INTO bot_settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(`cooldown_notification_mode:${userId}`, mode);
  return mode;
}

function getRareSpawnNameHidden(userId) {
  assertUserId(userId);
  const value = db.prepare(
    'SELECT value FROM bot_settings WHERE key = ?'
  ).get(`hide_rare_spawn_name:${userId}`)?.value || 'false';
  if (!['true', 'false'].includes(value)) {
    throw new Error(`Invalid rare-spawn name setting "${value}" for user ${userId}.`);
  }
  return value === 'true';
}

function setRareSpawnNameHidden(userId, hidden) {
  assertUserId(userId);
  if (typeof hidden !== 'boolean') throw new TypeError('hidden must be a boolean.');
  db.prepare(`
    INSERT INTO bot_settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(`hide_rare_spawn_name:${userId}`, String(hidden));
  return hidden;
}

function getMarketCompletionNotificationsEnabled(userId) {
  assertUserId(userId);
  const value = db.prepare(
    'SELECT value FROM bot_settings WHERE key = ?'
  ).get(`market_completion_notifications:${userId}`)?.value || 'false';
  if (!['true', 'false'].includes(value)) {
    throw new Error(`Invalid market notification setting "${value}" for user ${userId}.`);
  }
  return value === 'true';
}

function setMarketCompletionNotificationsEnabled(userId, enabled) {
  assertUserId(userId);
  if (typeof enabled !== 'boolean') throw new TypeError('enabled must be a boolean.');
  db.prepare(`
    INSERT INTO bot_settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(`market_completion_notifications:${userId}`, String(enabled));
  return enabled;
}

function setBuddyNickname(userId, nickname) {
  assertUserId(userId);
  const buddyId = getUser(userId).buddy_catch_id;
  if (!buddyId) return { error: 'no_buddy' };
  if (nickname !== null
      && (typeof nickname !== 'string' || !nickname.trim() || nickname.trim().length > 32
        || /[@\r\n]/.test(nickname))) {
    throw new TypeError('Buddy nickname must be 1–32 characters and cannot contain @ or line breaks.');
  }
  const key = `buddy_nickname:${userId}:${buddyId}`;
  if (nickname === null) {
    db.prepare('DELETE FROM bot_settings WHERE key = ?').run(key);
    return null;
  }
  const value = nickname.trim();
  db.prepare(`
    INSERT INTO bot_settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
  return value;
}

function rerollBuddyIv(userId, stat, confirmMaxed = false, expectedBuddyId = null) {
  assertUserId(userId);
  if (typeof confirmMaxed !== 'boolean') {
    throw new TypeError('confirmMaxed must be a boolean.');
  }
  if (expectedBuddyId !== null
      && (!Number.isSafeInteger(expectedBuddyId) || expectedBuddyId <= 0)) {
    throw new TypeError('expectedBuddyId must be a positive safe integer or null.');
  }
  const ivFields = {
    atk: 'atk_iv',
    def: 'def_iv',
    hp: 'hp_iv',
    spa: 'spa_iv',
    spdef: 'spdef_iv',
    spd: 'spd_iv',
  };
  const ivField = ivFields[stat];
  if (!ivField) return { error: 'invalid_stat' };
  const sharedIvStats = {
    atk: ['atk', 'spa'],
    spa: ['atk', 'spa'],
    def: ['def', 'spdef'],
    spdef: ['def', 'spdef'],
  };
  const rerolledStats = sharedIvStats[stat] || [stat];
  const rerolledIvFields = rerolledStats.map((rerolledStat) => ivFields[rerolledStat]);
  return db.transaction(() => {
    const user = getUser(userId);
    const buddyId = user.buddy_catch_id;
    if (!buddyId) return { error: 'no_buddy' };
    if (expectedBuddyId !== null && buddyId !== expectedBuddyId) {
      return { error: 'buddy_changed' };
    }
    const buddy = db.prepare(`
      SELECT catches.*, pokemon_forms.base_hp, pokemon_forms.base_atk,
        pokemon_forms.base_def, pokemon_forms.base_spa, pokemon_forms.base_spdef,
        pokemon_forms.base_spd
      FROM catches
      LEFT JOIN pokemon_forms ON pokemon_forms.id = catches.pokemon_id
      WHERE catches.id = ? AND catches.user_id = ?
    `).get(buddyId, userId);
    if (!buddy) return { error: 'no_buddy' };
    const ivIsMaxed = rerolledIvFields.some((field) => buddy[field] === 31);
    if (ivIsMaxed && !confirmMaxed) {
      return {
        error: 'max_iv_confirmation_required',
        pokemon: buddy.name,
        stat,
        rerolledStats,
        buddyId,
      };
    }
    if (confirmMaxed && !ivIsMaxed) {
      return { error: 'iv_changed' };
    }
    if (user.vote_coins < 1) return { error: 'not_enough_vote_coins' };

    const newIv = Math.floor(Math.random() * 32);
    const nextValues = {
      hp: buddy.hp,
      max_hp: buddy.max_hp,
      atk: buddy.atk,
      def: buddy.def,
      spd: buddy.spd,
    };
    for (const field of rerolledIvFields) nextValues[field] = newIv;
    if (stat === 'hp') {
      nextValues.max_hp = calculateStat(buddy.base_hp ?? 50, newIv, buddy.level, true, buddy.is_shiny, buddy.ev_hp);
      nextValues.hp = Math.min(
        nextValues.max_hp,
        buddy.hp + (nextValues.max_hp - buddy.max_hp)
      );
    } else if (rerolledStats.includes('atk')) {
      nextValues.atk = calculateStat(
        buddy.base_atk ?? 50, newIv, buddy.level, false, buddy.is_shiny, buddy.ev_atk
      );
    } else if (rerolledStats.includes('def')) {
      nextValues.def = calculateStat(
        buddy.base_def ?? 50, newIv, buddy.level, false, buddy.is_shiny, buddy.ev_def
      );
    } else if (stat === 'spd') {
      nextValues.spd = calculateStat(
        buddy.base_spd ?? 50, newIv, buddy.level, false, buddy.is_shiny, buddy.ev_spe
      );
    }
    const assignments = Object.keys(nextValues).map((field) => `${field} = ?`).join(', ');
    db.prepare(`UPDATE catches SET ${assignments} WHERE id = ? AND user_id = ?`)
      .run(...Object.values(nextValues), buddyId, userId);
    incrementUser(userId, { vote_coins: -1 });
    syncDuplicateCatchState(userId, buddyId);
    return {
      pokemon: buddy.name,
      stat,
      rerolledStats,
      oldIv: buddy[ivField],
      newIv,
      voteCoins: getUser(userId).vote_coins,
    };
  }).immediate();
}

function renamePokemonForm(formId, name) {
  if (!Number.isSafeInteger(formId) || formId <= 0) throw new TypeError('Invalid Pokémon form ID.');
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) {
    throw new TypeError('Pokémon name must be 1–80 characters.');
  }
  const form = db.prepare('SELECT id, slug, name FROM pokemon_forms WHERE id = ?').get(formId);
  if (!form) return null;
  const nextName = name.trim();
  updatePokemonDatabaseOverride(form.slug, { name: nextName });
  db.transaction(() => {
    db.prepare('UPDATE pokemon_forms SET name = ? WHERE id = ?').run(nextName, formId);
    db.prepare('UPDATE catches SET name = ? WHERE pokemon_id = ?').run(nextName, formId);
    db.prepare('UPDATE market SET name = ? WHERE pokemon_id = ?').run(nextName, formId);
  }).immediate();
  return { ...form, name: nextName };
}

function updatePokemonSpriteLinks(formId, normalUrl, shinyUrl = null) {
  if (!Number.isSafeInteger(formId) || formId <= 0) throw new TypeError('Invalid Pokémon form ID.');
  const validateUrl = (value) => {
    if (typeof value !== 'string') return false;
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  };
  if (!validateUrl(normalUrl) || (shinyUrl !== null && !validateUrl(shinyUrl))) {
    throw new TypeError('Pokémon sprite URLs must use HTTPS.');
  }
  const form = db.prepare(
    'SELECT id, slug, name, shiny_sprite FROM pokemon_forms WHERE id = ?'
  ).get(formId);
  if (!form) return null;
  const updates = {
    sprite: normalUrl,
    animated_sprite: normalUrl,
  };
  if (shinyUrl) {
    updates.shiny_sprite = shinyUrl;
    updates.shiny_animated_sprite = shinyUrl;
  }
  updatePokemonDatabaseOverride(form.slug, updates);
  db.prepare(`
    UPDATE pokemon_forms
    SET sprite = ?, shiny_sprite = ?
    WHERE id = ?
  `).run(normalUrl, shinyUrl || form.shiny_sprite || normalUrl, formId);
  const animatedSprites = new Map();
  for (const record of loadPokemonDatabase().values()) {
    if (record.animated || record.shinyAnimated) {
      animatedSprites.set(record.slug, { normal: record.animated, shiny: record.shinyAnimated });
    }
  }
  setSpriteOverrides(animatedSprites);
  return { ...form, sprite: normalUrl, shiny_sprite: shinyUrl || form.shiny_sprite || normalUrl };
}

const pokemonMovesPath = path.join(__dirname, 'data', 'pokemon-moves.json');
const pokemonMovesData = JSON.parse(fs.readFileSync(pokemonMovesPath, 'utf8'));
if (!pokemonMovesData.moves || !pokemonMovesData.learnsets) {
  throw new Error(`Move database at ${pokemonMovesPath} must include moves and learnsets.`);
}
const pokemonEvolutionRulesPath = path.join(__dirname, 'data', 'pokemon-evolution-rules.json');
const pokemonEvolutionRules = JSON.parse(fs.readFileSync(pokemonEvolutionRulesPath, 'utf8'));
if (!Array.isArray(pokemonEvolutionRules)
    || pokemonEvolutionRules.some((rule) =>
      !Number.isSafeInteger(rule.fromSpeciesId)
      || !Number.isSafeInteger(rule.toSpeciesId)
      || !Number.isSafeInteger(rule.minLevel)
      || rule.minLevel < 1
      || rule.minLevel > 100
    )) {
  throw new Error(`Pokémon evolution rules at ${pokemonEvolutionRulesPath} are invalid.`);
}
const levelEvolutionRules = new Map();
for (const rule of pokemonEvolutionRules) {
  const rules = levelEvolutionRules.get(rule.fromSpeciesId) || [];
  rules.push(rule);
  levelEvolutionRules.set(rule.fromSpeciesId, rules);
}

const MAX_FRIENDSHIP = 255;
const FRIENDSHIP_EVOLUTION_THRESHOLD = 160;
const pokemonFriendshipEvolutions = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'data', 'pokemon-friendship-evolutions.json'),
  'utf8'
));
const friendshipEvolutionRules = new Map();
for (const rule of pokemonFriendshipEvolutions) {
  const rules = friendshipEvolutionRules.get(rule.fromSpeciesId) || [];
  rules.push(rule);
  friendshipEvolutionRules.set(rule.fromSpeciesId, rules);
}

function isDaytime(date = new Date()) {
  const hour = date.getHours();
  return hour >= 6 && hour < 18;
}

// Rockruff evolves at level 25 into a different Lycanroc depending on the time of day.
const TIME_LEVEL_EVOLUTIONS = {
  744: { minLevel: 25, forms: { day: 'lycanroc-midday', dusk: 'lycanroc-dusk', night: 'lycanroc-midnight' } },
};

function getTimeOfDayPhase(date = new Date()) {
  const hour = date.getHours();
  if (hour === 17) return 'dusk';
  return hour >= 6 && hour < 17 ? 'day' : 'night';
}

const catchbotUpgradeCost = (baseCost, level) => {
  let cost = baseCost;
  for (let currentLevel = 0; currentLevel < level; currentLevel += 1) {
    cost = Math.ceil(cost * 1.25);
  }
  return cost;
};
const CB_CONFIG = Object.freeze({
  pokemon: Object.freeze({
    maxLvl: 10,
    costForLvl: (level) => catchbotUpgradeCost(5000, level),
    getStat: (level) => 1 + level * 3,
  }),
  cost: Object.freeze({
    maxLvl: 10,
    costForLvl: (level) => catchbotUpgradeCost(1000, level),
    getStat: (level) => Math.max(100, 500 - level * 40),
  }),
  duration: Object.freeze({
    maxLvl: 11,
    costForLvl: (level) => catchbotUpgradeCost(1500, level),
    getStat: (level) => 1 + level,
  }),
  luck: Object.freeze({
    maxLvl: 10,
    costForLvl: () => 2500000,
    getStat: (level) => level,
  }),
});

const userDefinitions = {
  coins: 'INTEGER NOT NULL DEFAULT 1000',
  research_points: 'INTEGER NOT NULL DEFAULT 0',
  research_relic_unlock_until: 'INTEGER NOT NULL DEFAULT 0',
  pc_locked: 'INTEGER NOT NULL DEFAULT 0',
  pokeballs: 'INTEGER NOT NULL DEFAULT 25',
  greatballs: 'INTEGER NOT NULL DEFAULT 10',
  ultraballs: 'INTEGER NOT NULL DEFAULT 5',
  masterballs: 'INTEGER NOT NULL DEFAULT 1',
  diveballs: 'INTEGER NOT NULL DEFAULT 0',
  fish_rods: "TEXT NOT NULL DEFAULT 'Old Rod'",
  last_daily: 'INTEGER NOT NULL DEFAULT 0',
  last_monthly: 'INTEGER NOT NULL DEFAULT 0',
  pokeradar_charges: 'INTEGER NOT NULL DEFAULT 0',
  double_xp_charges: 'INTEGER NOT NULL DEFAULT 0',
  daily_streak: 'INTEGER NOT NULL DEFAULT 0',
  highest_daily_streak: 'INTEGER NOT NULL DEFAULT 0',
  quest_type: "TEXT NOT NULL DEFAULT 'catch'",
  quest_progress: 'INTEGER NOT NULL DEFAULT 0',
  quest_target: 'INTEGER NOT NULL DEFAULT 3',
  quest_reward: 'INTEGER NOT NULL DEFAULT 500',
  catchbot_end: 'INTEGER NOT NULL DEFAULT 0',
  lootboxes: 'INTEGER NOT NULL DEFAULT 1',
  cooldown_machine_catch_charges: 'INTEGER NOT NULL DEFAULT 0',
  cooldown_machine_fish_charges: 'INTEGER NOT NULL DEFAULT 0',
  total_catches: 'INTEGER NOT NULL DEFAULT 0',
  shiny_catches: 'INTEGER NOT NULL DEFAULT 0',
  common_streak: 'INTEGER NOT NULL DEFAULT 0',
  premierballs: 'INTEGER NOT NULL DEFAULT 0',
  buddy_exp: 'INTEGER NOT NULL DEFAULT 0',
  buddy_catch_id: 'INTEGER',
  explore_steps_today: 'INTEGER NOT NULL DEFAULT 0',
  last_explore_reset: 'INTEGER NOT NULL DEFAULT 0',
  team_exp_share: 'INTEGER NOT NULL DEFAULT 0',
  exp_share_owned: 'INTEGER NOT NULL DEFAULT 0',
  rare_candies: 'INTEGER NOT NULL DEFAULT 0',
  active_poke_lures: 'INTEGER NOT NULL DEFAULT 0',
  active_mistys_lures: 'INTEGER NOT NULL DEFAULT 0',
  repels: 'INTEGER NOT NULL DEFAULT 0',
  world_bosses_fought: 'INTEGER NOT NULL DEFAULT 0',
  repel_encounters: 'INTEGER NOT NULL DEFAULT 0',
  super_repel_encounters: 'INTEGER NOT NULL DEFAULT 0',
  max_repel_encounters: 'INTEGER NOT NULL DEFAULT 0',
  honey_encounters: 'INTEGER NOT NULL DEFAULT 0',
  quest_reset_scrolls: 'INTEGER NOT NULL DEFAULT 0',
  hunt_target_id: 'INTEGER NOT NULL DEFAULT 245',
  hunt_target_name: "TEXT NOT NULL DEFAULT 'Suicune'",
  hunt_target_rarity: "TEXT NOT NULL DEFAULT 'Legendary'",
  hunt_progress: 'INTEGER NOT NULL DEFAULT 0',
  hunt_required: 'INTEGER NOT NULL DEFAULT 1',
  hunt_completed: 'INTEGER NOT NULL DEFAULT 0',
  hunt_rerolls_left: 'INTEGER NOT NULL DEFAULT 1',
  hunt_expires_at: 'INTEGER NOT NULL DEFAULT 0',
  swap_tokens: 'INTEGER NOT NULL DEFAULT 6',
  swaps_today: 'INTEGER NOT NULL DEFAULT 0',
  last_swap_reset: 'INTEGER NOT NULL DEFAULT 0',
  grazz_berries: 'INTEGER NOT NULL DEFAULT 0',
  grazz_buff_encounters: 'INTEGER NOT NULL DEFAULT 0',
  fishing_tokens: 'INTEGER NOT NULL DEFAULT 0',
  has_good_rod: 'INTEGER NOT NULL DEFAULT 0',
  has_super_rod: 'INTEGER NOT NULL DEFAULT 0',
  has_golden_rod: 'INTEGER NOT NULL DEFAULT 0',
  black_market_charm: 'INTEGER NOT NULL DEFAULT 0',
  has_patreon: 'INTEGER NOT NULL DEFAULT 0',
  patreon_tokens: 'INTEGER NOT NULL DEFAULT 0',
  patreon_tier: 'TEXT',
  cl_catches: 'INTEGER NOT NULL DEFAULT 0',
  cl_fishes: 'INTEGER NOT NULL DEFAULT 0',
  cl_battles: 'INTEGER NOT NULL DEFAULT 0',
  cl_event_catches: 'INTEGER NOT NULL DEFAULT 0',
  cl_daily_claimed: 'INTEGER NOT NULL DEFAULT 0',
  cl_claimed: 'INTEGER NOT NULL DEFAULT 0',
  event_ticket: 'INTEGER NOT NULL DEFAULT 0',
  event_reg_claimed: 'INTEGER NOT NULL DEFAULT 0',
  event_gold_claimed: 'INTEGER NOT NULL DEFAULT 0',
  trainer_icon: "TEXT NOT NULL DEFAULT 'Trainer May'",
  faction: "TEXT NOT NULL DEFAULT 'Recruit'",
  clan: "TEXT NOT NULL DEFAULT 'None'",
  wild_encounters: 'INTEGER NOT NULL DEFAULT 0',
  pkc_earned: 'INTEGER NOT NULL DEFAULT 0',
  used_pokeballs: 'INTEGER NOT NULL DEFAULT 0',
  used_greatballs: 'INTEGER NOT NULL DEFAULT 0',
  used_ultraballs: 'INTEGER NOT NULL DEFAULT 0',
  used_premierballs: 'INTEGER NOT NULL DEFAULT 0',
  used_masterballs: 'INTEGER NOT NULL DEFAULT 0',
  legendaries_caught: 'INTEGER NOT NULL DEFAULT 0',
  promos_claimed: 'INTEGER NOT NULL DEFAULT 0',
  promo_tokens: 'INTEGER NOT NULL DEFAULT 0',
  icons_unlocked: 'INTEGER NOT NULL DEFAULT 0',
  battles_won: 'INTEGER NOT NULL DEFAULT 0',
  battles_lost: 'INTEGER NOT NULL DEFAULT 0',
  max_qb_streak: 'INTEGER NOT NULL DEFAULT 0',
  live_wins: 'INTEGER NOT NULL DEFAULT 0',
  live_losses: 'INTEGER NOT NULL DEFAULT 0',
  mega_chambers_won: 'INTEGER NOT NULL DEFAULT 0',
  world_boss_mvps: 'INTEGER NOT NULL DEFAULT 0',
  battle_tower_wins: 'INTEGER NOT NULL DEFAULT 0',
  amulet_coins: 'INTEGER NOT NULL DEFAULT 0',
  shiny_charms: 'INTEGER NOT NULL DEFAULT 0',
  lootboxes_opened: 'INTEGER NOT NULL DEFAULT 0',
  golden_razz_used: 'INTEGER NOT NULL DEFAULT 0',
  repels_used: 'INTEGER NOT NULL DEFAULT 0',
  rare_candies_used: 'INTEGER NOT NULL DEFAULT 0',
  eggs_hatched: 'INTEGER NOT NULL DEFAULT 0',
  incubators_used: 'INTEGER NOT NULL DEFAULT 0',
  super_incubators_used: 'INTEGER NOT NULL DEFAULT 0',
  honey_used: 'INTEGER NOT NULL DEFAULT 0',
  pokeradars_used: 'INTEGER NOT NULL DEFAULT 0',
  vouchers_used: 'INTEGER NOT NULL DEFAULT 0',
  catchbot_runs: 'INTEGER NOT NULL DEFAULT 0',
  dailies_claimed: 'INTEGER NOT NULL DEFAULT 0',
  votes_claimed: 'INTEGER NOT NULL DEFAULT 0',
  vote_coins: 'INTEGER NOT NULL DEFAULT 0',
  vote_streak: 'INTEGER NOT NULL DEFAULT 0',
  highest_vote_streak: 'INTEGER NOT NULL DEFAULT 0',
  last_vote_at: 'INTEGER NOT NULL DEFAULT 0',
  last_vote_day: "TEXT NOT NULL DEFAULT ''",
  vote_eggs: 'INTEGER NOT NULL DEFAULT 0',
  held_egg_progress: 'INTEGER NOT NULL DEFAULT 0',
  held_egg_target: 'INTEGER NOT NULL DEFAULT 0',
  swaps_done: 'INTEGER NOT NULL DEFAULT 0',
  fishes_caught: 'INTEGER NOT NULL DEFAULT 0',
  quests_completed: 'INTEGER NOT NULL DEFAULT 0',
  hunts_completed: 'INTEGER NOT NULL DEFAULT 0',
  lotteries_won: 'INTEGER NOT NULL DEFAULT 0',
  events_joined: 'INTEGER NOT NULL DEFAULT 0',
  codes_earned: 'INTEGER NOT NULL DEFAULT 0',
  auctions_won: 'INTEGER NOT NULL DEFAULT 0',
  joined_at: 'INTEGER NOT NULL DEFAULT 0',
};

const catchDefinitions = {
  pokemon_id: 'INTEGER',
  name: 'TEXT',
  rarity: "TEXT NOT NULL DEFAULT 'Common'",
  is_shiny: 'INTEGER NOT NULL DEFAULT 0',
  is_golden: 'INTEGER NOT NULL DEFAULT 0',
  level: 'INTEGER NOT NULL DEFAULT 5',
  hp_iv: 'INTEGER NOT NULL DEFAULT 0',
  atk_iv: 'INTEGER NOT NULL DEFAULT 0',
  def_iv: 'INTEGER NOT NULL DEFAULT 0',
  spa_iv: 'INTEGER NOT NULL DEFAULT 0',
  spdef_iv: 'INTEGER NOT NULL DEFAULT 0',
  spd_iv: 'INTEGER NOT NULL DEFAULT 0',
  ev_hp: 'INTEGER NOT NULL DEFAULT 0',
  ev_atk: 'INTEGER NOT NULL DEFAULT 0',
  ev_def: 'INTEGER NOT NULL DEFAULT 0',
  ev_spa: 'INTEGER NOT NULL DEFAULT 0',
  ev_spdef: 'INTEGER NOT NULL DEFAULT 0',
  ev_spe: 'INTEGER NOT NULL DEFAULT 0',
  hp: 'INTEGER NOT NULL DEFAULT 10',
  max_hp: 'INTEGER NOT NULL DEFAULT 10',
  atk: 'INTEGER NOT NULL DEFAULT 5',
  def: 'INTEGER NOT NULL DEFAULT 5',
  spd: 'INTEGER NOT NULL DEFAULT 5',
  in_team: 'INTEGER NOT NULL DEFAULT 0',
  team_slot: 'INTEGER',
  is_locked: 'INTEGER NOT NULL DEFAULT 0',
  ever_buddy: 'INTEGER NOT NULL DEFAULT 0',
  friendship: 'INTEGER NOT NULL DEFAULT 0',
  is_fav: 'INTEGER NOT NULL DEFAULT 0',
  experience: 'INTEGER NOT NULL DEFAULT 0',
  ability: 'TEXT',
  held_item: 'TEXT',
  moves: "TEXT NOT NULL DEFAULT '[]'",
  sketched_moves: "TEXT NOT NULL DEFAULT '[]'",
  caught_at: 'DATETIME DEFAULT CURRENT_TIMESTAMP',
  caught_ball: 'TEXT',
};

function ensureColumns(table, definitions) {
  const columns = new Set(
    db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name)
  );

  for (const [column, definition] of Object.entries(definitions)) {
    if (!columns.has(column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    coins INTEGER NOT NULL DEFAULT 1000,
    pokeballs INTEGER NOT NULL DEFAULT 25,
    greatballs INTEGER NOT NULL DEFAULT 10,
    ultraballs INTEGER NOT NULL DEFAULT 5,
    masterballs INTEGER NOT NULL DEFAULT 1,
    premierballs INTEGER NOT NULL DEFAULT 0,
    diveballs INTEGER NOT NULL DEFAULT 0,
    fish_rods TEXT NOT NULL DEFAULT 'Old Rod',
    last_daily INTEGER NOT NULL DEFAULT 0,
    daily_streak INTEGER NOT NULL DEFAULT 0,
    quest_type TEXT NOT NULL DEFAULT 'catch',
    quest_progress INTEGER NOT NULL DEFAULT 0,
    quest_target INTEGER NOT NULL DEFAULT 3,
    quest_reward INTEGER NOT NULL DEFAULT 500,
    catchbot_end INTEGER NOT NULL DEFAULT 0,
    lootboxes INTEGER NOT NULL DEFAULT 1,
    total_catches INTEGER NOT NULL DEFAULT 0,
    shiny_catches INTEGER NOT NULL DEFAULT 0,
    common_streak INTEGER NOT NULL DEFAULT 0,
    buddy_exp INTEGER NOT NULL DEFAULT 0,
    cl_catches INTEGER NOT NULL DEFAULT 0,
    cl_fishes INTEGER NOT NULL DEFAULT 0,
    cl_battles INTEGER NOT NULL DEFAULT 0,
    cl_event_catches INTEGER NOT NULL DEFAULT 0,
    cl_daily_claimed INTEGER NOT NULL DEFAULT 0,
    cl_claimed INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS catches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    pokemon_id INTEGER,
    name TEXT,
    rarity TEXT NOT NULL DEFAULT 'Common',
    is_shiny INTEGER NOT NULL DEFAULT 0,
    level INTEGER NOT NULL DEFAULT 5,
    hp_iv INTEGER NOT NULL DEFAULT 0,
    atk_iv INTEGER NOT NULL DEFAULT 0,
    def_iv INTEGER NOT NULL DEFAULT 0,
    spa_iv INTEGER NOT NULL DEFAULT 0,
    spdef_iv INTEGER NOT NULL DEFAULT 0,
    spd_iv INTEGER NOT NULL DEFAULT 0,
    hp INTEGER NOT NULL DEFAULT 10,
    max_hp INTEGER NOT NULL DEFAULT 10,
    atk INTEGER NOT NULL DEFAULT 5,
    def INTEGER NOT NULL DEFAULT 5,
    spd INTEGER NOT NULL DEFAULT 5,
    in_team INTEGER NOT NULL DEFAULT 0,
    caught_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS catches_user_id_idx ON catches(user_id);

  CREATE TABLE IF NOT EXISTS pokemon_user_seen_counts (
    user_id TEXT NOT NULL,
    pokemon_id INTEGER NOT NULL,
    is_shiny INTEGER NOT NULL DEFAULT 0,
    is_golden INTEGER NOT NULL DEFAULT 0,
    seen_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, pokemon_id, is_shiny, is_golden)
  );

  CREATE TABLE IF NOT EXISTS market (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id TEXT,
    pokemon_id INTEGER,
    name TEXT,
    rarity TEXT,
    is_shiny INTEGER,
    is_golden INTEGER NOT NULL DEFAULT 0,
    level INTEGER,
    price INTEGER,
    amount INTEGER NOT NULL DEFAULT 1,
    hp_iv INTEGER NOT NULL DEFAULT 0,
    atk_iv INTEGER NOT NULL DEFAULT 0,
    def_iv INTEGER NOT NULL DEFAULT 0,
    spa_iv INTEGER NOT NULL DEFAULT 0,
    spdef_iv INTEGER NOT NULL DEFAULT 0,
    spd_iv INTEGER NOT NULL DEFAULT 0,
    hp INTEGER NOT NULL DEFAULT 10,
    max_hp INTEGER NOT NULL DEFAULT 10,
    atk INTEGER NOT NULL DEFAULT 5,
    def INTEGER NOT NULL DEFAULT 5,
    spd INTEGER NOT NULL DEFAULT 5,
    listed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS market_sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id INTEGER NOT NULL,
    seller_id TEXT NOT NULL,
    buyer_id TEXT NOT NULL,
    pokemon_id INTEGER,
    name TEXT NOT NULL,
    rarity TEXT,
    is_shiny INTEGER NOT NULL DEFAULT 0,
    is_golden INTEGER NOT NULL DEFAULT 0,
    sale_price INTEGER NOT NULL,
    tax_amount INTEGER NOT NULL,
    tax_rate INTEGER NOT NULL DEFAULT 15,
    payout_amount INTEGER NOT NULL,
    sold_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS market_sales_seller_id_idx ON market_sales(seller_id, id DESC);

  CREATE TABLE IF NOT EXISTS patreon_token_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
    amount INTEGER NOT NULL,
    remaining_amount INTEGER NOT NULL,
    unit_price INTEGER NOT NULL,
    fee_rate REAL NOT NULL DEFAULT 0,
    fee_amount INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'filled', 'cancelled', 'expired')),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS patreon_token_orders_book_idx
    ON patreon_token_orders(side, status, unit_price, id);
  CREATE INDEX IF NOT EXISTS patreon_token_orders_user_idx
    ON patreon_token_orders(user_id, status, id DESC);

  CREATE TABLE IF NOT EXISTS patreon_token_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    buy_order_id INTEGER,
    sell_order_id INTEGER,
    buyer_id TEXT NOT NULL,
    seller_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    unit_price INTEGER NOT NULL,
    total_coins INTEGER NOT NULL,
    traded_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS patreon_token_trades_time_idx
    ON patreon_token_trades(traded_at);

  CREATE TABLE IF NOT EXISTS pokemon_forms (
    id INTEGER PRIMARY KEY,
    species_id INTEGER NOT NULL,
    species_name TEXT NOT NULL,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    is_default INTEGER NOT NULL,
    is_legendary INTEGER NOT NULL,
    is_mythical INTEGER NOT NULL,
    evolution_chain_id INTEGER,
    evolution_stage INTEGER NOT NULL,
    rarity TEXT NOT NULL,
    base_hp INTEGER NOT NULL,
    base_atk INTEGER NOT NULL,
    base_def INTEGER NOT NULL,
    base_spa INTEGER NOT NULL DEFAULT 50,
    base_spdef INTEGER NOT NULL DEFAULT 50,
    base_spd INTEGER NOT NULL,
    base_stat_total INTEGER NOT NULL,
    types TEXT NOT NULL,
    is_water INTEGER NOT NULL,
    sprite TEXT,
    shiny_sprite TEXT,
    generation TEXT,
    is_custom INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS event_catches (
    event_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    pokemon_key TEXT NOT NULL,
    caught_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (event_id, user_id, pokemon_key)
  );

  CREATE TABLE IF NOT EXISTS event_pokemon (
    event_id TEXT NOT NULL,
    pokemon_key TEXT NOT NULL,
    name TEXT NOT NULL,
    match_names TEXT NOT NULL,
    shiny INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (event_id, pokemon_key)
  );

  CREATE TABLE IF NOT EXISTS event_announcement_channels (
    event_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    PRIMARY KEY (event_id, guild_id)
  );

  CREATE TABLE IF NOT EXISTS rare_spawn_announcement_channels (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rare_spawn_announcements (
    event_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    pokemon_key TEXT NOT NULL,
    PRIMARY KEY (event_id, user_id, pokemon_key)
  );

  CREATE TABLE IF NOT EXISTS world_boss_announcement_channels (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS market_announcement_channels (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS global_collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    pokemon_id INTEGER NOT NULL,
    is_shiny INTEGER NOT NULL DEFAULT 0,
    pokemon_name TEXT NOT NULL,
    buy_price INTEGER,
    is_private INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, pokemon_id, is_shiny)
  );

  CREATE TABLE IF NOT EXISTS autospawn_channels (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    last_hourly_tier INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    message_count INTEGER NOT NULL DEFAULT 0,
    message_target INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS giveaway_channels (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS active_giveaways (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT UNIQUE,
    channel_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    prize_title TEXT NOT NULL,
    prize_data TEXT NOT NULL,
    winner_count INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    ended INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS giveaway_entries (
    giveaway_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    username TEXT,
    PRIMARY KEY (giveaway_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS world_boss_announcement_posts (
    boss_id INTEGER NOT NULL,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    PRIMARY KEY (boss_id, guild_id)
  );

  CREATE TABLE IF NOT EXISTS active_quests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 5),
    quest_type TEXT NOT NULL,
    target_type TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    target INTEGER NOT NULL,
    reward_coins INTEGER NOT NULL,
    reward_candies INTEGER NOT NULL DEFAULT 0,
    reward_lootboxes INTEGER NOT NULL DEFAULT 0,
    reward_masterballs INTEGER NOT NULL DEFAULT 0,
    reward_ultraballs INTEGER NOT NULL DEFAULT 0,
    reward_grazz INTEGER NOT NULL DEFAULT 0,
    reward_items TEXT NOT NULL DEFAULT '{}',
    refresh_at INTEGER NOT NULL DEFAULT 0,
    UNIQUE (user_id, slot)
  );

  CREATE TABLE IF NOT EXISTS league_progress (
    user_id TEXT PRIMARY KEY,
    cleared_challenges INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS catchbot_data (
    user_id TEXT PRIMARY KEY,
    spent_upgrades INTEGER NOT NULL DEFAULT 0,
    pokemon_lvl INTEGER NOT NULL DEFAULT 0 CHECK (pokemon_lvl BETWEEN 0 AND 10),
    cost_lvl INTEGER NOT NULL DEFAULT 0 CHECK (cost_lvl BETWEEN 0 AND 10),
    duration_lvl INTEGER NOT NULL DEFAULT 0 CHECK (duration_lvl BETWEEN 0 AND 11),
    luck_lvl INTEGER NOT NULL DEFAULT 0 CHECK (luck_lvl BETWEEN 0 AND 10),
    c_caught INTEGER NOT NULL DEFAULT 0,
    u_caught INTEGER NOT NULL DEFAULT 0,
    r_caught INTEGER NOT NULL DEFAULT 0,
    sr_caught INTEGER NOT NULL DEFAULT 0,
    l_caught INTEGER NOT NULL DEFAULT 0,
    s_caught INTEGER NOT NULL DEFAULT 0,
    g_caught INTEGER NOT NULL DEFAULT 0,
    running_until INTEGER NOT NULL DEFAULT 0,
    hours_running INTEGER NOT NULL DEFAULT 0,
    completion_notified_until INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS mega_chambers (
    user_id TEXT NOT NULL,
    chamber_key TEXT NOT NULL,
    sacrifices INTEGER NOT NULL DEFAULT 0,
    clears INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, chamber_key)
  );

  CREATE TABLE IF NOT EXISTS mega_stones (
    user_id TEXT NOT NULL,
    stone_name TEXT NOT NULL,
    amount INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, stone_name)
  );

  CREATE TABLE IF NOT EXISTS user_items (
    user_id TEXT NOT NULL,
    item_name TEXT NOT NULL,
    amount INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
    PRIMARY KEY (user_id, item_name)
  );

  CREATE TABLE IF NOT EXISTS egg_incubators (
    user_id TEXT NOT NULL,
    incubator_type TEXT NOT NULL CHECK (incubator_type IN ('incubator', 'super_incubator')),
    slot INTEGER NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    target INTEGER NOT NULL,
    PRIMARY KEY (user_id, incubator_type, slot)
  );

  CREATE TABLE IF NOT EXISTS channel_catch_rate_boosts (
    user_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    PRIMARY KEY (user_id, guild_id, channel_id)
  );

  CREATE TABLE IF NOT EXISTS clans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    leader_id TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS clan_members (
    user_id TEXT PRIMARY KEY,
    clan_id INTEGER NOT NULL,
    catches INTEGER NOT NULL DEFAULT 0,
    fishes INTEGER NOT NULL DEFAULT 0,
    perk_rank INTEGER NOT NULL DEFAULT 0,
    donated_coins INTEGER NOT NULL DEFAULT 0,
    hatches INTEGER NOT NULL DEFAULT 0,
    swaps INTEGER NOT NULL DEFAULT 0,
    catchbot INTEGER NOT NULL DEFAULT 0,
    battles INTEGER NOT NULL DEFAULT 0,
    joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(clan_id) REFERENCES clans(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS clan_activity_periods (
    clan_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    period TEXT NOT NULL CHECK (period IN ('daily', 'weekly', 'monthly', 'yearly')),
    period_start INTEGER NOT NULL,
    catches INTEGER NOT NULL DEFAULT 0,
    fishes INTEGER NOT NULL DEFAULT 0,
    hatches INTEGER NOT NULL DEFAULT 0,
    swaps INTEGER NOT NULL DEFAULT 0,
    catchbot INTEGER NOT NULL DEFAULT 0,
    battles INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (clan_id, user_id, period, period_start),
    FOREIGN KEY(clan_id) REFERENCES clans(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS pokemon_rarity_settings (
    name TEXT PRIMARY KEY,
    spawn_weight INTEGER NOT NULL DEFAULT 0,
    catch_chance INTEGER NOT NULL DEFAULT 50
  );

  CREATE TABLE IF NOT EXISTS pokemon_rarity_overrides (
    pokemon_id INTEGER PRIMARY KEY,
    rarity TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_rarity_streaks (
    user_id TEXT NOT NULL,
    rarity TEXT NOT NULL,
    streak_count INTEGER NOT NULL DEFAULT 0,
    highest_streak INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, rarity)
  );

  CREATE TABLE IF NOT EXISTS user_favorites (
    user_id TEXT NOT NULL,
    species_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, species_id)
  );

  CREATE TABLE IF NOT EXISTS world_boss (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    current_hp INTEGER NOT NULL,
    max_hp INTEGER NOT NULL,
    image_url TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    rewards_claimed INTEGER NOT NULL DEFAULT 0,
    spawned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    registration_ends_at INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS world_boss_registrations (
    boss_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    registered_at INTEGER NOT NULL,
    team_pokemon_ids TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY (boss_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS boss_damage (
    user_id TEXT PRIMARY KEY,
    damage INTEGER NOT NULL DEFAULT 0,
    last_hit INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS world_boss_rewards (
    boss_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    boss_name TEXT NOT NULL,
    max_hp INTEGER NOT NULL,
    damage INTEGER NOT NULL,
    rank INTEGER NOT NULL,
    total_players INTEGER NOT NULL,
    coins INTEGER NOT NULL DEFAULT 0,
    claimed INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (boss_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS pokemon_forms_rarity_idx ON pokemon_forms(rarity);
  CREATE INDEX IF NOT EXISTS pokemon_forms_species_idx ON pokemon_forms(species_id);
  CREATE INDEX IF NOT EXISTS boss_damage_leaderboard_idx ON boss_damage(damage DESC);
`);

const collectionTableSql = db.prepare(
  "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'global_collections'"
).get()?.sql || '';
if (!collectionTableSql.includes('is_shiny')) {
  db.transaction(() => {
    db.exec(`
      ALTER TABLE global_collections RENAME TO global_collections_legacy;
      CREATE TABLE global_collections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        pokemon_id INTEGER NOT NULL,
        is_shiny INTEGER NOT NULL DEFAULT 0,
        pokemon_name TEXT NOT NULL,
        buy_price INTEGER,
        is_private INTEGER NOT NULL DEFAULT 0,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, pokemon_id, is_shiny)
      );
      INSERT INTO global_collections (
        id, user_id, pokemon_id, is_shiny, pokemon_name, buy_price, is_private, updated_at
      )
      SELECT id, user_id, pokemon_id, 0, pokemon_name, buy_price, is_private, updated_at
      FROM global_collections_legacy;
      DROP TABLE global_collections_legacy;
    `);
  }).immediate();
}

if (!/is_golden/.test(
  db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'global_collections'").get()?.sql || ''
)) {
  db.transaction(() => {
    db.exec(`
      ALTER TABLE global_collections RENAME TO global_collections_legacy;
      CREATE TABLE global_collections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        pokemon_id INTEGER NOT NULL,
        is_shiny INTEGER NOT NULL DEFAULT 0,
        is_golden INTEGER NOT NULL DEFAULT 0,
        pokemon_name TEXT NOT NULL,
        buy_price INTEGER,
        is_private INTEGER NOT NULL DEFAULT 0,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, pokemon_id, is_shiny, is_golden)
      );
      INSERT INTO global_collections (
        id, user_id, pokemon_id, is_shiny, is_golden, pokemon_name, buy_price, is_private, updated_at
      )
      SELECT id, user_id, pokemon_id, is_shiny, 0, pokemon_name, buy_price, is_private, updated_at
      FROM global_collections_legacy;
      DROP TABLE global_collections_legacy;
    `);
  }).immediate();
}

const channelBoostColumns = new Set(
  db.prepare('PRAGMA table_info(channel_catch_rate_boosts)').all().map((column) => column.name)
);
if (!channelBoostColumns.has('user_id')) {
  db.transaction(() => {
    db.exec(`
      ALTER TABLE channel_catch_rate_boosts RENAME TO channel_catch_rate_boosts_legacy;
      CREATE TABLE channel_catch_rate_boosts (
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        PRIMARY KEY (user_id, guild_id, channel_id)
      );
      INSERT INTO channel_catch_rate_boosts (user_id, guild_id, channel_id)
      SELECT '', guild_id, channel_id FROM channel_catch_rate_boosts_legacy;
      DROP TABLE channel_catch_rate_boosts_legacy;
    `);
  }).immediate();
}

const clanActivityTableSql = db.prepare(
  "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'clan_activity_periods'"
).get()?.sql || '';
if (!clanActivityTableSql.includes("'yearly'")) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE clan_activity_periods_updated (
        clan_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        period TEXT NOT NULL CHECK (period IN ('daily', 'weekly', 'monthly', 'yearly')),
        period_start INTEGER NOT NULL,
        catches INTEGER NOT NULL DEFAULT 0,
        fishes INTEGER NOT NULL DEFAULT 0,
        hatches INTEGER NOT NULL DEFAULT 0,
        swaps INTEGER NOT NULL DEFAULT 0,
        catchbot INTEGER NOT NULL DEFAULT 0,
        battles INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (clan_id, user_id, period, period_start),
        FOREIGN KEY(clan_id) REFERENCES clans(id) ON DELETE CASCADE
      );
      INSERT INTO clan_activity_periods_updated
        (clan_id, user_id, period, period_start, catches, fishes, hatches, swaps, catchbot, battles)
      SELECT clan_id, user_id, period, period_start, catches, fishes, hatches, swaps, catchbot, battles
      FROM clan_activity_periods;
      DROP TABLE clan_activity_periods;
      ALTER TABLE clan_activity_periods_updated RENAME TO clan_activity_periods;
    `);
  }).immediate();
}

ensureColumns('clans', {
  co_leader_id: 'TEXT',
  co_leader_ids: 'TEXT',
  clan_rank: "TEXT NOT NULL DEFAULT 'starter'",
  treasury: 'INTEGER NOT NULL DEFAULT 0',
  cr_tier: 'INTEGER NOT NULL DEFAULT 0',
  sr_tier: 'INTEGER NOT NULL DEFAULT 0',
  er_tier: 'INTEGER NOT NULL DEFAULT 0',
  pr_tier: 'INTEGER NOT NULL DEFAULT 0',
  shop_boost: 'INTEGER NOT NULL DEFAULT 0',
  amulet_boost: 'INTEGER NOT NULL DEFAULT 0',
});
ensureColumns('clan_members', {
  perk_rank: 'INTEGER NOT NULL DEFAULT 0',
  donated_coins: 'INTEGER NOT NULL DEFAULT 0',
  hatches: 'INTEGER NOT NULL DEFAULT 0',
  swaps: 'INTEGER NOT NULL DEFAULT 0',
  catchbot: 'INTEGER NOT NULL DEFAULT 0',
  battles: 'INTEGER NOT NULL DEFAULT 0',
});
const desiredClanIds = new Map([
  ['ascension', 1],
  ['shadow garden', 2],
  ['feral faeries', 3],
]);
const normalizeClanName = (name) => name.normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/æ/gi, 'ae')
  .trim()
  .toLowerCase();
const clansToRenumber = db.prepare('SELECT id, name FROM clans').all()
  .map((clan) => ({
    currentId: clan.id,
    targetId: desiredClanIds.get(normalizeClanName(clan.name)),
  }))
  .filter((clan) => clan.targetId !== undefined && clan.currentId !== clan.targetId);
if (clansToRenumber.length) {
  const conflictingClan = db.prepare('SELECT id, name FROM clans WHERE id = ?');
  for (const { targetId } of clansToRenumber) {
    const conflict = conflictingClan.get(targetId);
    if (conflict && !clansToRenumber.some(({ currentId }) => currentId === conflict.id)) {
      throw new Error(`Cannot assign clan ID ${targetId}; it belongs to unrelated clan "${conflict.name}".`);
    }
  }
  const clanIdChanges = clansToRenumber.map((clan, index) => ({
    ...clan,
    temporaryId: -1000000 - index,
  }));
  db.pragma('defer_foreign_keys = ON');
  db.transaction(() => {
    const updateActivityId = db.prepare(
      'UPDATE clan_activity_periods SET clan_id = ? WHERE clan_id = ?'
    );
    const updateMemberId = db.prepare(
      'UPDATE clan_members SET clan_id = ? WHERE clan_id = ?'
    );
    const updateClanId = db.prepare(
      'UPDATE clans SET id = ? WHERE id = ?'
    );
    for (const { currentId, temporaryId } of clanIdChanges) {
      updateActivityId.run(temporaryId, currentId);
      updateMemberId.run(temporaryId, currentId);
      updateClanId.run(temporaryId, currentId);
    }
    for (const { targetId, temporaryId } of clanIdChanges) {
      updateActivityId.run(targetId, temporaryId);
      updateMemberId.run(targetId, temporaryId);
      updateClanId.run(targetId, temporaryId);
    }
    db.prepare(`
      UPDATE sqlite_sequence
      SET seq = (SELECT COALESCE(MAX(id), 0) FROM clans)
      WHERE name = 'clans'
    `).run();
  }).immediate();
}
ensureColumns('catchbot_data', {
  completion_notified_until: 'INTEGER NOT NULL DEFAULT 0',
  golden_caught: 'INTEGER NOT NULL DEFAULT 0',
});
db.exec(`
  UPDATE clans
  SET clan_rank = CASE
    WHEN cr_tier >= 4 THEN 'diamond'
    WHEN cr_tier = 3 THEN 'gold'
    WHEN cr_tier = 2 THEN 'silver'
    WHEN cr_tier = 1 THEN 'bronze'
    ELSE 'starter'
  END
  WHERE clan_rank = 'starter' AND cr_tier > 0;
`);
// Quests grew from 2 to 3 slots; SQLite cannot alter a CHECK constraint, so rebuild the table.
const activeQuestsSql = db.prepare(
  "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'active_quests'"
).get()?.sql || '';
if (activeQuestsSql.includes('BETWEEN 1 AND 2')) {
  db.transaction(() => {
    db.exec(`
      ALTER TABLE active_quests RENAME TO active_quests_legacy;
      DROP INDEX IF EXISTS active_quests_user_slot_idx;
      CREATE TABLE active_quests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 3),
        quest_type TEXT NOT NULL,
        target_type TEXT NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        target INTEGER NOT NULL,
        reward_coins INTEGER NOT NULL,
        reward_candies INTEGER NOT NULL DEFAULT 0,
        reward_lootboxes INTEGER NOT NULL DEFAULT 0,
        reward_masterballs INTEGER NOT NULL DEFAULT 0,
        reward_ultraballs INTEGER NOT NULL DEFAULT 0,
        reward_grazz INTEGER NOT NULL DEFAULT 0,
        UNIQUE (user_id, slot)
      );
      INSERT INTO active_quests (
        id, user_id, slot, quest_type, target_type, progress, target,
        reward_coins, reward_candies, reward_lootboxes
      )
      SELECT id, user_id, slot, quest_type, target_type, progress, target,
        reward_coins, reward_candies, reward_lootboxes
      FROM active_quests_legacy;
      DROP TABLE active_quests_legacy;
    `);
  }).immediate();
}
ensureColumns('active_quests', {
  reward_masterballs: 'INTEGER NOT NULL DEFAULT 0',
  reward_ultraballs: 'INTEGER NOT NULL DEFAULT 0',
  reward_grazz: 'INTEGER NOT NULL DEFAULT 0',
  reward_items: "TEXT NOT NULL DEFAULT '{}'",
  refresh_at: 'INTEGER NOT NULL DEFAULT 0',
});
// Patreon tiers unlock up to 5 quest slots, so widen the slot CHECK constraint.
if (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'active_quests'").get()
  ?.sql.includes('BETWEEN 1 AND 3')) {
  db.transaction(() => {
    db.exec(`
      ALTER TABLE active_quests RENAME TO active_quests_legacy;
      DROP INDEX IF EXISTS active_quests_user_slot_idx;
      CREATE TABLE active_quests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 5),
        quest_type TEXT NOT NULL,
        target_type TEXT NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        target INTEGER NOT NULL,
        reward_coins INTEGER NOT NULL,
        reward_candies INTEGER NOT NULL DEFAULT 0,
        reward_lootboxes INTEGER NOT NULL DEFAULT 0,
        reward_masterballs INTEGER NOT NULL DEFAULT 0,
        reward_ultraballs INTEGER NOT NULL DEFAULT 0,
        reward_grazz INTEGER NOT NULL DEFAULT 0,
        reward_items TEXT NOT NULL DEFAULT '{}',
        UNIQUE (user_id, slot)
      );
      INSERT INTO active_quests (
        id, user_id, slot, quest_type, target_type, progress, target,
        reward_coins, reward_candies, reward_lootboxes,
        reward_masterballs, reward_ultraballs, reward_grazz, reward_items
      )
      SELECT id, user_id, slot, quest_type, target_type, progress, target,
        reward_coins, reward_candies, reward_lootboxes,
        reward_masterballs, reward_ultraballs, reward_grazz, reward_items
      FROM active_quests_legacy;
      DROP TABLE active_quests_legacy;
    `);
  }).immediate();
}
ensureColumns('world_boss', {
  rewards_claimed: 'INTEGER NOT NULL DEFAULT 0',
  spawned_by: 'TEXT',
  spawned_by_name: 'TEXT',
  registration_ends_at: 'INTEGER NOT NULL DEFAULT 0',
});
ensureColumns('giveaway_entries', { username: 'TEXT' });

db.exec(`
  CREATE TABLE IF NOT EXISTS lottery_state (
    id INTEGER PRIMARY KEY,
    jackpot INTEGER NOT NULL DEFAULT 5000000,
    ends_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS lottery_tickets (
    user_id TEXT PRIMARY KEY,
    ticket_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS lottery_user_stats (
    user_id TEXT PRIMARY KEY,
    wins_first INTEGER NOT NULL DEFAULT 0,
    wins_second INTEGER NOT NULL DEFAULT 0,
    wins_third INTEGER NOT NULL DEFAULT 0,
    lotteries_joined INTEGER NOT NULL DEFAULT 0,
    lifetime_tickets INTEGER NOT NULL DEFAULT 0,
    lifetime_winnings INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS lottery_channels (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL
  );
`);

// Promo items live in user_items; migrate any legacy promo_tokens balances across.
if (db.prepare('PRAGMA table_info(users)').all().some((column) => column.name === 'promo_tokens')) {
  db.exec(`
    INSERT INTO user_items (user_id, item_name, amount)
    SELECT id, 'Golden Leaf', promo_tokens FROM users WHERE promo_tokens > 0
    ON CONFLICT(user_id, item_name) DO UPDATE SET amount = user_items.amount + excluded.amount;
    UPDATE users SET promo_tokens = 0 WHERE promo_tokens > 0;
  `);
}
if (!db.prepare('PRAGMA table_info(event_catches)').all().some((column) => column.name === 'catch_count')) {
  db.exec('ALTER TABLE event_catches ADD COLUMN catch_count INTEGER NOT NULL DEFAULT 1');
}
ensureColumns('world_boss_registrations', {
  team_pokemon_ids: "TEXT NOT NULL DEFAULT '[]'",
});
const worldBossRewardColumns = new Set(
  db.prepare('PRAGMA table_info(world_boss_rewards)').all().map((column) => column.name)
);
if (!worldBossRewardColumns.has('items_json')) {
  db.exec("ALTER TABLE world_boss_rewards ADD COLUMN items_json TEXT NOT NULL DEFAULT ''");
}
if (!worldBossRewardColumns.has('pokemon_drop')) {
  db.exec('ALTER TABLE world_boss_rewards ADD COLUMN pokemon_drop INTEGER NOT NULL DEFAULT 0');
}
const worldBossPostPrimaryKey = db.prepare(
  'PRAGMA table_info(world_boss_announcement_posts)'
).all().filter((column) => column.pk > 0).sort((left, right) => left.pk - right.pk);
if (worldBossPostPrimaryKey.length === 1 && worldBossPostPrimaryKey[0].name === 'boss_id') {
  db.transaction(() => {
    db.exec(`
      ALTER TABLE world_boss_announcement_posts RENAME TO world_boss_announcement_posts_legacy;
      CREATE TABLE world_boss_announcement_posts (
        boss_id INTEGER NOT NULL,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        PRIMARY KEY (boss_id, guild_id)
      );
      INSERT INTO world_boss_announcement_posts (boss_id, guild_id, channel_id, message_id)
      SELECT boss_id, guild_id, channel_id, message_id
      FROM world_boss_announcement_posts_legacy;
      DROP TABLE world_boss_announcement_posts_legacy;
    `);
  }).immediate();
}
ensureColumns('pokemon_forms', {
  slug: "TEXT NOT NULL DEFAULT ''",
  evolution_chain_id: 'INTEGER',
  is_custom: 'INTEGER NOT NULL DEFAULT 0',
  base_spa: 'INTEGER NOT NULL DEFAULT 50',
  base_spdef: 'INTEGER NOT NULL DEFAULT 50',
});
ensureColumns('autospawn_channels', {
  message_count: 'INTEGER NOT NULL DEFAULT 0',
  message_target: 'INTEGER NOT NULL DEFAULT 0',
});
db.exec('CREATE INDEX IF NOT EXISTS pokemon_forms_slug_idx ON pokemon_forms(slug)');
ensureColumns('users', userDefinitions);
ensureColumns('users', { id: 'TEXT' });
ensureColumns('user_rarity_streaks', {
  highest_streak: 'INTEGER NOT NULL DEFAULT 0',
});
db.prepare('UPDATE users SET team_exp_share = 0 WHERE exp_share_owned = 0').run();
db.prepare(`
  UPDATE users
  SET has_good_rod = 1, has_super_rod = 1
  WHERE lower(fish_rods) = 'super rod'
`).run();
db.exec('UPDATE users SET daily_streak = 1 WHERE daily_streak = 0 AND last_daily > 0');
db.exec('UPDATE users SET highest_daily_streak = daily_streak WHERE highest_daily_streak < daily_streak');
db.exec('UPDATE users SET highest_vote_streak = vote_streak WHERE highest_vote_streak < vote_streak');
db.exec('UPDATE user_rarity_streaks SET highest_streak = streak_count WHERE highest_streak < streak_count');
const userColumns = new Set(
  db.prepare('PRAGMA table_info(users)').all().map((column) => column.name)
);
if (userColumns.has('user_id')) {
  db.exec(`
    UPDATE users SET id = user_id WHERE id IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS users_id_idx ON users(id);
  `);
}
db.exec(`
  INSERT OR IGNORE INTO user_rarity_streaks (user_id, rarity, streak_count, highest_streak)
  SELECT id, 'Common', common_streak, common_streak
  FROM users
  WHERE common_streak > 0 AND id IS NOT NULL
`);
const catchColumnsBeforeMigration = new Set(
  db.prepare('PRAGMA table_info(catches)').all().map((column) => column.name)
);
ensureColumns('catches', catchDefinitions);
if (!catchColumnsBeforeMigration.has('spa_iv')) {
  db.exec('UPDATE catches SET spa_iv = (random() & 2147483647) % 32');
}
if (!catchColumnsBeforeMigration.has('spdef_iv')) {
  db.exec('UPDATE catches SET spdef_iv = (random() & 2147483647) % 32');
}
db.prepare(`
  INSERT INTO pokemon_user_seen_counts (user_id, pokemon_id, is_shiny, is_golden, seen_count)
  SELECT user_id, pokemon_id, is_shiny, is_golden, COUNT(*)
  FROM catches
  WHERE pokemon_id IS NOT NULL AND user_id IS NOT NULL
  GROUP BY user_id, pokemon_id, is_shiny, is_golden
  ON CONFLICT (user_id, pokemon_id, is_shiny, is_golden) DO NOTHING
`).run();
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS active_quests_user_slot_idx ON active_quests(user_id, slot)');
db.exec(`
  UPDATE catches SET in_team = 0, team_slot = NULL
  WHERE id IN (
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY id) AS team_order
      FROM catches WHERE in_team = 1
    ) WHERE team_order > 3
  );
  UPDATE catches
  SET team_slot = (
    SELECT COUNT(*) FROM catches AS earlier
    WHERE earlier.user_id = catches.user_id
      AND earlier.in_team = 1
      AND earlier.id <= catches.id
  )
  WHERE in_team = 1 AND team_slot IS NULL;
`);
const marketColumnsBeforeMigration = new Set(
  db.prepare('PRAGMA table_info(market)').all().map((column) => column.name)
);
ensureColumns('market', {
  amount: 'INTEGER NOT NULL DEFAULT 1',
  is_golden: 'INTEGER NOT NULL DEFAULT 0',
  hp_iv: 'INTEGER NOT NULL DEFAULT 0',
  atk_iv: 'INTEGER NOT NULL DEFAULT 0',
  def_iv: 'INTEGER NOT NULL DEFAULT 0',
  spa_iv: 'INTEGER NOT NULL DEFAULT 0',
  spdef_iv: 'INTEGER NOT NULL DEFAULT 0',
  spd_iv: 'INTEGER NOT NULL DEFAULT 0',
  experience: 'INTEGER NOT NULL DEFAULT 0',
  hp: 'INTEGER NOT NULL DEFAULT 10',
  max_hp: 'INTEGER NOT NULL DEFAULT 10',
  atk: 'INTEGER NOT NULL DEFAULT 5',
  def: 'INTEGER NOT NULL DEFAULT 5',
  spd: 'INTEGER NOT NULL DEFAULT 5',
});
if (!marketColumnsBeforeMigration.has('spa_iv')) {
  db.exec('UPDATE market SET spa_iv = (random() & 2147483647) % 32');
}
if (!marketColumnsBeforeMigration.has('spdef_iv')) {
  db.exec('UPDATE market SET spdef_iv = (random() & 2147483647) % 32');
}
ensureColumns('market_sales', {
  is_golden: 'INTEGER NOT NULL DEFAULT 0',
  tax_rate: 'INTEGER NOT NULL DEFAULT 15',
  claimed: 'INTEGER NOT NULL DEFAULT 0',
});

const catalogPath = path.join(__dirname, 'data', 'pokemon-catalog.json');
if (!fs.existsSync(catalogPath)) {
  throw new Error(
    'Pokémon catalog is missing. Run "npm run sync-pokemon" to download the catalog before starting the bot.'
  );
}

const pokemonCatalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
if (!Array.isArray(pokemonCatalog) || pokemonCatalog.length === 0) {
  throw new Error(`Pokémon catalog at ${catalogPath} is empty or invalid.`);
}

const evolutionChainsPath = path.join(__dirname, 'data', 'pokemon-evolution-chains.json');
const evolutionChainsBySpecies = fs.existsSync(evolutionChainsPath)
  ? JSON.parse(fs.readFileSync(evolutionChainsPath, 'utf8'))
  : {};
if (!evolutionChainsBySpecies || typeof evolutionChainsBySpecies !== 'object'
    || Array.isArray(evolutionChainsBySpecies)) {
  throw new Error(`Pokémon evolution-chain data at ${evolutionChainsPath} is invalid.`);
}
const persistedEvolutionChainsBySpecies = new Map(
  db.prepare(`
    SELECT species_id, evolution_chain_id
    FROM pokemon_forms
    WHERE evolution_chain_id IS NOT NULL
    GROUP BY species_id
  `).all().map((row) => [row.species_id, row.evolution_chain_id])
);
const speciesMissingEvolutionChains = [
  ...new Set(pokemonCatalog.map((pokemon) => pokemon.species_id)),
].filter((speciesId) => !Number.isSafeInteger(evolutionChainsBySpecies[speciesId])
  && !persistedEvolutionChainsBySpecies.has(speciesId));
if (!fs.existsSync(evolutionChainsPath) || speciesMissingEvolutionChains.length) {
  console.warn(
    `Pokémon evolution-chain data is unavailable or incomplete at ${evolutionChainsPath}; ` +
    'Pokédex navigation will retain known families and still include each species’ own forms. ' +
    'Run "npm run sync-pokemon" to restore complete evolution-family navigation.'
  );
}

const pokemonRaritiesPath = path.join(__dirname, 'data', 'pokemon-rarities.json');
if (!fs.existsSync(pokemonRaritiesPath)) {
  const initialRarities = pokemonCatalog.map(({ id, name, rarity }) => ({ id, name, rarity }));
  fs.writeFileSync(pokemonRaritiesPath, `${JSON.stringify(initialRarities, null, 2)}\n`);
}
const pokemonRarities = JSON.parse(fs.readFileSync(pokemonRaritiesPath, 'utf8'));
if (!Array.isArray(pokemonRarities)) {
  throw new Error(`Pokémon rarity file at ${pokemonRaritiesPath} must contain an array.`);
}
const pokemonRarityById = new Map();
for (const entry of pokemonRarities) {
  if (!Number.isSafeInteger(entry.id) || entry.id <= 0
      || typeof entry.name !== 'string' || !entry.name.trim()
      || typeof entry.rarity !== 'string' || !entry.rarity.trim()
      || pokemonRarityById.has(entry.id)) {
    throw new Error(`Invalid or duplicate Pokémon rarity entry in ${pokemonRaritiesPath}.`);
  }
  pokemonRarityById.set(entry.id, { ...entry, rarity: entry.rarity.trim() });
}
for (const pokemon of pokemonCatalog) {
  if (!pokemonRarityById.has(pokemon.id)) {
    throw new Error(
      `Pokémon ID ${pokemon.id} is missing from ${pokemonRaritiesPath}. Run "npm run sync-rarities".`
    );
  }
}

// Display Mega forms as "Mega <Pokémon>" (e.g. "Mega Charizard X") instead of "<Pokémon> Mega".
function toMegaDisplayName(name) {
  return typeof name === 'string'
    ? name.replace(/^(.+?) Mega( [XYZ])?$/, 'Mega $1$2')
    : name;
}

const upsertPokemonForm = db.prepare(`
  INSERT INTO pokemon_forms (
    id, species_id, species_name, slug, name, is_default, is_legendary, is_mythical,
    evolution_chain_id, evolution_stage, rarity, base_hp, base_atk, base_def, base_spa, base_spdef, base_spd,
    base_stat_total, types, is_water, sprite, shiny_sprite, generation, is_custom
  )
  VALUES (
    @id, @species_id, @species_name, @slug, @name, @is_default, @is_legendary, @is_mythical,
    @evolution_chain_id, @evolution_stage, @rarity, @base_hp, @base_atk, @base_def, @base_spa, @base_spdef, @base_spd,
    @base_stat_total, @types, @is_water, @sprite, @shiny_sprite, @generation, 0
  )
  ON CONFLICT(id) DO UPDATE SET
    species_id = excluded.species_id,
    species_name = excluded.species_name,
    slug = excluded.slug,
    name = excluded.name,
    is_default = excluded.is_default,
    is_legendary = excluded.is_legendary,
    is_mythical = excluded.is_mythical,
    evolution_chain_id = excluded.evolution_chain_id,
    evolution_stage = excluded.evolution_stage,
    rarity = excluded.rarity,
    base_hp = excluded.base_hp,
    base_atk = excluded.base_atk,
    base_def = excluded.base_def,
    base_spa = excluded.base_spa,
    base_spdef = excluded.base_spdef,
    base_spd = excluded.base_spd,
    base_stat_total = excluded.base_stat_total,
    types = excluded.types,
    is_water = excluded.is_water,
    sprite = excluded.sprite,
    shiny_sprite = excluded.shiny_sprite,
    generation = excluded.generation,
    is_custom = 0
`);
const getExistingPokemonFormName = db.prepare('SELECT name FROM pokemon_forms WHERE id = ?');
const renameExistingCatch = db.prepare('UPDATE catches SET name = ? WHERE pokemon_id = ? AND name = ?');
const renameExistingMarketListing = db.prepare('UPDATE market SET name = ? WHERE pokemon_id = ? AND name = ?');
db.exec('CREATE TEMP TABLE IF NOT EXISTS pokemon_catalog_import_ids (id INTEGER PRIMARY KEY)');
const markCatalogId = db.prepare('INSERT INTO pokemon_catalog_import_ids (id) VALUES (?)');
db.transaction(() => {
  db.exec('DELETE FROM pokemon_catalog_import_ids');
  for (const catalogEntry of pokemonCatalog) {
    const pokemon = {
      ...catalogEntry,
      name: toMegaDisplayName(catalogEntry.name),
      base_spa: catalogEntry.base_spa ?? 50,
      base_spdef: catalogEntry.base_spdef ?? 50,
    };
    const rarity = pokemonRarityById.get(pokemon.id).rarity;
    const evolutionChainId = evolutionChainsBySpecies[pokemon.species_id]
      || persistedEvolutionChainsBySpecies.get(pokemon.species_id)
      || pokemon.species_id;
    if (!Number.isSafeInteger(evolutionChainId) || evolutionChainId <= 0) {
      throw new Error(`Invalid evolution-chain ID for Pokémon species ${pokemon.species_id}.`);
    }
    const existingName = getExistingPokemonFormName.get(pokemon.id)?.name;
    if (existingName && existingName !== pokemon.name) {
      renameExistingCatch.run(pokemon.name, pokemon.id, existingName);
      renameExistingMarketListing.run(pokemon.name, pokemon.id, existingName);
    }
    upsertPokemonForm.run({ ...pokemon, evolution_chain_id: evolutionChainId, rarity });
    markCatalogId.run(pokemon.id);
  }
  // Removed forms whose existing catches become another form instead of being orphaned.
  const REMOVED_FORM_CONVERSIONS = [
    { from: [10029], to: 710 },
    { from: [10030, 10031, 10032], to: 711 },
  ];
  for (const { from, to } of REMOVED_FORM_CONVERSIONS) {
    const target = db.prepare('SELECT name, rarity FROM pokemon_forms WHERE id = ?').get(to);
    if (!target) continue;
    for (const fromId of from) {
      db.prepare('UPDATE catches SET pokemon_id = ?, name = ?, rarity = ? WHERE pokemon_id = ?')
        .run(to, target.name, target.rarity, fromId);
      db.prepare('UPDATE market SET pokemon_id = ?, name = ?, rarity = ? WHERE pokemon_id = ?')
        .run(to, target.name, target.rarity, fromId);
      db.prepare('DELETE FROM pokemon_rarity_overrides WHERE pokemon_id = ?').run(fromId);
    }
  }
  db.exec(`
    DELETE FROM pokemon_forms
    WHERE is_custom = 0
      AND id NOT IN (SELECT id FROM pokemon_catalog_import_ids)
  `);
})();
db.exec('DROP TABLE pokemon_catalog_import_ids');

const setImportedPokemonRarity = db.prepare('UPDATE pokemon_forms SET rarity = ? WHERE id = ?');
const setImportedCatchRarity = db.prepare('UPDATE catches SET rarity = ? WHERE pokemon_id = ?');
const setImportedMarketRarity = db.prepare('UPDATE market SET rarity = ? WHERE pokemon_id = ?');
const persistImportedRarityOverride = db.prepare(`
  INSERT INTO pokemon_rarity_overrides (pokemon_id, rarity)
  VALUES (?, ?)
  ON CONFLICT(pokemon_id) DO UPDATE SET rarity = excluded.rarity
`);
const catalogPokemonIds = new Set(pokemonCatalog.map((pokemon) => pokemon.id));
db.transaction(() => {
  for (const entry of pokemonRarities) {
    setImportedPokemonRarity.run(entry.rarity, entry.id);
    setImportedCatchRarity.run(entry.rarity, entry.id);
    setImportedMarketRarity.run(entry.rarity, entry.id);
    if (!catalogPokemonIds.has(entry.id)) continue;
    persistImportedRarityOverride.run(entry.id, entry.rarity);
  }
})();

// pokemon-database/*.json: edit name, rarity and sprite URLs by slug; extra files and new slugs are supported.
const animatedSprites = new Map();
db.transaction(() => {
  const getFormBySlug = db.prepare('SELECT id, name, sprite, shiny_sprite FROM pokemon_forms WHERE slug = ?');
  const updateForm = db.prepare('UPDATE pokemon_forms SET name = ?, sprite = ?, shiny_sprite = ? WHERE id = ?');
  const renameCatches = db.prepare('UPDATE catches SET name = ? WHERE pokemon_id = ? AND name = ?');
  const renameMarket = db.prepare('UPDATE market SET name = ? WHERE pokemon_id = ? AND name = ?');
  for (const record of loadPokemonDatabase().values()) {
    let form = getFormBySlug.get(record.slug);
    const source = record.entry;
    if (!form) {
      // Unknown slug: add it as a custom Pokémon (needs name, rarity and sprite).
      if (!source || !record.name || !record.rarity || !record.sprite) continue;
      const id = (db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM pokemon_forms').get().id || 0) + 1;
      const types = Array.isArray(source.types) ? JSON.stringify(source.types) : (source.types || '["normal"]');
      const stat = (value, fallback) => (Number.isSafeInteger(value) && value > 0 ? value : fallback);
      const dex = record.dexNumber || id;
      db.prepare(`
        INSERT INTO pokemon_forms (
          id, species_id, species_name, slug, name, is_default, is_legendary, is_mythical,
          evolution_chain_id, evolution_stage, rarity, base_hp, base_atk, base_def,
          base_spa, base_spdef, base_spd, base_stat_total, types, is_water, sprite,
          shiny_sprite, generation, is_custom
        ) VALUES (?, ?, ?, ?, ?, 1, 0, 0, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'custom', 1)
        `).run(
          id, dex, record.name, record.slug, record.name, dex, record.rarity,
          stat(source.base_hp, 50), stat(source.base_atk, 50), stat(source.base_def, 50), stat(source.base_spd, 50),
          stat(source.base_spa, 50), stat(source.base_spdef, 50),
          stat(source.base_spd, 50),
          stat(source.base_hp, 50) + stat(source.base_atk, 50) + stat(source.base_def, 50)
            + stat(source.base_spa, 50) + stat(source.base_spdef, 50) + stat(source.base_spd, 50),
        types, source.is_water ? 1 : 0, record.sprite, record.shinySprite || record.sprite
      );
      form = getFormBySlug.get(record.slug);
    }
    const name = toMegaDisplayName(record.name || form.name);
    if (name !== form.name) {
      renameCatches.run(name, form.id, form.name);
      renameMarket.run(name, form.id, form.name);
    }
    updateForm.run(name, record.sprite || form.sprite, record.shinySprite || form.shiny_sprite, form.id);
    if (record.rarity) {
      setImportedPokemonRarity.run(record.rarity, form.id);
      setImportedCatchRarity.run(record.rarity, form.id);
      setImportedMarketRarity.run(record.rarity, form.id);
      persistImportedRarityOverride.run(form.id, record.rarity);
    }
    if (record.animated || record.shinyAnimated) {
      animatedSprites.set(record.slug, { normal: record.animated, shiny: record.shinyAnimated });
    }
  }
})();
setSpriteOverrides(animatedSprites);

const defaultRaritySettings = [
  ['Common', 400, 70],
  ['Uncommon', 345, 60],
  ['Rare', 200, 37],
  ['Super Rare', 50, 20],
  ['Legendary', 5, 5],
  ['Mega', 50, 25],
  ['Gmax', 50, 25],
  ['Shiny', 0, 64],
  ['Shiny Mega', 0, 64],
  ['Shiny Gmax', 0, 64],
  ['Event Shiny', 0, 0],
];
const insertRaritySetting = db.prepare(`
  INSERT OR IGNORE INTO pokemon_rarity_settings (name, spawn_weight, catch_chance)
  VALUES (?, ?, ?)
`);
for (const setting of defaultRaritySettings) insertRaritySetting.run(...setting);
const migrateDefaultCatchChance = db.prepare(`
  UPDATE pokemon_rarity_settings
  SET catch_chance = ?
  WHERE name = ? COLLATE NOCASE AND catch_chance = ?
`);
for (const [name, oldChance, newChance] of [
  ['Uncommon', 55, 60],
  ['Rare', 40, 37],
  ['Super Rare', 25, 20],
  ['Shiny', 50, 64],
  ['Shiny Mega', 50, 64],
  ['Shiny Gmax', 50, 64],
]) {
  migrateDefaultCatchChance.run(newChance, name, oldChance);
}
const insertUnconfiguredRarity = db.prepare(`
  INSERT OR IGNORE INTO pokemon_rarity_settings (name, spawn_weight, catch_chance)
  VALUES (?, 0, 50)
`);
for (const row of db.prepare('SELECT DISTINCT rarity FROM pokemon_forms').all()) {
  insertUnconfiguredRarity.run(row.rarity);
}

const incrementableUserFields = new Set([
  'pokeradar_charges',
  'double_xp_charges',
  'coins',
  'research_points',
  'patreon_tokens',
  'pokeballs',
  'greatballs',
  'ultraballs',
  'masterballs',
  'premierballs',
  'diveballs',
  'quest_progress',
  'lootboxes',
  'cooldown_machine_catch_charges',
  'cooldown_machine_fish_charges',
  'total_catches',
  'shiny_catches',
  'common_streak',
  'buddy_exp',
  'rare_candies',
  'active_poke_lures',
  'active_mistys_lures',
  'repels',
  'world_bosses_fought',
  'repel_encounters',
  'super_repel_encounters',
  'max_repel_encounters',
  'honey_encounters',
  'quest_reset_scrolls',
  'hunt_progress',
  'hunt_completed',
  'hunt_rerolls_left',
  'swap_tokens',
  'swaps_today',
  'grazz_berries',
  'grazz_buff_encounters',
  'fishing_tokens',
  'cl_catches',
  'cl_fishes',
  'cl_battles',
  'cl_event_catches',
  'wild_encounters',
  'pkc_earned',
  'used_pokeballs',
  'used_greatballs',
  'used_ultraballs',
  'used_premierballs',
  'used_masterballs',
  'legendaries_caught',
  'promos_claimed',
  'promo_tokens',
  'icons_unlocked',
  'battles_won',
  'battles_lost',
  'max_qb_streak',
  'live_wins',
  'live_losses',
  'mega_chambers_won',
  'world_boss_mvps',
  'battle_tower_wins',
  'amulet_coins',
  'shiny_charms',
  'lootboxes_opened',
  'golden_razz_used',
  'repels_used',
  'rare_candies_used',
  'eggs_hatched',
  'incubators_used',
  'super_incubators_used',
  'honey_used',
  'pokeradars_used',
  'vouchers_used',
  'catchbot_runs',
  'dailies_claimed',
  'votes_claimed',
  'vote_coins',
  'vote_eggs',
  'swaps_done',
  'fishes_caught',
  'quests_completed',
  'hunts_completed',
  'lotteries_won',
  'events_joined',
  'codes_earned',
  'auctions_won',
]);

const updatableUserFields = new Set([
  ...Object.keys(userDefinitions),
  'id',
]);
const legacyUserIdColumn = userColumns.has('user_id');

function assertUserId(userId) {
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new TypeError('userId must be a non-empty string.');
  }
}

function getUser(userId) {
  assertUserId(userId);
  const created = legacyUserIdColumn
    ? db.prepare('INSERT OR IGNORE INTO users (id, user_id) VALUES (?, ?)').run(userId, userId)
    : db.prepare('INSERT OR IGNORE INTO users (id) VALUES (?)').run(userId);
  if (created.changes > 0) {
    db.prepare('UPDATE users SET joined_at = ? WHERE id = ?').run(Date.now(), userId);
  }
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

// One-time fix: joined_at used to come from the Discord server join date.
// Use each user's earliest catch instead, or now if they have none.
db.exec('CREATE TABLE IF NOT EXISTS migration_flags (name TEXT PRIMARY KEY)');
if (!db.prepare("SELECT 1 FROM migration_flags WHERE name = 'joined_at_first_command'").get()) {
  db.transaction(() => {
    db.prepare(`
      UPDATE users SET joined_at = COALESCE(
        (SELECT CAST(strftime('%s', MIN(caught_at)) AS INTEGER) * 1000 FROM catches WHERE catches.user_id = users.id),
        ?
      )
    `).run(Date.now());
    db.prepare("INSERT INTO migration_flags (name) VALUES ('joined_at_first_command')").run();
  })();
}

function updateUser(userId, updates) {
  assertUserId(userId);
  const entries = Object.entries(updates);
  if (entries.length === 0) return getUser(userId);

  for (const [field] of entries) {
    if (!updatableUserFields.has(field) || field === 'id') {
      throw new TypeError(`Cannot update user field: ${field}`);
    }
  }

  getUser(userId);
  const assignments = entries.map(([field]) => `${field} = ?`).join(', ');
  db.prepare(`UPDATE users SET ${assignments} WHERE id = ?`)
    .run(...entries.map(([, value]) => value), userId);
  return getUser(userId);
}

function incrementUser(userId, increments) {
  assertUserId(userId);
  const entries = Object.entries(increments);
  if (entries.length === 0) return getUser(userId);

  for (const [field, amount] of entries) {
    if (!incrementableUserFields.has(field)) {
      throw new TypeError(`Cannot increment user field: ${field}`);
    }
    if (!Number.isSafeInteger(amount)) {
      throw new TypeError(`Increment for ${field} must be a safe integer.`);
    }
  }

  getUser(userId);
  const assignments = entries.map(([field]) => `${field} = ${field} + ?`).join(', ');
  db.prepare(`UPDATE users SET ${assignments} WHERE id = ?`)
    .run(...entries.map(([, amount]) => amount), userId);
  return getUser(userId);
}

function grantGlobalUserReward() {
  const grantKey = 'global_user_reward_2026_10_21';
  return db.transaction(() => {
    const existingGrant = db.prepare('SELECT value FROM bot_settings WHERE key = ?').get(grantKey);
    if (existingGrant) {
      return { alreadyGranted: true, userCount: Number(existingGrant.value) || 0 };
    }

    const users = db.prepare('SELECT id FROM users ORDER BY id').all();
    if (users.length === 0) {
      throw new Error('Cannot grant the global reward because there are no registered users.');
    }

    const goldenPorygon = db.prepare(`
      SELECT id, name, base_hp AS baseHp, base_atk AS baseAtk, base_def AS baseDef, base_spd AS baseSpd
      FROM pokemon_forms
      WHERE slug = 'porygon' AND species_id = 137 AND is_default = 1
      LIMIT 1
    `).get();
    if (!goldenPorygon) {
      throw new Error('Cannot grant the global reward because the default Porygon form is unavailable.');
    }

    for (const { id } of users) {
      incrementUser(id, { coins: 10_000_000, vote_coins: 100 });
      saveGoldenCatch(id, goldenPorygon);
    }

    db.prepare('INSERT INTO bot_settings (key, value) VALUES (?, ?)')
      .run(grantKey, String(users.length));
    return { alreadyGranted: false, userCount: users.length };
  }).immediate();
}

// Per-tier Patreon boosts. Fill in the real values per tier key (matches users.patreon_tier).
// incenseBonus = extra charges per Incense used (on top of the base 100).
const NO_PATREON_PERKS = Object.freeze({
  catchBoost: 0, amuletCoins: 0, shinyCharms: 0, incenseBonus: 0,
  shinyRatePct: 0, eventShinyPct: 0, swapDiscount: 0, dailyCoinMult: 1, voteCoinMult: 1,
  ivChecker: false, megaChamberDiscount: 0, moveCostDiscount: 0, quickHands: 0, fishingBoost: 0, eggHatchSpeed: 0,
  autoEquipEggs: false, shopDiscount: 0, lootboxBoost: 0, goldenBoost: 0,
  dailyTokens: 0, dailyCoins: 0, monthly: null, questSlots: 3, questRefreshMultiplier: 1, releaseLocks: 0,
  marketListingSlots: 0, marketTax: 0.1,
});

const PATREON_TIER_ORDER = ['common', 'uncommon', 'rare', 'superRare', 'legendary', 'shiny', 'golden'];
// Each tier only lists what it adds; higher tiers inherit everything below.
const PATREON_TIER_DELTAS = {
  common: {
    catchBoost: 5, shinyRatePct: 25, eventShinyPct: 5, swapDiscount: 0.5, dailyCoinMult: 2,
    dailyTokens: 1, dailyCoins: 5000, releaseLocks: 5,
    monthly: { coins: 100000, masterballs: 3, rare_candies: 10, eggs: 1 },
  },
  uncommon: {
    voteCoinMult: 2, questSlots: 4, ivChecker: true, megaChamberDiscount: 0.1, moveCostDiscount: 0.5, quickHands: 0.1,
    dailyTokens: 6, dailyCoins: 30000, releaseLocks: 5,
  },
  rare: {
    questSlots: 5, questRefreshMultiplier: 0.5, fishingBoost: 0.05, eggHatchSpeed: 0.15, autoEquipEggs: true, incenseBonus: 50,
    releaseLocks: 5, marketListingSlots: 5,
    dailyTokens: 15, dailyCoins: 75000,
    monthly: { coins: 5000000, masterballs: 10, rare_candies: 100, eggs: 10, super_incubators: 3, Incense: 1 },
  },
  superRare: {
    shopDiscount: 0.1, megaChamberDiscount: 0.2, eggHatchSpeed: 0.3, incenseBonus: 100, releaseLocks: 5,
    dailyTokens: 38, dailyCoins: 200000,
  },
  legendary: {
    lootboxBoost: 0.1, shinyRatePct: 50, eventShinyPct: 30, incenseBonus: 150, releaseLocks: 5,
    marketListingSlots: 15,
    dailyTokens: 75, dailyCoins: 500000,
    monthly: {
      coins: 15000000, masterballs: 15, rare_candies: 150, eggs: 50, super_incubators: 10,
      incubators: 5, Incense: 10, Pokeradar: 10, patreon_tokens: 500,
      'Cooldown Machine': 50, 'Ability Capsule': 1, 'Ability Patch': 1,
    },
  },
  shiny: {
    shinyCharms: 1, amuletCoins: 4, incenseBonus: 300, megaChamberDiscount: 0.3,
    marketListingSlots: 5, releaseLocks: 10, marketTax: 0,
    dailyTokens: 150, dailyCoins: 1000000,
    monthly: {
      coins: 15000000, masterballs: 15, rare_candies: 150, eggs: 100, super_incubators: 25,
      incubators: 5, Incense: 10, Pokeradar: 10, patreon_tokens: 2000,
      'Cooldown Machine': 110, 'Ability Capsule': 3, 'Ability Patch': 2,
    },
  },
  golden: {
    goldenBoost: 0.25, incenseBonus: 500,
    dailyTokens: 500, dailyCoins: 3000000,
    monthly: {
      coins: 15000000, masterballs: 15, rare_candies: 150, eggs: 250, super_incubators: 75,
      incubators: 5, Incense: 10, Pokeradar: 10, 'Boss Coin': 1, patreon_tokens: 6000,
      'Cooldown Machine': 300, 'Ability Capsule': 10, 'Ability Patch': 5,
    },
  },
};
const PATREON_TIER_PERKS = (() => {
  const result = {};
  let acc = { ...NO_PATREON_PERKS };
  for (const key of PATREON_TIER_ORDER) {
    const delta = PATREON_TIER_DELTAS[key];
    acc = {
      ...acc,
      ...delta,
      dailyCoinMult: Math.max(acc.dailyCoinMult, delta.dailyCoinMult || 1),
      releaseLocks: acc.releaseLocks + (delta.releaseLocks || 0),
      marketListingSlots: acc.marketListingSlots + (delta.marketListingSlots || 0),
    };
    result[key] = Object.freeze({ ...acc });
  }
  return Object.freeze(result);
})();

const BASE_INCENSE_CHARGES = 100;

db.exec(`
  CREATE TABLE IF NOT EXISTS guild_incense (
    guild_id TEXT PRIMARY KEY,
    charges INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS guild_incense_contributors (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    amount INTEGER NOT NULL DEFAULT 0,
    charges INTEGER NOT NULL DEFAULT 0,
    last_used_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );
`);

function getIncenseCharges(guildId) {
  return db.prepare('SELECT charges FROM guild_incense WHERE guild_id = ?').get(guildId)?.charges || 0;
}

function recordIncenseContribution(guildId, userId, amount, charges) {
  db.prepare(`
    INSERT INTO guild_incense_contributors (guild_id, user_id, amount, charges, last_used_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      amount = amount + excluded.amount,
      charges = charges + excluded.charges,
      last_used_at = excluded.last_used_at
  `).run(guildId, userId, amount, charges, Date.now());
}

function getIncenseContributors(guildId) {
  const rows = db.prepare(
    'SELECT user_id, amount, charges, last_used_at FROM guild_incense_contributors WHERE guild_id = ?'
  ).all(guildId);
  return {
    recent: rows.reduce((latest, row) => (!latest || row.last_used_at > latest.last_used_at ? row : latest), null),
    top: rows.sort((a, b) => b.charges - a.charges || a.last_used_at - b.last_used_at).slice(0, 5),
  };
}

function addIncenseCharges(guildId, charges) {
  db.prepare(`
    INSERT INTO guild_incense (guild_id, charges) VALUES (?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET charges = charges + excluded.charges
  `).run(guildId, charges);
}

// Uses one shared server charge; returns false when none are left.
function consumeIncenseCharge(guildId) {
  if (!guildId) return false;
  return db.prepare(
    'UPDATE guild_incense SET charges = charges - 1 WHERE guild_id = ? AND charges > 0'
  ).run(guildId).changes > 0;
}

const BASE_POKERADAR_CHARGES = 30;
const BASE_DOUBLE_XP_CHARGES = 30;

function consumePokeradarCharge(userId) {
  if (!userId) return false;
  return db.prepare(
    'UPDATE users SET pokeradar_charges = pokeradar_charges - 1 WHERE id = ? AND pokeradar_charges > 0'
  ).run(userId).changes > 0;
}

function getPatreonPerks(userId) {
  return PATREON_TIER_PERKS[getUser(userId).patreon_tier] || NO_PATREON_PERKS;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS patreon_monthly_sent (
    user_id TEXT NOT NULL,
    month_key TEXT NOT NULL,
    PRIMARY KEY (user_id, month_key)
  );
`);

// Grants the tier's monthly bundle once per user per month_key (e.g. "2026-10").
function grantPatreonMonthly(userId, monthKey) {
  assertUserId(userId);
  return db.transaction(() => {
    const user = getUser(userId);
    const perks = PATREON_TIER_PERKS[user.patreon_tier];
    if (!perks?.monthly) return { error: 'no_tier' };
    const marked = db.prepare(
      'INSERT OR IGNORE INTO patreon_monthly_sent (user_id, month_key) VALUES (?, ?)'
    ).run(userId, monthKey);
    if (marked.changes === 0) return { error: 'already_sent' };
    const { coins, masterballs, rare_candies, eggs, ...rest } = perks.monthly;
    const increments = { coins, masterballs, rare_candies, vote_eggs: eggs };
    const items = [];
    for (const [name, amount] of Object.entries(rest)) {
      if (name === 'patreon_tokens') increments.patreon_tokens = amount;
      else if (name === 'super_incubators') items.push(['Super Incubator', amount]);
      else if (name === 'incubators') items.push(['Incubator', amount]);
      else items.push([name, amount]);
    }
    incrementUser(userId, increments);
    for (const [name, amount] of items) addUserItem(userId, name, amount);
    return { reward: perks.monthly };
  }).immediate();
}

function getPatreonUserIds() {
  return db.prepare('SELECT id FROM users WHERE patreon_tier IS NOT NULL').all().map((row) => row.id);
}
function getAmuletCoinBoost(userId) {
  const user = getUser(userId);
  const clan = getPlayerClan(userId);
  const owned = Math.max(0, user.amulet_coins || 0);
  const invisible = getClanPerkMultipliers(clan).amuletCoins + getPatreonPerks(userId).amuletCoins;
  const totalEffective = owned + invisible;

  return {
    owned,
    invisible,
    totalEffective,
    percentBoost: totalEffective * 5,
    multiplier: 1 + totalEffective * 0.05,
  };
}

function awardCoinsWithBoost(userId, baseAmount) {
  assertUserId(userId);
  if (!Number.isSafeInteger(baseAmount) || baseAmount < 0) {
    throw new TypeError('Coin reward must be a non-negative safe integer.');
  }

  const amuletBoost = getAmuletCoinBoost(userId);
  const finalAmount = Math.floor(baseAmount * amuletBoost.multiplier);
  if (!Number.isSafeInteger(finalAmount)) {
    throw new RangeError('Boosted coin reward exceeds the safe integer range.');
  }

  incrementUser(userId, { coins: finalAmount, pkc_earned: finalAmount });
  return { finalAmount, boostPercent: amuletBoost.percentBoost };
}

function processTopggVote(userId, timestamp = Date.now()) {
  assertUserId(userId);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new TypeError('Vote timestamp must be a non-negative safe integer.');
  }

  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new RangeError('Vote timestamp is outside the supported date range.');
  const voteDay = date.toISOString().slice(0, 10);
  const rewardVote = db.transaction(() => {
    const user = getUser(userId);
    if (user.last_vote_at > 0 && (
      timestamp <= user.last_vote_at || timestamp - user.last_vote_at < 60_000
    )) {
      return { duplicate: true };
    }

    const previousDay = user.last_vote_day;
    const previousDate = previousDay ? Date.parse(`${previousDay}T00:00:00.000Z`) : NaN;
    const currentDate = Date.parse(`${voteDay}T00:00:00.000Z`);
    const dayGap = Number.isFinite(previousDate)
      ? Math.round((currentDate - previousDate) / 86_400_000)
      : Infinity;
    const streak = dayGap === 0 ? user.vote_streak : dayGap === 1 ? user.vote_streak + 1 : 1;
    const isNewStreakDay = dayGap !== 0;
    const streakCoinBonus = streak >= 50 ? 2 : streak >= 10 ? 1 : 0;
    let milestoneCoinBonus = 0;
    const streakRewards = { rare_candies: 0, vote_eggs: 0, masterballs: 0, boxes: [] };

    if (isNewStreakDay && streak === 10) {
      streakRewards.rare_candies += 2;
      streakRewards.vote_eggs += 2;
      streakRewards.boxes.push('Legendary Box');
    } else if (isNewStreakDay && streak === 25) {
      milestoneCoinBonus = 2;
      streakRewards.masterballs += 1;
      streakRewards.boxes.push('Shiny Box');
    } else if (isNewStreakDay && streak === 50) {
      milestoneCoinBonus = 2;
      streakRewards.rare_candies += 2;
      streakRewards.vote_eggs += 2;
      streakRewards.masterballs += 1;
      streakRewards.boxes.push('Shiny Box', 'Legendary Box');
    }

    const isGlobalBonusDay = Number(voteDay.slice(-2)) <= 5;
    const baseVoteCoins = 1 + streakCoinBonus + milestoneCoinBonus;
    const voteCoins = baseVoteCoins * getPatreonPerks(userId).voteCoinMult + (isGlobalBonusDay ? 1 : 0);
    const rewards = {
      duplicate: false,
      streak,
      voteCoins,
      boxes: [...streakRewards.boxes],
      bonusBoxes: [],
      lootboxes: 0,
      rareCandies: streakRewards.rare_candies,
      eggs: streakRewards.vote_eggs,
      masterballs: streakRewards.masterballs,
      goldenRazzBerries: 0,
    };

    const bonusBoxRoll = Math.random();
    if (bonusBoxRoll < 0.5) rewards.bonusBoxes.push('Rare Box');
    else if (bonusBoxRoll < 0.7) rewards.bonusBoxes.push('Super Rare Box');
    else if (bonusBoxRoll < 0.5 + 1 / 5 + 1 / 12) rewards.bonusBoxes.push('Legendary Box');
    else if (bonusBoxRoll < 0.5 + 1 / 5 + 1 / 12 + 1 / 30) rewards.bonusBoxes.push('Shiny Box');

    if (Math.random() < 0.2) rewards.lootboxes = 1;
    if (Math.random() < 0.2) rewards.goldenRazzBerries = 1;

    for (const boxName of rewards.boxes) addUserItem(userId, boxName);
    for (const boxName of rewards.bonusBoxes) addUserItem(userId, boxName);

    incrementUser(userId, {
      votes_claimed: 1,
      vote_coins: voteCoins,
      lootboxes: rewards.lootboxes,
      rare_candies: rewards.rareCandies,
      vote_eggs: rewards.eggs,
      masterballs: rewards.masterballs,
      grazz_berries: rewards.goldenRazzBerries,
    });
    updateUser(userId, {
      vote_streak: streak,
      highest_vote_streak: Math.max(user.highest_vote_streak, streak),
      last_vote_at: timestamp,
      last_vote_day: voteDay,
    });
    return rewards;
  });

  return rewardVote.immediate(userId, timestamp);
}

function openVoteBox(userId, boxName, amount = 1) {
  assertUserId(userId);
  const box = VOTE_BOXES[boxName];
  if (!box) throw new TypeError(`Unknown Vote Box: ${boxName}.`);
  if (!Number.isSafeInteger(amount) || amount < 1) {
    throw new TypeError('Vote Box amount must be a positive safe integer.');
  }

  return db.transaction(() => {
    const owned = getUserItems(userId).find((item) => item.item_name === boxName)?.amount || 0;
    if (owned < amount) return { error: 'insufficient', owned };
    if (!takeUserItem(userId, boxName, amount)) return { error: 'insufficient', owned };

    const rewards = {
      voteCoins: amount,
      pokecoins: 0,
      rareCandies: 0,
      eggs: 0,
      masterballs: 0,
    };
    const randomInt = (minimum, maximum) =>
      Math.floor(Math.random() * (maximum - minimum + 1)) + minimum;
    for (let index = 0; index < amount; index += 1) {
      rewards.pokecoins += randomInt(...box.coins);
      if (Math.random() < box.rareCandies[0]) {
        rewards.rareCandies += randomInt(box.rareCandies[1], box.rareCandies[2]);
      }
      if (Math.random() < box.eggs[0]) {
        rewards.eggs += randomInt(box.eggs[1], box.eggs[2]);
      }
      if (Math.random() < box.masterballs[0]) rewards.masterballs += 1;
    }
    incrementUser(userId, {
      vote_coins: rewards.voteCoins,
      rare_candies: rewards.rareCandies,
      vote_eggs: rewards.eggs,
      masterballs: rewards.masterballs,
    });
    rewards.awardedPokecoins = awardCoinsWithBoost(userId, rewards.pokecoins).finalAmount;
    return rewards;
  }).immediate();
}

function getCatchbotData(userId) {
  assertUserId(userId);
  getUser(userId);
  db.prepare('INSERT OR IGNORE INTO catchbot_data (user_id) VALUES (?)').run(userId);
  return db.prepare('SELECT * FROM catchbot_data WHERE user_id = ?').get(userId);
}

function upgradeCatchbot(userId, statName) {
  assertUserId(userId);
  const config = CB_CONFIG[statName];
  if (!config) return { error: 'invalid_stat' };
  return db.transaction(() => {
    const data = getCatchbotData(userId);
    const user = getUser(userId);
    if (data.running_until || user.catchbot_end) return { error: 'run_unclaimed' };
    const currentLevel = data[`${statName}_lvl`];
    if (currentLevel >= config.maxLvl) return { error: 'max_level', level: currentLevel };
    const cost = config.costForLvl(currentLevel);
    if (user.coins < cost) return { error: 'insufficient_coins', cost, coins: user.coins };
    incrementUser(userId, { coins: -cost });
    db.prepare(`
      UPDATE catchbot_data
      SET ${statName}_lvl = ${statName}_lvl + 1,
          spent_upgrades = spent_upgrades + ?
      WHERE user_id = ?
    `).run(cost, userId);
    return { level: currentLevel + 1, cost };
  }).immediate();
}

function startCatchbotRun(userId, hours, now = Date.now()) {
  assertUserId(userId);
  if (!Number.isSafeInteger(hours) || hours < 1 || hours > CB_CONFIG.duration.maxLvl + 1
      || !Number.isSafeInteger(now) || now < 0) {
    throw new TypeError('CatchBot run duration or start time is invalid.');
  }
  return db.transaction(() => {
    const data = getCatchbotData(userId);
    const user = getUser(userId);
    if (data.running_until || user.catchbot_end) {
      return {
        error: data.running_until > now || user.catchbot_end > now ? 'already_running' : 'run_unclaimed',
        runningUntil: Math.max(data.running_until, user.catchbot_end),
      };
    }
    const maxDuration = CB_CONFIG.duration.getStat(data.duration_lvl);
    if (hours > maxDuration) return { error: 'duration_too_long', maxDuration };
    const pokemonPerHour = CB_CONFIG.pokemon.getStat(data.pokemon_lvl);
    const costPerPokemon = CB_CONFIG.cost.getStat(data.cost_lvl);
    const totalPokemon = pokemonPerHour * hours;
    const totalCost = totalPokemon * costPerPokemon;
    if (user.coins < totalCost) return { error: 'insufficient_coins', totalCost, coins: user.coins };
    const runningUntil = now + hours * 60 * 60 * 1000;
    if (!Number.isSafeInteger(runningUntil)) throw new RangeError('CatchBot run end time is out of range.');
    incrementUser(userId, { coins: -totalCost, catchbot_runs: 1 });
    trackClanActivity(userId, 'catchbot');
    db.prepare(`
      UPDATE catchbot_data
      SET running_until = ?, hours_running = ?, completion_notified_until = 0
      WHERE user_id = ?
    `).run(runningUntil, hours, userId);
    updateUser(userId, { catchbot_end: runningUntil });
    return { hours, pokemonPerHour, totalPokemon, costPerPokemon, totalCost, runningUntil };
  }).immediate();
}

function claimCatchbotRun(userId, now = Date.now()) {
  assertUserId(userId);
  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError('Claim time is invalid.');
  return db.transaction(() => {
    const data = getCatchbotData(userId);
    if (!data.running_until) return { error: 'no_run' };
    if (now < data.running_until) {
      return { error: 'still_running', runningUntil: data.running_until };
    }
    const claimed = db.prepare(`
      UPDATE catchbot_data
      SET running_until = 0, hours_running = 0
      WHERE user_id = ? AND running_until = ?
    `).run(userId, data.running_until);
    if (!claimed.changes) return { error: 'no_run' };
    updateUser(userId, { catchbot_end: 0 });
    return {
      hours: data.hours_running,
      pokemonPerHour: CB_CONFIG.pokemon.getStat(data.pokemon_lvl),
      costPerPokemon: CB_CONFIG.cost.getStat(data.cost_lvl),
      luckPercent: CB_CONFIG.luck.getStat(data.luck_lvl),
    };
  }).immediate();
}

function recordCatchbotResults(userId, counts) {
  assertUserId(userId);
  const columns = {
    c: 'c_caught',
    u: 'u_caught',
    r: 'r_caught',
    sr: 'sr_caught',
    l: 'l_caught',
    s: 's_caught',
    g: 'g_caught',
    golden: 'golden_caught',
  };
  for (const key of Object.keys(columns)) {
    if (!Number.isSafeInteger(counts[key]) || counts[key] < 0) {
      throw new TypeError(`CatchBot result count "${key}" must be a non-negative integer.`);
    }
  }
  const assignments = Object.values(columns)
    .map((column) => `${column} = ${column} + ?`)
    .join(', ');
  db.prepare(`UPDATE catchbot_data SET ${assignments} WHERE user_id = ?`)
    .run(...Object.keys(columns).map((key) => counts[key]), userId);
}

const questTemplatesPath = path.join(__dirname, 'data', 'quest-templates.json');
const screenshotQuestTemplatesPath = path.join(__dirname, 'data', 'screenshot-quest-templates.json');
const QUEST_TEMPLATES = [
  ...JSON.parse(fs.readFileSync(questTemplatesPath, 'utf8')),
  ...JSON.parse(fs.readFileSync(screenshotQuestTemplatesPath, 'utf8')),
];
const FUN_ITEM_NAMES = ['Candy', 'Lollipop', 'Chocolate Bar', 'Broccoli', 'Cupcake', 'Gingerbread', 'Candy Cane', 'Sitrus Berry'];

// Migrate the old "Gingerbread Cookie" name for existing users and quests.
db.exec(`
  INSERT INTO user_items (user_id, item_name, amount)
    SELECT user_id, 'Gingerbread', amount FROM user_items WHERE item_name = 'Gingerbread Cookie'
    ON CONFLICT(user_id, item_name) DO UPDATE SET amount = amount + excluded.amount;
  DELETE FROM user_items WHERE item_name = 'Gingerbread Cookie';
  UPDATE active_quests SET target_type = REPLACE(target_type, 'Gingerbread Cookie', 'Gingerbread')
    WHERE target_type LIKE '%Gingerbread Cookie%';
`);

const QUEST_REROLL_COST = 2500;
const QUEST_SLOTS = 3;
const QUEST_REFRESH_WAIT_MS = 2 * 60 * 60 * 1000;
const QUEST_EXTRA_REWARDS = ['reward_masterballs', 'reward_ultraballs', 'reward_grazz', 'reward_items'];
const QUEST_REWARD_ITEM_FIELDS = {
  Pokeball: 'pokeballs',
  Greatball: 'greatballs',
  Ultraball: 'ultraballs',
  Premierball: 'premierballs',
  Diveball: 'diveballs',
  Masterball: 'masterballs',
  Lootbox: 'lootboxes',
  Repel: 'repels',
  'Rare Candy': 'rare_candies',
  'Golden Razz': 'grazz_berries',
  'Fishing Token': 'fishing_tokens',
};
const QUEST_ITEM_NAMES = new Set([
  ...Object.keys(QUEST_REWARD_ITEM_FIELDS),
  ...Object.keys(EVOLUTION_ITEMS),
  'Ancient Fossil',
  'Super Repel',
  'Max Repel',
  'Honey',
  'Max Potion',
  ...FUN_ITEM_NAMES,
  ...QUEST_TEMPLATES.flatMap((template) => [
    ...Object.keys(template.reward_items || {}),
    ...(template.quest_type === 'collect_item'
      ? [template.target_type]
      : template.quest_type === 'collect_item_any'
        ? template.target_type.split('|').map((item) => item.trim())
        : []),
  ]),
]);
let suppressQuestItemTracking = false;

function writeQuestTemplate(questId, template) {
  db.prepare(`
    UPDATE active_quests
    SET quest_type = ?, target_type = ?, progress = 0, target = ?,
      reward_coins = ?, reward_candies = ?, reward_lootboxes = ?,
      reward_masterballs = ?, reward_ultraballs = ?, reward_grazz = ?, reward_items = ?,
      refresh_at = 0
    WHERE id = ?
  `).run(
    template.quest_type,
    template.target_type,
    template.target,
    template.reward_coins,
    template.reward_candies,
    template.reward_lootboxes,
    template.reward_masterballs,
    template.reward_ultraballs,
    template.reward_grazz,
    JSON.stringify(template.reward_items || {}),
    questId
  );
}
if (!Array.isArray(QUEST_TEMPLATES) || QUEST_TEMPLATES.length === 0) {
  throw new Error(`Quest template database at ${questTemplatesPath} must be a non-empty array.`);
}
for (const template of QUEST_TEMPLATES) {
  template.reward_candies ??= 0;
  template.reward_lootboxes ??= 0;
  for (const field of QUEST_EXTRA_REWARDS) {
    if (field !== 'reward_items') template[field] ??= 0;
  }
  template.reward_items ??= {};
}
for (const [index, template] of QUEST_TEMPLATES.entries()) {
  if (![
    'encounter_type',
    'encounter_amount',
    'catch_rarity',
    'catch_amount',
    'catch_type',
    'fish_amount',
    'fishing_condition',
    'battle_wins',
    'battle_category',
    'battle_tower_floors',
    'collect_item',
    'collect_item_any',
  ].includes(template.quest_type)
      || typeof template.target_type !== 'string' || !template.target_type.trim()
      || !Number.isSafeInteger(template.target) || template.target <= 0
      || !Number.isSafeInteger(template.reward_coins) || template.reward_coins < 0
      || !Number.isSafeInteger(template.reward_candies) || template.reward_candies < 0
      || !Number.isSafeInteger(template.reward_lootboxes) || template.reward_lootboxes < 0
      || QUEST_EXTRA_REWARDS.some((field) =>
        field !== 'reward_items'
        && (!Number.isSafeInteger(template[field]) || template[field] < 0))
      || !template.reward_items || typeof template.reward_items !== 'object'
      || Array.isArray(template.reward_items)
      || Object.entries(template.reward_items).some(([name, amount]) =>
        !name.trim() || !Number.isSafeInteger(amount) || amount <= 0)) {
    throw new Error(`Invalid quest template at index ${index} in ${screenshotQuestTemplatesPath}.`);
  }
  if (template.quest_type === 'catch_rarity'
      && !['Common', 'Uncommon', 'Rare', 'Super Rare', 'Legendary', 'Shiny',
        'Mega', 'Shiny Mega', 'Gmax', 'Shiny Gmax']
        .some((rarity) => rarity.toLowerCase() === template.target_type.toLowerCase())) {
    throw new Error(`Invalid rarity target for quest template at index ${index} in ${questTemplatesPath}.`);
  }
}

function addRandomEvolutionReward(template) {
  const rewardItems = { ...(template.reward_items || {}) };
  if (Math.random() < 0.2) {
    const evolutionItems = Object.keys(EVOLUTION_ITEMS);
    const reward = evolutionItems[Math.floor(Math.random() * evolutionItems.length)];
    rewardItems[reward] = (rewardItems[reward] || 0) + 1;
  }
  return { ...template, reward_items: rewardItems };
}

const questEvolutionRewardMigrationKey = 'quest_evolution_rewards_v1';
db.transaction(() => {
  if (db.prepare('SELECT 1 FROM bot_settings WHERE key = ?').get(questEvolutionRewardMigrationKey)) {
    return;
  }
  const activeQuests = db.prepare(
    'SELECT id, reward_items FROM active_quests WHERE refresh_at = 0'
  ).all();
  const updateRewards = db.prepare('UPDATE active_quests SET reward_items = ? WHERE id = ?');
  for (const quest of activeQuests) {
    const updated = addRandomEvolutionReward({
      reward_items: JSON.parse(quest.reward_items || '{}'),
    });
    updateRewards.run(JSON.stringify(updated.reward_items), quest.id);
  }
  db.prepare('INSERT INTO bot_settings (key, value) VALUES (?, ?)').run(
    questEvolutionRewardMigrationKey,
    'done'
  );
}).immediate();

const MAX_QUEST_SLOTS = 5;

function getUserQuestSlots(userId) {
  const patreonSlots = (PATREON_TIER_PERKS[getUser(userId).patreon_tier] || NO_PATREON_PERKS).questSlots;
  const clanSlots = getClanPerkMultipliers(getPlayerClan(userId)).questSlotBonus;
  return Math.min(MAX_QUEST_SLOTS, patreonSlots + clanSlots);
}

function getUserQuestRefreshWait(userId) {
  return Math.round(QUEST_REFRESH_WAIT_MS * getPatreonPerks(userId).questRefreshMultiplier);
}

// Only slots within the user's current tier allowance are returned, so a lapsed
// Patreon keeps their extra quests stored but cannot see or progress them.
function ensureUserQuests(userId) {
  getUser(userId);
  const allowedSlots = getUserQuestSlots(userId);
  const quests = db.prepare(
    'SELECT * FROM active_quests WHERE user_id = ? ORDER BY slot'
  ).all(userId);
  const existingSlots = new Set(quests.map((quest) => quest.slot));
  const now = Date.now();
  for (const quest of quests) {
    if (quest.refresh_at > 0 && quest.refresh_at <= now) {
      const fresh = QUEST_TEMPLATES[Math.floor(Math.random() * QUEST_TEMPLATES.length)];
      writeQuestTemplate(quest.id, addRandomEvolutionReward(fresh));
    }
  }
  for (let slot = 1; slot <= allowedSlots; slot += 1) {
    if (existingSlots.has(slot)) continue;
    const template = QUEST_TEMPLATES[(slot - 1) % QUEST_TEMPLATES.length];
    const inserted = db.prepare(`
      INSERT INTO active_quests (
        user_id, slot, quest_type, target_type, progress, target,
        reward_coins, reward_candies, reward_lootboxes
      )
      VALUES (?, ?, ?, ?, 0, ?, 0, 0, 0)
    `).run(userId, slot, template.quest_type, template.target_type, template.target);
    writeQuestTemplate(inserted.lastInsertRowid, addRandomEvolutionReward(template));
  }
  return db.prepare(
    'SELECT * FROM active_quests WHERE user_id = ? AND slot <= ? ORDER BY slot'
  ).all(userId, allowedSlots);
}

function getUserQuests(userId) {
  assertUserId(userId);
  return db.transaction(() => ensureUserQuests(userId)).immediate();
}

function rerollUserQuest(userId, slot) {
  assertUserId(userId);
  if (!Number.isSafeInteger(slot) || slot < 1) {
    throw new TypeError('Quest slot must be a positive integer.');
  }

  return db.transaction(() => {
    const quests = ensureUserQuests(userId);
    const quest = quests.find((entry) => entry.slot === slot);
    if (!quest) return { error: 'quest_not_found' };

    const user = getUser(userId);
    const useScroll = user.quest_reset_scrolls > 0;
    if (!useScroll && user.coins < QUEST_REROLL_COST) {
      return { error: 'insufficient_coins', coins: user.coins };
    }

    const alternatives = QUEST_TEMPLATES.filter((template) =>
      template.quest_type !== quest.quest_type
      || template.target_type !== quest.target_type
      || template.target !== quest.target
      || template.reward_coins !== quest.reward_coins
      || template.reward_candies !== quest.reward_candies
      || template.reward_lootboxes !== quest.reward_lootboxes
      || JSON.stringify(template.reward_items || {}) !== quest.reward_items
      || QUEST_EXTRA_REWARDS.some((field) =>
        field !== 'reward_items' && template[field] !== quest[field])
    );
    const pool = alternatives.length > 0 ? alternatives : QUEST_TEMPLATES;
    const fresh = pool[Math.floor(Math.random() * pool.length)];
    if (useScroll) incrementUser(userId, { quest_reset_scrolls: -1 });
    else incrementUser(userId, { coins: -QUEST_REROLL_COST });
    writeQuestTemplate(quest.id, addRandomEvolutionReward(fresh));
    return {
      quest: db.prepare('SELECT * FROM active_quests WHERE id = ?').get(quest.id),
      cost: useScroll ? 0 : QUEST_REROLL_COST,
      usedScroll: useScroll,
    };
  }).immediate();
}

function advanceQuestProgress(userId, event = {}) {
  assertUserId(userId);
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new TypeError('Quest progress event must be an object.');
  }
  for (const field of ['encounterTypes', 'fishingConditions', 'battleCategories']) {
    if (event[field] !== undefined && !Array.isArray(event[field])) {
      throw new TypeError(`Quest progress ${field} must be an array.`);
    }
  }
  const types = (Array.isArray(event.encounterTypes) ? event.encounterTypes : [])
    .filter((type) => typeof type === 'string' && type.trim())
    .map((type) => type.trim().toLowerCase());
  const catches = event.catches ?? 0;
  const fishes = event.fishes ?? 0;
  const battleWins = event.battleWins ?? 0;
  const encounters = event.encounters ?? 0;
  const battleTowerFloors = event.battleTowerFloors ?? 0;
  const rarityCounts = event.rarityCounts ?? {};
  const typeCounts = event.typeCounts ?? {};
  const fishingConditions = new Set((event.fishingConditions || [])
    .filter((condition) => typeof condition === 'string')
    .map((condition) => condition.trim().toLowerCase()));
  const battleCategories = new Set((event.battleCategories || [])
    .filter((category) => typeof category === 'string')
    .map((category) => category.trim().toLowerCase()));
  const itemCounts = event.itemCounts ?? {};
  for (const [name, count] of Object.entries({
    catches, fishes, battleWins, encounters, battleTowerFloors,
  })) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new TypeError(`Quest progress ${name} must be a non-negative integer.`);
    }
  }
  if (!rarityCounts || typeof rarityCounts !== 'object' || Array.isArray(rarityCounts)
      || !typeCounts || typeof typeCounts !== 'object' || Array.isArray(typeCounts)
      || !itemCounts || typeof itemCounts !== 'object' || Array.isArray(itemCounts)) {
    throw new TypeError('Quest rarity, type, and item counts must be objects.');
  }
  const normalizedRarityCounts = new Map();
  for (const [rarity, count] of Object.entries(rarityCounts)) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new TypeError(`Quest rarity count for "${rarity}" must be a non-negative integer.`);
    }
    normalizedRarityCounts.set(rarity.trim().toLowerCase(), count);
  }
  const normalizedTypeCounts = new Map();
  for (const [type, count] of Object.entries(typeCounts)) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new TypeError(`Quest type count for "${type}" must be a non-negative integer.`);
    }
    normalizedTypeCounts.set(type.trim().toLowerCase(), count);
  }
  const normalizedItemCounts = new Map();
  for (const [item, count] of Object.entries(itemCounts)) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new TypeError(`Quest item count for "${item}" must be a non-negative integer.`);
    }
    normalizedItemCounts.set(item.trim().toLowerCase(), count);
  }
  if (types.length === 0 && fishingConditions.size === 0 && battleCategories.size === 0
      && catches === 0 && fishes === 0 && battleWins === 0 && encounters === 0
      && battleTowerFloors === 0 && normalizedRarityCounts.size === 0
      && normalizedTypeCounts.size === 0 && normalizedItemCounts.size === 0) {
    return [];
  }

  return db.transaction(() => {
    const quests = ensureUserQuests(userId);
    const completed = [];
    for (const quest of quests) {
      if (quest.refresh_at > 0) continue;
      let amount = 0;
      if (quest.quest_type === 'encounter_amount') amount = encounters;
      else if (quest.quest_type === 'encounter_type'
          && types.includes(quest.target_type.toLowerCase())) amount = 1;
      else if (quest.quest_type === 'catch_rarity') {
        amount = normalizedRarityCounts.get(quest.target_type.toLowerCase()) || 0;
      } else if (quest.quest_type === 'catch_type') {
        amount = normalizedTypeCounts.get(quest.target_type.toLowerCase()) || 0;
      } else if (quest.quest_type === 'catch_amount') amount = catches;
      else if (quest.quest_type === 'fish_amount') amount = fishes;
      else if (quest.quest_type === 'fishing_condition'
          && fishingConditions.has(quest.target_type.toLowerCase())) amount = fishes;
      else if (quest.quest_type === 'battle_wins') amount = battleWins;
      else if (quest.quest_type === 'battle_category'
          && battleCategories.has(quest.target_type.toLowerCase())) amount = 1;
      else if (quest.quest_type === 'battle_tower_floors') amount = battleTowerFloors;
      else if (quest.quest_type === 'collect_item') {
        amount = normalizedItemCounts.get(quest.target_type.toLowerCase()) || 0;
      } else if (quest.quest_type === 'collect_item_any') {
        amount = quest.target_type.split('|').reduce(
          (total, item) => total + (normalizedItemCounts.get(item.trim().toLowerCase()) || 0),
          0
        );
      }
      if (amount === 0) continue;

      const progress = quest.progress + amount;
      if (progress < quest.target) {
        db.prepare('UPDATE active_quests SET progress = ? WHERE id = ?')
          .run(progress, quest.id);
        continue;
      }

      const rewardCoins = awardCoinsWithBoost(userId, quest.reward_coins).finalAmount;
      const refreshAt = Date.now() + getUserQuestRefreshWait(userId);
      incrementUser(userId, {
        rare_candies: quest.reward_candies,
        lootboxes: quest.reward_lootboxes,
        masterballs: quest.reward_masterballs,
        ultraballs: quest.reward_ultraballs,
        grazz_berries: quest.reward_grazz,
        quests_completed: 1,
      });
      const rewardItems = JSON.parse(quest.reward_items || '{}');
      suppressQuestItemTracking = true;
      try {
        for (const [itemName, quantity] of Object.entries(rewardItems)) {
          const userField = QUEST_REWARD_ITEM_FIELDS[itemName];
          if (userField) incrementUser(userId, { [userField]: quantity });
          else addUserItem(userId, itemName, quantity);
        }
      } finally {
        suppressQuestItemTracking = false;
      }
      db.prepare('UPDATE active_quests SET progress = target, refresh_at = ? WHERE id = ?')
        .run(refreshAt, quest.id);
      completed.push({
        slot: quest.slot,
        refresh_at: refreshAt,
        reward_coins: rewardCoins,
        reward_candies: quest.reward_candies,
        reward_lootboxes: quest.reward_lootboxes,
        reward_masterballs: quest.reward_masterballs,
        reward_ultraballs: quest.reward_ultraballs,
        reward_grazz: quest.reward_grazz,
        reward_items: rewardItems,
      });
    }
    return completed;
  }).immediate();
}

const SHINY_STAT_MULTIPLIER = 1.05;

// Remembers a trainer's per-species stats after their last copy is traded away, so the next copy keeps them.
db.exec(`
  CREATE TABLE IF NOT EXISTS user_pokemon_state_snapshots (
    user_id TEXT NOT NULL,
    pokemon_id INTEGER NOT NULL,
    is_shiny INTEGER NOT NULL DEFAULT 0,
    is_golden INTEGER NOT NULL DEFAULT 0,
    experience INTEGER NOT NULL DEFAULT 0,
    level INTEGER NOT NULL DEFAULT 1,
    hp_iv INTEGER NOT NULL DEFAULT 0,
    atk_iv INTEGER NOT NULL DEFAULT 0,
    def_iv INTEGER NOT NULL DEFAULT 0,
    spd_iv INTEGER NOT NULL DEFAULT 0,
    friendship INTEGER NOT NULL DEFAULT 0,
    moves TEXT,
    sketched_moves TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY (user_id, pokemon_id, is_shiny, is_golden)
  );
`);
ensureColumns('user_pokemon_state_snapshots', {
  spa_iv: 'INTEGER NOT NULL DEFAULT 0',
  spdef_iv: 'INTEGER NOT NULL DEFAULT 0',
  ev_hp: 'INTEGER NOT NULL DEFAULT 0',
  ev_atk: 'INTEGER NOT NULL DEFAULT 0',
  ev_def: 'INTEGER NOT NULL DEFAULT 0',
  ev_spa: 'INTEGER NOT NULL DEFAULT 0',
  ev_spdef: 'INTEGER NOT NULL DEFAULT 0',
  ev_spe: 'INTEGER NOT NULL DEFAULT 0',
});
const SNAPSHOT_COLUMNS = 'user_id, pokemon_id, is_shiny, is_golden, experience, level, '
  + 'hp_iv, atk_iv, def_iv, spa_iv, spdef_iv, spd_iv, friendship, moves, sketched_moves, '
  + 'ev_hp, ev_atk, ev_def, ev_spa, ev_spdef, ev_spe';
const SNAPSHOT_OLD_VALUES = SNAPSHOT_COLUMNS.split(', ').map((column) => `OLD.${column}`).join(', ');
db.exec(`
  DROP TRIGGER IF EXISTS catches_snapshot_before_transfer;
  DROP TRIGGER IF EXISTS catches_snapshot_before_delete;
  CREATE TRIGGER catches_snapshot_before_transfer
  BEFORE UPDATE OF user_id ON catches
  WHEN OLD.user_id != NEW.user_id
  BEGIN
    INSERT OR REPLACE INTO user_pokemon_state_snapshots (${SNAPSHOT_COLUMNS})
    VALUES (${SNAPSHOT_OLD_VALUES});
  END;
  CREATE TRIGGER catches_snapshot_before_delete
  BEFORE DELETE ON catches
  BEGIN
    INSERT OR REPLACE INTO user_pokemon_state_snapshots (${SNAPSHOT_COLUMNS})
    VALUES (${SNAPSHOT_OLD_VALUES});
  END;
`);

function saveCatchStateSnapshot(userId, catchId) {
  db.prepare(`
    INSERT OR REPLACE INTO user_pokemon_state_snapshots (${SNAPSHOT_COLUMNS})
    SELECT ${SNAPSHOT_COLUMNS}
    FROM catches WHERE id = ? AND user_id = ?
  `).run(catchId, userId);
}

function getCatchStateSnapshot(userId, pokemon) {
  return db.prepare(`
    SELECT * FROM user_pokemon_state_snapshots
    WHERE user_id = ? AND pokemon_id = ? AND is_shiny = ? AND is_golden = ?
  `).get(userId, pokemon.pokemon_id, pokemon.is_shiny, pokemon.is_golden);
}

const EV_STATS = ['hp', 'atk', 'def', 'spa', 'spdef', 'spe'];
const EV_TOTAL_LIMIT = 510;
const EV_STAT_LIMIT = 252;
const EV_PER_BATTLE = 9;
const POWER_ITEM_EV_BONUS = 8;

function calculateStat(base, iv, level, isHp = false, isShiny = false, ev = 0) {
  const points = 2 * base + iv + Math.floor((ev || 0) / 4);
  const stat = isHp
    ? Math.floor((points * level) / 100) + level + 10
    : Math.floor((points * level) / 100) + 5;
  return isShiny ? Math.floor(stat * SHINY_STAT_MULTIPLIER) : stat;
}

const DUPLICATE_CATCH_STATE_FIELDS = [
  'experience',
  'level',
  'hp_iv',
  'atk_iv',
  'def_iv',
  'spa_iv',
  'spdef_iv',
  'spd_iv',
  'ev_hp',
  'ev_atk',
  'ev_def',
  'ev_spa',
  'ev_spdef',
  'ev_spe',
  'hp',
  'max_hp',
  'atk',
  'def',
  'spd',
  'moves',
  'sketched_moves',
  'friendship',
];

function syncDuplicateCatchState(userId, catchId) {
  assertUserId(userId);
  if (!Number.isSafeInteger(catchId) || catchId <= 0) {
    throw new TypeError('catchId must be a positive safe integer.');
  }
  const source = db.prepare(`
    SELECT pokemon_id, is_shiny, is_golden, ${DUPLICATE_CATCH_STATE_FIELDS.join(', ')}
    FROM catches
    WHERE id = ? AND user_id = ?
  `).get(catchId, userId);
  if (!source) return false;
  // Sketched moves are permanent: merge them across copies so no sync source can erase them.
  const sketchedUnion = new Set();
  for (const row of db.prepare(`
    SELECT sketched_moves FROM catches
    WHERE user_id = ? AND pokemon_id = ? AND is_shiny = ? AND is_golden = ?
  `).all(userId, source.pokemon_id, source.is_shiny, source.is_golden)) {
    for (const move of parseSketchedMoves(row.sketched_moves)) sketchedUnion.add(move);
  }
  source.sketched_moves = JSON.stringify([...new Set([
    ...parseSketchedMoves(source.sketched_moves),
    ...sketchedUnion,
  ])]);
  const assignments = DUPLICATE_CATCH_STATE_FIELDS.map((field) => `${field} = ?`).join(', ');
  db.prepare(`
    UPDATE catches
    SET ${assignments}
    WHERE user_id = ? AND pokemon_id = ? AND is_shiny = ? AND is_golden = ?
  `).run(
    ...DUPLICATE_CATCH_STATE_FIELDS.map((field) => source[field]),
    userId,
    source.pokemon_id,
    source.is_shiny,
    source.is_golden
  );
  return true;
}

function syncNewCatchState(userId, catchId) {
  assertUserId(userId);
  if (!Number.isSafeInteger(catchId) || catchId <= 0) {
    throw new TypeError('catchId must be a positive safe integer.');
  }
  const identity = db.prepare(`
    SELECT pokemon_id, is_shiny, is_golden
    FROM catches
    WHERE id = ? AND user_id = ?
  `).get(catchId, userId);
  if (!identity) return false;
  const matchesIdentity = (pokemon) => pokemon
    && pokemon.pokemon_id === identity.pokemon_id
    && pokemon.is_shiny === identity.is_shiny
    && pokemon.is_golden === identity.is_golden;
  const buddyCatchId = getUser(userId).buddy_catch_id;
  const buddy = buddyCatchId
    ? db.prepare('SELECT id, pokemon_id, is_shiny, is_golden FROM catches WHERE id = ? AND user_id = ?')
      .get(buddyCatchId, userId)
    : null;
  const firstCopy = db.prepare(`
    SELECT id, pokemon_id, is_shiny, is_golden
    FROM catches
    WHERE user_id = ? AND pokemon_id = ? AND is_shiny = ? AND is_golden = ? AND id != ?
    ORDER BY id
    LIMIT 1
  `).get(userId, identity.pokemon_id, identity.is_shiny, identity.is_golden, catchId);
  if (!firstCopy && !matchesIdentity(buddy) && getCatchStateSnapshot(userId, identity)) {
    return rebaseTransferredPokemon(userId, catchId);
  }
  const sourceId = matchesIdentity(buddy)
    ? buddy.id
    : firstCopy?.id || catchId;
  return syncDuplicateCatchState(userId, sourceId);
}

function rebaseTransferredPokemon(userId, catchId) {
  assertUserId(userId);
  if (!Number.isSafeInteger(catchId) || catchId <= 0) {
    throw new TypeError('catchId must be a positive safe integer.');
  }
  const pokemon = db.prepare(`
    SELECT catches.*, pokemon_forms.species_id, pokemon_forms.base_hp,
      pokemon_forms.base_atk, pokemon_forms.base_def, pokemon_forms.base_spd
    FROM catches
    JOIN pokemon_forms ON pokemon_forms.id = catches.pokemon_id
    WHERE catches.id = ? AND catches.user_id = ?
  `).get(catchId, userId);
  if (!pokemon) return false;

  const recipientPokemon = db.prepare(`
    SELECT catches.level, catches.experience
    FROM catches
    JOIN pokemon_forms ON pokemon_forms.id = catches.pokemon_id
    WHERE catches.user_id = ? AND catches.id != ? AND pokemon_forms.species_id = ?
    ORDER BY catches.level DESC, catches.experience DESC, catches.id
    LIMIT 1
  `).get(userId, catchId, pokemon.species_id);
  const recipientCopy = db.prepare(`
    SELECT hp_iv, atk_iv, def_iv, spa_iv, spdef_iv, spd_iv, level, experience, friendship,
      ev_hp, ev_atk, ev_def, ev_spa, ev_spdef, ev_spe
    FROM catches
    WHERE user_id = ? AND id != ? AND pokemon_id = ? AND is_shiny = ? AND is_golden = ?
    ORDER BY id
    LIMIT 1
  `).get(userId, catchId, pokemon.pokemon_id, pokemon.is_shiny, pokemon.is_golden);
  const snapshot = recipientCopy ? null : getCatchStateSnapshot(userId, pokemon);
  const evSource = recipientCopy || snapshot || {};
  const evs = Object.fromEntries(EV_STATS.map((stat) => [stat, evSource[`ev_${stat}`] ?? 0]));
  const level = recipientCopy?.level ?? snapshot?.level ?? recipientPokemon?.level ?? 1;
  const experience = recipientCopy?.experience ?? snapshot?.experience ?? recipientPokemon?.experience ?? 0;
  const friendship = recipientCopy?.friendship ?? snapshot?.friendship ?? 0;
  const hpIv = recipientCopy?.hp_iv ?? snapshot?.hp_iv ?? Math.floor(Math.random() * 32);
  const atkIv = recipientCopy?.atk_iv ?? snapshot?.atk_iv ?? Math.floor(Math.random() * 32);
  const defIv = recipientCopy?.def_iv ?? snapshot?.def_iv ?? Math.floor(Math.random() * 32);
  const spaIv = atkIv;
  const spdefIv = defIv;
  const spdIv = recipientCopy?.spd_iv ?? snapshot?.spd_iv ?? Math.floor(Math.random() * 32);
  const maxHp = calculateStat(
    pokemon.base_hp ?? 50, hpIv, level, true, Boolean(pokemon.is_shiny), evs.hp
  );
  const atk = calculateStat(
    pokemon.base_atk ?? 50, atkIv, level, false, Boolean(pokemon.is_shiny), evs.atk
  );
  const def = calculateStat(
    pokemon.base_def ?? 50, defIv, level, false, Boolean(pokemon.is_shiny), evs.def
  );
  const spd = calculateStat(
    pokemon.base_spd ?? 50, spdIv, level, false, Boolean(pokemon.is_shiny), evs.spe
  );
  db.prepare(`
    UPDATE catches
    SET level = ?, experience = ?, hp_iv = ?, atk_iv = ?, def_iv = ?,
      spa_iv = ?, spdef_iv = ?, spd_iv = ?,
      friendship = ?, hp = ?, max_hp = ?, atk = ?, def = ?, spd = ?,
      ev_hp = ?, ev_atk = ?, ev_def = ?, ev_spa = ?, ev_spdef = ?, ev_spe = ?
    WHERE id = ? AND user_id = ?
  `).run(
    level, experience, hpIv, atkIv, defIv, spaIv, spdefIv, spdIv, friendship,
    maxHp, maxHp, atk, def, spd,
    evs.hp, evs.atk, evs.def, evs.spa, evs.spdef, evs.spe,
    catchId, userId
  );
  if (snapshot) {
    db.prepare('UPDATE catches SET moves = COALESCE(?, moves), sketched_moves = ? WHERE id = ? AND user_id = ?')
      .run(snapshot.moves, snapshot.sketched_moves, catchId, userId);
  }
  return true;
}

// Brings every group of identical catches (team, buddy, PC) to one shared state.
// Source priority: buddy, then a team member, then the most experienced copy.
function reconcileDuplicateCatchStates(userId = null) {
  const stateKey = DUPLICATE_CATCH_STATE_FIELDS.map((field) => `COALESCE(${field}, '')`).join(" || '|' || ");
  const groups = db.prepare(`
    SELECT user_id, pokemon_id, is_shiny, is_golden
    FROM catches
    ${userId ? 'WHERE user_id = ?' : ''}
    GROUP BY user_id, pokemon_id, is_shiny, is_golden
    HAVING COUNT(*) > 1 AND COUNT(DISTINCT ${stateKey}) > 1
  `).all(...(userId ? [userId] : []));
  const pickSource = db.prepare(`
    SELECT catches.id FROM catches
    LEFT JOIN users ON users.buddy_catch_id = catches.id
    WHERE catches.user_id = ? AND catches.pokemon_id = ? AND catches.is_shiny = ? AND catches.is_golden = ?
    ORDER BY (users.buddy_catch_id IS NOT NULL) DESC, catches.in_team DESC,
      catches.experience DESC, catches.id ASC
    LIMIT 1
  `);
  db.transaction(() => {
    for (const group of groups) {
      const source = pickSource.get(group.user_id, group.pokemon_id, group.is_shiny, group.is_golden);
      if (source) syncDuplicateCatchState(group.user_id, source.id);
    }
  })();
  return groups.length;
}

// Existing shinies were stored without the shiny bonus; recomputing is idempotent.
function applyShinyStatBonus() {
  const rows = db.prepare(`
    SELECT catches.id, catches.level, catches.hp, catches.max_hp, catches.atk, catches.def, catches.spd,
      catches.hp_iv, catches.atk_iv, catches.def_iv, catches.spd_iv,
      catches.ev_hp, catches.ev_atk, catches.ev_def, catches.ev_spe,
      f.base_hp, f.base_atk, f.base_def, f.base_spd
    FROM catches JOIN pokemon_forms f ON f.id = catches.pokemon_id
    WHERE catches.is_shiny = 1
  `).all();
  const update = db.prepare('UPDATE catches SET hp = ?, max_hp = ?, atk = ?, def = ?, spd = ? WHERE id = ?');
  db.transaction(() => {
    for (const row of rows) {
      const maxHp = calculateStat(row.base_hp ?? 50, row.hp_iv, row.level, true, true, row.ev_hp);
      const atk = calculateStat(row.base_atk ?? 50, row.atk_iv, row.level, false, true, row.ev_atk);
      const def = calculateStat(row.base_def ?? 50, row.def_iv, row.level, false, true, row.ev_def);
      const spd = calculateStat(row.base_spd ?? 50, row.spd_iv, row.level, false, true, row.ev_spe);
      if (maxHp === row.max_hp && atk === row.atk && def === row.def && spd === row.spd) continue;
      const hp = row.max_hp > 0
        ? Math.min(maxHp, Math.max(1, Math.round((row.hp / row.max_hp) * maxHp)))
        : maxHp;
      update.run(hp, maxHp, atk, def, spd, row.id);
    }
  })();
}

applyShinyStatBonus();
reconcileDuplicateCatchStates();

function migrateSharedAttackAndDefenseIvs() {
  const migrationName = 'shared_attack_special_attack_and_defense_special_defense_ivs';
  if (db.prepare('SELECT 1 FROM migration_flags WHERE name = ?').get(migrationName)) return;

  db.transaction(() => {
    db.exec(`
      UPDATE catches SET spa_iv = atk_iv, spdef_iv = def_iv;
      UPDATE market SET spa_iv = atk_iv, spdef_iv = def_iv;
      UPDATE user_pokemon_state_snapshots SET spa_iv = atk_iv, spdef_iv = def_iv;
    `);
    db.prepare('INSERT INTO migration_flags (name) VALUES (?)').run(migrationName);
  }).immediate();
}

migrateSharedAttackAndDefenseIvs();

function saveCatch(userId, pokemon, isShiny = false, recordSeen = false, isGolden = false, caughtBall = null) {
  assertUserId(userId);
  if (!pokemon || !Number.isSafeInteger(pokemon.id) || typeof pokemon.name !== 'string') {
    throw new TypeError('pokemon must include a valid id and name.');
  }
  if (typeof recordSeen !== 'boolean' || typeof isGolden !== 'boolean') {
    throw new TypeError('recordSeen and isGolden must be booleans.');
  }

  const hpIv = Math.floor(Math.random() * 32);
  const atkIv = Math.floor(Math.random() * 32);
  const defIv = Math.floor(Math.random() * 32);
  const spaIv = atkIv;
  const spdefIv = defIv;
  const spdIv = Math.floor(Math.random() * 32);
  const level = 1;
  const baseHp = pokemon.baseHp ?? 50;
  const baseAtk = pokemon.baseAtk ?? 50;
  const baseDef = pokemon.baseDef ?? 50;
  const baseSpd = pokemon.baseSpd ?? 50;
  const maxHp = calculateStat(baseHp, hpIv, level, true, isShiny);
  const atk = calculateStat(baseAtk, atkIv, level, false, isShiny);
  const def = calculateStat(baseDef, defIv, level, false, isShiny);
  const spd = calculateStat(baseSpd, spdIv, level, false, isShiny);
  const speciesId = db.prepare(
    'SELECT species_id FROM pokemon_forms WHERE id = ?'
  ).get(pokemon.id)?.species_id;
  const availableMoves = getSpeciesLearnset(speciesId, pokemon.id);
  const startingMoves = availableMoves.slice(0, 4);

  return db.transaction(() => {
    getUser(userId);

    const result = db.prepare(`
      INSERT INTO catches (
        user_id, pokemon_id, name, rarity, is_shiny, is_golden, level,
        hp_iv, atk_iv, def_iv, spa_iv, spdef_iv, spd_iv,
        hp, max_hp, atk, def, spd, in_team, team_slot, moves, caught_ball
      )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      pokemon.id,
      pokemon.name,
      pokemon.rarity || 'Common',
      isShiny || pokemon.isShiny ? 1 : 0,
      isGolden ? 1 : 0,
      level,
      hpIv,
      atkIv,
      defIv,
      spaIv,
      spdefIv,
      spdIv,
      maxHp,
      maxHp,
      atk,
      def,
      spd,
      0,
      null,
      JSON.stringify(startingMoves),
      caughtBall
    );
    syncNewCatchState(userId, Number(result.lastInsertRowid));

    if (recordSeen) {
      const buddyCatchId = getUser(userId).buddy_catch_id;
      if (buddyCatchId) {
        const bumped = db.prepare(`
          UPDATE catches SET friendship = MIN(?, friendship + 1) WHERE id = ? AND user_id = ?
        `).run(MAX_FRIENDSHIP, buddyCatchId, userId);
        if (bumped.changes) syncDuplicateCatchState(userId, buddyCatchId);
      }
    }

    if (recordSeen) {
      db.prepare(`
        INSERT INTO pokemon_user_seen_counts (user_id, pokemon_id, is_shiny, is_golden, seen_count)
        VALUES (?, ?, ?, ?, 1)
        ON CONFLICT (user_id, pokemon_id, is_shiny, is_golden)
        DO UPDATE SET seen_count = seen_count + 1
      `).run(userId, pokemon.id, isShiny || pokemon.isShiny ? 1 : 0, isGolden ? 1 : 0);
    }

    incrementUser(userId, {
      total_catches: 1,
      shiny_catches: isShiny || pokemon.isShiny ? 1 : 0,
    });
    return Number(result.lastInsertRowid);
  }).immediate();
}

function advanceEggCatchProgress(userId, amount = 1) {
  assertUserId(userId);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new TypeError('Egg catch progress amount must be a positive safe integer.');
  }
  const heldEgg = db.prepare(`
    UPDATE users
    SET held_egg_progress = MIN(held_egg_target, held_egg_progress + ?)
    WHERE id = ? AND held_egg_target > 0 AND held_egg_progress < held_egg_target
    RETURNING held_egg_progress AS progress, held_egg_target AS target
  `).get(amount, userId);
  const progressedIncubators = db.prepare(`
    UPDATE egg_incubators
    SET progress = MIN(target, progress + ?)
    WHERE user_id = ? AND progress < target
    RETURNING incubator_type, slot, progress, target
  `).all(amount, userId);
  const newlyReady = [];
  if (heldEgg && heldEgg.progress >= heldEgg.target) {
    newlyReady.push({ type: 'held' });
  }
  newlyReady.push(...progressedIncubators
    .filter((incubator) => incubator.progress >= incubator.target)
    .map(({ incubator_type: incubatorType, slot }) => ({
      type: 'incubator',
      incubatorType,
      slot,
    })));
  return newlyReady;
}

const EGG_INCUBATOR_LIMITS = Object.freeze({
  incubator: 2,
  super_incubator: 6,
});

function getUserEggIncubators(userId) {
  assertUserId(userId);
  return db.prepare(`
    SELECT incubator_type, slot, progress, target
    FROM egg_incubators
    WHERE user_id = ?
    ORDER BY incubator_type, slot
  `).all(userId);
}

function startEggIncubators(userId, incubatorType, targets) {
  assertUserId(userId);
  if (!Object.hasOwn(EGG_INCUBATOR_LIMITS, incubatorType)) {
    throw new TypeError('Unknown Egg incubator type.');
  }
  if (!Array.isArray(targets) || !targets.length
      || targets.some((target) => !Number.isSafeInteger(target) || target < 1 || target > 130)) {
    throw new TypeError('Egg incubator targets must be a non-empty array of integers from 1 to 130.');
  }
  const itemName = incubatorType === 'incubator' ? 'Incubator' : 'Super Incubator';
  const statField = incubatorType === 'incubator' ? 'incubators_used' : 'super_incubators_used';
  return db.transaction(() => {
    const user = getUser(userId);
    const activeSlots = db.prepare(`
      SELECT slot FROM egg_incubators WHERE user_id = ? AND incubator_type = ?
    `).all(userId, incubatorType);
    const availableSlots = EGG_INCUBATOR_LIMITS[incubatorType] - activeSlots.length;
    const ownedIncubators = getUserItems(userId)
      .find((item) => item.item_name === itemName)?.amount || 0;
    if (targets.length > availableSlots) {
      return { error: 'slots_full', availableSlots };
    }
    if (targets.length > ownedIncubators) {
      return { error: 'insufficient_incubators', owned: ownedIncubators };
    }
    if (targets.length > user.vote_eggs) {
      return { error: 'insufficient_eggs', owned: user.vote_eggs };
    }
    if (!takeUserItem(userId, itemName, targets.length)) {
      return { error: 'insufficient_incubators', owned: ownedIncubators };
    }
    incrementUser(userId, { vote_eggs: -targets.length, [statField]: targets.length });
    const occupiedSlots = new Set(activeSlots.map((entry) => entry.slot));
    const insert = db.prepare(`
      INSERT INTO egg_incubators (user_id, incubator_type, slot, progress, target)
      VALUES (?, ?, ?, 0, ?)
    `);
    const started = targets.map((target) => {
      let slot = 1;
      while (occupiedSlots.has(slot)) slot += 1;
      occupiedSlots.add(slot);
      insert.run(userId, incubatorType, slot, target);
      return { incubator_type: incubatorType, slot, progress: 0, target };
    });
    return { started };
  }).immediate();
}

function hatchEggFromIncubator(userId, incubatorType, slot, pokemon, { isShiny = false, isGolden = false } = {}) {
  assertUserId(userId);
  if (!Object.hasOwn(EGG_INCUBATOR_LIMITS, incubatorType)) {
    throw new TypeError('Unknown Egg incubator type.');
  }
  if (!Number.isSafeInteger(slot) || slot < 1 || slot > EGG_INCUBATOR_LIMITS[incubatorType]) {
    throw new TypeError('Egg incubator slot is out of range.');
  }
  return db.transaction(() => {
    const incubator = db.prepare(`
      SELECT progress, target FROM egg_incubators
      WHERE user_id = ? AND incubator_type = ? AND slot = ?
    `).get(userId, incubatorType, slot);
    if (!incubator) return { error: 'no_incubator_egg' };
    if (incubator.progress < incubator.target) {
      return {
        error: 'egg_not_ready',
        progress: incubator.progress,
        target: incubator.target,
      };
    }
    db.prepare(`
      DELETE FROM egg_incubators
      WHERE user_id = ? AND incubator_type = ? AND slot = ?
    `).run(userId, incubatorType, slot);
    incrementUser(userId, { eggs_hatched: 1 });
    const catchId = isGolden
      ? saveGoldenCatch(userId, pokemon)
      : saveCatch(userId, pokemon, isShiny);
    trackClanActivity(userId, 'hatch');
    return { catchId, pokemon, isShiny, isGolden };
  }).immediate();
}

function holdEgg(userId, catchTarget) {
  assertUserId(userId);
  if (!Number.isSafeInteger(catchTarget) || catchTarget < 30 || catchTarget > 130) {
    throw new TypeError('Egg catch target must be between 30 and 130.');
  }
  return db.transaction(() => {
    const user = getUser(userId);
    if (user.held_egg_target > 0) {
      return { error: 'egg_already_held', progress: user.held_egg_progress, target: user.held_egg_target };
    }
    if (user.vote_eggs < 1) return { error: 'no_eggs' };
    db.prepare(`
      UPDATE users
      SET vote_eggs = vote_eggs - 1, held_egg_progress = 0, held_egg_target = ?
      WHERE id = ? AND vote_eggs > 0 AND held_egg_target = 0
    `).run(catchTarget, userId);
    return { progress: 0, target: catchTarget };
  }).immediate();
}

function hatchEgg(userId, pokemon, { isShiny = false, isGolden = false } = {}) {
  assertUserId(userId);
  return db.transaction(() => {
    const user = getUser(userId);
    if (user.held_egg_target <= 0) return { error: 'no_held_egg' };
    if (user.held_egg_progress < user.held_egg_target) {
      return {
        error: 'egg_not_ready',
        progress: user.held_egg_progress,
        target: user.held_egg_target,
      };
    }
    db.prepare(`
      UPDATE users
      SET held_egg_progress = 0, held_egg_target = 0, eggs_hatched = eggs_hatched + 1
      WHERE id = ?
    `).run(userId);
    const catchId = isGolden
      ? saveGoldenCatch(userId, pokemon)
      : saveCatch(userId, pokemon, isShiny);
    trackClanActivity(userId, 'hatch');
    return { catchId, pokemon, isShiny, isGolden };
  }).immediate();
}

// Golden Pokémon are promo/event/giveaway-only variants and never spawn in the wild.
function saveGoldenCatch(userId, pokemon) {
  return saveCatch(userId, { ...pokemon, rarity: 'Golden' }, false, false, true);
}

function parseSketchedMoves(raw) {
  try {
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list.filter((name) => typeof name === 'string') : [];
  } catch (_) {
    return [];
  }
}

function getPokemonLearnset(catchId, userId) {
  assertUserId(userId);
  const pokemon = db.prepare(`
    SELECT catches.pokemon_id, pokemon_forms.species_id, catches.moves, catches.sketched_moves
    FROM catches
    LEFT JOIN pokemon_forms ON pokemon_forms.id = catches.pokemon_id
    WHERE catches.id = ? AND catches.user_id = ?
  `).get(catchId, userId);
  if (!pokemon) return null;
  const gmaxMoves = getGigantamaxMoves(pokemon.species_id, pokemon.pokemon_id);
  const base = restrictStyleExclusiveMoves([
    ...getSpeciesLearnset(pokemon.species_id),
    ...getSpeciesLearnset(pokemon.species_id, pokemon.pokemon_id),
    ...gmaxMoves,
  ], pokemon.pokemon_id);
  return {
    pokemon,
    moves: [...new Set([...base, ...parseSketchedMoves(pokemon.sketched_moves)])],
  };
}

// Smeargle's Sketch permanently learns the copied move: it is added to this catch's
// learnset and replaces Sketch in its equipped moves.
function recordSketchedMove(catchId, userId, moveSlug) {
  assertUserId(userId);
  if (typeof moveSlug !== 'string' || !pokemonMovesData.moves[moveSlug]
      || ['sketch', 'struggle', 'chatter', 'transform', 'mimic'].includes(moveSlug)) return false;
  return db.transaction(() => {
    const row = db.prepare(`
      SELECT catches.moves, catches.sketched_moves, pokemon_forms.species_id, catches.pokemon_id
      FROM catches LEFT JOIN pokemon_forms ON pokemon_forms.id = catches.pokemon_id
      WHERE catches.id = ? AND catches.user_id = ?
    `).get(catchId, userId);
    const base = row ? getSpeciesLearnset(row.species_id, row.pokemon_id) : [];
    if (!row || !base.includes('sketch')) return false;
    const sketched = parseSketchedMoves(row.sketched_moves);
    if (!sketched.includes(moveSlug)) sketched.push(moveSlug);
    const known = [...new Set([...base, ...sketched])];
    let equipped = parseSketchedMoves(row.moves);
    for (const name of known) {
      if (equipped.length >= 4) break;
      if (!equipped.includes(name)) equipped.push(name);
    }
    if (!equipped.includes(moveSlug)) {
      const sketchIndex = equipped.indexOf('sketch');
      if (sketchIndex >= 0) equipped[sketchIndex] = moveSlug;
      else equipped[equipped.length - 1] = moveSlug;
    }
    equipped = [...new Set(equipped)].slice(0, 4);
    db.prepare('UPDATE catches SET moves = ?, sketched_moves = ? WHERE id = ? AND user_id = ?')
      .run(JSON.stringify(equipped), JSON.stringify(sketched), catchId, userId);
    syncDuplicateCatchState(userId, catchId);
    return true;
  }).immediate();
}

// Forms with their own learnset (Gmax / Eternamax) are keyed by form id in form_learnsets.
function getSpeciesLearnset(speciesId, formId = null) {
  const formMoves = formId !== null ? pokemonMovesData.form_learnsets?.[String(formId)] : null;
  if (formMoves) return formMoves;
  if (!Number.isSafeInteger(speciesId) || speciesId <= 0) return [];
  return pokemonMovesData.learnsets[String(speciesId)] || [];
}

function setBuddyMoves(userId, moveNames) {
  assertUserId(userId);
  if (!Array.isArray(moveNames) || moveNames.length !== 4
      || moveNames.some((name) => typeof name !== 'string')) {
    throw new TypeError('Exactly four move names are required.');
  }
  const normalizedMoves = moveNames.map((name) => name.trim().toLowerCase());
  if (new Set(normalizedMoves).size !== normalizedMoves.length) {
    return { error: 'duplicate_moves' };
  }

  return db.transaction(() => {
    const buddyId = getUser(userId).buddy_catch_id;
    if (!buddyId) return { error: 'no_buddy' };
    const pokemon = getPokemonLearnset(buddyId, userId);
    if (!pokemon) return { error: 'no_buddy' };
    const learnset = new Set(pokemon.moves.map((move) => move.toLowerCase()));
    if (normalizedMoves.some((move) => !learnset.has(move))) {
      return { error: 'not_learned', learnset: pokemon.moves };
    }
    db.prepare('UPDATE catches SET moves = ? WHERE id = ? AND user_id = ?')
      .run(JSON.stringify(normalizedMoves), buddyId, userId);
    syncDuplicateCatchState(userId, buddyId);
    return { moves: normalizedMoves };
  }).immediate();
}

const BUDDY_MOVE_CHANGE_BASE_COST = 50000;

function getBuddyMoveChangeCost(userId) {
  return Math.floor(
    BUDDY_MOVE_CHANGE_BASE_COST * (1 - getPatreonPerks(userId).moveCostDiscount)
  );
}

function setBuddyMoveSlot(userId, slot, moveName) {
  assertUserId(userId);
  if (!Number.isSafeInteger(slot) || slot < 1 || slot > 4
      || typeof moveName !== 'string' || !moveName.trim()) {
    throw new TypeError('A move slot from 1 to 4 and a move name are required.');
  }
  return db.transaction(() => {
    const buddyId = getUser(userId).buddy_catch_id;
    if (!buddyId) return { error: 'no_buddy' };
    const learnset = getPokemonLearnset(buddyId, userId);
    if (!learnset) return { error: 'no_buddy' };
    if (slot > Math.min(4, learnset.moves.length)) {
      return { error: 'invalid_slot', slotCount: Math.min(4, learnset.moves.length) };
    }
    const moveKey = moveName.trim().toLowerCase()
      .replace(/\s*\(physical\)\s*$/, '')
      .replace(/\s*\(special\)\s*$/, '-special')
      .replace(/\s+/g, '-');
    const knownMove = learnset.moves.find((move) => move.toLowerCase() === moveKey);
    if (!knownMove) return { error: 'not_learned', learnset: learnset.moves };
    const currentMoves = JSON.parse(learnset.pokemon.moves || '[]');
    while (currentMoves.length < 4) {
      const nextMove = learnset.moves.find((move) => !currentMoves.includes(move));
      if (!nextMove) break;
      currentMoves.push(nextMove);
    }
    if (currentMoves.some((move, index) => index !== slot - 1 && move === knownMove)) {
      return { error: 'duplicate_move' };
    }
    if (currentMoves[slot - 1] === knownMove) {
      return { error: 'unchanged' };
    }
    const cost = getBuddyMoveChangeCost(userId);
    const user = getUser(userId);
    if (user.coins < cost) return { error: 'insufficient_coins', cost, coins: user.coins };
    incrementUser(userId, { coins: -cost });
    currentMoves[slot - 1] = knownMove;
    db.prepare('UPDATE catches SET moves = ? WHERE id = ? AND user_id = ?')
      .run(JSON.stringify(currentMoves), buddyId, userId);
    syncDuplicateCatchState(userId, buddyId);
    return { moves: currentMoves, cost };
  }).immediate();
}

function deleteBuddyMoveSlot(userId, slot) {
  assertUserId(userId);
  if (!Number.isSafeInteger(slot) || slot < 1 || slot > 4) {
    throw new TypeError('A move slot from 1 to 4 is required.');
  }
  return db.transaction(() => {
    const buddyId = getUser(userId).buddy_catch_id;
    if (!buddyId) return { error: 'no_buddy' };
    const learnset = getPokemonLearnset(buddyId, userId);
    if (!learnset) return { error: 'no_buddy' };
    const slotCount = Math.min(4, learnset.moves.length);
    if (slot > slotCount) return { error: 'invalid_slot', slotCount };

    const currentMoves = JSON.parse(learnset.pokemon.moves || '[]');
    while (currentMoves.length < 4) {
      const nextMove = learnset.moves.find((move) => !currentMoves.includes(move));
      if (!nextMove) break;
      currentMoves.push(nextMove);
    }
    const removedMove = currentMoves[slot - 1];
    if (!removedMove) return { error: 'not_equipped' };

    currentMoves[slot - 1] = null;
    db.prepare('UPDATE catches SET moves = ? WHERE id = ? AND user_id = ?')
      .run(JSON.stringify(currentMoves), buddyId, userId);
    syncDuplicateCatchState(userId, buddyId);
    return { moves: currentMoves, removedMove };
  }).immediate();
}

function swapBuddyMoveSlots(userId, firstSlot, secondSlot) {
  assertUserId(userId);
  if (!Number.isSafeInteger(firstSlot) || !Number.isSafeInteger(secondSlot)
      || firstSlot < 1 || firstSlot > 4 || secondSlot < 1 || secondSlot > 4) {
    throw new TypeError('Move slots must be between 1 and 4.');
  }
  return db.transaction(() => {
    const buddyId = getUser(userId).buddy_catch_id;
    if (!buddyId) return { error: 'no_buddy' };
    const learnset = getPokemonLearnset(buddyId, userId);
    if (!learnset) return { error: 'no_buddy' };
    const slotCount = Math.min(4, learnset.moves.length);
    if (firstSlot > slotCount || secondSlot > slotCount) {
      return { error: 'invalid_slot', slotCount };
    }
    if (firstSlot === secondSlot) return { error: 'unchanged' };

    const currentMoves = JSON.parse(learnset.pokemon.moves || '[]');
    while (currentMoves.length < 4) {
      const nextMove = learnset.moves.find((move) => !currentMoves.includes(move));
      if (!nextMove) break;
      currentMoves.push(nextMove);
    }
    [currentMoves[firstSlot - 1], currentMoves[secondSlot - 1]] =
      [currentMoves[secondSlot - 1], currentMoves[firstSlot - 1]];
    db.prepare('UPDATE catches SET moves = ? WHERE id = ? AND user_id = ?')
      .run(JSON.stringify(currentMoves), buddyId, userId);
    syncDuplicateCatchState(userId, buddyId);
    return { moves: currentMoves };
  }).immediate();
}

db.exec(`
  CREATE TABLE IF NOT EXISTS battle_icons (
    user_id TEXT NOT NULL,
    npc_index INTEGER NOT NULL,
    unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, npc_index)
  );
  CREATE TABLE IF NOT EXISTS battle_icon_selected (
    user_id TEXT PRIMARY KEY,
    npc_index INTEGER NOT NULL
  );
`);

const ICON_DROP_TEST_USER_ID = '1514082847609061541';
db.prepare(`
  INSERT OR IGNORE INTO bot_settings (key, value)
  VALUES (?, 'pending')
`).run(`force_next_npc_icon_drop:${ICON_DROP_TEST_USER_ID}`);

function grantGuaranteedBattleIconDrop(userId, preferredIndex, totalIcons) {
  assertUserId(userId);
  if (!Number.isSafeInteger(preferredIndex) || preferredIndex < 0
      || !Number.isSafeInteger(totalIcons) || totalIcons <= 0
      || preferredIndex >= totalIcons) {
    throw new TypeError('A valid preferred icon index and positive icon count are required.');
  }
  return db.transaction(() => {
    const key = `force_next_npc_icon_drop:${userId}`;
    if (db.prepare('SELECT value FROM bot_settings WHERE key = ?').get(key)?.value !== 'pending') {
      return null;
    }
    if (getUnlockedBattleIcons(userId).includes(preferredIndex)
        || !unlockBattleIcon(userId, preferredIndex)) return null;
    db.prepare('UPDATE bot_settings SET value = ? WHERE key = ?').run('done', key);
    return preferredIndex;
  }).immediate();
}

function unlockBattleIcon(userId, npcIndex) {
  assertUserId(userId);
  return db.prepare('INSERT OR IGNORE INTO battle_icons (user_id, npc_index) VALUES (?, ?)')
    .run(userId, npcIndex).changes > 0;
}

function getUnlockedBattleIcons(userId) {
  return db.prepare('SELECT npc_index FROM battle_icons WHERE user_id = ? ORDER BY unlocked_at, rowid')
    .all(userId).map((row) => row.npc_index);
}

function getBattleIconRank(userId) {
  const own = db.prepare('SELECT COUNT(*) AS c FROM battle_icons WHERE user_id = ?').get(userId).c;
  return db.prepare(`
    SELECT COUNT(*) + 1 AS rank FROM (
      SELECT user_id FROM battle_icons GROUP BY user_id HAVING COUNT(*) > ?
    )
  `).get(own).rank;
}

function setSelectedBattleIcon(userId, npcIndex) {
  db.prepare(`
    INSERT INTO battle_icon_selected (user_id, npc_index) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET npc_index = excluded.npc_index
  `).run(userId, npcIndex);
}

function getSelectedBattleIcon(userId) {
  return db.prepare('SELECT npc_index FROM battle_icon_selected WHERE user_id = ?').get(userId)?.npc_index ?? null;
}

function getLeagueProgress(userId) {
  assertUserId(userId);
  return db.transaction(() => {
    getUser(userId);
    db.prepare('INSERT OR IGNORE INTO league_progress (user_id) VALUES (?)').run(userId);
    return db.prepare('SELECT * FROM league_progress WHERE user_id = ?').get(userId);
  }).immediate();
}

function clearLeagueChallenge(userId, expectedChallenge, reward) {
  assertUserId(userId);
  if (!Number.isSafeInteger(expectedChallenge) || expectedChallenge < 0
      || !Number.isSafeInteger(reward) || reward < 0) {
    throw new TypeError('Challenge index and reward must be non-negative integers.');
  }
  return db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO league_progress (user_id) VALUES (?)').run(userId);
    const result = db.prepare(`
      UPDATE league_progress
      SET cleared_challenges = cleared_challenges + 1, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND cleared_challenges = ?
    `).run(userId, expectedChallenge);
    if (!result.changes) return false;
    return awardCoinsWithBoost(userId, reward).finalAmount;
  }).immediate();
}

const CHAMBER_CONFIG = {
  sableye: {
    id: 1,
    key: 'sableye',
    name: 'Mega Sableye',
    monReq: 'Sableye',
    pokemonId: 302,
    rewardStone: 'Sablenite',
    icon: '💎',
  },
  gengar: {
    id: 2,
    key: 'gengar',
    name: 'Mega Gengar',
    monReq: 'Gengar',
    pokemonId: 94,
    rewardStone: 'Gengarite',
    icon: '👻',
  },
  mawile: {
    id: 3,
    key: 'mawile',
    name: 'Mega Mawile',
    monReq: 'Mawile',
    pokemonId: 303,
    rewardStone: 'Mawilite',
    icon: '🦷',
  },
  banette: {
    id: 4,
    key: 'banette',
    name: 'Mega Banette',
    monReq: 'Banette',
    pokemonId: 354,
    rewardStone: 'Banettite',
    icon: '🪡',
  },
};

// Every Mega Stone (Bulbapedia "Mega Stone"), used for the bag page and grants.
const MEGA_STONE_NAMES = Object.freeze([
  'Venusaurite', 'Charizardite X', 'Charizardite Y', 'Blastoisinite', 'Beedrillite', 'Pidgeotite',
  'Clefablite', 'Alakazite', 'Slowbronite', 'Gengarite', 'Kangaskhanite', 'Starminite', 'Pinsirite',
  'Gyaradosite', 'Aerodactylite', 'Dragoninite', 'Meganiumite', 'Feraligite', 'Ampharosite',
  'Steelixite', 'Scizorite', 'Heracronite', 'Houndoominite', 'Tyranitarite', 'Sceptilite',
  'Blazikenite', 'Swampertite', 'Gardevoirite', 'Sablenite', 'Mawilite', 'Aggronite', 'Medichamite',
  'Manectite', 'Sharpedonite', 'Cameruptite', 'Altarianite', 'Banettite', 'Chimechite', 'Absolite',
  'Glalitite', 'Salamencite', 'Metagrossite', 'Latiasite', 'Latiosite', 'Lopunnite', 'Garchompite',
  'Garchompite Z', 'Lucarionite', 'Lucarionite Z', 'Abomasite', 'Galladite', 'Audinite', 'Diancite',
  'Mewtwonite X', 'Mewtwonite Y', 'Raichunite X', 'Raichunite Y', 'Skarmorite', 'Froslassite',
  'Emboarite', 'Excadrite', 'Scolipite', 'Scraftinite', 'Eelektrossite', 'Chandelurite',
  'Chesnaughtite', 'Delphoxite', 'Greninjite', 'Pyroarite', 'Floettite', 'Malamarite', 'Barbaracite',
  'Dragalgite', 'Hawluchanite', 'Zygardite', 'Drampanite', 'Falinksite', 'Golurkite', 'Crabominite',
  'Golisopite', 'Scovillainite', 'Glimmoranite', 'Victreebelite', 'Baxcalibrite', 'Magearnite',
  'Darkanite', 'Meteor', 'Zeraorite', 'Heatranite', 'Meowsticite', 'Staraptite', 'Tatsugirinite',
]);

const MEGA_STONE_SPECIES_ALIASES = Object.freeze({
  abomas: 'abomasnow',
  alakaz: 'alakazam',
  altarian: 'altaria',
  baxcalibr: 'baxcalibur',
  blastoisin: 'blastoise',
  barbarac: 'barbaracle',
  banett: 'banette',
  chandelur: 'chandelure',
  clefabl: 'clefable',
  chimech: 'chimecho',
  crabomin: 'crabominable',
  darkan: 'darkrai',
  dianc: 'diancie',
  dragalg: 'dragalge',
  dragonin: 'dragonite',
  drampan: 'drampa',
  excadr: 'excadrill',
  falink: 'falinks',
  feralig: 'feraligatr',
  floett: 'floette',
  gallad: 'gallade',
  glalit: 'glalie',
  glimmoran: 'glimmora',
  golisop: 'golisopod',
  greninj: 'greninja',
  hawluchan: 'hawlucha',
  heracron: 'heracross',
  houndoomin: 'houndoom',
  lucarion: 'lucario',
  lopunn: 'lopunny',
  magearn: 'magearna',
  manect: 'manectric',
  mawil: 'mawile',
  mewtwon: 'mewtwo',
  pyroar: 'pyroar',
  raichun: 'raichu',
  sablen: 'sableye',
  scraftin: 'scrafty',
  scolip: 'scolipede',
  sceptil: 'sceptile',
  sharpedon: 'sharpedo',
  salamenc: 'salamence',
  skarmor: 'skarmory',
  slowbron: 'slowbro',
  starapt: 'staraptor',
  starmin: 'starmie',
  tatsugirin: 'tatsugiri',
  audin: 'audino',
  victreebel: 'victreebel',
  zeraor: 'zeraora',
  zygard: 'zygarde',
  meteor: 'rayquaza',
});

function getMegaStoneSpecies(stoneName) {
  const stoneKey = stoneName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const stem = stoneKey.replace(/ite(?:[xyz])?$/, '');
  return MEGA_STONE_SPECIES_ALIASES[stem] || stem;
}

function getMegaStoneForForm(form) {
  const speciesKey = form.species_name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const candidates = MEGA_STONE_NAMES.filter((stoneName) =>
    getMegaStoneSpecies(stoneName) === speciesKey
  );
  if (candidates.length <= 1) return candidates[0] || null;

  const variant = form.slug.match(/-mega-([xyz])$/i)?.[1]?.toUpperCase();
  if (variant) {
    const variantStone = candidates.find((stoneName) =>
      stoneName.toLowerCase().endsWith(` ${variant.toLowerCase()}`)
    );
    if (variantStone) return variantStone;
  }
  return candidates.find((stoneName) => !/ [XYZ]$/i.test(stoneName)) || candidates[0];
}

function getUserChambers(userId) {
  assertUserId(userId);
  const data = Object.fromEntries(Object.keys(CHAMBER_CONFIG).map((key) => [
    key,
    { sacrifices: 0, clears: 0 },
  ]));
  for (const row of db.prepare('SELECT * FROM mega_chambers WHERE user_id = ?').all(userId)) {
    if (data[row.chamber_key]) {
      data[row.chamber_key] = { sacrifices: row.sacrifices, clears: row.clears };
    }
  }
  return data;
}

function getMegaStones(userId) {
  assertUserId(userId);
  return db.prepare(
    'SELECT stone_name, amount FROM mega_stones WHERE user_id = ? AND amount > 0 ORDER BY stone_name'
  ).all(userId);
}

function sacrificeForChamber(userId, chamberKey, amount) {
  assertUserId(userId);
  const config = CHAMBER_CONFIG[chamberKey];
  if (!config) return { error: 'invalid_chamber' };
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100) {
    throw new TypeError('Sacrifice amount must be an integer between 1 and 100.');
  }
  return db.transaction(() => {
    getUser(userId);
    const available = db.prepare(`
      SELECT catches.id
      FROM catches
      JOIN pokemon_forms ON pokemon_forms.id = catches.pokemon_id
      JOIN users ON users.id = catches.user_id
      WHERE catches.user_id = ?
        AND pokemon_forms.species_id = ?
        AND pokemon_forms.is_default = 1
        AND catches.is_shiny = 0
        AND catches.is_golden = 0
        AND catches.in_team = 0
        AND (users.buddy_catch_id IS NULL OR catches.id != users.buddy_catch_id)
      ORDER BY catches.id
      LIMIT ?
    `).all(userId, config.pokemonId, amount);
    if (available.length < amount) return { error: 'insufficient_pokemon', available: available.length };
    const ids = available.map((pokemon) => pokemon.id);
    db.prepare(`DELETE FROM catches WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`)
      .run(userId, ...ids);
    db.prepare(`
      INSERT INTO mega_chambers (user_id, chamber_key, sacrifices, clears)
      VALUES (?, ?, ?, 0)
      ON CONFLICT(user_id, chamber_key) DO UPDATE SET
        sacrifices = mega_chambers.sacrifices + excluded.sacrifices
    `).run(userId, chamberKey, amount);
    const progress = db.prepare(
      'SELECT sacrifices, clears FROM mega_chambers WHERE user_id = ? AND chamber_key = ?'
    ).get(userId, chamberKey);
    return { sacrificed: amount, ...progress };
  }).immediate();
}

// Legendary/mythical chamber Pokémon need 5 sacrifices; everything else needs 10.
function getChamberRequirement(config, userId = null) {
  const row = db.prepare(
    'SELECT MAX(is_legendary) AS legendary FROM pokemon_forms WHERE species_id = ? AND is_default = 1'
  ).get(config.pokemonId);
  const base = row?.legendary ? 5 : 10;
  const discount = userId ? getPatreonPerks(userId).megaChamberDiscount : 0;
  return Math.max(1, Math.ceil(base * (1 - discount)));
}

function completeMegaChamber(userId, chamberKey) {
  assertUserId(userId);
  const config = CHAMBER_CONFIG[chamberKey];
  if (!config) return { error: 'invalid_chamber' };
  const required = getChamberRequirement(config, userId);
  return db.transaction(() => {
    const result = db.prepare(`
      UPDATE mega_chambers
      SET sacrifices = sacrifices - ?, clears = clears + 1
      WHERE user_id = ? AND chamber_key = ? AND sacrifices >= ?
    `).run(required, userId, chamberKey, required);
    if (!result.changes) return { error: 'not_ready' };
    db.prepare(`
      INSERT INTO mega_stones (user_id, stone_name, amount)
      VALUES (?, ?, 1)
      ON CONFLICT(user_id, stone_name) DO UPDATE SET amount = mega_stones.amount + 1
    `).run(userId, config.rewardStone);
    const coins = awardCoinsWithBoost(userId, 15000).finalAmount;
    incrementUser(userId, {
      mega_chambers_won: 1,
      battles_won: 1,
      cl_battles: 1,
    });
    const remaining = db.prepare(`
      SELECT sacrifices FROM mega_chambers
      WHERE user_id = ? AND chamber_key = ?
    `).get(userId, chamberKey);
    return {
      stone: config.rewardStone,
      coins,
      remainingSacrifices: remaining.sacrifices,
    };
  }).immediate();
}

function megaEvolvePokemon(userId, query, requestedStone = null) {
  assertUserId(userId);
  if (typeof query !== 'string' || !query.trim()) {
    throw new TypeError('Pokémon name or Pokédex number is required.');
  }
  const rawQuery = query.trim().toLowerCase();
  const shinyPrefix = rawQuery.match(/^shiny[\s_-]+(.+)$/);
  const pokemonQuery = (shinyPrefix ? shinyPrefix[1] : rawQuery).trim();
  const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalizedQuery = normalize(pokemonQuery);
  const dexNumber = /^\d+$/.test(pokemonQuery) ? Number(pokemonQuery) : null;
  let isShiny = Boolean(shinyPrefix);
  const forms = db.prepare(`
    SELECT id, species_id, species_name, name, slug, rarity, is_default,
      base_hp, base_atk, base_def, base_spd
    FROM pokemon_forms
    ORDER BY id
  `).all();
  const megaForms = forms
    .filter((form) => form.rarity === 'Mega')
    .map((form) => ({ ...form, stoneName: getMegaStoneForForm(form) }));
  let explicitlySelectedMega = megaForms.find((form) =>
    normalize(form.name) === normalizedQuery
    || (normalize(form.name.replace(/\bmega\b/i, '')) === normalizedQuery
      && normalize(form.species_name) !== normalizedQuery)
    || normalize(form.slug) === normalizedQuery
  );
  let speciesId = explicitlySelectedMega?.species_id;
  let selectedBaseFormId = null;
  const getBaseForm = (megaForm) => {
    const baseSlug = megaForm.slug.replace(/-mega(?:-[xyz])?$/i, '');
    return forms.find((form) =>
      form.species_id === megaForm.species_id
      && form.slug.toLowerCase() === baseSlug.toLowerCase()
    ) || forms.find((form) =>
      form.species_id === megaForm.species_id && form.is_default === 1
    );
  };
  if (explicitlySelectedMega) {
    selectedBaseFormId = getBaseForm(explicitlySelectedMega)?.id ?? null;
  }
  if (speciesId === undefined && dexNumber === null) {
    const namedForm = forms.find((form) =>
      form.rarity !== 'Mega'
      && (normalize(form.name) === normalizedQuery || normalize(form.slug) === normalizedQuery)
    );
    const namedSpecies = forms.find((form) =>
      normalize(form.species_name) === normalizedQuery
    );
    const selectedForm = namedForm || namedSpecies;
    speciesId = selectedForm?.species_id;
    selectedBaseFormId = selectedForm?.id ?? null;
  }
  if (speciesId === undefined && dexNumber !== null) {
    const dexNumbers = getPokemonDexNumbersForForms();
    const matchingForm = forms.find((form) => {
      const numbers = dexNumbers.get(form.id);
      if (numbers?.shinyDexNumber === dexNumber) isShiny = true;
      return numbers?.dexNumber === dexNumber || numbers?.shinyDexNumber === dexNumber;
    });
    if (matchingForm?.rarity === 'Mega') {
      explicitlySelectedMega = matchingForm;
      selectedBaseFormId = getBaseForm(matchingForm)?.id ?? null;
    } else {
      selectedBaseFormId = matchingForm?.id ?? null;
    }
    speciesId = matchingForm?.species_id;
  }
  if (speciesId === undefined) return { error: 'unsupported_pokemon' };

  let candidates = megaForms.filter((form) =>
    form.species_id === speciesId && form.stoneName
    && (!explicitlySelectedMega || form.id === explicitlySelectedMega.id)
    && (selectedBaseFormId === null || getBaseForm(form)?.id === selectedBaseFormId)
  );
  if (!candidates.length) return { error: 'unsupported_pokemon' };

  const requiredStoneNames = [...new Set(candidates.map((form) => form.stoneName))];
  if (requestedStone !== null) {
    candidates = candidates.filter((form) => form.stoneName === requestedStone);
    if (!candidates.length) {
      return {
        error: 'stone_required',
        stoneNames: requiredStoneNames,
        pokemonName: candidates[0]?.species_name || megaForms.find((form) => form.species_id === speciesId)?.species_name,
        isShiny,
      };
    }
  } else if (requiredStoneNames.length > 1) {
    const ownedStones = new Set(getMegaStones(userId).map((stone) => stone.stone_name));
    const availableStones = requiredStoneNames.filter((stoneName) => ownedStones.has(stoneName));
    if (availableStones.length === 1) {
      candidates = candidates.filter((form) => form.stoneName === availableStones[0]);
    } else {
      return {
        error: 'choose_stone',
        stoneNames: availableStones.length ? availableStones : requiredStoneNames,
        pokemonName: megaForms.find((form) => form.species_id === speciesId)?.species_name,
        isShiny,
      };
    }
  }
  if (candidates.length > 1 && !explicitlySelectedMega) {
    return {
      error: 'choose_form',
      formNames: candidates.map((form) => form.name),
      stoneName: candidates[0].stoneName,
      pokemonName: candidates[0].species_name,
      isShiny,
    };
  }

  return db.transaction(() => {
    const bracelet = db.prepare(`
      SELECT amount FROM user_items
      WHERE user_id = ? AND item_name = 'Mega Bracelet' AND amount > 0
    `).get(userId);
    if (!bracelet) {
      return { error: 'bracelet_required', pokemonName: candidates[0].species_name };
    }

    const options = candidates.map((megaForm) => {
      const baseForm = getBaseForm(megaForm);
      if (!baseForm) {
        const baseSlug = megaForm.slug.replace(/-mega(?:-[xyz])?$/i, '');
        throw new Error(`Missing base form ${baseSlug} for Mega Evolution ${megaForm.name}.`);
      }
      const pokemon = db.prepare(`
        SELECT * FROM catches
        WHERE user_id = ? AND pokemon_id = ? AND is_shiny = ? AND is_golden = 0
        ORDER BY id DESC
        LIMIT 1
      `).get(userId, baseForm.id, isShiny ? 1 : 0);
      const stone = db.prepare(`
        SELECT amount FROM mega_stones
        WHERE user_id = ? AND stone_name = ?
      `).get(userId, megaForm.stoneName);
      return { megaForm, pokemon, stone };
    });
    const available = options.filter((option) => option.pokemon && option.stone?.amount > 0);
    if (available.length > 1
        && new Set(available.map((option) => option.megaForm.stoneName)).size > 1) {
      return {
        error: 'choose_stone',
        stoneNames: [...new Set(available.map((option) => option.megaForm.stoneName))],
        pokemonName: candidates[0].species_name,
        isShiny,
      };
    }
    const selected = (available.length ? available : options)
      .sort((a, b) => (b.pokemon?.id || 0) - (a.pokemon?.id || 0))[0];
    const { megaForm, pokemon, stone } = selected;
    if (!pokemon) {
      return { error: 'pokemon_not_owned', pokemonName: megaForm.species_name, isShiny };
    }
    if (!stone || stone.amount < 1) {
      return {
        error: 'stone_required',
        stoneName: megaForm.stoneName,
        pokemonName: megaForm.species_name,
        isShiny,
      };
    }

    const maxHp = calculateStat(megaForm.base_hp, pokemon.hp_iv, pokemon.level, true, pokemon.is_shiny, pokemon.ev_hp);
    const atk = calculateStat(megaForm.base_atk, pokemon.atk_iv, pokemon.level, false, pokemon.is_shiny, pokemon.ev_atk);
    const def = calculateStat(megaForm.base_def, pokemon.def_iv, pokemon.level, false, pokemon.is_shiny, pokemon.ev_def);
    const spd = calculateStat(megaForm.base_spd, pokemon.spd_iv, pokemon.level, false, pokemon.is_shiny, pokemon.ev_spe);
    const hp = pokemon.max_hp > 0
      ? Math.min(maxHp, Math.round((pokemon.hp / pokemon.max_hp) * maxHp))
      : maxHp;
    const consumedStone = db.prepare(`
      UPDATE mega_stones SET amount = amount - 1
      WHERE user_id = ? AND stone_name = ? AND amount > 0
    `).run(userId, megaForm.stoneName);
    if (!consumedStone.changes) return { error: 'stone_required', stoneName: megaForm.stoneName };

    db.prepare(`
      UPDATE catches
      SET pokemon_id = ?, name = ?, rarity = 'Mega',
        hp = ?, max_hp = ?, atk = ?, def = ?, spd = ?
      WHERE id = ? AND user_id = ?
    `).run(
      megaForm.id,
      megaForm.name,
      hp,
      maxHp,
      atk,
      def,
      spd,
      pokemon.id,
      userId
    );
    syncDuplicateCatchState(userId, pokemon.id);
    const megaDexNumbers = getPokemonDexNumbersForForms().get(megaForm.id);
    return {
      pokemon: {
        ...pokemon,
        pokemon_id: megaForm.id,
        name: megaForm.name,
        rarity: 'Mega',
        is_shiny: isShiny,
      },
      stone: megaForm.stoneName,
      dexNumber: isShiny ? megaDexNumbers?.shinyDexNumber : megaDexNumbers?.dexNumber,
    };
  }).immediate();
}

const ROTOM_ITEMS = Object.freeze([
  'Rotom Fridge',
  'Rotom Oven',
  'Rotom Pokédex',
  'Rotom Fan',
  'Rotom Lawnmower',
  'Rotom Washer',
]);
const SPECIAL_USER_ITEM_NAMES = Object.freeze([
  'Incubator', 'Super Incubator', 'Incense', 'Pokeradar', 'Boss Coin', 'Swap Ticket',
  'Cooldown Machine', 'Ability Capsule', 'Ability Patch', 'Double XP Ticket', 'Mega Bracelet',
  'Team Medallion',
  'Aux Guard', 'Aux Power', 'Aux Powerguard', 'Team Boost', 'Catching Charm', 'Max Revive',
  'Pomeg Berry', 'Kelpsy Berry', 'Qualot Berry', 'Hondew Berry', 'Grepa Berry', 'Tamato Berry', 'Full Restore',
  ...RESEARCH_ITEM_NAMES,
  ...BATTLE_HELD_ITEM_NAMES,
]);

function isSupportedUserItemName(itemName) {
  return Boolean(
    EVOLUTION_ITEMS[itemName]
    || BOXES[itemName]
    || VOTE_BOXES[itemName]
    || getPromoItemNames().includes(itemName)
    || QUEST_ITEM_NAMES.has(itemName)
    || ROTOM_ITEMS.includes(itemName)
    || RESEARCH_ITEM_NAMES.includes(itemName)
    || SPECIAL_USER_ITEM_NAMES.includes(itemName)
  );
}

function findUserItemName(query) {
  if (typeof query !== 'string' || !query.trim()) return null;
  const normalizedQuery = query.toLowerCase().replace(/[^a-z0-9]/g, '');
  return [
    ...Object.keys(EVOLUTION_ITEMS),
    ...Object.keys(BOXES),
    ...Object.keys(VOTE_BOXES),
    ...getPromoItemNames(),
    ...QUEST_ITEM_NAMES,
    ...ROTOM_ITEMS,
    ...RESEARCH_ITEM_NAMES,
    ...SPECIAL_USER_ITEM_NAMES,
  ].find((itemName) => itemName.toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedQuery) || null;
}

function getUserItems(userId) {
  assertUserId(userId);
  return db.prepare(
    'SELECT item_name, amount FROM user_items WHERE user_id = ? AND amount > 0 ORDER BY item_name'
  ).all(userId);
}

function addUserItem(userId, itemName, amount = 1) {
  assertUserId(userId);
  if (!isSupportedUserItemName(itemName)) {
    throw new TypeError(`Unknown item: ${itemName}.`);
  }
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new TypeError('amount must be a positive safe integer.');
  }
  const isUniqueRelic = RESEARCH_RELICS.some((item) => item.name === itemName);
  if (isUniqueRelic) {
    db.prepare(`
      INSERT INTO user_items (user_id, item_name, amount) VALUES (?, ?, 1)
      ON CONFLICT(user_id, item_name) DO UPDATE SET amount = MIN(1, user_items.amount + 1)
    `).run(userId, itemName);
  } else {
    db.prepare(`
      INSERT INTO user_items (user_id, item_name, amount) VALUES (?, ?, ?)
      ON CONFLICT(user_id, item_name) DO UPDATE SET amount = user_items.amount + excluded.amount
    `).run(userId, itemName, amount);
  }
  if (!suppressQuestItemTracking && QUEST_ITEM_NAMES.has(itemName)) {
    return advanceQuestProgress(userId, { itemCounts: { [itemName]: amount } });
  }
  return [];
}

function findQuestItem(name) {
  if (typeof name !== 'string') return null;
  const normalizedName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalizedName === 'incubator') return 'Incubator';
  if (normalizedName === 'superincubator') return 'Super Incubator';
  return [...QUEST_ITEM_NAMES].find((itemName) =>
    itemName.toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedName
  ) || null;
}

function takeUserItem(userId, itemName, amount = 1) {
  return db.prepare(
    'UPDATE user_items SET amount = amount - ? WHERE user_id = ? AND item_name = ? AND amount >= ?'
  ).run(amount, userId, itemName, amount).changes > 0;
}

function changePokemonAbility(userId, catchId, ability, itemName) {
  assertUserId(userId);
  if (!Number.isSafeInteger(catchId) || catchId <= 0) {
    throw new TypeError('Catch ID must be a positive integer.');
  }
  if (typeof ability !== 'string' || !ability.trim()) {
    throw new TypeError('Ability must be a non-empty string.');
  }
  if (!['Ability Capsule', 'Ability Patch'].includes(itemName)) {
    throw new TypeError('Ability changes require an Ability Capsule or Ability Patch.');
  }
  return db.transaction(() => {
    const pokemon = db.prepare(
      'SELECT id, ability FROM catches WHERE id = ? AND user_id = ?'
    ).get(catchId, userId);
    if (!pokemon) return { error: 'pokemon_not_found' };
    if (pokemon.ability === ability) return { error: 'already_has_ability', ability };
    if (!takeUserItem(userId, itemName)) return { error: 'item_not_owned', itemName };
    db.prepare('UPDATE catches SET ability = ? WHERE id = ? AND user_id = ?')
      .run(ability, catchId, userId);
    return { ability, itemName };
  }).immediate();
}

function resolveSpeciesEvolution(fromSpeciesId, toSpeciesId, catchRow) {
  if (['Mega', 'Gmax'].includes(catchRow.form_rarity)) return null;
  const defaultSlug = (speciesId) => db.prepare(
    'SELECT slug FROM pokemon_forms WHERE species_id = ? AND is_default = 1'
  ).get(speciesId)?.slug;
  const fromSlug = defaultSlug(fromSpeciesId);
  const toSlug = defaultSlug(toSpeciesId);
  if (!fromSlug || !toSlug) return null;
  let targetSlug = toSlug;
  if (!catchRow.form_default) {
    if (!catchRow.form_slug.startsWith(fromSlug)) return null;
    targetSlug = toSlug + catchRow.form_slug.slice(fromSlug.length);
  }
  return db.prepare('SELECT * FROM pokemon_forms WHERE slug = ?').get(targetSlug) || null;
}

function resolveItemEvolution(itemName, catchRow) {
  if (EVOLUTION_ITEMS[itemName].variantOnly && catchRow.form_default) return null;
  const pair = EVOLUTION_ITEMS[itemName].evolutions.find(([from]) => from === catchRow.form_species);
  if (!pair) return null;
  return resolveSpeciesEvolution(pair[0], pair[1], catchRow);
}

function applyPokemonEvolution(userId, row, target, itemName = null, consumesHeldItem = false) {
  const maxHp = calculateStat(target.base_hp, row.hp_iv, row.level, true, row.is_shiny, row.ev_hp);
  const atk = calculateStat(target.base_atk, row.atk_iv, row.level, false, row.is_shiny, row.ev_atk);
  const def = calculateStat(target.base_def, row.def_iv, row.level, false, row.is_shiny, row.ev_def);
  const spd = calculateStat(target.base_spd, row.spd_iv, row.level, false, row.is_shiny, row.ev_spe);
  const hp = row.max_hp > 0
    ? Math.min(maxHp, Math.max(1, Math.round((row.hp / row.max_hp) * maxHp)))
    : maxHp;
  db.prepare(`
    UPDATE catches
    SET pokemon_id = ?, name = ?, rarity = ?, hp = ?, max_hp = ?, atk = ?, def = ?, spd = ?,
      held_item = ?
    WHERE id = ? AND user_id = ?
  `).run(
    target.id,
    target.name,
    row.is_golden ? 'Golden' : target.rarity,
    hp,
    maxHp,
    atk,
    def,
    spd,
    consumesHeldItem ? null : row.held_item,
    row.id,
    userId
  );
  syncDuplicateCatchState(userId, row.id);
  return {
    itemName,
    from: row.name,
    to: target.name,
    level: row.level,
    isShiny: Boolean(row.is_shiny),
    isGolden: Boolean(row.is_golden),
    rarity: row.is_golden ? 'Golden' : target.rarity,
    sprite: row.is_shiny ? (target.shiny_sprite || target.sprite) : target.sprite,
    slug: target.slug,
  };
}

function findOwnedPokemonRows(userId, query) {
  const rawQuery = query.trim().toLowerCase();
  const variantMatch = rawQuery.match(/^(shiny|golden)[\s_-]+(.+)$/);
  const requestedVariant = variantMatch?.[1] || null;
  const needle = (variantMatch ? variantMatch[2] : rawQuery).trim();
  const numericDex = /^\d+$/.test(needle) ? Number(needle) : null;
  const owned = db.prepare(`
    SELECT catches.*, pokemon_forms.species_id AS form_species, pokemon_forms.slug AS form_slug,
      pokemon_forms.name AS form_name, pokemon_forms.species_name AS form_species_name,
      pokemon_forms.is_default AS form_default, pokemon_forms.rarity AS form_rarity
    FROM catches
    JOIN pokemon_forms ON pokemon_forms.id = catches.pokemon_id
    WHERE catches.user_id = ?
    ORDER BY catches.id DESC
  `).all(userId);
  if (numericDex !== null) {
    const dexNumbers = getPokemonDexNumbersForForms();
    return owned.filter((row) => {
      if (row.is_golden) {
        return (!requestedVariant || requestedVariant === 'golden')
          && isGoldenFormSupported(row.form_species, row.form_slug, Boolean(row.form_default))
          && getGoldenDexNumber(row.form_species, row.form_slug) === numericDex;
      }
      if (requestedVariant === 'golden') return false;
      if (requestedVariant === 'shiny' && !row.is_shiny) return false;
      if (!requestedVariant && isGoldenDexNumber(numericDex)) return false;
      const numbers = dexNumbers.get(row.pokemon_id);
      const expectedDex = row.is_shiny ? numbers?.shinyDexNumber : numbers?.dexNumber;
      return expectedDex === numericDex;
    });
  }
  const normalizeName = (value) => `${value || ''}`.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalizedNeedle = normalizeName(needle);
  return owned.filter((row) => {
    if (requestedVariant === 'golden' ? !row.is_golden : Boolean(row.is_golden)) return false;
    if (requestedVariant === 'shiny' ? !row.is_shiny : Boolean(row.is_shiny)) return false;
    return [
      row.name,
      row.form_name,
      row.form_slug,
      ...(row.form_default ? [row.form_species_name] : []),
    ].some((name) => normalizeName(name) === normalizedNeedle);
  });
}

function findUserPokemonMatches(userId, query) {
  assertUserId(userId);
  if (typeof query !== 'string' || !query.trim()) {
    throw new TypeError('Pokémon name or Pokédex number is required.');
  }
  const normalizedQuery = query.trim().toLowerCase();
  const dexQuery = /^\d+$/.test(normalizedQuery) ? Number(normalizedQuery) : null;
  const normalizeName = (value) => `${value || ''}`.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalizedName = normalizeName(normalizedQuery);
  const catches = db.prepare(`
    SELECT catches.*, pokemon_forms.species_id AS form_species,
      pokemon_forms.name AS form_name, pokemon_forms.species_name AS form_species_name,
      pokemon_forms.slug AS form_slug, pokemon_forms.is_default AS form_default
    FROM catches
    LEFT JOIN pokemon_forms ON pokemon_forms.id = catches.pokemon_id
    WHERE catches.user_id = ?
    ORDER BY catches.id DESC
  `).all(userId);

  if (dexQuery !== null) {
    if (!Number.isSafeInteger(dexQuery) || dexQuery <= 0) return [];
    const dexNumbers = getPokemonDexNumbersForForms();
    return catches.filter((pokemon) => {
      const numbers = dexNumbers.get(pokemon.pokemon_id);
      return pokemon.form_species === dexQuery
        || (isGoldenFormSupported(
          pokemon.form_species, pokemon.form_slug, Boolean(pokemon.form_default)
        )
          && getGoldenDexNumber(pokemon.form_species, pokemon.form_slug) === dexQuery)
        || numbers?.dexNumber === dexQuery
        || numbers?.shinyDexNumber === dexQuery;
    });
  }

  return catches.filter((pokemon) => [
    pokemon.name,
    pokemon.form_name,
    pokemon.form_species_name,
    pokemon.form_slug,
  ].some((name) => normalizeName(name) === normalizedName));
}

function setUserPokemonLockByQuery(userId, query, locked) {
  assertUserId(userId);
  if (typeof locked !== 'boolean') throw new TypeError('locked must be a boolean.');
  return db.transaction(() => {
    const matches = findUserPokemonMatches(userId, query);
    if (!matches.length) return { error: 'not_found' };
    const matchingIds = matches.map((pokemon) => pokemon.id);
    const changedCount = db.prepare(
      `UPDATE catches SET is_locked = ? WHERE user_id = ? AND is_locked != ? AND id IN (${matchingIds.map(() => '?').join(', ')})`
    ).run(locked ? 1 : 0, userId, locked ? 1 : 0, ...matchingIds).changes;
    return {
      error: null,
      name: matches[0].name,
      matchedCount: matches.length,
      changedCount,
      locked,
    };
  }).immediate();
}

function holdEvolutionItem(userId, itemQuery, pokemonQuery) {
  assertUserId(userId);
  const itemName = findEvolutionItem(itemQuery) || findBattleHeldItem(itemQuery);
  if (!itemName) return { error: 'unknown_item' };
  if (EVOLUTION_ITEMS[itemName]?.kind !== 'held' && !BATTLE_HELD_ITEM_NAMES.has(itemName)) {
    return { error: 'not_holdable', itemName };
  }
  const researchHeldItem = RESEARCH_HELD_ITEMS.find((item) => item.name === itemName);
  return db.transaction(() => {
    if (researchHeldItem?.requiresRelicExchange
        && getUser(userId).research_relic_unlock_until <= Date.now()) {
      return { error: 'relic_exchange_required', itemName };
    }
    const owned = findOwnedPokemonRows(userId, pokemonQuery);
    if (!owned.length) return { error: 'pokemon_not_owned' };
    const candidates = owned.filter((row) => !row.held_item);
    if (!candidates.length) return { error: 'item_held' };
    const eligibleCandidates = researchHeldItem
      ? candidates.filter((row) => researchHeldItem.species.includes(row.form_species_name))
      : candidates;
    if (!eligibleCandidates.length) return { error: 'ineligible_pokemon', itemName };
    const target = EVOLUTION_ITEMS[itemName]
      ? eligibleCandidates.find((row) => resolveItemEvolution(itemName, row)) || eligibleCandidates[0]
      : eligibleCandidates[0];
    if (!takeUserItem(userId, itemName)) return { error: 'no_item', itemName };
    db.prepare('UPDATE catches SET held_item = ? WHERE id = ? AND user_id = ?')
      .run(itemName, target.id, userId);
    syncDuplicateCatchState(userId, target.id);
    return { itemName, pokemonName: target.name };
  }).immediate();
}

function getResearchHeldItemError(userId, itemName, pokemonId, now = Date.now()) {
  assertUserId(userId);
  const item = RESEARCH_HELD_ITEMS.find((entry) => entry.name === itemName);
  if (!item) return null;
  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError('now must be a non-negative timestamp.');
  if (item.requiresRelicExchange && getUser(userId).research_relic_unlock_until <= now) {
    return 'relic_exchange_required';
  }
  const pokemon = db.prepare(`
    SELECT pokemon_forms.species_name
    FROM catches
    JOIN pokemon_forms ON pokemon_forms.id = catches.pokemon_id
    WHERE catches.id = ? AND catches.user_id = ?
  `).get(pokemonId, userId);
  if (!pokemon) return 'pokemon_not_owned';
  return item.species.includes(pokemon.species_name) ? null : 'ineligible_pokemon';
}

function unholdEvolutionItem(userId, pokemonQuery) {
  assertUserId(userId);
  return db.transaction(() => {
    const owned = findOwnedPokemonRows(userId, pokemonQuery);
    if (!owned.length) return { error: 'pokemon_not_owned' };
    const target = owned.find((row) =>
      EVOLUTION_ITEMS[row.held_item]?.kind === 'held'
      || BATTLE_HELD_ITEM_NAMES.has(row.held_item)
    );
    if (!target) return { error: 'nothing_held' };
    db.prepare('UPDATE catches SET held_item = NULL WHERE id = ? AND user_id = ?')
      .run(target.id, userId);
    syncDuplicateCatchState(userId, target.id);
    addUserItem(userId, target.held_item);
    return { itemName: target.held_item, pokemonName: target.name };
  }).immediate();
}

function evolvePokemonWithItem(userId, pokemonQuery, itemQuery = null) {
  assertUserId(userId);
  let requestedItem = null;
  if (itemQuery) {
    requestedItem = findEvolutionItem(itemQuery);
    if (!requestedItem) return { error: 'unknown_item' };
  }
  return db.transaction(() => {
    const owned = findOwnedPokemonRows(userId, pokemonQuery);
    if (!owned.length) return { error: 'pokemon_not_owned' };

    let chosen = null;
    for (const row of owned) {
      const itemName = requestedItem
        || (EVOLUTION_ITEMS[row.held_item] ? row.held_item : null);
      if (!itemName) continue;
      const isHeld = EVOLUTION_ITEMS[itemName].kind === 'held';
      const alreadyHeld = isHeld && row.held_item === itemName;
      const hasInventoryItem = isHeld && !alreadyHeld && Boolean(db.prepare(
        'SELECT 1 FROM user_items WHERE user_id = ? AND item_name = ? AND amount > 0'
      ).get(userId, itemName));
      if (isHeld && !alreadyHeld && !hasInventoryItem) continue;
      const target = resolveItemEvolution(itemName, row);
      if (target) {
        chosen = {
          row,
          itemName,
          target,
          alreadyHeld,
          needsInventoryItem: isHeld && !alreadyHeld,
        };
        break;
      }
    }
    if (!chosen) {
      if (!requestedItem) return { error: 'no_held_item', pokemonName: owned[0].name };
      const kind = EVOLUTION_ITEMS[requestedItem].kind;
      const compatible = owned.some((row) => resolveItemEvolution(requestedItem, row));
      return {
        error: compatible && kind === 'held' ? 'no_item' : 'cannot_evolve',
        itemName: requestedItem,
        pokemonName: owned[0].name,
      };
    }

    const { row, itemName, target, alreadyHeld, needsInventoryItem } = chosen;
    if (needsInventoryItem && !takeUserItem(userId, itemName)) {
      return { error: 'no_item', itemName, pokemonName: row.name };
    }
    return applyPokemonEvolution(userId, row, target, itemName, alreadyHeld);
  }).immediate();
}

// Compact next-step evolution options for a catch, e.g. "Lv.16 → Ivysaur".
function getEvolutionRoute(catchId) {
  const row = db.prepare(`
    SELECT catches.*, pokemon_forms.species_id AS form_species, pokemon_forms.slug AS form_slug,
      pokemon_forms.is_default AS form_default, pokemon_forms.rarity AS form_rarity
    FROM catches JOIN pokemon_forms ON pokemon_forms.id = catches.pokemon_id
    WHERE catches.id = ?
  `).get(catchId);
  if (!row) return [];
  const routes = [];
  for (const rule of levelEvolutionRules.get(row.form_species) || []) {
    const target = resolveSpeciesEvolution(rule.fromSpeciesId, rule.toSpeciesId, row);
    if (target) routes.push(`Lv.${rule.minLevel} → ${target.name}`);
  }
  for (const rule of friendshipEvolutionRules.get(row.form_species) || []) {
    const target = resolveSpeciesEvolution(rule.fromSpeciesId, rule.toSpeciesId, row);
    if (!target) continue;
    const time = rule.timeOfDay ? ` ${rule.timeOfDay === 'day' ? '☀️' : '🌙'}` : '';
    routes.push(`💖${FRIENDSHIP_EVOLUTION_THRESHOLD}${time} → ${target.name}`);
  }
  const timeRule = TIME_LEVEL_EVOLUTIONS[row.form_species];
  if (timeRule) {
    const names = ['day', 'dusk', 'night'].map((phase) => {
      const form = db.prepare('SELECT name FROM pokemon_forms WHERE slug = ?').get(timeRule.forms[phase]);
      return form ? `${{ day: '☀️', dusk: '🌇', night: '🌙' }[phase]} ${form.name}` : null;
    }).filter(Boolean);
    routes.push(`Lv.${timeRule.minLevel} → ${names.join(' / ')}`);
  }
  for (const [itemName, item] of Object.entries(EVOLUTION_ITEMS)) {
    const target = resolveItemEvolution(itemName, row);
    if (target) routes.push(`${item.emoji || ''} ${itemName} → ${target.name}`.trim());
  }
  return routes;
}

function evolvePokemonByLevel(userId, pokemonQuery) {
  assertUserId(userId);
  return db.transaction(() => {
    const owned = findOwnedPokemonRows(userId, pokemonQuery);
    if (!owned.length) return { error: 'pokemon_not_owned' };

    let nextRequiredLevel = null;
    let friendshipNeeded = false;
    let wrongTime = null;
    for (const row of owned) {
      const friendshipRules = friendshipEvolutionRules.get(row.form_species) || [];
      for (const rule of friendshipRules) {
        const target = resolveSpeciesEvolution(rule.fromSpeciesId, rule.toSpeciesId, row);
        if (!target) continue;
        if (row.friendship < FRIENDSHIP_EVOLUTION_THRESHOLD) {
          friendshipNeeded = true;
          continue;
        }
        if (rule.timeOfDay && rule.timeOfDay !== (isDaytime() ? 'day' : 'night')) {
          wrongTime = rule.timeOfDay;
          continue;
        }
        return { ...applyPokemonEvolution(userId, row, target), friendship: row.friendship };
      }
      const timeRule = TIME_LEVEL_EVOLUTIONS[row.form_species];
      if (timeRule) {
        if (row.level < timeRule.minLevel) {
          nextRequiredLevel = nextRequiredLevel === null
            ? timeRule.minLevel
            : Math.min(nextRequiredLevel, timeRule.minLevel);
        } else {
          const phase = getTimeOfDayPhase();
          const target = db.prepare('SELECT * FROM pokemon_forms WHERE slug = ?').get(timeRule.forms[phase]);
          if (target) return { ...applyPokemonEvolution(userId, row, target), timeOfDay: phase };
        }
      }
      const rules = levelEvolutionRules.get(row.form_species) || [];
      for (const rule of rules) {
        const target = resolveSpeciesEvolution(rule.fromSpeciesId, rule.toSpeciesId, row);
        if (!target) continue;
        if (row.level < rule.minLevel) {
          nextRequiredLevel = nextRequiredLevel === null
            ? rule.minLevel
            : Math.min(nextRequiredLevel, rule.minLevel);
          continue;
        }
        return applyPokemonEvolution(userId, row, target);
      }
    }

    if (wrongTime) {
      return { error: 'wrong_time', pokemonName: owned[0].name, timeOfDay: wrongTime };
    }
    if (friendshipNeeded) {
      return {
        error: 'friendship_required',
        pokemonName: owned[0].name,
        requiredFriendship: FRIENDSHIP_EVOLUTION_THRESHOLD,
        friendship: Math.max(...owned.map((row) => row.friendship)),
      };
    }
    if (nextRequiredLevel !== null) {
      return {
        error: 'level_required',
        pokemonName: owned[0].name,
        requiredLevel: nextRequiredLevel,
      };
    }
    return { error: 'cannot_evolve_by_level', pokemonName: owned[0].name };
  }).immediate();
}

const moveInfoData = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'move-info.json'), 'utf8')
);

function findMoveInfo(query) {
  if (typeof query !== 'string') return null;
  const key = query.trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (!key) return null;
  if (moveInfoData[key]) return moveInfoData[key];
  const compact = key.replace(/-/g, '');
  const match = Object.entries(moveInfoData).find(([slug]) => slug.replace(/-/g, '') === compact);
  return match ? match[1] : null;
}

function getPokemonMove(moveName) {
  if (typeof moveName !== 'string') return null;
  const normalized = moveName.trim().toLowerCase().replace(/\s+/g, '-');
  return pokemonMovesData.moves[normalized] || null;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS saved_teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    team_name TEXT NOT NULL,
    is_defending INTEGER NOT NULL DEFAULT 0,
    pokemon_ids TEXT NOT NULL DEFAULT '[]',
    UNIQUE(user_id, team_name)
  );
  UPDATE catches SET ever_buddy = 1
  WHERE ever_buddy = 0 AND id IN (SELECT buddy_catch_id FROM users WHERE buddy_catch_id IS NOT NULL);
`);

function getSavedTeams(userId) {
  assertUserId(userId);
  return db.prepare('SELECT * FROM saved_teams WHERE user_id = ? ORDER BY id').all(userId);
}

function saveCurrentTeam(userId, teamName, isDefending = false) {
  const team = getUserTeam(userId);
  if (!team.length) return false;
  db.prepare(`
    INSERT INTO saved_teams (user_id, team_name, is_defending, pokemon_ids)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, team_name) DO UPDATE SET
      pokemon_ids = excluded.pokemon_ids,
      is_defending = excluded.is_defending
  `).run(userId, teamName, isDefending ? 1 : 0, JSON.stringify(team.map((mon) => mon.id)));
  return true;
}

function deleteSavedTeam(userId, teamName) {
  assertUserId(userId);
  if (teamName === 'all') {
    return db.prepare('DELETE FROM saved_teams WHERE user_id = ? AND is_defending = 0').run(userId);
  }
  return db.prepare(
    'DELETE FROM saved_teams WHERE user_id = ? AND is_defending = 0 AND LOWER(team_name) = ?'
  ).run(userId, teamName.toLowerCase());
}

function clearDefendingTeam(userId) {
  assertUserId(userId);
  return db.prepare('DELETE FROM saved_teams WHERE user_id = ? AND is_defending = 1').run(userId);
}

function equipSavedTeam(userId, teamName) {
  assertUserId(userId);
  return db.transaction(() => {
    const saved = db.prepare(
      'SELECT * FROM saved_teams WHERE user_id = ? AND is_defending = 0 AND LOWER(team_name) = ?'
    ).get(userId, teamName.toLowerCase());
    if (!saved) return { error: 'not_found' };
    const ids = JSON.parse(saved.pokemon_ids || '[]').slice(0, 3);
    if (!ids.length) return { error: 'empty', saved };
    const owned = ids
      .map((id) => db.prepare('SELECT * FROM catches WHERE id = ? AND user_id = ?').get(id, userId))
      .filter(Boolean);
    if (owned.length < ids.length) return { error: 'missing', saved };
    db.prepare('UPDATE catches SET in_team = 0, team_slot = NULL WHERE user_id = ?').run(userId);
    owned.forEach((mon, index) => {
      db.prepare('UPDATE catches SET in_team = 1, team_slot = ? WHERE id = ? AND user_id = ?')
        .run(index + 1, mon.id, userId);
    });
    return { saved, team: owned };
  }).immediate();
}

// Stored in saved_teams with is_defending = 2 so favorites/defending lists ignore it.
const LAST_WORLD_BOSS_TEAM_NAME = '__last_world_boss__';

function saveLastWorldBossTeam(userId, team) {
  assertUserId(userId);
  if (!team.length) return false;
  db.prepare(`
    INSERT INTO saved_teams (user_id, team_name, is_defending, pokemon_ids)
    VALUES (?, ?, 2, ?)
    ON CONFLICT(user_id, team_name) DO UPDATE SET pokemon_ids = excluded.pokemon_ids
  `).run(userId, LAST_WORLD_BOSS_TEAM_NAME, JSON.stringify(team.slice(0, 3).map((mon) => mon.id)));
  return true;
}

// Returns the Pokémon still owned from the last World Boss team, or null if none remain.
function getLastWorldBossTeam(userId) {
  assertUserId(userId);
  const saved = db.prepare(
    'SELECT pokemon_ids FROM saved_teams WHERE user_id = ? AND team_name = ?'
  ).get(userId, LAST_WORLD_BOSS_TEAM_NAME);
  if (!saved) return null;
  const owned = JSON.parse(saved.pokemon_ids || '[]').slice(0, 3)
    .map((id) => db.prepare('SELECT * FROM catches WHERE id = ? AND user_id = ?').get(id, userId))
    .filter(Boolean);
  return owned.length ? owned : null;
}

function equipLastWorldBossTeam(userId) {
  assertUserId(userId);
  return db.transaction(() => {
    const team = getLastWorldBossTeam(userId);
    if (!team) return null;
    db.prepare('UPDATE catches SET in_team = 0, team_slot = NULL WHERE user_id = ?').run(userId);
    team.forEach((mon, index) => {
      db.prepare('UPDATE catches SET in_team = 1, team_slot = ? WHERE id = ? AND user_id = ?')
        .run(index + 1, mon.id, userId);
    });
    return team;
  }).immediate();
}

function getUserBuddyHistory(userId, sortBy = 'ivs') {
  assertUserId(userId);
  const rows = db.prepare(`
    SELECT * FROM catches WHERE user_id = ? AND ever_buddy = 1
  `).all(userId).map((mon) => ({
    ...mon,
    iv_percent: (
      (mon.hp_iv + mon.atk_iv + mon.def_iv + mon.spa_iv + mon.spdef_iv + mon.spd_iv) / 186
    ) * 100,
  }));
  const compareIv = (a, b) => b.iv_percent - a.iv_percent || b.id - a.id;
  let compareRows = compareIv;
  if (sortBy === 'num') {
    compareRows = (a, b) => a.pokemon_id - b.pokemon_id || compareIv(a, b);
  }
  if (sortBy === 'stats' || sortBy === 'evs') {
    compareRows = (a, b) =>
      (b.level * 1e6 + b.experience) - (a.level * 1e6 + a.experience) || compareIv(a, b);
  }
  const uniqueBuddies = new Map();
  for (const pokemon of rows.sort(compareRows)) {
    const key = `${pokemon.pokemon_id}:${pokemon.is_shiny ? 1 : 0}:${pokemon.is_golden ? 1 : 0}`;
    if (!uniqueBuddies.has(key)) uniqueBuddies.set(key, pokemon);
  }
  const activeBuddyId = getUser(userId).buddy_catch_id;
  const activeBuddy = rows.find((pokemon) => pokemon.id === activeBuddyId);
  if (activeBuddy) {
    uniqueBuddies.set(
      `${activeBuddy.pokemon_id}:${activeBuddy.is_shiny ? 1 : 0}:${activeBuddy.is_golden ? 1 : 0}`,
      activeBuddy
    );
  }
  return [...uniqueBuddies.values()].sort(compareRows);
}

function getUserTeam(userId) {
  assertUserId(userId);
  return db.prepare(
    `SELECT catches.*, pokemon_forms.name AS form_name, pokemon_forms.slug AS form_slug,
      pokemon_forms.base_spa, pokemon_forms.base_spdef, pokemon_forms.types
    FROM catches
    LEFT JOIN pokemon_forms ON pokemon_forms.id = catches.pokemon_id
    WHERE catches.user_id = ? AND catches.in_team = 1
    ORDER BY catches.team_slot, catches.id LIMIT 3`
  ).all(userId).map((pokemon) => ({
    ...pokemon,
    spa: calculateStat(pokemon.base_spa ?? 50, pokemon.spa_iv, pokemon.level, false, Boolean(pokemon.is_shiny), pokemon.ev_spa),
    spdef: calculateStat(pokemon.base_spdef ?? 50, pokemon.spdef_iv, pokemon.level, false, Boolean(pokemon.is_shiny), pokemon.ev_spdef),
  }));
}

function getUserBuddy(userId) {
  assertUserId(userId);
  const buddyId = getUser(userId).buddy_catch_id;
  if (!buddyId) return null;
  const buddy = db.prepare(`
    SELECT catches.*, pokemon_forms.types, pokemon_forms.slug,
      pokemon_forms.sprite, pokemon_forms.shiny_sprite,
      pokemon_forms.id AS form_id, pokemon_forms.species_id,
      COALESCE(pokemon_forms.species_id, catches.pokemon_id)
        + CASE WHEN catches.is_shiny = 1 THEN 1000 ELSE 0 END AS dex_number,
      pokemon_forms.base_hp, pokemon_forms.base_atk, pokemon_forms.base_def,
      pokemon_forms.base_spa, pokemon_forms.base_spdef, pokemon_forms.base_spd
    FROM catches
    LEFT JOIN pokemon_forms ON pokemon_forms.id = catches.pokemon_id
    WHERE catches.id = ? AND catches.user_id = ?
  `).get(buddyId, userId);
  if (!buddy) return null;
  buddy.spa = calculateStat(
    buddy.base_spa ?? 50, buddy.spa_iv, buddy.level, false, Boolean(buddy.is_shiny), buddy.ev_spa
  );
  buddy.spdef = calculateStat(
    buddy.base_spdef ?? 50, buddy.spdef_iv, buddy.level, false, Boolean(buddy.is_shiny), buddy.ev_spdef
  );
  if (buddy.is_golden) buddy.rarity = 'Golden';
  buddy.nickname = db.prepare('SELECT value FROM bot_settings WHERE key = ?')
    .get(`buddy_nickname:${userId}:${buddy.id}`)?.value || null;
  buddy.display_name = buddy.nickname || buddy.name;
  const dexNumbers = getPokemonDexNumbersForForms().get(buddy.form_id);
  if (buddy.is_golden) {
    buddy.dex_number = getGoldenDexNumber(buddy.species_id, buddy.slug);
  } else if (dexNumbers) {
    buddy.dex_number = buddy.is_shiny
      ? dexNumbers.shinyDexNumber ?? dexNumbers.dexNumber
      : dexNumbers.dexNumber;
  }
  return buddy;
}

function getPokemonDexNumbersForForms() {
  return getPokemonDexNumbers(db.prepare(`
    SELECT id, species_id, name, slug, is_default
    FROM pokemon_forms
    ORDER BY species_id, id
  `).all());
}

function setUserBuddyByQuery(userId, query) {
  assertUserId(userId);
  if (typeof query !== 'string' || !query.trim()) {
    throw new TypeError('Pokémon name or Pokédex number is required.');
  }
  const rawQuery = query.trim().toLowerCase();
  const forceGolden = /^golden[\s_-]+/.test(rawQuery);
  const strippedQuery = forceGolden ? rawQuery.replace(/^golden[\s_-]+/, '') : rawQuery;
  const forceShiny = !forceGolden && /^shiny[\s_-]+/.test(strippedQuery);
  const name = forceShiny ? strippedQuery.replace(/^shiny[\s_-]+/, '') : strippedQuery;
  const normalizeName = (value) => `${value || ''}`.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalizedName = normalizeName(name);
  return db.transaction(() => {
    const numericDex = /^\d+$/.test(name.trim()) ? Number(name.trim()) : null;
    let pokemon;
    if (numericDex !== null && (forceGolden || isGoldenDexNumber(numericDex))) {
      const match = db.prepare(`
        SELECT catches.id, pokemon_forms.species_id, pokemon_forms.slug, pokemon_forms.is_default
        FROM catches
        LEFT JOIN pokemon_forms ON pokemon_forms.id = catches.pokemon_id
        WHERE catches.user_id = ? AND catches.is_golden = 1
        ORDER BY catches.id DESC
      `).all(userId).find((row) =>
        isGoldenFormSupported(row.species_id, row.slug, Boolean(row.is_default))
        && getGoldenDexNumber(row.species_id, row.slug) === numericDex
        || (forceGolden && row.species_id === numericDex));
      if (match) pokemon = { id: match.id };
    } else if (numericDex !== null) {
      const dexNumbers = getPokemonDexNumbersForForms();
      const ownedCatches = db.prepare(`
        SELECT id, pokemon_id, is_shiny
        FROM catches
        WHERE user_id = ? AND is_golden = 0
        ORDER BY id DESC
      `).all(userId);
      const match = ownedCatches.find((catchRecord) => {
        const formDex = dexNumbers.get(catchRecord.pokemon_id);
        if (!formDex) return false;
        const catchDex = catchRecord.is_shiny
          ? formDex.shinyDexNumber ?? formDex.dexNumber
          : formDex.dexNumber;
        return catchDex === numericDex;
      });
      if (match) pokemon = { id: match.id };
    } else {
      const findNameMatch = (isGolden) => db.prepare(`
        SELECT catches.id, catches.name AS catch_name, catches.is_shiny,
          pokemon_forms.name AS form_name, pokemon_forms.species_name, pokemon_forms.slug
        FROM catches
        LEFT JOIN pokemon_forms ON pokemon_forms.id = catches.pokemon_id
        WHERE catches.user_id = ?
          AND catches.is_shiny = ?
          AND catches.is_golden = ?
        ORDER BY catches.id DESC
      `).all(userId, forceShiny ? 1 : 0, isGolden ? 1 : 0)
        .map((catchRecord) => ({
          ...catchRecord,
          exactNameMatch: [
            catchRecord.catch_name,
            catchRecord.form_name,
            catchRecord.slug,
          ].some((candidate) => normalizeName(candidate) === normalizedName),
          speciesNameMatch: normalizeName(catchRecord.species_name) === normalizedName,
        }))
        .filter((catchRecord) => catchRecord.exactNameMatch || catchRecord.speciesNameMatch)
        .sort((first, second) =>
          Number(second.exactNameMatch) - Number(first.exactNameMatch)
          || second.id - first.id
        )[0];
      const match = findNameMatch(forceGolden)
        || (!forceGolden && !forceShiny ? findNameMatch(true) : null);
      if (match) pokemon = { id: match.id };
    }
    if (!pokemon) return null;
    updateUser(userId, { buddy_catch_id: pokemon.id });
    db.prepare('UPDATE catches SET ever_buddy = 1 WHERE id = ? AND user_id = ?').run(pokemon.id, userId);
    syncDuplicateCatchState(userId, pokemon.id);
    return getUserBuddy(userId);
  }).immediate();
}

function setTeamExpShare(userId, enabled) {
  assertUserId(userId);
  if (typeof enabled !== 'boolean') throw new TypeError('enabled must be a boolean.');
  return db.transaction(() => {
    const user = getUser(userId);
    if (enabled && !user.exp_share_owned) return { error: 'not_owned' };
    updateUser(userId, { team_exp_share: enabled ? 1 : 0 });
    return { enabled };
  }).immediate();
}

function experienceForNextLevel(level) {
  return (level + 1) ** 2 * 75;
}

function awardCatchExperience(userId, amount = 200) {
  assertUserId(userId);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new TypeError('Experience amount must be a positive safe integer.');
  }

  return db.transaction(() => {
    const user = getUser(userId);
    if (user.double_xp_charges > 0) {
      amount *= 2;
      db.prepare('UPDATE users SET double_xp_charges = double_xp_charges - 1 WHERE id = ?').run(userId);
    }
    const team = user.team_exp_share ? getUserTeam(userId) : [];
    const recipientExperience = new Map();
    const recipientGroups = new Set();
    if (user.buddy_catch_id) {
      const buddy = db.prepare(`
        SELECT pokemon_id, is_shiny, is_golden
        FROM catches
        WHERE id = ? AND user_id = ?
      `).get(user.buddy_catch_id, userId);
      if (buddy) {
        const key = `${buddy.pokemon_id}:${buddy.is_shiny}:${buddy.is_golden}`;
        const buddyIsOnTeam = team.some((pokemon) => pokemon.id === user.buddy_catch_id);
        recipientExperience.set(
          user.buddy_catch_id,
          buddyIsOnTeam ? Math.floor(amount * 1.33) : amount
        );
        recipientGroups.add(key);
      } else {
        recipientExperience.set(user.buddy_catch_id, amount);
      }
    }
    if (user.team_exp_share) {
      for (const pokemon of team) {
        if (pokemon.id === user.buddy_catch_id) continue;
        const key = `${pokemon.pokemon_id}:${pokemon.is_shiny}:${pokemon.is_golden}`;
        if (recipientGroups.has(key)) continue;
        recipientExperience.set(pokemon.id, Math.floor(amount / 3));
        recipientGroups.add(key);
      }
    }

    const levelUps = [];
    const awardedPokemon = [];
    const awardedCatchIds = new Set();
    for (const [catchId, experienceAmount] of recipientExperience) {
      const pokemon = db.prepare(`
        SELECT catches.*, pokemon_forms.base_hp, pokemon_forms.base_atk,
          pokemon_forms.base_def, pokemon_forms.base_spd
        FROM catches
        LEFT JOIN pokemon_forms ON pokemon_forms.id = catches.pokemon_id
        WHERE catches.id = ? AND catches.user_id = ?
      `).get(catchId, userId);
      if (!pokemon) {
        if (catchId === user.buddy_catch_id) {
          updateUser(userId, { buddy_catch_id: null });
        }
        continue;
      }

      const experience = pokemon.experience + experienceAmount;
      let level = pokemon.level;
      while (level < 100 && experience >= experienceForNextLevel(level)) level += 1;
      const baseHp = pokemon.base_hp ?? 50;
      const baseAtk = pokemon.base_atk ?? 50;
      const baseDef = pokemon.base_def ?? 50;
      const baseSpd = pokemon.base_spd ?? 50;
      const maxHp = calculateStat(baseHp, pokemon.hp_iv, level, true, pokemon.is_shiny, pokemon.ev_hp);
      const atk = calculateStat(baseAtk, pokemon.atk_iv, level, false, pokemon.is_shiny, pokemon.ev_atk);
      const def = calculateStat(baseDef, pokemon.def_iv, level, false, pokemon.is_shiny, pokemon.ev_def);
      const spd = calculateStat(baseSpd, pokemon.spd_iv, level, false, pokemon.is_shiny, pokemon.ev_spe);
      const hp = Math.min(maxHp, pokemon.hp + (maxHp - pokemon.max_hp));
      db.prepare(`
        UPDATE catches
        SET experience = ?, level = ?, hp = ?, max_hp = ?, atk = ?, def = ?, spd = ?
        WHERE id = ? AND user_id = ?
      `).run(experience, level, hp, maxHp, atk, def, spd, catchId, userId);
      awardedCatchIds.add(catchId);
      awardedPokemon.push({
        name: pokemon.name,
        is_shiny: Boolean(pokemon.is_shiny),
        is_buddy: catchId === user.buddy_catch_id,
        on_team: team.some((member) => member.id === catchId),
        experience: experienceAmount,
      });
      if (level > pokemon.level) {
        levelUps.push({ name: pokemon.name, from: pokemon.level, to: level });
      }
    }

    if (user.buddy_catch_id && awardedCatchIds.has(user.buddy_catch_id)) {
      incrementUser(userId, { buddy_exp: recipientExperience.get(user.buddy_catch_id) });
    }
    const synchronizedGroups = new Set();
    for (const catchId of [user.buddy_catch_id, ...awardedCatchIds]) {
      if (!catchId) continue;
      const identity = db.prepare(`
        SELECT pokemon_id, is_shiny, is_golden
        FROM catches
        WHERE id = ? AND user_id = ?
      `).get(catchId, userId);
      if (!identity) continue;
      const key = `${identity.pokemon_id}:${identity.is_shiny}:${identity.is_golden}`;
      if (synchronizedGroups.has(key)) continue;
      synchronizedGroups.add(key);
      syncDuplicateCatchState(userId, catchId);
    }
    return { awarded: awardedPokemon.length, pokemon: awardedPokemon, levelUps };
  }).immediate();
}

// Rare Candies can only be used on the user's buddy. `amount` is a positive integer or 'all'.
function useRareCandy(userId, amount = 1) {
  assertUserId(userId);
  const useAll = amount === 'all';
  if (!useAll && (!Number.isSafeInteger(amount) || amount <= 0)) {
    throw new TypeError("amount must be a positive safe integer or 'all'.");
  }

  return db.transaction(() => {
    const catchId = getUser(userId).buddy_catch_id;
    if (!catchId) return { error: 'no_buddy' };

    const pokemon = db.prepare(`
      SELECT catches.*, pokemon_forms.base_hp, pokemon_forms.base_atk,
        pokemon_forms.base_def, pokemon_forms.base_spd
      FROM catches
      LEFT JOIN pokemon_forms ON pokemon_forms.id = catches.pokemon_id
      WHERE catches.id = ? AND catches.user_id = ?
    `).get(catchId, userId);
    if (!pokemon) return { error: 'no_buddy' };
    if (pokemon.level >= 100) return { error: 'max_level' };

    const user = getUser(userId);
    if (user.rare_candies < 1) return { error: 'no_candies' };
    const requested = useAll ? 100 - pokemon.level : amount;
    const levelsGained = Math.min(requested, user.rare_candies, 100 - pokemon.level);
    const level = pokemon.level + levelsGained;
    const experience = Math.max(pokemon.experience, experienceForNextLevel(level - 1));
    const maxHp = calculateStat(pokemon.base_hp ?? 50, pokemon.hp_iv, level, true, pokemon.is_shiny, pokemon.ev_hp);
    const atk = calculateStat(pokemon.base_atk ?? 50, pokemon.atk_iv, level, false, pokemon.is_shiny, pokemon.ev_atk);
    const def = calculateStat(pokemon.base_def ?? 50, pokemon.def_iv, level, false, pokemon.is_shiny, pokemon.ev_def);
    const spd = calculateStat(pokemon.base_spd ?? 50, pokemon.spd_iv, level, false, pokemon.is_shiny, pokemon.ev_spe);
    const hp = Math.min(maxHp, pokemon.hp + (maxHp - pokemon.max_hp));

    incrementUser(userId, {
      rare_candies: -levelsGained,
      rare_candies_used: levelsGained,
    });
    db.prepare(`
      UPDATE catches
      SET experience = ?, level = ?, hp = ?, max_hp = ?, atk = ?, def = ?, spd = ?
      WHERE id = ? AND user_id = ?
    `).run(experience, level, hp, maxHp, atk, def, spd, catchId, userId);
    syncDuplicateCatchState(userId, catchId);
    return { pokemon, levelsGained, level, experience };
  }).immediate();
}

// Grants EVs to the given catches (capped per stat and in total) and refreshes their stats.
function awardPokemonEvs(userId, catchIds, stat, amount = EV_PER_BATTLE) {
  assertUserId(userId);
  if (!EV_STATS.includes(stat)) throw new TypeError(`Unknown EV stat "${stat}".`);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new TypeError('amount must be a positive safe integer.');
  return db.transaction(() => {
    const results = [];
    const handledGroups = new Set();
    for (const catchId of new Set(catchIds)) {
      const pokemon = db.prepare(`
        SELECT catches.*, pokemon_forms.base_hp, pokemon_forms.base_atk,
          pokemon_forms.base_def, pokemon_forms.base_spd
        FROM catches
        LEFT JOIN pokemon_forms ON pokemon_forms.id = catches.pokemon_id
        WHERE catches.id = ? AND catches.user_id = ?
      `).get(catchId, userId);
      if (!pokemon) continue;
      // Identical copies share one state, so each group is only trained once.
      const groupKey = `${pokemon.pokemon_id}:${pokemon.is_shiny}:${pokemon.is_golden}`;
      if (handledGroups.has(groupKey)) continue;
      handledGroups.add(groupKey);
      const evs = Object.fromEntries(EV_STATS.map((key) => [key, pokemon[`ev_${key}`] || 0]));
      let total = EV_STATS.reduce((sum, key) => sum + evs[key], 0);
      const grant = (key, wanted) => {
        const granted = Math.max(0, Math.min(wanted, EV_STAT_LIMIT - evs[key], EV_TOTAL_LIMIT - total));
        evs[key] += granted;
        total += granted;
        return granted;
      };
      const gained = grant(stat, amount);
      const powerStat = POWER_ITEM_EVS[pokemon.held_item];
      const bonusGained = powerStat ? grant(powerStat, POWER_ITEM_EV_BONUS) : 0;
      results.push({
        id: catchId,
        name: pokemon.name,
        gained,
        total,
        value: evs[stat],
        bonus: powerStat ? { stat: powerStat, gained: bonusGained, item: pokemon.held_item } : null,
      });
      if (!gained && !bonusGained) continue;
      const maxHp = calculateStat(pokemon.base_hp ?? 50, pokemon.hp_iv, pokemon.level, true, pokemon.is_shiny, evs.hp);
      const atk = calculateStat(pokemon.base_atk ?? 50, pokemon.atk_iv, pokemon.level, false, pokemon.is_shiny, evs.atk);
      const def = calculateStat(pokemon.base_def ?? 50, pokemon.def_iv, pokemon.level, false, pokemon.is_shiny, evs.def);
      const spd = calculateStat(pokemon.base_spd ?? 50, pokemon.spd_iv, pokemon.level, false, pokemon.is_shiny, evs.spe);
      const hp = Math.min(maxHp, Math.max(1, pokemon.hp + (maxHp - pokemon.max_hp)));
      db.prepare(`
        UPDATE catches
        SET ev_hp = ?, ev_atk = ?, ev_def = ?, ev_spa = ?, ev_spdef = ?, ev_spe = ?,
          hp = ?, max_hp = ?, atk = ?, def = ?, spd = ?
        WHERE id = ? AND user_id = ?
      `).run(evs.hp, evs.atk, evs.def, evs.spa, evs.spdef, evs.spe, hp, maxHp, atk, def, spd, catchId, userId);
      syncDuplicateCatchState(userId, catchId);
    }
    return results;
  }).immediate();
}

function setCatchTeamStatus(userId, catchId, inTeam) {
  assertUserId(userId);
  if (!Number.isSafeInteger(catchId) || catchId <= 0) {
    throw new TypeError('catchId must be a positive safe integer.');
  }
  if (typeof inTeam !== 'boolean') {
    throw new TypeError('inTeam must be a boolean.');
  }

  return db.transaction(() => {
    const pokemon = db.prepare(
      'SELECT * FROM catches WHERE id = ? AND user_id = ?'
    ).get(catchId, userId);
    if (!pokemon) return { error: 'not_found' };
    if (Boolean(pokemon.in_team) === inTeam) {
      return { error: inTeam ? 'already_in_team' : 'not_in_team' };
    }
    if (inTeam) {
      const count = db.prepare(
        'SELECT COUNT(*) AS count FROM catches WHERE user_id = ? AND in_team = 1'
      ).get(userId).count;
      if (count >= 3) return { error: 'team_full' };
      const occupiedSlots = new Set(db.prepare(
        'SELECT team_slot FROM catches WHERE user_id = ? AND in_team = 1'
      ).all(userId).map((entry) => entry.team_slot));
      const nextSlot = [1, 2, 3].find((slot) => !occupiedSlots.has(slot));
      db.prepare('UPDATE catches SET in_team = 1, team_slot = ? WHERE id = ? AND user_id = ?')
        .run(nextSlot, catchId, userId);
    } else {
      db.prepare('UPDATE catches SET in_team = 0, team_slot = NULL WHERE id = ? AND user_id = ?')
        .run(catchId, userId);
    }
    return { pokemon };
  }).immediate();
}

function setTeamCatchByQuery(userId, query, slot) {
  assertUserId(userId);
  if (typeof query !== 'string' || !query.trim()) {
    throw new TypeError('Pokémon name or Pokédex number is required.');
  }
  if (!Number.isSafeInteger(slot) || slot < 1 || slot > 3) {
    throw new TypeError('Team slot must be an integer from 1 to 3.');
  }

  const rawQuery = query.trim().toLowerCase();
  const variantMatch = rawQuery.match(/^(shiny|golden)[\s_-]+(.+)$/);
  const requestedVariant = variantMatch?.[1] || null;
  const normalized = (variantMatch ? variantMatch[2] : rawQuery).trim();
  const dexNumber = /^\d+$/.test(normalized) ? Number(normalized) : null;
  return db.transaction(() => {
    let pokemon;
    if (dexNumber !== null) {
      const dexNumbers = getPokemonDexNumbersForForms();
      const ownedCatches = db.prepare(`
        SELECT catches.*, pokemon_forms.species_id, pokemon_forms.slug
        FROM catches
        LEFT JOIN pokemon_forms ON pokemon_forms.id = catches.pokemon_id
        WHERE catches.user_id = ?
        ORDER BY catches.id
      `).all(userId);
      pokemon = ownedCatches.find((catchRecord) => {
        const isGoldenDex = isGoldenDexNumber(dexNumber);
        if (Boolean(catchRecord.is_golden) !== isGoldenDex) return false;
        if (requestedVariant === 'shiny' && !catchRecord.is_shiny) return false;
        if (requestedVariant === 'golden' && !catchRecord.is_golden) return false;
        let catchDex;
        if (catchRecord.is_golden) {
          catchDex = getGoldenDexNumber(catchRecord.species_id, catchRecord.slug);
        } else {
          const formDex = dexNumbers.get(catchRecord.pokemon_id);
          if (!formDex) return false;
          catchDex = catchRecord.is_shiny
            ? formDex.shinyDexNumber ?? formDex.dexNumber
            : formDex.dexNumber;
        }
        return catchDex === dexNumber;
      });
    } else {
      const normalizedName = normalized.replace(/[^a-z0-9]/g, '');
      const requestedIsShiny = requestedVariant === 'shiny' ? 1 : 0;
      const requestedIsGolden = requestedVariant === 'golden' ? 1 : 0;
      const ownedCatches = db.prepare(`
        SELECT catches.*, pokemon_forms.name AS form_name,
          pokemon_forms.species_name AS form_species_name,
          pokemon_forms.slug AS form_slug, pokemon_forms.is_default AS form_is_default
        FROM catches
        LEFT JOIN pokemon_forms ON pokemon_forms.id = catches.pokemon_id
        WHERE catches.user_id = ? AND catches.is_shiny = ? AND catches.is_golden = ?
        ORDER BY catches.id
      `).all(userId, requestedIsShiny, requestedIsGolden);
      pokemon = ownedCatches.find((catchRecord) => {
        const matchesForm = [catchRecord.form_name, catchRecord.form_slug]
          .some((name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedName);
        const matchesDefaultSpecies = Boolean(catchRecord.form_is_default)
          && String(catchRecord.form_species_name || '').toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedName;
        return matchesForm || matchesDefaultSpecies;
      });
    }
    if (!pokemon) return { error: 'not_found' };

    const displaced = db.prepare(
      'SELECT * FROM catches WHERE user_id = ? AND in_team = 1 AND team_slot = ?'
    ).get(userId, slot);
    if (displaced && displaced.id !== pokemon.id) {
      db.prepare('UPDATE catches SET in_team = 0, team_slot = NULL WHERE id = ?')
        .run(displaced.id);
    }
    db.prepare('UPDATE catches SET in_team = 0, team_slot = NULL WHERE user_id = ? AND id = ?')
      .run(userId, pokemon.id);
    db.prepare('UPDATE catches SET in_team = 1, team_slot = ? WHERE id = ? AND user_id = ?')
      .run(slot, pokemon.id, userId);
    return { pokemon, displaced: displaced?.id === pokemon.id ? null : displaced || null, slot };
  }).immediate();
}

function swapTeamSlots(userId, slotA, slotB) {
  assertUserId(userId);
  for (const slot of [slotA, slotB]) {
    if (!Number.isSafeInteger(slot) || slot < 1 || slot > 3) {
      throw new TypeError('Team slot must be an integer from 1 to 3.');
    }
  }
  return db.transaction(() => {
    const find = db.prepare(
      'SELECT * FROM catches WHERE user_id = ? AND in_team = 1 AND team_slot = ?'
    );
    const first = find.get(userId, slotA);
    const second = find.get(userId, slotB);
    if (!first && !second) return { error: 'empty' };
    const setSlot = db.prepare('UPDATE catches SET team_slot = ? WHERE id = ? AND user_id = ?');
    if (first) setSlot.run(slotB, first.id, userId);
    if (second) setSlot.run(slotA, second.id, userId);
    return { first, second };
  }).immediate();
}

function removeTeamSlot(userId, slot) {
  assertUserId(userId);
  if (!Number.isSafeInteger(slot) || slot < 1 || slot > 3) {
    throw new TypeError('Team slot must be an integer from 1 to 3.');
  }
  const pokemon = db.prepare(
    'SELECT * FROM catches WHERE user_id = ? AND in_team = 1 AND team_slot = ?'
  ).get(userId, slot);
  if (!pokemon) return null;
  db.prepare('UPDATE catches SET in_team = 0, team_slot = NULL WHERE id = ? AND user_id = ?')
    .run(pokemon.id, userId);
  return pokemon;
}

function getUserCatches(userId) {
  assertUserId(userId);
  return db.prepare(
    'SELECT * FROM catches WHERE user_id = ? ORDER BY id DESC LIMIT 15'
  ).all(userId);
}

function getDexIndexOffset() {
  return 1000;
}

function findPokemonForms(query, limit = 10) {
  if (typeof query !== 'string' || query.trim().length === 0) return [];
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 50) {
    throw new TypeError('limit must be an integer between 1 and 50.');
  }

  const normalized = query.trim().toLowerCase().replace(/[\s_]+/g, '-');
  const normalizedPrefix = `${normalized.replace(/[\\%_]/g, '\\$&')}%`;
  return db.prepare(`
    SELECT * FROM pokemon_forms
    WHERE lower(replace(name, ' ', '-')) = ?
       OR lower(replace(species_name, ' ', '-')) = ?
       OR lower(slug) = ?
       OR lower(replace(name, ' ', '-')) LIKE ? ESCAPE '\\'
       OR lower(slug) LIKE ? ESCAPE '\\'
       OR lower(replace(species_name, ' ', '-')) LIKE ? ESCAPE '\\'
    ORDER BY is_default DESC, id
    LIMIT ?
  `).all(
    normalized,
    normalized,
    normalized,
    normalizedPrefix,
    normalizedPrefix,
    normalizedPrefix,
    limit
  );
}

const SPECIAL_SPAWN_RESERVED_SPECIES = Object.freeze([
  'Darkrai',
  'Shaymin',
  'Arceus',
  'Reshiram',
  'Zekrom',
  'Kyurem',
  'Meloetta',
  'Diancie',
  'Hoopa',
  'Volcanion',
  'Keldeo',
  'Genesect',
  'Solgaleo',
  'Lunala',
]);

function getRandomPokemon(
  rarity = null,
  waterOnly = false,
  excludeGmax = false,
  excludeMega = false,
  allowedFormIds = null,
  excludedSpeciesNames = [],
  exactFormIds = null
) {
  const exactFilter = exactFormIds && exactFormIds.length
    ? `AND id IN (${exactFormIds.map(() => '?').join(', ')})`
    : '';
  if (allowedFormIds !== null
      && (!Array.isArray(allowedFormIds)
        || allowedFormIds.some((id) => !Number.isSafeInteger(id) || id <= 0))) {
    throw new TypeError('allowedFormIds must be null or an array of positive Pokémon form IDs.');
  }
  if (!Array.isArray(excludedSpeciesNames)
      || excludedSpeciesNames.some((name) => typeof name !== 'string' || !name.trim())) {
    throw new TypeError('excludedSpeciesNames must be an array of non-empty strings.');
  }
  const formFilter = allowedFormIds === null
    ? ''
    : `AND (is_default = 1${
      allowedFormIds.length ? ` OR id IN (${allowedFormIds.map(() => '?').join(', ')})` : ''
    })`;
  const excludedSpeciesFilter = excludedSpeciesNames.length
    ? `AND lower(species_name) NOT IN (${excludedSpeciesNames.map(() => '?').join(', ')})`
    : '';
  const select = db.prepare(`
    SELECT * FROM pokemon_forms
    WHERE (? IS NULL OR rarity = ?)
      AND (? = 0 OR is_water = 1)
      AND (? = 0 OR lower(rarity) NOT IN ('mega', 'shiny mega'))
      AND (
        ? = 0
        OR (
          lower(rarity) <> 'gmax'
          AND lower(name) NOT LIKE '%gmax%'
          AND lower(name) NOT LIKE '%gigantamax%'
          AND lower(name) NOT LIKE '%eternamax%'
        )
      )
      ${formFilter}
      ${exactFilter}
      ${excludedSpeciesFilter}
    ORDER BY RANDOM()
    LIMIT 1
  `);

  const attempts = [
    [rarity, waterOnly],
    [null, waterOnly],
    [rarity, false],
    [null, false],
  ];
  for (const [rarityFilter, waterFilter] of attempts) {
    const pokemon = select.get(
      rarityFilter,
      rarityFilter,
      waterFilter ? 1 : 0,
      excludeMega ? 1 : 0,
      excludeGmax ? 1 : 0,
      ...(allowedFormIds || []),
      ...(exactFormIds || []),
      ...excludedSpeciesNames.map((name) => name.toLowerCase())
    );
    if (pokemon) {
      return {
        id: pokemon.id,
        speciesId: pokemon.species_id,
        slug: pokemon.slug,
        name: pokemon.name,
        speciesName: pokemon.species_name,
        rarity: pokemon.rarity,
        baseHp: pokemon.base_hp,
        baseAtk: pokemon.base_atk,
        baseDef: pokemon.base_def,
        baseSpd: pokemon.base_spd,
        img: pokemon.sprite,
        shinyImg: pokemon.shiny_sprite,
        types: JSON.parse(pokemon.types),
        isDefault: Boolean(pokemon.is_default),
        isLegendary: Boolean(pokemon.is_legendary),
        isMythical: Boolean(pokemon.is_mythical),
      };
    }
  }
  throw new Error('Pokémon catalog contains no spawnable entries.');
}

function getRaritySettings() {
  const rarities = db.prepare(`
    SELECT settings.name, settings.spawn_weight, settings.catch_chance,
      COUNT(pokemon.id) AS pokemon_count
    FROM pokemon_rarity_settings AS settings
    LEFT JOIN pokemon_forms AS pokemon ON pokemon.rarity = settings.name
    GROUP BY settings.name
    ORDER BY settings.spawn_weight DESC, settings.name COLLATE NOCASE
  `).all();
  const totalWeight = rarities.reduce(
    (total, rarity) => total + (rarity.pokemon_count > 0 ? rarity.spawn_weight : 0),
    0
  );
  return rarities.map((rarity) => ({
    ...rarity,
    encounter_rate: totalWeight > 0 && rarity.pokemon_count > 0
      ? (rarity.spawn_weight / totalWeight) * 100
      : 0,
  }));
}

function setRaritySettings(name, spawnWeight, catchChance) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 40) {
    throw new TypeError('Rarity name must contain between 1 and 40 characters.');
  }
  if (!Number.isSafeInteger(spawnWeight) || spawnWeight < 0 || spawnWeight > 1000000) {
    throw new TypeError('Spawn weight must be an integer between 0 and 1000000.');
  }
  if (!Number.isSafeInteger(catchChance) || catchChance < 0 || catchChance > 100) {
    throw new TypeError('Catch chance must be an integer between 0 and 100.');
  }

  const rarity = name.trim();
  db.prepare(`
    INSERT INTO pokemon_rarity_settings (name, spawn_weight, catch_chance)
    VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      spawn_weight = excluded.spawn_weight,
      catch_chance = excluded.catch_chance
  `).run(rarity, spawnWeight, catchChance);
  return getRaritySettings().find((setting) => setting.name === rarity);
}

function setPokemonRarity(pokemonId, rarityName) {
  if (!Number.isSafeInteger(pokemonId) || pokemonId <= 0) {
    throw new TypeError('Pokémon ID must be a positive safe integer.');
  }
  if (typeof rarityName !== 'string' || !rarityName.trim() || rarityName.trim().length > 40) {
    throw new TypeError('Rarity name must contain between 1 and 40 characters.');
  }

  const rarity = rarityName.trim();
  return db.transaction(() => {
    const pokemon = db.prepare('SELECT id, name FROM pokemon_forms WHERE id = ?').get(pokemonId);
    if (!pokemon) return null;
    const existingEntry = pokemonRarityById.get(pokemonId);
    if (existingEntry) {
      existingEntry.rarity = rarity;
    } else {
      pokemonRarityById.set(pokemonId, { id: pokemonId, name: pokemon.name, rarity });
    }
    const updatedRarities = [...pokemonRarityById.values()].sort((left, right) => left.id - right.id);
    const temporaryPath = `${pokemonRaritiesPath}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(updatedRarities, null, 2)}\n`);
    fs.renameSync(temporaryPath, pokemonRaritiesPath);
    pokemonRarities.splice(0, pokemonRarities.length, ...updatedRarities);
    db.prepare(`
      INSERT INTO pokemon_rarity_settings (name, spawn_weight, catch_chance)
      VALUES (?, 0, 50)
      ON CONFLICT(name) DO NOTHING
    `).run(rarity);
    db.prepare('UPDATE pokemon_forms SET rarity = ? WHERE id = ?').run(rarity, pokemonId);
    db.prepare(`
      INSERT INTO pokemon_rarity_overrides (pokemon_id, rarity)
      VALUES (?, ?)
      ON CONFLICT(pokemon_id) DO UPDATE SET rarity = excluded.rarity
    `).run(pokemonId, rarity);
    db.prepare('UPDATE catches SET rarity = ? WHERE pokemon_id = ?').run(rarity, pokemonId);
    db.prepare('UPDATE market SET rarity = ? WHERE pokemon_id = ?').run(rarity, pokemonId);
    return db.prepare('SELECT * FROM pokemon_forms WHERE id = ?').get(pokemonId);
  }).immediate();
}

function addCustomPokemon(name, rarityName, sprite = null) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) {
    throw new TypeError('Pokémon name must contain between 1 and 80 characters.');
  }
  if (typeof rarityName !== 'string' || !rarityName.trim() || rarityName.trim().length > 40) {
    throw new TypeError('Rarity name must contain between 1 and 40 characters.');
  }
  if (sprite !== null && (typeof sprite !== 'string' || !/^https:\/\//i.test(sprite))) {
    throw new TypeError('Custom Pokémon artwork must use an HTTPS URL.');
  }

  const cleanName = name.trim();
  const rarity = rarityName.trim();
  const slugBase = cleanName.toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  if (!slugBase) throw new TypeError('Pokémon name must contain at least one letter or number.');

  return db.transaction(() => {
    db.prepare(`
      INSERT INTO pokemon_rarity_settings (name, spawn_weight, catch_chance)
      VALUES (?, 0, 50)
      ON CONFLICT(name) DO NOTHING
    `).run(rarity);
    const existingName = db.prepare(
      'SELECT id FROM pokemon_forms WHERE lower(name) = lower(?)'
    ).get(cleanName);
    if (existingName) throw new Error(`A Pokémon named "${cleanName}" already exists.`);

    const id = Math.max(
      1000000,
      (db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM pokemon_forms').get().id || 0) + 1
    );
    const slug = `${slugBase}-${id}`;
    const rarityEntry = { id, name: cleanName, rarity };
    pokemonRarityById.set(id, rarityEntry);
    const updatedRarities = [...pokemonRarityById.values()].sort((left, right) => left.id - right.id);
    const temporaryPath = `${pokemonRaritiesPath}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(updatedRarities, null, 2)}\n`);
    fs.renameSync(temporaryPath, pokemonRaritiesPath);
    pokemonRarities.splice(0, pokemonRarities.length, ...updatedRarities);
    db.prepare(`
      INSERT INTO pokemon_forms (
        id, species_id, species_name, slug, name, is_default, is_legendary, is_mythical,
        evolution_stage, rarity, base_hp, base_atk, base_def, base_spa, base_spdef, base_spd,
        base_stat_total, types, is_water, sprite, shiny_sprite, generation, is_custom
      )
      VALUES (?, ?, ?, ?, ?, 1, ?, 0, 1, ?, 50, 50, 50, 50, 50, 50, 300, '["normal"]', 0, ?, ?, NULL, 1)
    `).run(
      id,
      id,
      cleanName,
      slug,
      cleanName,
      rarity.toLowerCase() === 'legendary' ? 1 : 0,
      rarity,
      sprite,
      sprite
    );
    return db.prepare('SELECT * FROM pokemon_forms WHERE id = ?').get(id);
  }).immediate();
}

function getUserRarityStreak(userId, rarity) {
  assertUserId(userId);
  if (typeof rarity !== 'string' || !rarity) throw new TypeError('rarity must be a non-empty string.');
  const row = db.prepare(
    'SELECT streak_count FROM user_rarity_streaks WHERE user_id = ? AND rarity = ?'
  ).get(userId, rarity);
  return row?.streak_count || 0;
}

function resetRarityStreaks(userId, rarity = null) {
  assertUserId(userId);
  return db.transaction(() => {
    getUser(userId);
    if (rarity === null) {
      db.prepare('UPDATE user_rarity_streaks SET streak_count = 0 WHERE user_id = ?').run(userId);
      updateUser(userId, { common_streak: 0 });
      return;
    }
    // A break-out only resets the broken rarity and the general streak.
    db.prepare(
      "UPDATE user_rarity_streaks SET streak_count = 0 WHERE user_id = ? AND rarity IN (?, 'General')"
    ).run(userId, rarity);
    if (rarity === 'Common') updateUser(userId, { common_streak: 0 });
  }).immediate();
}

function recordRarityCatch(userId, rarity) {
  assertUserId(userId);
  if (typeof rarity !== 'string' || !rarity) throw new TypeError('rarity must be a non-empty string.');
  if (['mega', 'm', 'shiny mega', 'sm', 'gmax', 'g', 'shiny gmax', 'sg']
    .includes(rarity.trim().toLowerCase())) return 0;
  return db.transaction(() => {
    getUser(userId);
    const incrementStreak = (streakRarity) => {
      db.prepare(`
        INSERT INTO user_rarity_streaks (user_id, rarity, streak_count, highest_streak)
        VALUES (?, ?, 1, 1)
        ON CONFLICT(user_id, rarity) DO UPDATE SET
          streak_count = user_rarity_streaks.streak_count + 1,
          highest_streak = MAX(
            user_rarity_streaks.highest_streak,
            user_rarity_streaks.streak_count + 1
          )
      `).run(userId, streakRarity);
      return getUserRarityStreak(userId, streakRarity);
    };
    const streak = incrementStreak(rarity);
    const generalStreak = incrementStreak('General');
    if (rarity === 'Common') updateUser(userId, { common_streak: streak });
    const rewardMilestones = {
      Common: [[15, 1], [50, 1]],
      Uncommon: [[10, 1], [35, 1]],
      Rare: [[5, 1], [10, 2]],
      'Super Rare': [[5, 2]],
      Legendary: [[5, 3]],
      Shiny: [[5, 4]],
      General: [[25, 1]],
    };
    const lootboxesAwarded = [rarity, 'General'].reduce((total, streakRarity) => {
      const streakCount = streakRarity === rarity ? streak : generalStreak;
      return total + (rewardMilestones[streakRarity] || [])
        .reduce((earned, [milestone, amount]) =>
          earned + (streakCount % milestone === 0 ? amount : 0), 0);
    }, 0);
    if (lootboxesAwarded > 0) incrementUser(userId, { lootboxes: lootboxesAwarded });
    return { streak, generalStreak, lootboxesAwarded };
  }).immediate();
}

const WORLD_BOSS_OVERRIDES = {
  10190: { name: 'Eternatus-Eternamax', rarity: 'Legendary' },
  10196: { name: 'Gigantamax Charizard', rarity: 'Super Rare' },
  10202: { name: 'Gigantamax Gengar', rarity: 'Super Rare' },
};
const worldBossForms = db.prepare(`
  SELECT id, name, slug, rarity, base_hp, base_atk, base_def, base_spd, base_stat_total
  FROM pokemon_forms
  WHERE lower(rarity) = 'gmax'
  ORDER BY id
`).all();
if (!worldBossForms.length) {
  throw new Error('World Boss pool cannot be built because the catalog has no Gmax forms.');
}
const SHOWDOWN_GMAX_SLUGS = {
  'toxtricity-amped-gmax': 'toxtricity-gmax',
};
// Showdown has no animated Gmax sprite for these, so they use hosted GIFs instead.
const CUSTOM_GMAX_GIFS = {
  'venusaur-gmax': 'https://cdn.discordapp.com/attachments/1249277613198016555/1251897414391037992/venusaur-gmax.gif?ex=6ad0dad2&is=6acf8952&hm=235aad1205f9d7c9b60f61da93f84990c4c077565899161ef95c5bde12cadeae',
  'blastoise-gmax': 'https://media.discordapp.net/attachments/1202428993408868373/1251459949176033330/blastoise_gmax.gif?ex=6ad094e6&is=6acf4366&hm=32a6191ba396638cc412c129f09e560f80f4de420b09c10c1291efd8d196d977&=',
  'rillaboom-gmax': 'https://media.discordapp.net/attachments/1249277613198016555/1258898040517955605/gigantamax-rillaboom.gif?ex=6ad09d6a&is=6acf4bea&hm=caba05f97969d0c38eb68b675c540a3f71c5cc4616b110da767d3acf58140570&=',
  'cinderace-gmax': 'https://media.discordapp.net/attachments/965340186500296737/965367587078799440/cinderace-gmax.gif?ex=6ad0a0e0&is=6acf4f60&hm=5326c69003c6b105ba1c1b33af06dd503a92708113c3186b22d2b2f4131c1bc3&=',
  'urshifu-single-strike-gmax': 'https://media.discordapp.net/attachments/1260532287729045530/1266174031577481337/gigantamax-urshifu-singlestrike.gif?ex=6ad0b7b5&is=6acf6635&hm=cda5bc409d43872d3ada42ab00c0ce88237f7496761904cc6f4d6051ebccf863&=',
  'urshifu-rapid-strike-gmax': 'https://media.discordapp.net/attachments/1260532287729045530/1268354938455724154/gigantamax-urshifu-rapidstrike.gif?ex=6ad0bdd6&is=6acf6c56&hm=d8640a034f79693804ef811ca6a5f191c1f954f458a72bbd15c7862310c190c5&=',
};
const EXCLUDED_WORLD_BOSS_SLUGS = new Set(['toxtricity-low-key-gmax']);
const SHINY_WORLD_BOSS_ID_OFFSET = 100000;
const SHINY_WORLD_BOSS_FORMS_WITHOUT_GIF = new Set(Object.keys(CUSTOM_GMAX_GIFS));
const POKESPRITE_GMAX_SLUGS = {
  'toxtricity-amped-gmax': 'toxtricity-gmax',
  'urshifu-single-strike-gmax': 'urshifu-gmax',
};
const POKESPRITE_MISSING_SLUGS = new Set(['appletun-gmax']);
function getPokespriteIcon(slug, shiny) {
  if (POKESPRITE_MISSING_SLUGS.has(slug)) return null;
  const file = POKESPRITE_GMAX_SLUGS[slug] || slug;
  return `https://raw.githubusercontent.com/msikma/pokesprite/master/pokemon-gen8/${shiny ? 'shiny' : 'regular'}/${file}.png`;
}
const WORLD_BOSS_POOL = [];
for (const form of worldBossForms) {
  if (EXCLUDED_WORLD_BOSS_SLUGS.has(form.slug)) continue;
  const overrides = WORLD_BOSS_OVERRIDES[form.id] || {};
  const showdownSlug = SHOWDOWN_GMAX_SLUGS[form.slug] || form.slug;
  const artwork = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${form.id}.png`;
  const shinyArtwork = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/shiny/${form.id}.png`;
  const base = {
    formId: form.id,
    catchName: overrides.name || form.name,
    catchRarity: form.rarity,
    maxHp: form.id === 10190 || /eternatus-eternamax/i.test(form.slug)
      ? 50000000
      : 10000000,
    baseHp: form.base_hp,
    baseAtk: form.base_atk,
    baseDef: form.base_def,
    baseSpd: form.base_spd,
  };
  WORLD_BOSS_POOL.push({
    ...base,
    id: form.id,
    name: overrides.name || form.name,
    rarity: overrides.rarity || form.rarity,
    isShiny: false,
    icon: getPokespriteIcon(form.slug, false),
    img: CUSTOM_GMAX_GIFS[form.slug] || `https://play.pokemonshowdown.com/sprites/xyani/${showdownSlug}.gif`,
  });
  WORLD_BOSS_POOL.push({
    ...base,
    id: form.id + SHINY_WORLD_BOSS_ID_OFFSET,
    name: `Shiny ${overrides.name || form.name}`,
    rarity: 'Shiny Gmax',
    isShiny: true,
    icon: getPokespriteIcon(form.slug, true),
    img: SHINY_WORLD_BOSS_FORMS_WITHOUT_GIF.has(form.slug)
      ? shinyArtwork
      : `https://play.pokemonshowdown.com/sprites/ani-shiny/${showdownSlug}.gif`,
  });
}

function getActiveWorldBoss() {
  return db.prepare('SELECT * FROM world_boss WHERE is_active = 1 ORDER BY id DESC LIMIT 1').get() || null;
}

const WORLD_BOSS_REGISTRATION_DURATION_MS = 2 * 60 * 1000;

function spawnWorldBoss(template, spawnedBy = null, spawnedByName = null) {
  if (!template || !WORLD_BOSS_POOL.some((boss) => boss.id === template.id)) {
    throw new TypeError('World Boss template must be selected from WORLD_BOSS_POOL.');
  }
  if (spawnedBy !== null && (typeof spawnedBy !== 'string' || !spawnedBy)) {
    throw new TypeError('spawnedBy must be a non-empty user ID or null.');
  }
  if (spawnedByName !== null && (typeof spawnedByName !== 'string' || !spawnedByName.trim())) {
    throw new TypeError('spawnedByName must be a non-empty username or null.');
  }
  return db.transaction(() => {
    db.prepare('UPDATE world_boss SET is_active = 0 WHERE is_active = 1').run();
    db.prepare('DELETE FROM boss_damage').run();
    db.prepare('DELETE FROM world_boss_announcement_posts').run();
    db.prepare('DELETE FROM world_boss_registrations').run();
    const result = db.prepare(`
      INSERT INTO world_boss (
        name, current_hp, max_hp, image_url, is_active, spawned_by, spawned_by_name,
        registration_ends_at
      )
      VALUES (?, ?, ?, ?, 1, ?, ?, ?)
    `).run(
      template.name,
      template.maxHp,
      template.maxHp,
      template.img,
      spawnedBy,
      spawnedByName,
      Date.now() + WORLD_BOSS_REGISTRATION_DURATION_MS
    );
    return db.prepare('SELECT * FROM world_boss WHERE id = ?').get(result.lastInsertRowid);
  }).immediate();
}

function validateWorldBossTeamIds(teamPokemonIds) {
  if (!Array.isArray(teamPokemonIds) || teamPokemonIds.length < 1 || teamPokemonIds.length > 3
      || teamPokemonIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
      || new Set(teamPokemonIds).size !== teamPokemonIds.length) {
    throw new TypeError('teamPokemonIds must contain one to three unique positive Pokémon IDs.');
  }
}

function registerWorldBossPlayer(userId, bossId, teamPokemonIds, timestamp = Date.now()) {
  assertUserId(userId);
  if (!Number.isSafeInteger(bossId) || bossId <= 0) throw new TypeError('bossId must be positive.');
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new TypeError('timestamp must be non-negative.');
  validateWorldBossTeamIds(teamPokemonIds);

  return db.transaction(() => {
    const boss = db.prepare('SELECT * FROM world_boss WHERE id = ? AND is_active = 1').get(bossId);
    if (!boss) return { error: 'inactive' };
    const ownedPokemonIds = new Set(db.prepare(
      `SELECT id FROM catches WHERE user_id = ? AND id IN (${teamPokemonIds.map(() => '?').join(', ')})`
    ).all(userId, ...teamPokemonIds).map(({ id }) => id));
    if (teamPokemonIds.some((id) => !ownedPokemonIds.has(id))) return { error: 'invalid_team' };
    const inserted = db.prepare(`
      INSERT OR IGNORE INTO world_boss_registrations
        (boss_id, user_id, registered_at, team_pokemon_ids)
      VALUES (?, ?, ?, ?)
    `).run(bossId, userId, timestamp, JSON.stringify(teamPokemonIds));
    const registrationCount = db.prepare(
      'SELECT COUNT(*) AS count FROM world_boss_registrations WHERE boss_id = ?'
    ).get(bossId).count;
    return {
      registered: inserted.changes > 0,
      registrationCount,
      registrationEndsAt: boss.registration_ends_at,
      battleStarted: timestamp >= boss.registration_ends_at,
    };
  }).immediate();
}

function updateWorldBossPlayerTeam(userId, bossId, teamPokemonIds) {
  assertUserId(userId);
  if (!Number.isSafeInteger(bossId) || bossId <= 0) throw new TypeError('bossId must be positive.');
  validateWorldBossTeamIds(teamPokemonIds);

  return db.transaction(() => {
    if (!db.prepare('SELECT 1 FROM world_boss WHERE id = ? AND is_active = 1').get(bossId)) {
      return { error: 'inactive' };
    }
    if (!db.prepare(
      'SELECT 1 FROM world_boss_registrations WHERE boss_id = ? AND user_id = ?'
    ).get(bossId, userId)) {
      return { error: 'not_registered' };
    }
    const ownedPokemonIds = new Set(db.prepare(
      `SELECT id FROM catches WHERE user_id = ? AND id IN (${teamPokemonIds.map(() => '?').join(', ')})`
    ).all(userId, ...teamPokemonIds).map(({ id }) => id));
    if (teamPokemonIds.some((id) => !ownedPokemonIds.has(id))) return { error: 'invalid_team' };
    db.prepare(`
      UPDATE world_boss_registrations
      SET team_pokemon_ids = ?
      WHERE boss_id = ? AND user_id = ?
    `).run(JSON.stringify(teamPokemonIds), bossId, userId);
    return { updated: true };
  }).immediate();
}

function getWorldBossPlayerTeam(userId, bossId) {
  assertUserId(userId);
  if (!Number.isSafeInteger(bossId) || bossId <= 0) throw new TypeError('bossId must be positive.');
  const registration = db.prepare(`
    SELECT team_pokemon_ids FROM world_boss_registrations
    WHERE boss_id = ? AND user_id = ?
  `).get(bossId, userId);
  if (!registration) return null;
  const teamPokemonIds = JSON.parse(registration.team_pokemon_ids || '[]');
  if (!Array.isArray(teamPokemonIds) || teamPokemonIds.length < 1 || teamPokemonIds.length > 3) return null;
  const team = teamPokemonIds.map((id) =>
    db.prepare(`
      SELECT catches.*, pokemon_forms.name AS form_name, pokemon_forms.slug AS form_slug
      FROM catches
      LEFT JOIN pokemon_forms ON pokemon_forms.id = catches.pokemon_id
      WHERE catches.id = ? AND catches.user_id = ?
    `).get(id, userId)
  );
  return team.every(Boolean)
    ? team.map((pokemon, index) => ({ ...pokemon, team_slot: index + 1 }))
    : null;
}

function isWorldBossPlayerRegistered(userId, bossId) {
  assertUserId(userId);
  if (!Number.isSafeInteger(bossId) || bossId <= 0) throw new TypeError('bossId must be positive.');
  return Boolean(db.prepare(
    'SELECT 1 FROM world_boss_registrations WHERE boss_id = ? AND user_id = ?'
  ).get(bossId, userId));
}

function getWorldBossRegistrationCount(bossId) {
  if (!Number.isSafeInteger(bossId) || bossId <= 0) throw new TypeError('bossId must be positive.');
  return db.prepare(
    'SELECT COUNT(*) AS count FROM world_boss_registrations WHERE boss_id = ?'
  ).get(bossId).count;
}

function getBossLeaderboard(limit = 10) {
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 1000) {
    throw new TypeError('Leaderboard limit must be between 1 and 1000.');
  }
  return db.prepare(
    'SELECT user_id, damage, last_hit FROM boss_damage ORDER BY damage DESC, last_hit ASC LIMIT ?'
  ).all(limit);
}

function applyWorldBossDamage(userId, bossId, damage, timestamp = Date.now()) {
  assertUserId(userId);
  if (!Number.isSafeInteger(bossId) || bossId <= 0) throw new TypeError('bossId must be positive.');
  if (!Number.isSafeInteger(damage) || damage <= 0) throw new TypeError('damage must be positive.');
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new TypeError('timestamp must be non-negative.');

  return db.transaction(() => {
    const boss = db.prepare(
      'SELECT * FROM world_boss WHERE id = ? AND is_active = 1'
    ).get(bossId);
    if (!boss) return { error: 'inactive' };

    const appliedDamage = Math.min(damage, boss.current_hp);
    const currentHp = boss.current_hp - appliedDamage;
    db.prepare('UPDATE world_boss SET current_hp = ?, is_active = ? WHERE id = ?')
      .run(currentHp, currentHp > 0 ? 1 : 0, bossId);
    db.prepare(`
      INSERT INTO boss_damage (user_id, damage, last_hit)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        damage = boss_damage.damage + excluded.damage,
        last_hit = excluded.last_hit
    `).run(userId, appliedDamage, timestamp);

    return {
      boss: { ...boss, current_hp: currentHp, is_active: currentHp > 0 ? 1 : 0 },
      damage: appliedDamage,
      defeated: currentHp === 0,
    };
  }).immediate();
}

function distributeWorldBossRewards(bossId) {
  if (!Number.isSafeInteger(bossId) || bossId <= 0) throw new TypeError('bossId must be positive.');
  return db.transaction(() => {
    const boss = db.prepare(
      'SELECT * FROM world_boss WHERE id = ? AND is_active = 0 AND current_hp = 0'
    ).get(bossId);
    if (!boss || boss.rewards_claimed) return null;
    const leaderboard = getBossLeaderboard(1000);
    const mvp = leaderboard[0];
    if (!mvp) throw new Error('Defeated World Boss has no recorded damage contributors.');
    const template = WORLD_BOSS_POOL.find((entry) => entry.name === boss.name);
    if (!template) throw new Error(`No Pokémon reward template exists for World Boss "${boss.name}".`);

    const drops = [];
    const boxDrops = [];
    const extraDrops = [];
    for (const [index, entry] of leaderboard.entries()) {
      const isMvp = index === 0;
      trackClanActivity(entry.user_id, 'battle');
      db.prepare(`
        INSERT OR IGNORE INTO world_boss_rewards
          (boss_id, user_id, boss_name, max_hp, damage, rank, total_players, coins)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        bossId, entry.user_id, boss.name, boss.max_hp, entry.damage,
        index + 1, leaderboard.length, isMvp ? 30000 : 12000
      );
      const received = [];
      if (isMvp) {
        incrementUser(entry.user_id, {
          masterballs: 2,
          lootboxes: 3,
          world_boss_mvps: 1,
        });
        awardCoinsWithBoost(entry.user_id, 30000);
        received.push({ name: 'Masterball', amount: 2 }, { name: 'Lootbox', amount: 3 });
      } else {
        incrementUser(entry.user_id, { ultraballs: 5, lootboxes: 1 });
        awardCoinsWithBoost(entry.user_id, 12000);
        received.push({ name: 'Ultraball', amount: 5 }, { name: 'Lootbox', amount: 1 });
      }
      const isSpawnerBoosted = !isMvp && boss.spawned_by === entry.user_id;
      const dropChance = Math.min(1, (isMvp ? 0.12 : isSpawnerBoosted ? 0.12 : 0.03) * (isSpawnerBoosted ? 1.8 : 1));
      let gotPokemon = false;
      if (Math.random() < dropChance * 0.4) {
        gotPokemon = true;
        saveCatch(entry.user_id, {
          ...template,
          id: template.formId,
          name: template.catchName,
          rarity: template.isShiny ? template.catchRarity : template.rarity,
        }, template.isShiny);
        drops.push(entry.user_id);
      }
      const boxRolls = isSpawnerBoosted ? 5 : 1;
      for (let roll = 0; roll < boxRolls; roll += 1) {
        if (Math.random() < dropChance) {
          const boxNames = Object.keys(BOXES);
          const boxName = boxNames[Math.floor(Math.random() * boxNames.length)];
          addUserItem(entry.user_id, boxName);
          boxDrops.push({ userId: entry.user_id, itemName: boxName });
          received.push({ name: boxName, amount: 1 });
        }
      }
      if (isSpawnerBoosted) {
        incrementUser(entry.user_id, { ultraballs: 10, lootboxes: 2 });
        awardCoinsWithBoost(entry.user_id, 18000);
        received.push({ name: 'Ultraball', amount: 10 }, { name: 'Lootbox', amount: 2 });
      }
      for (const extra of rollWorldBossExtraDrops(isMvp)) {
        if (extra.name === 'Rare Candy') incrementUser(entry.user_id, { rare_candies: extra.amount });
        else if (extra.name === 'Repel') incrementUser(entry.user_id, { repels: extra.amount });
        else if (extra.name === 'Egg') incrementUser(entry.user_id, { vote_eggs: extra.amount });
        else addUserItem(entry.user_id, extra.name, extra.amount);
        extraDrops.push({ userId: entry.user_id, ...extra });
        received.push(extra);
      }
      db.prepare('UPDATE world_boss_rewards SET items_json = ?, pokemon_drop = ? WHERE boss_id = ? AND user_id = ?')
        .run(JSON.stringify(received), gotPokemon ? 1 : 0, bossId, entry.user_id);
    }
    db.prepare('UPDATE world_boss SET rewards_claimed = 1 WHERE id = ?').run(bossId);
    return { boss, leaderboard, mvp, drops, boxDrops, extraDrops };
  }).immediate();
}

function getUnclaimedWorldBossReward(userId) {
  assertUserId(userId);
  return db.prepare(`
    SELECT * FROM world_boss_rewards
    WHERE user_id = ? AND claimed = 0
    ORDER BY boss_id DESC LIMIT 1
  `).get(userId) || null;
}

const WORLD_BOSS_REPEL_DROPS = ['Repel', 'Super Repel', 'Max Repel'];

// Extra per-player loot on top of the standard rewards; MVPs get better odds and amounts.
function rollWorldBossExtraDrops(isMvp) {
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const drops = [];
  if (Math.random() < (isMvp ? 0.6 : 0.3)) {
    drops.push({ name: 'Rare Candy', amount: (isMvp ? 3 : 1) + Math.floor(Math.random() * 3) });
  }
  if (Math.random() < (isMvp ? 0.3 : 0.1)) {
    drops.push({ name: pick(Object.keys(EVOLUTION_ITEMS)), amount: 1 });
  }
  if (Math.random() < (isMvp ? 0.25 : 0.1)) {
    drops.push({ name: pick(WORLD_BOSS_REPEL_DROPS), amount: 1 + Math.floor(Math.random() * 2) });
  }
  if (Math.random() < (isMvp ? 0.15 : 0.08)) {
    drops.push({ name: 'Egg', amount: 1 });
  }
  return drops;
}

function rollWorldBossClaimItems() {
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  return [
    { name: 'Rare Candy', amount: 1 + Math.floor(Math.random() * 3) },
    { name: pick(WORLD_BOSS_REPEL_DROPS), amount: 1 },
    { name: pick(Object.keys(BOXES)), amount: 1 },
  ];
}

function claimWorldBossReward(userId) {
  assertUserId(userId);
  return db.transaction(() => {
    const record = getUnclaimedWorldBossReward(userId);
    if (!record) return null;
    db.prepare('UPDATE world_boss_rewards SET claimed = 1 WHERE boss_id = ? AND user_id = ?')
      .run(record.boss_id, userId);
    // Rewards were already granted when the boss died; claim only reports them.
    let items = [];
    try { items = JSON.parse(record.items_json || '[]'); } catch { items = []; }
    const merged = [];
    for (const item of items) {
      const existing = merged.find((entry) => entry.name === item.name);
      if (existing) existing.amount += item.amount;
      else merged.push({ ...item });
    }
    const user = incrementUser(userId, { world_bosses_fought: 1 });
    return {
      record, items: merged, bossesFought: user.world_bosses_fought, pokemonDrop: !!record.pokemon_drop,
    };
  }).immediate();
}

const BASE_MARKET_LISTING_LIMIT = 15;
function getMarketListingLimit(userId) {
  assertUserId(userId);
  return BASE_MARKET_LISTING_LIMIT + getPatreonPerks(userId).marketListingSlots;
}

function getUserMarketListingCount(userId) {
  assertUserId(userId);
  return db.prepare(
    'SELECT COUNT(*) AS count FROM market WHERE seller_id = ?'
  ).get(userId).count;
}

function listOnMarket(sellerId, catchId, price) {
  assertUserId(sellerId);
  if (!Number.isSafeInteger(catchId) || catchId <= 0
      || !Number.isSafeInteger(price) || price <= 0) {
    throw new TypeError('catchId and price must be positive safe integers.');
  }

  return db.transaction(() => {
    const listingLimit = getMarketListingLimit(sellerId);
    const listingCount = getUserMarketListingCount(sellerId);
    if (listingCount >= listingLimit) {
      return { error: 'listing_limit', listingCount, listingLimit };
    }
    const mon = db.prepare(
      'SELECT * FROM catches WHERE id = ? AND user_id = ?'
    ).get(catchId, sellerId);
    if (!mon || mon.in_team) return null;

    const inserted = db.prepare(`
      INSERT INTO market (
        seller_id, pokemon_id, name, rarity, is_shiny, is_golden, level, price, amount,
        hp_iv, atk_iv, def_iv, spa_iv, spdef_iv, spd_iv,
        experience, hp, max_hp, atk, def, spd
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sellerId, mon.pokemon_id, mon.name, mon.rarity, mon.is_shiny, mon.is_golden, mon.level, price,
      mon.hp_iv, mon.atk_iv, mon.def_iv, mon.spa_iv, mon.spdef_iv, mon.spd_iv,
      mon.experience, mon.hp, mon.max_hp, mon.atk, mon.def, mon.spd
    );
    db.prepare('UPDATE users SET buddy_catch_id = NULL WHERE buddy_catch_id = ?').run(catchId);
    saveCatchStateSnapshot(sellerId, catchId);
    db.prepare('DELETE FROM catches WHERE id = ? AND user_id = ?').run(catchId, sellerId);
    return { ...mon, amount: 1, market_listing_id: Number(inserted.lastInsertRowid) };
  }).immediate();
}

function listPokemonOnMarket(sellerId, pokemonId, amount, price, forceVariant = false) {
  assertUserId(sellerId);
  // forceVariant: false/'normal' (auto), true/'shiny', or 'golden'.
  const forced = forceVariant === true ? 'shiny' : forceVariant === false ? null : forceVariant;
  if (!Number.isSafeInteger(pokemonId) || pokemonId <= 0
      || !Number.isSafeInteger(amount) || amount <= 0 || amount > 50000
      || !Number.isSafeInteger(price) || price <= 0
      || ![null, 'shiny', 'golden'].includes(forced)) {
    throw new TypeError('pokemonId and price must be positive; amount must be between 1 and 50000.');
  }

  return db.transaction(() => {
    const listingLimit = getMarketListingLimit(sellerId);
    const listingCount = getUserMarketListingCount(sellerId);
    if (listingCount >= listingLimit) {
      return { error: 'listing_limit', listingCount, listingLimit };
    }
    const variant = db.prepare(`
      SELECT is_shiny, is_golden, MAX(id) AS latest_id
      FROM catches
      WHERE user_id = ? AND pokemon_id = ? AND in_team = 0
        AND (? IS NULL
          OR (? = 'shiny' AND is_shiny = 1 AND is_golden = 0)
          OR (? = 'golden' AND is_golden = 1))
      GROUP BY is_shiny, is_golden
      HAVING COUNT(*) >= ?
      ORDER BY latest_id DESC
      LIMIT 1
    `).get(sellerId, pokemonId, forced, forced, forced, amount);
    if (!variant) {
      if (forced) return null;
      const available = db.prepare(`
        SELECT COUNT(*) AS count FROM catches
        WHERE user_id = ? AND pokemon_id = ? AND in_team = 0
      `).get(sellerId, pokemonId).count;
      return available >= amount ? { error: 'mixed_variants' } : null;
    }
    const catches = db.prepare(`
      SELECT * FROM catches
      WHERE user_id = ? AND pokemon_id = ? AND in_team = 0
        AND is_shiny = ? AND is_golden = ?
      ORDER BY id DESC
      LIMIT ?
    `).all(sellerId, pokemonId, variant.is_shiny, variant.is_golden, amount);
    const mon = catches[0];
    const result = db.prepare(`
      INSERT INTO market (
        seller_id, pokemon_id, name, rarity, is_shiny, is_golden, level, price, amount,
        hp_iv, atk_iv, def_iv, spa_iv, spdef_iv, spd_iv,
        experience, hp, max_hp, atk, def, spd
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sellerId, mon.pokemon_id, mon.name, mon.rarity, mon.is_shiny, mon.is_golden,
      mon.level, price, amount,
      mon.hp_iv, mon.atk_iv, mon.def_iv, mon.spa_iv, mon.spdef_iv, mon.spd_iv, mon.experience,
      mon.hp, mon.max_hp, mon.atk, mon.def, mon.spd
    );
    const deleteCatches = db.prepare(
      'DELETE FROM catches WHERE id = ? AND user_id = ?'
    );
    const clearBuddy = db.prepare('UPDATE users SET buddy_catch_id = NULL WHERE buddy_catch_id = ?');
    for (const catchRow of catches) {
      clearBuddy.run(catchRow.id);
      saveCatchStateSnapshot(sellerId, catchRow.id);
      deleteCatches.run(catchRow.id, sellerId);
    }
    return [{ ...mon, amount, market_listing_id: Number(result.lastInsertRowid) }];
  }).immediate();
}

// filter ({ pokemonId, isShiny }) matches one exact form and variant instead of a name search.
function marketFilterSql(filter) {
  if (!filter) return { sql: '', params: [] };
  if (!Number.isSafeInteger(filter.pokemonId) || filter.pokemonId <= 0) {
    throw new TypeError('Market filter requires a valid pokemonId.');
  }
  return {
    sql: filter.isGolden
      ? ' AND pokemon_id = ? AND is_golden = 1'
      : ' AND pokemon_id = ? AND is_shiny = ? AND is_golden = 0',
    params: filter.isGolden ? [filter.pokemonId] : [filter.pokemonId, filter.isShiny ? 1 : 0],
  };
}

function getMarketListings(search = null, limit = 10, offset = 0, filter = null) {
  if (search !== null && (typeof search !== 'string' || !search.trim())) {
    throw new TypeError('Market search must be null or a non-empty string.');
  }
  if (!Number.isSafeInteger(limit) || limit < 1
      || !Number.isSafeInteger(offset) || offset < 0) {
    throw new TypeError('Market limit and offset must be valid integers.');
  }
  const exact = marketFilterSql(filter);
  const nameSearch = filter ? null : search;
  return db.prepare(`
    SELECT * FROM market
    WHERE (? IS NULL OR instr(lower(name), lower(?)) > 0)${exact.sql}
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `).all(nameSearch, nameSearch, ...exact.params, limit, offset);
}

function getMarketListingCount(search = null, filter = null) {
  if (search !== null && (typeof search !== 'string' || !search.trim())) {
    throw new TypeError('Market search must be null or a non-empty string.');
  }
  const exact = marketFilterSql(filter);
  const nameSearch = filter ? null : search;
  return db.prepare(`
    SELECT COUNT(*) AS count FROM market
    WHERE (? IS NULL OR instr(lower(name), lower(?)) > 0)${exact.sql}
  `).get(nameSearch, nameSearch, ...exact.params).count;
}

function getUserMarketListings(userId, limit = 10, offset = 0) {
  assertUserId(userId);
  if (!Number.isSafeInteger(limit) || limit < 1
      || !Number.isSafeInteger(offset) || offset < 0) {
    throw new TypeError('Market limit and offset must be valid integers.');
  }
  return db.prepare(`
    SELECT market.*,
      COALESCE(sales.sold_count, 0) AS sold_count
    FROM market
    LEFT JOIN (
      SELECT listing_id, COUNT(*) AS sold_count
      FROM market_sales
      WHERE seller_id = ?
      GROUP BY listing_id
    ) AS sales ON sales.listing_id = market.id
    WHERE market.seller_id = ?
    ORDER BY market.id DESC
    LIMIT ? OFFSET ?
  `).all(userId, userId, limit, offset);
}

function getUserMarketSales(userId, limit = 10, offset = 0) {
  assertUserId(userId);
  if (!Number.isSafeInteger(limit) || limit < 1
      || !Number.isSafeInteger(offset) || offset < 0) {
    throw new TypeError('Market sale limit and offset must be valid integers.');
  }
  return db.prepare(`
    SELECT * FROM market_sales
    WHERE seller_id = ?
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `).all(userId, limit, offset);
}

function getUnclaimedMarketSales(userId) {
  assertUserId(userId);
  return db.prepare(`
    SELECT * FROM market_sales
    WHERE seller_id = ? AND claimed = 0
    ORDER BY id DESC
  `).all(userId);
}

function markMarketSalesClaimed(userId, saleIds) {
  assertUserId(userId);
  const mark = db.prepare('UPDATE market_sales SET claimed = 1 WHERE id = ? AND seller_id = ?');
  db.transaction(() => {
    for (const id of saleIds) mark.run(id, userId);
  })();
}

function getUserMarketSaleSummary(userId) {
  assertUserId(userId);
  return db.prepare(`
    SELECT COUNT(*) AS sale_count,
      COALESCE(SUM(sale_price), 0) AS gross_amount,
      COALESCE(SUM(tax_amount), 0) AS tax_amount,
      COALESCE(SUM(payout_amount), 0) AS payout_amount
    FROM market_sales
    WHERE seller_id = ?
  `).get(userId);
}

function restoreMarketListings(playerListings) {
  const restoreCatch = db.prepare(`
    INSERT INTO catches (
      user_id, pokemon_id, name, rarity, is_shiny, is_golden, level,
      hp_iv, atk_iv, def_iv, spa_iv, spdef_iv, spd_iv, experience,
      hp, max_hp, atk, def, spd, in_team, team_slot
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)
  `);
  for (const listing of playerListings) {
    getUser(listing.seller_id);
    for (let copyIndex = 0; copyIndex < listing.amount; copyIndex += 1) {
      const result = restoreCatch.run(
        listing.seller_id,
        listing.pokemon_id,
        listing.name,
        listing.rarity,
        listing.is_shiny,
        listing.is_golden,
        listing.level,
        listing.hp_iv,
        listing.atk_iv,
        listing.def_iv,
        listing.spa_iv,
        listing.spdef_iv,
        listing.spd_iv,
        listing.experience,
        listing.hp,
        listing.max_hp,
        listing.atk,
        listing.def,
        listing.spd
      );
      syncNewCatchState(listing.seller_id, Number(result.lastInsertRowid));
    }
  }
}

function removeUserMarketListings(userId, listingId = 'all') {
  assertUserId(userId);
  if (listingId !== 'all' && (!Number.isSafeInteger(listingId) || listingId <= 0)) {
    throw new TypeError('listingId must be "all" or a positive safe integer.');
  }

  return db.transaction(() => {
    const listings = listingId === 'all'
      ? db.prepare('SELECT * FROM market WHERE seller_id = ?').all(userId)
      : [db.prepare('SELECT * FROM market WHERE id = ? AND seller_id = ?').get(listingId, userId)]
        .filter(Boolean);
    if (listingId !== 'all' && !listings.length) return null;

    restoreMarketListings(listings);
    const removedCount = listingId === 'all'
      ? db.prepare('DELETE FROM market WHERE seller_id = ?').run(userId).changes
      : db.prepare('DELETE FROM market WHERE id = ? AND seller_id = ?').run(listingId, userId).changes;
    return {
      removedCount,
      returnedCount: listings.reduce((total, listing) => total + listing.amount, 0),
    };
  }).immediate();
}

function clearMarketListings() {
  return db.transaction(() => {
    const playerListings = db.prepare(`
      SELECT * FROM market
      WHERE seller_id IS NOT NULL AND seller_id != '999999999999999999'
    `).all();
    restoreMarketListings(playerListings);
    const clearedCount = db.prepare('DELETE FROM market').run().changes;
    const returnedCount = playerListings.reduce((total, listing) => total + listing.amount, 0);
    return { clearedCount, returnedCount };
  }).immediate();
}

function stockMarketPokemon(pokemonId, quantity, price, isShiny = false) {
  if (!Number.isSafeInteger(pokemonId) || pokemonId <= 0
      || !Number.isSafeInteger(quantity)       || quantity <= 0
      || !Number.isSafeInteger(price) || price <= 0) {
    throw new TypeError('pokemonId, quantity and price must be positive.');
  }

  return db.transaction(() => {
    const pokemon = db.prepare('SELECT * FROM pokemon_forms WHERE id = ?').get(pokemonId);
    if (!pokemon) return null;

    const sellerId = '999999999999999999';
    const insert = db.prepare(`
      INSERT INTO market (
        seller_id, pokemon_id, name, rarity, is_shiny, level, price, amount,
        hp_iv, atk_iv, def_iv, spa_iv, spdef_iv, spd_iv, hp, max_hp, atk, def, spd
      )
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const hpIv = Math.floor(Math.random() * 32);
    const atkIv = Math.floor(Math.random() * 32);
    const defIv = Math.floor(Math.random() * 32);
    const spaIv = atkIv;
    const spdefIv = defIv;
    const spdIv = Math.floor(Math.random() * 32);
    const maxHp = calculateStat(pokemon.base_hp, hpIv, 1, true, isShiny);
    const inserted = insert.run(
      sellerId,
      pokemon.id,
      pokemon.name,
      pokemon.rarity,
      isShiny ? 1 : 0,
      price,
      quantity,
      hpIv,
      atkIv,
      defIv,
      spaIv,
      spdefIv,
      spdIv,
      maxHp,
      maxHp,
      calculateStat(pokemon.base_atk, atkIv, 1, false, isShiny),
      calculateStat(pokemon.base_def, defIv, 1, false, isShiny),
      calculateStat(pokemon.base_spd, spdIv, 1, false, isShiny)
    );
    const listings = [
      db.prepare('SELECT * FROM market WHERE id = ?').get(Number(inserted.lastInsertRowid)),
    ];
    return { pokemon, quantity, price, isShiny, listings };
  }).immediate();
}

function buyMarketItem(buyerId, listingId, quantity = 1) {
  assertUserId(buyerId);
  if (!Number.isSafeInteger(listingId) || listingId <= 0) {
    throw new TypeError('listingId must be a positive safe integer.');
  }
  if (quantity !== 'all' && (!Number.isSafeInteger(quantity) || quantity <= 0)) {
    throw new TypeError('quantity must be a positive safe integer or "all".');
  }

  return db.transaction(() => {
    const item = db.prepare('SELECT * FROM market WHERE id = ?').get(listingId);
    if (!item) return { error: 'Item not found or already sold.' };
    if (item.seller_id === buyerId) {
      return { error: 'You cannot buy your own listing.' };
    }
    const amount = quantity === 'all' ? item.amount : quantity;
    if (amount > item.amount) {
      return { error: `Only ${item.amount.toLocaleString()} remain in this listing.` };
    }
    const totalPrice = item.price * amount;

    const buyer = getUser(buyerId);
    if (buyer.coins < totalPrice) return { error: 'Insufficient coins.' };

    incrementUser(buyerId, { coins: -totalPrice });
    const isPlayerListing = item.seller_id !== null
      && item.seller_id !== '999999999999999999';
    const taxRate = isPlayerListing ? getPatreonPerks(item.seller_id).marketTax : 0;
    const taxAmount = isPlayerListing ? Math.floor(totalPrice * taxRate) : 0;
    const saleProceeds = totalPrice - taxAmount;
    if (isPlayerListing) {
      incrementUser(item.seller_id, { coins: saleProceeds, pkc_earned: saleProceeds });
    }
    if (isPlayerListing) {
      db.prepare(`
        INSERT INTO market_sales (
          listing_id, seller_id, buyer_id, pokemon_id, name, rarity, is_shiny,
          is_golden, sale_price, tax_amount, tax_rate, payout_amount
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        item.id,
        item.seller_id,
        buyerId,
        item.pokemon_id,
        item.name,
        item.rarity,
        item.is_shiny,
        item.is_golden,
        totalPrice,
        taxAmount,
        Math.round(taxRate * 100),
        saleProceeds
      );
    }
    if (item.amount > amount) {
      db.prepare('UPDATE market SET amount = amount - ? WHERE id = ?').run(amount, listingId);
    } else {
      db.prepare('DELETE FROM market WHERE id = ?').run(listingId);
    }
    const remainingAmount = db.prepare('SELECT amount FROM market WHERE id = ?').get(listingId)?.amount || 0;
    for (let index = 0; index < amount; index += 1) {
      const newCatchId = saveCatch(buyerId, {
        id: item.pokemon_id,
        name: item.name,
        rarity: item.rarity,
        hp_iv: item.hp_iv,
        atk_iv: item.atk_iv,
        def_iv: item.def_iv,
        spa_iv: item.spa_iv,
        spdef_iv: item.spdef_iv,
        spd_iv: item.spd_iv,
      }, item.is_shiny, false, Boolean(item.is_golden));
      rebaseTransferredPokemon(buyerId, newCatchId);
      syncNewCatchState(buyerId, newCatchId);
    }

    return {
      success: true,
      item,
      amount,
      totalPrice,
      remainingAmount,
      sale: isPlayerListing
        ? {
          listingId: item.id,
          salePrice: totalPrice,
          taxAmount,
          taxRate: Math.round(taxRate * 100),
          payoutAmount: saleProceeds,
        }
        : null,
    };
  }).immediate();
}

const TOKEN_ORDER_MAX_AMOUNT = 1000000;
const TOKEN_ORDER_MAX_PRICE = 1000000000;
const TOKEN_ORDER_DAY_MS = 24 * 60 * 60 * 1000;
const TOKEN_SELL_FEE_RATE = 0.05;
const TOKEN_PATRON_SELL_FEE_RATE = 0.025;

function expirePatreonTokenOrdersInternal(now) {
  const expired = db.prepare(`
    SELECT id, user_id, side, remaining_amount, unit_price
    FROM patreon_token_orders
    WHERE status = 'open' AND expires_at <= ?
  `).all(now);
  for (const order of expired) {
    if (order.side === 'buy') {
      incrementUser(order.user_id, { coins: order.remaining_amount * order.unit_price });
    } else {
      incrementUser(order.user_id, { patreon_tokens: order.remaining_amount });
    }
    db.prepare(`
      UPDATE patreon_token_orders
      SET status = 'expired', remaining_amount = 0
      WHERE id = ? AND status = 'open'
    `).run(order.id);
  }
  return expired.length;
}

function expirePatreonTokenOrders(now = Date.now()) {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new TypeError('Token order expiry timestamp must be a non-negative safe integer.');
  }
  return db.transaction(() => expirePatreonTokenOrdersInternal(now)).immediate();
}

function recordPatreonTokenTrade({ buyOrderId, sellOrderId, buyerId, sellerId, amount, unitPrice, now }) {
  db.prepare(`
    INSERT INTO patreon_token_trades (
      buy_order_id, sell_order_id, buyer_id, seller_id, amount, unit_price, total_coins, traded_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(buyOrderId, sellOrderId, buyerId, sellerId, amount, unitPrice, amount * unitPrice, now);
}

function createPatreonTokenOrder(userId, side, amount, unitPrice = null, now = Date.now()) {
  assertUserId(userId);
  if (!['buy', 'sell'].includes(side)) throw new TypeError('Token order side must be buy or sell.');
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > TOKEN_ORDER_MAX_AMOUNT) {
    throw new TypeError(`Token order amount must be between 1 and ${TOKEN_ORDER_MAX_AMOUNT}.`);
  }
  if (unitPrice !== null
      && (!Number.isSafeInteger(unitPrice) || unitPrice < 1 || unitPrice > TOKEN_ORDER_MAX_PRICE)) {
    throw new TypeError(`Token order price must be between 1 and ${TOKEN_ORDER_MAX_PRICE}.`);
  }
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new TypeError('Token order timestamp must be a non-negative safe integer.');
  }

  return db.transaction(() => {
    expirePatreonTokenOrdersInternal(now);
    const user = getUser(userId);
    const isPatron = Boolean(user.has_patreon || user.patreon_tier);
    const feeRate = isPatron ? TOKEN_PATRON_SELL_FEE_RATE : TOKEN_SELL_FEE_RATE;
    const expiresAt = now + TOKEN_ORDER_DAY_MS * (isPatron ? 5 : 2);
    let resolvedPrice = unitPrice;

    if (side === 'buy') {
      const marketOrder = unitPrice === null;
      if (marketOrder) {
        const asks = db.prepare(`
          SELECT * FROM patreon_token_orders
          WHERE side = 'sell' AND status = 'open' AND expires_at > ? AND user_id != ?
          ORDER BY unit_price ASC, id ASC
        `).all(now, userId);
        if (!asks.length) return { error: 'no_sell_orders' };
        let remaining = amount;
        let totalCost = 0;
        const fills = [];
        for (const ask of asks) {
          if (remaining === 0) break;
          const affordable = Math.floor((user.coins - totalCost) / ask.unit_price);
          const quantity = Math.min(remaining, ask.remaining_amount, affordable);
          if (quantity < 1) break;
          totalCost += quantity * ask.unit_price;
          remaining -= quantity;
          fills.push({ ask, quantity });
        }
        if (!fills.length) return { error: 'insufficient_coins' };
        if (!Number.isSafeInteger(totalCost)) return { error: 'amount_too_large' };
        incrementUser(userId, { coins: -totalCost });
        let filled = 0;
        for (const { ask, quantity } of fills) {
          const orderRemaining = ask.remaining_amount - quantity;
          const total = quantity * ask.unit_price;
          db.prepare(`
            UPDATE patreon_token_orders SET remaining_amount = ?, status = ?
            WHERE id = ? AND status = 'open'
          `).run(orderRemaining, orderRemaining === 0 ? 'filled' : 'open', ask.id);
          incrementUser(ask.user_id, { coins: total });
          incrementUser(userId, { patreon_tokens: quantity });
          recordPatreonTokenTrade({
            buyOrderId: null, sellOrderId: ask.id, buyerId: userId, sellerId: ask.user_id,
            amount: quantity, unitPrice: ask.unit_price, now,
          });
          filled += quantity;
        }
        return {
          side,
          amount,
          price: Math.round(totalCost / filled),
          filled,
          remaining: 0,
          unfilled: amount - filled,
          order: null,
          feeAmount: 0,
        };
      }

      let remaining = amount;
      let filled = 0;
      let spentCoins = 0;
      const asks = db.prepare(`
        SELECT * FROM patreon_token_orders
        WHERE side = 'sell' AND status = 'open' AND expires_at > ?
          AND unit_price <= ? AND user_id != ?
        ORDER BY unit_price ASC, id ASC
      `).all(now, resolvedPrice, userId);
      const fills = [];
      for (const ask of asks) {
        if (remaining === 0) break;
        const affordable = Math.floor((user.coins - spentCoins) / ask.unit_price);
        const quantity = Math.min(remaining, ask.remaining_amount, affordable);
        if (quantity < 1) break;
        const total = quantity * ask.unit_price;
        if (!Number.isSafeInteger(total)) throw new Error('Token market trade value exceeded safe integer range.');
        fills.push({ ask, quantity, total });
        remaining -= quantity;
        filled += quantity;
        spentCoins += total;
      }

      const reservedCoins = remaining * resolvedPrice;
      if (!Number.isSafeInteger(reservedCoins)) return { error: 'amount_too_large' };
      const canReserveBuyOrder = remaining > 0 && user.coins - spentCoins >= reservedCoins;
      if (!filled && !canReserveBuyOrder) return { error: 'insufficient_coins' };
      const totalCoins = spentCoins + (canReserveBuyOrder ? reservedCoins : 0);
      if (totalCoins > 0) incrementUser(userId, { coins: -totalCoins });

      for (const { ask, quantity, total } of fills) {
        const orderRemaining = ask.remaining_amount - quantity;
        db.prepare(`
          UPDATE patreon_token_orders SET remaining_amount = ?, status = ?
          WHERE id = ? AND status = 'open'
        `).run(orderRemaining, orderRemaining === 0 ? 'filled' : 'open', ask.id);
        incrementUser(ask.user_id, { coins: total });
        incrementUser(userId, { patreon_tokens: quantity });
        recordPatreonTokenTrade({
          buyOrderId: null, sellOrderId: ask.id, buyerId: userId, sellerId: ask.user_id,
          amount: quantity, unitPrice: ask.unit_price, now,
        });
      }
      let order = null;
      if (canReserveBuyOrder) {
        const inserted = db.prepare(`
          INSERT INTO patreon_token_orders (
            user_id, side, amount, remaining_amount, unit_price, fee_rate, created_at, expires_at
          )
          VALUES (?, 'buy', ?, ?, ?, 0, ?, ?)
        `).run(userId, amount, remaining, resolvedPrice, now, expiresAt);
        order = db.prepare('SELECT * FROM patreon_token_orders WHERE id = ?').get(Number(inserted.lastInsertRowid));
      }
      return {
        side,
        amount,
        price: resolvedPrice,
        filled,
        averagePrice: filled ? Math.round(spentCoins / filled) : null,
        remaining: order?.remaining_amount || 0,
        unfilled: order ? 0 : remaining,
        order,
        feeAmount: 0,
      };
    }

    if (resolvedPrice === null) return { error: 'sell_price_required' };
    const matchingBids = db.prepare(`
      SELECT * FROM patreon_token_orders
      WHERE side = 'buy' AND status = 'open' AND expires_at > ?
        AND unit_price >= ? AND user_id != ?
      ORDER BY unit_price DESC, id ASC
    `).all(now, resolvedPrice, userId);
    let remaining = amount;
    const fills = [];
    for (const bid of matchingBids) {
      if (remaining === 0) break;
      const quantity = Math.min(remaining, bid.remaining_amount);
      fills.push({ bid, quantity });
      remaining -= quantity;
    }
    const feeAmount = Math.ceil(remaining * feeRate);
    const requiredTokens = amount + feeAmount;
    if (!Number.isSafeInteger(requiredTokens)) return { error: 'amount_too_large' };
    if (user.patreon_tokens < requiredTokens) {
      return { error: 'insufficient_tokens', required: requiredTokens, owned: user.patreon_tokens };
    }
    incrementUser(userId, { patreon_tokens: -requiredTokens });
    let filled = 0;
    for (const { bid, quantity } of fills) {
      const orderRemaining = bid.remaining_amount - quantity;
      const total = quantity * bid.unit_price;
      if (!Number.isSafeInteger(total)) throw new Error('Token market trade value exceeded safe integer range.');
      db.prepare(`
        UPDATE patreon_token_orders SET remaining_amount = ?, status = ?
        WHERE id = ? AND status = 'open'
      `).run(orderRemaining, orderRemaining === 0 ? 'filled' : 'open', bid.id);
      incrementUser(bid.user_id, { patreon_tokens: quantity });
      incrementUser(userId, { coins: total });
      recordPatreonTokenTrade({
        buyOrderId: bid.id, sellOrderId: null, buyerId: bid.user_id, sellerId: userId,
        amount: quantity, unitPrice: bid.unit_price, now,
      });
      filled += quantity;
    }
    let order = null;
    if (remaining > 0) {
      const inserted = db.prepare(`
        INSERT INTO patreon_token_orders (
          user_id, side, amount, remaining_amount, unit_price, fee_rate, fee_amount, created_at, expires_at
        )
        VALUES (?, 'sell', ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, amount, remaining, resolvedPrice, feeRate, feeAmount, now, expiresAt);
      order = db.prepare('SELECT * FROM patreon_token_orders WHERE id = ?').get(Number(inserted.lastInsertRowid));
    }
    return { side, amount, price: resolvedPrice, filled, remaining: order?.remaining_amount || 0, order, feeAmount };
  }).immediate();
}

function cancelPatreonTokenOrder(userId, orderId, now = Date.now()) {
  assertUserId(userId);
  if (!Number.isSafeInteger(orderId) || orderId < 1) {
    throw new TypeError('Token order ID must be a positive safe integer.');
  }
  return db.transaction(() => {
    expirePatreonTokenOrdersInternal(now);
    const order = db.prepare(`
      SELECT * FROM patreon_token_orders WHERE id = ? AND user_id = ? AND status = 'open'
    `).get(orderId, userId);
    if (!order) return null;
    if (order.side === 'buy') {
      incrementUser(userId, { coins: order.remaining_amount * order.unit_price });
    } else {
      incrementUser(userId, { patreon_tokens: order.remaining_amount });
    }
    db.prepare(`
      UPDATE patreon_token_orders SET status = 'cancelled', remaining_amount = 0 WHERE id = ?
    `).run(order.id);
    return order;
  }).immediate();
}

function getPatreonTokenOrderBook(side, limit = 10, now = Date.now()) {
  if (!['buy', 'sell'].includes(side)) throw new TypeError('Token order book side must be buy or sell.');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new TypeError('Token order book limit must be between 1 and 100.');
  }
  expirePatreonTokenOrders(now);
  return db.prepare(`
    SELECT id, user_id, remaining_amount, unit_price, expires_at
    FROM patreon_token_orders
    WHERE side = ? AND status = 'open' AND expires_at > ?
    ORDER BY unit_price ${side === 'buy' ? 'DESC' : 'ASC'}, id ASC
    LIMIT ?
  `).all(side, now, limit);
}

function getUserPatreonTokenOrders(userId, now = Date.now()) {
  assertUserId(userId);
  expirePatreonTokenOrders(now);
  return db.prepare(`
    SELECT id, side, remaining_amount, unit_price, fee_amount, expires_at, created_at
    FROM patreon_token_orders
    WHERE user_id = ? AND status = 'open' AND expires_at > ?
    ORDER BY id DESC
  `).all(userId, now);
}

function getPatreonTokenMarketStats(now = Date.now()) {
  const monthStart = new Date(now);
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  return db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS volume,
      COALESCE(SUM(total_coins), 0) AS total_coins,
      CASE WHEN COALESCE(SUM(amount), 0) = 0 THEN 0
        ELSE CAST(SUM(total_coins) AS REAL) / SUM(amount)
      END AS average_price
    FROM patreon_token_trades
    WHERE traded_at >= ?
  `).get(monthStart.getTime());
}

const DAILY_RESET_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAILY_PERIOD_MS = 24 * 60 * 60 * 1000;

function getDailyResetDay(timestamp) {
  return Math.floor((timestamp - DAILY_RESET_OFFSET_MS) / DAILY_PERIOD_MS);
}

const DAILY_SWAP_TICKETS = 2;

// Grants the daily Swap Tickets once per daily reset period; returns the amount granted (0 if already claimed).
function claimDailySwapTickets(userId, timestamp = Date.now()) {
  assertUserId(userId);
  return db.transaction(() => {
    const key = `daily_swap_tickets:${userId}`;
    const today = getDailyResetDay(timestamp);
    const last = Number(db.prepare('SELECT value FROM bot_settings WHERE key = ?').get(key)?.value);
    if (Number.isSafeInteger(last) && last >= today) return 0;
    db.prepare(`
      INSERT INTO bot_settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, String(today));
    addUserItem(userId, 'Swap Ticket', DAILY_SWAP_TICKETS);
    return DAILY_SWAP_TICKETS;
  }).immediate();
}

function recordDailyCatch(userId, username, timestamp = Date.now()) {
  assertUserId(userId);
  if (typeof username !== 'string' || !username.trim()) {
    throw new TypeError('A non-empty username is required to record a daily catch.');
  }
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new TypeError('Catch timestamp must be a non-negative safe integer.');
  }
  const resetDay = getDailyResetDay(timestamp);
  return db.transaction(() => {
    db.prepare(`
      INSERT INTO daily_catch_counts (reset_day, user_id, username, catches)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(reset_day, user_id) DO UPDATE SET
        username = excluded.username,
        catches = daily_catch_counts.catches + 1
    `).run(resetDay, userId, username.trim());
    db.prepare('DELETE FROM daily_catch_counts WHERE reset_day < ?').run(resetDay);
    return db.prepare(
      'SELECT catches FROM daily_catch_counts WHERE reset_day = ? AND user_id = ?'
    ).get(resetDay, userId).catches;
  }).immediate();
}

function getDailyCatchLeaderboard(timestamp = Date.now()) {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new TypeError('Leaderboard timestamp must be a non-negative safe integer.');
  }
  return db.prepare(`
    SELECT user_id, username, catches
    FROM daily_catch_counts
    WHERE reset_day = ?
    ORDER BY catches DESC, username COLLATE NOCASE ASC, user_id ASC
    LIMIT 10
  `).all(getDailyResetDay(timestamp));
}

function recordWildEncounterCounter(userId, source) {
  assertUserId(userId);
  if (!['pokemon', 'fishing'].includes(source)) {
    throw new TypeError('Encounter counter source must be pokemon or fishing.');
  }
  for (const category of ['legendary', 'shiny']) {
    initializeEncounterCounter.run(userId, source, category);
  }
  db.prepare(`
    UPDATE user_encounter_counters
    SET encounters_since = encounters_since + 1
    WHERE user_id = ? AND source = ?
  `).run(userId, source);
}

function resetEncounterCounters(userId, source, categories, pokemonName, timestamp = Date.now()) {
  assertUserId(userId);
  if (!['pokemon', 'fishing'].includes(source)) {
    throw new TypeError('Encounter counter source must be pokemon or fishing.');
  }
  if (!Array.isArray(categories) || categories.some((category) => !['legendary', 'shiny'].includes(category))) {
    throw new TypeError('Encounter counter categories must be legendary or shiny.');
  }
  if (typeof pokemonName !== 'string' || !pokemonName.trim()) {
    throw new TypeError('A Pokémon name is required to reset an encounter counter.');
  }
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new TypeError('Catch timestamp must be a non-negative safe integer.');
  }
  const uniqueCategories = [...new Set(categories)];
  const update = db.prepare(`
    UPDATE user_encounter_counters
    SET encounters_since = 0, last_caught_at = ?, last_pokemon = ?, last_catcher_id = ?
    WHERE user_id = ? AND source = ? AND category = ?
  `);
  db.transaction(() => {
    for (const category of uniqueCategories) {
      initializeEncounterCounter.run(userId, source, category);
    }
    for (const category of uniqueCategories) {
      update.run(timestamp, pokemonName.trim(), userId, userId, source, category);
    }
  }).immediate();
  return uniqueCategories;
}

function getEncounterCounters(userId) {
  assertUserId(userId);
  for (const source of ['pokemon', 'fishing']) {
    for (const category of ['legendary', 'shiny']) {
      initializeEncounterCounter.run(userId, source, category);
    }
  }
  return db.prepare(`
    SELECT source, category, encounters_since, last_caught_at, last_pokemon
    FROM user_encounter_counters
    WHERE user_id = ?
    ORDER BY source, category
  `).all(userId);
}

function getNextDailyReset(timestamp = Date.now()) {
  return (getDailyResetDay(timestamp) + 1) * DAILY_PERIOD_MS + DAILY_RESET_OFFSET_MS;
}

function resetChecklistIfNewDay(userId) {
  const user = getUser(userId);
  if (
    user.last_daily > 0
    && getDailyResetDay(Date.now()) > getDailyResetDay(user.last_daily)
    && (user.cl_daily_claimed === 1 || user.cl_claimed === 1)
  ) {
    updateUser(userId, {
      cl_catches: 0,
      cl_fishes: 0,
      cl_battles: 0,
      cl_event_catches: 0,
      cl_daily_claimed: 0,
      cl_claimed: 0,
    });
  }
}

function registerEvent(event) {
  if (!event || typeof event.id !== 'string' || !Array.isArray(event.pokemon)) {
    throw new TypeError('Event must have an id and a Pokémon checklist.');
  }

  const insert = db.prepare(`
    INSERT INTO event_pokemon (event_id, pokemon_key, name, match_names, shiny)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(event_id, pokemon_key) DO UPDATE SET
      name = excluded.name,
      match_names = excluded.match_names,
      shiny = excluded.shiny
  `);
  const allowedKeys = new Set(event.pokemon.map((pokemon) => pokemon.key));

  db.transaction(() => {
    for (const pokemon of event.pokemon) {
      if (!pokemon.key || !pokemon.name || !Array.isArray(pokemon.matchNames)) {
        throw new TypeError(`Invalid Pokémon entry in event ${event.id}.`);
      }
      insert.run(
        event.id,
        pokemon.key,
        pokemon.name,
        JSON.stringify(pokemon.matchNames.map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, ''))),
        pokemon.shiny ? 1 : 0
      );
    }
    const existing = db.prepare('SELECT pokemon_key FROM event_pokemon WHERE event_id = ?').all(event.id);
    const remove = db.prepare('DELETE FROM event_pokemon WHERE event_id = ? AND pokemon_key = ?');
    for (const row of existing) {
      if (!allowedKeys.has(row.pokemon_key)) remove.run(event.id, row.pokemon_key);
    }
  })();
}

function trackEventCatch(eventId, userId, pokemonName, isShiny) {
  return Boolean(recordEventCatch(eventId, userId, pokemonName, isShiny)?.added);
}

function recordEventCatch(eventId, userId, pokemonName, isShiny) {
  const user = getUser(userId);
  if (!user.event_ticket) return null;
  const matchName = `${pokemonName}`.toLowerCase().replace(/[^a-z0-9]/g, '');
  const eventPokemon = db.prepare(`
    SELECT pokemon_key, name FROM event_pokemon
    WHERE event_id = ?
      AND instr(match_names, ?) > 0
      AND shiny = ?
  `).all(eventId, `"${matchName}"`, isShiny ? 1 : 0);
  if (!eventPokemon.length) return null;
  const insert = db.prepare(`
    INSERT OR IGNORE INTO event_catches (event_id, user_id, pokemon_key)
    VALUES (?, ?, ?)
  `);
  const bump = db.prepare(`
    UPDATE event_catches SET catch_count = catch_count + 1
    WHERE event_id = ? AND user_id = ? AND pokemon_key = ?
  `);
  let added = 0;
  for (const pokemon of eventPokemon) {
    const inserted = insert.run(eventId, userId, pokemon.pokemon_key).changes;
    added += inserted;
    if (!inserted) bump.run(eventId, userId, pokemon.pokemon_key);
  }
  const progress = getUserEventProgress(eventId, userId);
  return {
    matches: eventPokemon,
    added: added > 0,
    progressCount: progress.size,
    totalCount: db.prepare('SELECT COUNT(*) AS count FROM event_pokemon WHERE event_id = ?')
      .get(eventId).count,
  };
}

function getUserEventCatchCounts(eventId, userId) {
  return new Map(db.prepare(
    'SELECT pokemon_key, catch_count FROM event_catches WHERE event_id = ? AND user_id = ?'
  ).all(eventId, userId).map((row) => [row.pokemon_key, row.catch_count]));
}

function getUserEventProgress(eventId, userId) {
  return new Set(db.prepare(
    'SELECT pokemon_key FROM event_catches WHERE event_id = ? AND user_id = ?'
  ).all(eventId, userId).map((row) => row.pokemon_key));
}

function getPlayerClan(userId) {
  return db.prepare(`
    SELECT clans.*, clan_members.catches, clan_members.fishes, clan_members.perk_rank
    FROM clan_members
    JOIN clans ON clans.id = clan_members.clan_id
    WHERE clan_members.user_id = ?
  `).get(userId) || null;
}

function getClanPerkMultipliers(clan) {
  if (!clan) {
    return {
      crBonus: 0, srBonus: 0, erBonus: 0, prBonus: 0, shopDiscount: 0, amuletBoost: 0,
      amuletCoins: 0, questSlotBonus: 0, eggHatchBonus: 0,
    };
  }
  const crTable = [0, 1, 3, 5, 10];
  const srTable = [0, 1, 3, 5, 10];
  const erTable = [0, 5, 10, 15, 20];
  const prTable = [0, 5, 10];
  const purchasedRank = Number.isSafeInteger(clan.perk_rank)
    ? Math.max(0, Math.min(clan.perk_rank, CLAN_RANKS.length - 1))
    : 0;
  const purchasedPerks = CLAN_RANKS[purchasedRank];
  return {
    crBonus: crTable[purchasedPerks.cr] || 0,
    srBonus: srTable[purchasedPerks.sr] || 0,
    erBonus: erTable[purchasedPerks.er] || 0,
    prBonus: prTable[purchasedPerks.pr] || 0,
    shopDiscount: (purchasedPerks.shop || 0) * 0.05,
    // Each Amulet Boost level is one invisible Amulet Coin (+5% coins from catches).
    amuletCoins: purchasedPerks.amulet || 0,
    amuletBoost: (purchasedPerks.amulet || 0) * 0.05,
    questSlotBonus: purchasedPerks.quest || 0,
    eggHatchBonus: purchasedPerks.hatch || 0,
  };
}

function getTotalEffectiveShinyBonus(userId) {
  const user = getUser(userId);
  const clanPerks = getClanPerkMultipliers(getPlayerClan(userId));
  return Math.max(0, user.shiny_charms || 0)
    + (user.black_market_charm ? 1 : 0)
    + getPatreonPerks(userId).shinyCharms
    + clanPerks.srBonus;
}

// perkCatches/perkCost are the per-member purchase requirements (catches are divided by member count).
const CLAN_RANKS = [
  { name: 'starter', catches: 0, cost: 0, perkCatches: 0, perkCost: 0, memberLimit: 25, cr: 0, sr: 0, er: 0, pr: 0, shop: 0, amulet: 0, quest: 0, hatch: 0 },
  { name: 'bronze', catches: 100000, cost: 2500000, perkCatches: 100000, perkCost: 100000, memberLimit: 35, cr: 1, sr: 1, er: 0, pr: 0, shop: 0, amulet: 0, quest: 0, hatch: 0 },
  { name: 'silver', catches: 500000, cost: 12500000, perkCatches: 500000, perkCost: 250000, memberLimit: 40, cr: 2, sr: 2, er: 0, pr: 0, shop: 0, amulet: 0, quest: 0, hatch: 0 },
  { name: 'gold', catches: 2500000, cost: 62500000, perkCatches: 2500000, perkCost: 500000, memberLimit: 45, cr: 3, sr: 3, er: 1, pr: 0, shop: 0, amulet: 1, quest: 0, hatch: 0 },
  { name: 'diamond', catches: 5000000, cost: 125000000, perkCatches: 5000000, perkCost: 1000000, memberLimit: 50, cr: 4, sr: 4, er: 2, pr: 0, shop: 1, amulet: 1, quest: 0, hatch: 0 },
  { name: 'amethyst', catches: 15000000, cost: 375000000, perkCatches: 15000000, perkCost: 10000000, memberLimit: 65, cr: 4, sr: 4, er: 3, pr: 1, shop: 1, amulet: 1, quest: 1, hatch: 0 },
  { name: 'onyx', catches: 30000000, cost: 750000000, perkCatches: 30000000, perkCost: 25000000, memberLimit: 75, cr: 4, sr: 4, er: 4, pr: 2, shop: 2, amulet: 2, quest: 1, hatch: 1 },
];

function getClanRankInfo(clan) {
  const rankName = clan?.clan_rank || 'starter';
  return CLAN_RANKS.find((rank) => rank.name === rankName) || CLAN_RANKS[0];
}

function getNextClanRankInfo(clan) {
  const currentRank = getClanRankInfo(clan);
  return CLAN_RANKS[CLAN_RANKS.indexOf(currentRank) + 1] || null;
}

const MAX_CLAN_CO_LEADERS = 3;

function getClanCoLeaderIds(clan) {
  let ids = [];
  try {
    const parsed = JSON.parse(clan?.co_leader_ids || '[]');
    if (Array.isArray(parsed)) ids = parsed.filter((id) => typeof id === 'string');
  } catch {
    ids = [];
  }
  if (clan?.co_leader_id && !ids.includes(clan.co_leader_id)) ids.unshift(clan.co_leader_id);
  return ids;
}

function saveClanCoLeaderIds(clanId, ids) {
  db.prepare('UPDATE clans SET co_leader_id = ?, co_leader_ids = ? WHERE id = ?')
    .run(ids[0] || null, JSON.stringify(ids), clanId);
}

// targetUserId null removes all co-owners; remove=true removes just that member.
function setClanCoLeader(userId, targetUserId, remove = false) {
  return db.transaction(() => {
    const clan = getPlayerClan(userId);
    if (!clan) return { error: 'not_member' };
    if (clan.leader_id !== userId) return { error: 'not_leader' };
    let ids = getClanCoLeaderIds(clan);
    if (targetUserId === null) {
      ids = [];
    } else if (remove) {
      if (!ids.includes(targetUserId)) return { error: 'not_co_owner' };
      ids = ids.filter((id) => id !== targetUserId);
    } else {
      if (targetUserId === userId) return { error: 'self' };
      const member = db.prepare(
        'SELECT 1 FROM clan_members WHERE user_id = ? AND clan_id = ?'
      ).get(targetUserId, clan.id);
      if (!member) return { error: 'not_member_target' };
      if (ids.includes(targetUserId)) return { error: 'already_co_owner' };
      if (ids.length >= MAX_CLAN_CO_LEADERS) {
        return { error: 'co_owner_limit', limit: MAX_CLAN_CO_LEADERS };
      }
      ids.push(targetUserId);
    }
    saveClanCoLeaderIds(clan.id, ids);
    return { clan, targetUserId };
  }).immediate();
}

function transferClanOwnership(userId, targetUserId) {
  if (typeof targetUserId !== 'string' || !targetUserId) {
    throw new TypeError('targetUserId must be a non-empty user ID.');
  }
  return db.transaction(() => {
    const clan = getPlayerClan(userId);
    if (!clan) return { error: 'not_member' };
    if (clan.leader_id !== userId) return { error: 'not_leader' };
    if (targetUserId === userId) return { error: 'self' };
    const target = db.prepare(
      'SELECT 1 FROM clan_members WHERE user_id = ? AND clan_id = ?'
    ).get(targetUserId, clan.id);
    if (!target) return { error: 'not_member_target' };

    const ids = getClanCoLeaderIds(clan).filter((id) => id !== targetUserId);
    ids.unshift(userId);
    db.prepare('UPDATE clans SET leader_id = ? WHERE id = ?').run(targetUserId, clan.id);
    saveClanCoLeaderIds(clan.id, ids.slice(0, MAX_CLAN_CO_LEADERS));
    return { clan, previousOwnerId: userId, newOwnerId: targetUserId };
  }).immediate();
}

function purchaseClanRank(userId, rank) {
  const selected = CLAN_RANKS.find((entry) => entry.name === rank);
  if (!selected || selected.name === 'starter') return { error: 'invalid_rank' };
  return db.transaction(() => {
    const clan = getPlayerClan(userId);
    if (!clan) return { error: 'not_member' };
    if (clan.leader_id !== userId && !getClanCoLeaderIds(clan).includes(userId)) {
      return { error: 'not_owner' };
    }
    const currentRank = getClanRankInfo(clan);
    const nextRank = CLAN_RANKS[CLAN_RANKS.indexOf(currentRank) + 1];
    if (!nextRank || nextRank.name !== selected.name) {
      return { error: 'wrong_order', nextRank: nextRank?.name || null };
    }
    const totalCatches = db.prepare(
      'SELECT COALESCE(SUM(catches), 0) AS total FROM clan_members WHERE clan_id = ?'
    ).get(clan.id).total;
    if (totalCatches < selected.catches) {
      return { error: 'catch_requirement', required: selected.catches, total: totalCatches };
    }
    if (clan.treasury < selected.cost) {
      return { error: 'insufficient_treasury', required: selected.cost, treasury: clan.treasury };
    }
    if (clan.clan_rank === selected.name) {
      return { error: 'already_unlocked' };
    }
    db.prepare(`
      UPDATE clans
      SET clan_rank = ?, treasury = treasury - ?,
        cr_tier = ?, sr_tier = ?, er_tier = ?, pr_tier = ?,
        shop_boost = ?, amulet_boost = ?
      WHERE id = ?
    `).run(
      selected.name, selected.cost,
      selected.cr, selected.sr, selected.er, selected.pr,
      selected.shop, selected.amulet, clan.id
    );
    return { clan, cost: selected.cost, rank: selected.name, totalCatches, treasury: clan.treasury - selected.cost };
  }).immediate();
}

function purchaseClanPerks(userId, rank) {
  const selectedIndex = CLAN_RANKS.findIndex((entry) => entry.name === rank);
  if (selectedIndex <= 0) return { error: 'invalid_rank' };
  const selected = CLAN_RANKS[selectedIndex];
  return db.transaction(() => {
    const clan = getPlayerClan(userId);
    if (!clan) return { error: 'not_member' };
    const clanRankIndex = CLAN_RANKS.findIndex((entry) => entry.name === clan.clan_rank);
    if (selectedIndex > clanRankIndex) {
      return { error: 'rank_locked', clanRank: clan.clan_rank };
    }
    if (selectedIndex !== clan.perk_rank + 1) {
      return {
        error: selectedIndex <= clan.perk_rank ? 'already_purchased' : 'wrong_order',
        nextRank: CLAN_RANKS[clan.perk_rank + 1]?.name || null,
      };
    }
    const memberCount = db.prepare(
      'SELECT COUNT(*) AS count FROM clan_members WHERE clan_id = ?'
    ).get(clan.id).count;
    const requiredCatches = Math.floor(selected.perkCatches / memberCount);
    if (clan.catches < requiredCatches) {
      return {
        error: 'catch_requirement',
        rank: selected.name,
        required: requiredCatches,
        total: clan.catches,
        remaining: requiredCatches - clan.catches,
        memberCount,
      };
    }
    const user = getUser(userId);
    if (user.coins < selected.perkCost) {
      return {
        error: 'insufficient_funds',
        rank: selected.name,
        required: selected.perkCost,
        balance: user.coins,
      };
    }
    incrementUser(userId, { coins: -selected.perkCost });
    db.prepare('UPDATE clan_members SET perk_rank = ? WHERE user_id = ? AND clan_id = ?')
      .run(selectedIndex, userId, clan.id);
    return {
      clan,
      rank: selected.name,
      cost: selected.perkCost,
      requiredCatches,
      memberCount,
      perks: getClanPerkMultipliers({ ...clan, perk_rank: selectedIndex }),
    };
  }).immediate();
}

function getClanPerkPurchaseInfo(userId) {
  const clan = getPlayerClan(userId);
  if (!clan) return null;
  const nextRank = CLAN_RANKS[clan.perk_rank + 1] || null;
  if (!nextRank) return { clan, nextRank: null, memberCount: 0, requiredCatches: 0 };
  const clanRankIndex = CLAN_RANKS.findIndex((entry) => entry.name === clan.clan_rank);
  const memberCount = db.prepare(
    'SELECT COUNT(*) AS count FROM clan_members WHERE clan_id = ?'
  ).get(clan.id).count;
  return {
    clan,
    nextRank,
    unlocked: clanRankIndex >= clan.perk_rank + 1,
    memberCount,
    requiredCatches: Math.floor(nextRank.perkCatches / memberCount),
  };
}

function depositClanTreasury(userId, amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new TypeError('Treasury deposit must be a positive safe integer.');
  }
  return db.transaction(() => {
    const clan = getPlayerClan(userId);
    if (!clan) return { error: 'not_member' };
    const user = getUser(userId);
    if (user.coins < amount) return { error: 'insufficient_funds', balance: user.coins };
    incrementUser(userId, { coins: -amount });
    db.prepare('UPDATE clans SET treasury = treasury + ? WHERE id = ?').run(amount, clan.id);
    db.prepare(`
      UPDATE clan_members SET donated_coins = donated_coins + ?
      WHERE user_id = ? AND clan_id = ?
    `).run(amount, userId, clan.id);
    return { clan, treasury: clan.treasury + amount, deposited: amount };
  }).immediate();
}

function getClanByName(name) {
  return db.prepare('SELECT * FROM clans WHERE name = ? COLLATE NOCASE').get(name) || null;
}

function getClanMembers(clanId) {
  return db.prepare(`
    SELECT clan_members.user_id, clan_members.catches, clan_members.fishes,
      clan_members.donated_coins, clan_members.joined_at, clan_members.hatches,
      clan_members.swaps, clan_members.catchbot
    FROM clan_members
    WHERE clan_id = ?
    ORDER BY clan_members.catches DESC, clan_members.fishes DESC, clan_members.joined_at ASC
  `).all(clanId);
}

const CLAN_PERIOD_OFFSET_MS = 5 * 60 * 60 * 1000;
const CLAN_DAY_MS = 24 * 60 * 60 * 1000;

function getClanPeriodBounds(period, timestamp = Date.now()) {
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(period)) {
    throw new TypeError('Clan stats period must be daily, weekly, monthly, or yearly.');
  }
  const shifted = new Date(timestamp - CLAN_PERIOD_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();
  let start;
  let end;
  if (period === 'daily') {
    start = Date.UTC(year, month, day) + CLAN_PERIOD_OFFSET_MS;
    end = start + CLAN_DAY_MS;
  } else if (period === 'weekly') {
    const monday = day - ((shifted.getUTCDay() + 6) % 7);
    start = Date.UTC(year, month, monday) + CLAN_PERIOD_OFFSET_MS;
    end = start + 7 * CLAN_DAY_MS;
  } else if (period === 'monthly') {
    start = Date.UTC(year, month, 1) + CLAN_PERIOD_OFFSET_MS;
    end = Date.UTC(year, month + 1, 1) + CLAN_PERIOD_OFFSET_MS;
  } else {
    start = Date.UTC(year, 0, 1) + CLAN_PERIOD_OFFSET_MS;
    end = Date.UTC(year + 1, 0, 1) + CLAN_PERIOD_OFFSET_MS;
  }
  return { start, end };
}

function getClanActivityStats(clanId, period = 'daily', category = 'catches', userId = null, timestamp = Date.now()) {
  const columns = {
    catches: 'catches',
    fishes: 'fishes',
    hatches: 'hatches',
    swaps: 'swaps',
    catchbot: 'catchbot',
    battles: 'battles',
  };
  const column = columns[category];
  if (!column) throw new TypeError('Unknown clan stats category.');
  const { start, end } = getClanPeriodBounds(period, timestamp);
  const rows = db.prepare(`
    SELECT cm.user_id, cm.catches, cm.fishes, cm.hatches, cm.swaps, cm.catchbot,
      COALESCE(activity.catches, 0) AS period_catches,
      COALESCE(activity.fishes, 0) AS period_fishes,
      COALESCE(activity.hatches, 0) AS period_hatches,
      COALESCE(activity.swaps, 0) AS period_swaps,
      COALESCE(activity.catchbot, 0) AS period_catchbot,
      COALESCE(activity.battles, 0) AS period_battles
    FROM clan_members cm
    LEFT JOIN clan_activity_periods activity
      ON activity.clan_id = cm.clan_id
      AND activity.user_id = cm.user_id
      AND activity.period = ?
      AND activity.period_start = ?
    WHERE cm.clan_id = ?
    ORDER BY activity.${column} DESC, activity.catches DESC, activity.fishes DESC, cm.joined_at ASC
  `).all(period, start, clanId);
  const totals = rows.reduce((summary, row) => ({
    catches: summary.catches + row.period_catches,
    fishes: summary.fishes + row.period_fishes,
    hatches: summary.hatches + row.period_hatches,
    swaps: summary.swaps + row.period_swaps,
    catchbot: summary.catchbot + row.period_catchbot,
    battles: summary.battles + row.period_battles,
  }), { catches: 0, fishes: 0, hatches: 0, swaps: 0, catchbot: 0, battles: 0 });
  const rankedRows = rows.map((row, index) => ({
    ...row,
    rank: index + 1,
    categoryCount: row[`period_${column}`],
  }));
  return {
    period,
    category,
    start,
    end,
    totals,
    rows: rankedRows,
    memberRank: userId
      ? rankedRows.find((row) => row.user_id === userId)?.rank || null
      : null,
    memberCount: rows.length,
  };
}

function getClanLeaderboard() {
  return db.prepare(`
    SELECT clans.id, clans.name, clans.clan_rank, clans.leader_id,
      COUNT(clan_members.user_id) AS member_count,
      COALESCE(SUM(clan_members.catches), 0) AS catches,
      COALESCE(SUM(clan_members.fishes), 0) AS fishes,
      COALESCE(SUM(clan_members.catches + clan_members.fishes), 0) AS total_activity
    FROM clans
    LEFT JOIN clan_members ON clan_members.clan_id = clans.id
    GROUP BY clans.id
    ORDER BY total_activity DESC, clans.name COLLATE NOCASE ASC
  `).all();
}

function getClanHighScores(category = 'monthly', limit = 100, timestamp = Date.now()) {
  const categories = new Set([
    'monthly',
    'yearly',
    'catches',
    'hatches',
    'swaps',
    'catchbot',
    'treasury',
    'fishes',
  ]);
  if (!categories.has(category)) throw new TypeError('Unknown clan highscore category.');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new TypeError('Clan highscore limit must be between 1 and 100.');
  }

  const period = category === 'monthly' || category === 'yearly' ? category : null;
  const periodStart = period ? getClanPeriodBounds(period, timestamp).start : null;
  const rows = db.prepare(`
    SELECT clans.id, clans.name, clans.clan_rank, clans.treasury,
      COUNT(DISTINCT cm.user_id) AS member_count,
      COALESCE(SUM(cm.catches), 0) AS catches,
      COALESCE(SUM(cm.fishes), 0) AS fishes,
      COALESCE(SUM(cm.hatches), 0) AS hatches,
      COALESCE(SUM(cm.swaps), 0) AS swaps,
      COALESCE(SUM(cm.catchbot), 0) AS catchbot,
      COALESCE(SUM(activity.catches), 0) AS period_catches
    FROM clans
    LEFT JOIN clan_members cm ON cm.clan_id = clans.id
    LEFT JOIN clan_activity_periods activity
      ON activity.clan_id = clans.id
      AND activity.user_id = cm.user_id
      AND activity.period = ?
      AND activity.period_start = ?
    GROUP BY clans.id
  `).all(period, periodStart);

  const valueForCategory = {
    monthly: (row) => row.period_catches,
    yearly: (row) => row.period_catches,
    catches: (row) => row.catches,
    hatches: (row) => row.hatches,
    swaps: (row) => row.swaps,
    catchbot: (row) => row.catchbot,
    treasury: (row) => row.treasury,
    fishes: (row) => row.fishes,
  }[category];
  return rows
    .map((row) => ({ ...row, score: valueForCategory(row) }))
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, limit)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function createClan(name, leaderId, creationCost = 1000000) {
  return db.transaction(() => {
    const user = getUser(leaderId);
    if (getPlayerClan(leaderId)) return { error: 'already_member' };
    if (user.coins < creationCost) return { error: 'insufficient_funds' };
    if (getClanByName(name)) return { error: 'name_taken' };

    const result = db.prepare(
      'INSERT INTO clans (name, leader_id) VALUES (?, ?)'
    ).run(name, leaderId);
    const clanId = Number(result.lastInsertRowid);
    db.prepare('INSERT INTO clan_members (user_id, clan_id) VALUES (?, ?)').run(leaderId, clanId);
    updateUser(leaderId, { clan: name });
    incrementUser(leaderId, { coins: -creationCost });
    return { clanId };
  }).immediate();
}

function joinClan(userId, clanId) {
  return db.transaction(() => {
    getUser(userId);
    if (getPlayerClan(userId)) return { error: 'already_member' };
    const clan = db.prepare('SELECT * FROM clans WHERE id = ?').get(clanId);
    if (!clan) return { error: 'not_found' };
    const memberCount = db.prepare(
      'SELECT COUNT(*) AS count FROM clan_members WHERE clan_id = ?'
    ).get(clanId).count;
    if (memberCount >= getClanRankInfo(clan).memberLimit) {
      return { error: 'full', memberLimit: getClanRankInfo(clan).memberLimit };
    }
    db.prepare('INSERT INTO clan_members (user_id, clan_id) VALUES (?, ?)').run(userId, clanId);
    updateUser(userId, { clan: clan.name });
    return { clan };
  }).immediate();
}

function leaveClan(userId) {
  return db.transaction(() => {
    const clan = getPlayerClan(userId);
    if (!clan) return { error: 'not_member' };
    if (clan.leader_id === userId) return { error: 'leader' };
    const coLeaders = getClanCoLeaderIds(clan);
    if (coLeaders.includes(userId)) {
      saveClanCoLeaderIds(clan.id, coLeaders.filter((id) => id !== userId));
    }
    db.prepare('DELETE FROM clan_members WHERE user_id = ?').run(userId);
    updateUser(userId, { clan: 'None' });
    return { clan };
  }).immediate();
}

function disbandClan(userId) {
  return db.transaction(() => {
    const clan = getPlayerClan(userId);
    if (!clan) return { error: 'not_member' };
    if (clan.leader_id !== userId) return { error: 'not_leader' };
    db.prepare('UPDATE users SET clan = ? WHERE clan = ?').run('None', clan.name);
    db.prepare('DELETE FROM clans WHERE id = ?').run(clan.id);
    return { clan };
  }).immediate();
}

db.exec('CREATE TABLE IF NOT EXISTS banned_users (user_id TEXT PRIMARY KEY, banned_at INTEGER NOT NULL)');

function banUser(userId) {
  db.prepare('INSERT OR REPLACE INTO banned_users (user_id, banned_at) VALUES (?, ?)').run(userId, Date.now());
}

function unbanUser(userId) {
  return db.prepare('DELETE FROM banned_users WHERE user_id = ?').run(userId).changes > 0;
}

function isUserBanned(userId) {
  return !!db.prepare('SELECT 1 FROM banned_users WHERE user_id = ?').get(userId);
}

function wipeUserData(userId) {
  const keep = new Set(['banned_users', 'market_sales', 'patreon_token_trades']);
  return db.transaction(() => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
    const deleted = {};
    for (const { name } of tables) {
      if (keep.has(name)) continue;
      const columns = db.prepare(`PRAGMA table_info("${name}")`).all().map((c) => c.name);
      const idColumns = columns.filter((c) =>
        (name === 'users' && c === 'id') || ['user_id', 'seller_id', 'sender_id', 'receiver_id'].includes(c)
      );
      for (const column of idColumns) {
        const { changes } = db.prepare(`DELETE FROM "${name}" WHERE "${column}" = ?`).run(userId);
        if (changes) deleted[name] = (deleted[name] || 0) + changes;
      }
    }
    return deleted;
  }).immediate();
}

function deleteClanByName(name) {
  return db.transaction(() => {
    const clan = db.prepare('SELECT * FROM clans WHERE LOWER(name) = LOWER(?)').get(name);
    if (!clan) return null;
    db.prepare('UPDATE users SET clan = ? WHERE clan = ?').run('None', clan.name);
    for (const table of ['clan_members', 'clan_activity_periods']) {
      db.prepare(`DELETE FROM ${table} WHERE clan_id = ?`).run(clan.id);
    }
    db.prepare('DELETE FROM clans WHERE id = ?').run(clan.id);
    return clan;
  }).immediate();
}

function trackClanActivity(userId, type) {
  const columns = {
    catch: 'catches',
    fish: 'fishes',
    hatch: 'hatches',
    swap: 'swaps',
    catchbot: 'catchbot',
    battle: 'battles',
  };
  const column = columns[type];
  if (!column) {
    throw new TypeError('Clan activity type must be catch, fish, hatch, swap, catchbot, or battle.');
  }
  return db.transaction(() => {
    const member = db.prepare(
      'SELECT clan_id FROM clan_members WHERE user_id = ?'
    ).get(userId);
    if (!member) return false;
    db.prepare(`UPDATE clan_members SET ${column} = ${column} + 1 WHERE user_id = ?`)
      .run(userId);
    const now = Date.now();
    const insertPeriodActivity = db.prepare(`
      INSERT INTO clan_activity_periods (clan_id, user_id, period, period_start, ${column})
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(clan_id, user_id, period, period_start)
      DO UPDATE SET ${column} = ${column} + 1
    `);
    for (const period of ['daily', 'weekly', 'monthly', 'yearly']) {
      const { start } = getClanPeriodBounds(period, now);
      insertPeriodActivity.run(member.clan_id, userId, period, start);
    }
    return true;
  }).immediate();
}

function getEventAnnouncementChannel(eventId, guildId) {
  return db.prepare(
    'SELECT channel_id FROM event_announcement_channels WHERE event_id = ? AND guild_id = ?'
  ).get(eventId, guildId)?.channel_id || null;
}

function setEventAnnouncementChannel(eventId, guildId, channelId) {
  if (channelId === null) {
    return db.prepare(
      'DELETE FROM event_announcement_channels WHERE event_id = ? AND guild_id = ?'
    ).run(eventId, guildId).changes > 0;
  }
  db.prepare(`
    INSERT INTO event_announcement_channels (event_id, guild_id, channel_id)
    VALUES (?, ?, ?)
    ON CONFLICT(event_id, guild_id) DO UPDATE SET channel_id = excluded.channel_id
  `).run(eventId, guildId, channelId);
  return true;
}

function getAllEventAnnouncementChannels(eventId) {
  return db.prepare(
    'SELECT guild_id, channel_id FROM event_announcement_channels WHERE event_id = ?'
  ).all(eventId);
}

function getAllRareSpawnAnnouncementChannels() {
  return db.prepare(
    'SELECT guild_id, channel_id FROM rare_spawn_announcement_channels'
  ).all();
}

function getRareSpawnAnnouncementChannel(guildId) {
  return db.prepare(
    'SELECT channel_id FROM rare_spawn_announcement_channels WHERE guild_id = ?'
  ).get(guildId)?.channel_id || null;
}

function setRareSpawnAnnouncementChannel(guildId, channelId) {
  if (typeof guildId !== 'string' || !guildId) {
    throw new TypeError('A valid guild ID is required.');
  }
  if (channelId === null) {
    return db.prepare(
      'DELETE FROM rare_spawn_announcement_channels WHERE guild_id = ?'
    ).run(guildId).changes > 0;
  }
  if (typeof channelId !== 'string' || !channelId) {
    throw new TypeError('A valid channel ID or null is required.');
  }
  db.prepare(`
    INSERT INTO rare_spawn_announcement_channels (guild_id, channel_id)
    VALUES (?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET channel_id = excluded.channel_id
  `).run(guildId, channelId);
  return true;
}

function claimRareSpawnAnnouncement(eventId, userId, pokemonKey) {
  if ([eventId, userId, pokemonKey].some((value) => typeof value !== 'string' || !value)) {
    throw new TypeError('Rare-spawn announcement requires event, user, and Pokémon keys.');
  }
  return db.prepare(`
    INSERT OR IGNORE INTO rare_spawn_announcements (event_id, user_id, pokemon_key)
    VALUES (?, ?, ?)
  `).run(eventId, userId, pokemonKey).changes > 0;
}

function releaseRareSpawnAnnouncement(eventId, userId, pokemonKey) {
  if ([eventId, userId, pokemonKey].some((value) => typeof value !== 'string' || !value)) {
    throw new TypeError('Rare-spawn announcement requires event, user, and Pokémon keys.');
  }
  return db.prepare(`
    DELETE FROM rare_spawn_announcements
    WHERE event_id = ? AND user_id = ? AND pokemon_key = ?
  `).run(eventId, userId, pokemonKey).changes > 0;
}

function getWorldBossAnnouncementChannel(guildId) {
  return db.prepare(
    'SELECT channel_id FROM world_boss_announcement_channels WHERE guild_id = ?'
  ).get(guildId)?.channel_id || null;
}

function setWorldBossAnnouncementChannel(guildId, channelId) {
  if (typeof guildId !== 'string' || !guildId) {
    throw new TypeError('A valid guild ID is required.');
  }
  if (channelId === null) {
    return db.prepare(
      'DELETE FROM world_boss_announcement_channels WHERE guild_id = ?'
    ).run(guildId).changes > 0;
  }
  if (typeof channelId !== 'string' || !channelId) {
    throw new TypeError('A valid channel ID or null is required.');
  }
  db.prepare(`
    INSERT INTO world_boss_announcement_channels (guild_id, channel_id)
    VALUES (?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET channel_id = excluded.channel_id
  `).run(guildId, channelId);
  return true;
}

function getMarketAnnouncementChannel(guildId) {
  return db.prepare(
    'SELECT channel_id FROM market_announcement_channels WHERE guild_id = ?'
  ).get(guildId)?.channel_id || null;
}

function getUserRegisteredCollections(userId) {
  assertUserId(userId);
  return db.prepare(
    'SELECT * FROM global_collections WHERE user_id = ? ORDER BY updated_at DESC, id DESC'
  ).all(userId);
}

function registerCollection(userId, pokemonId, pokemonName, buyPrice, isShiny = false, isGolden = false) {
  assertUserId(userId);
  if (!Number.isSafeInteger(pokemonId) || pokemonId <= 0) {
    throw new TypeError('pokemonId must be a positive safe integer.');
  }
  if (typeof pokemonName !== 'string' || !pokemonName.trim()) {
    throw new TypeError('pokemonName must be a non-empty string.');
  }
  if (buyPrice !== null && (!Number.isSafeInteger(buyPrice) || buyPrice <= 0)) {
    throw new TypeError('buyPrice must be a positive safe integer or null.');
  }
  if (typeof isShiny !== 'boolean') throw new TypeError('isShiny must be a boolean.');
  if (typeof isGolden !== 'boolean') throw new TypeError('isGolden must be a boolean.');
  return db.transaction(() => {
    const exists = db.prepare(
      'SELECT 1 FROM global_collections WHERE user_id = ? AND pokemon_id = ? AND is_shiny = ? AND is_golden = ?'
    ).get(userId, pokemonId, Number(isShiny), Number(isGolden));
    if (!exists) {
      const count = db.prepare(
        'SELECT COUNT(*) AS count FROM global_collections WHERE user_id = ?'
      ).get(userId).count;
      if (count >= 15) return false;
    }
    db.prepare(`
      INSERT INTO global_collections (user_id, pokemon_id, is_shiny, is_golden, pokemon_name, buy_price, is_private, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, pokemon_id, is_shiny, is_golden) DO UPDATE SET
        pokemon_name = excluded.pokemon_name,
        buy_price = excluded.buy_price,
        updated_at = CURRENT_TIMESTAMP
    `).run(userId, pokemonId, Number(isShiny), Number(isGolden), pokemonName.trim(), buyPrice);
    return true;
  }).immediate();
}

function deleteCollection(userId, pokemonId, isShiny = false, isGolden = false) {
  assertUserId(userId);
  if (!Number.isSafeInteger(pokemonId) || pokemonId <= 0) {
    throw new TypeError('pokemonId must be a positive safe integer.');
  }
  if (typeof isShiny !== 'boolean') throw new TypeError('isShiny must be a boolean.');
  return db.prepare(
    'DELETE FROM global_collections WHERE user_id = ? AND pokemon_id = ? AND is_shiny = ? AND is_golden = ?'
  ).run(userId, pokemonId, Number(isShiny), Number(isGolden)).changes > 0;
}

function setCollectionPrivacy(userId, pokemonIdOrAll, isPrivate, isShiny = false, isGolden = false) {
  assertUserId(userId);
  if (typeof isPrivate !== 'boolean') {
    throw new TypeError('isPrivate must be a boolean.');
  }
  if (typeof isShiny !== 'boolean') throw new TypeError('isShiny must be a boolean.');
  if (pokemonIdOrAll === 'all') {
    return db.prepare(
      'UPDATE global_collections SET is_private = ? WHERE user_id = ?'
    ).run(isPrivate ? 1 : 0, userId).changes;
  }
  if (!Number.isSafeInteger(pokemonIdOrAll) || pokemonIdOrAll <= 0) {
    throw new TypeError('pokemonIdOrAll must be a positive safe integer or "all".');
  }
  return db.prepare(
    'UPDATE global_collections SET is_private = ? WHERE user_id = ? AND pokemon_id = ? AND is_shiny = ? AND is_golden = ?'
  ).run(isPrivate ? 1 : 0, userId, pokemonIdOrAll, Number(isShiny), Number(isGolden)).changes;
}

function refreshAllCollections(userId) {
  assertUserId(userId);
  return db.prepare(`
    UPDATE global_collections
    SET updated_at = CURRENT_TIMESTAMP,
      pokemon_name = COALESCE((
        SELECT owned.name FROM catches owned
        WHERE owned.user_id = global_collections.user_id
          AND owned.pokemon_id = global_collections.pokemon_id
          AND owned.is_shiny = global_collections.is_shiny
          AND owned.is_golden = global_collections.is_golden
        LIMIT 1
      ), pokemon_name)
    WHERE user_id = ?
  `).run(userId).changes;
}

function setGiveawayChannel(guildId, channelId) {
  db.prepare(`
    INSERT INTO giveaway_channels (guild_id, channel_id) VALUES (?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET channel_id = excluded.channel_id
  `).run(guildId, channelId);
}

function getGiveawayChannel(guildId) {
  return db.prepare(
    'SELECT channel_id FROM giveaway_channels WHERE guild_id = ?'
  ).get(guildId) || null;
}

function getAutoSpawnChannel(guildId) {
  return db.prepare(
    'SELECT * FROM autospawn_channels WHERE guild_id = ? AND enabled = 1'
  ).get(guildId) || null;
}

function getAllAutoSpawnChannels() {
  return db.prepare('SELECT * FROM autospawn_channels WHERE enabled = 1').all();
}

const LOTTERY_TICKET_PRICE = 10000;
const LOTTERY_BASE_JACKPOT = 5000000;
// 1st place golden prize per draw day (EST). null = coins only.
const LOTTERY_SCHEDULE = {
  0: { name: 'Golden Eevee', speciesId: 133 }, // Sunday
  1: null, // Monday
  3: { name: 'Golden Zorua', speciesId: 570 }, // Wednesday
  5: null, // Friday
};

// Next Sun/Mon/Wed/Fri at 9:00 PM EST (01:00 UTC).
function getNextLotteryDrawTime(now = Date.now()) {
  const validDays = new Set([0, 1, 3, 5]);
  const base = new Date(now);
  for (let offset = 0; offset <= 8; offset++) {
    const candidate = new Date(base);
    candidate.setUTCDate(base.getUTCDate() + offset);
    candidate.setUTCHours(1, 0, 0, 0);
    if (candidate.getTime() <= now) continue;
    const estDay = new Date(candidate.getTime() - 5 * 60 * 60 * 1000).getUTCDay();
    if (validDays.has(estDay)) return candidate.getTime();
  }
  return now + 24 * 60 * 60 * 1000;
}

function getLotteryState() {
  let state = db.prepare('SELECT * FROM lottery_state WHERE id = 1').get();
  if (!state) {
    db.prepare('INSERT INTO lottery_state (id, jackpot, ends_at) VALUES (1, ?, ?)')
      .run(LOTTERY_BASE_JACKPOT, getNextLotteryDrawTime());
    state = db.prepare('SELECT * FROM lottery_state WHERE id = 1').get();
  }
  return state;
}

function getUserLotteryStats(userId) {
  assertUserId(userId);
  getUser(userId);
  db.prepare('INSERT OR IGNORE INTO lottery_user_stats (user_id) VALUES (?)').run(userId);
  return db.prepare('SELECT * FROM lottery_user_stats WHERE user_id = ?').get(userId);
}

function setLotteryChannel(guildId, channelId) {
  if (typeof guildId !== 'string' || !guildId) throw new TypeError('A valid guild ID is required.');
  if (typeof channelId !== 'string' || !channelId) throw new TypeError('A valid channel ID is required.');
  db.prepare(`
    INSERT INTO lottery_channels (guild_id, channel_id) VALUES (?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET channel_id = excluded.channel_id
  `).run(guildId, channelId);
  return true;
}

function buyLotteryTickets(userId, amount) {
  assertUserId(userId);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new TypeError('Ticket amount must be a positive integer.');
  }
  return db.transaction(() => {
    const user = getUser(userId);
    const totalCost = amount * LOTTERY_TICKET_PRICE;
    if (user.coins < totalCost) return { error: 'insufficient_coins', totalCost };
    const addedToJackpot = Math.floor(totalCost * 0.75);
    incrementUser(userId, { coins: -totalCost });
    const state = getLotteryState();
    db.prepare('UPDATE lottery_state SET jackpot = jackpot + ? WHERE id = ?').run(addedToJackpot, state.id);
    getUserLotteryStats(userId);
    const existing = db.prepare('SELECT ticket_count FROM lottery_tickets WHERE user_id = ?').get(userId);
    if (existing) {
      db.prepare('UPDATE lottery_tickets SET ticket_count = ticket_count + ? WHERE user_id = ?').run(amount, userId);
    } else {
      db.prepare('INSERT INTO lottery_tickets (user_id, ticket_count) VALUES (?, ?)').run(userId, amount);
      db.prepare('UPDATE lottery_user_stats SET lotteries_joined = lotteries_joined + 1 WHERE user_id = ?').run(userId);
    }
    db.prepare('UPDATE lottery_user_stats SET lifetime_tickets = lifetime_tickets + ? WHERE user_id = ?')
      .run(amount, userId);
    return { totalCost, addedToJackpot, ticketCount: (existing?.ticket_count || 0) + amount };
  }).immediate();
}

// Picks up to 3 distinct winners weighted by ticket count without expanding tickets into an array,
// pays 50/30/20% of the jackpot, and grants 1st place the scheduled golden prize when applicable.
function drawLottery(now = Date.now()) {
  return db.transaction(() => {
    const state = getLotteryState();
    if (now < state.ends_at) return { error: 'not_due' };
    const tickets = db.prepare('SELECT user_id, ticket_count FROM lottery_tickets').all();
    if (!tickets.length) {
      db.prepare('UPDATE lottery_state SET ends_at = ? WHERE id = 1').run(getNextLotteryDrawTime(now));
      return { error: 'no_participants' };
    }
    const eligibleEntries = [...tickets];
    const winners = [];
    while (eligibleEntries.length && winners.length < 3) {
      const totalEligibleTickets = eligibleEntries.reduce(
        (total, entry) => total + entry.ticket_count, 0
      );
      let selectedTicket = Math.floor(Math.random() * totalEligibleTickets);
      const winnerIndex = eligibleEntries.findIndex((entry) => {
        selectedTicket -= entry.ticket_count;
        return selectedTicket < 0;
      });
      if (winnerIndex === -1) {
        throw new Error('Could not select a lottery winner from the remaining tickets.');
      }
      winners.push(eligibleEntries[winnerIndex].user_id);
      eligibleEntries.splice(winnerIndex, 1);
    }
    const jackpot = state.jackpot;
    const prizes = [0.5, 0.3, 0.2].map((share) => Math.floor(jackpot * share));
    const estDay = new Date(now - 5 * 60 * 60 * 1000).getUTCDay();
    const goldenPrize = LOTTERY_SCHEDULE[estDay] || null;
    winners.forEach((winnerId, place) => {
      getUser(winnerId);
      getUserLotteryStats(winnerId);
      prizes[place] = awardCoinsWithBoost(winnerId, prizes[place]).finalAmount;
      const winColumn = ['wins_first', 'wins_second', 'wins_third'][place];
      db.prepare(`
        UPDATE lottery_user_stats
        SET ${winColumn} = ${winColumn} + 1, lifetime_winnings = lifetime_winnings + ?
        WHERE user_id = ?
      `).run(prizes[place], winnerId);
    });
    if (winners[0] && goldenPrize) {
      const form = db.prepare(
        'SELECT * FROM pokemon_forms WHERE species_id = ? AND is_default = 1 ORDER BY id LIMIT 1'
      ).get(goldenPrize.speciesId);
      if (!form) throw new Error(`Lottery golden prize species ${goldenPrize.speciesId} has no base form.`);
      saveGoldenCatch(winners[0], {
        id: form.id,
        name: form.name,
        rarity: 'Golden',
        baseHp: form.base_hp,
        baseAtk: form.base_atk,
        baseDef: form.base_def,
        baseSpd: form.base_spd,
      });
    }
    const ticketCountByUser = new Map(tickets.map((entry) => [entry.user_id, entry.ticket_count]));
    const totalTickets = tickets.reduce((sum, entry) => sum + entry.ticket_count, 0);
    const lifetimeTickets = db.prepare(
      'SELECT COALESCE(SUM(lifetime_tickets), 0) AS total FROM lottery_user_stats'
    ).get().total;
    db.prepare('DELETE FROM lottery_tickets').run();
    db.prepare('UPDATE lottery_state SET jackpot = ?, ends_at = ? WHERE id = 1')
      .run(LOTTERY_BASE_JACKPOT, getNextLotteryDrawTime(now));
    return {
      winners: winners.map((winnerId, place) => ({
        userId: winnerId,
        tickets: ticketCountByUser.get(winnerId) || 0,
        prize: prizes[place],
      })),
      goldenPrize,
      jackpot,
      totalTickets,
      participants: tickets.length,
      drawnAt: now,
      lifetimeTickets,
      lifetimeTaxed: Math.floor(lifetimeTickets * LOTTERY_TICKET_PRICE * 0.25),
    };
  }).immediate();
}

function setAutoSpawnChannel(guildId, channelId) {
  db.prepare(`
    INSERT INTO autospawn_channels (
      guild_id, channel_id, last_hourly_tier, enabled, message_count, message_target
    )
    VALUES (?, ?, 0, 1, 0, 0)
    ON CONFLICT(guild_id) DO UPDATE SET
      channel_id = excluded.channel_id,
      enabled = 1,
      message_count = 0,
      message_target = 0
  `).run(guildId, channelId);
}

function setAutoSpawnProgress(guildId, count, target) {
  if (typeof guildId !== 'string' || !guildId
      || !Number.isSafeInteger(count) || count < 0
      || !Number.isSafeInteger(target) || target < 1
      || count > target) {
    throw new TypeError('Autospawn progress must have a valid guild ID and count no greater than its target.');
  }
  db.prepare(`
    UPDATE autospawn_channels
    SET message_count = ?, message_target = ?
    WHERE guild_id = ? AND enabled = 1
  `).run(count, target, guildId);
}

function disableAutoSpawnChannel(guildId) {
  return db.prepare(
    'UPDATE autospawn_channels SET enabled = 0 WHERE guild_id = ? AND enabled = 1'
  ).run(guildId).changes > 0;
}

function markAutoSpawnHourlyTier(guildId, timestamp) {
  db.prepare(
    'UPDATE autospawn_channels SET last_hourly_tier = ? WHERE guild_id = ?'
  ).run(timestamp, guildId);
}

function setMarketAnnouncementChannel(guildId, channelId) {
  if (typeof guildId !== 'string' || !guildId) {
    throw new TypeError('A valid guild ID is required.');
  }
  if (channelId === null) {
    return db.prepare(
      'DELETE FROM market_announcement_channels WHERE guild_id = ?'
    ).run(guildId).changes > 0;
  }
  if (typeof channelId !== 'string' || !channelId) {
    throw new TypeError('A valid channel ID or null is required.');
  }
  db.prepare(`
    INSERT INTO market_announcement_channels (guild_id, channel_id)
    VALUES (?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET channel_id = excluded.channel_id
  `).run(guildId, channelId);
  return true;
}

function getWorldBossAnnouncementPost(bossId) {
  if (!Number.isSafeInteger(bossId) || bossId <= 0) {
    throw new TypeError('World Boss ID must be a positive safe integer.');
  }
  return db.prepare(
    'SELECT guild_id, channel_id, message_id FROM world_boss_announcement_posts WHERE boss_id = ? ORDER BY guild_id LIMIT 1'
  ).get(bossId) || null;
}

function getWorldBossAnnouncementPosts(bossId) {
  if (!Number.isSafeInteger(bossId) || bossId <= 0) {
    throw new TypeError('World Boss ID must be a positive safe integer.');
  }
  return db.prepare(
    'SELECT guild_id, channel_id, message_id FROM world_boss_announcement_posts WHERE boss_id = ? ORDER BY guild_id'
  ).all(bossId);
}

function setWorldBossAnnouncementPost(bossId, guildId, channelId, messageId) {
  if (!Number.isSafeInteger(bossId) || bossId <= 0
      || [guildId, channelId, messageId].some((value) => typeof value !== 'string' || !value)) {
    throw new TypeError('World Boss post requires valid boss, guild, channel, and message IDs.');
  }
  db.prepare(`
    INSERT INTO world_boss_announcement_posts (boss_id, guild_id, channel_id, message_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(boss_id, guild_id) DO UPDATE SET
      channel_id = excluded.channel_id,
      message_id = excluded.message_id
  `).run(bossId, guildId, channelId, messageId);
}

const GUILD_CHANNEL_CATCH_RATE_BOOSTS = new Map([
  ['1560102297198006274', 5],
]);

function getChannelCatchRateBoost(userId, guildId, channelId) {
  if (typeof userId !== 'string' || !userId
      || typeof guildId !== 'string' || !guildId
      || typeof channelId !== 'string' || !channelId) {
    return 0;
  }
  const personalBoost = db.prepare(`
    SELECT 5 AS boost
    FROM channel_catch_rate_boosts
    WHERE user_id = ? AND guild_id = ? AND channel_id = ?
  `).get(userId, guildId, channelId)?.boost || 0;
  return personalBoost + (GUILD_CHANNEL_CATCH_RATE_BOOSTS.get(guildId) || 0);
}

function getBoostedChannels(userId) {
  assertUserId(userId);
  return db.prepare(`
    SELECT guild_id, channel_id
    FROM channel_catch_rate_boosts
    WHERE user_id = ?
    ORDER BY guild_id, channel_id
  `).all(userId);
}

function removeAllChannelCatchRateBoosts(userId) {
  assertUserId(userId);
  return db.prepare(`
    DELETE FROM channel_catch_rate_boosts
    WHERE user_id = ?
  `).run(userId).changes;
}

function addChannelCatchRateBoost(userId, guildId, channelId, limit = 10) {
  if (typeof userId !== 'string' || !userId
      || typeof guildId !== 'string' || !guildId
      || typeof channelId !== 'string' || !channelId
      || (limit !== null && (!Number.isSafeInteger(limit) || limit < 1))) {
    throw new TypeError('Valid user/guild/channel IDs and a positive or unlimited channel limit are required.');
  }
  return db.transaction(() => {
    const exists = db.prepare(`
      SELECT 1 FROM channel_catch_rate_boosts
      WHERE user_id = ? AND guild_id = ? AND channel_id = ?
    `).get(userId, guildId, channelId);
    if (exists) return 'already';
    const count = db.prepare(`
      SELECT COUNT(*) AS count FROM channel_catch_rate_boosts
      WHERE user_id = ?
    `).get(userId).count;
    if (limit !== null && count >= limit) return 'limit';
    db.prepare(`
      INSERT INTO channel_catch_rate_boosts (user_id, guild_id, channel_id)
      VALUES (?, ?, ?)
    `).run(userId, guildId, channelId);
    return 'added';
  }).immediate();
}

function setChannelCatchRateBoost(userId, guildId, channelId, enabled) {
  if (typeof userId !== 'string' || !userId
      || typeof guildId !== 'string' || !guildId
      || typeof channelId !== 'string' || !channelId
      || typeof enabled !== 'boolean') {
    throw new TypeError('Valid user/guild/channel IDs and a boolean setting are required.');
  }
  if (enabled) {
    return addChannelCatchRateBoost(userId, guildId, channelId) !== 'limit';
  }
  return db.prepare(`
    DELETE FROM channel_catch_rate_boosts
    WHERE user_id = ? AND guild_id = ? AND channel_id = ?
  `).run(userId, guildId, channelId).changes > 0;
}

function getPokemonFormBySlug(slug) {
  if (typeof slug !== 'string' || !slug) throw new TypeError('slug must be a non-empty string.');
  const pokemon = db.prepare('SELECT * FROM pokemon_forms WHERE slug = ?').get(slug);
  if (!pokemon) return null;
  return {
    id: pokemon.id,
    name: pokemon.name,
    rarity: pokemon.rarity,
    baseHp: pokemon.base_hp,
    baseAtk: pokemon.base_atk,
    baseDef: pokemon.base_def,
    baseSpd: pokemon.base_spd,
  };
}

function getUserStatsSummary(userId) {
  const user = getUser(userId);
  const currentlyOwned = db.prepare(
    'SELECT COUNT(*) AS count FROM catches WHERE user_id = ?'
  ).get(userId).count;
  const lifetimeCaught = Math.max(user.total_catches, currentlyOwned);
  const uniqueInBox = db.prepare(
    'SELECT COUNT(DISTINCT pokemon_id) AS count FROM catches WHERE user_id = ?'
  ).get(userId).count;
  const shiniesCaught = db.prepare(
    'SELECT COUNT(*) AS count FROM catches WHERE user_id = ? AND is_shiny = 1'
  ).get(userId).count;
  const legendariesCaught = db.prepare(
    "SELECT COUNT(*) AS count FROM catches WHERE user_id = ? AND rarity = 'Legendary'"
  ).get(userId).count;

  return { user, lifetimeCaught, uniqueInBox, shiniesCaught, legendariesCaught };
}

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gift_settings (
      user_id TEXT PRIMARY KEY,
      allow_gifts INTEGER DEFAULT 1,
      allow_dms INTEGER DEFAULT 1,
      send_anonymous INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS pending_gifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id TEXT,
      receiver_id TEXT,
      coins INTEGER DEFAULT 0,
      pokemon_json TEXT, -- array of { id, pokemon_id, name, rarity, is_shiny, count }
      is_anonymous INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      claimed INTEGER DEFAULT 0
    );
  `);
} catch (e) {
  // Tables exist
}

function getGiftSettings(userId) {
  let settings = db.prepare('SELECT * FROM gift_settings WHERE user_id = ?').get(userId);
  if (!settings) {
    db.prepare('INSERT INTO gift_settings (user_id) VALUES (?)').run(userId);
    settings = db.prepare('SELECT * FROM gift_settings WHERE user_id = ?').get(userId);
  }
  return settings;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS user_factions (
    user_id TEXT PRIMARY KEY,
    faction_key TEXT NOT NULL,
    rank TEXT NOT NULL DEFAULT 'Recruit',
    points INTEGER NOT NULL DEFAULT 0,
    last_changed_at INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS faction_shop_purchases (
    user_id TEXT NOT NULL,
    faction_key TEXT NOT NULL,
    purchased_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, faction_key)
  );
`);
ensureColumns('user_factions', {
  last_changed_at: 'INTEGER NOT NULL DEFAULT 0',
});

const FACTION_TEAMS = {
  rocket: {
    id: 'rocket', name: 'Team Rocket', badge: '🚀', emoji: '<:teamrocketlogo:1560297373190725712>',
    emojiId: '1560297373190725712', emojiName: 'teamrocketlogo',
    goldenPokemon: 'Grimer', goldenSlug: 'grimer', goldenEmoji: '<:goldengrimer:1562202548276830229>',
    npcs:
      '<:grunt:1560312842039726150> Grunt: <:rocketgruntmale:1561371468162408648> Rocket Grunt Male, ' +
      '<:rocketgruntfemale:1561371492577574912> Rocket Grunt Female\n' +
      '<:admin:1560312876596461578> Admin: <:rocketadminariana:1561371515050528858> Rocket Admin Ariana, ' +
      '<:rocketadminarcher:1561371545971204117> Rocket Admin Archer, ' +
      '<:rocketadminproton:1561371568951525488> Rocket Admin Proton, ' +
      '<:rocketadminpretel:1561371591466549450> Rocket Admin Pretel\n' +
      '<:leader:1560312904560025680> Leader: <:rocketleadergiovanni:1561371612446457906> Rocket Leader Giovanni',
    favoritePokemon: 'Persian, Meowth, Mewtwo',
    goals: 'Steal strong and rare Pokémon for global domination and criminal profit.',
  },
  magma: {
    id: 'magma', name: 'Team Magma', badge: '🌋', emoji: '<:teammagmalogo:1560297371479572480>',
    emojiId: '1560297371479572480', emojiName: 'teammagmalogo',
    goldenPokemon: 'Numel', goldenSlug: 'numel', goldenEmoji: '<:goldennumel:1562202552022601748>',
    npcs:
      '<:grunt:1560312842039726150> Grunt: <:magmagruntmale:1561376294648807466> Magma Grunt Male, ' +
      '<:magmagruntfemale:1561376313472847994> Magma Grunt Female\n' +
      '<:admin:1560312876596461578> Admin: <:magmaadmincourtney:1561376339523674232> Magma Admin Courtney, ' +
      '<:magmaadmintabitha:1561376360260182066> Magma Admin Tabitha\n' +
      '<:leader:1560312904560025680> Leader: <:magmaleadermaxie:1561376382016290866> Magma Leader Maxie',
    favoritePokemon: 'Groudon, Camerupt, Mightyena',
    goals: "Awaken ancient legendary power to expand the world's landmass.",
  },
  aqua: {
    id: 'aqua', name: 'Team Aqua', badge: '🌊', emoji: '<:teamaqualogo:1560297370174890015>',
    emojiId: '1560297370174890015', emojiName: 'teamaqualogo',
    goldenPokemon: 'Carvanha', goldenSlug: 'carvanha', goldenEmoji: '<:goldencarvanha:1562202550080507964>',
    npcs:
      '<:grunt:1560312842039726150> Grunt: <:aquagruntmale:1561376172359815168> Aqua Grunt Male, ' +
      '<:aquagruntfemale:1561376198305521674> Aqua Grunt Female\n' +
      '<:admin:1560312876596461578> Admin: <:aquaadminmatt:1561376222003462295> Aqua Admin Matt, ' +
      '<:aquaadminshelly:1561376248322850867> Aqua Admin Shelly\n' +
      '<:leader:1560312904560025680> Leader: <:aqualeaderarchie:1561376270883889204> Aqua Leader Archie',
    favoritePokemon: 'Kyogre, Sharpedo, Walrein',
    goals: 'Expand the global oceans to return the world to prehistoric beauty.',
  },
  galactic: {
    id: 'galactic', name: 'Team Galactic', badge: '🌌', emoji: '<:teamgalacticlogo:1560297368715534397>',
    emojiId: '1560297368715534397', emojiName: 'teamgalacticlogo',
    goldenPokemon: 'Croagunk', goldenSlug: 'croagunk', goldenEmoji: '<:goldencroagunk:1562202540521558026>',
    npcs:
      '<:grunt:1560312842039726150> Grunt: Galactic Grunt Male, Galactic Grunt Female\n' +
      '<:admin:1560312876596461578> Admin: Mars, Charon, Jupiter, Saturn\n' +
      '<:leader:1560312904560025680> Leader: Cyrus',
    favoritePokemon: 'Dialga, Palkia, Weavile',
    goals: 'Create a brand new universe devoid of spirit, grief, and human emotion.',
  },
  plasma: {
    id: 'plasma', name: 'Team Plasma', badge: '🛡️', emoji: '<:teamplasmalogo:1560297367578738791>',
    emojiId: '1560297367578738791', emojiName: 'teamplasmalogo',
    goldenPokemon: 'Scraggy', goldenSlug: 'scraggy', goldenEmoji: '<:goldenscraggy:1562202553851191366>',
    npcs:
      '<:grunt:1560312842039726150> Grunt: <:plasmagruntmale:1561371323546996816> Plasma Grunt Male, ' +
      '<:plasmagruntfemale:1561371357038641212> Plasma Grunt Female\n' +
      '<:admin:1560312876596461578> Admin: <:plasmaadminshadow:1561371380937789460> Plasma Admin Shadow, ' +
      '<:plasmaadminN:1561371409140162561> Plasma Admin N\n' +
      '<:leader:1560312904560025680> Leader: <:plasmaleaderghetsis:1561371442153525370> Plasma Leader Ghetsis',
    favoritePokemon: 'Reshiram, Zekrom, Hydreigon',
    goals: 'Liberate Pokémon from trainers to monopolize total authority.',
  },
  flare: {
    id: 'flare', name: 'Team Flare', badge: '🔥', emoji: '<:teamflarelogo:1560297365540307036>',
    emojiId: '1560297365540307036', emojiName: 'teamflarelogo',
    goldenPokemon: 'Litleo', goldenSlug: 'litleo', goldenEmoji: '<:goldenlitleo:1562202542203740261>',
    npcs:
      '<:grunt:1560312842039726150> Grunt: Flare Grunt Male, Flare Grunt Female\n' +
      '<:admin:1560312876596461578> Admin: Flare Admin Male, Flare Admin Female\n' +
      '<:leader:1560312904560025680> Leader: Lysandre',
    favoritePokemon: 'Yveltal, Xerneas, Pyroar, Malamar',
    goals: 'Purge imperfection to build a flawless, beautiful world of chosen elites.',
  },
  skull: {
    id: 'skull', name: 'Team Skull', badge: '💀', emoji: '<:teamskulllogo:1560297364793851934>',
    emojiId: '1560297364793851934', emojiName: 'teamskulllogo',
    goldenPokemon: 'Yungoos', goldenSlug: 'yungoos', goldenEmoji: '<:goldenyungoos:1562202544007155752>',
    npcs:
      '<:grunt:1560312842039726150> Grunt: Skull Grunt Male, Skull Grunt Female\n' +
      '<:admin:1560312876596461578> Admin: Plumeria\n' +
      '<:leader:1560312904560025680> Leader: Guzma',
    favoritePokemon: 'Golisopod, Salazzle, Alolan Marowak',
    goals: 'Cause absolute chaos across the islands and reject the Island Challenge.',
  },
  yell: {
    id: 'yell', name: 'Team Yell', badge: '📣', emoji: '<:teamyelllogo:1560297363413794987>',
    emojiId: '1560297363413794987', emojiName: 'teamyelllogo',
    goldenPokemon: 'Galarian Zigzagoon', goldenSlug: 'zigzagoon-galar', goldenEmoji: '<:goldengalarianzigzagoon:1562202546339315823>',
    npcs:
      '<:grunt:1560312842039726150> Grunt: Yell Grunt Male, Yell Grunt Female\n' +
      '<:admin:1560312876596461578> Admin: Marnie\n' +
      '<:leader:1560312904560025680> Leader: Piers',
    favoritePokemon: 'Obstagoon, Grimmsnarl, Morpeko',
    goals: 'Disrupt competitors and rally unwavering devotion to crown Marnie champion.',
  },
  star: {
    id: 'star', name: 'Team Star', badge: '⭐', emoji: '<:teamstarlogo:1560297361878552586>',
    emojiId: '1560297361878552586', emojiName: 'teamstarlogo',
    goldenPokemon: 'Varoom', goldenSlug: 'varoom', goldenEmoji: '<:goldenvaroom:1562203391835381840>',
    npcs:
      '<:grunt:1560312842039726150> Grunt: <:gruntfemale:1561091678759030784> Star Grunt Female, ' +
      '<:gruntmale:1561091294795800596> Star Grunt Male\n' +
      '<:admin:1560312876596461578> Admin: <:giacomo:1561091482046177330> Star Admin Giacomo, ' +
      '<:mela:1561091314802495539> Star Admin Mela, <:atticus:1561091500010373221> Star Admin Atticus, ' +
      '<:ortega:1561091237769908375> Star Admin Ortega, <:eri:1561091421488816160> Star Admin Eri\n' +
      '<:leader:1560312904560025680> Leader: <:penny:1561053211102683146> Star Leader Penny',
    favoritePokemon: 'Revavroom, Kingambit, Armarouge, Ceruledge',
    goals: 'Stand against academy bullies, preserve camaraderie, and protect the Starmobiles.',
  },
};

const FACTION_REGION_GENERATIONS = {
  rocket: ['generation-i', 'generation-ii'], magma: ['generation-iii'], aqua: ['generation-iii'],
  galactic: ['generation-iv'], plasma: ['generation-v'], flare: ['generation-vi'],
  skull: ['generation-vii'], yell: ['generation-viii'], star: ['generation-ix'],
};
const FACTION_FAVORITE_COUNT = 10;
const FACTION_POKEMON_POINT_BONUS = 1.1;
const factionFavoritesCache = new Map();

function seededRandom(seedText) {
  let hash = 1779033703 ^ seedText.length;
  for (let i = 0; i < seedText.length; i++) {
    hash = Math.imul(hash ^ seedText.charCodeAt(i), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  let state = hash >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Random favourites from the faction's home region; they rotate daily (UTC).
function getFactionFavorites(factionKey) {
  const generations = FACTION_REGION_GENERATIONS[factionKey];
  if (!generations) return [];
  const day = new Date().toISOString().slice(0, 10);
  const cached = factionFavoritesCache.get(factionKey);
  if (cached?.day === day) return cached.favorites;
  const candidates = db.prepare(`
    SELECT species_id, species_name FROM pokemon_forms
    WHERE is_default = 1 AND generation IN (${generations.map(() => '?').join(', ')})
    ORDER BY species_id
  `).all(...generations);
  const random = seededRandom(`${day}:${factionKey}`);
  const favorites = [];
  while (favorites.length < FACTION_FAVORITE_COUNT && candidates.length) {
    favorites.push(candidates.splice(Math.floor(random() * candidates.length), 1)[0]);
  }
  factionFavoritesCache.set(factionKey, { day, favorites });
  return favorites;
}

for (const team of Object.values(FACTION_TEAMS)) {
  Object.defineProperty(team, 'favoritePokemon', {
    enumerable: true,
    get() {
      return `${getFactionFavorites(team.id).map((entry) => entry.species_name).join(', ')}`;
    },
  });
}

// Faction whose favourites include this species, or null.
function getPokemonFactionTeam(speciesId) {
  if (!speciesId) return null;
  for (const team of Object.values(FACTION_TEAMS)) {
    if (getFactionFavorites(team.id).some((entry) => entry.species_id === speciesId)) return team;
  }
  return null;
}

// cost = points consumed to reach `next`; mult scales points earned at that rank.
const FACTION_RANKS = {
  Recruit: { next: 'Grunt', cost: 500000, mult: 1 },
  Grunt: { next: 'Captain', cost: 2500000, mult: 1.5 },
  Captain: { next: 'Admin', cost: 30000000, mult: 2 },
  Admin: { next: 'Commander', cost: 250000000, mult: 2.5 },
  Commander: { next: 'Leader', cost: 1000000000, mult: 3 },
  Leader: { next: null, cost: 0, mult: 4 },
};

const FACTION_DAILY_BALLS = [
  { key: 'pb', name: 'Poke Ball' },
  { key: 'gb', name: 'Greatball' },
  { key: 'ub', name: 'Ultraball' },
  { key: 'prb', name: 'Premierball' },
  { key: 'mb', name: 'Masterball' },
];

db.exec(`
  CREATE TABLE IF NOT EXISTS faction_daily_balls (
    faction_key TEXT NOT NULL,
    day INTEGER NOT NULL,
    ball_key TEXT NOT NULL,
    PRIMARY KEY (faction_key, day)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS rare_spawn_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    username TEXT,
    guild_id TEXT,
    pokemon_id INTEGER,
    pokemon_name TEXT NOT NULL,
    rarity TEXT,
    is_shiny INTEGER NOT NULL DEFAULT 0,
    is_golden INTEGER NOT NULL DEFAULT 0,
    caught_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_rare_spawn_log_user ON rare_spawn_log (user_id, caught_at);
  CREATE INDEX IF NOT EXISTS idx_rare_spawn_log_time ON rare_spawn_log (caught_at);
`);

function logRareSpawn({ userId, username, guildId, pokemonId, pokemonName, rarity, isShiny, isGolden }) {
  db.prepare(`
    INSERT INTO rare_spawn_log
      (user_id, username, guild_id, pokemon_id, pokemon_name, rarity, is_shiny, is_golden, caught_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(userId), username ?? null, guildId ? String(guildId) : null,
    pokemonId ?? null, pokemonName, rarity ?? null,
    isShiny ? 1 : 0, isGolden ? 1 : 0, Date.now()
  );
}

function getRareSpawnLog({ userId = null, limit = 10 } = {}) {
  const safeLimit = Math.min(Math.max(Math.trunc(Number(limit)) || 10, 1), 25);
  return userId
    ? db.prepare('SELECT * FROM rare_spawn_log WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(String(userId), safeLimit)
    : db.prepare('SELECT * FROM rare_spawn_log ORDER BY id DESC LIMIT ?').all(safeLimit);
}

function getDailyBall(factionKey = '', date = new Date()) {
  const day = getDailyResetDay(date.getTime());
  const storedBall = db.prepare(
    'SELECT ball_key FROM faction_daily_balls WHERE faction_key = ? AND day = ?'
  ).get(factionKey, day)?.ball_key;
  if (storedBall) {
    const ball = FACTION_DAILY_BALLS.find(({ key }) => key === storedBall);
    if (!ball) throw new Error(`Unknown daily faction ball "${storedBall}".`);
    return ball;
  }

  const previousBall = db.prepare(
    'SELECT ball_key FROM faction_daily_balls WHERE faction_key = ? AND day = ?'
  ).get(factionKey, day - 1)?.ball_key;
  const availableBalls = FACTION_DAILY_BALLS.filter(({ key }) => key !== previousBall);
  const chosenBall = availableBalls[Math.floor(Math.random() * availableBalls.length)];
  db.prepare(`
    INSERT OR IGNORE INTO faction_daily_balls (faction_key, day, ball_key)
    VALUES (?, ?, ?)
  `).run(factionKey, day, chosenBall.key);
  const finalBall = db.prepare(
    'SELECT ball_key FROM faction_daily_balls WHERE faction_key = ? AND day = ?'
  ).get(factionKey, day).ball_key;
  const ball = FACTION_DAILY_BALLS.find(({ key }) => key === finalBall);
  if (!ball) throw new Error(`Unknown daily faction ball "${finalBall}".`);
  return ball;
}

function getUserFaction(userId) {
  const row = db.prepare('SELECT * FROM user_factions WHERE user_id = ?').get(userId);
  if (!row || !FACTION_TEAMS[row.faction_key]) return null;
  return { ...row, team: FACTION_TEAMS[row.faction_key] };
}

function joinFaction(userId, factionKey) {
  if (!FACTION_TEAMS[factionKey]) throw new TypeError(`Unknown faction: ${factionKey}`);
  const result = db.prepare(
    'INSERT OR IGNORE INTO user_factions (user_id, faction_key) VALUES (?, ?)'
  ).run(userId, factionKey);
  return result.changes > 0;
}

const FACTION_GOLDEN_POKEMON_COST = 1500000000;
const FACTION_CHANGE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
const TEAM_MEDALLION_ITEM = 'Team Medallion';

function changeUserFaction(userId, factionKey, now = Date.now()) {
  assertUserId(userId);
  if (!FACTION_TEAMS[factionKey]) return { error: 'unknown_faction' };
  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError('now must be a non-negative timestamp.');
  return db.transaction(() => {
    const faction = db.prepare('SELECT * FROM user_factions WHERE user_id = ?').get(userId);
    if (!faction || !FACTION_TEAMS[faction.faction_key]) return { error: 'not_in_faction' };
    if (faction.faction_key === factionKey) return { error: 'same_faction' };
    const cooldownUntil = faction.last_changed_at + FACTION_CHANGE_COOLDOWN_MS;
    if (faction.last_changed_at && now < cooldownUntil) {
      return { error: 'cooldown', cooldownUntil };
    }
    if (!takeUserItem(userId, TEAM_MEDALLION_ITEM)) return { error: 'medallion_required' };
    db.prepare(`
      UPDATE user_factions
      SET faction_key = ?, rank = 'Recruit', points = 0, last_changed_at = ?
      WHERE user_id = ?
    `).run(factionKey, now, userId);
    return { faction: FACTION_TEAMS[factionKey] };
  }).immediate();
}

function getFactionGoldenPurchase(userId, factionKey) {
  assertUserId(userId);
  if (db.prepare(
    'SELECT 1 FROM faction_shop_purchases WHERE user_id = ? AND faction_key = ?'
  ).get(userId, factionKey)) return true;
  const team = FACTION_TEAMS[factionKey];
  if (!team) return false;
  const form = db.prepare('SELECT id FROM pokemon_forms WHERE slug = ?').get(team.goldenSlug);
  return Boolean(form && db.prepare(`
    SELECT 1 FROM catches WHERE user_id = ? AND pokemon_id = ? AND is_golden = 1 LIMIT 1
  `).get(userId, form.id));
}

function buyFactionGoldenPokemon(userId, now = Date.now()) {
  assertUserId(userId);
  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError('now must be a non-negative timestamp.');
  return db.transaction(() => {
    const faction = getUserFaction(userId);
    if (!faction) return { error: 'not_in_faction' };
    if (faction.rank !== 'Leader') return { error: 'leader_required' };
    if (getFactionGoldenPurchase(userId, faction.faction_key)) return { error: 'already_purchased' };
    if (faction.points < FACTION_GOLDEN_POKEMON_COST) {
      return { error: 'insufficient_points', points: faction.points };
    }

    const form = db.prepare('SELECT * FROM pokemon_forms WHERE slug = ?').get(faction.team.goldenSlug);
    if (!form) throw new Error(`Missing faction Golden Pokémon form "${faction.team.goldenSlug}".`);
    if (db.prepare(`
      SELECT 1 FROM catches WHERE user_id = ? AND pokemon_id = ? AND is_golden = 1 LIMIT 1
    `).get(userId, form.id)) return { error: 'already_owned' };

    db.prepare('UPDATE user_factions SET points = points - ? WHERE user_id = ?')
      .run(FACTION_GOLDEN_POKEMON_COST, userId);
    db.prepare(`
      INSERT INTO faction_shop_purchases (user_id, faction_key, purchased_at)
      VALUES (?, ?, ?)
    `).run(userId, faction.faction_key, now);
    const catchId = saveGoldenCatch(userId, {
      id: form.id,
      name: form.name,
      rarity: form.rarity,
      baseHp: form.base_hp,
      baseAtk: form.base_atk,
      baseDef: form.base_def,
      baseSpd: form.base_spd,
    });
    return {
      catchId,
      pokemon: faction.team.goldenPokemon,
      emoji: faction.team.goldenEmoji,
      cost: FACTION_GOLDEN_POKEMON_COST,
    };
  }).immediate();
}

const FACTION_BERRY_COST = 500000;
const FACTION_POWER_ITEM_COST = 100000000;
const FACTION_SHOP_ITEMS = Object.freeze({
  52: { name: 'Aux Guard', cost: 50000, rank: 'Recruit' },
  53: { name: 'Aux Power', cost: 50000, rank: 'Recruit' },
  54: { name: 'Aux Powerguard', cost: 250000, rank: 'Recruit' },
  55: { name: 'Team Boost', cost: 1000000, rank: 'Grunt', max: 10 },
  56: { name: 'Catching Charm', cost: 10000000, rank: 'Captain', max: 10 },
  57: { name: 'Pomeg Berry', cost: FACTION_BERRY_COST, rank: 'Admin', evStat: 'hp' },
  58: { name: 'Kelpsy Berry', cost: FACTION_BERRY_COST, rank: 'Admin', evStat: 'atk' },
  59: { name: 'Qualot Berry', cost: FACTION_BERRY_COST, rank: 'Admin', evStat: 'def' },
  60: { name: 'Hondew Berry', cost: FACTION_BERRY_COST, rank: 'Admin', evStat: 'spa' },
  61: { name: 'Grepa Berry', cost: FACTION_BERRY_COST, rank: 'Admin', evStat: 'spdef' },
  62: { name: 'Tamato Berry', cost: FACTION_BERRY_COST, rank: 'Admin', evStat: 'spe' },
  63: { name: 'Power Weight', cost: FACTION_POWER_ITEM_COST, rank: 'Commander' },
  64: { name: 'Power Bracer', cost: FACTION_POWER_ITEM_COST, rank: 'Commander' },
  65: { name: 'Power Belt', cost: FACTION_POWER_ITEM_COST, rank: 'Commander' },
  66: { name: 'Power Lens', cost: FACTION_POWER_ITEM_COST, rank: 'Commander' },
  67: { name: 'Power Band', cost: FACTION_POWER_ITEM_COST, rank: 'Commander' },
  68: { name: 'Power Anklet', cost: FACTION_POWER_ITEM_COST, rank: 'Commander' },
  70: { name: 'Full Restore', cost: 250000, rank: 'Admin' },
  71: { name: 'Max Revive', cost: 500000, rank: 'Commander' },
});
const FACTION_RANK_ORDER = Object.keys(FACTION_RANKS);
const FACTION_TEAM_BOOST_PER_ITEM = 0.05;
const CATCHING_CHARM_CRIT_PER_ITEM = 0.001;
// Items consumed or used in battle can't be held by a Pokémon.
const FACTION_NON_HOLDABLE_ITEMS = new Set(Object.values(FACTION_SHOP_ITEMS)
  .map((item) => item.name)
  .filter((name) => !POWER_ITEM_EVS[name]));

function getUserItemAmount(userId, itemName) {
  return db.prepare('SELECT amount FROM user_items WHERE user_id = ? AND item_name = ?')
    .get(userId, itemName)?.amount || 0;
}

function getCatchingCharmCritChance(userId) {
  return Math.min(10, getUserItemAmount(userId, 'Catching Charm')) * CATCHING_CHARM_CRIT_PER_ITEM;
}

function buyFactionShopItem(userId, itemId, amount = 1) {
  assertUserId(userId);
  const item = FACTION_SHOP_ITEMS[itemId];
  if (!item) return { error: 'unknown_item' };
  if (!Number.isSafeInteger(amount) || amount <= 0) return { error: 'invalid_amount' };
  const totalCost = item.cost * amount;
  if (!Number.isSafeInteger(totalCost)) return { error: 'invalid_amount' };
  return db.transaction(() => {
    const faction = getUserFaction(userId);
    if (!faction) return { error: 'not_in_faction' };
    if (FACTION_RANK_ORDER.indexOf(faction.rank) < FACTION_RANK_ORDER.indexOf(item.rank)) {
      return { error: 'rank_required', rank: item.rank };
    }
    if (item.max) {
      const owned = getUserItemAmount(userId, item.name);
      if (owned + amount > item.max) return { error: 'max_reached', max: item.max, owned };
    }
    if (faction.points < totalCost) return { error: 'insufficient_points', points: faction.points, cost: totalCost };
    db.prepare('UPDATE user_factions SET points = points - ? WHERE user_id = ?').run(totalCost, userId);
    addUserItem(userId, item.name, amount);
    return { item: item.name, amount, cost: totalCost, points: faction.points - totalCost };
  }).immediate();
}

// Each berry lowers one EV of the buddy by 10; an EV above 100 is first set to 100.
function eatBuddyBerry(userId, itemName, amount = 1) {
  assertUserId(userId);
  const entry = Object.values(FACTION_SHOP_ITEMS).find((item) => item.name === itemName && item.evStat);
  if (!entry) return { error: 'not_a_berry' };
  if (!Number.isSafeInteger(amount) || amount <= 0) return { error: 'invalid_amount' };
  const field = `ev_${entry.evStat}`;
  return db.transaction(() => {
    const buddyId = getUser(userId).buddy_catch_id;
    const pokemon = buddyId && db.prepare(`
      SELECT catches.*, pokemon_forms.base_hp, pokemon_forms.base_atk,
        pokemon_forms.base_def, pokemon_forms.base_spd
      FROM catches
      LEFT JOIN pokemon_forms ON pokemon_forms.id = catches.pokemon_id
      WHERE catches.id = ? AND catches.user_id = ?
    `).get(buddyId, userId);
    if (!pokemon) return { error: 'no_buddy' };
    const before = pokemon[field] || 0;
    let after = before;
    let eaten = 0;
    while (eaten < amount && after > 0) {
      after = after > 100 ? 100 : Math.max(0, after - 10);
      eaten += 1;
    }
    if (!eaten) return { error: 'no_evs', pokemon: pokemon.name, stat: entry.evStat };
    if (!takeUserItem(userId, itemName, eaten)) return { error: 'not_enough_items' };
    const evs = Object.fromEntries(EV_STATS.map((key) => [key, pokemon[`ev_${key}`] || 0]));
    evs[entry.evStat] = after;
    const maxHp = calculateStat(pokemon.base_hp ?? 50, pokemon.hp_iv, pokemon.level, true, pokemon.is_shiny, evs.hp);
    const atk = calculateStat(pokemon.base_atk ?? 50, pokemon.atk_iv, pokemon.level, false, pokemon.is_shiny, evs.atk);
    const def = calculateStat(pokemon.base_def ?? 50, pokemon.def_iv, pokemon.level, false, pokemon.is_shiny, evs.def);
    const spd = calculateStat(pokemon.base_spd ?? 50, pokemon.spd_iv, pokemon.level, false, pokemon.is_shiny, evs.spe);
    const hp = Math.min(maxHp, Math.max(1, pokemon.hp));
    db.prepare(`
      UPDATE catches
      SET ${field} = ?, hp = ?, max_hp = ?, atk = ?, def = ?, spd = ?
      WHERE id = ? AND user_id = ?
    `).run(after, hp, maxHp, atk, def, spd, buddyId, userId);
    syncDuplicateCatchState(userId, buddyId);
    return { pokemon: pokemon.name, stat: entry.evStat, before, after, eaten };
  }).immediate();
}

function addFactionPoints(userId, basePoints, { speciesId = null } = {}) {
  const faction = getUserFaction(userId);
  if (!faction) return 0;
  const factionBonus = getPokemonFactionTeam(speciesId)?.id === faction.faction_key
    ? FACTION_POKEMON_POINT_BONUS
    : 1;
  const teamBoost = 1 + Math.min(10, getUserItemAmount(userId, 'Team Boost')) * FACTION_TEAM_BOOST_PER_ITEM;
  const earned = Math.floor(basePoints * FACTION_RANKS[faction.rank].mult * factionBonus * teamBoost);
  db.prepare('UPDATE user_factions SET points = points + ? WHERE user_id = ?').run(earned, userId);
  return earned;
}

// Consumes points and promotes as many ranks as the balance allows.
function promoteFaction(userId) {
  return db.transaction(() => {
    const faction = getUserFaction(userId);
    if (!faction) return [];
    let { rank, points } = faction;
    const promotions = [];
    while (FACTION_RANKS[rank]?.next && points >= FACTION_RANKS[rank].cost) {
      points -= FACTION_RANKS[rank].cost;
      promotions.push({ from: rank, to: FACTION_RANKS[rank].next, cost: FACTION_RANKS[rank].cost });
      rank = FACTION_RANKS[rank].next;
    }
    if (promotions.length) {
      db.prepare('UPDATE user_factions SET rank = ?, points = ? WHERE user_id = ?').run(rank, points, userId);
    }
    return promotions;
  }).immediate();
}

function getFactionLeaders(factionKey, perRank = 2) {
  const members = db.prepare('SELECT user_id, rank, points FROM user_factions WHERE faction_key = ? ORDER BY points DESC')
    .all(factionKey);
  const byRank = {};
  for (const rank of Object.keys(FACTION_RANKS)) byRank[rank] = { count: 0, top: [] };
  for (const member of members) {
    const entry = byRank[member.rank];
    if (!entry) continue;
    entry.count += 1;
    if (entry.top.length < perRank) entry.top.push({ userId: member.user_id, points: member.points });
  }
  return { memberCount: members.length, byRank };
}

module.exports = {
  getTimeOfDayPhase,
  getEvolutionRoute,
  db,
  getCooldownNotificationMode,
  setCooldownNotificationMode,
  getRareSpawnNameHidden,
  setRareSpawnNameHidden,
  logRareSpawn,
  getRareSpawnLog,
  getMarketCompletionNotificationsEnabled,
  setMarketCompletionNotificationsEnabled,
  setBuddyNickname,
  rerollBuddyIv,
  renamePokemonForm,
  updatePokemonSpriteLinks,
  SPECIAL_SPAWN_RESERVED_SPECIES,
  getFactionLeaders,
  FACTION_TEAMS,
  FACTION_RANKS,
  getPokemonFactionTeam,
  getFactionFavorites,
  getDailyBall,
  getUserFaction,
  joinFaction,
  FACTION_GOLDEN_POKEMON_COST,
  FACTION_CHANGE_COOLDOWN_MS,
  TEAM_MEDALLION_ITEM,
  changeUserFaction,
  getFactionGoldenPurchase,
  buyFactionGoldenPokemon,
  buyFactionShopItem,
  getCatchingCharmCritChance,
  FACTION_NON_HOLDABLE_ITEMS,
  eatBuddyBerry,
  FACTION_SHOP_ITEMS,
  takeUserItem,
  addFactionPoints,
  promoteFaction,
  getGiftSettings,
  getUser,
  updateUser,
  incrementUser,
  grantGlobalUserReward,
  processTopggVote,
  openVoteBox,
  getAmuletCoinBoost,
  getPatreonPerks,
  consumePokeradarCharge,
  BASE_POKERADAR_CHARGES,
  BASE_DOUBLE_XP_CHARGES,
  grantPatreonMonthly,
  getPatreonUserIds,
  PATREON_TIER_ORDER,
  PATREON_TIER_PERKS,
  BASE_INCENSE_CHARGES,
  getIncenseCharges,
  addIncenseCharges,
  recordIncenseContribution,
  getIncenseContributors,
  consumeIncenseCharge,
  getSavedTeams,
  saveCurrentTeam,
  deleteSavedTeam,
  clearDefendingTeam,
  equipSavedTeam,
  saveLastWorldBossTeam,
  getLastWorldBossTeam,
  equipLastWorldBossTeam,
  getUserBuddyHistory,
  awardCoinsWithBoost,
  getUserQuests,
  getUserQuestSlots,
  rerollUserQuest,
  QUEST_REROLL_COST,
  advanceQuestProgress,
  saveCatch,
  saveGoldenCatch,
  advanceEggCatchProgress,
  holdEgg,
  hatchEgg,
  EGG_INCUBATOR_LIMITS,
  getUserEggIncubators,
  startEggIncubators,
  hatchEggFromIncubator,
  getUserTeam,
  getUserBuddy,
  setUserBuddyByQuery,
  getPokemonLearnset,
  getSpeciesLearnset,
  getGigantamaxMoves,
  getGigantamaxMoveLearners,
  restrictStyleExclusiveMoves,
  recordSketchedMove,
  setBuddyMoves,
  getBuddyMoveChangeCost,
  setBuddyMoveSlot,
  deleteBuddyMoveSlot,
  swapBuddyMoveSlots,
  CB_CONFIG,
  getCatchbotData,
  upgradeCatchbot,
  startCatchbotRun,
  claimCatchbotRun,
  recordCatchbotResults,
  getLeagueProgress,
  clearLeagueChallenge,
  unlockBattleIcon,
  grantGuaranteedBattleIconDrop,
  getUnlockedBattleIcons,
  getBattleIconRank,
  setSelectedBattleIcon,
  getSelectedBattleIcon,
  CHAMBER_CONFIG,
  getUserChambers,
  getMegaStones,
  sacrificeForChamber,
  completeMegaChamber,
  getChamberRequirement,
  MEGA_STONE_NAMES,
  FUN_ITEM_NAMES,
  megaEvolvePokemon,
  getPokemonMove,
  findMoveInfo,
  setTeamExpShare,
  awardCatchExperience,
  experienceForNextLevel,
  useRareCandy,
  awardPokemonEvs,
  EV_STATS,
  EV_TOTAL_LIMIT,
  EV_STAT_LIMIT,
  EV_PER_BATTLE,
  setCatchTeamStatus,
  setTeamCatchByQuery,
  removeTeamSlot,
  swapTeamSlots,
  getUserCatches,
  getDexIndexOffset,
  findPokemonForms,
  getRandomPokemon,
  getRaritySettings,
  setRaritySettings,
  setPokemonRarity,
  addCustomPokemon,
  getUserRarityStreak,
  resetRarityStreaks,
  recordRarityCatch,
  WORLD_BOSS_POOL,
  getActiveWorldBoss,
  spawnWorldBoss,
  registerWorldBossPlayer,
  updateWorldBossPlayerTeam,
  getWorldBossPlayerTeam,
  isWorldBossPlayerRegistered,
  getWorldBossRegistrationCount,
  getBossLeaderboard,
  applyWorldBossDamage,
  distributeWorldBossRewards,
  getUnclaimedWorldBossReward,
  claimWorldBossReward,
  listOnMarket,
  listPokemonOnMarket,
  getMarketListingLimit,
  getUserMarketListingCount,
  getMarketListings,
  getMarketListingCount,
  getUserMarketListings,
  getUserMarketSales,
  getUnclaimedMarketSales,
  markMarketSalesClaimed,
  getUserMarketSaleSummary,
  clearMarketListings,
  removeUserMarketListings,
  stockMarketPokemon,
  buyMarketItem,
  expirePatreonTokenOrders,
  createPatreonTokenOrder,
  cancelPatreonTokenOrder,
  getPatreonTokenOrderBook,
  getUserPatreonTokenOrders,
  getPatreonTokenMarketStats,
  getDailyResetDay,
  getNextDailyReset,
  claimDailySwapTickets,
  recordDailyCatch,
  getDailyCatchLeaderboard,
  recordWildEncounterCounter,
  resetEncounterCounters,
  getEncounterCounters,
  resetChecklistIfNewDay,
  trackEventCatch,
  recordEventCatch,
  getUserEventProgress,
  getUserEventCatchCounts,
  getEventAnnouncementChannel,
  getRareSpawnAnnouncementChannel,
  getAllEventAnnouncementChannels,
  getAllRareSpawnAnnouncementChannels,
  setRareSpawnAnnouncementChannel,
  claimRareSpawnAnnouncement,
  releaseRareSpawnAnnouncement,
  getWorldBossAnnouncementChannel,
  setWorldBossAnnouncementChannel,
  getMarketAnnouncementChannel,
  setMarketAnnouncementChannel,
  getWorldBossAnnouncementPost,
  getWorldBossAnnouncementPosts,
  setWorldBossAnnouncementPost,
  setEventAnnouncementChannel,
  getChannelCatchRateBoost,
  getBoostedChannels,
  removeAllChannelCatchRateBoosts,
  addChannelCatchRateBoost,
  setChannelCatchRateBoost,
  getPlayerClan,
  getClanPerkMultipliers,
  getTotalEffectiveShinyBonus,
  getClanRankInfo,
  getNextClanRankInfo,
  setClanCoLeader,
  getClanCoLeaderIds,
  transferClanOwnership,
  purchaseClanRank,
  purchaseClanPerks,
  getClanPerkPurchaseInfo,
  depositClanTreasury,
  getClanByName,
  getClanMembers,
  getClanActivityStats,
  getClanHighScores,
  getClanLeaderboard,
  createClan,
  joinClan,
  leaveClan,
  disbandClan,
  banUser,
  unbanUser,
  isUserBanned,
  wipeUserData,
  deleteClanByName,
  trackClanActivity,
  registerEvent,
  getPokemonFormBySlug,
  getUserStatsSummary,
  getUserRegisteredCollections,
  syncDuplicateCatchState,
  syncNewCatchState,
  rebaseTransferredPokemon,
  reconcileDuplicateCatchStates,
  registerCollection,
  deleteCollection,
  setCollectionPrivacy,
  refreshAllCollections,
  getUserItems,
  findUserPokemonMatches,
  setUserPokemonLockByQuery,
  ROTOM_ITEMS,
  addUserItem,
  findUserItemName,
  findQuestItem,
  takeUserItem,
  changePokemonAbility,
  holdEvolutionItem,
  getResearchHeldItemError,
  unholdEvolutionItem,
  evolvePokemonWithItem,
  evolvePokemonByLevel,
  setGiveawayChannel,
  getGiveawayChannel,
  getAutoSpawnChannel,
  getAllAutoSpawnChannels,
  LOTTERY_SCHEDULE,
  buyLotteryTickets,
  drawLottery,
  setLotteryChannel,
  getLotteryState,
  getUserLotteryStats,
  getNextLotteryDrawTime,
  setAutoSpawnChannel,
  setAutoSpawnProgress,
  disableAutoSpawnChannel,
  markAutoSpawnHourlyTier,
};
