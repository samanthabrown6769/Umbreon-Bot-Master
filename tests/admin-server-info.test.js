const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');

function extractBranch() {
  const start = "      if (command === 'admin' && subtype === 'server' && action === 'info') {";
  const end = "\n      if (command === 'admin' && subtype === 'users') {";
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, 'Could not extract admin server-info command');
  return source.slice(startIndex, endIndex);
}

class EmbedBuilder {
  setColor(value) { this.color = value; return this; }
  setTitle(value) { this.title = value; return this; }
  setDescription(value) { this.description = value; return this; }
  setFooter(value) { this.footer = value; return this; }
}

class ButtonBuilder {
  setCustomId(value) { this.customId = value; return this; }
  setLabel(value) { this.label = value; return this; }
  setStyle(value) { this.style = value; return this; }
  setDisabled(value) { this.disabled = value; return this; }
}

class ActionRowBuilder {
  addComponents(...components) { this.components = components; return this; }
}

test('admin server info DMs a sorted member list and labels bot accounts', async () => {
  const dms = [];
  const replies = [];
  const members = new Map([
    ['2', { id: '2', displayName: 'Bot Display', user: { username: 'zbot', bot: true } }],
    ['1', { id: '1', displayName: 'Alice Display', user: { username: 'alice', bot: false } }],
  ]);
  const context = vm.createContext({
    command: 'admin',
    subtype: 'server',
    action: 'info',
    args: ['server', 'info', '1562663315816194149'],
    PREFIX: '.',
    userId: 'admin-id',
    client: {
      guilds: {
        fetch: async (id) => {
          assert.equal(id, '1562663315816194149');
          return { name: 'Test Server', members: { fetch: async () => members } };
        },
      },
    },
    message: {
      author: { send: async (payload) => { dms.push(payload); return {}; } },
      reply: async (reply) => { replies.push(reply); },
    },
    EmbedBuilder,
    ActionRowBuilder: class {},
    ButtonBuilder: class {},
    ButtonStyle: { Secondary: 2 },
    ComponentType: { Button: 2 },
    console: { error() {} },
  });
  context.withServerDataExport = (_message, exportTask) => exportTask();
  context.queueServerExportRequest = (request) => request();
  vm.runInContext(`async function run() { ${extractBranch()} }`, context);

  await context.run();

  assert.match(dms[0].embeds[0].title, /Test Server Members \(2\)/);
  assert.ok(dms[0].embeds[0].description.indexOf('@alice') < dms[0].embeds[0].description.indexOf('@zbot'));
  assert.match(dms[0].embeds[0].description, /Alice Display.*`1`/);
  assert.match(dms[0].embeds[0].description, /Bot Display.*`2` • bot/);
  assert.match(replies[0], /2 members/);
});

test('admin server info paginates large member lists for the requesting admin', async () => {
  const members = new Map(Array.from({ length: 26 }, (_, index) => {
    const username = `user${String(index).padStart(2, '0')}`;
    return [String(index), {
      id: String(index),
      displayName: username,
      user: { username, bot: false },
    }];
  }));
  const collectorHandlers = {};
  let updated;
  const listMessage = {
    createMessageComponentCollector: () => ({
      on: (event, handler) => { collectorHandlers[event] = handler; },
    }),
    edit: async () => {},
  };
  const context = vm.createContext({
    command: 'admin',
    subtype: 'server',
    action: 'info',
    args: ['server', 'info', '1562663315816194149'],
    PREFIX: '.',
    userId: 'admin-id',
    client: {
      guilds: {
        fetch: async () => ({ name: 'Test Server', members: { fetch: async () => members } }),
      },
    },
    message: {
      author: { send: async () => listMessage },
      reply: async () => {},
    },
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle: { Secondary: 2 },
    ComponentType: { Button: 2 },
    console: { error() {} },
  });
  context.withServerDataExport = (_message, exportTask) => exportTask();
  context.queueServerExportRequest = (request) => request();
  vm.runInContext(`async function run() { ${extractBranch()} }`, context);

  await context.run();
  await collectorHandlers.collect({
    user: { id: 'admin-id' },
    customId: 'admin-server-info-next',
    update: async (payload) => { updated = payload; },
  });

  assert.equal(updated.embeds[0].footer.text, 'Page 2 / 2');
  assert.match(updated.embeds[0].description, /@user25/);
  assert.doesNotMatch(updated.embeds[0].description, /@user00/);
});

test('admin server info rejects malformed IDs before requesting a server', async () => {
  const replies = [];
  const context = vm.createContext({
    command: 'admin',
    subtype: 'server',
    action: 'info',
    args: ['server', 'info', 'not-an-id'],
    PREFIX: '.',
    userId: 'admin-id',
    client: { guilds: { fetch: async () => assert.fail('Should not fetch an invalid ID') } },
    message: { reply: async (reply) => { replies.push(reply); } },
    console: { error() {} },
  });
  context.withServerDataExport = (_message, exportTask) => exportTask();
  context.queueServerExportRequest = (request) => request();
  vm.runInContext(`async function run() { ${extractBranch()} }`, context);

  await context.run();

  assert.match(replies[0], /Usage: `\.admin server info <server ID>`/);
});
