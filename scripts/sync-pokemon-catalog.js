const fs = require('fs');
const path = require('path');
const { displayName, regionalPokemonName } = require('../pokemon-names');
const { appendCustomPokemonForms } = require('./pokemon-custom-forms');

const API = 'https://pokeapi.co/api/v2';
const OUTPUT = path.join(__dirname, '..', 'data', 'pokemon-catalog.json');
const EVOLUTION_CHAINS_OUTPUT = path.join(__dirname, '..', 'data', 'pokemon-evolution-chains.json');
const EVOLUTION_RULES_OUTPUT = path.join(__dirname, '..', 'data', 'pokemon-evolution-rules.json');
const REMOVED_FORMS_PATH = path.join(__dirname, '..', 'data', 'removed-pokemon-forms.json');
const CONCURRENCY = 10;
const removedForms = JSON.parse(fs.readFileSync(REMOVED_FORMS_PATH, 'utf8'));
if (!Array.isArray(removedForms)
    || removedForms.some((form) => !Number.isSafeInteger(form.id)
      || typeof form.slug !== 'string' || !form.slug.trim())) {
  throw new Error(`Removed Pokémon forms file is invalid: ${REMOVED_FORMS_PATH}`);
}
const removedFormIds = new Set(removedForms.map((form) => form.id));
function resourceId(url, resource) {
  const match = url.match(new RegExp(`/${resource}/(\\d+)/?$`));
  if (!match) throw new Error(`Could not read ${resource} ID from ${url}`);
  return Number(match[1]);
}

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

function getEvolutionStage(speciesId, speciesById, memo = new Map(), seen = new Set()) {
  if (memo.has(speciesId)) return memo.get(speciesId);
  if (seen.has(speciesId)) {
    throw new Error(`Pokémon evolution data contains a cycle at species ${speciesId}.`);
  }

  const species = speciesById.get(speciesId);
  if (!species) throw new Error(`Missing species data for species ${speciesId}.`);
  if (!species.evolves_from_species) {
    memo.set(speciesId, 0);
    return 0;
  }

  const parentId = resourceId(species.evolves_from_species.url, 'pokemon-species');
  const nextSeen = new Set(seen);
  nextSeen.add(speciesId);
  const stage = getEvolutionStage(parentId, speciesById, memo, nextSeen) + 1;
  memo.set(speciesId, stage);
  return stage;
}

function rarityFor(species, evolutionStage, baseStatTotal) {
  if (species.is_legendary || species.is_mythical) return 'Legendary';
  if (baseStatTotal >= 600 || (evolutionStage >= 2 && baseStatTotal >= 500)) {
    return 'Super Rare';
  }
  if (baseStatTotal >= 500 || (evolutionStage >= 1 && baseStatTotal >= 420)) {
    return 'Rare';
  }
  if (baseStatTotal >= 350 || evolutionStage >= 1) return 'Uncommon';
  return 'Common';
}

async function main() {
  const pokemonIndex = await fetchJson(`${API}/pokemon?limit=20000`);
  const pokemonRecords = await fetchAll(pokemonIndex.results, (pokemon) => pokemon.url);
  const speciesUrls = new Map();
  for (const pokemon of pokemonRecords) {
    speciesUrls.set(pokemon.species.url, pokemon.species.url);
  }

  const speciesRecords = await fetchAll(
    [...speciesUrls.values()],
    (url) => url
  );
  const speciesById = new Map(
    speciesRecords.map((species) => [species.id, species])
  );
  const evolutionChainsBySpecies = Object.fromEntries(
    speciesRecords.map((species) => [
      species.id,
      resourceId(species.evolution_chain.url, 'evolution-chain'),
    ])
  );
  const evolutionChainUrls = new Map(
    speciesRecords.map((species) => [
      species.evolution_chain.url,
      species.evolution_chain.url,
    ])
  );
  const evolutionChainRecords = await fetchAll(
    [...evolutionChainUrls.values()],
    (url) => url
  );
  const evolutionRules = [];
  const visitEvolutionChain = (node) => {
    const fromSpeciesId = resourceId(node.species.url, 'pokemon-species');
    for (const evolution of node.evolves_to) {
      const toSpeciesId = resourceId(evolution.species.url, 'pokemon-species');
      for (const detail of evolution.evolution_details) {
        const hasAdditionalRequirements = Object.entries(detail).some(([key, value]) =>
          !['version_group', 'is_default', 'trigger', 'min_level'].includes(key)
          && value !== null && value !== false && value !== ''
        );
        if (detail.trigger.name === 'level-up'
            && Number.isSafeInteger(detail.min_level)
            && detail.min_level > 0
            && !hasAdditionalRequirements) {
          evolutionRules.push({
            fromSpeciesId,
            toSpeciesId,
            minLevel: detail.min_level,
          });
        }
      }
      visitEvolutionChain(evolution);
    }
  };
  for (const chain of evolutionChainRecords) visitEvolutionChain(chain.chain);
  const uniqueEvolutionRules = Array.from(
    new Map(evolutionRules.map((rule) => [
      `${rule.fromSpeciesId}:${rule.toSpeciesId}:${rule.minLevel}`,
      rule,
    ])).values()
  ).sort((left, right) =>
    left.fromSpeciesId - right.fromSpeciesId || left.toSpeciesId - right.toSpeciesId
  );
  const evolutionStages = new Map();
  const defaultSpritesBySpecies = new Map(
    pokemonRecords
      .filter((pokemon) => pokemon.is_default)
      .map((pokemon) => [
        resourceId(pokemon.species.url, 'pokemon-species'),
        {
          normal: pokemon.sprites.front_default,
          shiny: pokemon.sprites.front_shiny,
        },
      ])
  );

  const catalog = pokemonRecords.filter((pokemon) => !removedFormIds.has(pokemon.id)).map((pokemon) => {
    const speciesId = resourceId(pokemon.species.url, 'pokemon-species');
    const species = speciesById.get(speciesId);
    if (!species) throw new Error(`Missing species data for ${pokemon.name}.`);

    const stats = Object.fromEntries(
      pokemon.stats.map(({ base_stat: value, stat }) => [stat.name, value])
    );
    if (!Number.isSafeInteger(stats['special-attack'])
        || !Number.isSafeInteger(stats['special-defense'])) {
      throw new Error(`Missing special stats for Pokémon form ${pokemon.id} (${pokemon.name}).`);
    }
    const baseStatTotal = Object.values(stats).reduce((total, value) => total + value, 0);
    const evolutionStage = getEvolutionStage(speciesId, speciesById, evolutionStages);
    const defaultSprites = defaultSpritesBySpecies.get(speciesId);
    const types = pokemon.types
      .sort((left, right) => left.slot - right.slot)
      .map(({ type }) => type.name);

    return {
      id: pokemon.id,
      species_id: speciesId,
      species_name: displayName(species.name),
      slug: pokemon.name,
      name: regionalPokemonName(pokemon.name),
      is_default: Number(pokemon.is_default),
      is_legendary: Number(species.is_legendary),
      is_mythical: Number(species.is_mythical),
      evolution_stage: evolutionStage,
      rarity: rarityFor(species, evolutionStage, baseStatTotal),
      base_hp: stats.hp,
      base_atk: stats.attack,
      base_def: stats.defense,
      base_spa: stats['special-attack'],
      base_spdef: stats['special-defense'],
      base_spd: stats.speed,
      base_stat_total: baseStatTotal,
      types: JSON.stringify(types),
      is_water: Number(types.includes('water')),
      sprite: pokemon.sprites.front_default || defaultSprites?.normal || null,
      shiny_sprite: pokemon.sprites.front_shiny || defaultSprites?.shiny || null,
      generation: species.generation.name,
    };
  }).sort((left, right) => left.id - right.id);
  appendCustomPokemonForms(catalog);
  catalog.sort((left, right) => left.id - right.id);

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(catalog)}\n`);
  fs.writeFileSync(
    EVOLUTION_CHAINS_OUTPUT,
    `${JSON.stringify(evolutionChainsBySpecies, null, 2)}\n`
  );
  fs.writeFileSync(
    EVOLUTION_RULES_OUTPUT,
    `${JSON.stringify(uniqueEvolutionRules, null, 2)}\n`
  );

  const summary = catalog.reduce((counts, pokemon) => {
    counts[pokemon.rarity] = (counts[pokemon.rarity] || 0) + 1;
    return counts;
  }, {});
  console.log(
    `Saved ${catalog.length} Pokémon and forms to ${OUTPUT} ` +
    `(${removedFormIds.size} excluded by ${path.basename(REMOVED_FORMS_PATH)}).`
  );
  console.log(`Rarity totals: ${JSON.stringify(summary)}`);
  console.log(`Saved ${uniqueEvolutionRules.length} level-based evolution rules to ${EVOLUTION_RULES_OUTPUT}.`);
}

main().catch((error) => {
  console.error('Failed to download Pokémon catalog:', error);
  process.exitCode = 1;
});
