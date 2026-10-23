// Boxes are stored in user_items under their name. Lootbox is separate (users.lootboxes).
const BOXES = {
  'Rare Box': {
    aliases: ['rarebox', 'rb'], emoji: '<:rarebox:1559925073308291224>',
    rarity: 'Rare', shiny: false, pokemonDropChance: 0.1, coins: [2000, 7000], eggs: [0.05, 1, 1],
    description: 'Gives PokéCoins and has a 10% chance to drop a random Rare Pokémon; otherwise, it gives Greatballs and Ultraballs.',
  },
  'Super Rare Box': {
    aliases: ['superrarebox', 'srb'], emoji: '<:superrarebox:1559925071697420298>',
    rarity: 'Super Rare', shiny: false, pokemonDropChance: 0.1, coins: [5000, 15000], eggs: [0.065, 1, 1],
    description: 'Gives PokéCoins and has a 10% chance to drop a random Super Rare Pokémon; otherwise, it gives Greatballs and Ultraballs.',
  },
  'Legendary Box': {
    aliases: ['legendarybox', 'legbox', 'lgb'], emoji: '<:legendarybox:1559925069831082105>',
    rarity: 'Legendary', shiny: false, pokemonDropChance: 0.1, coins: [25000, 25000], eggs: [0.125, 1, 1],
    description: 'Gives 25,000 PokéCoins and has a 10% chance to drop a random Legendary Pokémon; otherwise, it gives Greatballs and Ultraballs.',
  },
  'Shiny Box': {
    aliases: ['shinybox', 'sb'], emoji: '<a:shinybox:1559925068254154803>',
    rarity: null, shiny: true, pokemonDropChance: 0.1, coins: [50000, 50000], eggs: [0.3, 1, 3],
  },
};

const VOTE_BOXES = {
  'Vote Rare Box': {
    aliases: ['voterare', 'vrb'], emoji: BOXES['Rare Box'].emoji,
    coins: [100, 2599], rareCandies: [0.075, 1, 1], eggs: [0.05, 1, 1], masterballs: [0.05, 1, 1],
  },
  'Vote Super Rare Box': {
    aliases: ['votesuperrare', 'vsrb'], emoji: BOXES['Super Rare Box'].emoji,
    coins: [200, 3249], rareCandies: [0.065, 1, 2], eggs: [0.065, 1, 1], masterballs: [0.01, 1, 1],
  },
  'Vote Legendary Box': {
    aliases: ['votelegendary', 'vlb'], emoji: BOXES['Legendary Box'].emoji,
    coins: [750, 4249], rareCandies: [0.33, 1, 1], eggs: [0.125, 1, 1], masterballs: [0.1, 1, 1],
  },
  'Vote Shiny Box': {
    aliases: ['voteshiny', 'vsb'], emoji: BOXES['Shiny Box'].emoji,
    coins: [1250, 16249], rareCandies: [1, 1, 5], eggs: [0.3, 1, 3], masterballs: [0.2, 1, 1],
  },
};

const LOOTBOX_EMOJI = '<:lootbox:1560318756528590848>';

const normalize = (value) => String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
const boxesByKey = new Map();
const voteBoxesByKey = new Map();
for (const name of Object.keys(BOXES)) {
  boxesByKey.set(normalize(name), name);
  for (const alias of BOXES[name].aliases) boxesByKey.set(normalize(alias), name);
}
for (const name of Object.keys(VOTE_BOXES)) {
  voteBoxesByKey.set(normalize(name), name);
  for (const alias of VOTE_BOXES[name].aliases) voteBoxesByKey.set(normalize(alias), name);
}

function findBox(query) {
  return boxesByKey.get(normalize(query)) || null;
}

function findVoteBox(query) {
  return voteBoxesByKey.get(normalize(query)) || null;
}

module.exports = { BOXES, VOTE_BOXES, LOOTBOX_EMOJI, findBox, findVoteBox };
