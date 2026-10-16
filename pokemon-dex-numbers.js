const { loadPokemonDatabase } = require('./pokemon-database');

const FORM_DEX_STARTS = {
  mega: 4001,
  shinyMega: 4501,
  gmax: 5001,
  shinyGmax: 5501,
  formes: 6001,
  shinyFormes: 7001,
};
const GOLDEN_DEX_START = 8001;
// Per-species shiny dex overrides (currently none: shiny base dex = species ID + 2000).
const SHINY_FORM_DEX_NUMBERS_BY_SPECIES = new Map();
const RESERVED_FORM_DEX_NUMBERS = new Set();


function isGmax(pokemon) {
  return /gmax|gigantamax|eternamax/i.test(`${pokemon.name} ${pokemon.slug}`);
}

function isMega(pokemon) {
  return /\bmega\b/i.test(`${pokemon.name} ${pokemon.slug}`) && !isGmax(pokemon);
}

function sortedForms(forms) {
  return [...forms].sort((left, right) =>
    left.species_id - right.species_id || left.id - right.id
  );
}

function getPokemonDexGroups(pokemonForms) {
  const forms = [...pokemonForms];
  return [
    {
      key: 'mega',
      start: FORM_DEX_STARTS.mega,
      forms: sortedForms(forms.filter(isMega)),
      shiny: false,
    },
    {
      key: 'shinyMega',
      start: FORM_DEX_STARTS.shinyMega,
      forms: sortedForms(forms.filter(isMega)),
      shiny: true,
    },
    {
      key: 'gmax',
      start: FORM_DEX_STARTS.gmax,
      forms: sortedForms(forms.filter(isGmax)),
      shiny: false,
    },
    {
      key: 'shinyGmax',
      start: FORM_DEX_STARTS.shinyGmax,
      forms: sortedForms(forms.filter(isGmax)),
      shiny: true,
    },
    {
      key: 'formes',
      start: FORM_DEX_STARTS.formes,
      forms: sortedForms(forms.filter((pokemon) =>
        !pokemon.is_default
        && !isMega(pokemon)
        && !isGmax(pokemon)
      )),
      shiny: false,
    },
    {
      key: 'shinyFormes',
      start: FORM_DEX_STARTS.shinyFormes,
      forms: sortedForms(forms.filter((pokemon) =>
        !pokemon.is_default && !isMega(pokemon) && !isGmax(pokemon)
      )),
      shiny: true,
    },
  ];
}

function getPokemonDexNumbers(pokemonForms) {
  const numbers = new Map();
  for (const pokemon of pokemonForms) {
    if (pokemon.is_default) {
      numbers.set(pokemon.id, {
        dexNumber: pokemon.species_id,
        shinyDexNumber: pokemon.species_id + 2000,
      });
    }
  }
  for (const { start, forms, shiny } of getPokemonDexGroups(pokemonForms)) {
    let overflowDexNumber = start + forms.length;
    forms.forEach((pokemon, index) => {
      const current = numbers.get(pokemon.id) || {};
      const dexNumber = !shiny && RESERVED_FORM_DEX_NUMBERS.has(start + index)
        ? overflowDexNumber++
        : start + index;
      if (shiny) current.shinyDexNumber = dexNumber;
      else current.dexNumber = dexNumber;
      numbers.set(pokemon.id, current);
    });
  }
  for (const pokemon of pokemonForms) {
    const shinyDexNumber = SHINY_FORM_DEX_NUMBERS_BY_SPECIES.get(pokemon.species_id);
    if (pokemon.is_default && shinyDexNumber) {
      numbers.get(pokemon.id).shinyDexNumber = shinyDexNumber;
    }
  }
  // Numbers edited in pokemon-database/*.json win over the generated ones.
  const edits = loadPokemonDatabase();
  for (const pokemon of pokemonForms) {
    const edited = edits.get(pokemon.slug);
    const current = numbers.get(pokemon.id);
    if (!edited || !current) continue;
    if (edited.dexNumber) current.dexNumber = edited.dexNumber;
    if (edited.shinyDexNumber) current.shinyDexNumber = edited.shinyDexNumber;
  }
  return numbers;
}

function getGoldenDexNumber(speciesId) {
  if (!Number.isSafeInteger(speciesId) || speciesId <= 0 || speciesId > 1999) return null;
  return GOLDEN_DEX_START - 1 + speciesId;
}

module.exports = { GOLDEN_DEX_START, getGoldenDexNumber, getPokemonDexGroups, getPokemonDexNumbers };
