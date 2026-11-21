const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');

function extract(sourceText, start, end) {
  const first = sourceText.indexOf(start);
  const last = sourceText.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `Could not extract ${start}`);
  return sourceText.slice(first, last);
}

const reportHelper = extract(
  source,
  'function formatAdminAutoCatchReport(session) {',
  '\nasync function runAdminAutoCatch('
);
const runHelper = extract(
  source,
  'async function runAdminAutoCatch(session, userId, message, target, handleCatch) {',
  '\nconst activeLeagueBattles'
);
const commandBranch = extract(
  source,
  "      if (command === 'admin' && subtype === 'auto' && action === 'catch') {",
  "\n      if (command === 'admin' && ['bud', 'buddy'].includes(subtype)) {"
);

function makeAutoCatchContext() {
  const replies = [];
  const sent = [];
  const sessionMap = new Map();
  const faction = { faction_key: 'rocket', team: { name: 'Team Rocket' } };
  const context = vm.createContext({
    PREFIX: '.',
    BALL_CONFIG: {
      gb: { name: 'Greatball', column: 'greatballs', emoji: '🔵' },
    },
    adminAutoCatchSessions: sessionMap,
    args: ['auto', 'catch', 'start'],
    command: 'admin',
    subtype: 'auto',
    action: 'catch',
    userId: 'admin-user',
    message: {
      author: { id: 'admin-user' },
      channel: { id: 'test-channel', send: async (value) => sent.push(value) },
      reply: async (value) => replies.push(value),
    },
    getUserFaction: () => faction,
    getDailyBall: () => ({ key: 'gb', name: 'Greatball' }),
    getUser: () => ({ greatballs: 2 }),
    replies,
    sent,
  });
  vm.runInContext(reportHelper, context);
  vm.runInContext(runHelper, context);
  vm.runInContext(`async function run() { ${commandBranch} }`, context);
  return { context, replies, sent, sessionMap };
}

test('admin auto catch starts in the command channel and reports catches on stop', async () => {
  const { context, replies, sessionMap } = makeAutoCatchContext();

  await context.run();
  assert.equal(sessionMap.get('admin-user').channelId, 'test-channel');
  assert.equal(sessionMap.get('admin-user').factionKey, 'rocket');
  assert.match(replies[0], /Greatball/);
  assert.match(replies[0], /Use `\.pokemon` or `\.p admin/);

  const session = sessionMap.get('admin-user');
  session.caught.set('Pikachu', 2);
  session.totalCaught = 2;
  context.args = ['auto', 'catch', 'stop'];
  await context.run();

  assert.equal(sessionMap.has('admin-user'), false);
  assert.match(replies[1], /Caught \*\*2 Pokémon\*\*/);
  assert.match(replies[1], /Pikachu x2/);
});

test('auto catch uses the current faction ball only in its configured channel', async () => {
  const { context } = makeAutoCatchContext();
  const caughtWith = [];
  const message = {
    author: { id: 'admin-user' },
    channel: { id: 'test-channel', send: async () => {} },
  };
  const session = {
    active: true,
    channelId: 'test-channel',
    factionKey: 'rocket',
    factionName: 'Team Rocket',
    pendingCatch: null,
    caught: new Map(),
    totalCaught: 0,
  };
  await context.runAdminAutoCatch(session, 'admin-user', message, { name: 'Pikachu' }, async (...args) => {
    caughtWith.push(args);
    return true;
  });

  assert.equal(caughtWith.length, 1);
  assert.equal(caughtWith[0][0], 'gb');
  assert.equal(caughtWith[0][3], message.author);
  assert.equal(session.pendingCatch, null);
  assert.equal(session.caught.get('Pikachu'), 1);
  assert.equal(session.totalCaught, 1);

  await context.runAdminAutoCatch(session, 'admin-user', {
    ...message,
    channel: { id: 'another-channel', send: async () => {} },
  }, { name: 'Pikachu' }, async () => assert.fail('must not catch in another channel'));
});

test('auto catch pauses and explains when its faction ball runs out', async () => {
  const { context, sent } = makeAutoCatchContext();
  context.getUser = () => ({ greatballs: 0 });
  const session = {
    active: true,
    channelId: 'test-channel',
    factionKey: 'rocket',
    factionName: 'Team Rocket',
    pendingCatch: null,
  };
  await context.runAdminAutoCatch(session, 'admin-user', context.message, { name: 'Pikachu' }, async () => {
    assert.fail('must not catch without a ball');
  });

  assert.equal(session.active, false);
  assert.match(sent[0], /no Greatballs left/);
  assert.match(sent[0], /\.admin auto catch stop/);
});

test('auto catch reports split long results within Discord message limits', () => {
  const { context } = makeAutoCatchContext();
  const caught = new Map(Array.from({ length: 40 }, (_, index) => [
    `Pokémon ${index} ${'x'.repeat(65)}`,
    1,
  ]));
  const reports = context.formatAdminAutoCatchReport({ caught, totalCaught: 40 });

  assert.ok(reports.length > 1);
  assert.ok(reports.every((report) => report.length <= 2000));
  assert.equal(reports.join('\n').match(/Pokémon \d+/g).length, 40);
});
