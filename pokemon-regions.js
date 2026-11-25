const POKEDEX_REGIONS = Object.freeze({
  kanto: Object.freeze({ name: 'Kanto', firstSpeciesId: 1, lastSpeciesId: 151 }),
  johto: Object.freeze({ name: 'Johto', firstSpeciesId: 152, lastSpeciesId: 251 }),
  hoenn: Object.freeze({ name: 'Hoenn', firstSpeciesId: 252, lastSpeciesId: 386 }),
  sinnoh: Object.freeze({ name: 'Sinnoh', firstSpeciesId: 387, lastSpeciesId: 493 }),
  unova: Object.freeze({ name: 'Unova', firstSpeciesId: 494, lastSpeciesId: 649 }),
  kalos: Object.freeze({ name: 'Kalos', firstSpeciesId: 650, lastSpeciesId: 721 }),
  alola: Object.freeze({ name: 'Alola', firstSpeciesId: 722, lastSpeciesId: 809 }),
  galar: Object.freeze({ name: 'Galar', firstSpeciesId: 810, lastSpeciesId: 898 }),
  hisui: Object.freeze({ name: 'Hisui', firstSpeciesId: 899, lastSpeciesId: 905 }),
  paldea: Object.freeze({ name: 'Paldea', firstSpeciesId: 906, lastSpeciesId: 1025 }),
});

function getPokedexRegion(name) {
  return typeof name === 'string'
    ? POKEDEX_REGIONS[name.trim().toLowerCase()] || null
    : null;
}

function isPokemonInPokedexRegion(speciesId, region) {
  return Number.isSafeInteger(speciesId)
    && Boolean(region)
    && speciesId >= region.firstSpeciesId
    && speciesId <= region.lastSpeciesId;
}

module.exports = { getPokedexRegion, isPokemonInPokedexRegion };
