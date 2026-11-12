const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const Database = require('better-sqlite3');

const dbSource = fs.readFileSync(require.resolve('../db.js'), 'utf8');
const indexSource = fs.readFileSync(require.resolve('../index.js'), 'utf8');

function extract(source, start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `Could not extract ${start}`);
  return source.slice(first, last);
}

test('Iron Bundle uses the requested normal and shiny sprite URLs', () => {
  const record = require('../pokemon-database').loadPokemonDatabase().get('iron-bundle');
  const normal = 'https://res.cloudinary.com/apffqia5/image/upload/v1794260477/ezgif.com-resize_2.webp';
  const shiny = 'https://res.cloudinary.com/apffqia5/image/upload/v1794260477/ezgif.com-resize_3.webp';
  assert.equal(record.sprite, normal);
  assert.equal(record.animated, normal);
  assert.equal(record.shinySprite, shiny);
  assert.equal(record.shinyAnimated, shiny);
});

test('admin sprite and emoji overrides survive a database reopen and catalog refresh', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pokemon-overrides-'));
  const filename = path.join(directory, 'test.sqlite');
  let db = new Database(filename);
  try {
    db.exec(`
      CREATE TABLE pokemon_forms (id INTEGER PRIMARY KEY, slug TEXT, name TEXT, sprite TEXT, shiny_sprite TEXT, species_id INTEGER, is_default INTEGER);
      CREATE TABLE pokemon_admin_sprites (slug TEXT PRIMARY KEY, normal_url TEXT NOT NULL, shiny_url TEXT);
      CREATE TABLE pokemon_admin_sprite_variants (slug TEXT NOT NULL, variant TEXT NOT NULL, url TEXT NOT NULL, PRIMARY KEY (slug, variant));
      CREATE TABLE pokemon_admin_emojis (slug TEXT NOT NULL, variant TEXT NOT NULL, emoji TEXT NOT NULL, PRIMARY KEY (slug, variant));
      INSERT INTO pokemon_forms VALUES (1, 'iron-bundle', 'Iron Bundle', 'catalog-normal', 'catalog-shiny', 991, 1);
    `);
    let animated;
    const records = new Map([['iron-bundle', { slug: 'iron-bundle', animated: 'catalog-animated', shinyAnimated: 'catalog-shiny-animated' }]]);
    const makeContext = () => {
      const context = vm.createContext({
        db, URL, loadPokemonDatabase: () => records, setSpriteOverrides: (value) => { animated = value; },
        setGoldenSpriteOverrides: () => {},
      });
      vm.runInContext(extract(dbSource, 'function updatePokemonSpriteLinks(', '\nconst pokemonMovesPath'), context);
      return context;
    };
    let context = makeContext();
    assert.throws(() => context.updatePokemonSpriteLinks(1, 'http://example.test/invalid'), /HTTPS/);
    context.updatePokemonSpriteLinks(1, 'https://example.test/normal', 'https://example.test/shiny');
    context.updatePokemonSpriteLinks(1, 'https://example.test/new-normal');
    assert.equal(animated.get('iron-bundle').shiny, 'https://example.test/shiny');
    context.setPokemonSpriteEmoji(1, 'normal', '<:IronBundle:123456789012345678>');
    context.setPokemonSpriteEmoji(1, 'shiny', '<a:ShinyBundle:123456789012345679>');
    assert.throws(() => context.setPokemonSpriteEmoji(1, 'normal', 'not-an-emoji'), /custom Discord emoji/);
    db.close();

    db = new Database(filename);
    db.prepare('UPDATE pokemon_forms SET sprite = ?, shiny_sprite = ? WHERE id = 1').run('new-catalog', 'new-shiny');
    context = makeContext();
    context.applyPokemonAdminSpriteOverrides();
    context.refreshPokemonSpriteOverrides();
    assert.deepEqual(db.prepare('SELECT sprite, shiny_sprite FROM pokemon_forms WHERE id = 1').get(), {
      sprite: 'https://example.test/new-normal', shiny_sprite: 'https://example.test/shiny',
    });
    assert.equal(animated.get('iron-bundle').normal, 'https://example.test/new-normal');
    assert.equal(animated.get('iron-bundle').shiny, 'https://example.test/shiny');
    const rows = context.getPokemonSpriteEmojiOverrides();
    assert.equal(rows.length, 2);
    assert.equal(rows.find((row) => row.variant === 'shiny').emoji, '<a:ShinyBundle:123456789012345679>');
  } finally {
    db.close();
    fs.unlinkSync(filename);
    fs.rmdirSync(directory);
  }
});

test('Dex variant sprite overrides are independent, immediate and persistent', () => {
  const { getGoldenSpriteUrl, setGoldenSpriteOverrides } = require('../golden-pokemon');
  const { getPokemonShowdownSprite, setSpriteOverrides } = require('../pokemon-sprites');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pokemon-variants-'));
  const filename = path.join(directory, 'test.sqlite');
  let db = new Database(filename);
  try {
    db.exec(`
      CREATE TABLE pokemon_forms (id INTEGER PRIMARY KEY, slug TEXT, name TEXT, sprite TEXT, shiny_sprite TEXT, species_id INTEGER, is_default INTEGER);
      CREATE TABLE pokemon_admin_sprites (slug TEXT PRIMARY KEY, normal_url TEXT NOT NULL, shiny_url TEXT);
      CREATE TABLE pokemon_admin_sprite_variants (slug TEXT NOT NULL, variant TEXT NOT NULL, url TEXT NOT NULL, PRIMARY KEY (slug, variant));
      INSERT INTO pokemon_forms VALUES (1, 'bulbasaur', 'Bulbasaur', 'catalog-normal', 'catalog-shiny', 1, 1);
      INSERT INTO pokemon_forms VALUES (2, 'vulpix-alola', 'Alolan Vulpix', 'regional-normal', 'regional-shiny', 37, 0);
      INSERT INTO pokemon_admin_sprites VALUES ('bulbasaur', 'https://example.test/legacy', 'https://example.test/legacy-shiny');
    `);
    const ctx = vm.createContext({ db, URL, loadPokemonDatabase: () => new Map(),
      setSpriteOverrides, setGoldenSpriteOverrides });
    vm.runInContext(extract(dbSource, 'function updatePokemonSpriteLinks(', '\nconst pokemonMovesPath'), ctx);
    ctx.applyPokemonAdminSpriteOverrides();
    ctx.refreshPokemonSpriteOverrides();
    const legacy = getPokemonShowdownSprite('bulbasaur');
    const legacyShiny = getPokemonShowdownSprite('bulbasaur', true);
    ctx.updatePokemonSpriteVariants(1, { golden: 'https://example.test/golden' });
    assert.equal(getGoldenSpriteUrl(1, 'bulbasaur'), 'https://example.test/golden');
    assert.equal(getGoldenSpriteUrl(1), 'https://example.test/golden');
    assert.equal(getPokemonShowdownSprite('bulbasaur'), legacy);
    assert.equal(getPokemonShowdownSprite('bulbasaur', true), legacyShiny);
    ctx.updatePokemonSpriteVariants(1, { shiny: 'https://example.test/shiny' });
    assert.equal(getPokemonShowdownSprite('bulbasaur'), legacy);
    assert.equal(getPokemonShowdownSprite('bulbasaur', true), 'https://example.test/shiny');
    ctx.updatePokemonSpriteVariants(1, { normal: 'https://example.test/normal' });
    ctx.updatePokemonSpriteVariants(2, { golden: 'https://example.test/regional' });
    assert.equal(getGoldenSpriteUrl(37, 'vulpix-alola'), 'https://example.test/regional');
    assert.notEqual(getGoldenSpriteUrl(37), 'https://example.test/regional');
    assert.throws(() => ctx.updatePokemonSpriteVariants(1, { golden: 'http://example.test/no' }), /HTTPS/);
    assert.throws(() => ctx.updatePokemonSpriteVariants(1, { invalid: 'https://example.test/no' }), /variant/);
    db.close();
    db = new Database(filename);
    ctx.db = db;
    db.prepare('UPDATE pokemon_forms SET sprite = ?, shiny_sprite = ? WHERE id = 1').run('fresh-catalog', 'fresh-shiny');
    setSpriteOverrides(new Map());
    setGoldenSpriteOverrides([]);
    ctx.applyPokemonAdminSpriteOverrides();
    ctx.refreshPokemonSpriteOverrides();
    assert.deepEqual(db.prepare('SELECT sprite, shiny_sprite FROM pokemon_forms WHERE id = 1').get(),
      { sprite: 'https://example.test/normal', shiny_sprite: 'https://example.test/shiny' });
    assert.equal(getPokemonShowdownSprite('bulbasaur'), 'https://example.test/normal');
    assert.equal(getPokemonShowdownSprite('bulbasaur', true), 'https://example.test/shiny');
    assert.equal(getGoldenSpriteUrl(1), 'https://example.test/golden');
  } finally {
    setSpriteOverrides(new Map());
    setGoldenSpriteOverrides([]);
    db.close();
    fs.unlinkSync(filename);
    fs.rmdirSync(directory);
  }
});

test('admin sprite command targets the exact Dex variant and retains name-based dual URLs', async () => {
  const writes = [];
  const replies = [];
  const form = { id: 1, name: 'Bulbasaur', slug: 'bulbasaur' };
  const context = vm.createContext({
    command: 'admin', subtype: 'pokemon', action: 'sprite', PREFIX: '.', args: [], URL,
    message: { reply: async (value) => { replies.push(value); return value; } },
    resolvePokemonForm: (query) => ['bulbasaur', '001', '1001', '9001'].includes(query.toLowerCase()) ? form : null,
    getDexQueryMarketVariant: (_form, query) => ({ '001': 'normal', '1001': 'shiny', '9001': 'golden' }[query] || null),
    updatePokemonSpriteVariants: (id, variants) => { writes.push({ id, variants }); return form; },
  });
  vm.runInContext(`async function run() { ${extract(indexSource, "      if (command === 'admin' && subtype === 'pokemon' && action === 'sprite') {", "\n      if (command === 'admin' && subtype === 'pokemon' && action === 'rarity')")} }`, context);
  for (const [query, variant] of [['001', 'normal'], ['1001', 'shiny'], ['9001', 'golden']]) {
    context.args = ['pokemon', 'sprite', query, 'https://example.test/sprite'];
    await context.run();
    assert.deepEqual(Object.keys(writes.at(-1).variants), [variant]);
  }
  context.args = ['pokemon', 'sprite', 'golden', 'bulbasaur', 'https://example.test/gold'];
  await context.run();
  assert.equal(writes.at(-1).variants.golden, 'https://example.test/gold');
  context.args = ['pokemon', 'sprite', 'bulbasaur', 'https://example.test/normal', 'https://example.test/shiny'];
  await context.run();
  assert.deepEqual(Object.keys(writes.at(-1).variants), ['normal', 'shiny']);
  const count = writes.length;
  context.args = ['pokemon', 'sprite', '9001', 'https://example.test/a', 'https://example.test/b'];
  await context.run();
  assert.match(replies.at(-1), /one sprite URL/);
  context.args = ['pokemon', 'sprite', 'shiny', '9001', 'https://example.test/a'];
  await context.run();
  assert.match(replies.at(-1), /does not match/);
  assert.equal(writes.length, count);
});

test('sprite emoji overrides apply by variant and retain built-in fallbacks', () => {
  const context = vm.createContext({});
  vm.runInContext(extract(indexSource, 'const POKEMON_SPRITE_EMOJIS =', '\nfunction formatFactionFavorites('), context);
  context.refreshPokemonSpriteEmojis([
    { slug: 'sprigatito', name: 'Sprigatito', variant: 'normal', emoji: '<:NewSprigatito:123456789012345678>' },
    { slug: 'iron-bundle', name: 'Iron Bundle', variant: 'shiny', emoji: '<a:Bundle:123456789012345679>' },
  ]);
  assert.equal(context.getPokemonSpriteEmoji({ name: 'Sprigatito' }), '<:NewSprigatito:123456789012345678>');
  assert.match(context.getPokemonSpriteEmoji({ name: 'Sprigatito', isShiny: true }), /1567588638194409512/);
  assert.equal(context.getPokemonSpriteEmoji({ form_slug: 'iron-bundle', isShiny: true }), '<a:Bundle:123456789012345679>');
  assert.equal(context.getPokemonSpriteEmoji({ name: 'Iron Bundle' }), '');
});

test('admin emoji command resolves names, variants, and dex numbers', async () => {
  const writes = [];
  const replies = [];
  const form = { id: 1, name: 'Iron Bundle', slug: 'iron-bundle' };
  const context = vm.createContext({
    command: 'admin', PREFIX: '.', args: [],
    message: { reply: async (value) => { replies.push(value); return value; } },
    resolvePokemonForm: (query) => ['Iron Bundle', '991', '1991', '9991'].includes(query) ? form : null,
    getDexQueryMarketVariant: (_form, query) => query === '991' ? 'normal' : query === '1991' ? 'shiny' : query === '9991' ? 'golden' : null,
    setPokemonSpriteEmoji: (id, variant, emoji) => { writes.push({ id, variant, emoji }); return form; },
    getPokemonSpriteEmojiOverrides: () => [],
    refreshPokemonSpriteEmojis: () => {},
  });
  const code = extract(indexSource,
    "      if (command === 'admin' && args.length >= 2",
    "\n      if (command === 'admin' && subtype === 'factionpoints')");
  vm.runInContext(`async function run() {
    const subtype = args[0]?.toLowerCase(); const action = args[1]?.toLowerCase(); ${code}
  }`, context);
  const emoji = '<:Bundle:123456789012345678>';
  for (const [args, variant] of [
    [['Iron', 'Bundle', 'emoji', emoji], 'normal'],
    [['shiny', 'Iron', 'Bundle', 'emoji', emoji], 'shiny'],
    [['shiny', '991', 'emoji', emoji], 'shiny'],
    [['1991', 'emoji', emoji], 'shiny'],
    [['9991', 'emoji', emoji], 'golden'],
  ]) {
    context.args = args;
    await context.run();
    assert.equal(writes.at(-1).variant, variant);
  }
  const count = writes.length;
  context.args = ['golden', '1991', 'emoji', emoji];
  await context.run();
  assert.match(replies.at(-1), /does not match/);
  context.args = ['Iron', 'Bundle', 'emoji', 'nope'];
  await context.run();
  assert.match(replies.at(-1), /Usage/);
  context.args = ['Iron', 'Bundle', 'emoji'];
  await context.run();
  assert.match(replies.at(-1), /Usage/);
  assert.equal(writes.length, count);
});
