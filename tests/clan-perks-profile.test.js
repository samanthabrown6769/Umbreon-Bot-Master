const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
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
      extract(dbSource, 'function getClanPerkCatchRequirement(', '\nfunction getClanRankInfo') +
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

test('clan perk catch requirements use the documented member divisor', () => {
  const ctx = vm.createContext({});
  const ranks = extract(dbSource, 'const CLAN_RANKS = [', '\n];') + '\n];';
  const requirement = extract(
    dbSource,
    'function getClanPerkCatchRequirement(',
    '\nfunction getClanRankInfo'
  );
  vm.runInContext(`${ranks}\n${requirement}`, ctx);

  const clanRanks = vm.runInContext('CLAN_RANKS', ctx);
  const rank = (name) => clanRanks.find((entry) => entry.name === name);
  assert.equal(ctx.getClanPerkCatchRequirement(rank('bronze'), 20), 5000);
  assert.equal(ctx.getClanPerkCatchRequirement(rank('amethyst'), 65), 115384);
  assert.equal(ctx.getClanPerkCatchRequirement(rank('onyx'), 75), 200000);
});

test('Onyx and Golden Patreon perks provide six quest slots', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE active_quests (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL,
        slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 6), quest_type TEXT NOT NULL,
        target_type TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0, target INTEGER NOT NULL,
        reward_coins INTEGER NOT NULL, reward_candies INTEGER NOT NULL DEFAULT 0,
        reward_lootboxes INTEGER NOT NULL DEFAULT 0, refresh_at INTEGER NOT NULL DEFAULT 0,
        UNIQUE (user_id, slot)
      );
    `);
    const ctx = vm.createContext({
      db,
      getUser: () => ({ patreon_tier: 'golden' }),
      PATREON_TIER_PERKS: { golden: { questSlots: 5 } },
      NO_PATREON_PERKS: { questSlots: 3 },
      getClanPerkMultipliers: () => ({ questSlotBonus: 1 }),
      QUEST_TEMPLATES: [
        { quest_type: 'battle_category', target_type: 'battle_icon', target: 1 },
        { quest_type: 'catch', target_type: 'pokemon', target: 1 },
      ],
      addRandomEvolutionReward: (template) => template,
      writeQuestTemplate: () => {},
    });
    const slots = extract(dbSource, 'const MAX_QUEST_SLOTS =', '\nfunction getUserQuestRefreshWait');
    const helpers = extract(dbSource, 'function isBattleIconUnlockQuest(', '\n// Only slots within');
    const ensureQuests = extract(dbSource, 'function ensureUserQuests(', '\nfunction getUserQuests');
    vm.runInContext(`${slots}\n${helpers}\n${ensureQuests}`, ctx);

    const quests = ctx.ensureUserQuests('trainer');

    assert.equal(quests.length, 6);
    assert.equal(quests.at(-1).slot, 6);
    assert.equal(quests.filter((quest) =>
      quest.quest_type === 'battle_category' && quest.target_type === 'battle_icon'
    ).length, 1);
  } finally {
    db.close();
  }
});

test('quest-slot migration expands five slots to six and preserves quest data', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE active_quests (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL,
        slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 5), quest_type TEXT NOT NULL,
        target_type TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0, target INTEGER NOT NULL,
        reward_coins INTEGER NOT NULL, reward_candies INTEGER NOT NULL DEFAULT 0,
        reward_lootboxes INTEGER NOT NULL DEFAULT 0, reward_masterballs INTEGER NOT NULL DEFAULT 0,
        reward_ultraballs INTEGER NOT NULL DEFAULT 0, reward_grazz INTEGER NOT NULL DEFAULT 0,
        reward_items TEXT NOT NULL DEFAULT '{}', refresh_at INTEGER NOT NULL DEFAULT 0,
        UNIQUE (user_id, slot)
      );
      INSERT INTO active_quests (
        user_id, slot, quest_type, target_type, target, reward_coins, refresh_at
      ) VALUES ('trainer', 5, 'catch', 'pokemon', 4, 100, 12345);
    `);
    const ctx = vm.createContext({ db });
    vm.runInContext(
      extract(dbSource, '// Patreon and clan perks can grant up to 6 quest slots', "\nensureColumns('world_boss'"),
      ctx
    );

    const existing = db.prepare('SELECT * FROM active_quests WHERE user_id = ?').get('trainer');
    db.prepare(`
      INSERT INTO active_quests (user_id, slot, quest_type, target_type, target, reward_coins)
      VALUES ('trainer', 6, 'catch', 'pokemon', 4, 100)
    `).run();

    assert.equal(existing.refresh_at, 12345);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM active_quests WHERE user_id = ?').get('trainer').count, 2);
  } finally {
    db.close();
  }
});

test('clan perk information matches the grouped screenshot layout and details', async () => {
  const perkInfo = extract(
    indexSource,
    "if (subcommand === 'info' && args[1]?.toLowerCase() === 'perks') {",
    "\n      if (subcommand === 'create')"
  );
  const ctx = vm.createContext({
    PREFIX: ';',
    CLAN_RANK_EMOJIS: {
      bronze: 'B', silver: 'S', gold: 'G', diamond: 'D', amethyst: 'A', onyx: 'O',
    },
    EMOJIS: { pokeEgg: '🥚' },
    makeEmbed: (title, description) => ({ title, description }),
    message: { reply: async (value) => value },
  });
  vm.runInContext(
    `async function renderPerkInfo() {
      const subcommand = 'info';
      const args = ['info', 'perks'];
      ${perkInfo}
    }`,
    ctx
  );

  const response = await ctx.renderPerkInfo();
  const description = response.embeds[0].description;
  assert.match(description, /All clan perks are cumulative/);
  assert.match(description, /Catch Rate IV: \+5% \(total \+10%\)/);
  assert.match(description, /Promo Rate perks \(PR\).*`;pokemon`.*`;battle`.*`;fish`.*`;egg`/);
  assert.match(description, /Amethyst with 65 members requires 115,384 catches/);
  assert.match(description, /`;clan purchase bronze`/);
});
