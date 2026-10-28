const halloween = require('./halloween-2026');

// Starts the moment Halloween 2026 ends; the bot switches events automatically.
const event = {
  ...halloween,
  id: 'november-2026',
  name: 'November 2026',
  startsAt: halloween.endsAt,
  endsAt: '2026-11-25T05:00:00.000Z',

  emojis: {
    ...halloween.emojis,
    event: '🍂',
    announcementCatch: '🍂',
  },

  // Only one reward: the full checklist. `regular: null` disables the partial reward.
  checklistTargets: {
    regular: null,
    full: 10,
  },

  shinyChecklistKeys: [
    's_tarountula',
    's_girafarig',
    's_bidoof',
    's_caterpie',
    's_murkrow',
  ],

  rewards: {
    full: {
      pokemonSlug: 'topaz-teddiursa',
      shiny: false,
      rarity: 'Gem',
      displayName: 'Topaz Teddiursa',
      announcementName: 'Topaz Teddiursa',
    },
  },

  pokemon: [
    { key: 's_tarountula', name: 'Shiny Tarountula', matchNames: ['Tarountula'], shiny: true },
    { key: 's_girafarig', name: 'Shiny Girafarig', matchNames: ['Girafarig'], shiny: true },
    { key: 's_bidoof', name: 'Shiny Bidoof', matchNames: ['Bidoof'], shiny: true },
    { key: 's_caterpie', name: 'Shiny Caterpie', matchNames: ['Caterpie'], shiny: true },
    { key: 's_murkrow', name: 'Shiny Murkrow', matchNames: ['Murkrow'], shiny: true },
    { key: 'ash_greninja', name: 'Ash Greninja', matchNames: ['Greninja Ash', 'Ash Greninja'], shiny: false },
    { key: 'g_ponyta', name: 'Galarian Ponyta', matchNames: ['Galarian Ponyta'], shiny: false },
    { key: 'arceus_ghost', name: 'Arceus Ghost', matchNames: ['Arceus Ghost'], shiny: false },
    { key: 'meltan', name: 'Meltan', matchNames: ['Meltan'], shiny: false },
    { key: 'deoxys_speed', name: 'Deoxys Speed', matchNames: ['Deoxys Speed'], shiny: false },
  ],
};

module.exports = event;
