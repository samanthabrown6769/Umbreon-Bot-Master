const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');

function extractHelpers() {
  const start = source.indexOf('let serverDataExportInProgress = false;');
  const end = source.indexOf('\nconst SERVER_TRANSCRIPT_RECIPIENT_ID', start);
  assert.ok(start >= 0 && end > start, 'Could not extract shared server-message helpers');
  return source.slice(start, end);
}

function extractBranch() {
  const start = "      if (command === 'admin' && subtype === 'server' && action === 'transcript') {";
  const end = "\n      if (command === 'admin' && subtype === 'server' && action === 'info') {";
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, 'Could not extract admin server-transcript command');
  return source.slice(startIndex, endIndex);
}

class AttachmentBuilder {
  constructor(attachment, options) {
    this.attachment = attachment;
    this.name = options.name;
  }
}

test('admin server transcript includes accessible thread messages and DMs only the fixed recipient', async () => {
  const sentDms = [];
  const fetchedUserIds = [];
  const replies = [];
  const makeMessageChannel = (name, content) => {
    let fetched = false;
    return {
      id: `${name}-id`,
      name,
      permissionsFor: () => ({ has: () => true }),
      messages: {
        fetch: async () => {
          if (fetched) return new Map();
          fetched = true;
          const createdTimestamp = Date.parse('2026-10-12T12:00:00.000Z');
          return new Map([['message-id', {
            id: 'message-id',
            createdTimestamp,
            author: { tag: `${name}-author`, id: `${name}-user` },
            content,
            embeds: [],
            attachments: new Map(),
            stickers: new Map(),
          }]]);
        },
      },
    };
  };
  const rootChannel = makeMessageChannel('general', 'text channel message');
  const privateThread = makeMessageChannel('private-thread', 'thread message');
  privateThread.parent = rootChannel;
  rootChannel.type = 0;
  rootChannel.threads = {
    fetchActive: async () => ({ threads: new Map() }),
    fetchArchived: async ({ type }) => ({
      threads: type === 'private' ? new Map([[privateThread.id, privateThread]]) : new Map(),
    }),
  };
  const guild = {
    id: '1399099614355001448',
    name: 'Transcript Test Server',
    channels: { fetch: async () => new Map([[rootChannel.id, rootChannel]]) },
    members: { fetchMe: async () => ({ id: 'bot-id' }) },
  };
  const context = vm.createContext({
    command: 'admin',
    subtype: 'server',
    action: 'transcript',
    args: ['server', 'transcript', guild.id, '2026-10-11', '2026-10-12'],
    PREFIX: '.',
    client: {
      guilds: { fetch: async (id) => {
        assert.equal(id, guild.id);
        return guild;
      } },
      users: { fetch: async (id) => {
        fetchedUserIds.push(id);
        return { send: async (payload) => { sentDms.push(payload); } };
      } },
    },
    message: { reply: async (reply) => { replies.push(reply); } },
    ChannelType: { GuildText: 0, GuildAnnouncement: 5, GuildForum: 15, GuildMedia: 16 },
    PermissionsBitField: { Flags: { ViewChannel: 1, ReadMessageHistory: 2 } },
    AttachmentBuilder,
    SERVER_TRANSCRIPT_RECIPIENT_ID: '1514082847609061541',
    Buffer,
    console: { error() {} },
  });
  vm.runInContext(extractHelpers(), context);
  context.withServerDataExport = (_message, exportTask) => exportTask();
  context.queueServerExportRequest = (request) => request();
  vm.runInContext(`async function run() { ${extractBranch()} }`, context);

  await context.run();

  assert.deepEqual(fetchedUserIds, ['1514082847609061541']);
  assert.equal(sentDms.length, 1);
  const transcript = sentDms[0].files[0].attachment.toString('utf8');
  assert.match(transcript, /text channel message/);
  assert.match(transcript, /thread message/);
  assert.match(transcript, /UTC range: 2026-10-11 through 2026-10-12/);
  assert.match(sentDms[0].content, /2 messages/);
  assert.match(replies[0], /to <@1514082847609061541>/);
});

test('admin server transcript rejects invalid dates without fetching the server', async () => {
  const replies = [];
  const context = vm.createContext({
    command: 'admin',
    subtype: 'server',
    action: 'transcript',
    args: ['server', 'transcript', '1399099614355001448', '2026-02-30'],
    PREFIX: '.',
    client: { guilds: { fetch: async () => assert.fail('Should not fetch an invalid request') } },
    message: { reply: async (reply) => { replies.push(reply); } },
    console: { error() {} },
  });
  vm.runInContext(extractHelpers(), context);
  context.withServerDataExport = (_message, exportTask) => exportTask();
  context.queueServerExportRequest = (request) => request();
  vm.runInContext(`async function run() { ${extractBranch()} }`, context);

  await context.run();

  assert.match(replies[0], /Usage: `\.admin server transcript/);
});
