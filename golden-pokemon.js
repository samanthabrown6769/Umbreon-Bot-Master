// Golden Pokémon are promo, event-reward, and admin-giveaway variants only.
// They are NEVER produced by wild spawns. Golden forms exist for base Pokémon
// only (no Mega or Gmax forms).
//
// Golden sprites are hotlinked from TPPC RPG in this format:
//   https://graphics.tppcrpg.net/xy/golden/001M.gif
// (zero-padded 3-digit National Dex number + "M")

const GOLDEN_SPRITE_BASE = 'https://graphics.tppcrpg.net/xy/golden';
const GOLDEN_RARITY = 'Golden';

function getGoldenSpriteUrl(speciesId) {
  if (!Number.isSafeInteger(speciesId) || speciesId <= 0) return null;
  return `${GOLDEN_SPRITE_BASE}/${String(speciesId).padStart(3, '0')}M.gif`;
}

module.exports = { GOLDEN_RARITY, GOLDEN_SPRITE_BASE, getGoldenSpriteUrl };
