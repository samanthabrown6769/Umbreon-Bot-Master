const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Database = require('better-sqlite3');
const { CLONE_FORM_IDS, removeClonePokemon } = require('../remove-clone-pokemon');
const { getPokemonDexNumbers } = require('../pokemon-dex-numbers');

function makeDatabase() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, buddy_catch_id INTEGER, patreon_tokens INTEGER);
    CREATE TABLE catches (id INTEGER PRIMARY KEY, user_id TEXT, pokemon_id INTEGER, is_shiny INTEGER,
      is_golden INTEGER, held_item TEXT);
    CREATE TABLE user_items (user_id TEXT, item_name TEXT, amount INTEGER);
    CREATE TABLE market (pokemon_id INTEGER, is_shiny INTEGER DEFAULT 0, is_golden INTEGER DEFAULT 0);
    CREATE TABLE pokemon_gifts (pokemon_id INTEGER, is_shiny INTEGER DEFAULT 0, is_golden INTEGER DEFAULT 0);
    CREATE TABLE pokemon_user_seen_counts (pokemon_id INTEGER, is_shiny INTEGER DEFAULT 0, is_golden INTEGER DEFAULT 0);
    CREATE TABLE user_pokemon_state_snapshots (pokemon_id INTEGER, is_shiny INTEGER DEFAULT 0, is_golden INTEGER DEFAULT 0);
    CREATE TABLE global_collections (pokemon_id INTEGER, is_shiny INTEGER DEFAULT 0, is_golden INTEGER DEFAULT 0);
    CREATE TABLE pokemon_rarity_overrides (pokemon_id INTEGER);
    CREATE TABLE saved_teams (id INTEGER PRIMARY KEY, user_id TEXT, pokemon_ids TEXT);
    CREATE TABLE world_boss_registrations (boss_id INTEGER, user_id TEXT, team_pokemon_ids TEXT);
    CREATE TABLE pending_gifts (id INTEGER PRIMARY KEY, claimed INTEGER, pokemon_json TEXT, coins INTEGER);
    CREATE TABLE pokemon_auctions (id INTEGER PRIMARY KEY, pokemon_json TEXT, bidder_id TEXT,
      bid_amount INTEGER, ended_at INTEGER);
    CREATE TABLE pokemon_auction_bids (auction_id INTEGER);
    CREATE TABLE pokemon_auction_notifications (auction_id INTEGER);
    CREATE TABLE release_category_locks (user_id TEXT, category TEXT);
    CREATE TRIGGER snapshot_before_delete BEFORE DELETE ON catches BEGIN
      INSERT INTO user_pokemon_state_snapshots (pokemon_id, is_shiny, is_golden)
      VALUES (OLD.pokemon_id, OLD.is_shiny, OLD.is_golden);
    END;
  `);
  return db;
}

function helpers(db) {
  return {
    addUserItem: (userId, item) => db.prepare('INSERT INTO user_items VALUES (?, ?, 1)').run(userId, item),
    incrementUser: (userId, increments) => db.prepare(
      'UPDATE users SET patreon_tokens = patreon_tokens + ? WHERE id = ?'
    ).run(increments.patreon_tokens, userId),
  };
}

test('Clone forms stay excluded without changing any other Dex numbers', () => {
  const catalog = require('../data/pokemon-catalog.json');
  const rarities = require('../data/pokemon-rarities.json');
  const definitions = require('../data/custom-pokemon-forms.json');
  const removed = require('../data/removed-pokemon-forms.json');
  const referenceForms = require('../pokemon-database/formes.json');
  const clones = [
    { id: 20086, species_id: 25, slug: 'pikachu-clone', is_default: 0 },
    { id: 20087, species_id: 3, slug: 'venusaur-clone', is_default: 0 },
    { id: 20088, species_id: 6, slug: 'charizard-clone', is_default: 0 },
    { id: 20089, species_id: 9, slug: 'blastoise-clone', is_default: 0 },
  ];
  for (const clone of clones) {
    assert.ok(removed.some((entry) => entry.id === clone.id && entry.slug === clone.slug));
    assert.ok(!catalog.some((entry) => entry.id === clone.id || entry.slug === clone.slug));
    assert.ok(!rarities.some((entry) => entry.id === clone.id));
    assert.ok(!definitions.some((entry) => entry.slug === clone.slug));
    assert.ok(!referenceForms.some((entry) => entry.slug === clone.slug));
  }
  const original = getPokemonDexNumbers([...catalog, ...clones]);
  const current = getPokemonDexNumbers(catalog);
  for (const form of catalog) assert.deepEqual(current.get(form.id), original.get(form.id), form.slug);
  for (const id of CLONE_FORM_IDS) assert.equal(current.has(id), false);
});

test('startup removes Clone inventory and references, refunds auctions, and is repeatable', () => {
  const db = makeDatabase();
  db.exec(`
    INSERT INTO users VALUES ('owner', 1, 0), ('bidder', NULL, 5), ('other', 3, 0);
    INSERT INTO catches VALUES
      (1, 'owner', 20086, 0, 0, 'Lucky Egg'), (2, 'owner', 20086, 0, 0, 'Lucky Egg'),
      (3, 'other', 25, 0, 0, NULL), (4, 'owner', 20087, 1, 0, NULL);
    INSERT INTO user_pokemon_state_snapshots (pokemon_id) VALUES (20086), (25);
    INSERT INTO saved_teams VALUES (1, 'owner', '[1,3,4]'), (2, 'other', '[3,2]');
    INSERT INTO world_boss_registrations VALUES
      (1, 'owner', '[1,3]'), (2, 'owner', '[4]'), (3, 'other', '[3]');
    INSERT INTO pending_gifts VALUES
      (1, 0, '[{"pokemon_id":20086},{"pokemon_id":25}]', 100),
      (2, 1, '[{"pokemon_id":20087}]', 0);
    INSERT INTO pokemon_auctions VALUES
      (1, '{"pokemon_id":20087}', 'bidder', 40, NULL),
      (2, '{"pokemon_id":25}', 'bidder', 10, NULL),
      (3, '{"pokemon_id":20088}', 'bidder', 15, 123);
    INSERT INTO pokemon_auction_bids VALUES (1), (2), (3);
    INSERT INTO pokemon_auction_notifications VALUES (1), (2), (3);
    INSERT INTO release_category_locks VALUES
      ('owner', 'exact:20086:shiny'), ('owner', 'exact:25:base'), ('owner', 'species:25');
  `);
  for (const table of ['market', 'pokemon_gifts', 'pokemon_user_seen_counts',
    'global_collections', 'pokemon_rarity_overrides']) {
    db.prepare(`INSERT INTO ${table} (pokemon_id) VALUES (20086), (25)`).run();
  }
  removeClonePokemon(db, helpers(db));
  removeClonePokemon(db, helpers(db));
  assert.deepEqual(db.prepare('SELECT id FROM catches').all(), [{ id: 3 }]);
  assert.deepEqual(db.prepare('SELECT id, buddy_catch_id FROM users ORDER BY id').all(), [
    { id: 'bidder', buddy_catch_id: null }, { id: 'other', buddy_catch_id: 3 },
    { id: 'owner', buddy_catch_id: null },
  ]);
  assert.deepEqual(db.prepare('SELECT * FROM user_items').all(), [
    { user_id: 'owner', item_name: 'Lucky Egg', amount: 1 },
  ]);
  for (const table of ['market', 'pokemon_gifts', 'pokemon_user_seen_counts',
    'user_pokemon_state_snapshots', 'global_collections', 'pokemon_rarity_overrides']) {
    assert.deepEqual(db.prepare(`SELECT pokemon_id FROM ${table}`).all(), [{ pokemon_id: 25 }], table);
  }
  assert.deepEqual(db.prepare('SELECT pokemon_ids FROM saved_teams ORDER BY id').all(),
    [{ pokemon_ids: '[3]' }, { pokemon_ids: '[3]' }]);
  assert.deepEqual(db.prepare('SELECT boss_id, team_pokemon_ids FROM world_boss_registrations ORDER BY boss_id').all(),
    [{ boss_id: 1, team_pokemon_ids: '[3]' }, { boss_id: 3, team_pokemon_ids: '[3]' }]);
  assert.deepEqual(db.prepare('SELECT pokemon_json, coins FROM pending_gifts ORDER BY id').all(), [
    { pokemon_json: '[{"pokemon_id":25}]', coins: 100 }, { pokemon_json: '[{"pokemon_id":20087}]', coins: 0 },
  ]);
  assert.equal(db.prepare("SELECT patreon_tokens FROM users WHERE id = 'bidder'").get().patreon_tokens, 45);
  for (const table of ['pokemon_auctions', 'pokemon_auction_bids', 'pokemon_auction_notifications']) {
    const column = table === 'pokemon_auctions' ? 'id' : 'auction_id';
    assert.deepEqual(db.prepare(`SELECT ${column} AS id FROM ${table} ORDER BY id`).all(), [{ id: 2 }, { id: 3 }]);
  }
  assert.deepEqual(db.prepare('SELECT category FROM release_category_locks ORDER BY category').all(),
    [{ category: 'exact:25:base' }, { category: 'species:25' }]);
  db.close();
});

test('cleanup rolls back fully if refunding an auction fails', () => {
  const db = makeDatabase();
  db.exec(`
    INSERT INTO users VALUES ('owner', 1, 0), ('bidder', NULL, 0);
    INSERT INTO catches VALUES (1, 'owner', 20086, 0, 0, 'Lucky Egg');
    INSERT INTO market (pokemon_id) VALUES (20086);
    INSERT INTO pokemon_auctions VALUES (1, '{"pokemon_id":20086}', 'bidder', 10, NULL);
  `);
  assert.throws(() => removeClonePokemon(db, {
    ...helpers(db),
    incrementUser: () => { throw new Error('refund failed'); },
  }), /refund failed/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM catches').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM market').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_items').get().n, 0);
  assert.equal(db.prepare("SELECT buddy_catch_id FROM users WHERE id = 'owner'").get().buddy_catch_id, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pokemon_auctions').get().n, 1);
  db.close();
});

function loadVariantRemoval(db, overrides = {}) {
  db.exec(`
    CREATE TABLE pokemon_forms (id INTEGER PRIMARY KEY);
    CREATE TABLE removed_pokemon_variants (pokemon_id INTEGER, variant TEXT, PRIMARY KEY (pokemon_id, variant));
  `);
  const source = fs.readFileSync(require.resolve('../db.js'), 'utf8');
  const start = source.indexOf('function removePokemonVariant(');
  const end = source.indexOf('\nmodule.exports = {', start);
  assert.ok(start >= 0 && end > start);
  const ctx = vm.createContext({
    db, require: require('node:module').createRequire(require.resolve('../db.js')), ...helpers(db), ...overrides,
  });
  vm.runInContext(source.slice(start, end), ctx);
  return ctx.removePokemonVariant;
}

for (const [variant, shiny, golden] of [['base', 0, 0], ['shiny', 1, 0], ['golden', 0, 1]]) {
  test(`removing ${variant} preserves other variants and prevents new copies`, () => {
    const db = makeDatabase();
    const remove = loadVariantRemoval(db);
    db.exec(`
      INSERT INTO pokemon_forms VALUES (25);
      INSERT INTO users VALUES ('owner', 1, 0), ('bidder', NULL, 5);
      INSERT INTO catches VALUES
        (1, 'owner', 25, 0, 0, 'Lucky Egg'), (2, 'owner', 25, 1, 0, 'Lucky Egg'),
        (3, 'owner', 25, 0, 1, 'Lucky Egg');
      INSERT INTO saved_teams VALUES (1, 'owner', '[1,2,3]');
      INSERT INTO pending_gifts VALUES (1, 0,
        '[{"pokemon_id":25},{"pokemon_id":25,"is_shiny":1},{"pokemon_id":25,"is_golden":1}]', 10);
      INSERT INTO pokemon_auctions VALUES
        (1, '{"pokemon_id":25}', 'bidder', 10, NULL),
        (2, '{"pokemon_id":25,"is_shiny":1}', 'bidder', 20, NULL),
        (3, '{"pokemon_id":25,"is_golden":1}', 'bidder', 30, NULL);
      INSERT INTO pokemon_auction_bids VALUES (1), (2), (3);
      INSERT INTO pokemon_auction_notifications VALUES (1), (2), (3);
    `);
    for (const table of ['market', 'pokemon_gifts', 'pokemon_user_seen_counts',
      'user_pokemon_state_snapshots', 'global_collections']) {
      db.exec(`INSERT INTO ${table} VALUES (25,0,0), (25,1,0), (25,0,1)`);
    }
    assert.equal(remove(25, variant).removed, true);
    const removedId = variant === 'base' ? 1 : variant === 'shiny' ? 2 : 3;
    assert.deepEqual(db.prepare('SELECT id FROM catches ORDER BY id').all(),
      [1, 2, 3].filter((id) => id !== removedId).map((id) => ({ id })));
    assert.deepEqual(JSON.parse(db.prepare('SELECT pokemon_ids FROM saved_teams').get().pokemon_ids),
      [1, 2, 3].filter((id) => id !== removedId));
    assert.equal(db.prepare("SELECT buddy_catch_id FROM users WHERE id='owner'").get().buddy_catch_id,
      removedId === 1 ? null : 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_items').get().n, 1);
    for (const table of ['market', 'pokemon_gifts', 'pokemon_user_seen_counts',
      'user_pokemon_state_snapshots', 'global_collections']) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 2, table);
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE is_shiny=? AND is_golden=?`)
        .get(shiny, golden).n, 0, table);
    }
    assert.equal(JSON.parse(db.prepare('SELECT pokemon_json FROM pending_gifts').get().pokemon_json).length, 2);
    assert.equal(db.prepare("SELECT patreon_tokens FROM users WHERE id='bidder'").get().patreon_tokens,
      5 + removedId * 10);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pokemon_auction_bids WHERE auction_id=?').get(removedId).n, 0);
    assert.equal(remove(25, variant).error, 'already_removed');
    assert.throws(() => db.prepare(
      'INSERT INTO catches VALUES (4, ?, 25, ?, ?, NULL)'
    ).run('owner', shiny, golden), /removed from the game/);
    assert.throws(() => db.prepare(
      'INSERT INTO market VALUES (25, ?, ?)'
    ).run(shiny, golden), /removed from the game/);
    assert.throws(() => db.prepare(
      'INSERT INTO pokemon_gifts VALUES (25, ?, ?)'
    ).run(shiny, golden), /removed from the game/);
    const surviving = variant === 'base' ? [1, 0] : [0, 0];
    db.prepare('INSERT INTO catches VALUES (4, ?, 25, ?, ?, NULL)').run('owner', ...surviving);
    assert.throws(() => db.prepare('UPDATE catches SET is_shiny=?, is_golden=? WHERE id=4')
      .run(shiny, golden), /removed from the game/);
    db.close();
  });
}

test('variant removal and its tombstone roll back if an auction refund fails', () => {
  const db = makeDatabase();
  const remove = loadVariantRemoval(db, { incrementUser: () => { throw new Error('refund failed'); } });
  db.exec(`
    INSERT INTO pokemon_forms VALUES (25);
    INSERT INTO catches VALUES (1, 'owner', 25, 0, 0, NULL);
    INSERT INTO pokemon_auctions VALUES (1, '{"pokemon_id":25}', 'bidder', 10, NULL);
  `);
  assert.throws(() => remove(25, 'base'), /refund failed/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM catches').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM removed_pokemon_variants').get().n, 0);
  db.close();
});

test('admin remove interprets names and Pokédex numbers as exact variants', async () => {
  const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');
  const start = source.indexOf("      if (command === 'admin' && subtype === 'remove') {");
  const end = source.indexOf("\n      if (command === 'admin' && ['bud', 'buddy'].includes(subtype))", start);
  assert.ok(start >= 0 && end > start);
  const removals = [];
  const replies = [];
  let giveaways = [];
  const cancelled = [];
  const finishCancellations = [];
  const ctx = vm.createContext({
    command: 'admin', subtype: 'remove', args: [], action: null, PREFIX: '.',
    resolvePokemonForm: () => ({ id: 25, species_id: 25, slug: 'pikachu', name: 'Pikachu', is_default: 1 }),
    getDexQueryMarketVariant: (_form, query) => ({ '25': 'normal', '1025': 'shiny', '3025': 'golden' }[query] || null),
    isGoldenFormSupported: () => true,
    removePokemonVariant: (id, variant) => { removals.push([id, variant]); return { removed: true }; },
    db: { prepare: () => ({ all: () => giveaways }) },
    giveawayTimers: new Map(), clearTimeout: () => {},
    cancelCloneGiveaway: (giveaway) => {
      cancelled.push(giveaway.id);
      return new Promise((resolve) => finishCancellations.push(resolve));
    },
    message: { reply: async (text) => { replies.push(text); } },
  });
  vm.runInContext(`async function run() { ${source.slice(start, end)} }`, ctx);
  for (const [arguments_, action] of [
    [['remove', 'Pikachu'], 'pikachu'],
    [['remove', 'shiny', 'Pikachu'], 'shiny'],
    [['remove', 'golden', 'Pikachu'], 'golden'],
    [['remove', '25'], '25'],
    [['remove', '1025'], '1025'],
    [['remove', '3025'], '3025'],
  ]) {
    ctx.args = arguments_;
    ctx.action = action;
    await ctx.run();
  }
  assert.deepEqual(removals, [
    [25, 'base'], [25, 'shiny'], [25, 'golden'], [25, 'base'], [25, 'shiny'], [25, 'golden'],
  ]);
  assert.equal(replies.length, 6);
  giveaways = [
    { id: 1, prize_data: JSON.stringify({ pokemon: { id: 25, isShiny: true } }) },
    { id: 2, prize_data: JSON.stringify({ pokemon: { id: 25, isShiny: true } }) },
    { id: 3, prize_data: JSON.stringify({ pokemon: { id: 25, isGolden: true } }) },
  ];
  ctx.args = ['remove', 'shiny', 'Pikachu'];
  ctx.action = 'shiny';
  const pending = ctx.run();
  assert.deepEqual(cancelled, [1, 2]);
  finishCancellations.forEach((resolve) => resolve());
  await pending;
});

test('Clone giveaway cancellation disables its message and runs only once', async () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE active_giveaways (id INTEGER PRIMARY KEY, ended INTEGER); INSERT INTO active_giveaways VALUES (1, 0)');
  const edits = [];
  class Embed {
    setColor() { return this; }
    setTitle(value) { this.title = value; return this; }
    setDescription(value) { this.description = value; return this; }
    setTimestamp() { return this; }
  }
  const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');
  const start = source.indexOf('async function cancelCloneGiveaway(');
  const end = source.indexOf('\nasync function concludeGiveaway(', start);
  assert.ok(start >= 0 && end > start);
  const ctx = vm.createContext({
    db, EmbedBuilder: Embed, console,
    client: { channels: { fetch: async () => ({
      messages: { fetch: async () => ({ edit: async (value) => edits.push(value) }) },
    }) } },
  });
  vm.runInContext(source.slice(start, end), ctx);
  const giveaway = { id: 1, channel_id: 'channel', message_id: 'message', prize_title: 'Clone Pikachu' };
  await ctx.cancelCloneGiveaway(giveaway);
  await ctx.cancelCloneGiveaway(giveaway);
  assert.equal(db.prepare('SELECT ended FROM active_giveaways').get().ended, 1);
  assert.equal(edits.length, 1);
  assert.match(edits[0].embeds[0].title, /CANCELLED/);
  assert.equal(edits[0].components.length, 0);
  db.close();
});
