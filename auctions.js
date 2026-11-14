const AUCTION_DURATION_MS = 48 * 60 * 60 * 1000;
const AUCTION_STARTING_BID_SQL = `COALESCE(a.starting_bid, CASE
  WHEN json_extract(a.pokemon_json, '$.pokemon_id') = 10190 THEN 1000
  WHEN lower(json_extract(a.pokemon_json, '$.rarity')) = 'gem' THEN 500
  WHEN json_extract(a.pokemon_json, '$.is_shiny') = 1
    OR json_extract(a.pokemon_json, '$.is_golden') = 1 THEN 100
  ELSE 50
END)`;
const AUCTION_NEXT_BID_SQL = `MAX(${AUCTION_STARTING_BID_SQL}, a.bid_amount + 1)`;

function createAuctions({ db, getUser, incrementUser, addUserItem, saveCatch, rebaseTransferredPokemon, syncNewCatchState }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pokemon_auctions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pokemon_json TEXT NOT NULL,
      source_user_id TEXT NOT NULL,
      starts_at INTEGER NOT NULL,
      ends_at INTEGER NOT NULL,
      ended_at INTEGER,
      bidder_id TEXT,
      bid_amount INTEGER NOT NULL DEFAULT 0,
      bid_count INTEGER NOT NULL DEFAULT 0,
      last_bid_at INTEGER,
      is_started INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS pokemon_auctions_active_idx ON pokemon_auctions(ended_at, ends_at);
    CREATE INDEX IF NOT EXISTS pokemon_auctions_bidder_idx ON pokemon_auctions(bidder_id, ended_at);
    CREATE INDEX IF NOT EXISTS market_seller_idx ON market(seller_id);
    CREATE TABLE IF NOT EXISTS pokemon_auction_bids (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      auction_id INTEGER NOT NULL,
      bidder_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      bid_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS pokemon_auction_bids_user_idx ON pokemon_auction_bids(bidder_id, auction_id);
    CREATE TABLE IF NOT EXISTS pokemon_auction_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      auction_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('created', 'settled')),
      delivered_at INTEGER,
      UNIQUE (auction_id, kind)
    );
    CREATE INDEX IF NOT EXISTS pokemon_auction_notifications_pending_idx
      ON pokemon_auction_notifications(delivered_at, id);
  `);
  if (!db.prepare('PRAGMA table_info(pokemon_auctions)').all().some((column) => column.name === 'starting_bid')) {
    db.exec('ALTER TABLE pokemon_auctions ADD COLUMN starting_bid INTEGER');
  }
  if (!db.prepare('PRAGMA table_info(pokemon_auctions)').all().some((column) => column.name === 'is_started')) {
    db.exec('ALTER TABLE pokemon_auctions ADD COLUMN is_started INTEGER NOT NULL DEFAULT 1');
  }

  const normalize = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  function eventNames() {
    const names = new Set();
    for (const event of db.prepare('SELECT name, match_names FROM event_pokemon').all()) {
      names.add(normalize(event.name));
      for (const name of JSON.parse(event.match_names)) names.add(normalize(name));
    }
    return names;
  }
  function eligible(mon, names, legendaryForms) {
    return Boolean(mon.is_shiny || mon.is_golden)
      || String(mon.rarity).toLowerCase() === 'gem'
      || String(mon.rarity).toLowerCase() === 'legendary'
      || legendaryForms.has(mon.pokemon_id)
      || mon.pokemon_id === 10190
      || (String(mon.rarity).toLowerCase() === 'super rare' && names.has(normalize(mon.name)));
  }
  function enqueue(mon, userId, now, startingBid = null, queued = false) {
    const result = db.prepare(`
      INSERT INTO pokemon_auctions (pokemon_json, source_user_id, starts_at, ends_at, starting_bid, is_started)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(JSON.stringify(mon), userId, now, queued ? now : now + AUCTION_DURATION_MS, startingBid, Number(!queued));
    if (!queued) {
      db.prepare("INSERT INTO pokemon_auction_notifications (auction_id, kind) VALUES (?, 'created')")
        .run(result.lastInsertRowid);
    }
  }
  function getEligibility() {
    const legendaryForms = new Set(db.prepare(`
      SELECT f.id FROM pokemon_forms f
      WHERE lower(f.rarity) = 'legendary' OR EXISTS (
        SELECT 1 FROM pokemon_forms base WHERE base.species_id = f.species_id
          AND base.is_default = 1 AND lower(base.rarity) = 'legendary'
      )
    `).all().map((row) => row.id));
    return { names: eventNames(), legendaryForms };
  }
  function confiscate(userId, now = Date.now(), criteria = getEligibility(), options = {}) {
    const { names, legendaryForms } = criteria;
    const shouldConfiscate = (mon) => eligible(mon, names, legendaryForms);
    let count = 0;
    const catches = db.prepare('SELECT * FROM catches WHERE user_id = ?').all(userId);
    const selected = catches.filter(shouldConfiscate);
    const heldGroups = new Map();
    for (const mon of catches) {
      const key = JSON.stringify([mon.pokemon_id, mon.is_shiny, mon.is_golden]);
      const group = heldGroups.get(key) || { remaining: false, item: null };
      if (!shouldConfiscate(mon)) group.remaining = true;
      else if (mon.held_item) group.item = mon.held_item;
      heldGroups.set(key, group);
    }
    for (const group of heldGroups.values()) {
      if (group.item && !group.remaining) addUserItem(userId, group.item);
    }
    const removed = new Set();
    for (const mon of selected) {
      enqueue(mon, userId, now, options.startingBid, Boolean(options.queued));
      db.prepare('UPDATE users SET buddy_catch_id = NULL WHERE id = ? AND buddy_catch_id = ?').run(userId, mon.id);
      db.prepare('DELETE FROM catches WHERE id = ? AND user_id = ?').run(mon.id, userId);
      removed.add(mon.id);
      count++;
    }
    if (removed.size) {
      for (const team of db.prepare('SELECT id, pokemon_ids FROM saved_teams WHERE user_id = ?').all(userId)) {
        const ids = JSON.parse(team.pokemon_ids);
        const remaining = ids.filter((id) => !removed.has(id));
        if (remaining.length !== ids.length) {
          db.prepare('UPDATE saved_teams SET pokemon_ids = ? WHERE id = ?').run(JSON.stringify(remaining), team.id);
        }
      }
    }
    for (const listing of db.prepare('SELECT * FROM market WHERE seller_id = ?').all(userId)) {
      if (!shouldConfiscate(listing)) continue;
      for (let i = 0; i < listing.amount; i++) {
        enqueue(listing, userId, now, options.startingBid, Boolean(options.queued));
        count++;
      }
      db.prepare('DELETE FROM market WHERE id = ?').run(listing.id);
    }
    for (const gift of db.prepare('SELECT * FROM pokemon_gifts WHERE recipient_id = ?').all(userId)) {
      if (!shouldConfiscate(gift)) continue;
      enqueue(gift, userId, now, options.startingBid, Boolean(options.queued));
      db.prepare('DELETE FROM pokemon_gifts WHERE id = ?').run(gift.id);
      count++;
    }
    return count;
  }

  function cancelLeadingBids(userId) {
    const bids = db.prepare(`
      SELECT id, bid_amount FROM pokemon_auctions WHERE ended_at IS NULL AND bidder_id = ?
    `).all(userId);
    for (const bid of bids) {
      incrementUser(userId, { patreon_tokens: bid.bid_amount });
      db.prepare('UPDATE pokemon_auctions SET bidder_id = NULL, bid_amount = 0, last_bid_at = NULL WHERE id = ?')
        .run(bid.id);
    }
  }

  function startQueued(now = Date.now(), limit = 50) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('Invalid auction start limit.');
    const startLimit = Math.min(limit, 50);
    return db.transaction(() => {
      const queued = db.prepare(`
        SELECT id FROM pokemon_auctions WHERE ended_at IS NULL AND is_started = 0 ORDER BY id LIMIT ?
      `).all(startLimit);
      const start = db.prepare(`
        UPDATE pokemon_auctions SET starts_at = ?, ends_at = ?, is_started = 1
        WHERE id = ? AND ended_at IS NULL AND is_started = 0
      `);
      const notify = db.prepare(
        "INSERT INTO pokemon_auction_notifications (auction_id, kind) VALUES (?, 'created')"
      );
      let count = 0;
      for (const auction of queued) {
        if (!start.run(now, now + AUCTION_DURATION_MS, auction.id).changes) continue;
        notify.run(auction.id);
        count++;
      }
      return count;
    }).immediate();
  }

  function settle(now = Date.now()) {
    return db.transaction(() => {
      const due = db.prepare(`
        SELECT * FROM pokemon_auctions
        WHERE ended_at IS NULL AND is_started = 1 AND ends_at <= ? ORDER BY id
      `).all(now);
      for (const auction of due) {
        const mon = JSON.parse(auction.pokemon_json);
        if (auction.bidder_id) {
          getUser(auction.bidder_id);
          const catchId = saveCatch(auction.bidder_id, {
            id: mon.pokemon_id, name: mon.name, rarity: mon.rarity,
          }, Boolean(mon.is_shiny), false, Boolean(mon.is_golden), mon.caught_ball);
          if (!rebaseTransferredPokemon(auction.bidder_id, catchId)
              || !syncNewCatchState(auction.bidder_id, catchId)) {
            throw new Error(`Could not restore Pokémon for auction ${auction.id}.`);
          }
        }
        db.prepare('UPDATE pokemon_auctions SET ended_at = ? WHERE id = ?').run(now, auction.id);
        db.prepare("INSERT INTO pokemon_auction_notifications (auction_id, kind) VALUES (?, 'settled')")
          .run(auction.id);
        if (!auction.bidder_id) {
          enqueue(mon, auction.source_user_id, now, auction.starting_bid);
        }
      }
      return due.length;
    }).immediate();
  }

  function bid(userId, id, amount, now = Date.now()) {
    if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(amount) || amount < 1) {
      return { error: 'invalid' };
    }
    return db.transaction(() => {
      const auction = db.prepare(`
        SELECT a.*, ${AUCTION_NEXT_BID_SQL} AS minimum_bid
        FROM pokemon_auctions a WHERE a.id = ? AND a.is_started = 1
      `).get(id);
      if (!auction || auction.ended_at !== null || auction.ends_at <= now) return { error: 'closed' };
      if (amount < auction.minimum_bid) return { error: 'too_low', minimum: auction.minimum_bid };
      const alreadyReserved = auction.bidder_id === userId ? auction.bid_amount : 0;
      const needed = amount - alreadyReserved;
      const user = getUser(userId);
      if (user.patreon_tokens < needed) return { error: 'insufficient', needed, balance: user.patreon_tokens };
      incrementUser(userId, { patreon_tokens: -needed });
      if (auction.bidder_id && auction.bidder_id !== userId) {
        incrementUser(auction.bidder_id, { patreon_tokens: auction.bid_amount });
      }
      db.prepare(`
        UPDATE pokemon_auctions SET bidder_id = ?, bid_amount = ?, bid_count = bid_count + 1, last_bid_at = ?
        WHERE id = ?
      `).run(userId, amount, now, id);
      db.prepare('INSERT INTO pokemon_auction_bids (auction_id, bidder_id, amount, bid_at) VALUES (?, ?, ?, ?)')
        .run(id, userId, amount, now);
      return { amount };
    }).immediate();
  }

  function list(userId, sort = 'default', history = false, page = 0, pageSize = 8) {
    const sorts = {
      default: 'a.ends_at ASC, a.id ASC',
      lowest: 'a.bid_amount ASC, a.id ASC',
      highest: 'a.bid_amount DESC, a.id ASC',
      golden: 'a.ends_at ASC, a.id ASC',
      outbid: 'a.ends_at ASC, a.id ASC',
      bids: 'a.bid_count DESC, a.id DESC',
      recent: 'last_user_bid DESC, a.id DESC',
    };
    if (!Object.hasOwn(sorts, sort)) throw new TypeError('Invalid auction sort.');
    if (!Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(pageSize) || pageSize < 1) {
      throw new TypeError('Invalid auction page.');
    }
    const balance = getUser(userId).patreon_tokens;
    let filter = '';
    const params = [];
    if (sort === 'golden') filter = " AND json_extract(a.pokemon_json, '$.is_golden') = 1";
    if (sort === 'outbid') {
      filter = ` AND COALESCE(a.bidder_id, '') != ? AND ${AUCTION_NEXT_BID_SQL} <= ?`;
      params.push(userId, balance);
    }
    if (sort === 'recent') {
      filter = ' AND EXISTS (SELECT 1 FROM pokemon_auction_bids b WHERE b.auction_id = a.id AND b.bidder_id = ?)';
      params.push(userId);
    }
    const where = `a.ended_at IS ${history ? 'NOT ' : ''}NULL${history ? '' : ' AND a.is_started = 1'}${filter}`;
    const count = db.prepare(`SELECT COUNT(*) AS count FROM pokemon_auctions a WHERE ${where}`).get(...params).count;
    const pages = Math.max(1, Math.ceil(count / pageSize));
    const currentPage = Math.min(page, pages - 1);
    const rows = db.prepare(`
      SELECT a.*, ${AUCTION_NEXT_BID_SQL} AS minimum_bid, (SELECT MAX(b.bid_at) FROM pokemon_auction_bids b
        WHERE b.auction_id = a.id AND b.bidder_id = ?) AS last_user_bid
      FROM pokemon_auctions a WHERE ${where}
      ORDER BY ${history && sort === 'default' ? 'a.ended_at DESC, a.id DESC' : sorts[sort]}
      LIMIT ? OFFSET ?
    `).all(userId, ...params, pageSize, currentPage * pageSize)
      .map((row) => ({ ...row, pokemon: JSON.parse(row.pokemon_json) }));
    return { rows, count, page: currentPage, pages };
  }

  function pendingNotifications(limit = 100) {
    return db.prepare(`
      SELECT n.id AS notification_id, n.kind, a.*,
        ${AUCTION_STARTING_BID_SQL} AS minimum_bid
      FROM pokemon_auction_notifications n
      JOIN pokemon_auctions a ON a.id = n.auction_id
      WHERE n.delivered_at IS NULL
      ORDER BY n.id LIMIT ?
    `).all(limit).map((row) => ({ ...row, pokemon: JSON.parse(row.pokemon_json) }));
  }

  function markNotificationsDelivered(ids) {
    const mark = db.prepare('UPDATE pokemon_auction_notifications SET delivered_at = ? WHERE id = ? AND delivered_at IS NULL');
    db.transaction(() => {
      const now = Date.now();
      for (const id of ids) mark.run(now, id);
    }).immediate();
  }

  return {
    getEligibility, confiscate, cancelLeadingBids, startQueued, settle, bid, list,
    pendingNotifications, markNotificationsDelivered,
  };
}

module.exports = { createAuctions, AUCTION_DURATION_MS };
