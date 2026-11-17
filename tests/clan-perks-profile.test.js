const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Database = require('better-sqlite3');

const dbSource = fs.readFileSync(require.resolve('../db.js'), 'utf8');

function extract(source, start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `Could not extract ${start}`);
  return source.slice(first, last);
}

test('legacy purchased clan perk ranks migrate to profiles once', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, clan_perk_rank INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE clan_members (user_id TEXT PRIMARY KEY, perk_rank INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE migration_flags (name TEXT PRIMARY KEY);
      INSERT INTO users VALUES ('legacy', 0), ('higher-profile', 5);
      INSERT INTO clan_members VALUES ('legacy', 3), ('higher-profile', 2);
    `);
    const ctx = vm.createContext({ db });
    const migration = extract(
      dbSource,
      `if (!db.prepare("SELECT 1 FROM migration_flags WHERE name = 'clan_perks_user_profile'").get()) {`,
      `\nif (!db.prepare("SELECT 1 FROM migration_flags WHERE name = 'joined_at_first_command'").get())`,
    );

    vm.runInContext(migration, ctx);
    assert.equal(db.prepare('SELECT clan_perk_rank FROM users WHERE id = ?').get('legacy').clan_perk_rank, 3);
    assert.equal(db.prepare('SELECT clan_perk_rank FROM users WHERE id = ?').get('higher-profile').clan_perk_rank, 5);
    assert.deepEqual(db.prepare('SELECT perk_rank FROM clan_members ORDER BY user_id').all(), [
      { perk_rank: 0 },
      { perk_rank: 0 },
    ]);

    db.prepare('UPDATE users SET clan_perk_rank = 0 WHERE id = ?').run('legacy');
    vm.runInContext(migration, ctx);
    assert.equal(db.prepare('SELECT clan_perk_rank FROM users WHERE id = ?').get('legacy').clan_perk_rank, 0);
  } finally {
    db.close();
  }
});

test('purchased clan perks stay active on the user profile after leaving the clan', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, coins INTEGER, clan_perk_rank INTEGER);
      CREATE TABLE clans (id INTEGER PRIMARY KEY, clan_rank TEXT);
      CREATE TABLE clan_members (
        user_id TEXT PRIMARY KEY, clan_id INTEGER, catches INTEGER, fishes INTEGER
      );
      INSERT INTO users VALUES ('member', 500000, 0);
      INSERT INTO clans VALUES (1, 'bronze');
      INSERT INTO clan_members VALUES ('member', 1, 100000, 0);
    `);

    const getUser = (userId) => db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    const ctx = vm.createContext({
      db,
      getUser,
      getPlayerClan: (userId) => db.prepare(`
        SELECT clans.*, clan_members.catches, clan_members.fishes,
          users.clan_perk_rank AS perk_rank
        FROM clan_members
        JOIN clans ON clans.id = clan_members.clan_id
        JOIN users ON users.id = clan_members.user_id
        WHERE clan_members.user_id = ?
      `).get(userId) || null,
      incrementUser: (userId, changes) => db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?')
        .run(changes.coins, userId),
    });

    const rankDefinitions = extract(dbSource, 'const CLAN_RANKS = [', '\n];') + '\n];';
    vm.runInContext(
      `${rankDefinitions}\n` +
      extract(dbSource, 'function getClanPerkMultipliers(', '\nfunction getTotalEffectiveShinyBonus') +
      extract(dbSource, 'function purchaseClanPerks(', '\nfunction getClanPerkPurchaseInfo'),
      ctx,
    );

    const result = ctx.purchaseClanPerks('member', 'bronze');
    assert.equal(result.error, undefined);
    assert.equal(getUser('member').clan_perk_rank, 1);
    assert.equal(getUser('member').coins, 400000);

    db.prepare('DELETE FROM clan_members WHERE user_id = ?').run('member');
    assert.equal(ctx.getClanPerkMultipliers(getUser('member')).crBonus, 1);
    assert.equal(ctx.getClanPerkMultipliers(getUser('member')).srBonus, 1);
  } finally {
    db.close();
  }
});
