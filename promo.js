const fs = require('fs');
const path = require('path');
const { getGoldenSpriteUrl } = require('./golden-pokemon');

const PROMO_PATH = path.join(__dirname, 'promo.json');

function normalizePromo(config) {
  if (!Number.isSafeInteger(config?.speciesId) || config.speciesId <= 0) {
    console.error('promo.json: every promo needs a positive integer speciesId.');
    return null;
  }
  return {
    name: config.name || 'Golden Pokémon',
    speciesId: config.speciesId,
    costCoins: Number.isSafeInteger(config.costCoins) ? config.costCoins : 0,
    costItems: Number.isSafeInteger(config.costItems) ? config.costItems : 1,
    itemName: config.itemName || 'Promo Token',
    itemEmoji: config.itemEmoji || '✨',
    endsAtText: config.endsAtText || 'Limited time',
    endsAtFooter: config.endsAtFooter || config.endsAtText || '',
    drops: config.drops && typeof config.drops === 'object' ? config.drops : {},
    img: getGoldenSpriteUrl(config.speciesId),
  };
}

// Reads promo.json on every call so promo changes apply without a restart.
// Supports either a single promo object or { "promos": [ ... ] } for concurrent promos.
function getActivePromos() {
  let config;
  try {
    config = JSON.parse(fs.readFileSync(PROMO_PATH, 'utf8'));
  } catch (error) {
    console.error('Failed to read promo.json:', error.message);
    return [];
  }
  const list = Array.isArray(config.promos) ? config.promos : [config];
  return list.map(normalizePromo).filter(Boolean);
}

function getCurrentPromo() {
  return getActivePromos()[0] || null;
}

function getPromoItemNames() {
  return getActivePromos().map((promo) => promo.itemName);
}

function findPromoByItemName(query) {
  if (typeof query !== 'string' || !query.trim()) return null;
  const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const needle = normalize(query);
  return getActivePromos().find((promo) => normalize(promo.itemName) === needle) || null;
}

function rollPromoItemDrop(promo, source, multiplier = 1) {
  const drop = promo?.drops?.[source];
  if (!drop || drop.enabled === false) return false;
  const oneIn = Number(drop.oneIn);
  if (!Number.isSafeInteger(oneIn) || oneIn < 1) return false;
  return Math.random() < multiplier / oneIn;
}

module.exports = {
  findPromoByItemName,
  getActivePromos,
  getCurrentPromo,
  getPromoItemNames,
  rollPromoItemDrop,
};
