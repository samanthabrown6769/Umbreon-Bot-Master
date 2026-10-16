require('dotenv').config();

const path = require('path');
const Database = require('better-sqlite3');
const { Client, GatewayIntentBits } = require('discord.js');

// Cancels a giveaway without paying out: marks it ended in the database
// (concludeGiveaway re-reads the row and skips ended giveaways) and deletes
// the Discord message. Usage: node scripts/cancel-giveaway.js <messageId>

const messageId = process.argv[2];
if (!messageId || !/^\d+$/.test(messageId)) {
  console.error('Usage: node scripts/cancel-giveaway.js <giveawayMessageId>');
  process.exit(1);
}

const db = new Database(path.join(__dirname, '..', 'pokemon.sqlite'));
const giveaway = db.prepare('SELECT * FROM active_giveaways WHERE message_id = ?').get(messageId);
if (!giveaway) {
  console.error(`No giveaway found with message id ${messageId}.`);
  process.exit(1);
}

const changes = db.prepare(
  'UPDATE active_giveaways SET ended = 1 WHERE id = ? AND ended = 0'
).run(giveaway.id).changes;
db.close();
console.log(
  `Giveaway #${giveaway.id} ("${giveaway.prize_title}") ` +
  (changes ? 'marked as ended — it will not pay out.' : 'was already ended.')
);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const timeout = setTimeout(() => {
  console.error('Timed out logging in to Discord.');
  client.destroy();
  process.exit(1);
}, 20000);

client.once('ready', async () => {
  clearTimeout(timeout);
  try {
    const channel = await client.channels.fetch(giveaway.channel_id).catch(() => null);
    if (!channel?.isTextBased()) {
      console.log('Giveaway channel unavailable; skipping message deletion.');
    } else {
      await channel.messages.delete(messageId)
        .then(() => console.log('Discord message deleted.'))
        .catch((error) => console.log('Message deletion failed:', error.message));
    }
  } finally {
    client.destroy();
  }
});

client.login(process.env.BOT_TOKEN || process.env.DISCORD_TOKEN);
