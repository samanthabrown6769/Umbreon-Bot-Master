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
  const start = "      if (command === 'admin' && args[2]?.toLowerCase() === 'messages') {";
  const end = "\n      if (command === 'admin' && subtype === 'server' && action === 'transcript') {";
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, 'Could not extract admin user-messages command');
  return source.slice(startIndex, endIndex);
}

class AttachmentBuilder {
  constructor(attachment, options) {
    this.attachment = attachment;
    this.name = options.name;
  }
}

test('admin user messages returns only the target user history to the fixed recipient', async () => {
  const guildId = '1399099614355001448';
  const targetUserId = '1514082847609061541';
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
        const makeMessage = (id, authorId, content) => ({
          id,
          createdTimestamp: Date.parse('2026-10-12T12:00:00.000Z'),
          author: { tag: `user-${authorId}`, id: authorId },
          content,
          embeds: [],
          attachments: new Map(),
          stickers: new Map(),
        });
        return new Map([
          ['1', makeMessage('1', targetUserId, 'Target user message')],
          ['2', makeMessage('2', '111111111111111', 'Another user message')],
        ]);
      },
    },
  };
  const guild = {
    id: guildId,
    name: 'User Message Test Server',
    channels: { fetch: async () => new Map([[channel.id, channel]]) },
    members: { fetchMe: async () => ({ id: 'bot-id' }) },
  };
  const context = vm.createContext({
    command: 'admin',
    subtype: guildId,
    action: `<@!${targetUserId}>`,
    args: [guildId, `<@!${targetUserId}>`, 'messages'],
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
  const output = sentDms[0].files[0].attachment.toString('utf8');
  assert.match(output, /Target user message/);
  assert.match(output, /user-1514082847609061541/);
  assert.doesNotMatch(output, /Another user message/);
  assert.match(sentDms[0].content, /1 messages/);
  assert.match(replies[0], /to <@1514082847609061541>/);
});

test('admin user messages rejects an invalid user selector before fetching the server', async () => {
  const replies = [];
  const context = vm.createContext({
    command: 'admin',
    subtype: '1399099614355001448',
    action: 'not-a-user',
    args: ['1399099614355001448', 'not-a-user', 'messages'],
    PREFIX: '.',
    client: { guilds: { fetch: async () => assert.fail('Should not fetch an invalid request') } },
    message: { reply: async (reply) => { replies.push(reply); } },
    console: { error() {} },
  });
  vm.runInContext(extractHelpers(), context);
  context.withServerDataExport = (_message, exportTask) => exportTask();
  vm.runInContext(`async function run() { ${extractBranch()} }`, context);

  await context.run();

  assert.match(replies[0], /Usage: `\.admin <server ID> <user ID\|@user> messages`/);
});
