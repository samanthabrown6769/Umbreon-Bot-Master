const RESEARCH_SHOP_ITEMS = [
  {
    id: 34,
    name: 'Fluffy Tail',
    emoji: '<:fluffytail:1562176205896155157>',
    price: 125,
    description: 'Increases the chance to find valuables and held items from Pokémon encounters by 30%.',
  },
  {
    id: 35,
    name: 'PokeDoll',
    emoji: '<:pokedoll:1562176204486873108>',
    price: 150,
    description: 'Increases the chance to find relics and special battle held items from Pokémon encounters by 30%.',
  },
  {
    id: 36,
    name: 'PokeToy',
    emoji: '<:poketoy:1562176202846904380>',
    price: 200,
    description: 'Increases the chance to find an Ancient Fossil on a successful catch by 30%.',
  },
  {
    id: 38,
    name: 'Red Shard',
    emoji: '<:redshard:1562176201085161502>',
    price: 50,
    description: 'Unlocks certain Legendary Pokémon and is consumed automatically upon a single encounter.',
    unlocks: ['Moltres', 'Ho-Oh'],
    unlocksShiny: true,
  },
  {
    id: 39,
    name: 'Blue Shard',
    emoji: '<:blueshard:1562176199835263005>',
    price: 50,
    description: 'Unlocks certain Legendary Pokémon and is consumed automatically upon a single encounter.',
    unlocks: ['Articuno', 'Lugia'],
    unlocksShiny: true,
  },
  {
    id: 40,
    name: 'Green Shard',
    emoji: '<:greenshard:1562176198262661321>',
    price: 50,
    description: 'Unlocks certain Legendary Pokémon and is consumed automatically upon a single encounter.',
    unlocks: ['Celebi', 'Rayquaza'],
    unlocksShiny: true,
  },
  {
    id: 41,
    name: 'Yellow Shard',
    emoji: '<:yellowshard:1562176196509171902>',
    price: 50,
    description: 'Unlocks certain Legendary Pokémon and is consumed automatically upon a single encounter.',
    unlocks: ['Zapdos', 'Jirachi'],
    unlocksShiny: true,
  },
];

const RESEARCH_SHOP_ITEMS_BY_ID = new Map(
  RESEARCH_SHOP_ITEMS.map((item) => [item.id, item])
);
const RESEARCH_SHOP_ITEMS_BY_NAME = new Map(
  RESEARCH_SHOP_ITEMS.map((item) => [
    item.name.toLowerCase().replace(/[^a-z0-9]/g, ''),
    item,
  ])
);

const RESEARCH_VALUABLES = [
  { name: 'Nugget', emoji: '<:nugget:1562173058272333948>', coins: 2000, points: 1 },
  { name: 'Big Nugget', emoji: '<:bignugget:1562173054702985287>', coins: 30000, points: 15 },
  { name: 'Pearl', emoji: '<:pearl:1562173052580667543>', coins: 2000, points: 1 },
  { name: 'Big Pearl', emoji: '<:bigpearl:1562173050554679476>', coins: 30000, points: 15 },
  { name: 'Star Piece', emoji: '<:starpiece:1562173048952594532>', coins: 15000, points: 10 },
  { name: 'Comet Shard', emoji: '<:cometshard:1562173046679408640>', coins: 60000, points: 25 },
];

const RESEARCH_RELICS = [
  { name: 'Relic Crown', emoji: '<:reliccrown:1562176213051641876>' },
  { name: 'Relic Band', emoji: '<:relicband:1562176211331977287>' },
  { name: 'Relic Vase', emoji: '<:relicvase:1562176209566040154>' },
  { name: 'Relic Statue', emoji: '<:relicstatue:1562176208089915462>' },
];

const RESEARCH_HELD_ITEMS = [
  {
    name: "King's Rock",
    emoji: '<:kingsrock:1559927176575324292>',
    description: "Allows Poliwhirl and Slowpoke to evolve. In battle, damaging moves that do not already cause flinching have a 10% chance to make the target flinch.",
    species: ['Hawlucha', 'Hariyama', 'Slowpoke', 'Slowbro', 'Psyduck', 'Golduck'],
    requiresRelicExchange: true,
  },
  {
    name: 'Focus Band',
    emoji: '<:focusband:1562176813931962468>',
    description: 'When a damaging move would cause its holder to faint, it has a 10% chance to survive with 1 HP.',
    species: ['Machop', 'Machoke', 'Machamp'],
    requiresRelicExchange: true,
  },
  {
    name: 'Assault Vest',
    emoji: '<:assaultvest:1562176803009986701>',
    description: "Raises the holder's Special Defense by 50%, but prevents it from using status moves.",
    species: ['Aggron', 'Shuckle'],
    requiresRelicExchange: true,
  },
];

const RESEARCH_POINT_EMOJI = '<:researchpoint:1562173056569446432>';
const RESEARCH_DROP_VALUABLES = Object.freeze([
  'Nugget',
  'Pearl',
  'Comet Shard',
  'Star Piece',
]);
const RESEARCH_HOLDABLE_ITEM_NAMES = Object.freeze([
  'Red Shard',
  'Blue Shard',
  'Green Shard',
  'Yellow Shard',
  ...RESEARCH_HELD_ITEMS.map((item) => item.name),
]);
const RESEARCH_ITEM_NAMES = Object.freeze([
  ...RESEARCH_SHOP_ITEMS.map((item) => item.name),
  ...RESEARCH_VALUABLES.map((item) => item.name),
  ...RESEARCH_RELICS.map((item) => item.name),
  ...RESEARCH_HELD_ITEMS.map((item) => item.name),
]);
const RESEARCH_ITEM_EMOJIS = Object.fromEntries([
  ...RESEARCH_SHOP_ITEMS,
  ...RESEARCH_VALUABLES,
  ...RESEARCH_RELICS,
  ...RESEARCH_HELD_ITEMS,
].map((item) => [item.name, item.emoji]));

module.exports = {
  RESEARCH_ITEM_EMOJIS,
  RESEARCH_ITEM_NAMES,
  RESEARCH_DROP_VALUABLES,
  RESEARCH_HELD_ITEMS,
  RESEARCH_HOLDABLE_ITEM_NAMES,
  RESEARCH_POINT_EMOJI,
  RESEARCH_RELICS,
  RESEARCH_SHOP_ITEMS,
  RESEARCH_SHOP_ITEMS_BY_ID,
  RESEARCH_SHOP_ITEMS_BY_NAME,
  RESEARCH_VALUABLES,
};
