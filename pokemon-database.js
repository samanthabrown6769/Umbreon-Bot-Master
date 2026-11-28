const fs = require('node:fs');
const path = require('node:path');

const DATABASE_DIR = path.join(__dirname, 'pokemon-database');
const REQUESTED_OVERRIDES_PATH = path.join(DATABASE_DIR, 'z-requested-overrides.json');
const OVERRIDE_FIELDS = new Set([
  'name',
  'sprite',
  'shiny_sprite',
  'animated_sprite',
  'shiny_animated_sprite',
]);

// Reads every .json file in pokemon-database/ (including any you add) and merges the
// entries by slug. Shiny entries supply the shiny sprite/number; golden entries are ignored.
function readPokemonDatabase() {
  const bySlug = new Map();
  if (!fs.existsSync(DATABASE_DIR)) return bySlug;
  const files = fs.readdirSync(DATABASE_DIR).filter((file) => file.toLowerCase().endsWith('.json')).sort();
  for (const file of files) {
    let entries;
    try {
      entries = JSON.parse(fs.readFileSync(path.join(DATABASE_DIR, file), 'utf8'));
    } catch (error) {
      throw new Error(`pokemon-database/${file} is not valid JSON: ${error.message}`);
    }
    if (!Array.isArray(entries)) throw new Error(`pokemon-database/${file} must contain an array.`);
    for (const entry of entries) {
      if (!entry || typeof entry.slug !== 'string' || !entry.slug) continue;
      if (entry.variant === 'golden') continue;
      const record = bySlug.get(entry.slug) || { slug: entry.slug };
      const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
      const whole = (value) => (Number.isSafeInteger(value) && value > 0 ? value : null);
      if (file === 'z-requested-overrides.json') {
        record.adminDexNumber = whole(entry.admin_dex_number) ?? record.adminDexNumber;
        record.adminShinyDexNumber = whole(entry.admin_shiny_dex_number) ?? record.adminShinyDexNumber;
        record.adminGoldenDexNumber = whole(entry.admin_golden_dex_number) ?? record.adminGoldenDexNumber;
      }
      if (entry.variant === 'shiny') {
        record.shinySprite = text(entry.sprite) ?? record.shinySprite;
        if (!entry.is_default && entry.id !== entry.dex_number) {
          record.shinyDexNumber = whole(entry.dex_number) ?? record.shinyDexNumber;
        }
        record.shinyAnimated = text(entry.shiny_animated_sprite) ?? record.shinyAnimated;
      } else {
        record.entry = entry;
        record.name = text(entry.name) ?? record.name;
        record.rarity = text(entry.rarity) ?? record.rarity;
        record.sprite = text(entry.sprite) ?? record.sprite;
        if (entry.id !== entry.dex_number) {
          record.dexNumber = whole(entry.dex_number) ?? record.dexNumber;
        }
        record.animated = text(entry.animated_sprite) ?? record.animated;
        record.shinyAnimated = text(entry.shiny_animated_sprite) ?? record.shinyAnimated;
        record.shinySprite = text(entry.shiny_sprite) ?? record.shinySprite;
      }
      bySlug.set(entry.slug, record);
    }
  }
  return bySlug;
}

let cachedDatabase = null;
let cachedGoldenDexOverrides = null;
function loadPokemonDatabase() {
  if (!cachedDatabase) cachedDatabase = readPokemonDatabase();
  return cachedDatabase;
}

function getAdminGoldenDexOverrides() {
  if (!cachedGoldenDexOverrides) {
    cachedGoldenDexOverrides = new Map(
      [...loadPokemonDatabase().values()]
        .filter((record) => record.adminGoldenDexNumber)
        .map((record) => [record.slug, record.adminGoldenDexNumber])
    );
  }
  return cachedGoldenDexOverrides;
}

function updatePokemonDatabaseOverride(slug, updates) {
  if (typeof slug !== 'string' || !slug.trim()) throw new TypeError('A Pokémon form slug is required.');
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    throw new TypeError('Pokémon database updates must be an object.');
  }
  const fields = Object.keys(updates);
  if (!fields.length || fields.some((field) => !OVERRIDE_FIELDS.has(field))) {
    throw new TypeError('Pokémon database updates contain unsupported fields.');
  }
  for (const value of Object.values(updates)) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new TypeError('Pokémon database override values must be non-empty strings.');
    }
  }

  const entries = JSON.parse(fs.readFileSync(REQUESTED_OVERRIDES_PATH, 'utf8'));
  if (!Array.isArray(entries)) {
    throw new Error(`${REQUESTED_OVERRIDES_PATH} must contain an array.`);
  }
  let entry;
  for (const candidate of entries) {
    if (candidate?.slug === slug) entry = candidate;
  }
  if (!entry) {
    entry = { slug };
    entries.push(entry);
  }
  Object.assign(entry, updates);

  const temporaryPath = `${REQUESTED_OVERRIDES_PATH}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
    fs.renameSync(temporaryPath, REQUESTED_OVERRIDES_PATH);
  } catch (error) {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    throw error;
  }

  if (cachedDatabase) {
    const record = cachedDatabase.get(slug) || { slug };
    record.entry = { ...(record.entry || { slug }), ...updates };
    for (const [field, property] of [
      ['name', 'name'],
      ['sprite', 'sprite'],
      ['shiny_sprite', 'shinySprite'],
      ['animated_sprite', 'animated'],
      ['shiny_animated_sprite', 'shinyAnimated'],
    ]) {
      if (updates[field] !== undefined) record[property] = updates[field];
    }
    cachedDatabase.set(slug, record);
  }
  return entry;
}

function updatePokemonDexFiles(slug, variant, dexNumber) {
  const fields = {
    normal: ['admin_dex_number', 'dex_number', 'adminDexNumber'],
    shiny: ['admin_shiny_dex_number', 'shiny_dex_number', 'adminShinyDexNumber'],
    golden: ['admin_golden_dex_number', 'golden_dex_number', 'adminGoldenDexNumber'],
  };
  if (typeof slug !== 'string' || !slug.trim() || !fields[variant]
      || !Number.isSafeInteger(dexNumber) || dexNumber <= 0) {
    throw new TypeError('A Pokémon slug, valid variant, and positive Dex number are required.');
  }
  const [overrideField, catalogField, cacheField] = fields[variant];
  const catalogPath = path.join(__dirname, 'data', 'pokemon-catalog.json');
  const raritiesPath = path.join(__dirname, 'data', 'pokemon-rarities.json');
  const filenames = variant === 'golden' ? ['golden-dex.json']
    : variant === 'shiny' ? ['shiny-dex.json', 'shiny-mega.json', 'shiny-gmax.json', 'formes.json']
      : ['base-dex.json', 'mega.json', 'gmax.json', 'formes.json'];
  const readArray = (file) => {
    const text = fs.readFileSync(file, 'utf8');
    const entries = JSON.parse(text);
    if (!Array.isArray(entries)) throw new Error(`${file} must contain an array.`);
    return { file, text, entries };
  };
  const catalog = readArray(catalogPath);
  const catalogEntry = catalog.entries.find((entry) => entry.slug === slug);
  if (!catalogEntry) throw new Error(`Pokémon ${slug} is missing from the catalog.`);
  const datasets = filenames.map((filename) => readArray(path.join(DATABASE_DIR, filename)));
  const matches = datasets.flatMap((dataset) => dataset.entries
    .filter((entry) => entry.slug === slug)
    .map((entry) => ({ dataset, entry })));
  if (matches.length !== 1) {
    throw new Error(`Expected one ${variant} dex entry for ${slug}, found ${matches.length}.`);
  }
  const overrides = readArray(REQUESTED_OVERRIDES_PATH);
  let override = overrides.entries.find((entry) => entry.slug === slug);
  if (!override) {
    override = { slug };
    overrides.entries.push(override);
  }
  const rarities = readArray(raritiesPath);
  const rarity = rarities.entries.find((entry) => entry.id === catalogEntry.id);
  if (!rarity) throw new Error(`Pokémon ${slug} is missing from the rarity catalog.`);

  catalogEntry[catalogField] = dexNumber;
  override[overrideField] = dexNumber;
  const { dataset, entry } = matches[0];
  if (variant === 'shiny' && dataset.file.endsWith('formes.json')) {
    entry.shiny_dex_number = dexNumber;
  } else {
    if (variant !== 'golden' && !entry.is_default) entry.id = dexNumber;
    entry.dex_number = dexNumber;
    dataset.entries.sort((a, b) => a.dex_number - b.dex_number || a.id - b.id);
  }
  if (variant !== 'golden') rarity[catalogField] = dexNumber;

  const changes = [catalog, dataset, overrides, ...(variant === 'golden' ? [] : [rarities])];
  const written = [];
  try {
    for (const change of changes) {
      const temporaryPath = `${change.file}.${process.pid}.tmp`;
      try {
        const content = change === catalog
          ? JSON.stringify(change.entries)
          : JSON.stringify(change.entries, null, 2);
        fs.writeFileSync(temporaryPath, `${content}\n`, 'utf8');
        fs.renameSync(temporaryPath, change.file);
      } finally {
        if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
      }
      written.push(change);
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const change of written.reverse()) {
      try {
        fs.writeFileSync(change.file, change.text, 'utf8');
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length) {
      throw new AggregateError([error, ...rollbackErrors], 'Failed to update Pokémon dex files and restore all originals.');
    }
    throw error;
  }
  if (cachedDatabase) {
    const record = cachedDatabase.get(slug) || { slug };
    record[cacheField] = dexNumber;
    cachedDatabase.set(slug, record);
  }
  if (variant === 'golden' && cachedGoldenDexOverrides) {
    cachedGoldenDexOverrides.set(slug, dexNumber);
  }
}

module.exports = {
  DATABASE_DIR, loadPokemonDatabase, getAdminGoldenDexOverrides,
  updatePokemonDatabaseOverride, updatePokemonDexFiles,
};
