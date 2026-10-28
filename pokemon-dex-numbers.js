const { loadPokemonDatabase } = require('./pokemon-database');
const {
  GOLDEN_FORM_DEX_NUMBERS,
  GOLDEN_REGIONAL_FORMS,
  isGoldenBaseForm,
} = require('./golden-pokemon');

const FORM_DEX_STARTS = {
  mega: 4001,
  shinyMega: 4501,
  gmax: 5001,
  shinyGmax: 5501,
  formes: 6001,
  shinyFormes: 11000,
};
const GOLDEN_DEX_START = 9001;
const NO_SHINY_SLUGS = new Set(['topaz-teddiursa', 'topaz-ursaring']);
const SHINY_BASE_SPECIES_END = 999;
const GOLDEN_SCREENSHOT_DEX_END = 9999;
const pokemonCatalog = require('./data/pokemon-catalog.json');
const MAX_GOLDEN_BASE_SPECIES_ID = Math.max(
  ...pokemonCatalog
    .filter((pokemon) => pokemon.is_default)
    .map((pokemon) => pokemon.species_id)
);
const MAX_GOLDEN_REGIONAL_DEX_NUMBER = Math.max(
  GOLDEN_SCREENSHOT_DEX_END,
  ...[...GOLDEN_REGIONAL_FORMS.values()].map((form) => form.dexNumber)
);
const SHINY_HIGH_SPECIES_START = MAX_GOLDEN_REGIONAL_DEX_NUMBER + 1;
const SCREENSHOT_MEGA_DEX_NUMBERS = [
  ['venusaur-mega', 7001],
  ['charizard-mega-x', 7004],
  ['charizard-mega-y', 7007],
  ['blastoise-mega', 7010],
  ['sceptile-mega', 7013],
  ['blaziken-mega', 7016],
  ['swampert-mega', 7019],
  ['gardevoir-mega', 7022],
  ['beedrill-mega', 7025],
  ['ampharos-mega', 7028],
  ['sableye-mega', 7031],
  ['garchomp-mega', 7034],
  ['pidgeot-mega', 7037],
  ['gengar-mega', 7040],
  ['steelix-mega', 7043],
  ['lopunny-mega', 7046],
  ['alakazam-mega', 7049],
  ['scizor-mega', 7052],
  ['mawile-mega', 7055],
  ['lucario-mega', 7058],
  ['slowbro-mega', 7061],
  ['heracross-mega', 7064],
  ['aggron-mega', 7067],
  ['abomasnow-mega', 7070],
  ['kangaskhan-mega', 7073],
  ['houndoom-mega', 7076],
  ['medicham-mega', 7079],
  ['gallade-mega', 7082],
  ['pinsir-mega', 7085],
  ['tyranitar-mega', 7088],
  ['manectric-mega', 7091],
  ['audino-mega', 7094],
  ['gyarados-mega', 7097],
  ['aerodactyl-mega', 7100],
  ['sharpedo-mega', 7103],
  ['diancie-mega', 7106],
  ['mewtwo-mega-x', 7109],
  ['camerupt-mega', 7112],
  ['altaria-mega', 7115],
  ['rayquaza-mega', 7118],
  ['mewtwo-mega-y', 7121],
  ['banette-mega', 7124],
  ['absol-mega', 7127],
  ['glalie-mega', 7130],
  ['salamence-mega', 7133],
  ['metagross-mega', 7136],
  ['latias-mega', 7139],
  ['latios-mega', 7142],
  ['victreebel-mega', 7302],
  ['dragonite-mega', 7305],
  ['clefable-mega', 7308],
  ['starmie-mega', 7311],
  ['meganium-mega', 7314],
  ['skarmory-mega', 7317],
  ['emboar-mega', 7320],
  ['feraligatr-mega', 7323],
  ['froslass-mega', 7326],
  ['zeraora-mega', 7329],
  ['darkrai-mega', 7332],
];
const SCREENSHOT_GMAX_DEX_NUMBERS = [
  ['charizard-gmax', 7145],
  ['cinderace-gmax', 7148],
  ['gengar-gmax', 7151],
  ['eevee-gmax', 7154],
  ['machamp-gmax', 7157],
  ['blastoise-gmax', 7160],
  ['venusaur-gmax', 7163],
  ['butterfree-gmax', 7166],
  ['pikachu-gmax', 7169],
  ['meowth-gmax', 7172],
  ['lapras-gmax', 7175],
  ['snorlax-gmax', 7178],
  ['kingler-gmax', 7181],
  ['corviknight-gmax', 7184],
  ['melmetal-gmax', 7187],
  ['garbodor-gmax', 7190],
  ['alcremie-gmax', 7193],
  ['toxtricity-amped-gmax', 7196],
  ['coalossal-gmax', 7199],
  ['grimmsnarl-gmax', 7202],
  ['rillaboom-gmax', 7205],
  ['sandaconda-gmax', 7208],
  ['centiskorch-gmax', 7211],
  ['duraludon-gmax', 7214],
  ['inteleon-gmax', 7217],
  ['orbeetle-gmax', 7220],
  ['drednaw-gmax', 7223],
  ['copperajah-gmax', 7226],
  ['flapple-gmax', 7229],
  ['urshifu-single-strike-gmax', 7232],
  ['urshifu-rapid-strike-gmax', 7235],
  ['hatterene-gmax', 7238],
  ['appletun-gmax', 7241],
  ['eternatus-eternamax', 7244],
];
const LATE_SPECIES_DEX_NUMBERS = [
  ['archaludon', 8300],
  ['hydrapple', 8302],
  ['raging-bolt', 8304],
  ['iron-boulder', 8306],
  ['iron-crown', 8308],
  ['terapagos', 8310],
  ['pecharunt', 8312],
];
// Per-species shiny dex overrides for screenshot-specific entries.
const SHINY_FORM_DEX_NUMBERS_BY_SPECIES = new Map();
const SHINY_DEX_NUMBER_OVERRIDES_BY_SLUG = new Map([
  ['meltan', 1808],
  ['melmetal', 1809],
  ['nickit', 1827],
  ['thievul', 1828],
  ['wooloo', 1831],
  ['dubwool', 1832],
  ['silicobra', 1843],
  ['sandaconda', 1844],
  ['toxel', 1848],
  ['toxtricity-amped', 1849],
  ['clobbopus', 1852],
  ['grapploct', 1853],
  ['impidimp', 1859],
  ['morgrem', 1860],
  ['grimmsnarl', 1861],
  ['obstagoon', 1862],
  ['perrserker', 1863],
  ['cursola', 1864],
  ['zacian', 1888],
  ['zarude', 1893],
  ['regieleki', 1894],
  ['regidrago', 1895],
  ['glastrier', 1896],
  ['deoxys-attack', 7502],
  ['deoxys-defense', 7505],
  ['deoxys-speed', 7508],
  ['kyurem-black', 7511],
  ['kyurem-white', 7514],
  ['tornadus-therian', 7517],
  ['thundurus-therian', 7520],
  ['landorus-therian', 7523],
  ['shaymin-sky', 7547],
  ['hoopa-unbound', 7553],
  ['zygarde-complete', 7565],
  ['zygarde-10', 7568],
  ['groudon-primal', 7574],
  ['giratina-origin', 7580],
  ['kyogre-primal', 7584],
  ['keldeo-resolute', 7601],
  ['meloetta-pirouette', 7607],
  ['rotom-wash', 7613],
  ['marowak-alola', 7616],
  ['exeggutor-alola', 7622],
  ['rotom-fan', 7625],
  ['rotom-heat', 7631],
  ['geodude-alola', 7634],
  ['graveler-alola', 7637],
  ['golem-alola', 7640],
  ['rotom-frost', 7646],
  ['sandshrew-alola', 7649],
  ['sandslash-alola', 7652],
  ['rotom-mow', 7658],
  ['meowth-alola', 7661],
  ['persian-alola', 7664],
  ['necrozma-dawn', 7670],
  ['necrozma-dusk', 7688],
  ['raichu-alola', 7691],
  ['necrozma-ultra', 7694],
  ['castform-snowy', 7697],
  ['grimer-alola', 7700],
  ['muk-alola', 7703],
  ['rattata-alola', 7709],
  ['raticate-alola', 7712],
  ['vulpix-alola', 7718],
  ['ninetales-alola', 7721],
  ['articuno-galar', 7751],
  ['zapdos-galar', 7754],
  ['moltres-galar', 7757],
  ['lycanroc-dusk', 7769],
  ['aegislash-blade', 7777],
  ['dialga-origin', 7790],
  ['palkia-origin', 7793],
  ['darumaka-galar', 7796],
  ['zorua-hisui', 7802],
  ['zoroark-hisui', 7805],
  ['typhlosion-hisui', 7808],
  ['growlithe-hisui', 7811],
  ['arcanine-hisui', 7814],
  ['braviary-hisui', 7817],
  ['samurott-hisui', 7820],
  ['zigzagoon-galar', 7826],
  ['linoone-galar', 7829],
  ['weezing-galar', 7832],
  ['slowpoke-galar', 7835],
  ['slowbro-galar', 7838],
  ['slowking-galar', 7841],
  ['cramorant-gorging', 7859],
  ['morpeko-hangry', 7880],
  ['corsola-galar', 7883],
  ['oricorio-sensu', 7886],
  ['zacian-crowned', 7892],
  ['zamazenta-crowned', 7910],
  ['wooper-paldea', 7914],
  ['voltorb-hisui', 7917],
  ['electrode-hisui', 7920],
  ['sneasel-hisui', 7926],
  ['decidueye-hisui', 7929],
  ['chi-yu', 7953],
  ['roaring-moon', 7956],
  ['iron-valiant', 7959],
  ['pikachu-partner-cap', 7965],
  ['koraidon', 7968],
  ['miraidon', 7971],
  ['walking-wake', 7974],
  ['floette-eternal', 8192],
  ['pikachu-sinnoh-cap', 8195],
  ['ogerpon-wellspring-mask', 8212],
  ['ogerpon-hearthflame-mask', 8215],
  ['ogerpon-cornerstone-mask', 8218],
  ['pikachu-belle', 7526],
  ['pikachu-pop-star', 7529],
  ['pikachu-libre', 7532],
  ['pikachu-rock-star', 7535],
  ['pikachu-phd', 7538],
  ['greninja-ash', 7541],
  ...[...SCREENSHOT_MEGA_DEX_NUMBERS, ...SCREENSHOT_GMAX_DEX_NUMBERS]
    .map(([slug, dexNumber]) => [slug, dexNumber + 1]),
  ...LATE_SPECIES_DEX_NUMBERS.map(([slug, dexNumber]) => [slug, dexNumber + 1]),
]);
const DEX_NUMBER_OVERRIDES_BY_SLUG = new Map([
  ['deoxys-attack', 7501],
  ['deoxys-defense', 7504],
  ['deoxys-speed', 7507],
  ['kyurem-black', 7510],
  ['kyurem-white', 7513],
  ['tornadus-therian', 7516],
  ['thundurus-therian', 7519],
  ['landorus-therian', 7522],
  ['arceus-ice', 7543],
  ['shaymin-sky', 7546],
  ['arceus-fire', 7549],
  ['hoopa-unbound', 7552],
  ['arceus-water', 7555],
  ['genesect-shock', 7558],
  ['arceus-poison', 7561],
  ['zygarde-complete', 7564],
  ['zygarde-10', 7567],
  ['arceus-grass', 7570],
  ['groudon-primal', 7573],
  ['arceus-dark', 7576],
  ['giratina-origin', 7579],
  ['arceus-flying', 7581],
  ['kyogre-primal', 7583],
  ['arceus-electric', 7588],
  ['shadow-lugia', 7591],
  ['arceus-rock', 7594],
  ['arceus-ground', 7597],
  ['keldeo-resolute', 7600],
  ['arceus-dragon', 7603],
  ['meloetta-pirouette', 7606],
  ['arceus-steel', 7609],
  ['arceus-fairy', 7618],
  ['arceus-ghost', 7627],
  ['arceus-fighting', 7642],
  ['arceus-psychic', 7654],
  ['arceus-bug', 7666],
  ['necrozma-dawn', 7669],
  ['xerneas-neutral', 7684],
  ['necrozma-dusk', 7687],
  ['necrozma-ultra', 7693],
  ['dialga-primal', 7705],
  ['articuno-galar', 7750],
  ['zapdos-galar', 7753],
  ['moltres-galar', 7756],
  ['calyrex-shadow', 7873],
  ['dialga-origin', 7789],
  ['palkia-origin', 7792],
  ['calyrex-ice', 7888],
  ['zacian-crowned', 7891],
  ['zamazenta-crowned', 7909],
  ['wo-chien', 7943],
  ['chien-pao', 7946],
  ['ting-lu', 7949],
  ['chi-yu', 7952],
  ['enamorus-therian', 7961],
  ['koraidon', 7967],
  ['miraidon', 7970],
  ['walking-wake', 7973],
  ['iron-leaves', 7976],
  ['shadow-mewtwo', 7982],
  ['missingno', 7997],
  ['okidogi', 8158],
  ['munkidori', 8161],
  ['fezandipiti', 8164],
  ['ogerpon', 8167],
  ['gouging-fire', 8176],
  ['ogerpon-teal', 8208],
  ['ogerpon-wellspring-mask', 8211],
  ['ogerpon-hearthflame-mask', 8214],
  ['ogerpon-cornerstone-mask', 8217],
  ['rotom-wash', 7612],
  ['marowak-alola', 7615],
  ['exeggutor-alola', 7621],
  ['rotom-fan', 7624],
  ['rotom-heat', 7630],
  ['geodude-alola', 7633],
  ['graveler-alola', 7636],
  ['golem-alola', 7639],
  ['rotom-frost', 7645],
  ['sandshrew-alola', 7648],
  ['sandslash-alola', 7651],
  ['rotom-mow', 7657],
  ['meowth-alola', 7660],
  ['persian-alola', 7663],
  ['diglett-alola', 7675],
  ['dugtrio-alola', 7678],
  ['furfrou-dandy', 7681],
  ['raichu-alola', 7690],
  ['castform-snowy', 7696],
  ['grimer-alola', 7699],
  ['muk-alola', 7702],
  ['rattata-alola', 7708],
  ['raticate-alola', 7711],
  ['castform-rainy', 7714],
  ['vulpix-alola', 7717],
  ['ninetales-alola', 7720],
  ['darmanitan-zen', 7723],
  ['furfrou-star', 7726],
  ['genesect-chill', 7729],
  ['burmy-sandy', 7732],
  ['wormadam-sandy', 7735],
  ['burmy-trash', 7738],
  ['wormadam-trash', 7741],
  ['shellos-east', 7744],
  ['gastrodon-east', 7747],
  ['genesect-burn', 7762],
  ['genesect-douse', 7765],
  ['lycanroc-dusk', 7768],
  ['eiscue-noice', 7771],
  ['lycanroc-midnight', 7773],
  ['aegislash-blade', 7776],
  ['castform-sunny', 7780],
  ['ponyta-galar', 7783],
  ['rapidash-galar', 7786],
  ['darumaka-galar', 7795],
  ['zorua-hisui', 7801],
  ['zoroark-hisui', 7804],
  ['typhlosion-hisui', 7807],
  ['growlithe-hisui', 7810],
  ['arcanine-hisui', 7813],
  ['braviary-hisui', 7816],
  ['samurott-hisui', 7819],
  ['yamask-galar', 7822],
  ['zigzagoon-galar', 7825],
  ['linoone-galar', 7828],
  ['weezing-galar', 7831],
  ['slowpoke-galar', 7834],
  ['slowbro-galar', 7837],
  ['slowking-galar', 7840],
  ['minior-blue', 7846],
  ['minior-green', 7849],
  ['minior-yellow', 7852],
  ['furfrou-heart', 7855],
  ['cramorant-gorging', 7858],
  ['minior-violet', 7861],
  ['minior-orange', 7864],
  ['minior-red', 7867],
  ['minior-indigo', 7870],
  ['toxtricity-low-key', 7876],
  ['morpeko-hangry', 7879],
  ['corsola-galar', 7882],
  ['oricorio-sensu', 7885],
  ['stunfisk-galar', 7894],
  ['meowth-galar', 7897],
  ['farfetchd-galar', 7900],
  ['wooper-paldea', 7913],
  ['voltorb-hisui', 7916],
  ['electrode-hisui', 7919],
  ['mimikyu-busted', 7922],
  ['sneasel-hisui', 7925],
  ['decidueye-hisui', 7928],
  ['qwilfish-hisui', 7931],
  ['lilligant-hisui', 7934],
  ['gimmighoul-roaming', 7937],
  ['gholdengo', 7940],
  ['roaring-moon', 7955],
  ['iron-valiant', 7958],
  ['pikachu-partner-cap', 7964],
  ['cramorant-gulping', 7985],
  ['oricorio-pau', 7991],
  ['pikachu-hoenn-cap', 8140],
  ['palafin-hero', 8143],
  ['ursaluna-bloodmoon', 8146],
  ['dipplin', 8149],
  ['poltchageist', 8152],
  ['sinistcha', 8155],
  ['floette-eternal', 8191],
  ['pikachu-sinnoh-cap', 8194],
  ['sliggoo-hisui', 8202],
  ['goodra-hisui', 8205],
  ['oricorio-pom-pom', 8253],
  ['pikachu-belle', 7525],
  ['pikachu-pop-star', 7528],
  ['pikachu-libre', 7531],
  ['pikachu-rock-star', 7534],
  ['pikachu-phd', 7537],
  ['greninja-ash', 7540],
  ...SCREENSHOT_MEGA_DEX_NUMBERS,
  ...SCREENSHOT_GMAX_DEX_NUMBERS,
  ...LATE_SPECIES_DEX_NUMBERS,
]);


function isGmax(pokemon) {
  return /gmax|gigantamax|eternamax/i.test(`${pokemon.name} ${pokemon.slug}`);
}

function isMega(pokemon) {
  return /\bmega\b/i.test(`${pokemon.name} ${pokemon.slug}`) && !isGmax(pokemon);
}

function sortedForms(forms) {
  return [...forms].sort((left, right) =>
    left.species_id - right.species_id || left.id - right.id
  );
}

function getPokemonDexGroups(pokemonForms) {
  const forms = [...pokemonForms];
  return [
    {
      key: 'mega',
      start: FORM_DEX_STARTS.mega,
      forms: sortedForms(forms.filter(isMega)),
      shiny: false,
    },
    {
      key: 'shinyMega',
      start: FORM_DEX_STARTS.shinyMega,
      forms: sortedForms(forms.filter(isMega)),
      shiny: true,
    },
    {
      key: 'gmax',
      start: FORM_DEX_STARTS.gmax,
      forms: sortedForms(forms.filter(isGmax)),
      shiny: false,
    },
    {
      key: 'shinyGmax',
      start: FORM_DEX_STARTS.shinyGmax,
      forms: sortedForms(forms.filter(isGmax)),
      shiny: true,
    },
    {
      key: 'formes',
      start: FORM_DEX_STARTS.formes,
      forms: sortedForms(forms.filter((pokemon) =>
        !pokemon.is_default
        && !isMega(pokemon)
        && !isGmax(pokemon)
      )),
      shiny: false,
    },
    {
      key: 'shinyFormes',
      start: FORM_DEX_STARTS.shinyFormes,
      forms: sortedForms(forms.filter((pokemon) =>
        !pokemon.is_default && !isMega(pokemon) && !isGmax(pokemon)
      )),
      shiny: true,
    },
  ];
}

function getPokemonDexNumbers(pokemonForms) {
  const numbers = new Map();
  for (const pokemon of pokemonForms) {
    if (pokemon.is_default) {
      numbers.set(pokemon.id, {
        dexNumber: pokemon.species_id,
        shinyDexNumber: pokemon.species_id <= SHINY_BASE_SPECIES_END
          ? pokemon.species_id + 1000
          : SHINY_HIGH_SPECIES_START + pokemon.species_id - 1000,
      });
    }
  }
  for (const { start, forms, shiny } of getPokemonDexGroups(pokemonForms)) {
    forms.forEach((pokemon, index) => {
      const current = numbers.get(pokemon.id) || {};
      // Each form takes an even number and its shiny takes the next one.
      if (shiny) current.shinyDexNumber = current.dexNumber + 1;
      else current.dexNumber = start + index * 2;
      numbers.set(pokemon.id, current);
    });
  }
  for (const pokemon of pokemonForms) {
    const shinyDexNumber = SHINY_FORM_DEX_NUMBERS_BY_SPECIES.get(pokemon.species_id);
    if (pokemon.is_default && shinyDexNumber) {
      numbers.get(pokemon.id).shinyDexNumber = shinyDexNumber;
    }
  }
  // Numbers edited in pokemon-database/*.json win over the generated ones.
  const edits = loadPokemonDatabase();
  for (const pokemon of pokemonForms) {
    const edited = edits.get(pokemon.slug);
    const current = numbers.get(pokemon.id);
    if (!edited || !current) continue;
    if (edited.dexNumber) current.dexNumber = edited.dexNumber;
    if (edited.shinyDexNumber) current.shinyDexNumber = edited.shinyDexNumber;
  }
  for (const pokemon of pokemonForms) {
    const dexNumber = DEX_NUMBER_OVERRIDES_BY_SLUG.get(pokemon.slug);
    const current = numbers.get(pokemon.id);
    if (dexNumber && current) current.dexNumber = dexNumber;
  }
  for (const pokemon of pokemonForms) {
    const shinyDexNumber = SHINY_DEX_NUMBER_OVERRIDES_BY_SLUG.get(pokemon.slug);
    const current = numbers.get(pokemon.id);
    if (shinyDexNumber && current) current.shinyDexNumber = shinyDexNumber;
    else if (current && !pokemon.is_default && DEX_NUMBER_OVERRIDES_BY_SLUG.has(pokemon.slug)) {
      current.shinyDexNumber = current.dexNumber + 1;
    }
  }
  // Forms that have no shiny variant and therefore no shiny Dex number.
  for (const pokemon of pokemonForms) {
    if (NO_SHINY_SLUGS.has(pokemon.slug)) delete numbers.get(pokemon.id)?.shinyDexNumber;
  }
  return numbers;
}

function getDexNumberOverride(slug) {
  return DEX_NUMBER_OVERRIDES_BY_SLUG.get(slug) || null;
}

function getShinyDexNumberOverride(slug) {
  return SHINY_DEX_NUMBER_OVERRIDES_BY_SLUG.get(slug) || null;
}

function getGoldenDexNumber(speciesId, formSlug = null) {
  if (!Number.isSafeInteger(speciesId) || speciesId <= 0 || speciesId > 1999) return null;
  if (formSlug) {
    const dexNumber = GOLDEN_FORM_DEX_NUMBERS.get(formSlug);
    if (dexNumber) {
      const goldenForm = GOLDEN_REGIONAL_FORMS.get(formSlug);
      const formSpeciesId = goldenForm?.speciesId
        ?? pokemonCatalog.find((pokemon) => pokemon.slug === formSlug)?.species_id;
      return formSpeciesId === speciesId ? dexNumber : null;
    }
    const goldenForm = GOLDEN_REGIONAL_FORMS.get(formSlug);
    if (goldenForm) return goldenForm.speciesId === speciesId ? goldenForm.dexNumber : null;
    if (!isGoldenBaseForm(speciesId, formSlug)) return null;
  }
  return GOLDEN_DEX_START - 1 + speciesId;
}

function getGoldenSpeciesId(dexNumber) {
  if (!Number.isSafeInteger(dexNumber)) return null;
  if (dexNumber >= GOLDEN_DEX_START
      && dexNumber <= GOLDEN_DEX_START - 1 + MAX_GOLDEN_BASE_SPECIES_ID) {
    return dexNumber - GOLDEN_DEX_START + 1;
  }
  return null;
}

function isGoldenFormSupported(speciesId, formSlug, isDefault = false) {
  if (isDefault || isGoldenBaseForm(speciesId, formSlug)) return true;
  if (GOLDEN_FORM_DEX_NUMBERS.has(formSlug)) {
    return pokemonCatalog.some((pokemon) =>
      pokemon.slug === formSlug && pokemon.species_id === speciesId
    );
  }
  const goldenForm = GOLDEN_REGIONAL_FORMS.get(formSlug);
  return Boolean(goldenForm && goldenForm.speciesId === speciesId);
}

function isGoldenDexNumber(dexNumber) {
  return Number.isSafeInteger(dexNumber)
    && (getGoldenSpeciesId(dexNumber) !== null
      || [...GOLDEN_FORM_DEX_NUMBERS.values()].includes(dexNumber)
      || [...GOLDEN_REGIONAL_FORMS.values()].some((form) => form.dexNumber === dexNumber));
}

module.exports = {
  GOLDEN_DEX_START,
  getDexNumberOverride,
  getShinyDexNumberOverride,
  getGoldenDexNumber,
  getGoldenSpeciesId,
  isGoldenFormSupported,
  getPokemonDexGroups,
  getPokemonDexNumbers,
  isGoldenDexNumber,
};
