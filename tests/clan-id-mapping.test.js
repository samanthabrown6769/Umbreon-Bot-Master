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

for (const clanName of ["Mewtwo's Multiverse", 'Mewtwo’s Multiverse', 'Mewtwos Multiverse']) {
test(`clan ID renumbering assigns ${clanName} ID 2 and preserves references`, () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE clans (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
      CREATE TABLE clan_members (
        user_id TEXT PRIMARY KEY, clan_id INTEGER NOT NULL REFERENCES clans(id)
      );
      CREATE TABLE clan_activity_periods (
        clan_id INTEGER NOT NULL REFERENCES clans(id), user_id TEXT,
        PRIMARY KEY (clan_id, user_id)
      );
      INSERT INTO clans (id, name) VALUES
        (1, 'Ascension'), (2, 'Shadow Garden'), (3, 'Feral Faeries');
    `);
    db.prepare('INSERT INTO clans (id, name) VALUES (5, ?)').run(clanName);
    db.exec(`
      INSERT INTO clan_members VALUES
        ('ascension-member', 1), ('shadow-member', 2),
        ('faeries-member', 3), ('mewtwo-member', 5);
      INSERT INTO clan_activity_periods VALUES
        (1, 'ascension-member'), (2, 'shadow-member'),
        (3, 'faeries-member'), (5, 'mewtwo-member');
    `);

    vm.runInContext(
      extract(dbSource, 'const desiredClanIds = new Map([', "\nensureColumns('catchbot_data'"),
      vm.createContext({ db }),
    );

    assert.deepEqual(db.prepare('SELECT id, name FROM clans ORDER BY id').all(), [
      { id: 1, name: 'Ascension' },
      { id: 2, name: clanName },
      { id: 3, name: 'Shadow Garden' },
      { id: 4, name: 'Feral Faeries' },
    ]);
    assert.deepEqual(db.prepare('SELECT user_id, clan_id FROM clan_members ORDER BY user_id').all(), [
      { user_id: 'ascension-member', clan_id: 1 },
      { user_id: 'faeries-member', clan_id: 4 },
      { user_id: 'mewtwo-member', clan_id: 2 },
      { user_id: 'shadow-member', clan_id: 3 },
    ]);
    assert.deepEqual(db.prepare('SELECT clan_id, user_id FROM clan_activity_periods ORDER BY clan_id').all(), [
      { clan_id: 1, user_id: 'ascension-member' },
      { clan_id: 2, user_id: 'mewtwo-member' },
      { clan_id: 3, user_id: 'shadow-member' },
      { clan_id: 4, user_id: 'faeries-member' },
    ]);
  } finally {
    db.close();
  }
});
}
