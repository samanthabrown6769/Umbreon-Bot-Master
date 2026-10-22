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
  'indeedee-female': 'indeedee',
  'jellicent-male': 'jellicent',
  'oinkologne-male': 'oinkologne',
  'oinkologne-female': 'oinkologne',
  'maushold-family-of-three': 'maushold',
  'maushold-family-of-four': 'maushold-four',
  'dudunsparce-two-segment': 'dudunsparce',
  'dudunsparce-three-segment': 'dudunsparce-threesegment',
  'kommo-o': 'kommoo',
  'urshifu-single-strike': 'urshifu',
  'urshifu-rapid-strike': 'urshifu-rapidstrike',
  'tatsugiri-curly': 'tatsugiri',
  'tatsugiri-droopy': 'tatsugiri-droopy',
  'tatsugiri-stretchy': 'tatsugiri-stretchy',
  'gouging-fire': 'gougingfire',
  'chi-yu': 'chiyu',
  'mr-mime': 'mrmime',
  'mr-mime-galar': 'mrmime-galar',
  'tapu-koko': 'tapukoko',
  'tapu-lele': 'tapulele',
  'tapu-bulu': 'tapubulu',
  'great-tusk': 'greattusk',
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

const DIRECT_SHOWDOWN_SLUGS = new Set([
  'indeedee-male',
  'indeedee-female',
  'oinkologne-male',
  'oinkologne-female',
  'maushold-family-of-three',
  'maushold-family-of-four',
  'dudunsparce-two-segment',
  'dudunsparce-three-segment',
  'tapu-bulu',
  'tapu-lele',  'kommo-o',
  'great-tusk',  'kommo-o',
  'urshifu-single-strike',
  'urshifu-rapid-strike',
  'tatsugiri-curly',
  'tatsugiri-droopy',
  'tatsugiri-stretchy',
  'gouging-fire',
  'chi-yu',
]);

const CUSTOM_SPRITES = {
  inteleon: 'https://play.pokemonshowdown.com/sprites/ani/inteleon.gif',
  'corviknight-gmax': 'https://play.pokemonshowdown.com/sprites/ani/corviknight-gmax.gif',
  'mr-rime': 'https://res.cloudinary.com/apffqia5/image/upload/v1792006172/mrrime.gif',
  'mime-jr': 'https://res.cloudinary.com/apffqia5/image/upload/v1792006177/mimejr.gif',
  'iron-hands': 'https://res.cloudinary.com/apffqia5/image/upload/v1792075108/ironhands.gif',
  'iron-valiant': 'https://res.cloudinary.com/apffqia5/image/upload/v1792084059/iron-variant.gif',
  'iron-moth': 'https://res.cloudinary.com/apffqia5/image/upload/v1791995167/pokemon-sprites/ani/iron-moth.gif',
  miraidon: 'https://res.cloudinary.com/apffqia5/image/upload/v1792590811/miraidon.webp',
  'tapu-fini': 'https://play.pokemonshowdown.com/sprites/ani/tapufini.gif',
  'slither-wing': 'https://play.pokemonshowdown.com/sprites/ani/slitherwing.gif',
  'mr-mime': 'https://play.pokemonshowdown.com/sprites/ani/mrmime.gif',
  'palafin-zero': 'https://play.pokemonshowdown.com/sprites/ani/palafin.gif',
  'jellicent-male': 'https://play.pokemonshowdown.com/sprites/ani/jellicent.gif',
  'pyroar-male': 'https://play.pokemonshowdown.com/sprites/ani/pyroar.gif',
  'urshifu-single-strike-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/10226.webp',
  'urshifu-rapid-strike-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/10227.webp',
  'iron-leaves': 'https://res.cloudinary.com/apffqia5/image/upload/v1792270005/iron_leaves.webp',
  'iron-boulder': 'https://res.cloudinary.com/apffqia5/image/upload/v1792270237/iron_boulder.webp',
  'copperajah-gmax': 'https://play.pokemonshowdown.com/sprites/ani/copperajah-gmax.gif',
  'duraludon-gmax': 'https://play.pokemonshowdown.com/sprites/ani/duraludon-gmax.gif',
  'snorlax-gmax': 'https://play.pokemonshowdown.com/sprites/ani/snorlax-gmax.gif',
  'grimmsnarl-gmax': 'https://play.pokemonshowdown.com/sprites/ani/grimmsnarl-gmax.gif',
  'kingler-gmax': 'https://play.pokemonshowdown.com/sprites/ani/kingler-gmax.gif',
  'venusaur-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/10195.webp',
  'blastoise-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/10197.webp',
  // removed old link: eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1cm46YXBwOjdlMGQxODg5ODIyNjQzNzNhNWYwZDQxNWVhMGQyNmUwIiwiaXNzIjoidXJuOmFwcDo3ZTBkMTg4OTgyMjY0MzczYTVmMGQ0MTVlYTBkMjZlMCIsIm9iaiI6W1t7InBhdGgiOiIvZi8wYmQ5YmZkMy05Yzc2LTRhMzEtOTc3Yy04ZGFiYmNlMDk5ZWIvZG04aDBpby0yYTViYmMzMi1hYzAxLTRkOGEtYWZlNy00YWFkNWE5NGFmOTEuZ2lmIn1dXSwiYXVkIjpbInVybjpzZXJ2aWNlOmZpbGUuZG93bmxvYWQiXX0.WGMmRxSMyAd74EHO0AchL0wbZu5qSoMGYNxFFqlJ7s0',
  'cinderace-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/10210.webp',
  'eevee-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/10205.webp',
  'alcremie-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/10223.webp',
  'meowth-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/10200.webp',
  'lapras-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/10204.webp',
  'garbodor-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/10207.webp',
  'melmetal-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/10208.webp',
  'rillaboom-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/10209.webp',
  'inteleon-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/10211.webp',
  'orbeetle-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/10213.webp',
  'drednaw-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/10214.webp',
  'coalossal-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/10215.webp',
  'flapple-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/10216.webp',
  'appletun-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/10217.webp',
  'sandaconda-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/10218.webp',
  'toxtricity-amped-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/10219.webp',
  'toxtricity-low-key-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/10219.webp',
  'centiskorch-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/10220.webp',
  'hatterene-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/10221.webp',
  'butterfree-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/10198.webp',
  'pikachu-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/10199.webp',
};
const CUSTOM_SHINY_SPRITES = {
  'iron-valiant': 'https://res.cloudinary.com/apffqia5/image/upload/v1792084062/shiny_iron_valiant.gif',
  'iron-moth': 'https://res.cloudinary.com/apffqia5/image/upload/v1792590814/shiny_iron_moth.webp',
  miraidon: 'https://res.cloudinary.com/apffqia5/image/upload/v1792590811/shiny_miraidon.webp',
  'pyroar-male': 'https://play.pokemonshowdown.com/sprites/ani-shiny/pyroar.gif',
  'urshifu-single-strike-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/shiny/10226.webp',
  'urshifu-rapid-strike-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/shiny/10227.webp',
  'jellicent-male': 'https://play.pokemonshowdown.com/sprites/ani-shiny/jellicent.gif',
  'copperajah-gmax': 'https://play.pokemonshowdown.com/sprites/ani-shiny/copperajah-gmax.gif',
  'duraludon-gmax': 'https://play.pokemonshowdown.com/sprites/ani-shiny/duraludon-gmax.gif',
  'snorlax-gmax': 'https://play.pokemonshowdown.com/sprites/ani-shiny/snorlax-gmax.gif',
  'grimmsnarl-gmax': 'https://play.pokemonshowdown.com/sprites/ani-shiny/grimmsnarl-gmax.gif',
  'kingler-gmax': 'https://play.pokemonshowdown.com/sprites/ani-shiny/kingler-gmax.gif',
  'venusaur-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/shiny/10195.webp',
  'blastoise-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/shiny/10197.webp',
  // removed old link: eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1cm46YXBwOjdlMGQxODg5ODIyNjQzNzNhNWYwZDQxNWVhMGQyNmUwIiwiaXNzIjoidXJuOmFwcDo3ZTBkMTg4OTgyMjY0MzczYTVmMGQ0MTVlYTBkMjZlMCIsIm9iaiI6W1t7InBhdGgiOiIvZi83ZTA4NGI4NC0zNmJkLTQ1NTgtODZiYy0xZGVmOTQ3MzIzMDgvZGlta24ybi01YzY1OGE5MS05OTIwLTRmNzItOTMyNS1kZmExN2YzNjAwZmEuZ2lmIn1dXSwiYXVkIjpbInVybjpzZXJ2aWNlOmZpbGUuZG93bmxvYWQiXX0.VAtNK-NFmp5bsxfdhurxpvGAsPiqO2VslOl0W48hRPI',
  'cinderace-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/shiny/10210.webp',
  'eevee-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/shiny/10205.webp',
  'alcremie-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/shiny/10223.webp',
  'meowth-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/shiny/10200.webp',
  'lapras-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/shiny/10204.webp',
  'garbodor-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/shiny/10207.webp',
  'melmetal-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/shiny/10208.webp',
  'rillaboom-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/shiny/10209.webp',
  'inteleon-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/shiny/10211.webp',
  'orbeetle-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/shiny/10213.webp',
  'drednaw-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/shiny/10214.webp',
  'coalossal-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/shiny/10215.webp',
  'flapple-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/shiny/10216.webp',
  'appletun-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/shiny/10217.webp',
  'sandaconda-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/shiny/10218.webp',
  'toxtricity-amped-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/shiny/10219.webp',
  'toxtricity-low-key-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/shiny/10219.webp',
  'centiskorch-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/shiny/10220.webp',
  'hatterene-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/shiny/10221.webp',
  'butterfree-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/shiny/10198.webp',
  'pikachu-gmax': 'https://assets.pokestats.gg/pokeapi/orig/pokemon/versions/generation-viii/sword-shield/shiny/10199.webp',
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

function getPokemonShowdownSprite(slug, isShiny = false, fallback = null) {
  return getRawPokemonShowdownSprite(slug, isShiny, fallback);
}

function getRawPokemonShowdownSprite(slug, isShiny = false, fallback = null) {
  const override = spriteOverrides.get(slug);
  const overrideUrl = override && (isShiny ? override.shiny : override.normal);
  if (overrideUrl) return overrideUrl;
  if (isShiny && CUSTOM_SHINY_SPRITES[slug]) return CUSTOM_SHINY_SPRITES[slug];
  // Explicitly requested Showdown sprites skip Cloudinary, which has no upload for these names.
  if (DIRECT_SHOWDOWN_SLUGS.has(slug)) {
    return `${SHOWDOWN_ANIMATED_SPRITE_BASE}/${isShiny ? 'ani-shiny' : 'ani'}/${FORM_ALIASES[slug]}.gif`;
  }
  if (!isShiny && CUSTOM_SPRITES[slug]) return CUSTOM_SPRITES[slug];
  if (slug === 'pikachu-world-cap') return fallback;
  if (typeof slug === 'string' && /eternamax/i.test(slug)) {
    return `${SHOWDOWN_ANIMATED_SPRITE_BASE}/${isShiny ? 'ani-shiny' : 'ani'}/eternatus-eternamax.gif`;
  }
  if (typeof slug === 'string' && /gmax|gigantamax/i.test(slug)) return fallback;
  const spriteSlug = showdownSpriteSlug(slug);
  if (!spriteSlug) return fallback;
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
