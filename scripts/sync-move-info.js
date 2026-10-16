// Builds data/move-info.json (descriptions, priority, damage class, learners) from PokeAPI.
const fs = require('node:fs');
const path = require('node:path');

const API = 'https://pokeapi.co/api/v2';
const OUTPUT = path.join(__dirname, '..', 'data', 'move-info.json');

async function getJson(url, attempts = 4) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (attempt === attempts) throw new Error(`${url}: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  return null;
}

function english(entries, key) {
  const match = [...entries].reverse().find((entry) => entry.language.name === 'en');
  return match ? String(match[key]).replace(/\s+/g, ' ').trim() : '';
}

function titleCase(slug) {
  return slug.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

async function main() {
  const list = await getJson(`${API}/move?limit=2000`);
  const result = {};
  let index = 0;
  const workers = Array.from({ length: 12 }, async () => {
    while (index < list.results.length) {
      const entry = list.results[index++];
      const move = await getJson(entry.url);
      if (move.id >= 10000) continue;
      const learners = move.learned_by_pokemon
        .map((pokemon) => Number(pokemon.url.split('/').filter(Boolean).pop()))
        .filter((id) => id < 10000)
        .sort((a, b) => a - b)
        .map((id) => move.learned_by_pokemon.find((pokemon) => pokemon.url.endsWith(`/${id}/`)).name)
        .map(titleCase);
      result[move.name] = {
        name: english(move.names, 'name') || titleCase(move.name),
        type: titleCase(move.type.name),
        power: move.power ?? 0,
        accuracy: move.accuracy ?? 0,
        pp: move.pp ?? 0,
        priority: move.priority,
        damageClass: titleCase(move.damage_class.name),
        description: english(move.flavor_text_entries, 'flavor_text')
          || english(move.effect_entries, 'short_effect'),
        learners,
      };
    }
  });
  await Promise.all(workers);
  fs.writeFileSync(OUTPUT, JSON.stringify(result));
  console.log(`Wrote ${Object.keys(result).length} moves to ${OUTPUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
