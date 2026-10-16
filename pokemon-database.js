const fs = require('node:fs');
const path = require('node:path');

const DATABASE_DIR = path.join(__dirname, 'pokemon-database');

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
        record.shinyDexNumber = whole(entry.dex_number) ?? record.shinyDexNumber;
        record.shinyAnimated = text(entry.shiny_animated_sprite) ?? record.shinyAnimated;
      } else {
        record.entry = entry;
        record.name = text(entry.name) ?? record.name;
        record.rarity = text(entry.rarity) ?? record.rarity;
        record.sprite = text(entry.sprite) ?? record.sprite;
        record.dexNumber = whole(entry.dex_number) ?? record.dexNumber;
        record.shinyDexNumber = whole(entry.shiny_dex_number) ?? record.shinyDexNumber;
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

module.exports = { DATABASE_DIR, loadPokemonDatabase };
