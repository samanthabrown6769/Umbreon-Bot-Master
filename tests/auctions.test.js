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
    CREATE TABLE temporary_banned_users (user_id TEXT PRIMARY KEY, banned_at INTEGER NOT NULL);
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

test('confiscation selects only eligible box, market and incoming gift Pokémon once', () => {
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
  assert.deepEqual(db.prepare('SELECT id FROM catches ORDER BY id').all(), [{ id: 4 }]);
  assert.equal(db.prepare('SELECT buddy_catch_id FROM users WHERE id = ?').get('source').buddy_catch_id, null);
  assert.equal(db.prepare('SELECT pokemon_ids FROM saved_teams').get().pokemon_ids, '[4]');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM market').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pokemon_gifts').get().n, 0);
  assert.equal(auctions.list('alice', 'golden').count, 1);
  db.close();
});

test('ban auction queues exclude non-qualifying rarity and start only on admin activation', () => {
  const { db, auctions } = setup();
  db.exec(`
    INSERT INTO catches VALUES
      (1,'source',1,'Event Form','Super Rare',0,0,NULL),
      (2,'source',2,'Ordinary SR','Super Rare',0,0,NULL),
      (3,'source',3,'Gem','Gem',0,0,NULL),
      (4,'source',4,'Ordinary','Common',0,0,NULL),
      (5,'source',5,'Legend','Legendary',0,0,NULL),
      (6,'source',6,'Shiny','Common',1,0,NULL),
      (7,'source',7,'Golden','Common',0,1,NULL),
      (8,'source',10190,'Eternamax','Common',0,0,NULL);
  `);
  const queued = db.transaction(() => auctions.confiscate('source', 1000, auctions.getEligibility(), {
    queued: true,
    startingBid: 10,
  }))();
  assert.equal(queued, 6);
  assert.equal(auctions.list('alice').count, 0);
  assert.equal(auctions.list('alice', 'default').count, 0);
  assert.deepEqual(auctions.bid('alice', 1, 10, 1000), { error: 'closed' });
  assert.equal(auctions.pendingNotifications().length, 0);
  assert.equal(auctions.startQueued(2000), 6);
  assert.equal(auctions.startQueued(3000), 0);
  assert.equal(auctions.list('alice').count, 6);
  assert.equal(auctions.list('alice').rows.some((row) => row.pokemon.name === 'Gem'), true);
  assert.equal(auctions.pendingNotifications().length, 6);
  assert.deepEqual(
    db.prepare('SELECT DISTINCT starts_at, ends_at, is_started FROM pokemon_auctions ORDER BY starts_at').all(),
    [{ starts_at: 2000, ends_at: 2000 + AUCTION_DURATION_MS, is_started: 1 }]
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM catches WHERE user_id = 'source'").get().n, 2);
  db.close();
});

test('auction queue lists pending auctions in FIFO order without active auctions', () => {
  const { db, auctions } = setup();
  db.exec(`
    INSERT INTO pokemon_auctions
      (pokemon_json, source_user_id, starts_at, ends_at, is_started)
    VALUES
      ('{"pokemon_id":1,"name":"First","rarity":"Legendary","is_shiny":0,"is_golden":0}', 'source', 1, 1, 0),
      ('{"pokemon_id":2,"name":"Active","rarity":"Legendary","is_shiny":0,"is_golden":0}', 'source', 1, 100, 1),
      ('{"pokemon_id":3,"name":"Second","rarity":"Legendary","is_shiny":0,"is_golden":0}', 'source', 1, 1, 0),
      ('{"pokemon_id":4,"name":"Third","rarity":"Legendary","is_shiny":0,"is_golden":0}', 'source', 1, 1, 0);
  `);

  const { rows, count } = auctions.queued(2);
  assert.equal(count, 3);
  assert.deepEqual(rows.map(({ pokemon }) => pokemon.name), ['First', 'Second']);
  assert.deepEqual(rows.map(({ minimum_bid }) => minimum_bid), [50, 50]);
  assert.throws(() => auctions.queued(0), /Invalid auction queue limit/);
  db.close();
});

test('ineligible auctions are removed, with bids refunded and event Super Rares kept', () => {
  const { db, auctions } = setup();
  db.exec(`
    INSERT INTO pokemon_auctions
      (id, pokemon_json, source_user_id, starts_at, ends_at, bidder_id, bid_amount, is_started)
    VALUES
      (1, '{"pokemon_id":1,"name":"Ordinary","rarity":"Common","is_shiny":0,"is_golden":0}',
        'source', 1000, 5000, 'alice', 50, 1),
      (2, '{"pokemon_id":2,"name":"Queued","rarity":"Rare","is_shiny":0,"is_golden":0}',
        'source', 1000, 1000, NULL, 0, 0),
      (5, '{"pokemon_id":5,"name":"Event Form","rarity":"Super Rare","is_shiny":0,"is_golden":0}',
        'source', 1000, 5000, NULL, 0, 1),
      (3, '{"pokemon_id":3,"name":"Shiny","rarity":"Common","is_shiny":1,"is_golden":0}',
        'source', 1000, 5000, NULL, 0, 1),
      (4, '{"pokemon_id":8,"name":"Legendary Form","rarity":"Rare","is_shiny":0,"is_golden":0}',
        'source', 1000, 5000, NULL, 0, 1);
    INSERT INTO pokemon_auction_bids (auction_id, bidder_id, amount, bid_at) VALUES (1, 'alice', 50, 1000);
    INSERT INTO pokemon_auction_notifications (auction_id, kind) VALUES
      (1, 'created'), (2, 'created'), (3, 'created'), (4, 'created'), (5, 'created');
    UPDATE users SET patreon_tokens = 1950 WHERE id = 'alice';
  `);

  assert.equal(auctions.removeIneligibleAuctions(), 2);
  assert.equal(auctions.removeIneligibleAuctions(), 0);
  assert.equal(db.prepare('SELECT id FROM pokemon_auctions ORDER BY id').all().map(({ id }) => id).join(','), '3,4,5');
  assert.equal(db.prepare("SELECT patreon_tokens FROM users WHERE id = 'alice'").get().patreon_tokens, 2000);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pokemon_auction_bids').get().n, 0);
  assert.deepEqual(auctions.pendingNotifications().map(({ id }) => id), [3, 4, 5]);
  db.close();
});

test('auction starts are capped at 10 active Pokémon', () => {
  const { db, auctions } = setup();
  const insert = db.prepare(`
    INSERT INTO catches (id, user_id, pokemon_id, name, rarity)
    VALUES (?, 'source', ?, ?, 'Legendary')
  `);
  db.transaction(() => {
    for (let id = 1; id <= 55; id++) insert.run(id, id, `Legendary ${id}`);
  })();
  assert.equal(db.transaction(() => auctions.confiscate('source', 1000, auctions.getEligibility(), {
    queued: true,
  }))(), 55);
  assert.equal(auctions.startQueued(2000, 100), 10);
  assert.equal(auctions.list('alice').count, 10);
  assert.equal(auctions.startQueued(3000), 0);
  assert.equal(auctions.list('alice').count, 10);
  assert.equal(auctions.settle(2000 + AUCTION_DURATION_MS), 10);
  assert.equal(auctions.startQueued(2001 + AUCTION_DURATION_MS), 10);
  assert.equal(auctions.list('alice').count, 10);
  db.close();
});

test('active auctions contain only one copy of each form and variant', () => {
  const { db, auctions } = setup();
  db.exec(`
    INSERT INTO pokemon_auctions (pokemon_json, source_user_id, starts_at, ends_at, is_started)
    VALUES
      ('{"pokemon_id":4931,"name":"Arceus Ghost","rarity":"Legendary","is_shiny":0,"is_golden":0}', 'source', 1, 100, 0),
      ('{"pokemon_id":4931,"name":"Arceus Ghost","rarity":"Legendary","is_shiny":0,"is_golden":0}', 'source', 1, 100, 0),
      ('{"pokemon_id":4931,"name":"Arceus Ghost","rarity":"Legendary","is_shiny":1,"is_golden":0}', 'source', 1, 100, 0),
      ('{"pokemon_id":4931,"name":"Arceus Ghost","rarity":"Legendary","is_shiny":0,"is_golden":1}', 'source', 1, 100, 0);
  `);

  assert.equal(auctions.startQueued(10), 3);
  assert.equal(auctions.list('alice').count, 3);
  assert.equal(auctions.startQueued(11), 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM pokemon_auctions WHERE ended_at IS NULL AND is_started = 0')
    .get().count, 1);
  db.close();
});

test('auction minimum bids follow Pokémon category, including overlapping variants', () => {
  const { db, auctions } = setup();
  db.exec(`
    UPDATE users SET patreon_tokens = 10000 WHERE id = 'alice';
    INSERT INTO catches VALUES
      (1,'source',1,'Legend Form','Legendary',0,0,NULL),
      (2,'source',2,'Legend','Legendary',0,0,NULL),
      (3,'source',3,'Shiny Legend','Legendary',1,0,NULL),
      (4,'source',4,'Golden','Common',0,1,NULL),
      (5,'source',10190,'Eternamax','Legendary',0,0,NULL),
      (6,'source',10190,'Eternamax','Legendary',1,0,NULL),
      (7,'source',7,'Gem Teddiursa','Gem',0,0,NULL),
      (8,'source',8,'Shiny Gem','Gem',1,0,NULL);
  `);
  db.transaction(() => auctions.confiscate('source', 1000))();
  for (const [id, minimum] of [[1, 50], [2, 50], [3, 100], [4, 100], [5, 1000], [6, 1000], [7, 500]]) {
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
  const firstBid = auctions.bid('alice', 1, 50, 2000);
  assert.equal(firstBid.amount, 50);
  assert.equal(firstBid.outbidUserId, null);
  assert.equal(firstBid.pokemon.name, 'Test');
  assert.equal(balance('alice'), 1950);
  assert.equal(auctions.bid('alice', 1, 53, 3000).pokemon.name, 'Test');
  assert.equal(balance('alice'), 1947);
  assert.equal(auctions.bid('bob', 1, 53, 4000).error, 'too_low');
  assert.equal(auctions.bid('bob', 1, 3001, 4000).error, 'insufficient');
  const outbid = auctions.bid('bob', 1, 54, 4000);
  assert.equal(outbid.amount, 54);
  assert.equal(outbid.outbidUserId, 'alice');
  assert.equal(outbid.pokemon.name, 'Test');
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

test('late bids extend auctions by two minutes up to five minutes beyond the original end', () => {
  const { db, auctions } = setup();
  db.exec("INSERT INTO catches VALUES (1,'source',1,'Test','Legendary',0,0,NULL)");
  db.transaction(() => auctions.confiscate('source', 1000))();
  const originalEnd = 1000 + AUCTION_DURATION_MS;
  const getEnd = () => db.prepare('SELECT ends_at FROM pokemon_auctions WHERE id = 1').get().ends_at;

  assert.equal(auctions.bid('alice', 1, 50, originalEnd - 2 * 60 * 1000 - 1).amount, 50);
  assert.equal(getEnd(), originalEnd);
  assert.equal(auctions.bid('bob', 1, 51, originalEnd - 2000).amount, 51);
  assert.equal(getEnd(), originalEnd + 2 * 60 * 1000);
  assert.equal(auctions.bid('alice', 1, 52, originalEnd + 2 * 60 * 1000 - 2000).amount, 52);
  assert.equal(getEnd(), originalEnd + 4 * 60 * 1000);
  assert.equal(auctions.bid('bob', 1, 53, originalEnd + 4 * 60 * 1000 - 2000).amount, 53);
  assert.equal(getEnd(), originalEnd + 5 * 60 * 1000);
  assert.equal(auctions.bid('alice', 1, 54, originalEnd + 5 * 60 * 1000 - 2000).amount, 54);
  assert.equal(getEnd(), originalEnd + 5 * 60 * 1000);
  db.close();
});

test('auction command DMs the displaced bidder only after a successful outbid', async () => {
  const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');
  const start = source.indexOf("      if (action === 'bid') {", source.indexOf("    if (command === 'auction'"));
  const end = source.indexOf('\n\n      const history =', start);
  assert.ok(start >= 0 && end > start);
  const dms = [];
  const replies = [];
  const errors = [];
  let result = { amount: 54, outbidUserId: 'alice', pokemon: { name: 'Mewtwo', is_shiny: 1, is_golden: 0 } };
  const context = vm.createContext({
    action: 'bid', args: ['bid', '1', '54'], userId: 'bob', PREFIX: '.', EMOJIS: { patreonToken: ':token:' },
    auctions: { bid: () => result },
    client: { users: { fetch: async (id) => ({ send: async (text) => dms.push([id, text]) }) } },
    message: { reply: async (text) => replies.push(text) },
    console: { error: (...args) => errors.push(args) },
  });
  vm.runInContext(`async function run() { ${source.slice(start, end)} }`, context);
  await context.run();
  assert.equal(dms.length, 1);
  assert.equal(dms[0][0], 'alice');
  assert.match(dms[0][1], /Shiny Mewtwo.*#1.*54.*refunded.*\.auc bid 1 55/);
  assert.match(replies[0], /Shiny Mewtwo.*#1/);
  result = { amount: 55, outbidUserId: 'alice', pokemon: { name: 'Mewtwo', is_shiny: 0, is_golden: 1 } };
  await context.run();
  assert.match(dms[1][1], /Golden Mewtwo.*#1/);
  result = { amount: 55, outbidUserId: null };
  result.pokemon = { name: 'Mewtwo', is_shiny: 1, is_golden: 0 };
  await context.run();
  result = { error: 'too_low', minimum: 56 };
  await context.run();
  assert.equal(dms.length, 2);
  context.client.users.fetch = async () => { throw new Error('DM unavailable'); };
  result = { amount: 56, outbidUserId: 'alice', pokemon: { name: 'Mewtwo', is_shiny: 0, is_golden: 0 } };
  await context.run();
  assert.equal(errors.length, 1);
  assert.match(replies.at(-1), /Bid/);
});

test('message client receives DM commands through channel partials', () => {
  const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');
  assert.match(source, /GatewayIntentBits\.DirectMessages/);
  assert.match(source, /partials:\s*\[Partials\.Channel\]/);
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

test('unsold auctions queue for a later start and cancelled leading bids refund their escrow', () => {
  const { db, auctions } = setup();
  db.exec("INSERT INTO catches VALUES (1,'source',1,'Test','Legendary',0,0,NULL)");
  db.transaction(() => auctions.confiscate('source', 1000))();
  auctions.bid('alice', 1, 50, 2000);
  db.transaction(() => auctions.cancelLeadingBids('alice'))();
  assert.equal(db.prepare("SELECT patreon_tokens FROM users WHERE id = 'alice'").get().patreon_tokens, 2000);
  assert.equal(auctions.settle(1000 + AUCTION_DURATION_MS), 1);
  assert.equal(auctions.list('alice').count, 0);
  assert.equal(auctions.startQueued(2000 + AUCTION_DURATION_MS), 1);
  const active = auctions.list('alice').rows;
  assert.equal(active.length, 1);
  assert.equal(active[0].bid_amount, 0);
  assert.equal(active[0].ends_at, 2000 + 2 * AUCTION_DURATION_MS);
  assert.equal(auctions.list('alice', 'default', true).count, 1);
  db.close();
});

test('starting auctions settles overdue auctions before starting the queued batch', () => {
  const { db, auctions } = setup();
  db.exec("INSERT INTO catches VALUES (1,'source',1,'Test','Legendary',0,0,NULL)");
  db.transaction(() => auctions.confiscate('source', 1000))();
  assert.equal(auctions.startQueued(1000 + AUCTION_DURATION_MS), 1);
  assert.equal(auctions.list('alice', 'default', true).count, 1);
  assert.equal(auctions.list('alice').rows[0].ends_at, 1000 + 2 * AUCTION_DURATION_MS);
  assert.deepEqual(auctions.pendingNotifications().map((row) => [row.kind, row.id]), [
    ['created', 1], ['created', 2],
  ]);
  db.close();
});

test('eligible auctions start at 10 tokens and preserve the price when queued again', () => {
  const { db, auctions } = setup();
  db.exec(`
    INSERT INTO catches VALUES (1,'source',1,'Legendary','Legendary',0,0,NULL);
    INSERT INTO market VALUES (1,'source',2,'Golden Market','Common',0,1,2);
    INSERT INTO pokemon_gifts VALUES (1,'source',3,'Shiny Gift','Common',1,0,NULL);
  `);
  assert.equal(db.transaction(() => auctions.confiscate('source', 1000, auctions.getEligibility(),
    { startingBid: 10 }))(), 4);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM catches WHERE user_id = 'source'").get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM market').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pokemon_gifts').get().n, 0);
  assert.deepEqual(auctions.bid('alice', 1, 9, 2000), { error: 'too_low', minimum: 10 });
  assert.equal(auctions.bid('alice', 1, 10, 2000).amount, 10);
  auctions.settle(1000 + AUCTION_DURATION_MS);
  assert.equal(auctions.startQueued(2000 + AUCTION_DURATION_MS), 2);
  assert.equal(auctions.list('alice').rows[0].minimum_bid, 10);
  db.close();
});

test('auction notifications include winners but not unsold auctions until restarted', () => {
  const { db, auctions } = setup();
  db.exec("INSERT INTO catches VALUES (1,'source',1,'First','Legendary',0,0,NULL), (2,'source',2,'Second','Legendary',0,0,NULL)");
  db.transaction(() => auctions.confiscate('source', 1000))();
  const created = auctions.pendingNotifications();
  assert.deepEqual(created.map((row) => row.kind), ['created', 'created']);
  auctions.markNotificationsDelivered([created[0].notification_id]);
  assert.deepEqual(auctions.pendingNotifications().map((row) => row.id), [2]);
  auctions.bid('alice', 1, 50, 2000);
  auctions.settle(1000 + AUCTION_DURATION_MS);
  const pending = auctions.pendingNotifications();
  assert.deepEqual(pending.map((row) => [row.kind, row.id]), [
    ['created', 2], ['settled', 1],
  ]);
  assert.equal(pending[1].bidder_id, 'alice');
  assert.equal(pending[1].bid_amount, 50);
  auctions.settle(1000 + AUCTION_DURATION_MS);
  assert.equal(auctions.pendingNotifications().length, 2);
  db.prepare("INSERT INTO pokemon_auction_notifications (auction_id, kind) VALUES (2, 'settled')").run();
  assert.equal(auctions.pendingNotifications().length, 2);
  assert.equal(auctions.startQueued(2000 + AUCTION_DURATION_MS), 1);
  assert.deepEqual(auctions.pendingNotifications().map((row) => [row.kind, row.id]), [
    ['created', 2], ['settled', 1], ['created', 3],
  ]);
  db.close();
});

test('upgrading an existing auction table preserves its minimum and does not announce old auctions', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE market (seller_id TEXT);
    CREATE TABLE pokemon_auctions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, pokemon_json TEXT NOT NULL, source_user_id TEXT NOT NULL,
      starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, ended_at INTEGER, bidder_id TEXT,
      bid_amount INTEGER NOT NULL DEFAULT 0, bid_count INTEGER NOT NULL DEFAULT 0, last_bid_at INTEGER
    );
    INSERT INTO pokemon_auctions (pokemon_json, source_user_id, starts_at, ends_at)
    VALUES ('{"pokemon_id":1,"name":"Old","rarity":"Legendary","is_shiny":0,"is_golden":0}', 'source', 1, 100000);
  `);
  const dependencies = { db, getUser: () => ({ patreon_tokens: 1000 }) };
  const auctions = createAuctions(dependencies);
  createAuctions(dependencies);
  assert.equal(auctions.list('alice').rows[0].minimum_bid, 50);
  assert.equal(auctions.pendingNotifications().length, 0);
  db.close();
});

test('announcement delivery retries failures and posts auction and winner details', async () => {
  const { db, auctions } = setup();
  db.exec("INSERT INTO catches VALUES (1,'source',1,'Test','Legendary',0,0,NULL)");
  db.transaction(() => auctions.confiscate('source', 1000))();
  const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');
  const start = source.indexOf('let auctionAnnouncementsInProgress = false;');
  const end = source.indexOf('\nlet serverDataExportInProgress', start);
  assert.ok(start >= 0 && end > start);
  const sent = [];
  const errors = [];
  let fail = true;
  const context = vm.createContext({
    auctions, EmbedBuilder, PREFIX: '.', EMOJIS: { patreonToken: ':token:' },
    getMarketListingEmojis: () => '',
    AUCTION_ANNOUNCEMENT_CHANNEL_ID: 'channel',
    AUCTION_PING_ROLE_ID: 'role',
    client: { channels: { fetch: async (id) => {
      assert.equal(id, 'channel');
      return { isTextBased: () => true, send: async (payload) => {
        if (fail) throw new Error('unavailable');
        sent.push(payload);
      } };
    } } },
    console: { error: (...args) => errors.push(args) },
  });
  vm.runInContext(source.slice(start, end), context);
  await context.sendAuctionAnnouncements();
  assert.equal(errors.length, 1);
  assert.equal(auctions.pendingNotifications().length, 1);
  fail = false;
  await context.sendAuctionAnnouncements();
  assert.match(sent[0].embeds[0].toJSON().description, /ID #1.*Test/);
  assert.equal(sent[0].content, '<@&role>');
  assert.deepEqual(Array.from(sent[0].allowedMentions.parse), []);
  assert.deepEqual(Array.from(sent[0].allowedMentions.roles), ['role']);
  auctions.bid('alice', 1, 50, 2000);
  auctions.settle(1000 + AUCTION_DURATION_MS);
  await context.sendAuctionAnnouncements();
  assert.match(sent[1].embeds[0].toJSON().description, /<@alice> won .*Test.*50/);
  assert.equal(auctions.pendingNotifications().length, 0);
  db.close();
});

test('auction announcements put no more than 20 Pokémon in each embed', async () => {
  const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');
  const start = source.indexOf('let auctionAnnouncementsInProgress = false;');
  const end = source.indexOf('\nlet serverDataExportInProgress', start);
  assert.ok(start >= 0 && end > start);
  const rows = Array.from({ length: 45 }, (_, index) => ({
    notification_id: index + 1,
    kind: 'created',
    id: index + 1,
    ends_at: 5000,
    minimum_bid: 10,
    pokemon: { name: `Pokemon ${index + 1}` },
  }));
  const sent = [];
  let pendingRows = rows;
  const context = vm.createContext({
    auctions: {
      pendingNotifications: (limit) => pendingRows.slice(0, limit),
      markNotificationsDelivered: (ids) => {
        const deliveredIds = new Set(ids);
        pendingRows = pendingRows.filter((row) => !deliveredIds.has(row.notification_id));
      },
    },
    EmbedBuilder, PREFIX: '.', EMOJIS: { patreonToken: ':token:' },
    AUCTION_ANNOUNCEMENT_CHANNEL_ID: 'channel',
    AUCTION_PING_ROLE_ID: 'role',
    getMarketListingEmojis: () => '',
    client: { channels: { fetch: async () => ({
      isTextBased: () => true,
      send: async (payload) => sent.push(payload),
    }) } },
    console,
  });
  vm.runInContext(source.slice(start, end), context);
  await context.sendAuctionAnnouncements();
  assert.deepEqual(
    sent.map((payload) => (payload.embeds[0].toJSON().description.match(/ID #/g) || []).length),
    [20, 20, 5]
  );
});

test('multiban is atomic and skips previously banned accounts', () => {
  const { db, auctions } = setup();
  db.exec(`
    CREATE TABLE banned_users (user_id TEXT PRIMARY KEY, banned_at INTEGER NOT NULL);
    INSERT INTO banned_users VALUES ('bob', 1);
    INSERT INTO catches VALUES
      (1,'source',1,'First','Legendary',0,0,NULL),
      (2,'alice',2,'Second','Legendary',0,0,NULL),
      (3,'bob',3,'Existing','Common',0,0,NULL);
  `);
  const source = fs.readFileSync(require.resolve('../db.js'), 'utf8');
  const start = source.indexOf('function banUser(');
  const end = source.indexOf('\nfunction wipeUserData(', start);
  const context = vm.createContext({ db, auctions, Date });
  vm.runInContext(source.slice(start, end), context);
  db.exec(`CREATE TRIGGER reject_second BEFORE INSERT ON pokemon_auctions
    WHEN NEW.source_user_id = 'alice' BEGIN SELECT RAISE(ABORT, 'queue failed'); END`);
  assert.throws(() => context.banUsers(['source', 'alice']), /queue failed/);
  assert.equal(context.isUserBanned('source'), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pokemon_auctions').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM catches').get().n, 3);
  db.exec('DROP TRIGGER reject_second');
  const results = context.banUsers(['source', 'alice', 'bob']);
  assert.deepEqual(Array.from(results, (row) => [row.userId, row.alreadyBanned, row.auctioned]), [
    ['source', false, 1], ['alice', false, 1], ['bob', true, 0],
  ]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM catches WHERE user_id = 'bob'").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pokemon_auctions WHERE is_started = 0").get().n, 2);
  db.close();
});

test('multiban rejects invalid targets and deduplicates valid IDs', async () => {
  const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');
  const start = source.indexOf("      if (command === 'admin' && subtype === 'multiban')");
  const end = source.indexOf("\n      if (command === 'admin' && ['ban'", start);
  assert.ok(start >= 0 && end > start);
  const calls = [];
  const replies = [];
  const context = vm.createContext({
    command: 'admin', subtype: 'multiban', PREFIX: '.', args: ['multiban', '123456789012345', 'bad'],
    banUsers: (ids) => {
      calls.push(Array.from(ids));
      return ids.map((userId) => ({ userId, alreadyBanned: false, auctioned: 2 }));
    },
    sendAuctionAnnouncements: async () => {},
    message: { reply: async (text) => replies.push(text) },
  });
  vm.runInContext(`async function run() { ${source.slice(start, end)} }`, context);
  await context.run();
  assert.match(replies[0], /Usage/);
  assert.equal(calls.length, 0);
  context.args = ['multiban', '123456789012345', '<@123456789012345>', '999999999999999'];
  await context.run();
  assert.deepEqual(calls, [['123456789012345', '999999999999999']]);
  assert.match(replies[1], /Banned \*\*2\*\* account\(s\); \*\*4\*\* eligible Pokémon queued/);
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

test('admin auction start activates queued auctions and announces them', async () => {
  const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');
  const start = source.indexOf("      if (command === 'admin' && subtype === 'auction')");
  const end = source.indexOf("\n      if (command === 'admin' && ['ban'", start);
  assert.ok(start >= 0 && end > start);
  const replies = [];
  const calls = [];
  const context = vm.createContext({
    command: 'admin', subtype: 'auction', action: 'start', args: ['auction', 'start'], PREFIX: '.',
    auctions: { startQueued: () => 3 },
    sendAuctionAnnouncements: async () => calls.push('announce'),
    message: { reply: async (text) => replies.push(text) },
  });
  vm.runInContext(`async function run() { ${source.slice(start, end)} }`, context);
  await context.run();
  assert.deepEqual(calls, ['announce']);
  assert.match(replies[0], /Started \*\*3\*\* queued Pokémon auctions/);
});

test('admin auction queue reports the next queued Pokémon in FIFO order', async () => {
  const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');
  const start = source.indexOf("      if (command === 'admin' && subtype === 'auction')");
  const end = source.indexOf("\n      if (command === 'admin' && ['ban'", start);
  assert.ok(start >= 0 && end > start);
  const replies = [];
  const context = vm.createContext({
    command: 'admin', subtype: 'auction', action: 'queue', args: ['auction', 'queue'], PREFIX: '.',
    auctions: {
      queued: (limit) => {
        assert.equal(limit, 10);
        return {
          count: 2,
          rows: [
            { id: 4, minimum_bid: 50, pokemon: { name: 'First', rarity: 'Legendary' } },
            { id: 7, minimum_bid: 100, pokemon: { name: 'Second', rarity: 'Common', is_shiny: 1 } },
          ],
        };
      },
    },
    message: { reply: async (text) => replies.push(text) },
  });
  vm.runInContext(`async function run() { ${source.slice(start, end)} }`, context);
  await context.run();
  assert.match(replies[0], /2 Pokémon waiting/);
  assert.match(replies[0], /#4\*\* — First \(Legendary\)/);
  assert.match(replies[0], /#7\*\* — Shiny Second \(Common\)/);
});

test('only the designated bot admin can use admin ban and wipe', async () => {
  const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');
  const start = source.indexOf("      if (command === 'admin' && ['ban', 'unban', 'wipe'].includes(subtype))");
  const end = source.indexOf("\n      if (command === 'admin' && subtype === 'clan' && action === 'delete')", start);
  assert.ok(start >= 0 && end > start);
  const handler = source.slice(start, end);

  for (const subtype of ['ban', 'wipe']) {
    const calls = [];
    const replies = [];
    const context = vm.createContext({
      BAN_WIPE_ADMIN_USER_ID: '1514082847609061541',
      command: 'admin', subtype, PREFIX: '.', args: [subtype, '123456789012345', 'confirm'],
      message: {
        author: { id: '426946381098254336' },
        mentions: { users: { first: () => null } },
        reply: async (text) => replies.push(text),
      },
      isUserBanned: () => false,
      banUser: (id) => calls.push(['ban', id]),
      wipeUserData: (id) => { calls.push(['wipe', id]); return {}; },
    });
    vm.runInContext(`async function run() { ${handler} }`, context);
    await context.run();
    assert.deepEqual(calls, []);
    assert.match(replies[0], /Only the designated bot admin/);
  }

  const calls = [];
  const context = vm.createContext({
    BAN_WIPE_ADMIN_USER_ID: '1514082847609061541',
    command: 'admin', subtype: 'ban', PREFIX: '.', args: ['ban', '123456789012345'],
    message: {
      author: { id: '1514082847609061541' },
      mentions: { users: { first: () => null } },
      reply: async () => {},
    },
    isUserBanned: () => false,
    banUser: (id) => { calls.push(id); return 0; },
  });
  vm.runInContext(`async function run() { ${handler} }`, context);
  await context.run();
  assert.deepEqual(calls, ['123456789012345']);

  const wipeCalls = [];
  const wipeContext = vm.createContext({
    BAN_WIPE_ADMIN_USER_ID: '1514082847609061541',
    command: 'admin', subtype: 'wipe', PREFIX: '.', args: ['wipe', '123456789012345', 'confirm'],
    message: {
      author: { id: '1514082847609061541' },
      mentions: { users: { first: () => null } },
      reply: async () => {},
    },
    wipeUserData: (id) => { wipeCalls.push(id); return {}; },
  });
  vm.runInContext(`async function run() { ${handler} }`, wipeContext);
  await wipeContext.run();
  assert.deepEqual(wipeCalls, ['123456789012345']);
});

test('commands targeting a banned user return their username, except admin unban', async () => {
  const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');
  const start = source.indexOf('async function getBannedCommandTargetName(');
  const end = source.indexOf('\nfunction shouldLogAdminCommand', start);
  assert.ok(start >= 0 && end > start);
  const bannedIds = new Set(['12345678901234567']);
  const fetchCalls = [];
  const context = vm.createContext({
    isUserBanned: (id) => bannedIds.has(id),
    isUserTemporarilyBanned: () => false,
    client: {
      users: {
        cache: new Map(),
        fetch: async (id) => {
          fetchCalls.push(id);
          return { username: 'BannedTrainer' };
        },
      },
    },
    console,
  });
  vm.runInContext(source.slice(start, end), context);
  const mentions = new Map([['12345678901234567', { username: 'MentionedTrainer' }]]);
  const message = { mentions: { users: mentions } };
  const mentionedTarget = await context.getBannedCommandTargetName(
    message, '.profile <@12345678901234567>', 'profile', ['<@12345678901234567>']
  );
  assert.equal(mentionedTarget.name, 'MentionedTrainer');
  assert.equal(mentionedTarget.temporary, false);
  const fetchedTarget = await context.getBannedCommandTargetName(
    { mentions: { users: new Map() } }, '.profile 12345678901234567', 'profile', ['12345678901234567']
  );
  assert.equal(fetchedTarget.name, 'BannedTrainer');
  assert.equal(fetchedTarget.temporary, false);
  assert.equal(
    await context.getBannedCommandTargetName({ mentions: { users: new Map() } }, '.admin unban 12345678901234567', 'admin', ['unban', '12345678901234567']),
    null
  );
  assert.deepEqual(fetchCalls, ['12345678901234567']);
});

test('temporary bans block access without removing Pokémon or player data and unban restores access', () => {
  const { db, auctions } = setup();
  db.exec('CREATE TABLE banned_users (user_id TEXT PRIMARY KEY, banned_at INTEGER NOT NULL)');
  db.exec("INSERT INTO catches VALUES (1,'alice',1,'Pikachu','Common',0,0,NULL)");
  const source = fs.readFileSync(require.resolve('../db.js'), 'utf8');
  const start = source.indexOf('function banUser(');
  const end = source.indexOf('\nfunction deleteClanByName(', start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({ db, auctions, Date });
  vm.runInContext(source.slice(start, end), context);

  assert.equal(context.tempBanUser('alice'), true);
  assert.equal(context.tempBanUser('alice'), false);
  assert.equal(context.isUserBanned('alice'), true);
  assert.equal(context.isUserTemporarilyBanned('alice'), true);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM catches WHERE user_id = 'alice'").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pokemon_auctions").get().n, 0);
  assert.equal(context.unbanUser('alice'), true);
  assert.equal(context.isUserBanned('alice'), false);
  assert.equal(context.unbanUser('alice'), false);
  db.close();
});

test('admin temp ban accepts both spellings and is limited to the designated admin', async () => {
  const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');
  const start = source.indexOf("      if (command === 'admin' && (subtype === 'tempban'");
  const end = source.indexOf("\n      if (command === 'admin' && ['ban', 'unban', 'wipe'].includes(subtype))", start);
  assert.ok(start >= 0 && end > start);
  const handler = source.slice(start, end);

  for (const [subtype, action, args] of [
    ['tempban', undefined, ['tempban', '123456789012345']],
    ['temp', 'ban', ['temp', 'ban', '123456789012345']],
  ]) {
    const calls = [];
    const replies = [];
    const context = vm.createContext({
      command: 'admin', subtype, action, PREFIX: '.', args,
      BAN_WIPE_ADMIN_USER_ID: '1514082847609061541',
      message: {
        author: { id: '1514082847609061541' },
        mentions: { users: { first: () => null } },
        reply: async (text) => replies.push(text),
      },
      isUserBanned: () => false,
      tempBanUser: (id) => calls.push(id),
    });
    vm.runInContext(`async function run() { ${handler} }`, context);
    await context.run();
    assert.deepEqual(calls, ['123456789012345']);
    assert.match(replies[0], /Pokémon and data are unchanged/);
    assert.match(replies[0], /contact the staff team/);
  }

  const replies = [];
  const context = vm.createContext({
    command: 'admin', subtype: 'tempban', action: undefined, PREFIX: '.',
    args: ['tempban', '123456789012345'],
    BAN_WIPE_ADMIN_USER_ID: '1514082847609061541',
    message: {
      author: { id: '426946381098254336' },
      mentions: { users: { first: () => null } },
      reply: async (text) => replies.push(text),
    },
    isUserBanned: () => false,
    tempBanUser: () => assert.fail('unauthorized temp ban should not run'),
  });
  vm.runInContext(`async function run() { ${handler} }`, context);
  await context.run();
  assert.match(replies[0], /Only the designated bot admin/);
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
  assert.equal(auctions.list('alice').count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pokemon_auctions WHERE is_started = 0').get().n, 2);
  assert.equal(auctions.startQueued(), 2);
  assert.equal(auctions.list('alice').count, 2);
  db.exec("INSERT INTO catches VALUES (2,'source',3,'Wipe','Legendary',0,0,NULL)");
  assert.equal(context.wipeUserData('source').auctioned, 1);
  assert.equal(auctions.list('alice').count, 3);
  assert.equal(context.isUserBanned('source'), true);
  db.close();
});
