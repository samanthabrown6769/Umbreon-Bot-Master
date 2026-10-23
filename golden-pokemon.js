// Golden Pokémon are promo, event-reward, and admin-giveaway variants only.
// They are NEVER produced by wild spawns. Golden forms exist for base Pokémon,
// cataloged regional forms, and explicitly supported screenshot variants.
//
// Golden sprites are hotlinked from TPPC RPG in this format:
//   https://graphics.tppcrpg.net/xy/golden/001M.gif
// (zero-padded 3-digit National Dex number + "M")

const GOLDEN_SPRITE_BASE = 'https://graphics.tppcrpg.net/xy/golden';
const GOLDEN_RARITY = 'Golden';
const GOLDEN_FORM_DEX_NUMBERS = new Map([
  ['charizard-mega-x', 7006],
  ['charizard-mega-y', 7009],
  ['blastoise-mega', 7012],
  ['sceptile-mega', 7015],
  ['blaziken-mega', 7018],
  ['swampert-mega', 7021],
  ['gardevoir-mega', 7024],
  ['beedrill-mega', 7027],
  ['ampharos-mega', 7030],
  ['sableye-mega', 7033],
  ['garchomp-mega', 7036],
  ['pidgeot-mega', 7039],
  ['gengar-mega', 7042],
  ['steelix-mega', 7045],
  ['lopunny-mega', 7048],
  ['alakazam-mega', 7051],
  ['scizor-mega', 7054],
  ['mawile-mega', 7057],
  ['lucario-mega', 7060],
  ['slowbro-mega', 7063],
  ['heracross-mega', 7066],
  ['aggron-mega', 7069],
  ['abomasnow-mega', 7072],
  ['kangaskhan-mega', 7075],
  ['houndoom-mega', 7078],
  ['gallade-mega', 7084],
  ['pinsir-mega', 7087],
  ['tyranitar-mega', 7090],
  ['audino-mega', 7096],
  ['gyarados-mega', 7099],
  ['diancie-mega', 7108],
  ['mewtwo-mega-x', 7111],
  ['altaria-mega', 7117],
  ['rayquaza-mega', 7120],
  ['mewtwo-mega-y', 7123],
  ['banette-mega', 7126],
  ['absol-mega', 7129],
  ['salamence-mega', 7135],
  ['metagross-mega', 7138],
  ['latias-mega', 7141],
  ['latios-mega', 7144],
  ['kyurem-black', 7512],
  ['kyurem-white', 7515],
  ['zygarde-complete', 7566],
  ['zygarde-10', 7569],
  ['groudon-primal', 7575],
  ['kyogre-primal', 7585],
  ['giratina-origin', 7586],
  ['rotom-wash', 7614],
  ['rotom-fan', 7626],
  ['rotom-heat', 7632],
  ['rotom-frost', 7647],
  ['rotom-mow', 7659],
  ['grimer-alola', 7701],
  ['muk-alola', 7704],
  ['vulpix-alola', 7719],
  ['ninetales-alola', 7722],
  ['articuno-galar', 7752],
  ['moltres-galar', 7758],
  ['zorua-hisui', 7803],
  ['zoroark-hisui', 7806],
  ['zigzagoon-galar', 7827],
  ['linoone-galar', 7830],
  ['zacian-crowned', 7893],
]);
const GOLDEN_REGIONAL_SPRITES_UNAVAILABLE = new Set(['wooper-paldea']);
const { displayName, regionalPokemonName } = require('./pokemon-names');
const pokemonCatalog = require('./data/pokemon-catalog.json');
const customPokemonForms = require('./data/custom-pokemon-forms.json');
const customPokemonFormSlugs = new Set(customPokemonForms.map((form) => form.slug));
const defaultFormSlugBySpecies = new Map(
  pokemonCatalog
    .filter((pokemon) => pokemon.is_default)
    .map((pokemon) => [pokemon.species_id, pokemon.slug])
);
function isGoldenBaseForm(speciesId, formSlug) {
  return defaultFormSlugBySpecies.get(speciesId) === formSlug;
}

const alternateFormsBySpecies = new Map();
for (const pokemon of pokemonCatalog.filter((form) =>
  !form.is_default && !customPokemonFormSlugs.has(form.slug)
)) {
  const forms = alternateFormsBySpecies.get(pokemon.species_id) || [];
  forms.push(pokemon);
  alternateFormsBySpecies.set(pokemon.species_id, forms);
}
for (const forms of alternateFormsBySpecies.values()) {
  forms.sort((left, right) => left.id - right.id);
}

const GOLDEN_REGIONAL_FORMS = new Map();
const highestBaseSpeciesId = Math.max(
  ...pokemonCatalog.filter((pokemon) => pokemon.is_default).map((pokemon) => pokemon.species_id)
);
let nextGoldenDexNumber = Math.max(10001, 9000 + highestBaseSpeciesId + 1);
const regionalForms = pokemonCatalog
  .filter((pokemon) =>
    !pokemon.is_default
    && !customPokemonFormSlugs.has(pokemon.slug)
    && regionalPokemonName(pokemon.slug) !== displayName(pokemon.slug)
  )
  .sort((left, right) => left.species_id - right.species_id || left.id - right.id);
for (const pokemon of regionalForms) {
  const alternateForms = alternateFormsBySpecies.get(pokemon.species_id) || [];
  const formIndex = alternateForms.findIndex((form) => form.slug === pokemon.slug) + 1;
  if (formIndex <= 0) {
    throw new Error(`Could not determine regional form order for ${pokemon.slug}.`);
  }
  const dexNumber = GOLDEN_FORM_DEX_NUMBERS.get(pokemon.slug) || nextGoldenDexNumber++;
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
  GOLDEN_FORM_DEX_NUMBERS,
  GOLDEN_REGIONAL_FORMS,
  GOLDEN_SPRITE_BASE,
  getGoldenSpriteUrl,
  isGoldenBaseForm,
};
