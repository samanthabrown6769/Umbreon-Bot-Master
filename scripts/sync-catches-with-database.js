// Aligns stored catches (PC/box) with the current pokemon_forms catalog.
// Renamed forms get the catalog name/rarity; forms removed from the catalog are
// moved to their closest remaining form. Run: node scripts/sync-catches-with-database.js [--dry-run]
const { db } = require('../db');

const REMOVED_FORM_REPLACEMENTS = {
  'Tauros Paldea Blaze Breed': 'tauros',
  'Tauros Paldea Aqua Breed': 'tauros',
  'Paldea Tauros Blaze Breed': 'tauros',
  'Paldea Tauros Aqua Breed': 'tauros',
  'Araquanid Totem': 'araquanid',
  'Gumshoos Totem': 'gumshoos',
  'Togedemaru Totem': 'togedemaru',
  'Mimikyu Totem Disguised': 'mimikyu-disguised',
  'Mimikyu Totem Busted': 'mimikyu-busted',
  'Pumpkaboo Small': 'pumpkaboo-average',
  'Pumpkaboo Large': 'pumpkaboo-average',
  'Rockruff Own Tempo': 'rockruff',
  'Greninja Battle Bond': 'greninja',
  'Minior Orange Meteor': 'minior-orange',
  'Minior Yellow Meteor': 'minior-yellow',
};

const dryRun = process.argv.includes('--dry-run');
const formBySlug = db.prepare('SELECT * FROM pokemon_forms WHERE slug = ?');
const stale = db.prepare(`
  SELECT c.id, c.name, c.rarity, c.pokemon_id, p.id AS form_id
  FROM catches c LEFT JOIN pokemon_forms p ON p.id = c.pokemon_id
  WHERE p.id IS NULL OR c.name <> p.name OR c.rarity <> p.rarity
`).all();

const update = db.prepare('UPDATE catches SET pokemon_id = ?, name = ?, rarity = ? WHERE id = ?');
const syncFromCatalog = db.prepare(`
  UPDATE catches SET name = p.name, rarity = p.rarity
  FROM pokemon_forms p WHERE p.id = catches.pokemon_id AND catches.id = ?
`);
let renamed = 0;
let remapped = 0;
const unresolved = [];
db.transaction(() => {
  for (const row of stale) {
    if (row.form_id) {
      if (!dryRun) syncFromCatalog.run(row.id);
      renamed += 1;
      continue;
    }
    const target = REMOVED_FORM_REPLACEMENTS[row.name] && formBySlug.get(REMOVED_FORM_REPLACEMENTS[row.name]);
    if (!target) {
      unresolved.push(`${row.id} ${row.name}`);
      continue;
    }
    if (!dryRun) update.run(target.id, target.name, target.rarity, row.id);
    remapped += 1;
  }
})();
console.log(`${dryRun ? '[dry run] ' : ''}Renamed/synced: ${renamed}, remapped removed forms: ${remapped}`);
if (unresolved.length) console.log('Unresolved:', unresolved.join(', '));
