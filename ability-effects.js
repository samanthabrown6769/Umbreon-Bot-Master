// Battle abilities. Every hook takes `h`, the helper bag supplied by battle-effects.js
// ({ changeStage, inflictStatus, healMon, cureStatus, fx }), so this file has no circular dependency.
// Only Pokémon with a resolved `mon.ability` (the ability name) are affected.

const abilitySlug = (name) => String(name || '').toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const keyOf = (mon) => abilitySlug(mon && mon.ability);
const has = (mon, ...names) => !!mon && names.includes(keyOf(mon));
const moveSlug = (move) => abilitySlug(move && move.name);
const frac = (mon) => mon.hp / Math.max(1, mon.max_hp);
const breaksAbility = (mon) => has(mon, 'mold-breaker', 'teravolt', 'turboblaze');
// The defender's ability as seen by an attacker; Mold Breaker style abilities ignore it.
const defenderKey = (attacker, defender) => (breaksAbility(attacker) ? '' : keyOf(defender));
const tag = (mon) => `✨ **${mon.name}'s ${mon.ability}**`;

const PUNCH_RE = /punch|^(hammer-arm|plasma-fists|sky-uppercut|meteor-mash|ice-hammer|surging-strikes|wicked-blow|double-iron-bash)$/;
const BITE_RE = /bite|fang|^(crunch|jaw-lock|fishious-rend)$/;
const PULSE_RE = /pulse|^(aura-sphere)$/;
const BALL_RE = /ball|bomb|^(barrage|zap-cannon|octazooka|rock-wrecker|pollen-puff|focus-blast|acid-spray|magnet-bomb)$/;
const SLASH = new Set(['cut', 'slash', 'night-slash', 'psycho-cut', 'leaf-blade', 'x-scissor', 'cross-poison', 'air-slash', 'aerial-ace',
  'sacred-sword', 'razor-shell', 'fury-cutter', 'solar-blade', 'stone-axe', 'ceaseless-edge', 'kowtow-cleave', 'behemoth-blade',
  'tachyon-cutter', 'razor-leaf', 'air-cutter', 'secret-sword', 'population-bomb']);
const SOUND = new Set(['hyper-voice', 'boomburst', 'bug-buzz', 'chatter', 'round', 'echoed-voice', 'sing', 'screech', 'supersonic',
  'growl', 'roar', 'snarl', 'uproar', 'relic-song', 'sparkling-aria', 'snore', 'disarming-voice', 'noble-roar', 'parting-shot',
  'perish-song', 'metal-sound', 'grass-whistle', 'clanging-scales', 'clangorous-soul', 'confide', 'overdrive', 'eerie-spell',
  'torch-song', 'alluring-voice', 'psychic-noise', 'howl', 'heal-bell', 'screech', 'shadow-panic']);
const RECOIL = new Set(['double-edge', 'brave-bird', 'flare-blitz', 'take-down', 'submission', 'wood-hammer', 'head-smash',
  'wild-charge', 'volt-tackle', 'head-charge', 'light-of-ruin', 'struggle', 'wave-crash', 'high-jump-kick', 'jump-kick']);
const NON_CONTACT = new Set(['earthquake', 'rock-slide', 'rock-blast', 'bulldoze', 'magnitude', 'stone-edge', 'razor-leaf', 'magical-leaf',
  'pin-missile', 'spike-cannon', 'bone-rush', 'bonemerang', 'icicle-spear', 'icicle-crash', 'rock-throw', 'rock-tomb', 'smack-down',
  'seed-bomb', 'egg-bomb', 'gunk-shot', 'poison-sting', 'twineedle', 'barrage', 'thousand-arrows', 'thousand-waves', 'fissure',
  'explosion', 'self-destruct', 'lands-wrath', 'precipice-blades', 'fling', 'bullet-seed', 'pay-day', 'present', 'x-scissor-',
  'sand-tomb', 'fire-spin', 'whirlpool', 'magma-storm', 'infestation', 'snap-trap', 'steel-beam', 'spirit-shackle', 'shadow-bone',
  'bone-club', 'dragon-darts', 'ice-shard', 'thunder-cage', 'secret-power', 'dual-wingbeat-']);

function isContactMove(move) {
  if (!move || !(move.power > 0) || move.category === 'special') return false;
  const s = moveSlug(move);
  return !NON_CONTACT.has(s) && !/wave|beam|ball|bomb|blast|shot|cannon/.test(s);
}

const activeWeather = (field) => (field.suppressWeather ? null : field.weather);

function updateWeatherSuppression(ctx) {
  ctx.field.suppressWeather = [ctx.player, ctx.enemy].some((m) => m && m.hp > 0 && has(m, 'cloud-nine', 'air-lock'));
}

function setWeather(ctx, mon, weather, L) {
  if (ctx.field.weather === weather) return;
  ctx.field.weather = weather;
  ctx.field.weatherTurns = weather === 'rain' && mon.held_item === 'Damp Rock' ? 8 : 5;
  L({ rain: 'It started to rain!', sun: 'The sunlight turned harsh!', sand: 'A sandstorm kicked up!', hail: 'It started to hail!' }[weather]);
  updateWeatherSuppression(ctx);
}

function setTerrain(ctx, terrain, L) {
  if (ctx.field.terrain === terrain) return;
  ctx.field.terrain = terrain;
  ctx.field.terrainTurns = 5;
  L(`The battlefield became ${terrain === 'psychic' ? 'weird' : terrain}!`);
}

const WEATHER_SETTERS = { drizzle: 'rain', drought: 'sun', 'sand-stream': 'sand', 'snow-warning': 'hail' };
const TERRAIN_SETTERS = { 'electric-surge': 'electric', 'grassy-surge': 'grassy', 'misty-surge': 'misty', 'psychic-surge': 'psychic' };
const INTIMIDATE_BLOCKERS = ['clear-body', 'white-smoke', 'full-metal-body', 'hyper-cutter', 'inner-focus', 'oblivious', 'own-tempo', 'scrappy'];

// Runs when a Pokémon enters the field.
function entry(h, ctx, A, B, L) {
  const m = A.mon; const foe = B && B.mon;
  const a = keyOf(m);
  if (!a || m.hp <= 0) return;
  updateWeatherSuppression(ctx);
  if (WEATHER_SETTERS[a]) { L(tag(m)); setWeather(ctx, m, WEATHER_SETTERS[a], L); return; }
  if (TERRAIN_SETTERS[a]) { L(tag(m)); setTerrain(ctx, TERRAIN_SETTERS[a], L); return; }
  if (a === 'intimidate' && foe && foe.hp > 0) {
    L(tag(m));
    if (INTIMIDATE_BLOCKERS.includes(keyOf(foe))) L(`${foe.name}'s **${foe.ability}** prevents the Attack drop!`);
    else h.changeStage(ctx, foe, B.side, 'atk', -1, L, true);
  } else if (a === 'intrepid-sword') { L(tag(m)); h.changeStage(ctx, m, A.side, 'atk', 1, L); }
  else if (a === 'dauntless-shield') { L(tag(m)); h.changeStage(ctx, m, A.side, 'def', 1, L); }
  else if (a === 'download') { L(tag(m)); h.changeStage(ctx, m, A.side, 'atk', 1, L); }
  else if (a === 'cloud-nine' || a === 'air-lock') L(`${tag(m)} — the effects of weather disappeared.`);
}

// Stat changes: Simple / Contrary scaling and drop-blocking abilities.
function adjustStageDelta(mon, delta) {
  if (has(mon, 'simple')) return delta * 2;
  if (has(mon, 'contrary')) return -delta;
  return delta;
}

function blocksStatDrop(mon, key) {
  return has(mon, 'clear-body', 'white-smoke', 'full-metal-body')
    || (key === 'atk' && has(mon, 'hyper-cutter'))
    || (key === 'acc' && has(mon, 'keen-eye'))
    || (key === 'def' && has(mon, 'big-pecks'));
}

function onStatDropped(h, ctx, mon, side, L) {
  if (has(mon, 'defiant')) { L(tag(mon)); h.changeStage(ctx, mon, side, 'atk', 2, L); }
  else if (has(mon, 'competitive')) { L(tag(mon)); h.changeStage(ctx, mon, side, 'spa', 2, L); }
}

function speedMultiplier(mon, field) {
  const a = keyOf(mon);
  if (!a) return 1;
  const w = activeWeather(field);
  if (a === 'swift-swim' && w === 'rain') return 2;
  if (a === 'chlorophyll' && w === 'sun') return 2;
  if (a === 'sand-rush' && w === 'sand') return 2;
  if (a === 'slush-rush' && w === 'hail') return 2;
  if (a === 'surge-surfer' && field.terrain === 'electric') return 2;
  if (a === 'quick-feet' && mon.fx && mon.fx.status) return 1.5;
  return 1;
}

// Returns text if the ability makes the status impossible.
function statusBlocked(ctx, mon, status, source) {
  const a = keyOf(mon);
  if (!a || breaksAbility(source)) return null;
  const poison = status === 'psn' || status === 'tox';
  const blocked = a === 'purifying-salt'
    || (a === 'leaf-guard' && activeWeather(ctx.field) === 'sun')
    || (poison && ['immunity', 'pastel-veil'].includes(a))
    || (status === 'par' && a === 'limber')
    || (status === 'slp' && ['insomnia', 'vital-spirit', 'sweet-veil'].includes(a))
    || (status === 'brn' && ['water-veil', 'thermal-exchange', 'water-bubble'].includes(a))
    || (status === 'frz' && a === 'magma-armor');
  return blocked ? `${mon.name}'s **${mon.ability}** prevents the status!` : null;
}

function onStatusInflicted(h, ctx, mon, status, side, sourceMon, sourceSide) {
  if (!sourceMon || sourceSide === side || !has(mon, 'synchronize')) return;
  if (!['par', 'brn', 'psn', 'tox'].includes(status) || sourceMon.hp <= 0) return;
  h.inflictStatus(ctx, sourceMon, sourceSide, status === 'tox' ? 'psn' : status, () => {}, { quiet: true });
}

function priorityFor(mon, move, base) {
  const a = keyOf(mon);
  if (a === 'prankster' && !(move.power > 0)) return base + 1;
  if (a === 'gale-wings' && move.type === 'flying' && mon.hp === mon.max_hp) return base + 1;
  return base;
}

function accuracyMultiplier(attacker, defender, move, field) {
  let mult = 1;
  const a = keyOf(attacker);
  if (a === 'compound-eyes') mult *= 1.3;
  if (a === 'hustle' && move.category !== 'special') mult *= 0.8;
  const d = defenderKey(attacker, defender);
  const w = activeWeather(field);
  if (d === 'sand-veil' && w === 'sand') mult *= 0.8;
  if (d === 'snow-cloak' && w === 'hail') mult *= 0.8;
  if (d === 'tangled-feet' && defender.fx && defender.fx.confuse > 0) mult *= 0.5;
  return mult;
}

const alwaysHits = (attacker, defender) => has(attacker, 'no-guard') || has(defender, 'no-guard');

// Ability-driven move type changes. Returns { type, boost }.
function adjustMoveType(mon, move, type) {
  const a = keyOf(mon);
  if (a === 'normalize') return { type: 'normal', boost: type === 'normal' ? 1 : 1.2 };
  if (type === 'normal') {
    const to = { aerilate: 'flying', pixilate: 'fairy', refrigerate: 'ice', galvanize: 'electric' }[a];
    if (to) return { type: to, boost: 1.2 };
  }
  if (a === 'liquid-voice' && SOUND.has(moveSlug(move))) return { type: 'water', boost: 1 };
  return { type, boost: 1 };
}

// Immunity / absorb abilities. Returns true when the move is fully negated.
function absorb(h, ctx, A, B, move, type, eff, L) {
  const m = A.mon; const t = B.mon;
  const d = defenderKey(m, t);
  if (!d) return false;
  const tf = h.fx(t);
  const ms = moveSlug(move);
  const done = (effect) => {
    L(`${m.name} used **${move.name}**, but ${t.name}'s **${t.ability}** made it useless!`);
    if (effect) effect();
    return true;
  };
  const heal = () => h.healMon(t, t.max_hp / 4, L);
  const boost = (key, n) => h.changeStage(ctx, t, B.side, key, n, L);
  if (d === 'levitate' && type === 'ground' && ctx.field.gravity <= 0) return done();
  if (d === 'flash-fire' && type === 'fire') return done(() => { tf.flashFire = true; });
  if ((d === 'water-absorb' || d === 'dry-skin') && type === 'water') return done(heal);
  if (d === 'storm-drain' && type === 'water') return done(() => boost('spa', 1));
  if (d === 'volt-absorb' && type === 'electric') return done(heal);
  if (d === 'lightning-rod' && type === 'electric') return done(() => boost('spa', 1));
  if (d === 'motor-drive' && type === 'electric') return done(() => boost('spe', 1));
  if (d === 'sap-sipper' && type === 'grass') return done(() => boost('atk', 1));
  if (d === 'earth-eater' && type === 'ground') return done(heal);
  if (d === 'well-baked-body' && type === 'fire') return done(() => boost('def', 2));
  if (d === 'soundproof' && SOUND.has(ms)) return done();
  if (d === 'bulletproof' && BALL_RE.test(ms)) return done();
  if (d === 'wonder-guard' && eff <= 1 && ms !== 'struggle') return done();
  return false;
}

// Combined attacker + defender ability damage multiplier.
function damageMultiplier(ctx, A, B, move, { type, eff = 1, physical = true, crit = false, typeBoost = 1 }) {
  const m = A.mon; const t = B.mon;
  const a = keyOf(m);
  const d = defenderKey(m, t);
  if (!a && !d && typeBoost === 1) return 1;
  const mf = m.fx || {}; const tf = t.fx || {};
  const w = activeWeather(ctx.field);
  const ms = moveSlug(move);
  const power = move.power || 0;
  const low = frac(m) <= 1 / 3;
  const stab = (m.types || []).includes(type);
  const contact = isContactMove(move) && a !== 'long-reach';
  const status = mf.status;
  let mult = typeBoost;
  if (a) {
    if (physical && (a === 'huge-power' || a === 'pure-power')) mult *= 2;
    if (physical && (a === 'hustle' || a === 'gorilla-tactics')) mult *= 1.5;
    if (physical && a === 'guts' && status) mult *= 1.5;
    if (a === 'technician' && power <= 60) mult *= 1.5;
    if (a === 'adaptability' && stab) mult *= 2 / 1.5;
    if ((a === 'blaze' && type === 'fire' && low) || (a === 'overgrow' && type === 'grass' && low)
        || (a === 'torrent' && type === 'water' && low) || (a === 'swarm' && type === 'bug' && low)) mult *= 1.5;
    if (a === 'iron-fist' && PUNCH_RE.test(ms)) mult *= 1.2;
    if (a === 'strong-jaw' && BITE_RE.test(ms)) mult *= 1.5;
    if (a === 'tough-claws' && contact) mult *= 1.3;
    if (a === 'reckless' && RECOIL.has(ms)) mult *= 1.2;
    if (a === 'sharpness' && SLASH.has(ms)) mult *= 1.5;
    if (a === 'mega-launcher' && PULSE_RE.test(ms)) mult *= 1.5;
    if (a === 'punk-rock' && SOUND.has(ms)) mult *= 1.3;
    if (a === 'sand-force' && w === 'sand' && ['rock', 'ground', 'steel'].includes(type)) mult *= 1.3;
    if (a === 'tinted-lens' && eff < 1) mult *= 2;
    if (a === 'neuroforce' && eff > 1) mult *= 1.25;
    if (a === 'sniper' && crit) mult *= 1.5;
    if (a === 'steelworker' && type === 'steel') mult *= 1.5;
    if (a === 'water-bubble' && type === 'water') mult *= 2;
    if (a === 'transistor' && type === 'electric') mult *= 1.5;
    if (a === 'dragons-maw' && type === 'dragon') mult *= 1.5;
    if (a === 'rocky-payload' && type === 'rock') mult *= 1.5;
    if (a === 'flare-boost' && !physical && status === 'brn') mult *= 1.5;
    if (a === 'toxic-boost' && physical && (status === 'psn' || status === 'tox')) mult *= 1.5;
    if (a === 'solar-power' && !physical && w === 'sun') mult *= 1.5;
    if (a === 'defeatist' && frac(m) <= 0.5) mult *= 0.5;
    if (mf.flashFire && type === 'fire') mult *= 1.5;
  }
  if (d) {
    if (d === 'thick-fat' && (type === 'fire' || type === 'ice')) mult *= 0.5;
    if ((d === 'heatproof' || d === 'water-bubble') && type === 'fire') mult *= 0.5;
    if (d === 'fur-coat' && physical) mult *= 0.5;
    if (d === 'ice-scales' && !physical) mult *= 0.5;
    if ((d === 'multiscale' || d === 'shadow-shield') && t.hp === t.max_hp) mult *= 0.5;
    if ((d === 'solid-rock' || d === 'filter' || d === 'prism-armor') && eff > 1) mult *= 0.75;
    if (d === 'fluffy') { if (contact) mult *= 0.5; if (type === 'fire') mult *= 2; }
    if (d === 'dry-skin' && type === 'fire') mult *= 1.25;
    if (d === 'marvel-scale' && physical && tf.status) mult /= 1.5;
    if (d === 'punk-rock' && SOUND.has(ms)) mult *= 0.5;
    if (d === 'purifying-salt' && type === 'ghost') mult *= 0.5;
    if (d === 'grass-pelt' && physical && ctx.field.terrain === 'grassy') mult /= 1.5;
  }
  return mult;
}

// Which Pokémon types the attacker can hit despite normal immunities (Scrappy).
function adjustDefenderTypes(attacker, type, types) {
  if (has(attacker, 'scrappy') && (type === 'normal' || type === 'fighting')) return types.filter((x) => x !== 'ghost');
  return types;
}

function critChance(attacker, defender, base) {
  if (!breaksAbility(attacker) && has(defender, 'battle-armor', 'shell-armor')) return 0;
  return has(attacker, 'super-luck') ? Math.max(base, 0.125) : base;
}

function multiHitCount(mon, count) {
  return count > 1 && has(mon, 'skill-link') ? 5 : count;
}

function survivesLethal(attacker, defender, hpBefore) {
  return has(defender, 'sturdy') && !breaksAbility(attacker) && hpBefore === defender.max_hp;
}

// Does the holder ignore indirect damage (hazards, weather, status, recoil)?
const ignoresIndirect = (mon) => has(mon, 'magic-guard');
const ignoresWeatherDamage = (mon, weather) => has(mon, 'magic-guard', 'overcoat')
  || (weather === 'sand' && has(mon, 'sand-veil', 'sand-rush', 'sand-force'))
  || (weather === 'hail' && has(mon, 'ice-body', 'snow-cloak', 'slush-rush'));

// Reactions after a damaging hit connected.
function afterHit(h, ctx, A, B, move, dmg, { type, crit = false }, L) {
  const m = A.mon; const t = B.mon;
  if (!(dmg > 0)) return;
  const a = keyOf(m); const d = defenderKey(m, t);
  const contact = isContactMove(move) && a !== 'long-reach';
  const physical = move.category !== 'special';
  const chance = () => Math.random() < 0.3;
  const hurt = (mon, amount) => { mon.hp -= amount; };
  if (d) {
    if (contact && m.hp > 0) {
      if (d === 'static' && chance()) { L(tag(t)); h.inflictStatus(ctx, m, A.side, 'par', L, { sourceSide: B.side }); }
      else if (d === 'poison-point' && chance()) { L(tag(t)); h.inflictStatus(ctx, m, A.side, 'psn', L, { sourceSide: B.side }); }
      else if (d === 'flame-body' && chance()) { L(tag(t)); h.inflictStatus(ctx, m, A.side, 'brn', L, { sourceSide: B.side }); }
      else if (d === 'effect-spore' && chance() && !(m.types || []).includes('grass') && !has(m, 'overcoat')) {
        L(tag(t));
        h.inflictStatus(ctx, m, A.side, ['par', 'psn', 'slp'][Math.floor(Math.random() * 3)], L, { sourceSide: B.side });
      } else if ((d === 'rough-skin' || d === 'iron-barbs') && !ignoresIndirect(m)) {
        const amount = Math.max(1, Math.floor(m.max_hp / 8));
        hurt(m, amount);
        L(`${tag(t)} hurt ${m.name} for **${amount}** damage!`);
      } else if ((d === 'gooey' || d === 'tangling-hair')) { L(tag(t)); h.changeStage(ctx, m, A.side, 'spe', -1, L, true); }
    }
    if (t.hp > 0) {
      if (d === 'weak-armor' && physical) { L(tag(t)); h.changeStage(ctx, t, B.side, 'def', -1, L); h.changeStage(ctx, t, B.side, 'spe', 2, L); }
      else if (d === 'stamina') { L(tag(t)); h.changeStage(ctx, t, B.side, 'def', 1, L); }
      else if (d === 'justified' && type === 'dark') { L(tag(t)); h.changeStage(ctx, t, B.side, 'atk', 1, L); }
      else if (d === 'rattled' && ['bug', 'ghost', 'dark'].includes(type)) { L(tag(t)); h.changeStage(ctx, t, B.side, 'spe', 1, L); }
      else if (d === 'water-compaction' && type === 'water') { L(tag(t)); h.changeStage(ctx, t, B.side, 'def', 2, L); }
      else if (d === 'anger-point' && crit) {
        const tf = h.fx(t);
        tf.stages.atk = 6;
        L(`${tag(t)} — its Attack maxed out!`);
      } else if (d === 'sand-spit') { L(tag(t)); setWeather(ctx, t, 'sand', L); }
    } else if (d === 'aftermath' && contact && m.hp > 0 && !ignoresIndirect(m)) {
      const amount = Math.max(1, Math.floor(m.max_hp / 4));
      hurt(m, amount);
      L(`${tag(t)} hurt ${m.name} for **${amount}** damage!`);
    }
  }
  if (a) {
    if (a === 'poison-touch' && contact && t.hp > 0 && chance()) h.inflictStatus(ctx, t, B.side, 'psn', L, { sourceSide: A.side });
    if (t.hp <= 0 && m.hp > 0) {
      if (a === 'moxie' || a === 'chilling-neigh' || a === 'beast-boost') { L(tag(m)); h.changeStage(ctx, m, A.side, 'atk', 1, L); }
      else if (a === 'grim-neigh') { L(tag(m)); h.changeStage(ctx, m, A.side, 'spa', 1, L); }
    }
  }
}

const blocksSecondaryEffects = (attacker, defender) => !breaksAbility(attacker) && has(defender, 'shield-dust');

function blocksConfusion(attacker, mon) {
  return !breaksAbility(attacker) && has(mon, 'own-tempo');
}

function blocksAttract(attacker, mon) {
  return !breaksAbility(attacker) && has(mon, 'oblivious', 'own-tempo');
}

// Flinch handling: Inner Focus ignores it, Steadfast turns it into a Speed boost.
function onFlinch(h, ctx, mon, side, L) {
  if (has(mon, 'inner-focus')) { L(`${tag(mon)} — it won't flinch!`); return false; }
  if (has(mon, 'steadfast')) h.changeStage(ctx, mon, side, 'spe', 1, L);
  return true;
}

// Truant: the holder loafs every other turn. Returns true if it loafs this turn.
function truantLoafs(mon, L) {
  if (!has(mon, 'truant')) return false;
  const f = mon.fx;
  if (f.truantLoaf) { f.truantLoaf = false; L(`${mon.name} is loafing around!`); return true; }
  f.truantLoaf = true;
  return false;
}

// End-of-turn effects. Returns true if the ability replaced normal poison damage (Poison Heal).
function endTurn(h, ctx, mon, side, foe, L) {
  const a = keyOf(mon);
  if (!a || mon.hp <= 0) return;
  const f = h.fx(mon);
  const w = activeWeather(ctx.field);
  const chip = (n) => {
    if (ignoresIndirect(mon)) return;
    const amount = Math.max(1, Math.floor(mon.max_hp / n));
    mon.hp -= amount;
    L(`${tag(mon)} hurt it for **${amount}** damage!`);
  };
  if (a === 'speed-boost' && f.stages.spe < 6) { L(tag(mon)); h.changeStage(ctx, mon, side, 'spe', 1, L); }
  else if (a === 'moody') {
    const up = ['atk', 'def', 'spa', 'spdef', 'spe'].filter((k) => f.stages[k] < 6);
    if (up.length) { const k = up[Math.floor(Math.random() * up.length)]; L(tag(mon)); h.changeStage(ctx, mon, side, k, 2, L); }
    const down = ['atk', 'def', 'spa', 'spdef', 'spe'].filter((k) => f.stages[k] > -6);
    if (down.length) h.changeStage(ctx, mon, side, down[Math.floor(Math.random() * down.length)], -1, L);
  } else if (a === 'rain-dish' && w === 'rain' && mon.hp < mon.max_hp) h.healMon(mon, mon.max_hp / 16, L);
  else if (a === 'ice-body' && w === 'hail' && mon.hp < mon.max_hp) h.healMon(mon, mon.max_hp / 16, L);
  else if (a === 'dry-skin') {
    if (w === 'rain' && mon.hp < mon.max_hp) h.healMon(mon, mon.max_hp / 8, L);
    else if (w === 'sun') chip(8);
  } else if (a === 'solar-power' && w === 'sun') chip(8);
  else if (a === 'shed-skin' && f.status && Math.random() < 1 / 3) { L(`${tag(mon)} cured its status!`); h.cureStatus(mon); }
  else if (a === 'hydration' && w === 'rain' && f.status) { L(`${tag(mon)} cured its status!`); h.cureStatus(mon); }
  else if (a === 'bad-dreams' && foe && foe.hp > 0 && h.fx(foe).status === 'slp' && !ignoresIndirect(foe)) {
    const amount = Math.max(1, Math.floor(foe.max_hp / 8));
    foe.hp -= amount;
    L(`${tag(mon)} hurt ${foe.name} for **${amount}** damage!`);
  }
}

module.exports = {
  abilitySlug, keyOf, has, breaksAbility, isContactMove, activeWeather, updateWeatherSuppression,
  entry, adjustStageDelta, blocksStatDrop, onStatDropped, speedMultiplier, statusBlocked, onStatusInflicted,
  priorityFor, accuracyMultiplier, alwaysHits, adjustMoveType, absorb, damageMultiplier, adjustDefenderTypes,
  critChance, multiHitCount, survivesLethal, ignoresIndirect, ignoresWeatherDamage, afterHit,
  blocksSecondaryEffects, blocksConfusion, blocksAttract, onFlinch, truantLoafs, endTurn,
};
