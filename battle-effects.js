// Battle engine for status moves and their effects (stat stages, statuses, weather, screens, hazards...).
// A "mon" is any battler object with { name, hp, max_hp, types, moves } plus stats either on mon.stats
// ({atk,def,spd}) or directly on the mon ({atk,def,spd}). Per-battle state lives on mon.fx.
const moveInfo = require('./data/move-info.json');
const movesData = require('./data/pokemon-moves.json');
const {
  ASSAULT_VEST_ITEM,
  FOCUS_BAND_ITEM,
  KINGS_ROCK_ITEM,
  LEFTOVERS_ITEM,
  getHeldItemDamageMultiplier,
  getHeldItemMoveType,
} = require('./held-item-effects');

const slug = (name) => String(name || '').toLowerCase().replace(/\s*\((physical|special)\)\s*$/, '').replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const STAGE_KEYS = ['atk', 'def', 'spa', 'spdef', 'spe', 'acc', 'eva'];
const STAGE_NAMES = { atk: 'Attack', def: 'Defense', spa: 'Sp. Atk', spdef: 'Sp. Def', spe: 'Speed', acc: 'accuracy', eva: 'evasiveness' };
const STATUS_NAMES = { slp: 'fell asleep', par: 'was paralyzed', brn: 'was burned', psn: 'was poisoned', tox: 'was badly poisoned', frz: 'was frozen solid' };

const B = (boost, extra = {}) => ({ boost, ...extra });
const D = (drop, extra = {}) => ({ drop, ...extra });
const H = (heal, extra = {}) => ({ heal, ...extra });
const ST = (status, extra = {}) => ({ status, ...extra });
const ALL5 = { atk: 1, def: 1, spa: 1, spdef: 1, spe: 1 };

const EFFECTS = {
  // Self stat boosts
  'swords-dance': B({ atk: 2 }), growth: B({ atk: 1, spa: 1 }), amnesia: B({ spdef: 2 }), 'iron-defense': B({ def: 2 }),
  'shell-smash': B({ atk: 2, spa: 2, spe: 2, def: -1, spdef: -1 }), harden: B({ def: 1 }), withdraw: B({ def: 1 }),
  'quiver-dance': B({ spa: 1, spdef: 1, spe: 1 }), agility: B({ spe: 2 }), 'double-team': B({ eva: 1 }),
  coil: B({ atk: 1, def: 1, acc: 1 }), 'nasty-plot': B({ spa: 2 }), 'defense-curl': B({ def: 1 }), minimize: B({ eva: 2 }),
  'cosmic-power': B({ def: 1, spdef: 1 }), 'calm-mind': B({ spa: 1, spdef: 1 }), barrier: B({ def: 2 }),
  'acid-armor': B({ def: 2 }), 'rock-polish': B({ spe: 2 }), meditate: B({ atk: 1 }), 'dragon-dance': B({ atk: 1, spe: 1 }),
  'work-up': B({ atk: 1, spa: 1 }), sharpen: B({ atk: 1 }), 'cotton-guard': B({ def: 3 }), autotomize: B({ spe: 2 }),
  'hone-claws': B({ atk: 1, acc: 1 }), 'tail-glow': B({ spa: 3 }), 'defend-order': B({ def: 1, spdef: 1 }),
  'bulk-up': B({ atk: 1, def: 1 }), howl: B({ atk: 1 }), 'shift-gear': B({ spe: 2, atk: 1 }), 'gear-up': B({ atk: 1, spa: 1 }),
  'no-retreat': B({ ...ALL5 }), 'clangorous-soul': B({ ...ALL5 }, { cost: 1 / 3 }), geomancy: B({ spa: 2, spdef: 2, spe: 2 }),
  stockpile: B({ def: 1, spdef: 1 }, { stockpile: true }), 'flower-shield': B({ def: 1 }), 'stuff-cheeks': B({ def: 2 }),
  'belly-drum': B({}, { cost: 0.5, maxAtk: true }), 'fillet-away': B({ atk: 2, spa: 2, spe: 2 }, { cost: 0.5 }),
  shelter: B({ def: 2 }), 'take-heart': B({ spa: 1, spdef: 1 }, { cure: true }), acupressure: { randomBoost: 2 },
  'tidy-up': B({ atk: 1, spe: 1 }, { clearHazards: true }), 'power-up-punch': undefined,
  'focus-energy': { flag: 'focus', text: 'is getting pumped!' }, 'laser-focus': { flag: 'laser', text: 'concentrated intensely!' },
  'lock-on': { flag: 'sureHit', text: 'took aim!', foe: true }, 'mind-reader': { flag: 'sureHit', text: 'took aim!', foe: true },
  'odor-sleuth': { flag: 'sureHit', text: 'took aim!', foe: true }, foresight: { flag: 'sureHit', text: 'took aim!', foe: true },
  'miracle-eye': { flag: 'sureHit', text: 'took aim!', foe: true }, charge: { flag: 'charge', text: 'began charging power!', boost: { spdef: 1 } },
  'magnet-rise': { timer: ['magnetRise', 5], text: 'levitated with electromagnetism!' },
  telekinesis: { timer: ['telekinesis', 3], text: 'was hurled into the air!', foe: true },
  'aqua-ring': { flag: 'aquaRing', text: 'surrounded itself with a veil of water!' }, ingrain: { flag: 'ingrain', text: 'planted its roots!' },
  // Foe stat drops
  growl: D({ atk: -1 }, { sound: true }), leer: D({ def: -1 }), 'tail-whip': D({ def: -1 }), screech: D({ def: -2 }, { sound: true }),
  'scary-face': D({ spe: -2 }), 'string-shot': D({ spe: -2 }), smokescreen: D({ acc: -1 }), 'sand-attack': D({ acc: -1 }),
  flash: D({ acc: -1 }), kinesis: D({ acc: -1 }), 'sweet-scent': D({ eva: -2 }), 'feather-dance': D({ atk: -2 }), charm: D({ atk: -2 }),
  'baby-doll-eyes': D({ atk: -1 }), 'fake-tears': D({ spdef: -2 }), 'metal-sound': D({ spdef: -2 }, { sound: true }),
  'cotton-spore': D({ spe: -2 }, { powder: true }), 'eerie-impulse': D({ spa: -2 }), captivate: D({ spa: -2 }),
  'noble-roar': D({ atk: -1, spa: -1 }, { sound: true }), tickle: D({ atk: -1, def: -1 }), confide: D({ spa: -1 }, { sound: true }),
  'play-nice': D({ atk: -1 }), 'tearful-look': D({ atk: -1, spa: -1 }), 'parting-shot': D({ atk: -1, spa: -1 }, { sound: true }),
  'tar-shot': D({ spe: -1 }), 'spicy-extract': { foe: true, sure: true, stages: { atk: 2, def: -2 } },
  memento: D({ atk: -2, spa: -2 }, { selfFaint: true }), 'strength-sap': D({ atk: -1 }, { sapHeal: true }),
  'venom-drench': D({ atk: -1, spa: -1, spe: -1 }, { needsPoison: true }), 'toxic-thread': D({ spe: -1 }, { status: 'psn' }),
  octolock: { foe: true, flag: 'octolock', text: 'is locked in an octopus grip!' },
  // Statuses
  'sleep-powder': ST('slp', { powder: true }), spore: ST('slp', { powder: true }), hypnosis: ST('slp'), sing: ST('slp', { sound: true }),
  'lovely-kiss': ST('slp'), 'grass-whistle': ST('slp', { sound: true }), 'dark-void': ST('slp'),
  'stun-spore': ST('par', { powder: true }), 'thunder-wave': ST('par', { groundImmune: true }), glare: ST('par'),
  'poison-powder': ST('psn', { powder: true }), 'poison-gas': ST('psn'), toxic: ST('tox'), 'will-o-wisp': ST('brn'),
  supersonic: { foe: true, confuse: true, sound: true }, 'confuse-ray': { foe: true, confuse: true }, 'teeter-dance': { foe: true, confuse: true },
  swagger: { foe: true, confuse: true, boostFoe: { atk: 2 } }, flatter: { foe: true, confuse: true, boostFoe: { spa: 1 } },
  'sweet-kiss': { foe: true, confuse: true }, yawn: { foe: true, yawn: true }, 'leech-seed': { foe: true, leech: true },
  attract: { foe: true, attract: true }, nightmare: { foe: true, nightmare: true }, torment: { foe: true, timer: ['torment', 99], text: 'was subjected to torment!' },
  taunt: { foe: true, timer: ['taunt', 3], text: 'fell for the taunt!' }, disable: { foe: true, disable: true },
  encore: { foe: true, encore: true }, 'heal-block': { foe: true, timer: ['healBlock', 5], text: 'was prevented from healing!' },
  embargo: { foe: true, timer: ['embargo', 5], text: 'can no longer use items!' }, imprison: { flag: 'imprison', text: 'sealed the moves it shares with the foe!' },
  'psycho-shift': { foe: true, psychoShift: true }, quash: { foe: true, flag: 'quashed', onFoe: true, text: 'was forced to move last!' },
  powder: { foe: true, flag: 'powdered', onFoe: true, text: 'was covered in powder!' }, electrify: { foe: true, flag: 'electrified', onFoe: true, text: 'was charged with electricity!' },
  'perish-song': { perish: true }, 'destiny-bond': { flag: 'destinyBond', text: 'is trying to take its foe down with it!' },
  curse: { curse: true }, 'mean-look': { foe: true, nothing: 'The foe can no longer flee... (no escape needed here)' },
  // Healing
  recover: H(0.5), roost: H(0.5), 'slack-off': H(0.5), 'soft-boiled': H(0.5), 'milk-drink': H(0.5), 'heal-order': H(0.5),
  'shore-up': H(0.5, { weather: 'sand' }), synthesis: H(0.5, { weather: 'sun' }), 'morning-sun': H(0.5, { weather: 'sun' }),
  moonlight: H(0.5, { weather: 'sun' }), 'life-dew': H(0.25), 'jungle-healing': H(0.25, { cure: true }),
  'lunar-blessing': H(0.25, { cure: true, boost: { eva: 0 } }), 'heal-pulse': { foe: true, healFoe: 0.5, sure: true },
  'floral-healing': { foe: true, healFoe: 0.5, sure: true }, rest: { rest: true }, wish: { wish: true }, 'pain-split': { foe: true, painSplit: true, sure: true },
  swallow: { swallow: true }, 'heal-bell': { cure: true, text: 'A bell chimed and its status was cured!' },
  aromatherapy: { cure: true, text: 'A soothing aroma cured its status!' }, refresh: { cure: true }, purify: { foe: true, purify: true, sure: true },
  'healing-wish': { healingWish: true }, 'lunar-dance': { healingWish: true }, 'revival-blessing': { revive: true },
  // Protection
  protect: { protect: 'protect' }, detect: { protect: 'protect' }, endure: { protect: 'endure' }, 'spiky-shield': { protect: 'spiky' },
  'kings-shield': { protect: 'kings' }, 'baneful-bunker': { protect: 'baneful' }, obstruct: { protect: 'obstruct' },
  'silk-trap': { protect: 'silk' }, 'burning-bulwark': { protect: 'burning' }, 'mat-block': { protect: 'protect', firstTurn: true },
  'quick-guard': { protect: 'quick' }, 'crafty-shield': { protect: 'crafty' }, 'wide-guard': { nothing: 'It had no effect in a single battle.' },
  'magic-coat': { flag: 'magicCoat', text: 'shrouded itself with a reflecting aura!' }, snatch: { flag: 'snatch', text: 'waits for a chance to snatch a move!' },
  // Field
  reflect: { side: 'reflect', turns: 5 }, 'light-screen': { side: 'lightScreen', turns: 5 }, 'aurora-veil': { side: 'veil', turns: 5, needs: 'hail' },
  safeguard: { side: 'safeguard', turns: 5 }, mist: { side: 'mist', turns: 5 }, tailwind: { side: 'tailwind', turns: 4 },
  'lucky-chant': { side: 'luckyChant', turns: 5 }, spikes: { hazard: 'spikes', max: 3 }, 'toxic-spikes': { hazard: 'tspikes', max: 2 },
  'stealth-rock': { hazard: 'rocks', max: 1 }, 'sticky-web': { hazard: 'web', max: 1 }, defog: { defog: true, foe: true, sure: true },
  'court-change': { courtChange: true }, 'rain-dance': { weather: 'rain' }, 'sunny-day': { weather: 'sun' },
  sandstorm: { weather: 'sand' }, hail: { weather: 'hail' }, snowscape: { weather: 'hail' },
  'grassy-terrain': { terrain: 'grassy' }, 'electric-terrain': { terrain: 'electric' }, 'psychic-terrain': { terrain: 'psychic' },
  'misty-terrain': { terrain: 'misty' }, 'trick-room': { room: 'trickRoom' }, 'wonder-room': { room: 'wonder' }, 'magic-room': { room: 'magic' },
  gravity: { room: 'gravity' }, 'water-sport': { room: 'waterSport' }, 'mud-sport': { room: 'mudSport' }, 'ion-deluge': { room: 'ionDeluge' },
  'fairy-lock': { nothing: 'Neither side can flee... (no escape needed here)' },
  haze: { haze: true }, substitute: { substitute: true }, nature: undefined, 'topsy-turvy': { foe: true, topsy: true, sure: true },
  'psych-up': { foe: true, psychUp: true, sure: true }, 'power-swap': { foe: true, swap: ['atk', 'spa'], sure: true },
  'guard-swap': { foe: true, swap: ['def', 'spdef'], sure: true }, 'speed-swap': { foe: true, swapStat: 'spe', sure: true },
  'heart-swap': { foe: true, swap: STAGE_KEYS, sure: true }, 'power-trick': { powerTrick: true }, 'guard-split': { foe: true, split: 'def', sure: true },
  'power-split': { foe: true, split: 'atk', sure: true }, transform: { foe: true, transform: true, sure: true }, mimic: { foe: true, mimic: true, sure: true },
  sketch: { foe: true, mimic: true, sure: true }, conversion: { typeSelf: 'first' }, 'conversion-2': { typeSelf: 'resist' }, camouflage: { typeSelf: 'normal' },
  'reflect-type': { foe: true, typeSelf: 'copy', sure: true }, soak: { foe: true, typeFoe: ['water'] }, 'magic-powder': { foe: true, typeFoe: ['psychic'], powder: true },
  'trick-or-treat': { foe: true, addTypeFoe: 'ghost' }, 'forests-curse': { foe: true, addTypeFoe: 'grass' },
  // Move-calling
  metronome: { call: 'random' }, copycat: { call: 'copycat' }, 'mirror-move': { call: 'mirror' }, 'me-first': { call: 'mirror' },
  'sleep-talk': { call: 'sleeptalk' }, 'nature-power': { call: 'tri-attack' }, assist: { call: 'random' },
  // Moves that do nothing meaningful in a one-on-one battle without items/abilities/allies/switching
  splash: { nothing: 'But nothing happened!' }, teleport: { nothing: 'But it failed!' }, 'baton-pass': { baton: true },
  whirlwind: { nothing: 'But it failed!' }, roar: { nothing: 'But it failed!' }, 'helping-hand': { nothing: 'But it failed!' },
  'ally-switch': { nothing: 'But it failed!' }, 'after-you': { nothing: 'But it failed!' }, instruct: { nothing: 'But it failed!' },
  'follow-me': { nothing: 'But it failed!' }, 'rage-powder': { nothing: 'But it failed!' }, spotlight: { nothing: 'But it failed!' },
  'shed-tail': { nothing: 'But it failed!' }, 'play-rough': undefined,
  'magnetic-flux': { nothing: 'But it failed!' }, 'aromatic-mist': { nothing: 'But it failed!' },
  'dragon-cheer': { nothing: 'But it failed!' }, coaching: { nothing: 'But it failed!' },
  'corrosive-gas': { nothing: 'But it had no effect here.' }, 'chilly-reception': { weather: 'hail' },
};
for (const name of ['gastro-acid', 'simple-beam', 'worry-seed', 'entrainment', 'role-play', 'skill-swap', 'doodle', 'trick', 'switcheroo',
  'recycle', 'bestow', 'teatime', 'rototiller', 'decorate', 'grudge', 'spite', 'block', 'spider-web', 'topsy-turvy-x', 'psychic-noise-x']) {
  if (!EFFECTS[name]) EFFECTS[name] = { nothing: 'But it had no effect here.' };
}
EFFECTS['spider-web'] = { nothing: 'But it had no effect here.' };
for (const key of Object.keys(EFFECTS)) if (!EFFECTS[key]) delete EFFECTS[key];
for (const [key, eff] of Object.entries(EFFECTS)) {
  if (eff.drop || eff.status || eff.confuse) eff.foe = true;
}

const SOUND_MOVES = new Set(Object.entries(EFFECTS).filter(([, e]) => e.sound).map(([k]) => k));
// Moves that force the user to skip its next turn after hitting.
const RECHARGE_MOVES = new Set([
  'hyper-beam', 'giga-impact', 'blast-burn', 'hydro-cannon', 'frenzy-plant', 'rock-wrecker',
  'roar-of-time', 'prismatic-laser', 'meteor-assault', 'eternabeam',
]);

const stageMult = (s) => (s >= 0 ? (2 + s) / 2 : 2 / (2 - s));
const accMult = (s) => (s >= 0 ? (3 + s) / 3 : 3 / (3 - s));

function fx(m) {
  if (!m.fx) {
    m.fx = {
      stages: { atk: 0, def: 0, spa: 0, spdef: 0, spe: 0, acc: 0, eva: 0 },
      status: null, sleep: 0, tox: 0, confuse: 0, flinch: false, lastMove: null, protectStreak: 0, stockpile: 0, sub: 0,
    };
  }
  return m.fx;
}

function createField() {
  const side = () => ({ reflect: 0, lightScreen: 0, veil: 0, safeguard: 0, mist: 0, tailwind: 0, luckyChant: 0, spikes: 0, tspikes: 0, rocks: 0, web: 0, wish: null, healingWish: false });
  return {
    weather: null, weatherTurns: 0, terrain: null, terrainTurns: 0, trickRoom: 0, gravity: 0, wonder: 0, magic: 0,
    waterSport: 0, mudSport: 0, ionDeluge: false, sides: { player: side(), enemy: side() },
  };
}

const baseStat = (m, key) => (m.stats ? m.stats[key] : m[key]);
function setBaseStat(m, key, value) { if (m.stats) m.stats[key] = value; else m[key] = value; }
const other = (side) => (side === 'player' ? 'enemy' : 'player');
const isGrounded = (m, field) => {
  const f = fx(m);
  if (field.gravity > 0) return true;
  return !m.types.includes('flying') && !(f.magnetRise > 0) && !(f.telekinesis > 0);
};

function effectiveSpeed(m, field, side) {
  const f = fx(m);
  let speed = (baseStat(m, 'spd') || 1) * stageMult(f.stages.spe);
  if (f.status === 'par') speed *= 0.5;
  if (field.sides[side].tailwind > 0) speed *= 2;
  return speed;
}

// Stat multiplier for outgoing damage calculations: stage-adjusted attack and defense for a move.
// Sp. Atk / Sp. Def EVs add what they would to a dedicated special stat (this game stores only Atk and Def).
const evBonus = (m, key) => Math.floor(Math.floor((m[key] || 0) / 4) * (m.level || 0) / 100);

function damageStats(attacker, defender, move, field) {
  const af = fx(attacker); const df = fx(defender);
  const physical = move.category !== 'special';
  let defKey = physical ? 'def' : 'spdef';
  if (field.wonder > 0) defKey = physical ? 'spdef' : 'def';
  let atk = (baseStat(attacker, 'atk') + (physical ? 0 : evBonus(attacker, 'ev_spa'))) * stageMult(af.stages[physical ? 'atk' : 'spa']);
  if (af.status === 'brn' && physical) atk *= 0.5;
  const def = (baseStat(defender, 'def') + (defKey === 'spdef' ? evBonus(defender, 'ev_spdef') : 0))
    * stageMult(df.stages[defKey])
    * (defender.held_item === ASSAULT_VEST_ITEM && defKey === 'spdef' ? 1.5 : 1);
  return { atk: Math.max(1, atk), def: Math.max(1, def), physical };
}

const getPriority = (move) => moveInfo[slug(move.name)]?.priority ?? 0;

// Stored Power / Power Trip: 20 base power plus 20 for every positive stat stage the user has.
function effectivePower(move, stages) {
  if (!['stored-power', 'power-trip'].includes(slug(move.name))) return move.power;
  const boosts = Object.values(stages || {}).reduce((sum, stage) => sum + Math.max(0, stage), 0);
  return 20 + 20 * boosts;
}

function stageText(delta, label, name) {
  const size = Math.abs(delta);
  if (delta > 0) return `${name}'s ${label} ${size >= 3 ? 'rose drastically' : size === 2 ? 'rose sharply' : 'rose'}!`;
  return `${name}'s ${label} ${size >= 3 ? 'severely fell' : size === 2 ? 'harshly fell' : 'fell'}!`;
}

function changeStage(ctx, mon, side, key, delta, L, fromFoe = false) {
  const f = fx(mon);
  if (fromFoe && delta < 0) {
    if (ctx.field.sides[side].mist > 0) { L(`${mon.name} is protected by Mist!`); return false; }
    if (f.sub > 0) return false;
  }
  const next = Math.max(-6, Math.min(6, f.stages[key] + delta));
  if (next === f.stages[key]) {
    L(`${mon.name}'s ${STAGE_NAMES[key]} won't go any ${delta > 0 ? 'higher' : 'lower'}!`);
    return false;
  }
  const applied = next - f.stages[key];
  f.stages[key] = next;
  L(stageText(applied, STAGE_NAMES[key], mon.name));
  return true;
}

function healMon(mon, amount, L) {
  const f = fx(mon);
  if (f.healBlock > 0) { L(`${mon.name} can't heal while Heal Block is active!`); return false; }
  const before = mon.hp;
  mon.hp = Math.min(mon.max_hp, mon.hp + Math.max(1, Math.floor(amount)));
  if (mon.hp === before) { L(`${mon.name}'s HP is already full!`); return false; }
  L(`${mon.name} restored **${mon.hp - before}** HP.`);
  return true;
}

function inflictStatus(ctx, mon, side, status, L, { quiet = false, sourceSide = null } = {}) {
  const f = fx(mon);
  const fail = (text) => { if (!quiet) L(text); return false; };
  if (f.status) return fail(`${mon.name} is already ${f.status === 'slp' ? 'asleep' : 'afflicted'}!`);
  if (f.sub > 0 && sourceSide && sourceSide !== side) return fail('But it failed!');
  if (ctx.field.sides[side].safeguard > 0 && sourceSide && sourceSide !== side) return fail(`${mon.name} is protected by Safeguard!`);
  const grounded = isGrounded(mon, ctx.field);
  if (ctx.field.terrain === 'misty' && grounded) return fail(`${mon.name} is protected by the Misty Terrain!`);
  if (status === 'slp' && ctx.field.terrain === 'electric' && grounded) return fail(`${mon.name} is protected by the Electric Terrain!`);
  if (status === 'par' && mon.types.includes('electric')) return fail(`It doesn't affect ${mon.name}...`);
  if (status === 'brn' && mon.types.includes('fire')) return fail(`It doesn't affect ${mon.name}...`);
  if ((status === 'psn' || status === 'tox') && (mon.types.includes('poison') || mon.types.includes('steel'))) return fail(`It doesn't affect ${mon.name}...`);
  if (status === 'frz' && (mon.types.includes('ice') || ctx.field.weather === 'sun')) return fail(`It doesn't affect ${mon.name}...`);
  f.status = status;
  f.sleep = status === 'slp' ? 1 + Math.floor(Math.random() * 3) : 0;
  f.tox = status === 'tox' ? 1 : 0;
  L(`${mon.name} ${STATUS_NAMES[status]}!`);
  return true;
}

function cureStatus(mon) {
  const f = fx(mon);
  const had = f.status;
  f.status = null; f.sleep = 0; f.tox = 0; f.nightmare = false;
  return had;
}

// Build an enemy move list: up to 3 damaging moves plus one random supported status move when available.
function buildEnemyMoves(learnset, limit = 4) {
  const damaging = learnset.filter((m) => m.power > 0);
  const status = learnset.filter((m) => !m.power && EFFECTS[slug(m.name)] && !EFFECTS[slug(m.name)].nothing && !EFFECTS[slug(m.name)].baton);
  const pool = damaging.length ? damaging : learnset;
  if (!status.length || pool.length === 0) return pool.slice(0, limit);
  const picks = pool.slice(0, limit - 1);
  picks.push(status[Math.floor(Math.random() * status.length)]);
  return picks;
}

function isUseful(move, user, target, field, side) {
  if (move.power > 0) return true;
  const eff = EFFECTS[slug(move.name)];
  if (!eff) return false;
  if (eff.nothing || eff.baton || eff.call === 'sleeptalk') return false;
  const uf = fx(user); const tf = fx(target);
  if (eff.heal || eff.rest || eff.swallow) return user.hp < user.max_hp * 0.7;
  if (eff.boost) return Object.entries(eff.boost).some(([k, v]) => v > 0 && uf.stages[k] < 4);
  if (eff.drop) return Object.entries(eff.drop).some(([k, v]) => tf.stages[k] > -4);
  if (eff.status) return !tf.status;
  if (eff.confuse) return !(tf.confuse > 0);
  if (eff.side) return !(field.sides[side][eff.side] > 0);
  if (eff.hazard) return field.sides[other(side)][eff.hazard] < (eff.max || 1);
  if (eff.weather) return field.weather !== eff.weather;
  if (eff.terrain) return field.terrain !== eff.terrain;
  if (eff.protect) return uf.protectStreak === 0 && Math.random() < 0.4;
  if (eff.substitute) return !(uf.sub > 0) && user.hp > user.max_hp * 0.5;
  if (eff.leech) return !tf.leech;
  return true;
}

function chooseEnemyMove(enemy, player, field) {
  const moves = enemy.moves || [];
  const damaging = moves.filter((m) => m.power > 0);
  const status = moves.filter((m) => !m.power && isUseful(m, enemy, player, field, 'enemy'));
  if (status.length && (!damaging.length || Math.random() < 0.35)) return status[Math.floor(Math.random() * status.length)];
  const pool = damaging.length ? damaging : moves;
  return pool[Math.floor(Math.random() * pool.length)];
}

function onSwitchIn(ctx, mon, side, L) {
  fx(mon);
  const s = ctx.field.sides[side];
  if (s.healingWish) {
    s.healingWish = false;
    mon.hp = mon.max_hp; cureStatus(mon);
    L(`${mon.name} was healed by the healing wish!`);
  }
  const grounded = isGrounded(mon, ctx.field);
  if (s.rocks) {
    const mult = ctx.typeEff ? ctx.typeEff('rock', mon.types) : 1;
    const dmg = Math.max(1, Math.floor(mon.max_hp * mult / 8));
    mon.hp = Math.max(1, mon.hp - dmg); L(`Pointed stones dug into ${mon.name} for **${dmg}** damage!`);
  }
  if (s.spikes && grounded) {
    const dmg = Math.max(1, Math.floor(mon.max_hp * [0, 1 / 8, 1 / 6, 1 / 4][s.spikes]));
    mon.hp = Math.max(1, mon.hp - dmg); L(`${mon.name} was hurt by the spikes for **${dmg}** damage!`);
  }
  if (s.tspikes && grounded) {
    if (mon.types.includes('poison')) { s.tspikes = 0; L(`${mon.name} absorbed the poison spikes!`); }
    else inflictStatus(ctx, mon, side, s.tspikes >= 2 ? 'tox' : 'psn', L);
  }
  if (s.web && grounded) changeStage(ctx, mon, side, 'spe', -1, L);
}

function typeEffOf(ctx, type, types) { return ctx.typeEff ? ctx.typeEff(type, types) : 1; }

function useProtect(ctx, A, eff, L) {
  const f = fx(A.mon);
  const chance = f.protectStreak > 0 ? Math.pow(1 / 3, f.protectStreak) : 1;
  if (Math.random() >= chance) { f.protectStreak = 0; L('But it failed!'); return; }
  f.protect = eff.protect;
  f.protectStreak += 1;
  L(`${A.mon.name} ${eff.protect === 'endure' ? 'braced itself!' : 'protected itself!'}`);
}

function chooseCalledMove(ctx, A, B, kind) {
  const f = fx(A.mon);
  if (kind === 'copycat' || kind === 'mirror') return fx(B.mon).lastMove;
  if (kind === 'sleeptalk') {
    if (f.status !== 'slp') return null;
    const options = (A.mon.moves || []).filter((m) => slug(m.name) !== 'sleep-talk');
    return options.length ? options[Math.floor(Math.random() * options.length)] : null;
  }
  if (kind === 'tri-attack') return movesData.moves['tri-attack'] || null;
  const banned = new Set(['metronome', 'copycat', 'mirror-move', 'assist', 'me-first', 'sleep-talk', 'transform', 'mimic', 'sketch', 'nature-power', 'struggle']);
  const keys = Object.keys(movesData.moves).filter((k) => !banned.has(k) && (movesData.moves[k].power > 0 || EFFECTS[k]));
  return movesData.moves[keys[Math.floor(Math.random() * keys.length)]];
}

function applyContactEffect(ctx, A, B, kind, L) {
  const m = A.mon;
  if (kind === 'spiky') { m.hp -= Math.max(1, Math.floor(m.max_hp / 8)); L(`${m.name} was hurt by the spiky shield!`); }
  else if (kind === 'kings') changeStage(ctx, m, A.side, 'atk', -1, L);
  else if (kind === 'baneful') inflictStatus(ctx, m, A.side, 'psn', L, { sourceSide: B.side });
  else if (kind === 'obstruct') changeStage(ctx, m, A.side, 'def', -2, L);
  else if (kind === 'silk') changeStage(ctx, m, A.side, 'spe', -1, L);
  else if (kind === 'burning') inflictStatus(ctx, m, A.side, 'brn', L, { sourceSide: B.side });
}

function applyDamageMove(ctx, A, B, move, L, depth = 0) {
  const m = A.mon; const t = B.mon; const f = fx(m); const tf = fx(t);
  let type = getHeldItemMoveType(move.name, move.type, m.held_item);
  if (f.electrified) { type = 'electric'; f.electrified = false; } else if (ctx.field.ionDeluge && type === 'normal') type = 'electric';
  if (f.powdered && type === 'fire') {
    m.hp -= Math.max(1, Math.floor(m.max_hp / 4)); f.powdered = false;
    L(`${m.name} used **${move.name}**, but the powder exploded!`);
    return;
  }
  if (tf.protect && tf.protect !== 'endure') {
    const blocks = tf.protect === 'quick' ? getPriority(move) > 0 : tf.protect !== 'crafty';
    if (blocks) {
      L(`${m.name} used **${move.name}**, but ${t.name} protected itself!`);
      if (move.category !== 'special') applyContactEffect(ctx, A, B, tf.protect, L);
      return;
    }
  }
  if (!f.sureHit && move.accuracy) {
    const chance = move.accuracy * accMult(f.stages.acc - tf.stages.eva);
    if (Math.random() * 100 >= chance) { L(`${m.name} used **${move.name}**, but missed.`); return; }
  }
  f.sureHit = false;
  let defTypes = [...t.types];
  if (ctx.field.gravity > 0 && type === 'ground') defTypes = defTypes.filter((x) => x !== 'flying');
  const levitating = (tf.magnetRise > 0 || tf.telekinesis > 0) && ctx.field.gravity <= 0;
  const eff = (type === 'ground' && levitating) ? 0 : typeEffOf(ctx, type, defTypes);
  const { atk, def, physical } = damageStats(m, t, move, ctx.field);
  let calcMove = { ...move, type };
  calcMove.power = effectivePower(move, f.stages);
  let dmg = eff === 0 ? 0 : ctx.calc(calcMove, atk, def, defTypes);
  const heldItemMultiplier = getHeldItemDamageMultiplier(m.held_item, type);
  let crit = false;
  if (dmg > 0) {
    let mult = heldItemMultiplier;
    const w = ctx.field.weather;
    if (w === 'rain') mult *= type === 'water' ? 1.5 : type === 'fire' ? 0.5 : 1;
    if (w === 'sun') mult *= type === 'fire' ? 1.5 : type === 'water' ? 0.5 : 1;
    const terrain = ctx.field.terrain;
    if (isGrounded(m, ctx.field)) {
      if (terrain === 'grassy' && type === 'grass') mult *= 1.3;
      if (terrain === 'electric' && type === 'electric') mult *= 1.3;
      if (terrain === 'psychic' && type === 'psychic') mult *= 1.3;
    }
    if (terrain === 'misty' && type === 'dragon' && isGrounded(t, ctx.field)) mult *= 0.5;
    if (f.charge && type === 'electric') mult *= 2;
    if (ctx.field.waterSport > 0 && type === 'fire') mult *= 0.33;
    if (ctx.field.mudSport > 0 && type === 'electric') mult *= 0.33;
    crit = f.laser || Math.random() < (f.focus ? 0.5 : 0.0625);
    if (crit) {
      mult *= 1.5;
      // Each Aux Guard / Aux Powerguard stack cuts one critical hit's damage by 75%.
      if (tf.critGuard > 0) { tf.critGuard -= 1; mult *= 0.25; }
    }
    const ts = ctx.field.sides[B.side];
    if (!crit && (ts.veil > 0 || (physical ? ts.reflect : ts.lightScreen) > 0)) mult *= 0.5;
    dmg = Math.max(1, Math.floor(dmg * mult));
  }
  f.charge = false; f.laser = false;
  if (RECHARGE_MOVES.has(slug(move.name))) f.recharge = true;
  if (tf.frz !== undefined) tf.frz = undefined;
  if (dmg > 0 && tf.status === 'frz' && type === 'fire') { tf.status = null; L(`${t.name} thawed out!`); }
  if (dmg > 0 && tf.sub > 0) {
    tf.sub -= dmg;
    L(`${m.name} used **${move.name}** — the substitute took **${dmg}** damage${tf.sub <= 0 ? ' and faded!' : '.'}`);
    if (tf.sub <= 0) tf.sub = 0;
    return;
  }
  const targetHpBefore = t.hp;
  t.hp -= dmg;
  let survivedText = '';
  if (t.hp <= 0 && tf.protect === 'endure') { t.hp = 1; survivedText = ` ${t.name} endured the hit!`; }
  else if (t.hp <= 0 && t.held_item === FOCUS_BAND_ITEM && Math.random() < 0.1) {
    t.hp = 1;
    survivedText = ` ${t.name} hung on with its Focus Band!`;
  }
  if (dmg > 0 && t.hp > 0 && m.held_item === KINGS_ROCK_ITEM
      && !/flinch/i.test(moveInfo[slug(move.name)]?.description || '')
      && Math.random() < 0.1) {
    tf.flinch = true;
    survivedText += ` ${t.name} flinched from the King's Rock!`;
  }
  L(`${m.name} used **${move.name}** for **${dmg}** damage` +
    `${eff > 1 ? ' — super effective!' : eff === 0 ? ' — no effect.' : eff < 1 ? ' — not very effective.' : ''}` +
    `${heldItemMultiplier > 1 ? ` ${m.held_item} boosted the move!` : ''}` +
    `${crit && dmg > 0 ? ' A critical hit!' : ''}${survivedText}`);
  if (t.hp <= 0 && tf.destinyBond) { m.hp = 0; L(`${m.name} was taken down with ${t.name}!`); }
  applyDamageSecondaryEffects(ctx, A, B, t, move, dmg, L);
  if (slug(move.name) === 'drain-punch' && dmg > 0 && m.hp > 0) {
    const damageDealt = Math.max(0, targetHpBefore - Math.max(0, t.hp));
    if (damageDealt > 0) healMon(m, Math.max(1, Math.floor(damageDealt / 2)), L);
  }
}

// Stat drops that damaging moves inflict on the target: [chance %, stages].
const DAMAGE_STAT_DROPS = {
  'acid-spray': [100, { spdef: -2 }], 'seed-flare': [40, { spdef: -2 }], 'energy-ball': [10, { spdef: -1 }],
  'focus-blast': [10, { spdef: -1 }], 'earth-power': [10, { spdef: -1 }], 'shadow-ball': [20, { spdef: -1 }],
  'flash-cannon': [10, { spdef: -1 }], 'bug-buzz': [10, { spdef: -1 }], 'psychic': [10, { spdef: -1 }],
  'acid': [10, { spdef: -1 }], 'crunch': [20, { def: -1 }], 'iron-tail': [30, { def: -1 }],
  'rock-smash': [50, { def: -1 }], 'liquidation': [20, { def: -1 }], 'crush-claw': [50, { def: -1 }],
  'razor-shell': [50, { def: -1 }], 'lunge': [100, { atk: -1 }], 'trop-kick': [100, { atk: -1 }],
  'spirit-break': [100, { spa: -1 }], 'moonblast': [30, { spa: -1 }], 'mystical-fire': [100, { spa: -1 }],
  'snarl': [100, { spa: -1 }], 'struggle-bug': [100, { spa: -1 }],
  'icy-wind': [100, { spe: -1 }], 'electroweb': [100, { spe: -1 }], 'bulldoze': [100, { spe: -1 }],
  'low-sweep': [100, { spe: -1 }], 'rock-tomb': [100, { spe: -1 }], 'mud-shot': [100, { spe: -1 }],
  'constrict': [10, { spe: -1 }], 'bubble-beam': [10, { spe: -1 }], 'bubble': [10, { spe: -1 }],
  'mud-slap': [100, { acc: -1 }], 'octazooka': [50, { acc: -1 }], 'mud-bomb': [30, { acc: -1 }],
  'mirror-shot': [30, { acc: -1 }], 'muddy-water': [30, { acc: -1 }], 'night-daze': [40, { acc: -1 }],
  'lumina-crash': [100, { spdef: -2 }], 'fire-lash': [100, { def: -1 }], 'thunderous-kick': [100, { def: -1 }],
  'skitter-smack': [100, { spa: -1 }], 'apple-acid': [100, { spdef: -1 }], 'grav-apple': [100, { def: -1 }],
  'triple-arrows': [50, { def: -1 }],
  'bitter-malice': [100, { atk: -1 }], glaciate: [100, { spe: -1 }], pounce: [100, { spe: -1 }],
  'breaking-swipe': [100, { atk: -1 }], 'chilling-water': [100, { atk: -1 }], 'drum-beating': [100, { spe: -1 }],
  'play-rough': [10, { atk: -1 }], 'aurora-beam': [10, { atk: -1 }], 'mist-ball': [50, { spa: -1 }],
  'luster-purge': [50, { spdef: -1 }], 'shadow-bone': [20, { def: -1 }], 'leaf-tornado': [50, { acc: -1 }],
  'max-strike': [100, { spe: -1 }], 'max-wyrmwind': [100, { atk: -1 }], 'max-phantasm': [100, { def: -1 }],
  'max-darkness': [100, { spdef: -1 }], 'max-flutterby': [100, { spa: -1 }],
};

// Stat changes the user gets after a damaging move hits: [chance %, stages].
const DAMAGE_SELF_BOOSTS = {
  'max-ooze': [100, { spa: 1 }], 'max-knuckle': [100, { atk: 1 }], 'max-steelspike': [100, { def: 1 }],
  'max-quake': [100, { spdef: 1 }], 'max-airstream': [100, { spe: 1 }],
  'power-up-punch': [100, { atk: 1 }], 'flame-charge': [100, { spe: 1 }], 'trailblaze': [100, { spe: 1 }],
  'aqua-step': [100, { spe: 1 }], 'rapid-spin': [100, { spe: 1 }], 'esper-wing': [100, { spe: 1 }],
  'mystical-power': [100, { spa: 1 }], 'torch-song': [100, { spa: 1 }], 'charge-beam': [70, { spa: 1 }],
  'fiery-dance': [50, { spa: 1 }], 'metal-claw': [10, { atk: 1 }], 'steel-wing': [10, { def: 1 }],
  'diamond-storm': [50, { def: 2 }], 'scale-shot': [100, { spe: 1, def: -1 }],
  'ancient-power': [10, { atk: 1, def: 1, spa: 1, spdef: 1, spe: 1 }],
  'silver-wind': [10, { atk: 1, def: 1, spa: 1, spdef: 1, spe: 1 }],
  'ominous-wind': [10, { atk: 1, def: 1, spa: 1, spdef: 1, spe: 1 }],
  'close-combat': [100, { def: -1, spdef: -1 }], superpower: [100, { atk: -1, def: -1 }],
  'draco-meteor': [100, { spa: -2 }], overheat: [100, { spa: -2 }], 'leaf-storm': [100, { spa: -2 }],
  'psycho-boost': [100, { spa: -2 }], 'fleur-cannon': [100, { spa: -2 }], 'make-it-rain': [100, { spa: -1 }],
  'v-create': [100, { def: -1, spdef: -1, spe: -1 }], 'hammer-arm': [100, { spe: -1 }],
  'ice-hammer': [100, { spe: -1 }], 'dragon-ascent': [100, { def: -1, spdef: -1 }],
  'clanging-scales': [100, { def: -1 }], 'hyperspace-fury': [100, { def: -1 }],
  'armor-cannon': [100, { def: -1, spdef: -1 }], 'headlong-rush': [100, { def: -1, spdef: -1 }],
  'spin-out': [100, { spe: -2 }],
};

function applyDamageSecondaryEffects(ctx, A, B, t, move, dmg, L) {
  const selfBoost = DAMAGE_SELF_BOOSTS[slug(move.name)];
  if (selfBoost && dmg > 0 && Math.random() * 100 < selfBoost[0]) {
    for (const [key, delta] of Object.entries(selfBoost[1])) changeStage(ctx, A.mon, A.side, key, delta, L);
  }
  const drop = DAMAGE_STAT_DROPS[slug(move.name)];
  if (!drop || dmg <= 0 || t.hp <= 0 || fx(t).sub > 0) return;
  if (Math.random() * 100 >= drop[0]) return;
  for (const [key, delta] of Object.entries(drop[1])) changeStage(ctx, t, B.side, key, delta, L, true);
}

function applyStatusMove(ctx, A, B, move, L, depth = 0) {
  const m = A.mon; const t = B.mon; const f = fx(m); const tf = fx(t);
  const key = slug(move.name);
  const eff = EFFECTS[key];
  if (!eff) { L(`${m.name} used **${move.name}**. But nothing happened!`); return; }
  const foeTarget = Boolean(eff.foe);
  if (foeTarget && tf.magicCoat && depth === 0 && !eff.healFoe) {
    tf.magicCoat = false;
    L(`${m.name} used **${move.name}**, but ${t.name} bounced it back!`);
    applyStatusMove(ctx, B, A, move, L, 1);
    return;
  }
  if (tf.snatch && !foeTarget && (eff.boost || eff.heal)) {
    tf.snatch = false;
    L(`${t.name} snatched ${m.name}'s **${move.name}**!`);
    applyStatusMove(ctx, B, A, move, L, 1);
    return;
  }
  L(`${m.name} used **${move.name}**.`);
  if (foeTarget) {
    if (tf.protect && tf.protect !== 'endure' && tf.protect !== 'quick') { L(`${t.name} protected itself!`); return; }
    if (tf.sub > 0 && !SOUND_MOVES.has(key) && !eff.sure && !eff.flag) { L('But it failed!'); return; }
    if (eff.powder && t.types.includes('grass')) { L(`It doesn't affect ${t.name}...`); return; }
    if (eff.groundImmune && t.types.includes('ground')) { L(`It doesn't affect ${t.name}...`); return; }
    if (!eff.sure && !f.sureHit && move.accuracy && move.accuracy < 101) {
      const chance = move.accuracy * accMult(f.stages.acc - tf.stages.eva);
      if (Math.random() * 100 >= chance) { L('But it missed!'); return; }
    }
    f.sureHit = false;
    if (ctx.field.terrain === 'psychic' && isGrounded(t, ctx.field) && getPriority(move) > 0) { L(`${t.name} is protected by the Psychic Terrain!`); return; }
  }
  if (eff.nothing) { L(eff.nothing); return; }
  if (eff.baton) {
    const allies = (ctx.party?.[A.side] || []).filter((ally) => ally !== m && ally.hp > 0);
    if (!allies.length) { L('But it failed!'); return; }
    f.batonPass = true;
    L(`${m.name} is ready to pass its stat changes!`);
    return;
  }
  if (eff.needs === 'hail' && ctx.field.weather !== 'hail') { L('But it failed!'); return; }
  if (eff.firstTurn && f.protectStreak > 0) { L('But it failed!'); return; }
  if (eff.cost) {
    const cost = Math.floor(m.max_hp * eff.cost);
    if (m.hp <= cost || (eff.maxAtk && f.stages.atk >= 6)) { L('But it failed!'); return; }
    m.hp -= cost;
    L(`${m.name} cut its own HP!`);
  }
  if (eff.call) {
    const called = chooseCalledMove(ctx, A, B, eff.call);
    if (!called || depth > 1) { L('But it failed!'); return; }
    L(`It called **${called.name}**!`);
    performMove(ctx, A, B, called, L, depth + 1);
    return;
  }
  if (eff.protect) { useProtect(ctx, A, eff, L); return; }
  if (eff.maxAtk) { changeStage(ctx, m, A.side, 'atk', 12, L); }
  if (eff.stages) {
    for (const [k, v] of Object.entries(eff.stages)) changeStage(ctx, t, B.side, k, v, L, v < 0);
  }
  if (eff.boost) {
    if (eff.weather === undefined && key === 'growth' && ctx.field.weather === 'sun') {
      for (const k of Object.keys(eff.boost)) changeStage(ctx, m, A.side, k, 2, L);
    } else {
      for (const [k, v] of Object.entries(eff.boost)) { if (v) changeStage(ctx, m, A.side, k, v, L); }
    }
  }
  if (eff.randomBoost) {
    const keys = STAGE_KEYS.filter((k) => f.stages[k] < 6);
    if (keys.length) changeStage(ctx, m, A.side, keys[Math.floor(Math.random() * keys.length)], eff.randomBoost, L);
    else L('But it failed!');
  }
  if (eff.boostFoe) for (const [k, v] of Object.entries(eff.boostFoe)) changeStage(ctx, t, B.side, k, v, L);
  if (eff.drop) {
    if (eff.needsPoison && !(tf.status === 'psn' || tf.status === 'tox')) { L('But it failed!'); }
    else {
      const before = t.hp;
      const attackBefore = baseStat(t, 'atk') * stageMult(tf.stages.atk);
      for (const [k, v] of Object.entries(eff.drop)) changeStage(ctx, t, B.side, k, v, L, true);
      if (eff.sapHeal) healMon(m, attackBefore, L);
      void before;
    }
  }
  if (eff.status) inflictStatus(ctx, t, B.side, eff.status, L, { sourceSide: A.side });
  if (eff.confuse) {
    if (tf.confuse > 0) L(`${t.name} is already confused!`);
    else if (ctx.field.sides[B.side].safeguard > 0) L(`${t.name} is protected by Safeguard!`);
    else if (ctx.field.terrain === 'misty' && isGrounded(t, ctx.field)) L(`${t.name} is protected by the Misty Terrain!`);
    else { tf.confuse = 2 + Math.floor(Math.random() * 4); L(`${t.name} became confused!`); }
  }
  if (eff.leech) {
    if (t.types.includes('grass') || tf.leech) L(tf.leech ? 'But it failed!' : `It doesn't affect ${t.name}...`);
    else { tf.leech = A.side; L(`${t.name} was seeded!`); }
  }
  if (eff.attract) { if (tf.attract) L('But it failed!'); else { tf.attract = true; L(`${t.name} fell in love!`); } }
  if (eff.nightmare) { if (tf.status === 'slp' && !tf.nightmare) { tf.nightmare = true; L(`${t.name} is locked in a nightmare!`); } else L('But it failed!'); }
  if (eff.yawn) { if (tf.status || tf.yawn) L('But it failed!'); else { tf.yawn = 2; L(`${t.name} grew drowsy!`); } }
  if (eff.disable) { if (tf.lastMove) { tf.disabled = slug(tf.lastMove.name); tf.disableTurns = 4; L(`${t.name}'s **${tf.lastMove.name}** was disabled!`); } else L('But it failed!'); }
  if (eff.encore) { if (tf.lastMove) { tf.encore = 3; L(`${t.name} must keep using **${tf.lastMove.name}**!`); } else L('But it failed!'); }
  if (eff.psychoShift) {
    if (f.status && !tf.status && inflictStatus(ctx, t, B.side, f.status, () => {}, { sourceSide: A.side })) { L(`${t.name} received ${m.name}'s status!`); cureStatus(m); }
    else L('But it failed!');
  }
  if (eff.timer) {
    const target = eff.foe ? tf : f;
    const owner = eff.foe ? t : m;
    if (target[eff.timer[0]] > 0) L('But it failed!');
    else { target[eff.timer[0]] = eff.timer[1]; L(`${owner.name} ${eff.text}`); }
  } else if (eff.flag) {
    const target = eff.onFoe ? tf : f;
    const owner = eff.onFoe ? t : m;
    target[eff.flag] = true;
    L(`${owner.name} ${eff.text}`);
    if (eff.boost) { /* charge also boosts Sp. Def below */ }
  }
  if (eff.curse) {
    if (m.types.includes('ghost')) {
      if (tf.cursed) L('But it failed!');
      else { m.hp -= Math.floor(m.max_hp / 2); tf.cursed = true; L(`${m.name} cut its HP and cursed ${t.name}!`); }
    } else {
      changeStage(ctx, m, A.side, 'atk', 1, L); changeStage(ctx, m, A.side, 'def', 1, L); changeStage(ctx, m, A.side, 'spe', -1, L);
    }
  }
  if (eff.perish) {
    if (f.perish || tf.perish) L('But it failed!');
    else { f.perish = 4; tf.perish = 4; L('Both Pokémon will faint in three turns!'); }
  }
  if (eff.selfFaint) { m.hp = 0; }
  if (eff.stockpile) f.stockpile = Math.min(3, (f.stockpile || 0) + 1);
  if (eff.heal) {
    let frac = eff.heal;
    const w = ctx.field.weather;
    if (eff.weather === 'sun') frac = w === 'sun' ? 2 / 3 : (w ? 0.25 : 0.5);
    if (eff.weather === 'sand' && w === 'sand') frac = 2 / 3;
    healMon(m, m.max_hp * frac, L);
  }
  if (eff.healFoe) healMon(t, t.max_hp * eff.healFoe, L);
  if (eff.cure) { const had = cureStatus(m); if (had) L(`${m.name}'s status was cured!`); else if (!eff.boost && !eff.heal) L('But it failed!'); }
  if (eff.purify) {
    if (tf.status) { cureStatus(t); L(`${t.name}'s status was cured!`); healMon(m, m.max_hp / 2, L); } else L('But it failed!');
  }
  if (eff.rest) {
    if (f.status === 'slp' || m.hp >= m.max_hp) L('But it failed!');
    else { m.hp = m.max_hp; cureStatus(m); f.status = 'slp'; f.sleep = 2; L(`${m.name} slept and became healthy!`); }
  }
  if (eff.swallow) {
    const frac = [0, 0.25, 0.5, 1][f.stockpile || 0];
    if (!frac) L('But it failed!');
    else {
      healMon(m, m.max_hp * frac, L);
      f.stages.def -= Math.min(f.stockpile, f.stages.def + 6); f.stages.spdef -= Math.min(f.stockpile, f.stages.spdef + 6);
      f.stockpile = 0;
    }
  }
  if (eff.wish) { const s = ctx.field.sides[A.side]; if (s.wish) L('But it failed!'); else { s.wish = { turns: 2, amount: Math.floor(m.max_hp / 2) }; L(`${m.name} made a wish!`); } }
  if (eff.painSplit) { const avg = Math.floor((m.hp + t.hp) / 2); m.hp = Math.min(m.max_hp, avg); t.hp = Math.min(t.max_hp, avg); L('The battlers shared their pain!'); }
  if (eff.healingWish) { ctx.field.sides[A.side].healingWish = true; m.hp = 0; L(`${m.name} fainted to heal its ally!`); }
  if (eff.revive) {
    const party = ctx.party?.[A.side] || [];
    const fainted = party.find((p) => p.hp <= 0);
    if (fainted) { fainted.hp = Math.max(1, Math.floor(fainted.max_hp / 2)); L(`${fainted.name} was revived!`); } else L('But it failed!');
  }
  if (eff.side) {
    const s = ctx.field.sides[A.side];
    if (s[eff.side] > 0) L('But it failed!');
    else { s[eff.side] = eff.turns; L(`${m.name} set up a ${eff.side.replace(/([A-Z])/g, ' $1').toLowerCase()} for ${eff.turns} turns!`); }
  }
  if (eff.hazard) {
    const s = ctx.field.sides[B.side];
    if (s[eff.hazard] >= eff.max) L('But it failed!');
    else { s[eff.hazard] += 1; L(`Hazards were scattered around ${t.name}'s side!`); }
  }
  if (eff.clearHazards || eff.defog) {
    const sides = eff.defog ? [A.side, B.side] : [A.side, B.side];
    for (const sd of sides) for (const h of ['spikes', 'tspikes', 'rocks', 'web']) ctx.field.sides[sd][h] = 0;
    L('The hazards were cleared away!');
    if (eff.defog) { for (const k of ['reflect', 'lightScreen', 'veil', 'safeguard', 'mist']) ctx.field.sides[B.side][k] = 0; changeStage(ctx, t, B.side, 'eva', -1, L, true); }
  }
  if (eff.courtChange) {
    const { sides } = ctx.field;
    const swap = ['reflect', 'lightScreen', 'veil', 'safeguard', 'mist', 'tailwind', 'luckyChant', 'spikes', 'tspikes', 'rocks', 'web'];
    for (const k of swap) { const tmp = sides.player[k]; sides.player[k] = sides.enemy[k]; sides.enemy[k] = tmp; }
    L('The battle effects swapped sides!');
  }
  if (eff.weather) {
    if (ctx.field.weather === eff.weather) L('But it failed!');
    else {
      ctx.field.weather = eff.weather; ctx.field.weatherTurns = 5;
      L({ rain: 'It started to rain!', sun: 'The sunlight turned harsh!', sand: 'A sandstorm kicked up!', hail: 'It started to hail!' }[eff.weather]);
    }
  }
  if (eff.terrain) {
    if (ctx.field.terrain === eff.terrain) L('But it failed!');
    else { ctx.field.terrain = eff.terrain; ctx.field.terrainTurns = 5; L(`The battlefield became ${eff.terrain === 'psychic' ? 'weird' : eff.terrain}!`); }
  }
  if (eff.room) {
    const field = ctx.field;
    if (eff.room === 'ionDeluge') { field.ionDeluge = true; L('A deluge of ions showers the battlefield!'); }
    else if (eff.room === 'trickRoom' && field.trickRoom > 0) { field.trickRoom = 0; L('The twisted dimensions returned to normal!'); }
    else if (field[eff.room] > 0) L('But it failed!');
    else { field[eff.room] = eff.room === 'waterSport' || eff.room === 'mudSport' ? 5 : 5; L(`The ${eff.room.replace(/([A-Z])/g, ' $1').toLowerCase()} effect began!`); }
  }
  if (eff.haze) {
    for (const mon of [m, t]) for (const k of STAGE_KEYS) fx(mon).stages[k] = 0;
    L('All stat changes were eliminated!');
  }
  if (eff.substitute) {
    const cost = Math.floor(m.max_hp / 4);
    if (f.sub > 0 || m.hp <= cost) L('But it failed!');
    else { m.hp -= cost; f.sub = cost; L(`${m.name} put in a substitute!`); }
  }
  if (eff.topsy) { for (const k of STAGE_KEYS) tf.stages[k] = -tf.stages[k]; L(`${t.name}'s stat changes were reversed!`); }
  if (eff.psychUp) { for (const k of STAGE_KEYS) f.stages[k] = tf.stages[k]; L(`${m.name} copied ${t.name}'s stat changes!`); }
  if (eff.swap) { for (const k of eff.swap) { const tmp = f.stages[k]; f.stages[k] = tf.stages[k]; tf.stages[k] = tmp; } L('The battlers swapped stat changes!'); }
  if (eff.swapStat) { const a = baseStat(m, 'spd'); setBaseStat(m, 'spd', baseStat(t, 'spd')); setBaseStat(t, 'spd', a); L('The battlers swapped Speed!'); }
  if (eff.powerTrick) { const a = baseStat(m, 'atk'); setBaseStat(m, 'atk', baseStat(m, 'def')); setBaseStat(m, 'def', a); L(`${m.name} switched its Attack and Defense!`); }
  if (eff.split) {
    const avg = Math.floor((baseStat(m, eff.split) + baseStat(t, eff.split)) / 2);
    setBaseStat(m, eff.split, avg); setBaseStat(t, eff.split, avg);
    L(`The battlers shared their ${eff.split === 'atk' ? 'power' : 'guard'}!`);
  }
  if (eff.transform) {
    f.original = f.original || { types: [...m.types], moves: m.moves, atk: baseStat(m, 'atk'), def: baseStat(m, 'def'), spd: baseStat(m, 'spd') };
    m.types = [...t.types]; m.moves = (t.moves || []).map((x) => ({ ...x }));
    setBaseStat(m, 'atk', baseStat(t, 'atk')); setBaseStat(m, 'def', baseStat(t, 'def')); setBaseStat(m, 'spd', baseStat(t, 'spd'));
    L(`${m.name} transformed into ${t.name}!`);
  }
  if (eff.mimic) {
    if (tf.lastMove && m.moves?.length) {
      const idx = m.moves.findIndex((x) => slug(x.name) === key);
      m.moves = m.moves.map((x, i) => (i === (idx < 0 ? 0 : idx) ? { ...tf.lastMove } : x));
      L(`${m.name} learned **${tf.lastMove.name}**!`);
      if (key === 'sketch') {
        m.sketchedMove = slug(tf.lastMove.name);
        if (typeof ctx.onSketch === 'function') ctx.onSketch(m, m.sketchedMove);
      }
    } else L('But it failed!');
  }
  if (eff.typeSelf) {
    if (eff.typeSelf === 'normal') m.types = ['normal'];
    else if (eff.typeSelf === 'copy') m.types = [...t.types];
    else if (eff.typeSelf === 'first') { const first = (m.moves || []).find((x) => slug(x.name) !== key); if (first) m.types = [first.type]; }
    else if (eff.typeSelf === 'resist') {
      const last = tf.lastMove;
      const options = last ? Object.keys(ctx.typeChart || {}).filter((ty) => typeEffOf(ctx, last.type, [ty]) < 1) : [];
      if (options.length) m.types = [options[Math.floor(Math.random() * options.length)]];
    }
    L(`${m.name}'s type changed to ${m.types.join('/')}!`);
  }
  if (eff.typeFoe) { t.types = [...eff.typeFoe]; L(`${t.name} became ${t.types.join('/')} type!`); }
  if (eff.addTypeFoe) { if (t.types.includes(eff.addTypeFoe)) L('But it failed!'); else { t.types = [...t.types, eff.addTypeFoe]; L(`${t.name} gained the ${eff.addTypeFoe} type!`); } }
  if (eff.flag === 'charge' || key === 'charge') { /* Sp. Def boost handled via boost block */ }
}

function performMove(ctx, A, B, move, L, depth = 0) {
  if (move.power > 0 && move.category !== 'status') applyDamageMove(ctx, A, B, move, L, depth);
  else applyStatusMove(ctx, A, B, move, L, depth);
}

const BATON_PASSED_FLAGS = ['aquaRing', 'ingrain', 'focus', 'sub', 'magnetRise', 'healBlock', 'embargo', 'perish', 'cursed'];

// Captures what Baton Pass hands over (stat stages plus lingering effects like Aqua Ring) and clears it from the user.
function takeBatonState(mon) {
  const f = fx(mon);
  const state = { stages: { ...f.stages }, flags: {} };
  for (const key of BATON_PASSED_FLAGS) {
    if (f[key]) state.flags[key] = f[key];
  }
  f.batonPass = false;
  for (const key of Object.keys(f.stages)) f.stages[key] = 0;
  for (const key of Object.keys(state.flags)) f[key] = typeof f[key] === 'number' ? 0 : false;
  return state;
}

function giveBatonState(mon, state) {
  const f = fx(mon);
  Object.assign(f.stages, state.stages);
  Object.assign(f, state.flags);
}

// Returns false if the actor is prevented from acting; logs the reason.
function canAct(ctx, A, B, move, L) {
  const m = A.mon; const f = fx(m); const bf = fx(B.mon);
  const slugName = slug(move.name);
  if (f.flinch) { f.flinch = false; L(`${m.name} flinched and couldn't move!`); return false; }
  if (f.recharge) { f.recharge = false; L(`${m.name} must recharge!`); return false; }
  if (m.held_item === ASSAULT_VEST_ITEM && !move.power) {
    L(`${m.name} can't use status moves while holding an Assault Vest!`);
    return false;
  }
  if (f.status === 'slp') {
    f.sleep -= 1;
    if (f.sleep <= 0) { f.status = null; f.nightmare = false; L(`${m.name} woke up!`); }
    else if (slugName !== 'sleep-talk') { L(`${m.name} is fast asleep.`); return false; }
  }
  if (f.status === 'frz') {
    if (Math.random() < 0.2) { f.status = null; L(`${m.name} thawed out!`); } else { L(`${m.name} is frozen solid!`); return false; }
  }
  if (f.status === 'par' && Math.random() < 0.25) { L(`${m.name} is fully paralyzed and can't move!`); return false; }
  if (f.confuse > 0) {
    f.confuse -= 1;
    if (f.confuse <= 0) L(`${m.name} snapped out of its confusion!`);
    else {
      L(`${m.name} is confused!`);
      if (Math.random() < 1 / 3) {
        const hit = ctx.calc({ power: 40, type: '???' }, baseStat(m, 'atk') * stageMult(f.stages.atk), baseStat(m, 'def') * stageMult(f.stages.def), []);
        m.hp -= hit; L(`It hurt itself in its confusion for **${hit}** damage!`);
        return false;
      }
    }
  }
  if (f.attract && Math.random() < 0.5) { L(`${m.name} is immobilized by love!`); return false; }
  if (f.taunt > 0 && !move.power) { L(`${m.name} can't use **${move.name}** after the taunt!`); return false; }
  if (f.torment && f.lastMove && slug(f.lastMove.name) === slugName) { L(`${m.name} can't use the same move twice in a row (Torment)!`); return false; }
  if (f.disabled && f.disabled === slugName && f.disableTurns > 0) { L(`${m.name}'s **${move.name}** is disabled!`); return false; }
  if (bf.imprison && (B.mon.moves || []).some((x) => slug(x.name) === slugName)) { L(`${m.name} can't use the sealed move **${move.name}**!`); return false; }
  return true;
}

function runAction(ctx, A, B, prefix = '') {
  let first = true;
  const L = (text) => { ctx.log.push(`${first ? prefix : '↳ '}${text}`); first = false; };
  const f = fx(A.mon);
  let move = A.move;
  if (f.encore > 0 && f.lastMove) { move = f.lastMove; }
  if (!canAct(ctx, A, B, move, L)) { f.lastMove = move; f.protectStreak = 0; return; }
  const isProtectLike = EFFECTS[slug(move.name)]?.protect;
  if (!isProtectLike) f.protectStreak = 0;
  f.lastMove = move;
  performMove(ctx, A, B, move, L);
}

function endOfTurn(ctx) {
  const L = (text) => ctx.log.push(`↳ ${text}`);
  const { field } = ctx;
  const mons = [{ mon: ctx.player, side: 'player' }, { mon: ctx.enemy, side: 'enemy' }];
  for (const { mon, side } of mons) {
    if (!mon || mon.hp <= 0) continue;
    const f = fx(mon);
    f.protect = false;
    if (field.weather === 'sand' && !mon.types.some((x) => ['rock', 'ground', 'steel'].includes(x))) {
      const d = Math.max(1, Math.floor(mon.max_hp / 16)); mon.hp -= d; L(`${mon.name} is buffeted by the sandstorm for **${d}** damage.`);
    }
    if (field.weather === 'hail' && !mon.types.includes('ice')) {
      const d = Math.max(1, Math.floor(mon.max_hp / 16)); mon.hp -= d; L(`${mon.name} is pelted by hail for **${d}** damage.`);
    }
    if (mon.hp > 0 && field.terrain === 'grassy' && isGrounded(mon, field) && mon.hp < mon.max_hp) healMon(mon, mon.max_hp / 16, L);
    if (mon.hp > 0 && mon.held_item === LEFTOVERS_ITEM && mon.hp < mon.max_hp) {
      healMon(mon, mon.max_hp / 16, L);
    }
    if (mon.hp > 0 && f.status === 'brn') { const d = Math.max(1, Math.floor(mon.max_hp / 16)); mon.hp -= d; L(`${mon.name} was hurt by its burn for **${d}** damage.`); }
    if (mon.hp > 0 && f.status === 'psn') { const d = Math.max(1, Math.floor(mon.max_hp / 8)); mon.hp -= d; L(`${mon.name} was hurt by poison for **${d}** damage.`); }
    if (mon.hp > 0 && f.status === 'tox') { const d = Math.max(1, Math.floor(mon.max_hp * Math.min(15, f.tox) / 16)); f.tox += 1; mon.hp -= d; L(`${mon.name} was badly poisoned for **${d}** damage.`); }
    if (mon.hp > 0 && f.leech) {
      const d = Math.max(1, Math.floor(mon.max_hp / 8)); mon.hp -= d;
      const sapper = f.leech === 'player' ? ctx.player : ctx.enemy;
      L(`Leech Seed sapped **${d}** HP from ${mon.name}.`);
      if (sapper && sapper.hp > 0 && fx(sapper).healBlock <= 0) sapper.hp = Math.min(sapper.max_hp, sapper.hp + d);
    }
    if (mon.hp > 0 && f.cursed) { const d = Math.max(1, Math.floor(mon.max_hp / 4)); mon.hp -= d; L(`${mon.name} is afflicted by the curse for **${d}** damage.`); }
    if (mon.hp > 0 && f.nightmare && f.status === 'slp') { const d = Math.max(1, Math.floor(mon.max_hp / 4)); mon.hp -= d; L(`${mon.name} is locked in a nightmare for **${d}** damage.`); }
    if (mon.hp > 0 && f.octolock) { changeStage(ctx, mon, side, 'def', -1, L); changeStage(ctx, mon, side, 'spdef', -1, L); }
    for (const healingFlag of ['aquaRing', 'ingrain']) {
      if (mon.hp > 0 && f[healingFlag] && mon.hp < mon.max_hp) healMon(mon, mon.max_hp / 16, L);
    }
    if (mon.hp > 0 && f.yawn) { f.yawn -= 1; if (f.yawn <= 0) { f.yawn = 0; inflictStatus(ctx, mon, side, 'slp', L); } }
    if (mon.hp > 0 && f.perish) {
      f.perish -= 1;
      if (f.perish <= 0) { mon.hp = 0; f.perish = 0; L(`${mon.name}'s perish count ran out!`); }
      else L(`${mon.name}'s perish count fell to ${f.perish}!`);
    }
    for (const timer of ['taunt', 'healBlock', 'embargo', 'magnetRise', 'telekinesis', 'encore']) {
      if (f[timer] > 0 && f[timer] < 99) { f[timer] -= 1; if (f[timer] === 0 && timer === 'taunt') L(`${mon.name}'s taunt wore off!`); }
    }
    if (f.disableTurns > 0) { f.disableTurns -= 1; if (f.disableTurns === 0) f.disabled = null; }
    f.magicCoat = false; f.snatch = false; f.quashed = false; f.powdered = false; f.electrified = false;
    f.flinch = false;
    const s = field.sides[side];
    for (const k of ['reflect', 'lightScreen', 'veil', 'safeguard', 'mist', 'tailwind', 'luckyChant']) {
      if (s[k] > 0) { s[k] -= 1; if (s[k] === 0) L(`${side === 'player' ? 'Your' : "The foe's"} ${k.replace(/([A-Z])/g, ' $1').toLowerCase()} wore off.`); }
    }
    if (s.wish) {
      s.wish.turns -= 1;
      if (s.wish.turns <= 0) { const amount = s.wish.amount; s.wish = null; if (mon.hp > 0) { L(`${mon.name}'s wish came true!`); healMon(mon, amount, L); } }
    }
  }
  for (const k of ['trickRoom', 'gravity', 'wonder', 'magic', 'waterSport', 'mudSport']) {
    if (field[k] > 0) { field[k] -= 1; if (field[k] === 0) L(`The ${k.replace(/([A-Z])/g, ' $1').toLowerCase()} effect ended.`); }
  }
  field.ionDeluge = false;
  if (field.weatherTurns > 0) { field.weatherTurns -= 1; if (field.weatherTurns === 0 && field.weather) { L('The weather returned to normal.'); field.weather = null; } }
  if (field.terrainTurns > 0) { field.terrainTurns -= 1; if (field.terrainTurns === 0 && field.terrain) { L('The terrain returned to normal.'); field.terrain = null; } }
}

// ctx: { field, log, calc, typeEff, party:{player:[],enemy:[]}, player, enemy, turn }
function runTurn(ctx, playerMove, enemyMove) {
  const P = { mon: ctx.player, side: 'player', move: playerMove };
  const E = { mon: ctx.enemy, side: 'enemy', move: enemyMove };
  const quashed = (a) => fx(a.mon).quashed;
  const order = [P, E].sort((a, b) => {
    if (quashed(a) !== quashed(b)) return quashed(a) ? 1 : -1;
    const pa = getPriority(a.move); const pb = getPriority(b.move);
    if (pa !== pb) return pb - pa;
    const sa = effectiveSpeed(a.mon, ctx.field, a.side); const sb = effectiveSpeed(b.mon, ctx.field, b.side);
    if (sa === sb) return Math.random() < 0.5 ? -1 : 1;
    return ctx.field.trickRoom > 0 ? sa - sb : sb - sa;
  });
  for (const actor of order) {
    const foe = actor === P ? E : P;
    if (actor.mon.hp <= 0 || foe.mon.hp <= 0) continue;
    runAction(ctx, actor, foe);
  }
  endOfTurn(ctx);
}

function runSwitchTurn(ctx, enemyMove) {
  const player = { mon: ctx.player, side: 'player', move: null };
  const enemy = { mon: ctx.enemy, side: 'enemy', move: enemyMove };
  if (enemy.mon.hp > 0 && player.mon.hp > 0) {
    runAction(ctx, enemy, player);
  }
  endOfTurn(ctx);
}

module.exports = {
  EFFECTS, slug, fx, createField, runTurn, runSwitchTurn, runAction, endOfTurn, onSwitchIn, chooseEnemyMove, buildEnemyMoves, isUseful,
  applyStatusMove, canAct, performMove, effectivePower, stageMult, damageStats, healMon, STAGE_KEYS, STAGE_NAMES,
  DAMAGE_STAT_DROPS, DAMAGE_SELF_BOOSTS, RECHARGE_MOVES, takeBatonState, giveBatonState, cureStatus,
  summarize(mon) {
    const f = fx(mon);
    const parts = [];
    if (f.status) {
      const status = { slp: 'SLP', par: 'PAR', brn: 'BRN', psn: 'PSN', tox: 'TOX', frz: 'FRZ' }[f.status];
      if (status) parts.push(status);
    }
    if (f.confuse > 0) parts.push('CNF');
    if (f.leech) parts.push('SEEDED');
    if (f.sub > 0) parts.push('SUB');
    const stages = STAGE_KEYS.filter((k) => f.stages[k]).map((k) => `${STAGE_NAMES[k]} ${f.stages[k] > 0 ? '+' : ''}${f.stages[k]}`);
    return [...parts, ...stages].join(' · ');
  },
};
