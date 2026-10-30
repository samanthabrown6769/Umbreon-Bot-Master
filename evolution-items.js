// Species IDs are National Dex numbers. Each pair is [from, to].
// "stone" items are used straight from the inventory; "held" items must be held first.
const EVOLUTION_ITEMS = {
  'Fire Stone': {
    kind: 'stone', emoji: '<:firestone:1559927145147539507>',
    evolutions: [[37, 38], [58, 59], [133, 136], [513, 514], [951, 952]],
  },
  'Water Stone': {
    kind: 'stone', emoji: '<:waterstone:1559927127132999690>',
    evolutions: [[61, 62], [90, 91], [120, 121], [133, 134], [271, 272], [515, 516]],
  },
  'Thunder Stone': {
    kind: 'stone', emoji: '<:thunderstone:1559927129100132433>',
    evolutions: [[25, 26], [133, 135], [603, 604]],
  },
  'Leaf Stone': {
    kind: 'stone', emoji: '<:leafstone:1559927141469261956>',
    evolutions: [[44, 45], [70, 71], [102, 103], [133, 470], [274, 275], [511, 512]],
  },
  'Moon Stone': {
    kind: 'stone', emoji: '<:moonstone:1559927139749335181>',
    evolutions: [[30, 31], [33, 34], [35, 36], [39, 40], [300, 301], [517, 518]],
  },
  'Sun Stone': {
    kind: 'stone', emoji: '<:sunstone:1559927130559619123>',
    evolutions: [[44, 182], [191, 192], [546, 547], [548, 549], [694, 695]],
  },
  'Shiny Stone': {
    kind: 'stone', emoji: '<:shinystone:1559927132111634553>',
    evolutions: [[176, 468], [315, 407], [572, 573], [670, 671]],
  },
  'Dusk Stone': {
    kind: 'stone', emoji: '<:duskstone:1559927147102081084>',
    evolutions: [[198, 430], [200, 429], [608, 609], [680, 681]],
  },
  'Dawn Stone': {
    kind: 'stone', emoji: '<:dawnstone:1559927148624486500>',
    evolutions: [[281, 475], [361, 478]],
  },
  'Ice Stone': {
    kind: 'stone', emoji: '<:icestone:1559927143662882896>',
    evolutions: [[133, 471], [739, 740]],
  },
  'Oval Stone': {
    kind: 'held', emoji: '<:ovalstone:1559927138113552554>', evolutions: [[440, 113]],
  },
  'Malicious Armor': {
    kind: 'held', emoji: '<:maliciousarmor:1559927160657944596>', evolutions: [[935, 937]],
  },
  'Auspicious Armor': {
    kind: 'held', emoji: '<:auspicious_armor:1559927173220008048>', evolutions: [[935, 936]],
  },
  'Galarica Cuff': {
    kind: 'held', emoji: '<:galaricacuff:1559927166282629130>', variantOnly: true, evolutions: [[79, 80]],
  },
  'Galarica Wreath': {
    kind: 'held', emoji: '<:galaricawreath:1559927164726542366>', variantOnly: true, evolutions: [[79, 199]],
  },
  "King's Rock": { kind: 'held', emoji: '<:kingsrock:1559927176575324292>', evolutions: [[61, 186], [79, 199]] },
  'Metal Coat': { kind: 'held', emoji: '<:metalcoat:1559927174859984896>', evolutions: [[95, 208], [123, 212]] },
  'Dragon Scale': { kind: 'held', emoji: '<:dragonscale:1559927125627109486>', evolutions: [[117, 230]] },
  Upgrade: { kind: 'held', emoji: '<:upgrade:1559927152672251905>', evolutions: [[137, 233]] },
  'Dubious Disc': { kind: 'held', emoji: '<:dubious_disc:1559927167633199144>', evolutions: [[233, 474]] },
  'Deep Sea Tooth': { kind: 'held', emoji: '<:deep_sea_tooth:1559927169482760306>', evolutions: [[366, 367]] },
  'Deep Sea Scale': { kind: 'held', emoji: '<:deep_sea_scale:1559927171311607881>', evolutions: [[366, 368]] },
  Electirizer: { kind: 'held', emoji: '<:electirizer:1559927124176142457>', evolutions: [[125, 466]] },
  Magmarizer: { kind: 'held', emoji: '<:magmarizer:1559927122905006180>', evolutions: [[126, 467]] },
  Protector: { kind: 'held', emoji: '<:protector:1559927157541830707>', evolutions: [[112, 464]] },
  'Reaper Cloth': { kind: 'held', emoji: '<:reapercloth:1559927156170297434>', evolutions: [[356, 477]] },
  'Razor Claw': { kind: 'held', emoji: '<:razorclaw:1559927121520889856>', evolutions: [[215, 461]] },
  'Razor Fang': { kind: 'held', emoji: '<:razorfang:1559927120153813032>', evolutions: [[207, 472]] },
  'Prism Scale': { kind: 'held', emoji: '<:prismscale:1559927159055720449>', evolutions: [[349, 350]] },
  Sachet: { kind: 'held', emoji: '<:sachet:1559927154597302272>', evolutions: [[682, 683]] },
  'Whipped Dream': { kind: 'held', emoji: '<:whippeddream:1559927150688346132>', evolutions: [[684, 685]] },
  'Link Cable': {
    kind: 'held', emoji: '<:linkcable:1559927162377601065>',
    evolutions: [[64, 65], [67, 68], [75, 76], [93, 94]],
  },
};

const normalizeItemName = (name) => String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
const itemsByKey = new Map(
  Object.keys(EVOLUTION_ITEMS).map((name) => [normalizeItemName(name), name])
);

const ITEM_ALIASES = { linkingcord: 'Link Cable', linkingcable: 'Link Cable', linkcord: 'Link Cable' };

function findEvolutionItem(query) {
  const key = normalizeItemName(query);
  return itemsByKey.get(key) || itemsByKey.get(normalizeItemName(ITEM_ALIASES[key] || '')) || null;
}

module.exports = { EVOLUTION_ITEMS, findEvolutionItem, normalizeItemName };
