const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CATALOG_PATH = path.join(ROOT, 'data', 'pokemon-catalog.json');
const RARITIES_PATH = path.join(ROOT, 'data', 'pokemon-rarities.json');
const OUTPUT_DIR = path.join(ROOT, 'pokemon-database');
const { regionalPokemonName } = require('../pokemon-names');
const { loadPokemonDatabase } = require('../pokemon-database');
const { getGoldenSpriteUrl } = require('../golden-pokemon');
const {
  getGoldenDexNumber,
  getPokemonDexGroups,
  getPokemonDexNumbers,
  isGoldenFormSupported,
} = require('../pokemon-dex-numbers');

const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
const rarityOverrides = JSON.parse(fs.readFileSync(RARITIES_PATH, 'utf8'));
if (!Array.isArray(catalog) || !Array.isArray(rarityOverrides)) {
  throw new Error('Pokémon catalog and rarity data must both be JSON arrays.');
}

const rarityById = new Map(rarityOverrides.map((entry) => [entry.id, entry.rarity]));
const dexNumbersById = getPokemonDexNumbers(catalog);
const seenIds = new Set();
const datasets = {
  'base-dex.json': [],
  'shiny-dex.json': [],
  'golden-dex.json': [],
  'formes.json': [],
  'mega.json': [],
  'shiny-mega.json': [],
  'gmax.json': [],
  'shiny-gmax.json': [],
};

let catalogChanged = false;
for (const pokemon of catalog) {
  if (!Number.isSafeInteger(pokemon.id) || pokemon.id <= 0 || seenIds.has(pokemon.id)) {
    throw new Error(`Invalid or duplicate Pokémon form ID: ${pokemon.id}`);
  }
  seenIds.add(pokemon.id);
  const rarity = rarityById.get(pokemon.id);
  if (typeof rarity !== 'string' || !rarity.trim()) {
    throw new Error(`Pokémon form ${pokemon.id} is missing its rarity override.`);
  }

  const name = regionalPokemonName(pokemon.slug);
  if (pokemon.name !== name) {
    pokemon.name = name;
    catalogChanged = true;
  }
  const edited = loadPokemonDatabase().get(pokemon.slug) || {};
  const record = {
    ...pokemon,
    name: edited.name || name,
    rarity: edited.rarity || rarity,
    sprite: edited.sprite || pokemon.sprite,
    shiny_sprite: edited.shinySprite || pokemon.shiny_sprite,
    ...(edited.animated ? { animated_sprite: edited.animated } : {}),
    ...(edited.shinyAnimated ? { shiny_animated_sprite: edited.shinyAnimated } : {}),
  };
  const isGmax = /gmax|gigantamax|eternamax/i.test(`${pokemon.name} ${pokemon.slug}`);
  const isMega = /\bmega\b/i.test(`${pokemon.name} ${pokemon.slug}`);
  if (isGmax) {
    datasets['gmax.json'].push({ ...record, dex_number: pokemon.species_id });
    datasets['shiny-gmax.json'].push({
      ...record,
      dex_number: dexNumbersById.get(pokemon.id).shinyDexNumber,
      sprite: record.shiny_sprite || record.sprite,
      variant: 'shiny',
    });
  } else if (isMega) {
    datasets['mega.json'].push({ ...record, dex_number: pokemon.species_id });
    datasets['shiny-mega.json'].push({
      ...record,
      dex_number: dexNumbersById.get(pokemon.id).shinyDexNumber,
      sprite: record.shiny_sprite || record.sprite,
      variant: 'shiny',
    });
  } else if (pokemon.is_default) {
    datasets['base-dex.json'].push({ ...record, dex_number: pokemon.species_id });
    datasets['shiny-dex.json'].push({
      ...record,
      dex_number: dexNumbersById.get(pokemon.id).shinyDexNumber,
      sprite: record.shiny_sprite || record.sprite,
      variant: 'shiny',
    });
    datasets['golden-dex.json'].push({
      ...record,
      dex_number: getGoldenDexNumber(pokemon.species_id),
      sprite: getGoldenSpriteUrl(pokemon.species_id),
      variant: 'golden',
    });
  } else if (isGoldenFormSupported(pokemon.species_id, pokemon.slug)) {
    datasets['formes.json'].push({ ...record, dex_number: pokemon.species_id });
    datasets['golden-dex.json'].push({
      ...record,
      dex_number: getGoldenDexNumber(pokemon.species_id, pokemon.slug),
      sprite: getGoldenSpriteUrl(pokemon.species_id, pokemon.slug),
      variant: 'golden',
    });
  } else {
    datasets['formes.json'].push({ ...record, dex_number: pokemon.species_id });
  }
}

if (catalogChanged) {
  fs.writeFileSync(CATALOG_PATH, `${JSON.stringify(catalog)}\n`);
}

const dexDatasetByKey = {
  mega: 'mega.json',
  shinyMega: 'shiny-mega.json',
  gmax: 'gmax.json',
  shinyGmax: 'shiny-gmax.json',
  formes: 'formes.json',
  shinyFormes: 'formes.json',
};
const datasetsByCatalogId = new Map(
  Object.entries(dexDatasetByKey).map(([key, filename]) => [
    key,
    new Map(datasets[filename].map((pokemon) => [pokemon.id, pokemon])),
  ])
);
for (const group of getPokemonDexGroups(catalog)) {
  const datasetByCatalogId = datasetsByCatalogId.get(group.key);
  group.forms.forEach((form) => {
    const pokemon = datasetByCatalogId.get(form.id);
    if (!pokemon) {
      throw new Error(`Missing ${dexDatasetByKey[group.key]} entry for catalog form ${form.id}.`);
    }
    const numbers = dexNumbersById.get(form.id);
    const dexNumber = group.shiny ? numbers.shinyDexNumber : numbers.dexNumber;
    if (group.shiny && group.key === 'shinyFormes') {
      pokemon.shiny_dex_number = dexNumber;
      return;
    }
    pokemon.id = dexNumber;
    pokemon.dex_number = dexNumber;
  });
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
for (const [filename, entries] of Object.entries(datasets)) {
  entries.sort((left, right) =>
    left.dex_number - right.dex_number || left.id - right.id
  );
  fs.writeFileSync(
    path.join(OUTPUT_DIR, filename),
    `${JSON.stringify(entries, null, 2)}\n`
  );
  console.log(`${filename}: ${entries.length} entries`);
}

console.log(`Pokémon database written to ${OUTPUT_DIR}`);
