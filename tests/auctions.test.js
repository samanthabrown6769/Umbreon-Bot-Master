const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { createAuctions, AUCTION_DURATION_MS } = require('../auctions');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder } = require('discord.js');

function setup(filename = ':memory:') {
  const db = new Database(filename);
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, patreon_tokens INTEGER DEFAULT 0, buddy_catch_id INTEGER);
    CREATE TABLE catches (id INTEGER PRIMARY KEY, user_id TEXT, pokemon_id INTEGER, name TEXT,
      rarity TEXT, is_shiny INTEGER DEFAULT 0, is_golden INTEGER DEFAULT 0, caught_ball TEXT);
    CREATE TABLE saved_teams (id INTEGER PRIMARY KEY, user_id TEXT, pokemon_ids TEXT);
    CREATE TABLE market (id INTEGER PRIMARY KEY, seller_id TEXT, pokemon_id INTEGER, name TEXT,
      rarity TEXT, is_shiny INTEGER DEFAULT 0, is_golden INTEGER DEFAULT 0, amount INTEGER);
    CREATE TABLE pokemon_gifts (id INTEGER PRIMARY KEY, recipient_id TEXT, pokemon_id INTEGER, name TEXT,
      rarity TEXT, is_shiny INTEGER DEFAULT 0, is_golden INTEGER DEFAULT 0, caught_ball TEXT);
    CREATE TABLE event_pokemon (name TEXT, match_names TEXT);
    CREATE TABLE pokemon_forms (id INTEGER PRIMARY KEY, species_id INTEGER, is_default INTEGER, rarity TEXT);
    INSERT INTO event_pokemon VALUES ('Event Form', '["Special Form"]');
    INSERT INTO pokemon_forms VALUES (8,8,1,'Legendary'), (9,8,0,'Mega');
    INSERT INTO users VALUES ('source', 0, 1), ('alice', 2000, NULL), ('bob', 3000, NULL);
  `);
  const getUser = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const incrementUser = (id, increments) => {
    db.prepare('UPDATE users SET patreon_tokens = patreon_tokens + ? WHERE id = ?')
      .run(increments.patreon_tokens, id);
    return getUser(id);
  };
  const saveCatch = (id, mon, shiny, _seen, golden, ball) => Number(db.prepare(`
    INSERT INTO catches (user_id, pokemon_id, name, rarity, is_shiny, is_golden, caught_ball)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, mon.id, mon.name, mon.rarity, Number(shiny), Number(golden), ball || null).lastInsertRowid);
  const returnedItems = [];
  const auctions = createAuctions({
    db, getUser, incrementUser, addUserItem: (id, item) => returnedItems.push([id, item]), saveCatch,
    rebaseTransferredPokemon: () => true, syncNewCatchState: () => true,
  });
  return { db, auctions, returnedItems };
}

test('confiscation selects eligible box, market and incoming gift Pokémon once', () => {
  const { db, auctions } = setup();
  db.exec(`
    INSERT INTO catches VALUES
      (1,'source',1,'Ordinary','Common',1,0,'pb'),
      (2,'source',2,'Legend','Legendary',0,0,NULL),
      (3,'source',3,'Special Form','Super Rare',0,0,NULL),
      (4,'source',4,'Ordinary SR','Super Rare',0,0,NULL),
      (5,'source',10190,'Eternamax','Common',0,0,NULL),
      (6,'source',9,'Legend Mega','Mega',0,0,NULL);
    INSERT INTO saved_teams VALUES (1,'source','[1,4,5]');
    INSERT INTO market VALUES (1,'source',6,'Golden','Common',0,1,2);
    INSERT INTO pokemon_gifts VALUES (1,'source',7,'Gift','Common',1,0,NULL);
  `);
  const confiscate = db.transaction(() => auctions.confiscate('source', 1000));
  assert.equal(confiscate(), 8);
  assert.equal(confiscate(), 0);
  assert.deepEqual(db.prepare('SELECT id FROM catches').all(), [{ id: 4 }]);
  assert.equal(db.prepare('SELECT buddy_catch_id FROM users WHERE id = ?').get('source').buddy_catch_id, null);
  assert.equal(db.prepare('SELECT pokemon_ids FROM saved_teams').get().pokemon_ids, '[4]');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM market').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pokemon_gifts').get().n, 0);
  assert.equal(auctions.list('alice', 'golden').count, 2);
  db.close();
});

test('auction minimum bids follow Pokémon category, including overlapping variants', () => {
  const { db, auctions } = setup();
  db.exec(`
    UPDATE users SET patreon_tokens = 10000 WHERE id = 'alice';
    INSERT INTO catches VALUES
      (1,'source',1,'Special Form','Super Rare',0,0,NULL),
      (2,'source',2,'Legend','Legendary',0,0,NULL),
      (3,'source',3,'Shiny Legend','Legendary',1,0,NULL),
      (4,'source',4,'Golden','Common',0,1,NULL),
      (5,'source',10190,'Eternamax','Legendary',0,0,NULL),
      (6,'source',10190,'Eternamax','Legendary',1,0,NULL);
  `);
  db.transaction(() => auctions.confiscate('source', 1000))();
  for (const [id, minimum] of [[1, 50], [2, 50], [3, 100], [4, 100], [5, 1000], [6, 1000]]) {
    assert.deepEqual(auctions.bid('alice', id, minimum - 1, 2000), { error: 'too_low', minimum });
    assert.equal(auctions.bid('alice', id, minimum, 2000).amount, minimum);
    assert.deepEqual(auctions.bid('bob', id, minimum, 3000), { error: 'too_low', minimum: minimum + 1 });
  }
  db.close();
});

test('outbid filter respects minimums and existing lower bids remain valid', () => {
  const { db, auctions } = setup();
  db.exec(`
    INSERT INTO catches VALUES
      (1,'source',1,'Legend','Legendary',0,0,NULL),
      (2,'source',2,'Shiny','Common',1,0,NULL),
      (3,'source',10190,'Eternamax','Legendary',0,0,NULL);
  `);
  db.transaction(() => auctions.confiscate('source', 1000))();
  db.prepare("UPDATE pokemon_auctions SET bidder_id = 'bob', bid_amount = 10, bid_count = 1 WHERE id = 1").run();
  const setBalance = db.prepare("UPDATE users SET patreon_tokens = ? WHERE id = 'alice'");
  for (const [balance, ids] of [[49, []], [50, [1]], [99, [1]], [100, [1, 2]], [999, [1, 2]], [1000, [1, 2, 3]]]) {
    setBalance.run(balance);
    assert.deepEqual(auctions.list('alice', 'outbid').rows.map((row) => row.id), ids);
  }
  assert.equal(auctions.list('alice').rows[0].minimum_bid, 50);
  assert.deepEqual(auctions.bid('alice', 1, 11, 2000), { error: 'too_low', minimum: 50 });
  assert.equal(auctions.settle(1000 + AUCTION_DURATION_MS), 3);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM catches WHERE user_id = 'bob'").get().n, 1);
  assert.equal(auctions.list('alice', 'default', true).rows.find((row) => row.id === 1).bid_amount, 10);
  db.close();
});

test('bids reserve tokens, refund outbid users, and settle exactly once', () => {
  const { db, auctions } = setup();
  db.exec("INSERT INTO catches VALUES (1,'source',1,'Test','Legendary',0,0,'pb')");
  db.transaction(() => auctions.confiscate('source', 1000))();
  const balance = (id) => db.prepare('SELECT patreon_tokens FROM users WHERE id = ?').get(id).patreon_tokens;
  assert.equal(auctions.bid('alice', 1, 50, 2000).amount, 50);
  assert.equal(balance('alice'), 1950);
  assert.equal(auctions.bid('alice', 1, 53, 3000).amount, 53);
  assert.equal(balance('alice'), 1947);
  assert.equal(auctions.bid('bob', 1, 53, 4000).error, 'too_low');
  assert.equal(auctions.bid('bob', 1, 3001, 4000).error, 'insufficient');
  assert.equal(auctions.bid('bob', 1, 54, 4000).amount, 54);
  assert.equal(balance('alice'), 2000);
  assert.equal(balance('bob'), 2946);
  assert.equal(auctions.list('alice', 'recent').count, 1);
  assert.equal(auctions.list('alice', 'outbid').count, 1);
  assert.equal(auctions.list('bob', 'outbid').count, 0);
  assert.equal(auctions.bid('alice', 1, 55, 1000 + AUCTION_DURATION_MS).error, 'closed');
  assert.equal(auctions.settle(1000 + AUCTION_DURATION_MS), 1);
  assert.equal(auctions.settle(1000 + AUCTION_DURATION_MS), 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM catches WHERE user_id = 'bob'").get().n, 1);
  assert.equal(balance('bob'), 2946);
  assert.equal(auctions.list('alice', 'default', true).rows[0].bid_count, 3);
  db.close();
});

test('confiscation returns a shared held item only when its last copy leaves', () => {
  const { db, auctions, returnedItems } = setup();
  db.exec(`
    ALTER TABLE catches ADD COLUMN held_item TEXT;
    INSERT INTO catches VALUES
      (1,'source',1,'Legend','Legendary',0,0,NULL,'Stone'),
      (2,'source',1,'Legend','Legendary',0,0,NULL,'Stone'),
      (3,'source',2,'Partial','Legendary',0,0,NULL,'Berry'),
      (4,'source',2,'Partial','Common',0,0,NULL,'Berry');
  `);
  db.transaction(() => auctions.confiscate('source', 1000))();
  assert.deepEqual(returnedItems, [['source', 'Stone']]);
  assert.equal(db.prepare('SELECT held_item FROM catches WHERE id = 4').get().held_item, 'Berry');
  db.close();
});

test('unsold auctions relist and cancelled leading bids refund their escrow', () => {
  const { db, auctions } = setup();
  db.exec("INSERT INTO catches VALUES (1,'source',1,'Test','Legendary',0,0,NULL)");
  db.transaction(() => auctions.confiscate('source', 1000))();
  auctions.bid('alice', 1, 50, 2000);
  db.transaction(() => auctions.cancelLeadingBids('alice'))();
  assert.equal(db.prepare("SELECT patreon_tokens FROM users WHERE id = 'alice'").get().patreon_tokens, 2000);
  assert.equal(auctions.settle(1000 + AUCTION_DURATION_MS), 1);
  const active = auctions.list('alice').rows;
  assert.equal(active.length, 1);
  assert.equal(active[0].bid_amount, 0);
  assert.equal(active[0].ends_at, 1000 + 2 * AUCTION_DURATION_MS);
  assert.equal(auctions.list('alice', 'default', true).count, 1);
  db.close();
});

test('auction command renders, sorts and bids using the auction service', async () => {
  const { db, auctions } = setup();
  db.exec(`
    INSERT INTO catches VALUES (1,'source',1,'Test','Legendary',0,0,NULL);
    INSERT INTO market VALUES (1,'source',2,'Gold','Common',0,1,1);
  `);
  db.transaction(() => auctions.confiscate('source'))();
  const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');
  const start = source.indexOf("    if (command === 'auction' ||");
  const end = source.indexOf("\n    if (command === 'market' ||", start);
  assert.ok(start >= 0 && end > start);
  const handlers = {};
  const replies = [];
  const context = vm.createContext({
    command: 'auction', args: [], userId: 'alice', PREFIX: '.', auctions,
    EMOJIS: { patreonToken: ':token:' }, getUser: (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id),
    getMarketListingEmojis: () => '', ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder,
    console, message: { reply: async (payload) => {
      replies.push(payload);
      return { createMessageComponentCollector: () => ({ on: (event, fn) => { handlers[event] = fn; } }) };
    } },
  });
  vm.runInContext(`async function run() { ${source.slice(start, end)} }`, context);
  await context.run();
  assert.match(replies[0].embeds[0].toJSON().description, /Golden Gold/);
  assert.match(replies[0].embeds[0].toJSON().description, /ID: 1/);
  assert.match(replies[0].embeds[0].toJSON().description, /Minimum bid: :token: \*\*50\*\*/);
  assert.match(replies[0].embeds[0].toJSON().description, /Minimum bid: :token: \*\*100\*\*/);
  let update;
  await handlers.collect({ user: { id: 'alice' }, customId: 'auction:sort', update: async (value) => { update = value; } });
  assert.match(update.embeds[0].toJSON().footer.text, /Can outbid/);
  context.args = ['bid', '1', '50'];
  await context.run();
  assert.match(replies[1], /Bid :token: \*\*50\*\*/);
  assert.equal(db.prepare("SELECT patreon_tokens FROM users WHERE id = 'alice'").get().patreon_tokens, 1950);
  db.close();
});

test('auction filters, bid ordering and pagination use the full result set', () => {
  const { db, auctions } = setup();
  const insert = db.prepare(`
    INSERT INTO catches (id, user_id, pokemon_id, name, rarity, is_shiny, is_golden)
    VALUES (?, 'source', ?, ?, 'Legendary', 0, ?)
  `);
  for (let i = 1; i <= 10; i++) insert.run(i, i, `Pokemon ${i}`, Number(i === 10));
  db.transaction(() => auctions.confiscate('source', 1000))();
  auctions.bid('bob', 1, 50, 2000);
  auctions.bid('bob', 2, 58, 3000);
  auctions.bid('alice', 3, 60, 4000);
  auctions.bid('bob', 3, 61, 5000);
  assert.equal(auctions.list('alice', 'highest').rows[0].id, 3);
  assert.equal(auctions.list('alice', 'bids').rows[0].id, 3);
  assert.equal(auctions.list('alice', 'golden').rows[0].id, 10);
  assert.equal(auctions.list('alice', 'recent').rows[0].id, 3);
  const outbid = auctions.list('alice', 'outbid', false, 1, 8);
  assert.equal(outbid.count, 10);
  assert.equal(outbid.pages, 2);
  assert.equal(outbid.rows.length, 2);
  assert.equal(auctions.list('alice', 'lowest').rows[0].bid_amount, 0);
  db.close();
});

test('failed delivery rolls back the entire settlement for retry', () => {
  const { db, auctions } = setup();
  db.exec("INSERT INTO catches VALUES (1,'source',1,'Test','Legendary',0,0,NULL)");
  db.transaction(() => auctions.confiscate('source', 1000))();
  auctions.bid('alice', 1, 50, 2000);
  db.exec("CREATE TRIGGER reject_delivery BEFORE INSERT ON catches BEGIN SELECT RAISE(ABORT, 'delivery failed'); END");
  assert.throws(() => auctions.settle(1000 + AUCTION_DURATION_MS), /delivery failed/);
  assert.equal(db.prepare('SELECT ended_at FROM pokemon_auctions WHERE id = 1').get().ended_at, null);
  assert.equal(db.prepare("SELECT patreon_tokens FROM users WHERE id = 'alice'").get().patreon_tokens, 1950);
  db.exec('DROP TRIGGER reject_delivery');
  assert.equal(auctions.settle(1000 + AUCTION_DURATION_MS), 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM catches WHERE user_id = 'alice'").get().n, 1);
  db.close();
});

test('active auctions and reserved bids survive a database reopen', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'auction-test-'));
  const filename = path.join(directory, 'auction.sqlite');
  let db;
  try {
    const setupResult = setup(filename);
    db = setupResult.db;
    db.exec("INSERT INTO catches VALUES (1,'source',1,'Test','Legendary',0,0,NULL)");
    db.transaction(() => setupResult.auctions.confiscate('source', 1000))();
    setupResult.auctions.bid('alice', 1, 50, 2000);
    db.close();
    db = new Database(filename);
    const auctions = createAuctions({
      db,
      getUser: (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id),
      incrementUser: (id, increments) => db.prepare('UPDATE users SET patreon_tokens = patreon_tokens + ? WHERE id = ?')
        .run(increments.patreon_tokens, id),
      addUserItem: () => {},
      saveCatch: (id, mon) => Number(db.prepare(`
        INSERT INTO catches (user_id, pokemon_id, name, rarity) VALUES (?, ?, ?, ?)
      `).run(id, mon.id, mon.name, mon.rarity).lastInsertRowid),
      rebaseTransferredPokemon: () => true,
      syncNewCatchState: () => true,
    });
    assert.equal(auctions.list('alice').rows[0].bid_amount, 50);
    assert.equal(db.prepare("SELECT patreon_tokens FROM users WHERE id = 'alice'").get().patreon_tokens, 1950);
    auctions.settle(1000 + AUCTION_DURATION_MS);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM catches WHERE user_id = 'alice'").get().n, 1);
    assert.equal(auctions.list('alice', 'default', true).count, 1);
  } finally {
    if (db && db.open) db.close();
    if (fs.existsSync(filename)) fs.unlinkSync(filename);
    fs.rmdirSync(directory);
  }
});

test('ban, backfill and wipe atomically move eligible Pokémon into auctions', () => {
  const { db, auctions } = setup();
  db.exec(`
    CREATE TABLE banned_users (user_id TEXT PRIMARY KEY, banned_at INTEGER NOT NULL);
    CREATE TABLE clans (id INTEGER PRIMARY KEY, bonus_catches INTEGER, bonus_fishes INTEGER,
      bonus_hatches INTEGER, bonus_swaps INTEGER, bonus_catchbot INTEGER, bonus_battles INTEGER);
    CREATE TABLE clan_members (user_id TEXT, clan_id INTEGER, catches INTEGER, fishes INTEGER,
      hatches INTEGER, swaps INTEGER, catchbot INTEGER, battles INTEGER, donated_coins INTEGER);
    CREATE TABLE clan_activity_periods (user_id TEXT);
    INSERT INTO catches VALUES (1,'source',1,'Test','Legendary',0,0,NULL);
  `);
  const source = fs.readFileSync(require.resolve('../db.js'), 'utf8');
  const start = source.indexOf('function banUser(');
  const end = source.indexOf('\nfunction deleteClanByName(', start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({ db, auctions, Date });
  vm.runInContext(source.slice(start, end), context);
  db.exec("CREATE TRIGGER reject_auction BEFORE INSERT ON pokemon_auctions BEGIN SELECT RAISE(ABORT, 'queue failed'); END");
  assert.throws(() => context.banUser('source'), /queue failed/);
  assert.equal(context.isUserBanned('source'), false);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM catches WHERE user_id = 'source'").get().n, 1);
  db.exec('DROP TRIGGER reject_auction');
  assert.equal(context.banUser('source'), 1);
  assert.equal(context.isUserBanned('source'), true);
  db.exec("INSERT INTO pokemon_gifts VALUES (1,'source',2,'Gift','Common',1,0,NULL)");
  context.backfillBannedAuctions();
  context.backfillBannedAuctions();
  assert.equal(auctions.list('alice').count, 2);
  db.exec("INSERT INTO catches VALUES (2,'source',3,'Wipe','Legendary',0,0,NULL)");
  assert.equal(context.wipeUserData('source').auctioned, 1);
  assert.equal(auctions.list('alice').count, 3);
  assert.equal(context.isUserBanned('source'), true);
  db.close();
});
