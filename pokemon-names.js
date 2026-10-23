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
  'deoxys-normal': 'Deoxys',
  'giratina-altered': 'Giratina',
  'pyroar-male': 'Pyroar',
  'jellicent-male': 'Jellicent',
  'oinkologne-male': 'Oinkologne',
  'oinkologne-female': 'Oinkologne',
  'indeedee-male': 'Indeedee',
  'indeedee-female': 'Indeedee',
  'maushold-family-of-three': 'Maushold',
  'dudunsparce-two-segment': 'Dudunsparce',
  'tatsugiri-curly': 'Tatsugiri',
  'type-null': 'Type: Null',
  'nidoran-f': 'Nidoran♀',
  'nidoran-m': 'Nidoran♂',
  missingno: 'MissingNo.',
  'missingno-ghost': 'MissingNo. (Ghost)',
  'missingno-aerodactyl': 'MissingNo. (Aerodactyl)',
  'missingno-kabutops': 'MissingNo. (Kabutops)',
  'unown-exclamation': 'Unown !',
  'unown-question': 'Unown ?',
  'pikachu-mimikyu': 'Pikachu (Mimikyu)',
  'tauros-paldea-blaze-breed': 'Tauros Blaze',
  'spiky-eared-pichu': 'Spiky-Eared Pichu',
  'eevee-flower-crown': 'Flower Crown Eevee',
  'vaporeon-flower-crown': 'Flower Crown Vaporeon',
  'jolteon-flower-crown': 'Flower Crown Jolteon',
  'flareon-flower-crown': 'Flower Crown Flareon',
  'espeon-flower-crown': 'Flower Crown Espeon',
  'umbreon-flower-crown': 'Flower Crown Umbreon',
  'leafeon-flower-crown': 'Flower Crown Leafeon',
  'glaceon-flower-crown': 'Flower Crown Glaceon',
  'sylveon-flower-crown': 'Flower Crown Sylveon',
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
  if (slug === 'gourgeist-average') return 'Gourgeist';
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
