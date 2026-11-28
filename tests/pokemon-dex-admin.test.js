const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');

test('dex updates persist by variant across reload and dex regeneration', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pokemon-dex-admin-'));
  try {
    for (const file of ['pokemon-database.js', 'pokemon-dex-numbers.js', 'golden-pokemon.js', 'pokemon-names.js']) {
      fs.copyFileSync(path.join(root, file), path.join(directory, file));
    }
    fs.cpSync(path.join(root, 'data'), path.join(directory, 'data'), { recursive: true });
    fs.cpSync(path.join(root, 'pokemon-database'), path.join(directory, 'pokemon-database'), { recursive: true });
    fs.mkdirSync(path.join(directory, 'scripts'));
    fs.copyFileSync(path.join(root, 'scripts', 'build-pokemon-database.js'),
      path.join(directory, 'scripts', 'build-pokemon-database.js'));

    const database = require(path.join(directory, 'pokemon-database.js'));
    const dex = require(path.join(directory, 'pokemon-dex-numbers.js'));
    const catalogFile = path.join(directory, 'data', 'pokemon-catalog.json');
    const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
    const gholdengo = catalog.find((entry) => entry.slug === 'gholdengo');
    const initial = dex.getPokemonDexNumbers(catalog).get(gholdengo.id);
    database.updatePokemonDexFiles('gholdengo', 'normal', 200001);
    database.updatePokemonDexFiles('gholdengo', 'shiny', 200002);
    database.updatePokemonDexFiles('gholdengo', 'golden', 200003);
    const updated = dex.getPokemonDexNumbers(catalog).get(gholdengo.id);
    assert.equal(updated.dexNumber, 200001);
    assert.equal(updated.shinyDexNumber, 200002);
    assert.equal(dex.getGoldenDexNumber(1000), 200003);
    assert.equal(dex.getGoldenSpeciesId(200003), 1000);
    assert.equal(dex.isGoldenDexNumber(200003), true);
    assert.equal(dex.getGoldenSpeciesId(10000), null);
    assert.notEqual(initial.dexNumber, updated.dexNumber);
    const indexSource = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
    const start = indexSource.indexOf('function resolvePokemonForm(');
    const end = indexSource.indexOf('\nfunction getHuntTargetSprite(', start);
    assert.ok(start >= 0 && end > start);
    const resolver = vm.createContext({
      db: { prepare: () => ({ all: () => catalog }) },
      getPokemonDexNumbers: dex.getPokemonDexNumbers,
      getGoldenDexNumber: dex.getGoldenDexNumber,
    });
    vm.runInContext(indexSource.slice(start, end), resolver);
    for (const number of [200001, 200002, 200003]) {
      assert.equal(resolver.resolvePokemonForm(String(number)).slug, 'gholdengo');
    }
    for (const number of [initial.dexNumber, initial.shinyDexNumber, 10000]) {
      assert.equal(resolver.resolvePokemonForm(String(number)), null);
    }
    const saved = JSON.parse(fs.readFileSync(catalogFile, 'utf8')).find((p) => p.slug === 'gholdengo');
    assert.equal(saved.id, gholdengo.id);
    assert.equal(saved.species_id, gholdengo.species_id);
    assert.equal(saved.dex_number, 200001);
    assert.equal(saved.shiny_dex_number, 200002);
    assert.equal(saved.golden_dex_number, 200003);

    const build = spawnSync(process.execPath, [path.join(directory, 'scripts', 'build-pokemon-database.js')], {
      cwd: directory, encoding: 'utf8',
    });
    assert.equal(build.status, 0, build.stderr);
    for (const [file, number] of [
      ['base-dex.json', 200001], ['shiny-dex.json', 200002], ['golden-dex.json', 200003],
    ]) {
      const entries = JSON.parse(fs.readFileSync(path.join(directory, 'pokemon-database', file), 'utf8'));
      assert.equal(entries.find((entry) => entry.slug === 'gholdengo').dex_number, number);
    }

    const regional = catalog.find((entry) => entry.slug === 'vulpix-alola');
    const originalGolden = dex.getGoldenDexNumber(regional.species_id, regional.slug);
    const originalShiny = dex.getPokemonDexNumbers(catalog).get(regional.id).shinyDexNumber;
    database.updatePokemonDexFiles(regional.slug, 'normal', 200004);
    assert.equal(dex.getPokemonDexNumbers(catalog).get(regional.id).shinyDexNumber, originalShiny);
    database.updatePokemonDexFiles(regional.slug, 'shiny', 200005);
    database.updatePokemonDexFiles(regional.slug, 'golden', 200006);
    assert.equal(dex.getGoldenDexNumber(regional.species_id, regional.slug), 200006);
    assert.equal(dex.isGoldenDexNumber(200006), true);
    assert.equal(dex.isGoldenDexNumber(originalGolden), false);
    const forms = JSON.parse(fs.readFileSync(path.join(directory, 'pokemon-database', 'formes.json'), 'utf8'));
    const entry = forms.find((form) => form.slug === regional.slug);
    assert.equal(entry.dex_number, 200004);
    assert.equal(entry.shiny_dex_number, 200005);
    const rebuild = spawnSync(process.execPath, [path.join(directory, 'scripts', 'build-pokemon-database.js')], {
      cwd: directory, encoding: 'utf8',
    });
    assert.equal(rebuild.status, 0, rebuild.stderr);
    const rebuiltForms = JSON.parse(fs.readFileSync(path.join(directory, 'pokemon-database', 'formes.json'), 'utf8'));
    assert.equal(rebuiltForms.find((form) => form.slug === regional.slug).dex_number, 200004);
    assert.equal(rebuiltForms.find((form) => form.slug === regional.slug).shiny_dex_number, 200005);
    const rebuiltGolden = JSON.parse(fs.readFileSync(path.join(directory, 'pokemon-database', 'golden-dex.json'), 'utf8'));
    assert.equal(rebuiltGolden.find((form) => form.slug === regional.slug).dex_number, 200006);
    const before = fs.readFileSync(catalogFile, 'utf8');
    assert.throws(() => database.updatePokemonDexFiles('not-in-catalog', 'normal', 200007), /missing from the catalog/);
    assert.equal(fs.readFileSync(catalogFile, 'utf8'), before);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('admin dex command validates numbers, collisions, and exact variants', async () => {
  const source = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
  const start = source.indexOf("      if (command === 'admin' && action === 'update') {");
  const end = source.indexOf("\n      if (command === 'admin' && subtype === 'remove')", start);
  assert.ok(start >= 0 && end > start);
  const form = { id: 1, species_id: 1, slug: 'bulbasaur', name: 'Bulbasaur', is_default: 1 };
  const calls = [];
  const replies = [];
  const context = vm.createContext({
    command: 'admin', action: 'update', args: [], PREFIX: '.',
    db: { prepare: () => ({ all: () => [form] }) },
    getPokemonDexNumbers: () => new Map([[1, { dexNumber: 1, shinyDexNumber: 1001 }]]),
    getGoldenDexNumber: () => 9001,
    isGoldenFormSupported: () => true,
    updatePokemonDexFiles: (...args) => calls.push(args),
    message: { reply: async (value) => replies.push(value) },
    marketDexNumbersByFormId: new Map(),
    console,
  });
  vm.runInContext(`async function run() { ${source.slice(start, end)} }`, context);
  for (const [old, variant] of [['1', 'normal'], ['1001', 'shiny'], ['9001', 'golden']]) {
    context.args = [old, 'update', '200001'];
    await context.run();
    assert.deepEqual(calls.at(-1), ['bulbasaur', variant, 200001]);
    assert.equal(context.marketDexNumbersByFormId, null);
  }
  const count = calls.length;
  for (const args of [
    ['1', 'update', '1001'], ['1', 'update', '0'], ['1', 'update', '1.5'],
    ['999999', 'update', '200001'], ['1', 'update', '9007199254740992'],
  ]) {
    context.args = args;
    await context.run();
    assert.match(replies.at(-1), /❌|Usage/);
  }
  assert.equal(calls.length, count);
  context.getPokemonDexNumbers = () => new Map([[1, { dexNumber: 1, shinyDexNumber: 1 }]]);
  context.args = ['1', 'update', '200001'];
  await context.run();
  assert.match(replies.at(-1), /ambiguous/);
  assert.equal(calls.length, count);
});
