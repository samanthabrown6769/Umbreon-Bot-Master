const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Database = require('better-sqlite3');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder } = require('discord.js');

const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');
const dbSource = fs.readFileSync(require.resolve('../db.js'), 'utf8');

function extract(text, start, end) {
  const first = text.indexOf(start);
  const last = text.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `Could not extract ${start}`);
  return text.slice(first, last);
}

function makeContext() {
  const user = { vote_eggs: 10, held_egg_target: 0, held_egg_progress: 0,
    egg_auto_equip: 1, egg_auto_hatch: 0, egg_use_incubators: 1 };
  const items = { Incubator: 2, 'Super Incubator': 2 };
  const incubators = [];
  const events = {};
  const replies = [];
  const panel = {
    createMessageComponentCollector: () => ({ on: (name, fn) => { events[name] = fn; } }),
    edit: async () => {},
  };
  const context = vm.createContext({
    userId: 'trainer', command: 'egg', args: [], PREFIX: '.', Math, Array,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder,
    EMOJIS: { pokeEgg: '🥚', incubator: '🧪', superIncubator: '🧪' },
    EGG_INCUBATOR_LIMITS: { incubator: 2, super_incubator: 6 },
    getUser: () => user,
    getPatreonPerks: () => ({ autoEquipEggs: true }),
    updateUser: (_id, fields) => Object.assign(user, fields),
    getEggCatchTarget: () => 101,
    holdEgg: (_id, target) => {
      if (user.held_egg_target) return { error: 'egg_already_held' };
      if (!user.vote_eggs) return { error: 'no_eggs' };
      user.vote_eggs -= 1;
      user.held_egg_target = target;
      return {};
    },
    getUserEggIncubators: () => incubators,
    getUserItems: () => Object.entries(items).map(([item_name, amount]) => ({ item_name, amount })),
    startEggIncubators: (_id, type, targets) => {
      const itemName = type === 'incubator' ? 'Incubator' : 'Super Incubator';
      const started = targets.map((target) => {
        const entry = { incubator_type: type, slot: incubators.filter((item) => item.incubator_type === type).length + 1, target, progress: 0 };
        incubators.push(entry);
        return entry;
      });
      user.vote_eggs -= targets.length;
      items[itemName] -= targets.length;
      return { started };
    },
    message: { reply: async (payload) => { replies.push(payload); return panel; } },
    console,
  });
  vm.runInContext(extract(source, 'function canUseEggAutomation(', '\nasync function autoHatchReadyEggs('), context);
  vm.runInContext(`async function run() { ${extract(source, "    if (command === 'egg') {", "\n    if (command === 'help') {")} }`, context);
  const press = async (customId, id = 'trainer') => {
    const interaction = {
      customId, user: { id }, replied: false, deferred: false, updates: [], followups: [],
      reply: async (value) => { interaction.replied = true; interaction.followups.push(value); },
      update: async (value) => { interaction.replied = true; interaction.updates.push(value); },
      followUp: async (value) => { interaction.followups.push(value); },
    };
    await events.collect(interaction);
    return interaction;
  };
  return { context, user, items, incubators, replies, press };
}

test('existing and new accounts default to using incubators and setting persists', () => {
  const db = new Database(':memory:');
  try {
    db.exec("CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('existing')");
    const definition = extract(dbSource, '  egg_use_incubators:', '\n').trim().match(/'([^']+)'/)[1];
    db.exec(`ALTER TABLE users ADD COLUMN egg_use_incubators ${definition}`);
    assert.equal(db.prepare('SELECT egg_use_incubators FROM users WHERE id = ?').get('existing').egg_use_incubators, 1);
    db.prepare('UPDATE users SET egg_use_incubators = 0 WHERE id = ?').run('existing');
    db.prepare('INSERT INTO users (id) VALUES (?)').run('new');
    assert.equal(db.prepare('SELECT egg_use_incubators FROM users WHERE id = ?').get('existing').egg_use_incubators, 0);
    assert.equal(db.prepare('SELECT egg_use_incubators FROM users WHERE id = ?').get('new').egg_use_incubators, 1);
  } finally {
    db.close();
  }
});

test('hold all and auto equip honor the incubator toggle while keeping the free slot', () => {
  for (const automatic of [false, true]) {
    for (const enabled of [0, 1]) {
      const { context, user, items, incubators } = makeContext();
      user.egg_use_incubators = enabled;
      const summary = automatic ? context.autoEquipEggs('trainer') : context.holdAllEggs('trainer');
      assert.equal(user.held_egg_target, 101);
      assert.equal(incubators.length, enabled ? 4 : 0);
      assert.equal(user.vote_eggs, enabled ? 5 : 9);
      assert.equal(items.Incubator, enabled ? 0 : 2);
      assert.equal(items['Super Incubator'], enabled ? 0 : 2);
      if (enabled) assert.deepEqual(incubators.map((slot) => slot.target), [101, 101, 51, 51]);
      else if (!automatic) assert.match(summary.join(' '), /Incubators skipped/);
    }
  }
});

test('Egg Centre toggle controls button and command without consuming incubators when toggled', async () => {
  const { context, user, incubators, replies, press } = makeContext();
  await context.run();
  assert.equal(replies[0].components[0].toJSON().components.length, 5);
  const denied = await press('egg:use-incubators', 'other');
  assert.match(denied.followups[0].content, /another trainer/);
  assert.equal(user.egg_use_incubators, 1);
  const switched = await press('egg:use-incubators');
  assert.equal(user.egg_use_incubators, 0);
  assert.match(switched.updates[0].components[0].toJSON().components[4].label, /OFF/);
  assert.equal(incubators.length, 0);
  const button = await press('egg:hold-all');
  assert.match(button.followups[0].content, /Incubators skipped/);
  assert.equal(user.held_egg_target, 101);
  assert.equal(incubators.length, 0);
  await press('egg:use-incubators');
  assert.equal(incubators.length, 0);
  context.args = ['hold', 'all'];
  await context.run();
  assert.match(replies.at(-1), /Started \*\*2 Incubators/);
  assert.equal(incubators.length, 4);
});

test('manual incubator use and existing incubators are unaffected by the toggle', async () => {
  const { context, user, incubators, press } = makeContext();
  await context.run();
  await press('egg:use-incubators');
  context.args = ['use-incubator', 'si', 'all'];
  await context.run();
  assert.equal(incubators.length, 2);
  assert.equal(user.vote_eggs, 8);
  const targets = incubators.map((item) => item.target);
  context.args = ['hold', 'all'];
  await context.run();
  assert.equal(user.vote_eggs, 7);
  assert.deepEqual(incubators.map((item) => item.target), targets);
});

test('auto equip still requires its setting and Patreon access', () => {
  const { context, user, incubators } = makeContext();
  user.egg_auto_equip = 0;
  assert.equal(context.autoEquipEggs('trainer').length, 0);
  user.egg_auto_equip = 1;
  context.getPatreonPerks = () => ({ autoEquipEggs: false });
  assert.equal(context.autoEquipEggs('trainer').length, 0);
  assert.equal(user.vote_eggs, 10);
  assert.equal(incubators.length, 0);
});
