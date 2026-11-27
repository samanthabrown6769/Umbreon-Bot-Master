const november = require('./november-2026');

module.exports = {
  ...november,
  id: 'november-part-2-2026',
  name: 'November Part 2',
  startsAt: november.endsAt,
  endsAt: '2026-12-16T05:00:00.000Z',
  checklistTargets: { regular: null, full: 12 },
  shinyChecklistKeys: [
    's_gastly',
    's_weedle',
    's_swinub',
    's_winter_deerling',
    's_delibird',
    's_oricorio',
  ],
  rewards: {
    full: {
      pokemonSlug: 'turquoise-rookidee',
      shiny: false,
      rarity: 'Gem',
      displayName: 'Turquoise Rookidee',
      announcementName: 'Turquoise Rookidee',
    },
  },
  pokemon: [
    { key: 's_gastly', name: 'Shiny Gastly', matchNames: ['Gastly'], shiny: true },
    { key: 's_weedle', name: 'Shiny Weedle', matchNames: ['Weedle'], shiny: true },
    { key: 's_swinub', name: 'Shiny Swinub', matchNames: ['Swinub'], shiny: true },
    { key: 's_winter_deerling', name: 'Shiny Winter Deerling', matchNames: ['Deerling Winter'], shiny: true },
    { key: 's_delibird', name: 'Shiny Delibird', matchNames: ['Delibird'], shiny: true },
    {
      key: 's_oricorio', name: 'Shiny Oricorio', matchNames: ['Oricorio Baile'], shiny: true,
      patreonOnly: true,
      checklistDisplay: '<:1741:1573347784462172321> Shiny Oricorio <:patreonlogo:1573357109058470039>',
    },
    { key: 'h_growlithe', name: 'Hisuian Growlithe', matchNames: ['Hisuian Growlithe'], shiny: false },
    {
      key: 'walking_wake', name: 'Walking Wake', matchNames: ['Walking Wake'], shiny: false,
      fishOnly: true,
      checklistDisplay: '<:WalkingWake:1568037632376569968> Walking Wake (`.fish`)',
    },
    { key: 'castform_snowy', name: 'Castform Snowy', matchNames: ['Castform Snowy'], shiny: false },
    { key: 'g_zigzagoon', name: 'Galarian Zigzagoon', matchNames: ['Galarian Zigzagoon'], shiny: false },
    { key: 'necrozma_dusk', name: 'Necrozma Duskmane', matchNames: ['Necrozma Duskmane', 'Necrozma Dusk'], shiny: false },
    { key: 'necrozma_dawn', name: 'Necrozma Dawnwings', matchNames: ['Necrozma Dawnwings', 'Necrozma Dawn'], shiny: false },
  ],
};
