// Adds G-Max learnsets, Eternatus Eternamax Max Moves, and Max moves for Charizard Gmax.
const fs = require('fs');
const path = require('path');

const MOVES_PATH = path.join(__dirname, '..', 'data', 'pokemon-moves.json');
const INFO_PATH = path.join(__dirname, '..', 'data', 'move-info.json');
const CATALOG_PATH = path.join(__dirname, '..', 'data', 'pokemon-catalog.json');
const gmax = require('../pokemon-database/gmax.json');
const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));

// [gmax form slug, move name, type, category, effect description]
const GMAX_MOVES = [
  ['venusaur-gmax', 'G-Max Vine Lash', 'grass', 'physical', 'Damages the foes and continues to damage them for four turns.'],
  ['charizard-gmax', 'G-Max Wildfire', 'fire', 'physical', 'Damages the foes and continues to damage them for four turns.'],
  ['blastoise-gmax', 'G-Max Cannonade', 'water', 'special', 'Damages the foes and continues to damage them for four turns.'],
  ['butterfree-gmax', 'G-Max Befuddle', 'bug', 'special', 'Damages the foes and may poison, paralyze or put them to sleep.'],
  ['pikachu-gmax', 'G-Max Volt Crash', 'electric', 'physical', 'Damages the foes and paralyzes them.'],
  ['meowth-gmax', 'G-Max Gold Rush', 'normal', 'physical', 'Damages the foes, confuses them and scatters coins.'],
  ['machamp-gmax', 'G-Max Chi Strike', 'fighting', 'physical', 'Damages the foes and raises the critical-hit ratio of allies.'],
  ['gengar-gmax', 'G-Max Terror', 'ghost', 'physical', 'Damages the foes and prevents them from escaping.'],
  ['kingler-gmax', 'G-Max Foam Burst', 'water', 'physical', 'Damages the foes and harshly lowers their Speed.'],
  ['lapras-gmax', 'G-Max Resonance', 'ice', 'special', 'Damages the foes and sets up Aurora Veil.'],
  ['eevee-gmax', 'G-Max Cuddle', 'normal', 'physical', 'Damages the foes and infatuates them.'],
  ['snorlax-gmax', 'G-Max Replenish', 'normal', 'physical', 'Damages the foes and may restore consumed Berries.'],
  ['garbodor-gmax', 'G-Max Malodor', 'poison', 'physical', 'Damages the foes and poisons them.'],
  ['melmetal-gmax', 'G-Max Meltdown', 'steel', 'physical', 'Damages the foes and prevents them from using the same move twice in a row.'],
  ['rillaboom-gmax', 'G-Max Drum Solo', 'grass', 'physical', 'Damages the foes, ignoring their Abilities.'],
  ['cinderace-gmax', 'G-Max Fireball', 'fire', 'physical', 'Damages the foes, ignoring their Abilities.'],
  ['inteleon-gmax', 'G-Max Hydrosnipe', 'water', 'special', 'Damages the foes, ignoring their Abilities.'],
  ['corviknight-gmax', 'G-Max Wind Rage', 'flying', 'physical', 'Damages the foes and blows away hazards and terrain.'],
  ['orbeetle-gmax', 'G-Max Gravitas', 'psychic', 'special', 'Damages the foes and intensifies gravity.'],
  ['drednaw-gmax', 'G-Max Stonesurge', 'water', 'physical', 'Damages the foes and scatters sharp stones.'],
  ['coalossal-gmax', 'G-Max Volcalith', 'rock', 'physical', 'Damages the foes and continues to damage them for four turns.'],
  ['flapple-gmax', 'G-Max Tartness', 'grass', 'physical', 'Damages the foes and may lower their evasiveness.'],
  ['appletun-gmax', 'G-Max Sweetness', 'grass', 'special', 'Damages the foes and cures the status conditions of allies.'],
  ['sandaconda-gmax', 'G-Max Sandblast', 'ground', 'physical', 'Damages the foes and traps them in a sandstorm for four to five turns.'],
  ['toxtricity-amped-gmax', 'G-Max Stun Shock', 'electric', 'special', 'Damages the foes and may poison or paralyze them.'],
  ['toxtricity-low-key-gmax', 'G-Max Stun Shock', 'electric', 'special', 'Damages the foes and may poison or paralyze them.'],
  ['centiskorch-gmax', 'G-Max Centiferno', 'fire', 'physical', 'Damages the foes and traps them in flames for four to five turns.'],
  ['hatterene-gmax', 'G-Max Smite', 'fairy', 'special', 'Damages the foes and confuses them.'],
  ['grimmsnarl-gmax', 'G-Max Snooze', 'dark', 'physical', 'Damages the foes and may make them drowsy.'],
  ['alcremie-gmax', 'G-Max Finale', 'fairy', 'special', 'Damages the foes and heals allies.'],
  ['copperajah-gmax', 'G-Max Steelsurge', 'steel', 'physical', 'Damages the foes and scatters sharp steel spikes.'],
  ['duraludon-gmax', 'G-Max Depletion', 'dragon', 'special', 'Damages the foes and reduces the PP of their last move.'],
  ['urshifu-single-strike-gmax', 'G-Max One Blow', 'dark', 'physical', 'Damages the foes and bypasses Max Guard.'],
  ['urshifu-rapid-strike-gmax', 'G-Max Rapid Flow', 'water', 'physical', 'Damages the foes and bypasses Max Guard.'],
];

const toSlug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const titleCase = (value) => value.charAt(0).toUpperCase() + value.slice(1);

const movesData = JSON.parse(fs.readFileSync(MOVES_PATH, 'utf8'));
const moveInfo = JSON.parse(fs.readFileSync(INFO_PATH, 'utf8'));
movesData.form_learnsets ||= {};

for (const [formSlug, name, type, category, description] of GMAX_MOVES) {
  const form = gmax.find((entry) => entry.slug === formSlug);
  if (!form) throw new Error(`Unknown Gigantamax form: ${formSlug}`);
  const catalogForm = catalog.find((entry) => entry.slug === formSlug);
  if (!catalogForm) throw new Error(`Missing catalog form for Gigantamax Pokémon: ${formSlug}`);
  const moveSlug = toSlug(name);

  movesData.moves[moveSlug] = { name, type, power: 150, accuracy: 100, pp: 5, category };
  const learners = moveInfo[moveSlug]?.learners || [];
  for (const learner of [form.species_name, form.name]) {
    if (!learners.includes(learner)) learners.push(learner);
  }
  moveInfo[moveSlug] = {
    name,
    type: titleCase(type),
    power: 150,
    accuracy: 100,
    pp: 5,
    priority: 0,
    damageClass: titleCase(category),
    description: `${name} is exclusive to Gigantamax ${form.species_name}. ${description}`,
    learners,
    source: 'serebii',
  };

  // Gigantamax forms start from their species learnset; the G-Max move is added to this form only.
  const current = movesData.form_learnsets[String(catalogForm.id)]
    || movesData.learnsets[String(form.species_id)] || [];
  movesData.form_learnsets[String(catalogForm.id)] = [...new Set([...current, moveSlug])];
  movesData.learnsets[String(form.species_id)] = [
    ...new Set([...(movesData.learnsets[String(form.species_id)] || []), moveSlug]),
  ];
}

const eternamaxForm = catalog.find((pokemon) => pokemon.slug === 'eternatus-eternamax');
if (!eternamaxForm) throw new Error('Missing Eternatus Eternamax form in the Pokémon catalog.');
const charizardGmaxForm = catalog.find((pokemon) => pokemon.slug === 'charizard-gmax');
if (!charizardGmaxForm) throw new Error('Missing Charizard Gigantamax form in the Pokémon catalog.');
const maxMoves = Object.entries(moveInfo)
  .filter(([moveSlug]) => moveSlug.startsWith('max-') && moveSlug !== 'max-guard');
const eternamaxLearnset = movesData.form_learnsets[String(eternamaxForm.id)]
  || movesData.learnsets[String(eternamaxForm.species_id)]
  || [];
for (const [moveSlug, move] of maxMoves) {
  movesData.moves[moveSlug] = {
    name: move.name,
    type: move.type.toLowerCase(),
    power: Math.max(100, move.power || 0),
    accuracy: move.accuracy ?? 100,
    pp: move.pp ?? 10,
    category: move.damageClass.toLowerCase(),
  };
  const learners = move.learners || [];
  if (!learners.includes(eternamaxForm.name)) learners.push(eternamaxForm.name);
  move.learners = learners;
}
movesData.form_learnsets[String(eternamaxForm.id)] = [
  ...new Set([...eternamaxLearnset, ...maxMoves.map(([moveSlug]) => moveSlug)]),
];

let charizardGmaxLearnset = movesData.form_learnsets[String(charizardGmaxForm.id)]
  || movesData.learnsets[String(charizardGmaxForm.species_id)]
  || [];
for (const moveSlug of ['max-quake', 'max-flare']) {
  if (!moveInfo[moveSlug]) throw new Error(`Missing move info for ${moveSlug}.`);
  charizardGmaxLearnset = [...new Set([...charizardGmaxLearnset, moveSlug])];
  movesData.form_learnsets[String(charizardGmaxForm.id)] = charizardGmaxLearnset;
  if (!moveInfo[moveSlug].learners.includes(charizardGmaxForm.name)) {
    moveInfo[moveSlug].learners.push(charizardGmaxForm.name);
  }
}

fs.writeFileSync(MOVES_PATH, `${JSON.stringify(movesData)}\n`);
fs.writeFileSync(INFO_PATH, JSON.stringify(moveInfo));
console.log(
  `Added ${GMAX_MOVES.length} G-Max moves, ${maxMoves.length} Max moves to Eternatus Eternamax, ` +
  'and Max Quake/Max Flare to Charizard Gmax.'
);
