function challenge(region, stage, trainer, speciesIds, baseLevel, reward) {
  return {
    region,
    name: `${region} ${stage} — ${trainer}`,
    reward,
    team: speciesIds.map((pokemon_id, index) => ({
      pokemon_id,
      level: baseLevel + index * 2,
    })),
  };
}

function regionChallenges(region, leaders, eliteFour, champion, eliteStage = 'Elite Four') {
  return [
    ...leaders.map(([name, team, level], index) =>
      challenge(region, 'Gym', name, team, level, 5000 + index * 1500)
    ),
    ...eliteFour.map(([name, team, level], index) =>
      challenge(region, eliteStage, name, team, level, 30000 + index * 10000)
    ),
    challenge(region, 'Champion', champion[0], champion[1], champion[2], 100000),
  ];
}

const challenges = [
  ...regionChallenges('Johto', [
    ['Falkner', [16, 17], 9],
    ['Bugsy', [123, 15, 214], 14],
    ['Whitney', [35, 241], 18],
    ['Morty', [92, 93, 94], 22],
    ['Chuck', [57, 62], 26],
    ['Jasmine', [81, 82, 208], 30],
    ['Pryce', [86, 87, 221], 34],
    ['Clair', [130, 148, 148, 230], 38],
  ], [
    ['Will', [178, 124, 103, 80], 48],
    ['Koga', [168, 169, 205, 49, 49], 49],
    ['Bruno', [237, 106, 107, 107, 68], 50],
    ['Karen', [197, 45, 94, 198, 229], 52],
  ], ['Lance', [130, 142, 6, 149, 149, 149], 56]),

  ...regionChallenges('Hoenn', [
    ['Roxanne', [74, 299], 14],
    ['Brawly', [66, 296], 18],
    ['Wattson', [100, 82, 310], 22],
    ['Flannery', [218, 322, 78], 26],
    ['Norman', [327, 264, 288, 289], 30],
    ['Winona', [333, 357, 227, 334], 34],
    ['Tate', [337, 338, 178, 344], 38],
    ['Juan', [370, 340, 364, 342, 230], 42],
  ], [
    ['Sidney', [262, 275, 332, 359, 275], 48],
    ['Phoebe', [356, 302, 354, 302, 354], 49],
    ['Glacia', [362, 364, 362, 478, 365], 50],
    ['Drake', [372, 330, 334, 330, 373], 52],
  ], ['Wallace', [321, 73, 272, 340, 130, 350], 56]),

  ...regionChallenges('Sinnoh', [
    ['Roark', [74, 95, 408], 14],
    ['Gardenia', [315, 387, 407], 18],
    ['Maylene', [307, 67, 448], 22],
    ['Crasher Wake', [130, 419, 423], 26],
    ['Fantina', [426, 429, 426, 429, 442], 30],
    ['Byron', [303, 208, 411], 34],
    ['Candice', [459, 221, 478, 460], 38],
    ['Volkner', [466, 405, 26, 462], 42],
  ], [
    ['Aaron', [15, 214, 416, 212, 452], 48],
    ['Bertha', [450, 76, 423, 340, 450], 49],
    ['Flint', [392, 78, 126, 467, 467], 50],
    ['Lucian', [475, 122, 178, 65, 475], 52],
  ], ['Cynthia', [442, 169, 407, 448, 445, 487], 56]),

  ...regionChallenges('Unova', [
    ['Cheren', [504, 506], 14],
    ['Roxie', [109, 544], 18],
    ['Burgh', [540, 542, 545], 22],
    ['Elesa', [523, 587, 181, 523], 26],
    ['Clay', [529, 530, 423], 30],
    ['Skyla', [580, 581, 630], 34],
    ['Drayden', [611, 612, 621], 42],
    ['Marlon', [565, 321, 593], 44],
  ], [
    ['Shauntal', [563, 609, 593, 623], 48],
    ['Grimsley', [553, 560, 510, 625], 49],
    ['Caitlin', [575, 579, 576, 648], 50],
    ['Marshal', [619, 620, 534, 620], 52],
  ], ['Alder', [589, 606, 567, 612, 637, 637], 56]),
  challenge('Unova', 'Champion', 'Iris', [635, 621, 567, 306, 131, 612], 56, 100000),

  ...regionChallenges('Kalos', [
    ['Viola', [664, 666], 14],
    ['Grant', [698, 696], 18],
    ['Korrina', [619, 701, 448], 22],
    ['Ramos', [187, 673, 459], 26],
    ['Clemont', [694, 695, 310], 30],
    ['Valerie', [700, 303, 683], 34],
    ['Olympia', [177, 678, 678], 38],
    ['Wulfric', [613, 713, 460], 42],
  ], [
    ['Malva', [668, 609, 609, 663], 48],
    ['Siebold', [689, 693, 691, 706], 49],
    ['Wikstrom', [707, 707, 681, 376], 50],
    ['Drasna', [691, 334, 715, 715], 52],
  ], ['Diantha', [701, 697, 699, 706, 702, 718], 56]),

  [
    ...[
      ['Gym', 'Ilima', [735, 53, 20], 14],
      ['Gym', 'Lana', [746, 73, 130], 18],
      ['Gym', 'Kiawe', [758, 77, 59], 22],
      ['Gym', 'Mallow', [761, 103, 254], 26],
      ['Gym', 'Sophocles', [777, 101, 738], 30],
      ['Gym', 'Acerola', [778, 302, 778], 34],
      ['Gym', 'Mina', [741, 743, 754], 38],
      ['Gym', 'Hapu', [750, 750, 423, 768], 46],
      ['Elite Four', 'Hala', [739, 740, 68, 760], 50],
      ['Elite Four', 'Olivia', [744, 745, 248, 476], 51],
      ['Elite Four', 'Acerola', [778, 94, 778, 778, 781], 52],
      ['Elite Four', 'Kahili', [733, 227, 628, 701, 748], 53],
    ].map(([stage, name, team, level], index) =>
      challenge('Alola', stage, name, team.map(Number), level, 8000 + index * 5000)
    ),
    challenge('Alola', 'Champion', 'Kukui', [735, 724, 727, 738, 745, 727], 58, 100000),
  ],

  ...regionChallenges('Galar', [
    ['Milo', [810, 812, 830], 14],
    ['Nessa', [833, 846, 834], 18],
    ['Kabu', [850, 851, 59], 22],
    ['Bea', [865, 237, 68], 26],
    ['Opal', [859, 303, 869], 30],
    ['Gordie', [838, 839, 834, 697, 839], 34],
    ['Piers', [862, 509, 862, 727, 863], 38],
    ['Raihan', [776, 330, 884, 330, 887], 42],
  ], [
    ['Raihan', [776, 330, 884, 330, 887], 48],
    ['Bede', [303, 282, 858, 859, 678], 48],
    ['Marnie', [510, 454, 560, 877, 861], 50],
    ['Hop', [832, 143, 823, 871, 862, 815], 52],
  ], ['Leon', [815, 812, 839, 858, 887, 849], 56], 'Champion Cup'),

  ...regionChallenges('Paldea', [
    ['Katy', [917, 919, 920], 14],
    ['Brassius', [928, 930, 949], 18],
    ['Iono', [939, 938, 940, 941], 22],
    ['Kofu', [846, 964, 976, 978], 26],
    ['Larry', [775, 982, 398], 30],
    ['Ryme', [979, 972, 973, 979], 34],
    ['Tulip', [981, 282, 956, 671], 38],
    ['Grusha', [873, 875, 614, 998], 42],
  ], [
    ['Rika', [340, 323, 232, 51, 980], 48],
    ['Poppy', [878, 879, 823, 970, 959], 49],
    ['Larry', [357, 741, 334, 398, 973], 50],
    ['Hassel', [998, 941, 952, 988, 621], 52],
  ], ['Geeta', [979, 983, 956, 959, 970, 981], 56]),
  challenge('Paldea', 'Champion', 'Nemona', [979, 983, 956, 959, 970, 998], 58, 100000),
];

module.exports = challenges.flat();
