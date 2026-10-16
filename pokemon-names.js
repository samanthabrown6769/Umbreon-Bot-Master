const SPECIAL_NAMES = {
  flabebe: 'Flabébé',
  farfetchd: "Farfetch'd",
  sirfetchd: "Sirfetch'd",
  'ho-oh': 'Ho-Oh',
  'jangmo-o': 'Jangmo-o',
  'hakamo-o': 'Hakamo-o',
  'kommo-o': 'Kommo-o',
  'mime-jr': 'Mime Jr.',
  'mr-mime': 'Mr. Mime',
  'mr-rime': 'Mr. Rime',
  'type-null': 'Type: Null',
  'nidoran-f': 'Nidoran♀',
  'nidoran-m': 'Nidoran♂',
};

const REGIONAL_ADJECTIVES = {
  alola: 'Alolan',
  galar: 'Galarian',
  hisui: 'Hisuian',
  paldea: 'Paldean',
};

function displayName(slug) {
  return SPECIAL_NAMES[slug]
    || slug.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function regionalPokemonName(slug) {
  if (slug === 'pumpkaboo-average') return 'Pumpkaboo';
  const match = slug.match(/^(.*?)-(alola|galar|hisui|paldea)(?:-(.+))?$/);
  if (!match || (match[2] === 'alola' && ['cap', 'totem'].includes(match[3]))) {
    return displayName(slug);
  }
  const [, baseSlug, region, suffix] = match;
  return [
    REGIONAL_ADJECTIVES[region],
    displayName(baseSlug),
    suffix ? displayName(suffix) : '',
  ].filter(Boolean).join(' ');
}

module.exports = { displayName, regionalPokemonName };
