const { getCloudinaryPokemonSprite, isCloudinaryEnabled } = require('./cloudinary');

const SHOWDOWN_ANIMATED_SPRITE_BASE = 'https://play.pokemonshowdown.com/sprites';

const DEFAULT_FORM_ALIASES = {
  'aegislash-shield': 'aegislash',
  'basculin-red-striped': 'basculin',
  'basculin-blue-striped': 'basculin-bluestriped',
  'basculin-white-striped': 'basculin-whitestriped',
  'basculegion-male': 'basculegion',
  'basculegion-female': 'basculegion-f',
  'darmanitan-standard': 'darmanitan',
  'deoxys-normal': 'deoxys',
  'eiscue-ice': 'eiscue',
  'frillish-male': 'frillish',
  'giratina-altered': 'giratina',
  'gourgeist-average': 'gourgeist',
  'jangmo-o': 'jangmoo',
  'keldeo-ordinary': 'keldeo',
  'lycanroc-midday': 'lycanroc',
  'mimikyu-disguised': 'mimikyu',
  'meowstic-male': 'meowstic',
  'meowstic-female': 'meowstic-f',
  'meloetta-aria': 'meloetta',
  'minior-red-meteor': 'minior',
  'nidoran-f': 'nidoranf',
  'nidoran-m': 'nidoranm',
  'oricorio-baile': 'oricorio',
  'pumpkaboo-average': 'pumpkaboo',
  'scream-tail': 'screamtail',
  'shaymin-land': 'shaymin',
  'type-null': 'typenull',
  'toxtricity-amped': 'toxtricity',
  'tornadus-incarnate': 'tornadus',
  'thundurus-incarnate': 'thundurus',
  'landorus-incarnate': 'landorus',
  'wormadam-plant': 'wormadam',
  'wishiwashi-solo': 'wishiwashi',
  'zygarde-50': 'zygarde',
  'indeedee-male': 'indeedee',
  'indeedee-female': 'indeedee-f',
  'mr-mime': 'mrmime',
  'mr-mime-galar': 'mrmime-galar',
  'tapu-koko': 'tapukoko',
  'tapu-lele': 'tapulele',
  'tapu-bulu': 'tapubulu',
  'tapu-fini': 'tapufini',
  'raging-bolt': 'ragingbolt',
  'slither-wing': 'slitherwing',
  'flutter-mane': 'fluttermane',
};

const FORM_ALIASES = {
  ...DEFAULT_FORM_ALIASES,
  'pikachu-alola-cap': 'pikachu-alola',
  'pikachu-rock-star': 'pikachu-rockstar',
  'pikachu-original-cap': 'pikachu-original',
  'pikachu-hoenn-cap': 'pikachu-hoenn',
  'pikachu-sinnoh-cap': 'pikachu-sinnoh',
  'pikachu-unova-cap': 'pikachu-unova',
  'pikachu-kalos-cap': 'pikachu-kalos',
  'pikachu-partner-cap': 'pikachu-partner',
};

const CUSTOM_SPRITES = {
  inteleon: 'https://play.pokemonshowdown.com/sprites/ani/inteleon.gif',
  'mr-rime': 'https://res.cloudinary.com/apffqia5/image/upload/v1792006172/mrrime.gif',
  'mime-jr': 'https://res.cloudinary.com/apffqia5/image/upload/v1792006177/mimejr.gif',
  'iron-hands': 'https://res.cloudinary.com/apffqia5/image/upload/v1792075108/ironhands.gif',
  'iron-valiant': 'https://res.cloudinary.com/apffqia5/image/upload/v1792084059/iron-variant.gif',
  'tapu-fini': 'https://play.pokemonshowdown.com/sprites/ani/tapufini.gif',
  'slither-wing': 'https://play.pokemonshowdown.com/sprites/ani/slitherwing.gif',
  'mr-mime': 'https://play.pokemonshowdown.com/sprites/ani/mrmime.gif',
  'palafin-zero': 'https://play.pokemonshowdown.com/sprites/ani/palafin.gif',
  'jellicent-male': 'https://play.pokemonshowdown.com/sprites/ani/jellicent.gif',
  'pyroar-male': 'https://play.pokemonshowdown.com/sprites/ani/pyroar.gif',
};
const CUSTOM_SHINY_SPRITES = {
  'iron-valiant': 'https://res.cloudinary.com/apffqia5/image/upload/v1792084062/shiny_iron_valiant.gif',
};

function showdownSpriteSlug(slug) {
  if (typeof slug !== 'string' || !slug.trim()) return null;
  const normalized = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!normalized) return null;
  if (FORM_ALIASES[normalized]) return FORM_ALIASES[normalized];

  return normalized.replace(/-mega-([xy])$/, '-mega$1');
}

// Per-slug animated sprite URLs from data/pokemon-editable.json; they win over every built-in rule.
let spriteOverrides = new Map();

function setSpriteOverrides(overrides) {
  spriteOverrides = overrides;
}

const SPRITE_RESIZE_WIDTH = 120;

// Only the large pokestats.gg artwork is resized so it matches the animated sprite size.
function resizeSprite(url) {
  if (typeof url !== 'string' || !url.startsWith('https://assets.pokestats.gg/')) return url;
  const source = url.replace(/^https?:\/\//, '');
  return `https://images.weserv.nl/?url=${encodeURIComponent(source)}&w=${SPRITE_RESIZE_WIDTH}&output=png`;
}

function getPokemonShowdownSprite(slug, isShiny = false, fallback = null) {
  return resizeSprite(getRawPokemonShowdownSprite(slug, isShiny, fallback));
}

function getRawPokemonShowdownSprite(slug, isShiny = false, fallback = null) {
  const override = spriteOverrides.get(slug);
  const overrideUrl = override && (isShiny ? override.shiny : override.normal);
  if (overrideUrl) return overrideUrl;
  if (isShiny && CUSTOM_SHINY_SPRITES[slug]) return CUSTOM_SHINY_SPRITES[slug];
  if (!isShiny && CUSTOM_SPRITES[slug]) return CUSTOM_SPRITES[slug];
  if (slug === 'pikachu-world-cap') return fallback;
  if (typeof slug === 'string' && /eternamax/i.test(slug)) {
    return `${SHOWDOWN_ANIMATED_SPRITE_BASE}/${isShiny ? 'ani-shiny' : 'ani'}/eternatus-eternamax.gif`;
  }
  if (typeof slug === 'string' && /gmax|gigantamax/i.test(slug)) return fallback;
  const spriteSlug = showdownSpriteSlug(slug);
  if (!spriteSlug) return fallback;
  if (spriteSlug === 'great-tusk') return fallback;
  // Showdown has no Mega Meowstic sprite; both mega genders share the catalog artwork.
  if (/^meowstic-(male|female)-mega$/.test(slug)) return fallback;
  if (isCloudinaryEnabled()) {
    const cloudinarySprite = getCloudinaryPokemonSprite(spriteSlug, isShiny);
    if (cloudinarySprite) return cloudinarySprite;
  }
  if (slug === 'groudon-primal' && isShiny) {
    return 'https://play.pokemonshowdown.com/sprites/ani-shiny/groudon-primal.gif';
  }
  const variantPath = isShiny ? 'ani-shiny' : 'ani';
  return `${SHOWDOWN_ANIMATED_SPRITE_BASE}/${variantPath}/${spriteSlug}.gif`;
}

module.exports = { getPokemonShowdownSprite, showdownSpriteSlug, setSpriteOverrides };
