const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const catalog = require('../data/pokemon-catalog.json');
const rarities = require('../data/pokemon-rarities.json');
const referenceForms = require('../pokemon-database/formes.json');
const { appendCustomPokemonForms } = require('../scripts/pokemon-custom-forms');
const { getPokemonDexNumbers, getGoldenDexNumber } = require('../pokemon-dex-numbers');
const { getPokemonShowdownSprite } = require('../pokemon-sprites');
const { loadPokemonDatabase } = require('../pokemon-database');

const seasonalForms = [
  ['deerling-summer', 6321],
  ['sawsbuck-summer', 6323],
  ['deerling-autumn', 6325],
  ['sawsbuck-autumn', 6327],
  ['deerling-winter', 6329],
  ['sawsbuck-winter', 6331],
];

test('seasonal forms resolve all requested normal and shiny Dex numbers and sprites', () => {
  const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');
  const start = source.indexOf('function resolvePokemonForm(');
  const end = source.indexOf('\nfunction getHuntTargetSprite(', start);
  assert.ok(start >= 0 && end > start);
  const ctx = vm.createContext({
    db: { prepare: () => ({ all: () => catalog }) },
    getPokemonDexNumbers,
    getGoldenDexNumber,
  });
  vm.runInContext(source.slice(start, end), ctx);

  const numbers = getPokemonDexNumbers(catalog);
  for (const [slug, dexNumber] of seasonalForms) {
    const form = catalog.find((entry) => entry.slug === slug);
    assert.ok(form, `Missing ${slug}`);
    const values = numbers.get(form.id);
    assert.equal(values.dexNumber, dexNumber);
    assert.equal(values.shinyDexNumber, dexNumber + 1);
    for (const [number, shiny] of [[dexNumber, false], [dexNumber + 1, true]]) {
      const matches = catalog.filter((entry) => {
        const dex = numbers.get(entry.id);
        return dex.dexNumber === number || dex.shinyDexNumber === number;
      });
      assert.deepEqual(matches.map((entry) => entry.slug), [slug]);
      assert.equal(ctx.resolvePokemonForm(String(number)).slug, slug);
      assert.equal(
        getPokemonShowdownSprite(slug, shiny),
        `https://play.pokemonshowdown.com/sprites/${shiny ? 'ani-shiny' : 'ani'}/${slug}.gif`,
      );
    }
    const rarity = rarities.find((entry) => entry.id === form.id);
    const reference = referenceForms.find((entry) => entry.slug === slug);
    assert.equal(rarity.dex_number, dexNumber);
    assert.equal(rarity.shiny_dex_number, dexNumber + 1);
    assert.equal(reference.dex_number, dexNumber);
    assert.equal(reference.shiny_dex_number, dexNumber + 1);
    assert.equal(reference.animated_sprite, getPokemonShowdownSprite(slug));
    assert.equal(reference.shiny_animated_sprite, getPokemonShowdownSprite(slug, true));
  }
});

test('summer, autumn and winter Deerling and Sawsbuck remain Super Rare after import and regeneration', () => {
  const definitions = require('../data/custom-pokemon-forms.json');
  const customSlugs = new Set(definitions.map((entry) => entry.slug));
  const regenerated = catalog.filter((entry) => !customSlugs.has(entry.slug));
  appendCustomPokemonForms(regenerated);
  const imported = loadPokemonDatabase();
  for (const [slug] of seasonalForms) {
    const form = catalog.find((entry) => entry.slug === slug);
    assert.equal(form.rarity, 'Super Rare', slug);
    assert.equal(rarities.find((entry) => entry.id === form.id).rarity, 'Super Rare', slug);
    assert.equal(referenceForms.find((entry) => entry.slug === slug).rarity, 'Super Rare', slug);
    assert.equal(imported.get(slug).rarity, 'Super Rare', slug);
    assert.equal(regenerated.find((entry) => entry.slug === slug).rarity, 'Super Rare', slug);
  }
});

test('new seasonal forms survive catalog regeneration without renumbering existing forms', () => {
  const additions = new Set([
    'deerling-summer', 'sawsbuck-summer', 'deerling-winter', 'sawsbuck-winter',
  ]);
  const baseline = catalog.filter((entry) => !additions.has(entry.slug));
  const oldNumbers = getPokemonDexNumbers(baseline);
  const newNumbers = getPokemonDexNumbers(catalog);
  for (const entry of baseline) {
    assert.deepEqual(newNumbers.get(entry.id), oldNumbers.get(entry.id), entry.slug);
  }

  const definitions = require('../data/custom-pokemon-forms.json');
  const customSlugs = new Set(definitions.map((entry) => entry.slug));
  const regenerated = catalog.filter((entry) => !customSlugs.has(entry.slug));
  appendCustomPokemonForms(regenerated);
  for (const slug of additions) {
    assert.deepEqual(regenerated.find((entry) => entry.slug === slug), catalog.find((entry) => entry.slug === slug));
  }
});
