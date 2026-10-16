const CLOUDINARY = 'https://res.cloudinary.com/apffqia5/image/upload';

const EXPLORE_MAPS = {
  grass: {
    name: 'Grass Map', emoji: '🌿', bgColor: '#78C850',
    images: [
      `${CLOUDINARY}/v1792179255/gm1.webp`,
      `${CLOUDINARY}/v1792179256/gm2.webp`,
      `${CLOUDINARY}/v1792179256/gm3.webp`,
      `${CLOUDINARY}/v1792179255/gm4.webp`,
    ],
  },
  fire: {
    name: 'Fire Map', emoji: '🔥', bgColor: '#C03028',
    images: [
      `${CLOUDINARY}/v1792179255/fm1.webp`,
      `${CLOUDINARY}/v1792179255/fm2.webp`,
    ],
  },
  water: {
    name: 'Water Map', emoji: '🌊', bgColor: '#6890F0',
    images: [
      `${CLOUDINARY}/v1792179255/wm1.webp`,
      `${CLOUDINARY}/v1792179255/wm2.webp`,
      `${CLOUDINARY}/v1792179256/wm3.webp`,
    ],
  },
};

// [dex number, rarity, can be shiny]
const U = 'Uncommon';
const R = 'Rare';
const S = 'Super Rare';
const EXPLORE_EXCLUSIVES = {
  grass: [
    [1, U, true], [2, R, false], [3, S, false],
    [152, U, true], [153, R, false], [154, S, false],
    [252, U, true], [253, R, false], [254, S, false],
    [387, U, true], [388, R, false], [389, S, false],
    [495, U, true], [496, R, false], [497, S, false],
    [650, U, true], [651, R, false], [652, S, false],
    [722, U, true], [723, R, false], [724, S, false],
    [810, U, false], [811, R, false], [812, S, false],
  ],
  fire: [
    [4, U, true], [5, R, false], [6, S, false],
    [155, U, true], [156, R, false], [157, S, false],
    [255, U, true], [256, R, false], [257, S, false],
    [390, U, true], [391, R, false], [392, S, false],
    [498, U, true], [499, R, false], [500, S, false],
    [653, U, true], [654, R, false], [655, S, false],
    [725, U, true], [726, R, false], [727, S, false],
    [813, U, false], [814, R, false], [815, S, false],
  ],
  water: [
    [7, U, true], [8, R, false], [9, S, false],
    [158, U, true], [159, R, false], [160, S, false],
    [258, U, true], [259, R, false], [260, S, false],
    [393, U, true], [394, R, false], [395, S, false],
    [501, U, false], [502, R, true], [503, S, false],
    [656, U, true], [657, R, false], [658, S, false],
    [728, U, true], [729, R, false], [730, S, false],
    [816, U, false], [817, R, false], [818, S, false],
    [902, S, false],
  ],
};

// Dex numbers that can also spawn as Golden on each map type.
const EXPLORE_GOLDENS = { grass: 252, fire: 725, water: 393 };

// Catch rates (%) per ball before clan/Patreon bonuses: [pb, gb, ub, prb, mb]
const EXPLORE_CATCH_RATES = {
  Common: { pb: 75, gb: 90, ub: 100, prb: 100, mb: 100 },
  Uncommon: { pb: 65, gb: 80, ub: 95, prb: 100, mb: 100 },
  Rare: { pb: 42, gb: 57, ub: 72, prb: 87, mb: 100 },
  'Super Rare': { pb: 25, gb: 40, ub: 55, prb: 70, mb: 100 },
  Top: { pb: 20, gb: 35, ub: 50, prb: 65, mb: 100 },
};

function getExploreCatchRate(ballKey, displayRarity) {
  const row = EXPLORE_CATCH_RATES[displayRarity] || EXPLORE_CATCH_RATES.Top;
  return row[ballKey];
}

const EXPLORE_EXCLUSIVE_SPECIES_IDS = Object.freeze(
  [...new Set(Object.values(EXPLORE_EXCLUSIVES).flat().map(([id]) => id))]
);

module.exports = {
  EXPLORE_MAPS,
  EXPLORE_EXCLUSIVES,
  EXPLORE_GOLDENS,
  EXPLORE_EXCLUSIVE_SPECIES_IDS,
  getExploreCatchRate,
};
