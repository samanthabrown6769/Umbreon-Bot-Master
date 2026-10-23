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
function loadPokemonDatabase() {
  if (!cachedDatabase) cachedDatabase = readPokemonDatabase();
  return cachedDatabase;
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

module.exports = { DATABASE_DIR, loadPokemonDatabase, updatePokemonDatabaseOverride };
