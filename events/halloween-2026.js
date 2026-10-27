const event = {
  // Event identity and schedule. Dates must be ISO-8601 timestamps with a timezone.
  id: 'halloween-2026',
  name: 'Halloween 2026',
  startsAt: '2026-10-01T00:00:00.000Z',
  endsAt: '2026-11-04T05:00:00.000Z',
  timezoneLabel: '12:00 AM EST',

  // Ticket and shop settings.
  ticketSpawnMultiplier: 10000,
  ticketPrice: 50000,
  premierballPrice: 10000,

  // All event-specific Discord emoji and text symbols are configurable here.
  emojis: {
    event: '🎃',
    complete: '✅',
    incomplete: '',
    shinyCategory: '<:shiny:1558841136905326784>',
    exclusiveCategory: '<:eventticket:1558834590855077938>',
    ticket: '<:eventticket:1558834590855077938>',
    pokecoin: '<:pokecoin:1558834592067227688>',
    premierball: '<:premierball:1558834593757405294>',
    regularReward: '🎁',
    fullReward: '🏆',
    shiny: ':shiny:1558834592067227688>',
    endDate: '🗓️',
    claimRegular: '🎁',
    claimFull: '🏆',
    announcementCatch: '🎃',
    announcementProgress: '🗺️',
  },
  announcementFooter: 'Catch Event Pokémon to compete in the event checklist!',

  // Players get the regular reward at `regular` catches and the full reward at `full`.
  checklistTargets: {
    regular: 8,
    full: 15,
  },

  // These checklist keys are displayed in the shiny section.
  shinyChecklistKeys: [
    's_spinarak',
    's_misdreavus',
    's_poochyena',
    's_sableye',
    's_duskull',
    's_drifloon',
    's_litwick',
    's_phantump',
    's_pumpkaboo',
    's_rotom',
  ],

  // Change reward Pokémon by using its catalog slug. `displayName` is saved in the box.
  // Optional `rarity: 'Gem'` is reserved for checklist rewards; leave unset unless a reward
  // is intentionally designated as Gem rarity.
  rewards: {
    regular: {
      pokemonSlug: 'typhlosion-hisui',
      shiny: true,
      displayName: 'Hisuian Typhlosion',
      announcementName: 'Shiny Hisuian Typhlosion',
    },
    full: {
      pokemonSlug: 'groudon-primal',
      shiny: true,
      displayName: 'Primal Groudon',
      announcementName: 'Shiny Primal Groudon',
    },
  },

  // Checklist and spawn pool. To add an entry:
  // - Give it a unique `key` and the name to show players.
  // - Set `matchNames` to catalog form names (punctuation/case are ignored).
  // - Set `shiny` to true only when checklist progress requires a shiny catch.
  // - Optionally add `tag` to show a note after the name.
  // Only names matching a form in the Pokémon catalog can spawn.
  // - Set `fish: true` to let the entry spawn through `.fish`; otherwise it never spawns there.
  pokemon: [
    {
      key: 's_spinarak',
      name: 'Shiny Spinarak',
      matchNames: ['Spinarak'],
      shiny: true,
    },
    {
      key: 's_misdreavus',
      name: 'Shiny Misdreavus',
      matchNames: ['Misdreavus'],
      shiny: true,
    },
    {
      key: 's_poochyena',
      name: 'Shiny Poochyena',
      matchNames: ['Poochyena'],
      shiny: true,
    },
    {
      key: 's_sableye',
      name: 'Shiny Sableye',
      matchNames: ['Sableye'],
      shiny: true,
    },
    {
      key: 's_duskull',
      name: 'Shiny Duskull',
      matchNames: ['Duskull'],
      shiny: true,
    },
    {
      key: 's_drifloon',
      name: 'Shiny Drifloon',
      matchNames: ['Drifloon'],
      shiny: true,
    },
    {
      key: 's_litwick',
      name: 'Shiny Litwick',
      matchNames: ['Litwick'],
      shiny: true,
    },
    {
      key: 's_phantump',
      name: 'Shiny Phantump',
      matchNames: ['Phantump'],
      shiny: true,
    },
    {
      key: 's_pumpkaboo',
      name: 'Shiny Pumpkaboo',
      matchNames: ['Pumpkaboo'],
      shiny: true,
    },
    {
      key: 's_rotom',
      name: 'Shiny Rotom',
      matchNames: ['Rotom'],
      shiny: true,
    },
    {
      key: 's_giratina_o',
      name: 'Shiny Giratina-Origin',
      matchNames: ['Giratina Origin', 'Giratina Origin Forme'],
      shiny: true,
    },
    {
      key: 's_flutter_mane',
      name: 'Shiny Flutter Mane',
      matchNames: ['Flutter Mane'],
      shiny: true,
    },
    {
      key: 'giratina_o',
      name: 'Giratina-Origin',
      matchNames: ['Giratina Origin', 'Giratina Origin Forme'],
      shiny: false,
    },
    {
      key: 'h_zorua',
      name: 'Hisuian Zorua',
      matchNames: ['Hisuian Zorua'],
      shiny: false,
    },
    {
      key: 'h_typhlosion',
      name: 'Hisuian Typhlosion',
      matchNames: ['Hisuian Typhlosion'],
      shiny: false,
    }
  ],
};

module.exports = event;
