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
});

const LEFTOVERS_ITEM = 'Leftovers';
const BATTLE_HELD_ITEM_NAMES = new Set([
  ...Object.keys(TYPE_BOOSTING_HELD_ITEMS),
  LEFTOVERS_ITEM,
]);

function findBattleHeldItem(query) {
  if (typeof query !== 'string' || !query.trim()) return null;
  const normalizedQuery = query.toLowerCase().replace(/[^a-z0-9]/g, '');
  return [...BATTLE_HELD_ITEM_NAMES].find((name) =>
    name.toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedQuery
  ) || null;
}

function getHeldItemDamageMultiplier(itemName, moveType) {
  const boostedType = TYPE_BOOSTING_HELD_ITEMS[itemName];
  return boostedType && boostedType === String(moveType).toLowerCase() ? 1.2 : 1;
}

module.exports = {
  BATTLE_HELD_ITEM_NAMES,
  LEFTOVERS_ITEM,
  TYPE_BOOSTING_HELD_ITEMS,
  findBattleHeldItem,
  getHeldItemDamageMultiplier,
};
