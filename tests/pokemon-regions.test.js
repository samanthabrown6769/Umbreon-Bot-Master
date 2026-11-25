const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { getPokedexRegion, isPokemonInPokedexRegion } = require('../pokemon-regions');
const indexSource = fs.readFileSync(require.resolve('../index.js'), 'utf8');

test('regional Pokédex lookup accepts every supported region case-insensitively', () => {
  for (const [name, firstSpeciesId, lastSpeciesId] of [
    ['Kanto', 1, 151],
    ['Johto', 152, 251],
    ['Hoenn', 252, 386],
    ['Sinnoh', 387, 493],
    ['Unova', 494, 649],
    ['Kalos', 650, 721],
    ['Alola', 722, 809],
    ['Galar', 810, 898],
    ['Hisui', 899, 905],
    ['Paldea', 906, 1025],
  ]) {
    const region = getPokedexRegion(name.toUpperCase());
    assert.equal(region.name, name);
    assert.equal(isPokemonInPokedexRegion(firstSpeciesId, region), true);
    assert.equal(isPokemonInPokedexRegion(lastSpeciesId, region), true);
    assert.equal(isPokemonInPokedexRegion(firstSpeciesId - 1, region), false);
    assert.equal(isPokemonInPokedexRegion(lastSpeciesId + 1, region), false);
  }
});

test('regional Pokédex lookup rejects unknown names and invalid species IDs', () => {
  assert.equal(getPokedexRegion('unknown'), null);
  assert.equal(getPokedexRegion(null), null);
  assert.equal(isPokemonInPokedexRegion('152', getPokedexRegion('johto')), false);
});

test('regional .d commands enter the paginated regional Pokédex and filter by species range', () => {
  assert.match(indexSource, /getPokedexRegion\(args\[0\]\)/);
  assert.match(indexSource, /\(command === 'dex' \|\| command === 'd'\) && \(args\.length === 0 \|\| requestedDexRegion\)/);
  assert.match(indexSource, /!dexRegion \|\| isPokemonInPokedexRegion\(pokemon\.species_id, dexRegion\)/);
});
