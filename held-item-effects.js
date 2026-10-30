const { RESEARCH_HOLDABLE_ITEM_NAMES } = require('./research-data');

const TYPE_BOOSTING_HELD_ITEMS = Object.freeze({
  'Black Belt': 'fighting',
  'Black Glasses': 'dark',
  Charcoal: 'fire',
  'Dragon Fang': 'dragon',
  'Fairy Feather': 'fairy',
  'Hard Stone': 'rock',
  Magnet: 'electric',
  'Metal Coat': 'steel',
  'Miracle Seed': 'grass',
  'Mystic Water': 'water',
  'Never-Melt Ice': 'ice',
  'Poison Barb': 'poison',
  'Sharp Beak': 'flying',
  'Silk Scarf': 'normal',
  'Silver Powder': 'bug',
  'Soft Sand': 'ground',
  'Spell Tag': 'ghost',
  'Twisted Spoon': 'psychic',
  'Draco Plate': 'dragon',
  'Dread Plate': 'dark',
  'Earth Plate': 'ground',
  'Fist Plate': 'fighting',
  'Flame Plate': 'fire',
  'Icicle Plate': 'ice',
  'Insect Plate': 'bug',
  'Iron Plate': 'steel',
  'Meadow Plate': 'grass',
  'Mind Plate': 'psychic',
  'Pixie Plate': 'fairy',
  'Sky Plate': 'flying',
  'Splash Plate': 'water',
  'Spooky Plate': 'ghost',
  'Stone Plate': 'rock',
  'Toxic Plate': 'poison',
  'Zap Plate': 'electric',
});

const LEFTOVERS_ITEM = 'Leftovers';
const ASSAULT_VEST_ITEM = 'Assault Vest';
const FOCUS_BAND_ITEM = 'Focus Band';
const KINGS_ROCK_ITEM = "King's Rock";
const BATTLE_HELD_ITEM_DETAILS = Object.freeze([
  {
    name: 'Choice Cloak',
    emoji: '<:choicecloak:1564308705418420244>',
    description: "Combines Choice Band, Choice Scarf, and Choice Specs: the holder's Attack, Special Attack, and Speed are boosted by 1.5x, but it can only use the first move it executes.",
  },
  {
    name: 'Choice Band',
    emoji: '<:choiceband:1564308703694553270>',
    description: "Boosts the holder's Attack by 1.5x, but it can only use the first move it executes.",
  },
  {
    name: 'Choice Scarf',
    emoji: '<:choicescarf:1564308701563854998>',
    description: "Boosts the holder's Speed by 1.5x, but it can only use the first move it executes.",
  },
  {
    name: 'Choice Specs',
    emoji: '<:choicespecs:1564308699906834462>',
    description: "Boosts the holder's Special Attack by 1.5x, but it can only use the first move it executes.",
  },
  {
    name: 'Damp Rock',
    emoji: '<:damprock:1564308698191626351>',
    description: 'Extends the duration of rain started by its holder from 5 to 8 turns.',
  },
  {
    name: 'Expert Belt',
    emoji: '<:expertbelt:1564308696606052372>',
    description: 'Boosts the holder’s super-effective moves by 20%.',
  },
  {
    name: 'Focus Sash',
    emoji: '<:focussash:1564308692512538805>',
    description: 'If the holder is at full HP when a damaging move would make it faint, it survives with 1 HP. It works once per battle.',
  },
  {
    name: 'Life Orb',
    emoji: '<:lifeorb:1564308688892600381>',
    description: 'Boosts the holder’s damaging moves by 30%, but costs it 10% of its maximum HP after a successful hit.',
  },
  {
    name: 'Loaded Dice',
    emoji: '<:loadeddice:1564308687030456342>',
    description: 'Outside World Boss battles, multi-hit moves with a 2–5 hit range always hit 4 or 5 times, with an equal chance of either. In World Boss battles, it reduces the chance of being hit: regular Pokémon are hit 1/4 of the time instead of 1/3, and Golden Pokémon 1/3 instead of 1/2. Other effects cannot reduce World Boss accuracy.',
  },
  {
    name: 'Luck Incense',
    emoji: '<:luckincense:1564308685092561097>',
    description: 'Doubles PokéCoins earned from trainer battles while its holder participates.',
  },
  {
    name: 'Lucky Egg',
    emoji: '<:luckyegg:1564308683410767872>',
    description: 'Boosts EXP earned by its holder by 50%.',
  },
  {
    name: 'Metronome',
    emoji: '<:metronome:1564308680185479208>',
    description: 'Boosts the holder’s damage to World Bosses by 35%.',
  },
  {
    name: 'Quick Claw',
    emoji: '<:quickclaw:1564308678147055707>',
    description: 'Gives the holder a 20% chance to act before its opponent.',
  },
  {
    name: 'Sitrus Berry',
    emoji: '<:sitrusberry:1564308675793789031>',
    description: 'Restores 25% of the holder’s maximum HP once its HP falls to half or lower.',
  },
  {
    name: 'Soothe Bell',
    emoji: '<:soothebell:1564308674128773221>',
    description: 'Doubles friendship gained by its holder.',
  },
  {
    name: 'Wise Glasses',
    emoji: '<:wiseglasses:1564308672245538938>',
    description: 'Boosts the holder’s Special moves by 10%.',
  },
  {
    name: 'Zoom Lens',
    emoji: '<:zoomlens:1564308670672805979>',
    description: 'Boosts the accuracy of the holder’s moves by 20% when it acts after its target.',
  },
]);
const BATTLE_HELD_ITEM_NAMES_SET = new Set(BATTLE_HELD_ITEM_DETAILS.map((item) => item.name));
const CHOICE_ITEMS = new Set(['Choice Cloak', 'Choice Band', 'Choice Scarf', 'Choice Specs']);
const CHOICE_ATTACK_ITEMS = new Set(['Choice Cloak', 'Choice Band']);
const CHOICE_SPECIAL_ATTACK_ITEMS = new Set(['Choice Cloak', 'Choice Specs']);
const CHOICE_SPEED_ITEMS = new Set(['Choice Cloak', 'Choice Scarf']);
const MULTI_HIT_MOVE_NAMES = new Set([
  'armthrust', 'barrage', 'bonerush', 'bulletseed', 'cometpunch', 'doubleslap',
  'furyattack', 'furyswipes', 'iciclespear', 'pinmissile', 'rockblast', 'spikecannon',
  'tailslap', 'watershuriken', 'scaleshot',
]);
// Power items add 8 EVs in their stat to every EV training reward.
const POWER_ITEM_EVS = Object.freeze({
  'Power Weight': 'hp',
  'Power Bracer': 'atk',
  'Power Belt': 'def',
  'Power Lens': 'spa',
  'Power Band': 'spdef',
  'Power Anklet': 'spe',
});
const BATTLE_HELD_ITEM_NAMES = new Set([
  ...Object.keys(TYPE_BOOSTING_HELD_ITEMS),
  ...Object.keys(POWER_ITEM_EVS),
  LEFTOVERS_ITEM,
  ASSAULT_VEST_ITEM,
  FOCUS_BAND_ITEM,
  KINGS_ROCK_ITEM,
  ...RESEARCH_HOLDABLE_ITEM_NAMES,
  ...BATTLE_HELD_ITEM_NAMES_SET,
]);

function findBattleHeldItem(query) {
  if (typeof query !== 'string' || !query.trim()) return null;
  const normalizedQuery = query.toLowerCase().replace(/[^a-z0-9]/g, '');
  return [...BATTLE_HELD_ITEM_NAMES].find((name) =>
    name.toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedQuery
  ) || null;
}

function getHeldItemDamageMultiplier(itemName, moveType, effectiveness = 1, category, worldBoss = false) {
  const boostedType = TYPE_BOOSTING_HELD_ITEMS[itemName];
  let multiplier = boostedType && boostedType === String(moveType).toLowerCase() ? 1.2 : 1;
  if (itemName === 'Expert Belt' && effectiveness > 1) multiplier *= 1.2;
  if (itemName === 'Life Orb') multiplier *= 1.3;
  if (itemName === 'Wise Glasses' && category === 'special') multiplier *= 1.1;
  if (worldBoss && itemName === 'Metronome') multiplier *= 1.35;
  return multiplier;
}

function getBattleHeldItemDetails(itemName) {
  return BATTLE_HELD_ITEM_DETAILS.find((item) => item.name === itemName) || null;
}

function getMultiHitCount(moveName, heldItem) {
  const normalizedMove = String(moveName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!MULTI_HIT_MOVE_NAMES.has(normalizedMove)) return 1;
  if (heldItem === 'Loaded Dice') return Math.random() < 0.5 ? 4 : 5;
  const roll = Math.random();
  return roll < 0.35 ? 2 : roll < 0.7 ? 3 : roll < 0.85 ? 4 : 5;
}

function isPlateItem(itemName) {
  return typeof itemName === 'string' && itemName.endsWith(' Plate') && itemName in TYPE_BOOSTING_HELD_ITEMS;
}

// Judgment takes the type of the Plate its holder carries.
function getHeldItemMoveType(moveName, moveType, itemName) {
  const isJudgment = String(moveName || '').toLowerCase().replace(/[^a-z]/g, '') === 'judgment';
  return isJudgment && isPlateItem(itemName) ? TYPE_BOOSTING_HELD_ITEMS[itemName] : moveType;
}

module.exports = {
  BATTLE_HELD_ITEM_NAMES,
  BATTLE_HELD_ITEM_DETAILS,
  CHOICE_ITEMS,
  CHOICE_ATTACK_ITEMS,
  CHOICE_SPECIAL_ATTACK_ITEMS,
  CHOICE_SPEED_ITEMS,
  ASSAULT_VEST_ITEM,
  FOCUS_BAND_ITEM,
  KINGS_ROCK_ITEM,
  LEFTOVERS_ITEM,
  TYPE_BOOSTING_HELD_ITEMS,
  POWER_ITEM_EVS,
  getHeldItemDamageMultiplier,
  getBattleHeldItemDetails,
  getMultiHitCount,
  getHeldItemMoveType,
  isPlateItem,
  findBattleHeldItem,
};