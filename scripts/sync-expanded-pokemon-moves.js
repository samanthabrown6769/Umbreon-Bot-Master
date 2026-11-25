const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SOURCE_REVISION = 'de6760be38b60a3024f1d9054330ff265f0dc619';
const CSV_URL = `https://raw.githubusercontent.com/PokeAPI/pokeapi/${SOURCE_REVISION}/data/v2/csv`;
const LEARNING_METHODS = new Set([1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13]);

async function loadCsv(name, expectedHeader) {
  const response = await fetch(`${CSV_URL}/${name}.csv`);
  if (!response.ok) throw new Error(`Failed to download ${name}.csv: HTTP ${response.status}`);
  const lines = (await response.text()).trim().split(/\r?\n/);
  if (lines.shift() !== expectedHeader) throw new Error(`Unexpected ${name}.csv format.`);
  return lines.map((line) => line.split(','));
}

async function main() {
  const [pokemonRows, speciesRows, moveRows, learnRows] = await Promise.all([
    loadCsv('pokemon', 'id,identifier,species_id,height,weight,base_experience,order,is_default'),
    loadCsv('pokemon_species', 'id,identifier,generation_id,evolves_from_species_id,evolution_chain_id,color_id,shape_id,habitat_id,gender_rate,capture_rate,base_happiness,is_baby,hatch_counter,has_gender_differences,growth_rate_id,forms_switchable,is_legendary,is_mythical,order,conquest_order'),
    loadCsv('moves', 'id,identifier,generation_id,type_id,power,pp,accuracy,priority,target_id,damage_class_id,effect_id,effect_chance,contest_type_id,contest_effect_id,super_contest_effect_id'),
    loadCsv('pokemon_moves', 'pokemon_id,version_group_id,move_id,pokemon_move_method_id,level,order,enhancement_level'),
  ]);
  const catalog = require(path.join(ROOT, 'data', 'pokemon-catalog.json'));
  const { moves } = require(path.join(ROOT, 'data', 'pokemon-moves.json'));
  const sourcePokemon = new Map(pokemonRows.map(([id, slug, speciesId]) => [slug, {
    id: Number(id), speciesId: Number(speciesId),
  }]));
  const defaultPokemon = new Map(pokemonRows
    .filter((row) => row[7] === '1')
    .map(([id, slug, speciesId]) => [Number(speciesId), { id: Number(id), slug }]));
  const parents = new Map(speciesRows.map(([id, , , parent]) => [Number(id), parent ? Number(parent) : null]));
  const moveNames = new Map(moveRows.map(([id, name]) => [Number(id), name]));
  const movesByPokemon = new Map();
  for (const [pokemonId, , moveId, method] of learnRows) {
    const name = moveNames.get(Number(moveId));
    if (!LEARNING_METHODS.has(Number(method)) || !name || !moves[name]
        || name.startsWith('g-max-') || name.startsWith('max-')) continue;
    const id = Number(pokemonId);
    if (!movesByPokemon.has(id)) movesByPokemon.set(id, new Set());
    movesByPokemon.get(id).add(name);
  }
  const output = { source_revision: SOURCE_REVISION, species: {}, forms: {} };
  for (const pokemon of catalog) {
    const source = sourcePokemon.get(pokemon.slug);
    const direct = source && source.speciesId === pokemon.species_id
      ? movesByPokemon.get(source.id)
      : null;
    const learnable = new Set(direct || []);
    const defaultSlug = defaultPokemon.get(pokemon.species_id)?.slug;
    const formSuffix = !pokemon.is_default && defaultSlug && pokemon.slug.startsWith(`${defaultSlug}-`)
      ? pokemon.slug.slice(defaultSlug.length)
      : '';
    const visited = new Set([pokemon.species_id]);
    let parent = parents.get(pokemon.species_id);
    while (parent) {
      if (visited.has(parent)) throw new Error(`Evolution cycle for species ${pokemon.species_id}`);
      visited.add(parent);
      const parentDefault = defaultPokemon.get(parent);
      const parentForm = formSuffix && parentDefault
        ? sourcePokemon.get(`${parentDefault.slug}${formSuffix}`)
        : null;
      const parentId = parentForm?.speciesId === parent ? parentForm.id : parentDefault?.id;
      for (const move of movesByPokemon.get(parentId) || []) learnable.add(move);
      parent = parents.get(parent);
    }
    if (learnable.size) {
      (pokemon.is_default ? output.species : output.forms)[pokemon.is_default ? pokemon.species_id : pokemon.id] =
        [...learnable].sort();
    }
  }
  fs.writeFileSync(
    path.join(ROOT, 'data', 'expanded-pokemon-moves.json'),
    `${JSON.stringify(output)}\n`
  );
  console.log(`Saved expanded learnsets for ${Object.keys(output.species).length} species and ${Object.keys(output.forms).length} forms.`);
}

main().catch((error) => {
  console.error('Failed to sync expanded Pokémon moves:', error);
  process.exitCode = 1;
});
