// Golden Pokémon are promo, event-reward, and admin-giveaway variants only.
// They are NEVER produced by wild spawns. Golden forms exist for base Pokémon,
// plus explicitly supported regional forms (no Mega or Gmax forms).
//
// Golden sprites are hotlinked from TPPC RPG in this format:
//   https://graphics.tppcrpg.net/xy/golden/001M.gif
// (zero-padded 3-digit National Dex number + "M")

const GOLDEN_SPRITE_BASE = 'https://graphics.tppcrpg.net/xy/golden';
const GOLDEN_RARITY = 'Golden';
const GOLDEN_REGIONAL_DEX_NUMBERS = new Map([
  ['zorua-hisui', 10001],
  ['zoroark-hisui', 10002],
]);
const GOLDEN_REGIONAL_SPRITES_UNAVAILABLE = new Set(['wooper-paldea']);
const { displayName, regionalPokemonName } = require('./pokemon-names');
const pokemonCatalog = require('./data/pokemon-catalog.json');
const defaultFormSlugBySpecies = new Map(
  pokemonCatalog
    .filter((pokemon) => pokemon.is_default)
    .map((pokemon) => [pokemon.species_id, pokemon.slug])
);
function isGoldenBaseForm(speciesId, formSlug) {
  return defaultFormSlugBySpecies.get(speciesId) === formSlug;
}

const alternateFormsBySpecies = new Map();
for (const pokemon of pokemonCatalog.filter((form) => !form.is_default)) {
  const forms = alternateFormsBySpecies.get(pokemon.species_id) || [];
  forms.push(pokemon);
  alternateFormsBySpecies.set(pokemon.species_id, forms);
}
for (const forms of alternateFormsBySpecies.values()) {
  forms.sort((left, right) => left.id - right.id);
}

const GOLDEN_REGIONAL_FORMS = new Map();
let nextGoldenDexNumber = 10003;
const regionalForms = pokemonCatalog
  .filter((pokemon) =>
    !pokemon.is_default && regionalPokemonName(pokemon.slug) !== displayName(pokemon.slug)
  )
  .sort((left, right) => left.species_id - right.species_id || left.id - right.id);
for (const pokemon of regionalForms) {
  const alternateForms = alternateFormsBySpecies.get(pokemon.species_id) || [];
  const formIndex = alternateForms.findIndex((form) => form.slug === pokemon.slug) + 1;
  if (formIndex <= 0) {
    throw new Error(`Could not determine regional form order for ${pokemon.slug}.`);
  }
  const dexNumber = GOLDEN_REGIONAL_DEX_NUMBERS.get(pokemon.slug) || nextGoldenDexNumber++;
  const filename = `${String(pokemon.species_id).padStart(3, '0')}M-${formIndex}.gif`;
  GOLDEN_REGIONAL_FORMS.set(pokemon.slug, {
    speciesId: pokemon.species_id,
    dexNumber,
    spriteUrl: GOLDEN_REGIONAL_SPRITES_UNAVAILABLE.has(pokemon.slug)
      ? null
      : `${GOLDEN_SPRITE_BASE}/${filename}`,
  });
}

function getGoldenSpriteUrl(speciesId, formSlug = null) {
  if (!Number.isSafeInteger(speciesId) || speciesId <= 0) return null;
  if (formSlug) {
    const regionalForm = GOLDEN_REGIONAL_FORMS.get(formSlug);
    if (regionalForm?.speciesId === speciesId) return regionalForm.spriteUrl;
    if (!isGoldenBaseForm(speciesId, formSlug)) return null;
  }
  return `${GOLDEN_SPRITE_BASE}/${String(speciesId).padStart(3, '0')}M.gif`;
}

module.exports = {
  GOLDEN_RARITY,
  GOLDEN_REGIONAL_FORMS,
  GOLDEN_SPRITE_BASE,
  getGoldenSpriteUrl,
  isGoldenBaseForm,
};
