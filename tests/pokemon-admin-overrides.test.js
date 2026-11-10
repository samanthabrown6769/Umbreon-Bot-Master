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
      CREATE TABLE pokemon_forms (id INTEGER PRIMARY KEY, slug TEXT, name TEXT, sprite TEXT, shiny_sprite TEXT);
      CREATE TABLE pokemon_admin_sprites (slug TEXT PRIMARY KEY, normal_url TEXT NOT NULL, shiny_url TEXT);
      CREATE TABLE pokemon_admin_emojis (slug TEXT NOT NULL, variant TEXT NOT NULL, emoji TEXT NOT NULL, PRIMARY KEY (slug, variant));
      INSERT INTO pokemon_forms VALUES (1, 'iron-bundle', 'Iron Bundle', 'catalog-normal', 'catalog-shiny');
    `);
    let animated;
    const records = new Map([['iron-bundle', { slug: 'iron-bundle', animated: 'catalog-animated', shinyAnimated: 'catalog-shiny-animated' }]]);
    const makeContext = () => {
      const context = vm.createContext({
        db, URL, loadPokemonDatabase: () => records, setSpriteOverrides: (value) => { animated = value; },
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
