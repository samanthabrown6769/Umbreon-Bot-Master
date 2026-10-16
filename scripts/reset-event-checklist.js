require('dotenv').config();

const path = require('path');
const Database = require('better-sqlite3');
const { Client, GatewayIntentBits } = require('discord.js');
const halloweenEvent = require('../events/halloween-2026');

// Resets a user's event checklist progress for the current event:
// deletes their event catches and clears claim flags (event ticket is kept).
// Usage: node scripts/reset-event-checklist.js <discord-username>

const username = process.argv[2];
if (!username) {
  console.error('Usage: node scripts/reset-event-checklist.js <discord-username>');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const timeout = setTimeout(() => {
  console.error('Timed out logging in to Discord.');
  client.destroy();
  process.exit(1);
}, 20000);

client.once('ready', async () => {
  clearTimeout(timeout);
  try {
    let member = null;
    for (const guild of client.guilds.cache.values()) {
      const results = await guild.members.search({ query: username, limit: 5 }).catch(() => null);
      member = results?.find((m) => m.user.username === username) || results?.first() || null;
      if (member) break;
    }
    if (!member) {
      console.error(`No member named "${username}" found in any of the bot's servers.`);
      process.exit(1);
    }
    const userId = member.user.id;
    console.log(`Found ${member.user.tag} (${userId}).`);

    const db = new Database(path.join(__dirname, '..', 'pokemon.sqlite'));
    const catches = db.prepare(
      'DELETE FROM event_catches WHERE event_id = ? AND user_id = ?'
    ).run(halloweenEvent.id, userId).changes;
    db.prepare(
      'UPDATE users SET event_reg_claimed = 0, event_gold_claimed = 0 WHERE id = ?'
    ).run(userId);
    db.close();
    console.log(
      `Reset ${halloweenEvent.name} checklist for ${member.user.tag}: ` +
      `${catches} event catch record${catches === 1 ? '' : 's'} deleted, claim flags cleared.`
    );
  } finally {
    client.destroy();
  }
});

client.login(process.env.BOT_TOKEN || process.env.DISCORD_TOKEN);
