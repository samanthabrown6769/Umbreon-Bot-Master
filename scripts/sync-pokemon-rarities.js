const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ROOT = path.join(__dirname, '..');
const CATALOG_PATH = path.join(DATA_DIR, 'pokemon-catalog.json');
const RARITIES_PATH = path.join(DATA_DIR, 'pokemon-rarities.json');
const REMOVED_FORMS_PATH = path.join(DATA_DIR, 'removed-pokemon-forms.json');
const { getPokemonDexNumbers } = require(path.join(ROOT, 'pokemon-dex-numbers'));

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function rarityForForm(pokemon, existingEntry) {
  const normalizedName = pokemon.name.toLowerCase();
  if (/\bmega\b/.test(normalizedName)) return 'Mega';
  if (existingEntry?.rarity === 'Mega') return pokemon.rarity;
  if (
    /gmax|gigantamax|eternamax/.test(normalizedName)
    || pokemon.id === 10190
  ) {
    return 'Gmax';
  }
  return existingEntry?.rarity || pokemon.rarity;
}

function main() {
  const catalog = readJson(CATALOG_PATH);
  if (!Array.isArray(catalog) || catalog.length === 0) {
    throw new Error(`Pokémon catalog is missing or empty: ${CATALOG_PATH}`);
  }

  const existing = readJson(RARITIES_PATH) || [];
  if (!Array.isArray(existing)) {
    throw new Error(`Pokémon rarity file must contain an array: ${RARITIES_PATH}`);
  }
  const removedForms = readJson(REMOVED_FORMS_PATH);
  if (!Array.isArray(removedForms)
      || removedForms.some((form) => !Number.isSafeInteger(form.id)
        || typeof form.slug !== 'string' || !form.slug.trim())) {
    throw new Error(`Removed Pokémon forms file is missing or invalid: ${REMOVED_FORMS_PATH}`);
  }
  const removedFormIds = new Set(removedForms.map((form) => form.id));
  const existingById = new Map();
  for (const entry of existing) {
    if (!Number.isSafeInteger(entry.id) || entry.id <= 0
        || typeof entry.name !== 'string' || !entry.name.trim()
        || typeof entry.rarity !== 'string' || !entry.rarity.trim()
        || existingById.has(entry.id)) {
      throw new Error(`Invalid or duplicate Pokémon rarity entry in ${RARITIES_PATH}.`);
    }
    existingById.set(entry.id, entry);
  }

  const catalogIds = new Set();
  const dexNumbers = getPokemonDexNumbers(catalog);
  const rarities = catalog.map((pokemon) => {
    if (removedFormIds.has(pokemon.id)) {
      throw new Error(`Removed Pokémon form ${pokemon.id} is still present in ${CATALOG_PATH}.`);
    }
    if (!Number.isSafeInteger(pokemon.id) || typeof pokemon.name !== 'string'
        || typeof pokemon.rarity !== 'string' || catalogIds.has(pokemon.id)) {
      throw new Error('Pokémon catalog contains an invalid or duplicate rarity entry.');
    }
    catalogIds.add(pokemon.id);
    const dex = dexNumbers.get(pokemon.id);
    return {
      id: pokemon.id,
      dex_number: dex?.dexNumber ?? pokemon.species_id,
      ...(dex?.shinyDexNumber === undefined ? {} : { shiny_dex_number: dex.shinyDexNumber }),
      name: pokemon.name,
      rarity: rarityForForm(pokemon, existingById.get(pokemon.id)),
    };
  });
  for (const entry of existing) {
    if (!catalogIds.has(entry.id) && !removedFormIds.has(entry.id)) {
      const preservedEntry = { ...entry };
      delete preservedEntry.catalog_id;
      rarities.push({
        ...preservedEntry,
        dex_number: entry.dex_number ?? entry.id,
      });
    }
  }
  rarities.sort((left, right) => left.id - right.id);

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(RARITIES_PATH, `${JSON.stringify(rarities, null, 2)}\n`);
  console.log(`Saved editable rarities for ${catalog.length} catalog Pokémon to ${RARITIES_PATH}.`);
  console.log('Existing rarity choices were preserved. Review and edit the rarity field as needed.');
}

try {
  main();
} catch (error) {
  console.error('Failed to sync Pokémon rarities:', error);
  process.exitCode = 1;
}
