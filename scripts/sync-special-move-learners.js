// Keep these expanded, all-generation learnsets separate from the level-up database.
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const learners = {};
  for (const move of ['pay-day', 'power-up-punch']) {
    const response = await fetch(`https://pokeapi.co/api/v2/move/${move}`);
    if (!response.ok) throw new Error(`PokéAPI ${move} request failed: ${response.status}`);
    const data = await response.json();
    learners[move] = data.learned_by_pokemon.map((pokemon) => {
      const match = pokemon.url.match(/\/pokemon\/(\d+)\/?$/);
      if (!match) throw new Error(`Invalid Pokémon URL: ${pokemon.url}`);
      return Number(match[1]);
    }).sort((a, b) => a - b);
  }
  fs.writeFileSync(
    path.join(__dirname, '..', 'data', 'special-move-learners.json'),
    `${JSON.stringify(learners, null, 2)}\n`
  );
}

main().catch((error) => {
  console.error('Failed to sync special move learners:', error);
  process.exitCode = 1;
});
