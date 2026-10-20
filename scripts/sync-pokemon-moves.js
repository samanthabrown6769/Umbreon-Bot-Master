const fs = require('fs');
const path = require('path');

const API = 'https://pokeapi.co/api/v2';
const CATALOG_PATH = path.join(__dirname, '..', 'data', 'pokemon-catalog.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'pokemon-moves.json');
const CONCURRENCY = 8;
const LEARNSET_OVERRIDES = {
  528: ['confide', 'captivate'],
};

async function fetchJson(url) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(url);
    if (response.ok) return response.json();
    if (response.status !== 429 && response.status < 500) {
      throw new Error(`PokéAPI request failed (${response.status}): ${url}`);
    }
    const retryAfter = Number(response.headers.get('retry-after'));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 500 * (2 ** attempt);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new Error(`PokéAPI request failed after retries: ${url}`);
}

async function fetchAll(items, getUrl) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await fetchJson(getUrl(items[index]));
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return results;
}

function resourceId(url, resource) {
  const match = url.match(new RegExp(`/${resource}/(\\d+)/?$`));
  if (!match) throw new Error(`Could not read ${resource} ID from ${url}`);
  return Number(match[1]);
}

function normalizeMoveName(name) {
  return name.split('-').map((part) =>
    part.charAt(0).toUpperCase() + part.slice(1)
  ).join(' ');
}

async function main() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const defaultForms = catalog.filter((pokemon) => pokemon.is_default);
  const pokemonRecords = await fetchAll(defaultForms, (pokemon) =>
    `${API}/pokemon/${pokemon.slug}`
  );

  const eligibleBySpecies = new Map();
  for (const pokemon of pokemonRecords) {
    const speciesId = resourceId(pokemon.species.url, 'pokemon-species');
    const moves = new Map();
    for (const entry of pokemon.moves) {
      const levelDetails = entry.version_group_details
        .filter((detail) => detail.move_learn_method.name === 'level-up')
        .map((detail) => ({
          level: detail.level_learned_at,
          versionGroup: Number(detail.version_group.url.match(/version-group\/(\d+)/)?.[1] || 0),
        }))
        .sort((left, right) => right.versionGroup - left.versionGroup || left.level - right.level);
      const learn = levelDetails[0];
      if (!learn) continue;
      const previous = moves.get(entry.move.name);
      if (!previous || learn.versionGroup > previous.versionGroup
          || (learn.versionGroup === previous.versionGroup && learn.level < previous.level)) {
        moves.set(entry.move.name, learn);
      }
    }
    eligibleBySpecies.set(speciesId, [...moves.keys()]);
  }

  const moveNames = [...new Set([...eligibleBySpecies.values()].flat())];
  const moveDetails = await fetchAll(moveNames, (name) => `${API}/move/${name}`);
  const moves = {};
  for (const move of moveDetails) {
    const isStatus = move.damage_class?.name === 'status';
    const isDamaging = Number.isSafeInteger(move.power) && move.power > 0;
    if (!isStatus && !isDamaging) continue;
    moves[move.name] = {
      name: normalizeMoveName(move.name),
      type: move.type.name,
      power: isDamaging ? move.power : 0,
      accuracy: move.accuracy ?? 100,
      pp: move.pp,
      category: move.damage_class?.name || (isDamaging ? 'physical' : 'status'),
    };
  }

  const learnsets = {};
  for (const [speciesId, names] of eligibleBySpecies.entries()) {
    const learnable = names
      .filter((name) => moves[name])
      .sort((left, right) =>
        moves[right].power - moves[left].power || left.localeCompare(right)
      );
    if (learnable.length) learnsets[speciesId] = learnable;
  }

  for (const [speciesId, names] of Object.entries(LEARNSET_OVERRIDES)) {
    const learnable = new Set(learnsets[speciesId] || []);
    for (const name of names) {
      if (!moves[name]) {
        throw new Error(`Learnset override references unknown move: ${name}`);
      }
      learnable.add(name);
    }
    learnsets[speciesId] = [...learnable].sort((left, right) =>
      moves[right].power - moves[left].power || left.localeCompare(right)
    );
  }

  const output = {
    source: 'PokéAPI',
    generated_at: new Date().toISOString(),
    moves,
    learnsets,
  };
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output)}\n`);
  console.log(`Saved ${Object.keys(moves).length} moves (damaging and status) and ${Object.keys(learnsets).length} species learnsets to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error('Failed to sync Pokémon moves:', error);
  process.exitCode = 1;
});
