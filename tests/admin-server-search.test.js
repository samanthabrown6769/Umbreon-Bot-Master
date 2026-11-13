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
  const start = "      if (command === 'admin' && action === 'search' && args[2]?.toLowerCase() === 'message') {";
  const end = "\n      if (command === 'admin' && subtype === 'server' && action === 'transcript') {";
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, 'Could not extract admin message-search command');
  return source.slice(startIndex, endIndex);
}

class AttachmentBuilder {
  constructor(attachment, options) {
    this.attachment = attachment;
    this.name = options.name;
  }
}

test('admin message search matches substrings and DMs results only to the fixed recipient', async () => {
  const guildId = '1399099614355001448';
  const fetchedUserIds = [];
  const sentDms = [];
  const replies = [];
  let fetchedMessages = false;
  const channel = {
    id: 'channel-id',
    name: 'general',
    type: 0,
    permissionsFor: () => ({ has: () => true }),
    threads: {
      fetchActive: async () => ({ threads: new Map() }),
      fetchArchived: async () => ({ threads: new Map() }),
    },
    messages: {
      fetch: async () => {
        if (fetchedMessages) return new Map();
        fetchedMessages = true;
        const makeMessage = (id, content) => ({
          id,
          createdTimestamp: Date.parse('2026-10-12T12:00:00.000Z'),
          author: { tag: `user-${id}`, id: `author-${id}` },
          content,
          embeds: [],
          attachments: new Map(),
          stickers: new Map(),
        });
        return new Map([
          ['1', makeMessage('1', 'A rare PokeBall appeared')],
          ['2', makeMessage('2', 'An unrelated message')],
        ]);
      },
    },
  };
  const guild = {
    id: guildId,
    name: 'Search Test Server',
    channels: { fetch: async () => new Map([[channel.id, channel]]) },
    members: { fetchMe: async () => ({ id: 'bot-id' }) },
  };
  const context = vm.createContext({
    command: 'admin',
    subtype: guildId,
    action: 'search',
    args: [guildId, 'search', 'message', 'poke'],
    PREFIX: '.',
    client: {
      guilds: { fetch: async (id) => {
        assert.equal(id, guildId);
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
  const results = sentDms[0].files[0].attachment.toString('utf8');
  assert.match(results, /A rare PokeBall appeared/);
  assert.match(results, /user-1 \(author-1\)/);
  assert.doesNotMatch(results, /An unrelated message/);
  assert.match(sentDms[0].content, /1 matches/);
  assert.match(replies[0], /to <@1514082847609061541>/);
});

test('admin message search requires a server ID and search term', async () => {
  const replies = [];
  const context = vm.createContext({
    command: 'admin',
    subtype: 'not-an-id',
    action: 'search',
    args: ['not-an-id', 'search', 'message'],
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

  assert.match(replies[0], /Usage: `\.admin <server ID> search message/);
});

test('server exports serialize and space requests to avoid competing with commands', async () => {
  let now = 100_000;
  const FakeDate = class extends Date {
    static now() { return now; }
  };
  const context = vm.createContext({
    Date: FakeDate,
    setTimeout: (callback, delay) => {
      now += delay;
      callback();
    },
    Buffer,
    console: { error() {} },
  });
  vm.runInContext(extractHelpers(), context);

  const starts = [];
  let activeRequests = 0;
  let maxActiveRequests = 0;
  const makeRequest = () => context.queueServerExportRequest(async () => {
    activeRequests += 1;
    maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
    starts.push(now);
    await Promise.resolve();
    activeRequests -= 1;
  });
  await Promise.all([makeRequest(), makeRequest()]);

  assert.equal(maxActiveRequests, 1);
  assert.ok(starts[1] - starts[0] >= 1500);

  let finishExport;
  const exportTask = context.withServerDataExport(
    { reply: async () => {} },
    () => new Promise((resolve) => { finishExport = resolve; })
  );
  await Promise.resolve();
  let busyReply;
  await context.withServerDataExport(
    { reply: async (content) => { busyReply = content; } },
    async () => assert.fail('A concurrent server export should not start')
  );
  finishExport();
  await exportTask;
  assert.match(busyReply, /already running/);
});
