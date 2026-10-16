const path = require('path');
const Database = require('better-sqlite3');

// One-off: swap the 50M base for the new 5M base on the active jackpot,
// preserving any ticket contributions already made.
const db = new Database(path.join(__dirname, '..', 'pokemon.sqlite'));
const state = db.prepare('SELECT jackpot FROM lottery_state WHERE id = 1').get();

if (!state) {
  console.log('No lottery state row yet — nothing to fix.');
} else {
  const contributions = Math.max(0, state.jackpot - 50000000);
  const corrected = 5000000 + contributions;
  db.prepare('UPDATE lottery_state SET jackpot = ? WHERE id = 1').run(corrected);
  console.log(`Jackpot base swapped: ${state.jackpot} -> ${corrected} (contributions kept: ${contributions})`);
}
db.close();
