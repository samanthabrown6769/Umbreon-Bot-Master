require('dotenv').config();

const fs = require('fs');
const { EventEmitter } = require('events');
const path = require('path');
const { execFile } = require('child_process');

function rebuildPokemonDatabaseFiles() {
  execFile(process.execPath, [path.join(__dirname, 'scripts', 'build-pokemon-database.js')], (error) => {
    if (error) console.error('Could not rebuild pokemon-database files:', error.message);
  });
}

function getTopggVoteUrl() {
  const configuredUrl = process.env.TOPGG_VOTE_URL?.trim();
  if (!configuredUrl) return `https://top.gg/bot/${client.user.id}/vote`;
  const parsedUrl = new URL(configuredUrl);
  if (parsedUrl.protocol !== 'https:') {
    throw new TypeError('TOPGG_VOTE_URL must use HTTPS.');
  }
  return parsedUrl.toString();
}

function startTopggWebhook() {
  if (!TOPGG_WEBHOOK_AUTH) {
    console.log('[vote-webhook] Disabled: TOPGG_WEBHOOK_AUTH is not configured.');
    return;
  }
  const port = Number(process.env.TOPGG_WEBHOOK_PORT || process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('[vote-webhook] Invalid TOPGG_WEBHOOK_PORT; expected an integer from 1 to 65535.');
    return;
  }

  const server = createTopggWebhookServer({
    authorization: TOPGG_WEBHOOK_AUTH,
    onVote: async (voterId) => {
      const rewards = processTopggVote(voterId);
      if (rewards.duplicate) return;
      const rewardLines = [
        `${EMOJIS.votecoin} **Vote Coins:** +${rewards.voteCoins}`,
        rewards.lootboxes ? `${LOOTBOX_EMOJI} **Lootbox:** +${rewards.lootboxes}` : null,
        rewards.voteBoxes.length
          ? `📦 **Vote Box:** ${rewards.voteBoxes.join(', ')} (open by box name or alias, e.g. \`${PREFIX}open voterare\`)`
          : null,
        rewards.boxes.length ? `📦 **Streak Boxes:** ${rewards.boxes.join(', ')}` : null,
        rewards.rareCandies ? `${EMOJIS.rarecandy} **Rare Candies:** +${rewards.rareCandies}` : null,
        rewards.eggs ? `${EMOJIS.pokeEgg} **Eggs:** +${rewards.eggs} (use \`${PREFIX}egg hold\` to incubate)` : null,
        rewards.masterballs ? `${EMOJIS.masterball} **Masterballs:** +${rewards.masterballs}` : null,
        rewards.goldenRazzBerries ? `🫐 **Golden Razz Berry:** +${rewards.goldenRazzBerries}` : null,
      ].filter(Boolean);
      try {
        const voter = await client.users.fetch(voterId);
        await voter.send(
          `Thanks for voting! Your vote streak is **${rewards.streak} day${rewards.streak === 1 ? '' : 's'}**.\n` +
          rewardLines.join('\n')
        );
      } catch (error) {
        console.warn(`[vote-webhook] Could not send the vote reward DM to ${voterId}:`, error.message);
      }
    },
  });
  server.on('error', (error) => {
    console.error('[vote-webhook] Server error:', error);
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(`[vote-webhook] Listening on 0.0.0.0:${port}/topgg.`);
  });
}

const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  ComponentType,
  EmbedBuilder,
  GatewayIntentBits,
  PermissionsBitField,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} = require('discord.js');
const {
  db,
  getCooldownNotificationMode,
  setCooldownNotificationMode,
  getRareSpawnNameHidden,
  setRareSpawnNameHidden,
  getMarketCompletionNotificationsEnabled,
  setMarketCompletionNotificationsEnabled,
  setBuddyNickname,
  rerollBuddyIv,
  renamePokemonForm,
  updatePokemonSpriteLinks,
  SPECIAL_SPAWN_RESERVED_SPECIES: BASE_SPAWN_RESERVED_SPECIES,
  findPokemonForms,
  addCustomPokemon,
  getRaritySettings,
  getUserRarityStreak,
  resetRarityStreaks,
  getUser,
  getAmuletCoinBoost,
  getPatreonPerks,
  grantPatreonMonthly,
  getPatreonUserIds,
  PATREON_TIER_ORDER,
  PATREON_TIER_PERKS,
  BASE_INCENSE_CHARGES,
  getIncenseCharges,
  addIncenseCharges,
  recordIncenseContribution,
  getIncenseContributors,
  consumeIncenseCharge,
  consumePokeradarCharge,
  BASE_POKERADAR_CHARGES,
  BASE_DOUBLE_XP_CHARGES,
  awardCoinsWithBoost,
  getUserTeam,
  getUserRegisteredCollections,
  getUserBuddy,
  getSavedTeams,
  saveCurrentTeam,
  deleteSavedTeam,
  clearDefendingTeam,
  equipSavedTeam,
  getUserBuddyHistory,
  setUserBuddyByQuery,
  syncDuplicateCatchState,
  syncNewCatchState,
  getPokemonFormBySlug,
  getPokemonLearnset,
  getSpeciesLearnset,
  getSpeciesGmaxMoves,
  recordSketchedMove,
  getPokemonMove,
  getBuddyMoveChangeCost,
  setBuddyMoveSlot,
  swapBuddyMoveSlots,
  getLeagueProgress,
  clearLeagueChallenge,
  unlockBattleIcon,
  grantGuaranteedBattleIconDrop,
  getUnlockedBattleIcons,
  getBattleIconRank,
  setSelectedBattleIcon,
  getSelectedBattleIcon,
  CB_CONFIG,
  getCatchbotData,
  upgradeCatchbot,
  startCatchbotRun,
  claimCatchbotRun,
  recordCatchbotResults,
  CHAMBER_CONFIG,
  getUserChambers,
  getMegaStones,
  sacrificeForChamber,
  completeMegaChamber,
  getChamberRequirement,
  MEGA_STONE_NAMES,
  FUN_ITEM_NAMES,
  megaEvolvePokemon,
  setTeamExpShare,
  awardCatchExperience,
  experienceForNextLevel,
  getUserQuests,
  getUserQuestSlots,
  rerollUserQuest,
  QUEST_REROLL_COST,
  findMoveInfo,
  advanceQuestProgress,
  useRareCandy,
  setCatchTeamStatus,
  setTeamCatchByQuery,
  getDexIndexOffset,
  removeTeamSlot,
  swapTeamSlots,
  getActiveWorldBoss,
  getWorldBossAnnouncementChannel,
  setWorldBossAnnouncementChannel,
  getWorldBossAnnouncementPosts,
  setWorldBossAnnouncementPost,
  getBossLeaderboard,
  applyWorldBossDamage,
  distributeWorldBossRewards,
  claimWorldBossReward,
  getUnclaimedWorldBossReward,
  spawnWorldBoss,
  WORLD_BOSS_POOL,
  incrementUser,
  processTopggVote,
  openVoteBox,
  listOnMarket,
  listPokemonOnMarket,
  getMarketListingLimit,
  getUserMarketListingCount,
  getMarketListings,
  getMarketListingCount,
  getUserMarketSales,
  getUserMarketSaleSummary,
  clearMarketListings,
  stockMarketPokemon,
  getRandomPokemon,
  buyMarketItem,
  createPatreonTokenOrder,
  cancelPatreonTokenOrder,
  expirePatreonTokenOrders,
  getPatreonTokenOrderBook,
  getUserPatreonTokenOrders,
  getPatreonTokenMarketStats,
  registerCollection,
  deleteCollection,
  setCollectionPrivacy,
  refreshAllCollections,
  getUserItems,
  findUserPokemonMatches,
  setUserPokemonLockByQuery,
  addUserItem,
  findUserItemName,
  findQuestItem,
  takeUserItem,
  changePokemonAbility,
  holdEvolutionItem,
  unholdEvolutionItem,
  evolvePokemonWithItem,
  evolvePokemonByLevel,
  setGiveawayChannel,
  getGiveawayChannel,
  getAutoSpawnChannel,
  getAllAutoSpawnChannels,
  LOTTERY_SCHEDULE,
  buyLotteryTickets,
  drawLottery,
  setLotteryChannel,
  getLotteryState,
  getUserLotteryStats,
  setAutoSpawnChannel,
  setAutoSpawnProgress,
  disableAutoSpawnChannel,
  markAutoSpawnHourlyTier,
  getUserEventProgress,
  getUserEventCatchCounts,
  getEventAnnouncementChannel,
  getRareSpawnAnnouncementChannel,
  getAllEventAnnouncementChannels,
  getAllRareSpawnAnnouncementChannels,
  setRareSpawnAnnouncementChannel,
  getMarketAnnouncementChannel,
  setMarketAnnouncementChannel,
  getChannelCatchRateBoost,
  getBoostedChannels,
  removeAllChannelCatchRateBoosts,
  addChannelCatchRateBoost,
  setChannelCatchRateBoost,
  getPlayerClan,
  getClanPerkMultipliers,
  getClanByName,
  getClanMembers,
  getClanActivityStats,
  getClanHighScores,
  createClan,
  joinClan,
  leaveClan,
  disbandClan,
  trackClanActivity,
  setClanCoLeader,
  getClanCoLeaderIds,
  transferClanOwnership,
  purchaseClanRank,
  purchaseClanPerks,
  depositClanTreasury,
  getClanRankInfo,
  getNextClanRankInfo,
  getClanLeaderboard,
  getTotalEffectiveShinyBonus,
  getUserStatsSummary,
  getDailyResetDay,
  getNextDailyReset,
  recordDailyCatch,
  getDailyCatchLeaderboard,
  recordWildEncounterCounter,
  resetEncounterCounters,
  getEncounterCounters,
  resetChecklistIfNewDay,
  registerEvent,
  recordRarityCatch,
  saveCatch,
  saveGoldenCatch,
  advanceEggCatchProgress,
  holdEgg,
  hatchEgg,
  EGG_INCUBATOR_LIMITS,
  getUserEggIncubators,
  startEggIncubators,
  hatchEggFromIncubator,
  setPokemonRarity,
  setRaritySettings,
  recordEventCatch,
  setEventAnnouncementChannel,
  updateUser,
  FACTION_TEAMS,
  FACTION_RANKS,
  getDailyBall,
  getUserFaction,
  joinFaction,
  addFactionPoints,
  promoteFaction,
  getFactionLeaders,
  ROTOM_ITEMS,
} = require('./db');
const halloweenEvent = require('./events/halloween-2026');
const { parseAmount } = require('./amounts');
const { parseTradeMonInput } = require('./trade-parser');
const {
  getPokemonDexNumbers,
  getGoldenDexNumber,
  GOLDEN_DEX_START,
  isGoldenFormSupported,
  isGoldenDexNumber,
} = require('./pokemon-dex-numbers');
const { getPokemonShowdownSprite } = require('./pokemon-sprites');
const battleFx = require('./battle-effects');
const { runTurn, runSwitchTurn, onSwitchIn, chooseEnemyMove, buildEnemyMoves } = battleFx;
const createBattleField = battleFx.createField;
const { getGoldenSpriteUrl } = require('./golden-pokemon');
const { getCurrentPromo, getActivePromos, findPromoByItemName, rollPromoItemDrop } = require('./promo');
const { EVOLUTION_ITEMS, findEvolutionItem } = require('./evolution-items');
const { BOXES, VOTE_BOXES, LOOTBOX_EMOJI, findBox, findVoteBox } = require('./boxes');
const {
  EXPLORE_MAPS,
  EXPLORE_EXCLUSIVES,
  EXPLORE_GOLDENS,
  EXPLORE_EXCLUSIVE_SPECIES_IDS,
  getExploreCatchRate,
} = require('./exploreData');
// Explore exclusives never spawn outside of explore.
const SPECIAL_SPAWN_RESERVED_SPECIES = Object.freeze([
  ...BASE_SPAWN_RESERVED_SPECIES,
  ...db.prepare(
    `SELECT species_name FROM pokemon_forms WHERE is_default = 1 AND species_id IN (${EXPLORE_EXCLUSIVE_SPECIES_IDS.map(() => '?').join(', ')})`
  ).all(...EXPLORE_EXCLUSIVE_SPECIES_IDS).map((row) => row.species_name),
]);
const { createTopggWebhookServer } = require('./vote-webhook');

registerEvent(halloweenEvent);

const eventSpawnFormIds = Array.from(new Set(
  halloweenEvent.pokemon.flatMap((eventPokemon) =>
    eventPokemon.matchNames.flatMap((matchName) => {
      const normalizedName = matchName.toLowerCase().replace(/[^a-z0-9]/g, '');
      return findPokemonForms(matchName, 50)
        .filter((pokemon) =>
          !pokemon.is_default
          && pokemon.name.toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedName
        )
        .map((pokemon) => pokemon.id);
    })
  )
));

const EVENT_SPAWN_ODDS = 100;
const eventSpawnEntries = halloweenEvent.pokemon.map((eventPokemon) => {
  const names = eventPokemon.matchNames.map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const ids = Array.from(new Set(eventPokemon.matchNames.flatMap((matchName) =>
    findPokemonForms(matchName, 50)
      .filter((pokemon) => names.includes(pokemon.name.toLowerCase().replace(/[^a-z0-9]/g, '')))
      .map((pokemon) => pokemon.id)
  )));
  return { ids, shiny: Boolean(eventPokemon.shiny) };
}).filter((entry) => entry.ids.length);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const PREFIX = process.env.PREFIX || '.';
const TOPGG_WEBHOOK_AUTH = process.env.TOPGG_WEBHOOK_AUTH?.trim();
const NON_STREAK_RARITIES = new Set([
  'mega', 'm', 'shiny mega', 'sm',
  'gmax', 'g', 'shiny gmax', 'sg',
]);
const GUARANTEED_CATCH_EXCLUDED_USER_IDS = new Set([
  '1514082847609061541',
  '426946381098254336',
]);
const catchCooldowns = new Set();
const fishCooldowns = new Set();
const battleCooldowns = new Set();
const pokemonCooldownStates = { p: new Map(), f: new Map() };
const pokemonAbilitiesByFormId = new Map();
let allPokemonAbilities = null;
const pokemonAbilityDetails = new Map();
const activeCatchEncounters = new Map();
const activeLeagueBattles = new Map();
const activeMegaChamberBattles = new Map();
const activeSparBattles = new Map();
const activeWorldBossBattles = new Map();
const activeWorldBossPosts = new Map();
const activeWorldBossRaidHandlers = new Map();
const activeWorldBossPlayers = new Map();
const activeWorldBossFainted = new Map();
const activeWorldBossTeamStates = new Map();
const activeDexEntries = new Map();

function isInteractionAlreadyAcknowledgedOrExpired(error) {
  return error?.code === 40060 || error?.code === 10062;
}

async function replyToInteractionFailure(interaction, content, context) {
  try {
    const response = { content, ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(response);
    } else {
      await interaction.reply(response);
    }
  } catch (error) {
    if (isInteractionAlreadyAcknowledgedOrExpired(error)) return;
    console.error(`Failed to send ${context} interaction error response:`, error);
  }
}

const KANTO_LEAGUE = require('./data/kanto-league.json').challenges;
const NPC_CAMPAIGN = [
  ...KANTO_LEAGUE.map((challenge) => ({ region: 'Kanto', ...challenge })),
  ...require('./data/regional-npc-battles'),
];
const NPC_SPECIAL_BATTLES = [
  {
    name: 'Volo',
    region: 'Hisui',
    special: true,
    volo: true,
    team: [
      { form_id: 10007, level: 100 },
      { form_id: 10007, level: 100, is_shiny: true },
      {
        form_id: 10007,
        level: 100,
        is_golden: true,
        sprite_url: 'https://graphics.tppcrpg.net/xy/golden/487M-1.gif',
      },
    ],
    reward: 0,
  },
];
const NPC_TRAINER_ICON_EMOJIS = {
  volo: '<:volo:1561053228131688488>',
  brock: '<:brock:1561053190198132816>',
  misty: '<:misty:1561091268233265232>',
  erika: '<:erika:1561128013142163637>',
  penny: '<:penny:1561053211102683146>',
  giacomo: '<:giacomo:1561091482046177330>',
  mela: '<:mela:1561091314802495539>',
  atticus: '<:atticus:1561091500010373221>',
  ortega: '<:ortega:1561091237769908375>',
  eri: '<:eri:1561091421488816160>',
  stargruntfemale: '<:stargruntfemale:1561091678759030784>',
  stargruntmale: '<:stargruntmale:1561091294795800596>',
  staradmingiacomo: '<:giacomo:1561091482046177330>',
  staradminmela: '<:mela:1561091314802495539>',
  staradminatticus: '<:atticus:1561091500010373221>',
  staradminortega: '<:ortega:1561091237769908375>',
  staradmineri: '<:eri:1561091421488816160>',
  plasmaadminn: '<:kingn:1561066703906144286>',
  iono: '<:iono:1561066683488280646>',
  kingn: '<:kingn:1561066703906144286>',
  hop: '<:hop:1561066662315167815>',
};
const FACTION_NPC_ROLE_EMOJIS = {
  Grunt: '<:grunt:1560312842039726150>',
  Admin: '<:admin:1560312876596461578>',
  Leader: '<:leader:1560312904560025680>',
};
const FACTION_NPC_BATTLE_DEFINITIONS = [
  { factionKey: 'rocket', trainer: 'Rocket Grunt Male', role: 'Grunt', pokemon: ['Raticate', 'Golbat', 'Koffing'], strengthMultiplier: 2 },
  { factionKey: 'rocket', trainer: 'Rocket Grunt Female', role: 'Grunt', pokemon: ['Arbok', 'Golbat', 'Persian'], strengthMultiplier: 2 },
  { factionKey: 'rocket', trainer: 'Rocket Admin Ariana', role: 'Admin', pokemon: ['Arbok', 'Vileplume', 'Murkrow'], strengthMultiplier: 2.3 },
  { factionKey: 'rocket', trainer: 'Rocket Admin Archer', role: 'Admin', pokemon: ['Golbat', 'Koffing', 'Houndoom'], strengthMultiplier: 2.3 },
  { factionKey: 'rocket', trainer: 'Rocket Admin Proton', role: 'Admin', pokemon: ['Golbat', 'Weezing', 'Raticate'], strengthMultiplier: 2.3 },
  { factionKey: 'rocket', trainer: 'Rocket Admin Pretel', role: 'Admin', pokemon: ['Raticate', 'Koffing', 'Muk'], strengthMultiplier: 2.3 },
  { factionKey: 'rocket', trainer: 'Giovanni', role: 'Leader', pokemon: ['Persian', 'Nidoking', 'Mewtwo'], strengthMultiplier: 2.5 },
  { factionKey: 'magma', trainer: 'Magma Grunt Male', role: 'Grunt', pokemon: ['Poochyena', 'Numel', 'Zubat'], strengthMultiplier: 2 },
  { factionKey: 'magma', trainer: 'Magma Grunt Female', role: 'Grunt', pokemon: ['Numel', 'Mightyena', 'Golbat'], strengthMultiplier: 2 },
  { factionKey: 'magma', trainer: 'Magma Admin Courtney', role: 'Admin', pokemon: ['Camerupt', 'Mightyena', 'Sableye'], strengthMultiplier: 2.3 },
  { factionKey: 'magma', trainer: 'Magma Admin Tabitha', role: 'Admin', pokemon: ['Camerupt', 'Golbat', 'Mightyena'], strengthMultiplier: 2.3 },
  { factionKey: 'magma', trainer: 'Maxie', role: 'Leader', pokemon: ['Mightyena', 'Camerupt', 'Groudon'], strengthMultiplier: 2.7 },
  { factionKey: 'aqua', trainer: 'Aqua Grunt Male', role: 'Grunt', pokemon: ['Carvanha', 'Zubat', 'Poochyena'], strengthMultiplier: 2 },
  { factionKey: 'aqua', trainer: 'Aqua Grunt Female', role: 'Grunt', pokemon: ['Carvanha', 'Mightyena', 'Golbat'], strengthMultiplier: 2 },
  { factionKey: 'aqua', trainer: 'Aqua Admin Matt', role: 'Admin', pokemon: ['Sharpedo', 'Mightyena', 'Crobat'], strengthMultiplier: 2.3 },
  { factionKey: 'aqua', trainer: 'Aqua Admin Shelly', role: 'Admin', pokemon: ['Sharpedo', 'Golbat', 'Muk'], strengthMultiplier: 2.3 },
  { factionKey: 'aqua', trainer: 'Archie', role: 'Leader', pokemon: ['Sharpedo', 'Walrein', 'Kyogre'], strengthMultiplier: 2.7 },
  { factionKey: 'galactic', trainer: 'Galactic Grunt Male', role: 'Grunt', pokemon: ['Stunky', 'Glameow', 'Croagunk'], strengthMultiplier: 2 },
  { factionKey: 'galactic', trainer: 'Galactic Grunt Female', role: 'Grunt', pokemon: ['Glameow', 'Stunky', 'Golbat'], strengthMultiplier: 2 },
  { factionKey: 'galactic', trainer: 'Galactic Admin Mars', role: 'Admin', pokemon: ['Purugly', 'Golbat', 'Bronzor'], strengthMultiplier: 2.3 },
  { factionKey: 'galactic', trainer: 'Galactic Admin Charon', role: 'Admin', pokemon: ['Magnezone', 'Houndoom', 'Golbat'], strengthMultiplier: 2.3 },
  { factionKey: 'galactic', trainer: 'Galactic Admin Jupiter', role: 'Admin', pokemon: ['Skuntank', 'Golbat', 'Bronzor'], strengthMultiplier: 2.3 },
  { factionKey: 'galactic', trainer: 'Galactic Admin Saturn', role: 'Admin', pokemon: ['Toxicroak', 'Golbat', 'Bronzor'], strengthMultiplier: 2.3 },
  { factionKey: 'galactic', trainer: 'Cyrus', role: 'Leader', pokemon: ['Weavile', 'Honchkrow', 'Dialga'], strengthMultiplier: 2.8 },
  { factionKey: 'plasma', trainer: 'Plasma Grunt Male', role: 'Grunt', pokemon: ['Liepard', 'Watchog', 'Trubbish'], strengthMultiplier: 2 },
  { factionKey: 'plasma', trainer: 'Plasma Grunt Female', role: 'Grunt', pokemon: ['Purrloin', 'Watchog', 'Scraggy'], strengthMultiplier: 2 },
  { factionKey: 'plasma', trainer: 'Plasma Admin Shadow', role: 'Admin', pokemon: ['Liepard', 'Golbat', 'Krookodile'], strengthMultiplier: 2.3 },
  { factionKey: 'plasma', trainer: 'Plasma Admin N', role: 'Admin', pokemon: ['Zoroark', 'Klinklang', 'Zekrom'], strengthMultiplier: 2.7 },
  { factionKey: 'plasma', trainer: 'Ghetsis', role: 'Leader', pokemon: ['Bisharp', 'Hydreigon', 'Zekrom'], strengthMultiplier: 3 },
  { factionKey: 'flare', trainer: 'Flare Grunt Male', role: 'Grunt', pokemon: ['Houndour', 'Scraggy', 'Golbat'], strengthMultiplier: 2 },
  { factionKey: 'flare', trainer: 'Flare Grunt Female', role: 'Grunt', pokemon: ['Houndour', 'Liepard', 'Scraggy'], strengthMultiplier: 2 },
  { factionKey: 'flare', trainer: 'Flare Admin Male', role: 'Admin', pokemon: ['Houndoom', 'Pyroar', 'Golbat'], strengthMultiplier: 2.3 },
  { factionKey: 'flare', trainer: 'Flare Admin Female', role: 'Admin', pokemon: ['Liepard', 'Pyroar', 'Malamar'], strengthMultiplier: 2.3 },
  { factionKey: 'flare', trainer: 'Lysandre', role: 'Leader', pokemon: ['Pyroar', 'Malamar', 'Yveltal'], strengthMultiplier: 2.8 },
  { factionKey: 'skull', trainer: 'Skull Grunt Male', role: 'Grunt', pokemon: ['Rattata', 'Drowzee', 'Golbat'], strengthMultiplier: 2 },
  { factionKey: 'skull', trainer: 'Skull Grunt Female', role: 'Grunt', pokemon: ['Rattata', 'Golbat', 'Salandit'], strengthMultiplier: 2 },
  { factionKey: 'skull', trainer: 'Skull Admin Plumeria', role: 'Admin', pokemon: ['Golbat', 'Salazzle', 'Toxapex'], strengthMultiplier: 2.3 },
  { factionKey: 'skull', trainer: 'Guzma', role: 'Leader', pokemon: ['Golisopod', 'Scizor', 'Alolan Marowak'], strengthMultiplier: 2.2 },
  { factionKey: 'yell', trainer: 'Yell Grunt Male', role: 'Grunt', pokemon: ['Zigzagoon', 'Thievul', 'Obstagoon'], strengthMultiplier: 2 },
  { factionKey: 'yell', trainer: 'Yell Grunt Female', role: 'Grunt', pokemon: ['Thievul', 'Liepard', 'Obstagoon'], strengthMultiplier: 2 },
  { factionKey: 'yell', trainer: 'Yell Admin Marnie', role: 'Admin', pokemon: ['Morpeko', 'Toxicroak', 'Grimmsnarl'], strengthMultiplier: 2.3 },
  { factionKey: 'yell', trainer: 'Piers', role: 'Leader', pokemon: ['Skuntank', 'Obstagoon', 'Grimmsnarl'], strengthMultiplier: 2 },
  { factionKey: 'star', trainer: 'Star Grunt Male', role: 'Grunt', pokemon: ['Pawniard', 'Grafaiai', 'Revavroom'], strengthMultiplier: 2 },
  { factionKey: 'star', trainer: 'Star Grunt Female', role: 'Grunt', pokemon: ['Pawniard', 'Lokix', 'Revavroom'], strengthMultiplier: 2 },
  { factionKey: 'star', trainer: 'Star Admin Giacomo', role: 'Admin', pokemon: ['Pawniard', 'Revavroom'], strengthMultiplier: 2.3 },
  { factionKey: 'star', trainer: 'Star Admin Mela', role: 'Admin', pokemon: ['Torkoal', 'Revavroom'], strengthMultiplier: 2.3 },
  { factionKey: 'star', trainer: 'Star Admin Atticus', role: 'Admin', pokemon: ['Skuntank', 'Muk', 'Revavroom'], strengthMultiplier: 2.3 },
  { factionKey: 'star', trainer: 'Star Admin Ortega', role: 'Admin', pokemon: ['Azumarill', 'Dachsbun', 'Revavroom'], strengthMultiplier: 2.3 },
  { factionKey: 'star', trainer: 'Star Admin Eri', role: 'Admin', pokemon: ['Toxicroak', 'Annihilape', 'Revavroom'], strengthMultiplier: 2.3 },
  { factionKey: 'star', trainer: 'Penny', role: 'Leader', pokemon: ['Sylveon', 'Umbreon', 'Revavroom'], strengthMultiplier: 2.5 },
];
const FACTION_NPC_BATTLES = FACTION_NPC_BATTLE_DEFINITIONS.map(({
  factionKey,
  trainer,
  role,
  pokemon,
  strengthMultiplier,
}) => {
  const faction = FACTION_TEAMS[factionKey];
  if (!faction) throw new Error(`Missing faction configuration for ${factionKey}.`);
  const trainerKey = trainer.toLowerCase().replace(/[^a-z0-9]/g, '');
  return {
    name: `${faction.name} — ${trainer}`,
    region: 'Factions',
    iconEmoji: NPC_TRAINER_ICON_EMOJIS[trainerKey] || FACTION_NPC_ROLE_EMOJIS[role],
    special: true,
    factionNpc: true,
    strengthMultiplier,
    pokemonNames: pokemon,
    team: pokemon.map((name) => {
      const form = resolvePokemonForm(name);
      if (!form) throw new Error(`Missing catalog Pokémon ${name} for ${faction.name} NPC ${trainer}.`);
      return { form_id: form.id, level: 100 };
    }),
    reward: 0,
  };
});
NPC_SPECIAL_BATTLES.push(...FACTION_NPC_BATTLES);
for (const challenge of [...NPC_CAMPAIGN, ...NPC_SPECIAL_BATTLES]) {
  const trainerName = challenge.name.split('\u2014').pop().trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const trainerIconEmoji = NPC_TRAINER_ICON_EMOJIS[trainerName];
  if (trainerIconEmoji) challenge.iconEmoji = trainerIconEmoji;
}
const NPC_ICON_ALIASES = {
  lorelei: 'lorelei-gen3',
  agatha: 'agatha-gen3',
  tateandliza: 'tateandliza-gen3',
  phoebe: 'phoebe-gen3',
  drake: 'drake-gen3',
  stevenstone: 'steven',
};
const NPC_ICON_DROP_CHANCE = 1 / 1000;
const DEFAULT_TRAINER_ICONS = {
  brendan: { value: -1, name: 'Brendan', emoji: '<:trainerbrendan:1560314274973352016>' },
  may: { value: -2, name: 'May', emoji: '<:trainermay:1560314251565076630>' },
};

function getTrainerIconEmoji(userId) {
  const selected = getSelectedBattleIcon(userId);
  const preset = Object.values(DEFAULT_TRAINER_ICONS).find((icon) => icon.value === selected);
  if (preset) return preset.emoji;
  if (selected === null) return DEFAULT_TRAINER_ICONS.brendan.emoji;
  return getNpcChallenge(selected)?.iconEmoji || '';
}

function getTrainerIconUrl(userId) {
  const selected = getSelectedBattleIcon(userId);
  if (selected !== null && selected >= 0 && getNpcChallenge(selected)) return getNpcIconUrl(selected);
  const emoji = getTrainerIconEmoji(userId);
  const emojiId = emoji.match(/:(\d+)>$/)?.[1];
  return emojiId ? `https://cdn.discordapp.com/emojis/${emojiId}.png` : null;
}

const FACTION_RANK_ICONS = {
  Recruit: '<:recruit:1560312824729698395>',
  Grunt: '<:grunt:1560312842039726150>',
  Captain: '<:captain:1560312861388050525>',
  Admin: '<:admin:1560312876596461578>',
  Commander: '<:commander:1560312890861420656>',
  Leader: '<:leader:1560312904560025680>',
};


function getTrainerIconLabel(userId) {
  const selected = getSelectedBattleIcon(userId);
  const preset = Object.values(DEFAULT_TRAINER_ICONS).find((icon) => icon.value === selected);
  if (preset) return `${preset.emoji} Trainer ${preset.name}`;
  if (selected === null || selected === undefined) {
    return `${DEFAULT_TRAINER_ICONS.brendan.emoji} Trainer ${DEFAULT_TRAINER_ICONS.brendan.name}`;
  }
  const name = getNpcChallenge(selected) ? getNpcTrainerName(selected) : 'Trainer';
  return `${getNpcIconEmojiOrBlank(selected)} ${name}`.trim();
}

function getNpcChallenge(index) {
  return NPC_CAMPAIGN[index] || NPC_SPECIAL_BATTLES[index - NPC_CAMPAIGN.length];
}

function getNpcIconEmojiOrBlank(index) {
  return getNpcChallenge(index)?.iconEmoji || '';
}

function getNpcTrainerName(index) {
  const challenge = getNpcChallenge(index);
  if (!challenge) throw new RangeError(`Unknown NPC index ${index}.`);
  return challenge.name.split('\u2014').pop().trim();
}

function getNpcIconUrl(index) {
  const challenge = getNpcChallenge(index);
  if (!challenge) throw new RangeError(`Unknown NPC index ${index}.`);
  const emojiId = challenge.iconEmoji?.match(/:(\d+)>$/)?.[1];
  if (emojiId) return `https://cdn.discordapp.com/emojis/${emojiId}.png`;
  const id = getNpcTrainerName(index).toLowerCase().replace(/[^a-z0-9]/g, '');
  return `https://play.pokemonshowdown.com/sprites/trainers/${NPC_ICON_ALIASES[id] || id}.png`;
}

function scheduleCooldownNotification(cooldowns, userId, username, channel, duration, command) {
  const action = {
    p: 'catching',
    f: 'fishing',
    battle: 'battle',
  }[command];
  if (!action) throw new TypeError(`Unknown cooldown command "${command}".`);
  const stateMap = pokemonCooldownStates[command];
  const previousState = stateMap?.get(userId);
  if (previousState) clearTimeout(previousState.timer);
  const state = stateMap
    ? { startedAt: Date.now(), duration, timer: null }
    : null;
  if (state) stateMap.set(userId, state);
  const timer = setTimeout(async () => {
    cooldowns.delete(userId);
    if (state && stateMap.get(userId) === state) stateMap.delete(userId);
    try {
      const mode = getCooldownNotificationMode(userId);
      await channel.send({
        content: `✅ ${mode === 'ping' ? `<@${userId}>` : `**${username}**`}, your ${action} cooldown is over. ` +
          `You can use \`${PREFIX}${command}\` again.`,
        allowedMentions: mode === 'ping' ? { users: [userId] } : { parse: [] },
      });
    } catch (error) {
      console.error(`Failed to send ${command} cooldown notification for user ${userId}:`, error);
    }
  }, duration);
  if (state) state.timer = timer;
}

function consumeCooldownMachineForEarlyUse(userId, command, cooldowns) {
  const state = pokemonCooldownStates[command].get(userId);
  if (!state) return false;
  const elapsed = Date.now() - state.startedAt;
  if (elapsed >= state.duration) {
    clearTimeout(state.timer);
    pokemonCooldownStates[command].delete(userId);
    cooldowns.delete(userId);
    return true;
  }
  if (elapsed < state.duration / 2) return false;
  const chargeField = command === 'p'
    ? 'cooldown_machine_catch_charges'
    : 'cooldown_machine_fish_charges';
  if (getUser(userId)[chargeField] < 1) return false;
  incrementUser(userId, { [chargeField]: -1 });
  clearTimeout(state.timer);
  pokemonCooldownStates[command].delete(userId);
  cooldowns.delete(userId);
  return true;
}

async function fetchPokemonAbilities(formId) {
  if (!Number.isSafeInteger(formId) || formId <= 0) {
    throw new TypeError('This Pokémon has no supported PokéAPI form ID.');
  }
  if (pokemonAbilitiesByFormId.has(formId)) return pokemonAbilitiesByFormId.get(formId);
  const response = await fetch(`https://pokeapi.co/api/v2/pokemon/${formId}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new Error(`PokéAPI returned ${response.status} for Pokémon form ${formId}.`);
  }
  const data = await response.json();
  if (!Array.isArray(data.abilities)
      || data.abilities.some((entry) =>
        typeof entry?.ability?.name !== 'string' || typeof entry.is_hidden !== 'boolean'
        || !Number.isSafeInteger(entry.slot))) {
    throw new Error(`PokéAPI returned invalid ability data for Pokémon form ${formId}.`);
  }
  const abilities = data.abilities.map((entry) => ({
    name: entry.ability.name.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
    hidden: entry.is_hidden,
    slot: entry.slot,
  })).sort((left, right) => left.slot - right.slot);
  if (!abilities.length) throw new Error(`Pokémon form ${formId} has no ability data.`);
  pokemonAbilitiesByFormId.set(formId, abilities);
  return abilities;
}

async function fetchAllPokemonAbilities() {
  if (allPokemonAbilities) return allPokemonAbilities;
  const response = await fetch('https://pokeapi.co/api/v2/ability?limit=1000', {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new Error(`PokéAPI returned ${response.status} while loading the ability list.`);
  }
  const data = await response.json();
  if (!Array.isArray(data.results)
      || data.results.some((entry) =>
        typeof entry?.name !== 'string' || typeof entry.url !== 'string')) {
    throw new Error('PokéAPI returned invalid ability-list data.');
  }
  const abilities = data.results
    .map((entry) => ({
      name: entry.name.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
      slug: entry.name,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (!abilities.length) throw new Error('PokéAPI returned an empty ability list.');
  allPokemonAbilities = abilities;
  return abilities;
}

async function fetchPokemonAbilityDetails(abilityName) {
  const normalizedName = abilityName.toLowerCase().trim().replace(/[\s_]+/g, '-');
  if (!normalizedName) throw new TypeError('Ability name must not be empty.');
  if (pokemonAbilityDetails.has(normalizedName)) return pokemonAbilityDetails.get(normalizedName);
  const response = await fetch(
    `https://pokeapi.co/api/v2/ability/${encodeURIComponent(normalizedName)}`,
    { signal: AbortSignal.timeout(10000) }
  );
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`PokéAPI returned ${response.status} for ability "${abilityName}".`);
  }
  const data = await response.json();
  if (!Number.isSafeInteger(data.id) || data.id <= 0 || typeof data.name !== 'string'
      || !Array.isArray(data.effect_entries) || !Array.isArray(data.pokemon)) {
    throw new Error(`PokéAPI returned invalid detail data for ability "${abilityName}".`);
  }
  const englishEffect = data.effect_entries.find((entry) =>
    entry.language?.name === 'en' && typeof entry.effect === 'string'
  );
  const details = {
    id: data.id,
    name: data.name.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
    effect: englishEffect?.effect || null,
    shortEffect: typeof englishEffect?.short_effect === 'string' ? englishEffect.short_effect : null,
    pokemon: data.pokemon.map((entry) => ({
      name: entry.pokemon?.name,
      hidden: entry.is_hidden,
    })).filter((entry) => typeof entry.name === 'string'),
  };
  pokemonAbilityDetails.set(normalizedName, details);
  return details;
}

function startLeagueChallengeWithCooldown(message, userId, challengeIndex, challenges) {
  if (battleCooldowns.has(userId)) {
    return message.reply('⏳ Battle cooldown is active (30s)!');
  }
  if (!getUserTeam(userId).length) {
    return runLeagueChallenge(message, userId, challengeIndex, challenges)
      .catch((error) => {
        console.error(`Failed to start NPC battle for user ${userId}:`, error);
        return message.reply('❌ The NPC battle could not be started. Please try again later.')
          .catch((replyError) => {
            console.error(`Failed to report NPC battle startup error for user ${userId}:`, replyError);
          });
      });
  }
  battleCooldowns.add(userId);
  scheduleCooldownNotification(
    battleCooldowns,
    userId,
    message.author.username,
    message.channel,
    30000,
    'battle'
  );
  return runLeagueChallenge(message, userId, challengeIndex, challenges)
    .catch((error) => {
      console.error(`Failed to start NPC battle for user ${userId}:`, error);
      return message.reply('❌ The NPC battle could not be started. Please try again later.')
        .catch((replyError) => {
          console.error(`Failed to report NPC battle startup error for user ${userId}:`, replyError);
        });
    });
}

const ROD_CONFIGS = {
  'old rod': {
    name: 'Old Rod',
    baseShinyRate: 1 / 16384,
    baseSpawnChance: 0.65,
    cooldownMs: 15000,
    pullWaitMs: 15000,
    enablesShiny: false,
    enablesLegendary: false,
    img: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/old-rod.png',
  },
  'good rod': {
    name: 'Good Rod',
    baseShinyRate: 1 / 8192,
    baseSpawnChance: 0.75,
    cooldownMs: 15000,
    pullWaitMs: 10000,
    enablesShiny: true,
    enablesLegendary: false,
    img: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/good-rod.png',
  },
  'super rod': {
    name: 'Super Rod',
    baseShinyRate: 1 / 4096,
    baseSpawnChance: 0.8,
    cooldownMs: 15000,
    pullWaitMs: 6000,
    enablesShiny: true,
    enablesLegendary: true,
    img: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/super-rod.png',
  },
  'golden rod': {
    name: 'Golden Rod',
    baseShinyRate: 1 / 4096,
    baseSpawnChance: 0.8,
    cooldownMs: 15000,
    pullWaitMs: 6000,
    enablesShiny: true,
    enablesLegendary: true,
    img: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/super-rod.png',
  },
};

function getFishingRod(user) {
  const rod = ROD_CONFIGS[user.fish_rods?.toLowerCase()];
  if (!rod) throw new Error(`Unknown fishing rod configured for user ${user.id}.`);
  return rod;
}

const EMOJIS = {
  pokeball: '<:pokeball:1560318610306637974>',
  greatball: '<:greatball:1560318631399923732>',
  ultraball: '<:ultraball:1560318663658315857>',
  masterball: '<:masterball:1560318696180686888>',
  premierball: '<:premierball:1558834593757405294>',
  diveball: '<:diveball:1560438056346198077>',
  pokecoin: '<:pokecoin:1558834592067227688>',
  amuletcoin: '<:amuletcoin:1560318517792870400>',
  // Replaced at startup with the server's :incense: emoji when the bot can see it.
  incense: '🌿',
  pokeradar: '📡',
  bosscoin: '🪙',
  patreonToken: '<:patreontoken:1560376902374522980>',
  abilityCapsule: '<:abilitycapsule:1561042642790391848>',
  cooldownMachine: '<:cooldownmachine:1561042605129863238>',
  abilityPatch: '<:abilitypatch:1561042622997467386>',
  dxpticket: '<:dxpticket:1560320022029541446>',
  eventvoucher: '<:eventvoucher:1560319754173161634>',
  honey: '<:honey:1560319715002552450>',
  incubator: '<:incubator:1560319675307397180>',
  megabracelet: '<:megabracelet:1560318451556421772>',
  oldrod: '<:oldrod:1560319797265301534>',
  pokeEgg: '<:poke_egg:1560319652402561124>',
  superIncubator: '<:superincubator:1560319695482261614>',
  pokeradar: '<:pokeradar:1560319733960810626>',
  repel: '<:repel:1560319632898924735>',
  superRepel: '<:superrepel:1560399770835492995>',
  maxRepel: '<:maxrepel:1560399980521328672>',
  votecoin: '<:votecoin:1560319772875554897>',
  clanStarter: '🎖️',
  clanBronze: '<:bronzeclan:1558859966109192312>',
  clanSilver: '<:silverclan:1558859965081591980>',
  clanGold: '<a:goldclan:1558859962396975184>',
  clanDiamond: '<a:diamonclan:1558859960354476082>',
  clanAmethyst: '<a:amethystclan:1558859958777413692>',
  clanOnyx: '<a:onyxclan:1558859956696916090>',
  shinyCharm: '<:shinycharm:1560318587573379172>',
  eventticket: '<:eventticket:1558834590855077938>',
  expshare: '<:expshare:1558855049382207529>',
  rarecandy: '<:rarecandy:1560319612845817927>',
  fishingtoken: '<:fishingtoken:1558856235451941046>',
  goodRod: '<:goodrod:1558856916174766080>',
  superRod: '<:superrod:1558856914094260354>',
  goldenRod: '<:goldenrod:1558856912655876246>',
  pokeLure: '<:pokelure:1560393207106244670>',
  mistysLure: '<:mistyslure:1560393225884410049>',
  shinyGmax: '<:shinygmax:1558841134061453402>',
  gmax: '<:gmax:1558841134996791387>',
  shinyMega: '<:shinymega:1558844547340177519>',
  mega: '<:mega:1558844548564918472>',
  shiny: '<:shiny:1558841136905326784>',
  golden: '<:golden:1559951535062909128>',
  legendary: '<:legendary:1558841138193113221>',
  superRare: '<:superrare:1558841140441120858>',
  rare: '<:rare:1558841142878015559>',
  uncommon: '<:uncommon:1558841144178380800>',
  common: '<:common:1558841145734205470>',
  goldenRazz: '<:goldenrazzberry:1560319592109445181>',
};

const TYPE_EMOJIS = {
  psychic: '<:psychictype:1560293258725163090>',
  dark: '<:darktype:1560293257391644742>',
  grass: '<:grasstype:1560293256036749312>',
  poison: '<:poisontype:1560293254430462012>',
  fire: '<:firetype:1560293252828237855>',
  flying: '<:flyingtype:1560293250940665879>',
  dragon: '<:dragontype:1560293249925644409>',
  water: '<:watertype:1560293248503910400>',
  bug: '<:bugtype:1560293247102877788>',
  fairy: '<:fairytype:1560293245983137912>',
  electric: '<:electrictype:1560293244573585601>',
  normal: '<:normaltype:1560293243529339021>',
  ice: '<:icetype:1560293241990156299>',
  fighting: '<:fightingtype:1560293240366702713>',
  steel: '<:steeltype:1560293238420537405>',
  ground: '<:groundtype:1560293236839419991>',
  rock: '<:rocktype:1560293235740381234>',
  ghost: '<:ghosttype:1560293234205532220>',
};

function getTypeEmoji(type) {
  return TYPE_EMOJIS[String(type || '').toLowerCase()] || '⚪';
}

function formatTypes(types, separator = ' / ') {
  const list = (Array.isArray(types) ? types : types ? [types] : []).filter(Boolean);
  if (!list.length) return 'Unknown';
  return list
    .map((type) => `${getTypeEmoji(type)} ${String(type)[0].toUpperCase()}${String(type).slice(1)}`)
    .join(separator);
}

const CLAN_RANK_EMOJIS = {
  starter: EMOJIS.clanStarter,
  bronze: EMOJIS.clanBronze,
  silver: EMOJIS.clanSilver,
  gold: EMOJIS.clanGold,
  diamond: EMOJIS.clanDiamond,
  amethyst: EMOJIS.clanAmethyst,
  onyx: EMOJIS.clanOnyx,
};

const EGG_HATCH_POOLS = Object.freeze({
  early: Object.freeze([
    'Chingling', 'Bonsly', 'Mime Jr.', 'Happiny', 'Chatot', 'Munchlax', 'Riolu',
    'Mantyke', 'Audino', 'Zorua', 'Emolga', 'Ferroseed', 'Golett', 'Pawniard',
    'Larvesta', 'Pancham', 'Spritzee', 'Swirlix', 'Skrelp', 'Noibat', 'Crabrawler',
    'Rockruff', 'Mareanie', 'Wimpod', 'Type: Null',
  ]),
  late: Object.freeze(['Carbink', 'Mimikyu']),
});

const EGG_RARE_HATCHES = Object.freeze([
  { name: 'Nickit', denominator: 150, minTarget: 30, maxTarget: 90 },
  { name: 'Yamper', denominator: 150, minTarget: 30, maxTarget: 90 },
  { name: 'Toxel', denominator: 150, minTarget: 30, maxTarget: 90 },
  { name: 'Morpeko', denominator: 100, minTarget: 30, maxTarget: 90 },
  { name: "Sirfetch'd", denominator: 100, minTarget: 91, maxTarget: 130 },
  { name: 'Phione', denominator: 150, minTarget: 91, maxTarget: 130 },
  { name: 'Manaphy', denominator: 150, minTarget: 91, maxTarget: 130 },
  { name: 'Victini', denominator: 500, minTarget: 91, maxTarget: 130 },
  { name: 'Wynaut', denominator: 150, isGolden: true },
  { name: 'Chansey', denominator: 100, isShiny: true },
  { name: 'Scyther', denominator: 100, isShiny: true },
  { name: 'Ditto', denominator: 100, isShiny: true },
  { name: 'Aerodactyl', denominator: 100, isShiny: true },
  { name: 'Togepi', denominator: 100, isShiny: true },
  { name: 'Elekid', denominator: 100, isShiny: true },
  { name: 'Magby', denominator: 100, isShiny: true },
  { name: 'Bonsly', denominator: 100, isShiny: true },
  { name: 'Chatot', denominator: 100, isShiny: true, patreonOnly: true },
  { name: 'Gible', denominator: 100, isShiny: true },
  { name: 'Phione', denominator: 750, isShiny: true },
  { name: 'Manaphy', denominator: 750, isShiny: true },
  { name: 'Victini', denominator: 1000, isShiny: true },
  { name: 'Zorua', denominator: 100, isShiny: true },
  { name: 'Pawniard', denominator: 100, isShiny: true },
  { name: 'Larvesta', denominator: 100, isShiny: true },
  { name: 'Noibat', denominator: 100, isShiny: true, patreonOnly: true },
  { name: 'Nickit', denominator: 100, isShiny: true },
  { name: 'Wooloo', denominator: 100, isShiny: true },
  { name: 'Silicobra', denominator: 100, isShiny: true },
  { name: 'Impidimp', denominator: 100, isShiny: true },
  { name: 'Toxel', denominator: 100, isShiny: true },
  { name: 'Perrserker', denominator: 100, isShiny: true },
  { name: 'Cursola', denominator: 100, isShiny: true },
  { name: 'Milcery', denominator: 100, isShiny: true },
]);

const SWAP_EXCLUSIVE_SHINIES = Object.freeze([
  { name: 'Oddish' },
  { name: 'Gastly' },
  { name: 'Tyrogue' },
  { name: 'Larvitar' },
  { name: 'Ralts' },
  { name: 'Snorunt' },
  { name: 'Beldum' },
  { name: 'Bronzor' },
  { name: 'Scraggy', patreonOnly: true },
  { name: 'Shelmet' },
  { name: 'Pancham', patreonOnly: true },
]);

const FISH_EXCLUSIVE_SHINIES = Object.freeze([
  'Horsea', 'Tentacool', 'Goldeen', 'Finneon', 'Poliwag', 'Krabby',
  'Clamperl', 'Shellder', 'Wailmer', 'Carvanha', 'Magikarp', 'Feebas',
]);
const FISH_EXCLUSIVE_GOLDENS = Object.freeze(['Poliwag', 'Tentacool', 'Wailmer', 'Kyogre']);
const FISH_EXCLUSIVE_GOLDEN_DENOMINATOR = 5000;
const CATCHBOT_GOLDEN_EXCLUSIVES = Object.freeze(
  db.prepare(`
    SELECT id, species_name AS name, rarity, base_hp AS baseHp, base_atk AS baseAtk,
      base_def AS baseDef, base_spd AS baseSpd, types
    FROM pokemon_forms
    WHERE is_default = 1 AND lower(species_name) IN ('aron', 'swablu')
    ORDER BY species_id
  `).all()
);
if (CATCHBOT_GOLDEN_EXCLUSIVES.length !== 2) {
  throw new Error('CatchBot Golden exclusives Aron and Swablu must exist in the Pokémon catalog.');
}

function rollCatchbotGoldenExclusive(luckPercent) {
  const maxLuckPercent = CB_CONFIG.luck.getStat(CB_CONFIG.luck.maxLvl);
  if (luckPercent < maxLuckPercent || Math.random() >= 1 / 1000) return null;
  const pokemon = CATCHBOT_GOLDEN_EXCLUSIVES[
    Math.floor(Math.random() * CATCHBOT_GOLDEN_EXCLUSIVES.length)
  ];
  return {
    ...pokemon,
    types: JSON.parse(pokemon.types),
    rarity: 'Golden',
    isGolden: true,
    isShiny: false,
  };
}

function getSwapMultiplier(swapsToday) {
  const bonusPercent = Math.min(10, Math.floor(swapsToday / 20));
  return 1 + bonusPercent / 100;
}

function getEggCatchTarget(userId) {
  const accelerated = getPatreonPerks(userId).eggHatchSpeed > 0;
  const minimum = accelerated ? 20 : 30;
  const maximum = accelerated ? 110 : 130;
  return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum;
}

function rollEggHatch(target, hasPatreon) {
  const matchingSpecials = EGG_RARE_HATCHES.filter((entry) =>
    (entry.minTarget === undefined || target >= entry.minTarget)
    && (entry.maxTarget === undefined || target <= entry.maxTarget)
    && (!entry.patreonOnly || hasPatreon)
    && Math.random() < 1 / entry.denominator
  );
  const result = matchingSpecials.length
    ? matchingSpecials[Math.floor(Math.random() * matchingSpecials.length)]
    : {
      name: EGG_HATCH_POOLS[target <= 90 ? 'early' : 'late'][
        Math.floor(Math.random() * EGG_HATCH_POOLS[target <= 90 ? 'early' : 'late'].length)
      ],
    };
  const form = db.prepare(`
    SELECT id, species_id, slug, species_name, rarity, sprite AS img, shiny_sprite AS shinyImg,
      base_hp AS baseHp, base_atk AS baseAtk,
      base_def AS baseDef, base_spd AS baseSpd
    FROM pokemon_forms
    WHERE lower(species_name) = lower(?) AND is_default = 1
    ORDER BY id
    LIMIT 1
  `).get(result.name);
  if (!form) throw new Error(`Egg-exclusive Pokémon ${result.name} has no default form in the catalog.`);
  return {
    pokemon: { ...form, name: form.species_name },
    isShiny: Boolean(result.isShiny),
    isGolden: Boolean(result.isGolden),
  };
}

const RARITY_EMOJIS = {
  legendary: EMOJIS.legendary,
  'super rare': EMOJIS.superRare,
  rare: EMOJIS.rare,
  uncommon: EMOJIS.uncommon,
  common: EMOJIS.common,
  mega: EMOJIS.mega,
  gmax: EMOJIS.gmax,
  shiny: EMOJIS.shiny,
  golden: EMOJIS.golden,
  'shiny mega': EMOJIS.shinyMega,
  'shiny gmax': EMOJIS.shinyGmax,
};

const RARITY_COLORS = {
  common: 0x00008b,
  uncommon: 0x87cefa,
  rare: 0xffa500,
  'super rare': 0xffff00,
  legendary: 0x800080,
  shiny: 0xffb6c1,
  golden: 0xffd700,
};
const EVENT_EMBED_COLOR = 0x8b0000;

function getDisplayRarity(rarity, pokemonName = '', isShiny = false) {
  if (isShiny) {
    if (/gmax|gigantamax|eternamax/i.test(pokemonName)) return 'Shiny Gmax';
    if (/\bmega\b/i.test(pokemonName)) return 'Shiny Mega';
    return 'Shiny';
  }
  if (/gmax|gigantamax|eternamax/i.test(pokemonName)) return 'Gmax';
  if (/\bmega\b/i.test(pokemonName)) return 'Mega';
  return rarity;
}

function getRarityColor(rarity, pokemonName = '', isShiny = false) {
  const displayRarity = getDisplayRarity(rarity, pokemonName, isShiny).toLowerCase();
  return RARITY_COLORS[displayRarity] || 0x3498db;
}

// Species-specific Mega emojis, filled at startup from the emojis the bot can see.
const MEGA_SPECIES_EMOJIS = {};

function getRarityEmojis(rarity, pokemonName = '', isShiny = false) {
  const displayRarity = getDisplayRarity(rarity, pokemonName, isShiny);
  const base = RARITY_EMOJIS[displayRarity.toLowerCase()] || '';
  if (/^(shiny )?mega$/i.test(displayRarity)) {
    const species = String(pokemonName).toLowerCase().match(/sableye|gengar|mawile|banette/)?.[0];
    const speciesEmoji = species && MEGA_SPECIES_EMOJIS[species];
    if (speciesEmoji) return /^shiny/i.test(displayRarity) ? `${speciesEmoji}${base}` : speciesEmoji;
  }
  return base;
}

function formatPokemonReward(pokemon) {
  const isShiny = Boolean(pokemon.isShiny ?? pokemon.is_shiny);
  const isGolden = Boolean(pokemon.isGolden ?? pokemon.is_golden);
  if (isGolden) return `${EMOJIS.golden} **Golden ${pokemon.name}**`;
  const emoji = getRarityEmojis(pokemon.rarity, pokemon.name, isShiny);
  return `${emoji ? `${emoji} ` : ''}${isShiny ? '✨ ' : ''}**${pokemon.name}**`;
}

const BALL_CONFIG = {
  pb: { name: 'Poke Ball', column: 'pokeballs', bonus: 10, usageColumn: 'used_pokeballs', emoji: EMOJIS.pokeball, buttonEmoji: { name: 'pokeball', id: '1560318610306637974' }, image: 'poke-ball.png' },
  gb: { name: 'Greatball', column: 'greatballs', bonus: 25, usageColumn: 'used_greatballs', emoji: EMOJIS.greatball, buttonEmoji: { name: 'greatball', id: '1560318631399923732' }, image: 'great-ball.png' },
  ub: { name: 'Ultraball', column: 'ultraballs', bonus: 35, usageColumn: 'used_ultraballs', emoji: EMOJIS.ultraball, buttonEmoji: { name: 'ultraball', id: '1560318663658315857' }, image: 'ultra-ball.png' },
  mb: { name: 'Masterball', column: 'masterballs', bonus: 100, usageColumn: 'used_masterballs', emoji: EMOJIS.masterball, buttonEmoji: { name: 'masterball', id: '1560318696180686888' }, image: 'master-ball.png' },
  prb: { name: 'Premierball', column: 'premierballs', bonus: 50, usageColumn: 'used_premierballs', emoji: '<:premierball:1558834593757405294>', buttonEmoji: { name: 'premierball', id: '1558834593757405294' }, image: 'premier-ball.png' },
  dv: { name: 'Diveball', column: 'diveballs', bonus: 0, usageColumn: null, emoji: EMOJIS.diveball, buttonEmoji: { name: 'diveball', id: '1560438056346198077' }, image: 'dive-ball.png', fishingOnly: true, catchChance: 85 },
};

const FACTION_CATCH_POINTS = 100;
const FACTION_MASTERBALL_POINTS = 5000;
// Daily-ball points scale with the rarity of the Pokémon caught.
const FACTION_DAILY_BALL_POINTS_BY_RARITY = {
  Common: 1000,
  Uncommon: 2500,
  Rare: 5000,
  'Super Rare': 8000,
  Legendary: 12000,
};
const FACTION_DAILY_BALL_TOP_POINTS = 12000;

function getFactionCatchPoints(factionKey, ballKey, displayRarity) {
  if (ballKey === 'mb') return FACTION_MASTERBALL_POINTS;
  if (getDailyBall(factionKey).key === ballKey) {
    return FACTION_DAILY_BALL_POINTS_BY_RARITY[displayRarity] ?? FACTION_DAILY_BALL_TOP_POINTS;
  }
  return FACTION_CATCH_POINTS;
}

const ICONS = {
  grass: '🌿',
  dex: '📑',
  check: '✅',
  box: '📦',
};

// Non-event shinies are 1/200 (1/160 for patrons); active event shiny targets use 1/2500 before bonuses.
const BASE_SHINY_RATE = 1 / 200;
// Incense: +10% shiny encounter rate and +10% promo item drop rate while server charges last.
const INCENSE_BOOST = 1.1;
const PATREON_SHINY_RATE = 1 / 160;
const EVENT_SHINY_RATE = 1 / 2500;
const CATCHBOT_SHINY_MULTIPLIER = 0.5;
const GRAZZ_ENCOUNTERS_PER_BERRY = 50;
const SPECIAL_SPAWN_EST_OFFSET_MS = 5 * 60 * 60 * 1000;
const ENCOUNTER_RARITY_WEIGHTS = Object.freeze({
  normal: { Common: 40, Uncommon: 30, Rare: 27, 'Super Rare': 2 },
  repel: { Common: 15, Uncommon: 50, Rare: 31, 'Super Rare': 3 },
  super_repel: { Common: 12, Uncommon: 48, Rare: 35, 'Super Rare': 4 },
  max_repel: { Common: 7, Uncommon: 48, Rare: 39, 'Super Rare': 5 },
  honey: { Common: 75, Uncommon: 15, Rare: 8, 'Super Rare': 1 },
});
const LEGENDARY_GENERATION_ORDER = Object.freeze([
  { generation: 'generation-iv', rollChance: 1 / 5 },
  { generation: 'generation-v', rollChance: 1 / 5 },
  { generation: 'generation-vi', rollChance: 1 / 5 },
  { generation: 'generation-vii', rollChance: 1 / 5 },
]);
const LEGENDARY_BASE_CHANCE = 1 / 250;
const LEGENDARY_GOLDEN_RAZZ_CHANCE = 1 / 190;
const LEGENDARY_GENERATION_DENOMINATORS = Object.freeze({
  'generation-i': { normal: 244, goldenRazz: 183 },
  'generation-ii': { normal: 244, goldenRazz: 183 },
  'generation-iii': { normal: 244, goldenRazz: 183 },
  'generation-iv': { normal: 500, goldenRazz: 375 },
  'generation-v': { normal: 625, goldenRazz: 469 },
  'generation-vi': { normal: 781, goldenRazz: 586 },
  'generation-vii': { normal: 977, goldenRazz: 732 },
});
// A hunt targets one specific Pokémon; the catches needed depend on its rarity.
const DAILY_HUNT_CONFIG = Object.freeze({
  Common: { chance: 1, required: 5, rewards: { pokeballs: 2, greatballs: 1 } },
  Uncommon: { chance: 1, required: 5, rewards: { pokeballs: 3, greatballs: 2 } },
  Rare: { chance: 1, required: 3, rewards: { greatballs: 3, ultraballs: 1 } },
  'Super Rare': { chance: 1, required: 1, rewards: { ultraballs: 3, premierballs: 1 } },
  Legendary: { chance: 1, required: 1, rewards: { masterballs: 2 } },
});

function chooseDailyHuntTarget(excludedId = null) {
  const rarities = Object.keys(DAILY_HUNT_CONFIG);
  const target = db.prepare(`
    SELECT id, species_name AS name, rarity
    FROM pokemon_forms
    WHERE is_default = 1 AND rarity IN (${rarities.map(() => '?').join(', ')}) AND id != ?
    ORDER BY RANDOM()
    LIMIT 1
  `).get(...rarities, excludedId ?? 0);
  if (!target) throw new Error('No Pokémon are available for the Daily Hunt.');
  return target;
}

function formatPercent(chance) {
  return `${(chance * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
}

function formatEncounterWeights(modifier) {
  return Object.entries(ENCOUNTER_RARITY_WEIGHTS[modifier])
    .map(([rarity, weight]) => `${rarity} ${weight}`)
    .join(' • ');
}

function getLegendaryEncounterRateText(
  generation,
  goldenRazzActive,
  channelRateBoost,
  roleChanceBoost = 0
) {
  const denominators = LEGENDARY_GENERATION_DENOMINATORS[generation];
  if (!denominators) throw new Error(`No encounter-rate denominator configured for "${generation}".`);
  const denominator = Math.round(
    denominators[goldenRazzActive ? 'goldenRazz' : 'normal']
      / ((1 + channelRateBoost / 100) * (1 + roleChanceBoost / 100))
  );
  return `1/${denominator.toLocaleString()} encounter rate`;
}

function recordDailyHuntCatch(userId, caught) {
  return db.transaction(() => {
    const now = Date.now();
    const user = getUser(userId);
    const huntRarity = user.hunt_target_rarity;
    const config = DAILY_HUNT_CONFIG[huntRarity];
    if (
      user.hunt_expires_at <= now
      || user.hunt_completed
      || !config
      || user.hunt_target_id <= 0
      || user.hunt_required !== config.required
    ) return null;
    if (caught.id !== user.hunt_target_id || caught.isShiny || caught.isGolden) {
      return { outcome: 'other_pokemon', progress: user.hunt_progress, required: config.required };
    }
    if (Math.random() >= config.chance) {
      return { outcome: 'chance_missed', progress: user.hunt_progress, required: config.required };
    }

    const progress = Math.min(config.required, user.hunt_progress + 1);
    const completed = progress >= config.required;
    const updated = db.prepare(`
      UPDATE users
      SET hunt_progress = ?, hunt_completed = ?
      WHERE id = ? AND hunt_completed = 0 AND hunt_expires_at > ?
    `).run(progress, completed ? 1 : 0, userId, now).changes > 0;
    if (!updated) return null;
    if (completed) {
      incrementUser(userId, { ...config.rewards, hunts_completed: 1 });
    }
    return {
      outcome: completed ? 'completed' : 'progress',
      progress,
      required: config.required,
      chance: config.chance,
      rewards: completed ? config.rewards : null,
    };
  }).immediate();
}

function consumeEncounterModifier(userId) {
  return db.transaction(() => {
    for (const [modifier, column] of [
      ['repel', 'repel_encounters'],
      ['super_repel', 'super_repel_encounters'],
      ['max_repel', 'max_repel_encounters'],
      ['honey', 'honey_encounters'],
    ]) {
      const consumed = db.prepare(
        `UPDATE users SET ${column} = ${column} - 1 WHERE id = ? AND ${column} > 0`
      ).run(userId).changes > 0;
      if (consumed) return modifier;
    }
    return 'normal';
  }).immediate();
}

function activateEncounterModifier(userId, modifier, amount) {
  const items = {
    repel: { itemName: 'Repel', activeField: 'repel_encounters', countField: 'repels' },
    super_repel: { itemName: 'Super Repel', activeField: 'super_repel_encounters' },
    max_repel: { itemName: 'Max Repel', activeField: 'max_repel_encounters' },
    honey: { itemName: 'Honey', activeField: 'honey_encounters' },
  };
  const item = items[modifier];
  if (!item) throw new TypeError(`Unknown encounter modifier "${modifier}".`);

  return db.transaction(() => {
    const user = getUser(userId);
    const active = [
      ['Repel', user.repel_encounters],
      ['Super Repel', user.super_repel_encounters],
      ['Max Repel', user.max_repel_encounters],
      ['Honey', user.honey_encounters],
    ].find(([, encounters]) => encounters > 0);
    if (active) return { error: 'modifier_active', activeName: active[0] };

    const addedEncounters = amount * 30;
    const activeCount = user[item.activeField];
    if (!Number.isSafeInteger(addedEncounters)
        || !Number.isSafeInteger(activeCount + addedEncounters)) {
      return { error: 'too_many' };
    }
    if (item.countField) {
      if (user[item.countField] < amount) {
        return { error: 'insufficient', owned: user[item.countField] };
      }
      incrementUser(userId, { [item.countField]: -amount });
    } else if (!takeUserItem(userId, item.itemName, amount)) {
      const owned = getUserItems(userId).find((entry) => entry.item_name === item.itemName)?.amount || 0;
      return { error: 'insufficient', owned };
    }

    incrementUser(userId, {
      [item.activeField]: addedEncounters,
      ...(modifier === 'honey'
        ? { honey_used: amount }
        : { repels_used: amount }),
    });
    return { encounters: activeCount + addedEncounters };
  }).immediate();
}

function chooseEncounterRarity(modifier, goldenRazzActive, channelRateBoost, roleChanceBoost = 0) {
  const legendaryChance = Math.min(
    1,
    (goldenRazzActive ? LEGENDARY_GOLDEN_RAZZ_CHANCE : LEGENDARY_BASE_CHANCE)
      * (1 + channelRateBoost / 100)
      * (1 + roleChanceBoost / 100)
  );
  if (Math.random() < legendaryChance) return 'Legendary';

  const weights = ENCOUNTER_RARITY_WEIGHTS[modifier] || ENCOUNTER_RARITY_WEIGHTS.normal;
  const totalWeight = Object.values(weights).reduce((total, weight) => total + weight, 0);
  let roll = Math.random() * totalWeight;
  for (const [rarity, weight] of Object.entries(weights)) {
    roll -= weight;
    if (roll < 0) return rarity;
  }
  throw new Error(`Could not select encounter rarity for modifier "${modifier}".`);
}

function getRandomLegendaryFromGenerations(generations) {
  const placeholders = generations.map(() => '?').join(', ');
  const excludedPlaceholders = SPECIAL_SPAWN_RESERVED_SPECIES.map(() => '?').join(', ');
  const pokemon = db.prepare(`
    SELECT * FROM pokemon_forms
    WHERE is_default = 1 AND is_legendary = 1
      AND lower(rarity) = 'legendary'
      AND generation IN (${placeholders})
      AND lower(species_name) NOT IN (${excludedPlaceholders})
    ORDER BY RANDOM()
    LIMIT 1
  `).get(...generations, ...SPECIAL_SPAWN_RESERVED_SPECIES.map((name) => name.toLowerCase()));
  if (!pokemon) {
    throw new Error(`No ordinary Legendary Pokémon are configured for ${generations.join(', ')}.`);
  }
  return {
    id: pokemon.id,
    speciesId: pokemon.species_id,
    slug: pokemon.slug,
    name: pokemon.name,
    speciesName: pokemon.species_name,
    rarity: pokemon.rarity,
    baseHp: pokemon.base_hp,
    baseAtk: pokemon.base_atk,
    baseDef: pokemon.base_def,
    baseSpd: pokemon.base_spd,
    img: pokemon.sprite,
    shinyImg: pokemon.shiny_sprite,
    types: JSON.parse(pokemon.types),
    isDefault: Boolean(pokemon.is_default),
    isLegendary: Boolean(pokemon.is_legendary),
    isMythical: Boolean(pokemon.is_mythical),
    generation: pokemon.generation,
  };
}

function rollEncounterLegendary() {
  for (const entry of LEGENDARY_GENERATION_ORDER) {
    if (Math.random() < entry.rollChance) {
      return getRandomLegendaryFromGenerations([entry.generation]);
    }
  }
  return getRandomLegendaryFromGenerations([
    'generation-i',
    'generation-ii',
    'generation-iii',
  ]);
}

function getSpecialSpawnPokemon(speciesName) {
  const form = findPokemonForms(speciesName, 50)
    .find((pokemon) => pokemon.is_default && pokemon.species_name.toLowerCase() === speciesName.toLowerCase());
  if (!form) {
    throw new Error(`Special spawn Pokémon "${speciesName}" is missing its default catalog form.`);
  }
  return {
    id: form.id,
    speciesId: form.species_id,
    slug: form.slug,
    name: form.name,
    speciesName: form.species_name,
    rarity: form.rarity,
    baseHp: form.base_hp,
    baseAtk: form.base_atk,
    baseDef: form.base_def,
    baseSpd: form.base_spd,
    img: form.sprite,
    shinyImg: form.shiny_sprite,
    types: JSON.parse(form.types),
    isDefault: Boolean(form.is_default),
    isLegendary: Boolean(form.is_legendary),
    isMythical: Boolean(form.is_mythical),
  };
}

function rollSpecialLegendarySpawn(
  userId,
  goldenRazzActive,
  shinyBonus,
  channelRateBoost,
  roleChanceBoost = 0
) {
  const fixedEstHour = new Date(Date.now() - SPECIAL_SPAWN_EST_OFFSET_MS).getUTCHours();
  const isNight = fixedEstHour >= 18 || fixedEstHour < 6;
  const ownedSpecies = new Set(
    db.prepare(`
      SELECT DISTINCT lower(forms.species_name) AS species_name
      FROM catches
      JOIN pokemon_forms AS forms ON forms.id = catches.pokemon_id
      WHERE catches.user_id = ?
    `).all(userId).map((row) => row.species_name)
  );
  const hasLegendaryTrio = ['cobalion', 'terrakion', 'virizion']
    .every((species) => ownedSpecies.has(species));
  const hasAncientFossil = (getUserItems(userId)
    .find((item) => item.item_name === 'Ancient Fossil')?.amount || 0) > 0;
  const specialEntries = [
    { species: 'Darkrai', denominator: 100000, active: isNight, shinyMode: 'one-in-ten' },
    { species: 'Shaymin', denominator: 100000, active: !isNight, shinyMode: 'one-in-ten' },
    { species: 'Arceus', denominator: 100000, active: true, shinyMode: 'one-in-ten' },
    { species: 'Reshiram', denominator: 41630, boostedDenominator: 31250, active: true, shinyMode: 'full-odds' },
    { species: 'Zekrom', denominator: 41630, boostedDenominator: 31250, active: true, shinyMode: 'full-odds' },
    { species: 'Kyurem', denominator: 41630, boostedDenominator: 31250, active: true, shinyMode: 'full-odds' },
    { species: 'Meloetta', denominator: 41630, boostedDenominator: 31250, active: true, shinyMode: 'one-in-two' },
    { species: 'Diancie', denominator: 52030, boostedDenominator: 39070, active: true, shinyMode: 'one-in-two' },
    { species: 'Hoopa', denominator: 52030, boostedDenominator: 39070, active: true, shinyMode: 'one-in-two' },
    { species: 'Volcanion', denominator: 52030, boostedDenominator: 39070, active: true, shinyMode: 'one-in-two' },
    { species: 'Keldeo', denominator: 41630, boostedDenominator: 31250, active: hasLegendaryTrio, shinyMode: 'one-in-two' },
    { species: 'Genesect', denominator: 41630, boostedDenominator: 31250, active: hasAncientFossil, shinyMode: 'one-in-two' },
  ];

  for (const entry of specialEntries) {
    if (!entry.active) continue;
    const denominator = goldenRazzActive
      ? (entry.boostedDenominator || entry.denominator)
      : entry.denominator;
    const legendaryChance = Math.min(
      1,
      ((1 + channelRateBoost / 100) * (1 + roleChanceBoost / 100)) / denominator
    );
    if (Math.random() >= legendaryChance) continue;

    const pokemon = getSpecialSpawnPokemon(entry.species);
    const isShiny = entry.shinyMode === 'one-in-ten'
      ? Math.random() < 0.1
      : entry.shinyMode === 'one-in-two'
        ? Math.random() < 0.5
        : Math.random() < (getUser(userId).has_patreon ? PATREON_SHINY_RATE : BASE_SHINY_RATE)
          * (1 / (1 - shinyBonus / 100))
          * (1 + getPatreonPerks(userId).shinyRatePct / 100)
          * (1 + channelRateBoost / 100);
    pokemon.encounterRateText =
      `1/${Math.round(
        denominator / ((1 + channelRateBoost / 100) * (1 + roleChanceBoost / 100))
      ).toLocaleString()} encounter rate`;
    pokemon.isShiny = isShiny;
    pokemon.isEventShiny = false;
    return pokemon;
  }
  return null;
}

function rollSpawn(
  poolName,
  userId = null,
  rod = null,
  {
    catchbot = false,
    catchbotLuckPercent = 0,
    channelRateBoost = 0,
    roleChanceBoost = 0,
    goldenRazzActive = false,
    guildId = null,
  } = {}
) {
  if (poolName !== 'land' && poolName !== 'water') {
    throw new TypeError(`Unknown spawn pool: ${poolName}`);
  }
  // One shared server charge per boosted encounter.
  const incenseActive = !catchbot && consumeIncenseCharge(guildId);
  const pokeradarActive = !catchbot && userId !== null && consumePokeradarCharge(userId);

  const ticketSpawnMultiplier = halloweenEvent.ticketSpawnMultiplier ?? 1;
  if (!Number.isFinite(ticketSpawnMultiplier) || ticketSpawnMultiplier < 1) {
    throw new Error('Event ticket spawn multiplier must be a finite number of at least 1.');
  }
  const ticketBoostActive = !catchbot
    && userId !== null
    && isEventOpen(halloweenEvent)
    && Boolean(getUser(userId).event_ticket)
    && ticketSpawnMultiplier > 1;
  const eventTicketActive = !catchbot
    && userId !== null
    && isEventOpen(halloweenEvent)
    && Boolean(getUser(userId).event_ticket);
  const clanPerks = userId === null
    ? getClanPerkMultipliers(null)
    : getClanPerkMultipliers(getPlayerClan(userId));
  const shinyBonus = userId === null ? 0 : getTotalEffectiveShinyBonus(userId);
  const encounterModifier = !catchbot
    && poolName === 'land'
    && userId !== null
    ? consumeEncounterModifier(userId)
    : 'normal';

  if (!catchbot && poolName === 'land' && userId !== null) {
    const specialPokemon = rollSpecialLegendarySpawn(
      userId,
      goldenRazzActive,
      shinyBonus,
      channelRateBoost,
      roleChanceBoost
    );
    if (specialPokemon) return specialPokemon;
  }

  let forcedEvent = null;
  if (eventTicketActive && eventSpawnEntries.length && Math.random() * EVENT_SPAWN_ODDS < 1) {
    forcedEvent = eventSpawnEntries[Math.floor(Math.random() * eventSpawnEntries.length)];
  }

  while (true) {
    let rarity;
    let pokemon;
    let isForcedEventSpawn = false;
    let forcedShiny = false;
    if (forcedEvent) {
      pokemon = getRandomPokemon(null, false, true, true, null, [], forcedEvent.ids);
      pokemon.encounterModifier = encounterModifier;
      forcedShiny = forcedEvent.shiny;
      forcedEvent = null;
      isForcedEventSpawn = true;
    } else if (!catchbot && poolName === 'land') {
      rarity = chooseEncounterRarity(
        encounterModifier,
        goldenRazzActive,
        channelRateBoost,
        roleChanceBoost
      );
      if (rarity === 'Legendary') {
        pokemon = rollEncounterLegendary();
        pokemon.encounterRateText = getLegendaryEncounterRateText(
          pokemon.generation,
          goldenRazzActive,
          channelRateBoost,
          roleChanceBoost
        );
      } else {
        pokemon = getRandomPokemon(
          rarity,
          false,
          true,
          true,
          eventTicketActive ? eventSpawnFormIds : [],
          SPECIAL_SPAWN_RESERVED_SPECIES
        );
        pokemon.encounterRateText = `${ENCOUNTER_RARITY_WEIGHTS[encounterModifier][rarity]}% encounter rate`;
      }
      pokemon.encounterModifier = encounterModifier;
    } else {
      const rarityPool = getRaritySettings().filter(
        (entry) => entry.name.toLowerCase() !== 'gmax'
          && !['mega', 'shiny mega'].includes(entry.name.toLowerCase())
          && (!rod || rod.enablesLegendary || entry.name.toLowerCase() !== 'legendary')
          && entry.spawn_weight > 0
          && entry.pokemon_count > 0
      ).map((entry) => ({
        ...entry,
        spawn_weight: entry.spawn_weight
          * (catchbot
            ? ({
              common: 1,
              uncommon: 0.75,
              rare: 0.5,
              'super rare': 0.25,
              legendary: 0.1,
            }[entry.name.toLowerCase()] ?? 0.1)
            : 1)
          * (entry.name.toLowerCase() === 'legendary'
            ? (1 + (catchbot ? 0 : channelRateBoost) / 100)
              * (1 + roleChanceBoost / 100)
            : 1),
      }));
      const totalWeight = rarityPool.reduce((total, entry) => total + entry.spawn_weight, 0);
      if (!totalWeight) throw new Error('No Pokémon rarities have a positive spawn weight.');
      let random = Math.random() * totalWeight;
      rarity = rarityPool[rarityPool.length - 1].name;
      for (const entry of rarityPool) {
        random -= entry.spawn_weight;
        if (random < 0) {
          rarity = entry.name;
          break;
        }
      }
      pokemon = getRandomPokemon(
        rarity,
        poolName === 'water',
        true,
        true,
        eventTicketActive ? eventSpawnFormIds : [],
        SPECIAL_SPAWN_RESERVED_SPECIES
      );
    }

    if (catchbot && isEventOpen(halloweenEvent) && getEventPokemonKey(pokemon, false)) continue;

    if (
      roleChanceBoost > 0
      && isEventOpen(halloweenEvent)
      && !isForcedEventSpawn
      && !isEventChecklistSpawn(pokemon)
      && Math.random() >= 1 / (1 + roleChanceBoost / 100)
    ) continue;

    const isEventShinyTargetActive = (!rod || rod.enablesShiny)
      && eventTicketActive
      && isEventShinyTarget(pokemon);
    const eventShinyBonus = isEventShinyTargetActive ? clanPerks.erBonus : 0;
    const shinyBonusMultiplier = 1 / (1 - (shinyBonus + eventShinyBonus) / 100);
    const eventTicketShinyMultiplier = isEventShinyTargetActive && eventTicketActive
      ? 1 / 0.95
      : 1;
    const baseShinyRate = isEventShinyTargetActive
      ? EVENT_SHINY_RATE
      : rod
        ? (rod.enablesShiny ? rod.baseShinyRate : 0)
        : (userId !== null && getUser(userId).has_patreon ? PATREON_SHINY_RATE : BASE_SHINY_RATE);
    const patreonShinyMultiplier = userId === null
      ? 1
      : 1 + (isEventShinyTargetActive
        ? getPatreonPerks(userId).eventShinyPct
        : getPatreonPerks(userId).shinyRatePct) / 100;
    const baseShinyChance = baseShinyRate
      * patreonShinyMultiplier
      * shinyBonusMultiplier
      * eventTicketShinyMultiplier;
    const shinyChance = baseShinyChance
      * (catchbot
        ? CATCHBOT_SHINY_MULTIPLIER * (1 + catchbotLuckPercent / 100)
        : 1)
      * (catchbot ? 1 : 1 + channelRateBoost / 100)
      * (incenseActive ? INCENSE_BOOST : 1)
      * (pokeradarActive ? 1.1 : 1);
    pokemon.incenseActive = incenseActive;
    pokemon.isShiny = isForcedEventSpawn ? forcedShiny : Math.random() < shinyChance;
    // Event checklist Pokémon only spawn for ticket holders (never via CatchBot).
    if (pokemon.isShiny && !eventTicketActive && isEventOpen(halloweenEvent) && isEventChecklistSpawn(pokemon)) {
      pokemon.isShiny = false;
    }
    pokemon.isEventShiny = Boolean(
      pokemon.isShiny
      && eventTicketActive
      && isEventShinyTarget(pokemon)
    );
    if (isForcedEventSpawn || !eventTicketActive) return pokemon;
    if (!getEventPokemonKey(pokemon, false)) return pokemon;
  }
}

function isEventChecklistSpawn(pokemon) {
  return Boolean(getEventPokemonKey(pokemon));
}

const EXPLORE_EXCLUSIVE_CHANCE = 0.3;
const EXPLORE_GOLDEN_CHANCE = 1 / 200;
const EXPLORE_EXCLUSIVE_WEIGHTS = { Uncommon: 60, Rare: 30, 'Super Rare': 10 };

function formToSpawn(form) {
  return {
    id: form.id,
    speciesId: form.species_id,
    slug: form.slug,
    name: form.name,
    speciesName: form.species_name,
    rarity: form.rarity,
    baseHp: form.base_hp,
    baseAtk: form.base_atk,
    baseDef: form.base_def,
    baseSpd: form.base_spd,
    img: form.sprite,
    shinyImg: form.shiny_sprite,
    types: JSON.parse(form.types),
    isDefault: Boolean(form.is_default),
    isLegendary: Boolean(form.is_legendary),
    isMythical: Boolean(form.is_mythical),
  };
}

function rollExploreExclusive(mapKey) {
  const entries = EXPLORE_EXCLUSIVES[mapKey];
  if (!entries?.length) return null;
  const totalWeight = entries.reduce((sum, [, rarity]) => sum + EXPLORE_EXCLUSIVE_WEIGHTS[rarity], 0);
  let roll = Math.random() * totalWeight;
  let chosen = entries[entries.length - 1];
  for (const entry of entries) {
    roll -= EXPLORE_EXCLUSIVE_WEIGHTS[entry[1]];
    if (roll < 0) { chosen = entry; break; }
  }
  const form = db.prepare('SELECT * FROM pokemon_forms WHERE species_id = ? AND is_default = 1 ORDER BY id LIMIT 1')
    .get(chosen[0]);
  if (!form) return null;
  return { pokemon: { ...formToSpawn(form), rarity: chosen[1] }, canShiny: chosen[2], dex: chosen[0] };
}

// Explore encounters: any Pokémon except event checklist entries, plus per-map exclusives.
function rollExploreEncounter(userId, mapKey = 'grass') {
  let pokemon;
  let canShiny = true;
  const exclusive = Math.random() < EXPLORE_EXCLUSIVE_CHANCE ? rollExploreExclusive(mapKey) : null;
  if (exclusive) {
    pokemon = exclusive.pokemon;
    canShiny = exclusive.canShiny;
    if (EXPLORE_GOLDENS[mapKey] === exclusive.dex && Math.random() < EXPLORE_GOLDEN_CHANCE) {
      pokemon.rarity = 'Golden';
      pokemon.isGolden = true;
      pokemon.isShiny = false;
      pokemon.isEventShiny = false;
      pokemon.isExplore = true;
      pokemon.encounterModifier = 'normal';
      pokemon.encounterRateText = 'Explore encounter';
      return pokemon;
    }
  } else {
    do {
      pokemon = getRandomPokemon(null, false, true, true, [], SPECIAL_SPAWN_RESERVED_SPECIES);
    } while (getEventPokemonKey(pokemon, false));
  }
  const user = getUser(userId);
  const shinyBonus = getTotalEffectiveShinyBonus(userId);
  const shinyRate = (user.has_patreon ? PATREON_SHINY_RATE : BASE_SHINY_RATE)
    * (1 + getPatreonPerks(userId).shinyRatePct / 100) / (1 - shinyBonus / 100);
  pokemon.isShiny = canShiny && Math.random() < shinyRate;
  pokemon.isEventShiny = false;
  pokemon.isExplore = true;
  pokemon.encounterModifier = 'normal';
  pokemon.encounterRateText = 'Explore encounter';
  return pokemon;
}

function getEventPokemonKey(pokemon, matchVariant = true) {
  const normalizedName = pokemon.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const matchesName = (eventPokemon) => eventPokemon.matchNames.some((name) =>
    name.toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedName
  );
  return halloweenEvent.pokemon.find((eventPokemon) =>
    (!matchVariant || Boolean(eventPokemon.shiny) === Boolean(pokemon.isShiny))
    && matchesName(eventPokemon)
  )?.key || (!matchVariant
    ? halloweenEvent.pokemon.find(matchesName)?.key || null
    : null);
}

function isEventShinyTarget(pokemon) {
  const normalizedName = pokemon.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return halloweenEvent.pokemon.some((eventPokemon) =>
    eventPokemon.shiny
    && eventPokemon.matchNames.some((name) =>
      name.toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedName
    )
  );
}

function getRarityInfo(
  rarityName,
  displayRarity = rarityName,
  isShiny = false,
  isEventShiny = false,
  encounterRateText = null
) {
  const rarities = getRaritySettings();
  if (rarityName === 'Golden') {
    return { catchChance: 20, rateText: encounterRateText || 'Golden encounter' };
  }
  const rarity = rarities.find((entry) => entry.name === rarityName);
  const catchRarity = isShiny
    ? (isEventShiny ? 'Event Shiny' : 'Shiny')
    : displayRarity;
  const displayRaritySetting = rarities.find((entry) => entry.name === catchRarity);
  if (!rarity) throw new Error(`No configuration exists for Pokémon rarity "${rarityName}".`);
  if (!displayRaritySetting) {
    throw new Error(`No configuration exists for Pokémon catch rarity "${catchRarity}".`);
  }
  const encounterRate = Math.round(rarity.encounter_rate * (isShiny ? 0.01 : 1));
  return {
    catchChance: displayRaritySetting.catch_chance,
    rateText: encounterRateText || `${encounterRate}% encounter rate`,
  };
}

const PREMIERBALL_RATES = {
  Common: 100,
  Uncommon: 100,
  Rare: 87,
  'Super Rare': 70,
  Legendary: 55,
};

// Premierball uses fixed base rates (event-checklist shinies 50%, any other shiny 100%); clan and channel boosts still apply.
function getBallCatchRate(ballKey, ball, target, displayRarity, baseCatchChance, clanBonus, channelBoost) {
  if (target.isExplore && ['pb', 'gb', 'ub', 'prb', 'mb'].includes(ballKey)) {
    const tableRarity = target.isShiny ? 'Shiny' : displayRarity;
    return ballKey === 'mb'
      ? 100
      : getCatchChance(getExploreCatchRate(ballKey, tableRarity), 0, clanBonus, channelBoost);
  }
  if (ballKey === 'prb') {
    if (target.isShiny) return getCatchChance(target.isEventShiny ? 50 : 100, 0, clanBonus, channelBoost);
    if (PREMIERBALL_RATES[displayRarity] !== undefined) {
      return getCatchChance(PREMIERBALL_RATES[displayRarity], 0, clanBonus, channelBoost);
    }
  }
  return ball.catchChance ?? getCatchChance(baseCatchChance, ball.bonus, clanBonus, channelBoost);
}

function getCatchChance(baseChance, ballBonus, clanBonus = 0, channelBoost = 0) {
  return Math.min(100, (baseChance + ballBonus + clanBonus) * (1 + channelBoost / 100));
}

function getCatchCoinReward(rarity, isShiny) {
  const range = isShiny
    ? [10000, 25000]
    : ({
      Common: [125, 325],
      Uncommon: [250, 525],
      Rare: [450, 875],
      'Super Rare': [1200, 2700],
      Legendary: [10000, 25000],
    }[rarity] || [125, 325]);
  return range[0] + Math.floor(Math.random() * (range[1] - range[0] + 1));
}

function grantRotomItemDrops(userId, pokemon) {
  if (!pokemon.name.toLowerCase().includes('rotom')) return [];
  const chance = pokemon.is_shiny ? 0.10 : 0.02;
  const drops = ROTOM_ITEMS.filter(() => Math.random() < chance);
  for (const item of drops) addUserItem(userId, item);
  return drops;
}

const RELEASE_PAYOUTS = Object.freeze({
  common: 150,
  uncommon: 300,
  rare: 500,
  'super rare': 1000,
});
const BASE_RELEASE_LOCK_LIMIT = 25;

function getReleaseLockLimit(userId) {
  return BASE_RELEASE_LOCK_LIMIT + getPatreonPerks(userId).releaseLocks;
}

function getReleaseLockCount(userId) {
  return db.prepare(
    'SELECT COUNT(*) AS count FROM catches WHERE user_id = ? AND is_locked = 1'
  ).get(userId).count;
}

function getReleaseProtectionReason(pokemon) {
  if (pokemon.is_golden) return 'Golden Pokémon cannot be released.';
  if (pokemon.is_shiny) return 'Shiny Pokémon cannot be released.';
  const rarity = getDisplayRarity(pokemon.rarity, pokemon.name, false).toLowerCase();
  if (['legendary', 'mega', 'gmax'].includes(rarity)) {
    return `${rarity[0].toUpperCase()}${rarity.slice(1)} Pokémon cannot be released.`;
  }
  return null;
}

function findReleaseLockPresetMatches(userId, preset) {
  const catches = db.prepare(`
    SELECT catches.id, catches.pokemon_id, catches.name, catches.rarity,
    catches.is_shiny, catches.is_golden, catches.is_locked, pokemon_forms.species_id,
      pokemon_forms.species_name, pokemon_forms.slug, pokemon_forms.evolution_chain_id,
      pokemon_forms.evolution_stage
    FROM catches
    LEFT JOIN pokemon_forms ON pokemon_forms.id = catches.pokemon_id
    WHERE catches.user_id = ?
    ORDER BY catches.id DESC
  `).all(userId);
  const normalize = (value) => `${value || ''}`.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalizedPreset = normalize(preset);
  const rarityAliases = new Map([
    ['common', 'common'],
    ['uncommon', 'uncommon'],
    ['rare', 'rare'],
    ['superrare', 'super rare'],
    ['legendary', 'legendary'],
    ['shiny', 'shiny'],
    ['golden', 'golden'],
    ['mega', 'mega'],
    ['shinymega', 'shiny mega'],
    ['gmax', 'gmax'],
    ['shinygmax', 'shiny gmax'],
  ]);
  const requestedRarity = rarityAliases.get(normalizedPreset);

  if (requestedRarity) {
    return catches.filter((pokemon) =>
      getDisplayRarity(pokemon.rarity, pokemon.name, Boolean(pokemon.is_shiny)).toLowerCase()
        === requestedRarity
    );
  }

  if (['egg', 'eggs'].includes(normalizedPreset)) {
    const eggNames = new Set([
      ...EGG_HATCH_POOLS.early,
      ...EGG_HATCH_POOLS.late,
      ...EGG_RARE_HATCHES.map((entry) => entry.name),
    ].map(normalize));
    return catches.filter((pokemon) =>
      eggNames.has(normalize(pokemon.name))
      || eggNames.has(normalize(pokemon.species_name))
    );
  }

  if (['starter', 'starters'].includes(normalizedPreset)) {
    const starterNames = [
      'Bulbasaur', 'Charmander', 'Squirtle',
      'Chikorita', 'Cyndaquil', 'Totodile',
      'Treecko', 'Torchic', 'Mudkip',
      'Turtwig', 'Chimchar', 'Piplup',
      'Snivy', 'Tepig', 'Oshawott',
      'Chespin', 'Fennekin', 'Froakie',
      'Rowlet', 'Litten', 'Popplio',
      'Grookey', 'Scorbunny', 'Sobble',
      'Sprigatito', 'Fuecoco', 'Quaxly',
    ];
    const starterChains = new Set(db.prepare(`
      SELECT DISTINCT evolution_chain_id
      FROM pokemon_forms
      WHERE is_default = 1 AND lower(species_name) IN (${starterNames.map(() => '?').join(', ')})
    `).all(...starterNames.map((name) => name.toLowerCase()))
      .map((row) => row.evolution_chain_id)
      .filter((chainId) => chainId !== null));
    return catches.filter((pokemon) => starterChains.has(pokemon.evolution_chain_id));
  }

  if (['event', 'events'].includes(normalizedPreset)) {
    const eventNames = new Set();
    for (const eventPokemon of db.prepare('SELECT match_names FROM event_pokemon').all()) {
      const names = JSON.parse(eventPokemon.match_names);
      for (const name of names) eventNames.add(normalize(name));
    }
    for (const reward of Object.values(halloweenEvent.rewards || {})) {
      if (reward.displayName) eventNames.add(normalize(reward.displayName.replace(/^(shiny|golden)\s+/i, '')));
      if (reward.pokemonSlug) {
        for (const form of db.prepare('SELECT name, species_name, slug FROM pokemon_forms WHERE slug = ?').all(reward.pokemonSlug)) {
          eventNames.add(normalize(form.name));
          eventNames.add(normalize(form.species_name));
          eventNames.add(normalize(form.slug));
        }
      }
    }
    return catches.filter((pokemon) =>
      eventNames.has(normalize(pokemon.name))
      || eventNames.has(normalize(pokemon.species_name))
      || eventNames.has(normalize(pokemon.slug))
    );
  }

  if (['megaline', 'megalines'].includes(normalizedPreset)) {
    const megaForms = db.prepare(`
      SELECT species_id, evolution_chain_id, evolution_stage
      FROM pokemon_forms
      WHERE slug LIKE '%-mega%'
    `).all();
    const maxMegaStageByChain = new Map();
    for (const form of megaForms) {
      if (form.evolution_chain_id === null) continue;
      maxMegaStageByChain.set(
        form.evolution_chain_id,
        Math.max(maxMegaStageByChain.get(form.evolution_chain_id) ?? -1, form.evolution_stage)
      );
    }
    return catches.filter((pokemon) =>
      maxMegaStageByChain.has(pokemon.evolution_chain_id)
      && pokemon.evolution_stage < maxMegaStageByChain.get(pokemon.evolution_chain_id)
    );
  }

  return null;
}

function releaseCatchIds(userId, catchIds, { protectFavorites = false } = {}) {
  return db.transaction(() => {
    const released = [];
    const skipped = { locked: 0, inTeam: 0, golden: 0, unsupported: 0 };
    let totalPayout = 0;
    const rotomDrops = [];
    for (const catchId of catchIds) {
      const pokemon = db.prepare(`
        SELECT catches.*,
          (catches.is_fav = 1) AS is_favorite
        FROM catches
        WHERE catches.id = ? AND catches.user_id = ?
      `
      ).get(catchId, userId);
      if (!pokemon) continue;
      if (pokemon.is_locked) {
        skipped.locked += 1;
        continue;
      }
      if (pokemon.in_team) {
        skipped.inTeam += 1;
        continue;
      }
      if (getReleaseProtectionReason(pokemon)) {
        if (pokemon.is_golden) skipped.golden += 1;
        else skipped.unsupported += 1;
        continue;
      }
      if (protectFavorites && (pokemon.is_shiny || pokemon.is_favorite)) {
        skipped.unsupported += 1;
        continue;
      }
      const payout = RELEASE_PAYOUTS[getDisplayRarity(
        pokemon.rarity,
        pokemon.name,
        Boolean(pokemon.is_shiny)
      ).toLowerCase()];
      if (!payout) {
        skipped.unsupported += 1;
        continue;
      }
      const deleted = db.prepare(
        `DELETE FROM catches
         WHERE id = ? AND user_id = ? AND is_locked = 0 AND in_team = 0 AND is_golden = 0`
      ).run(catchId, userId);
      if (!deleted.changes) continue;
      const drops = grantRotomItemDrops(userId, pokemon);
      rotomDrops.push(...drops);
      db.prepare('UPDATE users SET buddy_catch_id = NULL WHERE buddy_catch_id = ?').run(catchId);
      totalPayout += awardCoinsWithBoost(userId, payout).finalAmount;
      released.push(pokemon);
    }
    return { released, skipped, totalPayout, rotomDrops };
  }).immediate();
}

function createReleaseAnnouncement(userId, username, outcome, extra = '') {
  const rarityCounts = new Map();
  for (const pokemon of outcome.released) {
    const rarity = getDisplayRarity(pokemon.rarity, pokemon.name, Boolean(pokemon.is_shiny));
    rarityCounts.set(rarity, (rarityCounts.get(rarity) || 0) + 1);
  }
  const rarityLines = [...rarityCounts].map(([rarity, amount]) =>
    `${getRarityEmojis(rarity)} **${rarity} ${amount}**`
  );
  return {
    embeds: [new EmbedBuilder()
      .setColor(0x2ecc71)
      .setAuthor({ name: `${username} released`, iconURL: getTrainerIconUrl(userId) || undefined })
      .setDescription(
        `${rarityLines.join(', ')}, earning ${EMOJIS.pokecoin} ` +
        `**${outcome.totalPayout.toLocaleString()} PokéCoins**!${extra}`
      )],
  };
}

function getCatchExperienceReward(displayRarity) {
  return {
    Common: 100,
    Uncommon: 250,
    Rare: 400,
    'Super Rare': 1500,
    Legendary: 7500,
    Mega: 7500,
    Gmax: 7500,
    Shiny: 10000,
    'Shiny Mega': 10000,
    'Shiny Gmax': 10000,
    Egg: 2500,
  }[displayRarity] ?? 100;
}

function getFishingTokenReward(displayRarity) {
  return {
    Common: 1,
    Uncommon: 2,
    Rare: 3,
    'Super Rare': 4,
    Legendary: 5,
    Mega: 6,
    Gmax: 7,
    Shiny: 8,
    'Shiny Mega': 9,
    'Shiny Gmax': 10,
  }[displayRarity] ?? 1;
}

function isConfiguredBotAdmin(message) {
  const configuredIds = [...new Set([
    ...(process.env.ADMIN_IDS || process.env.ADMIN_ID || '1514082847609061541')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
  ])];
  return configuredIds.includes(message.author.id);
}

const EXTRA_CHANNEL_BOOSTER_IDS = new Set([
  '1352997432929288194',
  '183625933041827840',
]);
const UNLIMITED_CHANNEL_BOOSTER_IDS = new Set([
  '1514082847609061541',
]);
const EXTRA_WORLD_BOSS_SPAWNER_IDS = new Set([
  '1352997432929288194',
  '183625933041827840',
]);

async function sendPagedEmbeds(message, embeds, label) {
  let page = 0;
  const total = embeds.length;
  const render = () => {
    embeds[page].setFooter({ text: `${label} • Page ${page + 1}/${total}` });
    return embeds[page];
  };
  const buttons = (disabled = false) => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('page_prev').setLabel('Back').setStyle(ButtonStyle.Primary)
      .setDisabled(disabled || page === 0),
    new ButtonBuilder().setCustomId('page_next').setLabel('Next').setStyle(ButtonStyle.Primary)
      .setDisabled(disabled || page === total - 1)
  );
  const sent = await message.reply({ embeds: [render()], components: total > 1 ? [buttons()] : [] });
  if (total <= 1) return sent;
  const collector = sent.createMessageComponentCollector({ componentType: ComponentType.Button, time: 120000 });
  collector.on('collect', async (interaction) => {
    if (interaction.user.id !== message.author.id) {
      return interaction.reply({ content: 'Run the command yourself to browse it.', ephemeral: true });
    }
    page = interaction.customId === 'page_prev' ? Math.max(0, page - 1) : Math.min(total - 1, page + 1);
    await interaction.update({ embeds: [render()], components: [buttons()] });
  });
  collector.on('end', () => {
    sent.edit({ components: [buttons(true)] }).catch(() => {});
  });
  return sent;
}

function isBotAdmin(message) {
  return isConfiguredBotAdmin(message)
    || Boolean(message.member?.permissions.has(PermissionsBitField.Flags.Administrator));
}

function resolvePokemonForm(query) {
  const normalizedName = query.trim().toLowerCase();
  if (/^\d+$/.test(normalizedName)) {
    const requestedNumber = Number(normalizedName);
    const forms = db.prepare(`
      SELECT * FROM pokemon_forms
      ORDER BY species_id, id
    `).all();
    const dexNumbers = getPokemonDexNumbers(forms);
    return forms.find((pokemon) => {
      const numbers = dexNumbers.get(pokemon.id);
      return numbers?.dexNumber === requestedNumber
        || numbers?.shinyDexNumber === requestedNumber;
    }) || null;
  }
  const normalizeName = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalized = normalizeName(normalizedName);
  const forms = findPokemonForms(query, 50);
  return forms.find((pokemon) =>
    normalizeName(pokemon.name) === normalized
    || normalizeName(pokemon.slug) === normalized
  ) || forms.find((pokemon) =>
    normalizeName(pokemon.species_name) === normalized
  ) || null;
}

function getHuntTargetSprite(user) {
  const form = db.prepare('SELECT slug, sprite FROM pokemon_forms WHERE id = ?').get(user.hunt_target_id);
  return form ? getPokemonShowdownSprite(form.slug, false, form.sprite) : null;
}

function getPokemonFormDexNumber(pokemon) {
  const forms = db.prepare(`
    SELECT id, species_id, name, slug, is_default
    FROM pokemon_forms
    ORDER BY species_id, id
  `).all();
  const numbers = getPokemonDexNumbers(forms).get(pokemon.id);
  return numbers?.dexNumber ?? pokemon.species_id;
}

function createWorldBossEmbed(boss, clientUser) {
  const template = WORLD_BOSS_POOL.find((entry) => entry.name === boss.name);
  const leaderboard = getBossLeaderboard();
  const players = db.prepare('SELECT COUNT(*) AS count FROM boss_damage').get().count;
  const totalDamage = db.prepare('SELECT COALESCE(SUM(damage), 0) AS total FROM boss_damage').get().total;
  const progressSize = 18;
  const filled = Math.round(Math.max(0, Math.min(1, boss.current_hp / boss.max_hp)) * progressSize);
  const healthBar = '🟩'.repeat(filled) + '⬛'.repeat(progressSize - filled);
  const topPlayers = leaderboard.length
    ? leaderboard.slice(0, 5).map((row, index) =>
      `**#${index + 1}** <@${row.user_id}> — 💥 DMG: \`${row.damage.toLocaleString()}\``
    ).join('\n')
    : '*No damage dealt yet. Be the first to strike!*';
  const spawnedMs = Date.parse(`${String(boss.spawned_at || '').replace(' ', 'T')}Z`);
  const defeated = boss.current_hp <= 0;
  const bossFormRow = db.prepare('SELECT types FROM pokemon_forms WHERE id = ?')
    .get(template?.formId ?? template?.id);
  const bossTypeLine = bossFormRow ? `• Type: ${formatTypes(JSON.parse(bossFormRow.types))}\n` : '';
  const embed = new EmbedBuilder()
    .setColor(0xf47fb4)
    .setAuthor({
      name: defeated ? 'The World Boss has been defeated!' : 'A World Boss has appeared! Register now!',
      iconURL: 'https://cdn.discordapp.com/emojis/1559925077167054978.png',
    })
    .setDescription(
      `**Boss: ${getRarityEmojis(template?.rarity || 'Legendary', boss.name)} ${boss.name}**\n\n` +
      `Health: ${boss.current_hp.toLocaleString()} / ${boss.max_hp.toLocaleString()} ${EMOJIS.fire || '🔥'}\n` +
      `${healthBar}\n` +
      bossTypeLine.replace('• ', '') +
      `Spawned by: ${boss.spawned_by
        ? `${getTrainerIconEmoji(boss.spawned_by)} **${boss.spawned_by_name || 'Trainer'}**`
        : 'Natural spawn'}\n\n` +
      (Number.isFinite(spawnedMs)
        ? `⚔️ Challenge ${defeated ? 'started' : 'starts'} <t:${Math.floor(spawnedMs / 1000)}:R>`
        : '⚔️ Challenge starts soon') +
      (leaderboard.length
        ? `\n\n🏆 **Top Damage Contributors** (${totalDamage.toLocaleString()} total DMG)\n${topPlayers}`
        : '')
    )
    .setFooter({
      text: `Register for the battle using ${PREFIX}wb fight • Boss id: ${boss.id} • Players: ${players}`,
    })
    .setTimestamp(Number.isFinite(spawnedMs) ? spawnedMs : Date.now());
  if (boss.image_url) embed.setImage(boss.image_url).setThumbnail(template?.icon || boss.image_url);
  return embed;
}

// Personal battle panel shown to each trainer after they pick a Pokémon or use a move.
function createWorldBossPanelEmbed(boss, { state, team, faintedIds, log = [], user }) {
  const template = WORLD_BOSS_POOL.find((entry) => entry.name === boss.name);
  const players = db.prepare('SELECT COUNT(*) AS count FROM boss_damage').get().count;
  const userDamage = db.prepare('SELECT damage FROM boss_damage WHERE user_id = ?').get(user.id)?.damage ?? 0;
  const teamLines = team.map((pokemon) => {
    const isActive = state?.pokemon.id === pokemon.id;
    const savedState = state?.teamStates?.get(pokemon.id);
    const fainted = faintedIds.has(pokemon.id) || (isActive && state.hp <= 0) || savedState?.hp <= 0;
    const hp = fainted
      ? 0
      : isActive
        ? Math.max(0, state.hp)
        : savedState
          ? Math.max(0, savedState.hp)
          : pokemon.max_hp;
    const label = `${pokemon.name} ${hp} / ${pokemon.max_hp}`;
    if (fainted) return `💫 ~~${label}~~ **FNT**`;
    return isActive ? `🟩 **${label}** ⚔️` : `🟩 ${label}`;
  }).join('\n');
  const embed = new EmbedBuilder()
    .setColor(0xf47fb4)
    .setAuthor({ name: `${boss.name} Challenge`, iconURL: boss.image_url || undefined })
    .setDescription(
      `⚔️ ${getRarityEmojis(template?.rarity || 'Legendary', boss.name)} ` +
      `${boss.name}: ${boss.current_hp.toLocaleString()} / ${boss.max_hp.toLocaleString()} HP\n\n` +
      (log.length ? `${log.join('\n')}\n\n` : '') +
      `⚔️ **${user.username}'s Team**\n${teamLines}\n\n` +
      (state && state.hp > 0
        ? 'Choose a move or switch Pokémon. The boss counterattacks after each move.'
        : 'Choose a Pokémon to continue.')
    )
    .setFooter({
      text: `Players in battle: ${players} • Your total DMG dealt: ${userDamage.toLocaleString()}\n` +
        `${boss.name} health: ${boss.current_hp.toLocaleString()} / ${boss.max_hp.toLocaleString()} HP`,
    });
  if (boss.image_url) embed.setImage(boss.image_url).setThumbnail(template?.icon || boss.image_url);
  return embed;
}

function isWorldBossTeamFainted(team, faintedIds, teamStates = new Map()) {
  return team.length > 0 && team.every((pokemon) =>
    faintedIds.has(pokemon.id) || teamStates.get(pokemon.id)?.hp <= 0
  );
}

async function postWorldBossAnnouncement(message, boss) {
  if (!message.guild) {
    throw new Error('World Boss announcements must be started from a server channel.');
  }
  const configuredChannelId = getWorldBossAnnouncementChannel(message.guild.id);
  const channel = configuredChannelId
    ? await message.guild.channels.fetch(configuredChannelId)
    : message.channel;
  return postWorldBossAnnouncementToChannel(message.guild, channel, boss);
}

async function postWorldBossAnnouncementToChannel(guild, channel, boss) {
  if (!channel || !channel.isTextBased() || channel.guildId !== guild.id) {
    throw new Error(`World Boss announcement channel is unavailable in guild ${guild.id}.`);
  }
  const permissions = channel.permissionsFor(guild.members.me);
  if (!permissions?.has([
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.EmbedLinks,
  ])) {
    throw new Error(`Bot cannot send messages and embeds in World Boss channel ${channel.id}.`);
  }
  const pingRole = guild.id === WORLD_BOSS_GUILD_ID ? WORLD_BOSS_PING_ROLE_ID : null;
  const post = await channel.send({
    content: pingRole ? `<@&${pingRole}>` : '',
    allowedMentions: { roles: pingRole ? [pingRole] : [] },
    embeds: [createWorldBossEmbed(boss, client.user)],
  });
  setWorldBossAnnouncementPost(boss.id, guild.id, channel.id, post.id);
  return channel;
}

// Posts the boss in every World Boss server; one failing server does not block the rest.
async function announceWorldBossEverywhere(boss, fallbackMessage = null) {
  const posted = [];
  for (const guildId of WORLD_BOSS_GUILD_IDS) {
    try {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) throw new Error(`World Boss server ${guildId} is unavailable.`);
      const configuredChannelId = getWorldBossAnnouncementChannel(guild.id);
      const channel = configuredChannelId
        ? await guild.channels.fetch(configuredChannelId)
        : fallbackMessage?.guildId === guild.id
          ? fallbackMessage.channel
          : guild.systemChannelId
            ? await guild.channels.fetch(guild.systemChannelId)
            : null;
      posted.push(await postWorldBossAnnouncementToChannel(guild, channel, boss));
    } catch (error) {
      console.error(`Failed to announce World Boss ${boss.id} in guild ${guildId}:`, error);
    }
  }
  return posted;
}

async function updateWorldBossAnnouncement(boss, embed) {
  const embeds = Array.isArray(embed) ? embed : [embed];
  const announcements = getWorldBossAnnouncementPosts(boss.id);
  await Promise.all(announcements.map(async (announcement) => {
    try {
      const channel = await client.channels.fetch(announcement.channel_id);
      if (!channel?.isTextBased() || channel.guildId !== announcement.guild_id) {
        throw new Error(`Saved World Boss announcement channel ${announcement.channel_id} is unavailable.`);
      }
      const post = await channel.messages.fetch(announcement.message_id);
      await post.edit({ content: '', embeds });
    } catch (error) {
      console.error(`Failed to update World Boss announcement for boss ${boss.id}:`, error);
    }
  }));
}

// Posts the result as its own message so it can be forwarded separately from the boss post.
async function postWorldBossResult(boss, embed) {
  const announcements = getWorldBossAnnouncementPosts(boss.id);
  await Promise.all(announcements.map(async (announcement) => {
    try {
      const channel = await client.channels.fetch(announcement.channel_id);
      if (!channel?.isTextBased()) return;
      await channel.send({ embeds: [embed] });
    } catch (error) {
      console.error(`Failed to post World Boss result for boss ${boss.id}:`, error);
    }
  }));
}

function createWorldBossAttackResult(attack, rewards = null) {
  if (attack.defeated) {
    const template = WORLD_BOSS_POOL.find((entry) => entry.name === attack.boss.name);
    const rarityEmojis = getRarityEmojis(template?.rarity || 'Legendary', attack.boss.name);
    const participants = rewards.leaderboard.length;
    const coinsSent = 30000 + (participants - 1) * 12000;
    const itemsSent = 5 + (participants - 1) * 6 + rewards.boxDrops.length;
    const totalDamage = rewards.leaderboard.reduce((total, row) => total + row.damage, 0);
    const spawnedMs = Date.parse(`${String(attack.boss.spawned_at || '').replace(' ', 'T')}Z`);
    const elapsed = Number.isFinite(spawnedMs) ? Math.max(0, Math.round((Date.now() - spawnedMs) / 1000)) : null;
    const duration = elapsed === null
      ? ''
      : ` in ${elapsed >= 3600 ? `${Math.floor(elapsed / 3600)}h ` : ''}${elapsed >= 60 ? `${Math.floor((elapsed % 3600) / 60)}m ` : ''}${elapsed % 60}s`;
    const specialDrops = [
      ...rewards.drops.map((id) =>
        `• <@${id}> ${rarityEmojis} **${attack.boss.name}**! 🎉`
      ),
      ...rewards.boxDrops.map(({ userId, itemName }) =>
        `• <@${userId}> ${BOXES[itemName]?.emoji || (itemName === 'Lootbox' ? LOOTBOX_EMOJI : '📦')} **${itemName}**!`
      ),
    ];
    const drops = specialDrops.length
      ? specialDrops.join('\n')
      : '• *No trainers rolled a Pokémon or box drop this raid.*';
    return new EmbedBuilder()
      .setColor(0xf47fb4)
      .setAuthor({ name: `World Boss Challenge — 🎁 Reward Summary`, iconURL: attack.boss.image_url || undefined })
      .setDescription(
        `👥 ${participants} / ${participants} players qualified for rewards\n` +
        `❤️‍🔥 Total boss health: ${attack.boss.max_hp.toLocaleString()} HP\n` +
        `💥 Total raid damage: ${totalDamage.toLocaleString()} DMG\n` +
        `🎁 Items sent to players: ${itemsSent.toLocaleString()}\n` +
        `${EMOJIS.pokecoin} PokéCoins sent to players: ${coinsSent.toLocaleString()}\n\n` +
        `🎉 **Special loot obtained:**\n${drops}\n` +
        `• All qualified players also received standard rewards.\n\n` +
        `ℹ️ Rewards were sent to your bag automatically!\n\n` +
        `👑 <@${rewards.mvp.user_id}> 💥 **${rewards.mvp.damage.toLocaleString()}** DMG`
      )
      .setThumbnail(attack.boss.image_url)
      .setFooter({ text: `Boss id: ${attack.boss.id} • ${attack.boss.name} was defeated${duration}` });
  }

  return new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle(`⚔️ Raid Hit: ${attack.boss.name}`)
    .setDescription(
      attack.battleLog.join('\n') + '\n\n' +
      `💥 **Move Damage:** \`${attack.damage.toLocaleString()}\`\n` +
      `❤️ **Boss HP:** ${attack.boss.current_hp.toLocaleString()} / ` +
      `${attack.boss.max_hp.toLocaleString()} ` +
      `(${((attack.boss.current_hp / attack.boss.max_hp) * 100).toFixed(1)}%)`
    );
}

function getWorldBossTeamMoves(team) {
  return team.map((pokemon, teamIndex) => {
    const form = db.prepare('SELECT species_id, types FROM pokemon_forms WHERE id = ?')
      .get(pokemon.pokemon_id);
    if (!form) throw new Error(`Missing catalog form ${pokemon.pokemon_id} for team catch ${pokemon.id}.`);
    const moves = getEquippedBattleMoves(pokemon, form.species_id, form.id);
    return {
      pokemon,
      types: JSON.parse(form.types),
      moves,
      teamIndex: pokemon.team_slot - 1,
    };
  });
}

// Re-reads the Pokémon's equipped moves so changes made mid-raid take effect. Returns true if they changed.
function refreshWorldBossMoves(playerState, playerTeam) {
  const fresh = playerTeam.find((entry) => entry.id === playerState.pokemon.id);
  if (!fresh) return false;
  const [member] = getWorldBossTeamMoves([fresh]);
  const sameMoves = member.moves.length === playerState.moves.length
    && member.moves.every((move, index) => move.name === playerState.moves[index].name);
  playerState.pokemon = fresh;
  if (sameMoves) return false;
  playerState.moves = member.moves;
  if (playerState.battle) playerState.battle.mon.moves = member.moves;
  return true;
}

function createWorldBossSelectRows(bossId, team) {
  return [new ActionRowBuilder().addComponents(
    ...team.map((pokemon) => new ButtonBuilder()
      .setCustomId(`worldboss:choose:${bossId}:${pokemon.team_slot}`)
      .setLabel(pokemon.name.slice(0, 80))
      .setStyle(ButtonStyle.Primary))
  )];
}

function createWorldBossPlayerSelectRows(bossId, team, faintedIds = new Set(), teamStates = new Map()) {
  // When the whole team has fainted, keep the buttons clickable: choosing revives the team.
  const allFainted = isWorldBossTeamFainted(team, faintedIds, teamStates);
  const buttons = team
    .filter((pokemon) => {
      const savedState = teamStates.get(pokemon.id);
      return allFainted || (
        !faintedIds.has(pokemon.id)
        && (!savedState || savedState.hp > 0)
      );
    })
    .map((pokemon) => new ButtonBuilder()
    .setCustomId(`worldboss:choose:${bossId}:${pokemon.team_slot}`)
    .setLabel(pokemon.name.slice(0, 80))
    .setStyle(ButtonStyle.Primary));
  if (!buttons.length) {
    buttons.push(new ButtonBuilder()
      .setCustomId(`worldboss:choose:${bossId}:0`)
      .setLabel('No Pokémon available')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true));
  }
  return [new ActionRowBuilder().addComponents(buttons)];
}

function createWorldBossSwitchRows(bossId, team, activePokemonId, faintedIds = new Set()) {
  const switches = team
    .filter((pokemon) => pokemon.id !== activePokemonId && !faintedIds.has(pokemon.id))
    .map((pokemon) => new ButtonBuilder()
      .setCustomId(`worldboss:choose:${bossId}:${pokemon.team_slot}`)
      .setLabel(`Switch to ${pokemon.name}`.slice(0, 80))
      .setStyle(ButtonStyle.Secondary));
  return switches.length ? [new ActionRowBuilder().addComponents(switches)] : [];
}

function createWorldBossPlayerMoveRows(bossId, pokemon, moves) {
  const buttons = moves.map((move, index) => new ButtonBuilder()
    .setCustomId(`worldboss:attack:${bossId}:${pokemon.id}:${index}`)
    .setLabel(move.name.slice(0, 80))
    .setStyle(ButtonStyle.Danger)
    .setEmoji('⚔️'));
  const rows = [];
  for (let index = 0; index < buttons.length; index += 5) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(index, index + 5)));
  }
  return rows;
}

function createWorldBossPlayerEmbed(state, detail = '') {
  const health = Math.max(0, state.hp);
  return makeEmbed(
    `⚔️ ${state.pokemon.name} vs. World Boss`,
    `${detail ? `${detail}\n\n` : ''}` +
    `**Your Pokémon:** ${health > 0 ? '🟩' : '💫'} **${state.pokemon.name}**\n` +
    `❤️ HP: **${health}/${state.pokemon.max_hp}**\n` +
    (health > 0 ? 'Choose one move. The boss counterattacks after each turn.' : 'Choose another Pokémon to continue.'),
    health > 0 ? 0x9b59b6 : 0xe74c3c
  );
}

async function sendCatchbotClaimPages(message, title, pokemon, summary) {
  const entries = pokemon.length
    ? pokemon.map((entry) => formatPokemonReward(entry))
    : ['No catches recorded.'];
  const pages = [];
  for (let offset = 0; offset < entries.length; offset += 20) {
    pages.push(entries.slice(offset, offset + 20));
  }
  let currentPage = 0;
  const pageEmbed = () => makeEmbed(
    title,
    `${currentPage === 0 && summary ? `${summary}\n\n` : ''}${pages[currentPage].join('\n')}`,
    0x2ecc71
  ).setFooter({ text: `Page ${currentPage + 1}/${pages.length} • ${pokemon.length} Pokémon` });
  const pageButtons = () => new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('cbclaim:prev')
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage === 0),
    new ButtonBuilder()
      .setCustomId('cbclaim:next')
      .setLabel('Next')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(currentPage === pages.length - 1)
  );

  const dm = await message.author.send({
    embeds: [pageEmbed()],
    components: pages.length > 1 ? [pageButtons()] : [],
  });
  if (pages.length > 1) {
    const collector = dm.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 15 * 60 * 1000,
    });
    collector.on('collect', async (interaction) => {
      try {
        if (interaction.user.id !== message.author.id) {
          await interaction.reply({ content: 'These CatchBot pages belong to another trainer.', ephemeral: true });
          return;
        }
        if (interaction.customId === 'cbclaim:prev') currentPage = Math.max(0, currentPage - 1);
        else if (interaction.customId === 'cbclaim:next') {
          currentPage = Math.min(pages.length - 1, currentPage + 1);
        }
        await interaction.update({ embeds: [pageEmbed()], components: [pageButtons()] });
      } catch (error) {
        console.error(`Failed to navigate CatchBot claim pages for user ${message.author.id}:`, error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'Could not change the CatchBot results page.', ephemeral: true });
        }
      }
    });
    collector.on('end', async () => {
      try {
        await dm.edit({
          components: [new ActionRowBuilder().addComponents(
            ButtonBuilder.from(pageButtons().components[0]).setDisabled(true),
            ButtonBuilder.from(pageButtons().components[1]).setDisabled(true)
          )],
        });
      } catch (error) {
        console.error(`Failed to close CatchBot claim pages for user ${message.author.id}:`, error);
      }
    });
  }
  return dm;
}

function getWorldBossBattle(playerState, boss) {
  if (!playerState.battle) {
    const template = WORLD_BOSS_POOL.find((entry) => entry.name === boss.name);
    const form = db.prepare('SELECT types FROM pokemon_forms WHERE id = ?').get(template?.formId ?? template?.id);
    if (!template || !form) throw new Error(`Missing World Boss battle data for "${boss.name}".`);
    const pokemon = playerState.pokemon;
    playerState.battle = {
      field: createBattleField(),
      turn: 0,
      mon: {
        name: pokemon.name, hp: playerState.hp, max_hp: pokemon.max_hp, types: playerState.types,
        atk: pokemon.atk, def: pokemon.def, spd: pokemon.spd, moves: playerState.moves,
      },
      boss: {
        name: boss.name, hp: WORLD_BOSS_DUMMY_HP, max_hp: WORLD_BOSS_DUMMY_HP, types: JSON.parse(form.types), moves: null,
        stats: combatStats({
          hp: template.baseHp, attack: template.baseAtk, defense: template.baseDef, speed: template.baseSpd,
        }, Math.max(1, pokemon.level)),
      },
    };
  }
  return playerState.battle;
}

function worldBossCtx(bs, log, turn = bs.turn) {
  return makeBattleCtx(bs.field, log, bs.mon, bs.boss, turn, [bs.mon], []);
}

function runWorldBossMove(userId, team, boss, teamIndex, moveIndex, damageMult = 1) {
  if (!team.length) return { error: 'no_team' };
  const selectedTeamMember = getWorldBossTeamMoves(team)
    .find((teamMember) => teamMember.teamIndex === teamIndex);
  if (!selectedTeamMember) return { error: 'invalid_move' };
  const { pokemon, types, moves } = selectedTeamMember;
  const move = moves[moveIndex];
  if (!move) return { error: 'invalid_move' };
  if (!move.power) return { error: 'status_move', pokemon, move };
  const bossTemplate = WORLD_BOSS_POOL.find((entry) => entry.name === boss.name);
  const bossForm = db.prepare('SELECT types FROM pokemon_forms WHERE id = ?')
    .get(bossTemplate?.formId ?? bossTemplate?.id);
  const bossTypes = bossForm ? JSON.parse(bossForm.types) : [];
  const effectiveness = typeEffectiveness(move.type, bossTypes);
  if (effectiveness === 0) {
    return { error: 'no_effect', pokemon, move };
  }
  const stab = types.includes(move.type) ? 1.5 : 1;
  const isCritical = Math.random() < 0.15;
  const baseDamage = Math.max(
    1,
    Math.floor(
      (pokemon.atk * 3.5 + pokemon.level * 4 + (pokemon.atk_iv || 15))
      * (move.power / 100)
      * effectiveness
      * stab
      * 10
    )
  );
  const damage = Math.max(1, Math.floor((isCritical ? Math.floor(baseDamage * 1.8) : baseDamage) * damageMult));
  const result = applyWorldBossDamage(userId, boss.id, damage);
  if (result.error) return result;
  const battleLog = [
    `**${pokemon.is_shiny ? `${EMOJIS.shiny} ` : ''}${pokemon.name}** used **${move.name}** ` +
    `for **${result.damage.toLocaleString()}** DMG` +
    `${effectiveness > 1 ? ' — super effective!' : effectiveness < 1 ? ' — not very effective.' : ''}` +
    `${stab > 1 ? ' Same-type bonus!' : ''}${isCritical ? ' 💥 *(CRITICAL HIT!)*' : ''}`,
  ];
  const rewards = result.defeated ? distributeWorldBossRewards(boss.id) : null;
  return {
    ...result,
    battleLog,
    damage: result.damage,
    defeated: result.defeated,
    rewards,
    boss: {
      ...result.boss,
      image_url: result.boss.image_url,
      rarity: WORLD_BOSS_POOL.find((entry) => entry.name === result.boss.name)?.rarity || 'Legendary',
    },
  };
}

async function startWorldBossBattle(message, boss, userId, team) {
  const bossMessage = await message.reply({
    embeds: [createWorldBossEmbed(boss, message.client.user)],
    components: createWorldBossSelectRows(boss.id, team),
  });
  const collector = bossMessage.createMessageComponentCollector({
    componentType: ComponentType.Button,
  });
  let raidPosts = activeWorldBossPosts.get(boss.id);
  if (!raidPosts) {
    raidPosts = new Map();
    activeWorldBossPosts.set(boss.id, raidPosts);
  }
  raidPosts.set(bossMessage.id, { message: bossMessage, collector });
  const players = activeWorldBossPlayers.get(boss.id) || new Map();
  activeWorldBossPlayers.set(boss.id, players);
  const faintedPlayers = activeWorldBossFainted.get(boss.id) || new Map();
  activeWorldBossFainted.set(boss.id, faintedPlayers);
  const teamStatesByPlayer = activeWorldBossTeamStates.get(boss.id) || new Map();
  activeWorldBossTeamStates.set(boss.id, teamStatesByPlayer);
  const handler = async (interaction) => {
    try {
      const currentBoss = getActiveWorldBoss();
      if (!currentBoss || currentBoss.id !== boss.id) {
        await interaction.reply({
          content: `This raid is no longer active. Check \`${PREFIX}wb\` for the current World Boss.`,
          ephemeral: true,
        });
        collector.stop('boss-inactive');
        await bossMessage.edit({ components: [] });
        return;
      }
      if (interaction.user.id !== userId) {
        await interaction.reply({
          content: `Run \`${PREFIX}wb fight\` to open a battle panel for your own team.`,
          ephemeral: true,
        });
        return;
      }
      if (getUnclaimedWorldBossReward(userId)) {
        await interaction.reply({
          content: `🎁 Claim your pending World Boss reward with \`${PREFIX}wb claim\` before joining another raid.`,
          ephemeral: true,
        });
        return;
      }
      const parts = interaction.customId.split(':');
      const action = parts[1];
      const playerId = interaction.user.id;
      const playerTeam = getUserTeam(playerId);
      let playerState = players.get(playerId);
      let faintedTeam = faintedPlayers.get(playerId);
      if (!faintedTeam) {
        faintedTeam = new Set();
        faintedPlayers.set(playerId, faintedTeam);
      }
      if (action === 'choose') {
        const teamSlot = Number(parts[3]);
        const pokemon = playerTeam.find((entry) => entry.team_slot === teamSlot);
        if (!pokemon) {
          await interaction.reply({
            content: `❌ You do not have a Pokémon in team slot ${teamSlot}. Use \`${PREFIX}team\` to check your party.`,
            ephemeral: true,
          });
          return;
        }
        const revivedTeam = isWorldBossTeamFainted(
          playerTeam,
          faintedTeam,
          teamStatesByPlayer.get(playerId)
        );
        if (revivedTeam) {
          faintedTeam.clear();
          players.delete(playerId);
          teamStatesByPlayer.delete(playerId);
        }
        if (faintedTeam.has(pokemon.id)) {
          await interaction.reply({
            content: `💫 **${pokemon.name}** has already fainted in this raid. Choose another Pokémon.`,
            ephemeral: true,
          });
          return;
        }
        const switched = playerState?.hp > 0 && playerState.pokemon.id !== pokemon.id;
        if (playerState?.hp > 0) {
          if (playerState.pokemon.id === pokemon.id) {
            refreshWorldBossMoves(playerState, playerTeam);
          } else {
            let teamStates = teamStatesByPlayer.get(playerId);
            if (!teamStates) {
              teamStates = new Map();
              teamStatesByPlayer.set(playerId, teamStates);
            }
            teamStates.set(playerState.pokemon.id, playerState);
            playerState = teamStates.get(pokemon.id);
            if (!playerState) {
              const [member] = getWorldBossTeamMoves([pokemon]);
              if (!member?.moves.length) throw new Error(`${pokemon.name} has no moves available for a World Boss battle.`);
              playerState = {
                pokemon,
                hp: pokemon.max_hp,
                types: member.types,
                moves: member.moves,
                teamStates,
              };
              teamStates.set(pokemon.id, playerState);
            } else {
              playerState.teamStates = teamStates;
              refreshWorldBossMoves(playerState, playerTeam);
            }
            players.set(playerId, playerState);
          }
          const switchPayload = {
            embeds: [createWorldBossPanelEmbed(currentBoss, {
              state: playerState,
              team: playerTeam,
              faintedIds: faintedTeam,
              user: interaction.user,
              log: switched ? [`🔄 Switched to **${playerState.pokemon.name}**.`] : [],
            })],
            components: [
              ...createWorldBossPlayerMoveRows(boss.id, playerState.pokemon, playerState.moves),
              ...createWorldBossSwitchRows(boss.id, playerTeam, playerState.pokemon.id, faintedTeam),
            ],
          };
          // Switching from an existing battle panel edits it instead of posting another.
          if (interaction.message.id === bossMessage.id) await interaction.reply(switchPayload);
          else await interaction.update(switchPayload);
          return;
        }
        let teamStates = teamStatesByPlayer.get(playerId);
        if (!teamStates) {
          teamStates = new Map();
          teamStatesByPlayer.set(playerId, teamStates);
        }
        playerState = teamStates.get(pokemon.id);
        if (!playerState) {
          const [member] = getWorldBossTeamMoves([pokemon]);
          if (!member?.moves.length) throw new Error(`${pokemon.name} has no moves available for a World Boss battle.`);
          playerState = { pokemon, hp: pokemon.max_hp, types: member.types, moves: member.moves, teamStates };
          teamStates.set(pokemon.id, playerState);
        } else {
          playerState.teamStates = teamStates;
          refreshWorldBossMoves(playerState, playerTeam);
        }
        players.set(playerId, playerState);
        const choosePayload = {
          embeds: [createWorldBossPanelEmbed(currentBoss, {
            state: playerState,
            team: playerTeam,
            faintedIds: faintedTeam,
            user: interaction.user,
            log: revivedTeam ? ['✨ Your team fainted and has been revived for the fight!'] : [],
          })],
          components: [
            ...createWorldBossPlayerMoveRows(boss.id, playerState.pokemon, playerState.moves),
            ...createWorldBossSwitchRows(boss.id, playerTeam, playerState.pokemon.id, faintedTeam),
          ],
        };
        if (interaction.message.id === bossMessage.id) await interaction.reply(choosePayload);
        else await interaction.update(choosePayload);
        return;
      }

      const pokemonId = Number(parts[3]);
      const moveIndex = Number(parts[4]);
      if (!playerState || playerState.hp <= 0 || playerState.pokemon.id !== pokemonId) {
        await interaction.reply({
          content: 'Choose an active Pokémon from the World Boss post before attacking.',
          ephemeral: true,
        });
        return;
      }
      // Acknowledge the click first so raid math cannot outlive the 3s interaction window.
      await interaction.deferUpdate();
      if (refreshWorldBossMoves(playerState, playerTeam)) {
        await interaction.followUp({
          content: '🔄 Your moves changed. Pick your Pokémon again from the World Boss post to see the new moves.',
          ephemeral: true,
        });
        return;
      }
      const bs = getWorldBossBattle(playerState, currentBoss);
      const chosenMove = playerState.moves[moveIndex];
      let attack;
      let acted = true;
      const turnLog = [];
      const turnSay = (text) => turnLog.push(text);
      if (chosenMove) {
        bs.turn += 1;
        bs.mon.hp = playerState.hp;
        acted = battleFx.canAct(
          worldBossCtx(bs, turnLog, bs.turn), { mon: bs.mon, side: 'player', move: chosenMove },
          { mon: bs.boss, side: 'enemy', move: chosenMove }, chosenMove, turnSay
        );
        battleFx.fx(bs.mon).lastMove = chosenMove;
      }
      if (chosenMove && (!acted || !chosenMove.power)) {
        // Status moves, or a move the player's Pokémon is prevented from using (sleep, paralysis...).
        if (acted) {
          battleFx.performMove(
            worldBossCtx(bs, turnLog, bs.turn), { mon: bs.mon, side: 'player', move: chosenMove },
            { mon: bs.boss, side: 'enemy', move: chosenMove }, chosenMove, turnSay
          );
          if (bs.mon.sketchedMove) {
            const learned = bs.mon.sketchedMove;
            bs.mon.sketchedMove = null;
            if (recordSketchedMove(playerState.pokemon.id, interaction.user.id, learned)) {
              const slugName = (n) => String(n).toLowerCase().replace(/[^a-z0-9]+/g, '-');
              playerState.moves = playerState.moves.map((mv) => (slugName(mv.name) === 'sketch' ? getPokemonMove(learned) || mv : mv));
              bs.mon.moves = playerState.moves;
            }
          }
        }
        playerState.hp = bs.mon.hp;
        attack = { battleLog: turnLog, defeated: false, boss: currentBoss };
      } else {
        const attackFx = battleFx.fx(bs.mon);
        const bossFx = battleFx.fx(bs.boss);
        const physical = chosenMove?.category !== 'special';
        const wonder = bs.field.wonder > 0;
        const bossDefKey = physical === !wonder ? 'def' : 'spdef';
        const damageMult = chosenMove
          ? (battleFx.stageMult(attackFx.stages[physical ? 'atk' : 'spa']) / battleFx.stageMult(bossFx.stages[bossDefKey]))
            * (attackFx.status === 'brn' && physical ? 0.5 : 1)
          : 1;
        if (chosenMove) { attackFx.protectStreak = 0; attackFx.charge = false; attackFx.laser = false; }
        attack = runWorldBossMove(
          playerId,
          [playerState.pokemon],
          currentBoss,
          playerState.pokemon.team_slot - 1,
          moveIndex,
          damageMult
        );
        if (!attack.error && turnLog.length) attack.battleLog.unshift(...turnLog);
      }
      if (attack.error === 'invalid_move') {
        await interaction.followUp({ content: 'That move is no longer available.', ephemeral: true });
        return;
      }
      if (attack.error === 'status_move') {
        await interaction.followUp({
          content: `**${attack.move.name}** is a status move and can't damage ${currentBoss.name}. Choose a damaging move.`,
          ephemeral: true,
        });
        return;
      }
      if (attack.error === 'no_effect') {
        await interaction.followUp({
          content: `❌ **${attack.move.name}** has no effect on ${currentBoss.name}. Choose a different move.`,
          ephemeral: true,
        });
        return;
      }
      if (attack.error === 'inactive') {
        await interaction.followUp({ content: 'This World Boss is no longer active.', ephemeral: true });
        collector.stop('boss-inactive');
        await bossMessage.edit({ components: [] });
        return;
      }

      if (!attack.defeated && playerState.hp > 0) {
        const template = WORLD_BOSS_POOL.find((entry) => entry.name === currentBoss.name);
        const bossForm = db.prepare('SELECT species_id FROM pokemon_forms WHERE id = ?')
          .get(template?.formId ?? template?.id);
        if (!template || !bossForm) {
          throw new Error(`Missing World Boss battle data for "${currentBoss.name}".`);
        }
        if (!bs.boss.moves) {
          bs.boss.moves = buildEnemyMoves(getSpeciesLearnset(bossForm.species_id, bossForm.id)
            .map((name) => getPokemonMove(name))
            .filter(Boolean));
        }
        if (!bs.boss.moves.length) throw new Error(`${currentBoss.name} has no moves available for its counterattack.`);
        bs.mon.hp = playerState.hp;
        const bossCtx = worldBossCtx(bs, attack.battleLog, bs.turn);
        const bossActor = { mon: bs.boss, side: 'enemy' };
        const playerActor = { mon: bs.mon, side: 'player' };
        const bossMove = chooseEnemyMove(bs.boss, bs.mon, bs.field);
        const bossSay = (text) => attack.battleLog.push(text);
        if (battleFx.canAct(bossCtx, { ...bossActor, move: bossMove }, { ...playerActor, move: bossMove }, bossMove, bossSay)) {
          battleFx.fx(bs.boss).lastMove = bossMove;
          if (!bossMove.power) {
            battleFx.performMove(bossCtx, { ...bossActor, move: bossMove },             { ...playerActor, move: bossMove }, bossMove, bossSay);
          } else if (Math.random() * 100 < bossMove.accuracy) {
            const { atk: bossAtk, def: playerDef } = battleFx.damageStats(bs.boss, bs.mon, bossMove, bs.field);
            const playerSide = bs.field.sides.player;
            const screened = playerSide.veil > 0 || (bossMove.category === 'special' ? playerSide.lightScreen : playerSide.reflect) > 0;
            const counterDamage = Math.max(1, Math.floor(calculateMoveDamage(
              bossMove,
              bossAtk,
              playerDef,
              bs.mon.types
            ) * WORLD_BOSS_COUNTER_DAMAGE_MULTIPLIER * (screened ? 0.5 : 1)));
            const protectedByMove = bs.mon.fx?.protect;
            if (protectedByMove && protectedByMove !== 'endure' && protectedByMove !== 'crafty') {
              attack.battleLog.push(`**${currentBoss.name}** used **${bossMove.name}**, but **${bs.mon.name}** protected itself!`);
            } else {
              playerState.hp = Math.max(protectedByMove === 'endure' ? 1 : 0, playerState.hp - counterDamage);
              bs.mon.hp = playerState.hp;
              attack.battleLog.push(
                `**${currentBoss.name}** counterattacked with **${bossMove.name}** for **${counterDamage}** damage.`
              );
            }
          } else {
            attack.battleLog.push(`**${currentBoss.name}** used **${bossMove.name}**, but missed.`);
          }
        }
        playerState.hp = bs.mon.hp;
        if (playerState.hp > 0) {
          battleFx.endOfTurn(bossCtx);
          playerState.hp = bs.mon.hp;
          // Damage-over-time on the boss (burn, poison, Leech Seed...) is converted into real boss damage.
          const chip = Math.max(0, bs.boss.max_hp - Math.max(0, bs.boss.hp)) * WORLD_BOSS_CHIP_PER_HP;
          bs.boss.hp = bs.boss.max_hp;
          const liveBoss = getActiveWorldBoss();
          if (chip > 0 && liveBoss && liveBoss.current_hp > 1) {
            const applied = applyWorldBossDamage(playerId, boss.id, Math.min(chip, liveBoss.current_hp - 1));
            if (!applied.error) attack.battleLog.push(`${currentBoss.name} took **${applied.damage.toLocaleString()}** damage from status effects.`);
          }
        }
        if (playerState.hp <= 0) {
          attack.battleLog.push(`💫 **${playerState.pokemon.name}** fainted! Choose another Pokémon.`);
          faintedTeam.add(playerState.pokemon.id);
          players.delete(playerId);
        }
      }

      const refreshedBoss = getActiveWorldBoss();
      if (!attack.defeated && refreshedBoss) {
        const progressEmbed = createWorldBossEmbed(refreshedBoss, message.client.user);
        await Promise.all([
          updateWorldBossAnnouncement(refreshedBoss, progressEmbed),
          ...[...raidPosts].map(async ([postId, post]) => {
            try {
              await post.message.edit({ embeds: [progressEmbed] });
            } catch (error) {
              console.error(`Failed to update World Boss post ${postId}:`, error);
            }
          }),
        ]);
      }
      if (attack.defeated) {
        const victoryEmbed = createWorldBossAttackResult(attack, attack.rewards);
        const mvpUserId = attack.rewards.mvp.user_id;
        const mvpUser = await client.users.fetch(mvpUserId);
        const mvpTeam = getUserTeam(mvpUserId);
        const mvpTeamStates = activeWorldBossTeamStates.get(boss.id)?.get(mvpUserId);
        const mvpFaintedIds = activeWorldBossFainted.get(boss.id)?.get(mvpUserId);
        victoryEmbed.addFields({
          name: `MVP's Team — ${mvpUser.username}`,
          value: mvpTeam.length
            ? mvpTeam.map((pokemon) => {
              const teamState = mvpTeamStates?.get(pokemon.id);
              const fainted = mvpFaintedIds?.has(pokemon.id) || teamState?.hp <= 0;
              const hp = fainted ? 0 : teamState ? Math.max(0, teamState.hp) : pokemon.max_hp;
              return `${formatPokemonReward(pokemon)} — ${fainted ? '💫 FNT' : `${hp}/${pokemon.max_hp} HP`}`;
            }).join('\n')
            : '*No active team Pokémon.*',
        });
        const defeatedBossEmbed = createWorldBossEmbed(attack.boss, message.client.user);
        const closedPosts = [...raidPosts];
        await Promise.all([
          updateWorldBossAnnouncement(attack.boss, [defeatedBossEmbed]),
          postWorldBossResult(attack.boss, victoryEmbed),
          interaction.editReply({ embeds: [victoryEmbed], components: [] }),
          ...closedPosts.map(async ([postId, post]) => {
            try {
              await post.message.edit({ embeds: [victoryEmbed], components: [] });
            } catch (error) {
              console.error(`Failed to close defeated World Boss post ${postId}:`, error);
            }
          }),
        ]);
        for (const [postId, post] of closedPosts) {
          activeWorldBossBattles.delete(postId);
          post.collector.stop('boss-defeated');
        }
        activeWorldBossPosts.delete(boss.id);
        for (const key of [...activeWorldBossRaidHandlers.keys()]) {
          if (key.startsWith(`${boss.id}:`)) activeWorldBossRaidHandlers.delete(key);
        }
        activeWorldBossPlayers.delete(boss.id);
        activeWorldBossFainted.delete(boss.id);
        activeWorldBossTeamStates.delete(boss.id);
        return;
      }
      const attackEmbed = createWorldBossPanelEmbed(refreshedBoss || attack.boss, {
        state: playerState,
        team: playerTeam,
        faintedIds: faintedTeam,
        user: interaction.user,
        log: attack.battleLog,
      });
      await interaction.editReply({
        embeds: [attackEmbed],
        components: playerState.hp > 0
          ? [
            ...createWorldBossPlayerMoveRows(boss.id, playerState.pokemon, playerState.moves),
            ...createWorldBossSwitchRows(boss.id, playerTeam, playerState.pokemon.id, faintedTeam),
          ]
          : createWorldBossPlayerSelectRows(
            boss.id,
            playerTeam,
            faintedTeam,
            teamStatesByPlayer.get(playerId)
          ),
      });
    } catch (error) {
      console.error('Failed to process World Boss move:', error);
      await replyToInteractionFailure(
        interaction,
        '❌ The World Boss move could not be processed.',
        'World Boss move'
      );
    }
  };
  activeWorldBossRaidHandlers.set(`${boss.id}:${userId}`, handler);
  activeWorldBossBattles.set(bossMessage.id, handler);
  collector.on('end', async () => {
    activeWorldBossBattles.delete(bossMessage.id);
    raidPosts.delete(bossMessage.id);
    if (activeWorldBossRaidHandlers.get(`${boss.id}:${userId}`) === handler) {
      activeWorldBossRaidHandlers.delete(`${boss.id}:${userId}`);
    }
    if (!raidPosts.size) {
      activeWorldBossPosts.delete(boss.id);
      activeWorldBossPlayers.delete(boss.id);
      activeWorldBossFainted.delete(boss.id);
      activeWorldBossTeamStates.delete(boss.id);
    }
  });
}

function isEventOpen(event, now = Date.now()) {
  return now >= Date.parse(event.startsAt) && now < Date.parse(event.endsAt);
}

// Resolves configured announcement rows (any guild) into channels the bot can post embeds in.
async function resolveAnnouncementChannels(rows) {
  const channels = [];
  for (const { guild_id: guildId, channel_id: channelId } of rows) {
    try {
      const channel = await client.channels.fetch(channelId);
      const permissions = channel?.isTextBased() && channel.guildId === guildId
        ? channel.permissionsFor(client.user)
        : null;
      if (permissions?.has([
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.EmbedLinks,
      ])) channels.push(channel);
      else console.error(`Announcement channel ${channelId} in guild ${guildId} is unavailable.`);
    } catch (error) {
      if (error.code === 10003) {
        console.warn(`Announcement channel ${channelId} in guild ${guildId} no longer exists; skipping.`);
      } else {
        console.error(`Failed to resolve announcement channel ${channelId} in guild ${guildId}:`, error);
      }
    }
  }
  return channels;
}

async function sendToChannels(channels, payload) {
  const results = await Promise.allSettled(channels.map((channel) => channel.send(payload)));
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`Failed to post announcement in channel ${channels[index].id}:`, result.reason);
    }
  });
  return results.some((result) => result.status === 'fulfilled');
}

async function announceEventCatch(guild, user, pokemon, eventCatch) {
  if (!guild || !eventCatch?.added) return;
  const channels = await resolveAnnouncementChannels(getAllEventAnnouncementChannels(halloweenEvent.id));
  if (!channels.length) return;

  try {
    const caughtNames = eventCatch.matches.map((entry) => entry.name).join(', ');
    const embed = new EmbedBuilder()
      .setColor(EVENT_EMBED_COLOR)
      .setTitle(
        `${halloweenEvent.emojis.announcementCatch} ${caughtNames} was just caught by ${user.username}! ` +
        halloweenEvent.emojis.announcementCatch
      )
      .setDescription(
        `${halloweenEvent.emojis.announcementProgress} **${user.username}** has now caught ` +
        `**${eventCatch.progressCount}/${eventCatch.totalCount} Event Pokémon!**`
      )
      .setFooter({ text: halloweenEvent.announcementFooter })
      .setTimestamp();
    const image = getPokemonShowdownSprite(
      pokemon.slug,
      pokemon.isShiny,
      pokemon.isShiny ? (pokemon.shinyImg || pokemon.img) : pokemon.img
    );
    if (image) embed.setThumbnail(image);
    await sendToChannels(channels, { embeds: [embed] });
  } catch (error) {
    console.error(`Failed to announce an event Pokémon catch from guild ${guild.id}:`, error);
  }
}

async function announceEventChecklistCompletion(guild, user, rewardPokemon, progressCount, fallbackChannel = null) {
  if (!guild) return;
  const channels = await resolveAnnouncementChannels(getAllEventAnnouncementChannels(halloweenEvent.id));
  if (!channels.length && fallbackChannel) channels.push(fallbackChannel);
  if (!channels.length) return;

  try {
    const checklistNames = halloweenEvent.pokemon.map((pokemon) => pokemon.name).join(', ');
    const rewardName = `${rewardPokemon.isShiny ? '✨ ' : ''}${rewardPokemon.name}`;
    const endsAtTimestamp = Math.floor(Date.parse(halloweenEvent.endsAt) / 1000);
    const embed = new EmbedBuilder()
      .setColor(EVENT_EMBED_COLOR)
      .setAuthor({
        name: `${user.username} completed the ${halloweenEvent.emojis.event}`,
        iconURL: user.displayAvatarURL(),
      })
      .setTitle(`Event checklist! (${progressCount}/${halloweenEvent.pokemon.length} caught)`)
      .setDescription(
        `${user.username} claimed a ${halloweenEvent.emojis.fullReward} **${rewardName}**!\n\n` +
        `• ${halloweenEvent.emojis.event} Event completed: ${checklistNames}\n\n` +
        `This limited event reward will rotate out <t:${endsAtTimestamp}:R>.`
      )
      .setImage(
        getPokemonShowdownSprite(
          rewardPokemon.slug,
          Boolean(rewardPokemon.isShiny),
          `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/` +
            `${rewardPokemon.isShiny ? 'shiny/' : ''}${rewardPokemon.id}.png`
        )
      )
      .setFooter({ text: halloweenEvent.announcementFooter })
      .setTimestamp();
    await sendToChannels(channels, { embeds: [embed] });
  } catch (error) {
    console.error(`Failed to announce event checklist completion from guild ${guild.id}:`, error);
  }
}

async function announceRareSpawn(guild, user, pokemon) {
  if (!guild || !pokemon) return;
  const eventPokemonKey = getEventPokemonKey(pokemon);
  const rarity = `${pokemon.rarity}`.toLowerCase();
  const isGmax = rarity === 'gmax';
  const isGolden = Boolean(pokemon.isGolden || pokemon.is_golden) || rarity === 'golden';
  if (!eventPokemonKey && rarity !== 'legendary' && !isGmax && !pokemon.isShiny && !isGolden) return;
  const rareChannels = await resolveAnnouncementChannels(getAllRareSpawnAnnouncementChannels());
  if (!rareChannels.length) return;

  try {
    const displayRarity = getDisplayRarity(pokemon.rarity, pokemon.name, Boolean(pokemon.isShiny));
    const rarityEmoji = isGolden ? EMOJIS.golden : getRarityEmojis(displayRarity);
    const shinyPrefix = isGolden ? 'Golden ' : pokemon.isShiny ? 'Shiny ' : '';
    const count = db.prepare(`
      SELECT COUNT(*) AS count FROM (
        SELECT id FROM catches WHERE pokemon_id = ? AND is_shiny = ? AND is_golden = ?
        UNION ALL
        SELECT id FROM market WHERE pokemon_id = ? AND is_shiny = ?
      )
    `).get(
      pokemon.id,
      pokemon.isShiny ? 1 : 0,
      isGolden ? 1 : 0,
      pokemon.id,
      pokemon.isShiny ? 1 : 0
    ).count;
    const embed = new EmbedBuilder()
      .setColor(eventPokemonKey || isGmax
        ? EVENT_EMBED_COLOR
        : isGolden ? 0xf1c40f : pokemon.isShiny
          ? RARITY_COLORS.shiny
          : getRarityColor(pokemon.rarity, pokemon.name))
      .setAuthor({
        name: `${client.user.username} Global Rare Spawns`,
        iconURL: client.user.displayAvatarURL(),
      })
      .setTitle(
        `🎉 ${getRareSpawnNameHidden(user.id) ? 'somebody' : user.username} has found a ` +
        `${rarityEmoji} ${shinyPrefix}${pokemon.name}!`
      )
      .setFooter({
        text: `There's now ${count.toLocaleString()} ${shinyPrefix}${pokemon.name}${pokemon.name.endsWith('s') ? '' : 's'} in-game • Today at ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}`,
      })
      .setTimestamp();
    const image = isGolden
      ? getGoldenSpriteUrl(pokemon.species_id ?? pokemon.id, pokemon.slug)
      : getPokemonShowdownSprite(
        pokemon.slug,
        Boolean(pokemon.isShiny),
        pokemon.isShiny ? (pokemon.shinyImg || pokemon.img) : pokemon.img
      );
    if (image) embed.setImage(image);
    if (!await sendToChannels(rareChannels, { embeds: [embed] })) {
      throw new Error('No rare-spawn channel accepted the announcement.');
    }
  } catch (error) {
    console.error(`Failed to forward rare Pokémon catch from guild ${guild.id}:`, error);
  }
}

async function sendRareSpawnChannelEmbed(guild, embed) {
  if (!guild) return false;
  const channelId = getRareSpawnAnnouncementChannel(guild.id);
  if (!channelId) return false;
  const channels = await resolveAnnouncementChannels([{ guild_id: guild.id, channel_id: channelId }]);
  if (!channels.length) return false;
  return sendToChannels(channels, { embeds: [embed] });
}

async function announcePromoItemFound(guild, user, promo, source, newTotal) {
  const sourceLabel = { catch: 'Pokémon catch', fish: 'Fishing catch', battle: 'Battle', egg: 'Egg hatch' }[source] || source;
  const drop = promo.drops?.[source];
  const rateText = drop && Number.isSafeInteger(Number(drop.oneIn))
    ? `1/${Number(drop.oneIn).toLocaleString()}`
    : 'rare';
  const embed = new EmbedBuilder()
    .setColor(RARITY_COLORS.golden)
    .setAuthor({
      name: `${client.user.username} Promo Item — ${sourceLabel}`,
      iconURL: client.user.displayAvatarURL(),
    })
    .setDescription(
      `${promo.itemEmoji} **${user.username}** just found a ${promo.itemEmoji} **${promo.itemName}**!\n\n` +
      `• ${source === 'fish' ? EMOJIS.fishingtoken : EMOJIS.pokeball} Source: **${sourceLabel}**\n` +
      `• ${promo.itemEmoji} Current total: **${newTotal}x**\n` +
      `• 🎁 Collect **${promo.costItems}** of them and type ${PREFIX}promo claim to redeem a ${EMOJIS.golden} **${promo.name}**!`
    )
    .setThumbnail(promo.img)
    .setFooter({
      text: `Collect ${promo.costItems} ${promo.itemName}s to redeem a ${promo.name}! • Promo rate: ${rateText}`,
    })
    .setTimestamp();
  return sendRareSpawnChannelEmbed(guild, embed);
}

// Promo drop odds scale with active server incense and the Patreon golden perk.
function getPromoChanceMultiplier(userId, incenseActive) {
  const clanPromoBonus = getClanPerkMultipliers(getPlayerClan(userId)).prBonus;
  return (incenseActive ? INCENSE_BOOST : 1)
    * (1 + getPatreonPerks(userId).goldenBoost)
    * (1 + clanPromoBonus / 100);
}

// Battles and egg hatches roll promo drops too; one server incense charge is used (for +10%)
// only while an active promo drops from that activity.
async function rollActivityPromoDrops(user, guild, channel, source) {
  try {
    const promos = getActivePromos().filter((promo) => promo.drops?.[source] && promo.drops[source].enabled !== false);
    if (!promos.length) return;
    const incenseActive = Boolean(guild) && consumeIncenseCharge(guild.id);
    const multiplier = getPromoChanceMultiplier(user.id, incenseActive);
    const verb = { battle: 'battling', egg: 'hatching an Egg' }[source] || source;
    for (const promo of promos) {
      if (!rollPromoItemDrop(promo, source, multiplier)) continue;
      addUserItem(user.id, promo.itemName, 1);
      const newTotal = db.prepare(
        'SELECT amount FROM user_items WHERE user_id = ? AND item_name = ?'
      ).get(user.id, promo.itemName)?.amount || 1;
      await channel?.send(
        `${promo.itemEmoji} <@${user.id}>, while ${verb} you discovered a rare ` +
        `**${promo.itemName}**! Check your progress with \`${PREFIX}promo\`.`
      ).catch(() => {});
      await announcePromoItemFound(guild, user, promo, source, newTotal);
    }
  } catch (error) {
    console.error(`Failed to roll ${source} promo drops:`, error);
  }
}

async function announcePromoClaim(guild, user, promo) {
  const embed = new EmbedBuilder()
    .setColor(RARITY_COLORS.golden)
    .setAuthor({
      name: `${client.user.username} Special Golden Promotionals`,
      iconURL: client.user.displayAvatarURL(),
    })
    .setDescription(
      `**${user.username}** spent ${EMOJIS.pokecoin} **${promo.costCoins.toLocaleString()}** and **${promo.costItems}x ${promo.itemEmoji}**!\n` +
      `**${user.username}** claimed a ${EMOJIS.golden} **${promo.name}**!`
    )
    .setImage(promo.img)
    .setFooter({ text: `Current Promo leaves on: ${promo.endsAtFooter}` })
    .setTimestamp();
  return sendRareSpawnChannelEmbed(guild, embed);
}

function createEventLinkRow(event) {
  const links = [
    { label: 'Support for Perks', url: event.links?.support },
    { label: 'Gift a Subscription', url: event.links?.gift },
  ].filter(({ url }) => {
    if (typeof url !== 'string') return false;
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'http:';
    } catch {
      return false;
    }
  });

  if (!links.length) return null;
  return new ActionRowBuilder().addComponents(
    ...links.map(({ label, url }) =>
      new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url)
    )
  );
}

function processQuestProgress(userId, type) {
  incrementUser(userId, { [type === 'catch' ? 'cl_catches' : 'cl_fishes']: 1 });
}

function rollChecklistRewards() {
  const coins = 5000 + Math.floor(Math.random() * 5001);
  const roll = Math.random();
  let bonus;
  if (roll < 0.3) {
    bonus = { field: 'lootboxes', min: 1, max: 3, emoji: '📦', name: 'Lootboxes' };
  } else if (roll < 0.55) {
    bonus = {
      field: 'rare_candies',
      min: 2,
      max: 5,
      emoji: EMOJIS.rarecandy,
      name: 'Rare Candies',
    };
  } else if (roll < 0.75) {
    bonus = {
      field: 'fishing_tokens',
      min: 25,
      max: 75,
      emoji: EMOJIS.fishingtoken,
      name: 'Fishing Tokens',
    };
  } else if (roll < 0.95) {
    bonus = {
      field: 'ultraballs',
      min: 5,
      max: 15,
      emoji: EMOJIS.ultraball,
      name: 'Ultra Balls',
    };
  } else {
    bonus = {
      field: 'masterballs',
      min: 1,
      max: 1,
      emoji: EMOJIS.masterball,
      name: 'Masterball',
    };
  }

  const amount = bonus.min + Math.floor(Math.random() * (bonus.max - bonus.min + 1));
  return {
    increments: { [bonus.field]: amount },
    coins,
    description:
      `• ${bonus.emoji} **${amount}** ${bonus.name}`,
  };
}

const FUN_ITEM_EMOJIS = {
  Candy: '🍬',
  Lollipop: '🍭',
  'Chocolate Bar': '🍫',
  Broccoli: '🥦',
  Cupcake: '🧁',
  'Gingerbread': '<:gingerbread_cookie:1560661577378832545>',
  'Sitrus Berry': '<:sitrusberry:1560662054447087687>',
  'Candy Cane': '<:candy_cane:1560660203572043816>',
};

function formatQuestRewards(quest) {
  const rewards = [];
  if (quest.reward_lootboxes > 0) rewards.push(`${quest.reward_lootboxes}x ${LOOTBOX_EMOJI}`);
  if (quest.reward_candies > 0) rewards.push(`${quest.reward_candies}x ${EMOJIS.rarecandy}`);
  if (quest.reward_masterballs > 0) rewards.push(`${quest.reward_masterballs}x ${EMOJIS.masterball}`);
  if (quest.reward_ultraballs > 0) rewards.push(`${quest.reward_ultraballs}x ${EMOJIS.ultraball}`);
  if (quest.reward_grazz > 0) rewards.push(`${quest.reward_grazz}x ${EMOJIS.goldenRazz}`);
  const itemEmojis = {
    Pokeball: EMOJIS.pokeball,
    Greatball: EMOJIS.greatball,
    Ultraball: EMOJIS.ultraball,
    Premierball: EMOJIS.premierball,
    Diveball: EMOJIS.diveball,
    Masterball: EMOJIS.masterball,
    Lootbox: LOOTBOX_EMOJI,
    'Rare Candy': EMOJIS.rarecandy,
    'Golden Razz': EMOJIS.goldenRazz,
    'Fishing Token': EMOJIS.fishingtoken,
    Repel: EMOJIS.repel,
    'Super Repel': EMOJIS.superRepel,
    'Max Repel': EMOJIS.maxRepel,
    Honey: EMOJIS.honey,
    Incense: EMOJIS.incense,
    Pokeradar: EMOJIS.pokeradar,
    'Boss Coin': EMOJIS.bosscoin,
    'Poké Lure': EMOJIS.pokeLure,
    "Misty's Lure": EMOJIS.mistysLure,
    'Swap Ticket': '🎟️',
    ...FUN_ITEM_EMOJIS,
  };
  const questItems = typeof quest.reward_items === 'string'
    ? JSON.parse(quest.reward_items)
    : quest.reward_items || {};
  for (const [name, amount] of Object.entries(questItems)) {
    const normalizedName = name.toLowerCase().replace(/[^a-z]/g, '');
    const emoji = normalizedName === 'pokelure'
      ? EMOJIS.pokeLure
      : normalizedName === 'mistyslure'
        ? EMOJIS.mistysLure
        : itemEmojis[name] || '📦';
    rewards.push(`${amount}x ${emoji} ${name}`);
  }
  rewards.push(`${EMOJIS.pokecoin} ${quest.reward_coins.toLocaleString()}`);
  return rewards.join(', ');
}

function announceQuestCompletions(userId, channel, completedQuests) {
  for (const quest of completedQuests) {
    channel.send(
      `🎉 <@${userId}> completed **Quest #${quest.slot}**!\n` +
      `💰 **Rewards claimed:** ${formatQuestRewards({
        reward_lootboxes: quest.reward_lootboxes,
        reward_candies: quest.reward_candies,
        reward_masterballs: quest.reward_masterballs,
        reward_ultraballs: quest.reward_ultraballs,
        reward_grazz: quest.reward_grazz,
        reward_items: quest.reward_items,
        reward_coins: quest.reward_coins,
      })}\n` +
      `⏳ A new quest for this slot will be available <t:${Math.floor(quest.refresh_at / 1000)}:R>.`
    ).catch((error) => {
      console.error(`Failed to announce quest ${quest.slot} completion for user ${userId}:`, error);
    });
  }
}

function formatQuestObjective(quest) {
  if (quest.quest_type === 'encounter_type') {
    return `Encounter **${quest.target} ${getTypeEmoji(quest.target_type)} ${quest.target_type} Pokémon** in the wild`;
  }
  if (quest.quest_type === 'encounter_amount') {
    return `Encounter **${quest.target} Pokémon** in the wild`;
  }
  if (quest.quest_type === 'catch_type') {
    return `Catch **${quest.target} ${getTypeEmoji(quest.target_type)} ${quest.target_type} Type Pokémon**`;
  }
  if (quest.quest_type === 'catch_rarity') {
    return `Catch **${quest.target} ${quest.target_type} Pokémon**`;
  }
  if (quest.quest_type === 'catch_amount') {
    return `Catch **${quest.target} Pokémon**`;
  }
  if (quest.quest_type === 'fish_amount') {
    return `Catch **${quest.target} Pokémon while fishing**`;
  }
  if (quest.quest_type === 'battle_wins') {
    return `Win **${quest.target} battle${quest.target === 1 ? '' : 's'}**`;
  }
  if (quest.quest_type === 'fishing_condition') {
    const conditions = {
      poke_lure: `with a ${EMOJIS.pokeLure} Poké Lure active`,
      mistys_lure: `with ${EMOJIS.mistysLure} Misty's Lure active`,
      both_lures: `with both ${EMOJIS.pokeLure} Poké Lure and ${EMOJIS.mistysLure} Misty's Lure active`,
      event_exclusive: 'of an event-exclusive Pokémon',
      shiny: 'of a Shiny Pokémon',
      golden: 'of a Golden Pokémon',
    };
    return `Fish and catch **${quest.target} Pokémon ${conditions[quest.target_type] || quest.target_type}**`;
  }
  if (quest.quest_type === 'battle_category') {
    const categories = {
      gym_leader: 'Gym Leader',
      elite_four: 'Elite Four Trainer',
      champion: 'Champion',
      mega_chamber: 'Mega Chamber',
      basic_challenger: 'Basic Challenger',
      boss_challenger: 'Boss Challenger',
      master_challenger: 'Master Challenger',
      battle_icon: 'battle icon',
    };
    const label = categories[quest.target_type] || quest.target_type;
    return quest.target_type === 'battle_icon'
      ? `Obtain **${quest.target} ${label}${quest.target === 1 ? '' : 's'}**`
      : `Defeat **${quest.target} ${label}${quest.target === 1 ? '' : 's'}**`;
  }
  if (quest.quest_type === 'battle_tower_floors') {
    return `Defeat **${quest.target} Battle Tower floors**`;
  }
  if (quest.quest_type === 'collect_item') {
    const emoji = FUN_ITEM_EMOJIS[quest.target_type];
    return `Collect **${quest.target}** ${emoji ? `${emoji} ` : ''}**${quest.target_type}${quest.target === 1 ? '' : 's'}**`;
  }
  if (quest.quest_type === 'collect_item_any') {
    const items = quest.target_type.split('|').map((name) => {
      const emoji = FUN_ITEM_EMOJIS[name.trim()];
      return `${emoji ? `${emoji} ` : ''}${name.trim()}`;
    });
    return `Collect **${quest.target}** of any: ${items.join(', ')}`;
  }
  throw new Error(`Unsupported quest type "${quest.quest_type}".`);
}

function countQuestTypes(pokemonList) {
  const counts = {};
  for (const pokemon of pokemonList) {
    const types = Array.isArray(pokemon.types) ? pokemon.types : pokemon.type ? [pokemon.type] : [];
    for (const type of types) counts[type] = (counts[type] || 0) + 1;
  }
  return counts;
}

function countQuestRarities(pokemonList) {
  const counts = {};
  for (const pokemon of pokemonList) {
    const rarity = getDisplayRarity(pokemon.rarity, pokemon.name, pokemon.isShiny);
    counts[rarity] = (counts[rarity] || 0) + 1;
  }
  return counts;
}

let inlineEncounterCounter = 0;

function makeInlineCollector(timeMs) {
  const emitter = new EventEmitter();
  let ended = false;
  let timer = null;
  const collector = {
    on: (event, listener) => { emitter.on(event, listener); return collector; },
    stop: (reason = 'user') => {
      if (ended) return;
      ended = true;
      if (timer) clearTimeout(timer);
      emitter.emit('end', [], reason);
    },
  };
  if (timeMs > 0) timer = setTimeout(() => collector.stop('time'), timeMs);
  return collector;
}

// Lets askForBall run an encounter inside an existing message (e.g. .explore) instead of sending its own embed.
function makeInlineEncounterHost(onEdit) {
  inlineEncounterCounter += 1;
  return {
    id: `inline-encounter-${inlineEncounterCounter}`,
    edit: async (payload) => {
      const firstLine = payload.embeds?.[0]?.data?.description?.split('\n')[0] || '';
      const text = [firstLine, payload.content].filter(Boolean).join('\n');
      await onEdit(text, payload);
    },
  };
}

async function askForBall(
  message,
  userId,
  target,
  mode,
  {
    guaranteedCatch = false,
    timeoutMs = 20000,
    onHandler = null,
    inline = null,
    counterSource = null,
  } = {}
) {
  guaranteedCatch = guaranteedCatch && !GUARANTEED_CATCH_EXCLUDED_USER_IDS.has(userId);
  target = {
    ...target,
    name: target.name.replace(/\btotem\b/gi, '').replace(/\s+/g, ' ').trim(),
  };
  const user = getUser(userId);
  incrementUser(userId, { wild_encounters: 1 });
  const completedQuests = advanceQuestProgress(
    userId,
    {
      encounters: 1,
      encounterTypes: Array.isArray(target.types)
        ? target.types
        : target.type ? [target.type] : [],
    }
  );
  const isFishing = mode === 'fish';
  if (counterSource) recordWildEncounterCounter(userId, counterSource);
  const catchDisplayRarity = getDisplayRarity(target.rarity, target.name, target.isShiny);
  const rarityData = getRarityInfo(
    target.rarity,
    catchDisplayRarity,
    target.isShiny,
    target.isEventShiny,
    target.encounterRateText
  );
  const clanPerks = getClanPerkMultipliers(getPlayerClan(userId));
  const ninjaBonus = getPatreonPerks(userId).catchBoost;
  const channelCatchRateBoost = getChannelCatchRateBoost(userId, message.guildId, message.channelId);
  const catchRateText = mode === 'catch'
    ? ''
    : `**Catch chance:** ${['pb', 'gb', 'ub', 'prb', 'mb', ...(isFishing ? ['dv'] : [])].map((key) => {
      const ball = BALL_CONFIG[key];
      const chance = guaranteedCatch || key === 'mb'
        ? 100
        : getBallCatchRate(key, ball, target, catchDisplayRarity, rarityData.catchChance, clanPerks.crBonus + ninjaBonus,         channelCatchRateBoost);
              return `${ball.emoji} ${Math.round(chance)}%`;
            }).join(' • ')}\n`;
  const tracksRarityStreak = !NON_STREAK_RARITIES.has(catchDisplayRarity.toLowerCase());
  const currentStreak = tracksRarityStreak
    ? getUserRarityStreak(userId, catchDisplayRarity)
    : null;
  const trainerLabel = `${getTrainerIconEmoji(userId)} **${message.author.username}**`;
  const embed = new EmbedBuilder()
    .setColor(isEventOpen(halloweenEvent) && isEventChecklistSpawn(target)
      ? EVENT_EMBED_COLOR
      : getRarityColor(target.rarity, target.name, target.isShiny))
    .setTitle(
      isFishing
        ? `🎣 A wild Pokémon appeared!`
        : `${ICONS.grass} A wild Pokémon appeared!`
    )
    .setDescription(
      `${trainerLabel} found a wild **${target.name}**!\n` +
      `${isFishing ? `🎣 Rod used: **${user.fish_rods}**\n` : ''}` +
      `\n**${getRarityEmojis(catchDisplayRarity)} ${catchDisplayRarity} ` +
      `(${rarityData.rateText})**\n` +
      catchRateText +
      `${Array.isArray(target.types) && target.types.length ? `Type: ${formatTypes(target.types)}\n` : ''}` +
      `${tracksRarityStreak ? `${catchDisplayRarity} catches: ${currentStreak}\n` : ''}` +
      `\n═══════ Balls left ═══════\n` +
      `Pokéballs: ${user.pokeballs} • Greatballs: ${user.greatballs}\n` +
      `Ultraballs: ${user.ultraballs} • Masterballs: ${user.masterballs}\n` +
      `Premierballs: ${user.premierballs}` +
      `${isFishing ? `\nDiveballs: ${user.diveballs}` : ''}`
    );
  const image = getPokemonShowdownSprite(
    target.slug,
    target.isShiny,
    target.isShiny ? (target.shinyImg || target.img) : target.img
  );
  if (image) embed.setImage(image);
  const ballEntries = Object.entries(BALL_CONFIG)
    .filter(([, ball]) => !ball.fishingOnly || isFishing);
  const ballRows = [];
  for (let i = 0; i < ballEntries.length; i += 5) {
    ballRows.push(new ActionRowBuilder().addComponents(
      ...ballEntries.slice(i, i + 5).map(([key, ball]) =>
        new ButtonBuilder().setCustomId(`catch:${key}`).setEmoji(ball.buttonEmoji).setStyle(ButtonStyle.Secondary)
      )
    ));
  }
  const spawnMessage = inline
    ? makeInlineEncounterHost(inline.onEdit)
    : await message.channel.send({
      embeds: [embed],
      components: ballRows,
    });

  const buttonCollector = inline
    ? makeInlineCollector(timeoutMs)
    : spawnMessage.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: timeoutMs,
    });
  const textCollector = inline
    ? makeInlineCollector(0)
    : message.channel.createMessageCollector({
      filter: (response) => response.author.id === userId
        && Object.hasOwn(BALL_CONFIG, response.content.toLowerCase())
        && (isFishing || !BALL_CONFIG[response.content.toLowerCase()].fishingOnly),
      time: timeoutMs,
      max: 1,
    });
  announceQuestCompletions(userId, message.channel, completedQuests);
  let actionTaken = false;
  activeCatchEncounters.set(spawnMessage.id, async (interaction) => {
    const selectedBall = interaction.customId.split(':')[1];
    const validBall = Object.hasOwn(BALL_CONFIG, selectedBall)
      && (isFishing || !BALL_CONFIG[selectedBall].fishingOnly);
    const reserved = interaction.user.id === userId && validBall && !actionTaken;
    if (reserved) actionTaken = true;
    try {
      if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
      if (interaction.user.id !== userId) {
        await interaction.followUp({ content: 'This is not your Pokémon encounter.', ephemeral: true });
        return;
      }
      if (!validBall) {
        await interaction.followUp({ content: 'That ball is not available.', ephemeral: true });
        return;
      }
      if (!reserved) {
        await interaction.followUp({ content: 'This encounter has already ended.', ephemeral: true });
        return;
      }
      await handleCatch(selectedBall, interaction, true);
    } catch (error) {
      if (isInteractionAlreadyAcknowledgedOrExpired(error)) return;
      console.error('Failed to process catch-button interaction:', error);
      await replyToInteractionFailure(
        interaction,
        '❌ The encounter could not be processed.',
        'catch-button processing'
      );
      actionTaken = true;
      buttonCollector.stop('error');
      textCollector.stop('error');
      try {
        await spawnMessage.edit({
          content: '❌ This encounter could not be processed. Please try again.',
          embeds: [],
          components: [],
        });
      } catch (editError) {
        console.error('Failed to close catch encounter after processing error:', editError);
      }
    }
  });

  if (onHandler) onHandler(activeCatchEncounters.get(spawnMessage.id));

  async function handleCatch(selectedBall, interaction = null, reserved = false) {
    if (actionTaken && !reserved) {
      if (interaction) {
        await interaction.followUp({ content: 'This encounter has already ended.', ephemeral: true });
      }
      return;
    }
    if (!reserved) actionTaken = true;
    const ball = BALL_CONFIG[selectedBall];
    const used = db.transaction(() => {
      const liveUser = getUser(userId);
      if (liveUser[ball.column] <= 0) return false;
      incrementUser(userId, {
        [ball.column]: -1,
        ...(ball.usageColumn ? { [ball.usageColumn]: 1 } : {}),
      });
      return true;
    }).immediate();
    if (!used) {
      const errorText = `❌ You don't have any **${ball.name}s** left!`;
      try {
        if (interaction) await interaction.followUp({ content: errorText, ephemeral: true });
        else await message.channel.send(errorText);
      } finally {
        actionTaken = false;
      }
      return;
    }

    buttonCollector.stop('resolved');
    textCollector.stop('resolved');
    const playerRoll = Math.random() * 100;
    const targetRate = guaranteedCatch
      ? 100
      : getBallCatchRate(selectedBall, ball, target, catchDisplayRarity,       rarityData.catchChance, clanPerks.crBonus + ninjaBonus, channelCatchRateBoost);
    const isSuccess = guaranteedCatch || selectedBall === 'mb' || playerRoll < targetRate;
    const baseCoinsEarned = getCatchCoinReward(target.rarity, Boolean(target.isShiny));
    const getRemainingBalls = () => {
      const remainingUser = getUser(userId);
      const ballCounts = Object.entries(BALL_CONFIG)
        .filter(([, configuredBall]) => isFishing || !configuredBall.fishingOnly)
        .map(([, configuredBall]) => `${configuredBall.name}s: ${remainingUser[configuredBall.column]}`);
      return [
        ballCounts.slice(0, 2).join(' • '),
        ballCounts.slice(2).join(' • '),
      ].join('\n');
    };

    if (!isSuccess) {
      resetRarityStreaks(userId, catchDisplayRarity);
      const fledEmbed = new EmbedBuilder()
        .setColor(isEventOpen(halloweenEvent) && isEventChecklistSpawn(target)
          ? EVENT_EMBED_COLOR
          : getRarityColor(target.rarity, target.name, target.isShiny))
        .setAuthor({
          name: `${message.author.username} used a ${ball.name}!`,
          iconURL: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/${ball.image}`,
        })
        .setDescription(
          `${getRarityEmojis(catchDisplayRarity)} ` +
          `**${target.name}** broke out of the ${ball.emoji} **${ball.name}**!\n\n` +
          `**Rarity:** ${catchDisplayRarity} (${rarityData.rateText})\n\n` +
          `Pokémon roll: **${Math.round(playerRoll)}**\n` +
          `Your catch rate: **${Math.round(targetRate)}%**\n\n` +
          '═══════ Balls left ═══════\n' +
          `${getRemainingBalls()}`
        );
      const fledImage = getPokemonShowdownSprite(
        target.slug,
        target.isShiny,
        target.isShiny ? (target.shinyImg || target.img) : target.img
      );
      if (fledImage) fledEmbed.setImage(fledImage);
      await spawnMessage.edit({ content: '', embeds: [fledEmbed], components: [] });
      return;
    }

    const { finalAmount: coinsEarned } = awardCoinsWithBoost(userId, baseCoinsEarned);
    const quickHandsPct = getPatreonPerks(userId).quickHands;
    let ballSaved = false;
    if (quickHandsPct > 0 && Math.random() < quickHandsPct) {
      incrementUser(userId, { [ball.column]: 1 });
      ballSaved = true;
    }
    const remainingBalls = getRemainingBalls();
    const isNewDexEntry = !db.prepare(`
      SELECT 1
      FROM catches
      WHERE user_id = ? AND pokemon_id = ? AND is_shiny = ? AND is_golden = ?
      LIMIT 1
    `).get(userId, target.id, target.isShiny ? 1 : 0, target.isGolden ? 1 : 0);
    saveCatch(userId, target, Boolean(target.isShiny), true, Boolean(target.isGolden));
    if (!guaranteedCatch) recordDailyCatch(userId, message.author.username);
    const resetCounterCategories = counterSource
      ? resetEncounterCounters(
        userId,
        counterSource,
        [
          ...(String(target.rarity).toLowerCase() === 'legendary' ? ['legendary'] : []),
          ...(target.isShiny ? ['shiny'] : []),
        ],
        target.name
      )
      : [];
    advanceEggCatchProgress(userId);
    // Onyx clan perk: eggs hatch 2x faster (extra progress on every catch).
    if (getClanPerkMultipliers(getPlayerClan(userId)).eggHatchBonus > 0) advanceEggCatchProgress(userId);
    const eggPerks = getPatreonPerks(userId);
    if (eggPerks.eggHatchSpeed > 0 && Math.random() < eggPerks.eggHatchSpeed) advanceEggCatchProgress(userId);
    if (eggPerks.autoEquipEggs) {
      const eggUser = getUser(userId);
      if (eggUser.held_egg_target <= 0 && eggUser.vote_eggs > 0) {
        holdEgg(userId, getEggCatchTarget(userId));
      }
    }
    let ancientFossilDropText = '';
    if (Math.random() < 1 / 10000) {
      addUserItem(userId, 'Ancient Fossil');
      ancientFossilDropText = '\n🦴 You found an **Ancient Fossil**!';
    }
    let huntRewardText = '';
    if (!isFishing) {
      const huntProgress = recordDailyHuntCatch(userId, target);
      if (huntProgress?.outcome === 'chance_missed') {
        huntRewardText =
          `\n🎯 Daily Hunt: the ${target.rarity} progress roll missed ` +
          `(${formatPercent(huntProgress.chance)} chance; ${huntProgress.progress}/${huntProgress.required}).`;
      } else if (huntProgress?.outcome === 'progress') {
        huntRewardText =
          `\n🎯 Daily Hunt progress: ${huntProgress.progress}/${huntProgress.required} ` +
          `${target.rarity} (${formatPercent(huntProgress.chance)} progress chance).`;
      } else if (huntProgress?.outcome === 'completed') {
        const ballRewards = [
          ['pokeballs', EMOJIS.pokeball, 'Pokéball'],
          ['greatballs', EMOJIS.greatball, 'Greatball'],
          ['ultraballs', EMOJIS.ultraball, 'Ultraball'],
          ['premierballs', EMOJIS.premierball, 'Premierball'],
          ['masterballs', EMOJIS.masterball, 'Masterball'],
        ].filter(([field]) => huntProgress.rewards[field] > 0)
          .map(([field, emoji, name]) => `${emoji} ${huntProgress.rewards[field]} ${name}${huntProgress.rewards[field] === 1 ? '' : 's'}`);
        huntRewardText =
          `\n🎯 **Daily Hunt complete!** You caught your hunt target, ${target.name}.\n` +
          `🎁 Rewards: ${ballRewards.join(', ')}.`;
      }
    }
    const catchFaction = getUserFaction(userId);
    if (catchFaction) {
      addFactionPoints(userId, getFactionCatchPoints(catchFaction.faction_key, selectedBall, catchDisplayRarity));
    }
    trackClanActivity(userId, isFishing ? 'fish' : 'catch');
    const experienceAmount = getCatchExperienceReward(catchDisplayRarity);
    const experienceResult = isFishing ? null : awardCatchExperience(userId, experienceAmount);
    const fishingTokensEarned = isFishing ? getFishingTokenReward(catchDisplayRarity) : 0;
    const fishingConditions = [];
    if (isFishing) {
      const lureUser = getUser(userId);
      if (lureUser.active_poke_lures > 0) fishingConditions.push('poke_lure');
      if (lureUser.active_mistys_lures > 0) fishingConditions.push('mistys_lure');
      if (lureUser.active_poke_lures > 0 && lureUser.active_mistys_lures > 0) {
        fishingConditions.push('both_lures');
      }
      if (target.isShiny) fishingConditions.push('shiny');
      if (target.isGolden || target.is_golden || target.rarity === 'Golden') {
        fishingConditions.push('golden');
      }
      if (isEventOpen(halloweenEvent) && isEventChecklistSpawn(target)) {
        fishingConditions.push('event_exclusive');
      }
      const lureUse = {};
      if (lureUser.active_poke_lures > 0) lureUse.active_poke_lures = -1;
      if (lureUser.active_mistys_lures > 0) lureUse.active_mistys_lures = -1;
      if (Object.keys(lureUse).length) incrementUser(userId, lureUse);
    }
    const tracksRarityStreak = !NON_STREAK_RARITIES.has(catchDisplayRarity.toLowerCase());
    const streakResult = tracksRarityStreak
      ? recordRarityCatch(userId, catchDisplayRarity)
      : null;
    const nextStreak = streakResult?.streak ?? null;
    const streakRewardText = streakResult?.lootboxesAwarded
      ? `\n${LOOTBOX_EMOJI} **Streak reward:** You received **${streakResult.lootboxesAwarded} Lootbox${streakResult.lootboxesAwarded === 1 ? '' : 'es'}**!`
      : '';
    if (isEventOpen(halloweenEvent)) {
      const eventCatch = recordEventCatch(
        halloweenEvent.id,
        userId,
        target.name,
        target.isShiny
      );
      if (isEventChecklistSpawn(target)) {
        incrementUser(userId, { cl_event_catches: 1 });
      }
      await announceEventCatch(message.guild, message.author, target, eventCatch);
    }
    await announceRareSpawn(message.guild, message.author, target);
    if (target.rarity === 'Legendary') {
      incrementUser(userId, { legendaries_caught: 1 });
    }
    const completedRepeatableQuests = advanceQuestProgress(userId, {
      catches: isFishing ? 0 : 1,
      fishes: isFishing ? 1 : 0,
      fishingConditions,
      rarityCounts: { [catchDisplayRarity]: 1 },
      typeCounts: countQuestTypes([target]),
    });
    announceQuestCompletions(userId, message.channel, completedRepeatableQuests);
    processQuestProgress(userId, isFishing ? 'fish' : 'catch', message);
    if (isFishing) {
      incrementUser(userId, {
        fishes_caught: 1,
        fishing_tokens: fishingTokensEarned,
      });
    }
    const successEmbed = new EmbedBuilder()
      .setColor(isEventOpen(halloweenEvent) && isEventChecklistSpawn(target)
        ? EVENT_EMBED_COLOR
        : getRarityColor(target.rarity, target.name, target.isShiny))
      .setAuthor({
        name: `Congratulations, ${message.author.username}!`,
        iconURL: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/${ball.image}`,
      })
      .setDescription(
        `✅ ${getTrainerIconEmoji(userId)} You caught ` +
        `${/^[aeiou]/i.test(target.name) ? 'an' : 'a'} ` +
        `${getRarityEmojis(catchDisplayRarity)} **${target.name}** with a ` +
        `${ball.emoji} **${ball.name}**!\n` +
        `${ballSaved ? `⚡ **${ball.name} not used!**\n` : ''}\n` +
        `Rarity: ${getRarityEmojis(catchDisplayRarity)} ` +
        `${catchDisplayRarity} (${rarityData.rateText})\n` +
        `${tracksRarityStreak ? `${catchDisplayRarity} catches: ${nextStreak}\n` : ''}` +
        `${streakResult ? `General catches: ${streakResult.generalStreak}\n` : ''}` +
        `${streakRewardText}\n` +
        `${isNewDexEntry ? `${target.name} has been added to your Pokédex.\n\n` : ''}` +
        `${huntRewardText}` +
        `${ancientFossilDropText}` +
        `${isFishing
          ? `🎣 You earned ${EMOJIS.fishingtoken} **${fishingTokensEarned} Fishing Token${fishingTokensEarned === 1 ? '' : 's'}**!\n` : ''}` +
        `Pokémon roll: ${Math.round(playerRoll)}\n` +
        `Your catch rate: ${Math.round(targetRate)}%\n\n` +
        `═══════ Balls left ═══════\n` +
        `${remainingBalls}\n\n` +
        `You earned ${coinsEarned} ${EMOJIS.pokecoin} PokéCoins!`
      );
    const successImage = getPokemonShowdownSprite(
      target.slug,
      target.isShiny,
      target.isShiny ? (target.shinyImg || target.img) : target.img
    );
    if (successImage) successEmbed.setImage(successImage);
    const experienceMessage = !isFishing && experienceResult.awarded
      ? experienceResult.pokemon.map((pokemon) =>
        `${pokemon.is_shiny ? `${EMOJIS.shiny} ` : ''}**${pokemon.name}** gained **${experienceAmount.toLocaleString()} EXP!**`
      ).join('\n')
      : '';
    const levelUpMessage = experienceResult?.levelUps.map((levelUp) =>
      `🆙 • Congratulations, **${message.author.username}**! Your **${levelUp.name}** is now level **${levelUp.to}**.`
    ).join('\n') || '';
    await spawnMessage.edit({
      content: [experienceMessage, levelUpMessage].filter(Boolean).join('\n'),
      embeds: [successEmbed],
      components: [],
    });
    for (const promo of getActivePromos()) {
      if (!rollPromoItemDrop(promo, isFishing ? 'fish' : 'catch', getPromoChanceMultiplier(userId, target.incenseActive))) continue;
      addUserItem(userId, promo.itemName, 1);
      const newTotal = db.prepare(
        'SELECT amount FROM user_items WHERE user_id = ? AND item_name = ?'
      ).get(userId, promo.itemName)?.amount || 1;
      await message.channel.send(
        `${promo.itemEmoji} <@${userId}>, while ${isFishing ? 'fishing' : 'catching'} you discovered a rare ` +
        `**${promo.itemName}**! Check your progress with \`${PREFIX}promo\`.`
      ).catch(() => {});
      await announcePromoItemFound(
        message.guild,
        message.author,
        promo,
        isFishing ? 'fish' : 'catch',
        newTotal
      );
    }
  }

  textCollector.on('collect', async (response) => {
    try {
      await handleCatch(response.content.toLowerCase());
    } catch (error) {
      console.error('Failed to process catch-ball message:', error);
      await message.channel.send('❌ The encounter could not be processed.');
    }
  });
  buttonCollector.on('end', async (_, reason) => {
    activeCatchEncounters.delete(spawnMessage.id);
    if (onHandler) onHandler(null);
    if (reason === 'time' && !actionTaken) {
      actionTaken = true;
      textCollector.stop('expired');
      try {
        await spawnMessage.edit({
          content: `💨 The wild **${target.name}** ran away!`,
          components: [],
        });
      } catch (error) {
        console.error('Failed to expire Pokémon encounter:', error);
      }
    }
  });
}

const TYPE_EFFECTIVENESS = {
  normal: { rock: 0.5, ghost: 0, steel: 0.5 },
  fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
  water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
  electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
  grass: { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
  ice: { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
  fighting: { normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, rock: 2, ghost: 0, dark: 2, steel: 2, fairy: 0.5 },
  poison: { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
  ground: { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
  flying: { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
  psychic: { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
  bug: { fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5 },
  rock: { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
  ghost: { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
  dragon: { dragon: 2, steel: 0.5, fairy: 0 },
  dark: { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
  steel: { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2 },
  fairy: { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 },
};

const MOVE_DAMAGE_SCALE = 0.45;
const WORLD_BOSS_COUNTER_DAMAGE_MULTIPLIER = 5;
// The boss's real HP is huge, so status chip damage is tracked on a small dummy HP pool and scaled up.
const WORLD_BOSS_DUMMY_HP = 1600;
const WORLD_BOSS_CHIP_PER_HP = 100;

function typeEffectiveness(moveType, defenderTypes) {
  return defenderTypes.reduce(
    (multiplier, type) => multiplier * (TYPE_EFFECTIVENESS[moveType]?.[type] ?? 1),
    1
  );
}

function calculateMoveDamage(move, attack, defense, defenderTypes) {
  if (!move.power) return 0;
  const effectiveness = typeEffectiveness(move.type, defenderTypes);
  if (effectiveness === 0) return 0;
  return Math.max(
    1,
    Math.floor((move.power * attack / Math.max(1, defense))
      * MOVE_DAMAGE_SCALE * effectiveness * (0.85 + Math.random() * 0.15))
  );
}

function getDamagingMoves(moves) {
  const damaging = moves.filter((move) => move.power > 0);
  return damaging.length ? damaging : moves;
}

function makeBattleCtx(field, log, player, enemy, turn, partyData, opponents) {
  return {
    field, log, player, enemy, turn,
    calc: calculateMoveDamage,
    typeEff: typeEffectiveness,
    typeChart: TYPE_EFFECTIVENESS,
    party: { player: partyData, enemy: opponents },
  };
}

function battleStatusSuffix(mon) {
  const summary = mon ? battleFx.summarize(mon) : '';
  return summary ? ` [${summary}]` : '';
}

function describeBattleField(field) {
  const parts = [];
  const names = { rain: '🌧️ Rain', sun: '☀️ Harsh sun', sand: '🏜️ Sandstorm', hail: '❄️ Hail/Snow' };
  if (field.weather) parts.push(names[field.weather]);
  if (field.terrain) parts.push(`${field.terrain[0].toUpperCase()}${field.terrain.slice(1)} Terrain`);
  if (field.trickRoom > 0) parts.push('Trick Room');
  if (field.gravity > 0) parts.push('Gravity');
  for (const [side, label] of [['player', 'Your side'], ['enemy', 'Foe side']]) {
    const s = field.sides[side];
    const active = ['reflect', 'lightScreen', 'veil', 'safeguard', 'mist', 'tailwind']
      .filter((k) => s[k] > 0).map((k) => k.replace(/([A-Z])/g, ' $1').toLowerCase());
    if (s.spikes) active.push(`spikes x${s.spikes}`);
    if (s.tspikes) active.push(`toxic spikes x${s.tspikes}`);
    if (s.rocks) active.push('stealth rock');
    if (s.web) active.push('sticky web');
    if (active.length) parts.push(`${label}: ${active.join(', ')}`);
  }
  return parts.length ? `**Field:** ${parts.join(' · ')}\n` : '';
}

function getEquippedBattleMoves(pokemon, speciesId, formId = null) {
  let equipped = [];
  try {
    equipped = JSON.parse(pokemon.moves || '[]');
  } catch (error) {
    console.error(`Could not parse moves for Pokémon catch ${pokemon.id}:`, error);
  }
  let sketched = [];
  try { sketched = JSON.parse(pokemon.sketched_moves || '[]'); } catch (_) { /* ignore */ }
  const learnset = [...new Set([
    ...getSpeciesLearnset(speciesId),
    ...getSpeciesLearnset(speciesId, formId),
    ...getSpeciesGmaxMoves(speciesId),
    ...sketched,
  ])];
  const selected = equipped.filter((name) => learnset.includes(name)).slice(0, 4);
  for (const moveName of learnset) {
    if (selected.length >= 4) break;
    if (!selected.includes(moveName)) selected.push(moveName);
  }
  return selected.map((name) => getPokemonMove(name)).filter(Boolean);
}

const GAUNTLET_TRAINERS = [
  { name: 'Ace Trainer Flint', pokemonId: 229 },
  { name: 'Veteran Laura', pokemonId: 248 },
  { name: 'Dragon Tamer Drake', pokemonId: 373 },
  { name: 'Hex Maniac Valerie', pokemonId: 609 },
  { name: 'Black Belt Kiyo', pokemonId: 448 },
];

const LEAGUE_REGIONS = [
  { name: 'Kanto', gen: 'I' },
  { name: 'Johto', gen: 'II' },
  { name: 'Hoenn', gen: 'III' },
  { name: 'Sinnoh', gen: 'IV' },
  { name: 'Unova', gen: 'V' },
  { name: 'Kalos', gen: 'VI' },
  { name: 'Alola', gen: 'VII' },
  { name: 'Galar', gen: 'VIII' },
  { name: 'Paldea', gen: 'IX' },
];
const LEAGUE_CATEGORIES = {
  gym: {
    command: 'gym',
    title: 'Gym Battles',
    plural: 'Gyms',
    leaderLabel: 'Leader',
    color: 0xf1c40f,
    iconNoun: 'Gym Leader',
    matches: (name) => name.includes('gym') || name.includes('trial'),
  },
  e4: {
    command: 'elitefour',
    title: 'Elite Four Battles',
    plural: 'Elite Four',
    leaderLabel: 'Member',
    color: 0xe74c3c,
    iconNoun: 'Elite Four',
    matches: (name) => name.includes('elite four'),
  },
  champion: {
    command: 'champion',
    title: 'Champion Battles',
    plural: 'Champions',
    leaderLabel: 'Champion',
    color: 0x9b59b6,
    iconNoun: 'Champion',
    matches: (name) => name.includes('champion'),
  },
};

function getNpcCode(index, categoryKey) {
  const challenge = NPC_CAMPAIGN[index];
  const slug = (value) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
  return `${slug(challenge.region)}_${categoryKey === 'e4' ? 'e4' : categoryKey}_${slug(getNpcTrainerName(index))}`;
}

function getLeagueEntries(categoryKey, regionName = null) {
  const category = LEAGUE_CATEGORIES[categoryKey];
  return NPC_CAMPAIGN
    .map((challenge, index) => ({ challenge, index }))
    .filter(({ challenge }) => category.matches(challenge.name.toLowerCase())
      && (!regionName || challenge.region === regionName));
}

function getNpcCodeCategory(challenge) {
  const name = challenge.name.toLowerCase();
  return Object.keys(LEAGUE_CATEGORIES).find((key) => LEAGUE_CATEGORIES[key].matches(name)) || 'gym';
}

async function sendLeagueHub(message, userId, categoryKey, initialRegion = null) {
  const category = LEAGUE_CATEGORIES[categoryKey];
  const prefixedCommand = `${PREFIX}${category.command}`;
  const regions = LEAGUE_REGIONS.filter((region) => getLeagueEntries(categoryKey, region.name).length);
  const speciesNames = new Map();
  const getSpeciesName = (entry) => {
    const key = entry.form_id ? `f${entry.form_id}` : `s${entry.pokemon_id}`;
    if (!speciesNames.has(key)) {
      const form = entry.form_id
        ? db.prepare('SELECT name FROM pokemon_forms WHERE id = ?').get(entry.form_id)
        : db.prepare('SELECT name FROM pokemon_forms WHERE species_id = ? AND is_default = 1 LIMIT 1').get(entry.pokemon_id);
      speciesNames.set(key, form?.name || '???');
    }
    return speciesNames.get(key);
  };
  let current = initialRegion;

  const buildEmbed = () => {
    const progress = getLeagueProgress(userId).cleared_challenges;
    const unlockedIcons = new Set(getUnlockedBattleIcons(userId));
    const embed = new EmbedBuilder()
      .setColor(category.color)
      .setAuthor({
        name: `Umbreon ${category.title}${current ? ` - ${current}` : ''}`,
        iconURL: client.user.displayAvatarURL(),
      });
    if (!current) {
      const lines = regions.map((region) => `**Gen ${region.gen}: ${region.name} ${category.plural}**\n` +
        `\`${prefixedCommand} ${region.name.toLowerCase()}\` to view ${region.name} ${category.plural.toLowerCase()}`);
      const badges = regions.map((region) => {
        const entries = getLeagueEntries(categoryKey, region.name);
        const cleared = entries.filter(({ index }) => index < progress).length;
        return `**${region.name}** \`[${cleared}/${entries.length}]\``;
      });
      return embed
        .setDescription(
          `${lines.join('\n\n')}\n\n**Your ${category.plural} Progress**\n${badges.join('\n')}\n\n` +
          `Use \`${PREFIX}battle npc\` for the full league tracker.`
        );
    }
    const entries = getLeagueEntries(categoryKey, current);
    const fields = [];
    entries.forEach(({ challenge, index }, position) => {
      const cleared = index < progress;
      const status = `${cleared ? '✅ ' : ''}${unlockedIcons.has(index) ? '🎉 ' : ''}`;
      const [place] = challenge.name.split('\u2014');
      const icon = getNpcIconEmojiOrBlank(index);
      fields.push({
        name: `${status}${place.trim()}`,
        value:
          `**${category.leaderLabel}** ${[icon, getNpcTrainerName(index)].filter(Boolean).join(' ')}\n` +
          `**Team** ${challenge.team.map(getSpeciesName).join(', ')}\n` +
          `**ID** \`${index + 1}\`\n` +
          `**Name** \`${getNpcCode(index, categoryKey)}\``,
        inline: true,
      });
      if (position % 2 === 1) fields.push({ name: '\u200b', value: '\u200b', inline: true });
    });
    const unlockedCount = entries.filter(({ index }) => unlockedIcons.has(index)).length;
    return embed
      .setDescription('✅ — Defeated NPC   🎉 — Unlocked icon')
      .addFields(fields)
      .setFooter({
        text: `Unlocked ${unlockedCount} / ${entries.length} ${current} ${category.iconNoun} icons\n` +
          `To battle, type ${PREFIX}battle npc {id or name}`,
      });
  };

  const buildButtons = (disabled = false) => {
    const buttons = regions.map((region) => new ButtonBuilder()
      .setCustomId(`leaguehub:${categoryKey}:${region.name}`)
      .setLabel(region.name)
      .setStyle(current === region.name ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(disabled));
    buttons.push(new ButtonBuilder()
      .setCustomId(`leaguehub:${categoryKey}:home`)
      .setLabel('Home')
      .setStyle(!current ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(disabled));
    const rows = [];
    for (let i = 0; i < buttons.length; i += 5) {
      rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    }
    return rows;
  };

  const hubMessage = await message.reply({ embeds: [buildEmbed()], components: buildButtons() });
  const collector = hubMessage.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 180000,
  });
  collector.on('collect', async (interaction) => {
    if (interaction.user.id !== message.author.id) {
      return interaction.reply({ content: `Run \`${prefixedCommand}\` to browse it yourself.`, ephemeral: true });
    }
    const target = interaction.customId.split(':')[2];
    current = target === 'home' ? null : target;
    return interaction.update({ embeds: [buildEmbed()], components: buildButtons() });
  });
  collector.on('end', () => {
    hubMessage.edit({ components: buildButtons(true) }).catch((error) => {
      if (error.code !== 10008) console.error('Failed to disable league hub buttons:', error);
    });
  });
  return hubMessage;
}

function resolveLeagueRegion(input) {
  if (!input) return null;
  return LEAGUE_REGIONS.find((region) => region.name.toLowerCase() === input.toLowerCase())?.name || undefined;
}

function formatMegaChamberSacrifices(sacrifices, required = 10) {
  const readyRuns = Math.floor(sacrifices / required);
  const towardNext = sacrifices % required;
  return `${sacrifices}/${required} sacrifices — **${readyRuns} run${readyRuns === 1 ? '' : 's'} ready**` +
    `${towardNext ? `, ${towardNext}/${required} toward the next` : ''}`;
}

function makeMegaChamberButtons(moves, disabled = false) {
  return new ActionRowBuilder().addComponents(
    ...moves.map((move, index) =>
      new ButtonBuilder()
        .setCustomId(`chamber:move:${index}`)
        .setLabel(move.name.slice(0, 80))
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled)
    )
  );
}

function makeBattleForfeitRow(customId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(customId)
      .setLabel('Forfeit Battle')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );
}

function makeSparButtons(moves) {
  return new ActionRowBuilder().addComponents(
    ...moves.map((move, index) =>
      new ButtonBuilder()
        .setCustomId(`spar:move:${index}`)
        .setLabel(move.name.slice(0, 80))
        .setStyle(ButtonStyle.Primary)
    )
  );
}

function makeBattleSwitchButtons(party, activeIndex, prefix) {
  const switches = party
    .map((pokemon, index) => ({ pokemon, index }))
    .filter(({ pokemon, index }) => index !== activeIndex && pokemon.hp > 0)
    .map(({ pokemon, index }) => new ButtonBuilder()
      .setCustomId(`${prefix}:switch:${index}`)
      .setLabel(`Switch to ${pokemon.name}`.slice(0, 80))
      .setStyle(ButtonStyle.Secondary));
  return switches.length ? new ActionRowBuilder().addComponents(switches) : null;
}

function buildSparParty(userId) {
  return getUserTeam(userId).map((pokemon) => {
    const form = db.prepare('SELECT * FROM pokemon_forms WHERE id = ?').get(pokemon.pokemon_id);
    if (!form) return null;
    const moves = getEquippedBattleMoves(pokemon, form.species_id, form.id);
    if (!moves.length) return null;
    return {
      ...pokemon,
      types: JSON.parse(form.types),
      moves,
      hp: pokemon.max_hp,
      spriteUrl: getPokemonShowdownSprite(form.slug),
    };
  }).filter(Boolean);
}

// Friendly spar: your team against another player's team, which is controlled by the AI. No rewards or records.
async function runPlayerSpar(message, userId, opponentUser) {
  const party = buildSparParty(userId);
  if (!party.length) return message.reply('❌ Set up a team with at least one Pokémon that has battle moves first.');
  const opponents = buildSparParty(opponentUser.id);
  if (!opponents.length) {
    return message.reply(`❌ **${opponentUser.username}** has no battle-ready team Pokémon.`);
  }
  for (const mon of opponents) mon.trainer = opponentUser.username;
  let partyIndex = 0;
  let opponentIndex = 0;
  let turn = 0;
  let finished = false;
  let won = false;
  let resultSummary = '';
  const field = createBattleField();
  const log = [`🤝 **${message.author.username}** challenged **${opponentUser.username}**'s team!`];
  const currentMoves = () => party[partyIndex]?.moves || [];
  const battleEmbed = () => {
    const player = party[partyIndex];
    const enemy = opponents[opponentIndex];
    const embed = new EmbedBuilder()
      .setColor(finished ? (won ? 0x2ecc71 : 0xe74c3c) : 0x3498db)
      .setTitle(`⚔️ ${message.author.username} vs ${opponentUser.username}`)
      .setDescription(finished
        ? resultSummary || 'No battle rewards were earned.'
        : (
        `**Your Pokémon:** ${player ? `${player.is_shiny ? '✨ ' : ''}${player.name} Lv.${player.level} — ${Math.max(0, player.hp)}/${player.max_hp} HP${battleStatusSuffix(player)}` : 'Your team was wiped out'}\n` +
        `**Opponent:** ${enemy ? `${enemy.is_shiny ? '✨ ' : ''}${enemy.name} Lv.${enemy.level} — ${Math.max(0, enemy.hp)}/${enemy.max_hp} HP${battleStatusSuffix(enemy)}` : 'Their team was wiped out'}\n` +
        `${describeBattleField(field)}` +
        `**Your team:** ${party.filter((mon) => mon.hp > 0).length}/${party.length} • ` +
        `**Their team:** ${opponents.filter((mon) => mon.hp > 0).length}/${opponents.length}\n\n` +
        log.slice(-14).join('\n')
      ))
      .setFooter({
        text: finished
          ? (won ? 'You won the spar!' : 'You lost the spar.')
          : 'Choose a move or switch Pokémon. The winner earns Buddy EXP.',
      });
    if (enemy?.spriteUrl) embed.setImage(enemy.spriteUrl);
    return embed;
  };

  log.push(`${opponentUser.username} sent out **${opponents[0].name}**!`);
  onSwitchIn(makeBattleCtx(field, log, party[0], opponents[0], 0, party, opponents), opponents[0], 'enemy', (text) => log.push(`↳ ${text}`));
  const battleComponents = () => [
    makeSparButtons(currentMoves()),
    makeBattleSwitchButtons(party, partyIndex, 'spar'),
    makeBattleForfeitRow('spar:forfeit'),
  ].filter(Boolean);
  const battleMessage = await message.reply({
    embeds: [battleEmbed()],
    components: battleComponents(),
  });
  const collector = battleMessage.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 120000,
  });
  const handleMove = async (interaction) => {
    try {
      if (interaction.user.id !== userId) {
        await interaction.reply({ content: 'This is not your battle.', ephemeral: true });
        return;
      }
      if (interaction.customId === 'spar:forfeit') {
        finished = true;
        won = false;
        resultSummary = '🏳️ You forfeited the battle. No rewards were earned.';
        log.push('🏳️ **You forfeited the battle.**');
        await interaction.update({ embeds: [battleEmbed()], components: [] });
        activeSparBattles.delete(battleMessage.id);
        collector.stop('forfeit');
        return;
      }
      const parts = interaction.customId.split(':');
      const enemy = opponents[opponentIndex];
      if (!enemy || finished) {
        await interaction.reply({ content: 'That battle action is no longer available.', ephemeral: true });
        return;
      }

      log.length = 0;
      turn += 1;
      if (parts[1] === 'switch') {
        const nextIndex = Number(parts[2]);
        const nextPlayer = party[nextIndex];
        if (!nextPlayer || nextIndex === partyIndex || nextPlayer.hp <= 0) {
          turn -= 1;
          await interaction.reply({ content: 'That Pokémon cannot be switched in.', ephemeral: true });
          return;
        }
        partyIndex = nextIndex;
        log.push(`🔄 You switched to **${nextPlayer.name}**!`);
        const ctx = makeBattleCtx(field, log, nextPlayer, enemy, turn, party, opponents);
        onSwitchIn(ctx, nextPlayer, 'player', (text) => log.push(`↳ ${text}`));
        runSwitchTurn(ctx, chooseEnemyMove(enemy, nextPlayer, field));
      } else {
        const moveIndex = Number(parts[2]);
        const player = party[partyIndex];
        const selectedMove = currentMoves()[moveIndex];
        if (!selectedMove || !player) {
          turn -= 1;
          await interaction.reply({ content: 'That move is no longer available.', ephemeral: true });
          return;
        }
        const ctx = makeBattleCtx(field, log, player, enemy, turn, party, opponents);
        runTurn(ctx, selectedMove, chooseEnemyMove(enemy, player, field));
      }
      if (enemy.hp <= 0) {
        log.push(`🏅 ${opponentUser.username}'s ${enemy.name} was defeated!`);
        opponentIndex += 1;
        while (opponentIndex < opponents.length && opponents[opponentIndex].hp <= 0) opponentIndex += 1;
        if (opponentIndex < opponents.length) {
          const nextEnemy = opponents[opponentIndex];
          log.push(`${opponentUser.username} sent out **${nextEnemy.name}**!`);
          onSwitchIn(makeBattleCtx(field, log, party[partyIndex], nextEnemy, turn, party, opponents), nextEnemy, 'enemy', (text) => log.push(`↳ ${text}`));
        }
      }
      const player = party[partyIndex];
      if (player && player.hp <= 0) {
        log.push(`💫 ${player.name} fainted!`);
        partyIndex = party.findIndex((pokemon) => pokemon.hp > 0);
        if (partyIndex >= 0) {
          const nextPlayer = party[partyIndex];
          log.push(`Go, **${nextPlayer.name}**!`);
          onSwitchIn(makeBattleCtx(field, log, nextPlayer, opponents[opponentIndex] || enemy, turn, party, opponents), nextPlayer, 'player', (text) => log.push(`↳ ${text}`));
        }
      }

      const lost = partyIndex < 0;
      won = opponentIndex >= opponents.length;
      finished = won || lost;
      if (won) {
        log.push(`🎉 **VICTORY!** You defeated ${opponentUser.username}'s team!`);
        const experience = 200 + Math.floor(Math.random() * 1801);
        const experienceResult = awardCatchExperience(userId, experience);
        if (experienceResult.awarded) {
          log.push(`✨ Your Buddy and eligible Exp. Share Pokémon earned **${experience.toLocaleString()} EXP**.`);
          resultSummary = `🎉 **Victory!**\n✨ Buddy and eligible Exp. Share Pokémon earned **${experience.toLocaleString()} EXP**.`;
        } else {
          resultSummary = '🎉 **Victory!**\nNo Buddy or eligible Exp. Share Pokémon could receive EXP.';
        }
      }
      else if (lost) {
        log.push(`💀 **DEFEAT!** ${opponentUser.username}'s team was too strong.`);
        resultSummary = '💀 **Defeat.** No rewards were earned.';
      }
      await interaction.update({
        embeds: [battleEmbed()],
        components: finished
          ? []
          : battleComponents(),
      });
      if (finished) {
        activeSparBattles.delete(battleMessage.id);
        collector.stop('finished');
      } else {
        collector.resetTimer();
      }
    } catch (error) {
      console.error(`Failed to process player spar for user ${userId}:`, error);
      await replyToInteractionFailure(interaction, 'The battle could not be processed.', 'player battle');
      collector.stop('error');
    }
  };
  activeSparBattles.set(battleMessage.id, handleMove);
  collector.on('end', async (_, reason) => {
    activeSparBattles.delete(battleMessage.id);
    if (reason !== 'time') return;
    finished = true;
    won = false;
    resultSummary = '⏳ The battle timed out. No rewards were earned.';
    log.push('⏳ The battle timed out.');
    try {
      await battleMessage.edit({ embeds: [battleEmbed()], components: [] });
    } catch (error) {
      console.error(`Failed to close expired player spar for user ${userId}:`, error);
    }
  });
}

async function runMegaChamberGauntlet(message, userId, config) {
  const team = getUserTeam(userId);
  if (team.length < 3) {
    return message.reply('❌ You need a full 3-Pokémon team to enter the Mega Chamber.');
  }
  const party = team.map((pokemon) => {
    const form = db.prepare('SELECT * FROM pokemon_forms WHERE id = ?').get(pokemon.pokemon_id);
    if (!form) throw new Error(`Missing catalog form ${pokemon.pokemon_id} for team catch ${pokemon.id}.`);
    const moves = getEquippedBattleMoves(pokemon, form.species_id, form.id);
    if (!moves.length) throw new Error(`${pokemon.name} has no damaging moves in the move database.`);
    return {
      ...pokemon,
      types: JSON.parse(form.types),
      moves,
      hp: pokemon.max_hp,
    };
  });
  const averageLevel = Math.max(
    1,
    Math.floor(party.reduce((total, pokemon) => total + pokemon.level, 0) / party.length)
  );
  const shuffled = [...GAUNTLET_TRAINERS];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  const opponents = shuffled.slice(0, 3).map((trainer) => {
    const form = db.prepare(`
      SELECT * FROM pokemon_forms
      WHERE species_id = ? AND is_default = 1
      LIMIT 1
    `).get(trainer.pokemonId);
    if (!form) throw new Error(`Missing Mega Chamber Pokémon ${trainer.pokemonId}.`);
    const level = Math.min(100, Math.max(10, averageLevel + 4));
    const stats = combatStats({
      hp: form.base_hp,
      attack: form.base_atk,
      defense: form.base_def,
      speed: form.base_spd,
    }, level);
    const moves = buildEnemyMoves(getSpeciesLearnset(form.species_id, form.id)
      .map((name) => getPokemonMove(name))
      .filter(Boolean));
    if (!moves.length) throw new Error(`${form.name} has no damaging moves in the move database.`);
    return {
      trainer: trainer.name,
      name: form.name,
      spriteUrl: getPokemonShowdownSprite(form.slug),
      types: JSON.parse(form.types),
      stats,
      hp: stats.hp,
      max_hp: stats.hp,
      moves,
    };
  });
  let partyIndex = 0;
  let opponentIndex = 0;
  let turn = 0;
  let finished = false;
  let won = false;
  let resultSummary = '';
  const field = createBattleField();
  const log = [`🏟️ **Challenging the ${config.icon} ${config.name} Chamber!**`];
  const currentMoves = () => party[partyIndex]?.moves || [];
  const battleComponents = () => [
    makeMegaChamberButtons(currentMoves()),
    makeBattleSwitchButtons(party, partyIndex, 'chamber'),
    makeBattleForfeitRow('chamber:forfeit'),
  ].filter(Boolean);
  const battleEmbed = () => {
    const player = party[partyIndex];
    const enemy = opponents[opponentIndex];
    const embed = new EmbedBuilder()
      .setColor(finished ? (won ? 0x2ecc71 : 0xe74c3c) : 0x9b59b6)
      .setTitle(`${config.icon} Mega Chamber Gauntlet: ${config.name}`)
      .setDescription(finished
        ? resultSummary || 'No battle rewards were earned.'
        : (
        `**Your Pokémon:** ${player ? `${player.is_shiny ? '✨ ' : ''}${player.name} — ${Math.max(0, player.hp)}/${player.max_hp} HP${battleStatusSuffix(player)}` : 'Your party was wiped out'}\n` +
        `**Opponent:** ${enemy ? `${enemy.trainer}'s ${enemy.name} — ${Math.max(0, enemy.hp)}/${enemy.max_hp} HP${battleStatusSuffix(enemy)}` : 'All trainers defeated'}\n` +
        `${describeBattleField(field)}` +
        `**Party:** ${party.filter((pokemon) => pokemon.hp > 0).length}/${party.length} remaining\n\n` +
        log.slice(-14).join('\n')
      ))
      .setFooter({
        text: finished
          ? (won ? 'Mega Chamber cleared!' : 'Gauntlet lost.')
          : 'Choose a move or switch Pokémon.',
      });
    if (enemy?.spriteUrl) embed.setImage(enemy.spriteUrl);
    return embed;
  };

  log.push(`**Round 1/3:** ${opponents[0].trainer} sent out ${opponents[0].name}!`);
  const battleMessage = await message.reply({
    embeds: [battleEmbed()],
    components: battleComponents(),
  });
  const collector = battleMessage.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 90000,
  });
  const handleMove = async (interaction) => {
    try {
      if (interaction.user.id !== userId) {
        await interaction.reply({ content: 'This is not your Mega Chamber battle.', ephemeral: true });
        return;
      }
      if (interaction.customId === 'chamber:forfeit') {
        if (finished) {
          await interaction.reply({ content: 'This Mega Chamber battle has already ended.', ephemeral: true });
          return;
        }
        finished = true;
        won = false;
        resultSummary = '🏳️ You forfeited the battle. No rewards were earned.';
        incrementUser(userId, { battles_lost: 1 });
        log.push('🏳️ **You forfeited the Mega Chamber battle.**');
        trackClanActivity(userId, 'battle');
        await interaction.update({ embeds: [battleEmbed()], components: [] });
        activeMegaChamberBattles.delete(battleMessage.id);
        collector.stop('forfeit');
        return;
      }
      const parts = interaction.customId.split(':');
      const enemy = opponents[opponentIndex];
      if (!enemy || finished) {
        await interaction.reply({ content: 'That battle action is no longer available.', ephemeral: true });
        return;
      }

      log.length = 0;
      turn += 1;
      if (parts[1] === 'switch') {
        const nextIndex = Number(parts[2]);
        const nextPlayer = party[nextIndex];
        if (!nextPlayer || nextIndex === partyIndex || nextPlayer.hp <= 0) {
          turn -= 1;
          await interaction.reply({ content: 'That Pokémon cannot be switched in.', ephemeral: true });
          return;
        }
        partyIndex = nextIndex;
        log.push(`🔄 You switched to **${nextPlayer.name}**!`);
        const ctx = makeBattleCtx(field, log, nextPlayer, enemy, turn, party, opponents);
        onSwitchIn(ctx, nextPlayer, 'player', (text) => log.push(`↳ ${text}`));
        runSwitchTurn(ctx, chooseEnemyMove(enemy, nextPlayer, field));
      } else {
        const moveIndex = Number(parts[2]);
        const player = party[partyIndex];
        const selectedMove = currentMoves()[moveIndex];
        if (!selectedMove || !player) {
          turn -= 1;
          await interaction.reply({ content: 'That move is no longer available.', ephemeral: true });
          return;
        }
        const ctx = makeBattleCtx(field, log, player, enemy, turn, party, opponents);
        runTurn(ctx, selectedMove, chooseEnemyMove(enemy, player, field));
      }
      if (enemy.hp <= 0) {
        log.push(`🏅 ${enemy.trainer}'s ${enemy.name} was defeated!`);
        opponentIndex += 1;
        while (opponentIndex < opponents.length && opponents[opponentIndex].hp <= 0) opponentIndex += 1;
        if (opponentIndex < opponents.length) {
          const nextEnemy = opponents[opponentIndex];
          log.push(`**Round ${opponentIndex + 1}/3:** ${nextEnemy.trainer} sent out ${nextEnemy.name}!`);
          onSwitchIn(makeBattleCtx(field, log, party[partyIndex], nextEnemy, turn, party, opponents), nextEnemy, 'enemy', (text) => log.push(`↳ ${text}`));
        }
      }
      const player = party[partyIndex];
      if (player && player.hp <= 0) {
        log.push(`💫 ${player.name} fainted!`);
        partyIndex = party.findIndex((pokemon) => pokemon.hp > 0);
        if (partyIndex >= 0) {
          const nextPlayer = party[partyIndex];
          log.push(`Go, **${nextPlayer.name}**!`);
          onSwitchIn(makeBattleCtx(field, log, nextPlayer, opponents[opponentIndex] || enemy, turn, party, opponents), nextPlayer, 'player', (text) => log.push(`↳ ${text}`));
        }
      }

      const lost = partyIndex < 0;
      won = opponentIndex >= opponents.length;
      finished = won || lost;
      if (won) {
        const reward = completeMegaChamber(userId, config.key);
        if (reward.error) {
          won = false;
          log.push('❌ The chamber entry was no longer available; no reward was granted.');
        } else {
          incrementUser(userId, { cl_battles: 1 });
          const completedQuests = advanceQuestProgress(userId, {
            battleWins: 1,
            battleCategories: ['mega_chamber'],
          });
          announceQuestCompletions(userId, message.channel, completedQuests);
          log.push(
            `🎉 **VICTORY!** You cleared the gauntlet and earned 1x ${stoneLabel(reward.stone)} ` +
            `and ${EMOJIS.pokecoin} **${reward.coins.toLocaleString()} PokéCoins**! ` +
            `${formatMegaChamberSacrifices(reward.remainingSacrifices, getChamberRequirement(config, userId))} remain.`
          );
          resultSummary =
            `🎉 **Victory!**\n` +
            `Earned **1x ${stoneLabel(reward.stone)}** and ${EMOJIS.pokecoin} **${reward.coins.toLocaleString()} PokéCoins**.\n` +
            `${formatMegaChamberSacrifices(reward.remainingSacrifices, getChamberRequirement(config, userId))} remain.`;
        }
        if (reward.error) resultSummary = '❌ The chamber entry was no longer available; no reward was granted.';
        finished = true;
      } else if (lost) {
        incrementUser(userId, { battles_lost: 1 });
        log.push('💀 **DEFEAT!** Train your team and challenge the chamber again.');
        resultSummary = '💀 **Defeat.** No rewards were earned.';
      }

      if (finished) {
        trackClanActivity(userId, 'battle');
        rollActivityPromoDrops(interaction.user, interaction.guild, interaction.channel, 'battle');
      }
      await interaction.update({
        embeds: [battleEmbed()],
        components: finished
          ? []
          : battleComponents(),
      });
      if (finished) {
        activeMegaChamberBattles.delete(battleMessage.id);
        collector.stop('finished');
      } else {
        collector.resetTimer();
      }
    } catch (error) {
      console.error(`Failed to process Mega Chamber battle for user ${userId}:`, error);
      await replyToInteractionFailure(
        interaction,
        'The Mega Chamber battle could not be processed.',
        'Mega Chamber battle'
      );
      collector.stop('error');
    }
  };
  activeMegaChamberBattles.set(battleMessage.id, handleMove);
  collector.on('end', async (_, reason) => {
    activeMegaChamberBattles.delete(battleMessage.id);
    if (reason !== 'time') return;
    finished = true;
    won = false;
    resultSummary = '⏳ The battle timed out. No rewards were earned.';
    log.push('⏳ The Mega Chamber battle timed out.');
    try {
      await battleMessage.edit({ embeds: [battleEmbed()], components: [] });
    } catch (error) {
      console.error(`Failed to close expired Mega Chamber battle for user ${userId}:`, error);
    }
  });
}

function combatStats(baseStats, level) {
  return {
    hp: Math.floor((2 * baseStats.hp * level) / 100) + level + 10,
    atk: Math.floor((2 * baseStats.attack * level) / 100) + 5,
    def: Math.floor((2 * baseStats.defense * level) / 100) + 5,
    spd: Math.floor((2 * baseStats.speed * level) / 100) + 5,
  };
}

function makeLeagueButtons(moves, disabled = false) {
  return new ActionRowBuilder().addComponents(
    ...moves.map((move, index) =>
      new ButtonBuilder()
        .setCustomId(`league:move:${index}`)
        .setLabel(move.name.slice(0, 80))
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled)
    )
  );
}

async function runLeagueChallenge(message, userId, challengeIndex, challenges = KANTO_LEAGUE) {
  const challenge = challenges[challengeIndex];
  if (challenge.factionNpc && !getUserFaction(userId)) {
    return message.reply(`Join a faction with \`${PREFIX}faction\` before challenging faction NPCs.`);
  }
  const party = getUserTeam(userId);
  if (!party.length) {
    return message.reply(`Add Pokémon to your active team before challenging the league (\`${PREFIX}team add <name|dex> <slot>\`).`);
  }
  const partyData = party.map((pokemon) => {
    const form = db.prepare('SELECT * FROM pokemon_forms WHERE id = ?').get(pokemon.pokemon_id);
    if (!form) throw new Error(`Missing catalog form ${pokemon.pokemon_id} for team catch ${pokemon.id}.`);
    const types = JSON.parse(form.types);
    const moves = getEquippedBattleMoves(pokemon, form.species_id, form.id);
    if (!moves.length) throw new Error(`${pokemon.name} has no damaging moves in the move database.`);
    return {
      ...pokemon,
      species_id: form.species_id,
      types,
      moves,
      hp: pokemon.max_hp,
      max_hp: pokemon.max_hp,
    };
  });
  const averageLevel = Math.max(
    1,
    Math.floor(partyData.reduce((total, pokemon) => total + pokemon.level, 0) / partyData.length)
  );
  const opponents = challenge.team.map((entry) => {
    const form = entry.form_id
      ? db.prepare('SELECT * FROM pokemon_forms WHERE id = ?').get(entry.form_id)
      : db.prepare(`
        SELECT * FROM pokemon_forms WHERE species_id = ? AND is_default = 1 LIMIT 1
      `).get(entry.pokemon_id);
    if (!form) {
      throw new Error(`Missing catalog entry for league Pokémon ${entry.form_id || entry.pokemon_id}.`);
    }
    const level = challenge.factionNpc
      ? 100
      : Math.min(entry.level, Math.max(10, averageLevel + 6 + Math.floor(challengeIndex / 2) * 2));
    const stats = combatStats({
      hp: form.base_hp,
      attack: form.base_atk,
      defense: form.base_def,
      speed: form.base_spd,
    }, level);
    if (challenge.factionNpc) {
      for (const stat of Object.keys(stats)) {
        stats[stat] = Math.floor(stats[stat] * challenge.strengthMultiplier);
      }
    }
    const moves = buildEnemyMoves(getSpeciesLearnset(form.species_id, form.id)
      .map((name) => getPokemonMove(name))
      .filter(Boolean));
    if (!moves.length) throw new Error(`${form.name} has no damaging moves in the move database.`);
    const namePrefix = entry.is_golden ? 'Golden ' : entry.is_shiny ? 'Shiny ' : '';
    return {
      name: `${namePrefix}${form.name}`,
      types: JSON.parse(form.types),
      spriteUrl: entry.sprite_url || (entry.is_golden
        ? getGoldenSpriteUrl(form.species_id, form.slug)
        : getPokemonShowdownSprite(form.slug, Boolean(entry.is_shiny))),
      stats,
      hp: stats.hp,
      max_hp: stats.hp,
      moves,
    };
  });
  let partyIndex = 0;
  let opponentIndex = 0;
  let turn = 0;
  let finished = false;
  let resultSummary = '';
  const log = [`⚔️ **${challenge.name}** challenged you!`];
  const field = createBattleField();
  const currentMoves = () => partyData[partyIndex]?.moves || [];
  const battleComponents = () => [
    makeLeagueButtons(currentMoves()),
    makeBattleSwitchButtons(partyData, partyIndex, 'league'),
    makeBattleForfeitRow('league:forfeit'),
  ].filter(Boolean);
  const battleEmbed = (finished = false, won = false) => {
    const player = partyData[partyIndex];
    const enemy = opponents[opponentIndex];
    const embed = new EmbedBuilder()
      .setColor(finished ? (won ? 0x2ecc71 : 0xe74c3c) : 0xe67e22)
      .setTitle(`⚔️ ${challenge.iconEmoji ? `${challenge.iconEmoji} ` : ''}${challenge.name}`)
      .setDescription(finished
        ? resultSummary || 'No battle rewards were earned.'
        : (
        `**Your Pokémon:** ${player ? `${player.is_shiny ? '✨ ' : ''}${player.name} (${formatTypes(player.types, ' ')}) — ${Math.max(0, player.hp)}/${player.max_hp} HP${battleStatusSuffix(player)}` : 'All Pokémon fainted'}\n` +
        `**Opponent:** ${enemy ? `${enemy.name} (${formatTypes(enemy.types, ' ')}) — ${Math.max(0, enemy.hp)}/${enemy.max_hp} HP${battleStatusSuffix(enemy)}` : 'All opponents defeated'}\n` +
        `${describeBattleField(field)}` +
        `**Party:** ${partyData.filter((pokemon) => pokemon.hp > 0).length}/${partyData.length} remaining\n\n` +
        log.slice(-14).join('\n')
      ))
      .setFooter({ text: finished ? (won ? 'Challenge cleared!' : 'Challenge lost.') : 'Choose a move or switch Pokémon.' });
    if (enemy?.spriteUrl) embed.setImage(enemy.spriteUrl);
    if (challenges === NPC_CAMPAIGN) embed.setThumbnail(getNpcIconUrl(challengeIndex));
    return embed;
  };

  const battleMessage = await message.reply({
    embeds: [battleEmbed()],
    components: battleComponents(),
  });
  const collector = battleMessage.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 90000,
  });
  let actionInProgress = false;
  const handleMove = async (interaction) => {
    try {
      if (interaction.user.id !== userId) {
        await interaction.reply({ content: 'This is not your league battle.', ephemeral: true });
        return;
      }
      if (actionInProgress) {
        await interaction.reply({ content: 'Your previous battle action is still being processed.', ephemeral: true });
        return;
      }
      if (finished) {
        await interaction.reply({ content: 'This league battle has already ended.', ephemeral: true });
        return;
      }
      if (interaction.customId === 'league:forfeit') {
        actionInProgress = true;
        await interaction.deferUpdate();
        finished = true;
        resultSummary = '🏳️ You forfeited the battle. No rewards were earned.';
        incrementUser(userId, { battles_lost: 1 });
        log.push('🏳️ **You forfeited the battle.**');
        trackClanActivity(userId, 'battle');
        await interaction.editReply({
          embeds: [battleEmbed(true, false)],
          components: [],
        });
        actionInProgress = false;
        activeLeagueBattles.delete(battleMessage.id);
        collector.stop('forfeit');
        return;
      }
      const parts = interaction.customId.split(':');
      const enemy = opponents[opponentIndex];
      if (!enemy) {
        await interaction.reply({ content: 'That battle action is no longer available.', ephemeral: true });
        return;
      }
      let nextPlayer = null;
      let selectedMove = null;
      if (parts[1] === 'switch') {
        nextPlayer = partyData[Number(parts[2])];
        if (!nextPlayer || nextPlayer === partyData[partyIndex] || nextPlayer.hp <= 0) {
          await interaction.reply({ content: 'That Pokémon cannot be switched in.', ephemeral: true });
          return;
        }
      } else if (parts[1] === 'move') {
        selectedMove = currentMoves()[Number(parts[2])];
        if (!selectedMove || !partyData[partyIndex]) {
          await interaction.reply({ content: 'That move is no longer available.', ephemeral: true });
          return;
        }
      } else {
        await interaction.reply({ content: 'That battle action is no longer available.', ephemeral: true });
        return;
      }
      actionInProgress = true;
      await interaction.deferUpdate();
      log.length = 0;
      turn += 1;
      if (parts[1] === 'switch') {
        partyIndex = partyData.indexOf(nextPlayer);
        log.push(`🔄 You switched to **${nextPlayer.name}**!`);
        const ctx = makeBattleCtx(field, log, nextPlayer, enemy, turn, partyData, opponents);
        onSwitchIn(ctx, nextPlayer, 'player', (text) => log.push(`↳ ${text}`));
        runSwitchTurn(ctx, chooseEnemyMove(enemy, nextPlayer, field));
      } else {
        const player = partyData[partyIndex];
        const ctx = makeBattleCtx(field, log, player, enemy, turn, partyData, opponents);
        runTurn(ctx, selectedMove, chooseEnemyMove(enemy, player, field));
      }
      if (enemy.hp <= 0) {
        log.push(`🏅 ${enemy.name} was defeated!`);
        opponentIndex += 1;
        while (opponentIndex < opponents.length && opponents[opponentIndex].hp <= 0) opponentIndex += 1;
        if (opponentIndex < opponents.length) {
          const nextEnemy = opponents[opponentIndex];
          onSwitchIn(makeBattleCtx(field, log, partyData[partyIndex], nextEnemy, turn, partyData, opponents), nextEnemy, 'enemy', (text) => log.push(`↳ ${text}`));
        }
      }
      const player = partyData[partyIndex];
      if (player && player.hp <= 0) {
        log.push(`💫 ${player.name} fainted!`);
        partyIndex = partyData.findIndex((pokemon) => pokemon.hp > 0);
        if (partyIndex >= 0) {
          const nextPlayer = partyData[partyIndex];
          onSwitchIn(makeBattleCtx(field, log, nextPlayer, opponents[opponentIndex] || enemy, turn, partyData, opponents), nextPlayer, 'player', (text) => log.push(`↳ ${text}`));
        }
      }

      const won = opponentIndex >= opponents.length;
      const lost = partyIndex < 0;
      if (won) {
        const isRematch = challenge.special || challengeIndex < getLeagueProgress(userId).cleared_challenges;
        let rematchCoins = 0;
        let rematchItem = null;
        let voloCoins = 0;
        let voloItem = null;
        if (challenge.volo) {
          voloCoins = awardCoinsWithBoost(userId, 5000 + Math.floor(Math.random() * 10001)).finalAmount;
          const voloDrops = [
            ['rare_candies', 2, 'Rare Candy'],
            ['ultraballs', 3, 'Ultraball'],
            ['masterballs', 1, 'Masterball'],
            ['lootboxes', 1, 'Lootbox'],
          ];
          if (Math.random() < 0.4) voloItem = voloDrops[Math.floor(Math.random() * voloDrops.length)];
        }
        if (isRematch) {
          rematchCoins = challenge.special ? 0 : Math.max(1, Math.floor(challenge.reward * 0.5));
          if (!challenge.special && Math.random() < 0.25) {
            const drops = [
              ['greatballs', 3, 'Greatball'],
              ['ultraballs', 2, 'Ultraball'],
              ['rare_candies', 1, 'Rare Candy'],
              ['lootboxes', 1, 'Lootbox'],
            ];
            rematchItem = drops[Math.floor(Math.random() * drops.length)];
          }
        }
        const reward = challenge.special
          ? 0
          : isRematch
            ? awardCoinsWithBoost(userId, rematchCoins).finalAmount
            : clearLeagueChallenge(userId, challengeIndex, challenge.reward);
        if (reward === false) {
          log.push('Your league progress changed during battle; this challenge was not counted twice.');
          resultSummary = '🏆 **Victory!** Your league progress changed during battle, so no rewards were granted.';
        } else {
          incrementUser(userId, {
            battles_won: 1,
            cl_battles: 1,
            ...(rematchItem ? { [rematchItem[0]]: rematchItem[1] } : {}),
            ...(voloItem ? { [voloItem[0]]: voloItem[1] } : {}),
          });
          const factionPointsAwarded = challenge.factionNpc
            ? addFactionPoints(userId, 1000 + Math.floor(Math.random() * 9001))
            : 0;
          const npcExperience = 200 + Math.floor(Math.random() * 1801);
          const npcExperienceResult = awardCatchExperience(userId, npcExperience);
          const normalizedChallengeName = challenge.name.toLowerCase();
          const battleCategories = [];
          if (normalizedChallengeName.includes('gym')) {
            battleCategories.push('gym_leader', 'basic_challenger');
          }
          if (normalizedChallengeName.includes('elite four')) {
            battleCategories.push('elite_four', 'boss_challenger');
          }
          if (normalizedChallengeName.includes('champion')) {
            battleCategories.push('champion', 'master_challenger');
          }
          const completedQuests = advanceQuestProgress(userId, {
            battleWins: 1,
            battleCategories,
          });
          announceQuestCompletions(userId, message.channel, completedQuests);
          log.push(challenge.volo
            ? `🏆 **${challenge.name} defeated!** You earned ${EMOJIS.pokecoin} **${voloCoins.toLocaleString()} PokéCoins**` +
              `${voloItem ? ` and **${voloItem[1]}x ${voloItem[2]}**` : ''}.`
            : challenge.factionNpc
              ? `🏆 **${challenge.name} defeated!** You earned **${factionPointsAwarded.toLocaleString()} faction points**.`
            : isRematch
              ? `🏆 **Rematch won!** You earned ${EMOJIS.pokecoin} **${rematchCoins.toLocaleString()} PokéCoins**` +
                `${rematchItem ? ` and **${rematchItem[1]}x ${rematchItem[2]}**` : ''}.`
              : `🏆 **Challenge cleared!** You earned ${EMOJIS.pokecoin} **${reward.toLocaleString()} PokéCoins**.`);
          if (challenge.factionNpc) {
            resultSummary =
              `🏆 **Victory!**\nYou defeated **${challenge.name}**.\n` +
              `${getUserFaction(userId).team.emoji} Earned **${factionPointsAwarded.toLocaleString()} faction points**.`;
          } else {
            const awardedCoins = challenge.volo ? voloCoins : reward;
            resultSummary =
              `🏆 **Victory!**\n` +
              `${EMOJIS.pokecoin} Earned **${awardedCoins.toLocaleString()} PokéCoins**` +
              `${rematchItem ? ` and **${rematchItem[1]}x ${rematchItem[2]}**` : ''}` +
              `${voloItem ? ` and **${voloItem[1]}x ${voloItem[2]}**` : ''}.`;
          }
          if (npcExperienceResult.awarded) {
            log.push(`✨ Your Buddy and Exp. Share team earned **${npcExperience.toLocaleString()} EXP**.`);
            resultSummary += `\n✨ Buddy and eligible Exp. Share Pokémon earned **${npcExperience.toLocaleString()} EXP**.`;
          }
          const challengeIconIndex = challenge.special
            ? NPC_CAMPAIGN.length + NPC_SPECIAL_BATTLES.indexOf(challenge)
            : challengeIndex;
          const canDropIcon = (challenges === NPC_CAMPAIGN || challenge.special)
            && challengeIconIndex >= 0;
          let unlockedIconIndex = null;
          if (canDropIcon) {
            unlockedIconIndex = grantGuaranteedBattleIconDrop(
              userId,
              challengeIconIndex,
              NPC_CAMPAIGN.length + NPC_SPECIAL_BATTLES.length
            );
            if (unlockedIconIndex === null
                && Math.random() < NPC_ICON_DROP_CHANCE
                && unlockBattleIcon(userId, challengeIconIndex)) {
              unlockedIconIndex = challengeIconIndex;
            }
          }
          if (unlockedIconIndex !== null) {
            log.push(`🆕 **Icon unlocked!** ${getNpcTrainerName(unlockedIconIndex)}'s battle icon dropped! View it with \`${PREFIX}battle icons\`.`);
            const iconQuests = advanceQuestProgress(userId, {
              battleCategories: ['battle_icon'],
            });
            announceQuestCompletions(userId, message.channel, iconQuests);
            resultSummary += `\n🆕 Unlocked ${getNpcTrainerName(unlockedIconIndex)}'s battle icon.`;
          }
        }
      } else if (lost) {
        incrementUser(userId, { battles_lost: 1 });
        log.push('💀 **You were defeated.** Train your team and challenge again.');
        resultSummary = '💀 **Defeat.** No rewards were earned.';
      }
      finished = won || lost;
      if (finished) {
        trackClanActivity(userId, 'battle');
        rollActivityPromoDrops(interaction.user, interaction.guild, interaction.channel, 'battle');
      }
      await interaction.editReply({
        embeds: [battleEmbed(finished, won)],
        components: finished
          ? []
          : battleComponents(),
      });
      actionInProgress = false;
      if (finished) {
        activeLeagueBattles.delete(battleMessage.id);
        collector.stop('finished');
      }
      else collector.resetTimer();
    } catch (error) {
      actionInProgress = false;
      console.error(`Failed to process league battle for user ${userId}:`, error);
      await replyToInteractionFailure(interaction, 'The league battle could not be processed.', 'league battle');
      collector.stop('error');
    }
  };
  activeLeagueBattles.set(battleMessage.id, handleMove);
  collector.on('end', async (_, reason) => {
    activeLeagueBattles.delete(battleMessage.id);
    if (reason !== 'time') return;
    resultSummary = '⏳ The battle timed out. No rewards were earned.';
    try {
      await battleMessage.edit({
        embeds: [battleEmbed(true, false)],
        components: [],
      });
    } catch (error) {
      console.error(`Failed to close expired league battle for user ${userId}:`, error);
    }
  });
}

function makeEmbed(title, description, color = 0x3498db) {
  const embed = new EmbedBuilder().setColor(color).setTitle(title);
  if (description) embed.setDescription(description);
  return embed;
}

const MOVES_PER_PAGE = 10;

function createBuddyMovesEmbed(buddy, learnsetData, equippedMoves, page = 0, moveChangeCost = 50000) {
  const availableMoveSlots = Math.min(4, learnsetData.moves.length);
  const moveLine = (moveName) => {
    const move = getPokemonMove(moveName);
    return move
      ? `• **${move.name}** — ${getTypeEmoji(move.type)} ${move.type} • ${move.power ? `Power ${move.power}` : 'Status'} • Accuracy ${move.accuracy}%`
      : `• ${moveName}`;
  };
  return new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`${buddy.is_shiny ? '✨ ' : ''}${buddy.display_name || buddy.name} — Moves`)
    .setDescription(
      `**Equipped moves**\n${equippedMoves.length ? equippedMoves.map(moveLine).join('\n') : 'No moves are available.'}\n\n` +
      `**Learnable moves** (${learnsetData.moves.length})\n${learnsetData.moves.slice(page * MOVES_PER_PAGE, (page + 1) * MOVES_PER_PAGE).map(moveLine).join('\n') || 'No moves found.'}\n\n` +
      (availableMoveSlots
        ? `Change a move while this Pokémon is your buddy: \`${PREFIX}move replace <equipped move|slot> <new move>\` ` +
          `(${EMOJIS.pokecoin} **${moveChangeCost.toLocaleString()}**); swap equipped slots with ` +
          `\`${PREFIX}move swap <slot> <slot>\`.`
        : 'This buddy has no moves available to change.')
    )
    .setFooter({ text: `Page ${page + 1}/${Math.max(1, Math.ceil(learnsetData.moves.length / MOVES_PER_PAGE))} • Pokémon can only use moves from their species learnset.` });
}

const activeTradeLocks = new Set();

function findTradeCatch(ownerId, spec) {
  let isShiny = Boolean(spec.isShiny);
  let isGolden = Boolean(spec.isGolden);
  let form;
  if (spec.dexNumber && isGoldenDexNumber(spec.dexNumber)) {
    form = db.prepare('SELECT * FROM pokemon_forms ORDER BY species_id, id').all()
      .find((pokemon) => isGoldenFormSupported(pokemon.species_id, pokemon.slug, Boolean(pokemon.is_default))
        && getGoldenDexNumber(pokemon.species_id, pokemon.slug) === spec.dexNumber);
    isGolden = true;
  } else if (spec.dexNumber) {
    form = resolvePokemonForm(spec.query);
    if (form) {
      const allForms = db.prepare('SELECT * FROM pokemon_forms ORDER BY species_id, id').all();
      const numbers = getPokemonDexNumbers(allForms).get(form.id);
      // A number that is only the shiny dex number refers to the shiny variant.
      isShiny = numbers?.dexNumber !== spec.dexNumber && numbers?.shinyDexNumber === spec.dexNumber;
    }
  } else {
    form = resolvePokemonForm(spec.query);
  }
  if (!form) return null;
  return db.prepare(`
    SELECT * FROM catches
    WHERE user_id = ? AND in_team = 0 AND pokemon_id = ? AND is_shiny = ? AND is_golden = ?
    ORDER BY id LIMIT 1
  `).get(ownerId, form.id, isShiny ? 1 : 0, isGolden ? 1 : 0) || null;
}

function sendTradeHelp(message) {
  return message.reply({
    embeds: [new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('Trade command')
      .setDescription(
        `**Command:** \`${PREFIX}trade\`\n` +
        '**Description:** Trade Pokémon with other users 🤝\n' +
        '**Aliases:** tr\n\n' +
        '**Command Usage:**\n' +
        `\`${PREFIX}trade {@user} {your Pokémon name|Pokédex number} {their Pokémon name|Pokédex number}\`\n` +
        `Or offer one Pokémon with \`${PREFIX}trade @User <Pokémon name|Pokédex number>\` and let the recipient reply with theirs.\n\n` +
        `${EMOJIS.shiny} **Shiny Pokémon:** write the name in 1 word, e.g. \`shinybulbasaur\`\n` +
        `**Example:** \`${PREFIX}trade @User mew shinybulbasaur\`\n\n` +
        `${EMOJIS.golden} **Golden Pokémon:** e.g. \`goldenbulbasaur\`\n` +
        `**Example:** \`${PREFIX}trade @User mew goldenbulbasaur\`\n\n` +
        `${EMOJIS.mega} **Mega Pokémon:** e.g. \`mega-charizard-x\` or \`shinymega-charizard-x\`\n` +
        `**Example:** \`${PREFIX}trade @User mew mega-venusaur\`\n\n` +
        'Pokémon on your active team cannot be traded.'
      )],
  });
}

async function handleNameTrade(message, userId, targetUser, yourArg, theirArg) {
  if (activeTradeLocks.has(userId) || activeTradeLocks.has(targetUser.id)) {
    return message.reply('⏳ One of the trainers is already in an active trade.');
  }
  const yourSpec = parseTradeMonInput(yourArg);
  const theirSpec = parseTradeMonInput(theirArg);
  if (!yourSpec || !theirSpec) return sendTradeHelp(message);

  const yourMon = findTradeCatch(userId, yourSpec);
  if (!yourMon) {
    return message.reply(`❌ You don't have **${yourArg}** available in your box (or it is on your active team).`);
  }
  const theirMon = findTradeCatch(targetUser.id, theirSpec);
  if (!theirMon) {
    return message.reply(`❌ <@${targetUser.id}> doesn't have **${theirArg}** available to trade.`);
  }

  activeTradeLocks.add(userId);
  activeTradeLocks.add(targetUser.id);
  const describe = (mon) =>
    `${mon.is_shiny ? `${EMOJIS.shiny} ` : ''}${mon.is_golden ? `${EMOJIS.golden} ` : ''}**${mon.name}** (Lv. ${mon.level})`;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('trade_accept').setLabel('Accept').setStyle(ButtonStyle.Success).setEmoji('✅'),
    new ButtonBuilder().setCustomId('trade_decline').setLabel('Decline').setStyle(ButtonStyle.Danger).setEmoji('❌')
  );
  const tradeMessage = await message.channel.send({
    content: `<@${targetUser.id}>, you have a trade request from <@${userId}>!`,
    embeds: [makeEmbed(
      '🤝 Trade Offer Pending Confirmation',
      `**${message.author.username}** offers:\n└ ${describe(yourMon)}\n\n` +
      `**${targetUser.username}** offers:\n└ ${describe(theirMon)}\n\n` +
      '*Both trainers must click Accept. The offer expires in 60 seconds.*'
    )],
    components: [row],
    allowedMentions: { users: [targetUser.id] },
  });

  const accepted = new Set();
  const collector = tradeMessage.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 60000,
  });
  collector.on('collect', async (interaction) => {
    if (interaction.user.id !== userId && interaction.user.id !== targetUser.id) {
      await interaction.reply({ content: 'You are not part of this trade.', ephemeral: true });
      return;
    }
    if (interaction.customId === 'trade_decline') {
      collector.stop('declined');
      await interaction.update({
        content: `❌ The trade was cancelled by <@${interaction.user.id}>.`,
        embeds: [],
        components: [],
      });
      return;
    }
    accepted.add(interaction.user.id);
    if (accepted.size < 2) {
      await interaction.reply({ content: `✅ <@${interaction.user.id}> accepted! Waiting for the other trainer...` });
      return;
    }

    const swapped = db.transaction(() => {
      const stillYours = db.prepare(
        'SELECT id FROM catches WHERE id = ? AND user_id = ? AND in_team = 0'
      ).get(yourMon.id, userId);
      const stillTheirs = db.prepare(
        'SELECT id FROM catches WHERE id = ? AND user_id = ? AND in_team = 0'
      ).get(theirMon.id, targetUser.id);
      if (!stillYours || !stillTheirs) return false;
      db.prepare('UPDATE catches SET user_id = ? WHERE id = ?').run(targetUser.id, yourMon.id);
      db.prepare('UPDATE catches SET user_id = ? WHERE id = ?').run(userId, theirMon.id);
      db.prepare('UPDATE users SET buddy_catch_id = NULL WHERE buddy_catch_id IN (?, ?)')
        .run(yourMon.id, theirMon.id);
      syncNewCatchState(targetUser.id, yourMon.id);
      syncNewCatchState(userId, theirMon.id);
      return true;
    }).immediate();

    collector.stop('completed');
    if (!swapped) {
      await interaction.update({
        content: '❌ One or both Pokémon are no longer available. Trade cancelled.',
        embeds: [],
        components: [],
      });
      return;
    }
    await interaction.update({
      content: '',
      embeds: [makeEmbed(
        '🤝 Trade Complete!',
        `• <@${userId}> received ${describe(theirMon)}\n• <@${targetUser.id}> received ${describe(yourMon)}`,
        0x2ecc71
      )],
      components: [],
    });
  });
  collector.on('end', () => {
    activeTradeLocks.delete(userId);
    activeTradeLocks.delete(targetUser.id);
    tradeMessage.edit({ components: [] }).catch(() => {});
  });
}

async function handleTrade(message, userId, args) {
  const targetUser = message.mentions.users.first();
  if (!args.length || args[0].toLowerCase() === 'help') return sendTradeHelp(message);
  if (targetUser && args.length >= 3) {
    if (targetUser.id === userId || targetUser.bot) {
      return message.reply("❌ Please mention a different, real trainer to trade with.");
    }
    return handleNameTrade(message, userId, targetUser, args[1], args[2]);
  }
  if (!targetUser || targetUser.id === userId || targetUser.bot) {
    return message.reply(`Please mention a valid player: \`${PREFIX}trade @User <your Pokémon name|Pokédex number>\`.`);
  }

  const offeredQuery = args.slice(1).join(' ');
  const offeredMatches = findUserPokemonMatches(userId, offeredQuery);
  if (!offeredMatches.length) {
    return message.reply(`You do not have a Pokémon matching **${offeredQuery}** in your box.`);
  }
  const offeredCatch = offeredMatches.find((pokemon) => !pokemon.in_team);
  if (!offeredCatch) {
    return message.reply('You cannot trade a Pokémon that is currently in your active team!');
  }

  await message.channel.send({
    embeds: [makeEmbed(
      '🤝 Trade Request',
      `<@${userId}> offers **${offeredCatch.is_shiny ? '✨ ' : ''}${offeredCatch.name}** ` +
      `(Lv. ${offeredCatch.level}) to <@${targetUser.id}>.\n\n` +
      `Reply with your Pokémon's name or Pokédex number, or \`cancel\`, within 30 seconds.`
    )],
  });

  let response;
  try {
    const collected = await message.channel.awaitMessages({
      filter: (candidate) => candidate.author.id === targetUser.id,
      max: 1,
      time: 30000,
      errors: ['time'],
    });
    response = collected.first().content.trim();
  } catch (error) {
    if (error.code !== 'time') throw error;
    return message.channel.send(`⏰ Trade expired. <@${targetUser.id}> took too long to offer a Pokémon.`);
  }

  if (response.toLowerCase() === 'cancel') {
    return message.channel.send('❌ Trade was cancelled by the recipient.');
  }
  const requestedMatches = findUserPokemonMatches(targetUser.id, response);
  if (!requestedMatches.length) {
    return message.channel.send(`<@${targetUser.id}> does not own a Pokémon matching **${response}**.`);
  }
  const requestedCatch = requestedMatches.find((pokemon) => !pokemon.in_team);
  if (!requestedCatch) {
    return message.channel.send('That Pokémon is on the active team and cannot be traded!');
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('confirm_trade').setLabel('Accept Trade').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('cancel_trade').setLabel('Decline').setStyle(ButtonStyle.Danger)
  );
  const review = await message.channel.send({
    embeds: [makeEmbed(
      '🤝 Confirm Trade',
      `Both trainers must accept:\n\n` +
      `• <@${userId}> gives **${offeredCatch.is_shiny ? '✨ ' : ''}${offeredCatch.name}** ` +
      `(Lv. ${offeredCatch.level})\n` +
      `• <@${targetUser.id}> gives **${requestedCatch.is_shiny ? '✨ ' : ''}${requestedCatch.name}** ` +
      `(Lv. ${requestedCatch.level})`
    )],
    components: [row],
  });

  const accepted = new Set();
  let completed = false;
  const collector = review.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 30000,
  });

  collector.on('collect', async (interaction) => {
    if (interaction.user.id !== userId && interaction.user.id !== targetUser.id) {
      await interaction.reply({ content: 'You are not part of this trade!', ephemeral: true });
      return;
    }
    if (interaction.customId === 'cancel_trade') {
      collector.stop('cancelled');
      await interaction.reply({ content: 'Trade cancelled.' });
      return;
    }

    accepted.add(interaction.user.id);
    await interaction.reply({ content: '✅ You accepted the trade!' });
    if (accepted.size !== 2 || completed) return;
    completed = true;
    collector.stop('completed');

    const result = db.transaction(() => {
      const senderStillOwns = db.prepare(
        'SELECT id FROM catches WHERE id = ? AND user_id = ? AND in_team = 0'
      ).get(offeredCatch.id, userId);
      const recipientStillOwns = db.prepare(
        'SELECT id FROM catches WHERE id = ? AND user_id = ? AND in_team = 0'
      ).get(requestedCatch.id, targetUser.id);
      if (!senderStillOwns || !recipientStillOwns) return false;

      db.prepare('UPDATE catches SET user_id = ? WHERE id = ?').run(targetUser.id, offeredCatch.id);
      db.prepare('UPDATE catches SET user_id = ? WHERE id = ?').run(userId, requestedCatch.id);
      db.prepare('UPDATE users SET buddy_catch_id = NULL WHERE buddy_catch_id IN (?, ?)')
        .run(offeredCatch.id, requestedCatch.id);
      syncNewCatchState(targetUser.id, offeredCatch.id);
      syncNewCatchState(userId, requestedCatch.id);
      return true;
    }).immediate();

    if (!result) {
      await message.channel.send('❌ A Pokémon changed owners or teams before the trade completed. Trade aborted.');
      return;
    }
    await message.channel.send({
      embeds: [makeEmbed(
        '🎉 Trade Successful!',
        `• <@${userId}> received ${formatPokemonReward(requestedCatch)}\n` +
        `• <@${targetUser.id}> received ${formatPokemonReward(offeredCatch)}`,
        0x2ecc71
      )],
    });
  });

  collector.on('end', (_, reason) => {
    if (reason === 'time' && accepted.size < 2) {
      message.channel.send('⏰ Trade confirmation timed out.').catch(console.error);
    }
  });
}

async function handleEventCommand(message, userId, args, checklistOnly = false) {
  const user = getUser(userId);
  const subcommand = checklistOnly ? 'cl' : args[0]?.toLowerCase();
  const eventProgress = getUserEventProgress(halloweenEvent.id, userId);
  const eventCatchCounts = getUserEventCatchCounts(halloweenEvent.id, userId);
  const fullChecklistCount = halloweenEvent.pokemon.length;
  const eventOpen = isEventOpen(halloweenEvent);
  const eventLinkRow = createEventLinkRow(halloweenEvent);
  const eventLinkNotice = eventLinkRow
    ? ''
    : '\n\nEvent support and gift links are not configured.';

  if (subcommand === 'buy' && !checklistOnly) {
    if (!eventOpen) return message.reply(`${halloweenEvent.emojis.ticket} **${halloweenEvent.name}** is not currently active.`);
    const itemName = args.slice(1).join(' ').toLowerCase();
    const lastArgument = args.at(-1) || '';
    const hasExplicitQuantity = args.length > 2 && !Number.isNaN(parseAmount(lastArgument));
    const amount = hasExplicitQuantity ? parseAmount(lastArgument) : 1;
    const normalizedItem = hasExplicitQuantity ? args.slice(1, -1).join(' ').toLowerCase() : itemName;
    if (hasExplicitQuantity && (!Number.isSafeInteger(amount) || amount <= 0)) {
      return message.reply('Specify a valid positive purchase amount.');
    }
    if (!normalizedItem) {
      return message.reply('Usage: `.events buy ticket` or `.events buy premierball <amount>`');
    }

    if (['1', 'ticket', 'event ticket'].includes(normalizedItem)) {
      if (user.event_ticket) return message.reply(`${halloweenEvent.emojis.ticket} Your **Event Ticket** is already active!`);
      const purchased = db.transaction(() => {
        const currentUser = getUser(userId);
        if (currentUser.event_ticket || currentUser.coins < halloweenEvent.ticketPrice) return false;
        incrementUser(userId, { coins: -halloweenEvent.ticketPrice, events_joined: 1 });
        updateUser(userId, { event_ticket: 1 });
        return true;
      }).immediate();
      if (!purchased) return message.reply(`❌ You need ${halloweenEvent.emojis.pokecoin} **${halloweenEvent.ticketPrice.toLocaleString()} PokéCoins** to buy an Event Ticket.`);
      return message.reply(`${halloweenEvent.emojis.ticket} You bought an **Event Ticket**! Your ticket is now active.`);
    }

    if (['2', 'premierball', 'premierballs', 'prb'].includes(normalizedItem)) {
      const cost = halloweenEvent.premierballPrice * amount;
      if (!Number.isSafeInteger(cost)) return message.reply('That purchase amount is too large.');
      const purchased = db.transaction(() => {
        const currentUser = getUser(userId);
        if (currentUser.coins < cost) return false;
        incrementUser(userId, { coins: -cost, premierballs: amount });
        return true;
      }).immediate();
      if (!purchased) return message.reply(`❌ You need ${halloweenEvent.emojis.pokecoin} **${cost.toLocaleString()} PokéCoins** for ${amount} Premierball(s).`);
      return message.reply(`✅ Purchased ${amount}x ${halloweenEvent.emojis.premierball} **Premierball** for ${halloweenEvent.emojis.pokecoin} **${cost.toLocaleString()} PokéCoins**!`);
    }

    return message.reply('Invalid event item. Use `.events buy ticket` or `.events buy premierball <amount>`.');
  }

  if (subcommand === 'cl' || checklistOnly) {
    if (args[checklistOnly ? 0 : 1]?.toLowerCase() === 'claim' && !user.event_ticket) {
      return message.reply(`${halloweenEvent.emojis.ticket} You need an active Event Ticket to claim rewards. Get one with \`.events buy ticket\`.`);
    }

    if (args[checklistOnly ? 0 : 1]?.toLowerCase() === 'claim') {
      const rewardTier = db.transaction(() => {
        const currentUser = getUser(userId);
        if (!currentUser.event_ticket) return null;
        const caughtCount = db.prepare(
          'SELECT COUNT(*) AS count FROM event_catches WHERE event_id = ? AND user_id = ?'
        ).get(halloweenEvent.id, userId).count;
        if (caughtCount >= fullChecklistCount && !currentUser.event_gold_claimed) {
          return 'full';
        }
        if (caughtCount >= halloweenEvent.checklistTargets.regular && !currentUser.event_reg_claimed) {
          return 'regular';
        }
        return null;
      })();
      if (!rewardTier) {
        return message.reply('❌ No checklist reward is ready to claim. Check your progress with `.e cl`.');
      }

      const reward = halloweenEvent.rewards[rewardTier];
      const species = getPokemonFormBySlug(reward.pokemonSlug);
      if (!species) throw new Error(`Event reward form "${reward.pokemonSlug}" is missing from the Pokémon catalog.`);
      const claimed = db.transaction(() => {
        const currentUser = getUser(userId);
        const caughtCount = db.prepare(
          'SELECT COUNT(*) AS count FROM event_catches WHERE event_id = ? AND user_id = ?'
        ).get(halloweenEvent.id, userId).count;
        const claimColumn = rewardTier === 'full' ? 'event_gold_claimed' : 'event_reg_claimed';
        const target = rewardTier === 'full'
          ? fullChecklistCount
          : halloweenEvent.checklistTargets.regular;
        if (!currentUser.event_ticket || currentUser[claimColumn] || caughtCount < target) return false;

        updateUser(userId, {
          [claimColumn]: 1,
        });
        saveCatch(userId, { ...species, name: reward.displayName }, reward.shiny);
        return true;
      }).immediate();
      if (!claimed) {
        return message.reply('❌ This event reward is no longer available to claim.');
      }
      if (rewardTier === 'full') {
        await announceEventChecklistCompletion(
          message.guild,
          message.author,
          { ...species, name: reward.announcementName, isShiny: reward.shiny },
          eventProgress.size,
          message.channel
        );
      }
      return message.reply(
        rewardTier === 'full'
          ? `${halloweenEvent.emojis.claimFull} **Golden Reward Claimed!** You completed all ${fullChecklistCount} event Pokémon and received ${formatPokemonReward({
            ...species,
            name: reward.announcementName,
            isShiny: reward.shiny,
          })}!`
          : `${halloweenEvent.emojis.claimRegular} **Checklist Reward Claimed!** You received ${formatPokemonReward({
            ...species,
            name: reward.announcementName,
            isShiny: reward.shiny,
          })}!`
      );
    }

    const shinyKeys = new Set(halloweenEvent.shinyChecklistKeys);
    const shinies = halloweenEvent.pokemon.filter((pokemon) => shinyKeys.has(pokemon.key));
    const exclusives = halloweenEvent.pokemon.filter((pokemon) => !shinyKeys.has(pokemon.key));
    const formatChecklist = (pokemon) => {
      const icon = eventProgress.has(pokemon.key)
        ? halloweenEvent.emojis.complete
        : halloweenEvent.emojis.incomplete;
      const caught = eventCatchCounts.get(pokemon.key) || 0;
      return `${icon} ${pokemon.name}${pokemon.tag ? ` ${pokemon.tag}` : ''} — **${caught}** caught`;
    };
    const description =
      `Catch **${halloweenEvent.checklistTargets.regular} of ${fullChecklistCount}** ` +
      'for the regular reward; complete all for the exclusive reward.\n\n' +
      `${halloweenEvent.emojis.event} Event progress: **${Math.min(eventProgress.size, fullChecklistCount)}/${fullChecklistCount}**\n\n` +
      `${halloweenEvent.emojis.shinyCategory} **Shinies (${shinies.filter((pokemon) => eventProgress.has(pokemon.key)).length}/${shinies.length})**\n` +
      `${shinies.map(formatChecklist).join('\n')}\n\n` +
      `${halloweenEvent.emojis.exclusiveCategory} **Event exclusives (${exclusives.filter((pokemon) => eventProgress.has(pokemon.key)).length}/${exclusives.length})**\n` +
      `${exclusives.map(formatChecklist).join('\n')}\n\n` +
      `${halloweenEvent.emojis.regularReward} **Shiny ${halloweenEvent.rewards.regular.announcementName}:** ${user.event_reg_claimed ? 'Claimed' : 'Unclaimed'}\n` +
      `${halloweenEvent.emojis.fullReward} **${halloweenEvent.rewards.full.announcementName}:** ${user.event_gold_claimed ? 'Claimed' : 'Unclaimed'}\n` +
      `${halloweenEvent.emojis.endDate} Ends <t:${Math.floor(Date.parse(halloweenEvent.endsAt) / 1000)}:F> (${halloweenEvent.timezoneLabel})`;
    const embed = new EmbedBuilder()
      .setColor(EVENT_EMBED_COLOR)
      .setAuthor({ name: `${halloweenEvent.name} Event Checklist`, iconURL: client.user.displayAvatarURL() })
      .setDescription(description);
    return message.reply({ embeds: [embed], components: eventLinkRow ? [eventLinkRow] : [] });
  }

  const ticketStatus = user.event_ticket
    ? '**ACTIVE** — good luck in the event!'
    : '**INACTIVE** — buy an Event Ticket below to participate.';
  const statusText = eventOpen
    ? `${halloweenEvent.emojis.endDate} Event ends <t:${Math.floor(Date.parse(halloweenEvent.endsAt) / 1000)}:F>.`
    : `Event is not active.`;
  const embed = new EmbedBuilder()
    .setColor(EVENT_EMBED_COLOR)
    .setTitle(`${halloweenEvent.emojis.ticket} ${halloweenEvent.name}`)
    .setDescription(
      `Your ${halloweenEvent.emojis.ticket} Event Ticket is ${ticketStatus}\n${statusText}\n\n` +
      `\`1\` ${halloweenEvent.emojis.ticket} **Event Ticket** — ${halloweenEvent.emojis.pokecoin} **${halloweenEvent.ticketPrice.toLocaleString()}**\n` +
      `\`2\` ${halloweenEvent.emojis.premierball} **Premierball** — ${halloweenEvent.emojis.pokecoin} **${halloweenEvent.premierballPrice.toLocaleString()} each**\n\n` +
      `${halloweenEvent.emojis.event} With an active ticket, each spawn has a **1 in ${EVENT_SPAWN_ODDS}** chance to be an event checklist Pokémon.\n` +
      'Use `.events buy ticket` to join or `.events buy premierball <amount>` to buy balls.\n' +
      'Use `.e cl` to view your checklist.' +
      eventLinkNotice
    );
  return message.reply({ embeds: [embed], components: eventLinkRow ? [eventLinkRow] : [] });
}

async function handleStatsCommand(message) {
  const target = message.mentions.users.first() || message.author;
  const summary = getUserStatsSummary(target.id);
  const user = summary.user;
  const targetMember = message.guild?.members.cache.get(target.id);
  const joinedTimestamp = user.joined_at || Date.now();
  if (!user.joined_at) {
    updateUser(target.id, { joined_at: joinedTimestamp });
  }
  const relativeDate = `<t:${Math.floor(joinedTimestamp / 1000)}:R>`;
  const targetFaction = getUserFaction(target.id);
  const factionLabel = targetFaction
    ? `${targetFaction.team.emoji} ${targetFaction.team.name} — ${FACTION_RANK_ICONS[targetFaction.rank] || ''} ${targetFaction.rank}`
    : 'None';
  const header =
    `**Trainer Icon:** ${getTrainerIconLabel(target.id)}\n` +
    `**Lifetime caught:** ${summary.lifetimeCaught.toLocaleString()}\n` +
    `**Unique Pokémon in box:** ${summary.uniqueInBox.toLocaleString()}\n` +
    `**Wild encounters:** ${(user.wild_encounters || 0).toLocaleString()}\n` +
    `**Faction:** ${factionLabel}\n` +
    `**Clan:** ${user.clan ? `🎖️ ${user.clan}` : 'None'}\n\n`;
  const statEmoji = (name, fallback) => {
    const found = client.emojis.cache.find((emoji) => emoji.name === name);
    return found ? found.toString() : fallback;
  };
  const catching =
    `${EMOJIS.pokeball} **Pokéballs used:** ${user.used_pokeballs}\n` +
    `${EMOJIS.greatball} **Greatballs used:** ${user.used_greatballs}\n` +
    `${EMOJIS.ultraball} **Ultraballs used:** ${user.used_ultraballs}\n` +
    `${EMOJIS.premierball} **Premierballs used:** ${user.used_premierballs}\n` +
    `${EMOJIS.masterball} **Masterballs used:** ${user.used_masterballs}\n` +
    `${EMOJIS.legendary} **Legendaries caught:** ${summary.legendariesCaught}\n` +
    `${EMOJIS.shiny} **Shinies caught:** ${summary.shiniesCaught}\n` +
    `${EMOJIS.golden} **Promos claimed:** ${user.promos_claimed}\n` +
    `${EMOJIS.pokecoin} **PokéCoins earned:** ${user.pkc_earned.toLocaleString()}`;
  const battling =
    `${DEFAULT_TRAINER_ICONS.brendan.emoji} **Icons unlocked:** ${user.icons_unlocked}\n` +
    `🏆 **Battles won:** ${user.battles_won}\n` +
    `💀 **Battles lost:** ${user.battles_lost}\n` +
    `⚡ **Max QB streak:** ${user.max_qb_streak}\n` +
    `⚔️ **Live wins/losses:** ${user.live_wins}/${user.live_losses}\n` +
    `${EMOJIS.megabracelet} **Mega Chambers won:** ${user.mega_chambers_won}\n` +
    `${WORLD_BOSS_EMOJI} **World Boss MVPs:** ${user.world_boss_mvps}\n` +
    `🗼 **Battle Tower wins:** ${user.battle_tower_wins}`;
  const items =
    `${EMOJIS.amuletcoin} **Amulet coins:** ${user.amulet_coins}\n` +
    `${EMOJIS.shinyCharm} **Shiny charms:** ${user.shiny_charms}\n` +
    `${LOOTBOX_EMOJI} **Lootboxes opened:** ${user.lootboxes_opened}\n` +
    `${EMOJIS.goldenRazz} **Golden Razz's used:** ${user.golden_razz_used}\n` +
    `${EMOJIS.repel} **Repels used:** ${user.repels_used}\n` +
    `${EMOJIS.rarecandy} **Rare candies used:** ${user.rare_candies_used}\n` +
    `${EMOJIS.pokeEgg} **Eggs hatched:** ${user.eggs_hatched}\n` +
    `${EMOJIS.incubator} **Incubators used:** ${user.incubators_used}\n` +
    `${statEmoji('superincubator', '🔬')} **Super incubators used:** ${user.super_incubators_used}\n` +
    `${EMOJIS.honey} **Honey used:** ${user.honey_used}\n` +
    `${EMOJIS.pokeradar} **Pokéradars used:** ${user.pokeradars_used}\n` +
    `${EMOJIS.eventvoucher} **Event vouchers used:** ${user.vouchers_used}`;
  const miscellaneous =
    `🤖 **CatchBot runs:** ${user.catchbot_runs}\n` +
    `⏰ **Dailies claimed:** ${user.dailies_claimed}\n` +
    `${EMOJIS.votecoin} **Votes claimed:** ${user.votes_claimed}\n` +
    `🔄 **Swaps done:** ${user.swaps_done}\n` +
    `${EMOJIS.oldrod} **Fish caught:** ${user.fishes_caught}\n` +
    `📋 **Quests completed:** ${user.quests_completed}\n` +
    `🎯 **Hunts completed:** ${user.hunts_completed}\n` +
    `🎫 **Lotteries won:** ${user.lotteries_won}\n` +
    `${EMOJIS.eventticket} **Events joined:** ${user.events_joined}\n` +
    `💻 **Codes earned:** ${user.codes_earned}\n` +
    `⚖️ **Auctions won:** ${user.auctions_won}\n` +
    `🍰 **Joined:** ${relativeDate}`;

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setAuthor({
      name: `${target.username}'s Stats`,
      iconURL: target.displayAvatarURL(),
    })
    .setThumbnail('https://cdn-icons-png.flaticon.com/512/1372/1372789.png')
    .setDescription(
      `${header}` +
      `${EMOJIS.dxpticket} **DXP:** No \`/doubleexp\` tickets used.\n\u200B`
    )
    .addFields(
      { name: '__Catching stats__', value: catching, inline: true },
      { name: '__Battling stats__', value: battling, inline: true },
      { name: '\u200B', value: '\u200B', inline: false },
      { name: '__Item stats__', value: items, inline: true },
      { name: '__Miscellaneous stats__', value: miscellaneous, inline: true }
    )
    .setFooter({ text: `View ${target.username}'s profile with .profile ${target.id}` })
    .setTimestamp();
  return message.reply({ embeds: [embed] });
}

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  if (interaction.customId === 'ga_enter' || interaction.customId === 'ga_leave') {
    try {
      await handleGiveawayEntry(interaction);
    } catch (error) {
      console.error('Failed to process giveaway participation:', error);
    }
    return;
  }
  const isCatch = interaction.customId.startsWith('catch:');
  const isDexForm = interaction.customId.startsWith('dex:');
  const isLeagueMove = interaction.customId.startsWith('league:move:')
    || interaction.customId.startsWith('league:switch:')
    || interaction.customId === 'league:forfeit';
  const isChamberMove = interaction.customId.startsWith('chamber:move:')
    || interaction.customId.startsWith('chamber:switch:')
    || interaction.customId === 'chamber:forfeit';
  const isSparMove = interaction.customId.startsWith('spar:move:')
    || interaction.customId.startsWith('spar:switch:')
    || interaction.customId === 'spar:forfeit';
  const isWorldBossMove = interaction.customId.startsWith('worldboss:');
  if (isSparMove) {
    const sparHandler = activeSparBattles.get(interaction.message.id);
    if (sparHandler) return sparHandler(interaction);
    await replyToInteractionFailure(
      interaction,
      'This player battle has expired. Start another with `.b user <@user|id>`.',
      'expired player battle'
    );
    return;
  }
  if (!isCatch && !isDexForm && !isLeagueMove && !isChamberMove && !isWorldBossMove) return;
  if (isWorldBossMove && !activeWorldBossBattles.has(interaction.message.id)) {
    // Public battle panels are replies, so Discord records who opened them.
    const panelOwnerId = interaction.message.interactionMetadata?.user?.id
      ?? interaction.message.interaction?.user?.id;
    if (panelOwnerId && panelOwnerId !== interaction.user.id) {
      await replyToInteractionFailure(
        interaction,
        'This is not your battle panel. Use `.wb fight` to open your own.',
        'World Boss panel owner check'
      );
      return;
    }
  }
  const handler = isCatch
    ? activeCatchEncounters.get(interaction.message.id)
    : isDexForm
      ? activeDexEntries.get(interaction.message.id)
      : isLeagueMove
        ? activeLeagueBattles.get(interaction.message.id)
        : isChamberMove
          ? activeMegaChamberBattles.get(interaction.message.id)
          : activeWorldBossBattles.get(interaction.message.id)
            || activeWorldBossRaidHandlers.get(`${interaction.customId.split(':')[2]}:${interaction.user.id}`);
  if (handler) return handler(interaction);
  const actionName = isCatch
    ? 'catch-button'
    : isDexForm
      ? 'Pokédex form button'
      : isLeagueMove
        ? 'league move-button'
        : isChamberMove
          ? 'Mega Chamber move-button'
          : 'World Boss move-button';
  await replyToInteractionFailure(
    interaction,
    isCatch
      ? 'This encounter has expired. Start a new one with `.p` or `.f`.'
      : isDexForm
        ? 'This Pokédex entry has expired. Run `.dex` again to browse its forms.'
        : isLeagueMove
          ? 'This NPC battle has expired. Check your next opponent with `.battle npc list`.'
          : isChamberMove
            ? 'This Mega Chamber battle has expired. Start another with `.mc battle <chamber>`.'
            : 'This World Boss panel is outdated. Use `.wb` to view the active raid.',
    `expired ${actionName}`
  );
});

const GIVEAWAY_MAX_MINUTES = 7 * 24 * 60;
const giveawayTimers = new Map();

function formatGiveawayRewards(prizeData) {
  const lines = [];
  if (prizeData.coins) lines.push(`${EMOJIS.pokecoin} **${prizeData.coins.toLocaleString()} PokéCoins**`);
  if (prizeData.pokemon) {
    const { name, rarity, isShiny, isGolden } = prizeData.pokemon;
    const emoji = getRarityEmojis(rarity, name, isShiny);
    if (isGolden) lines.push(`${EMOJIS.golden} **Golden ${name}**`);
    else lines.push(`${emoji ? `${emoji} ` : ''}**${isShiny ? '✨ Shiny ' : ''}${name}**`);
  }
  for (const [item, quantity] of Object.entries(prizeData.items || {})) {
    const emoji = EVOLUTION_ITEMS[item]?.emoji
      || BOXES[item]?.emoji
      || {
        Lootbox: LOOTBOX_EMOJI,
        Masterball: EMOJIS.masterball,
        Diveball: EMOJIS.diveball,
        'Rare Candy': EMOJIS.rarecandy,
        'Poké Lure': EMOJIS.pokeLure,
        "Misty's Lure": EMOJIS.mistysLure,
        'Swap Ticket': '🎟️',
      }[item]
      || findPromoByItemName(item)?.itemEmoji
      || '📦';
    lines.push(`${emoji} **${quantity}x ${item}**`);
  }
  return lines.join('\n');
}

function formatGiveawayEntrants(giveawayId) {
  const entrants = db.prepare(
    'SELECT user_id, username FROM giveaway_entries WHERE giveaway_id = ? ORDER BY rowid'
  ).all(giveawayId);
  if (!entrants.length) return '*No entries yet.*';
  const shown = entrants.slice(0, 50).map((entry) =>
    entry.username ? `\`${entry.username}\`` : `<@${entry.user_id}>`
  );
  const suffix = entrants.length > 50 ? `, and **${entrants.length - 50}** more` : '';
  return shown.join(', ') + suffix;
}

function getGiveawayPokemonSprite(prizeData) {
  const pokemon = prizeData?.pokemon;
  if (!pokemon || !Number.isSafeInteger(pokemon.id)) return null;
  const form = db.prepare('SELECT id, species_id, slug, sprite, shiny_sprite FROM pokemon_forms WHERE id = ?')
    .get(pokemon.id);
  if (!form) return null;
  if (pokemon.isGolden) return getGoldenSpriteUrl(form.species_id, form.slug);
  return getPokemonShowdownSprite(
    form.slug,
    Boolean(pokemon.isShiny),
    pokemon.isShiny ? (form.shiny_sprite || form.sprite) : form.sprite
  );
}

// The active promo items (promo.json) are valid prizes backed by user_items rows.
function isPromoItemName(query) {
  return Boolean(findPromoByItemName(query));
}

const GIVEAWAY_ITEM_COLUMNS = {
  Lootbox: 'lootboxes',
  Masterball: 'masterballs',
  'Rare Candy': 'rare_candies',
};

const ENCOUNTER_BOOST_ROLE_ID = '1560407313251180585';
const ENCOUNTER_BOOST_GUILD_ID = '1560102297198006274';
const ROLE_ENCOUNTER_BOOST_PERCENT = 5;
async function getRoleEncounterBoost(userId) {
  const guild = client.guilds.cache.get(ENCOUNTER_BOOST_GUILD_ID);
  if (!guild) {
    throw new Error(`Booster server ${ENCOUNTER_BOOST_GUILD_ID} is unavailable.`);
  }
  try {
    const member = await guild.members.fetch({ user: userId, force: false });
    return member.roles.cache.has(ENCOUNTER_BOOST_ROLE_ID)
      ? ROLE_ENCOUNTER_BOOST_PERCENT
      : 0;
  } catch (error) {
    if (error.code === 10007) return 0;
    throw error;
  }
}

const WORLD_BOSS_PING_ROLE_ID = '1560108658010890380';

// Highest tier first so the best role a member holds wins.
const PATREON_TIER_ROLES = [
  { key: 'golden', name: 'Golden', roleId: '1560711296884670525' },
  { key: 'shiny', name: 'Shiny', roleId: '1560705084919386243' },
  { key: 'legendary', name: 'Legendary', roleId: '1560704923761643642' },
  { key: 'superRare', name: 'Super Rare', roleId: '1560704707855392889' },
  { key: 'rare', name: 'Rare', roleId: '1560704667351126056' },
  { key: 'uncommon', name: 'Uncommon', roleId: '1560704601584308234' },
  { key: 'common', name: 'Common', roleId: '1560704520420597910' },
];

const patreonTierSyncedAt = new Map();

function syncPatreonTier(userId, roles) {
  const tier = PATREON_TIER_ROLES.find(({ roleId }) => roles.has(roleId));
  const key = tier?.key ?? null;
  const user = getUser(userId);
  if ((user.patreon_tier ?? null) !== key || user.has_patreon !== Number(Boolean(key))) {
    updateUser(userId, { patreon_tier: key, has_patreon: Number(Boolean(key)) });
  }
  patreonTierSyncedAt.set(userId, Date.now());
  return tier;
}

async function getPatreonTier(userId, user = getUser(userId)) {
  const fallback = { key: null, name: user.has_patreon ? 'Patron' : 'Player' };
  const guild = client.guilds.cache.get(ENCOUNTER_BOOST_GUILD_ID);
  if (!guild) {
    syncPatreonTier(userId, new Set());
    return { key: null, name: 'Player' };
  }
  try {
    const member = await guild.members.fetch({ user: userId, force: true });
    const tier = syncPatreonTier(userId, member.roles.cache);
    return tier
      ? { key: tier.key, name: `${EMOJIS[tier.key]} ${tier.name} Patron` }
      : { key: null, name: 'Player' };
  } catch (error) {
    if (error.code === 10007) {
      syncPatreonTier(userId, new Set());
      return { key: null, name: 'Player' };
    }
    console.error(`Failed to sync Patreon role for user ${userId}:`, error);
    throw error;
  }
}

client.on('guildMemberUpdate', (oldMember, newMember) => {
  if (newMember.guild.id !== ENCOUNTER_BOOST_GUILD_ID) return;
  try {
    syncPatreonTier(newMember.id, newMember.roles.cache);
  } catch (error) {
    console.error(`Failed to sync Patreon role update for user ${newMember.id}:`, error);
  }
});

client.on('guildMemberRemove', (member) => {
  if (member.guild.id !== ENCOUNTER_BOOST_GUILD_ID) return;
  try {
    syncPatreonTier(member.id, new Set());
  } catch (error) {
    console.error(`Failed to clear Patreon role for departed user ${member.id}:`, error);
  }
});

function monthlyRewardLines(r) {
  const lines = [
    `${EMOJIS.pokecoin} ${r.coins.toLocaleString()} PokéCoins`,
    `${EMOJIS.masterball} ${r.masterballs}x Masterballs`,
    `${EMOJIS.rarecandy} ${r.rare_candies}x Rare Candies`,
    `${EMOJIS.pokeEgg} Egg: ${r.eggs}`,
  ];
  if (r.super_incubators) lines.push(`${EMOJIS.superIncubator} ${r.super_incubators}x Super Incubators`);
  if (r.incubators) lines.push(`${EMOJIS.incubator} ${r.incubators}x Incubators`);
  if (r.Incense) lines.push(`${EMOJIS.incense} ${r.Incense}x Incense`);
  if (r.Pokeradar) lines.push(`${EMOJIS.pokeradar} ${r.Pokeradar}x Pokeradars`);
  if (r['Boss Coin']) lines.push(`${EMOJIS.bosscoin} ${r['Boss Coin']}x Boss Coin`);
  if (r.patreon_tokens) lines.push(`${EMOJIS.patreonToken} ${r.patreon_tokens.toLocaleString()} Patreon Tokens`);
  if (r['Cooldown Machine']) lines.push(`${EMOJIS.cooldownMachine} ${r['Cooldown Machine']}x Cooldown Machines`);
  if (r['Ability Capsule']) lines.push(`${EMOJIS.abilityCapsule} ${r['Ability Capsule']}x Ability Capsules`);
  if (r['Ability Patch']) lines.push(`${EMOJIS.abilityPatch} ${r['Ability Patch']}x Ability Patches`);
  return lines;
}

const PACIFIC_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: 'numeric', day: 'numeric',
  hour: 'numeric', hourCycle: 'h23',
});
function getPacificParts(ms) {
  const parts = Object.fromEntries(PACIFIC_PARTS.formatToParts(new Date(ms)).map((p) => [p.type, Number(p.value)]));
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour };
}
const isLastDayOfMonth = ({ year, month, day }) => day === new Date(Date.UTC(year, month, 0)).getUTCDate();

// Next last-day-of-month 10 PM Pacific Time (PST/PDT), as a UTC timestamp.
function getNextPatreonMonthlyTime(from = Date.now()) {
  const start = from - (from % 3_600_000);
  for (let ms = start; ms < start + 62 * 86_400_000; ms += 3_600_000) {
    const pacific = getPacificParts(ms);
    if (ms > from && pacific.hour === 22 && isLastDayOfMonth(pacific)) return ms;
  }
  return from;
}

let patreonMonthlyRunning = false;
async function runPatreonMonthlyPayout() {
  const pacific = getPacificParts(Date.now());
  if (patreonMonthlyRunning || !isLastDayOfMonth(pacific) || pacific.hour < 22) return;
  patreonMonthlyRunning = true;
  const monthKey = `${pacific.year}-${String(pacific.month).padStart(2, '0')}`;
  try {
    for (const userId of getPatreonUserIds()) {
      try {
        // Re-check the Discord role so lapsed members don't receive rewards.
        const tier = await getPatreonTier(userId);
        if (!tier.key) continue;
        const result = grantPatreonMonthly(userId, monthKey);
        if (!result.reward) continue;
        const discordUser = await client.users.fetch(userId).catch(() => null);
        await discordUser?.send({
          embeds: [new EmbedBuilder().setColor(0xf1c40f).setTitle('💰 Your Monthly Patreon Rewards')
            .setDescription(
              `Thank you for supporting the bot! Your **${tier.name}** monthly rewards were added to your account:\n\n` +
              monthlyRewardLines(result.reward).join('\n')
            )],
        }).catch(() => {});
      } catch (error) {
        console.error(`Monthly Patreon payout failed for ${userId}:`, error);
      }
    }
  } finally {
    patreonMonthlyRunning = false;
  }
}

const MEGA_STONE_EMOJIS = {
  Sablenite: '<:Sablenite:1560748046000849068>',
  Banettite: '<:Banettite:1560748020813926521>',
  Mawilite: '<:Mawilite:1560747941361225940>',
  Gengarite: '<:Gengarite:1560747984562688041>',
};
const stoneLabel = (name) => `${MEGA_STONE_EMOJIS[name] ? `${MEGA_STONE_EMOJIS[name]} ` : ''}**${name}**`;

const WORLD_BOSS_GUILD_ID = '1560102297198006274';
const WORLD_BOSS_GUILD_IDS = [WORLD_BOSS_GUILD_ID];
const WORLD_BOSS_CHANNEL_ID = '1560104155232600146';
const WORLD_BOSS_EMOJI = '<:worldboss:1559925077167054978>';
const GIVEAWAY_PING_ROLE_ID = '1560108609898156042';
const GIVEAWAY_CHANNEL_ID = '1560104419822018670';

// Rewards grow with the daily streak; bigger bonuses land on streak milestones.
function getDailyRewards(streak) {
  const boxes = {};
  if (streak % 7 === 0) boxes['Super Rare Box'] = 1;
  if (streak % 30 === 0) boxes['Shiny Box'] = 1;
  return {
    coins: 3000 + 200 * (Math.min(streak, 50) - 1),
    greatballs: 10 + 2 * Math.floor(streak / 5),
    ultraballs: 5 + Math.floor(streak / 5),
    rareCandies: streak % 14 === 0 ? 10 : 0,
    masterballs: (streak % 14 === 0 ? 1 : 0) + (streak % 30 === 0 ? 3 : 0),
    boxes,
  };
}

function getNextHuntReset(timestamp = Date.now()) {
  const shifted = new Date(timestamp - 5 * 60 * 60 * 1000);
  return Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + 1,
    5
  );
}
const LOTTERY_PING_ROLE_ID = '1560284020653433013';
const LOTTERY_CHANNEL_ID = '1560104474268278934';
const DAILY_GIVEAWAY = {
  winners: 50,
  durationMs: 12 * 60 * 60 * 1000,
  prizeTitle: '📦 Daily Items',
};

function rollGiveawayItems() {
  const fallback = {
    coins: 10000,
    items: { 'Rare Candy': 5, Lootbox: 3, Masterball: 1 },
  };
  let config;
  try {
    config = JSON.parse(fs.readFileSync(path.join(__dirname, 'giveaway-items.json'), 'utf8'));
  } catch (error) {
    console.error('Failed to read giveaway-items.json:', error.message);
    return fallback;
  }
  const isValidName = (name) => Boolean(
    GIVEAWAY_ITEM_COLUMNS[name] || EVOLUTION_ITEMS[name] || BOXES[name] || isPromoItemName(name)
  );
  const pool = (Array.isArray(config.pool) ? config.pool : []).filter((entry) => {
    const valid = isValidName(entry?.item) && entry.weight > 0
      && Number.isSafeInteger(entry.min) && Number.isSafeInteger(entry.max)
      && entry.min >= 1 && entry.max >= entry.min;
    if (!valid) console.error('Ignoring invalid giveaway-items.json entry:', JSON.stringify(entry));
    return valid;
  });
  if (!pool.length) return fallback;
  const items = {};
  const picks = Math.min(Math.max(1, Number(config.picks) || 1), pool.length);
  for (let i = 0; i < picks; i += 1) {
    const remaining = pool.filter((entry) => !(entry.item in items));
    let roll = Math.random() * remaining.reduce((sum, entry) => sum + entry.weight, 0);
    const chosen = remaining.find((entry) => (roll -= entry.weight) < 0) || remaining[remaining.length - 1];
    items[chosen.item] = chosen.min + Math.floor(Math.random() * (chosen.max - chosen.min + 1));
  }
  const result = { items };
  const coins = config.coins;
  if (
    coins?.enabled
    && Number.isSafeInteger(coins.min)
    && coins.min >= 1
    && Number.isSafeInteger(coins.max)
    && coins.max >= coins.min
  ) {
    result.coins = coins.min + Math.floor(Math.random() * (coins.max - coins.min + 1));
  }
  return result;
}

async function postGiveaway(guildId, channel, prizeTitle, prizeData, winnerCount, durationMs) {
  const endsAt = Date.now() + durationMs;
  const startEmbed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle(`🎉 Giveaway for ${prizeTitle} — ${winnerCount} Winner${winnerCount === 1 ? '' : 's'}!`)
    .setDescription(
      'Click **🎉 Enter Giveaway** to join, or **↩️ Leave Giveaway** to withdraw.\n\n' +
      `🎁 **Rewards (per winner)**\n${formatGiveawayRewards(prizeData)}\n\n` +
      `⏰ **Ends:** <t:${Math.floor(endsAt / 1000)}:R>\n\n` +
      '🎟️ **Entries (0):**\n*No entries yet.*'
    )
    .setFooter({ text: `Winners: ${winnerCount} • Entry is free!` });
  const prizeSprite = getGiveawayPokemonSprite(prizeData);
  if (prizeSprite) startEmbed.setImage(prizeSprite);
  const giveawayMessage = await channel.send({
    content: `<@&${GIVEAWAY_PING_ROLE_ID}>`,
    allowedMentions: { roles: [GIVEAWAY_PING_ROLE_ID] },
    embeds: [startEmbed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ga_enter').setLabel('Enter Giveaway')
        .setStyle(ButtonStyle.Success).setEmoji('🎉'),
      new ButtonBuilder().setCustomId('ga_leave').setLabel('Leave Giveaway')
        .setStyle(ButtonStyle.Secondary).setEmoji('↩️')
    )],
  });
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO active_giveaways
      (message_id, channel_id, guild_id, prize_title, prize_data, winner_count, ends_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(giveawayMessage.id, channel.id, guildId, prizeTitle, JSON.stringify(prizeData), winnerCount, endsAt);
  scheduleGiveaway(Number(lastInsertRowid), endsAt);
}

async function runDailyGiveaways() {
  if (dailyGiveawaysRunning) return;
  const now = Date.now();
  const slotAt = getCurrentDailyGiveawaySlot(now);
  if (now - slotAt >= 5 * 60 * 1000) return;

  dailyGiveawaysRunning = true;
  try {
    for (const { guild_id: guildId, channel_id: channelId } of db.prepare('SELECT * FROM giveaway_channels').all()) {
      try {
        const recentGiveaways = db.prepare(`
          SELECT prize_data FROM active_giveaways
          WHERE guild_id = ? AND prize_data LIKE '%"auto":true%'
          ORDER BY id DESC LIMIT 24
        `).all(guildId);
        const alreadyStarted = recentGiveaways.some(({ prize_data: prizeData }) => {
          try {
            return JSON.parse(prizeData).autoSlot === slotAt;
          } catch (error) {
            console.error(`Failed to parse daily giveaway data for guild ${guildId}:`, error);
            return false;
          }
        });
        if (alreadyStarted) continue;

        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel?.isTextBased() || channel.guildId !== guildId) continue;
        await postGiveaway(
          guildId,
          channel,
          DAILY_GIVEAWAY.prizeTitle,
          { ...rollGiveawayItems(), auto: true, autoSlot: slotAt },
          DAILY_GIVEAWAY.winners,
          DAILY_GIVEAWAY.durationMs
        );
      } catch (error) {
        console.error(`Failed to start daily giveaway for guild ${guildId}:`, error);
      }
    }
  } finally {
    dailyGiveawaysRunning = false;
  }
}

let dailyGiveawaysRunning = false;

function getCurrentDailyGiveawaySlot(timestamp = Date.now()) {
  const fixedEst = new Date(timestamp - 5 * 60 * 60 * 1000);
  const slotHour = fixedEst.getUTCHours() < 12 ? 0 : 12;
  return Date.UTC(
    fixedEst.getUTCFullYear(),
    fixedEst.getUTCMonth(),
    fixedEst.getUTCDate(),
    slotHour
  ) + 5 * 60 * 60 * 1000;
}

function scheduleGiveaway(giveawayId, endsAt) {
  clearTimeout(giveawayTimers.get(giveawayId));
  const timer = setTimeout(() => {
    giveawayTimers.delete(giveawayId);
    concludeGiveaway(giveawayId).catch((error) => console.error('Failed to conclude giveaway:', error));
  }, Math.min(Math.max(1000, endsAt - Date.now()), 2 ** 31 - 1));
  giveawayTimers.set(giveawayId, timer);
}

async function concludeGiveaway(giveawayId) {
  const giveaway = db.prepare('SELECT * FROM active_giveaways WHERE id = ?').get(giveawayId);
  if (!giveaway || giveaway.ended) return;
  if (giveaway.ends_at - Date.now() > 1000) {
    scheduleGiveaway(giveawayId, giveaway.ends_at);
    return;
  }
  const prizeData = JSON.parse(giveaway.prize_data);
  const form = prizeData.pokemon
    ? db.prepare('SELECT * FROM pokemon_forms WHERE id = ?').get(prizeData.pokemon.id)
    : null;
  const entries = db.prepare('SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?').all(giveawayId);
  const winners = entries.sort(() => Math.random() - 0.5).slice(0, giveaway.winner_count);
  const winnerCoinRewards = new Map();

  // The ended flag is claimed and rewards granted in one transaction, so a giveaway can never pay out twice.
  const claimed = db.transaction(() => {
    if (db.prepare('UPDATE active_giveaways SET ended = 1 WHERE id = ? AND ended = 0').run(giveawayId).changes === 0) {
      return false;
    }
    for (const { user_id: winnerId } of winners) {
      getUser(winnerId);
      const increments = {};
      if (prizeData.coins) {
        winnerCoinRewards.set(
          winnerId,
          awardCoinsWithBoost(winnerId, prizeData.coins).finalAmount
        );
      }
      for (const [item, quantity] of Object.entries(prizeData.items || {})) {
        const column = GIVEAWAY_ITEM_COLUMNS[item];
        if (column) increments[column] = (increments[column] || 0) + quantity;
        else if (EVOLUTION_ITEMS[item] || BOXES[item] || isPromoItemName(item)) addUserItem(winnerId, item, quantity);
      }
      if (Object.keys(increments).length) incrementUser(winnerId, increments);
      if (form) {
        const catchFields = {
          id: form.id,
          name: form.name,
          rarity: form.rarity,
          baseHp: form.base_hp,
          baseAtk: form.base_atk,
          baseDef: form.base_def,
          baseSpd: form.base_spd,
        };
        if (prizeData.pokemon.isGolden) saveGoldenCatch(winnerId, catchFields);
        else saveCatch(winnerId, catchFields, Boolean(prizeData.pokemon.isShiny));
      }
    }
    return true;
  })();
  if (!claimed) return;

  (async () => {
    for (const { user_id: winnerId } of winners) {
      try {
        const user = await client.users.fetch(winnerId);
        const winnerPrize = winnerCoinRewards.has(winnerId)
          ? { ...prizeData, coins: winnerCoinRewards.get(winnerId) }
          : prizeData;
        const dmEmbed = new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle('🎉 You won a giveaway!')
          .setDescription(
            `You won the giveaway for **${giveaway.prize_title}**!\n\n` +
            `🎁 **Your rewards**\n${formatGiveawayRewards(winnerPrize)}\n\n` +
            'The rewards have been added to your account.'
          )
          .setTimestamp();
        const dmSprite = getGiveawayPokemonSprite(winnerPrize);
        if (dmSprite) dmEmbed.setImage(dmSprite);
        await user.send({ embeds: [dmEmbed] });
      } catch {
        // DMs may be closed; the channel announcement still mentions the winner.
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  })();

  const channel = await client.channels.fetch(giveaway.channel_id).catch(() => null);
  const giveawayMessage = await channel?.messages.fetch(giveaway.message_id).catch(() => null);
  if (!giveawayMessage) return;
  let winnersText = '*No participants joined.*';
  if (winners.length) {
    const shown = winners.slice(0, 40).map((winner) => `<@${winner.user_id}>`).join(' ');
    winnersText = winners.length > 40 ? `${shown}\n... and **${winners.length - 40} more**` : shown;
  }
  const endEmbed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle(`🎉 Giveaway for ${giveaway.prize_title} — ${winners.length} Winner${winners.length === 1 ? '' : 's'} — ENDED`)
    .setDescription(
      `**Winners (${winners.length}):**\n${winnersText}\n\n` +
      `🎁 **Rewards (per winner)**\n${formatGiveawayRewards(prizeData)}\n\n` +
      `🎟️ **Entries (${entries.length}):**\n${formatGiveawayEntrants(giveawayId)}`
    )
    .setFooter({ text: `This giveaway has ended • Total Participants: ${entries.length}` })
    .setTimestamp();
  const endSprite = getGiveawayPokemonSprite(prizeData);
  if (endSprite) endEmbed.setImage(endSprite);
  await giveawayMessage.edit({
    embeds: [endEmbed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ga_ended').setLabel('Ended')
        .setStyle(ButtonStyle.Secondary).setDisabled(true)
    )],
  }).catch(() => {});
}

async function updateGiveawayEntryDisplay(giveaway, message) {
  const total = db.prepare(
    'SELECT COUNT(*) AS count FROM giveaway_entries WHERE giveaway_id = ?'
  ).get(giveaway.id).count;
  const prizeData = JSON.parse(giveaway.prize_data);
  const updatedEmbed = EmbedBuilder.from(message.embeds[0] ?? new EmbedBuilder())
    .setDescription(
      'Click **🎉 Enter Giveaway** to join, or **↩️ Leave Giveaway** to withdraw.\n\n' +
      `🎁 **Rewards (per winner)**\n${formatGiveawayRewards(prizeData)}\n\n` +
      `⏰ **Ends:** <t:${Math.floor(giveaway.ends_at / 1000)}:R>\n\n` +
      `🎟️ **Entries (${total}):**\n${formatGiveawayEntrants(giveaway.id)}`
    );
  try {
    await message.edit({ embeds: [updatedEmbed] });
    return true;
  } catch (error) {
    console.error(`Failed to update participant display for giveaway ${giveaway.id}:`, error);
    return false;
  }
}

async function handleGiveawayEntry(interaction) {
  const giveaway = db.prepare('SELECT * FROM active_giveaways WHERE message_id = ?').get(interaction.message.id);
  if (!giveaway || giveaway.ended || giveaway.ends_at <= Date.now()) {
    return interaction.reply({ content: '❌ This giveaway has already ended!', ephemeral: true });
  }
  const isLeaving = interaction.customId === 'ga_leave';
  const changed = isLeaving
    ? db.prepare(
      'DELETE FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?'
    ).run(giveaway.id, interaction.user.id).changes
    : db.prepare(
      'INSERT OR IGNORE INTO giveaway_entries (giveaway_id, user_id, username) VALUES (?, ?, ?)'
    ).run(giveaway.id, interaction.user.id, interaction.user.username).changes;
  if (!changed) {
    return interaction.reply({
      content: isLeaving
        ? 'You have not entered this giveaway.'
        : 'You have already entered this giveaway! 🎉',
      ephemeral: true,
    });
  }
  const displayUpdated = await updateGiveawayEntryDisplay(giveaway, interaction.message);
  const total = db.prepare(
    'SELECT COUNT(*) AS count FROM giveaway_entries WHERE giveaway_id = ?'
  ).get(giveaway.id).count;
  const actionMessage = isLeaving
    ? `↩️ You left the giveaway for **${giveaway.prize_title}**.`
    : `✅ You entered the giveaway for **${giveaway.prize_title}**!`;
  return interaction.reply({
    content: `${actionMessage} (Total participants: **${total}**)` +
      (displayUpdated ? '' : ' The participant list could not be refreshed.'),
    ephemeral: true,
  });
}

const autospawnStates = new Map();
const AUTOSPAWN_GUESS_MS = 25 * 1000;
const AUTOSPAWN_INTERVAL_MS = 10 * 60 * 1000;

function getAutospawnThreshold() {
  return Math.floor(Math.random() * 61) + 15; // 15–75 messages
}

function createAutoSpawnState(config) {
  const nextTarget = Number.isSafeInteger(config.message_target)
    && config.message_target >= 15
    && config.message_target <= 75
    ? config.message_target
    : getAutospawnThreshold();
  const count = Number.isSafeInteger(config.message_count)
    && config.message_count >= 0
    && config.message_count <= nextTarget
    ? config.message_count
    : 0;
  setAutoSpawnProgress(config.guild_id, count, nextTarget);
  return { count, nextTarget, active: false };
}

// Message-triggered spawns roll rarer Pokémon the higher the message target is.
function getAutospawnRarityForThreshold(threshold) {
  if (threshold >= 60) return 'Super Rare';
  if (threshold >= 45) return 'Rare';
  if (threshold >= 30) return 'Uncommon';
  return 'Common';
}

// Uniform picks across every form over-represent Legendaries, so roll a weighted rarity that never includes them.
function rollNonLegendaryAutospawn() {
  const pool = getRaritySettings().filter((rarity) =>
    !['legendary', 'gmax', 'mega', 'shiny mega'].includes(rarity.name.toLowerCase())
    && rarity.spawn_weight > 0
    && rarity.pokemon_count > 0
  );
  const totalWeight = pool.reduce((total, rarity) => total + rarity.spawn_weight, 0);
  if (!totalWeight) return getRandomPokemon('Common', false, true, true, []);
  let random = Math.random() * totalWeight;
  for (const entry of pool) {
    random -= entry.spawn_weight;
    if (random < 0) return getRandomPokemon(entry.name, false, true, true, []);
  }
  return getRandomPokemon(pool[pool.length - 1].name, false, true, true, []);
}

const AUTOSPAWN_SPECIAL_LEGENDARY_CHANCE = 0.3;

// Scheduled special spawns are a base Dex Legendary or a random shiny Dex entry.
function rollAutospawnTarget({ legendaryOrShiny = false, messageThreshold = null } = {}) {
  if (legendaryOrShiny) {
    if (Math.random() < AUTOSPAWN_SPECIAL_LEGENDARY_CHANCE) {
      const target = getRandomPokemon(
        'Legendary',
        false,
        true,
        true,
        [],
        SPECIAL_SPAWN_RESERVED_SPECIES
      );
      target.isShiny = false;
      return target;
    }
    const target = rollNonLegendaryAutospawn();
    target.isShiny = true;
    return target;
  }
  if (messageThreshold !== null) {
    return getRandomPokemon(getAutospawnRarityForThreshold(messageThreshold), false, true, true, []);
  }
  return rollNonLegendaryAutospawn();
}

async function triggerAutoSpawn(channel, guildConfig, state, { legendaryOrShiny = false, messageThreshold = null } = {}) {
  if (state.active) return;
  state.active = true;
  state.count = 0;
  console.log(`[autospawn] triggering spawn in channel ${channel.id}`);
  state.nextTarget = getAutospawnThreshold();
  setAutoSpawnProgress(guildConfig.guild_id, state.count, state.nextTarget);
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;

  try {
    const target = rollAutospawnTarget({ legendaryOrShiny, messageThreshold });

    const displayRarity = getDisplayRarity(target.rarity, target.name, target.isShiny);
    const rarityEmoji = getRarityEmojis(displayRarity);
    const title = `A wild ${rarityEmoji ? `${rarityEmoji} ` : ''}${displayRarity} Pokémon appeared! Quick, catch it! 🎯`;
    const decoys = db.prepare(`
      SELECT DISTINCT name FROM pokemon_forms
      WHERE is_default = 1 AND LOWER(name) <> LOWER(?)
      ORDER BY RANDOM() LIMIT 4
    `).all(target.name).map((row) => row.name);
    const choices = [...decoys, target.name].sort(() => Math.random() - 0.5);
    const image = getPokemonShowdownSprite(
      target.slug,
      target.isShiny,
      target.isShiny ? (target.shinyImg || target.img) : target.img
    );
    const spawnEmbed = new EmbedBuilder()
      .setColor(getRarityColor(target.rarity, target.name, target.isShiny))
      .setTitle(title);
    if (image) spawnEmbed.setImage(image);
    const buildRow = (resolved = false) => new ActionRowBuilder().addComponents(
      choices.map((name, index) => {
        const button = new ButtonBuilder()
          .setCustomId(`autospawn:${index}`)
          .setLabel(name.slice(0, 80))
          .setStyle(resolved && name === target.name ? ButtonStyle.Success : ButtonStyle.Secondary);
        return button.setDisabled(resolved);
      })
    );
    const spawnMessage = await channel.send({ embeds: [spawnEmbed], components: [buildRow()] });
    let caught = false;
    const collector = spawnMessage.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: AUTOSPAWN_GUESS_MS,
    });
    collector.on('collect', async (interaction) => {
      if (caught) {
        return interaction.reply({ content: 'Someone already caught it!', ephemeral: true }).catch(() => {});
      }
      const selected = choices[Number(interaction.customId.split(':')[1])];
      if (selected !== target.name) {
        return interaction.reply({
          content: `❌ **${selected}** is incorrect! Keep guessing!`,
          ephemeral: true,
        }).catch(() => {});
      }
      caught = true;
      collector.stop('caught');
      try {
        saveCatch(interaction.user.id, target, target.isShiny, true);
        advanceEggCatchProgress(interaction.user.id);
        trackClanActivity(interaction.user.id, 'catch');
        announceRareSpawn(interaction.guild, interaction.user, target).catch(() => {});
        const owned = db.prepare(
          'SELECT COUNT(*) AS count FROM catches WHERE user_id = ? AND pokemon_id = ? AND is_shiny = ? AND is_golden = 0'
        ).get(interaction.user.id, target.id, target.isShiny ? 1 : 0).count;
        const winEmbed = new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle(title)
          .setDescription(
            `🎉 **${interaction.user.username}** caught the ${target.isShiny ? '✨ ' : ''}**${target.name}**!\n\n` +
            `• **${target.name}** has been added to your \`${PREFIX}box\`\n` +
            `• You now own **${owned}x** ${rarityEmoji ? `${rarityEmoji} ` : ''}**${target.name}**!`
          );
        if (image) winEmbed.setImage(image);
        await interaction.update({ embeds: [winEmbed], components: [buildRow(true)] });
      } catch (error) {
        console.error('Failed to process autospawn catch:', error);
        await interaction.reply({ content: '❌ The catch could not be processed.', ephemeral: true }).catch(() => {});
      }
    });
    collector.on('end', async () => {
      state.active = false;
      if (caught) return;
      const escapeEmbed = new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle(title)
        .setDescription(`⏳ **Time's up! No one caught the ${target.name}.**`);
      if (image) escapeEmbed.setImage(image);
      await spawnMessage.edit({ embeds: [escapeEmbed], components: [buildRow(true)] }).catch(() => {});
    });
  } catch (error) {
    state.active = false;
    console.error('Failed to trigger autospawn:', error);
  }
}

function trackAutoSpawnMessage(message) {
  if (!message.guild) return;
  const guildConfig = getAutoSpawnChannel(message.guild.id);
  if (!guildConfig) return;
  let state = autospawnStates.get(message.guild.id);
  if (!state) {
    state = createAutoSpawnState(guildConfig);
    autospawnStates.set(message.guild.id, state);
  }
  if (state.active) return;
  if (state.count < state.nextTarget) state.count += 1;
  setAutoSpawnProgress(message.guild.id, state.count, state.nextTarget);
  console.log(`[autospawn] counted message ${state.count}/${state.nextTarget} in guild ${message.guild.id}`);
  if (state.count < state.nextTarget) return;
  const threshold = state.nextTarget;
  const cached = message.guild.channels.cache.get(guildConfig.channel_id);
  const channelPromise = cached
    ? Promise.resolve(cached)
    : message.guild.channels.fetch(guildConfig.channel_id).catch(() => null);
  channelPromise.then((channel) => {
    if (channel) triggerAutoSpawn(channel, guildConfig, state, { messageThreshold: threshold });
  });
}

async function runScheduledAutospawns(legendaryOrShiny) {
  for (const config of getAllAutoSpawnChannels()) {
    try {
      const guild = await client.guilds.fetch(config.guild_id).catch(() => null);
      if (!guild) continue;
      const channel = guild.channels.cache.get(config.channel_id)
        || await guild.channels.fetch(config.channel_id).catch(() => null);
      if (!channel?.isTextBased()) continue;
      let state = autospawnStates.get(config.guild_id);
      if (!state) {
        state = createAutoSpawnState(config);
        autospawnStates.set(config.guild_id, state);
      }
      triggerAutoSpawn(channel, config, state, { legendaryOrShiny });
    } catch (error) {
      console.error(`[autospawn] scheduled spawn failed in guild ${config.guild_id}:`, error);
    }
  }
}

function startAutospawnScheduler() {
  let lastSpawnMark = Math.floor(Date.now() / AUTOSPAWN_INTERVAL_MS);
  const timer = setInterval(() => {
    const mark = Math.floor(Date.now() / AUTOSPAWN_INTERVAL_MS);
    if (mark === lastSpawnMark) return;
    lastSpawnMark = mark;
    const now = new Date();
    const legendaryOrShiny = now.getUTCMinutes() === 0 && now.getUTCHours() % 6 === 0;
    console.log(
      `[autospawn] ten-minute spawn tick${legendaryOrShiny ? ' (Legendary/Shiny)' : ''}`
    );
    runScheduledAutospawns(legendaryOrShiny).catch((error) => {
      console.error('[autospawn] scheduled spawns failed:', error);
    });
  }, 15 * 1000);
  timer.unref?.();
}

async function runLotteryDrawIfDue() {
  const result = drawLottery();
  if (!result || result.error) return;
  const drawDate = new Date(result.drawnAt - 5 * 60 * 60 * 1000); // EST clock time
  const drawDateText = drawDate.toLocaleDateString('en-US', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  });
  const medals = ['🥇', '🥈', '🥉'];
  const placeNames = ['First', 'Second', 'Third'];
  const winnerLines = result.winners.map((winner, place) =>
    `${medals[place]} **${placeNames[place]} place:** <@${winner.userId}> (${winner.tickets.toLocaleString()} entries)\n` +
    `Won ${EMOJIS.pokecoin} **${winner.prize.toLocaleString()}**` +
    (place === 0 && result.goldenPrize ? ` + ${EMOJIS.golden} **${result.goldenPrize.name}**!` : '')
  );
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setAuthor({
      name: `PokéLottery Winners — ${drawDateText}`,
      iconURL: client.user.displayAvatarURL(),
    })
    .setDescription(
      `${winnerLines.join('\n\n')}\n\n` +
      '📊 **Lifetime Lottery statistics**\n' +
      `🎟️ Total tickets bought: ${result.lifetimeTickets.toLocaleString()}\n` +
      `${EMOJIS.pokecoin} PokéCoins taxed from Lottery: ${result.lifetimeTaxed.toLocaleString()}`
    )
    .setFooter({ text: `Entries in this lottery: ${result.totalTickets.toLocaleString()}` })
    .setTimestamp(result.drawnAt);
  if (result.goldenPrize) embed.setImage(getGoldenSpriteUrl(result.goldenPrize.speciesId));
  console.log(
    `[lottery] draw complete: ${result.winners.length} winner(s), ` +
    `jackpot ${result.jackpot.toLocaleString()}${result.goldenPrize ? `, golden prize ${result.goldenPrize.name}` : ''}`
  );
  // Results go to each guild's lottery channel, falling back to its giveaway channel.
  const targetByGuild = new Map(
    db.prepare('SELECT guild_id, channel_id FROM giveaway_channels').all()
      .map((row) => [row.guild_id, row.channel_id])
  );
  for (const row of db.prepare('SELECT guild_id, channel_id FROM lottery_channels').all()) {
    targetByGuild.set(row.guild_id, row.channel_id);
  }
  for (const channelId of new Set(targetByGuild.values())) {
    try {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel?.isTextBased()) continue;
      const pingRole = channel.guildId === WORLD_BOSS_GUILD_ID ? LOTTERY_PING_ROLE_ID : null;
      await channel.send({
        content: pingRole ? `<@&${pingRole}>` : undefined,
        allowedMentions: { roles: pingRole ? [pingRole] : [] },
        embeds: [embed],
      });
    } catch (error) {
      console.error(`[lottery] failed to announce results in channel ${channelId}:`, error);
    }
  }
}

function startLotteryScheduler() {
  const timer = setInterval(() => {
    runLotteryDrawIfDue().catch((error) => console.error('[lottery] draw failed:', error));
  }, 60 * 1000);
  timer.unref?.();
}

async function announceMarketListings(message, listings) {
  if (!message.guild) return { configured: false, failures: 0 };
  const channelId = getMarketAnnouncementChannel(message.guild.id);
  if (!channelId) return { configured: false, failures: 0 };

  let channel;
  try {
    channel = await message.guild.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      throw new Error(`Configured market listing channel ${channelId} is not a text channel.`);
    }
  } catch (error) {
    console.error(`Failed to resolve market announcement channel ${channelId}:`, error);
    return { configured: true, failures: 1 };
  }

  const pageSize = 10;
  const pageCount = Math.ceil(listings.length / pageSize);
  let failures = 0;
  for (let offset = 0; offset < listings.length; offset += pageSize) {
    const page = listings.slice(offset, offset + pageSize);
    const pageNumber = Math.floor(offset / pageSize) + 1;
    const embed = new EmbedBuilder()
      .setColor(getRarityColor(page[0].rarity, page[0].name, Boolean(page[0].is_shiny)))
      .setTitle(`New Market Listings${pageCount > 1 ? ` (${pageNumber}/${pageCount})` : ''}`)
      .setDescription(page.map((listing) =>
        `**#${listing.market_listing_id ?? listing.id} —** ${formatPokemonReward(listing)}\n` +
        `Level: **${listing.level}** • Price: ${EMOJIS.pokecoin} **${listing.price.toLocaleString()}**\n` +
        `Buy with \`${PREFIX}mbuy ${listing.market_listing_id ?? listing.id}\``
      ).join('\n\n'));
    try {
      await channel.send({ embeds: [embed] });
    } catch (error) {
      failures += 1;
      console.error(`Failed to announce market listings page ${pageNumber} for guild ${message.guild.id}:`, error);
    }
  }
  return { configured: true, failures };
}

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) {
    if (!message.author.bot) trackAutoSpawnMessage(message);
    return;
  }

  const input = message.content.slice(PREFIX.length).trim();
  if (!input) return;
  const args = input.split(/\s+/);
  let command = args.shift().toLowerCase();
  if ((command === 'market' || command === 'm') && args[0]?.toLowerCase() === 'offer') {
    args[0] = 'list';
  }
  if (command === 's' && args[0]?.toLowerCase() === 'b') {
    command = 'shop';
    args[0] = 'buy';
  }
  if (command === 't') command = 'team';
  if (command === 'sacrifice' || command === 'r') command = 'release';
  if (command === 'npc') {
    command = 'battle';
    args.unshift('npc');
  }
  if (command === 'release' && args[0]?.toLowerCase() === 'd') args[0] = 'duplicates';
  if (command === 'use' && args.length) {
    const normalizedItem = args[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    const itemTokens = [3, 2, 1].find((count) =>
      count <= args.length && [
        'goldenrazzberry', 'goldenrazz', 'doublexp', 'doublexpticket', 'superincubator', 'cooldownmachine',
        'abilitycapsule', 'abilitypatch', 'rarecandy', 'mistyslure', 'pokelure', 'superrepel', 'maxrepel',
      ].includes(args.slice(0, count).join('').toLowerCase().replace(/[^a-z0-9]/g, ''))
      || (count <= args.length && (
        findBox(args.slice(0, count).join(' ')) || findVoteBox(args.slice(0, count).join(' '))
      ))
    ) || 1;
    const normalizedFullItem = args.slice(0, itemTokens).join('').toLowerCase().replace(/[^a-z0-9]/g, '');
    const useCommandAliases = {
      incense: 'incense',
      inc: 'incense',
      pokeradar: 'pokeradar',
      radar: 'pokeradar',
      doublexp: 'doublexp',
      doublexpticket: 'doublexp',
      dxp: 'doublexp',
      goldenrazz: 'grazz',
      goldenrazzberry: 'grazz',
      grazz: 'grazz',
      graze: 'grazz',
      repel: 'repel',
      superrepel: 'superrepel',
      maxrepel: 'maxrepel',
      honey: 'honey',
      cooldownmachine: 'cooldown',
    };
    const useCommand = useCommandAliases[normalizedFullItem] || useCommandAliases[normalizedItem];
    if (useCommand) {
      command = useCommand;
      args = args.slice(useCommandAliases[normalizedFullItem] ? itemTokens : 1);
      if (args.length === 0 && ['incense', 'pokeradar', 'doublexp', 'grazz', 'repel', 'superrepel', 'maxrepel', 'honey'].includes(command)) {
        args = ['1'];
      }
    } else if (normalizedFullItem === 'rarecandy') {
      command = 'use';
      args = ['rarecandy', ...args.slice(itemTokens)];
    } else if (normalizedFullItem === 'pokelure' || normalizedFullItem === 'mistyslure') {
      command = 'use';
      args = [normalizedFullItem, ...args.slice(itemTokens)];
    } else if (normalizedItem === 'egg' || normalizedItem === 'eggs') {
      command = 'egg';
      args = ['hatch', ...args.slice(1)];
    } else if (normalizedFullItem === 'incubator' || normalizedFullItem === 'superincubator') {
      command = 'egg';
      args = ['use-incubator', normalizedFullItem === 'incubator' ? 'i' : 'si', ...args.slice(itemTokens)];
    } else if (normalizedFullItem === 'abilitycapsule' || normalizedFullItem === 'abilitypatch'
        || (normalizedItem === 'ability' && ['capsule', 'patch'].includes(args[1]?.toLowerCase()))) {
      command = 'buddy';
      args = ['info', ...args.slice(normalizedItem === 'ability' ? 2 : itemTokens)];
    } else if (normalizedItem === 'lootbox'
        || findBox(args.slice(0, itemTokens).join(' '))
        || findVoteBox(args.slice(0, itemTokens).join(' '))) {
      command = 'open';
      const box = findBox(args.slice(0, itemTokens).join(' ')) || findVoteBox(args.slice(0, itemTokens).join(' '));
      args = [box || args[0], ...args.slice(itemTokens)];
    }
  }
  const userId = message.author.id;

  try {
    // Keep the stored Patreon tier fresh (at most every 10 minutes per user).
    if (Date.now() - (patreonTierSyncedAt.get(userId) || 0) > 600000) {
      await getPatreonTier(userId);
    }

    if (command === 'toggle') {
      if (args[0]?.toLowerCase() === 'market') {
        if (args.length > 2) {
          return message.reply(`Usage: \`${PREFIX}toggle market [on|off]\`.`);
        }
        const current = getMarketCompletionNotificationsEnabled(userId);
        const requested = args[1]?.toLowerCase();
        if (requested && !['on', 'off'].includes(requested)) {
          return message.reply(`Usage: \`${PREFIX}toggle market [on|off]\`.`);
        }
        const enabled = requested ? requested === 'on' : !current;
        if (enabled && !getPatreonPerks(userId).ivChecker) {
          return message.reply(
            `❌ Market completion DMs are an Uncommon Patreon perk. Use \`${PREFIX}perks uncommon\` to learn more.`
          );
        }
        setMarketCompletionNotificationsEnabled(userId, enabled);
        return message.reply(
          `✅ Market listing completion DMs are now **${enabled ? 'on' : 'off'}**.`
        );
      }
      if (args[0]?.toLowerCase() === 'rarespawn') {
        if (args.length > 2) {
          return message.reply(`Usage: \`${PREFIX}toggle rarespawn [on|off]\`.`);
        }
        const current = getRareSpawnNameHidden(userId);
        const requested = args[1]?.toLowerCase();
        if (requested && !['on', 'off', 'true', 'false'].includes(requested)) {
          return message.reply(`Usage: \`${PREFIX}toggle rarespawn [on|off]\`.`);
        }
        const hidden = requested
          ? ['on', 'true'].includes(requested)
          : !current;
        setRareSpawnNameHidden(userId, hidden);
        return message.reply(
          `✅ Rare-spawn name hiding is now **${hidden ? 'on' : 'off'}**. ` +
          (hidden
            ? 'Your rare-spawn announcements will say **somebody**.'
            : 'Your rare-spawn announcements will show your username.')
        );
      }
      if (args.length !== 1 || args[0]?.toLowerCase() !== 'cooldown') {
        return message.reply(
          `Usage: \`${PREFIX}toggle cooldown\`, \`${PREFIX}toggle market [on|off]\`, ` +
          `or \`${PREFIX}toggle rarespawn [on|off]\`.`
        );
      }
      const buildEmbed = () => {
        const mode = getCooldownNotificationMode(userId);
        return new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('⏱️ Cooldown Notifications')
          .setDescription(
            `Cooldown completion notifications currently use **${mode === 'ping' ? 'user pings' : 'usernames'}**.\n\n` +
            `This setting only applies to your future cooldown notifications.`
          );
      };
      const buildButtons = (disabled = false) => new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('toggle_cooldown_mode')
          .setLabel(`Switch to ${getCooldownNotificationMode(userId) === 'ping' ? 'username' : 'ping'}`)
          .setStyle(ButtonStyle.Primary)
          .setDisabled(disabled)
      );
      const toggleMessage = await message.reply({
        embeds: [buildEmbed()],
        components: [buildButtons()],
      });
      const collector = toggleMessage.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 120000,
      });
      collector.on('collect', async (interaction) => {
        try {
          if (interaction.user.id !== userId) {
            await interaction.reply({ content: 'Only the user who opened this setting can change it.', ephemeral: true });
            return;
          }
          const currentMode = getCooldownNotificationMode(userId);
          setCooldownNotificationMode(userId, currentMode === 'ping' ? 'username' : 'ping');
          await interaction.update({
            embeds: [buildEmbed()],
            components: [buildButtons()],
          });
        } catch (error) {
          console.error('Failed to update cooldown notification mode:', error);
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
              content: 'Could not update the cooldown notification setting.',
              ephemeral: true,
            });
          }
        }
      });
      collector.on('end', async () => {
        try {
          await toggleMessage.edit({ components: [buildButtons(true)] });
        } catch (error) {
          console.error('Failed to disable the cooldown notification toggle:', error);
        }
      });
      return;
    }

    if (command === 'perks' || command === 'perk') {
      const sub = args[0]?.toLowerCase();
      if (sub === 'booster') {
        const hasBoosterPerk = (await getRoleEncounterBoost(userId)) > 0;
        const status = hasBoosterPerk
          ? '✅ You are boosting the booster server and these perks are active globally for your encounters.'
          : 'You are not currently boosting the booster server.';
        return message.reply({
          embeds: [new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('🚀 Server Booster Perks')
            .setDescription(
              `${status}\n\n` +
              `• **Legendary encounters:** +5% relative chance\n` +
              `• **Event Pokémon:** +5% relative encounter weight while an event is active\n\n` +
              'These bonuses apply globally to land, fishing, and CatchBot encounters.'
            )],
        });
      }

      const targetUser = message.mentions.users.first() || message.author;
      const targetId = targetUser.id;
      const userTier = (await getPatreonTier(targetId, getUser(targetId))).name;
      const user = getUser(targetId);
      const PT = '<:patreontoken:1560376902374522980>';
      const baseEmbed = (color) => new EmbedBuilder().setColor(color).setAuthor({
        name: `${targetUser.username}'s perks`,
        iconURL: targetUser.displayAvatarURL(),
      });
      const monthlyText = (tierKey) => {
        const m = PATREON_TIER_PERKS[tierKey].monthly;
        const lines = [
          `• ${EMOJIS.pokecoin} ${m.coins.toLocaleString()} PokeCoins`,
          `• ${EMOJIS.masterball} ${m.masterballs}x Masterballs`,
          `• ${EMOJIS.rarecandy} ${m.rare_candies}x Rare Candies`,
          `• ${EMOJIS.pokeEgg} Eggs: ${m.eggs}`,
        ];
        if (m.super_incubators) lines.push(`• ${EMOJIS.superIncubator} Super Incubators: ${m.super_incubators}`);
        if (m.incubators) lines.push(`• ${EMOJIS.incubator} Incubators: ${m.incubators}`);
        if (m.Incense) lines.push(`• ${EMOJIS.incense} Incense: ${m.Incense}`);
        if (m.Pokeradar) lines.push(`• ${EMOJIS.pokeradar} Pokeradars: ${m.Pokeradar}`);
        if (m['Boss Coin']) lines.push(`• ${EMOJIS.bosscoin} Boss Coin: ${m['Boss Coin']}`);
        if (m.patreon_tokens) {
          const tokenAmount = tierKey === 'golden' ? 6000 : m.patreon_tokens;
          const tokenLabel = tierKey === 'golden' ? 'Bonus Patreon Tokens' : 'Patreon Tokens';
          lines.push(`• ${PT} ${tokenAmount.toLocaleString()} ${tokenLabel}`);
        }
        if (m['Cooldown Machine']) lines.push(`• ${EMOJIS.cooldownMachine} Cooldown Machines: ${m['Cooldown Machine']}`);
        if (m['Ability Capsule']) lines.push(`• ${EMOJIS.abilityCapsule} Ability Capsules: ${m['Ability Capsule']}`);
        if (m['Ability Patch']) lines.push(`• ${EMOJIS.abilityPatch} Ability Patches: ${m['Ability Patch']}`);
        return lines.join('\n');
      };
      const TIER_PAGES = {
        common: {
          color: 0x0099ff, emoji: EMOJIS.common, name: 'Common',
          benefits: [
            '🥷 Ninja perk: +5% catch rate (all ball types)',
            `${EMOJIS.shiny} +25% full-odds shiny rate`,
            `<:eonticket:1560743778870890636> +5% event shiny rate`,
            `💖 Access to Patreon-exclusive Shiny Pokémon (\`${PREFIX}excl patreon\`)`,
            '🎟️ 50% reduced `/swap` costs',
            '🔒 +5 release-lock slots',
            `Double ${EMOJIS.pokecoin} from \`/daily\``,
          ],
        },
        uncommon: {
          color: 0x00d8d8, emoji: EMOJIS.uncommon, name: 'Uncommon',
          benefits: [
            `${EMOJIS.votecoin} 2x Vote Coins from \`${PREFIX}vote\`, including streak bonuses`,
            '💥 50% off move changes with `.moves set` (25,000 instead of 50,000 PokéCoins)',
            '📜 +1 quest slot (4 total)',
            '📱 Exact buddy IV numbers alongside their stars with the IV Checker, including reroll results',
            '🧬 10% fewer Pokémon needed for `.mc` challenges',
            `📥 DM notifications when market listings sell (\`${PREFIX}toggle market\`)`,
            '<:caught:1560340176713031711> Quick Hands: 10% chance to save balls on successful catches',
            '🔒 +5 more release-lock slots (35 total)',
          ],
        },
        rare: {
          color: 0xffa500, emoji: EMOJIS.rare, name: 'Rare',
          benefits: [
            '⏱️ Quest slots refresh 50% sooner after completion (2 hours → 1 hour)',
            '📜 +1 quest slot (5 total)',
            `${EMOJIS.pokeEgg} Egg hatch targets reduced to 20–110 catches; auto-equip Eggs`,
            `${EMOJIS.oldrod} +5% fishing encounter rate`,
            '🏪 +5 market listings (20 total)',
            '🔒 +5 more release-lock slots (40 total)',
          ],
        },
        superRare: {
          color: 0xffff00, emoji: EMOJIS.superRare, name: 'Super Rare',
          benefits: [
            `🛒 10% cheaper ${EMOJIS.pokecoin} PokeCoin shop items`,
            '🧬 Additional 10% `.mc` challenge cost reduction (20% total)',
            `${EMOJIS.pokeEgg} Even faster egg hatching`,
            '🔒 +5 additional release-lock slots (45 total)',
            '🎬 Behind-the-scenes channel access',
          ],
        },
        legendary: {
          color: 0x800080, emoji: EMOJIS.legendary, name: 'Legendary',
          benefits: [
            `${LOOTBOX_EMOJI} 10% improved lootbox item odds`,
            `${EMOJIS.shiny} +25% shiny rate for full-odds and event shinies`,
            '🏪 +15 market listing slots (35 total)',
            '🔒 +5 additional release-lock slots (50 total)',
            '✨ Submit up to 10 non-Legendary Shiny Pokémon for the next event',
            '🔒 `#legendary-patreon` access',
            '📈 Boost up to 10 channels for your own encounters',
          ],
        },
        shiny: {
          color: 0xffb6c1, emoji: EMOJIS.shiny, name: 'Shiny',
          benefits: [
            '🏪 0% Pokémon market tax and +5 market listings (40 total)',
            '🧬 Additional 10% Mega Chamber cost reduction (30% total)',
            `${EMOJIS.shinyCharm} +1 passive Shiny Charm`,
            `${EMOJIS.amuletcoin} +4 passive Amulet Coins`,
            '🔒 +10 additional release-lock slots (60 total)',
            `${PT} +1,500 monthly Patreon Token bonus (2,000 monthly total)`,
            `${EMOJIS.cooldownMachine} 110 Cooldown Machines, ${EMOJIS.abilityCapsule} 3 Ability Capsules, and ${EMOJIS.abilityPatch} 2 Ability Patches monthly`,
            `${EMOJIS.pokeEgg} 100 Eggs and 25 Super Incubators monthly`,
            '📈 Boost up to 10 channels for your own encounters',
            '🎨 Custom role and `#shiny-patreon` access',
          ],
        },
        golden: {
          color: 0xffd700, emoji: EMOJIS.golden, name: 'Golden',
          benefits: [
            `${EMOJIS.golden} +25% Golden-exclusive Fishing and PokeSwap odds, and Promo item rates`,
            `${EMOJIS.cooldownMachine} 300 Cooldown Machines, ${EMOJIS.abilityCapsule} 10 Ability Capsules, ${EMOJIS.abilityPatch} 5 Ability Patches, 250 Eggs, and 75 Super Incubators monthly`,
            `${PT} +6,000 monthly bonus Patreon Tokens`,
            `${EMOJIS.bosscoin} 1 Boss Coin every month`,
            '📈 Boost up to 10 channels for your own encounters',
            '🎨 Request a staff-approved custom role icon and glow for your custom role',
          ],
        },
      };
      const tierEmbed = (tierKey) => {
        const page = TIER_PAGES[tierKey];
        const perks = PATREON_TIER_PERKS[tierKey];
        const lower = PATREON_TIER_ORDER.indexOf(tierKey) > 0;
        return baseEmbed(page.color).setDescription(
          `**You are currently ${userTier}**\n\n` +
          `${page.emoji} **${page.name} Patreon Benefits**\n` +
          (lower ? '• ✅ Includes all lower-tier benefits\n' : '') +
          `\n✨ **Key Benefits**\n${page.benefits.map((line) => `• ${line}`).join('\n')}\n\n` +
          `📅 **Daily Rewards**\n• ${PT} ${perks.dailyTokens.toLocaleString()} Patreon Tokens\n` +
          `• ${EMOJIS.pokecoin} ${perks.dailyCoins.toLocaleString()} PokeCoins\n\n` +
          `💰 **Monthly Rewards**\n${monthlyText(tierKey)}\n\n` +
          `${page.emoji} **${page.name} patreon role** in the Official Support Server\n` +
          `🔴 [View full Patreon benefits](https://patreon.com/UmbreonBot?utm_medium=unknown&utm_source=join_link&utm_campaign=creatorshare_creator&utm_content=copyLink)`
        );
      };
      const TIER_BUTTON_IDS = {
        perk_c: 'common', perk_u: 'uncommon', perk_r: 'rare',
        perk_sr: 'superRare', perk_l: 'legendary', perk_s: 'shiny', perk_g: 'golden',
      };
      const TIER_SUBCOMMANDS = {
        c: 'common', common: 'common', u: 'uncommon', uncommon: 'uncommon', r: 'rare', rare: 'rare',
        sr: 'superRare', superrare: 'superRare', l: 'legendary', legendary: 'legendary',
        s: 'shiny', shiny: 'shiny', g: 'golden', golden: 'golden',
      };      const overviewEmbed = () => {
        const charms = user.shiny_charms || 0;
        const amulet = getAmuletCoinBoost(targetId);
        const clan = getPlayerClan(targetId);
        const clanAmuletCoins = getClanPerkMultipliers(clan).amuletCoins;
        const clanText = clanAmuletCoins
          ? `• **${clan.name || 'Clan'}:** +${clanAmuletCoins} invisible Amulet Coin${clanAmuletCoins === 1 ? '' : 's'}`
          : '*No active clan perks.*';
        const patreonPerks = getPatreonPerks(targetId);
        const patreonText = user.patreon_tier
          ? `✅ **Active ${userTier} Perks:** +${patreonPerks.amuletCoins} Amulet Coins, +${patreonPerks.shinyCharms} Shiny Charms`
          : `❌ **You don't have any Patreon perks! Support the bot on Patreon to get perks!**`;
        return baseEmbed(0x2b2d31).setDescription(
          `**You are currently ${userTier}**\n\n` +
          `**Boosts**\n` +
          `• <:caught:1560340176713031711>  **Catch boost:** +${patreonPerks.catchBoost}% catch rate (all ball types)\n` +
          `• ${EMOJIS.shinyCharm}  **Shiny charms [${charms}]:** +${charms * 10}% shiny rate (including events)\n` +
          `• ${EMOJIS.amuletcoin}  **Amulet coins [${amulet.totalEffective}]:** +${amulet.percentBoost}% PokeCoins per catch\n\n` +
          `**Active Clan Perks**\n${clanText}\n\n${patreonText}\n\n` +
          `Server booster perks: \`${PREFIX}perks booster\`\n` +
          `[Click here to view the full list of Patreon benefits!](https://patreon.com/UmbreonBot?utm_medium=unknown&utm_source=join_link&utm_campaign=creatorshare_creator&utm_content=copyLink)`
        );
      };
      const tierButton = (id, emoji) =>
        new ButtonBuilder().setCustomId(id).setEmoji(emoji).setStyle(ButtonStyle.Secondary);
      const buildRows = () => [
        new ActionRowBuilder().addComponents(
          tierButton('perk_c', EMOJIS.common),
          tierButton('perk_u', EMOJIS.uncommon),
          tierButton('perk_r', EMOJIS.rare),
          new ButtonBuilder().setLabel('Subscribe for Perks!').setStyle(ButtonStyle.Link).setURL('https://patreon.com/UmbreonBot?utm_medium=unknown&utm_source=join_link&utm_campaign=creatorshare_creator&utm_content=copyLink').setEmoji('🟠')
        ),
        new ActionRowBuilder().addComponents(
          tierButton('perk_sr', EMOJIS.superRare),
          tierButton('perk_l', EMOJIS.legendary),
          tierButton('perk_s', EMOJIS.shiny),
          tierButton('perk_g', EMOJIS.golden)
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel('Gift a Subscription!').setStyle(ButtonStyle.Link).setURL('https://www.patreon.com/UmbreonBot/gift').setEmoji('🎁')
        ),
      ];

      let firstEmbed = overviewEmbed();
      const activeTier = TIER_SUBCOMMANDS[sub] || user.patreon_tier;
      if (activeTier && TIER_PAGES[activeTier]) firstEmbed = tierEmbed(activeTier);
      const perksMsg = await message.reply({ embeds: [firstEmbed], components: buildRows() });
      const collector = perksMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });
      collector.on('collect', async (interaction) => {
        if (interaction.user.id !== message.author.id) {
          return interaction.reply({ content: `Use \`${PREFIX}perks\` to view your own perks.`, ephemeral: true });
        }
        const tierKey = TIER_BUTTON_IDS[interaction.customId];
        if (!tierKey) return interaction.deferUpdate();
        return interaction.update({ embeds: [tierEmbed(tierKey)], components: buildRows() });
      });
      collector.on('end', () => perksMsg.edit({ components: [] }).catch(() => {}));
      return;
    }

    if (command === 'excl') {
      const exclusiveType = args[0]?.toLowerCase();
      if (!['swap', 'egg', 'fish', 'catchbot', 'patreon'].includes(exclusiveType) || args.length > 1) {
        return message.reply(`Usage: \`${PREFIX}excl <swap|egg|fish|catchbot|patreon>\`.`);
      }
      let embed;
      if (exclusiveType === 'patreon') {
        const shinyEggExclusives = EGG_RARE_HATCHES
          .filter((entry) => entry.patreonOnly && entry.isShiny)
          .map((entry) => `• ✨ ${entry.name} (1/${entry.denominator} per Egg hatch)`);
        const shinySwapExclusives = SWAP_EXCLUSIVE_SHINIES
          .filter((entry) => entry.patreonOnly)
          .map((entry) => `• ✨ ${entry.name} (1/2,000 base chance per PokeSwap)`);
        embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('💖 Patreon-exclusive Shiny Pokémon')
          .setDescription(
            `**Egg hatches**\n${shinyEggExclusives.join('\n') || 'None configured.'}\n\n` +
            `**PokeSwap**\n${shinySwapExclusives.join('\n') || 'None configured.'}\n\n` +
            'PokeSwap odds can increase with your daily swap multiplier and the Shiny Pokémon you offer.'
          );
      } else if (exclusiveType === 'swap') {
        const shinyExclusives = SWAP_EXCLUSIVE_SHINIES
          .map(({ name }) => name)
          .join(' • ');
        embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('🔄 PokeSwap Exclusives')
          .setDescription(
            '**Swap-exclusive Shiny Pokémon** (each 1/2,000)\n' +
            `${shinyExclusives}\n\n` +
            `**Golden exclusive**\n${EMOJIS.golden} Goomy (1/5,000)`
          );
      } else if (exclusiveType === 'fish') {
        embed = new EmbedBuilder()
          .setColor(0x3498db)
          .setTitle('🎣 Fishing Exclusives')
          .setDescription(
            `**Shiny Pokémon**\n${FISH_EXCLUSIVE_SHINIES.map((name) => `• ${name}`).join('\n')}\n\n` +
            `**Golden Pokémon**\n${FISH_EXCLUSIVE_GOLDENS.map((name) => `• ${EMOJIS.golden} ${name}`).join('\n')}\n\n` +
            `Golden-exclusive fishing encounters are **1/${FISH_EXCLUSIVE_GOLDEN_DENOMINATOR.toLocaleString()}**; Golden Patreon raises this rate by 25%.`
          );
      } else if (exclusiveType === 'catchbot') {
        embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('🤖 CatchBot Exclusives')
          .setDescription(
            `**Golden Pokémon**\n` +
            `${EMOJIS.golden} Aron\n${EMOJIS.golden} Swablu\n\n` +
            'Each CatchBot Pokémon has a **1/1,000** chance to be Golden at maximum Luck.'
          );
      } else {
        const formatPool = (names) => names.map((name) => `• ${name}`).join('\n');
        const formatSpecials = (entries) => entries
          .map((entry) =>
            `• ${entry.isGolden ? `${EMOJIS.golden} Golden ` : entry.isShiny ? '✨ Shiny ' : ''}` +
            `${entry.name} (1/${entry.denominator})`
          )
          .join('\n');
        embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('🥚 Egg-exclusive Pokémon')
          .setDescription(
            'These Pokémon can be obtained by hatching Eggs. Rare hatch chances apply to each matching entry.'
          )
          .addFields(
            { name: 'Early Hatch Pool (30–90 catches)', value: formatPool(EGG_HATCH_POOLS.early) },
            { name: 'Late Hatch Pool (91–130 catches)', value: formatPool(EGG_HATCH_POOLS.late) },
            {
              name: 'Rare Regular & Golden Hatches',
              value: formatSpecials(EGG_RARE_HATCHES.filter((entry) => !entry.isShiny)),
            },
            {
              name: 'Rare Shiny Hatches',
              value: formatSpecials(EGG_RARE_HATCHES.filter((entry) => entry.isShiny)),
            }
          );
      }
      return message.reply({ embeds: [embed] });
    }

    if (command === 'vote') {
      const voter = getUser(userId);
      const voteUrl = getTopggVoteUrl();
      const botName = client.user?.username || 'the bot';
      const perks = getPatreonPerks(userId);
      const streak = voter.vote_streak || 0;
      const streakBonus = streak >= 50 ? 2 : streak >= 10 ? 1 : 0;
      const perVote = (1 + streakBonus) * perks.voteCoinMult;
      const lastVoted = voter.last_vote_at > 0
        ? `<t:${Math.floor(voter.last_vote_at / 1000)}:R>`
        : 'never';
      const embed = new EmbedBuilder()
        .setColor(0x00a8fc)
        .setDescription(
          `🙀 **| You can vote now!**\n` +
          `📅 | Vote multiple days in a row for streak rewards!\n` +
          `⏰ | Remember to vote once every 12 hours for rewards!\n` +
          `🆕 | Voting provides a hidden +1 ${EMOJIS.shinyCharm} Shiny Charm bonus!\n` +
          `| [Click here to vote for ${botName}](${voteUrl})\n\n` +
          `${EMOJIS.votecoin} **Your Vote Coins**: ${voter.vote_coins.toLocaleString()}\n` +
          `💰 Spend your vote coins at \`${PREFIX}shop\`\n\n` +
          `To open ${LOOTBOX_EMOJI} Lootboxes, type \`${PREFIX}lootbox\` or \`${PREFIX}lootbox all\`\n` +
          `To open ${BOXES['Rare Box'].emoji} ${BOXES['Super Rare Box'].emoji} ${BOXES['Legendary Box'].emoji} ${BOXES['Shiny Box'].emoji} boxes, type \`${PREFIX}open {rb/srb/lb/sb} {amount or all}\`\n\n` +
          `🏆 **Total times voted**: ${voter.votes_claimed.toLocaleString()}\n` +
          `⏰ **You last voted**: ${lastVoted}\n` +
          `**At a 10 streak**: 2x ${EMOJIS.rarecandy}, 2x ${EMOJIS.pokeEgg}, & 1x ${BOXES['Legendary Box'].emoji}\n` +
          `**At a 25 streak**: 1x ${EMOJIS.masterball}, 2x ${EMOJIS.votecoin}, & 1x ${BOXES['Shiny Box'].emoji}\n\n` +
          `🆕 **New Vote Streak Bonuses** 🆕\n` +
          `🔥 **Your Vote streak**: ${streak}\n` +
          `• **10+ Vote Streak:** You permanently receive +1 ${EMOJIS.votecoin} per vote ${streak >= 10 ? '✅' : '❌'}\n` +
          `• **50+ Vote Streak:** You permanently receive +2 ${EMOJIS.votecoin} per vote ${streak >= 50 ? '✅' : '❌'}\n\n` +
          `😍 **You currently receive:** ${EMOJIS.votecoin} ${perVote} per vote\n\n` +
          `Support our Patreon for extra voting benefits & sneak peeks for new features!\n` +
          `**Weekend votes or voting on the first 5 days of the month gives bonus rewards!**`
        );
      return message.reply({ embeds: [embed] });
    }

    if (command === 'egg') {
      const subcommand = args[0]?.toLowerCase();
      const incubatorType = (value) => {
        const normalized = (value || '').toLowerCase().replace(/[^a-z]/g, '');
        if (['i', 'incubator', 'normal'].includes(normalized)) return 'incubator';
        if (['si', 'superincubator', 'super'].includes(normalized)) return 'super_incubator';
        return null;
      };
      if (subcommand === 'use-incubator' || subcommand === 'useincubator') {
        const type = incubatorType(args[1]);
        const amountArg = args[2]?.toLowerCase();
        if (!type || args.length > 3) {
          return message.reply(
            `Usage: \`${PREFIX}egg use-incubator <i|si> <amount|all>\`.`
          );
        }
        const existing = getUserEggIncubators(userId)
          .filter((incubator) => incubator.incubator_type === type);
        const freeSlots = EGG_INCUBATOR_LIMITS[type] - existing.length;
        const itemName = type === 'incubator' ? 'Incubator' : 'Super Incubator';
        const ownedIncubators = getUserItems(userId)
          .find((item) => item.item_name === itemName)?.amount || 0;
        const ownedEggs = getUser(userId).vote_eggs;
        const amount = amountArg === 'all'
          ? Math.min(freeSlots, ownedIncubators, ownedEggs)
          : amountArg === undefined ? 1 : parseAmount(amountArg);
        if (!Number.isSafeInteger(amount) || amount < 1) {
          if (amountArg === 'all' && freeSlots < 1) {
            return message.reply(`❌ All ${itemName} slots are already in use.`);
          }
          if (amountArg === 'all' && ownedIncubators < 1) {
            return message.reply(`❌ You do not have any ${itemName}s available.`);
          }
          if (amountArg === 'all' && ownedEggs < 1) {
            return message.reply('❌ You do not have any Eggs to incubate.');
          }
          return message.reply(`Specify a valid amount or \`all\`.`);
        }
        if (amount > freeSlots) {
          return message.reply(`❌ You only have **${freeSlots}** ${itemName} slot(s) available.`);
        }
        if (amount > ownedIncubators) {
          return message.reply(`❌ You have **${ownedIncubators}** ${itemName}${ownedIncubators === 1 ? '' : 's'} available.`);
        }
        if (amount > ownedEggs) {
          return message.reply(`❌ You have **${ownedEggs}** Eggs available.`);
        }
        const targets = Array.from({ length: amount }, () => {
          const catches = getEggCatchTarget(userId);
          return type === 'super_incubator' ? Math.ceil(catches / 2) : catches;
        });
        const result = startEggIncubators(userId, type, targets);
        if (result.error === 'slots_full') {
          return message.reply(`❌ You only have **${result.availableSlots}** ${type === 'incubator' ? 'Incubator' : 'Super Incubator'} slot(s) available.`);
        }
        if (result.error === 'insufficient_incubators') {
          return message.reply(`❌ You have **${result.owned}** ${itemName}${result.owned === 1 ? '' : 's'} available.`);
        }
        if (result.error === 'insufficient_eggs') {
          return message.reply(`❌ You have **${result.owned}** Eggs available.`);
        }
        const emoji = type === 'incubator' ? EMOJIS.incubator : EMOJIS.superIncubator;
        const name = type === 'incubator' ? 'Incubator' : 'Super Incubator';
        return message.reply(
          `${emoji} Started **${result.started.length} ${name}${result.started.length === 1 ? '' : 's'}**. ` +
          result.started.map((entry) => `Slot ${entry.slot}: **0/${entry.target} catches**`).join(' • ') +
          `\nUse \`${PREFIX}egg hatch-incubator ${type === 'incubator' ? 'i' : 'si'} all\` when ready.`
        );
      }
      if (subcommand === 'hatch-incubator' || subcommand === 'hatchincubator') {
        const type = incubatorType(args[1]);
        const selection = args[2]?.toLowerCase() || 'all';
        if (!type || args.length > 3 || (selection !== 'all' && !/^\d+$/.test(selection))) {
          return message.reply(
            `Usage: \`${PREFIX}egg hatch-incubator <i|si> <slot|all>\`.`
          );
        }
        const incubators = getUserEggIncubators(userId)
          .filter((incubator) => incubator.incubator_type === type);
        const selected = selection === 'all'
          ? incubators.filter((incubator) => incubator.progress >= incubator.target)
          : incubators.filter((incubator) => incubator.slot === Number(selection));
        if (!selected.length) {
          const pending = selection === 'all'
            ? incubators.find((incubator) => incubator.progress < incubator.target)
            : incubators.find((incubator) => incubator.slot === Number(selection));
          if (!pending) return message.reply('❌ There is no Egg in that incubator slot.');
          return message.reply(
            `${EMOJIS.pokeEgg} Slot **${pending.slot}** needs **${pending.target - pending.progress} more catches** ` +
            `(${pending.progress}/${pending.target}).`
          );
        }
        const user = getUser(userId);
        const hatched = [];
        const hatchedPokemon = [];
        let experienceAwarded = false;
        for (const incubator of selected) {
          const hatch = rollEggHatch(incubator.target, Boolean(user.has_patreon));
          const result = hatchEggFromIncubator(userId, type, incubator.slot, hatch.pokemon, hatch);
          if (result.error === 'egg_not_ready') continue;
          if (result.error) throw new Error(`Could not hatch Egg from ${type} slot ${incubator.slot}: ${result.error}.`);
          const experience = awardCatchExperience(userId, getCatchExperienceReward('Egg'));
          rollActivityPromoDrops(message.author, message.guild, message.channel, 'egg');
          experienceAwarded = experienceAwarded || experience.awarded;
          const variant = result.isGolden ? 'Golden ' : result.isShiny ? 'Shiny ' : '';
          const variantEmoji = result.isGolden ? EMOJIS.golden : result.isShiny ? EMOJIS.shiny : '';
          hatchedPokemon.push({ ...hatch.pokemon, isShiny: result.isShiny, isGolden: result.isGolden });
          const emoji = type === 'incubator' ? EMOJIS.incubator : EMOJIS.superIncubator;
          hatched.push(`${emoji} Slot ${incubator.slot}: ${variantEmoji}**${variant}${hatch.pokemon.name}**`);
        }
        if (!hatched.length) return message.reply('❌ Those Eggs are not ready to hatch yet.');
        const remaining = getUserEggIncubators(userId)
          .filter((incubator) => incubator.incubator_type === type).length;
        const stillIncubating = incubators.length - hatched.length;
        const embed = new EmbedBuilder()
          .setColor(0x8e44ad)
          .setTitle(`${EMOJIS.pokeEgg} Hatched ${hatched.length} Egg${hatched.length === 1 ? '' : 's'}!`)
          .setDescription(
            `${hatched.join('\n')}\n\n` +
            `${EMOJIS.pokeEgg} Eggs remaining: **${getUser(userId).vote_eggs.toLocaleString()}**\n` +
            `${type === 'incubator' ? EMOJIS.incubator : EMOJIS.superIncubator} ${type === 'incubator' ? 'Incubator' : 'Super Incubator'} slots in use: **${remaining}/${EGG_INCUBATOR_LIMITS[type]}**\n` +
            (stillIncubating > 0 ? `**${stillIncubating}** other Egg${stillIncubating === 1 ? ' remains' : 's remain'} in incubator slots.\n` : '') +
            (experienceAwarded
              ? 'EXP was awarded to your Buddy and eligible Exp. Share team members.'
              : 'No Buddy or active Exp. Share team was available to receive hatch EXP.')
          );
        await message.reply({ embeds: [embed] });
        for (const pokemon of hatchedPokemon) await announceRareSpawn(message.guild, message.author, pokemon);
        return;
      }
      if (subcommand === 'hold') {
        if (args.length !== 1) return message.reply(`Usage: \`${PREFIX}egg hold\`.`);
        const catchTarget = getEggCatchTarget(userId);
        const result = holdEgg(userId, catchTarget);
        if (result.error === 'egg_already_held') {
          return message.reply(
            `You already have an Egg held (**${result.progress}/${result.target} catches**). ` +
            `Use \`${PREFIX}egg hatch\` when it is ready.`
          );
        }
        if (result.error === 'no_eggs') return message.reply(`You do not have an Egg to hold. Check \`${PREFIX}bag 2\`.`);
        return message.reply(
          `${EMOJIS.pokeEgg} You are now holding an Egg! It will be ready to hatch after ` +
          `**${catchTarget} successful Pokémon catches** ` +
          `(${getPatreonPerks(userId).eggHatchSpeed > 0 ? 'Rare Patreon hatch range: 20–110' : 'standard hatch range: 30–130'}). ` +
          `Check progress with \`${PREFIX}egg\`, then use \`${PREFIX}egg hatch\`.`
        );
      }
      if (subcommand === 'hatch') {
        if (args.length !== 1) return message.reply(`Usage: \`${PREFIX}egg hatch\`.`);
        const user = getUser(userId);
        if (user.held_egg_target <= 0) {
          return message.reply(`You are not holding an Egg. Start one with \`${PREFIX}egg hold\`.`);
        }
        if (user.held_egg_progress < user.held_egg_target) {
          return message.reply(
            `${EMOJIS.pokeEgg} Your held Egg needs **${user.held_egg_target - user.held_egg_progress} more ` +
            `successful Pokémon catches** (**${user.held_egg_progress}/${user.held_egg_target}**).`
          );
        }
        const hatch = rollEggHatch(user.held_egg_target, Boolean(user.has_patreon));
        const result = hatchEgg(userId, hatch.pokemon, hatch);
        if (result.error === 'no_held_egg') {
          return message.reply(`You are not holding an Egg. Start one with \`${PREFIX}egg hold\`.`);
        }
        if (result.error === 'egg_not_ready') {
          return message.reply(
            `${EMOJIS.pokeEgg} Your held Egg needs **${result.target - result.progress} more ` +
            `successful Pokémon catches** (**${result.progress}/${result.target}**).`
          );
        }
        const hatchExperience = getCatchExperienceReward('Egg');
        awardCatchExperience(userId, hatchExperience);
        rollActivityPromoDrops(message.author, message.guild, message.channel, 'egg');
        const variant = result.isGolden ? 'Golden ' : result.isShiny ? 'Shiny ' : '';
        const embed = new EmbedBuilder()
          .setColor(result.isGolden ? 0xf1c40f : result.isShiny ? 0xff66cc : 0x8e44ad)
          .setAuthor({ name: `${message.author.username}'s Egg hatched!`, iconURL: message.author.displayAvatarURL() })
          .setDescription(
            `${EMOJIS.pokeEgg} Your Egg hatched into ${result.isGolden ? EMOJIS.golden : result.isShiny ? EMOJIS.shiny : ''} ` +
            `**${variant}${hatch.pokemon.name}**!`
          )
          .setFooter({ text: `${getUser(userId).vote_eggs.toLocaleString()} Eggs left` });
        const hatchSprite = result.isGolden
          ? getGoldenSpriteUrl(hatch.pokemon.species_id ?? hatch.pokemon.id, hatch.pokemon.slug)
          : getPokemonShowdownSprite(
            hatch.pokemon.slug,
            result.isShiny,
            result.isShiny
              ? hatch.pokemon.shinyImg || hatch.pokemon.shiny_sprite || hatch.pokemon.img
              : hatch.pokemon.img
          );
        if (hatchSprite) embed.setImage(hatchSprite);
        await message.reply({ embeds: [embed] });
        await announceRareSpawn(message.guild, message.author, {
          ...hatch.pokemon,
          isShiny: result.isShiny,
          isGolden: result.isGolden,
        });
        return;
      }
      if (subcommand || args.length) {
        return message.reply(
          `Usage: \`${PREFIX}egg\`, \`${PREFIX}egg hold\`, \`${PREFIX}egg hatch\`, ` +
          `\`${PREFIX}egg use-incubator <i|si> <amount|all>\`, or ` +
          `\`${PREFIX}egg hatch-incubator <i|si> <slot|all>\`.`
        );
      }
      const user = getUser(userId);
      const eggs = user.vote_eggs;
      const incubators = getUserEggIncubators(userId);
      const ownedItems = new Map(getUserItems(userId).map((item) => [item.item_name, item.amount]));
      const heldText = user.held_egg_target > 0
        ? `✅ **You ARE holding an Egg!** (${user.held_egg_progress.toLocaleString()}/${user.held_egg_target.toLocaleString()} catches)` +
          (user.held_egg_progress >= user.held_egg_target ? ` — ready to hatch with \`${PREFIX}egg hatch\`.` : '')
        : '❌ **You are NOT holding an Egg!**';
      const incubatorLines = (type, max, emoji, name) => {
        const active = incubators.filter((entry) => entry.incubator_type === type);
        const statusBySlot = new Map(active.map((entry) => [entry.slot, entry]));
        return `**${emoji} ${name}s — You have ${ownedItems.get(name) || 0} ${name}s left**\n` +
          Array.from({ length: max }, (_, index) => {
            const slot = index + 1;
            const entry = statusBySlot.get(slot);
            return entry
              ? `${slot}. ${emoji} **${entry.progress >= entry.target ? 'Ready to hatch' : 'In use'}:** ${entry.progress}/${entry.target} catches`
              : `${slot}. ${emoji} ❌ Not in use`;
          }).join('\n');
      };
      const embed = new EmbedBuilder()
        .setColor(0x8e44ad)
        .setTitle(`${EMOJIS.pokeEgg} Umbreon Egg Centre — View & Hatch your Eggs!`)
        .setDescription(
          `${EMOJIS.pokeEgg} **Your Eggs:** ${eggs.toLocaleString()}\n\n` +
          `${heldText}\n` +
          `To hold or hatch a free Egg, use \`${PREFIX}egg hold\` or \`${PREFIX}egg hatch\`.\n\n` +
          `${incubatorLines('incubator', EGG_INCUBATOR_LIMITS.incubator, EMOJIS.incubator, 'Incubator')}\n\n` +
          `${incubatorLines('super_incubator', EGG_INCUBATOR_LIMITS.super_incubator, EMOJIS.superIncubator, 'Super Incubator')}\n\n` +
          `Use \`${PREFIX}egg use-incubator <i|si> <amount|all>\` to start incubators and ` +
          `\`${PREFIX}egg hatch-incubator <i|si> <slot|all>\` to hatch ready Eggs.\n` +
          `Incubators need 30–130 catches; Super Incubators need half as many.`
        )
        .setThumbnail('https://cdn.discordapp.com/emojis/1560319652402561124.webp?size=96');
      return message.reply({ embeds: [embed] });
    }

    if (command === 'help') {
      const helpAreas = {
        clan: {
          title: '🏰 Clan Commands',
          description:
            `• \`${PREFIX}clan\` — View your clan overview and personal contributions\n` +
            `• \`${PREFIX}clan create <name>\`, \`${PREFIX}clan join <name>\`, \`${PREFIX}clan leave\`, \`${PREFIX}clan disband\`\n` +
            `• \`${PREFIX}clan invite @user\` — Invite a player to your clan\n` +
            `• \`${PREFIX}clan donate <amount>\` — Donate PokéCoins to the clan treasury\n` +
            `• \`${PREFIX}clan stats [daily|weekly|monthly]\` — View ranked clan activity; choose a category from the menu (weekly/monthly use the command)\n` +
            `• \`${PREFIX}clan hs\` — View clans ranked by monthly catches\n` +
            `• \`${PREFIX}clan upgrade <rank>\` / \`${PREFIX}clan purchase <rank>\` — Unlock ranks and individually purchase perks\n` +
            `• \`${PREFIX}clan info ranks\` — View rank requirements and perks\n` +
            `• \`${PREFIX}clan add co-owner @member\`, \`${PREFIX}clan coowner remove\`, \`${PREFIX}clan transfer ownership @member\``,
        },
        team: {
          title: '⚔️ Team Commands',
          description:
            `• \`${PREFIX}team\` / \`${PREFIX}t\` — View your battle roster\n` +
            `• \`${PREFIX}team add <Pokémon name|Pokédex number> <slot 1-3>\`\n` +
            `• \`${PREFIX}team remove <slot 1-3>\`\n` +
            `• \`${PREFIX}team expshare on|off\` — Toggle Exp. Share\n` +
            `• \`${PREFIX}team give lootbox <slot|name>\` — Give a Lootbox to a team Pokémon`,
        },
        battle: {
          title: '⚔️ Battle Commands',
          description:
            `• \`${PREFIX}battle npc <number|name>\` / \`${PREFIX}b npc\` — Battle an NPC trainer; Volo is always available (30s cooldown)\n` +
            `• \`${PREFIX}npc list [region]\` / \`${PREFIX}battle npc list [region]\` — Browse NPCs, including Volo\n` +
            `• \`${PREFIX}faction npc list\` — List all faction NPCs and their teams\n` +
            `• \`${PREFIX}faction battle [leader|faction]\` — Challenge faction leaders with boosted teams and a chance to drop their icon\n` +
            `• \`${PREFIX}battle icons [@user]\` / \`${PREFIX}battle set-icon <name|number>\`\n` +
            `• \`${PREFIX}league\` — View League progress\n` +
            `• \`${PREFIX}mc\` — View and battle Mega Chambers`,
        },
        market: {
          title: '🛒 Market Commands',
          description:
            `• \`${PREFIX}market\` / \`${PREFIX}m\` — Browse Pokémon listings\n` +
            `• \`${PREFIX}market list\` / \`${PREFIX}m offer <Pokémon name|Pokédex number> <amount> <price>\` — List Pokémon\n` +
            `• \`${PREFIX}market view <Pokémon name|Pokédex number>\` / \`${PREFIX}m view <Pokémon name|Pokédex number>\` — Search listings\n` +
            `• \`${PREFIX}mbuy <listing_id>\` — Buy a listing`,
        },
        trade: {
          title: '🔁 Trade Commands',
          description:
            `• \`${PREFIX}trade @user <your Pokémon name|Pokédex number> <their Pokémon name|Pokédex number>\` — Propose both sides of a trade\n` +
            `• \`${PREFIX}trade @user <your Pokémon name|Pokédex number>\` — Offer one Pokémon and let the recipient reply with theirs\n` +
            `• \`${PREFIX}swap <Pokémon name|Pokédex number>\` — PokeSwap one Pokémon\n` +
            `• \`${PREFIX}swap shiny|golden <Pokémon name|Pokédex number>\` — PokeSwap a specific variant\n` +
            `• \`${PREFIX}swap info\` — View your current PokeSwap multiplier\n` +
            `• \`${PREFIX}excl swap\` — View swap-exclusive Pokémon\n` +
            `• \`${PREFIX}excl catchbot\` — View CatchBot-exclusive Golden Pokémon`,
        },
        fishing: {
          title: '🎣 Fishing Commands',
          description:
            `• \`${PREFIX}fish\` / \`${PREFIX}f\` — Fish for Pokémon\n` +
            `• \`${PREFIX}fish shop\` — Buy Diveballs for 50 Fishing Tokens each\n` +
            `• \`${PREFIX}item info diveball\` — View Diveball details\n` +
            `• \`${PREFIX}rod\` — View or manage fishing rods\n` +
            `• \`${PREFIX}excl fish\` — View Fishing-exclusive Pokémon\n` +
            `Fishing catches contribute to your clan activity stats.`,
        },
        eggs: {
          title: '🥚 Egg Inventory',
          description:
            `• \`${PREFIX}egg\` — View your Eggs, active progress, and incubator slots\n` +
            `• \`${PREFIX}egg hold\` — Hold an Egg and begin counting successful Pokémon catches\n` +
            `• \`${PREFIX}egg hatch\` — Hatch a ready free-held Egg into an Egg-exclusive Pokémon\n` +
            `• \`${PREFIX}excl egg\` — View Egg-exclusive Pokémon\n` +
            `• \`${PREFIX}egg use-incubator <i|si> <amount|all>\` — Start up to 2 Incubators or 6 Super Incubators\n` +
            `• \`${PREFIX}egg hatch-incubator <i|si> <slot|all>\` — Hatch a ready incubated Egg; Super Incubators halve the catch target\n` +
            `• Incubator aliases: \`i\` (Incubator), \`si\` (Super Incubator)`,
        },
        economy: {
          title: '🪙 Economy Commands',
          description:
            `• \`${PREFIX}balance\` / \`${PREFIX}bal\` — View currency balances\n` +
            `• \`${PREFIX}daily\` — Claim your daily reward\n` +
            `• \`${PREFIX}shop\` / \`${PREFIX}shop buy <number|item> [amount]\`\n` +
            `• \`${PREFIX}clan donate <amount>\` — Donate to your clan treasury\n` +
            `• \`${PREFIX}market\` — Browse Pokémon listings`,
        },
      };
      const requestedArea = args.join(' ').toLowerCase().trim();
      const areaAliases = {
        c: 'clan',
        b: 'battle',
        league: 'battle',
        mc: 'battle',
        m: 'market',
        mbuy: 'market',
        swap: 'trade',
        sw: 'trade',
        pokeswap: 'trade',
        fish: 'fishing',
        f: 'fishing',
        rod: 'fishing',
        egg: 'eggs',
        daily: 'economy',
        balance: 'economy',
        bal: 'economy',
        shop: 'economy',
        donate: 'clan',
      };
      const area = helpAreas[requestedArea] || helpAreas[areaAliases[requestedArea]];
      if (area) {
        return message.reply({
          embeds: [new EmbedBuilder()
            .setColor(0x0080ff)
            .setTitle(area.title)
            .setDescription(area.description)
            .setFooter({ text: `Use ${PREFIX}help for all command categories` })],
        });
      }

      const helpPages = {
        general: new EmbedBuilder()
          .setColor(0x0080ff)
          .setTitle('📖 Umbreon Help — General & Catching')
          .setDescription(
            `Default prefix: \`${PREFIX}\`\n\n` +
            `• \`${PREFIX}p\` / \`${PREFIX}pokemon\` — Spawn a wild Pokémon (7s cooldown)\n` +
            `• \`${PREFIX}fish\` / \`${PREFIX}f\` — Fish for Water-type Pokémon using your rod (15s cooldown)\n` +
            `• \`${PREFIX}repel [amount]\` — Use Repels to change wild land encounter rarity weights for 30 encounters each\n` +
            `• \`${PREFIX}dailycatchers\` / \`${PREFIX}dc\` — View today's top 10 Pokémon catchers\n` +
            `• \`${PREFIX}counters\` / \`${PREFIX}co\` — View Legendary and Shiny encounter counters for .p and .f\n` +
            `• \`${PREFIX}hunt\` / \`${PREFIX}hunt reroll\` — View or reroll your daily Legendary target\n` +
            `• \`${PREFIX}box\` / \`${PREFIX}pc\` — Browse your Pokémon storage\n` +
            `• \`${PREFIX}buddy [set <name|Pokédex number>|clear]\` — Choose and inspect your buddy; numeric IDs match PC Pokédex numbers\n` +
            `• \`${PREFIX}moves\` — View your buddy's moves; \`${PREFIX}move replace <move|slot> <new move>\` changes one ` +
            `(${EMOJIS.pokecoin} cost), and \`${PREFIX}move swap <slot> <slot>\` swaps two equipped moves\n` +
            `• \`${PREFIX}team add <Pokédex number|name> <slot 1-3>\` / \`${PREFIX}team remove <slot 1-3>\` — Manage your three team slots\n` +
            `• \`${PREFIX}team expshare on|off\` — Toggle your purchased Exp. Share for the active team\n` +
            `• \`${PREFIX}team give lootbox <slot|name>\` — Give a Lootbox to a Pokémon on your team\n` +
            `  Filter with \`${PREFIX}box fav\`, \`${PREFIX}box shiny\`, \`${PREFIX}box <rarity>\`, or \`${PREFIX}box type <type>\`\n` +
            `  Favorite Pokédex numbers with \`${PREFIX}box fav <number|all>\`; use a region or \`${PREFIX}box @user\` to filter/view\n` +
            `• \`${PREFIX}dex\` / \`${PREFIX}d\` — Search the Pokédex by name or number; prefix with \`shiny\` for shiny entries\n` +
            `• \`${PREFIX}pokedex [page]\` — Browse the full Pokédex and caught status\n` +
            `• \`${PREFIX}perks\` — View server booster perks and your role status\n` +
            `• \`${PREFIX}vote\` — View your Top.gg vote balance, streak, and rewards\n` +
            `• \`${PREFIX}balance\` / \`${PREFIX}bal\` — View your currency balances\n` +
            `• \`${PREFIX}bag\` / \`${PREFIX}inv\` / \`${PREFIX}inventory\` [page] — View your paginated bag (items, evolution items, boxes)\n` +
            `• \`${PREFIX}collection\` / \`${PREFIX}coll\` — Browse public Global Collections; use \`${PREFIX}coll help\` for options\n` +
            `• \`${PREFIX}use rarecandy <amount|all>\` (alias \`rc\`) — Level up your buddy with Rare Candy\n` +
            `• \`${PREFIX}release <Pokémon name|Pokédex number>\` / \`${PREFIX}r\` — Release a Pokémon for PokéCoins; \`${PREFIX}release number <Pokédex number> [amount]\` releases multiples\n` +
            `  Use \`${PREFIX}release duplicates\` (\`${PREFIX}r d\`) or \`${PREFIX}release type <rarity>mons\` for bulk releases; use \`${PREFIX}release lock|unlock <name|Pokédex number|mega-line|egg|rarity|event|starters>\`, \`${PREFIX}release view-locks\`, or \`${PREFIX}release clear-locks\``
          )
          .setFooter({ text: 'Page 1/4 • Select a category below' }),
        economy: new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle('🛒 Umbreon Help — Economy & Items')
          .setDescription(
            `• \`${PREFIX}shop\` — View the PokéMart catalog\n` +
            `• \`${PREFIX}shop buy <number|item> [amount]\` — Buy a numbered shop item\n` +
            `• \`${PREFIX}swap <Pokémon>\`, \`${PREFIX}swap shiny <Pokémon>\`, or \`${PREFIX}swap golden <Pokémon>\` — PokeSwap one Pokémon; use \`${PREFIX}excl swap\` to view swap-exclusive Pokémon\n` +
            `• \`${PREFIX}quest reset <1-3>\` — Spend a Quest Reset Scroll to replace an active quest\n` +
            `• \`${PREFIX}item info shiny charm\` — View Shiny Charm ownership and bonus\n` +
            `• \`${PREFIX}item info lootbox\` — View Lootbox ownership and reward chances\n` +
            `• \`${PREFIX}lb all\` / \`${PREFIX}open <box> all\` — Open all owned Lootboxes or all boxes of one type\n` +
            `• \`${PREFIX}lb all\` / \`${PREFIX}open <box> all\` — Open all owned Lootboxes or all boxes of one type\n` +
            `• \`${PREFIX}repel\`, \`${PREFIX}superrepel\` / \`${PREFIX}sr\`, \`${PREFIX}maxrepel\` / \`${PREFIX}mr\`, \`${PREFIX}honey\` — Activate 30-encounter modifiers (one active at a time)\n` +
            `• \`${PREFIX}hunt\` — View your daily catch target and reward\n` +
            `• \`${PREFIX}daily\` — Claim daily PokéCoins and balls\n` +
            `• \`${PREFIX}clan\` — Manage clans; use \`${PREFIX}clan hs\` for clan highscores\n` +
            `• \`${PREFIX}clan info ranks\` — View rank requirements and perks\n` +
            `• \`${PREFIX}clan purchase <rank>\` — Individually purchase unlocked clan perks with your catches and coins\n` +
            `• \`${PREFIX}clan upgrade <rank>\` — Clan leaders/co-owners unlock the next rank using catches and treasury coins\n` +
            `• \`${PREFIX}channel add boost\` — eligible Patreon supporters add a personal +5% rate boost in this channel (up to 10 channels)\n` +
            `• \`${PREFIX}evoitems\` — View your evolution stones/items and what they evolve\n` +
            `• \`${PREFIX}evolve <Pokémon> [item]\` / \`${PREFIX}use <item> <Pokémon>\` — Evolve with an item, level, or high friendship (catch Pokémon with a buddy to raise it)\n` +
            `• \`${PREFIX}hold <item> <Pokémon>\` / \`${PREFIX}unhold <Pokémon>\` — Hold an evolution item\n` +
            `• \`${PREFIX}giveaway set [#channel]\` / \`${PREFIX}gstart items|coins|pokemon ...\` — Manage Server: run giveaways\n` +
            `• \`${PREFIX}autospawn set [#channel]\` / \`${PREFIX}autospawn disable\` — Manage Channels: toggle button-guess wild spawns\n` +
            `• \`${PREFIX}clan add co-owner @member\` — Add up to 3 co-owners (one primary owner)\n` +
            `• \`${PREFIX}clan transfer ownership @member\` — Transfer leadership to a current clan member\n` +
            `• \`${PREFIX}clan invite @user\` — Invite a player to your clan with accept/deny buttons\n` +
            `• \`${PREFIX}clan donate <amount>\` — Contribute coins to your clan treasury\n` +
            `• \`${PREFIX}clan stats [daily|weekly|monthly]\` — View ranked activity; weekly/monthly periods are opened with the command\n` +
            `• \`${PREFIX}streak\` — View your daily streak and rarity streaks\n` +
            `• \`${PREFIX}dailycatchers\` / \`${PREFIX}dc\` — View today's top 10 Pokémon catchers\n` +
            `• \`${PREFIX}counters\` / \`${PREFIX}co\` — View Legendary and Shiny encounter counts since the last catch for .p and .f\n` +
            `• \`${PREFIX}lb [amount|all]\` / \`${PREFIX}lootbox open [amount|all]\` — Open Lootboxes\n` +
            `• \`${PREFIX}boxes\` — View the boxes you own and their quantities\n` +
            `• \`${PREFIX}open [box name] [amount|all]\` — Open boxes (no argument lists all box types)\n` +
            `• \`${PREFIX}shop buy <number|item> [amount]\` / \`${PREFIX}s b <number|item> [amount]\` — Buy shop items\n` +
            `• \`${PREFIX}market\` / \`${PREFIX}m\` — Browse market listings; use \`${PREFIX}market view <Pokémon name>\` or \`${PREFIX}m view <Pokémon name>\` to search\n` +
            `• \`${PREFIX}market list\` / \`${PREFIX}m offer <Pokémon number or name> <amount> <price>\` — List owned Pokémon at the price per Pokémon\n` +
            `• \`${PREFIX}mbuy <listing_id>\` — Buy a market listing`
          )
          .setFooter({ text: 'Page 2/4 • Select a category below' }),
        battles: new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('⚔️ Umbreon Help — Battles & Progress')
          .setDescription(
            `• \`${PREFIX}team\` — View your battle roster and stats\n` +
            `• \`${PREFIX}team expshare on|off\` — Toggle your purchased Exp. Share for the active team\n` +
            `            • \`${PREFIX}battle npc <number/name>\` / \`${PREFIX}b npc\` — Battle NPC trainers starting with Brock (\`${PREFIX}battle npc 1\`); Volo is always available with \`${PREFIX}battle npc volo\` (30s cooldown)\n` +
                        `• \`${PREFIX}npc list [region]\` / \`${PREFIX}battle npc list [region]\` — Browse all NPCs (paginated); cleared campaign NPCs can be rematched for icon drops (1/1K)\n` +
                        `• \`${PREFIX}faction npc list\` — List all faction NPCs and their teams\n` +
            `• \`${PREFIX}battle icons [@user]\` / \`${PREFIX}battle set-icon <name|number>\` — View and set unlocked NPC battle icons\n` +
            `• \`${PREFIX}league\` — Check progress across Kanto, Johto, Hoenn, Sinnoh, Unova, Kalos, Alola, Galar, and Paldea\n` +
            `• \`${PREFIX}mc\` — View Mega Chambers; sacrifice Pokémon with \`${PREFIX}mc sacrifice <Pokémon> [amount]\`, then use move buttons in \`${PREFIX}mc battle <chamber>\`\n` +
            `• \`${PREFIX}mega evo <Pokémon name>\` — Requires ${EMOJIS.megabracelet} Mega Bracelet (shop item 22, 125 vote coins) and the matching Mega Stone\n` +
            `• \`${PREFIX}wb\` — View the active shared World Boss; use \`${PREFIX}wb fight\` from any channel to battle\n` +
            `• \`${PREFIX}quest\` / \`${PREFIX}q\` — View your daily quest and two type-encounter quests\n` +
            `• \`${PREFIX}cl\` / \`${PREFIX}checklist\` — Check daily goals and rewards\n` +
            `• \`${PREFIX}cb\` — View CatchBot upgrades and lifetime catches\n` +
            `• \`${PREFIX}cb upgrade <pokemon|cost|duration|luck>\` — Upgrade CatchBot stats\n` +
            `• \`${PREFIX}cb run [hours]\` / \`${PREFIX}cb claim\` — Run CatchBot or collect its catches\n` +
            `• \`${PREFIX}trade @user <your Pokémon name|Pokédex number> <their Pokémon name|Pokédex number>\` — Propose a two-sided trade\n` +
            `• \`${PREFIX}trade @user <your Pokémon name|Pokédex number>\` — Offer one Pokémon; the recipient can reply with theirs`
          )
          .setFooter({ text: 'Page 3/4 • Select a category below' }),
        events: new EmbedBuilder()
          .setColor(0x9b59b6)
          .setTitle('🎟️ Umbreon Help — Events & Stats')
          .setDescription(
            `• \`${PREFIX}events\` / \`${PREFIX}e\` — View the event hub and shop\n` +
            `• \`${PREFIX}events buy ticket\` — Join the active event\n` +
            `• \`${PREFIX}events buy premierball <amount>\` — Buy event balls\n` +
            `• \`${PREFIX}e cl\` — View event checklist progress\n` +
            `• \`${PREFIX}e cl claim\` — Claim an available checklist reward\n` +
            `• \`${PREFIX}s\` / \`${PREFIX}stats [@user]\` — View trainer statistics\n` +
            `• \`${PREFIX}profile\` / \`${PREFIX}pr\` — View a trainer profile`
          )
          .setFooter({ text: 'Page 4/4 • Select a category below' }),
      };
      helpPages.progress = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('🌟 Umbreon Help — Progress & Social')
        .setDescription(
          `• \`${PREFIX}faction\` / \`${PREFIX}fac\` — Join or view your faction, daily ball and rank\n` +
          `• \`${PREFIX}grazz <amount>\` — Use Golden Razz Berries to boost Legendary encounters\n` +
          `• \`${PREFIX}item info grazz\` — View Golden Razz Berry info\n` +
          `• \`${PREFIX}move info <move>\` — View a move's type, power, accuracy and learners\n` +
          `• \`${PREFIX}streak\` — View your daily streak and rarity streaks\n` +
          `• \`${PREFIX}lottery\` / \`${PREFIX}lot\` — View the lottery; \`${PREFIX}lottery buy <amount>\` buys tickets\n` +
          `• \`${PREFIX}lottery channel [#channel]\` — Manage Channels: set the lottery results channel\n` +
          `• \`${PREFIX}autospawn set [#channel]\` / \`${PREFIX}autospawn disable\` — Manage Channels: wild spawns\n` +
          `• \`${PREFIX}giveaway set [#channel]\` — Manage Server: set the giveaway channel\n` +
          `• \`${PREFIX}help\` — Show this list; admins can use \`${PREFIX}admin help\``
        );
      const pageList = Object.values(helpPages);
      return sendPagedEmbeds(message, pageList, '📖 Umbreon Help');
    }

    if (command === 'giveaway' || command === 'gstart') {
      if (!message.guild) return message.reply('Giveaways can only be managed inside a server.');
      const canManage = isBotAdmin(message)
        || message.member?.permissions.has(PermissionsBitField.Flags.ManageGuild);
      if (!canManage) return message.reply('⛔ Only server managers can start giveaways.');
      const type = args[0]?.toLowerCase();
      if (type === 'pokemon' && !isBotAdmin(message)) {
        return message.reply('⛔ Pokémon giveaways can only be started by an admin.');
      }
      const giveawayUsage =
        '**Giveaway commands:**\n' +
        `• \`${PREFIX}giveaway set [#channel]\` — Set the giveaway channel.\n` +
        `• \`${PREFIX}gstart items <winners> [minutes]\` — Item bundle.\n` +
        `• \`${PREFIX}gstart coins <amount> <winners> [minutes]\` — PokéCoins.\n` +
        `• \`${PREFIX}gstart pokemon <name> <true|false|golden> <winners> [minutes]\` — A Pokémon.`;

      if (type === 'set') {
        const channel = message.mentions.channels.first() || message.channel;
        if (channel.guildId !== message.guildId || channel.type !== ChannelType.GuildText) {
          return message.reply('Choose a text channel in this server.');
        }
        setGiveawayChannel(message.guildId, channel.id);
        return message.reply(`✅ Giveaway channel set to <#${channel.id}>.`);
      }

      const positive = (value, fallback, max) => {
        if (value === undefined) return fallback;
        const parsed = Number(value);
        return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= max ? parsed : null;
      };
      let prizeTitle;
      let prizeData;
      let winnerArg;
      let minuteArg;
      if (type === 'items') {
        [winnerArg, minuteArg] = [args[1], args[2]];
        prizeTitle = '📦 Items';
        prizeData = rollGiveawayItems();
      } else if (type === 'coins') {
        const amount = parseAmount(args[1] || '');
        if (!Number.isSafeInteger(amount) || amount <= 0) return message.reply(giveawayUsage);
        [winnerArg, minuteArg] = [args[2], args[3]];
        prizeTitle = `${EMOJIS.pokecoin} ${amount.toLocaleString()} PokéCoins`;
        prizeData = { coins: amount };
      } else if (type === 'item') {
        const amountIndex = args.findIndex((arg, index) => index > 1 && /^\d+$/.test(arg));
        const itemQuery = amountIndex > 1 ? args.slice(1, amountIndex).join(' ') : '';
        const promoItem = findPromoByItemName(itemQuery);
        const itemName = itemQuery
          ? (findEvolutionItem(itemQuery) || findBox(itemQuery) || promoItem?.itemName || null)
          : null;
        const quantity = amountIndex > 1 ? Number(args[amountIndex]) : 0;
        if (!itemName || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) {
          return message.reply(
            `Usage: \`${PREFIX}gstart item <evolution item or box> <amount> <winners> [minutes]\`. See \`${PREFIX}evoitems\`.`
          );
        }
        [winnerArg, minuteArg] = [args[amountIndex + 1], args[amountIndex + 2]];
        prizeTitle = `${EVOLUTION_ITEMS[itemName]?.emoji || BOXES[itemName]?.emoji || promoItem?.itemEmoji} ${quantity}x ${itemName}`;
        prizeData = { items: { [itemName]: quantity } };
      } else if (type === 'pokemon') {
        const flagIndex = args.findIndex((arg, index) => index > 1 && /^(true|false|golden)$/i.test(arg));
        if (flagIndex < 2) return message.reply(giveawayUsage);
        const form = resolvePokemonForm(args.slice(1, flagIndex).join(' '));
        if (!form) return message.reply('That Pokémon was not found in the Pokédex.');
        const variant = args[flagIndex].toLowerCase();
        const isShiny = variant === 'true';
        const isGolden = variant === 'golden';
        if (isGolden && !isGoldenFormSupported(form.species_id, form.slug, Boolean(form.is_default))) {
          return message.reply('Golden giveaways are limited to base Pokémon and supported regional forms (no Mega or Gmax forms).');
        }
        [winnerArg, minuteArg] = [args[flagIndex + 1], args[flagIndex + 2]];
        prizeTitle = isGolden ? `${EMOJIS.golden} Golden ${form.name}` : `${isShiny ? '✨ Shiny ' : ''}${form.name}`;
        prizeData = { pokemon: { id: form.id, name: form.name, rarity: form.rarity, isShiny, isGolden } };
      } else {
        return message.reply(giveawayUsage);
      }
      const winnerCount = positive(winnerArg, 1, 100);
      const durationMinutes = positive(minuteArg, 5, GIVEAWAY_MAX_MINUTES);
      if (!winnerCount || !durationMinutes) {
        return message.reply(
          `Winners must be 1–100 and duration 1–${GIVEAWAY_MAX_MINUTES} minutes.`
        );
      }

      const savedChannel = getGiveawayChannel(message.guildId);
      let targetChannel = savedChannel
        ? await client.channels.fetch(savedChannel.channel_id).catch(() => null)
        : null;
      if (!targetChannel || targetChannel.guildId !== message.guildId) targetChannel = message.channel;
      await postGiveaway(
        message.guildId, targetChannel, prizeTitle, prizeData, winnerCount, durationMinutes * 60 * 1000
      );
      if (targetChannel.id !== message.channel.id) {
        return message.reply(`✅ Giveaway started in <#${targetChannel.id}>!`);
      }
      return;
    }

    if (command === 'autospawn') {
      if (!message.guildId) return message.reply('Autospawn can only be configured inside a server.');
      const canManage = isBotAdmin(message)
        || message.member?.permissions.has(PermissionsBitField.Flags.ManageChannels);
      if (!canManage) {
        return message.reply('⛔ You need the `Manage Channels` permission to configure autospawn.');
      }
      const action = args[0]?.toLowerCase();
      if (action === 'set') {
        const targetChannel = message.mentions.channels.first() || message.channel;
        if (targetChannel.guildId !== message.guildId || targetChannel.type !== ChannelType.GuildText) {
          return message.reply('Choose a text channel in this server.');
        }
        setAutoSpawnChannel(message.guildId, targetChannel.id);
        autospawnStates.delete(message.guildId);
        return message.reply(
          `✅ Autospawn is active in <#${targetChannel.id}>. Spawns run at :00/:15/:30/:45 every hour ` +
          '(the :00 spawn is a guaranteed Legendary or Shiny), plus every 15–75 messages server-wide — ' +
          'higher message targets roll rarer Pokémon, up to Super Rare.'
        );
      }
      if (action === 'disable' || action === 'stop') {
        const stateToClear = autospawnStates.get(message.guildId);
        if (stateToClear?.timer) clearTimeout(stateToClear.timer);
        autospawnStates.delete(message.guildId);
        return message.reply(disableAutoSpawnChannel(message.guildId)
          ? '🛑 Autospawn has been disabled for this server.'
          : 'Autospawn is not enabled for this server.');
      }
      if (action === 'status') {
        const guildConfig = getAutoSpawnChannel(message.guildId);
        if (!guildConfig) {
          return message.reply(
            `Autospawn is not enabled for this server. Use \`${PREFIX}autospawn set [#channel]\` to choose a channel.`
          );
        }
        const tracked = autospawnStates.get(message.guildId);
        const configuredChannel = message.guild.channels.cache.get(guildConfig.channel_id);
        const botMember = message.guild.members.me;
        const botPerms = configuredChannel && botMember
          ? configuredChannel.permissionsFor(botMember)
          : null;
        const canPost = botPerms?.has([
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.EmbedLinks,
        ]);
        return message.reply(
          '**Autospawn status:**\n' +
          `• Channel: <#${guildConfig.channel_id}>\n` +
          '• Counting messages in: ✅ all server channels\n' +
          `• Bot can post in configured channel: ` +
            `${canPost ? '✅' : '⚠️ missing View Channel / Send Messages / Embed Links'}\n` +
          `• Messages counted: ${tracked?.count ?? guildConfig.message_count ?? 0} / ` +
            `${(tracked?.nextTarget ?? guildConfig.message_target) || '—'}\n` +
          `• Spawn currently active: ${tracked?.active ? 'yes' : 'no'}\n` +
          '• Scheduled spawns: :00 / :15 / :30 / :45 past each hour (:00 = Legendary or Shiny)\n' +
          '_Message progress is saved and continues after bot restarts._'
        );
      }
      return message.reply(
        '**Autospawn commands:**\n' +
        `• \`${PREFIX}autospawn set [#channel]\` — Choose the channel for wild button spawns.\n` +
        `• \`${PREFIX}autospawn status\` — Show the configured channel, permissions, and progress.\n` +
        `• \`${PREFIX}autospawn disable\` — Turn off wild spawns.`
      );
    }

    if (command === 'lottery' || command === 'lot') {
      const sub = args[0]?.toLowerCase();
      const state = getLotteryState();
      const now = Date.now();
      const userStats = getUserLotteryStats(userId);
      const diffMs = state.ends_at - now;
      const isBlocked = Math.abs(diffMs) <= 5 * 60 * 1000;

      if (sub === 'channel' || sub === 'setchannel') {
        if (!message.guildId) return message.reply('Lottery results channels can only be set inside a server.');
        const canManage = isBotAdmin(message)
          || message.member?.permissions.has(PermissionsBitField.Flags.ManageChannels);
        if (!canManage) {
          return message.reply('⛔ You need the `Manage Channels` permission to set the lottery channel.');
        }
        const targetChannel = message.mentions.channels.first() || message.channel;
        if (targetChannel.guildId !== message.guildId || targetChannel.type !== ChannelType.GuildText) {
          return message.reply('Choose a text channel in this server.');
        }
        setLotteryChannel(message.guildId, targetChannel.id);
        return message.reply(`✅ Lottery results will be posted in <#${targetChannel.id}>.`);
      }

      if (sub === 'buy') {
        if (isBlocked) {
          return message.reply('⏳ Ticket buying is paused 5 minutes before & after the draw.');
        }
        const amount = parseAmount(args[1] || '');
        if (!Number.isSafeInteger(amount) || amount <= 0) {
          return message.reply(`Usage: \`${PREFIX}lottery buy <amount>\``);
        }
        const result = buyLotteryTickets(userId, amount);
        if (result.error === 'insufficient_coins') {
          return message.reply(
            `❌ You need **${result.totalCost.toLocaleString()} PokéCoins** to buy **${amount.toLocaleString()}** ticket(s)!`
          );
        }
        return message.reply(
          `🎟️ You bought **${amount.toLocaleString()} ticket(s)** for **${result.totalCost.toLocaleString()} PokéCoins**! ` +
          `**${result.addedToJackpot.toLocaleString()}** was deposited into the jackpot.`
        );
      }

      const allTickets = db.prepare('SELECT user_id, ticket_count FROM lottery_tickets').all();
      const totalTickets = allTickets.reduce((sum, entry) => sum + entry.ticket_count, 0);
      const userTickets = allTickets.find((entry) => entry.user_id === userId)?.ticket_count || 0;
      const winPercentage = totalTickets > 0 ? ((userTickets / totalTickets) * 100).toFixed(1) : '0';
      const drawDay = new Date(state.ends_at - 5 * 60 * 60 * 1000).getUTCDay();
      const nextGoldenPrize = LOTTERY_SCHEDULE[drawDay] || null;
      const endsText = diffMs >= 3600000
        ? `in ${Math.floor(diffMs / 3600000)} hours`
        : `in ${Math.max(0, Math.floor(diffMs / 60000))} minutes`;
      const dayNames = { 0: 'Sunday', 1: 'Monday', 3: 'Wednesday', 5: 'Friday' };
      const goldenScheduleLines = [0, 1, 3, 5].map((day) => {
        const prize = LOTTERY_SCHEDULE[day];
        const text = prize ? `${EMOJIS.golden} ${prize.name}` : 'PokéCoins only';
        return day === drawDay
          ? `• 💥 **${dayNames[day]}: ${text}** 💥`
          : `• ${dayNames[day]}: ${text}`;
      });
      const embed = new EmbedBuilder()
        .setColor(0x2B2D31)
        .setAuthor({
          name: 'PokéLottery — Win the Jackpot!',
          iconURL: message.client.user.displayAvatarURL(),
        })
        .setDescription(
          '• Every ticket is a separate entry, so more tickets means a higher chance to win!\n' +
          '• Ticket buying is blocked **5 minutes before & after** the lottery ends.\n' +
          '• **75% of the purchase cost** is deposited into the jackpot (25% tax)\n\n' +
          `**1st winner:** 50% of the jackpot${nextGoldenPrize ? ` + ${EMOJIS.golden} **${nextGoldenPrize.name}**!` : ''}\n` +
          '**2nd winner:** 30% of the jackpot\n' +
          '**3rd winner:** 20% of the jackpot\n\n' +
          `${EMOJIS.golden} **1st place prizes by draw day:**\n${goldenScheduleLines.join('\n')}\n\n` +
          `🎟️ **Cost:** ${EMOJIS.pokecoin} 10,000 — ${PREFIX}lottery buy <amount>\n\n` +
          '📊 **Your lottery stats**\n' +
          `🥇🥈🥉 wins: ${userStats.wins_first}/${userStats.wins_second}/${userStats.wins_third} • Lotteries joined: ${userStats.lotteries_joined}\n` +
          `🎟️ Lifetime tickets: ${userStats.lifetime_tickets.toLocaleString()} • ${EMOJIS.pokecoin} Lifetime winnings: ${userStats.lifetime_winnings.toLocaleString()}\n\n` +
          `**Current Jackpot** • **This Lottery Ends** • **Total Participants**\n` +
          `${EMOJIS.pokecoin} ${state.jackpot.toLocaleString()} • ⏰ ${endsText} • 👥 ${allTickets.length}\n\n` +
          `**Your Lottery Entries** • **Your Win Percentage** • **Total Tickets**\n` +
          `🎟️ ${userTickets.toLocaleString()} • 📈 ${winPercentage}% • 📊 ${totalTickets.toLocaleString()}`
        )
        .setFooter({ text: 'Winners are drawn every Mon, Wed, Fri & Sun at 9pm (EST)' });
      if (nextGoldenPrize) embed.setThumbnail(getGoldenSpriteUrl(nextGoldenPrize.speciesId));
      return message.reply({ embeds: [embed] });
    }

    if (command === 'promo') {
      const promos = getActivePromos();
      if (!promos.length) return message.reply('There is no active promo right now.');

      const promoItemCount = (promo) => db.prepare(
        'SELECT amount FROM user_items WHERE user_id = ? AND item_name = ?'
      ).get(userId, promo.itemName)?.amount || 0;

      const claimPromo = (promo) => {
        const user = getUser(userId);
        if (user.coins < promo.costCoins) return { error: 'coins' };
        const owned = promoItemCount(promo);
        if (owned < promo.costItems) return { error: 'items', owned };
        const form = db.prepare(
          'SELECT * FROM pokemon_forms WHERE species_id = ? AND is_default = 1 ORDER BY id LIMIT 1'
        ).get(promo.speciesId);
        if (!form) throw new Error(`promo.json speciesId ${promo.speciesId} has no base form in the catalog.`);
        db.transaction(() => {
          incrementUser(userId, { coins: -promo.costCoins, promos_claimed: 1 });
          takeUserItem(userId, promo.itemName, promo.costItems);
          saveGoldenCatch(userId, {
            id: form.id,
            name: form.name,
            rarity: 'Golden',
            baseHp: form.base_hp,
            baseAtk: form.base_atk,
            baseDef: form.base_def,
            baseSpd: form.base_spd,
          });
        }).immediate();
        return { form };
      };

      const buildClaimEmbed = (promo, form) => new EmbedBuilder()
        .setColor(RARITY_COLORS.golden)
        .setTitle(`🎉 Promo Claimed: ${promo.name}!`)
        .setDescription(
          `You exchanged **${promo.costCoins.toLocaleString()} PokéCoins** and ` +
          `**${promo.costItems}x ${promo.itemEmoji} ${promo.itemName}** for a ${EMOJIS.golden} **${promo.name}**!\n\n` +
          `• Species: **${form.species_name}** [#${getGoldenDexNumber(form.species_id)}]\n` +
          '• Level: **1**\n' +
          `• Added directly to your ${PREFIX}box!`
        )
        .setThumbnail(promo.img);

      const dropSourceLabels = {
        catch: `${EMOJIS.pokeball} Catching Pokémon (${PREFIX}p)`,
        fish: `${EMOJIS.fishingtoken} Fishing (${PREFIX}fish)`,
        battle: '⚔️ Battling',
        egg: '🥚 Hatching Eggs',
      };
      const incenseOn = Boolean(message.guildId) && getIncenseCharges(message.guildId) > 0;
      const promoMultiplier = getPromoChanceMultiplier(userId, incenseOn);
      const boostParts = [];
      if (incenseOn) boostParts.push(`${EMOJIS.incense} Incense +10%`);
      if (getPatreonPerks(userId).goldenBoost) boostParts.push(`Patreon +${Math.round(getPatreonPerks(userId).goldenBoost * 100)}%`);
      const buildPromoEmbed = (promo) => {
        const dropSources = Object.entries(promo.drops)
          .filter(([, drop]) => drop && drop.enabled !== false && Number.isSafeInteger(Number(drop.oneIn)))
          .map(([source, drop]) =>
            `• ${dropSourceLabels[source] || `${promo.itemEmoji} ${source}`} (1/${Math.max(1, Math.round(Number(drop.oneIn) / promoMultiplier)).toLocaleString()})`
          );
        return new EmbedBuilder()
          .setColor(0x2B2D31)
          .setAuthor({
            name: 'Special Golden Promotionals',
            iconURL: message.client.user.displayAvatarURL(),
          })
          .setTitle(`✨ ${promo.name} Promo! ✨`)
          .setDescription(
            `**Current Promo:** ${EMOJIS.golden} **${promo.name}** [#${getGoldenDexNumber(promo.speciesId)}]\n` +
            `**Cost:** ${EMOJIS.pokecoin} **${promo.costCoins.toLocaleString()}** & ` +
            `**${promo.costItems}x ${promo.itemEmoji} ${promo.itemName}**\n\n` +
            `You have **${promoItemCount(promo)}x ${promo.itemEmoji} ${promo.itemName}**. You can obtain them from:\n` +
            `${dropSources.join('\n')}\n` +
            (boostParts.length ? `*Your odds include: ${boostParts.join(' • ')}*\n` : '') + `\n` +
            `🎁 **To purchase ${EMOJIS.golden} ${promo.name}**, press Claim below or type ${PREFIX}promo claim\n` +
            `• **Available until:** 📅 ${promo.endsAtText}`
          )
          .setThumbnail(promo.img)
          .setFooter({ text: `🛒 Buy as many as you want! • 📅 Current Promo ends on: ${promo.endsAtFooter}` });
      };

      const sub = args[0]?.toLowerCase();
      if (sub === 'claim' || sub === 'buy') {
        const claimQuery = args.slice(1).join(' ').trim().toLowerCase();
        let promo = promos.length === 1 ? promos[0] : null;
        if (claimQuery) {
          promo = promos.find((entry) =>
            entry.name.toLowerCase().includes(claimQuery)
            || entry.itemName.toLowerCase().includes(claimQuery)
          ) || null;
          if (!promo) return message.reply(`No active promo matches **${claimQuery}**.`);
        }
        if (!promo) {
          return message.reply(
            'Multiple promos are active: ' +
            promos.map((entry) => `**${entry.name}**`).join(', ') +
            `. Claim one with \`${PREFIX}promo claim <name>\`.`
          );
        }
        const result = claimPromo(promo);
        if (result.error === 'coins') {
          return message.reply(`❌ You need **${promo.costCoins.toLocaleString()} PokéCoins** to claim this promo!`);
        }
        if (result.error === 'items') {
          return message.reply(
            `❌ You need **${promo.costItems}x ${promo.itemEmoji} ${promo.itemName}**! You currently have **${result.owned}x**.`
          );
        }
        await announcePromoClaim(message.guild, message.author, promo);
        return message.reply({ embeds: [buildClaimEmbed(promo, result.form)] });
      }

      let currentIndex = 0;
      const buildRows = () => new ActionRowBuilder().addComponents(
        ...promos.map((promo, index) => new ButtonBuilder()
          .setCustomId(`promo:view:${index}`)
          .setLabel(promo.name.slice(0, 80))
          .setStyle(index === currentIndex ? ButtonStyle.Primary : ButtonStyle.Secondary)),
        new ButtonBuilder()
          .setCustomId('promo:claim')
          .setLabel('Claim')
          .setStyle(ButtonStyle.Success)
          .setEmoji('🎁')
      );
      const promoMessage = await message.reply({
        embeds: [buildPromoEmbed(promos[currentIndex])],
        components: [buildRows()],
      });
      const collector = promoMessage.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 2 * 60 * 1000,
      });
      collector.on('collect', async (interaction) => {
        try {
          if (interaction.user.id !== userId) {
            await interaction.reply({ content: 'These promo buttons belong to another trainer.', ephemeral: true });
            return;
          }
          if (interaction.customId.startsWith('promo:view:')) {
            currentIndex = Number(interaction.customId.split(':')[2]);
            await interaction.update({
              embeds: [buildPromoEmbed(promos[currentIndex])],
              components: [buildRows()],
            });
            return;
          }
          const promo = promos[currentIndex];
          const result = claimPromo(promo);
          if (result.error === 'coins') {
            await interaction.reply({
              content: `❌ You need **${promo.costCoins.toLocaleString()} PokéCoins** to claim this promo!`,
              ephemeral: true,
            });
            return;
          }
          if (result.error === 'items') {
            await interaction.reply({
              content: `❌ You need **${promo.costItems}x ${promo.itemEmoji} ${promo.itemName}**! You currently have **${result.owned}x**.`,
              ephemeral: true,
            });
            return;
          }
          await announcePromoClaim(message.guild, interaction.user, promo);
          await interaction.update({ embeds: [buildPromoEmbed(promo)], components: [buildRows()] });
          await interaction.followUp({ embeds: [buildClaimEmbed(promo, result.form)] });
        } catch (error) {
          console.error('Failed to process promo button:', error);
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
              content: '❌ The promo action could not be processed.',
              ephemeral: true,
            }).catch(() => {});
          }
        }
      });
      collector.on('end', () => {
        promoMessage.edit({ components: [] }).catch(() => {});
      });
      return;
    }

    if (command === 'cooldown') {
      const amount = args.length ? Number(args[0]) : 1;
      const owned = getUserItems(userId).find((item) => item.item_name === 'Cooldown Machine')?.amount || 0;
      if (args.length > 1 || !Number.isSafeInteger(amount) || amount <= 0) {
        return message.reply(`Usage: \`${PREFIX}cooldown [quantity]\` (each machine adds one charge).`);
      }
      if (owned < amount) {
        return message.reply(`❌ You have **${owned} ${EMOJIS.cooldownMachine} Cooldown Machines**; you need **${amount}**.`);
      }
      const prompt = await message.reply({
        content: `Choose which command to load **${amount} ${EMOJIS.cooldownMachine} Cooldown Machine charge${amount === 1 ? '' : 's'}** for:`,
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('cooldown-machine:p')
            .setLabel(`${PREFIX}pokemon`)
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('cooldown-machine:f')
            .setLabel(`${PREFIX}fish`)
            .setStyle(ButtonStyle.Primary)
        )],
      });
      const collector = prompt.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60_000,
      });
      collector.on('collect', async (interaction) => {
        if (interaction.user.id !== userId) {
          return interaction.reply({ content: 'Only the trainer who loaded these machines can choose the command.', ephemeral: true });
        }
        const commandKey = interaction.customId === 'cooldown-machine:p' ? 'p' : 'f';
        const chargeField = commandKey === 'p'
          ? 'cooldown_machine_catch_charges'
          : 'cooldown_machine_fish_charges';
        const result = db.transaction(() => {
          const currentCharges = getUser(userId)[chargeField];
          if (currentCharges > Number.MAX_SAFE_INTEGER - amount) return 'charge_limit';
          if (!takeUserItem(userId, 'Cooldown Machine', amount)) return 'item_unavailable';
          incrementUser(userId, { [chargeField]: amount });
          return 'ok';
        }).immediate();
        collector.stop('loaded');
        if (result === 'charge_limit') {
          return interaction.update({ content: `❌ You cannot hold more ${EMOJIS.cooldownMachine} Cooldown Machine charges.`, components: [] });
        }
        if (result === 'item_unavailable') {
          return interaction.update({ content: `❌ Your ${EMOJIS.cooldownMachine} Cooldown Machine inventory changed. Try again with the current quantity.`, components: [] });
        }
        const commandName = commandKey === 'p' ? 'pokemon' : 'fish';
        return interaction.update({
          content: `✅ Loaded **${amount} ${amount === 1 ? 'charge' : 'charges'}** for \`${PREFIX}${commandName}\`. ` +
            `${EMOJIS.cooldownMachine} A charge lets you use it after half its normal cooldown; waiting out the full cooldown preserves it.`,
          components: [],
        });
      });
      collector.on('end', (collected) => {
        if (!collected.size) prompt.edit({ components: [] }).catch((error) => {
          console.error(`Failed to remove expired Cooldown Machine buttons for user ${userId}:`, error);
        });
      });
      return;
    }

    if (command === 'channel') {
      const action = args[0]?.toLowerCase();
      const setting = args[1]?.toLowerCase();
      if (args.length === 1 && action === 'boost') {
        const boostedChannels = getBoostedChannels(userId);
        const channelList = boostedChannels.length
          ? boostedChannels.map(({ guild_id: guildId, channel_id: channelId }) => {
            const guild = client.guilds.cache.get(guildId);
            const channel = guild?.channels.cache.get(channelId);
            const channelName = channel?.name ? `#${channel.name}` : `#${channelId}`;
            const guildName = guild?.name || `Server ${guildId}`;
            return `• [${channelName}](${`https://discord.com/channels/${guildId}/${channelId}`}) — **${guildName}**`;
          }).join('\n')
          : 'You have not boosted any channels.';
        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`${message.author.username}'s Boosted Channels`)
          .setDescription(channelList)
          .addFields({
            name: 'Boost',
            value: '+5% catch, shiny, and Legendary rates for your encounters in each listed channel.',
          })
          .setFooter({
            text: `${boostedChannels.length} / ${UNLIMITED_CHANNEL_BOOSTER_IDS.has(userId) ? '∞' : '10'} channels boosted`,
          });
        return message.reply({ embeds: [embed] });
      }
      if (args.length === 2 && action === 'remove' && setting === 'all') {
        const removed = removeAllChannelCatchRateBoosts(userId);
        return message.reply(removed
          ? `✅ Removed all **${removed}** personal channel boost${removed === 1 ? '' : 's'} across all servers.`
          : 'You do not have any personal channel boosts to remove.');
      }
      if (!message.guildId) {
        return message.reply('Add or remove channel boosts from the server channel you want to manage.');
      }
      const tierIndex = PATREON_TIER_ORDER.indexOf(getUser(userId).patreon_tier);
      const canManageBoost = tierIndex >= PATREON_TIER_ORDER.indexOf('legendary');
      if (
        !isConfiguredBotAdmin(message)
        && !EXTRA_CHANNEL_BOOSTER_IDS.has(userId)
        && !UNLIMITED_CHANNEL_BOOSTER_IDS.has(userId)
        && !canManageBoost
      ) {
        return message.reply('⛔ Channel boosts are available to Legendary-, Shiny-, and Golden-tier Patreon supporters and configured bot admins.');
      }
      if (args.length === 2 && action === 'add' && setting === 'boost') {
        const result = addChannelCatchRateBoost(
          userId,
          message.guildId,
          message.channelId,
          UNLIMITED_CHANNEL_BOOSTER_IDS.has(userId) ? null : 10
        );
        if (result === 'already') {
          return message.reply(`This channel already has a **+5% catch, shiny, and Legendary rate boost**.`);
        }
        if (result === 'limit') {
          return message.reply(
            '⛔ You already have 10 boosted channels across all servers. Remove one with `.channel remove boost` before adding another.'
          );
        }
        return message.reply(
          `✅ Added a personal **+5% catch, shiny, and Legendary rate boost** for your encounters in <#${message.channelId}>.`
        );
      }
      if (args.length === 2 && action === 'remove' && setting === 'boost') {
        const removed = setChannelCatchRateBoost(userId, message.guildId, message.channelId, false);
        return message.reply(removed
          ? `✅ Removed your catch, shiny, and Legendary rate boost for <#${message.channelId}>.`
          : `You do not have a rate boost configured for <#${message.channelId}>.`);
      }
      return message.reply(
        `Usage: \`${PREFIX}channel add boost\`, \`${PREFIX}channel remove boost|all\`, ` +
        `or \`${PREFIX}channel boost\`.`
      );
    }

    if (command === 'admin' && args[0]?.toLowerCase() === 'rarespawns') {
      if (!isBotAdmin(message)) {
        return message.reply('⛔ Only a configured bot admin can configure rare-spawn announcements.');
      }
      if (!message.guild) {
        return message.reply('Rare-spawn channels can only be configured inside a server.');
      }
      const action = args[1]?.toLowerCase();
      if (action === 'setup' && args.length === 2) {
        let channel = message.guild.channels.cache.find((candidate) =>
          candidate.name === 'rarespawns' && candidate.type === ChannelType.GuildText
        );
        if (!channel) {
          const botMember = message.guild.members.me;
          if (!botMember?.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
            return message.reply(
              'The bot needs the **Manage Channels** permission to create `#rarespawns`.'
            );
          }
          try {
            channel = await message.guild.channels.create({
              name: 'rarespawns',
              type: ChannelType.GuildText,
              topic: 'First rare Pokémon catches per trainer: event Pokémon, Legendary, Shiny, and Gmax.',
              reason: `Rare Pokémon announcement setup by ${message.author.tag}`,
            });
          } catch (error) {
            console.error(`Failed to create rare-spawns channel in guild ${message.guild.id}:`, error);
            return message.reply('Could not create `#rarespawns`. Check the bot’s channel-management permissions.');
          }
        }
        const permissions = channel.permissionsFor(message.guild.members.me);
        if (!permissions?.has([
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.EmbedLinks,
        ])) {
          return message.reply(`The bot needs permission to send messages and embeds in <#${channel.id}>.`);
        }
        setRareSpawnAnnouncementChannel(message.guild.id, channel.id);
        return message.reply(`✅ Rare Pokémon announcements are set up in <#${channel.id}>.`);
      }

      if (action === 'channel') {
        if (args.length === 2) {
          const configuredChannelId = getRareSpawnAnnouncementChannel(message.guild.id);
          return message.reply(
            configuredChannelId
              ? `Rare-spawn announcements are currently sent to <#${configuredChannelId}>.`
              : `No rare-spawn channel is configured. Use \`${PREFIX}admin rarespawns setup\`.`
          );
        }
        if (args.length !== 3) {
          return message.reply(
            `Usage: \`${PREFIX}admin rarespawns setup\`, ` +
            `\`${PREFIX}admin rarespawns channel #channel\`, or ` +
            `\`${PREFIX}admin rarespawns channel off\`.`
          );
        }
        const channelArgument = args[2];
        if (['off', 'clear', 'disable'].includes(channelArgument.toLowerCase())) {
          setRareSpawnAnnouncementChannel(message.guild.id, null);
          return message.reply('Rare-spawn announcements are disabled for this server.');
        }
        const channelId = channelArgument.match(/^<#(\d+)>$/)?.[1] || channelArgument;
        if (!/^\d{17,20}$/.test(channelId)) {
          return message.reply(`Mention a text channel or use \`${PREFIX}admin rarespawns channel off\`.`);
        }
        let channel;
        try {
          channel = await message.guild.channels.fetch(channelId);
        } catch (error) {
          console.error(`Failed to fetch rare-spawns channel ${channelId}:`, error);
          return message.reply('Could not verify that channel. Check the ID and try again.');
        }
        if (!channel || channel.type !== ChannelType.GuildText) {
          return message.reply('Choose a server text channel for rare-spawn announcements.');
        }
        const permissions = channel.permissionsFor(message.guild.members.me);
        if (!permissions?.has([
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.EmbedLinks,
        ])) {
          return message.reply('The bot needs permission to send messages and embeds in that channel.');
        }
        setRareSpawnAnnouncementChannel(message.guild.id, channel.id);
        return message.reply(`Rare-spawn announcements will be posted in <#${channel.id}>.`);
      }

      return message.reply(`Use \`${PREFIX}admin rarespawns setup\` to create and configure the channel.`);
    }

    if (
      command === 'admin'
      && args[0]?.toLowerCase() === 'worldboss'
      && args[1]?.toLowerCase() === 'channel'
    ) {
      if (!isBotAdmin(message)) {
        return message.reply('⛔ Only a configured bot admin can configure World Boss announcements.');
      }
      if (!message.guild) {
        return message.reply('World Boss announcement channels can only be configured inside a server.');
      }

      const channelArgument = args[2];
      if (!channelArgument) {
        const configuredChannelId = getWorldBossAnnouncementChannel(message.guild.id);
        return message.reply(
          configuredChannelId
            ? `World Boss announcements are currently sent to <#${configuredChannelId}>.`
            : `No World Boss announcement channel is configured. Use \`${PREFIX}admin worldboss channel #channel\`.`
        );
      }
      if (args.length !== 3) {
        return message.reply(
          `Usage: \`${PREFIX}admin worldboss channel #channel\`, ` +
          `\`${PREFIX}admin worldboss channel off\`, or \`${PREFIX}admin worldboss channel\`.`
        );
      }
      if (['off', 'clear', 'disable'].includes(channelArgument.toLowerCase())) {
        setWorldBossAnnouncementChannel(message.guild.id, null);
        return message.reply('World Boss announcements will use the channel where the boss is spawned.');
      }

      const channelId = channelArgument.match(/^<#(\d+)>$/)?.[1] || channelArgument;
      if (!/^\d{17,20}$/.test(channelId)) {
        return message.reply(
          `Use \`${PREFIX}admin worldboss channel #channel\`, \`${PREFIX}admin worldboss channel off\`, ` +
          `or \`${PREFIX}admin worldboss channel\` to check the setting.`
        );
      }

      let channel;
      try {
        channel = await message.guild.channels.fetch(channelId);
      } catch (error) {
        console.error(`Failed to fetch World Boss announcement channel ${channelId}:`, error);
        return message.reply('Could not verify that channel. Check the ID and try again.');
      }
      if (!channel || !channel.isTextBased()) {
        return message.reply('Choose a text channel where the bot can post embeds.');
      }
      const permissions = channel.permissionsFor(message.guild.members.me);
      if (!permissions?.has([
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.EmbedLinks,
      ])) {
        return message.reply('The bot needs permission to send messages and embeds in that channel.');
      }
      setWorldBossAnnouncementChannel(message.guild.id, channel.id);
      return message.reply(`World Boss spawns and results will be posted in <#${channel.id}>.`);
    }

    if (
      command === 'adminboss'
      || ((command === 'admin' || command === 'admingive') && args[0]?.toLowerCase() === 'boss')
    ) {
      if (!isBotAdmin(message) && !EXTRA_WORLD_BOSS_SPAWNER_IDS.has(userId)) {
        return message.reply('⛔ Only a configured bot admin can spawn a World Boss.');
      }
      const query = (command === 'adminboss' ? args : args.slice(1)).join(' ').trim().toLowerCase();
      const regularBossPool = WORLD_BOSS_POOL.filter((boss) => !boss.isShiny);
      const shinyBossPool = WORLD_BOSS_POOL.filter((boss) => boss.isShiny);
      const bossTemplate = !query || query === 'random'
        ? regularBossPool[Math.floor(Math.random() * regularBossPool.length)]
        : query === 'shiny' || query === 'shiny random'
          ? shinyBossPool[Math.floor(Math.random() * shinyBossPool.length)]
          : WORLD_BOSS_POOL.find((boss) =>
            boss.name.toLowerCase().includes(query) || String(boss.id) === query
          );
      if (!bossTemplate) {
        const choices = regularBossPool.map((boss) => `• \`${boss.id}\` — ${boss.name}`).join('\n');
        return message.reply(
          `World Boss not found. Choose one of:\n${choices}\n` +
          `Add \`shiny\` before the name for a shiny boss (e.g. \`${PREFIX}adminboss shiny snorlax\`), or use \`${PREFIX}adminboss random\`.`
        );
      }

      const boss = spawnWorldBoss(bossTemplate, userId, message.author.username);
      try {
        const announced = await announceWorldBossEverywhere(boss, message);
        if (!announced.length) throw new Error('No World Boss announcement could be posted.');
        return message.reply(`✅ **${boss.name}** spawned and announced in ${announced.map((channel) => `<#${channel.id}>`).join(', ')}. Trainers can use \`${PREFIX}wb fight\` from any channel.`);
      } catch (error) {
        console.error(`Failed to announce World Boss ${boss.id}:`, error);
        return message.reply(
          `⚠️ **${boss.name}** is active, but I could not post its announcement. ` +
          'Check the configured World Boss channel and bot permissions.'
        );
      }
    }

    if (command === 'admin' || command === 'admingive') {
      if (!isBotAdmin(message)) {
        return message.reply('⛔ You do not have permission to use admin commands.');
      }

      const subtype = args[0]?.toLowerCase();
      const action = args[1]?.toLowerCase();

      if (command === 'admin' && (subtype === 'help' || args.length === 0)) {
        const adminPages = [
          new EmbedBuilder().setColor(0xe67e22).setTitle('🛠️ Admin Help — Channel Setup').setDescription(
            `• \`${PREFIX}admin worldboss channel #channel|off\` — World Boss announcements (no channel shows the current setting)\n` +
            `• \`${PREFIX}admin event channel #channel|off\` — Event announcements\n` +
            `• \`${PREFIX}admin market setup\` / \`channel #channel|off\` — Market listing announcements\n` +
            `• \`${PREFIX}admin rarespawns setup\` / \`channel #channel|off\` — Create or set the rare-spawn channel\n` +
            `• \`${PREFIX}giveaway set [#channel]\` — Giveaway channel (Manage Server)\n` +
            `• \`${PREFIX}lottery channel [#channel]\` — Lottery results channel (Manage Channels)\n` +
            `• \`${PREFIX}autospawn set [#channel]\` / \`${PREFIX}autospawn disable\` — Autospawn channel (Manage Channels)\n` +
            `• \`${PREFIX}channel add boost\` — eligible Patreon supporters add a personal +5% rate boost (up to 10 channels)\n` +
            `• \`${PREFIX}channel remove all\` — remove all of your personal channel boosts\n` +
            `• \`${PREFIX}channel boost\` — list your boosted channels across all servers`
          ),
          new EmbedBuilder().setColor(0xe67e22).setTitle('🛠️ Admin Help — Give & Spawn').setDescription(
            `• \`${PREFIX}admin coins @User <amount>\` — Add or remove PokéCoins\n` +
            `• \`${PREFIX}admin token @User <amount>\` — Add or remove Patreon tokens\n` +
            `• \`${PREFIX}admin item @User <item or currency> <amount>\` — Give or remove items and balances (PokéCoins, Patreon/Vote/Fishing tokens, and more)\n` +
            `• \`${PREFIX}admin pokemon @User <Pokémon|form|number> [amount] [shiny|golden]\` — Give Pokémon\n` +
            `• \`${PREFIX}p admin [shiny] <Pokémon name>\` — Spawn a catalog Pokémon for a guaranteed catch\n` +
            `• \`${PREFIX}adminboss <Pokémon>|shiny <Pokémon>|random\` — Start a World Boss\n` +
            `• \`${PREFIX}gstart items|coins|pokemon ...\` — Start giveaways\n` +
            `• \`${PREFIX}admin giveaway remove @User\` — Remove a user from the latest giveaway in this channel`
          ),
          new EmbedBuilder().setColor(0xe67e22).setTitle('🛠️ Admin Help — Rarity & Pokémon Data').setDescription(
            `• \`${PREFIX}admin rarity list\` — View rarity weights and catch chances\n` +
            `• \`${PREFIX}admin rarity set <name> <weight> <catch chance>\`\n` +
            `• \`${PREFIX}admin pokemon rarity <number> <rarity>\`\n` +
            `• \`${PREFIX}admin pokemon rename <Pokémon|form|number> -- <new name>\`\n` +
            `• \`${PREFIX}admin pokemon sprite <Pokémon|form|number> <https URL> [shiny https URL]\`\n` +
            `• \`${PREFIX}admin pokemon add <rarity> -- <name> [sprite url]\`\n` +
            `• \`${PREFIX}admin set rarity [Pokémon|number] <c|u|r|sr|l|s|m|sm|g|sg>\` — Omit Pokémon to change your last catch\n` +
            `• Edit the files in \`pokemon-database/\` (names, rarity, numbers, sprites) and restart the bot to apply`
          ),
          new EmbedBuilder().setColor(0xe67e22).setTitle('🛠️ Admin Help — Market & Misc').setDescription(
            `• \`${PREFIX}admin market listings\` — Create 10 random market listings\n` +
            `• \`${PREFIX}admin market stock <Pokémon|number> <quantity> <price> [shiny]\`\n` +
            `• \`${PREFIX}admin market clear confirm\` — Clear listings and return player Pokémon\n` +
            `• \`${PREFIX}admin return cb [@user]\` — Return CatchBot Pokémon\n` +
            `• \`${PREFIX}admin icon @User <battle icon name|NPC number>\` — Unlock a battle icon for someone`
          ),
        ];
        return sendPagedEmbeds(message, adminPages, '🛠️ Admin Help');
      }

      if (command === 'admin' && (subtype === 'icon' || subtype === 'icons')) {
        const targetUser = message.mentions.users.first()
          || (/^\d{15,22}$/.test(args[1] || '') ? await client.users.fetch(args[1]).catch(() => null) : null);
        const iconQuery = args.slice(2).join(' ').trim().toLowerCase();
        if (!targetUser || !iconQuery) {
          return message.reply(`Usage: \`${PREFIX}admin icon @User {battle icon name or NPC number}\``);
        }
        const npcCount = NPC_CAMPAIGN.length + NPC_SPECIAL_BATTLES.length;
        const iconIndex = /^\d+$/.test(iconQuery)
          ? Number(iconQuery) - 1
          : Array.from({ length: npcCount }, (_, index) => index)
            .find((index) => getNpcTrainerName(index).toLowerCase() === iconQuery) ?? -1;
        const resolvedIndex = iconIndex >= 0 && iconIndex < npcCount
          ? iconIndex
          : Array.from({ length: npcCount }, (_, index) => index)
            .find((index) => getNpcTrainerName(index).toLowerCase().includes(iconQuery)) ?? -1;
        if (resolvedIndex < 0) {
          return message.reply(`No battle icon matches \`${iconQuery}\`. See \`${PREFIX}battle npc list\`.`);
        }
        const unlockedNow = unlockBattleIcon(targetUser.id, resolvedIndex);
        const iconName = getNpcTrainerName(resolvedIndex);
        return message.reply({
          embeds: [new EmbedBuilder()
            .setColor(0x2ecc71)
            .setDescription(unlockedNow
              ? `✅ Unlocked the **${iconName}** battle icon for <@${targetUser.id}>.`
              : `<@${targetUser.id}> already has the **${iconName}** battle icon.`)
            .setThumbnail(getNpcIconUrl(resolvedIndex))],
          allowedMentions: { parse: [] },
        });
      }

      if (command === 'admin' && subtype === 'giveaway' && action === 'remove') {
        if (!message.guild) {
          return message.reply('Giveaway entrants can only be removed inside a server.');
        }
        const target = message.mentions.users.first();
        if (!target) {
          return message.reply(`Usage: \`${PREFIX}admin giveaway remove @User\`.`);
        }
        const giveaway = db.prepare(`
          SELECT * FROM active_giveaways
          WHERE guild_id = ? AND channel_id = ? AND ended = 0 AND ends_at > ?
          ORDER BY id DESC
          LIMIT 1
        `).get(message.guild.id, message.channel.id, Date.now());
        if (!giveaway) {
          return message.reply('There is no active giveaway in this channel.');
        }
        const removed = db.prepare(
          'DELETE FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?'
        ).run(giveaway.id, target.id).changes;
        if (!removed) {
          return message.reply(`<@${target.id}> is not entered in the active giveaway.`);
        }
        let giveawayMessage;
        try {
          giveawayMessage = await message.channel.messages.fetch(giveaway.message_id);
        } catch (error) {
          console.error(`Failed to fetch giveaway ${giveaway.id} message after removing an entrant:`, error);
          return message.reply(
            `✅ Removed <@${target.id}> from the active giveaway, but I could not refresh its participant list.`
          );
        }
        const displayUpdated = await updateGiveawayEntryDisplay(giveaway, giveawayMessage);
        return message.reply(
          `✅ Removed <@${target.id}> from the active giveaway.` +
          (displayUpdated ? '' : ' The participant list could not be refreshed.')
        );
      }

      if (command === 'admin' && subtype === 'market' && action === 'listings') {
        if (args.length !== 2) {
          return message.reply(`Usage: \`${PREFIX}admin market listings\`.`);
        }
        const eligibleRarities = getRaritySettings().filter((rarity) =>
          rarity.spawn_weight > 0
          && rarity.pokemon_count > 0
          && !['mega', 'shiny mega', 'gmax', 'shiny gmax'].includes(rarity.name.toLowerCase())
        );
        const totalWeight = eligibleRarities.reduce((total, rarity) => total + rarity.spawn_weight, 0);
        if (!totalWeight) {
          return message.reply('Could not create market listings because no eligible Pokémon rarity has a positive spawn weight.');
        }

        const pricesByRarity = {
          common: 500,
          uncommon: 1000,
          rare: 2500,
          'super rare': 5000,
          legendary: 25000,
          shiny: 50000,
        };
        const listedPokemon = [];
        const stockedListings = [];
        const selectedIds = new Set();
        for (let index = 0; index < 10; index += 1) {
          let pokemon = null;
          for (let attempt = 0; attempt < 50; attempt += 1) {
            let roll = Math.random() * totalWeight;
            let rarity = eligibleRarities[eligibleRarities.length - 1];
            for (const entry of eligibleRarities) {
              roll -= entry.spawn_weight;
              if (roll < 0) {
                rarity = entry;
                break;
              }
            }
            const candidate = getRandomPokemon(rarity.name, false, true, true);
            if (!selectedIds.has(candidate.id)) {
              pokemon = candidate;
              break;
            }
          }
          if (!pokemon) {
            return message.reply('Could not find 10 distinct Pokémon forms for the market listings.');
          }
          const price = pricesByRarity[pokemon.rarity.toLowerCase()] || 5000;
          const stocked = stockMarketPokemon(pokemon.id, 1, price);
          if (!stocked) {
            throw new Error(`Could not create a market listing for Pokémon form ${pokemon.id}.`);
          }
          selectedIds.add(pokemon.id);
          stockedListings.push(...stocked.listings);
          listedPokemon.push(`${formatPokemonReward(stocked.pokemon)} — ${price.toLocaleString()} coins`);
        }

        const announcement = await announceMarketListings(message, stockedListings);
        const announcementWarning = announcement.failures
          ? ' Listings were added, but the market channel announcement failed.'
          : '';
        return message.reply(
          `✅ Added 10 random Pokémon to the global market at rarity-based prices:\n` +
          listedPokemon.map((listing) => `• ${listing}`).join('\n') +
          announcementWarning
        );
      }

      if (command === 'admin' && subtype === 'market' && action === 'clear') {
        if (args.length !== 3 || args[2].toLowerCase() !== 'confirm') {
          return message.reply(
            `This removes every market listing and returns player-listed Pokémon to their owners. ` +
            `Confirm with \`${PREFIX}admin market clear confirm\`.`
          );
        }
        const { clearedCount, returnedCount } = clearMarketListings();
        return message.reply(
          `✅ Cleared **${clearedCount}** market listing${clearedCount === 1 ? '' : 's'}. ` +
          `Returned **${returnedCount}** player-listed Pokémon to their owners.`
        );
      }

      if (command === 'admin' && subtype === 'market' && ['channel', 'setup'].includes(action)) {
        if (!message.guild) {
          return message.reply('Market announcement channels can only be configured inside a server.');
        }
        if (action === 'setup' && args.length === 2) {
          let channel = message.guild.channels.cache.find((candidate) =>
            candidate.name === 'market-listings' && candidate.type === ChannelType.GuildText
          );
          if (!channel) {
            if (!message.guild.members.me?.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
              return message.reply(
                'The bot needs the **Manage Channels** permission to create `#market-listings`.'
              );
            }
            try {
              channel = await message.guild.channels.create({
                name: 'market-listings',
                type: ChannelType.GuildText,
                topic: 'New Pokémon listed on the global market.',
                reason: `Market listing channel setup by ${message.author.tag}`,
              });
            } catch (error) {
              console.error(`Failed to create market-listings channel in guild ${message.guild.id}:`, error);
              return message.reply('Could not create `#market-listings`. Check the bot’s channel-management permissions.');
            }
          }
          const permissions = channel.permissionsFor(message.guild.members.me);
          if (!permissions?.has([
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.EmbedLinks,
          ])) {
            return message.reply(`The bot needs permission to send messages and embeds in <#${channel.id}>.`);
          }
          setMarketAnnouncementChannel(message.guild.id, channel.id);
          return message.reply(`✅ New market listings will be posted in <#${channel.id}>.`);
        }
        if (action === 'channel' && args.length === 2) {
          const channelId = getMarketAnnouncementChannel(message.guild.id);
          return message.reply(
            channelId
              ? `New market listings are currently posted in <#${channelId}>.`
              : `No market listing channel is configured. Use \`${PREFIX}admin market setup\`.`
          );
        }
        if (action === 'channel' && args.length === 3) {
          const channelArgument = args[2];
          if (['off', 'clear', 'disable'].includes(channelArgument.toLowerCase())) {
            setMarketAnnouncementChannel(message.guild.id, null);
            return message.reply('Market listing announcements are disabled for this server.');
          }
          const channelId = channelArgument.match(/^<#(\d+)>$/)?.[1] || channelArgument;
          if (!/^\d{17,20}$/.test(channelId)) {
            return message.reply(`Mention a text channel or use \`${PREFIX}admin market channel off\`.`);
          }
          let channel;
          try {
            channel = await message.guild.channels.fetch(channelId);
          } catch (error) {
            console.error(`Failed to fetch market listing channel ${channelId}:`, error);
            return message.reply('Could not verify that channel. Check the ID and try again.');
          }
          if (!channel || channel.type !== ChannelType.GuildText) {
            return message.reply('Choose a server text channel for market listing announcements.');
          }
          const permissions = channel.permissionsFor(message.guild.members.me);
          if (!permissions?.has([
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.EmbedLinks,
          ])) {
            return message.reply('The bot needs permission to send messages and embeds in that channel.');
          }
          setMarketAnnouncementChannel(message.guild.id, channel.id);
          return message.reply(`New market listings will be posted in <#${channel.id}>.`);
        }
        return message.reply(
          `Use \`${PREFIX}admin market setup\`, \`${PREFIX}admin market channel #channel\`, ` +
          `or \`${PREFIX}admin market channel off\`.`
        );
      }

      if (command === 'admin' && subtype === 'return' && action === 'cb') {
        if (args.length > 3) {
          return message.reply(`Usage: \`${PREFIX}admin return cb [@user]\`.`);
        }
        const target = message.mentions.users.first() || message.author;
        const now = Date.now();
        const result = db.transaction(() => {
          const targetUser = getUser(target.id);
          const catchbot = getCatchbotData(target.id);
          if (catchbot.running_until > now) {
            db.prepare(`
              UPDATE catchbot_data
              SET running_until = ?
              WHERE user_id = ? AND running_until = ?
            `).run(now, target.id, catchbot.running_until);
            updateUser(target.id, { catchbot_end: now });
            return { returned: true };
          }
          if (!catchbot.running_until && targetUser.catchbot_end > now) {
            updateUser(target.id, { catchbot_end: now });
            return { returned: true, legacy: true };
          }
          return { returned: false };
        }).immediate();
        if (!result.returned) {
          return message.reply(`<@${target.id}> has no active CatchBot run to return early.`);
        }
        return message.reply(
          `🤖 CatchBot has returned early for <@${target.id}>. ` +
          `They can collect its catches with \`${PREFIX}cb claim\`.`
        );
      }

      if (command === 'admin' && subtype === 'event' && action === 'channel') {
        if (!message.guild) {
          return message.reply('Event announcement channels can only be configured inside a server.');
        }

        const channelArgument = args[2];
        if (!channelArgument) {
          const configuredChannelId = getEventAnnouncementChannel(halloweenEvent.id, message.guild.id);
          return message.reply(
            configuredChannelId
              ? `Event announcements are currently sent to <#${configuredChannelId}>.`
              : `No event announcement channel is configured. Use \`${PREFIX}admin event channel #channel\`.`
          );
        }
        if (['off', 'clear', 'disable'].includes(channelArgument.toLowerCase())) {
          setEventAnnouncementChannel(halloweenEvent.id, message.guild.id, null);
          return message.reply('Event catch announcements have been disabled for this server.');
        }

        const channelId = channelArgument.match(/^<#(\d+)>$/)?.[1] || channelArgument;
        if (!/^\d{17,20}$/.test(channelId)) {
          return message.reply(
            `Use \`${PREFIX}admin event channel #channel\`, \`${PREFIX}admin event channel off\`, or view the current setting with \`${PREFIX}admin event channel\`.`
          );
        }

        let channel;
        try {
          channel = await message.guild.channels.fetch(channelId);
        } catch (error) {
          console.error(`Failed to fetch event announcement channel ${channelId}:`, error);
          return message.reply('Could not verify that channel. Check the ID and try again.');
        }
        if (!channel || !channel.isTextBased()) {
          return message.reply('Choose a text channel where the bot can post embeds.');
        }
        const permissions = channel.permissionsFor(message.guild.members.me);
        if (!permissions?.has([
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.EmbedLinks,
        ])) {
          return message.reply('The bot needs permission to send messages and embeds in that channel.');
        }

        setEventAnnouncementChannel(halloweenEvent.id, message.guild.id, channel.id);
        return message.reply(`Event catch announcements will be posted in <#${channel.id}>.`);
      }

      if (command === 'admin' && subtype === 'set' && action === 'rarity') {
        const rarityAliases = new Map([
          ['c', 'Common'],
          ['common', 'Common'],
          ['u', 'Uncommon'],
          ['uncommon', 'Uncommon'],
          ['r', 'Rare'],
          ['rare', 'Rare'],
          ['sr', 'Super Rare'],
          ['super rare', 'Super Rare'],
          ['l', 'Legendary'],
          ['legendary', 'Legendary'],
          ['s', 'Shiny'],
          ['shiny', 'Shiny'],
          ['m', 'Mega'],
          ['mega', 'Mega'],
          ['sm', 'Shiny Mega'],
          ['shiny mega', 'Shiny Mega'],
          ['g', 'Gmax'],
          ['gmax', 'Gmax'],
          ['sg', 'Shiny Gmax'],
          ['shiny gmax', 'Shiny Gmax'],
        ]);
        const values = args.slice(2);
        const rarityInput = values.pop()?.toLowerCase().replace(/\s+/g, ' ') || '';
        const rarity = rarityAliases.get(rarityInput);
        const pokemonQuery = values.join(' ').trim();
        if (!rarity) {
          return message.reply(
            `Usage: \`${PREFIX}admin set rarity [Pokémon name or Pokédex number] <c|u|r|sr|l|s|m|sm|g|sg>\` ` +
            `(omit the Pokémon to change your most recent catch)`
          );
        }
        if (!pokemonQuery) {
          const lastCatch = db.prepare(`
            SELECT id, name, pokemon_id FROM catches
            WHERE user_id = ?
            ORDER BY id DESC
            LIMIT 1
          `).get(userId);
          if (!lastCatch) {
            return message.reply('You have no caught Pokémon to update.');
          }
          const updatedPokemon = setPokemonRarity(lastCatch.pokemon_id, rarity);
          if (!updatedPokemon) {
            return message.reply(`**${lastCatch.name}** is no longer available in the Pokémon catalog.`);
          }
          rebuildPokemonDatabaseFiles();
          return message.reply(
            `Set **${updatedPokemon.name}** (Pokédex #${getPokemonFormDexNumber(updatedPokemon)}) ` +
            `to **${rarity}** rarity. This updates the Pokédex, the market and every copy in every ${PREFIX}pc.`
          );
        }

        const pokemon = resolvePokemonForm(pokemonQuery);
        if (!pokemon) {
          return message.reply(`No exact Pokémon or form named **${pokemonQuery}** was found in the catalog.`);
        }
        const updatedPokemon = setPokemonRarity(pokemon.id, rarity);
        if (!updatedPokemon) {
          return message.reply(`**${pokemon.name}** is no longer available in the Pokémon catalog.`);
        }
        rebuildPokemonDatabaseFiles();
        return message.reply(
          `Set **${updatedPokemon.name}** ` +
          `(Pokédex #${getPokemonFormDexNumber(updatedPokemon)}) ` +
          `to **${rarity}** rarity.`
        );
      }

      if (command === 'admin' && subtype === 'market' && action === 'stock') {
        const values = args.slice(2);
        const isShiny = values.at(-1)?.toLowerCase() === 'shiny';
        if (isShiny) values.pop();
        const price = parseAmount(values.pop());
        const quantity = parseAmount(values.pop());
        const pokemonQuery = values.join(' ').trim();
        if (!pokemonQuery
            || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100
            || !Number.isSafeInteger(price) || price <= 0) {
          return message.reply(
            `Usage: \`${PREFIX}admin market stock <Pokémon name or Pokédex number> <quantity 1-100> <price> [shiny]\``
          );
        }
        const pokemon = resolvePokemonForm(pokemonQuery);
        if (!pokemon) {
          return message.reply(`No exact Pokémon or form named **${pokemonQuery}** was found in the catalog.`);
        }
        const stocked = stockMarketPokemon(pokemon.id, quantity, price, isShiny);
        if (!stocked) {
          return message.reply(`**${pokemon.name}** is no longer available in the Pokémon catalog.`);
        }
        const announcement = await announceMarketListings(message, stocked.listings);
        return message.reply(
          `🏪 Added **${quantity}x ${isShiny ? '✨ ' : ''}${pokemon.name}** to the market ` +
          `at **${price.toLocaleString()} PokéCoins each**.` +
          (announcement.failures ? ' The listings were added, but their channel announcement failed.' : '')
        );
      }

      if (command === 'admin' && subtype === 'rarity') {
        if (action === 'list') {
          const settings = getRaritySettings();
          const lines = settings.map((rarity) =>
            `• **${rarity.name}** — ${rarity.spawn_weight} weight, ` +
            `${rarity.catch_chance}% catch chance, ${Math.round(rarity.encounter_rate)}% encounter rate ` +
            `(${rarity.pokemon_count} Pokémon)`
          );
          return message.reply(`**Rarity settings**\n${lines.join('\n')}`);
        }
        if (action === 'set') {
          const values = args.slice(2);
          const catchChance = Number(values.at(-1));
          const spawnWeight = Number(values.at(-2));
          const name = values.slice(0, -2).join(' ').trim();
          if (!name || name.length > 40
              || !Number.isSafeInteger(spawnWeight) || spawnWeight < 0 || spawnWeight > 1000000
              || !Number.isSafeInteger(catchChance) || catchChance < 0 || catchChance > 100) {
            return message.reply(
              `Use \`${PREFIX}admin rarity set <name> <weight 0-1000000> <catch chance 0-100>\`.`
            );
          }
          const rarity = setRaritySettings(name, spawnWeight, catchChance);
          return message.reply(
            `Updated **${rarity.name}**: spawn weight **${rarity.spawn_weight}**, ` +
            `catch chance **${rarity.catch_chance}%**.`
          );
        }
        return message.reply(
          `Use \`${PREFIX}admin rarity list\` or ` +
          `\`${PREFIX}admin rarity set <name> <spawn weight> <catch chance>\`.`
        );
      }

      if (command === 'admin' && subtype === 'pokemon' && action === 'rename') {
        const separator = args.indexOf('--', 2);
        const pokemonQuery = separator >= 0 ? args.slice(2, separator).join(' ').trim() : '';
        const newName = separator >= 0 ? args.slice(separator + 1).join(' ').trim() : '';
        if (!pokemonQuery || !newName || newName.length > 80) {
          return message.reply(
            `Usage: \`${PREFIX}admin pokemon rename <Pokémon name|form|Pokédex number> -- <new name>\``
          );
        }
        const form = resolvePokemonForm(pokemonQuery);
        if (!form) return message.reply(`No Pokémon form matching **${pokemonQuery}** was found.`);
        const renamed = renamePokemonForm(form.id, newName);
        if (!renamed) return message.reply(`No Pokémon form matching **${pokemonQuery}** was found.`);
        for (const boss of WORLD_BOSS_POOL) {
          if (boss.formId === form.id) boss.name = `${boss.isShiny ? 'Shiny ' : ''}${renamed.name}`;
        }
        return message.reply(`Renamed **${form.name}** to **${renamed.name}**.`);
      }

      if (command === 'admin' && subtype === 'pokemon' && action === 'sprite') {
        const values = args.slice(2);
        const isHttpsUrl = (value) => {
          if (typeof value !== 'string') return false;
          try {
            return new URL(value).protocol === 'https:';
          } catch {
            return false;
          }
        };
        const urlIndexes = values
          .map((value, index) => isHttpsUrl(value) ? index : -1)
          .filter((index) => index >= 0);
        const urlsAtEnd = urlIndexes.length > 0 && urlIndexes.length <= 2
          && urlIndexes[urlIndexes.length - 1] === values.length - 1
          && (urlIndexes.length === 1 || urlIndexes[urlIndexes.length - 2] === values.length - 2);
        const normalUrl = urlsAtEnd
          ? values[urlIndexes.length === 1 ? urlIndexes[0] : urlIndexes[urlIndexes.length - 2]]
          : null;
        const shinyUrl = urlsAtEnd && urlIndexes.length === 2
          ? values[urlIndexes[urlIndexes.length - 1]]
          : null;
        const pokemonQuery = urlsAtEnd ? values.slice(0, urlIndexes[0]).join(' ').trim() : '';
        if (!pokemonQuery || !normalUrl) {
          return message.reply(
            `Usage: \`${PREFIX}admin pokemon sprite <Pokémon name|form|Pokédex number> <https sprite URL> [shiny https URL]\``
          );
        }
        const form = resolvePokemonForm(pokemonQuery);
        if (!form) return message.reply(`No Pokémon form matching **${pokemonQuery}** was found.`);
        const updated = updatePokemonSpriteLinks(form.id, normalUrl, shinyUrl);
        if (!updated) return message.reply(`No Pokémon form matching **${pokemonQuery}** was found.`);
        return message.reply(
          `Updated sprite links for **${updated.name}**${shinyUrl ? ' (normal and shiny)' : ' (normal)'}.`
        );
      }

      if (command === 'admin' && subtype === 'pokemon' && action === 'rarity') {
        const separator = args.indexOf('--', 2);
        const pokemonQuery = separator >= 0
          ? args.slice(2, separator).join(' ').trim()
          : args[2] || '';
        const rarityName = (separator >= 0
          ? args.slice(separator + 1)
          : args.slice(3)).join(' ').trim();
        if (!pokemonQuery || !rarityName) {
          return message.reply(
            `Usage: \`${PREFIX}admin pokemon rarity <Pokémon name|Pokédex number> -- <rarity name>\``
          );
        }
        const pokemonForm = resolvePokemonForm(pokemonQuery);
        if (!pokemonForm) {
          return message.reply(`No Pokémon form matching **${pokemonQuery}** was found.`);
        }
        const pokemon = setPokemonRarity(pokemonForm.id, rarityName);
        if (!pokemon) {
          return message.reply(`No Pokémon form matching **${pokemonQuery}** was found.`);
        }
        return message.reply(
          `Set **${pokemon.name}** (Pokédex #${getPokemonFormDexNumber(pokemon)}) ` +
          `to **${pokemon.rarity}** rarity.`
        );
      }

      if (command === 'admin' && subtype === 'pokemon' && action === 'add') {
        const separator = args.indexOf('--', 2);
        if (separator < 0) {
          return message.reply(
            `Usage: \`${PREFIX}admin pokemon add <rarity name> -- <Pokémon name> [https://sprite-url]\``
          );
        }
        const rarityName = args.slice(2, separator).join(' ').trim();
        const pokemonArgs = args.slice(separator + 1);
        const sprite = /^https:\/\//i.test(pokemonArgs.at(-1) || '') ? pokemonArgs.pop() : null;
        const pokemonName = pokemonArgs.join(' ').trim();
        if (!rarityName || !pokemonName) {
          return message.reply(
            `Usage: \`${PREFIX}admin pokemon add <rarity name> -- <Pokémon name> [https://sprite-url]\``
          );
        }
        const pokemon = addCustomPokemon(pokemonName, rarityName, sprite);
        const rarity = getRaritySettings().find((setting) => setting.name === pokemon.rarity);
        const spawnNote = rarity.spawn_weight > 0
          ? `It is eligible to spawn with the current weight (**${rarity.spawn_weight}**).`
          : `Set a positive spawn weight with \`${PREFIX}admin rarity set ${pokemon.rarity} <weight> <catch chance>\` to make it spawn.`;
        return message.reply(
          `Added **${pokemon.name}** to the Pokémon database as **${pokemon.rarity}** ` +
          `(Pokédex #${getPokemonFormDexNumber(pokemon)}). ${spawnNote}`
        );
      }

      const target = message.mentions.users.first();
      if (!target) {
        return message.reply(
          '**Usage:**\n' +
          `• \`${PREFIX}admin coins @User <amount>\`\n` +
          `• \`${PREFIX}admin token @User <amount>\`\n` +
          `• \`${PREFIX}admin item @User <item or currency> <amount>\`\n` +
          `• \`${PREFIX}admin pokemon @User <Pokémon name, form, or Pokédex number> [amount] [shiny|golden]\`\n` +
          `• \`${PREFIX}admin pokemon rename <Pokémon|form|number> -- <new name>\`\n` +
          `• \`${PREFIX}admin pokemon sprite <Pokémon|form|number> <https URL> [shiny https URL]\`\n` +
          `• \`${PREFIX}admin giveaway remove @User\` — remove a user from the most recent active giveaway in this channel\n` +
          `• \`${PREFIX}admin rarity list|set ...\`\n` +
          `• \`${PREFIX}admin pokemon add|rarity ...\`\n` +
          `• \`${PREFIX}admin set rarity [Pokémon|Pokédex number] <c|u|r|sr|l|s|m|sm|g|sg>\` — omit Pokémon to change your last catch\n` +
          `• \`${PREFIX}admin market setup|channel #channel|off\` — configure new listing announcements\n` +
          `• \`${PREFIX}admin market listings\` — create 10 random market listings at reasonable prices\n` +
          `• \`${PREFIX}admin market clear confirm\` — clear market listings and return player Pokémon\n` +
          `• \`${PREFIX}admin market stock <Pokémon|Pokédex number> <quantity> <price> [shiny]\`\n` +
          `• \`${PREFIX}p admin [shiny] <Pokémon name>\` — spawn a catalog Pokémon for a guaranteed catch\n` +
          `• \`${PREFIX}admin event channel #channel|off\`\n` +
          `• \`${PREFIX}admin rarespawns setup\` — Create and configure the rare-spawn channel\n` +
          `• Clan: \`${PREFIX}clan create|join|leave|disband|info\``
        );
      }

      getUser(target.id);
      if (['coin', 'coins', 'pkc'].includes(subtype)) {
        const amount = parseAmount(args[2]);
        if (!Number.isSafeInteger(amount) || amount === 0) {
          return message.reply(`Usage: \`${PREFIX}admin coins @User <non-zero amount>\``);
        }
        incrementUser(target.id, { coins: amount });
        return message.reply(
          `${EMOJIS.pokecoin} Granted **${amount.toLocaleString()} PokéCoins** to <@${target.id}>.`
        );
      }

      if (['token', 'tokens', 'patreontoken', 'patreontokens'].includes(subtype)) {
        const amount = parseAmount(args[2]);
        const currentTokens = getUser(target.id).patreon_tokens;
        const updatedTokens = currentTokens + amount;
        if (!Number.isSafeInteger(amount) || amount === 0 || !Number.isSafeInteger(updatedTokens) || updatedTokens < 0) {
          return message.reply(
            `Usage: \`${PREFIX}admin token @User <non-zero amount>\`. ` +
            `The amount cannot remove more than the user's current balance (${currentTokens.toLocaleString()}).`
          );
        }
        incrementUser(target.id, { patreon_tokens: amount });
        return message.reply(
          `${EMOJIS.patreonToken} ${amount > 0 ? 'Granted' : 'Removed'} **${Math.abs(amount).toLocaleString()} Patreon token(s)** ` +
          `${amount > 0 ? 'to' : 'from'} <@${target.id}> (${updatedTokens.toLocaleString()} owned).`
        );
      }

      if (subtype === 'item') {
        const itemTokens = args.slice(2).filter((argument) => !/^<@!?\d+>$/.test(argument));
        const hasAmountToken = itemTokens.length > 1 && /^-?[\d,.]+[kmb]?$/i.test(itemTokens.at(-1));
        const amount = hasAmountToken ? parseAmount(itemTokens.pop()) : 1;
        const itemQuery = itemTokens.join(' ').toLowerCase().trim();
        const item = itemQuery.replace(/[^a-z0-9]/g, '');
        const itemColumns = {
          coin: 'coins',
          coins: 'coins',
          pkc: 'coins',
          pokecoin: 'coins',
          pokecoins: 'coins',
          pokcoin: 'coins',
          pokcoins: 'coins',
          pb: 'pokeballs',
          pokeball: 'pokeballs',
          pokeballs: 'pokeballs',
          pokball: 'pokeballs',
          pokballs: 'pokeballs',
          gb: 'greatballs',
          greatball: 'greatballs',
          greatballs: 'greatballs',
          ub: 'ultraballs',
          ultraball: 'ultraballs',
          ultraballs: 'ultraballs',
          mb: 'masterballs',
          masterball: 'masterballs',
          masterballs: 'masterballs',
          repel: 'repels',
          repels: 'repels',
          prb: 'premierballs',
          premierball: 'premierballs',
          premierballs: 'premierballs',
          dv: 'diveballs',
          diveball: 'diveballs',
          diveballs: 'diveballs',
          lb: 'lootboxes',
          lootbox: 'lootboxes',
          lootboxes: 'lootboxes',
          patreontoken: 'patreon_tokens',
          patreontokens: 'patreon_tokens',
          votecoin: 'vote_coins',
          votecoins: 'vote_coins',
          vc: 'vote_coins',
          rarecandy: 'rare_candies',
          rarecandies: 'rare_candies',
          rc: 'rare_candies',
          egg: 'vote_eggs',
          eggs: 'vote_eggs',
          voteegg: 'vote_eggs',
          voteeggs: 'vote_eggs',
          token: 'fishing_tokens',
          tokens: 'fishing_tokens',
          fishingtoken: 'fishing_tokens',
          fishingtokens: 'fishing_tokens',
          grazz: 'grazz_berries',
          goldenrazz: 'grazz_berries',
          goldenrazzberry: 'grazz_berries',
          goldenrazzberries: 'grazz_berries',
          swaptoken: 'swap_tokens',
          swaptokens: 'swap_tokens',
          questresetscroll: 'quest_reset_scrolls',
          questresetscrolls: 'quest_reset_scrolls',
          pokelure: 'active_poke_lures',
          pokelures: 'active_poke_lures',
          poklure: 'active_poke_lures',
          poklures: 'active_poke_lures',
          mistyslure: 'active_mistys_lures',
          mistyslures: 'active_mistys_lures',
          amuletcoin: 'amulet_coins',
          amuletcoins: 'amulet_coins',
        };
        if (!itemQuery || !Number.isSafeInteger(amount) || amount === 0) {
          return message.reply(`Usage: \`${PREFIX}admin item @User <item> <non-zero amount>\``);
        }
        if (item === 'ticket' || item === 'eventticket') {
          updateUser(target.id, { event_ticket: amount > 0 ? 1 : 0 });
          return message.reply(
            `${EMOJIS.eventticket} ${amount > 0 ? 'Granted' : 'Removed'} the Event Ticket for <@${target.id}>.`
          );
        }
        const flagItems = {
          expshare: ['exp_share_owned', 'Exp. Share'],
        };
        if (flagItems[item]) {
          const [flagColumn, flagName] = flagItems[item];
          updateUser(target.id, { [flagColumn]: amount > 0 ? 1 : 0 });
          return message.reply(`🎁 ${amount > 0 ? 'Granted' : 'Removed'} **${flagName}** for <@${target.id}>.`);
        }
        if (item === 'shinycharm' || item === 'shinycharms') {
          const owned = getUser(target.id).shiny_charms;
          if (owned + amount < 0 || owned + amount > 5) {
            return message.reply(`Shiny Charms must stay between 0 and 5. <@${target.id}> has **${owned}**.`);
          }
          incrementUser(target.id, { shiny_charms: amount });
          return message.reply(`${EMOJIS.shinyCharm} <@${target.id}> now has **${owned + amount}/5 Shiny Charms**.`);
        }
        const rods = {
          goodrod: ['has_good_rod', 'Good Rod'],
          superrod: ['has_super_rod', 'Super Rod'],
          goldenrod: ['has_golden_rod', 'Golden Rod'],
        };
        if (rods[item]) {
          const [rodColumn, rodName] = rods[item];
          const rodUser = getUser(target.id);
          const rodRanking = ['Old Rod', 'Good Rod', 'Super Rod', 'Golden Rod'];
          const updates = { [rodColumn]: amount > 0 ? 1 : 0 };
          if (amount > 0 && rodRanking.indexOf(rodName) > rodRanking.indexOf(rodUser.fish_rods)) {
            updates.fish_rods = rodName;
          }
          updateUser(target.id, updates);
          return message.reply(`🎣 ${amount > 0 ? 'Granted' : 'Removed'} the **${rodName}** for <@${target.id}>.`);
        }
        const column = itemColumns[item];
        if (column) {
          const currentAmount = getUser(target.id)[column];
          const updatedAmount = currentAmount + amount;
          if (!Number.isSafeInteger(updatedAmount) || updatedAmount < 0) {
            return message.reply(
              amount < 0
                ? `<@${target.id}> only has ${currentAmount.toLocaleString()}x **${itemQuery}** to remove.`
                : `That grant would exceed the supported balance for **${itemQuery}**.`
            );
          }
          const updatedUser = incrementUser(target.id, { [column]: amount });
          return message.reply(
            `📦 ${amount > 0 ? 'Added' : 'Removed'} **${Math.abs(amount).toLocaleString()}x ${itemQuery}** ` +
            `${amount > 0 ? 'to' : 'from'} <@${target.id}>'s inventory ` +
            `(${updatedUser[column].toLocaleString()} owned).`
          );
        }
        const stoneName = [
          ...MEGA_STONE_NAMES,
          ...Object.values(CHAMBER_CONFIG).map((chamber) => chamber.rewardStone),
        ].find((name) => name.toLowerCase() === item || name.toLowerCase() === itemQuery.toLowerCase());
        if (stoneName) {
          if (amount < 0) {
            return message.reply('Mega Stones can only be granted, not removed, with this command.');
          }
          const currentAmount = getMegaStones(target.id)
            .find((stone) => stone.stone_name === stoneName)?.amount || 0;
          if (!Number.isSafeInteger(currentAmount + amount)) {
            return message.reply(`That grant would exceed the supported balance for **${stoneName}**.`);
          }
          db.prepare(`
            INSERT INTO mega_stones (user_id, stone_name, amount) VALUES (?, ?, ?)
            ON CONFLICT(user_id, stone_name) DO UPDATE SET amount = mega_stones.amount + excluded.amount
          `).run(target.id, stoneName, amount);
          return message.reply(`${MEGA_STONE_EMOJIS[stoneName] || '🔮'} Added **${amount.toLocaleString()}x ${stoneName}** to <@${target.id}>'s inventory.`);
        }
        const storedItem = findEvolutionItem(itemQuery)
          || findBox(itemQuery)
          || findVoteBox(itemQuery)
          || findQuestItem(itemQuery)
          || ROTOM_ITEMS.find((name) => name.toLowerCase().replace(/[^a-z0-9]/g, '') === item)
          || findUserItemName(itemQuery)
          || ({ i: 'Incubator', si: 'Super Incubator', inc: 'Incense' }[item]);
        if (storedItem) {
          const currentAmount = getUserItems(target.id)
            .find((entry) => entry.item_name === storedItem)?.amount || 0;
          if (amount > 0 && !Number.isSafeInteger(currentAmount + amount)) {
            return message.reply(`That grant would exceed the supported balance for **${storedItem}**.`);
          }
          let completedQuests = [];
          if (amount > 0) {
            completedQuests = addUserItem(target.id, storedItem, amount);
          } else if (!takeUserItem(target.id, storedItem, -amount)) {
            return message.reply(`<@${target.id}> doesn't have ${(-amount).toLocaleString()}x **${storedItem}** to remove.`);
          }
          const reply = await message.reply(
            `${({
              'Cooldown Machine': EMOJIS.cooldownMachine,
              'Ability Capsule': EMOJIS.abilityCapsule,
              'Ability Patch': EMOJIS.abilityPatch,
            }[storedItem] || '🎁')} ${amount > 0 ? 'Added' : 'Removed'} **${Math.abs(amount).toLocaleString()}x ${storedItem}** ` +
            `${amount > 0 ? 'to' : 'from'} <@${target.id}>'s inventory.`
          );
          announceQuestCompletions(target.id, message.channel, completedQuests);
          return reply;
        }
        const promoItem = findPromoByItemName(itemQuery);
        if (promoItem) {
          const currentAmount = getUserItems(target.id)
            .find((entry) => entry.item_name === promoItem.itemName)?.amount || 0;
          if (amount > 0 && !Number.isSafeInteger(currentAmount + amount)) {
            return message.reply(`That grant would exceed the supported balance for **${promoItem.itemName}**.`);
          }
          if (amount > 0) addUserItem(target.id, promoItem.itemName, amount);
          else if (!takeUserItem(target.id, promoItem.itemName, -amount)) {
            return message.reply(`<@${target.id}> doesn't have ${(-amount).toLocaleString()}x **${promoItem.itemName}** to remove.`);
          }
          return message.reply(
            `${promoItem.itemEmoji} ${amount > 0 ? 'Added' : 'Removed'} **${Math.abs(amount).toLocaleString()}x ${promoItem.itemName}** ` +
            `${amount > 0 ? 'to' : 'from'} <@${target.id}>'s inventory.`
          );
        }
        return message.reply(
          'Invalid item. Choose a currency, ball, supported inventory item, Shiny Charm, Exp. Share, rod, Mega Stone, ' +
          'evolution item, box, active promo item, or ticket.'
        );
      }

      if (['pokemon', 'mon', 'p'].includes(subtype)) {
        const pokemonArgs = args.slice(2).filter((argument) => !/^<@!?\d+>$/.test(argument));
        const leadingVariant = ['true', 'false', 'shiny', 'golden'].includes(pokemonArgs[0]?.toLowerCase())
          ? pokemonArgs.shift().toLowerCase()
          : null;
        const trailingVariant = ['true', 'false', 'shiny', 'golden'].includes(pokemonArgs.at(-1)?.toLowerCase())
          ? pokemonArgs.pop().toLowerCase()
          : null;
        if (leadingVariant && trailingVariant && leadingVariant !== trailingVariant) {
          return message.reply('Choose only one Pokémon variant: `shiny` or `golden`.');
        }
        const variantArgument = trailingVariant || leadingVariant;
        let isShiny = variantArgument === 'true' || variantArgument === 'shiny';
        const isGolden = variantArgument === 'golden';
        if (variantArgument === 'false') isShiny = false;
        const amountArgument = pokemonArgs.at(-1);
        const hasAmount = pokemonArgs.length > 1 && /^-?\d+(?:\.\d+)?$/.test(amountArgument || '');
        const amount = hasAmount ? Number(amountArgument) : 1;
        if (hasAmount) pokemonArgs.pop();
        if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100) {
          return message.reply('The Pokémon grant amount must be a whole number from 1 to 100.');
        }
        const pokemonName = pokemonArgs.join(' ').trim();
        if (!pokemonName) {
          return message.reply(
            `Usage: \`${PREFIX}admin pokemon @User <Pokémon name, form, or Pokédex number> [amount] [shiny|golden]\``
          );
        }
        let exactMatch;
        if (/^\d+$/.test(pokemonName)) {
          const dexNumber = Number(pokemonName);
          const forms = db.prepare(`
            SELECT id, species_id, name, slug, is_default, rarity,
              base_hp, base_atk, base_def, base_spd
            FROM pokemon_forms
            ORDER BY species_id, id
          `).all();
          const dexNumbers = getPokemonDexNumbers(forms);
          const dexMatch = forms.find((pokemon) => {
            if (isGolden) {
              return isGoldenFormSupported(pokemon.species_id, pokemon.slug, Boolean(pokemon.is_default))
                && getGoldenDexNumber(pokemon.species_id, pokemon.slug) === dexNumber;
            }
            const numbers = dexNumbers.get(pokemon.id);
            if (numbers?.dexNumber === dexNumber) return true;
            if (numbers?.shinyDexNumber === dexNumber) {
              isShiny = true;
              return true;
            }
            return false;
          });
          exactMatch = dexMatch;
        } else {
          exactMatch = findPokemonForms(pokemonName, 20).find((pokemon) =>
            pokemon.name.toLowerCase() === pokemonName.toLowerCase()
            || pokemon.slug.toLowerCase() === pokemonName.toLowerCase().replace(/\s+/g, '-')
          );
        }
        if (!exactMatch) {
          return message.reply(
            `No exact Pokémon, form, or ${isGolden ? 'Golden ' : ''}Pokédex number **${pokemonName}** was found in the catalog.`
          );
        }
        if (isGolden && !isGoldenFormSupported(exactMatch.species_id, exactMatch.slug, Boolean(exactMatch.is_default))) {
          return message.reply('Golden Pokémon can only be granted in base forms and supported regional forms, not Mega or Gmax forms.');
        }
        const catalogPokemon = {
          id: exactMatch.id,
          name: exactMatch.name,
          rarity: exactMatch.rarity,
          baseHp: exactMatch.base_hp,
          baseAtk: exactMatch.base_atk,
          baseDef: exactMatch.base_def,
          baseSpd: exactMatch.base_spd,
        };
        for (let count = 0; count < amount; count++) {
          if (isGolden) saveGoldenCatch(target.id, catalogPokemon);
          else saveCatch(target.id, catalogPokemon, isShiny);
        }
        return message.reply(
          `🎉 Added **${amount}x** ${
            isGolden
              ? `${EMOJIS.golden} **Golden ${exactMatch.name}**`
              : formatPokemonReward({ ...exactMatch, isShiny })
          } ` +
          `to <@${target.id}>'s storage.`
        );
      }

      return message.reply(`Invalid sub-command. Use \`${PREFIX}admin coins|item|pokemon ...\`.`);
    }

    if (command === 'worldboss' || command === 'wb') {
      const subCommand = args[0]?.toLowerCase();
      if (subCommand === 'claim') {
        const claim = claimWorldBossReward(userId);
        if (!claim) return message.reply('❌ You have no World Boss rewards to claim.');
        const { record, items, bossesFought } = claim;
        const itemCount = items.reduce((sum, item) => sum + item.amount, 0);
        const itemEmoji = (name) => ({
          'Rare Candy': EMOJIS.rarecandy,
          Repel: EMOJIS.repel,
          'Super Repel': EMOJIS.superRepel,
          'Max Repel': EMOJIS.maxRepel,
          'Swap Ticket': '🎟️',
        }[name] || BOXES[name]?.emoji || '📦');
        return message.reply({
          embeds: [new EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle(`🎁 Here are your rewards for the ${record.boss_name} challenge! (Boss id: ${record.boss_id})`)
            .setDescription(
              `📜 **Items received (${itemCount}):**\n` +
              items.map((item) => `• ${item.amount}x ${itemEmoji(item.name)} **${item.name}**`).join('\n') + '\n\n' +
              `🪙 **PokeCoins earned:** ${record.coins.toLocaleString()}\n\n` +
              `🎖️ **You placed ${record.rank} / ${record.total_players} players in DMG!**\n` +
              `🌸 You have now fought **${bossesFought}** World Boss${bossesFought === 1 ? '' : 'es'}.`
            )
            .setFooter({
              text: `💥 You dealt ${record.damage.toLocaleString()} / ${record.max_hp.toLocaleString()} DMG`,
            })
            .setTimestamp()],
        });
      }
      if (subCommand === 'spawn') {
        if (!message.guild) return message.reply('Use this in a server.');
        const activeBoss = getActiveWorldBoss();
        if (activeBoss) {
          return message.reply(`❌ **${activeBoss.name}** is already active. Wait until it's defeated or replaced before spawning another.`);
        }
        const spawnPool = WORLD_BOSS_POOL.filter((entry) => !entry.isShiny && !/eternamax|eternatus/i.test(entry.name));
        const template = spawnPool[Math.floor(Math.random() * spawnPool.length)];
        const spent = db.transaction(() => {
          if (getActiveWorldBoss() || !takeUserItem(userId, 'Boss Coin', 1)) return null;
          return spawnWorldBoss(template, userId, message.author.username);
        }).immediate();
        if (!spent) {
          return message.reply(
            `❌ You need a ${EMOJIS.bosscoin} **Boss Coin** to spawn a World Boss. Buy one with \`${PREFIX}shop buy 50\`.`
          );
        }
        const announced = await announceWorldBossEverywhere(spent, message);
        return message.reply(
          `${EMOJIS.bosscoin} **${message.author.username}** spent a Boss Coin and spawned **${spent.name}**! ` +
          (announced.length ? `Announced in ${announced.map((channel) => `<#${channel.id}>`).join(', ')}. ` : '') +
          `Use \`${PREFIX}wb fight\` to join.`
        );
      }
      const boss = getActiveWorldBoss();
      if (!boss) {
        return message.reply(
          `💤 There is no active World Boss. Use \`${PREFIX}wb spawn\` with a Boss Coin, or a bot admin can start one with \`${PREFIX}adminboss random\`.`
        );
      }
      const team = getUserTeam(userId);
      if (subCommand === 'fight' || subCommand === 'f') {
        if (getUnclaimedWorldBossReward(userId)) {
          return message.reply(
            `🎁 Claim your pending World Boss reward with \`${PREFIX}wb claim\` before joining another raid.`
          );
        }
        if (!team.length) {
          return message.reply(`❌ Add a Pokémon to your active team before fighting. Use \`${PREFIX}team\`.`);
        }
        const faintedTeam = activeWorldBossFainted.get(boss.id)?.get(userId) || new Set();
        const teamStates = activeWorldBossTeamStates.get(boss.id)?.get(userId);
        const revived = isWorldBossTeamFainted(team, faintedTeam, teamStates);
        if (revived) {
          faintedTeam.clear();
          activeWorldBossPlayers.get(boss.id)?.delete(userId);
          activeWorldBossTeamStates.get(boss.id)?.delete(userId);
        }
        await startWorldBossBattle(message, boss, userId, team);
        if (revived) {
          return message.reply('✨ Your entire team had fainted. Rejoining the raid revived your team to full HP; choose a Pokémon from the new battle panel.');
        }
        return;
      }
      if (subCommand && !['status'].includes(subCommand)) {
        return message.reply(`Usage: \`${PREFIX}wb\` to view the raid or \`${PREFIX}wb fight\` to battle.`);
      }
      return message.reply({
        embeds: [createWorldBossEmbed(boss, message.client.user)],
        content: `Use \`${PREFIX}wb fight\` from any channel to join the raid.`,
      });
    }

    if (command === 'ability' || command === 'ab') {
      const query = args.join(' ').trim();
      if (!query) {
        let abilities;
        try {
          abilities = await fetchAllPokemonAbilities();
        } catch (error) {
          console.error('Failed to load the Pokémon ability list:', error);
          return message.reply('❌ The ability list could not be loaded right now. Please try again later.');
        }
        const abilitiesPerPage = 40;
        const pages = [];
        for (let offset = 0; offset < abilities.length; offset += abilitiesPerPage) {
          const page = abilities.slice(offset, offset + abilitiesPerPage);
          pages.push(new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('Pokémon Abilities')
            .setDescription(page.map(({ name }) => `• ${name}`).join('\n')));
        }
        return sendPagedEmbeds(
          message,
          pages,
          `${abilities.length} abilities • ${PREFIX}ability <Pokémon|ability name>`
        );
      }

      const pokemon = resolvePokemonForm(query);
      if (pokemon) {
        let abilities;
        try {
          abilities = await fetchPokemonAbilities(pokemon.id);
        } catch (error) {
          console.error(`Failed to load ability data for Pokémon form ${pokemon.id}:`, error);
          return message.reply('❌ Ability data could not be loaded for that Pokémon right now. Please try again later.');
        }
        const abilityLines = abilities.map((ability) =>
          `• **${ability.name}** — ${ability.hidden ? 'Hidden Ability' : 'Standard Ability'}`
        );
        const dexNumber = getPokemonFormDexNumber(pokemon);
        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`${pokemon.name} — Abilities`)
          .setDescription(
            `**Pokédex number:** #${dexNumber}\n\n${abilityLines.join('\n')}\n\n` +
            `Use \`${PREFIX}ability <ability name>\` to read about an ability.`
          );
        if (pokemon.sprite) embed.setThumbnail(pokemon.sprite);
        return message.reply({ embeds: [embed] });
      }

      let ability;
      try {
        ability = await fetchPokemonAbilityDetails(query);
      } catch (error) {
        console.error(`Failed to load ability details for "${query}":`, error);
        return message.reply('❌ Ability information could not be loaded right now. Please try again later.');
      }
      if (!ability) {
        return message.reply(
          `❌ I couldn't find a Pokémon or ability matching **${query}**. ` +
          `Use \`${PREFIX}ability\` to browse all abilities.`
        );
      }

      const pokemonList = ability.pokemon.slice(0, 20).map((entry) =>
        `• ${entry.name.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())}` +
        `${entry.hidden ? ' (Hidden Ability)' : ''}`
      );
      const effect = ability.effect || ability.shortEffect || 'No English effect description is available.';
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`${ability.name} — Ability`)
        .setDescription(effect.length > 4000 ? `${effect.slice(0, 3997)}...` : effect)
        .addFields({
          name: `Pokémon with this ability (${ability.pokemon.length})`,
          value: pokemonList.length
            ? `${pokemonList.join('\n')}${ability.pokemon.length > pokemonList.length
              ? `\n…and ${ability.pokemon.length - pokemonList.length} more.`
              : ''}`
            : 'No Pokémon are currently listed with this ability.',
        })
        .setFooter({ text: `Ability #${ability.id} • Data from PokéAPI` });
      if (ability.shortEffect && ability.shortEffect !== ability.effect) {
        embed.addFields({ name: 'Summary', value: ability.shortEffect });
      }
      return message.reply({ embeds: [embed] });
    }

    if (command === 'pokemon' || command === 'p') {
      if (args[0]?.toLowerCase() === 'admin') {
        if (!isBotAdmin(message)) {
          return message.reply('⛔ Only a bot admin or server administrator can use this command.');
        }
        const shinySpawn = args[1]?.toLowerCase() === 'shiny';
        const requestedName = args.slice(shinySpawn ? 2 : 1).join(' ').trim();
        if (!requestedName) {
          return message.reply(
            `Usage: \`${PREFIX}p admin [shiny] <Pokémon name>\``
          );
        }
        const pokemon = resolvePokemonForm(requestedName);
        if (!pokemon) {
          return message.reply(
            `No exact Pokémon or form named **${requestedName}** was found in the catalog.`
          );
        }
        const shinyNumberRequested = /^\d+$/.test(requestedName) && (() => {
          const allForms = db.prepare('SELECT * FROM pokemon_forms ORDER BY species_id, id').all();
          const numbers = getPokemonDexNumbers(allForms).get(pokemon.id);
          return numbers?.dexNumber !== Number(requestedName) && numbers?.shinyDexNumber === Number(requestedName);
        })();
        const target = {
          id: pokemon.id,
          slug: pokemon.slug,
          name: pokemon.name,
          rarity: pokemon.rarity,
          baseHp: pokemon.base_hp,
          baseAtk: pokemon.base_atk,
          baseDef: pokemon.base_def,
          baseSpd: pokemon.base_spd,
          types: JSON.parse(pokemon.types),
          img: pokemon.sprite,
          shinyImg: pokemon.shiny_sprite,
          isShiny: shinySpawn || shinyNumberRequested,
        };
        return await askForBall(message, userId, target, 'catch', { guaranteedCatch: true });
      }
      const isAdmin = isConfiguredBotAdmin(message);
      if (!isAdmin && catchCooldowns.has(userId)) {
        if (!consumeCooldownMachineForEarlyUse(userId, 'p', catchCooldowns)) {
          return message.reply('⏳ Catching cooldown is active (7s). A Cooldown Machine can skip it after 3.5s.');
        }
      }
      if (!isAdmin) {
        catchCooldowns.add(userId);
        scheduleCooldownNotification(
          catchCooldowns,
          userId,
          message.author.username,
          message.channel,
          7000,
          'p'
        );
      }
      const roleChanceBoost = await getRoleEncounterBoost(userId);
      const grazzActive = getUser(userId).grazz_buff_encounters > 0;
      if (grazzActive) incrementUser(userId, { grazz_buff_encounters: -1 });
      return await askForBall(message, userId, rollSpawn('land', userId, null, {
        channelRateBoost: getChannelCatchRateBoost(userId, message.guildId, message.channelId),
        roleChanceBoost,
        goldenRazzActive: grazzActive,
        guildId: message.guildId,
      }), 'catch', {
        guaranteedCatch: isAdmin,
        counterSource: 'pokemon',
      });
    }

    if (command === 'fish' || command === 'f') {
      const user = getUser(userId);
      if (args[0]?.toLowerCase() === 'shop') {
        return message.reply({
          embeds: [new EmbedBuilder()
            .setColor(0x3498db)
            .setAuthor({ name: '🎣 Fishing Shop' })
            .setDescription(
              `${EMOJIS.diveball} **Diveball** — 50 ${EMOJIS.fishingtoken} Fishing Tokens each\n\n` +
              `Purchase with \`${PREFIX}shop buy 14 [amount]\`.`
            )],
        });
      }
      if (args.length) return message.reply(`Usage: \`${PREFIX}fish\` or \`${PREFIX}fish shop\`.`);
      const rod = getFishingRod(user);
      const isAdmin = isConfiguredBotAdmin(message);
      if (!isAdmin && fishCooldowns.has(userId)) {
        if (!consumeCooldownMachineForEarlyUse(userId, 'f', fishCooldowns)) {
          return message.reply(
            `⏳ Fishing cooldown is active (**${rod.cooldownMs / 1000}s** for your ${rod.name}). ` +
            `A Cooldown Machine can skip it after ${rod.cooldownMs / 2000}s.`
          );
        }
      }
      if (!isAdmin) {
        fishCooldowns.add(userId);
        scheduleCooldownNotification(
          fishCooldowns,
          userId,
          message.author.username,
          message.channel,
          rod.cooldownMs,
          'f'
        );
      }
      if (!isAdmin && Math.random() >= rod.baseSpawnChance * (1 + getPatreonPerks(userId).fishingBoost)) {
        return message.reply(`🎣 You cast your line with the **${rod.name}**, but nothing bit.`);
      }
      const roleChanceBoost = await getRoleEncounterBoost(userId);
      let fishingTarget = rollSpawn('water', userId, rod, {
        channelRateBoost: getChannelCatchRateBoost(userId, message.guildId, message.channelId),
        roleChanceBoost,
        guildId: message.guildId,
      });
      const goldenFishingChance =
        (1 / FISH_EXCLUSIVE_GOLDEN_DENOMINATOR) * (1 + getPatreonPerks(userId).goldenBoost);
      if (Math.random() < goldenFishingChance) {
        const speciesName = FISH_EXCLUSIVE_GOLDENS[
          Math.floor(Math.random() * FISH_EXCLUSIVE_GOLDENS.length)
        ];
        fishingTarget = {
          ...getSpecialSpawnPokemon(speciesName),
          rarity: 'Golden',
          isGolden: true,
          isShiny: false,
          isEventShiny: false,
          encounterRateText: 'Fishing-exclusive Golden',
        };
      }
      return await askForBall(
        message,
        userId,
        fishingTarget,
        'fish',
        { guaranteedCatch: isAdmin, timeoutMs: rod.pullWaitMs, counterSource: 'fishing' }
      );
    }

    if (command === 'clan') {
      const subcommand = args[0]?.toLowerCase();
      const playerClan = getPlayerClan(userId);

      if (subcommand === 'stats') {
        if (!playerClan) return message.reply('Join a clan before viewing clan stats.');
        const periods = ['daily', 'weekly', 'monthly'];
        const categories = ['catches', 'fishes', 'hatches', 'swaps', 'catchbot', 'battles'];
        let period = args[1]?.toLowerCase() || 'daily';
        let category = args[2]?.toLowerCase() || 'catches';
        if (!periods.includes(period)) {
          return message.reply(`Choose a stats period: \`${PREFIX}clan stats daily|weekly|monthly\`.`);
        }
        if (!categories.includes(category)) {
          return message.reply(
            `Choose a category: catches, fishes, hatches, swaps, catchbot, or battles.`
          );
        }

        const pageSize = 10;
        let currentPage = 0;
        const categoryInfo = {
          catches: { label: 'Catches', emoji: '🔴' },
          fishes: { label: 'Fish', emoji: '🎣' },
          hatches: { label: 'Hatches', emoji: '🥚' },
          swaps: {
            label: 'Swaps',
            emoji: client.emojis.cache.find((emoji) => emoji.name === 'tickets')?.toString() || '🎟️',
          },
          catchbot: { label: 'CatchBot', emoji: '🤖' },
          battles: { label: 'Battles', emoji: '⚔️' },
        };
        const makeComponents = (pageCount) => [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('clan-stats-previous')
              .setLabel('Previous')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(currentPage === 0),
            new ButtonBuilder()
              .setCustomId('clan-stats-next')
              .setLabel('Next')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(currentPage >= pageCount - 1)
          ),
        ];
        const usernameCache = new Map();
        const renderStats = async () => {
          const stats = getClanActivityStats(playerClan.id, period, category, userId);
          const pageCount = Math.max(1, Math.ceil(stats.rows.length / pageSize));
          currentPage = Math.min(currentPage, pageCount - 1);
          const periodLabel = `${period[0].toUpperCase()}${period.slice(1)}`;
          const formatActivityStats = (values) => [
            `<:caught:1560340176713031711>  ${values.catches.toLocaleString()}`,
            `${EMOJIS.oldrod}  ${values.fishes.toLocaleString()}`,
            `${EMOJIS.pokeEgg}  ${values.hatches.toLocaleString()}`,
            `${categoryInfo.swaps.emoji}  ${values.swaps.toLocaleString()}`,
            `${categoryInfo.catchbot.emoji}  ${values.catchbot.toLocaleString()}`,
            `${categoryInfo.battles.emoji}  ${values.battles.toLocaleString()}`,
          ].join(' · ');
          const totalLine = formatActivityStats({
            catches: stats.totals.catches,
            fishes: stats.totals.fishes,
            hatches: stats.totals.hatches,
            swaps: stats.totals.swaps,
            catchbot: stats.totals.catchbot,
            battles: stats.totals.battles,
          });
          const pageRows = stats.rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
          const memberLines = await Promise.all(pageRows.map(async (row) => {
            let name = usernameCache.get(row.user_id);
            if (!name) {
              const discordUser = message.client.users.cache.get(row.user_id)
                || await message.client.users.fetch(row.user_id);
              name = discordUser.username;
              usernameCache.set(row.user_id, name);
            }
            const selectedIcon = getSelectedBattleIcon(row.user_id);
            const preset = Object.values(DEFAULT_TRAINER_ICONS)
              .find((trainerIcon) => trainerIcon.value === selectedIcon);
            let icon;
            if (selectedIcon === null) icon = DEFAULT_TRAINER_ICONS.brendan.emoji;
            else if (preset) icon = preset.emoji;
            else if (getNpcChallenge(selectedIcon)) {
              icon = getNpcIconEmojiOrBlank(selectedIcon);
            } else {
              throw new Error(`User ${row.user_id} has invalid selected battle icon ${selectedIcon}.`);
            }
            const counters = formatActivityStats({
              catches: row.period_catches,
              fishes: row.period_fishes,
              hatches: row.period_hatches,
              swaps: row.period_swaps,
              catchbot: row.period_catchbot,
              battles: row.period_battles,
            });
            return `**${row.rank}. ${icon} ${name}**\n${counters}`;
          }));
          const memberStats = stats.rows.find((row) => row.user_id === userId);
          const resetTimestamp = Math.floor(stats.end / 1000);
          const ownRankLine = memberStats
            ? `🏅 You're Rank **${memberStats.rank}** in your clan's ${period} stats for ` +
              `**${categoryInfo[category].label} — ${memberStats.categoryCount.toLocaleString()}**.`
            : `🏅 You are not ranked in your clan's ${period} stats yet.`;
          const embed = new EmbedBuilder()
            .setColor(0x3498db)
            .setTitle(`👥 Clan ${periodLabel} Stats — ${playerClan.name} 👥`)
            .setDescription(
              `📅 ${periodLabel} stats reset <t:${resetTimestamp}:R> (<t:${resetTimestamp}:f>)\n` +
              `📊 Totals: ${totalLine}\n` +
              `⬇️ Sorted by ${categoryInfo[category].label}\n\n` +
              `${ownRankLine}\n\n` +
              `${memberLines.length ? memberLines.join('\n') : 'No members to display.'}`
            )
            .setFooter({ text: `Page ${currentPage + 1}/${pageCount} • ${stats.memberCount} clan members` });
          return { embed, components: makeComponents(pageCount), pageCount };
        };

        const initial = await renderStats();
        const statsMessage = await message.reply({
          embeds: [initial.embed],
          components: initial.components,
        });
        const collector = statsMessage.createMessageComponentCollector({ time: 120000 });
        collector.on('collect', async (interaction) => {
          if (interaction.user.id !== userId) {
            await interaction.reply({
              content: 'Only the member who opened these stats can change the view.',
              ephemeral: true,
            });
            return;
          }
          try {
            if (interaction.customId === 'clan-stats-period') {
              period = interaction.values[0];
              currentPage = 0;
            } else if (interaction.customId === 'clan-stats-category') {
              category = interaction.values[0];
              currentPage = 0;
            } else if (interaction.customId === 'clan-stats-previous') {
              currentPage = Math.max(0, currentPage - 1);
            } else if (interaction.customId === 'clan-stats-next') {
              currentPage += 1;
            }
            const updated = await renderStats();
            await interaction.update({
              embeds: [updated.embed],
              components: updated.components,
            });
          } catch (error) {
            console.error('Failed to update clan stats view:', error);
            try {
              const response = {
                content: 'The clan stats view could not be updated. Please run the command again.',
                ephemeral: true,
              };
              if (interaction.deferred || interaction.replied) {
                await interaction.followUp(response);
              } else {
                await interaction.reply(response);
              }
            } catch (responseError) {
              console.error('Failed to report the clan stats view error:', responseError);
            }
          }
        });
        collector.on('end', async () => {
          try {
            await statsMessage.edit({ components: [] });
          } catch (error) {
            if (error.code !== 10008) console.error('Failed to disable expired clan stats controls:', error);
          }
        });
        return;
      }

      if (subcommand === 'hs') {
        if (args.length > 1) return message.reply(`Usage: \`${PREFIX}clan hs\`.`);
        const pageSize = 15;
        let currentPage = 0;
        const renderHighscores = () => {
          const clans = getClanHighScores('monthly');
          const pageCount = Math.max(1, Math.ceil(clans.length / pageSize));
          currentPage = Math.min(currentPage, pageCount - 1);
          const lines = clans
            .slice(currentPage * pageSize, (currentPage + 1) * pageSize)
            .map((clan) => {
              const rankEmoji = CLAN_RANK_EMOJIS[clan.clan_rank] || CLAN_RANK_EMOJIS.starter;
              return `**${clan.rank}** ${rankEmoji} **${clan.name}** ` +
                `<:caught:1560340176713031711> **${clan.score.toLocaleString()}** ` +
                `👥 **${clan.member_count}**`;
            });
          const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('clan-hs-previous')
              .setLabel('Previous')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(currentPage === 0),
            new ButtonBuilder()
              .setCustomId('clan-hs-next')
              .setLabel('Next')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(currentPage >= pageCount - 1)
          );
          const embed = new EmbedBuilder()
            .setColor(0x36393f)
            .setTitle('🏆 Clan Highscores — Monthly Catches 🏆')
            .setDescription(
              '**Clan Rank & Name**　 **Monthly Catches**　 **Members**\n' +
              (lines.length ? lines.join('\n') : 'No clans have recorded monthly catches yet.')
            )
            .setFooter({
              text: `Top 100 clans • Page ${currentPage + 1}/${pageCount}`,
            });
          return {
            embed,
            components: [buttons],
            pageCount,
          };
        };

        const initial = renderHighscores();
        const highscoresMessage = await message.reply({
          embeds: [initial.embed],
          components: initial.components,
        });
        const collector = highscoresMessage.createMessageComponentCollector({ time: 5 * 60 * 1000 });
        collector.on('collect', async (interaction) => {
          if (interaction.user.id !== userId) {
            await interaction.reply({
              content: 'Only the trainer who opened these highscores can change the view.',
              ephemeral: true,
            });
            return;
          }
          try {
            if (interaction.customId === 'clan-hs-previous') {
              currentPage = Math.max(0, currentPage - 1);
            } else if (interaction.customId === 'clan-hs-next') {
              currentPage += 1;
            }
            const updated = renderHighscores();
            await interaction.update({ embeds: [updated.embed], components: updated.components });
          } catch (error) {
            console.error(`Failed to update clan highscores for user ${userId}:`, error);
            if (!interaction.replied && !interaction.deferred) {
              await interaction.reply({
                content: 'Could not update the clan highscore view. Please run the command again.',
                ephemeral: true,
              });
            }
          }
        });
        collector.on('end', async () => {
          try {
            await highscoresMessage.edit({ components: [] });
          } catch (error) {
            console.error(`Failed to disable expired clan highscore controls for user ${userId}:`, error);
          }
        });
        return;
      }

      if (subcommand === 'lb' || subcommand === 'leaderboard') {
        return message.reply(`That leaderboard command was replaced. Use \`${PREFIX}clan hs\`.`);
      }

      if (subcommand === 'invite') {
        const target = message.mentions.users.first();
        if (args.length !== 2 || !target || target.bot || target.id === userId) {
          return message.reply(`Usage: \`${PREFIX}clan invite @user\` (choose another player).`);
        }
        if (!playerClan) return message.reply('Join a clan before inviting another player.');
        if (getPlayerClan(target.id)) return message.reply(`${target} is already in a clan.`);
        const rankInfo = getClanRankInfo(playerClan);
        const memberCount = getClanMembers(playerClan.id).length;
        if (memberCount >= rankInfo.memberLimit) {
          return message.reply(
            `**${playerClan.name}** is full (${memberCount}/${rankInfo.memberLimit} members).`
          );
        }

        const inviteRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('clan-invite:accept')
            .setLabel('Accept')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId('clan-invite:deny')
            .setLabel('Deny')
            .setStyle(ButtonStyle.Danger)
        );
        const inviteMessage = await message.channel.send({
          content: `${target}`,
          embeds: [makeEmbed(
            `Invitation to ${playerClan.name}`,
            `<@${userId}> invited you to join **${playerClan.name}** ` +
            `(${CLAN_RANK_EMOJIS[playerClan.clan_rank] || CLAN_RANK_EMOJIS.starter} ` +
            `${playerClan.clan_rank}, ${memberCount}/${rankInfo.memberLimit} members).\n\n` +
            'This invitation expires in 60 seconds.',
            0x3498db
          )],
          components: [inviteRow],
        });
        const collector = inviteMessage.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 60000,
        });
        let settled = false;
        collector.on('collect', async (interaction) => {
          try {
            await interaction.deferUpdate();
            if (interaction.user.id !== target.id) {
              await interaction.followUp({
                content: 'Only the invited player can respond to this clan invitation.',
                ephemeral: true,
              });
              return;
            }
            if (settled) {
              await interaction.followUp({
                content: 'This clan invitation has already been answered.',
                ephemeral: true,
              });
              return;
            }
            settled = true;
            if (interaction.customId === 'clan-invite:deny') {
              await inviteMessage.edit({
                content: '',
                embeds: [makeEmbed('Clan Invitation Declined', `${target} declined the invitation to **${playerClan.name}**.`, 0xed4245)],
                components: [],
              });
              collector.stop('resolved');
              return;
            }

            const result = joinClan(target.id, playerClan.id);
            if (result.error === 'already_member') {
              await inviteMessage.edit({
                content: '',
                embeds: [makeEmbed('Invitation Expired', `${target} has already joined a clan.`, 0xed4245)],
                components: [],
              });
              collector.stop('resolved');
              return;
            }
            if (result.error === 'not_found') {
              await inviteMessage.edit({
                content: '',
                embeds: [makeEmbed('Invitation Expired', `**${playerClan.name}** no longer exists.`, 0xed4245)],
                components: [],
              });
              collector.stop('resolved');
              return;
            }
            if (result.error === 'full') {
              await inviteMessage.edit({
                content: '',
                embeds: [makeEmbed(
                  'Clan Is Full',
                  `**${playerClan.name}** reached its member limit (${result.memberLimit}) before the invitation was accepted.`,
                  0xed4245
                )],
                components: [],
              });
              collector.stop('resolved');
              return;
            }
            await inviteMessage.edit({
              content: '',
              embeds: [makeEmbed(
                'Clan Invitation Accepted',
                `${target} joined **${result.clan.name}**!`,
                0x2ecc71
              )],
              components: [],
            });
            collector.stop('resolved');
          } catch (error) {
            console.error('Failed to process clan invitation:', error);
            settled = true;
            collector.stop('error');
            try {
              await inviteMessage.edit({
                content: '',
                embeds: [makeEmbed(
                  'Clan Invitation Unavailable',
                  'The invitation could not be processed. Please ask the clan member to send another invite.',
                  0xed4245
                )],
                components: [],
              });
            } catch (editError) {
              console.error('Failed to disable clan invitation after an error:', editError);
            }
            try {
              await interaction.followUp({
                content: 'The clan invitation could not be processed. Please try again.',
                ephemeral: true,
              });
            } catch (responseError) {
              console.error('Failed to report clan invitation error:', responseError);
            }
          }
        });
        collector.on('end', async (_, reason) => {
          if (reason !== 'time') return;
          try {
            await inviteMessage.edit({
              content: '',
              embeds: [makeEmbed('Clan Invitation Expired', `The invitation to **${playerClan.name}** expired.`, 0x747f8d)],
              components: [],
            });
          } catch (error) {
            console.error('Failed to expire clan invitation message:', error);
          }
        });
        return message.reply(`📨 Sent a clan invitation to ${target}.`);
      }

      if (
        subcommand === 'coowner'
        || subcommand === 'coleader'
        || (subcommand === 'add' && ['owner', 'co-owner', 'coowner'].includes(args[1]?.toLowerCase()))
      ) {
        const addRoleSyntax = subcommand === 'add';
        const target = message.mentions.users.first();
        const remove = !addRoleSyntax && args[1]?.toLowerCase() === 'remove';
        if ((!remove && !target) || (addRoleSyntax && args.length !== 3)) {
          return message.reply(
            `Usage: \`${PREFIX}clan add co-owner @member\` (up to 3 co-owners), ` +
            `\`${PREFIX}clan coowner remove [@member]\``
          );
        }
        const result = setClanCoLeader(userId, target ? target.id : null, remove && Boolean(target));
        if (result.error === 'not_member') return message.reply('You are not in a clan.');
        if (result.error === 'not_leader') {
          return message.reply('❌ Only the primary clan leader can assign or remove a co-owner.');
        }
        if (result.error === 'self') return message.reply('The clan leader is already the primary owner.');
        if (result.error === 'not_member_target') {
          return message.reply(`${target} is not a member of your clan.`);
        }
        if (result.error === 'already_co_owner') return message.reply(`${target} is already a co-owner.`);
        if (result.error === 'not_co_owner') return message.reply(`${target} is not a co-owner.`);
        if (result.error === 'co_owner_limit') {
          return message.reply(`❌ A clan can have at most ${result.limit} co-owners.`);
        }
        return message.reply(
          remove
            ? `👑 ${target ? `${target} removed as co-owner` : 'All co-owners removed'} of **${result.clan.name}**.`
            : `👑 ${target} is now co-owner of **${result.clan.name}**.`
        );
      }

      if (subcommand === 'transfer' && args[1]?.toLowerCase() === 'ownership') {
        const target = message.mentions.users.first();
        if (args.length !== 3 || !target || target.bot) {
          return message.reply(`Usage: \`${PREFIX}clan transfer ownership @user\`.`);
        }
        const result = transferClanOwnership(userId, target.id);
        if (result.error === 'not_member') return message.reply('You are not in a clan.');
        if (result.error === 'not_leader') {
          return message.reply('❌ Only the current clan owner can transfer ownership.');
        }
        if (result.error === 'self') {
          return message.reply('You already own this clan.');
        }
        if (result.error === 'not_member_target') {
          return message.reply(`${target} must be a member of your clan before ownership can be transferred.`);
        }
        return message.reply(
          `👑 Clan ownership of **${result.clan.name}** has been transferred to ${target}. ` +
          `You are now the co-owner.`
        );
      }

      if (subcommand === 'donate' || subcommand === 'deposit') {
        const amount = parseAmount(args[1]);
        if (args.length !== 2 || !Number.isSafeInteger(amount) || amount <= 0) {
          return message.reply(`Usage: \`${PREFIX}clan donate <positive coin amount>\`.`);
        }
        const result = depositClanTreasury(userId, amount);
        if (result.error === 'not_member') return message.reply('You are not in a clan.');
        if (result.error === 'insufficient_funds') {
          return message.reply(
            `❌ You only have **${result.balance.toLocaleString()} PokéCoins** to donate.`
          );
        }
        return message.reply(
          `🏦 Donated **${amount.toLocaleString()} PokéCoins** to **${result.clan.name}**'s treasury. ` +
          `Treasury balance: **${result.treasury.toLocaleString()}**.`
        );
      }

      if (subcommand === 'purchase') {
        const rank = args[1]?.toLowerCase();
        const result = purchaseClanPerks(userId, rank);
        if (result.error === 'invalid_rank') {
          return message.reply(`Usage: \`${PREFIX}clan purchase <bronze|silver|gold|diamond|amethyst|onyx>\`.`);
        }
        if (result.error === 'not_member') return message.reply('You are not in a clan.');
        if (result.error === 'rank_locked') {
          return message.reply(
            `❌ **${rank[0].toUpperCase()}${rank.slice(1)}** perks are locked until your clan reaches that rank.`
          );
        }
        if (result.error === 'already_purchased') {
          return message.reply(
            `You have already purchased ${CLAN_RANK_EMOJIS[rank]} **${rank}** perks.`
          );
        }
        if (result.error === 'wrong_order') {
          return message.reply(
            `Purchase your next available perk tier${result.nextRank ? ` (**${result.nextRank}**)` : ''} first.`
          );
        }
        if (result.error === 'catch_requirement') {
          return message.reply(
            `❌ You do not have enough contributions to buy ${rank[0].toUpperCase()}${rank.slice(1)} perks. ` +
            `With **${result.memberCount} clan members**, you need **${result.required.toLocaleString()} catches**.\n` +
            `• You need 🔴 **${result.remaining.toLocaleString()} more catches** to buy the perks.`
          );
        }
        if (result.error === 'insufficient_funds') {
          return message.reply(
            `❌ You need **${EMOJIS.pokecoin} ${result.required.toLocaleString()}** to buy ` +
            `${rank[0].toUpperCase()}${rank.slice(1)} perks. You have **${result.balance.toLocaleString()}**.`
          );
        }
        const unlockedPerks = {
          bronze: [
            'Catch Rate I: increases catch rate by 1%',
            'Shiny Rate I: increases shiny rate by 1%',
          ],
          silver: [
            'Catch Rate II: increases catch rate by 3% total',
            'Shiny Rate II: increases shiny rate by 3% total',
          ],
          gold: [
            'Catch Rate III: increases catch rate by 5% total',
            'Shiny Rate III: increases shiny rate by 5% total',
            'Event Rate I: increases event shiny odds by 5%',
            'Amulet Boost I: increases coin rewards by 5%',
          ],
          diamond: [
            'Catch Rate IV: increases catch rate by 10% total',
            'Shiny Rate IV: increases shiny rate by 10% total',
            'Event Rate II: increases event shiny odds by 10%',
            'Shop Boost I: discounts eligible shop purchases by 5%',
          ],
          amethyst: [
            'Event Rate III: increases event shiny odds by 15%',
            'Promo Rate I: increases promo item drop rate by 5%',
            'Quest Bonus: +1 quest slot in `.q`',
          ],
          onyx: [
            'Event Rate IV: increases event shiny odds by 20%',
            'Shop Boost II: discounts eligible shop purchases by 10% total',
            'Amulet Boost II: increases coin rewards by 10% total',
            'Promo Rate II: increases promo item drop rate by 10% total',
            'Hatch Bonus: eggs hatch 2x faster',
          ],
        }[result.rank];
        return message.reply(
          `✅ Purchased ${CLAN_RANK_EMOJIS[result.rank]} **${result.rank[0].toUpperCase()}${result.rank.slice(1)}** ` +
          `perks for ${EMOJIS.pokecoin} **${result.cost.toLocaleString()}**!\n\n` +
          `You unlocked the following perks:\n` +
          unlockedPerks.map((perk) => `• ${CLAN_RANK_EMOJIS[result.rank]} ${perk}`).join('\n') +
          `\n\n🗡️ Use \`${PREFIX}clan info perks\` for full perk information.`
        );
      }

      if (subcommand === 'upgrade') {
        const rank = args[1]?.toLowerCase();
        const result = purchaseClanRank(userId, rank);
        if (result.error === 'invalid_rank') {
          return message.reply(`Usage: \`${PREFIX}clan upgrade <bronze|silver|gold|diamond|amethyst|onyx>\`.`);
        }
        if (result.error === 'not_member') return message.reply('You are not in a clan.');
        if (result.error === 'not_owner') {
          return message.reply('❌ Only clan leaders or co-owners can upgrade the clan rank.');
        }
        if (result.error === 'wrong_order') {
          return message.reply(
            result.nextRank
              ? `**${result.clan.name}** must reach **${result.nextRank}** before that upgrade.`
              : `**${result.clan.name}** is already at the highest rank.`
          );
        }
        if (result.error === 'catch_requirement') {
          return message.reply(
            `❌ **${rank.toUpperCase()}** requires **${result.required.toLocaleString()} clan catches**. ` +
            `Your clan has **${result.total.toLocaleString()}**.`
          );
        }
        if (result.error === 'insufficient_treasury') {
          return message.reply(
            `❌ The clan treasury needs **${result.required.toLocaleString()} PokéCoins**; ` +
            `it currently has **${result.treasury.toLocaleString()}**. Members can use ` +
            `\`${PREFIX}clan donate <amount>\`.`
          );
        }
        const rankInfo = getClanRankInfo({ clan_rank: result.rank });
        return message.reply(
          `🎉 **${result.clan.name}** reached ${CLAN_RANK_EMOJIS[rank]} **${rank.toUpperCase()}** rank! ` +
          `Spent **${result.cost.toLocaleString()}** from the treasury. ` +
          `${CLAN_RANK_EMOJIS[rank]} perks are now available for members to purchase individually. ` +
          `Member limit: **${rankInfo.memberLimit}**.`
        );
      }

      if (subcommand === 'info' && ['ranks', 'rank'].includes(args[1]?.toLowerCase())) {
        const ranks = [
          ['starter', 'No requirements or perks', 0, 0, 25, 0],
          ['bronze', '100,000 clan catches • Catch Rate I • Shiny Rate I', 2500000, 100000, 35, 100000],
          ['silver', '500,000 clan catches • Catch Rate II • Shiny Rate II', 12500000, 500000, 40, 500000],
          ['gold', '2,500,000 clan catches • Catch Rate III • Shiny Rate III • Event Rate I • Amulet Boost I', 62500000, 2500000, 45, 2500000],
          ['diamond', '5,000,000 clan catches • Catch Rate IV • Shiny Rate IV • Event Rate II • Shop Boost I', 125000000, 5000000, 50, 5000000],
          ['amethyst', '15,000,000 clan catches • Event Rate III • Promo Rate I • Quest bonus', 375000000, 15000000, 65, 10000000],
          ['onyx', '30,000,000 clan catches • Event Rate IV • Amulet Boost II • Shop Boost II • Promo Rate II • Hatch bonus', 750000000, 30000000, 75, 25000000],
        ];
        const description = ranks.map(([rank, perks, cost, catches, members, perkBase]) =>
          `${CLAN_RANK_EMOJIS[rank]} **${rank[0].toUpperCase()}${rank.slice(1)}**\n` +
          `• ${perks}\n` +
          (rank === 'starter'
            ? `• Member limit: **${members}**\n`
            : `• Upgrade: **${catches.toLocaleString()} clan catches** + **${cost.toLocaleString()} treasury coins**\n` +
              `• Member perk purchase: **${perkBase.toLocaleString()} PokéCoins** + ` +
              `floor(${getClanRankInfo({ clan_rank: rank }).perkCatches.toLocaleString()} catches ÷ current members)\n` +
              `• Member limit: **${members}**\n`) +
          (rank === 'onyx' ? '' : '\n')
        ).join('');
        return message.reply({
          embeds: [new EmbedBuilder()
            .setColor(0x2b2d31)
            .setAuthor({
              name: 'Clan Rank Information',
              iconURL: message.client.user.displayAvatarURL(),
            })
            .setDescription(
              '**Clan upgrades unlock perk tiers; each member purchases each tier individually.**\n\n' +
              description
            )
            .setFooter({
              text: `Donate with ${PREFIX}clan donate <amount>; owners upgrade with ${PREFIX}clan upgrade <rank>; members purchase perks with ${PREFIX}clan purchase <rank>.`,
            })],
        });
      }

      if (subcommand === 'info' && args[1]?.toLowerCase() === 'perks') {
        const embed = makeEmbed(
          '🛡️ Clan Perks',
          '**Perks are unlocked by clan rank, then purchased individually by each member.** Rank upgrades do not grant perks automatically.\n\n' +
          '• Bronze: Catch Rate I (+1%), Shiny Rate I (+1%)\n' +
          '• Silver: Catch Rate II (+3% total), Shiny Rate II (+3% total)\n' +
          '• Gold: Catch/Shiny Rate III (+5% total), Event Rate I, Amulet Boost I (+5%)\n' +
          '• Diamond: Catch/Shiny Rate IV (+10% total), Event Rate II, Shop Boost I (-5%)\n' +
          '• Amethyst: Event Rate III, Promo Rate I (+5%), +1 quest slot\n' +
          '• Onyx: Event Rate IV, Amulet Boost II (+10%), Shop Boost II (-10%), Promo Rate II (+10%), eggs hatch 2x faster\n\n' +
          'Purchase unlocked perk tiers in order with `.clan purchase <rank>`. Each tier costs PokéCoins and requires personal catches: required catches are `floor(rank catch target ÷ current clan members)`. For example, Bronze requires 5,000 catches in a 20-member clan; Amethyst requires 230,769 in a 65-member clan. Catch Rate applies to `.p` and `.fish`; Shiny Rate applies to encounters and stacks with Shiny Charms. Event Rate boosts shiny odds for matching event Pokémon. Amulet Boost increases coin rewards; Shop Boost discounts eligible purchases.\n\n' +
          'Clan owners/co-owners upgrade the clan rank with `.clan upgrade <rank>`; donate with `.clan donate <amount>`.',
          0x3498db
        );
        return message.reply({ embeds: [embed] });
      }

      if (subcommand === 'create') {
        const clanName = args.slice(1).join(' ').trim();
        if (!clanName) return message.reply(`Usage: \`${PREFIX}clan create <Clan Name>\``);
        if (clanName.length < 3 || clanName.length > 20) {
          return message.reply('Clan name must be between 3 and 20 characters.');
        }
        const result = createClan(clanName, userId);
        if (result.error === 'already_member') {
          const currentClan = getPlayerClan(userId);
          return message.reply(
            `You are already in **${currentClan.name}**! Leave it before making a new one.`
          );
        }
        if (result.error === 'insufficient_funds') {
          const balance = getUser(userId).coins;
          return message.reply(
            `❌ Creating a clan costs **1,000,000 PokéCoins**. You have **${balance.toLocaleString()}**.`
          );
        }
        if (result.error === 'name_taken') return message.reply('A clan with that name already exists!');
        return message.reply(
          `🛡️ Congratulations! You created **${clanName}** for **1,000,000 PokéCoins**!`
        );
      }

      if (subcommand === 'join') {
        const clanName = args.slice(1).join(' ').trim();
        if (!clanName) return message.reply(`Usage: \`${PREFIX}clan join <Clan Name>\``);
        if (playerClan) return message.reply(`You are already a member of **${playerClan.name}**!`);
        const clan = getClanByName(clanName);
        if (!clan) return message.reply('Clan not found.');
        const result = joinClan(userId, clan.id);
        if (result.error === 'already_member') {
          return message.reply(`You are already a member of **${getPlayerClan(userId).name}**!`);
        }
        if (result.error === 'not_found') return message.reply('Clan not found.');
        if (result.error === 'full') {
          return message.reply(`That clan is full (${result.memberLimit} members).`);
        }
        return message.reply(
          `✅ You joined **${result.clan.name}**. Successful catches and fishing will count toward clan stats.`
        );
      }

      if (subcommand === 'leave') {
        const result = leaveClan(userId);
        if (result.error === 'not_member') return message.reply('You are not in a clan.');
        if (result.error === 'leader') {
          return message.reply('Clan leaders cannot leave. Disband the clan if you want to dissolve it.');
        }
        return message.reply(`👋 You left **${result.clan.name}**.`);
      }

      if (subcommand === 'disband') {
        const result = disbandClan(userId);
        if (result.error === 'not_member') return message.reply('You are not in a clan.');
        if (result.error === 'not_leader') return message.reply('Only the clan leader can disband it.');
        return message.reply(`💥 **${result.clan.name}** has been disbanded.`);
      }

      const clanQuery = subcommand === 'info'
        ? args.slice(1).join(' ').trim()
        : args.join(' ').trim();
      const clan = clanQuery ? getClanByName(clanQuery) : playerClan;
      if (clanQuery && !clan) return message.reply('Clan not found.');
      if (!clan) {
        return message.reply(
          `You are not in a clan. Create one with \`${PREFIX}clan create <name>\` ` +
          `or join one with \`${PREFIX}clan join <name>\`.`
        );
      }

      const members = getClanMembers(clan.id);
      const rankInfo = getClanRankInfo(clan);
      const nextRankInfo = getNextClanRankInfo(clan);
      const totalCatches = members.reduce((sum, member) => sum + member.catches, 0);
      const totalFishes = members.reduce((sum, member) => sum + member.fishes, 0);
      const totalHatches = members.reduce((sum, member) => sum + member.hatches, 0);
      const totalSwaps = members.reduce((sum, member) => sum + member.swaps, 0);
      const totalCatchbot = members.reduce((sum, member) => sum + member.catchbot, 0);
      const clanLeaderboard = getClanLeaderboard();
      const globalRank = clanLeaderboard.findIndex((entry) => entry.id === clan.id) + 1;
      const clanRankIndex = ['starter', 'bronze', 'silver', 'gold', 'diamond', 'amethyst', 'onyx']
        .indexOf(clan.clan_rank);
      const unlockedPerkGroups = [
        ['bronze', 'CR I, SR I'],
        ['silver', 'CR II, SR II'],
        ['gold', 'CR III, SR III, ER I, AB I'],
        ['diamond', 'CR IV, SR IV, ER II, SB I'],
        ['amethyst', 'ER III, AB II, PR I, Quest bonus'],
        ['onyx', 'ER IV, SB II, PR II, Hatch bonus'],
      ].filter(([rank]) => ['starter', 'bronze', 'silver', 'gold', 'diamond', 'amethyst', 'onyx']
        .indexOf(rank) <= clanRankIndex)
        .map(([rank, perks]) => `${CLAN_RANK_EMOJIS[rank]} ${perks}`);
      const perkLines = [];
      for (let index = 0; index < unlockedPerkGroups.length; index += 2) {
        perkLines.push(unlockedPerkGroups.slice(index, index + 2).join('  |  '));
      }
      const rankProgress = nextRankInfo
        ? `📈 Next rank: ${CLAN_RANK_EMOJIS[nextRankInfo.name]} ${nextRankInfo.name[0].toUpperCase()}${nextRankInfo.name.slice(1)}, ` +
          `${totalCatches.toLocaleString()} / ${nextRankInfo.catches.toLocaleString()} req`
        : '📈 Next rank: Maximum rank reached';
      const rankEmoji = CLAN_RANK_EMOJIS[clan.clan_rank] || CLAN_RANK_EMOJIS.starter;
      const rankEmojiId = rankEmoji.match(/:(\d+)>$/)?.[1];
      const dateTimestamp = (value) => {
        if (!value) return null;
        const timestamp = new Date(`${String(value).replace(' ', 'T')}Z`).getTime();
        return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null;
      };
      const clanCreated = dateTimestamp(clan.created_at);
      const clanMember = members.find((member) => member.user_id === userId);
      const joinedTimestamp = clanMember ? dateTimestamp(clanMember.joined_at) : null;
      const personalContribution = clanMember
        ? `\n\nYour personal contributions to ${clan.name}\n` +
          `<:caught:1560340176713031711> ${clanMember.catches.toLocaleString()} • ` +
          `${EMOJIS.pokeEgg} ${clanMember.hatches.toLocaleString()} • 🎟️ ${clanMember.swaps.toLocaleString()} • ` +
          `🤖 ${clanMember.catchbot.toLocaleString()} • ${EMOJIS.oldrod} ${clanMember.fishes.toLocaleString()}\n` +
          `💵 Donated: ${EMOJIS.pokecoin} ${clanMember.donated_coins.toLocaleString()}\n` +
          `📅 Joined: ${joinedTimestamp ? `<t:${joinedTimestamp}:D>` : 'Unknown'}`
        : '\n\nYour personal contributions\nYou are not a member of this clan.';
      const embed = new EmbedBuilder()
        .setColor({
          starter: 0x808080,
          bronze: 0xcd7f32,
          silver: 0xc0c0c0,
          gold: 0xffd700,
          diamond: 0x00bfff,
          amethyst: 0x9b59b6,
          onyx: 0x2b2d31,
        }[clan.clan_rank] || 0x3498db)
        .setTitle(`${rankEmoji} Welcome to ${clan.name} [ID: #${clan.id}]`)
        .setThumbnail(rankEmojiId
          ? `https://cdn.discordapp.com/emojis/${rankEmojiId}.${rankEmoji.startsWith('<a:') ? 'gif' : 'png'}`
          : `https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/72x72/${[...rankEmoji].map((char) => char.codePointAt(0).toString(16)).filter((code) => code !== 'fe0f').join('-')}.png`)
        .setDescription(
          `👑 Owned by: <@${clan.leader_id}>\n` +
          `🔱 Co-owned by: ${getClanCoLeaderIds(clan).map((id) => `<@${id}>`).join(', ') || '*None*'}\n` +
          `👥 Members: ${members.length} / ${rankInfo.memberLimit}\n` +
          `🌎 Global Rank: ${globalRank || 'Unranked'} of ${clanLeaderboard.length} clans\n\n` +
          `${rankEmoji} Rank: ${clan.clan_rank[0].toUpperCase()}${clan.clan_rank.slice(1)}\n` +
          `${rankProgress}\n` +
          `🏦 Treasury: ${EMOJIS.pokecoin} ${clan.treasury.toLocaleString()}\n` +
          `📅 ${clanCreated ? `${clan.name} was created on <t:${clanCreated}:D>` : 'Creation date unavailable'}\n` +
          `<:caught:1560340176713031711> Clan catches: ${totalCatches.toLocaleString()} • ` +
          `${EMOJIS.pokeEgg} Hatches: ${totalHatches.toLocaleString()}\n` +
          `${client.emojis.cache.find((emoji) => emoji.name === 'tickets')?.toString() || '🎟️'} Clan swaps: ${totalSwaps.toLocaleString()} • 🤖 Catchbot: ${totalCatchbot.toLocaleString()}\n` +
          `${EMOJIS.oldrod} Fish caught: ${totalFishes.toLocaleString()}\n\n` +
          `🗡️ Unlocked perks:\n${perkLines.length ? perkLines.join('\n') : 'No perks unlocked.'}` +
          `${personalContribution}`
        )
        .setFooter({ text: `${clan.name} • Clan ID #${clan.id}` })
        .setTimestamp();
      return message.reply({ embeds: [embed] });
    }

    if (['dailycatchers', 'catchers', 'dc'].includes(command)) {
      const leaderboard = getDailyCatchLeaderboard();
      const description = leaderboard.length
        ? leaderboard.map((entry, index) =>
          `**${index + 1}.** ${entry.username} — **${entry.catches.toLocaleString()}** catch${entry.catches === 1 ? '' : 'es'}`
        ).join('\n')
        : '*No Pokémon have been caught yet today.*';
      const resetTimestamp = Math.floor(getNextDailyReset() / 1000);
      return message.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle('🏆 Daily Catchers — Top 10')
          .setDescription(
            `${description}\n\nDaily counts reset <t:${resetTimestamp}:R>.\n` +
            'Includes successful .p and .f catches.'
          )
          .setFooter({ text: 'Counts reset daily at 5 AM EST' })],
      });
    }

    if (command === 'counters' || command === 'co') {
      const counters = getEncounterCounters(userId);
      const counterByKey = new Map(counters.map((counter) => [
        `${counter.source}:${counter.category}`,
        counter,
      ]));
      const rows = [
        { source: 'pokemon', category: 'legendary', label: 'Legendary spawn', rarity: 'Legendary' },
        { source: 'pokemon', category: 'shiny', label: 'Shiny spawn', rarity: 'Shiny' },
        { source: 'fishing', category: 'legendary', label: 'Legendary spawn', rarity: 'Legendary' },
        { source: 'fishing', category: 'shiny', label: 'Shiny spawn', rarity: 'Shiny' },
      ];
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`${message.author.username}'s Counters`)
        .setDescription('<:caught:1560340176713031711> - Pokémon Counters\n<:oldrod:1560319797265301534> - Fishing Counters')
        .addFields(
          { name: 'Category', value: '\u200b', inline: true },
          { name: 'Counter — Pokémon', value: '\u200b', inline: true },
          { name: 'Last reset', value: '\u200b', inline: true },
          ...rows.flatMap(({ source, category, label, rarity }) => {
            const counter = counterByKey.get(`${source}:${category}`);
            if (!counter) throw new Error(`Missing ${source} ${category} encounter counter for user ${userId}.`);
            const sourceEmoji = source === 'pokemon'
              ? '<:caught:1560340176713031711>'
              : '<:oldrod:1560319797265301534>';
            const lastReset = counter.last_caught_at
              ? `<t:${Math.floor(counter.last_caught_at / 1000)}:d>`
              : 'Never';
            return [
              {
                name: '\u200b',
                value: `${sourceEmoji} ${getRarityEmojis(rarity)} ${label}`,
                inline: true,
              },
              {
                name: '\u200b',
                value: `${counter.encounters_since.toLocaleString()} - ${counter.last_pokemon || 'N/A'}`,
                inline: true,
              },
              {
                name: '\u200b',
                value: lastReset,
                inline: true,
              },
            ];
          })
        );
      return message.reply({ embeds: [embed], allowedMentions: { parse: [] } });
    }

    if (command === 'streak' || command === 'streaks') {
      const user = getUser(userId);
      const streakRows = db.prepare(
        'SELECT rarity, streak_count, highest_streak FROM user_rarity_streaks WHERE user_id = ?'
      ).all(userId);
      const streakByRarity = new Map(streakRows.map((row) => [row.rarity, row.streak_count]));
      const highestByRarity = new Map(streakRows.map((row) => [row.rarity, row.highest_streak]));
      const formatStreak = (current, highest, unit = '') =>
        `${current}${unit ? ` ${unit}` : ''}  \`[Highest: ${Math.max(current, highest)}]\``;
      const rarityLines = getRaritySettings()
        .filter((rarity) => !NON_STREAK_RARITIES.has(rarity.name.trim().toLowerCase())
          && !rarity.name.trim().toLowerCase().startsWith('event'))
        .map((rarity) => {
          const current = streakByRarity.get(rarity.name) || 0;
          const highest = highestByRarity.get(rarity.name) || 0;
          return `${getRarityEmojis(rarity.name)} ${formatStreak(current, highest, 'in a row')}`;
        })
        .join('\n');
      return message.reply({
        embeds: [new EmbedBuilder()
          .setColor(0x9b59b6)
          .setAuthor({
            name: `${message.author.username}'s Streaks`,
            iconURL: message.author.displayAvatarURL(),
          })
          .setDescription(
            `**General Streaks**\n` +
            `🎣 Catch streak: ${formatStreak(getUserRarityStreak(userId, 'General'), highestByRarity.get('General') || 0)}\n` +
            `📅 Daily streak: ${formatStreak(user.daily_streak, user.highest_daily_streak)}\n` +
            `${EMOJIS.votecoin} Vote streak: ${formatStreak(user.vote_streak, user.highest_vote_streak)}\n\n` +
            `**Rarity-based Catch Streaks**\n${rarityLines || 'No rarity streaks are configured.'}`
          )],
      });
    }

    if (command === 'daily') {
      const user = getUser(userId);
      const now = Date.now();
      if (user.last_daily > 0 && getDailyResetDay(user.last_daily) === getDailyResetDay(now)) {
        const hours = Math.ceil((getNextDailyReset(now) - now) / (60 * 60 * 1000));
        return message.reply(`⏰ You have already claimed your daily reward! Return in **${hours} hours**.`);
      }
      const dailyClaim = db.transaction(() => {
        const currentUser = getUser(userId);
        if (
          currentUser.last_daily > 0
          && getDailyResetDay(currentUser.last_daily) === getDailyResetDay(now)
        ) return null;
        const daysSinceLastClaim = currentUser.last_daily > 0
          ? getDailyResetDay(now) - getDailyResetDay(currentUser.last_daily)
          : null;
        const nextStreak = daysSinceLastClaim === null || daysSinceLastClaim > 1
          ? 1
          : currentUser.daily_streak + 1;
        const rewards = getDailyRewards(nextStreak);
        resetChecklistIfNewDay(userId);
        updateUser(userId, {
          last_daily: now,
          daily_streak: nextStreak,
          highest_daily_streak: Math.max(currentUser.highest_daily_streak, nextStreak),
          cl_daily_claimed: 1,
        });
        incrementUser(userId, {
          ultraballs: rewards.ultraballs,
          greatballs: rewards.greatballs,
          rare_candies: rewards.rareCandies,
          masterballs: rewards.masterballs,
          dailies_claimed: 1,
        });
        const dailyPerks = getPatreonPerks(userId);
        rewards.coins = awardCoinsWithBoost(userId, rewards.coins * dailyPerks.dailyCoinMult).finalAmount;
        rewards.patreonCoins = dailyPerks.dailyCoins;
        rewards.patreonTokens = dailyPerks.dailyTokens;
        if (dailyPerks.dailyCoins || dailyPerks.dailyTokens) {
          incrementUser(userId, { coins: dailyPerks.dailyCoins, patreon_tokens: dailyPerks.dailyTokens });
        }
        for (const [boxName, quantity] of Object.entries(rewards.boxes)) {
          addUserItem(userId, boxName, quantity);
        }
        const dailyFunItems = FUN_ITEM_NAMES.filter((name) => name !== 'Sitrus Berry');
        rewards.funItem = dailyFunItems[Math.floor(Math.random() * dailyFunItems.length)];
        addUserItem(userId, rewards.funItem, 1);
        return { streak: nextStreak, rewards };
      }).immediate();
      if (dailyClaim === null) {
        const hours = Math.ceil((getNextDailyReset(now) - now) / (60 * 60 * 1000));
        return message.reply(`⏰ You have already claimed your daily reward! Return in **${hours} hours**.`);
      }
      const { streak, rewards: claimed } = dailyClaim;
      const bonusItems = [
        `${EMOJIS.greatball} ${claimed.greatballs} Greatballs`,
        `${EMOJIS.ultraball} ${claimed.ultraballs} Ultraballs`,
      ];
      for (const [boxName, quantity] of Object.entries(claimed.boxes)) {
        bonusItems.push(`${BOXES[boxName].emoji} ${quantity} ${boxName}`);
      }
      if (claimed.rareCandies) bonusItems.push(`${EMOJIS.rarecandy} ${claimed.rareCandies} Rare Candies`);
      if (claimed.masterballs) {
        bonusItems.push(`${EMOJIS.masterball} ${claimed.masterballs} Masterball${claimed.masterballs === 1 ? '' : 's'}`);
      }
      bonusItems.push(`${FUN_ITEM_EMOJIS[claimed.funItem]} 1 ${claimed.funItem}`);
      const dailyFaction = getUserFaction(userId);
      const dailyFactionBall = dailyFaction ? getDailyBall(dailyFaction.faction_key) : null;
      const nextResetSeconds = Math.floor(getNextDailyReset(now) / 1000);
      const dailyEmbed = new EmbedBuilder()
        .setColor(0x3498db)
        .setAuthor({
          name: `${message.author.username} is now on a 🏅 ${streak} daily streak!`,
          iconURL: message.author.displayAvatarURL(),
        })
        .setDescription(
          `${EMOJIS.pokecoin} **|** Here are your daily **${claimed.coins.toLocaleString()} PokéCoins**! ` +
          `You claimed ${bonusItems.join(', ')} today!\n` +
          `🕐 **|** Your next daily is on <t:${nextResetSeconds}:f>` +
          (dailyFaction
            ? `\n${dailyFaction.team.emoji} **|** Your Faction's daily ball-type is ` +
              `${BALL_CONFIG[dailyFactionBall.key]?.emoji || ''} ${dailyFactionBall.name}`
            : '')
        );
      if (claimed.patreonCoins || claimed.patreonTokens) {
        const patreonLines = [];
        if (claimed.patreonCoins) patreonLines.push(`${EMOJIS.pokecoin} **${claimed.patreonCoins.toLocaleString()}** PokéCoins`);
        if (claimed.patreonTokens) patreonLines.push(`${EMOJIS.patreonToken} **${claimed.patreonTokens.toLocaleString()}** Patreon Tokens`);
        dailyEmbed.addFields({ name: '💖 Patreon Daily Rewards', value: patreonLines.join('\n') });
      }
      return message.reply({ embeds: [dailyEmbed] });
    }

    if (command === 'monthly') {
      const tierPerks = getPatreonPerks(userId);
      if (!tierPerks.monthly) {
        return message.reply(`❌ Monthly rewards are for Patreon members. Use \`${PREFIX}perks\` to see the tiers.`);
      }
      return message.reply({
        embeds: [new EmbedBuilder().setColor(0xf1c40f).setTitle('💰 Monthly Patreon Rewards')
          .setDescription(
            `Your monthly rewards are sent to you automatically on the **last day of every month at 10 PM Pacific Time** ` +
            `(next: <t:${Math.floor(getNextPatreonMonthlyTime() / 1000)}:F>).\n\n` +
            monthlyRewardLines(tierPerks.monthly).join('\n')
          )],
      });
    }

    if (command === 'hunt' || command === 'h' || command === 'target' || command === 'hunts') {
      const huntSub = ['reroll', 'rr'].includes(args[0]?.toLowerCase()) ? 'reroll' : args[0]?.toLowerCase();
      if (args.length > 1 || (args[0] && huntSub !== 'reroll')) {
        return message.reply(`Usage: \`${PREFIX}hunt [reroll]\` (alias: \`${PREFIX}h [rr]\`).`);
      }
      let user = getUser(userId);
      const now = Date.now();
      const currentHuntConfig = DAILY_HUNT_CONFIG[user.hunt_target_rarity];
      const hasCurrentHunt = currentHuntConfig
        && user.hunt_target_id > 0
        && user.hunt_required === currentHuntConfig.required;
      const huntFields = (huntTarget) => ({
        hunt_target_id: huntTarget.id,
        hunt_target_name: huntTarget.name,
        hunt_target_rarity: huntTarget.rarity,
        hunt_progress: 0,
        hunt_required: DAILY_HUNT_CONFIG[huntTarget.rarity].required,
        hunt_completed: 0,
      });
      if (!user.hunt_expires_at || now >= user.hunt_expires_at || !hasCurrentHunt) {
        updateUser(userId, {
          ...huntFields(chooseDailyHuntTarget()),
          hunt_rerolls_left: 1,
          hunt_expires_at: getNextHuntReset(now),
        });
        user = getUser(userId);
        if (huntSub === 'reroll') {
          return message.reply(
            `🎯 Your new Daily Hunt target is **${user.hunt_target_name}** (${user.hunt_target_rarity}). ` +
            `You can reroll it once more today with \`${PREFIX}hunt reroll\`.`
          );
        }
      } else if (huntSub === 'reroll') {
        if (user.hunt_rerolls_left <= 0) {
          return message.reply('❌ You have already used today’s Daily Hunt reroll.');
        }
        updateUser(userId, {
          ...huntFields(chooseDailyHuntTarget(user.hunt_target_id)),
          hunt_rerolls_left: 0,
        });
        user = getUser(userId);
        const rerollImage = getHuntTargetSprite(user);
        return message.reply({
          content: `🎲 Rerolled your Daily Hunt target to **${user.hunt_target_name}** (${user.hunt_target_rarity}).`,
          embeds: rerollImage ? [new EmbedBuilder().setColor(0x0099ff).setImage(rerollImage)] : [],
        });
      }

      const remainingSeconds = Math.max(0, Math.floor((user.hunt_expires_at - now) / 1000));
      const huntConfig = DAILY_HUNT_CONFIG[user.hunt_target_rarity];
      const rewards = [
        ['pokeballs', EMOJIS.pokeball, 'Pokéball'],
        ['greatballs', EMOJIS.greatball, 'Greatball'],
        ['ultraballs', EMOJIS.ultraball, 'Ultraball'],
        ['premierballs', EMOJIS.premierball, 'Premierball'],
        ['masterballs', EMOJIS.masterball, 'Masterball'],
      ].filter(([field]) => huntConfig.rewards[field] > 0)
        .map(([field, emoji, name]) => `${emoji} ${huntConfig.rewards[field]} ${name}${huntConfig.rewards[field] === 1 ? '' : 's'}`)
        .join(', ');
      const embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle("Today's Daily Hunt")
        .setDescription(
          `Catch **${user.hunt_target_name}** (${user.hunt_target_rarity}) before the next daily reset.\n` +
          `⏰ Resets <t:${Math.floor(user.hunt_expires_at / 1000)}:R>\n\n` +
          `**Progress:** ${user.hunt_progress}/${user.hunt_required} ${user.hunt_completed ? '✅ Complete' : ''}\n` +
          `🎁 **Completion reward:** ${rewards}\n` +
          `Rerolls remaining: ${user.hunt_rerolls_left} (\`${PREFIX}hunt reroll\`)`
        )
        .setFooter({ text: `${Math.floor(remainingSeconds / 3600)}h ${Math.floor((remainingSeconds % 3600) / 60)}m remaining` });
      const huntImage = getHuntTargetSprite(user);
      if (huntImage) embed.setImage(huntImage);
      return message.reply({ embeds: [embed] });
    }

    if (command === 'quest' || command === 'q') {
      let rerollNotice = '';
      if (args[0]?.toLowerCase() === 'rr') {
        const maxSlot = getUserQuestSlots(userId);
        if (args.length !== 2 || !/^\d+$/.test(args[1])) {
          return message.reply(`Usage: \`${PREFIX}q rr <quest number 1-${maxSlot}>\`.`);
        }
        const questSlot = Number(args[1]);
        if (questSlot < 1 || questSlot > maxSlot) {
          return message.reply(`Choose a quest from **1** to **${maxSlot}**: \`${PREFIX}q rr <1-${maxSlot}>\`.`);
        }
        const reroll = rerollUserQuest(userId, questSlot);
        if (reroll.error === 'insufficient_coins') {
          return message.reply(
            `❌ Quest rerolls cost ${EMOJIS.pokecoin} **${QUEST_REROLL_COST.toLocaleString()}**. ` +
            `You have **${reroll.coins.toLocaleString()}** PokéCoins.`
          );
        }
        if (reroll.error === 'quest_not_found') {
          return message.reply(`❌ You do not have an active quest in Slot #${questSlot}.`);
        }
        rerollNotice = reroll.usedScroll
          ? `📜 Used **1 Quest Reset Scroll** to reroll **Quest #${reroll.quest.slot}**.\n\n`
          : `🔄 Quest **#${reroll.quest.slot}** rerolled for ` +
            `${EMOJIS.pokecoin} **${reroll.cost.toLocaleString()}** PokéCoins.\n\n`;
      }
      const user = getUser(userId);
      const activeQuests = getUserQuests(userId);
      const activeQuestText = activeQuests.map((quest) => {
        const isWaitingForRefresh = quest.refresh_at > 0;
        const progressText = quest.refresh_at > 0
          ? `└ ⏳ New quest available <t:${Math.floor(quest.refresh_at / 1000)}:R>`
          : `└ 📋 Progress: ${quest.progress} / ${quest.target}`;
        return (
          `**Quest #${quest.slot}:** ${isWaitingForRefresh ? '✅ Completed' : formatQuestObjective(quest)}\n` +
          `│ 💰 ${isWaitingForRefresh ? 'Rewards claimed' : 'Rewards'}: ${formatQuestRewards(quest)}\n` +
          progressText
        );
      }).join('\n\n');
      return message.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xe67e22)
          .setAuthor({
            name: `${message.author.username}'s Quests`,
            iconURL: message.author.displayAvatarURL(),
          })
          .setTitle('Complete your quests for rewards!')
          .setDescription(
            `${rerollNotice}${activeQuestText}`
          )
          .setFooter({
            text: `Use ${PREFIX}q rr <1-${activeQuests.length}> to reroll (uses a Quest Reset Scroll first, otherwise ${QUEST_REROLL_COST.toLocaleString()} PokéCoins).`,
          })],
      });
    }

    if (
      command === 'pokedex'
      || command === 'pdex'
      || ((command === 'dex' || command === 'd') && args.length === 0)
    ) {
      const targetUser = message.mentions.users.first() || message.author;
      const totalSpecies = db.prepare(
        'SELECT COUNT(DISTINCT species_id) AS count FROM pokemon_forms WHERE is_default = 1'
      ).get().count;
      const total = totalSpecies * 3;
      const dexNumberByFormId = getPokemonDexNumbers(db.prepare(`
        SELECT id, species_id, name, slug, is_default
        FROM pokemon_forms
        ORDER BY species_id, id
      `).all());
      const dexEntries = db.prepare(`
        SELECT id, species_id, name, rarity
        FROM pokemon_forms
        WHERE is_default = 1
      `).all().flatMap((pokemon) => {
        const numbers = dexNumberByFormId.get(pokemon.id);
        return [
          { ...pokemon, is_shiny: 0, dex_number: numbers.dexNumber },
          { ...pokemon, is_shiny: 1, dex_number: numbers.shinyDexNumber },
          { ...pokemon, is_shiny: 0, is_golden: 1, dex_number: getGoldenDexNumber(pokemon.species_id) },
        ];
      });
      const formEntryRows = db.prepare(`
        SELECT id, species_id, name, rarity
        FROM pokemon_forms
        WHERE is_default = 0
      `).all().filter((pokemon) => /gmax|gigantamax|eternamax|\bmega\b/i.test(pokemon.name));
      for (const pokemon of formEntryRows) {
        const numbers = dexNumberByFormId.get(pokemon.id);
        if (!numbers) continue;
        dexEntries.push(
          { ...pokemon, is_form: 1, is_shiny: 0, dex_number: numbers.dexNumber },
          { ...pokemon, is_form: 1, is_shiny: 1, dex_number: numbers.shinyDexNumber },
        );
      }
      const pageSize = 20;
      const dexRarityOptions = [
        ['all', 'All'], ['common', 'Common'], ['uncommon', 'Uncommon'], ['rare', 'Rare'], ['super rare', 'Super Rare'],
        ['legendary', 'Legendary'],         ['shiny', 'Shiny'], ['golden', 'Golden'], ['mega', 'Mega'], ['gmax', 'Gmax'],
      ];
      let dexRarity = 'all';
      const dexMatchesRarity = (pokemon) => {
        if (dexRarity === 'all') return !pokemon.is_form;
        if (dexRarity === 'golden') return Boolean(pokemon.is_golden);
        if (pokemon.is_golden) return false;
        const displayed = getDisplayRarity(pokemon.rarity, pokemon.name, Boolean(pokemon.is_shiny)).toLowerCase();
        return dexRarity === 'mega' || dexRarity === 'gmax' || dexRarity === 'shiny'
          ? displayed.includes(dexRarity)
          : displayed === dexRarity;
      };
      const visibleDexEntries = () => dexEntries.filter(dexMatchesRarity);
      const getDexTotalPages = () => Math.max(1, Math.ceil(visibleDexEntries().length / pageSize));
      let totalPages = getDexTotalPages();
      const requestedPage = Number(args.find((argument) => /^\d+$/.test(argument)));
      let currentPage = Number.isSafeInteger(requestedPage) && requestedPage > 0
        ? Math.min(requestedPage, totalPages)
        : 1;
      let sortAscending = true;
      const caughtRows = db.prepare(`
        SELECT pokemon.species_id, catches.is_shiny, catches.is_golden
        FROM catches
        JOIN pokemon_forms AS pokemon ON pokemon.id = catches.pokemon_id
        WHERE catches.user_id = ?
        GROUP BY pokemon.species_id, catches.is_shiny, catches.is_golden
      `).all(targetUser.id);
      const caughtByEntry = new Map(
        caughtRows.map((row) => [`${row.species_id}:${row.is_golden ? 'g' : row.is_shiny}`, true])
      );
      const seenBySpecies = new Set(
        caughtRows.map((row) => row.species_id)
      );
      const caughtForms = new Set(db.prepare(`
        SELECT DISTINCT pokemon_id, is_shiny FROM catches WHERE user_id = ?
      `).all(targetUser.id).map((row) => `${row.pokemon_id}:${row.is_shiny ? 1 : 0}`));
      const pageEmbed = () => {
        const entries = visibleDexEntries()
          .sort((left, right) =>
            (left.dex_number - right.dex_number) * (sortAscending ? 1 : -1)
          )
          .slice((currentPage - 1) * pageSize, currentPage * pageSize);
        const description = entries.map((pokemon) => {
          const variantKey = `${pokemon.species_id}:${pokemon.is_golden ? 'g' : pokemon.is_shiny}`;
          const marker = (pokemon.is_form
            ? caughtForms.has(`${pokemon.id}:${pokemon.is_shiny}`)
            : caughtByEntry.has(variantKey))
            ? '<:caught:1560340176713031711>'
            : seenBySpecies.has(pokemon.species_id)
              ? '<:uncaught:1560340193108566177>'
              : '<:empty:1560342156630167764>';
          const rarityEmoji = pokemon.is_golden ? EMOJIS.golden : getRarityEmojis(
            pokemon.rarity,
            pokemon.name,
            Boolean(pokemon.is_shiny)
          );
          const displayName = pokemon.is_golden ? `Golden ${pokemon.name}` : pokemon.is_shiny ? `Shiny ${pokemon.name}` : pokemon.name;
          return `\`${String(pokemon.dex_number).padStart(4, '0')}\` ${marker} ${rarityEmoji} **${displayName}**`;
        }).join('\n') || 'No entries.';
        return new EmbedBuilder()
          .setColor(0x0099ff)
          .setAuthor({ name: `${targetUser.username}'s Pokédex`, iconURL: targetUser.displayAvatarURL() })
          .setTitle('Complete your Pokédex!')
          .setDescription(description)
          .setFooter({
            text: `Total: ${total} • Unique: ${caughtByEntry.size}/${total} • Shiny entries have their own numbers • Page: ${currentPage}/${totalPages}` +
              (dexRarity === 'all' ? '' : ` • Showing: ${dexRarityOptions.find(([key]) => key === dexRarity)[1]}`),
          });
      };
      const pageButtons = () => [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('pokedex:first').setEmoji('⏪').setStyle(ButtonStyle.Secondary).setDisabled(currentPage === 1),
        new ButtonBuilder().setCustomId('pokedex:prev').setLabel('Back').setEmoji('⬅️').setStyle(ButtonStyle.Primary).setDisabled(currentPage === 1),
        new ButtonBuilder().setCustomId('pokedex:next').setLabel('Next').setEmoji('➡️').setStyle(ButtonStyle.Primary).setDisabled(currentPage === totalPages),
        new ButtonBuilder().setCustomId('pokedex:last').setEmoji('⏩').setStyle(ButtonStyle.Secondary).setDisabled(currentPage === totalPages),
        new ButtonBuilder().setCustomId('pokedex:sort').setLabel('Sort').setEmoji('🔄').setStyle(ButtonStyle.Primary)
      ),
        ...[dexRarityOptions.slice(0, 5), dexRarityOptions.slice(5)].map((group) =>
          new ActionRowBuilder().addComponents(group.map(([key, label]) => {
            const button = new ButtonBuilder()
              .setCustomId(`pokedex:rarity:${key}`)
              .setStyle(dexRarity === key ? ButtonStyle.Success : ButtonStyle.Secondary);
            const emoji = key === 'all' ? '' : RARITY_EMOJIS[key];
            if (emoji) button.setEmoji(emoji);
            else button.setLabel(label);
            return button;
          })))
      ];
      const pokedexMessage = await message.reply({
        embeds: [pageEmbed()],
        components: pageButtons(),
      });
      const collector = pokedexMessage.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 90000,
      });
      collector.on('collect', async (interaction) => {
        try {
        if (interaction.user.id !== message.author.id) {
          await interaction.reply({
            content: `Use \`${PREFIX}dex\` yourself to browse the Pokédex.`,
            ephemeral: true,
          });
          return;
        }
        if (interaction.customId === 'pokedex:first') currentPage = 1;
        else if (interaction.customId === 'pokedex:prev') currentPage = Math.max(1, currentPage - 1);
        else if (interaction.customId === 'pokedex:next') currentPage = Math.min(totalPages, currentPage + 1);
        else if (interaction.customId === 'pokedex:last') currentPage = totalPages;
        else if (interaction.customId === 'pokedex:sort') {
          sortAscending = !sortAscending;
          currentPage = 1;
        } else if (interaction.customId.startsWith('pokedex:rarity:')) {
          dexRarity = interaction.customId.slice('pokedex:rarity:'.length);
          totalPages = getDexTotalPages();
          currentPage = 1;
        }
        await interaction.deferUpdate();
        await pokedexMessage.edit({ embeds: [pageEmbed()], components: pageButtons() });
        } catch (error) {
          console.error('Failed to update Pokédex page:', error);
          if (interaction.deferred) {
            await interaction.followUp({ content: 'Could not update the Pokédex page.', ephemeral: true });
          } else if (!interaction.replied) {
            await interaction.reply({ content: 'Could not update the Pokédex page.', ephemeral: true });
          }
        }
      });
      collector.on('end', async () => {
        const disabled = pageButtons().map((row) => new ActionRowBuilder().addComponents(
          row.components.map((button) => ButtonBuilder.from(button).setDisabled(true))
        ));
        try {
          await pokedexMessage.edit({ components: disabled });
        } catch (error) {
          console.error('Failed to disable Pokédex controls:', error);
        }
      });
      return;
    }

    if (command === 'dex' || command === 'd') {
      const previewShiny = args[0]?.toLowerCase() === 'shiny';
      const previewGolden = !previewShiny && args[0]?.toLowerCase() === 'golden';
      const query = (previewShiny || previewGolden ? args.slice(1) : args).join(' ').trim();
      if (!query) {
        return message.reply(
          `Search for a Pokémon, form, or Pokédex number: \`${PREFIX}dex [shiny|golden] <name|number>\`.`
        );
      }

      const dexIndexOffset = getDexIndexOffset();
      const catalogForms = db.prepare(
        'SELECT * FROM pokemon_forms ORDER BY species_id, id'
      ).all();
      const dexNumbersByFormId = getPokemonDexNumbers(catalogForms);
      const numericDex = /^\d+$/.test(query) ? Number(query) : null;
      const numericMatch = numericDex === null
        ? null
        : catalogForms
          .filter((pokemon) => !pokemon.is_default)
          .concat(catalogForms.filter((pokemon) => pokemon.is_default))
          .find((pokemon) => {
            const numbers = dexNumbersByFormId.get(pokemon.id);
            return numbers?.dexNumber === numericDex
              || numbers?.shinyDexNumber === numericDex;
          });
      const numericMatchIsShiny = numericMatch
        && dexNumbersByFormId.get(numericMatch.id)?.shinyDexNumber === numericDex;
      const goldenFormByNumber = numericDex === null
        ? null
        : catalogForms.find((pokemon) =>
          !pokemon.is_default
            && isGoldenFormSupported(pokemon.species_id, pokemon.slug)
            && getGoldenDexNumber(pokemon.species_id, pokemon.slug) === numericDex
        );
      const goldenByNumber = !numericMatch
        && numericDex !== null
        && isGoldenDexNumber(numericDex);
      const goldenEntry = previewGolden || goldenByNumber;
      const shinyEntry = !goldenEntry && (previewShiny || (
        numericMatch ? numericMatchIsShiny : numericDex !== null && numericDex > dexIndexOffset
      ));
      const speciesId = numericDex === null || numericMatch || goldenFormByNumber
        ? null
        : goldenByNumber
          ? numericDex - (GOLDEN_DEX_START - 1)
          : (numericDex > dexIndexOffset ? numericDex - dexIndexOffset : numericDex);
      let selectedPokemon;
      if (numericMatch) {
        selectedPokemon = numericMatch;
      } else if (goldenFormByNumber) {
        selectedPokemon = goldenFormByNumber;
      } else if (speciesId !== null) {
        const maximumSpeciesId = db.prepare(
          'SELECT MAX(species_id) AS maximum FROM pokemon_forms WHERE is_default = 1'
        ).get().maximum || 0;
        if (speciesId > maximumSpeciesId) {
          return message.reply(`Pokédex number **${numericDex}** is out of range.`);
        }
        selectedPokemon = db.prepare(`
          SELECT * FROM pokemon_forms
          WHERE species_id = ? AND is_default = 1
          ORDER BY id LIMIT 1
        `).get(speciesId);
      } else {
        const normalizedQuery = shinyEntry ? query.replace(/^shiny\s+/i, '') : query;
        const matches = findPokemonForms(normalizedQuery, 50);
        const normalizedName = normalizedQuery.toLowerCase();
        selectedPokemon = matches.find((pokemon) =>
          pokemon.name.toLowerCase() === normalizedName
          || pokemon.species_name.toLowerCase() === normalizedName
          || pokemon.slug.toLowerCase() === normalizedName.replace(/\s+/g, '-')
        ) || matches[0];
      }
      if (!selectedPokemon) return message.reply(`No Pokémon or form found for **${query}**.`);
      if (goldenEntry && !isGoldenFormSupported(
        selectedPokemon.species_id,
        selectedPokemon.slug,
        Boolean(selectedPokemon.is_default)
      )) {
        // Unsupported Golden alternate forms use their base species' card.
        selectedPokemon = db.prepare(
          'SELECT * FROM pokemon_forms WHERE species_id = ? AND is_default = 1 ORDER BY id LIMIT 1'
        ).get(selectedPokemon.species_id) || selectedPokemon;
      }

      // Golden searches exclude Mega and Gmax forms from the related-form buttons.
      const relatedForms = db.prepare(`
        SELECT * FROM pokemon_forms
        WHERE evolution_chain_id = ? OR species_id = ?
        ORDER BY evolution_stage, species_id, is_default DESC, id
      `).all(
        selectedPokemon.evolution_chain_id || -1,
        selectedPokemon.species_id
      ).filter((form) => !goldenEntry || !/mega|gmax/i.test(form.rarity));
      const formById = new Map(relatedForms.map((form) => [form.id, form]));
      let currentPokemon = selectedPokemon;
      const formsPerPage = 20;
      let currentPage = Math.floor(
        Math.max(0, relatedForms.findIndex((form) => form.id === selectedPokemon.id)) / formsPerPage
      );
      const dexCard = (pokemon) => {
        let types;
        try {
          types = JSON.parse(pokemon.types);
        } catch (error) {
          console.error(`Could not parse Pokédex types for form ${pokemon.id}:`, error);
          types = [];
        }
        const numbers = dexNumbersByFormId.get(pokemon.id);
        const regularDexNumber = numbers?.dexNumber ?? pokemon.species_id;
        const shinyDexNumber = numbers?.shinyDexNumber
          ?? pokemon.species_id + dexIndexOffset;
        const goldenDexNumber = getGoldenDexNumber(pokemon.species_id, pokemon.slug);
        const dexNumber = goldenEntry
          ? goldenDexNumber ?? regularDexNumber
          : shinyEntry ? shinyDexNumber : regularDexNumber;
        const ingameCount = goldenEntry
          ? db.prepare(
            'SELECT COUNT(*) AS count FROM catches WHERE pokemon_id = ? AND is_golden = 1'
          ).get(pokemon.id).count
          : db.prepare(`
            SELECT COUNT(*) AS count FROM (
              SELECT catches.id FROM catches
              WHERE catches.pokemon_id = ? AND catches.is_shiny = ? AND catches.is_golden = 0
              UNION ALL
              SELECT market.id FROM market
              WHERE market.pokemon_id = ? AND market.is_shiny = ?
            )
          `).get(pokemon.id, shinyEntry ? 1 : 0, pokemon.id, shinyEntry ? 1 : 0).count;
        const seenCount = db.prepare(`
          SELECT seen_count AS count FROM pokemon_user_seen_counts
          WHERE user_id = ? AND pokemon_id = ? AND is_shiny = ? AND is_golden = ?
        `).get(userId, pokemon.id, shinyEntry ? 1 : 0, goldenEntry ? 1 : 0)?.count || 0;
        const ownedCount = goldenEntry
          ? db.prepare(
            'SELECT COUNT(*) AS count FROM catches WHERE user_id = ? AND pokemon_id = ? AND is_golden = 1'
          ).get(userId, pokemon.id).count
          : db.prepare(`
            SELECT COUNT(*) AS count FROM catches
            WHERE catches.user_id = ? AND catches.pokemon_id = ? AND catches.is_shiny = ? AND catches.is_golden = 0
          `).get(userId, pokemon.id, shinyEntry ? 1 : 0).count;
        const caughtStatusEmojiId = ownedCount > 0
          ? '1560340176713031711'
          : '1560340193108566177';
        const dexIcon = `https://raw.githubusercontent.com/msikma/pokesprite/master/icons/pokemon/regular/${pokemon.slug}.png`;
        const sprite = goldenEntry
          ? getGoldenSpriteUrl(pokemon.species_id, pokemon.slug)
          : getPokemonShowdownSprite(
            pokemon.slug,
            shinyEntry,
            shinyEntry ? (pokemon.shiny_sprite || pokemon.sprite) : pokemon.sprite
          );
        const evolutionLine = relatedForms
          .filter((form) => form.is_default)
          .sort((left, right) => left.evolution_stage - right.evolution_stage)
          .map((form) => `${form.species_id === pokemon.species_id ? '🔹 ' : ''}${form.name}`)
          .join(' → ');
        const variantIds = [
          `${EMOJIS.shiny} variant: \`${PREFIX}dex ${shinyDexNumber}\``,
          ...(goldenDexNumber
            ? [`${EMOJIS.golden} variant: \`${PREFIX}dex ${goldenDexNumber}\``]
            : []),
        ].join('  ');
        const embed = new EmbedBuilder()
          .setColor(goldenEntry
            ? RARITY_COLORS.golden
            : getRarityColor(pokemon.rarity, pokemon.name, shinyEntry))
          .setAuthor({
            name: `${pokemon.name} #${dexNumber}`,
            iconURL: `https://cdn.discordapp.com/emojis/${caughtStatusEmojiId}.png`,
          })
          .setDescription(
            `${variantIds}` +
            (evolutionLine ? `\n\n${evolutionLine}` : '')
          )
          .addFields(
            { name: 'Type', value: formatTypes(types), inline: true },
            { name: 'Dex Number', value: `#${pokemon.species_id}`, inline: true },
            {
              name: 'Rarity',
              value: goldenEntry
                ? `${EMOJIS.golden} Golden`
                : `${getRarityEmojis(pokemon.rarity, pokemon.name, shinyEntry)} ${getDisplayRarity(pokemon.rarity, pokemon.name, shinyEntry)}`,
              inline: true,
            },
            { name: 'Ingame', value: `🌐 ${ingameCount.toLocaleString()}`, inline: true },
            { name: 'Seen / Owned', value: `📜 ${seenCount.toLocaleString()} / 👤 ${ownedCount.toLocaleString()}`, inline: true },
            { name: 'Base Stats', value: `⚔️ ${pokemon.base_atk}  🛡️ ${pokemon.base_def}  ❤️ ${pokemon.base_hp}  ⚡ ${pokemon.base_spd}`, inline: true },
            { name: 'Base Stat Total', value: `${pokemon.base_stat_total}`, inline: true },
            {
              name: 'Obtainable From',
              value: goldenEntry
                ? 'Promo codes, event rewards, and admin giveaways'
                : `\`${PREFIX}p\` land encounters${pokemon.is_water ? `\n\`${PREFIX}fish\` fishing encounters` : ''}`,
              inline: true,
            }
          )
          .setFooter({
            text: 'Pokédex • Use the buttons below to browse forms and evolutions',
          });
        embed.setThumbnail(dexIcon);
        if (sprite) embed.setImage(sprite);
        return embed;
      };
      const formRows = () => {
        const pageForms = relatedForms.slice(
          currentPage * formsPerPage,
          (currentPage + 1) * formsPerPage
        );
        const buttons = pageForms.map((form) =>
          new ButtonBuilder()
            .setCustomId(`dex:form:${form.id}`)
            .setLabel(form.name.slice(0, 80))
            .setStyle(form.id === currentPokemon.id ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(form.id === currentPokemon.id)
        );
        const rows = [];
        for (let i = 0; i < buttons.length; i += 5) {
          rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
        }
        if (relatedForms.length > formsPerPage) {
          rows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('dex:page:prev')
              .setLabel('Previous')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(currentPage === 0),
            new ButtonBuilder()
              .setCustomId('dex:page:status')
              .setLabel(`Page ${currentPage + 1} / ${Math.ceil(relatedForms.length / formsPerPage)}`)
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true),
            new ButtonBuilder()
              .setCustomId('dex:page:next')
              .setLabel('Next')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled((currentPage + 1) * formsPerPage >= relatedForms.length)
          ));
        }
        return rows;
      };
      const dexMessage = await message.reply({
        embeds: [dexCard(currentPokemon)],
        components: formRows(),
      });
      if (relatedForms.length < 2) return;
      const collector = dexMessage.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 90000,
      });
      activeDexEntries.set(dexMessage.id, async (interaction) => {
        try {
          if (interaction.user.id !== userId) {
            await interaction.reply({
              content: `Use \`${PREFIX}dex ${query}\` yourself to browse this entry.`,
              ephemeral: true,
            });
            return;
          }
          if (interaction.customId.startsWith('dex:page:')) {
            const lastPage = Math.ceil(relatedForms.length / formsPerPage) - 1;
            currentPage = Math.max(0, Math.min(
              lastPage,
              currentPage + (interaction.customId === 'dex:page:next' ? 1 : -1)
            ));
          } else {
            const formId = Number(interaction.customId.slice('dex:form:'.length));
            const nextPokemon = formById.get(formId);
            if (!nextPokemon) {
              await interaction.reply({ content: 'That form is no longer available.', ephemeral: true });
              return;
            }
            currentPokemon = nextPokemon;
            currentPage = Math.floor(
              relatedForms.findIndex((form) => form.id === nextPokemon.id) / formsPerPage
            );
          }
          await interaction.deferUpdate();
          await dexMessage.edit({
            embeds: [dexCard(currentPokemon)],
            components: formRows(),
          });
        } catch (error) {
          console.error('Failed to update Pokédex form:', error);
          if (interaction.deferred) {
            await interaction.followUp({ content: 'Could not update the Pokédex form.', ephemeral: true });
          } else if (!interaction.replied) {
            await interaction.reply({ content: 'Could not update the Pokédex form.', ephemeral: true });
          }
        }
      });
      collector.on('end', async () => {
        activeDexEntries.delete(dexMessage.id);
        try {
          await dexMessage.edit({
            components: formRows().map((row) =>
              new ActionRowBuilder().addComponents(
                row.components.map((button) => ButtonBuilder.from(button).setDisabled(true))
              )
            ),
          });
        } catch (error) {
          console.error('Failed to disable Pokédex form buttons:', error);
        }
      });
      return;
    }

    if (command === 'cb' || command === 'catchbot') {
      const user = getUser(userId);
      const cb = getCatchbotData(userId);
      const now = Date.now();
      const subcommand = args[0]?.toLowerCase();

      if (subcommand === 'upgrade' || subcommand === 'up') {
        const aliases = {
          pokemon: 'pokemon',
          pkmn: 'pokemon',
          cost: 'cost',
          duration: 'duration',
          dur: 'duration',
          time: 'duration',
          luck: 'luck',
        };
        const statName = aliases[args[1]?.toLowerCase()];
        if (!statName || args.length !== 2) {
          return message.reply(
            `Usage: \`${PREFIX}cb upgrade <pokemon|cost|duration|luck>\`.`
          );
        }
        const result = upgradeCatchbot(userId, statName);
        if (result.error === 'run_unclaimed') {
          return message.reply(`Claim your finished CatchBot run before upgrading it.`);
        }
        if (result.error === 'max_level') {
          return message.reply(`❌ **${statName}** is already maxed at level ${result.level}.`);
        }
        if (result.error === 'insufficient_coins') {
          return message.reply(
            `❌ This upgrade costs **${result.cost.toLocaleString()} PokéCoins**; ` +
            `you have **${result.coins.toLocaleString()}**.`
          );
        }
        return message.reply(
          `🔧 CatchBot **${statName}** upgraded to **level ${result.level}** ` +
          `for **${result.cost.toLocaleString()} PokéCoins**.`
        );
      }

      if (subcommand === 'run' || subcommand === 'start') {
        const maxDuration = CB_CONFIG.duration.getStat(cb.duration_lvl);
        const hours = args[1] === undefined ? maxDuration : Number(args[1]);
        if (args.length > 2 || !Number.isSafeInteger(hours) || hours < 1) {
          return message.reply(`Usage: \`${PREFIX}cb run [hours 1-${maxDuration}]\`.`);
        }
        if (hours > maxDuration) {
          return message.reply(
            `❌ Your CatchBot can run for at most **${maxDuration} hours**. ` +
            `Upgrade duration with \`${PREFIX}cb upgrade duration\`.`
          );
        }
        const result = startCatchbotRun(userId, hours, now);
        if (result.error === 'already_running') {
          const minutes = Math.ceil((result.runningUntil - now) / 60000);
          return message.reply(`⚙️ CatchBot is already running. Time remaining: **${minutes} minutes**.`);
        }
        if (result.error === 'run_unclaimed') {
          return message.reply(`Claim the completed CatchBot run with \`${PREFIX}cb claim\` before starting another.`);
        }
        if (result.error === 'duration_too_long') {
          return message.reply(`❌ Your CatchBot can currently run for at most **${result.maxDuration} hours**.`);
        }
        if (result.error === 'insufficient_coins') {
          return message.reply(
            `❌ This run costs **${result.totalCost.toLocaleString()} PokéCoins**; ` +
            `you have **${result.coins.toLocaleString()}**.`
          );
        }
        return message.reply(
          `🚀 **CatchBot dispatched!**\n` +
          `• Duration: **${result.hours} hours**\n` +
          `• Expected catches: **${result.totalPokemon} Pokémon** ` +
          `(${result.pokemonPerHour}/hour)\n` +
          `• Cost: **${result.totalCost.toLocaleString()} PokéCoins** ` +
          `(${result.costPerPokemon} each)\n\n` +
          `Return after the run with \`${PREFIX}cb claim\`.`
        );
      }

      if (subcommand === 'claim') {
        if (!cb.running_until && user.catchbot_end) {
          if (now < user.catchbot_end) {
            const minutes = Math.ceil((user.catchbot_end - now) / 60000);
            return message.reply(`⚙️ Your legacy CatchBot run is still active. Available in **${minutes} minutes**.`);
          }
          const roleChanceBoost = await getRoleEncounterBoost(userId);
          const legacyLuckPercent = CB_CONFIG.luck.getStat(cb.luck_lvl);
          const legacyRewards = Array.from(
            { length: 4 },
            () => rollCatchbotGoldenExclusive(legacyLuckPercent)
              || rollSpawn('land', userId, null, {
                catchbot: true,
                catchbotLuckPercent: legacyLuckPercent,
                roleChanceBoost,
              })
          );
          const eventCatchReports = [];
          const legacyClaimed = db.transaction(() => {
            const current = getUser(userId);
            if (!current.catchbot_end || now < current.catchbot_end) return false;
            updateUser(userId, { catchbot_end: 0 });
            for (const pokemon of legacyRewards) {
              if (pokemon.isGolden) saveCatch(userId, pokemon, false, true, true);
              else saveCatch(userId, pokemon, pokemon.isShiny, true);
              advanceEggCatchProgress(userId);
              const displayRarity = getDisplayRarity(pokemon.rarity, pokemon.name, pokemon.isShiny);
              awardCatchExperience(userId, getCatchExperienceReward(pokemon.isGolden ? 'Common' : displayRarity));
              trackClanActivity(userId, 'catch');
              if (isEventOpen(halloweenEvent)) {
                const eventCatch = recordEventCatch(
                  halloweenEvent.id,
                  userId,
                  pokemon.name,
                  pokemon.isShiny
                );
                if (isEventChecklistSpawn(pokemon)) {
                  incrementUser(userId, { cl_event_catches: 1 });
                }
                if (eventCatch) {
                  eventCatchReports.push({ pokemon, eventCatch });
                }
              }
            }
            incrementUser(userId, { cl_catches: legacyRewards.length });
            trackClanActivity(userId, 'catchbot');
            const { finalAmount: bonus } = awardCoinsWithBoost(userId, 300);
            return true;
          }).immediate();
          if (!legacyClaimed) return message.reply('❌ CatchBot could not be claimed. Please try again.');
          const completedQuests = advanceQuestProgress(userId, {
            catches: legacyRewards.length,
            rarityCounts: countQuestRarities(legacyRewards),
            typeCounts: countQuestTypes(legacyRewards),
          });
          announceQuestCompletions(userId, message.channel, completedQuests);
          try {
            await sendCatchbotClaimPages(
              message,
              '🤖 CatchBot Return Log',
              legacyRewards,
              `CatchBot secured **${legacyRewards.length} Pokémon**.\n` +
              `Bonus earned: ${EMOJIS.pokecoin} **${bonus.toLocaleString()} PokéCoins**.`
            );
            await message.reply('✅ CatchBot rewards claimed. I sent the paginated results to your DMs.');
          } catch (error) {
            console.error(`Failed to send legacy CatchBot claim pages to user ${userId}:`, error);
            await message.reply(
              '✅ CatchBot rewards were claimed and added to your box, but I could not DM the results. ' +
              'Enable DMs from server members and check `.box`.'
            );
          }
          for (const { pokemon, eventCatch } of eventCatchReports) {
            await announceEventCatch(message.guild, message.author, pokemon, eventCatch);
          }
          for (const pokemon of legacyRewards) {
            await announceRareSpawn(message.guild, message.author, pokemon);
          }
          return;
        }

        const eventCatchReports = [];
        const roleChanceBoost = await getRoleEncounterBoost(userId);
        const result = db.transaction(() => {
          const run = claimCatchbotRun(userId, now);
          if (run.error) return run;
          const totalPokemon = run.pokemonPerHour * run.hours;
          const counts = { c: 0, u: 0, r: 0, sr: 0, l: 0, s: 0, g: 0 };
          let goldenCount = 0;
          const caughtPokemon = [];
          const rarityCounts = {};
          for (let index = 0; index < totalPokemon; index += 1) {
            const spawnedPokemon = rollSpawn('land', userId, null, {
              catchbot: true,
              catchbotLuckPercent: run.luckPercent,
              roleChanceBoost,
            });
            const pokemon = rollCatchbotGoldenExclusive(run.luckPercent) || spawnedPokemon;
            if (pokemon.isGolden) saveCatch(userId, pokemon, false, true, true);
            else saveCatch(userId, pokemon, pokemon.isShiny, true);
            advanceEggCatchProgress(userId);
            caughtPokemon.push({ ...pokemon });
            const displayRarity = getDisplayRarity(pokemon.rarity, pokemon.name, pokemon.isShiny);
            rarityCounts[displayRarity] = (rarityCounts[displayRarity] || 0) + 1;
            awardCatchExperience(userId, getCatchExperienceReward(pokemon.isGolden ? 'Common' : displayRarity));
            trackClanActivity(userId, 'catch');
            if (pokemon.isGolden) goldenCount += 1;
            if (pokemon.isShiny) counts.s += 1;
            else if (pokemon.rarity === 'Legendary') counts.l += 1;
            else if (pokemon.rarity === 'Super Rare') counts.sr += 1;
            else if (pokemon.rarity === 'Rare') counts.r += 1;
            else if (pokemon.rarity === 'Uncommon') counts.u += 1;
            else if (pokemon.rarity === 'Gmax') counts.g += 1;
            else counts.c += 1;
            if (isEventOpen(halloweenEvent)) {
              const eventCatch = recordEventCatch(
                halloweenEvent.id,
                userId,
                pokemon.name,
                pokemon.isShiny
              );
              if (isEventChecklistSpawn(pokemon)) {
                incrementUser(userId, { cl_event_catches: 1 });
              }
              if (eventCatch) {
                eventCatchReports.push({ pokemon, eventCatch });
              }
            }
          }
          incrementUser(userId, { cl_catches: totalPokemon });
          recordCatchbotResults(userId, counts);
          return { ...run, counts, goldenCount, totalPokemon, caughtPokemon, rarityCounts };
        }).immediate();
        if (result.error === 'no_run') {
          return message.reply(`CatchBot has no unclaimed run. Start one with \`${PREFIX}cb run\`.`);
        }
        if (result.error === 'still_running') {
          const minutes = Math.ceil((result.runningUntil - now) / 60000);
          return message.reply(`⚙️ CatchBot is still running. Available in **${minutes} minutes**.`);
        }
        const completedQuests = advanceQuestProgress(userId, {
          catches: result.totalPokemon,
          rarityCounts: result.rarityCounts,
          typeCounts: countQuestTypes(result.caughtPokemon),
        });
        announceQuestCompletions(userId, message.channel, completedQuests);
        const raritySummary = [
          ['Common', result.counts.c - result.goldenCount],
          ['Uncommon', result.counts.u],
          ['Rare', result.counts.r],
          ['Super Rare', result.counts.sr],
          ['Legendary', result.counts.l],
          ['Shiny', result.counts.s],
          [`${EMOJIS.golden} Golden`, result.goldenCount],
        ].filter(([, count]) => count > 0)
          .map(([rarity, count]) =>
            `${String(rarity).includes('Golden') ? rarity : getRarityEmojis(rarity)} **${count}**`
          )
          .join('\n');
        try {
          await sendCatchbotClaimPages(
            message,
            '🤖 CatchBot Return Log',
            result.caughtPokemon,
            `CatchBot returned with **${result.totalPokemon} Pokémon** after **${result.hours} hours**.\n\n` +
            `**Catch summary**\n${raritySummary || 'No catches recorded.'}`
          );
          await message.reply('✅ CatchBot rewards claimed. I sent the paginated results to your DMs.');
        } catch (error) {
          console.error(`Failed to send CatchBot claim pages to user ${userId}:`, error);
          await message.reply(
            '✅ CatchBot rewards were claimed and added to your box, but I could not DM the results. ' +
            'Enable DMs from server members and check `.box`.'
          );
        }
        for (const { pokemon, eventCatch } of eventCatchReports) {
          await announceEventCatch(message.guild, message.author, pokemon, eventCatch);
        }
        for (const pokemon of result.caughtPokemon) {
          await announceRareSpawn(message.guild, message.author, pokemon);
        }
        return;
      }

      if (subcommand && subcommand !== 'status') {
        return message.reply(
          `CatchBot commands: \`${PREFIX}cb\`, \`${PREFIX}cb upgrade <pokemon|cost|duration|luck>\`, ` +
          `\`${PREFIX}cb run [hours]\`, \`${PREFIX}cb claim\`.`
        );
      }

      const currentMonsPerHour = CB_CONFIG.pokemon.getStat(cb.pokemon_lvl);
      const duration = CB_CONFIG.duration.getStat(cb.duration_lvl);
      const costPerPokemon = CB_CONFIG.cost.getStat(cb.cost_lvl);
      const luckPercent = CB_CONFIG.luck.getStat(cb.luck_lvl);
      const isRunning = cb.running_until > now || user.catchbot_end > now;
      const hasUnclaimedRun = Boolean(cb.running_until || user.catchbot_end);
      const timeRemaining = Math.max(cb.running_until, user.catchbot_end) - now;
      const renderLevelBar = (level, maximum) =>
        '■'.repeat(level) + '□'.repeat(maximum - level);
      const nextUpgrade = (stat) => cb[`${stat}_lvl`] < CB_CONFIG[stat].maxLvl
        ? CB_CONFIG[stat].costForLvl(cb[`${stat}_lvl`]).toLocaleString()
        : 'MAX';
      const status = isRunning
        ? `⚙️ **Running** — ${Math.ceil(timeRemaining / 60000)} minutes remaining`
        : hasUnclaimedRun
          ? `✅ **Run complete** — claim it with \`${PREFIX}cb claim\` before starting or upgrading`
          : `🔋 **Ready** — run up to **${duration} hours** with \`${PREFIX}cb run\``;
      const description =
        `${status}\n\n` +
        `**Upgrades**\n` +
        `🔴 Pokémon: **${currentMonsPerHour}/hour** — Lv. ${cb.pokemon_lvl}/10 ` +
        `(${renderLevelBar(cb.pokemon_lvl, 10)}) • Next: ${nextUpgrade('pokemon')}\n` +
        `💰 Cost: **${costPerPokemon} coins/catch** — Lv. ${cb.cost_lvl}/10 ` +
        `(${renderLevelBar(cb.cost_lvl, 10)}) • Next: ${nextUpgrade('cost')}\n` +
        `⏰ Duration: **${duration} hours** — Lv. ${cb.duration_lvl}/11 ` +
        `(${renderLevelBar(cb.duration_lvl, 11)}) • Next: ${nextUpgrade('duration')}\n` +
        `🍀 Luck: **+${luckPercent}% shiny odds** — Lv. ${cb.luck_lvl}/10 ` +
        `(${renderLevelBar(cb.luck_lvl, 10)}) • Next: ${nextUpgrade('luck')}\n\n` +
        `**Lifetime catches**\n` +
        `${getRarityEmojis('Common')} ${cb.c_caught} • ${getRarityEmojis('Uncommon')} ${cb.u_caught} • ` +
        `${getRarityEmojis('Rare')} ${cb.r_caught}\n` +
        `${getRarityEmojis('Super Rare')} ${cb.sr_caught} • ${getRarityEmojis('Legendary')} ${cb.l_caught} • ` +
        `${getRarityEmojis('Shiny')} ${cb.s_caught}\n` +
        `Upgrades spent: **${cb.spent_upgrades.toLocaleString()} PokéCoins**\n\n` +
        `Commands: \`${PREFIX}cb upgrade <pokemon|cost|duration|luck>\`, ` +
        `\`${PREFIX}cb run [hours]\`, \`${PREFIX}cb claim\``;
      const maximumCost = CB_CONFIG.pokemon.getStat(10)
        * CB_CONFIG.duration.getStat(11)
        * CB_CONFIG.cost.getStat(10);
      return message.reply({
        embeds: [new EmbedBuilder()
          .setColor(0x2b2d31)
          .setTitle(`🤖 ${message.author.username}'s CatchBot`)
          .setDescription(description)
          .setFooter({
            text: `Fully upgraded: 372 catches over 12 hours for ${maximumCost.toLocaleString()} PokéCoins.`,
          })],
      });
    }

    if (command === 'buddy' || command === 'bud') {
      const action = args[0]?.toLowerCase();
      if (action === 'info') {
        const query = args.slice(1).join(' ').trim();
        if (!query) return message.reply(`Usage: \`${PREFIX}bud info <Pokémon>\`.`);
        const pokemon = findUserPokemonMatches(userId, query)[0];
        if (!pokemon) return message.reply(`You do not own a Pokémon matching **${query}**.`);
        let abilities;
        try {
          abilities = await fetchPokemonAbilities(pokemon.pokemon_id);
        } catch (error) {
          console.error(`Failed to load ability data for catch ${pokemon.id}:`, error);
          return message.reply('❌ Ability data could not be loaded right now. Please try again later.');
        }
        const standardAbilities = abilities.filter((ability) => !ability.hidden);
        const currentAbility = pokemon.ability || standardAbilities[0]?.name;
        if (!currentAbility) {
          return message.reply('❌ This Pokémon has no supported Standard Ability data.');
        }
        const infoMessage = await message.reply({
          embeds: [new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(`${pokemon.is_shiny ? '✨ ' : ''}${pokemon.name} — Ability`)
            .setDescription(`**Current ability:** ${currentAbility}\n\nSelect the Ability button to use an Ability Capsule or Ability Patch.`)],
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`ability-change:${pokemon.id}`)
              .setLabel('Ability')
              .setEmoji(EMOJIS.abilityCapsule)
              .setStyle(ButtonStyle.Primary)
          )],
        });
        const collector = infoMessage.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 60_000,
        });
        collector.on('collect', async (interaction) => {
          if (interaction.user.id !== userId) {
            return interaction.reply({ content: 'Only the trainer who requested this Pokémon’s info can change its ability.', ephemeral: true });
          }
          collector.stop('opened');
          await interaction.deferReply({ ephemeral: true });
          let currentAbilities;
          try {
            currentAbilities = await fetchPokemonAbilities(pokemon.pokemon_id);
          } catch (error) {
            console.error(`Failed to load ability options for catch ${pokemon.id}:`, error);
            return interaction.editReply('❌ Ability data could not be loaded right now. Please try again later.');
          }
          const livePokemon = findUserPokemonMatches(userId, pokemon.name)
            .find((entry) => entry.id === pokemon.id);
          if (!livePokemon) {
            return interaction.editReply('This Pokémon is no longer in your storage.');
          }
          const normal = currentAbilities.filter((ability) => !ability.hidden);
          const activeAbility = livePokemon.ability || normal[0]?.name;
          const ownedItems = new Map(getUserItems(userId).map((item) => [item.item_name, item.amount]));
          const choices = [];
          if ((ownedItems.get('Ability Capsule') || 0) > 0) {
            for (const ability of normal) {
              if (ability.name === activeAbility) continue;
              choices.push({
                name: ability.name,
                itemName: 'Ability Capsule',
                emoji: EMOJIS.abilityCapsule,
                description: 'Switch to this Standard Ability',
              });
            }
          }
          if ((ownedItems.get('Ability Patch') || 0) > 0) {
            for (const ability of currentAbilities.filter((entry) => entry.hidden)) {
              if (ability.name === activeAbility) continue;
              choices.push({
                name: ability.name,
                itemName: 'Ability Patch',
                emoji: EMOJIS.abilityPatch,
                description: 'Change to the Hidden Ability',
              });
            }
          }
          if (!choices.length) {
            return interaction.editReply(
              'No ability change is available. A Capsule requires another Standard Ability; a Patch requires an unused Hidden Ability.'
            );
          }
          const itemByValue = new Map();
          const menu = new StringSelectMenuBuilder()
            .setCustomId(`ability-select:${pokemon.id}`)
            .setPlaceholder('Choose an Ability item and target ability');
          for (const [index, choice] of choices.entries()) {
            const value = `${index}`;
            itemByValue.set(value, choice);
            menu.addOptions(new StringSelectMenuOptionBuilder()
              .setLabel(`${choice.name} — ${choice.itemName}`)
              .setDescription(choice.description)
              .setValue(value)
              .setEmoji(choice.emoji));
          }
          const abilityMessage = await interaction.editReply({
            content: `Current ability: **${activeAbility}**. Select an option to consume the matching item.`,
            components: [new ActionRowBuilder().addComponents(menu)],
          });
          const abilityCollector = abilityMessage.createMessageComponentCollector({
            componentType: ComponentType.StringSelect,
            time: 60_000,
          });
          abilityCollector.on('collect', async (selection) => {
            if (selection.user.id !== userId) {
              return selection.reply({ content: 'Only the trainer who opened this ability menu can use it.', ephemeral: true });
            }
            const choice = itemByValue.get(selection.values[0]);
            if (!choice) {
              abilityCollector.stop('invalid');
              return selection.update({ content: '❌ That ability selection is invalid. Run `.bud info` again.', components: [] });
            }
            const result = changePokemonAbility(userId, pokemon.id, choice.name, choice.itemName);
            const response = result.error === 'item_not_owned'
              ? `❌ You no longer have an ${choice.itemName}.`
              : result.error === 'already_has_ability'
                ? `**${pokemon.name}** already has **${choice.name}**.`
                : result.error === 'pokemon_not_found'
                  ? 'This Pokémon is no longer in your storage.'
                  : `✅ **${pokemon.name}** now has **${result.ability}**. Used 1 ${choice.emoji} ${choice.itemName}.`;
            await selection.update({ content: response, components: [] });
            abilityCollector.stop('changed');
          });
          abilityCollector.on('end', (_collected, reason) => {
            if (reason !== 'changed' && reason !== 'invalid') interaction.editReply({ components: [] }).catch((error) => {
              console.error(`Failed to remove expired ability selector for catch ${pokemon.id}:`, error);
            });
          });
        });
        collector.on('end', () => infoMessage.edit({ components: [] }).catch((error) => {
          console.error(`Failed to remove expired Ability button for catch ${pokemon.id}:`, error);
        }));
        return;
      }
      if (action === 'rr') {
        const stat = args[1]?.toLowerCase();
        if (args.length !== 2 || !['atk', 'def', 'hp', 'spd'].includes(stat)) {
          return message.reply(`Usage: \`${PREFIX}buddy rr <atk|def|hp|spd>\` (1 Vote Coin per reroll).`);
        }
        const result = rerollBuddyIv(userId, stat);
        if (result.error === 'no_buddy') {
          return message.reply(`Choose a buddy first with \`${PREFIX}buddy set <Pokémon>\`.`);
        }
        if (result.error === 'not_enough_vote_coins') {
          return message.reply(`You need 1 ${EMOJIS.votecoin} Vote Coin to reroll a buddy IV.`);
        }
        if (result.error === 'invalid_stat') {
          return message.reply(`Usage: \`${PREFIX}buddy rr <atk|def|hp|spd>\`.`);
        }
        const statName = { atk: 'Attack', def: 'Defense', hp: 'HP', spd: 'Speed' }[result.stat];
        return message.reply(
          `🎲 **${result.pokemon} ${statName} IV rerolled:** **${result.oldIv}** → **${result.newIv}** ` +
          `(${EMOJIS.votecoin} ${result.voteCoins.toLocaleString()} Vote Coins remaining).`
        );
      }
      if (action === 'nickname') {
        const buddy = getUserBuddy(userId);
        if (!buddy) {
          return message.reply(`Choose a buddy first with \`${PREFIX}buddy set <Pokémon>\`.`);
        }
        const nickname = args.slice(1).join(' ').trim();
        if (!nickname) {
          return message.reply(
            buddy.nickname
              ? `Your buddy's nickname is **${buddy.display_name}**. Use \`${PREFIX}buddy nickname reset\` to clear it.`
              : `Your buddy has no nickname. Set one with \`${PREFIX}buddy nickname <name>\`.`
          );
        }
        if (['reset', 'clear'].includes(nickname.toLowerCase())) {
          setBuddyNickname(userId, null);
          return message.reply(`Cleared your buddy's nickname. It is now **${buddy.name}**.`);
        }
        if (nickname.length > 32 || /[@\r\n]/.test(nickname)) {
          return message.reply('Buddy nicknames must be 1–32 characters and cannot contain @ or line breaks.');
        }
        const savedNickname = setBuddyNickname(userId, nickname);
        if (savedNickname?.error === 'no_buddy') {
          return message.reply(`Choose a buddy first with \`${PREFIX}buddy set <Pokémon>\`.`);
        }
        return message.reply(`Your buddy **${buddy.name}** is now nicknamed **${savedNickname}**.`);
      }
      if (action === 'clear' || action === 'off') {
        if (args.length > 1) {
          return message.reply(`Usage: \`${PREFIX}buddy clear\`.`);
        }
        updateUser(userId, { buddy_catch_id: null });
        return message.reply('Your buddy has been cleared.');
      }

      if (action === 'list') {
        const sortKey = args[1]?.toLowerCase() || 'ivs';
        const buddies = getUserBuddyHistory(userId, sortKey);
        if (!buddies.length) {
          return message.reply(`You have not set any Pokémon as your buddy yet! Use \`${PREFIX}buddy set <Pokémon>\`.`);
        }
        const currentId = getUser(userId).buddy_catch_id;
        const current = buddies.find((mon) => mon.id === currentId);
        const currentBuddy = getUserBuddy(userId);
        const pageSize = 15;
        const totalPages = Math.ceil(buddies.length / pageSize);
        let page = 1;
        const buildEmbed = () => {
          const start = (page - 1) * pageSize;
          const lines = buddies.slice(start, start + pageSize).map((mon, index) => {
            const displayName = mon.id === currentId ? currentBuddy?.display_name || mon.name : mon.name;
            const name = mon.id === currentId ? `**${displayName}**` : mon.name;
            return `\`${String(start + index + 1).padStart(2, '0')}\` ${mon.is_shiny ? '✨ ' : ''}${name} • Lvl. ${mon.level} • ` +
              `${(mon.experience || 0).toLocaleString()} XP • ${mon.iv_percent.toFixed(1)}% IV`;
          });
          return new EmbedBuilder()
            .setColor(0x0099ff)
            .setAuthor({
              name: `${message.author.username}'s Buddy Profiles — Sorted by ${sortKey === 'num' ? 'Number' : sortKey === 'stats' || sortKey === 'evs' ? 'Level/XP' : 'IVs'}`,
              iconURL: message.author.displayAvatarURL(),
            })
            .setDescription(`Current buddy: ${current ? `**${currentBuddy?.display_name || current.name}** Lvl. ${current.level}` : '*None*'}\n\n${lines.join('\n')}`)
            .setFooter({ text: `Page ${page}/${totalPages} • ${PREFIX}buddy list [ivs/stats/num]` });
        };
        const buildRow = () => new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('budlist_first').setEmoji('⏪').setStyle(ButtonStyle.Secondary).setDisabled(page === 1),
          new ButtonBuilder().setCustomId('budlist_prev').setEmoji('⬅️').setStyle(ButtonStyle.Primary).setDisabled(page === 1),
          new ButtonBuilder().setCustomId('budlist_next').setEmoji('➡️').setStyle(ButtonStyle.Primary).setDisabled(page === totalPages),
          new ButtonBuilder().setCustomId('budlist_last').setEmoji('⏩').setStyle(ButtonStyle.Secondary).setDisabled(page === totalPages)
        );
        const listMsg = await message.reply({ embeds: [buildEmbed()], components: totalPages > 1 ? [buildRow()] : [] });
        if (totalPages > 1) {
          const collector = listMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 90000 });
          collector.on('collect', async (interaction) => {
            if (interaction.user.id !== message.author.id) {
              return interaction.reply({ content: `Use \`${PREFIX}buddy list\` yourself to view your buddies.`, ephemeral: true });
            }
            const id = interaction.customId;
            if (id === 'budlist_first') page = 1;
            else if (id === 'budlist_prev') page = Math.max(1, page - 1);
            else if (id === 'budlist_next') page = Math.min(totalPages, page + 1);
            else if (id === 'budlist_last') page = totalPages;
            await interaction.update({ embeds: [buildEmbed()], components: [buildRow()] });
          });
          collector.on('end', () => listMsg.edit({ components: [] }).catch(() => {}));
        }
        return;
      }

      if (action === 'set' || (action && /^\d+$/.test(action))) {
        const query = action === 'set' ? args.slice(1).join(' ') : args.join(' ');
        if (!query || args.length > (action === 'set' ? 10 : 9)) {
          return message.reply(
            `Usage: \`${PREFIX}buddy set [shiny|golden] <Pokémon form name|Pokédex number>\` or \`${PREFIX}buddy clear\`.`
          );
        }
        const buddy = setUserBuddyByQuery(userId, query);
        if (!buddy) {
          return message.reply(`You do not own a Pokémon matching **${query}**. Use its name or Pokédex number from \`${PREFIX}box\`.`);
        }
        return message.reply(
          `${getRarityEmojis(buddy.rarity, buddy.name, Boolean(buddy.is_shiny))} ` +
          `${buddy.is_shiny ? '✨ ' : ''}**${buddy.display_name || buddy.name}** (#${buddy.dex_number}) is now your buddy! ` +
          'Catch Pokémon to earn buddy EXP.'
        );
      }

      if (args.length) {
        return message.reply(
          `Usage: \`${PREFIX}buddy\`, \`${PREFIX}buddy info <Pokémon>\`, \`${PREFIX}buddy set [shiny|golden] <Pokémon form name|Pokédex number>\`, ` +
          `\`${PREFIX}buddy clear\`, \`${PREFIX}buddy nickname <name|reset>\`, or ` +
          `\`${PREFIX}buddy rr <atk|def|hp|spd>\` (1 Vote Coin).`
        );
      }

      const buddy = getUserBuddy(userId);
      if (!buddy) {
        const dexIndexOffset = getDexIndexOffset();
        const choices = db.prepare(`
          SELECT catches.name, catches.is_shiny, catches.is_golden, catches.level,
            pokemon_forms.id AS form_id, pokemon_forms.species_id,
            COALESCE(pokemon_forms.species_id, catches.pokemon_id)
              + CASE WHEN catches.is_shiny = 1 THEN ? ELSE 0 END AS dex_number,
            pokemon_forms.slug
          FROM catches
          LEFT JOIN pokemon_forms ON pokemon_forms.id = catches.pokemon_id
          WHERE catches.user_id = ?
          ORDER BY catches.id DESC
          LIMIT 15
        `).all(dexIndexOffset, userId);
        const dexNumberByFormId = getPokemonDexNumbers(db.prepare(`
          SELECT id, species_id, name, slug, is_default
          FROM pokemon_forms
          ORDER BY species_id, id
        `).all());
        for (const pokemon of choices) {
          const dexNumbers = dexNumberByFormId.get(pokemon.form_id);
          if (pokemon.is_golden) {
            pokemon.dex_number = getGoldenDexNumber(pokemon.species_id, pokemon.slug) ?? pokemon.dex_number;
          } else if (dexNumbers) {
            pokemon.dex_number = pokemon.is_shiny
              ? dexNumbers.shinyDexNumber ?? dexNumbers.dexNumber
              : dexNumbers.dexNumber;
          }
        }
        if (!choices.length) {
          return message.reply(`You do not have a Pokémon to set as your buddy yet. Catch one with \`${PREFIX}p\`.`);
        }
        const available = choices.map((pokemon) =>
          `• #${pokemon.dex_number} — ${pokemon.is_golden ? `${EMOJIS.golden} Golden ` : ''}` +
          `${pokemon.is_shiny ? '✨ ' : ''}${pokemon.name} (Lv. ${pokemon.level})`
        ).join('\n');
        return message.reply(
          `Choose a buddy with \`${PREFIX}buddy set [shiny|golden] <Pokémon form name|Pokédex number>\`:\n${available}`
        );
      }

      const level = buddy.level;
      const levelStart = level === 1 ? 0 : level ** 2 * 75;
      const nextLevelAt = experienceForNextLevel(level);
      const progress = level >= 100
        ? 1
        : Math.max(0, Math.min(1, (buddy.experience - levelStart) / (nextLevelAt - levelStart)));
      const barLength = 20;
      const progressBar = '🟦'.repeat(Math.round(progress * barLength)) +
        '⬛'.repeat(barLength - Math.round(progress * barLength));
      let types = [];
      if (buddy.types) {
        try {
          types = JSON.parse(buddy.types);
        } catch (error) {
          console.error(`Could not parse types for buddy form ${buddy.pokemon_id}:`, error);
        }
      }
      const typeLabel = types.length
        ? types.map((type) => `${getTypeEmoji(type)} ${type[0].toUpperCase() + type.slice(1)}`).join(' / ')
        : 'Unknown';
      const expProgress = level >= 100
        ? 'MAX LEVEL'
        : `${(nextLevelAt - buddy.experience).toLocaleString()} EXP to Level ${level + 1}`;
      const expShareEnabled = Boolean(getUser(userId).team_exp_share);
      const ivStars = (iv) => {
        const filled = iv === 0 ? 0 : iv <= 15 ? 1 : iv <= 30 ? 2 : 3;
        return '⭐'.repeat(filled) + '☆'.repeat(3 - filled) + (iv === 31 ? ' 🎉' : '');
      };
      const ivValue = (iv) => getPatreonPerks(userId).ivChecker
        ? `${ivStars(iv)} **${iv}**`
        : ivStars(iv);
      const buddyExpBar = '🟦'.repeat(Math.round(progress * 10)) + '⬛'.repeat(10 - Math.round(progress * 10));
      const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle(`${getRarityEmojis(buddy.rarity, buddy.name, Boolean(buddy.is_shiny))} ${message.author.username}'s ${buddy.display_name || buddy.name}`)
        .setDescription(
          `**Level:** ${level}\n` +
          `**Held Item:** ${buddy.held_item || 'None'}\n` +
          `**Friendship:** 💖 ${buddy.friendship ?? 0}/255\n\n` +
          `**Type**\n${typeLabel}\n\n` +
          `**${expProgress}**\n${buddyExpBar}\n\n` +
          `**Pokémon IVs**\n` +
          `\`ATK\` ${ivValue(buddy.atk_iv)}  \`DEF\` ${ivValue(buddy.def_iv)}\n` +
          `\`HP\` ${ivValue(buddy.hp_iv)}  \`SPE\` ${ivValue(buddy.spd_iv)}\n\n` +
          `**Pokémon Stats**\n` +
          `⚔️ \`Atk\` **${buddy.atk}**  🛡️ \`Def\` **${buddy.def}**\n` +
          `❤️ \`HP\` **${buddy.max_hp}**  ⚡ \`Spe\` **${buddy.spd}**`
        )
        .setFooter({
          text: `${buddy.display_name || buddy.name} Level: ${level} • Total EXP: ${buddy.experience.toLocaleString()}` +
            (expShareEnabled ? ' • Exp. Share enabled' : ''),
        });
      const buddyImage = buddy.is_golden
        ? getGoldenSpriteUrl(buddy.species_id, buddy.slug)
        : getPokemonShowdownSprite(
          buddy.slug,
          Boolean(buddy.is_shiny),
          null
        ) || (buddy.is_shiny ? (buddy.shiny_sprite || buddy.sprite) : buddy.sprite);
      if (buddyImage) embed.setImage(buddyImage);
      const movesButtonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('buddy:view-moves')
          .setLabel('View Moves')
          .setEmoji('📖')
          .setStyle(ButtonStyle.Primary)
      );
      const buddyMessage = await message.reply({
        embeds: [embed],
        components: [movesButtonRow],
      });
      const collector = buddyMessage.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 120_000,
      });
      collector.on('collect', async (interaction) => {
        if (interaction.user.id !== userId) {
          await interaction.reply({
            content: 'Only the trainer who viewed this buddy can use its buttons.',
            ephemeral: true,
          });
          return;
        }
        try {
          await interaction.deferReply({ ephemeral: true });
          const activeBuddy = getUserBuddy(userId);
          if (!activeBuddy || activeBuddy.id !== buddy.id) {
            await interaction.editReply('Your buddy has changed. Run `.buddy` again to view its moves.');
            return;
          }
          const learnsetData = getPokemonLearnset(activeBuddy.id, userId);
          if (!learnsetData) {
            await interaction.editReply('Your current buddy could not be found in your box.');
            return;
          }
          let equippedMoves;
          try {
            equippedMoves = JSON.parse(learnsetData.pokemon.moves || '[]');
          } catch (error) {
            console.error(`Could not parse move set for buddy catch ${activeBuddy.id}:`, error);
            await interaction.editReply('Your buddy’s move set could not be read. Please contact a bot admin.');
            return;
          }
          for (const move of learnsetData.moves) {
            if (equippedMoves.length >= 4) break;
            if (!equippedMoves.includes(move)) equippedMoves.push(move);
          }
          const totalPages = Math.max(1, Math.ceil(learnsetData.moves.length / MOVES_PER_PAGE));
          let page = 0;
          const buildPayload = (disabled = false) => ({
            embeds: [createBuddyMovesEmbed(
              activeBuddy, learnsetData, equippedMoves, page, getBuddyMoveChangeCost(userId)
            )],
            components: totalPages > 1 ? [new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('mvp_prev').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(disabled || page === 0),
              new ButtonBuilder().setCustomId('mvp_next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(disabled || page >= totalPages - 1)
            )] : [],
          });
          const movesReply = await interaction.editReply(buildPayload());
          if (totalPages > 1) {
            const pager = movesReply.createMessageComponentCollector({ componentType: ComponentType.Button, time: 120_000 });
            pager.on('collect', async (pageInteraction) => {
              page = Math.min(totalPages - 1, Math.max(0, page + (pageInteraction.customId === 'mvp_next' ? 1 : -1)));
              await pageInteraction.update(buildPayload());
            });
            pager.on('end', () => interaction.editReply(buildPayload(true)).catch(() => {}));
          }
        } catch (error) {
          console.error(`Failed to show buddy moves for user ${userId}:`, error);
          if (interaction.deferred || interaction.replied) {
            await interaction.editReply('Could not load your buddy’s moves. Please try `.moves`.');
          } else {
            await interaction.reply({
              content: 'Could not load your buddy’s moves. Please try `.moves`.',
              ephemeral: true,
            });
          }
        }
      });
      collector.on('end', async () => {
        try {
          await buddyMessage.edit({
            components: [new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId('buddy:view-moves:expired')
                .setLabel('View Moves')
                .setEmoji('📖')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(true)
            )],
          });
        } catch (error) {
          console.error(`Failed to disable buddy moves button for user ${userId}:`, error);
        }
      });
      return;
    }

    if ((command === 'moves' || command === 'move') && args[0]?.toLowerCase() === 'info') {
      const query = args.slice(1).join(' ').trim();
      if (!query) return message.reply(`Usage: \`${PREFIX}move info <move name>\`.`);
      const move = findMoveInfo(query);
      if (!move) return message.reply(`❌ No move named **${query}** was found.`);
      const learnersPerPage = 15;
      const totalPages = Math.max(1, Math.ceil(move.learners.length / learnersPerPage));
      let currentPage = 1;
      const buildMoveEmbed = (page) => {
        const learners = move.learners
          .slice((page - 1) * learnersPerPage, page * learnersPerPage)
          .map((name) => `👾 ${name}`)
          .join(' ');
        return new EmbedBuilder()
          .setColor(0x0099ff)
          .setTitle(`💥 ${move.name}`)
          .setDescription(
            `${move.description || 'No description available.'}\n\n` +
            `✏️ **Learned by**\n${learners || '*No Pokémon learn this move.*'}`
          )
          .addFields(
            { name: 'Type', value: `${getTypeEmoji(move.type)} ${move.type}`, inline: true },
            { name: '🔋 Power', value: move.power ? `${move.power}` : '—', inline: true },
            { name: '💯 Accuracy', value: move.accuracy ? `${move.accuracy}` : '—', inline: true },
            { name: 'Priority', value: `${move.priority}`, inline: true },
            { name: 'Damage class', value: `🔘 ${move.damageClass}`, inline: true },
            { name: 'PP', value: `${move.pp}`, inline: true }
          )
          .setFooter({
            text: `Page ${page} / ${totalPages} • To buy new moves for your buddy, type ${PREFIX}moves`,
          });
      };
      const buildButtons = (page) => new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('moveinfo:prev').setLabel('Back')
          .setStyle(ButtonStyle.Primary).setDisabled(page === 1),
        new ButtonBuilder().setCustomId('moveinfo:next').setLabel('Next')
          .setStyle(ButtonStyle.Primary).setDisabled(page === totalPages)
      );
      const moveMessage = await message.reply({
        embeds: [buildMoveEmbed(currentPage)],
        components: totalPages > 1 ? [buildButtons(currentPage)] : [],
      });
      if (totalPages > 1) {
        const collector = moveMessage.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 60000,
        });
        collector.on('collect', async (interaction) => {
          try {
            if (interaction.user.id !== message.author.id) {
              await interaction.reply({
                content: `Use \`${PREFIX}move info\` to inspect moves yourself.`,
                ephemeral: true,
              });
              return;
            }
            currentPage = interaction.customId === 'moveinfo:prev'
              ? Math.max(1, currentPage - 1)
              : Math.min(totalPages, currentPage + 1);
            await interaction.update({
              embeds: [buildMoveEmbed(currentPage)],
              components: [buildButtons(currentPage)],
            });
          } catch (error) {
            console.error(`Failed to page move info for user ${message.author.id}:`, error);
          }
        });
        collector.on('end', () => {
          moveMessage.edit({ components: [] }).catch(() => {});
        });
      }
      return;
    }

    if (command === 'faction' || command === 'fac') {
      const ballFor = (factionKey) => {
        const ball = getDailyBall(factionKey);
        return { ...ball, emoji: BALL_CONFIG[ball.key]?.emoji || '' };
      };
      const earnInfo = (joined, ball) =>
        `**Earn faction points from:**\n` +
        `• 🎯 Catching using your daily ball\n` +
        `• ⚔️ Battling NPCs and faction members\n\n` +
        `🪧 **Ranking info**\n` +
        `• Ranking up requires faction points, which are **automatically removed from your balance** when you rank up.\n` +
        `• To rank up, type \`${PREFIX}faction\` once you have met the next rank's point requirement.` +
        (joined ? '' : '\n• Example: at 500,000 points you rank up from Recruit to Grunt and 500,000 points are taken.');

      const existing = getUserFaction(userId);
      if (args[0]?.toLowerCase() === 'npc') {
        if (args[1]?.toLowerCase() !== 'list' || args.length > 2) {
          return message.reply(`Usage: \`${PREFIX}faction npc list\`.`);
        }
        return message.reply({
          embeds: [new EmbedBuilder()
            .setColor(0x9b59b6)
            .setTitle('⚔️ Faction NPCs')
            .setDescription(
              FACTION_NPC_BATTLES.map((challenge) => {
                const trainerKey = challenge.name.split('\u2014').pop().trim().toLowerCase().replace(/[^a-z0-9]/g, '');
                const iconEmoji = NPC_TRAINER_ICON_EMOJIS[trainerKey] || challenge.iconEmoji || '';
                return `• ${iconEmoji} **${challenge.name}**`.trim();
              }).join('\n') +
              `\n\nChallenge one with \`${PREFIX}faction battle <leader name|faction name>\`.`
            )],
        });
      }
      if (args[0]?.toLowerCase() === 'battle') {
        if (!existing) {
          return message.reply(`Join a faction with \`${PREFIX}faction\` before challenging its NPCs.`);
        }
        const query = args.slice(1).join(' ').trim().toLowerCase();
        if (!query) {
          return message.reply({
            embeds: [new EmbedBuilder()
              .setColor(0x9b59b6)
              .setTitle('⚔️ Faction NPC Battles')
              .setDescription(
                FACTION_NPC_BATTLES.map((challenge, index) =>
                  `**${index + 1}. ${challenge.name}** — ${challenge.strengthMultiplier}× opponent stats`
                ).join('\n') +
                `\n\nFaction NPCs have a **1/1,000** chance to drop their battle icon.\n` +
                `Challenge one with \`${PREFIX}faction battle <leader name|faction name>\`.`
              )],
          });
        }
        const matches = FACTION_NPC_BATTLES.filter((challenge) =>
          challenge.name.toLowerCase().includes(query)
          || challenge.name.split('\u2014').pop().trim().toLowerCase().includes(query)
          || FACTION_TEAMS[challenge.factionKey].name.toLowerCase().includes(query)
        );
        const exact = matches.find((challenge) =>
          challenge.name.toLowerCase() === query
          || challenge.name.split('\u2014').pop().trim().toLowerCase() === query
          || FACTION_TEAMS[challenge.factionKey].name.toLowerCase() === query
        );
        const challenge = exact || (matches.length === 1 ? matches[0] : null);
        if (!challenge) {
          return message.reply(
            matches.length
              ? `That faction matches multiple NPCs. Specify a leader name, such as \`${PREFIX}faction battle Giovanni\`.`
              : `No faction NPC matches **${query}**. Use \`${PREFIX}faction battle\` to see the challengers.`
          );
        }
        return startLeagueChallengeWithCooldown(
          message,
          userId,
          0,
          [challenge]
        );
      }
      if (existing) {
        const promotions = promoteFaction(userId);
        const faction = getUserFaction(userId);
        const rankInfo = FACTION_RANKS[faction.rank];
        const team = faction.team;
        const dailyBall = ballFor(faction.faction_key);
        const ballEmoji = dailyBall.emoji;
        const promoted = promotions.map((p) =>
          `🎉 **PROMOTION!** You ranked up from **${p.from}** to **${p.to}**! \`${p.cost.toLocaleString()}\` points were consumed.`
        ).join('\n');
        const rankIcons = FACTION_RANK_ICONS;
        const progress = rankInfo.next
          ? `Next rank: ${rankIcons[rankInfo.next] || ''} ${rankInfo.next}\nProgress: ${team.emoji} ${faction.points.toLocaleString()} / ${rankInfo.cost.toLocaleString()} points`
          : 'MAX RANK ACHIEVED (Leader)';
        const leaders = getFactionLeaders(faction.faction_key);
        const nameCache = new Map();
        const nameOf = async (id) => {
          if (!nameCache.has(id)) {
            nameCache.set(id, (await client.users.fetch(id).catch(() => null))?.username || 'Unknown trainer');
          }
          return nameCache.get(id);
        };
        const leaderFields = [];
        for (const [rankName, info] of Object.entries(leaders.byRank)) {
          const lines = [];
          for (const entry of info.top) {
            lines.push(`**${await nameOf(entry.userId)}**\n${entry.points.toLocaleString()} points`);
          }
          leaderFields.push({
            name: `${rankIcons[rankName] || ''} ${rankName} (${info.count.toLocaleString()})`,
            value: lines.length ? lines.join('\n\n') : '*No members*',
            inline: true,
          });
        }
        const embed = new EmbedBuilder()
          .setColor(0x9b59b6)
          .setAuthor({
            name: `${team.name} — Headquarters`,
            iconURL: `https://cdn.discordapp.com/emojis/${team.emojiId}.png`,
          })
          .setThumbnail(`https://cdn.discordapp.com/emojis/${team.emojiId}.png`)
          .setDescription(
            (promoted ? `${promoted}\n\n` : '') +
            `Member: ${getTrainerIconEmoji(userId)} ${message.author.username}\n` +
            `Rank: ${rankIcons[faction.rank] || ''} ${faction.rank} (${rankInfo.mult}x points)\n` +
            `Points: ${team.emoji} ${faction.points.toLocaleString()}\n\n` +
            `${progress}\n\n` +
            `**${team.name} Information**\n` +
            `• **NPCs:** ${team.npcs || team.officers}\n` +
            `• **Favorite Pokémon:** ${team.favoritePokemon}\n` +
            `• **Goals:** *${team.goals}*\n\n` +
            `🎯 **Today's Daily Ball:** ${ballEmoji} **${dailyBall.name}**\n` +
            `*Catch Pokémon using ${ballEmoji} ${dailyBall.name} to earn bonus Faction Points — higher rarities earn more!*\n\n` +
            earnInfo(true, dailyBall) +
            `\n\n🏆 **Point Leaders**`
          )
          .addFields(leaderFields)
          .setFooter({ text: `${team.name} has ${leaders.memberCount.toLocaleString()} members` });
        return message.reply({ embeds: [embed] });
      }

      const teams = Object.values(FACTION_TEAMS);
      const buildEmbed = (team = null) => new EmbedBuilder()
        .setColor(team ? 0x9b59b6 : 0xed4245)
        .setAuthor({ name: team ? `Factions — ${team.name}` : 'Factions — Join a Team!', iconURL: client.user.displayAvatarURL() })
        .setDescription(
          (team
            ? `${team.emoji} **${team.name}**\n• **NPCs:** ${team.npcs || team.officers}\n• **Favorite Pokémon:** ${team.favoritePokemon}\n• **Goals:** *${team.goals}*\n\nPress **Join** to pledge to this team, or pick another.`
            : `❌ **You are not in a faction!**\n\n` +
              `Factions are differentiated by their:\n• Officers (Grunt, Captain, Admin, Commander and Leader)\n• Favorite Pokémon\n• Overall goals\n\n` +
              `View a team's information by clicking its button below.\n\n`) +
          `\n🎯 **Daily Ball:** ${team
            ? `${ballFor(team.id).emoji} **${ballFor(team.id).name}** *(${team.name}'s ball today)*`
            : 'Each faction has its own randomised daily ball — select a team to see it.'}\n\n` +
          earnInfo(false, team ? ballFor(team.id) : ballFor(''))
        )
        .setFooter({ text: 'Join a faction and rank up for rewards!' });
      const buildRows = (selected = null) => {
        const buttons = teams.map((team) => new ButtonBuilder()
          .setCustomId(`faction:view:${team.id}`)
          .setLabel(team.name)
          .setStyle(selected === team.id ? ButtonStyle.Success : ButtonStyle.Secondary)
          .setEmoji({ id: team.emojiId, name: team.emojiName }));
        const rows = [
          new ActionRowBuilder().addComponents(buttons.slice(0, 5)),
          new ActionRowBuilder().addComponents(buttons.slice(5)),
        ];
        if (selected) {
          rows[1].addComponents(
            new ButtonBuilder().setCustomId(`faction:join:${selected}`).setLabel('Join').setStyle(ButtonStyle.Primary)
          );
        }
        return rows;
      };

      const promptMsg = await message.reply({ embeds: [buildEmbed()], components: buildRows() });
      const factionCollector = promptMsg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 120000,
      });
      factionCollector.on('collect', async (interaction) => {
        if (interaction.user.id !== message.author.id) {
          return interaction.reply({ content: `Use \`${PREFIX}faction\` yourself to choose a team.`, ephemeral: true });
        }
        const [, action, teamKey] = interaction.customId.split(':');
        const chosen = FACTION_TEAMS[teamKey];
        if (!chosen) return interaction.deferUpdate();
        if (action === 'view') {
          return interaction.update({ embeds: [buildEmbed(chosen)], components: buildRows(teamKey) });
        }
        if (!joinFaction(interaction.user.id, teamKey)) {
          factionCollector.stop('joined');
          return interaction.update({ content: '❌ You are already in a faction.', embeds: [], components: [] });
        }
        factionCollector.stop('joined');
        const joinedBall = ballFor(teamKey);
        return interaction.update({
          content: `🎉 <@${interaction.user.id}> has pledged allegiance to ${chosen.emoji} **${chosen.name}**!\n` +
            `Catch Pokémon with today's ball (${joinedBall.emoji} **${joinedBall.name}**) to earn points for your faction!`,
          embeds: [],
          components: [],
        });
      });
      factionCollector.on('end', (_, reason) => {
        if (reason !== 'joined') promptMsg.edit({ components: [] }).catch(() => {});
      });
      return;
    }

    if (command === 'grazz' || command === 'graze') {
      const amount = args[0] === undefined ? 1 : Number(args[0]);
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        return message.reply(`Usage: \`${PREFIX}grazz {amt}\``);
      }
      const owned = getUser(userId).grazz_berries;
      if (owned < amount) {
        return message.reply(
          `❌ You don't have enough Golden Razz Berries! You currently own **${owned}x**.`
        );
      }
      incrementUser(userId, {
        grazz_berries: -amount,
        grazz_buff_encounters: amount * GRAZZ_ENCOUNTERS_PER_BERRY,
        golden_razz_used: amount,
      });
      const remaining = getUser(userId).grazz_buff_encounters;
      return message.reply(
        `${EMOJIS.goldenRazz} Activated **${amount}x Golden Razz Berry**! Your next **${remaining}** ` +
        `\`${PREFIX}p\` encounters have a boosted chance of finding ${EMOJIS.legendary} **Legendary** Pokémon!`
      );
    }

    if ((command === 'item' || command === 'i') && args[0]?.toLowerCase() === 'info'
        && /grazz|golden razz/.test(args.slice(1).join(' ').toLowerCase())) {
      const user = getUser(userId);
      return message.reply({
        embeds: [new EmbedBuilder()
          .setColor(0x0099ff)
          .setAuthor({ name: 'Golden razz berry — Item information' })
          .setDescription(
            `Increases the rate at which you encounter ${EMOJIS.legendary} **L** Pokémon using \`${PREFIX}pokemon\`\n\n` +
            `**You currently own:** ${EMOJIS.goldenRazz} **${user.grazz_berries}x Golden razz berry**\n` +
            `**Active boost:** **${user.grazz_buff_encounters}** encounters remaining\n\n` +
            `**Usage**\nTo use grazz, type \`${PREFIX}grazz {amt}\`. Lasts for ${GRAZZ_ENCOUNTERS_PER_BERRY} encounters.\n\n` +
            '**Method to obtain**\n• Quests\n• Lootboxes, vote streaks and events'
          )
          .setFooter({ text: `Item info: ${PREFIX}item info <item>` })],
      });
    }

    if (command === 'moves' || command === 'move') {
      const buddy = getUserBuddy(userId);
      if (!buddy) return message.reply(`Choose a buddy first with \`${PREFIX}buddy set [shiny] <form name|dex>\`.`);
      const learnsetData = getPokemonLearnset(buddy.id, userId);
      if (!learnsetData) return message.reply('Your current buddy could not be found in your box.');
      const availableMoveSlots = Math.min(4, learnsetData.moves.length);
      let equippedMoves;
      try {
        equippedMoves = JSON.parse(learnsetData.pokemon.moves || '[]');
      } catch (error) {
        console.error(`Could not parse move set for buddy catch ${buddy.id}:`, error);
        return message.reply('Your buddy’s move set could not be read. Please contact a bot admin.');
      }
      for (const move of learnsetData.moves) {
        if (equippedMoves.length >= 4) break;
        if (!equippedMoves.includes(move)) equippedMoves.push(move);
      }
      const subcommand = args[0]?.toLowerCase();
      if (subcommand === 'set') {
        const slot = Number(args[1]);
        const moveName = args.slice(2).join(' ').trim();
        if (!availableMoveSlots) {
          return message.reply('Your buddy has no damaging moves available to change.');
        }
        if (!Number.isSafeInteger(slot) || slot < 1 || slot > availableMoveSlots || !moveName) {
          return message.reply(
            `Usage: \`${PREFIX}moves set <slot 1-${availableMoveSlots}> <move name>\` ` +
            `(cost: ${EMOJIS.pokecoin} **${getBuddyMoveChangeCost(userId).toLocaleString()}**).`
          );
        }
        const result = setBuddyMoveSlot(userId, slot, moveName);
        if (result.error === 'no_buddy') return message.reply('Choose a buddy before changing its moves.');
        if (result.error === 'invalid_slot') {
          return message.reply(`This buddy has ${result.slotCount} move slot${result.slotCount === 1 ? '' : 's'} available.`);
        }
        if (result.error === 'duplicate_move') {
          return message.reply('That move is already equipped in another slot.');
        }
        if (result.error === 'unchanged') {
          return message.reply(`**${buddy.name}** already has that move in slot ${slot}.`);
        }
        if (result.error === 'insufficient_coins') {
          return message.reply(
            `❌ Changing a move costs ${EMOJIS.pokecoin} **${result.cost.toLocaleString()}**. ` +
            `You have **${result.coins.toLocaleString()}** PokéCoins.`
          );
        }
        if (result.error === 'not_learned') {
          return message.reply(
            `Your buddy cannot learn **${moveName}**. Check \`${PREFIX}moves\` for its learnset.`
          );
        }
        const changedMove = getPokemonMove(result.moves[slot - 1]);
        return message.reply(
          `✅ **${buddy.name}** learned **${changedMove.name}** in move slot ${slot} ` +
          `for ${EMOJIS.pokecoin} **${result.cost.toLocaleString()} PokéCoins**.`
        );
      }
      if (subcommand === 'replace') {
        let slot;
        let moveName;
        if (/^\d+$/.test(args[1] || '')) {
          slot = Number(args[1]);
          moveName = args.slice(2).join(' ').trim();
        } else {
          const normalizeMoveName = (name) =>
            name.toLowerCase().trim().replace(/[\s_]+/g, '-');
          for (let end = args.length - 1; end > 1; end -= 1) {
            const target = normalizeMoveName(args.slice(1, end).join(' '));
            const equippedIndex = equippedMoves.findIndex((move) =>
              normalizeMoveName(move) === target
            );
            if (equippedIndex >= 0) {
              slot = equippedIndex + 1;
              moveName = args.slice(end).join(' ').trim();
              break;
            }
          }
        }
        if (!availableMoveSlots) {
          return message.reply('Your buddy has no damaging moves available to change.');
        }
        if (!slot || slot > availableMoveSlots || !moveName) {
          return message.reply(
            `Usage: \`${PREFIX}move replace <equipped move name|slot 1-${availableMoveSlots}> <new move name>\` ` +
            `(cost: ${EMOJIS.pokecoin} **${getBuddyMoveChangeCost(userId).toLocaleString()}**).`
          );
        }
        const result = setBuddyMoveSlot(userId, slot, moveName);
        if (result.error === 'no_buddy') return message.reply('Choose a buddy before changing its moves.');
        if (result.error === 'invalid_slot') {
          return message.reply(`This buddy has ${result.slotCount} move slot${result.slotCount === 1 ? '' : 's'} available.`);
        }
        if (result.error === 'duplicate_move') {
          return message.reply('That move is already equipped in another slot.');
        }
        if (result.error === 'unchanged') {
          return message.reply(`**${buddy.name}** already has that move in slot ${slot}.`);
        }
        if (result.error === 'insufficient_coins') {
          return message.reply(
            `❌ Changing a move costs ${EMOJIS.pokecoin} **${result.cost.toLocaleString()}**. ` +
            `You have **${result.coins.toLocaleString()}** PokéCoins.`
          );
        }
        if (result.error === 'not_learned') {
          return message.reply(
            `Your buddy cannot learn **${moveName}**. Check \`${PREFIX}moves\` for its learnset.`
          );
        }
        const changedMove = getPokemonMove(result.moves[slot - 1]);
        return message.reply(
          `✅ **${buddy.name}** replaced its move in slot ${slot} with **${changedMove.name}** ` +
          `for ${EMOJIS.pokecoin} **${result.cost.toLocaleString()} PokéCoins**.`
        );
      }
      if (subcommand === 'swap') {
        if (!availableMoveSlots) {
          return message.reply('Your buddy has no move slots available to swap.');
        }
        const firstSlot = Number(args[1]);
        const secondSlot = Number(args[2]);
        if (args.length !== 3
            || !Number.isSafeInteger(firstSlot)
            || !Number.isSafeInteger(secondSlot)
            || firstSlot < 1 || firstSlot > availableMoveSlots
            || secondSlot < 1 || secondSlot > availableMoveSlots) {
          return message.reply(
            `Usage: \`${PREFIX}move swap <slot 1-${availableMoveSlots}> <slot 1-${availableMoveSlots}>\`.`
          );
        }
        const result = swapBuddyMoveSlots(userId, firstSlot, secondSlot);
        if (result.error === 'no_buddy') return message.reply('Choose a buddy before swapping its moves.');
        if (result.error === 'invalid_slot') {
          return message.reply(`This buddy has ${result.slotCount} move slot${result.slotCount === 1 ? '' : 's'} available.`);
        }
        if (result.error === 'unchanged') {
          return message.reply('Choose two different move slots to swap.');
        }
        return message.reply(
          `✅ **${buddy.name}** swapped move slots ${firstSlot} and ${secondSlot}: ` +
          `**${getPokemonMove(result.moves[firstSlot - 1]).name}** / ` +
          `**${getPokemonMove(result.moves[secondSlot - 1]).name}**.`
        );
      }
      if (args.length) {
        return message.reply(
          availableMoveSlots
            ? `Usage: \`${PREFIX}move\`, \`${PREFIX}move replace <move name|slot> <new move>\`, ` +
              `\`${PREFIX}move swap <slot> <slot>\`, or \`${PREFIX}moves set <slot 1-${availableMoveSlots}> <move name>\`.`
            : `Usage: \`${PREFIX}moves\`. This buddy has no damaging moves available to change.`
        );
      }
      const totalPages = Math.max(1, Math.ceil(learnsetData.moves.length / MOVES_PER_PAGE));
      let page = 0;
      const buildMovesPayload = (disabled = false) => ({
        embeds: [createBuddyMovesEmbed(
          buddy, learnsetData, equippedMoves, page, getBuddyMoveChangeCost(userId)
        )],
        components: totalPages > 1 ? [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('mv_prev').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(disabled || page === 0),
          new ButtonBuilder().setCustomId('mv_next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(disabled || page >= totalPages - 1)
        )] : [],
      });
      const movesMessage = await message.reply(buildMovesPayload());
      if (totalPages > 1) {
        const collector = movesMessage.createMessageComponentCollector({ time: 120000 });
        collector.on('collect', async (interaction) => {
          if (interaction.user.id !== userId) {
            return interaction.reply({ content: 'This is not your move list.', ephemeral: true });
          }
          page = Math.min(totalPages - 1, Math.max(0, page + (interaction.customId === 'mv_next' ? 1 : -1)));
          await interaction.update(buildMovesPayload());
        });
        collector.on('end', () => movesMessage.edit(buildMovesPayload(true)).catch(() => {}));
      }
      return;
    }

    if (command === 'gym' && (!args.length || resolveLeagueRegion(args[0]) !== undefined)) {
      return sendLeagueHub(message, userId, 'gym', resolveLeagueRegion(args[0]));
    }

    if (command === 'elitefour' || command === 'e4') {
      const region = resolveLeagueRegion(args[0]);
      if (region === undefined) return message.reply(`Usage: \`${PREFIX}elitefour [region]\`.`);
      return sendLeagueHub(message, userId, 'e4', region);
    }

    if (command === 'champion' || command === 'champions') {
      const region = resolveLeagueRegion(args[0]);
      if (region === undefined) return message.reply(`Usage: \`${PREFIX}champion [region]\`.`);
      return sendLeagueHub(message, userId, 'champion', region);
    }

    if (command === 'gym' || command === 'league') {
      const progress = getLeagueProgress(userId);
      if (args[0]?.toLowerCase() === 'status' || command === 'league') {
        const challenges = command === 'league' ? NPC_CAMPAIGN : KANTO_LEAGUE;
        const cleared = Math.min(progress.cleared_challenges, challenges.length);
        const next = challenges[cleared];
        return message.reply({
          embeds: [makeEmbed(
            command === 'league' ? '🏆 Regional NPC Campaign' : '🏆 Kanto Gym Challenge',
            `**Progress:** ${cleared}/${challenges.length} challenges cleared\n` +
            (next
              ? `**Next:** ${next.name}\n**Reward:** ${EMOJIS.pokecoin} ${next.reward.toLocaleString()} PokéCoins\n\n` +
                `Use \`${PREFIX}battle npc ${cleared + 1}\` to battle.`
              : command === 'league'
                ? '**You have cleared every regional Gym, Trial, Elite Four, and Champion challenge!**'
                : '**You are the Kanto Champion!** All gyms and the Elite Four have been defeated.'),
            0xf1c40f
          )],
        });
      }
      if (args.length) return message.reply(`Usage: \`${PREFIX}gym\`, \`${PREFIX}gym status\` or \`${PREFIX}league\`.`);
      return message.reply(`Use \`${PREFIX}battle npc <number>\` to challenge a trainer.`);
    }

    // Set to true to bring `.explore` back.
    const EXPLORE_ENABLED = false;
    if (EXPLORE_ENABLED && (command === 'explore' || command === 'exp')) {
      const { MAP_THEMES, MAP_WIDTH, MAP_HEIGHT, TRAINER_WIDTH, TRAINER_HEIGHT, renderExploreMap } = require('./exploreRenderer');
      const DAILY_STEP_LIMIT = 500;
      const PATREON_STEP_LIMIT = 1000;
      const SEARCH_FIND_CHANCE = 0.4;
      const SEARCH_LOOT = [
        { field: 'coins', label: 'PokéCoins', min: 500, max: 5000 },
        { field: 'pokeballs', label: 'Poké Balls', min: 3, max: 10 },
        { field: 'greatballs', label: 'Great Balls', min: 2, max: 6 },
        { field: 'ultraballs', label: 'Ultra Balls', min: 1, max: 3 },
        { field: 'rare_candies', label: 'Rare Candies', min: 1, max: 2 },
        { field: 'repels', label: 'Repels', min: 1, max: 1 },
      ];
      const STEP = 32;
      const mapKey = args[0]?.toLowerCase() || 'grass';
      if (!MAP_THEMES[mapKey]) {
        return message.reply(`Usage: \`${PREFIX}explore [${Object.keys(MAP_THEMES).join('|')}]\``);
      }
      const theme = MAP_THEMES[mapKey];
      const backgroundIndex = Math.floor(Math.random() * theme.images.length);
      const backgroundUrl = theme.images[backgroundIndex];
      const mapTitle = `${theme.name} ${backgroundIndex + 1}`;
      const readSteps = () => {
        const current = getUser(userId);
        if (Date.now() - (current.last_explore_reset || 0) >= 24 * 60 * 60 * 1000) {
          updateUser(userId, { explore_steps_today: 0, last_explore_reset: Date.now() });
          return 0;
        }
        return current.explore_steps_today || 0;
      };
      let x = Math.floor((MAP_WIDTH - TRAINER_WIDTH) / 2);
      let y = 130;
      const EXPLORE_ENCOUNTER_CHANCE = 0.6;
      let encounterBusyUntil = 0;
      let activeWild = null;
      const trainerUrl = getTrainerIconUrl(userId);
      let catchHandler = null;
      const moveButton = (id, emoji, disabled) =>
        new ButtonBuilder().setCustomId(id).setEmoji(emoji).setStyle(ButtonStyle.Primary).setDisabled(disabled);
      const ballButton = (key, disabled) =>
        new ButtonBuilder().setCustomId(`exp_ball:${key}`).setEmoji(BALL_CONFIG[key].buttonEmoji)
          .setStyle(ButtonStyle.Secondary).setDisabled(disabled);
      const buildRows = (disabled) => [
        new ActionRowBuilder().addComponents(
          moveButton('exp_nw', '↖️', disabled), moveButton('exp_up', '⬆️', disabled), moveButton('exp_ne', '↗️', disabled),
          ballButton('pb', false), ballButton('prb', false)
        ),
        new ActionRowBuilder().addComponents(
          moveButton('exp_left', '⬅️', disabled), moveButton('exp_search', '🔍', disabled), moveButton('exp_right', '➡️', disabled),
          ballButton('gb', false), ballButton('mb', false)
        ),
        new ActionRowBuilder().addComponents(
          moveButton('exp_sw', '↙️', disabled), moveButton('exp_down', '⬇️', disabled), moveButton('exp_se', '↘️', disabled),
          ballButton('ub', false),
          new ButtonBuilder().setCustomId('exp_run').setEmoji('🏃').setStyle(ButtonStyle.Secondary)
        ),
      ];
      let statusText = '';
      const buildPayload = async (steps) => {
        const limit = getUser(userId).has_patreon ? PATREON_STEP_LIMIT : DAILY_STEP_LIMIT;
        return {
          content: `${theme.emoji} **${mapTitle}** — steps today: **${steps}/${limit}**${statusText}`,
          files: [new AttachmentBuilder(await renderExploreMap(mapKey, x, y, null, trainerUrl, backgroundUrl), { name: 'explore.png' })],
          components: buildRows(steps >= limit),
        };
      };
      const startSteps = readSteps();
      const exploreMsg = await message.reply(await buildPayload(startSteps));
      const collector = exploreMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 180000 });
      const MOVES = {
        exp_up: [0, -1], exp_down: [0, 1], exp_left: [-1, 0], exp_right: [1, 0],
        exp_nw: [-1, -1], exp_ne: [1, -1], exp_sw: [-1, 1], exp_se: [1, 1], exp_search: [0, 0],
      };
      collector.on('collect', async (interaction) => {
        if (interaction.user.id !== message.author.id) {
          return interaction.reply({ content: `Use \`${PREFIX}explore\` to start your own adventure.`, ephemeral: true });
        }
        if (interaction.customId === 'exp_run') {
          await interaction.deferUpdate();
          collector.stop('run');
          return;
        }
        if (interaction.customId.startsWith('exp_ball:')) {
          if (!catchHandler || Date.now() >= encounterBusyUntil) {
            return interaction.reply({ content: 'There is no wild Pokémon to catch right now. Keep exploring!', ephemeral: true });
          }
          return catchHandler(interaction);
        }
        const move = MOVES[interaction.customId];
        if (!move) return interaction.deferUpdate();
        const isSearch = interaction.customId === 'exp_search';
        const limit = getUser(userId).has_patreon ? PATREON_STEP_LIMIT : DAILY_STEP_LIMIT;
        const steps = readSteps();
        if (steps >= limit) {
          return interaction.reply({
            content: `You have used all of your exploring steps for today (${limit}).` +
              (limit === DAILY_STEP_LIMIT ? ' Patreon supporters get more steps.' : ''),
            ephemeral: true,
          });
        }
        x = Math.max(0, Math.min(MAP_WIDTH - TRAINER_WIDTH, x + move[0] * STEP));
        y = Math.max(0, Math.min(MAP_HEIGHT - TRAINER_HEIGHT, y + move[1] * STEP));
        updateUser(userId, { explore_steps_today: steps + 1 });
        await interaction.deferUpdate();
        let wild = null;
        let foundText = '';
        if (isSearch) {
          if (Math.random() < SEARCH_FIND_CHANCE) {
            const found = SEARCH_LOOT[Math.floor(Math.random() * SEARCH_LOOT.length)];
            const qty = found.min + Math.floor(Math.random() * (found.max - found.min + 1));
            incrementUser(userId, { [found.field]: qty });
            foundText = `\n🔍 You found **${qty.toLocaleString()}x ${found.label}** on the floor!`;
          } else {
            foundText = '\n🔍 You searched the ground but found nothing.';
          }
        } else if (!catchHandler && Math.random() < EXPLORE_ENCOUNTER_CHANCE) {
          wild = rollExploreEncounter(userId, mapKey);
          encounterBusyUntil = Date.now() + 25000;
        }
        activeWild = wild || (catchHandler ? activeWild : null);
        if (wild) {
          const wildRarity = getDisplayRarity(wild.rarity, wild.name, wild.isShiny);
          statusText = `\n❗ A wild ${wild.isShiny ? '✨ ' : ''}**${wild.name}** appeared! ` +
            `(${getRarityEmojis(wildRarity)} ${wildRarity}) — throw a ball with the buttons on the right.`;
        } else if (!catchHandler) {
          statusText = foundText;
        }
        await exploreMsg.edit(await buildPayload(steps + 1));
        if (wild) {
          try {
            await askForBall(message, userId, wild, 'catch', {
              guaranteedCatch: false,
              timeoutMs: 45000,
              onHandler: (handler) => { catchHandler = handler; },
              inline: {
                onEdit: async (text) => {
                  catchHandler = null;
                  activeWild = null;
                  statusText = `\n${text}`;
                  await exploreMsg.edit(await buildPayload(readSteps())).catch(() => {});
                },
              },
            });
          } catch (error) {
            console.error('Failed to start explore encounter:', error);
            catchHandler = null;
            activeWild = null;
            encounterBusyUntil = 0;
          }
        }
      });
      collector.on('end', () => exploreMsg.edit({ components: [] }).catch(() => {}));
      return;
    }

    if (command === 'team') {
      const action = args[0]?.toLowerCase();
      if (action === 'swap') {
        const slotA = Number(args[1]);
        const slotB = Number(args[2]);
        const valid = (slot) => Number.isInteger(slot) && slot >= 1 && slot <= 3;
        if (!valid(slotA) || !valid(slotB) || slotA === slotB) {
          return message.reply(`Usage: \`${PREFIX}team swap <slot 1-3> <slot 1-3>\` — e.g. \`${PREFIX}team swap 1 3\`.`);
        }
        const swapped = swapTeamSlots(userId, slotA, slotB);
        if (swapped.error) return message.reply('Both of those team slots are empty.');
        const label = (mon) => (mon ? mon.name : 'empty slot');
        return message.reply(
          `🔁 Swapped team positions **${slotA}** and **${slotB}**: ` +
          `**${label(swapped.first)}** is now in slot ${slotB} and **${label(swapped.second)}** is now in slot ${slotA}.`
        );
      }
      if (action === 'fav' || action === 'favorite') {
        const teamName = args.slice(1).join(' ').trim();
        if (!teamName) return message.reply(`Usage: \`${PREFIX}team favorite {team name}\` to add your current team to favorites.`);
        if (teamName.length > 32 || teamName.toLowerCase() === 'all' || teamName === '__defending__') {
          return message.reply('Pick a different team name (max 32 characters, not "all").');
        }
        if (!saveCurrentTeam(userId, teamName, false)) return message.reply('Your battle team is empty! Set up a team first.');
        return message.reply(`⭐ Saved your active team as **${teamName}**! Use \`${PREFIX}team use ${teamName}\` to equip it anytime.`);
      }
      if (action === 'defend') {
        if (args[1]?.toLowerCase() === 'clear') {
          clearDefendingTeam(userId);
          return message.reply('🛡️ Reset your defending team.');
        }
        if (!saveCurrentTeam(userId, '__defending__', true)) return message.reply('Your battle team is empty!');
        return message.reply('🛡️ Successfully set your current team as your **Defending team**!');
      }
      if (action === 'use') {
        const teamName = args.slice(1).join(' ').trim();
        if (!teamName) return message.reply(`Usage: \`${PREFIX}team use {team name}\``);
        const result = equipSavedTeam(userId, teamName);
        if (result.error === 'not_found') return message.reply(`Could not find a saved team named **${teamName}**. View them with \`${PREFIX}team list\`.`);
        if (result.error === 'empty') return message.reply('This saved team is empty.');
        if (result.error === 'missing') return message.reply('You can only use a favorited team if you own all of the Pokémon on that team.');
        return message.reply(
          `✅ Equipped favorited team **${result.saved.team_name}**!\n` +
          result.team.map((mon, index) => `${index + 1}. **${mon.name}** (Lv. ${mon.level})`).join('\n')
        );
      }
      if (action === 'delete') {
        const teamName = args.slice(1).join(' ').trim();
        if (!teamName) return message.reply(`Usage: \`${PREFIX}team delete {team name}\` or \`${PREFIX}team delete all\``);
        const result = deleteSavedTeam(userId, teamName.toLowerCase() === 'all' ? 'all' : teamName);
        if (!result.changes) return message.reply(`Could not find a saved team named **${teamName}**.`);
        return message.reply(teamName.toLowerCase() === 'all'
          ? '🗑️ Deleted all of your favorite teams.'
          : `🗑️ Deleted team **${teamName}** from your favorites.`);
      }
      if (action === 'list' || action === 'favs' || action === 'favorites') {
        const presets = getSavedTeams(userId);
        const defending = presets.find((preset) => preset.is_defending === 1);
        const favorites = presets.filter((preset) => preset.is_defending === 0);
        const formatMembers = (preset) => {
          const ids = JSON.parse(preset.pokemon_ids || '[]');
          if (!ids.length) return '*Empty team*';
          const mons = ids
            .map((id) => db.prepare('SELECT name, level FROM catches WHERE id = ? AND user_id = ?').get(id, userId))
            .filter(Boolean);
          if (!mons.length) return '*Pokémon missing from box*';
          return mons.map((mon) => `👾 ${mon.name} \`Lv. ${mon.level}\``).join('\n');
        };
        const embed = new EmbedBuilder()
          .setColor(0x0099ff)
          .setAuthor({ name: `${message.author.username}'s Favorite Teams`, iconURL: message.author.displayAvatarURL() })
          .setDescription(
            'You can only use a favorited team if you own all of the Pokémon on that team.\n' +
            `\`${PREFIX}team favorite {team name}\` add your current team to favorites\n` +
            `\`${PREFIX}team use {team name}\` equip a favorite team\n` +
            `\`${PREFIX}team delete {team name}\` / \`${PREFIX}team delete all\`\n` +
            `\`${PREFIX}team defend\` set your current team as your defending team\n` +
            `\`${PREFIX}team defend clear\` reset your defending team\n\n` +
            `🛡️ **Defending team**\n${defending ? formatMembers(defending) : '*No defending team set*'}\n\u200B`
          );
        if (favorites.length) {
          embed.addFields(favorites.slice(0, 24).map((preset) => ({ name: preset.team_name, value: formatMembers(preset), inline: true })));
        } else {
          embed.addFields({ name: 'No Favorite Teams', value: `Use \`${PREFIX}team favorite {name}\` to save your equipped team.` });
        }
        embed.setFooter({ text: "Set up your team for battling other trainers & NPC's" });
        return message.reply({ embeds: [embed] });
      }
      if (action === 'expshare') {
        const setting = args[1]?.toLowerCase();
        if (args.length > 2 || (setting && !['on', 'off'].includes(setting))) {
          return message.reply(`Usage: \`${PREFIX}team expshare [on|off]\`.`);
        }
        if (!setting) {
          const enabled = getUser(userId).team_exp_share === 1;
          return message.reply(
            `${EMOJIS.expshare} Team EXP Share is **${enabled ? 'ON' : 'OFF'}**. ` +
            `Use \`${PREFIX}team expshare on|off\` to change it.`
          );
        }
        const enabled = setting === 'on';
        const result = setTeamExpShare(userId, enabled);
        if (result.error === 'not_owned') {
          return message.reply(
            `You need to buy ${EMOJIS.expshare} Exp. Share from \`${PREFIX}shop\` first.`
          );
        }
        return message.reply(
          `${EMOJIS.expshare} Team EXP Share is now **${enabled ? 'ON' : 'OFF'}**. ` +
          `${enabled ? 'Your active team will each gain rarity-based EXP on successful catches.' : 'Catch EXP will go to your selected buddy, if you have one.'}`
        );
      }
      if (action === 'give' && (['lootbox', 'lb'].includes(args[1]?.toLowerCase()) || findBox(args[1] || ''))) {
        const boxName = findBox(args[1] || '');
        const giveLabel = boxName || 'Lootbox';
        if (args.length < 3) {
          return message.reply(`Usage: \`${PREFIX}team give ${args[1].toLowerCase()} <slot|Pokémon name>\`.`);
        }
        const team = getUserTeam(userId);
        if (!team.length) return message.reply('Your battle team is empty!');
        const targetQuery = args.slice(2).join(' ').trim();
        const dexQuery = targetQuery.toLowerCase().startsWith('dex ')
          ? targetQuery.slice(4).trim()
          : targetQuery;
        const slot = /^[1-3]$/.test(targetQuery) ? Number(targetQuery) : null;
        const targetMon = slot !== null
          ? team.find((pokemon) => pokemon.team_slot === slot)
          : findUserPokemonMatches(userId, dexQuery).find((pokemon) => pokemon.in_team);
        if (!targetMon) {
          return message.reply(
            `Choose a Pokémon on your team by name or Pokédex number; use a slot number to select by team slot. Usage: \`${PREFIX}team give lootbox <slot|Pokémon name|Pokédex number>\`.`
          );
        }
        const result = db.transaction(() => {
          const user = getUser(userId);
          if (!boxName && user.lootboxes < 1) return 'no_lootbox';
          if (boxName && !db.prepare(
            'SELECT 1 FROM user_items WHERE user_id = ? AND item_name = ? AND amount > 0'
          ).get(userId, boxName)) return 'no_lootbox';
          const currentMon = db.prepare(
            'SELECT held_item FROM catches WHERE id = ? AND user_id = ? AND in_team = 1'
          ).get(targetMon.id, userId);
          if (!currentMon) return 'not_found';
          if (currentMon.held_item) return 'item_held';
          const updated = db.prepare(`
            UPDATE catches SET held_item = ?
            WHERE id = ? AND user_id = ? AND in_team = 1 AND held_item IS NULL
          `).run(giveLabel, targetMon.id, userId);
          if (!updated.changes) return 'item_held';
          syncDuplicateCatchState(userId, targetMon.id);
          if (boxName) {
            if (!takeUserItem(userId, boxName)) throw new Error('no_box');
          } else {
            incrementUser(userId, { lootboxes: -1 });
          }
          return 'success';
        }).immediate();
        if (result === 'no_lootbox') return message.reply(`❌ You do not have any ${giveLabel}${boxName ? '' : 'e'}s to give.`);
        if (result === 'not_found') return message.reply('That Pokémon is no longer in your battle team.');
        if (result === 'item_held') return message.reply('That Pokémon is already holding an item.');
        return message.reply(`✅ Gave **1x ${giveLabel}** to **${targetMon.name}**.`);
      }
      if (action === 'add' || action === 'remove') {
        if (action === 'add' && args.length === 1) {
          const available = db.prepare(`
            SELECT id, name, is_shiny, level
            FROM catches
            WHERE user_id = ? AND in_team = 0
            ORDER BY id DESC
            LIMIT 20
          `).all(userId);
          if (!available.length) return message.reply('You have no Pokémon outside your active team.');
          const choices = available.map((pokemon) =>
            `• ${pokemon.is_shiny ? '✨ ' : ''}${pokemon.name} (Lv. ${pokemon.level})`
          ).join('\n');
          return message.reply(
            `Choose a Pokémon and slot with \`${PREFIX}team add <name|Pokédex number> <slot 1-3>\`:\n${choices}`
          );
        }
        if (action === 'add' && args.length >= 3
            && [1, 2, 3].includes(Number(args[args.length - 1]))) {
          const slot = Number(args[args.length - 1]);
          const query = args.slice(1, -1).join(' ');
          const result = setTeamCatchByQuery(userId, query, slot);
          if (result.error === 'not_found') {
            return message.reply(`You do not have a Pokémon matching **${query}** in your box.`);
          }
          return message.reply(
            `✅ Slot **${slot}** is now ${result.pokemon.is_shiny ? '✨ ' : ''}` +
            `**${result.pokemon.name}**.` +
            `${result.displaced ? ` Replaced **${result.displaced.name}**.` : ''}`
          );
        }
        if (action === 'remove' && args[1]?.toLowerCase() === 'slot') {
          if (args.length !== 3) {
            return message.reply(`Usage: \`${PREFIX}team remove slot <slot 1-3>\`.`);
          }
          const slot = Number(args[2]);
          if (!Number.isSafeInteger(slot) || slot < 1 || slot > 3) {
            return message.reply(`Usage: \`${PREFIX}team remove slot <slot 1-3>\`.`);
          }
          const pokemon = removeTeamSlot(userId, slot);
          if (!pokemon) return message.reply(`There is no Pokémon in team slot ${slot}.`);
          return message.reply(`➖ Removed **${pokemon.name}** from slot ${slot}.`);
        }
        if (action === 'remove' && args.length >= 2) {
          const rawQuery = args.slice(1).join(' ');
          const query = rawQuery.toLowerCase().startsWith('dex ')
            ? rawQuery.slice(4).trim()
            : rawQuery;
          if (/^\d+$/.test(query) && Number(query) >= 1 && Number(query) <= 3
              && rawQuery === query) {
            const slot = Number(query);
            const pokemon = removeTeamSlot(userId, slot);
            if (!pokemon) return message.reply(`There is no Pokémon in team slot ${slot}.`);
            return message.reply(`➖ Removed **${pokemon.name}** from slot ${slot}.`);
          }
          const matchingTeam = findUserPokemonMatches(userId, query)
            .filter((pokemon) => pokemon.in_team);
          if (!matchingTeam.length) {
            return message.reply(`No Pokémon matching **${query}** is on your active team.`);
          }
          const result = setCatchTeamStatus(userId, matchingTeam[0].id, false);
          if (result.error === 'not_in_team') {
            return message.reply(`No Pokémon matching **${query}** is on your active team.`);
          }
          return message.reply(`➖ Removed **${result.pokemon.name}** from your active team.`);
        }
        if (action === 'add') {
          const query = args.slice(1).join(' ');
          const match = findUserPokemonMatches(userId, query)
            .find((pokemon) => !pokemon.in_team);
          if (!match) {
            return message.reply(`You do not have an eligible Pokémon matching **${query}** outside your active team.`);
          }
          const result = setCatchTeamStatus(userId, match.id, true);
          if (result.error === 'team_full') {
            return message.reply('Your active team is full (3 Pokémon). Remove one before adding another.');
          }
          if (result.error === 'already_in_team' || result.error === 'not_found') {
            return message.reply(`Could not add a Pokémon matching **${query}** to your team.`);
          }
          return message.reply(
            `✅ Added to your active team: ${result.pokemon.is_shiny ? '✨ ' : ''}` +
            `**${result.pokemon.name}**.`
          );
        }
        return message.reply(
          action === 'add'
            ? `Usage: \`${PREFIX}team add <Pokédex number|name> [slot 1-3]\`.`
            : `Usage: \`${PREFIX}team remove <name>\`, \`${PREFIX}team remove dex <Pokédex number>\`, or \`${PREFIX}team remove slot <slot 1-3>\`.`
        );
      }

      const team = getUserTeam(userId);
      if (!team.length) {
        return message.reply(
          `Your active team is empty. Catch Pokémon with \`${PREFIX}p\`, then use ` +
          `\`${PREFIX}team add <name|Pokédex number> <slot 1-3>\`.`
        );
      }
      const embed = makeEmbed(`⚔️ ${message.author.username}'s Battle Team (Top 3)`, '', 0x34495e);
      for (const pokemon of team) {
        embed.addFields({
          name: `Slot ${pokemon.team_slot} ${pokemon.is_shiny ? '✨ ' : ''}${pokemon.name} (Lv. ${pokemon.level})`,
          value: `**HP:** ${pokemon.hp}/${pokemon.max_hp} | **ATK:** ${pokemon.atk} | ` +
            `**DEF:** ${pokemon.def} | **SPD:** ${pokemon.spd}\n` +
            `*IVs:* ${pokemon.hp_iv}H/${pokemon.atk_iv}A/${pokemon.def_iv}D/${pokemon.spd_iv}S\n` +
            `**Held item:** ${pokemon.held_item || 'None'} | **Friendship:** 💖 ${pokemon.friendship ?? 0}`,
        });
      }
      return message.reply({ embeds: [embed] });
    }

    if (command === 'mc' || command === 'megachamber') {
      const subcommand = args[0]?.toLowerCase();
      const chambers = getUserChambers(userId);
      const resolveChamber = (query) => Object.values(CHAMBER_CONFIG).find((chamber) =>
        String(chamber.id) === query
        || chamber.key === query?.toLowerCase()
        || chamber.monReq.toLowerCase() === query?.toLowerCase()
        || chamber.name.toLowerCase() === query?.toLowerCase()
      );

      if (subcommand === 'sacrifice' || subcommand === 'sac') {
        const config = resolveChamber(args[1]);
        const amount = args[2] === undefined ? 1 : Number(args[2]);
        if (!config || !Number.isSafeInteger(amount) || amount < 1 || amount > 100 || args.length > 3) {
          return message.reply(
            `Usage: \`${PREFIX}mc sacrifice <1-4|sableye|gengar|mawile|banette> [amount 1-100]\`.`
          );
        }
        const result = sacrificeForChamber(userId, config.key, amount);
        if (result.error === 'insufficient_pokemon') {
          return message.reply(
            `❌ You need **${amount} ${config.monReq}** outside your team and not assigned as your buddy; ` +
            `you have **${result.available}** available.`
          );
        }
        return message.reply(
          `🕯️ Sacrificed **${result.sacrificed} ${config.monReq}** for the ${config.icon} **${config.name} Chamber**. ` +
          `Banked sacrifices: ${formatMegaChamberSacrifices(result.sacrifices, getChamberRequirement(config, userId))}.`
        );
      }

      if (subcommand === 'battle' || subcommand === 'start' || subcommand === 'b') {
        const config = resolveChamber(args[1]);
        if (!config || args.length > 2) {
          return message.reply(`Usage: \`${PREFIX}mc battle <1-4|sableye|gengar|mawile|banette>\`.`);
        }
        const progress = chambers[config.key];
        const required = getChamberRequirement(config, userId);
        if (progress.sacrifices < required) {
          return message.reply(
            `❌ Sacrifice **${required} ${config.monReq}** before challenging this chamber. ` +
            `Current bank: ${formatMegaChamberSacrifices(progress.sacrifices, required)}.`
          );
        }
        return runMegaChamberGauntlet(message, userId, config);
      }

      if (args.length && subcommand !== 'status') {
        return message.reply(
          `Usage: \`${PREFIX}mc\`, \`${PREFIX}mc sacrifice <Pokémon> [amount]\`, or ` +
          `\`${PREFIX}mc battle <chamber>\`.`
        );
      }
      const chamberText = Object.values(CHAMBER_CONFIG).map((config) => {
        const progress = chambers[config.key];
        const required = getChamberRequirement(config, userId);
        return (
          `${config.icon} **${config.id}. ${config.name} Chamber** — sacrifice ${config.monReq} ×${required}\n` +
          `Bank: ${formatMegaChamberSacrifices(progress.sacrifices, required)} • Clears: **${progress.clears}**\n` +
          `Reward: ${stoneLabel(config.rewardStone)} + 15,000 PokéCoins`
        );
      }).join('\n\n');
      return message.reply({
        embeds: [new EmbedBuilder()
          .setColor(0x2b2d31)
          .setTitle('🛡️ Mega Chambers')
          .setDescription(
            `${chamberText}\n\n` +
            `Use \`${PREFIX}mc sacrifice <chamber number|Pokémon> [amount]\` to prepare, then ` +
            `\`${PREFIX}mc battle <chamber number|name>\` to fight a three-trainer gauntlet.`
          )],
      });
    }

    if (command === 'mega') {
      if (args[0]?.toLowerCase() !== 'evo' || args.length < 2) {
        return message.reply(
          `Usage: \`${PREFIX}mega evo <Pokémon name>\`. Requires ${EMOJIS.megabracelet} Mega Bracelet (shop item 22, 125 vote coins) and consumes the matching Mega Stone.`
        );
      }
      const result = megaEvolvePokemon(userId, args.slice(1).join(' '));
      if (result.error === 'bracelet_required') {
        return message.reply(
          `❌ Mega Evolution requires ${EMOJIS.megabracelet} **Mega Bracelet**. ` +
          `Buy it once from \`${PREFIX}shop buy mega bracelet\` for ${EMOJIS.votecoin} **125 Vote Coins**.`
        );
      }
      if (result.error === 'unsupported_pokemon') {
        return message.reply(
          'That Pokémon does not have a supported Mega Stone yet. Mega Evolution is currently available for Sableye, Gengar, Mawile, and Banette.'
        );
      }
      if (result.error === 'pokemon_not_owned') {
        return message.reply(`You do not own a **${result.pokemonName}** that can Mega Evolve.`);
      }
      if (result.error === 'already_mega') {
        return message.reply(`Your **${result.pokemonName}** has already Mega Evolved.`);
      }
      if (result.error === 'stone_required') {
        return message.reply(
          `You need a ${stoneLabel(result.stoneName)} to Mega Evolve ${result.pokemonName}.`
        );
      }
      return message.reply(
        `✨ **${result.pokemon.name}** Mega Evolved using ${stoneLabel(result.stone)}! ` +
        `It is now Pokédex #${result.dexNumber}.`
      );
    }

    if (command === 'battle' || command === 'b') {
      const battleSub = args[0]?.toLowerCase();
      if (battleSub === 'icons' || battleSub === 'icon') {
        const mentioned = message.mentions.users.first();
        const idArg = args[1] && /^\d{17,20}$/.test(args[1]) ? args[1] : null;
        const targetId = mentioned?.id || idArg || userId;
        const targetUser = mentioned || (idArg ? await client.users.fetch(idArg).catch(() => null) : message.author);
        if (!targetUser) return message.reply('I could not find that user.');
        const unlocked = getUnlockedBattleIcons(targetId);
        const selected = getSelectedBattleIcon(targetId);
        const isSelf = targetId === userId;
        const list = unlocked.length
          ? unlocked.map((index) => getNpcIconEmojiOrBlank(index) || `**${index + 1}.** ${getNpcTrainerName(index)}`).join(' ')
          : 'None';
        const embed = new EmbedBuilder()
          .setColor(0x3498db)
          .setDescription(
            `Hello **${message.author.username}**! Unlock new icons randomly from battling NPCs!\n` +
            `Campaign, special, and faction NPCs have a **1/1K** chance of dropping their icon when defeated. Unlock them all!\n` +
            `• 🆕 View other trainers' icons by using \`${PREFIX}b icons {user id or @user}\`\n\n` +
            `${isSelf ? 'You have' : `**${targetUser.username}** has`} unlocked **${unlocked.length}** battle icons! ` +
            `${DEFAULT_TRAINER_ICONS.brendan.emoji} ${DEFAULT_TRAINER_ICONS.may.emoji} are default icons.\n` +
            `• To view a full list of NPCs, type \`${PREFIX}battle npc list\`\n` +
            `• Global Icon rank: **${getBattleIconRank(targetId).toLocaleString()}**\n\n` +
            `**Unlocked icons (${unlocked.length})**\n${list.slice(0, 2800)}\n\n` +
            `To update your trainer icon, type \`${PREFIX}battle set-icon {icon name or NPC number}\``
          )
          .setFooter({ text: 'Icons are shown by trainer name and NPC number.' });
        if (selected !== null && selected >= 0) embed.setThumbnail(getNpcIconUrl(selected));
        else if (selected === null && unlocked.length) embed.setThumbnail(getNpcIconUrl(unlocked[0]));
        return message.reply({ embeds: [embed] });
      }
      if (battleSub === 'set-icon' || battleSub === 'seticon') {
        const query = args.slice(1).join(' ').trim().toLowerCase();
        if (!query) return message.reply(`Usage: \`${PREFIX}battle set-icon {icon name or NPC number}\``);
        const unlocked = getUnlockedBattleIcons(userId);
        const preset = DEFAULT_TRAINER_ICONS[query.replace(/^trainer/, '')];
        if (preset) {
          setSelectedBattleIcon(userId, preset.value);
          return message.reply(`✅ Trainer icon set to ${preset.emoji} **${preset.name}**!`);
        }
        const match = /^\d+$/.test(query)
          ? unlocked.find((index) => index === Number(query) - 1)
          : unlocked.find((index) => getNpcTrainerName(index).toLowerCase() === query)
            ?? unlocked.find((index) => getNpcTrainerName(index).toLowerCase().includes(query));
        if (match === undefined) {
          return message.reply(`You haven't unlocked that icon. See \`${PREFIX}battle icons\`.`);
        }
        setSelectedBattleIcon(userId, match);
        return message.reply({
          embeds: [new EmbedBuilder()
            .setColor(0x2ecc71)
            .setDescription(`✅ Trainer icon set to **${getNpcTrainerName(match)}**!`)
            .setThumbnail(getNpcIconUrl(match))],
        });
      }
      const sparTargetArg = battleSub === 'user' || battleSub === 'player' ? args[1] : args[0];
      const sparTargetId = message.mentions.users.first()?.id
        || (/^\d{17,20}$/.test(sparTargetArg || '') ? sparTargetArg : null);
      if (sparTargetId && !['npc', 'icons', 'icon', 'set-icon', 'seticon'].includes(battleSub)) {
        if (sparTargetId === userId) return message.reply('❌ You can’t battle yourself.');
        const sparUser = message.mentions.users.get(sparTargetId)
          || await client.users.fetch(sparTargetId).catch(() => null);
        if (!sparUser || sparUser.bot) return message.reply('❌ I could not find that player.');
        return runPlayerSpar(message, userId, sparUser);
      }
      if (args[0]?.toLowerCase() === 'npc') {
        const progress = getLeagueProgress(userId);
        const nextChallenge = NPC_CAMPAIGN[progress.cleared_challenges];
        const requested = args.slice(1).join(' ').trim().toLowerCase();
        const [firstArg, ...restArgs] = requested.split(/\s+/);

        if (!requested || firstArg === 'list') {
          const regionFilter = restArgs.join(' ').toLowerCase();
          const entries = [
            ...NPC_CAMPAIGN.map((challenge, index) => ({ challenge, index, special: false })),
            ...NPC_SPECIAL_BATTLES.map((challenge, index) => ({
              challenge,
              index: NPC_CAMPAIGN.length + index,
              special: true,
            })),
          ]
            .filter(({ challenge }) => !regionFilter || challenge.region?.toLowerCase() === regionFilter);
          if (!entries.length) return message.reply('No NPCs match that region.');
          const perPage = 15;
          const totalPages = Math.ceil(entries.length / perPage);
          let page = 1;
          const buildList = () => new EmbedBuilder()
            .setColor(0x3498db)
            .setTitle('⚔️ NPC Trainers')
            .setDescription(
              entries.slice((page - 1) * perPage, page * perPage).map(({ challenge, index, special }) => {
                const status = special
                  ? '⭐'
                  : index < progress.cleared_challenges
                    ? '✅'
                    : index === progress.cleared_challenges
                      ? '➡️'
                      : '🔒';
                return `${status} ${getNpcIconEmojiOrBlank(index)} **${index + 1}.** ${challenge.name}` +
                  `${challenge.region ? ` — ${challenge.region}` : ''}`;
              }).join('\n') +
              `\n\nBattle with \`${PREFIX}battle npc <number/name>\`. Filter with \`${PREFIX}battle npc list <region>\`.`
            )
            .setFooter({
              text: `Page ${page} / ${totalPages} • ${progress.cleared_challenges} / ${NPC_CAMPAIGN.length} campaign trainers cleared • Volo is always available`,
            });
          const buildButtons = () => new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('npc_prev').setLabel('Back').setStyle(ButtonStyle.Primary).setDisabled(page === 1),
            new ButtonBuilder().setCustomId('npc_next').setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(page === totalPages)
          );
          const listMsg = await message.reply({
            embeds: [buildList()],
            components: totalPages > 1 ? [buildButtons()] : [],
          });
          if (totalPages > 1) {
            const listCollector = listMsg.createMessageComponentCollector({
              componentType: ComponentType.Button,
              time: 120000,
            });
            listCollector.on('collect', async (interaction) => {
              if (interaction.user.id !== message.author.id) {
                return interaction.reply({ content: `Use \`${PREFIX}battle npc list\` yourself.`, ephemeral: true });
              }
              page = interaction.customId === 'npc_prev' ? Math.max(1, page - 1) : Math.min(totalPages, page + 1);
              return interaction.update({ embeds: [buildList()], components: [buildButtons()] });
            });
            listCollector.on('end', () => listMsg.edit({ components: [] }).catch(() => {}));
          }
          return;
        }

        let npcIndex;
        if (/^\d+$/.test(requested)) {
          npcIndex = Number(requested) - 1;
        } else {
          const codeMatches = NPC_CAMPAIGN
            .map((challenge, index) => ({ challenge, index }))
            .filter(({ challenge, index }) => getNpcCode(index, getNpcCodeCategory(challenge)) === requested);
          const matches = codeMatches.length ? codeMatches : [
            ...NPC_CAMPAIGN.map((challenge, index) => ({ challenge, index })),
            ...NPC_SPECIAL_BATTLES.map((challenge, index) => ({
              challenge,
              index: NPC_CAMPAIGN.length + index,
            })),
          ]
            .filter(({ challenge }) => challenge.name.toLowerCase().includes(requested));
          const exact = matches.filter(({ challenge }) => challenge.name.toLowerCase() === requested);
          const pool = exact.length ? exact : matches;
          // Prefer the unlocked NPC when several share a name.
          npcIndex = (pool.find(({ index }) => index === progress.cleared_challenges) || pool[0])?.index ?? -1;
        }
        if (!Number.isSafeInteger(npcIndex) || npcIndex < 0
            || npcIndex >= NPC_CAMPAIGN.length + NPC_SPECIAL_BATTLES.length) {
          return message.reply(
            `No NPC found. Use a number from **1** to **${NPC_CAMPAIGN.length + NPC_SPECIAL_BATTLES.length}** or a name; see \`${PREFIX}battle npc list\`.`
          );
        }
        if (npcIndex >= NPC_CAMPAIGN.length) {
          const specialChallenge = NPC_SPECIAL_BATTLES[npcIndex - NPC_CAMPAIGN.length];
          return startLeagueChallengeWithCooldown(message, userId, 0, [specialChallenge]);
        }
        if (npcIndex > progress.cleared_challenges) {
          return message.reply(
            `Your next opponent is **${progress.cleared_challenges + 1}. ${nextChallenge.name}**. ` +
            `Defeat trainers in order to unlock later battles.`
          );
        }
        return startLeagueChallengeWithCooldown(message, userId, npcIndex, NPC_CAMPAIGN);
      }

      return message.reply(`Usage: \`${PREFIX}battle npc <number/name>\` or \`${PREFIX}battle npc list\`.`);
    }

    if (command === 'balance' || command === 'bal') {
      const user = getUser(userId);
      const balances = [
        `🪙 **${user.coins.toLocaleString()} PokéCoins**`,
        `<:patreontoken:1560376902374522980> **${user.patreon_tokens.toLocaleString()} Patreon tokens**`,
        `${EMOJIS.votecoin} **${user.vote_coins.toLocaleString()} Vote coins**`,
        `${EMOJIS.fishingtoken} **${user.fishing_tokens.toLocaleString()} Fishing tokens**`,
        `🎟️ **${(getUserItems(userId).find((item) => item.item_name === 'Swap Ticket')?.amount || 0).toLocaleString()} Swap tickets**`,
      ];
      const faction = getUserFaction(userId);
      if (faction) {
        balances.push(`${faction.team.emoji} **${faction.points.toLocaleString()} ${faction.team.name} points**`);
      }
      return message.reply({
        embeds: [new EmbedBuilder()
          .setColor(0x5865f2)
          .setAuthor({
            name: `${message.author.username}'s balance`,
            iconURL: message.author.displayAvatarURL(),
          })
          .setDescription(
            `${getTrainerIconEmoji(userId)} **${message.author.username}, you currently have:**\n` +
            balances.map((balance) => `• ${balance}`).join('\n')
          )
          .setFooter({
            text: `Tip: Use ${PREFIX}market list <Pokémon name|Pokédex number> <amount> <price> to list Pokémon for sale!`,
          })
          .setTimestamp()],
      });
    }

    if (command === 'inv' || command === 'inventory' || command === 'bag') {
      const targetUser = message.author;
      const targetId = targetUser.id;
      const bagUser = getUser(targetId);
      const ownedItems = new Map(getUserItems(targetId).map((row) => [row.item_name, row.amount]));
      const totalPages = 7;
      const requestedPage = Number(args.find((arg) => /^\d+$/.test(arg)));
      let currentPage = requestedPage >= 1 && requestedPage <= totalPages ? requestedPage : 1;
      const itemLines = (entries) => entries
        .map(([name, definition]) => `• ${definition.emoji} **${name}:** ${(ownedItems.get(name) || 0).toLocaleString()}x`)
        .join('\n');

      const buildBagEmbed = (page) => {
        const embed = new EmbedBuilder()
          .setColor(0x0099ff)
          .setAuthor({ name: `${targetUser.username}'s Bag`, iconURL: targetUser.displayAvatarURL() });
        if (page === 1) {
          embed.setTitle(`🎒 Currencies & Gear (Page 1/${totalPages})`).addFields(
            { name: 'Currency', value: `• ${EMOJIS.pokecoin} **PokéCoins:** ${bagUser.coins.toLocaleString()}\n• ${EMOJIS.votecoin} **Vote Coins:** ${bagUser.vote_coins.toLocaleString()}\n• 🎟️ **Swap Tickets:** ${(ownedItems.get('Swap Ticket') || 0).toLocaleString()}`, inline: false },
            {
              name: 'Pokéballs',
              value:
                `• ${EMOJIS.pokeball} **Pokéball:** ${bagUser.pokeballs.toLocaleString()}\n` +
                `• ${EMOJIS.greatball} **Greatball:** ${bagUser.greatballs.toLocaleString()}\n` +
                `• ${EMOJIS.ultraball} **Ultraball:** ${bagUser.ultraballs.toLocaleString()}\n` +
                `• ${EMOJIS.masterball} **Masterball:** ${bagUser.masterballs.toLocaleString()}\n` +
                `• ${EMOJIS.premierball} **Premierball:** ${bagUser.premierballs.toLocaleString()}\n` +
                `• ${EMOJIS.diveball} **Diveball:** ${bagUser.diveballs.toLocaleString()}`,
              inline: true,
            },
            {
              name: 'Fishing',
              value:
                `• 🎣 **Rod:** ${bagUser.fish_rods}\n` +
                `• ${EMOJIS.fishingtoken} **Fishing Tokens:** ${bagUser.fishing_tokens.toLocaleString()}\n` +
                `• ${EMOJIS.pokeLure} **Poké Lures:** ${bagUser.active_poke_lures.toLocaleString()}\n` +
                `• ${EMOJIS.mistysLure} **Misty's Lures:** ${bagUser.active_mistys_lures.toLocaleString()}`,
              inline: true,
            },
            {
              name: 'Event',
              value: `• ${EMOJIS.eventticket} **Event Ticket:** ${bagUser.event_ticket ? 'Active' : 'None'}`,
              inline: false,
            }
          );
        } else if (page === 2) {
          const amuletBoost = getAmuletCoinBoost(targetId);
          embed.setTitle(`🎒 Utility Items (Page 2/${totalPages})`).addFields(
            {
              name: 'Boosters',
              value:
                `• ${EMOJIS.rarecandy} **Rare Candy:** ${bagUser.rare_candies.toLocaleString()}\n` +
                `• ${EMOJIS.pokeEgg} **Eggs:** ${bagUser.vote_eggs.toLocaleString()}${bagUser.held_egg_target > 0 ? ` (+ held: ${bagUser.held_egg_progress}/${bagUser.held_egg_target})` : ''}\n` +
                `• ${EMOJIS.incubator} **Incubators:** ${(ownedItems.get('Incubator') || 0).toLocaleString()}\n` +
                `• ${EMOJIS.superIncubator} **Super Incubators:** ${(ownedItems.get('Super Incubator') || 0).toLocaleString()}\n` +
                `• ${EMOJIS.repel} **Repel:** ${bagUser.repels.toLocaleString()} (${bagUser.repel_encounters.toLocaleString()} active)\n` +
                `• ${EMOJIS.goldenRazz} **Golden Razz:** ${bagUser.grazz_berries.toLocaleString()}\n` +
                `• ${EMOJIS.superRepel} **Super Repel:** ${(ownedItems.get('Super Repel') || 0).toLocaleString()} (${bagUser.super_repel_encounters.toLocaleString()} active)\n` +
                `• ${EMOJIS.maxRepel} **Max Repel:** ${(ownedItems.get('Max Repel') || 0).toLocaleString()} (${bagUser.max_repel_encounters.toLocaleString()} active)\n` +
                `• ${EMOJIS.honey} **Honey:** ${(ownedItems.get('Honey') || 0).toLocaleString()} (${bagUser.honey_encounters.toLocaleString()} active)\n` +
                `• 📜 **Quest Reset Scroll:** ${bagUser.quest_reset_scrolls.toLocaleString()}\n` +
                `• ${EMOJIS.expshare} **Exp. Share:** ${bagUser.exp_share_owned ? 'Owned' : 'Not owned'}\n` +
                `• ${EMOJIS.amuletcoin} **Amulet Coin:** ${amuletBoost.owned}/10 (+${amuletBoost.percentBoost}% coin boost)`,
              inline: true,
            },
            {
              name: 'Patreon Items',
              value:
                `• ${EMOJIS.cooldownMachine} **Cooldown Machines:** ${(ownedItems.get('Cooldown Machine') || 0).toLocaleString()}\n` +
                `• ${EMOJIS.abilityCapsule} **Ability Capsules:** ${(ownedItems.get('Ability Capsule') || 0).toLocaleString()}\n` +
                `• ${EMOJIS.abilityPatch} **Ability Patches:** ${(ownedItems.get('Ability Patch') || 0).toLocaleString()}`,
              inline: true,
            },
            {
              name: 'Charms',
              value:
                `• ${EMOJIS.shinyCharm} **Shiny Charm:** ${bagUser.shiny_charms}/5`,
              inline: true,
            },
            {
              name: 'Promo Items',
              value: (() => {
                const promos = getActivePromos();
                if (!promos.length) return '*No active promo.*';
                return promos.map((promo) =>
                  `• ${promo.itemEmoji} **${promo.itemName}:** ${(ownedItems.get(promo.itemName) || 0).toLocaleString()}x`
                ).join('\n');
              })(),
              inline: true,
            }
          );
        } else if (page === 3) {
          const evolutionEntries = Object.entries(EVOLUTION_ITEMS);
          const heldEntries = evolutionEntries.filter(([, item]) => item.kind === 'held');
          const heldSplit = Math.ceil(heldEntries.length / 2);
          embed.setTitle(`🎒 Evolution & Mega Items (Page 3/${totalPages})`).addFields(
            {
              name: 'Evolution Stones',
              value: itemLines(evolutionEntries.filter(([, item]) => item.kind === 'stone')),
              inline: false,
            },
            { name: 'Held Evolution Items', value: itemLines(heldEntries.slice(0, heldSplit)), inline: true },
            { name: '\u200b', value: itemLines(heldEntries.slice(heldSplit)), inline: true },
            {
              name: 'Mega Bracelet',
              value: `${EMOJIS.megabracelet} **${(ownedItems.get('Mega Bracelet') || 0) > 0 ? 'Owned' : 'Not owned'}** — required for \`${PREFIX}mega evo\` (Mega Stones are on page 6)`,
              inline: false,
            }
          );
        } else if (page === 4) {
          embed.setTitle(`🎒 Boxes (Page 4/${totalPages})`).setDescription(
            `• ${LOOTBOX_EMOJI} **Lootbox:** ${bagUser.lootboxes.toLocaleString()}x *(\`${PREFIX}lb all\`)*\n` +
            Object.entries(BOXES)
              .map(([name, box]) => `• ${box.emoji} **${name}:** ${(ownedItems.get(name) || 0).toLocaleString()}x *(\`${PREFIX}open ${box.aliases[0]}\`)*`)
              .join('\n') +
            `\n\n*Inspect a box with \`${PREFIX}item info <box>\`.*`
          );
        } else if (page === 5) {
          const questItems = [...ownedItems.entries()]
            .filter(([name]) =>
              !EVOLUTION_ITEMS[name]
              && !BOXES[name]
              && !VOTE_BOXES[name]
              && !FUN_ITEM_NAMES.includes(name)
              && name !== 'Rare Candy'
              && name !== 'Swap Ticket'
              && !['Super Repel', 'Max Repel', 'Honey'].includes(name)
              && name !== 'Mega Bracelet'
              && !['Incubator', 'Super Incubator'].includes(name)
              && !['Cooldown Machine', 'Ability Capsule', 'Ability Patch'].includes(name)
              && !getActivePromos().some((promo) => promo.itemName === name)
            );
          embed.setTitle(`🎒 Quest Items (Page 5/${totalPages})`).addFields(
            {
              name: 'Fun Items',
              value: FUN_ITEM_NAMES
                .filter((name) => name !== 'Sitrus Berry')
                .map((name) => `• ${FUN_ITEM_EMOJIS[name]} **${name}:** ${(ownedItems.get(name) || 0).toLocaleString()}x`)
                .join('\n'),
              inline: false,
            },
            ...(questItems.length ? [{
              name: 'Quest Items',
              value: questItems.map(([name, amount]) => {
                const emoji = {
                  Honey: EMOJIS.honey,
                  Incense: EMOJIS.incense,
                  Pokeradar: EMOJIS.pokeradar,
                  'Boss Coin': EMOJIS.bosscoin,
                  'Super Repel': EMOJIS.superRepel,
                  'Max Repel': EMOJIS.maxRepel,
                  'Golden Razz': EMOJIS.goldenRazz,
                }[name] || '📦';
                return `• ${emoji} **${name}:** ${amount.toLocaleString()}x`;
              }).join('\n').slice(0, 1000),
              inline: false,
            }] : [])
          );
        } else if (page === 7) {
          embed.setTitle(`🎒 Battle (Page 7/${totalPages})`).addFields({
            name: 'Battle Items',
            value: `• ${FUN_ITEM_EMOJIS['Sitrus Berry']} **Sitrus Berry:** ${(ownedItems.get('Sitrus Berry') || 0).toLocaleString()}x`,
            inline: false,
          });
        } else {
          const stoneCounts = new Map(MEGA_STONE_NAMES.map((name) => [name, 0]));
          for (const stone of getMegaStones(targetId)) stoneCounts.set(stone.stone_name, stone.amount);
          for (const config of Object.values(CHAMBER_CONFIG)) {
            if (!stoneCounts.has(config.rewardStone)) stoneCounts.set(config.rewardStone, 0);
          }
          const stoneEntries = [...stoneCounts.entries()].sort(([a], [b]) => a.localeCompare(b));
          const owned = stoneEntries.filter(([, amount]) => amount > 0).length;
          const stoneChunk = Math.ceil(stoneEntries.length / 3);
          embed.setTitle(`🎒 Mega Stones (Page 6/${totalPages})`)
            .setDescription(
              `${EMOJIS.megabracelet} **Mega Bracelet:** ${(ownedItems.get('Mega Bracelet') || 0) > 0 ? 'Owned' : 'Not owned'} — required for \`${PREFIX}mega evo\`\n` +
              `**Collected:** ${owned}/${stoneEntries.length} • Earn stones from \`${PREFIX}mc\``
            )
            .addFields([0, 1, 2].map((column) => ({
              name: column === 0 ? 'Mega Stones' : '\u200b',
              value: stoneEntries
                .slice(column * stoneChunk, (column + 1) * stoneChunk)
                .map(([name, amount]) => `${MEGA_STONE_EMOJIS[name] || (amount > 0 ? '🔮' : '▫️')} **${name}:** ${amount.toLocaleString()}x`)
                .join('\n') || '\u200b',
              inline: true,
            })));
        }
        return embed.setFooter({ text: `Page ${page}/${totalPages} • ${PREFIX}bag [page]` });
      };
      const buildBagButtons = (page, disabled = false) => new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('bag:first').setEmoji('⏪').setStyle(ButtonStyle.Secondary).setDisabled(disabled || page === 1),
        new ButtonBuilder().setCustomId('bag:prev').setEmoji('⬅️').setStyle(ButtonStyle.Primary).setDisabled(disabled || page === 1),
        new ButtonBuilder().setCustomId('bag:next').setEmoji('➡️').setStyle(ButtonStyle.Primary).setDisabled(disabled || page === totalPages),
        new ButtonBuilder().setCustomId('bag:last').setEmoji('⏩').setStyle(ButtonStyle.Secondary).setDisabled(disabled || page === totalPages)
      );

      const bagMessage = await message.reply({
        embeds: [buildBagEmbed(currentPage)],
        components: [buildBagButtons(currentPage)],
      });
      const bagCollector = bagMessage.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 90000,
      });
      bagCollector.on('collect', async (interaction) => {
        if (interaction.user.id !== message.author.id) {
          return interaction.reply({ content: `Use \`${PREFIX}bag\` to open your own bag.`, ephemeral: true });
        }
        const action = interaction.customId.split(':')[1];
        if (action === 'first') currentPage = 1;
        else if (action === 'prev') currentPage = Math.max(1, currentPage - 1);
        else if (action === 'next') currentPage = Math.min(totalPages, currentPage + 1);
        else if (action === 'last') currentPage = totalPages;
        return interaction.update({
          embeds: [buildBagEmbed(currentPage)],
          components: [buildBagButtons(currentPage)],
        });
      });
      bagCollector.on('end', () => {
        bagMessage.edit({ components: [buildBagButtons(currentPage, true)] }).catch(() => {});
      });
      return;
    }

    if (command === 'use' && ['pokelure', 'pokelures', 'poke-lure', 'pl', 'mistyslure', 'mistys-lure', 'ml'].includes(
      args[0]?.toLowerCase().replace(/['’]/g, '')
    )) {
      const normalizedItem = args[0].toLowerCase().replace(/['’]/g, '').replace(/-/g, '');
      const isPokeLure = ['pokelure', 'pokelures', 'pl'].includes(normalizedItem);
      const itemName = isPokeLure ? 'Poké Lure' : "Misty's Lure";
      const itemEmoji = isPokeLure ? EMOJIS.pokeLure : EMOJIS.mistysLure;
      const activeField = isPokeLure ? 'active_poke_lures' : 'active_mistys_lures';
      const amount = args[1] === undefined ? 1 : Number(args[1]);
      if (args.length > 2 || !Number.isSafeInteger(amount) || amount <= 0) {
        return message.reply(`Usage: \`${PREFIX}use <pokelure|mistyslure|pl|ml> [amount]\`.`);
      }
      if (!takeUserItem(userId, itemName, amount)) {
        const owned = getUserItems(userId).find((item) => item.item_name === itemName)?.amount || 0;
        return message.reply(`You need ${amount} ${itemEmoji} ${itemName}${amount === 1 ? '' : 's'} (you own ${owned}).`);
      }
      incrementUser(userId, { [activeField]: amount });
      return message.reply(
        `${itemEmoji} Activated **${amount} ${itemName}${amount === 1 ? '' : 's'}**. ` +
        `They will apply to your next ${amount} successful fishing catch${amount === 1 ? '' : 'es'}.`
      );
    }

    if (command === 'use' && ['lure', 'lures'].includes(args[0]?.toLowerCase())) {
      const lureName = args[1]?.toLowerCase().replace(/['’]/g, '').replace(/[^a-z]/g, '');
      const isPokeLure = ['poke', 'pokelure'].includes(lureName);
      const isMistysLure = ['misty', 'mistys', 'mistyslure'].includes(lureName);
      if (args.length > 3 || (!isPokeLure && !isMistysLure)) {
        return message.reply(`Usage: \`${PREFIX}use lure <poke|mistys> [amount]\`.`);
      }
      const itemName = isPokeLure ? 'Poké Lure' : "Misty's Lure";
      const itemEmoji = isPokeLure ? EMOJIS.pokeLure : EMOJIS.mistysLure;
      const activeField = isPokeLure ? 'active_poke_lures' : 'active_mistys_lures';
      const amount = args[2] === undefined ? 1 : Number(args[2]);
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        return message.reply(`Usage: \`${PREFIX}use lure <poke|mistys> [amount]\`.`);
      }
      if (!takeUserItem(userId, itemName, amount)) {
        const owned = getUserItems(userId).find((item) => item.item_name === itemName)?.amount || 0;
        return message.reply(`You need ${amount} ${itemEmoji} ${itemName}${amount === 1 ? '' : 's'} (you own ${owned}).`);
      }
      incrementUser(userId, { [activeField]: amount });
      return message.reply(
        `${itemEmoji} Activated **${amount} ${itemName}${amount === 1 ? '' : 's'}**. ` +
        `They will apply to your next ${amount} successful fishing catch${amount === 1 ? '' : 'es'}.`
      );
    }

    if (command === 'use' && ['rarecandy', 'rare-candy', 'candy', 'rc'].includes(args[0]?.toLowerCase())) {
      const candyArg = args[1]?.toLowerCase();
      const amount = candyArg === 'all' ? 'all' : candyArg === undefined ? 1 : parseAmount(candyArg);
      if (args.length > 2 || (amount !== 'all' && (!Number.isSafeInteger(amount) || amount <= 0))) {
        return message.reply(
          `Usage: \`${PREFIX}use rarecandy <amount>\` or \`${PREFIX}use rc all\`. Rare Candies only work on your buddy.`
        );
      }
      const result = useRareCandy(userId, amount);
      if (result.error === 'no_buddy') {
        return message.reply(`Rare Candies can only be used on your buddy. Set one with \`${PREFIX}buddy set <Pokémon>\` first.`);
      }
      if (result.error === 'max_level') return message.reply('Your buddy is already at the level cap (100).');
      if (result.error === 'no_candies') return message.reply(`You do not have any ${EMOJIS.rarecandy} Rare Candies.`);
      return message.reply(
        `🍬 Used **${result.levelsGained} Rare Candy${result.levelsGained === 1 ? '' : 's'}** on ` +
        `**${result.pokemon.name}**: Level ${result.pokemon.level} → **${result.level}**.`
      );
    }

    if (command === 'box' || command === 'pc') {
      const userIdArg = args.find((argument) => /^\d{17,20}$/.test(argument));
      let targetUser = message.mentions.users.first() || null;
      if (!targetUser && userIdArg) {
        targetUser = await client.users.fetch(userIdArg).catch(() => null);
        if (!targetUser) return message.reply('Could not find a Discord user with that ID.');
      }
      if (!targetUser) targetUser = message.author;
      const filters = args.filter((argument) =>
        !/^<@!?\d+>$/.test(argument) && argument !== userIdArg
      );
      if (['sort', 'sortby', 'order'].includes(filters[0]?.toLowerCase()) && filters.length > 1) filters.shift();
      const mutation = filters[0]?.toLowerCase();
      if (mutation === 'fav' || mutation === 'unfav') {
        if (targetUser.id !== message.author.id) {
          return message.reply('You can only change favorites in your own box.');
        }
        const values = filters.slice(1).join(' ').split(',').map((value) => value.trim()).filter(Boolean);
        const favLimit = getUser(userId).has_patreon ? 40 : 20;
        const favLabel = (row) => `${row.is_golden ? 'Golden ' : row.is_shiny ? '✨ ' : ''}${row.name}`;
        if (values.length === 0) {
          if (mutation === 'unfav') {
            return message.reply(`Usage: \`${PREFIX}box unfav <Pokémon name|Pokédex number|all>\``);
          }
          const favorites = db.prepare(
            'SELECT * FROM catches WHERE user_id = ? AND is_fav = 1 ORDER BY id'
          ).all(userId);
          return message.reply({
            embeds: [new EmbedBuilder()
              .setColor(0x5865f2)
              .setAuthor({ name: `${message.author.username}'s Box Favorites`, iconURL: message.author.displayAvatarURL() })
              .setDescription(
                (favorites.length
                  ? favorites.map((row, index) => `${index + 1}. ${favLabel(row)}`).join('\n')
                  : 'You have no favorite Pokémon yet.') +
                `\n\n**Favorite a Pokémon:**\n\`${PREFIX}box fav {name or Pokédex number}\`\n\n` +
                `**Unfavorite a Pokémon:**\n\`${PREFIX}box unfav {name, Pokédex number or all}\`\n\n` +
                `You can favorite a maximum of ${favLimit} Pokémon in your box (40 for Patreon Supporters).`
              )
              .setFooter({ text: 'Favorited Pokémon appear at the top of your box with a ⭐' })],
          });
        }
        const changed = [];
        const missing = [];
        const wantsAll = values.some((value) => value.toLowerCase() === 'all');
        if (wantsAll) {
          if (mutation === 'fav') return message.reply('You can only use `all` with unfav.');
          changed.push(...db.prepare('SELECT * FROM catches WHERE user_id = ? AND is_fav = 1').all(userId));
          db.prepare('UPDATE catches SET is_fav = 0 WHERE user_id = ?').run(userId);
        } else {
          const favCount = db.prepare('SELECT COUNT(*) AS n FROM catches WHERE user_id = ? AND is_fav = 1').get(userId).n;
          let remaining = favLimit - favCount;
          const findCatches = db.prepare(`
            SELECT * FROM catches
            WHERE user_id = ? AND pokemon_id = ? AND is_fav = ?
              AND is_golden = ? AND is_shiny = ?
            ORDER BY id
          `);
          const setFav = db.prepare('UPDATE catches SET is_fav = ? WHERE id = ?');
          const allForms = db.prepare('SELECT * FROM pokemon_forms ORDER BY species_id, id').all();
          const allDexNumbers = getPokemonDexNumbers(allForms);
          db.transaction(() => {
            for (const rawValue of values) {
              let value = rawValue;
              let wantsShiny = false;
              if (/^(shiny|✨)\s*/i.test(value) && value.replace(/^(shiny|✨)\s*/i, '')) {
                wantsShiny = true;
                value = value.replace(/^(shiny|✨)\s*/i, '');
              }
              const form = resolvePokemonForm(value);
              if (form && /^\d+$/.test(value)) {
                const numbers = allDexNumbers.get(form.id);
                wantsShiny = numbers?.dexNumber !== Number(value) && numbers?.shinyDexNumber === Number(value);
              }
              const rows = form
                ? findCatches.all(
                  userId,
                  form.id,
                  mutation === 'fav' ? 0 : 1,
                  0,
                  wantsShiny ? 1 : 0
                )
                : [];
              if (!rows.length) {
                missing.push(rawValue);
                continue;
              }
              if (mutation === 'fav') {
                if (rows.length > remaining) {
                  missing.push(`${rawValue} (favorite limit reached)`);
                  continue;
                }
                remaining -= rows.length;
              }
              for (const row of rows) {
                setFav.run(mutation === 'fav' ? 1 : 0, row.id);
                changed.push(row);
              }
            }
          })();
        }
        const verb = mutation === 'fav' ? 'Favorited' : 'Unfavorited';
        const embed = new EmbedBuilder()
          .setColor(changed.length ? 0x5865f2 : 0xe74c3c)
          .setTitle('Favorites updated');
        if (changed.length) {
          const changedNames = [...new Set(changed.map(favLabel))];
          embed.addFields({
            name: `${verb} Pokémon`,
            value: changedNames.slice(0, 40).map((name) => `• ${name}`).join('\n'),
          });
        }
        if (missing.length) {
          embed.addFields({ name: `Not changed (${missing.length})`, value: missing.map((value) => `• ${value}`).join('\n').slice(0, 1000) });
        }
        return message.reply({ embeds: [embed] });
      }

      const dexIndexOffset = getDexIndexOffset();
      const catches = db.prepare(`
        SELECT c.*,
          p.species_id AS form_species_id,
          p.slug AS form_slug,
          COALESCE(p.species_id, c.pokemon_id)
            + CASE WHEN c.is_shiny = 1 THEN ? ELSE 0 END AS dex_number,
          p.id AS form_id, p.generation, p.types,
          (c.is_fav = 1) AS is_favorite
        FROM catches c
        LEFT JOIN pokemon_forms p ON p.id = c.pokemon_id
        WHERE c.user_id = ?
        ORDER BY c.id DESC
      `).all(dexIndexOffset, targetUser.id);
      const dexNumberByFormId = getPokemonDexNumbers(db.prepare(`
        SELECT id, species_id, name, slug, is_default
        FROM pokemon_forms
        ORDER BY species_id, id
      `).all());
      for (const pokemon of catches) {
        if (pokemon.is_golden) {
          const goldenDex = getGoldenDexNumber(pokemon.form_species_id, pokemon.form_slug);
          if (goldenDex) pokemon.dex_number = goldenDex;
          continue;
        }
        const dexNumbers = dexNumberByFormId.get(pokemon.form_id);
        if (dexNumbers) {
          pokemon.dex_number = pokemon.is_shiny
            ? dexNumbers.shinyDexNumber ?? dexNumbers.dexNumber
            : dexNumbers.dexNumber;
        }
      }
      if (!catches.length) {
        return message.reply(`<@${targetUser.id}>'s box is empty. Go catch Pokémon with \`.p\` or \`.fish\`!`);
      }

      const generationByRegion = {
        kanto: 'generation-i',
        johto: 'generation-ii',
        hoenn: 'generation-iii',
        sinnoh: 'generation-iv',
        unova: 'generation-v',
        kalos: 'generation-vi',
        alola: 'generation-vii',
        galar: 'generation-viii',
        paldea: 'generation-ix',
      };
      const rarityNames = new Map(
        getRaritySettings().map((rarity) => [rarity.name.toLowerCase(), rarity.name])
      );
      const filter = filters[0]?.toLowerCase();
      const rarityFilter = rarityNames.get(filters.join(' ').toLowerCase());
      let activeFilter = '';
      let visibleCatches = catches;
      if (filter === 'fav') {
        activeFilter = 'Favorites';
        visibleCatches = catches.filter((pokemon) => pokemon.is_favorite);
      } else if (filter === 'shiny') {
        activeFilter = 'Shiny';
        visibleCatches = catches.filter((pokemon) => pokemon.is_shiny);
      } else if (filter === 'golden') {
        activeFilter = 'Golden';
        visibleCatches = catches.filter((pokemon) => pokemon.is_golden);
      } else if (generationByRegion[filter]) {
        activeFilter = filter[0].toUpperCase() + filter.slice(1);
        visibleCatches = catches.filter((pokemon) => pokemon.generation === generationByRegion[filter]);
      } else if (rarityFilter) {
        activeFilter = rarityFilter;
        visibleCatches = catches.filter((pokemon) =>
          getDisplayRarity(pokemon.rarity, pokemon.name, Boolean(pokemon.is_shiny)).toLowerCase()
            === rarityFilter.toLowerCase()
        );
      } else if (filter === 'type' && filters[1]) {
        const type = filters[1].toLowerCase();
        activeFilter = `${getTypeEmoji(type)} ${type[0].toUpperCase()}${type.slice(1)} type`;
        visibleCatches = catches.filter((pokemon) =>
          JSON.parse(pokemon.types || '[]').includes(type)
        );
      } else if (filter === 'recent' || ['duplicates', 'duplicate', 'dupes', 'dupe', 'dup'].includes(filter)) {
        activeFilter = '';
      } else if (filter) {
        return message.reply(
          `Unknown box filter. Try a region, rarity, \`fav\`, \`shiny\`, \`type <type>\`, \`duplicates\`, or \`recent\`.`
        );
      }
      if (!visibleCatches.length) {
        return message.reply(
          `${targetUser.username}'s box has no Pokémon${activeFilter ? ` matching **${activeFilter}**` : ''}.`
        );
      }

      const grouped = new Map();
      for (const pokemon of visibleCatches) {
        const key = `${pokemon.pokemon_id}:${pokemon.is_shiny ? 1 : 0}:${pokemon.is_golden ? 1 : 0}`;
        const entry = grouped.get(key) || {
          ...pokemon,
          count: 0,
          latestCatchId: 0,
        };
        entry.count += 1;
        entry.latestCatchId = Math.max(entry.latestCatchId, pokemon.id);
        entry.in_team = Boolean(entry.in_team || pokemon.in_team);
        entry.is_favorite = Boolean(entry.is_favorite || pokemon.is_favorite);
        grouped.set(key, entry);
      }
      const rarityOrder = new Map([
        'Shiny Gmax',
        'Gmax',
        'Shiny Mega',
        'Mega',
        'Shiny',
        'Legendary',
        'Super Rare',
        'Rare',
        'Uncommon',
        'Common',
      ].map((rarity, index) => [rarity, index]));
      const unlistedRarityOrder = rarityOrder.size;
      const groupedCatches = [...grouped.values()];
      const rarityButtonOptions = [
        ['all', 'All'], ['common', 'Common'], ['uncommon', 'Uncommon'], ['rare', 'Rare'], ['super rare', 'Super Rare'],
        ['legendary', 'Legendary'], ['shiny', 'Shiny'], ['golden', 'Golden'], ['mega', 'Mega'], ['gmax', 'Gmax'],
      ];
      let rarityButton = 'all';
      const matchesRarityButton = (pokemon) => {
        if (rarityButton === 'all') return true;
        if (rarityButton === 'golden') return Boolean(pokemon.is_golden);
        if (pokemon.is_golden) return false;
        const displayed = getDisplayRarity(pokemon.rarity, pokemon.name, Boolean(pokemon.is_shiny)).toLowerCase();
        return rarityButton === 'mega' || rarityButton === 'gmax'
          ? displayed.includes(rarityButton)
          : displayed === rarityButton;
      };
      const filteredCatches = () => groupedCatches.filter(matchesRarityButton);
      let rarityFirst = filter !== 'recent';
      let sortByDuplicates = ['duplicates', 'duplicate', 'dupes', 'dupe', 'dup'].includes(filter);
      const orderedCatches = () => filteredCatches().sort((left, right) => {
        if (Boolean(left.is_favorite) !== Boolean(right.is_favorite)) {
          return left.is_favorite ? -1 : 1;
        }
        if (sortByDuplicates && left.count !== right.count) return right.count - left.count;
        if (rarityFirst) {
          if (Boolean(left.is_golden) !== Boolean(right.is_golden)) {
            return left.is_golden ? -1 : 1;
          }
          const leftRarity = getDisplayRarity(left.rarity, left.name, Boolean(left.is_shiny));
          const rightRarity = getDisplayRarity(right.rarity, right.name, Boolean(right.is_shiny));
          const rarityDifference = (rarityOrder.get(leftRarity) ?? unlistedRarityOrder)
            - (rarityOrder.get(rightRarity) ?? unlistedRarityOrder);
          if (rarityDifference) return rarityDifference;
          return right.dex_number - left.dex_number || right.pokemon_id - left.pokemon_id;
        }
        return right.latestCatchId - left.latestCatchId;
      });
      const pageSize = 20;
      const getTotalPages = () => Math.max(1, Math.ceil(filteredCatches().length / pageSize));
      let totalPages = getTotalPages();
      let currentPage = 1;
      const lineFor = (pokemon) => {
        const isGolden = Boolean(pokemon.is_golden);
        const isShiny = Boolean(pokemon.is_shiny);
        const displayRarity = getDisplayRarity(pokemon.rarity, pokemon.name, isShiny);
        const rarityEmoji = isGolden
          ? EMOJIS.golden
          : RARITY_EMOJIS[displayRarity.toLowerCase()] || '\u2003';
        const megaSpecies = pokemon.name.toLowerCase().match(/sableye|gengar|mawile|banette/)?.[0];
        const spriteEmoji = megaSpecies && MEGA_SPECIES_EMOJIS[megaSpecies]
          ? ` ${MEGA_SPECIES_EMOJIS[megaSpecies]}`
          : ' \u2003\u2003';
        const name = isGolden ? `Golden ${pokemon.name}` : pokemon.name;
        return `${String(pokemon.dex_number).padStart(4, '0')} ${rarityEmoji}${spriteEmoji} **${name}**` +
          `${pokemon.count > 1 ? ` ×${pokemon.count}` : ''}${pokemon.is_favorite ? ' ⭐' : ''}`;
      };
      const pageEmbed = () => {
        const entries = orderedCatches().slice((currentPage - 1) * pageSize, currentPage * pageSize);
        const makeColumn = (columnEntries) => columnEntries.length
          ? columnEntries.map(lineFor).join('\n')
          : '\u200b';
        const embed = new EmbedBuilder()
          .setColor(0x9b59b6)
          .setAuthor({
            name: `${targetUser.username}'s Pokémon Box`,
            iconURL: targetUser.displayAvatarURL(),
          })
          .setDescription(
            `⭐ \`${PREFIX}box fav <Dex #|all>\` / \`${PREFIX}box unfav <Dex #|all>\` — manage favorites\n` +
            `🌎 \`${PREFIX}box kanto|johto|hoenn|sinnoh|unova|kalos|alola|galar|paldea\` — region\n` +
            `🏅 \`${PREFIX}box <rarity>\` • \`${PREFIX}box shiny\` • \`${PREFIX}box golden\` • \`${PREFIX}box type <type>\` • \`${PREFIX}box recent\`\n` +
            `🔒 Lock/unlock Pokémon by name, Dex #, Mega line, Egg, rarity, event, or starters with \`${PREFIX}release lock|unlock <category>\`\n` +
            `🔎 \`${PREFIX}box @user [filter]\` — view another trainer\'s box` +
            (activeFilter ? `\n\n**Filter:** ${activeFilter}` : '')
          )
          .addFields(
            { name: '\u200b', value: makeColumn(entries.slice(0, 10)), inline: true },
            { name: '\u200b', value: makeColumn(entries.slice(10, 20)), inline: true }
          )
          .setFooter({
            text: `Page ${currentPage}/${totalPages} • Total mons: ${filteredCatches().reduce((sum, entry) => sum + entry.count, 0)} • ` +
              `Sorted by: ${sortByDuplicates ? 'Duplicates' : rarityFirst ? 'Rarity' : 'Recent'}` +
              (rarityButton === 'all' ? '' : ` • Showing: ${rarityButtonOptions.find(([key]) => key === rarityButton)[1]}`),
          });
        return embed;
      };
      const pageButtons = () => [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('box:first').setEmoji('⏪').setStyle(ButtonStyle.Secondary).setDisabled(currentPage === 1),
          new ButtonBuilder().setCustomId('box:prev').setEmoji('⬅️').setStyle(ButtonStyle.Primary).setDisabled(currentPage === 1),
          new ButtonBuilder().setCustomId('box:next').setEmoji('➡️').setStyle(ButtonStyle.Primary).setDisabled(currentPage === totalPages),
          new ButtonBuilder().setCustomId('box:last').setEmoji('⏩').setStyle(ButtonStyle.Secondary).setDisabled(currentPage === totalPages),
          new ButtonBuilder().setCustomId('box:sort').setLabel(sortByDuplicates ? 'Duplicates' : rarityFirst ? 'Rarity' : 'Recent').setEmoji('🔄').setStyle(ButtonStyle.Primary)
        ),
        ...[rarityButtonOptions.slice(0, 5), rarityButtonOptions.slice(5)].map((group) =>
          new ActionRowBuilder().addComponents(group.map(([key, label]) => {
            const button = new ButtonBuilder()
              .setCustomId(`box:rarity:${key}`)
              .setStyle(rarityButton === key ? ButtonStyle.Success : ButtonStyle.Secondary);
            const emoji = key === 'all' ? '' : RARITY_EMOJIS[key];
            if (emoji) button.setEmoji(emoji);
            else button.setLabel(label);
            return button;
          })))
      ];
      const boxMessage = await message.reply({ embeds: [pageEmbed()], components: pageButtons() });
      const collector = boxMessage.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 90000,
      });
      collector.on('collect', async (interaction) => {
        try {
        if (interaction.user.id !== message.author.id) {
          await interaction.reply({ content: `Use \`${PREFIX}box\` yourself to navigate storage.`, ephemeral: true });
          return;
        }
        if (interaction.customId === 'box:first') currentPage = 1;
        else if (interaction.customId === 'box:prev') currentPage = Math.max(1, currentPage - 1);
        else if (interaction.customId === 'box:next') currentPage = Math.min(totalPages, currentPage + 1);
        else if (interaction.customId === 'box:last') currentPage = totalPages;
        else if (interaction.customId === 'box:sort') {
          if (sortByDuplicates) { sortByDuplicates = false; rarityFirst = false; }
          else if (rarityFirst) { sortByDuplicates = true; }
          else rarityFirst = true;
          currentPage = 1;
        }
        else if (interaction.customId.startsWith('box:rarity:')) {
          rarityButton = interaction.customId.slice('box:rarity:'.length);
          totalPages = getTotalPages();
          currentPage = 1;
        }
        await interaction.deferUpdate();
        await boxMessage.edit({ embeds: [pageEmbed()], components: pageButtons() });
        } catch (error) {
          console.error('Failed to update PC box page:', error);
          if (interaction.deferred) {
            await interaction.followUp({ content: 'Could not update the PC box page.', ephemeral: true });
          } else if (!interaction.replied) {
            await interaction.reply({ content: 'Could not update the PC box page.', ephemeral: true });
          }
        }
      });
      collector.on('end', async () => {
        const disabled = pageButtons().map((row) => new ActionRowBuilder().addComponents(
          row.components.map((button) => ButtonBuilder.from(button).setDisabled(true))
        ));
        try {
          await boxMessage.edit({ components: disabled });
        } catch (error) {
          console.error('Failed to disable PC box controls:', error);
        }
      });
      return;
    }

    if ((command === 'item' || command === 'i') && args[0]?.toLowerCase() === 'info') {
      const query = args.slice(1).join(' ').toLowerCase().trim();
      if (['diveball', 'dive ball', 'diveballs', 'dive balls'].includes(query)) {
        const user = getUser(userId);
        return message.reply({
          embeds: [new EmbedBuilder()
            .setColor(0x0099ff)
            .setAuthor({ name: `${EMOJIS.diveball} Diveball — Item Information` })
            .setDescription(
              `An item used to capture Pokémon while fishing. It has an **85% catch chance**.\n\n` +
              `**You currently own:** ${EMOJIS.diveball} **${user.diveballs.toLocaleString()}x Diveball**\n\n` +
              `**Usage**\nUse the Diveball button during a \`${PREFIX}fish\` encounter.\n\n` +
              `**Method to obtain**\n` +
              `• Purchase from \`${PREFIX}fish shop\` for 50 ${EMOJIS.fishingtoken} Fishing Tokens each.\n` +
              `• Fishing quests`
            )
            .setThumbnail('https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/dive-ball.png')
            .setFooter({ text: `Item info: ${PREFIX}item info <item>` })],
        });
      }
      const voteBoxName = findVoteBox(query);
      if (voteBoxName) {
        const box = VOTE_BOXES[voteBoxName];
        const owned = getUserItems(userId).find((row) => row.item_name === voteBoxName)?.amount || 0;
        const amountText = (range) => range[1] === range[2]
          ? `${range[1]}`
          : `${range[1]}–${range[2]}`;
        return message.reply({
          embeds: [new EmbedBuilder()
            .setColor(0x0099ff)
            .setAuthor({ name: `${voteBoxName} — Item Information` })
            .setDescription(
              `A voting reward box containing PokéCoins and a chance at extra items.\n\n` +
              `**You currently own:** ${box.emoji} **${owned}x ${voteBoxName}**\n\n` +
              `**Rewards when opened**\n` +
              `• 1 Vote Coin and ${box.coins[0].toLocaleString()}–${box.coins[1].toLocaleString()} PokéCoins\n` +
              `• Rare Candy: ${(box.rareCandies[0] * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}% chance (${amountText(box.rareCandies)})\n` +
              `• Egg: ${(box.eggs[0] * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}% chance (${amountText(box.eggs)})\n` +
              `• Masterball: ${(box.masterballs[0] * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}% chance\n\n` +
              `**Usage**\nOpen with \`${PREFIX}open ${box.aliases[0]} [amount|all]\`.`
            )],
        });
      }
      const infoBox = findBox(query);
      if (infoBox) {
        const box = BOXES[infoBox];
        const ownedBoxes = getUserItems(userId).find((row) => row.item_name === infoBox)?.amount || 0;
        return message.reply({
          embeds: [new EmbedBuilder()
            .setColor(0x0099ff)
            .setAuthor({ name: `${infoBox} — Item Information` })
            .setDescription(
              `${box.description}\n\n` +
              `**You currently own:** ${box.emoji} **${ownedBoxes}x ${infoBox}**\n\n` +
              `**Usage**\nOpen with \`${PREFIX}open ${box.aliases[0]} [amount|all]\`.\n\n` +
              '**How to obtain**\n• 🎉 Item giveaways\n• Special events\n\n' +
              `**Can be held by Pokémon?** ✅ Yes — \`${PREFIX}team give ${box.aliases[0]} <slot|name>\``
            )],
        });
      }
      if (query.includes('lootbox') || query === 'lb' || query === 'lootboxes') {
        const user = getUser(userId);
        const chanceBoost = 1 + getPatreonPerks(userId).lootboxBoost;
        const chanceText = (chance) =>
          `${(chance * chanceBoost * 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
        const embed = new EmbedBuilder()
          .setColor(0x0099ff)
          .setAuthor({ name: 'Lootbox — Item Information' })
          .setDescription(
            `Opening a Lootbox always grants ${EMOJIS.pokecoin} 50–1,050 PokéCoins and ${EMOJIS.pokeball} 3–6 Pokéballs. ` +
            `${getPatreonPerks(userId).lootboxBoost ? 'Your Patreon perk increases item drop chances by 10% relative.' : 'Legendary Patreon and above increase item drop chances by 10% relative.'}\n\n` +
            `**Additional drops (each roll is independent)**\n` +
            `• Greatball: ${chanceText(0.75)} (1–4)\n` +
            `• Ultraball: ${chanceText(0.35)} (1–2)\n` +
            `• Masterball: ${chanceText(0.005)} (1)\n` +
            `• Repel: ${chanceText(0.12)} (1)\n` +
            `• Golden Razz Berry: ${chanceText(0.12)} (1)\n` +
            `• Egg: ${chanceText(0.09)} (1)\n` +
            `• Quest Reset Scroll: ${chanceText(0.08)} (1)\n` +
            `• Rare Candy: ${chanceText(0.01)} (1)\n\n` +
            `**You currently own:** ${LOOTBOX_EMOJI} **${user.lootboxes}x Lootbox**\n\n` +
            `**Usage**\n` +
            `Open lootboxes with \`${PREFIX}lootbox open [amount|all]\` or \`${PREFIX}lb [amount|all]\`.\n\n` +
            `**How to obtain**\n` +
            `• Complete quests that offer Lootboxes as a reward.\n` +
            `• Earn them from World Boss and other event rewards.\n\n` +
            `**Can be held by Pokémon?** ✅ Yes — \`${PREFIX}team give lootbox <slot|name>\``
          )
          .setThumbnail('https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/treasure-box.png')
          .setFooter({ text: `Item info: ${PREFIX}item info <item>` });
        return message.reply({ embeds: [embed] });
      }
      if (query.includes('repel')) {
        const user = getUser(userId);
        const itemDetails = query.includes('max')
          ? {
            name: 'Max Repel',
            modifier: 'max_repel',
            owned: getUserItems(userId).find((row) => row.item_name === 'Max Repel')?.amount || 0,
            field: 'max_repel_encounters',
            command: 'maxrepel',
            price: 15000,
            description: 'strongly reduces Common encounters and boosts Rare and Super Rare encounters',
          }
          : query.includes('super')
            ? {
              name: 'Super Repel',
              modifier: 'super_repel',
              emoji: EMOJIS.superRepel,
              owned: getUserItems(userId).find((row) => row.item_name === 'Super Repel')?.amount || 0,
              field: 'super_repel_encounters',
              command: 'superrepel',
              price: 10000,
              description: 'reduces Common encounters and boosts Rare and Super Rare encounters',
            }
            : {
              name: 'Repel',
              modifier: 'repel',
              owned: user.repels,
              field: 'repel_encounters',
              command: 'repel',
              price: 5000,
              description: 'reduces Common encounters while boosting Uncommon and Rare encounters',
            };
        return message.reply({
          embeds: [new EmbedBuilder()
            .setColor(0x0099ff)
            .setAuthor({ name: `${itemDetails.name} — Item Information` })
            .setDescription(
              `${itemDetails.name} ${itemDetails.description}. Each unit lasts for 30 land encounters. ` +
              `Only one encounter modifier can be active at a time.\n\n` +
              (itemDetails.modifier === 'max_repel'
                ? ''
                : `**Land encounter weights:** ${formatEncounterWeights(itemDetails.modifier)}\n\n`) +
              `**You currently own:** ${itemDetails.emoji || EMOJIS.repel} **${itemDetails.owned.toLocaleString()}x ${itemDetails.name}**\n` +
              `**Active:** ${user[itemDetails.field].toLocaleString()} encounters remaining\n\n` +
              `**Usage**\nUse \`${PREFIX}${itemDetails.command} [amount]\`.\n\n` +
              `**How to obtain**\nBuy for ${EMOJIS.pokecoin} **${itemDetails.price.toLocaleString()} each** ` +
              `with \`${PREFIX}shop buy ${itemDetails.name.toLowerCase()} [amount]\`.\n\n` +
              '**Can be held by Pokémon?** ❌ No'
            )
            .setThumbnail('https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/repel.png')
            .setFooter({ text: `Item info: ${PREFIX}item info <item>` })],
        });
      }
      if (query === 'pokeradar') {
        const owned = getUserItems(userId).find((row) => row.item_name === 'Pokeradar')?.amount || 0;
        return message.reply({
          embeds: [new EmbedBuilder()
            .setColor(0x0099ff)
            .setAuthor({ name: 'Pokeradar — Item Information' })
            .setDescription(
              `Increases the rate at which you encounter ${EMOJIS.shiny} Pokémon by 10%. 1 charge is used for every encounter.\n\n` +
              `**You currently own:** ${EMOJIS.pokeradar} **${owned.toLocaleString()}x Pokeradar**\n` +
              `**Active charges:** ${getUser(userId).pokeradar_charges.toLocaleString()}\n\n` +
              `**Usage**\nTo use a Pokeradar, type \`${PREFIX}pokeradar {amt}\`. Each pokeradar used provides ${BASE_POKERADAR_CHARGES} charges.\n\n` +
              `**Method to obtain**\n• Purchase one for 10 ${EMOJIS.votecoin} Vote Coins: \`${PREFIX}s buy 44\`\n• Higher Patreon tiers receive them monthly (\`${PREFIX}monthly\`)`
            )
            .setFooter({ text: `Item info: ${PREFIX}item info <item>` })],
        });
      }
      if (query === 'boss coin' || query === 'bosscoin') {
        const owned = getUserItems(userId).find((row) => row.item_name === 'Boss Coin')?.amount || 0;
        return message.reply({
          embeds: [new EmbedBuilder()
            .setColor(0x0099ff)
            .setAuthor({ name: 'Boss Coin — Item Information' })
            .setDescription(
              'Allows any user to spawn a random World Boss directly. ' +
              'While spawning, you receive MVP-style rewards if the boss is defeated: higher Gigantamax drop rates, extra item rolls and a higher PokéCoin reward.\n\n' +
              `**You currently own:** ${EMOJIS.bosscoin} **${owned.toLocaleString()}x Boss Coin**\n\n` +
              `**Usage**\nType \`${PREFIX}worldboss spawn\`.\n\n` +
              `**Method to obtain**\n• Buy for 1,000 ${EMOJIS.patreonToken} Patreon Tokens: \`${PREFIX}shop buy 50\`\n• Golden Patreon monthly reward`
            )
            .setFooter({ text: `Item info: ${PREFIX}item info <item>` })],
        });
      }
      if (query === 'cooldown machine' || query === 'cooldownmachine') {
        const user = getUser(userId);
        const owned = getUserItems(userId).find((row) => row.item_name === 'Cooldown Machine')?.amount || 0;
        return message.reply({
          embeds: [new EmbedBuilder()
            .setColor(0x0099ff)
            .setAuthor({ name: 'Cooldown Machine — Item Information' })
            .setDescription(
              `Halves the normal cooldown for your next eligible \`${PREFIX}pokemon\` or \`${PREFIX}fish\` use.\n\n` +
              `**You currently own:** ${EMOJIS.cooldownMachine} ${owned}x Cooldown Machine\n` +
              `**Loaded charges:** ${user.cooldown_machine_catch_charges} ${PREFIX}pokemon • ` +
              `${user.cooldown_machine_fish_charges} ${PREFIX}fish\n\n` +
              `**Usage**\nUse \`${PREFIX}cooldown [quantity]\`, then choose \`${PREFIX}pokemon\` or \`${PREFIX}fish\`. ` +
              `After half the normal cooldown, that command spends one loaded charge to run early. ` +
              `Waiting the full cooldown does not consume a charge.\n\n` +
              `**How to obtain**\n• Buy with 1 ${EMOJIS.votecoin} Vote Coin: \`${PREFIX}shop buy 99\`\n` +
              `• Buy with 1 ${EMOJIS.patreonToken} Patreon Token: \`${PREFIX}shop buy 100\`\n` +
              '• Monthly Legendary, Shiny, and Golden Patreon rewards\n\n' +
              '**Can be held by Pokémon?** ❌ No'
            )
            .setFooter({ text: `Item info: ${PREFIX}item info <item>` })],
        });
      }
      if (query === 'ability capsule' || query === 'abilitycapsule'
          || query === 'ability patch' || query === 'abilitypatch') {
        const isPatch = query.includes('patch');
        const itemName = isPatch ? 'Ability Patch' : 'Ability Capsule';
        const owned = getUserItems(userId).find((row) => row.item_name === itemName)?.amount || 0;
        return message.reply({
          embeds: [new EmbedBuilder()
            .setColor(0x0099ff)
            .setAuthor({ name: `${itemName} — Item Information` })
            .setDescription(
              (isPatch
                ? 'A consumable item that changes a Pokémon to its Hidden Ability. It has no effect if the Pokémon is already using its Hidden Ability or has no Hidden Ability.'
                : 'A consumable item that switches a Pokémon to its other Standard or Secondary ability. It has no effect if the Pokémon has only one non-Hidden ability.') +
              `\n\n**You currently own:** ${isPatch ? EMOJIS.abilityPatch : EMOJIS.abilityCapsule} ${owned}x ${itemName}\n\n` +
              `**Usage**\nUse \`${PREFIX}bud info <Pokémon>\`, then select the ability to apply.\n\n` +
              `**How to obtain**\n• Buy for ${isPatch ? 150 : 50} ${EMOJIS.votecoin} Vote Coins: ` +
              `\`${PREFIX}shop buy ${isPatch ? 74 : 73}\`\n` +
              '**Can be held by Pokémon?** ❌ No'
            )
            .setFooter({ text: `Item info: ${PREFIX}item info <item>` })],
        });
      }
      if (query === 'incense') {
        const owned = getUserItems(userId).find((row) => row.item_name === 'Incense')?.amount || 0;
        return message.reply({
          embeds: [new EmbedBuilder()
            .setColor(0x0099ff)
            .setAuthor({ name: 'Incense — Item Information' })
            .setDescription(
              `Increases the rate at which you encounter ${EMOJIS.shiny} Pokémon & increases promo item rates by 10% ` +
              `for \`${PREFIX}pokemon\`, \`${PREFIX}fish\`, \`${PREFIX}battle\` and \`${PREFIX}egg hatch\` commands.\n\n` +
              '1 charge is used for every encounter or every time a boost is applied. ' +
              'Charges are shared for all members in this server.\n\n' +
              `**You currently own:** ${EMOJIS.incense} **${owned.toLocaleString()}x Incense**\n\n` +
              `**Usage**\nTo use an incense, type \`${PREFIX}incense {amt}\`. Each incense provides a base amount of ` +
              `${BASE_INCENSE_CHARGES} charges. Higher Patreon tiers provide extra charges. Check \`${PREFIX}perks\` for more information.\n` +
              `• Check available incense charges in this server using \`${PREFIX}incense\`\n\n` +
              `**Method to obtain**\n• Buy for 100 ${EMOJIS.patreonToken} Patreon Tokens: \`${PREFIX}shop buy 47\``
            )
            .setFooter({ text: `Item info: ${PREFIX}item info <item>` })],
        });
      }
      if (query === 'honey') {
        const user = getUser(userId);
        const owned = getUserItems(userId).find((row) => row.item_name === 'Honey')?.amount || 0;
        return message.reply({
          embeds: [new EmbedBuilder()
            .setColor(0x0099ff)
            .setAuthor({ name: 'Honey — Item Information' })
            .setDescription(
              `Honey attracts Common Pokémon while reducing other encounter rarities. Each Honey lasts for 30 land encounters. ` +
              `Only one encounter modifier can be active at a time.\n\n` +
              `**Land encounter weights:** ${formatEncounterWeights('honey')}\n\n` +
              `**You currently own:** ${EMOJIS.honey} **${owned.toLocaleString()}x Honey**\n` +
              `**Active:** ${user.honey_encounters.toLocaleString()} encounters remaining\n\n` +
              `**Usage**\nUse \`${PREFIX}honey [amount]\`.\n\n` +
              `**How to obtain**\nBuy for ${EMOJIS.pokecoin} **5,000 each** with \`${PREFIX}shop buy honey [amount]\`.\n\n` +
              '**Can be held by Pokémon?** ❌ No'
            )
            .setThumbnail('https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/honey.png')
            .setFooter({ text: `Item info: ${PREFIX}item info <item>` })],
        });
      }
      if (query.includes('ancient fossil')) {
        const owned = getUserItems(userId)
          .find((item) => item.item_name === 'Ancient Fossil')?.amount || 0;
        return message.reply({
          embeds: [new EmbedBuilder()
            .setColor(0x0099ff)
            .setAuthor({ name: 'Ancient Fossil — Item Information' })
            .setDescription(
              `A rare fossil that attracts Genesect to your special Legendary encounter pool.\n\n` +
              `**You currently own:** 🦴 **${owned.toLocaleString()}x Ancient Fossil**\n\n` +
              `**How to obtain**\n` +
              `• A **1/10,000** chance to find one when catching a Pokémon (CatchBot catches are excluded).\n\n` +
              `**Can be held by Pokémon?** ❌ No`
            )
            .setThumbnail('https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/old-amber.png')
            .setFooter({ text: `Item info: ${PREFIX}item info <item>` })],
        });
      }
      if (query.includes('quest reset') || query.includes('questreset') || query === 'scroll') {
        const user = getUser(userId);
        return message.reply({
          embeds: [new EmbedBuilder()
            .setColor(0x0099ff)
            .setAuthor({ name: 'Quest Reset Scroll — Item Information' })
            .setDescription(
              `Reset one of your active rotating quests to a new quest.\n\n` +
              `**You currently own:** 📜 **${user.quest_reset_scrolls}x Quest Reset Scroll**\n\n` +
              `**Usage**\nUse \`${PREFIX}quest reset <1-3>\`.\n\n` +
              `**How to obtain**\nBuy for ${EMOJIS.pokecoin} **10,000 each** with \`${PREFIX}shop buy quest reset scroll [amount]\`.\n\n` +
              '**Can be held by Pokémon?** ❌ No'
            )
            .setThumbnail('https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/town-map.png')
            .setFooter({ text: `Item info: ${PREFIX}item info <item>` })],
        });
      }
      if (query.includes('amulet') || query.includes('amulet coin')) {
        const boost = getAmuletCoinBoost(userId);
        const embed = new EmbedBuilder()
          .setColor(0x0099ff)
          .setAuthor({ name: 'Amulet Coin — Item Information' })
          .setDescription(
            `Provides a **+5% PokéCoin reward boost per effective Amulet Coin**.\n\n` +
            `**You currently own:** ${EMOJIS.amuletcoin} **${boost.owned}/10 Amulet Coins**\n` +
            `**Effective bonus:** **+${boost.percentBoost}%** ` +
            `(${boost.invisible} invisible bonus coin${boost.invisible === 1 ? '' : 's'} included)\n\n` +
            `**Usage**\nAutomatically active when you earn PokéCoins.\n\n` +
            `**How to obtain**\n` +
            `• Buy for ${EMOJIS.pokecoin} **150,000 each** with \`${PREFIX}shop buy amulet coin [amount]\` (maximum 10 purchased).\n` +
            `• Gold and Amethyst clan perks provide invisible Amulet Coins (Amethyst includes both perk levels).\n` +
            `• Patreon perks provide +4 invisible Amulet Coins.\n\n` +
            `**Can be held by Pokémon?** ❌ No`
          )
          .setThumbnail('https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/amulet-coin.png')
          .setFooter({ text: `Item info: ${PREFIX}item info <item>` });
        return message.reply({ embeds: [embed] });
      }
      if (query.includes('shiny charm') || query.includes('shinycharm')) {
        const user = getUser(userId);
        const embed = new EmbedBuilder()
          .setColor(0x0099ff)
          .setAuthor({ name: 'Shiny Charm — Item Information' })
          .setDescription(
            `Each charm adds **+1 percentage point** to your shiny encounter chance, up to **5 shop charms**. ` +
            `Clan Shiny Rate bonuses also apply.\n\n` +
            `**You own:** ${EMOJIS.shinyCharm} **${user.shiny_charms}/5 shop charms**\n` +
            `**Effective bonus:** **+${getTotalEffectiveShinyBonus(userId)}%** ` +
            '(includes applicable clan and account bonuses)\n\n' +
            `Buy for **25 Vote Coins each** with \`${PREFIX}shop buy 8 [amount]\`.`
          )
          .setThumbnail('https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/shiny-charm.png');
        return message.reply({ embeds: [embed] });
      }
      const rod = ROD_CONFIGS[query];
      if (!rod) {
        return message.reply(`Usage: \`${PREFIX}item info <old rod|good rod|super rod|golden rod>\`.`);
      }
      const embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setAuthor({ name: `${rod.name} — Item Information` })
        .setDescription(
          `**Spawn chance:** ${(rod.baseSpawnChance * 100).toFixed(0)}%\n` +
          `**Shiny rate:** ${rod.enablesShiny ? `1/${Math.round(1 / rod.baseShinyRate).toLocaleString()}` : 'Unavailable'}\n` +
          `**Cooldown:** ${rod.cooldownMs / 1000}s\n` +
          `**Reel time:** ${rod.pullWaitMs / 1000}s\n` +
          `**Legendary Pokémon:** ${rod.enablesLegendary ? 'Available' : 'Unavailable'}\n\n` +
          (rod.name === 'Old Rod'
            ? 'Automatically equipped as your starter rod.'
            : rod.name === 'Golden Rod'
              ? `Buy with 100 ${EMOJIS.votecoin} Vote Coins. Requires both Good and Super Rods. ` +
                'Its 2× Golden-variant bonus is inactive because the game has no Golden Pokémon variants.'
              : `Buy with ${rod.name === 'Good Rod' ? '100' : '2,500'} ${EMOJIS.fishingtoken} Fishing Tokens via \`${PREFIX}shop buy ${rod.name === 'Good Rod' ? 5 : 6}\`.`)
        )
        .setThumbnail(rod.img);
      return message.reply({ embeds: [embed] });
    }

    if (command === 'shop' && args[0]?.toLowerCase() !== 'buy') {
      const shopCategories = {
        balls: {
          label: 'Main',
          emoji: EMOJIS.pokeball,
          description:
            `══════════ **Balls** ══════════\n` +
            `\`1\` ${EMOJIS.pokeball} **Pokeball** — 200 ${EMOJIS.pokecoin}\n` +
            `\`2\` ${EMOJIS.greatball} **Greatball** — 500 ${EMOJIS.pokecoin}\n` +
            `\`3\` ${EMOJIS.ultraball} **Ultraball** — 1,500 ${EMOJIS.pokecoin}\n` +
            `\`4\` ${EMOJIS.masterball} **Masterball** — 50,000 ${EMOJIS.pokecoin}\n` +
            `══════════ **Items** ══════════\n` +
            `\`11\` ${EMOJIS.amuletcoin} **Amulet Coin** — 150,000 ${EMOJIS.pokecoin}\n` +
            `\`13\` 📜 **Quest Scroll** — 10,000 ${EMOJIS.pokecoin}\n` +
            `\`12\` ${EMOJIS.repel} **Repel [30 uses]** — 5,000 ${EMOJIS.pokecoin}\n` +
            `\`8\` ${EMOJIS.shinyCharm} **Shiny Charm** — 25 ${EMOJIS.votecoin}\n` +
            `\`24\` ${LOOTBOX_EMOJI} **Lootbox** — 1 ${EMOJIS.votecoin}\n` +
            `\`73\` ${EMOJIS.abilityCapsule} **Ability Capsule** — 50 ${EMOJIS.votecoin}\n` +
            `\`74\` ${EMOJIS.abilityPatch} **Ability Patch** — 150 ${EMOJIS.votecoin}\n` +
            `\`99\` ${EMOJIS.cooldownMachine} **Cooldown Machine** — 1 ${EMOJIS.votecoin}\n` +
            `══════════ **Buddy** ══════════\n` +
            `\`9\` ${EMOJIS.expshare} **EXP. Share** — 2,500,000 ${EMOJIS.pokecoin}\n` +
            `\`22\` ${EMOJIS.megabracelet} **Mega Bracelet** — 125 ${EMOJIS.votecoin}\n\n` +
            `\`${PREFIX}item info <item>\` for item description & usage`,
        },
        fishing: {
          label: 'Fishing',
          emoji: '🎣',
          description:
            `══════════ **Rods** ══════════\n` +
            `\`5\` ${EMOJIS.goodRod} **Good Rod** — 100 ${EMOJIS.fishingtoken}\n` +
            `\`6\` ${EMOJIS.superRod} **Super Rod** — 2,500 ${EMOJIS.fishingtoken}\n` +
            `\`7\` ${EMOJIS.goldenRod} **Golden Rod** — 100 ${EMOJIS.votecoin}\n` +
            `══════════ **Items** ══════════\n` +
            `\`14\` ${EMOJIS.diveball} **Dive Ball** — 50 ${EMOJIS.fishingtoken}\n` +
            `\`20\` ${EMOJIS.pokeLure} **Pokelure** — 50 ${EMOJIS.fishingtoken}\n` +
            `\`21\` ${EMOJIS.mistysLure} **Misty's Lure** — 150 ${EMOJIS.fishingtoken}\n\n` +
            `\`${PREFIX}item info <item>\` for item usage & info`,
        },
        battle: {
          label: 'Battle',
          emoji: '⚔️',
          description:
            `\`23\` ${FUN_ITEM_EMOJIS['Sitrus Berry']} **Sitrus Berry** — ${EMOJIS.pokecoin} 2,500 Coins each`,
        },
        vote: {
          label: 'Vote',
          emoji: EMOJIS.votecoin,
          description:
            `══════════ **Boxes** ══════════\n` +
            `\`24\` ${LOOTBOX_EMOJI} **Lootbox** — 1 ${EMOJIS.votecoin}\n` +
            `\`26\` ${VOTE_BOXES['Vote Rare Box'].emoji} **Rare Box** — 2 ${EMOJIS.votecoin}\n` +
            `\`27\` ${VOTE_BOXES['Vote Super Rare Box'].emoji} **Super Rare Box** — 5 ${EMOJIS.votecoin}\n` +
            `\`28\` ${VOTE_BOXES['Vote Legendary Box'].emoji} **Legendary Box** — 10 ${EMOJIS.votecoin}\n` +
            `\`29\` ${VOTE_BOXES['Vote Shiny Box'].emoji} **Shiny Box** — 25 ${EMOJIS.votecoin}\n` +
            `══════════ **Items** ══════════\n` +
            `\`8\` ${EMOJIS.shinyCharm} **Shiny Charm** — 25 ${EMOJIS.votecoin}\n` +
            `\`22\` ${EMOJIS.megabracelet} **Mega Bracelet** — 125 ${EMOJIS.votecoin}\n` +
            `\`25\` 🎟️ **Double XP Ticket** — 3 ${EMOJIS.votecoin}\n` +
            `\`44\` ${EMOJIS.pokeradar} **Pokeradar** — 10 ${EMOJIS.votecoin}\n` +
            `\`30\` ${EMOJIS.incubator} **Incubator** — 10 ${EMOJIS.votecoin}\n` +
            `\`7\` ${EMOJIS.goldenRod} **Golden Rod** — 100 ${EMOJIS.votecoin}\n\n` +
            `\`${PREFIX}item info <item>\` for item usage & info`,
        },
        patreon: {
          label: 'Patreon',
          emoji: EMOJIS.patreonToken,
          description:
            `══════════ **Items** ══════════\n` +
            `\`31\` ${EMOJIS.superIncubator} **Super Incubator** — 50 ${EMOJIS.patreonToken}\n` +
            `\`47\` ${EMOJIS.incense} **Incense** — 100 ${EMOJIS.patreonToken}\n` +
            `\`100\` ${EMOJIS.cooldownMachine} **Cooldown Machine** — 1 ${EMOJIS.patreonToken}\n` +
            `\`50\` ${EMOJIS.bosscoin} **Boss Coin** — 1,000 ${EMOJIS.patreonToken}\n\n` +
            `\`${PREFIX}item info <item>\` for item usage & info`,
        },
      };
      let selectedCategory = 'balls';
      const buildShopEmbed = () => {
        const balance = getUser(userId);
        const category = shopCategories[selectedCategory];
        if (selectedCategory === 'fishing' || selectedCategory === 'vote' || selectedCategory === 'patreon') {
          return makeEmbed(
            selectedCategory === 'vote' ? '🗳️ PokéMart Vote Shop'
              : selectedCategory === 'patreon' ? '💎 PokéMart Patreon Shop' : '🎣 PokéMart Fishing Shop',
            (selectedCategory === 'fishing'
              ? `**${message.author.username}'s Fishing Tokens:** ${EMOJIS.fishingtoken} ${balance.fishing_tokens.toLocaleString()}\n`
              : '') +
            (selectedCategory === 'patreon'
              ? `**${message.author.username}'s Patreon Tokens:** ${EMOJIS.patreonToken} ${balance.patreon_tokens.toLocaleString()}\n\n`
              : `**${message.author.username}'s VoteCoins:** ${EMOJIS.votecoin} ${balance.vote_coins.toLocaleString()}\n\n`) +
            `${category.description}\n\n` +
            `Buy with \`${PREFIX}shop buy <number|item> [amount]\`.`,
            0xf1c40f
          );
        }
        return makeEmbed(
          `🛒 PokéMart — ${category.label}`,
          (selectedCategory === 'balls' ? '**Buy some items for your adventure!**\n\n' : '') +
          `**${message.author.username}'s PokeCoins:** ${EMOJIS.pokecoin} ${balance.coins.toLocaleString()}\n` +
          `**${message.author.username}'s VoteCoins:** ${EMOJIS.votecoin} ${balance.vote_coins.toLocaleString()}\n` +
          `${EMOJIS.fishingtoken} ${balance.fishing_tokens.toLocaleString()} Fishing Tokens • ` +
          `${EMOJIS.patreonToken} ${balance.patreon_tokens.toLocaleString()} Patreon Tokens\n\n` +
          `${category.description}\n\n` +
          `Buy with \`${PREFIX}shop buy <number|item> [amount]\`. Clan Shop Boost and Super Rare+ Patreon discounts apply to PokéCoin prices.`,
          0xf1c40f
        );
      };
      const buildShopButtons = (disabled = false) => {
        const buttons = Object.entries(shopCategories).map(([key, category]) =>
          new ButtonBuilder()
            .setCustomId(`shop-category:${key}`)
            .setLabel(category.label)
            .setEmoji(category.emoji)
            .setStyle(selectedCategory === key ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(disabled)
        );
        const rows = [];
        for (let i = 0; i < buttons.length; i += 5) {
          rows.push(new ActionRowBuilder().addComponents(...buttons.slice(i, i + 5)));
        }
        return rows;
      };
      const shopMessage = await message.reply({
        embeds: [buildShopEmbed()],
        components: buildShopButtons(),
      });
      const shopCollector = shopMessage.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 120000,
      });
      shopCollector.on('collect', async (interaction) => {
        if (interaction.user.id !== message.author.id) {
          return interaction.reply({ content: `Run \`${PREFIX}shop\` to browse your own shop.`, ephemeral: true });
        }
        const category = interaction.customId.split(':')[1];
        if (!Object.hasOwn(shopCategories, category)) {
          return interaction.reply({ content: 'That shop category is unavailable.', ephemeral: true });
        }
        selectedCategory = category;
        return interaction.update({
          embeds: [buildShopEmbed()],
          components: buildShopButtons(),
        });
      });
      shopCollector.on('end', () => {
        shopMessage.edit({ components: buildShopButtons(true) }).catch((error) => {
          console.error('Failed to disable expired shop category buttons:', error);
        });
      });
      return;
    }

    if (command === 'shop' && args[0]?.toLowerCase() === 'buy') {
      const purchaseArgs = args.slice(1);
      if (!purchaseArgs.length) {
        return message.reply(`Usage: \`${PREFIX}shop buy <number|item> [amount]\`. Use \`${PREFIX}shop\` to view item numbers.`);
      }
      const threeWordItem = purchaseArgs.slice(0, 3).join(' ').toLowerCase();
      const twoWordItem = purchaseArgs.slice(0, 2).join(' ').toLowerCase();
      const hasThreeWordItem = ['quest reset scroll', 'super rare box', 'double xp ticket'].includes(threeWordItem);
      const hasMultiWordItem = [
        'rare box',
        'legendary box',
        'shiny box',
        'vote incubator',
        'double xp',
        'poke ball',
        'great ball',
        'ultra ball',
        'master ball',
        'dive ball',
        'boss coin',
        'shiny charm',
        'shiny charm',
        'good rod',
        'super rod',
        'golden rod',
        'rare candy',
        'exp share',
        'amulet coin',
        'mega bracelet',
        'super repel',
        'max repel',
        'super incubator',
        'sitrus berry',
        'cooldown machine',
        'ability capsule',
        'ability patch',
        'poke lure',
        "misty's lure",
      ].includes(twoWordItem) || hasThreeWordItem;
      const itemInput = hasThreeWordItem
        ? threeWordItem
        : hasMultiWordItem ? twoWordItem : purchaseArgs[0]?.toLowerCase();
      const indexedItems = {
        1: 'pb',
        2: 'gb',
        3: 'ub',
        4: 'mb',
        5: 'goodrod',
        6: 'superrod',
        7: 'goldenrod',
        8: 'shinycharm',
        9: 'expshare',
        10: 'rarecandy',
        11: 'amuletcoin',
        12: 'repel',
        13: 'questreset',
        14: 'diveball',
        15: 'superrepel',
        16: 'maxrepel',
        17: 'honey',
        18: 'incubator',
        19: 'superincubator',
        20: 'pokelure',
        21: 'mistyslure',
        22: 'megabracelet',
        23: 'sitrusberry',
        24: 'lootbox',
        25: 'doublexp',
        26: 'voterarebox',
        27: 'votesuperrarebox',
        28: 'votelegendarybox',
        29: 'voteshinybox',
        30: 'voteincubator',
        31: 'patsuperincubator',
        47: 'incense',
        44: 'pokeradar',
        50: 'bosscoin',
        73: 'abilitycapsule',
        74: 'abilitypatch',
        99: 'cooldownmachine',
        100: 'patcooldownmachine',
      };
      const item = {
        pb: 'pb',
        'poke ball': 'pb',
        pokeball: 'pb',
        gb: 'gb',
        'great ball': 'gb',
        greatball: 'gb',
        ub: 'ub',
        'ultra ball': 'ub',
        ultraball: 'ub',
        mb: 'mb',
        'master ball': 'mb',
        masterball: 'mb',
        'dive ball': 'diveball',
        diveball: 'diveball',
        diveballs: 'diveball',
        db: 'diveball',
        'exp-share': 'expshare',
        exp_share: 'expshare',
        'exp share': 'expshare',
        'rare-candy': 'rarecandy',
        rare_candy: 'rarecandy',
        'rare candy': 'rarecandy',
        rc: 'rarecandy',
        candy: 'rarecandy',
        i: 'incubator',
        incubator: 'incubator',
        'super incubator': 'superincubator',
        superincubator: 'superincubator',
        si: 'superincubator',
        'good-rod': 'goodrod',
        good_rod: 'goodrod',
        'super-rod': 'superrod',
        super_rod: 'superrod',
        'golden-rod': 'goldenrod',
        golden_rod: 'goldenrod',
        'shiny-charm': 'shinycharm',
        shiny_charm: 'shinycharm',
        'shiny charm': 'shinycharm',
        amulet: 'amuletcoin',
        amuletcoin: 'amuletcoin',
        'amulet coin': 'amuletcoin',
        'mega bracelet': 'megabracelet',
        megabracelet: 'megabracelet',
        lootbox: 'lootbox',
        'rare box': 'voterarebox',
        rarebox: 'voterarebox',
        'super rare box': 'votesuperrarebox',
        superrarebox: 'votesuperrarebox',
        'legendary box': 'votelegendarybox',
        legendarybox: 'votelegendarybox',
        'shiny box': 'voteshinybox',
        shinybox: 'voteshinybox',
        'double xp': 'doublexp',
        'double xp ticket': 'doublexp',
        doublexp: 'doublexp',
        doublexpticket: 'doublexp',
        'vote incubator': 'voteincubator',
        voteincubator: 'voteincubator',
        patsuperincubator: 'patsuperincubator',
        'pt super incubator': 'patsuperincubator',
        lootboxes: 'lootbox',
        repel: 'repel',
        'super repel': 'superrepel',
        superrepel: 'superrepel',
        'max repel': 'maxrepel',
        maxrepel: 'maxrepel',
        honey: 'honey',
        'boss coin': 'bosscoin',
        bosscoin: 'bosscoin',
        radar: 'pokeradar',
        pokeradar: 'pokeradar',
        'sitrus berry': 'sitrusberry',
        'cooldown machine': 'cooldownmachine',
        cooldownmachine: 'cooldownmachine',
        'ability capsule': 'abilitycapsule',
        abilitycapsule: 'abilitycapsule',
        'ability patch': 'abilitypatch',
        abilitypatch: 'abilitypatch',
        patcooldownmachine: 'patcooldownmachine',
        sitrus: 'sitrusberry',
        sitrusberry: 'sitrusberry',
        questreset: 'questreset',
        'quest reset scroll': 'questreset',
        scroll: 'questreset',
        'good rod': 'goodrod',
        'super rod': 'superrod',
        'golden rod': 'goldenrod',
        'poke lure': 'pokelure',
        pokelure: 'pokelure',
        pl: 'pokelure',
        "misty's lure": 'mistyslure',
        mistyslure: 'mistyslure',
        ml: 'mistyslure',
      }[itemInput] || indexedItems[itemInput] || itemInput;
      const amountArgumentIndex = hasThreeWordItem ? 3 : hasMultiWordItem ? 2 : 1;
      const amount = purchaseArgs[amountArgumentIndex] === undefined
        ? 1
        : parseAmount(purchaseArgs[amountArgumentIndex]);
      const prices = {
        pb: 200,
        gb: 500,
        ub: 1500,
        mb: 50000,
        goodrod: 1000,
        superrod: 2500,
        rarecandy: 1000,
        expshare: 2500000,
        amuletcoin: 150000,
        repel: 5000,
        superrepel: 10000,
        maxrepel: 15000,
        honey: 5000,
        sitrusberry: 2500,
        questreset: 10000,
        incubator: 10000,
        superincubator: 50000,
      };
      const fishingTokenPrices = { diveball: 50, pokelure: 50, mistyslure: 150 };
      if (!Number.isSafeInteger(amount) || amount <= 0) return message.reply('Specify a valid positive amount.');
      if (['goodrod', 'superrod', 'goldenrod'].includes(item)) {
        if (amount !== 1) return message.reply(`You can only buy one ${item.replace('rod', ' Rod')} at a time.`);
        const rodInfo = {
          goodrod: { name: 'Good Rod', tokens: 100 },
          superrod: { name: 'Super Rod', tokens: 2500 },
          goldenrod: { name: 'Golden Rod', votes: 100 },
        }[item];
        const rodResult = db.transaction(() => {
          const u = getUser(userId);
          if ((item === 'goodrod' && u.has_good_rod) || (item === 'superrod' && u.has_super_rod)
              || (item === 'goldenrod' && u.has_golden_rod)) return 'owned';
          if (item === 'goldenrod' && (!u.has_good_rod || !u.has_super_rod)) return 'prereq';
          if (rodInfo.votes) {
            if (u.vote_coins < rodInfo.votes) return 'poor';
            incrementUser(userId, { vote_coins: -rodInfo.votes });
            updateUser(userId, { has_golden_rod: 1, fish_rods: 'Golden Rod' });
          } else {
            if (u.fishing_tokens < rodInfo.tokens) return 'poor';
            incrementUser(userId, { fishing_tokens: -rodInfo.tokens });
            updateUser(userId, {
              has_good_rod: item === 'goodrod' ? 1 : u.has_good_rod,
              has_super_rod: item === 'superrod' ? 1 : u.has_super_rod,
              fish_rods: item === 'superrod' ? 'Super Rod' : (u.has_super_rod ? 'Super Rod' : 'Good Rod'),
            });
          }
          return 'ok';
        }).immediate();
        const costText = rodInfo.votes
          ? `${rodInfo.votes} ${EMOJIS.votecoin} Vote Coins`
          : `${rodInfo.tokens.toLocaleString()} ${EMOJIS.fishingtoken} Fishing Tokens`;
        if (rodResult === 'owned') return message.reply(`You already own the **${rodInfo.name}**.`);
        if (rodResult === 'prereq') return message.reply('❌ You need both a **Good Rod** and a **Super Rod** before buying a Golden Rod.');
        if (rodResult === 'poor') return message.reply(`❌ The ${rodInfo.name} costs **${costText}**, which you don't have.`);
        return message.reply(`🎣 You purchased a **${rodInfo.name}** for **${costText}**!`);
      }
      const voteCoinPrices = {
        shinycharm: 25, megabracelet: 125, lootbox: 1, doublexp: 3, voteincubator: 10,
        voterarebox: 2, votesuperrarebox: 5, votelegendarybox: 10, voteshinybox: 25,
        cooldownmachine: 1, abilitycapsule: 50, abilitypatch: 150,
      };
      const voteBoxItems = {
        voterarebox: 'Vote Rare Box', votesuperrarebox: 'Vote Super Rare Box',
        votelegendarybox: 'Vote Legendary Box', voteshinybox: 'Vote Shiny Box',
      };
      if (Object.hasOwn(voteCoinPrices, item)) {
        if (item === 'megabracelet' && amount !== 1) return message.reply('You can only buy one Mega Bracelet at a time.');
        const votePrice = voteCoinPrices[item] * amount;
        if (!Number.isSafeInteger(votePrice)) return message.reply('That purchase amount is too large.');
        const result = db.transaction(() => {
          const user = getUser(userId);
          if (item === 'megabracelet' && getUserItems(userId).some((o) => o.item_name === 'Mega Bracelet')) return 'owned';
          if (item === 'shinycharm' && user.shiny_charms + amount > 5) return 'charm_limit';
          if (user.vote_coins < votePrice) return 'poor';
          if (item === 'megabracelet') {
            incrementUser(userId, { vote_coins: -votePrice });
            addUserItem(userId, 'Mega Bracelet');
          } else if (item === 'shinycharm') {
            incrementUser(userId, { vote_coins: -votePrice, shiny_charms: amount });
          } else if (item === 'doublexp') {
            incrementUser(userId, { vote_coins: -votePrice });
            addUserItem(userId, 'Double XP Ticket', amount);
          } else if (item === 'voteincubator') {
            incrementUser(userId, { vote_coins: -votePrice });
            addUserItem(userId, 'Incubator', amount);
          } else if (voteBoxItems[item]) {
            incrementUser(userId, { vote_coins: -votePrice });
            addUserItem(userId, voteBoxItems[item], amount);
          } else if (['cooldownmachine', 'abilitycapsule', 'abilitypatch'].includes(item)) {
            incrementUser(userId, { vote_coins: -votePrice });
            const itemName = {
              cooldownmachine: 'Cooldown Machine',
              abilitycapsule: 'Ability Capsule',
              abilitypatch: 'Ability Patch',
            }[item];
            addUserItem(userId, itemName, amount);
          } else {
            incrementUser(userId, { vote_coins: -votePrice, lootboxes: amount });
          }
          return 'ok';
        }).immediate();
        if (result === 'owned') return message.reply(`You already own ${EMOJIS.megabracelet} **Mega Bracelet**.`);
        if (result === 'charm_limit') {
          return message.reply(`❌ You can own at most **5 shop Shiny Charms**. You currently have **${getUser(userId).shiny_charms}**.`);
        }
        if (result === 'poor') {
          return message.reply(
            `❌ That costs **${votePrice.toLocaleString()} ${EMOJIS.votecoin} Vote Coins**. ` +
            `You have **${getUser(userId).vote_coins.toLocaleString()}**.`
          );
        }
        const label = voteBoxItems[item]
          ? `${VOTE_BOXES[voteBoxItems[item]].emoji} ${voteBoxItems[item].replace('Vote ', '')}`
          : {
            shinycharm: `${EMOJIS.shinyCharm} Shiny Charm`,
            megabracelet: `${EMOJIS.megabracelet} Mega Bracelet`,
            lootbox: `${LOOTBOX_EMOJI} Lootbox`,
            doublexp: '🎟️ Double XP Ticket',
            voteincubator: `${EMOJIS.incubator} Incubator`,
            cooldownmachine: `${EMOJIS.cooldownMachine} Cooldown Machine`,
            abilitycapsule: `${EMOJIS.abilityCapsule} Ability Capsule`,
            abilitypatch: `${EMOJIS.abilityPatch} Ability Patch`,
          }[item];
        const hint = item === 'doublexp' ? ` Use it with \`${PREFIX}doublexp [amount]\`.` : '';
        return message.reply(
          `✅ Purchased **${amount}x ${label}** for **${votePrice.toLocaleString()} ${EMOJIS.votecoin} Vote Coins**.${hint}`
        );
      }
      if (item === 'pokeradar') {
        const votePrice = 10 * amount;
        if (!Number.isSafeInteger(votePrice)) return message.reply('That purchase amount is too large.');
        const bought = db.transaction(() => {
          if (getUser(userId).vote_coins < votePrice) return false;
          incrementUser(userId, { vote_coins: -votePrice });
          addUserItem(userId, 'Pokeradar', amount);
          return true;
        }).immediate();
        if (!bought) {
          return message.reply(
            `❌ That costs **${votePrice.toLocaleString()} ${EMOJIS.votecoin} Vote Coins**. ` +
            `You have **${getUser(userId).vote_coins.toLocaleString()}**.`
          );
        }
        return message.reply(
          `✅ Purchased **${amount}x ${EMOJIS.pokeradar} Pokeradar** for ` +
          `**${votePrice.toLocaleString()} ${EMOJIS.votecoin} Vote Coins**. Use it with \`${PREFIX}pokeradar ${amount}\`.`
        );
      }
      if (item === 'bosscoin' || item === 'boss coin') {
        const tokenPrice = 1000 * amount;
        if (!Number.isSafeInteger(tokenPrice)) return message.reply('That purchase amount is too large.');
        const bought = db.transaction(() => {
          if (getUser(userId).patreon_tokens < tokenPrice) return false;
          incrementUser(userId, { patreon_tokens: -tokenPrice });
          addUserItem(userId, 'Boss Coin', amount);
          return true;
        }).immediate();
        if (!bought) {
          return message.reply(
            `❌ That costs **${tokenPrice.toLocaleString()} ${EMOJIS.patreonToken} Patreon Tokens**. ` +
            `You have **${getUser(userId).patreon_tokens.toLocaleString()}**.`
          );
        }
        return message.reply(
          `✅ Purchased **${amount}x ${EMOJIS.bosscoin} Boss Coin** for ` +
          `**${tokenPrice.toLocaleString()} ${EMOJIS.patreonToken} Patreon Tokens**. Use it with \`${PREFIX}worldboss spawn\`.`
        );
      }
      if (item === 'patsuperincubator') {
        const tokenPrice = 50 * amount;
        if (!Number.isSafeInteger(tokenPrice)) return message.reply('That purchase amount is too large.');
        const bought = db.transaction(() => {
          if (getUser(userId).patreon_tokens < tokenPrice) return false;
          incrementUser(userId, { patreon_tokens: -tokenPrice });
          addUserItem(userId, 'Super Incubator', amount);
          return true;
        }).immediate();
        if (!bought) {
          return message.reply(
            `❌ That costs **${tokenPrice.toLocaleString()} ${EMOJIS.patreonToken} Patreon Tokens**. ` +
            `You have **${getUser(userId).patreon_tokens.toLocaleString()}**.`
          );
        }
        return message.reply(
          `✅ Purchased **${amount}x ${EMOJIS.superIncubator} Super Incubator** for ` +
          `**${tokenPrice.toLocaleString()} ${EMOJIS.patreonToken} Patreon Tokens**.`
        );
      }
      if (item === 'incense') {
        const tokenPrice = 100 * amount;
        if (!Number.isSafeInteger(tokenPrice)) return message.reply('That purchase amount is too large.');
        const bought = db.transaction(() => {
          if (getUser(userId).patreon_tokens < tokenPrice) return false;
          incrementUser(userId, { patreon_tokens: -tokenPrice });
          addUserItem(userId, 'Incense', amount);
          return true;
        }).immediate();
        if (!bought) {
          return message.reply(
            `❌ That costs **${tokenPrice.toLocaleString()} ${EMOJIS.patreonToken} Patreon Tokens**. ` +
            `You have **${getUser(userId).patreon_tokens.toLocaleString()}**.`
          );
        }
        return message.reply(
          `✅ Purchased **${amount}x ${EMOJIS.incense} Incense** for ` +
          `**${tokenPrice.toLocaleString()} ${EMOJIS.patreonToken} Patreon Tokens**. Use it with \`${PREFIX}incense ${amount}\`.`
        );
      }
      if (item === 'patcooldownmachine') {
        const tokenPrice = amount;
        const bought = db.transaction(() => {
          if (getUser(userId).patreon_tokens < tokenPrice) return false;
          incrementUser(userId, { patreon_tokens: -tokenPrice });
          addUserItem(userId, 'Cooldown Machine', amount);
          return true;
        }).immediate();
        if (!bought) {
          return message.reply(
            `❌ That costs **${tokenPrice.toLocaleString()} ${EMOJIS.patreonToken} Patreon Tokens**. ` +
            `You have **${getUser(userId).patreon_tokens.toLocaleString()}**.`
          );
        }
        return message.reply(
          `✅ Purchased **${amount}x ${EMOJIS.cooldownMachine} Cooldown Machine${amount === 1 ? '' : 's'}** for ` +
          `**${tokenPrice.toLocaleString()} ${EMOJIS.patreonToken} Patreon Tokens**.`
        );
      }
      if (!Object.hasOwn(prices, item) && !Object.hasOwn(fishingTokenPrices, item) && item !== 'goldenrod') {
        return message.reply('Invalid item! Check `.shop`.');
      }
      if (['goodrod', 'superrod', 'goldenrod', 'expshare', 'megabracelet'].includes(item) && amount !== 1) {
        return message.reply(`You can only buy one ${item === 'megabracelet' ? 'Mega Bracelet' : item.replace('rod', ' Rod')} at a time.`);
      }
      const baseCost = (prices[item] || 0) * amount;
      const shopDiscount = Math.min(0.9, getClanPerkMultipliers(getPlayerClan(userId)).shopDiscount + getPatreonPerks(userId).shopDiscount);
      const cost = Object.hasOwn(fishingTokenPrices, item) ? 0 : Math.floor(baseCost * (1 - shopDiscount));
      const tokenCost = (fishingTokenPrices[item] || 0) * amount;
      if (!Number.isSafeInteger(cost)) return message.reply('That purchase amount is too large.');
      if (!Number.isSafeInteger(tokenCost)) return message.reply('That purchase amount is too large.');

      const purchased = db.transaction(() => {
        const user = getUser(userId);
        if (item === 'expshare' && user.exp_share_owned) return 'already_owned';
        if (item === 'megabracelet'
            && getUserItems(userId).some((ownedItem) => ownedItem.item_name === 'Mega Bracelet')) {
          return 'already_owned_bracelet';
        }
        if (item === 'shinycharm' && user.shiny_charms + amount > 5) return 'charm_limit';
        if (item === 'amuletcoin' && user.amulet_coins + amount > 10) return 'amulet_limit';
        if (item === 'goodrod' && user.has_good_rod) return 'already_owned_rod';
        if (item === 'superrod' && user.has_super_rod) return 'already_owned_rod';
        if (item === 'goldenrod' && user.has_golden_rod) return 'already_owned_rod';
        if (item === 'goldenrod' && (!user.has_good_rod || !user.has_super_rod)) return 'rod_prerequisite';
        if (item === 'goldenrod') {
          if (user.fishing_tokens < 1000) return 'insufficient_tokens';
          incrementUser(userId, { fishing_tokens: -1000 });
          updateUser(userId, { has_golden_rod: 1, fish_rods: 'Golden Rod' });
          return true;
        }
        if (Object.hasOwn(fishingTokenPrices, item)) {
          if (user.fishing_tokens < tokenCost) return 'insufficient_lure_tokens';
          incrementUser(userId, { fishing_tokens: -tokenCost });
          if (item === 'diveball') incrementUser(userId, { diveballs: amount });
          else {
            const itemName = item === 'pokelure' ? 'Poké Lure' : "Misty's Lure";
            addUserItem(userId, itemName, amount);
          }
          return true;
        }
        if (user.coins < cost) return false;
        if (item === 'goodrod' || item === 'superrod') {
          const rod = item === 'superrod' ? 'Super Rod' : (user.has_super_rod ? 'Super Rod' : 'Good Rod');
          updateUser(userId, {
            coins: user.coins - cost,
            has_good_rod: item === 'goodrod' ? 1 : user.has_good_rod,
            has_super_rod: item === 'superrod' ? 1 : user.has_super_rod,
            fish_rods: rod,
          });
          return true;
        }
        if (item === 'expshare') {
          updateUser(userId, {
            coins: user.coins - cost,
            exp_share_owned: 1,
          });
          return true;
        }
        if (item === 'megabracelet') {
          incrementUser(userId, { coins: -cost });
          addUserItem(userId, 'Mega Bracelet');
          return true;
        }
        if (item === 'shinycharm') {
          incrementUser(userId, { coins: -cost, shiny_charms: amount });
          return true;
        }
        if (item === 'amuletcoin') {
          incrementUser(userId, { coins: -cost, amulet_coins: amount });
          return true;
        }
        if (item === 'rarecandy') {
          incrementUser(userId, { coins: -cost, rare_candies: amount });
          return true;
        }
        if (item === 'repel') {
          incrementUser(userId, { coins: -cost, repels: amount });
          return true;
        }
        if (item === 'questreset') {
          incrementUser(userId, { coins: -cost, quest_reset_scrolls: amount });
          return true;
        }
        if (item === 'incubator' || item === 'superincubator') {
          incrementUser(userId, { coins: -cost });
          addUserItem(userId, item === 'incubator' ? 'Incubator' : 'Super Incubator', amount);
          return true;
        }
        if (['superrepel', 'maxrepel', 'honey', 'sitrusberry'].includes(item)) {
          const itemName = {
            superrepel: 'Super Repel',
            maxrepel: 'Max Repel',
            honey: 'Honey',
            sitrusberry: 'Sitrus Berry',
          }[item];
          incrementUser(userId, { coins: -cost });
          addUserItem(userId, itemName, amount);
          return true;
        }
        const column = {
          pb: 'pokeballs',
          gb: 'greatballs',
          ub: 'ultraballs',
          mb: 'masterballs',
        }[item];
        incrementUser(userId, { coins: -cost, [column]: amount });
        return true;
      }).immediate();
      if (purchased === 'already_owned') {
        return message.reply(`You already own ${EMOJIS.expshare} **Exp. Share**.`);
      }
      if (purchased === 'already_owned_bracelet') {
        return message.reply(`You already own ${EMOJIS.megabracelet} **Mega Bracelet**.`);
      }
      if (purchased === 'already_owned_rod') {
        return message.reply(`You already own the **${item.replace('rod', ' Rod')}**.`);
      }
      if (purchased === 'charm_limit') {
        return message.reply(
          `❌ You can own at most **5 shop Shiny Charms**. You currently have **${getUser(userId).shiny_charms}**.`
        );
      }
      if (purchased === 'amulet_limit') {
        return message.reply(
          `❌ You can own at most **10 shop Amulet Coins**. You currently have **${getUser(userId).amulet_coins}**.`
        );
      }
      if (purchased === 'rod_prerequisite') {
        return message.reply('❌ You need both a **Good Rod** and a **Super Rod** before buying a Golden Rod.');
      }
      if (purchased === 'insufficient_tokens') {
        return message.reply(
          `❌ A Golden Rod costs **1,000 ${EMOJIS.fishingtoken} Fishing Tokens**. ` +
          `You have **${getUser(userId).fishing_tokens.toLocaleString()}**.`
        );
      }
      if (purchased === 'insufficient_lure_tokens') {
        return message.reply(
          `❌ This purchase costs **${tokenCost.toLocaleString()} ${EMOJIS.fishingtoken} Fishing Tokens**. ` +
          `You have **${getUser(userId).fishing_tokens.toLocaleString()}**.`
        );
      }
      if (!purchased) return message.reply(`❌ You need ${EMOJIS.pokecoin} **${cost}** coins to buy that, but don't have enough.`);
      if (item === 'goodrod' || item === 'superrod') {
        return message.reply(
          `🎣 You purchased a **${item === 'goodrod' ? 'Good Rod' : 'Super Rod'}** for ` +
          `${EMOJIS.pokecoin} **${cost.toLocaleString()} PokéCoins**!`
        );
      }
      if (item === 'goldenrod') {
        return message.reply(`🏆 You bought the **Golden Rod** for 1,000 ${EMOJIS.fishingtoken} Fishing Tokens!`);
      }
      if (Object.hasOwn(fishingTokenPrices, item)) {
        const itemName = item === 'diveball'
          ? 'Diveball'
          : item === 'pokelure' ? 'Poké Lure' : "Misty's Lure";
        const itemEmoji = item === 'diveball'
          ? EMOJIS.diveball
          : item === 'pokelure' ? EMOJIS.pokeLure : EMOJIS.mistysLure;
        if (item === 'diveball') {
          return message.reply(
            `✅ Purchased **${amount} ${itemEmoji} Diveball${amount === 1 ? '' : 's'}** for ` +
            `**${tokenCost.toLocaleString()} ${EMOJIS.fishingtoken} Fishing Tokens**.`
          );
        }
        return message.reply(
          `✅ Purchased **${amount} ${itemEmoji} ${itemName}${amount === 1 ? '' : 's'}** for ` +
          `**${tokenCost.toLocaleString()} ${EMOJIS.fishingtoken} Fishing Tokens**. ` +
          `Activate with \`${PREFIX}use ${item === 'pokelure' ? 'pl' : 'ml'} [amount]\`.`
        );
      }
      if (item === 'expshare') {
        return message.reply(
          `✅ Purchased ${EMOJIS.expshare} **Exp. Share** for ${EMOJIS.pokecoin} **${cost.toLocaleString()} PokéCoins**. ` +
          `Enable it with \`${PREFIX}team expshare on\`.`
        );
      }
      if (item === 'megabracelet') {
        return message.reply(
          `✅ Purchased ${EMOJIS.megabracelet} **Mega Bracelet** for ` +
          `${EMOJIS.pokecoin} **${cost.toLocaleString()} PokéCoins**.`
        );
      }
      if (item === 'shinycharm') {
        return message.reply(
          `✨ Purchased **${amount} Shiny Charm${amount === 1 ? '' : 's'}** for ` +
          `${EMOJIS.pokecoin} **${cost.toLocaleString()} PokéCoins** ` +
          `(${getUser(userId).shiny_charms}/5 shop charms).`
        );
      }
      if (item === 'amuletcoin') {
        const owned = getUser(userId).amulet_coins;
        return message.reply(
          `✅ Purchased ${EMOJIS.amuletcoin} **${amount} Amulet Coin${amount === 1 ? '' : 's'}** for ` +
          `${EMOJIS.pokecoin} **${cost.toLocaleString()} PokéCoins** (${owned}/10 purchased).`
        );
      }
      if (item === 'rarecandy') {
        return message.reply(
          `✅ Purchased ${EMOJIS.rarecandy} **${amount} Rare Candy${amount === 1 ? '' : 's'}** ` +
          `for ${EMOJIS.pokecoin} **${cost.toLocaleString()} PokéCoins**.`
        );
      }
      if (item === 'incubator' || item === 'superincubator') {
        const isSuper = item === 'superincubator';
        return message.reply(
          `✅ Purchased ${amount}x ${isSuper ? EMOJIS.superIncubator + ' **Super Incubator**' : EMOJIS.incubator + ' **Incubator**'} ` +
          `for ${EMOJIS.pokecoin} **${cost.toLocaleString()} PokéCoins**.`
        );
      }
      if (['repel', 'questreset', 'superrepel', 'maxrepel', 'honey', 'sitrusberry'].includes(item)) {
        const itemName = {
          repel: 'Repel',
          questreset: 'Quest Reset Scroll',
          superrepel: 'Super Repel',
          maxrepel: 'Max Repel',
          honey: 'Honey',
          sitrusberry: 'Sitrus Berry',
        }[item];
        const emoji = {
          repel: EMOJIS.repel,
          questreset: '📜',
          superrepel: EMOJIS.superRepel,
          maxrepel: EMOJIS.maxRepel,
          honey: EMOJIS.honey,
          sitrusberry: FUN_ITEM_EMOJIS['Sitrus Berry'],
        }[item];
        return message.reply(
          `✅ Purchased ${emoji} **${amount}x ${itemName}** for ${EMOJIS.pokecoin} ` +
          `**${cost.toLocaleString()} PokéCoins**.`
        );
      }
      const ballLabels = {
        pb: `${EMOJIS.pokeball} Poke Ball`,
        gb: `${EMOJIS.greatball} Great Ball`,
        ub: `${EMOJIS.ultraball} Ultra Ball`,
        mb: `${EMOJIS.masterball} Master Ball`,
      };
      return message.reply(
        `✅ Purchased **${amount}x ${ballLabels[item]}** for ${EMOJIS.pokecoin} ` +
        `**${cost.toLocaleString()}** PokéCoins.`
      );
    }

    if (command === 'release') {
      const subcommand = args[0]?.toLowerCase();
      if (subcommand === 'lock' || subcommand === 'unlock') {
        const query = args.slice(1).join(' ').trim();
        if (!query) {
          return message.reply(
            `Usage: \`${PREFIX}release ${subcommand} <Pokémon name|Pokédex number|mega-line|egg|rarity|event|starters>\`.`
          );
        }
        const locked = subcommand === 'lock';
        const presetMatches = findReleaseLockPresetMatches(userId, query);
        if (presetMatches) {
          if (!presetMatches.length) {
            return message.reply(`No Pokémon matching the **${query}** lock category found in your storage.`);
          }
          if (locked) {
            const lockCount = getReleaseLockCount(userId);
            const lockLimit = getReleaseLockLimit(userId);
            const locksToAdd = presetMatches.filter((pokemon) => !pokemon.is_locked).length;
            if (lockCount + locksToAdd > lockLimit) {
              return message.reply(
                `🔒 You can have up to **${lockLimit}** release-locked Pokémon ` +
                `(${lockCount}/${lockLimit} in use). Unlock some Pokémon before locking this category.`
              );
            }
          }
          const ids = presetMatches.map((pokemon) => pokemon.id);
          const changedCount = db.prepare(
            `UPDATE catches SET is_locked = ? WHERE user_id = ? AND is_locked != ? AND id IN (${ids.map(() => '?').join(', ')})`
          ).run(locked ? 1 : 0, userId, locked ? 1 : 0, ...ids).changes;
          if (!changedCount) {
            return message.reply(`All **${query}** Pokémon matching this category are already ${locked ? 'locked' : 'unlocked'}.`);
          }
          return message.reply(
            `${locked ? '🔒 Locked' : '🔓 Unlocked'} **${changedCount} Pokémon** in the **${query}** category` +
            `${presetMatches.length > changedCount ? ` (${presetMatches.length - changedCount} already in that state)` : ''}.`
          );
        }
        if (locked) {
          const matches = findUserPokemonMatches(userId, query);
          const locksToAdd = matches.filter((pokemon) => !pokemon.is_locked).length;
          const lockCount = getReleaseLockCount(userId);
          const lockLimit = getReleaseLockLimit(userId);
          if (lockCount + locksToAdd > lockLimit) {
            return message.reply(
              `🔒 You can have up to **${lockLimit}** release-locked Pokémon ` +
              `(${lockCount}/${lockLimit} in use). Unlock some Pokémon before locking these.`
            );
          }
        }
        const result = setUserPokemonLockByQuery(userId, query, locked);
        if (result.error === 'not_found') return message.reply(`No Pokémon matching **${query}** found in your storage.`);
        if (/^\d+$/.test(query)) {
          if (!result.changedCount) {
            return message.reply(`Dex #${query} is already ${locked ? 'locked' : 'unlocked'} from release.`);
          }
          return message.reply(
            `${locked ? '🔒 Locked' : '🔓 Unlocked'} Dex **#${query}** from release.`
          );
        }
        if (!result.changedCount) {
          return message.reply(`All **${result.name}** matching **${query}** are already ${locked ? 'locked' : 'unlocked'}.`);
        }
        return message.reply(
          `${locked ? '🔒 Locked' : '🔓 Unlocked'} **${result.changedCount} ${result.name}** ` +
          `matching **${query}**${result.matchedCount > result.changedCount ? ` (${result.matchedCount - result.changedCount} already in that state)` : ''}.`
        );
      }

      if (subcommand === 'view-locks') {
        if (args.length !== 1) return message.reply(`Usage: \`${PREFIX}release view-locks\`.`);
        const locked = db.prepare(`
          SELECT catches.id, catches.pokemon_id, catches.name, catches.rarity,
            catches.is_shiny, catches.is_golden, pokemon_forms.species_id
          FROM catches
          LEFT JOIN pokemon_forms ON pokemon_forms.id = catches.pokemon_id
          WHERE catches.user_id = ? AND catches.is_locked = 1
          ORDER BY catches.id DESC
        `).all(userId);
        if (!locked.length) return message.reply('🔓 You do not have any locked Pokémon.');
        const lockedIds = new Set(locked.map((pokemon) => pokemon.id));
        const lockCategories = [
          { query: 'mega-line', label: 'mega-line' },
          { query: 'egg', label: 'egg' },
          { query: 'starters', label: 'starters' },
          { query: 'event', label: 'event' },
          { query: 'common', label: 'common' },
          { query: 'uncommon', label: 'uncommon' },
          { query: 'rare', label: 'rare' },
          { query: 'super rare', label: 'super rare' },
          { query: 'legendary', label: 'legendary' },
          { query: 'shiny', label: 'shiny' },
          { query: 'golden', label: 'golden' },
          { query: 'mega', label: 'mega' },
          { query: 'shiny mega', label: 'shiny mega' },
          { query: 'gmax', label: 'gmax' },
          { query: 'shiny gmax', label: 'shiny gmax' },
        ];
        const summarizedIds = new Set();
        const entries = [];
        for (const category of lockCategories) {
          const matching = findReleaseLockPresetMatches(userId, category.query);
          if (!matching?.length || !matching.every((pokemon) => lockedIds.has(pokemon.id))) continue;
          entries.push(`(#${category.label})`);
          for (const pokemon of matching) summarizedIds.add(pokemon.id);
        }
        for (const pokemon of locked) {
          if (summarizedIds.has(pokemon.id)) continue;
          const prefix = pokemon.is_golden ? 'Golden ' : pokemon.is_shiny ? 'Shiny ' : '';
          entries.push(
            `#${pokemon.species_id || pokemon.pokemon_id || '?'} ${prefix}${pokemon.name} (${pokemon.rarity})`
          );
        }
        const lines = entries.slice(0, 20).map((entry, index) => `${String(index + 1).padStart(2, '0')}.) ${entry}`);
        const remaining = entries.length - lines.length;
        return message.reply(
          `🔒 **Your release locked Pokémon (${locked.length}):**\n${lines.join('\n')}` +
          (remaining ? `\n…and ${remaining} more.` : '')
        );
      }

      if (subcommand === 'clear-locks') {
        if (args.length !== 1) return message.reply(`Usage: \`${PREFIX}release clear-locks\`.`);
        const cleared = db.prepare(
          'UPDATE catches SET is_locked = 0 WHERE user_id = ? AND is_locked = 1'
        ).run(userId).changes;
        return message.reply(
          cleared
            ? `🔓 Cleared release locks from **${cleared} Pokémon**.`
            : '🔓 You do not have any release locks to clear.'
        );
      }

      if (subcommand === 'duplicates' || subcommand === 'type') {
        if (subcommand === 'duplicates') {
          if (args.length !== 1) return message.reply(`Usage: \`${PREFIX}release duplicates\` or \`${PREFIX}r d\`.`);
          const rarityOrder = ['Common', 'Uncommon', 'Rare', 'Super Rare'];
          const findReleaseCandidates = () => {
            const catches = db.prepare(`
              SELECT catches.id, catches.pokemon_id, catches.name, catches.rarity,
                catches.is_shiny, catches.is_golden, catches.in_team, catches.is_locked,
                (catches.is_fav = 1) AS is_favorite
              FROM catches
              LEFT JOIN pokemon_forms ON pokemon_forms.id = catches.pokemon_id
              WHERE catches.user_id = ?
              ORDER BY catches.id
            `).all(userId);
            const speciesGroups = new Map();
            for (const pokemon of catches) {
              if (getReleaseProtectionReason(pokemon) || pokemon.is_favorite) continue;
              const rarity = getDisplayRarity(pokemon.rarity, pokemon.name, false);
              if (!rarityOrder.includes(rarity)) continue;
              const key = pokemon.pokemon_id === null
                ? `name:${pokemon.name.toLowerCase()}`
                : `form:${pokemon.pokemon_id}`;
              const group = speciesGroups.get(key) || [];
              group.push({ ...pokemon, displayRarity: rarity });
              speciesGroups.set(key, group);
            }

            const candidates = [];
            for (const group of speciesGroups.values()) {
              let keptOne = false;
              for (const pokemon of group) {
                if (!keptOne) {
                  keptOne = true;
                  continue;
                }
                if (pokemon.in_team || pokemon.is_locked) continue;
                candidates.push(pokemon);
              }
            }
            return candidates;
          };
          const releaseCandidates = findReleaseCandidates();
          if (!releaseCandidates.length) {
            return message.reply(
              'No eligible duplicate Pokémon to release. Shiny, Legendary, Golden, Mega, Gmax, favourited, ' +
              'team, and manually locked Pokémon are protected.'
            );
          }

          const candidateIds = releaseCandidates.map((pokemon) => pokemon.id);
          const groupedCounts = new Map();
          for (const pokemon of releaseCandidates) {
            const rarityData = groupedCounts.get(pokemon.displayRarity) || { count: 0, payout: 0, pokemon: new Map() };
            const basePayout = RELEASE_PAYOUTS[pokemon.displayRarity.toLowerCase()];
            const payout = Math.floor(basePayout * getAmuletCoinBoost(userId).multiplier);
            rarityData.count += 1;
            rarityData.payout += payout;
            rarityData.pokemon.set(pokemon.name, (rarityData.pokemon.get(pokemon.name) || 0) + 1);
            groupedCounts.set(pokemon.displayRarity, rarityData);
          }
          const summaryLines = rarityOrder
            .filter((rarity) => groupedCounts.has(rarity))
            .map((rarity) => {
              const data = groupedCounts.get(rarity);
              return `${getRarityEmojis(rarity)} **${rarity}**\n` +
                `${data.count} Pokémon × ${EMOJIS.pokecoin} ${Math.floor(data.payout / data.count).toLocaleString()} ` +
                `≈ ${EMOJIS.pokecoin} **${data.payout.toLocaleString()}**`;
            });
          const totalCount = releaseCandidates.length;
          const totalPayout = [...groupedCounts.values()].reduce((sum, data) => sum + data.payout, 0);
          const protectionText =
            'Shiny, Legendary, Golden, Mega, Gmax, favourited, team, and manually locked Pokémon are protected.';
          const trainerLabel = `${getTrainerIconEmoji(userId)} **${message.author.username}**`;
          const detailsEntries = rarityOrder.flatMap((rarity) => {
            const rarityData = groupedCounts.get(rarity);
            if (!rarityData) return [];
            return [...rarityData.pokemon]
              .sort(([first], [second]) => first.localeCompare(second))
              .map(([name, count]) => ({ rarity, name, count }));
          });
          const totalPages = Math.max(1, Math.ceil(detailsEntries.length / 15));
          let detailsPage = 0;
          let showDetails = false;
          const summaryEmbed = () => new EmbedBuilder()
            .setColor(0xf39c12)
            .setTitle('Duplicate Release Preview')
            .setDescription(
              `${trainerLabel}, these are the unlocked duplicate Pokémon that will be released:\n\n` +
              `${summaryLines.join('\n\n')}\n\n` +
              `**Total:** ${totalCount} Pokémon · ${EMOJIS.pokecoin} **${totalPayout.toLocaleString()}**\n\n` +
              protectionText
            );
          const detailsEmbed = () => {
            const pageRows = detailsEntries.slice(detailsPage * 15, (detailsPage + 1) * 15);
            const lines = [];
            let activeRarity = null;
            for (const entry of pageRows) {
              if (entry.rarity !== activeRarity) {
                activeRarity = entry.rarity;
                const count = groupedCounts.get(activeRarity).count;
                lines.push(`\n${getRarityEmojis(activeRarity)} **${activeRarity} (${count})**`);
              }
              lines.push(`• ${entry.name} ×${entry.count} — ${EMOJIS.pokecoin} ${Math.floor(
                RELEASE_PAYOUTS[activeRarity.toLowerCase()] * getAmuletCoinBoost(userId).multiplier
              ).toLocaleString()}`);
            }
            return new EmbedBuilder()
              .setColor(0xf39c12)
              .setTitle('Duplicate Release Details')
              .setDescription(
                `${trainerLabel}, each Pokémon count shows how many duplicates would be released.\n` +
                `${lines.join('\n')}\n\n` +
                protectionText
              )
              .setFooter({ text: `Page ${detailsPage + 1} of ${totalPages}` });
          };
          const buttons = () => showDetails
            ? [
              new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('release-duplicates-summary').setLabel('Back to Summary').setStyle(ButtonStyle.Secondary).setEmoji('↩️'),
                new ButtonBuilder().setCustomId('release-duplicates-first').setLabel('Fast Back').setStyle(ButtonStyle.Secondary).setEmoji('⏮️').setDisabled(detailsPage === 0),
                new ButtonBuilder().setCustomId('release-duplicates-back').setLabel('Back').setStyle(ButtonStyle.Secondary).setEmoji('⬅️').setDisabled(detailsPage === 0),
                new ButtonBuilder().setCustomId('release-duplicates-forward').setLabel('Forward').setStyle(ButtonStyle.Secondary).setEmoji('➡️').setDisabled(detailsPage >= totalPages - 1),
                new ButtonBuilder().setCustomId('release-duplicates-last').setLabel('Fast Forward').setStyle(ButtonStyle.Secondary).setEmoji('⏭️').setDisabled(detailsPage >= totalPages - 1)
              ),
              new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('release-duplicates-confirm').setLabel(`Release ${totalCount} Pokémon`).setStyle(ButtonStyle.Danger).setEmoji('🕸️'),
                new ButtonBuilder().setCustomId('release-duplicates-cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary).setEmoji('❌')
              ),
            ]
            : [new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('release-duplicates-confirm').setLabel(`Release ${totalCount} Pokémon`).setStyle(ButtonStyle.Danger).setEmoji('🕸️'),
              new ButtonBuilder().setCustomId('release-duplicates-details').setLabel('View Detailed Counts').setStyle(ButtonStyle.Primary).setEmoji('📋'),
              new ButtonBuilder().setCustomId('release-duplicates-cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary).setEmoji('❌')
            )];

          const previewMessage = await message.reply({ embeds: [summaryEmbed()], components: buttons() });
          const collector = previewMessage.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 120000,
          });
          collector.on('collect', async (interaction) => {
            if (interaction.user.id !== userId) {
              await interaction.reply({
                content: 'Only the trainer who opened this preview can confirm or cancel the release.',
                ephemeral: true,
              });
              return;
            }
            try {
              if (interaction.customId === 'release-duplicates-cancel') {
                collector.stop('cancelled');
                await interaction.update({
                  embeds: [makeEmbed('Duplicate Release Cancelled', 'No Pokémon were released.', 0x747f8d)],
                  components: [],
                });
                return;
              }
              if (interaction.customId === 'release-duplicates-details') {
                showDetails = true;
              } else if (interaction.customId === 'release-duplicates-summary') {
                showDetails = false;
              } else if (interaction.customId === 'release-duplicates-first') {
                detailsPage = 0;
              } else if (interaction.customId === 'release-duplicates-back') {
                detailsPage = Math.max(0, detailsPage - 1);
              } else if (interaction.customId === 'release-duplicates-forward') {
                detailsPage = Math.min(totalPages - 1, detailsPage + 1);
              } else if (interaction.customId === 'release-duplicates-last') {
                detailsPage = totalPages - 1;
              } else if (interaction.customId === 'release-duplicates-confirm') {
                const stillDuplicateIds = new Set(findReleaseCandidates().map((pokemon) => pokemon.id));
                const safeIds = candidateIds.filter((id) => stillDuplicateIds.has(id));
                const outcome = releaseCatchIds(userId, safeIds, { protectFavorites: true });
                collector.stop('confirmed');
                if (!outcome.released.length) {
                  await interaction.update({
                    content: 'No eligible duplicate Pokémon remained to release.',
                    embeds: [],
                    components: [],
                  });
                  return;
                }
                const breakdown = [...new Set(outcome.released.map((pokemon) =>
                  getDisplayRarity(pokemon.rarity, pokemon.name, Boolean(pokemon.is_shiny))
                ))]
                  .map((rarity) => {
                    const count = outcome.released.filter((pokemon) =>
                      getDisplayRarity(pokemon.rarity, pokemon.name, Boolean(pokemon.is_shiny)) === rarity
                    ).length;
                    return `${getRarityEmojis(rarity)} ${rarity} (${count})`;
                  }).join(' • ');
                const rotomText = outcome.rotomDrops.length
                  ? `\n⚙️ Rotom items found: ${outcome.rotomDrops.join(', ')}.`
                  : '';
                await interaction.update({
                  content:
                    `${getTrainerIconEmoji(userId)} **${message.author.username}** released ` +
                    `**${outcome.released.length} duplicate Pokémon**, earning ${EMOJIS.pokecoin} ` +
                    `**${outcome.totalPayout.toLocaleString()}**!` +
                    (breakdown ? `\n${breakdown}` : '') + rotomText,
                  embeds: [],
                  components: [],
                });
                return;
              }
              await interaction.update({
                embeds: [showDetails ? detailsEmbed() : summaryEmbed()],
                components: buttons(),
              });
            } catch (error) {
              console.error(`Failed to process duplicate release for user ${userId}:`, error);
              if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                  content: 'The request encountered an error. Check your Pokémon storage before retrying to avoid releasing the same Pokémon twice.',
                  ephemeral: true,
                });
              }
            }
          });
          collector.on('end', async (_, reason) => {
            if (reason === 'confirmed' || reason === 'cancelled') return;
            try {
              await previewMessage.edit({ components: [] });
            } catch (error) {
              console.error(`Failed to disable expired duplicate release controls for user ${userId}:`, error);
            }
          });
          return;
        }

        const rarityArg = args.slice(1)
          .join('')
          .toLowerCase()
          .replace(/mons$/, '')
          .replace(/s$/, '')
          .replace(/[^a-z]/g, '');
        const rarityKey = rarityArg;
        const rarityByKey = {
          common: 'Common',
          uncommon: 'Uncommon',
          rare: 'Rare',
          superrare: 'Super Rare',
          legendary: 'Legendary',
          shiny: 'Shiny',
        };
        const requestedRarity = subcommand === 'type' ? rarityByKey[rarityKey] : null;
        if (subcommand === 'type' && (!requestedRarity || args.length < 2)) {
          return message.reply(`Usage: \`${PREFIX}release type <rarity>mons\`.`);
        }
        if (requestedRarity && ['Legendary', 'Shiny'].includes(requestedRarity)) {
          return message.reply(
            'Bulk release does not release Legendary or Shiny Pokémon. Release them individually by ID or name.'
          );
        }
        const catches = db.prepare(`
          SELECT id, pokemon_id, name, rarity, is_shiny, is_golden, in_team, is_locked
          FROM catches WHERE user_id = ? ORDER BY id
        `).all(userId);
        const groups = new Map();
        for (const pokemon of catches) {
          const displayRarity = getDisplayRarity(
            pokemon.rarity,
            pokemon.name,
            Boolean(pokemon.is_shiny)
          );
          if (
            pokemon.is_shiny
            || pokemon.is_golden
            || pokemon.in_team
            || pokemon.is_locked
            || !['common', 'uncommon', 'rare', 'super rare'].includes(pokemon.rarity.toLowerCase())
            || (requestedRarity && displayRarity !== requestedRarity)
          ) continue;
          const key = pokemon.pokemon_id === null
            ? `name:${pokemon.name.toLowerCase()}`
            : `form:${pokemon.pokemon_id}`;
          const group = groups.get(key) || [];
          group.push(pokemon);
          groups.set(key, group);
        }
        const releaseIds = [...groups.values()].flatMap((group) =>
          group.slice(1).map((pokemon) => pokemon.id)
        );
        if (!releaseIds.length) {
          return message.reply(
            `No eligible ${requestedRarity ? `${requestedRarity} ` : ''}duplicate Pokémon to release. ` +
            'Locked Pokémon, team Pokémon, Shinies, and Legendaries are kept.'
          );
        }
        const outcome = releaseCatchIds(userId, releaseIds);
        const rotomText = outcome.rotomDrops.length
          ? `\n⚙️ Rotom items found: ${outcome.rotomDrops.join(', ')}.`
          : '';
        return message.reply(createReleaseAnnouncement(
          userId,
          message.author.username,
          outcome,
          (outcome.skipped.locked ? `\n🔒 Kept ${outcome.skipped.locked} locked Pokémon.` : '') + rotomText
        ));
      }

      if (subcommand === 'number') {
        const dexNumber = Number(args[1]);
        const amount = args[2] === undefined ? 1 : Number(args[2]);
        if (
          args.length < 2
          || args.length > 3
          || !Number.isSafeInteger(dexNumber)
          || dexNumber <= 0
          || !Number.isSafeInteger(amount)
          || amount <= 0
        ) {
          return message.reply(`Usage: \`${PREFIX}release number <Pokédex number> [amount]\`.`);
        }
        const normalizedDexNumber = dexNumber > getDexIndexOffset()
          ? dexNumber - getDexIndexOffset()
          : dexNumber;
        const matching = db.prepare(`
          SELECT c.id, c.name, c.rarity, c.is_shiny, c.is_golden
          FROM catches c
          LEFT JOIN pokemon_forms p ON p.id = c.pokemon_id
          WHERE c.user_id = ?
            AND COALESCE(p.species_id, c.pokemon_id) = ?
            AND c.in_team = 0 AND c.is_locked = 0 AND c.is_golden = 0
          ORDER BY c.id
        `).all(userId, normalizedDexNumber, amount);
        const releasable = matching
          .filter((pokemon) => !getReleaseProtectionReason(pokemon))
          .slice(0, amount);
        if (!releasable.length) {
          return message.reply(`No releasable Pokémon found for Pokédex number **${dexNumber}**.`);
        }
        const outcome = releaseCatchIds(userId, releasable.map((pokemon) => pokemon.id));
        if (!outcome.released.length) {
          return message.reply(
            'Those Pokémon are protected from release or have no configured payout. Locked, team, Legendary, Shiny, Golden, Mega, and Gmax Pokémon are kept.'
          );
        }
        const rotomText = outcome.rotomDrops.length
          ? `\n⚙️ Rotom items found: ${outcome.rotomDrops.join(', ')}.`
          : '';
        return message.reply(createReleaseAnnouncement(
          userId,
          message.author.username,
          outcome,
          rotomText
        ));
      }

      if (!args.length) {
        const lockCount = getReleaseLockCount(userId);
        const lockLimit = getReleaseLockLimit(userId);
        const embed = new EmbedBuilder()
          .setColor(0x2b2d31)
          .setAuthor({
            name: `${message.author.username}'s Release Locked Pokémon`,
            iconURL: message.author.displayAvatarURL(),
          })
          .setDescription(
            `\`${PREFIX}release lock|unlock <name|Dex #>\` — lock/unlock a Pokémon from being released.\n` +
            `\`${PREFIX}release lock|unlock <rarity>\` — lock/unlock a rarity category.\n` +
            `\`${PREFIX}release lock|unlock mega-line\` — lock/unlock pre-evolutions of Mega Pokémon.\n` +
            `⭐ Favorites are automatically protected from release.\n` +
            `🔒 You can lock up to **${lockLimit} Pokémon** (${BASE_RELEASE_LOCK_LIMIT} standard` +
            `${getPatreonPerks(userId).releaseLocks ? ` + ${getPatreonPerks(userId).releaseLocks} Patreon` : ''}).\n` +
            `\`${PREFIX}excl egg|swap|fish|patreon\` — view exclusive Pokémon lists.\n` +
            `\`${PREFIX}release clear-locks\` — clear all of your release locks.\n` +
            `\`${PREFIX}release view-locks\` — view all of your release locks.\n\n` +
            `**Rarity types:** \`common\`, \`uncommon\`, \`rare\`, \`super rare\`\n` +
            `:poke_egg: Lock Egg exclusives with \`${PREFIX}release lock egg\`\n` +
            `:eventvoucher: Lock event Pokémon with \`${PREFIX}release lock event\`\n` +
            `:megabracelet: Lock pre-evolutions of Mega Pokémon with \`${PREFIX}release lock mega-line\`\n` +
            `🌱 Lock starter evolutionary lines with \`${PREFIX}release lock starters\`\n\n` +
            (lockCount
              ? `🔒 **Your release locked Pokémon (${lockCount}/${lockLimit}):** View the list with \`${PREFIX}release view-locks\`.`
              : `You don't have any locked Pokémon! Use the commands above to lock Pokémon.\n\n🔒 **Your release locked Pokémon (0/${lockLimit})**\nYou have 0 locked Pokémon.`) +
            `\n\nLegendary, Shiny, Golden, Mega, and Gmax Pokémon cannot be released.`
          )
          .setFooter({ text: 'Lock Pokémon to prevent them from being released.' });
        return message.reply({ embeds: [embed] });
      }

      const query = args.join(' ').trim();
      const matching = findUserPokemonMatches(userId, query);
      const eligible = matching.find((pokemon) =>
        !pokemon.is_locked && !pokemon.in_team && !getReleaseProtectionReason(pokemon)
      );
      const catchId = eligible?.id ?? matching[0]?.id ?? null;
      if (!Number.isSafeInteger(catchId) || catchId <= 0) {
        return message.reply(
          `Specify an owned Pokémon name or Pokédex number: \`${PREFIX}release <name|Pokédex number>\`.`
        );
      }
      const pokemon = db.prepare(
        'SELECT * FROM catches WHERE id = ? AND user_id = ?'
      ).get(catchId, userId);
      if (!pokemon) return message.reply('Pokémon not found in your storage.');
      if (pokemon.is_locked) return message.reply(`🔒 This Pokémon is locked. Unlock it with \`${PREFIX}release unlock ${pokemon.name}\` first.`);
      if (pokemon.in_team) return message.reply('Cannot release a Pokémon in your active team!');
      const protectionReason = getReleaseProtectionReason(pokemon);
      if (protectionReason) return message.reply(protectionReason);
      const outcome = releaseCatchIds(userId, [catchId]);
      if (!outcome.released.length) {
        return message.reply(
          'This Pokémon is protected from release or does not have a configured release payout.'
        );
      }
      const rotomText = outcome.rotomDrops.length
        ? `\n⚙️ Rotom items found: ${outcome.rotomDrops.join(', ')}.`
        : '';
      return message.reply(createReleaseAnnouncement(
        userId,
        message.author.username,
        outcome,
        rotomText
      ));
    }

    if (command === 'incense' || command === 'inc') {
      if (!message.guildId) return message.reply('Incense can only be used in a server.');
      const incenseArgs = args[0]?.toLowerCase() === 'use' ? args.slice(1) : args;
      if (incenseArgs.length > 1 || (args[0]?.toLowerCase() === 'use' && incenseArgs.length === 0)) {
        return message.reply(`Usage: \`${PREFIX}incense [use {amount}]\`.`);
      }
      if (incenseArgs[0] === undefined) {
        const charges = getIncenseCharges(message.guildId);
        const { recent, top } = getIncenseContributors(message.guildId);
        const serverName = message.guild.name;
        const code = (text) => `\`${text}\``;
        const embed = new EmbedBuilder()
          .setColor(0x3498db)
          .setAuthor({ name: `${serverName}'s Incenses`, iconURL: message.guild.iconURL() || undefined })
          .setDescription(
            `**${serverName}** has ${charges > 0 ? '✅' : '❌'} ${EMOJIS.incense} **${charges.toLocaleString()}** incense charges remaining.\n` +
            `• 1 charge is consumed per ${code(`${PREFIX}pokemon`)} & ${code(`${PREFIX}fish`)} encounter, ${code(`${PREFIX}battle`)}, or ${code(`${PREFIX}egg`)} hatch\n` +
            `• Use an incense with ${code(`${PREFIX}incense use {amount}`)}\n\n` +
            `${EMOJIS.incense} Incense benefits:\n` +
            `• +10% increased ${EMOJIS.shiny} rate (for ${code(`${PREFIX}pokemon`)} & ${code(`${PREFIX}fish`)})\n` +
            `• +10% increased ${code(`${PREFIX}promo`)} rates (all categories)\n` +
            `• 1 charge used on battles, and egg hatches during promo\n\n` +
            `Recent contribution\n` +
            `• ${recent
              ? `<@${recent.user_id}> — ${recent.charges.toLocaleString()} charges total (last used <t:${Math.floor(recent.last_used_at / 1000)}:R>)`
              : 'None'}\n\n` +
            `Top 5 contributors for ${serverName}\n` +
            (top.length
              ? top.map((row, index) => `• **${index + 1}.** <@${row.user_id}> — ${row.charges.toLocaleString()} charges`).join('\n')
              : '• None')
          )
          .setFooter({ text: 'Incense charges are shared & used by every player in this server' });
        return message.reply({ embeds: [embed], allowedMentions: { parse: [] } });
      }
      const amount = parseAmount(incenseArgs[0]);
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        return message.reply(`Usage: \`${PREFIX}incense [use {amount}]\`.`);
      }
      const chargesPerIncense = BASE_INCENSE_CHARGES + getPatreonPerks(userId).incenseBonus;
      const added = db.transaction(() => {
        if (!takeUserItem(userId, 'Incense', amount)) return false;
        addIncenseCharges(message.guildId, amount * chargesPerIncense);
        recordIncenseContribution(message.guildId, userId, amount, amount * chargesPerIncense);
        return true;
      })();
      if (!added) {
        const owned = getUserItems(userId).find((row) => row.item_name === 'Incense')?.amount || 0;
        return message.reply(`❌ You don't have enough ${EMOJIS.incense} **Incense**. You own **${owned.toLocaleString()}x**.`);
      }
      return message.reply(
        `${EMOJIS.incense} Used **${amount}x Incense** (**${(amount * chargesPerIncense).toLocaleString()}** charges). ` +
        `This server now has **${getIncenseCharges(message.guildId).toLocaleString()}** charges.`
      );
    }

    if (command === 'doublexp' || command === 'dxp') {
      if (args.length > 1) return message.reply(`Usage: \`${PREFIX}doublexp [amount]\`.`);
      if (args[0] === undefined) {
        return message.reply(
          `🎟️ You have **${getUser(userId).double_xp_charges.toLocaleString()}** Double XP catches remaining. ` +
          `Use \`${PREFIX}doublexp {amt}\` to add more.`
        );
      }
      const amount = parseAmount(args[0]);
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        return message.reply(`Usage: \`${PREFIX}doublexp [positive amount]\`.`);
      }
      const added = db.transaction(() => {
        if (!takeUserItem(userId, 'Double XP Ticket', amount)) return false;
        incrementUser(userId, { double_xp_charges: amount * BASE_DOUBLE_XP_CHARGES });
        return true;
      })();
      if (!added) {
        const owned = getUserItems(userId).find((row) => row.item_name === 'Double XP Ticket')?.amount || 0;
        return message.reply(`❌ You don't have enough 🎟️ **Double XP Tickets**. You own **${owned.toLocaleString()}x**.`);
      }
      return message.reply(
        `🎟️ Used **${amount}x Double XP Ticket** — your next **${getUser(userId).double_xp_charges.toLocaleString()}** catches give double XP.`
      );
    }

    if (command === 'pokeradar' || command === 'radar') {
      if (args.length > 1) return message.reply(`Usage: \`${PREFIX}pokeradar [amount]\`.`);
      if (args[0] === undefined) {
        return message.reply(
          `${EMOJIS.pokeradar} You have **${getUser(userId).pokeradar_charges.toLocaleString()}** Pokeradar charges. ` +
          `Use \`${PREFIX}pokeradar {amt}\` to add more.`
        );
      }
      const amount = parseAmount(args[0]);
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        return message.reply(`Usage: \`${PREFIX}pokeradar [positive amount]\`.`);
      }
      const added = db.transaction(() => {
        if (!takeUserItem(userId, 'Pokeradar', amount)) return false;
        incrementUser(userId, { pokeradar_charges: amount * BASE_POKERADAR_CHARGES });
        return true;
      })();
      if (!added) {
        const owned = getUserItems(userId).find((row) => row.item_name === 'Pokeradar')?.amount || 0;
        return message.reply(`❌ You don't have enough ${EMOJIS.pokeradar} **Pokeradar**. You own **${owned.toLocaleString()}x**.`);
      }
      return message.reply(
        `${EMOJIS.pokeradar} Used **${amount}x Pokeradar** (**${(amount * BASE_POKERADAR_CHARGES).toLocaleString()}** charges). ` +
        `You now have **${getUser(userId).pokeradar_charges.toLocaleString()}** charges.`
      );
    }

    const encounterModifierCommands = {
      repel: { modifier: 'repel', label: 'Repel', emoji: EMOJIS.repel },
      superrepel: { modifier: 'super_repel', label: 'Super Repel', emoji: EMOJIS.superRepel },
      sr: { modifier: 'super_repel', label: 'Super Repel', emoji: EMOJIS.superRepel },
      maxrepel: { modifier: 'max_repel', label: 'Max Repel', emoji: EMOJIS.maxRepel },
      mr: { modifier: 'max_repel', label: 'Max Repel', emoji: EMOJIS.maxRepel },
      honey: { modifier: 'honey', label: 'Honey', emoji: EMOJIS.honey },
    };
    if (encounterModifierCommands[command]) {
      const { modifier, label, emoji } = encounterModifierCommands[command];
      if (args.length > 1) return message.reply(`Usage: \`${PREFIX}repel [amount]\`.`);
      const amount = args[0] === undefined ? 1 : parseAmount(args[0]);
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        return message.reply(`Usage: \`${PREFIX}${command} [positive amount]\`.`);
      }
      const activation = activateEncounterModifier(userId, modifier, amount);
      if (activation.error === 'modifier_active') {
        return message.reply(
          `❌ **${activation.activeName}** is already active. Wait for its encounters to finish before using another modifier.`
        );
      }
      if (activation.error === 'insufficient') {
        return message.reply(
          `❌ You don't have enough **${label}**. You own **${activation.owned.toLocaleString()}x**.`
        );
      }
      if (activation.error === 'too_many') {
        return message.reply(`❌ That many **${label}** would exceed the active encounter limit.`);
      }
      return message.reply(
        `${emoji} Activated **${amount}x ${label}** for the next ` +
        `**${activation.encounters.toLocaleString()} encounters**.`
      );
    }

    if (command === 'swap' || command === 'sw' || command === 'pokeswap') {
      const legacySwap = command === 'swap'
        && args[0]?.toLowerCase() === 'sacrifice';
      if (legacySwap) {
        return message.reply(
          `The three-Pokémon sacrifice swap is no longer available. Use \`${PREFIX}swap <Pokémon name|Pokédex number>\` instead.`
        );
      }
      if (!legacySwap) {
        const variant = ['shiny', 'golden'].includes(args[0]?.toLowerCase())
          ? args.shift().toLowerCase()
          : 'regular';
        const pokemonName = args.join(' ').trim();
        if (!pokemonName || ['help', 'info'].includes(pokemonName.toLowerCase())) {
          const swapUser = getUser(userId);
          const swapsToday = getDailyResetDay(Date.now()) > getDailyResetDay(swapUser.last_swap_reset)
            ? 0
            : swapUser.swaps_today;
          const multiplier = getSwapMultiplier(swapsToday);
          const multiplierBonusPercent = Math.round((multiplier - 1) * 100);
          const nextReset = Math.floor(getNextDailyReset(Date.now()) / 1000);
          const swapTickets = getUserItems(userId)
            .find((item) => item.item_name === 'Swap Ticket')?.amount || 0;
          return message.reply({
            embeds: [new EmbedBuilder()
              .setColor(0x5865f2)
              .setTitle('🔄 PokeSwap — Swap your Pokémon!')
              .setDescription(
                'Swap one Pokémon from your storage for a random Pokémon. ' +
                'Swap-exclusive Shiny and Golden Pokémon may also be obtained.\n\n' +
                `**Usage**\n` +
                `• \`${PREFIX}swap <Pokémon name|Pokédex number>\` — swap a regular Pokémon\n` +
                `• \`${PREFIX}swap shiny <Pokémon name|Pokédex number>\` — swap a Shiny Pokémon\n` +
                `• \`${PREFIX}swap golden <Pokémon name|Pokédex number>\` — swap a Golden Pokémon\n` +
                `🎟️ Swap Tickets: **${swapTickets}**\n` +
                `🔥 Multiplier: **+${multiplierBonusPercent}%**\n` +
                `📊 Your swaps today: **${swapsToday}**\n\n` +
                `Swap cost: ${EMOJIS.pokecoin} **${Math.round(5000 * (1 - getPatreonPerks(userId).swapDiscount)).toLocaleString()} per swap**\n\n` +
                `• Every 20 swaps adds **+1%** to your multiplier (**10% max**).\n` +
                `• Your multiplier increases your Shiny/Golden swap odds.\n` +
                `• The multiplier resets to **0%** at 12 AM EST every day.\n` +
                `• Your multiplier resets <t:${nextReset}:F>.\n\n` +
                `${EMOJIS.golden} **Current Swap Golden:** ${EMOJIS.golden} **Golden Goomy**`
              )],
          });
        }

        const now = Date.now();
        const result = db.transaction(() => {
          let user = getUser(userId);
          if (getDailyResetDay(now) > getDailyResetDay(user.last_swap_reset)) {
            updateUser(userId, { swaps_today: 0, last_swap_reset: now });
            user = getUser(userId);
          }
          const isShiny = variant === 'shiny';
          const isGolden = variant === 'golden';
          const offeredMatch = findUserPokemonMatches(userId, pokemonName)
            .find((pokemon) =>
              !pokemon.in_team
              && !pokemon.is_locked
              && Boolean(pokemon.is_shiny) === isShiny
              && Boolean(pokemon.is_golden) === isGolden
            );
          const offered = offeredMatch
            ? db.prepare('SELECT * FROM catches WHERE id = ? AND user_id = ? AND in_team = 0 AND is_locked = 0')
              .get(offeredMatch.id, userId)
            : null;
          if (!offered) return { error: 'pokemon_not_found' };
          const swapTickets = getUserItems(userId)
            .find((item) => item.item_name === 'Swap Ticket')?.amount || 0;
          const payment = swapTickets > 0 ? 'swap_ticket' : 'coins';
          const swapPerks = getPatreonPerks(userId);
          const cost = payment === 'coins' ? Math.round(5000 * (1 - swapPerks.swapDiscount)) : 0;
          if (user.coins < cost) return { error: 'insufficient_coins', coins: user.coins };

          const swapsToday = user.swaps_today + 1;
          const multiplier = getSwapMultiplier(swapsToday);
          const shinyBonus = isShiny ? 1.35 * 1.25 : 1;
          const goldenBonus = isGolden ? 1.65 * 1.25 : 1;
          const shinyChance = Math.min(1, multiplier * shinyBonus / 2000);
          const goldenChance = Math.min(1, multiplier * goldenBonus * (1 + swapPerks.goldenBoost) / 5000);
          const exclusiveShinyHits = SWAP_EXCLUSIVE_SHINIES.filter((exclusive) =>
            (!exclusive.patreonOnly || user.has_patreon)
            && Math.random() < shinyChance
          );
          const exclusiveShiny = exclusiveShinyHits.length
            ? exclusiveShinyHits[Math.floor(Math.random() * exclusiveShinyHits.length)]
            : null;
          const receivedGolden = Math.random() < goldenChance;
          const receivedRegularShiny = Math.random() < shinyChance;
          const receivedShiny = !receivedGolden && (Boolean(exclusiveShiny) || receivedRegularShiny);
          db.prepare('UPDATE users SET buddy_catch_id = NULL WHERE buddy_catch_id = ?')
            .run(offered.id);
          db.prepare('DELETE FROM catches WHERE id = ? AND user_id = ?').run(offered.id, userId);
          const offeredRemaining = db.prepare(`
            SELECT COUNT(*) AS amount
            FROM catches
            WHERE user_id = ? AND pokemon_id = ?
              AND is_shiny = ? AND is_golden = ?
          `).get(userId, offered.pokemon_id, offered.is_shiny, offered.is_golden).amount;
          if (payment === 'swap_ticket' && !takeUserItem(userId, 'Swap Ticket')) {
            throw new Error(`Swap Ticket inventory changed during PokeSwap for user ${userId}.`);
          }
          incrementUser(userId, {
            ...(payment === 'coins' ? { coins: -cost } : {}),
            swaps_today: 1,
            swaps_done: 1,
          });
          trackClanActivity(userId, 'swap');
          const rotomDrops = grantRotomItemDrops(userId, offered);

          let reward;
          if (receivedGolden) {
            reward = findPokemonForms('Goomy', 50).find((pokemon) => pokemon.is_default);
            if (!reward) throw new Error('Could not find base-form Goomy for the Golden PokeSwap reward.');
            saveGoldenCatch(userId, reward);
          } else if (exclusiveShiny) {
            reward = findPokemonForms(exclusiveShiny.name, 50)
              .find((pokemon) => pokemon.is_default && pokemon.species_name === exclusiveShiny.name);
            if (!reward) throw new Error(`Could not find default form for Shiny PokeSwap exclusive ${exclusiveShiny.name}.`);
            saveCatch(userId, reward, true);
          } else {
            reward = getRandomPokemon(null, false, true, true, []);
            if (!reward) throw new Error('The Pokémon pool is empty; cannot complete PokeSwap.');
            saveCatch(userId, reward, receivedShiny);
          }
          return {
            offered,
            offeredRemaining,
            reward,
            receivedGolden,
            receivedShiny,
            exclusiveShiny,
            rotomDrops,
            cost,
            payment,
            multiplier,
            swapsToday,
            shinyChance,
            goldenChance,
          };
        }).immediate();

        if (result.error === 'pokemon_not_found') {
          return message.reply(
            `❌ Could not find a non-team ${variant === 'regular' ? '' : `${variant} `}` +
            `**${pokemonName}** in your box. Specify its Pokémon name or Pokédex number.`
          );
        }
        if (result.error === 'insufficient_coins') {
          return message.reply(
            `❌ You need ${EMOJIS.pokecoin} **${Math.round(5000 * (1 - getPatreonPerks(userId).swapDiscount)).toLocaleString()} PokéCoins** for a swap without a Swap Ticket. ` +
            `You have **${result.coins.toLocaleString()}**.`
          );
        }
        const offeredDisplay = result.offered.is_golden
          ? `${EMOJIS.golden} **Golden ${result.offered.name}**`
          : `${getRarityEmojis(result.offered.rarity, result.offered.name, Boolean(result.offered.is_shiny))} ` +
            `${result.offered.is_shiny ? 'Shiny ' : ''}**${result.offered.name}**`;
        const rewardDisplay = result.receivedGolden
          ? `${EMOJIS.golden} **Golden ${result.reward.name}**`
          : formatPokemonReward({ ...result.reward, isShiny: result.receivedShiny });
        const remainingTickets = getUserItems(userId)
          .find((item) => item.item_name === 'Swap Ticket')?.amount || 0;
        const paymentText = result.payment === 'swap_ticket'
            ? `You spent 🎟️ **1 Swap Ticket** and have **${remainingTickets}** left.`
            : `You spent ${EMOJIS.pokecoin} **${result.cost.toLocaleString()} PokéCoins** for this swap.`;
        const rewardSprite = result.receivedGolden
          ? getGoldenSpriteUrl(result.reward.species_id, result.reward.slug)
          : getPokemonShowdownSprite(
            result.reward.slug,
            result.receivedShiny,
            result.receivedShiny
              ? result.reward.shinyImg || result.reward.shiny_sprite || result.reward.img
              : result.reward.img
          );
        const swapEmbed = new EmbedBuilder()
          .setColor(getRarityColor(
            result.receivedGolden ? 'Golden' : result.reward.rarity,
            result.reward.name,
            result.receivedShiny
          ))
          .setAuthor({
            name: 'PokeSwap',
            iconURL: getTrainerIconUrl(userId) || message.author.displayAvatarURL(),
          })
          .setDescription(`**${message.author.username}** received ${rewardDisplay} from a swap!`)
          .setFooter({ text: 'PokeSwap' })
          .setTimestamp();
        if (rewardSprite) swapEmbed.setImage(rewardSprite);
        const dropsText = result.rotomDrops.length
          ? `\n⚙️ **Rotom Appliances Found:** ${result.rotomDrops.join(', ')}!`
          : '';
        await message.reply({
          content:
            `${paymentText}\n` +
            `${getTrainerIconEmoji(userId)} **${message.author.username}** swapped: ${offeredDisplay} ` +
            `(${result.offeredRemaining} left in box)\n` +
            `${getTrainerIconEmoji(userId)} **${message.author.username}** received: ${rewardDisplay}\n` +
            `🎟️ Swap rate: **${Math.round((result.multiplier - 1) * 100)}%**` +
            `${result.payment === 'coins' ? `\n🎟️ Swap Tickets: **${remainingTickets}**` : ''}` +
            `${dropsText}`,
          embeds: [swapEmbed],
        });
        await announceRareSpawn(message.guild, message.author, {
          ...result.reward,
          id: result.reward.id,
          isShiny: result.receivedShiny,
          isGolden: result.receivedGolden,
        });
        return;
      }
    }

    if (command === 'collection' || command === 'collections' || command === 'coll') {
      const sub = args[0]?.toLowerCase();
      const recentFilter = "gc.updated_at >= datetime('now', '-3 months')";
      const getRows = (options = {}) => {
        const conditions = [recentFilter];
        const values = [];
        if (!options.includePrivate) conditions.push('gc.is_private = 0');
        if (options.userId) {
          conditions.push('gc.user_id = ?');
          values.push(options.userId);
        }
        if (options.buyersOnly) conditions.push('gc.buy_price IS NOT NULL');
        if (options.nonBuyersOnly) conditions.push('gc.buy_price IS NULL');
        if (options.pokemonId) {
          conditions.push('gc.pokemon_id = ?');
          values.push(options.pokemonId);
        }
        if (options.pokemonName) {
          conditions.push(`(
            LOWER(gc.pokemon_name) = ?
            OR gc.pokemon_id IN (
              SELECT id FROM pokemon_forms WHERE LOWER(name) = ? OR LOWER(slug) = ?
            )
          )`);
          values.push(options.pokemonName, options.pokemonName, options.pokemonName.replace(/\s+/g, '-'));
        }
        if (options.rarity) {
          conditions.push('LOWER(pf.rarity) = ?');
          values.push(options.rarity);
        }
        if (options.minimumCount !== undefined) {
          conditions.push(`(
            SELECT COUNT(*) FROM catches owned
            WHERE owned.user_id = gc.user_id AND owned.pokemon_id = gc.pokemon_id
          ) >= ?`);
          values.push(options.minimumCount);
        }
        if (options.minimumShare !== undefined) {
          conditions.push(`(
            SELECT COUNT(*) FROM catches owned
            WHERE owned.user_id = gc.user_id AND owned.pokemon_id = gc.pokemon_id
          ) * 100.0 / MAX(1, (
            SELECT COUNT(*) FROM catches population WHERE population.pokemon_id = gc.pokemon_id
          )) >= ?`);
          values.push(options.minimumShare);
        }
        return db.prepare(`
          SELECT gc.*,
            COALESCE(pf.rarity, 'Unknown') AS rarity,
            (SELECT COUNT(*) FROM catches owned
              WHERE owned.user_id = gc.user_id AND owned.pokemon_id = gc.pokemon_id) AS owned_count,
            (SELECT COUNT(*) FROM catches population
              WHERE population.pokemon_id = gc.pokemon_id) AS population_count
          FROM global_collections gc
          LEFT JOIN pokemon_forms pf ON pf.id = gc.pokemon_id
          WHERE ${conditions.join(' AND ')}
          ORDER BY gc.updated_at DESC, gc.id DESC
          LIMIT ${options.limit || 50}
        `).all(...values);
      };
      const formatRelativeTime = (timestamp) => {
        const then = new Date(`${String(timestamp).replace(' ', 'T')}Z`).getTime();
        const minutes = Math.max(0, Math.floor((Date.now() - then) / 60000));
        if (minutes < 1) return 'just now';
        if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
        const days = Math.floor(hours / 24);
        return `${days} day${days === 1 ? '' : 's'} ago`;
      };
      const sendCollectionFeed = async (requestedPage) => {
        const pageSize = 18;
        const entries = getRows({ buyersOnly: false, nonBuyersOnly: true, limit: 180 });
        if (!entries.length) {
          return message.reply(
            `No public collections registered yet! Register one with \`${PREFIX}coll register <Pokédex number>\`.`
          );
        }
        const totalPages = Math.ceil(entries.length / pageSize);
        let page = Math.min(Math.max(1, requestedPage || 1), totalPages);
        const buildEmbed = () => {
          const lines = entries.slice((page - 1) * pageSize, page * pageSize).map((row) => {
            const emoji = getRarityEmojis(row.rarity, row.pokemon_name);
            const percent = ((row.owned_count / Math.max(1, row.population_count)) * 100).toFixed(2);
            return `${emoji ? `${emoji} ` : ''}**${row.pokemon_name} x${row.owned_count.toLocaleString()}** ` +
              `\`#${row.pokemon_id}\` \`(${percent}%)\` • <@${row.user_id}> • ${formatRelativeTime(row.updated_at)}`;
          });
          return new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle('Global Collections — Recent collections (non-buyers)')
            .setDescription(
              `${lines.join('\n')}\n\n💰 To view buyer collections, type \`${PREFIX}coll buyers\``
            )
            .setFooter({
              text: `Page ${page} / ${totalPages} • Data refreshes automatically every 10 mins • ${PREFIX}coll info`,
            });
        };
        const buildButtons = (disabled = false) => new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('collfeed:first').setEmoji('⏪')
            .setStyle(ButtonStyle.Secondary).setDisabled(disabled || page === 1),
          new ButtonBuilder().setCustomId('collfeed:prev').setLabel('Back').setEmoji('⬅️')
            .setStyle(ButtonStyle.Primary).setDisabled(disabled || page === 1),
          new ButtonBuilder().setCustomId('collfeed:next').setLabel('Next').setEmoji('➡️')
            .setStyle(ButtonStyle.Primary).setDisabled(disabled || page === totalPages),
          new ButtonBuilder().setCustomId('collfeed:last').setEmoji('⏩')
            .setStyle(ButtonStyle.Secondary).setDisabled(disabled || page === totalPages)
        );
        const feedMessage = await message.reply({
          embeds: [buildEmbed()],
          components: totalPages > 1 ? [buildButtons()] : [],
        });
        if (totalPages <= 1) return feedMessage;
        const collector = feedMessage.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 90000,
        });
        collector.on('collect', async (interaction) => {
          if (interaction.user.id !== message.author.id) {
            return interaction.reply({
              content: `Use \`${PREFIX}coll\` yourself to browse global collections.`,
              ephemeral: true,
            });
          }
          const action = interaction.customId.split(':')[1];
          if (action === 'first') page = 1;
          else if (action === 'prev') page = Math.max(1, page - 1);
          else if (action === 'next') page = Math.min(totalPages, page + 1);
          else if (action === 'last') page = totalPages;
          await interaction.update({ embeds: [buildEmbed()], components: [buildButtons()] });
        });
        collector.on('end', () => {
          feedMessage.edit({ components: [] }).catch(() => {});
        });
        return feedMessage;
      };
      const rowsToDescription = (rows, showPrivacy = false) => rows.map((row) => {
        const priceText = row.buy_price
          ? ` • Buying for: **${EMOJIS.pokecoin} ${row.buy_price.toLocaleString()}**`
          : '';
        const privacyText = showPrivacy && row.is_private ? ' 🔒 *(Private)*' : '';
        return `• <@${row.user_id}> — **#${row.pokemon_id} ${row.pokemon_name}**` +
          ` • Count: \`${row.owned_count}\`${priceText}${privacyText}`;
      }).join('\n').slice(0, 4000);
      const collectionEmbed = (title, rows, showPrivacy = false) => new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle(title)
        .setDescription(rows.length
          ? rowsToDescription(rows, showPrivacy)
          : 'No matching public collections have been updated in the past 3 months.')
        .setFooter({ text: 'Showing up to 50 collections updated in the past 3 months.' });
      const makeHelpEmbed = () => new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle('Global Collections Information')
        .setDescription(
          'Show off your Pokémon and find trainers to help grow your collections.\n\n' +
          '**Registering and managing entries**\n' +
          `\`${PREFIX}coll register <Pokémon name|Pokédex number> [buy price]\` (maximum 5)\n` +
          `\`${PREFIX}coll update <Pokémon name|Pokédex number> [buy price]\`\n` +
          `\`${PREFIX}coll update all\` — Refresh all of your entries\n` +
          `\`${PREFIX}coll delete <Pokémon name|Pokédex number>\`\n` +
          `\`${PREFIX}coll private <Pokémon name|Pokédex number|all>\`\n` +
          `\`${PREFIX}coll unprivate <Pokémon name|Pokédex number|all>\`\n` +
          '*These entries do not affect your actual box Pokémon.*\n\n' +
          '**Browsing collections**\n' +
          `\`${PREFIX}collection\` — Recent public collections\n` +
          `\`${PREFIX}collection view buyers\` — Recent public buy offers\n` +
          `\`${PREFIX}collection view <Pokédex number|name>\`\n` +
          `\`${PREFIX}collection view <rarity>\`\n` +
          `\`${PREFIX}collection count <amount|percentage%>\`\n` +
          `\`${PREFIX}collection mine\` or \`${PREFIX}collection <@user|user ID>\``
        );

      if (sub === 'help' || sub === 'info') {
        return message.reply({ embeds: [makeHelpEmbed()] });
      }

      if (!sub || /^\d{1,6}$/.test(sub)) {
        return sendCollectionFeed(sub ? Number(sub) : 1);
      }

      if (sub === 'buyers') {
        const rows = getRows({ buyersOnly: true });
        return message.reply({ embeds: [collectionEmbed('🛰️ Global Collections — Active Buyers', rows)] });
      }

      if (sub === 'update' && args[1]?.toLowerCase() === 'all' && args.length === 2) {
        const updated = refreshAllCollections(userId);
        return message.reply(updated
          ? `🔄 Updated **${updated}** collection${updated === 1 ? '' : 's'}.`
          : `You have no collections registered. Use \`${PREFIX}coll register <Pokédex number>\`.`);
      }

      if (sub === 'register' || sub === 'update') {
        if (args.length < 2) {
          return message.reply(`Usage: \`${PREFIX}coll ${sub} <Pokémon name|Pokédex number> [buy price]\`.`);
        }
        const values = args.slice(1);
        let buyPrice = null;
        if (values.length > 1) {
          const possiblePrice = parseAmount(values[values.length - 1]);
          if (Number.isSafeInteger(possiblePrice)) {
            buyPrice = possiblePrice;
            values.pop();
          }
        }
        if (buyPrice !== null && buyPrice <= 0) {
          return message.reply('The optional buy price must be a positive amount.');
        }
        const pokemonQuery = values.join(' ').trim();
        const form = resolvePokemonForm(pokemonQuery);
        if (!form) return message.reply(`Pokémon **${pokemonQuery}** was not found in the Pokédex.`);
        const owned = db.prepare(
          'SELECT name FROM catches WHERE user_id = ? AND pokemon_id = ? LIMIT 1'
        ).get(userId, form.id);
        const pokemonName = owned?.name || form.name;
        const registered = registerCollection(userId, form.id, pokemonName, buyPrice);
        if (!registered) {
          return message.reply('❌ You can register a maximum of **5 Pokémon** in your Global Collection.');
        }
        return message.reply(
          `🛰️ Registered **${pokemonName}** to your Global Collection!` +
          (buyPrice
            ? ` Buy price set to **${EMOJIS.pokecoin} ${buyPrice.toLocaleString()}**.`
            : '')
        );
      }

      if (sub === 'delete' || sub === 'remove') {
        const pokemonQuery = args.slice(1).join(' ').trim();
        const form = resolvePokemonForm(pokemonQuery);
        if (!form) {
          return message.reply(`Usage: \`${PREFIX}coll delete <Pokémon name|Pokédex number>\`.`);
        }
        const deleted = deleteCollection(userId, form.id);
        return message.reply(deleted
          ? `🗑️ Removed **${form.name}** from your Global Collection.`
          : `You do not have **${form.name}** registered.`);
      }

      if (sub === 'private' || sub === 'unprivate') {
        const targetArg = args.slice(1).join(' ').trim();
        if (!targetArg) {
          return message.reply(`Usage: \`${PREFIX}coll ${sub} <Pokémon name|Pokédex number|all>\`.`);
        }
        const isPrivate = sub === 'private';
        if (targetArg.toLowerCase() === 'all') {
          const updated = setCollectionPrivacy(userId, 'all', isPrivate);
          return message.reply(
            `🔒 Set **${updated}** collection${updated === 1 ? '' : 's'} to ` +
            `**${isPrivate ? 'private' : 'public'}**.`
          );
        }
        const form = resolvePokemonForm(targetArg);
        if (!form) return message.reply(`Pokémon **${targetArg}** was not found in the Pokédex.`);
        const updated = setCollectionPrivacy(userId, form.id, isPrivate);
        return message.reply(updated
          ? `🔒 Collection for **${form.name}** is now **${isPrivate ? 'private' : 'public'}**.`
          : `You do not have **${form.name}** registered.`);
      }

      if (sub === 'mine' || message.mentions.users.first() || /^\d{17,20}$/.test(sub)) {
        if (args.length > 1) {
          return message.reply(`Usage: \`${PREFIX}collection mine\` or \`${PREFIX}collection <@user|user ID>\`.`);
        }
        const targetUser = sub === 'mine'
          ? message.author
          : message.mentions.users.first() || await client.users.fetch(sub).catch(() => null);
        if (!targetUser) return message.reply('User not found.');
        const rows = getRows({
          userId: targetUser.id,
          includePrivate: targetUser.id === userId,
        });
        return message.reply({
          embeds: [collectionEmbed(`🛰️ ${targetUser.username}'s Collection`, rows, targetUser.id === userId)],
        });
      }

      if (sub === 'view') {
        const viewArg = args.slice(1).join(' ').trim();
        if (!viewArg) {
          return message.reply(
            `Usage: \`${PREFIX}collection view buyers\`, \`${PREFIX}collection view <Pokédex number|name>\`, ` +
            `or \`${PREFIX}collection view <rarity>\`.`
          );
        }
        if (args.length === 2 && viewArg.toLowerCase() === 'buyers') {
          const rows = getRows({ buyersOnly: true });
          return message.reply({
            embeds: [collectionEmbed('🛰️ Global Collection — Active Buyers', rows)],
          });
        }
        const rarity = db.prepare(
          'SELECT 1 FROM pokemon_forms WHERE LOWER(rarity) = ? LIMIT 1'
        ).get(viewArg.toLowerCase());
        if (rarity) {
          const rows = getRows({ rarity: viewArg.toLowerCase() });
          return message.reply({
            embeds: [collectionEmbed(`🛰️ Global Collections — ${viewArg}`, rows)],
          });
        }
        const form = resolvePokemonForm(viewArg);
        if (form) {
          const rows = getRows({ pokemonId: form.id });
          return message.reply({
            embeds: [collectionEmbed(`🛰️ Collections for ${form.name}`, rows)],
          });
        }
        return message.reply(`Pokémon **${viewArg}** was not found in the Pokédex.`);
      }

      if (sub === 'count') {
        if (args.length !== 2) {
          return message.reply(`Usage: \`${PREFIX}collection count <amount|percentage%>\`.`);
        }
        const countRows = (minimumCount, minimumShare) => getRows({ minimumCount, minimumShare });
        if (/^\d+(?:\.\d+)?%$/.test(args[1])) {
          const percentage = Number(args[1].slice(0, -1));
          if (percentage <= 0 || percentage > 100) {
            return message.reply('Choose a population share greater than 0% and up to 100%.');
          }
          const rows = countRows(undefined, percentage);
          return message.reply({
            embeds: [collectionEmbed(`🛰️ Collections Holding at Least ${percentage}% of Population`, rows)],
          });
        }
        const minimumCount = parseAmount(args[1]);
        if (!Number.isSafeInteger(minimumCount) || minimumCount <= 0) {
          return message.reply('Specify a positive Pokémon count or a population percentage such as `20%`.');
        }
        const rows = countRows(minimumCount, undefined);
        return message.reply({
          embeds: [collectionEmbed(`🛰️ Collections with at Least ${minimumCount} Pokémon`, rows)],
        });
      }

      return message.reply(`Use \`${PREFIX}coll help\` to see Global Collection commands.`);
    }

    if (command === 'token' || command === 'tokens') {
      const action = args[0]?.toLowerCase();
      if (action === 'buy' || action === 'sell') {
        const amount = parseAmount(args[1] || '');
        const price = args[2] === undefined ? null : parseAmount(args[2]);
        if (args.length > 3 || !Number.isSafeInteger(amount) || amount < 1 || amount > 1000000
            || (action === 'sell' && price === null)
            || (price !== null && (!Number.isSafeInteger(price) || price < 1 || price > 1000000000))) {
          return message.reply(
            action === 'buy'
              ? `Usage: \`${PREFIX}token buy <amount> [price per token]\`. Omit price to buy from the cheapest sell orders.`
              : `Usage: \`${PREFIX}token sell <amount> <price per token>\`.`
          );
        }
        const result = createPatreonTokenOrder(userId, action, amount, price);
        if (result.error === 'insufficient_tokens') {
          return message.reply(
            `❌ You need **${result.required.toLocaleString()}** Patreon Tokens including the order fee; ` +
            `you own **${result.owned.toLocaleString()}**.`
          );
        }
        const failures = {
          no_sell_orders: 'There are no sell orders to buy from. Try again later or place a priced buy order.',
          insufficient_coins: `You do not have enough ${EMOJIS.pokecoin} PokéCoins to fund that buy order.`,
          amount_too_large: 'That order total exceeds the supported balance limit.',
          sell_price_required: 'A sell order requires a price per token.',
        };
        if (result.error) return message.reply(`❌ ${failures[result.error] || 'That token order could not be placed.'}`);
        const lines = [
          `✅ ${action === 'buy' ? 'Buy' : 'Sell'} order for **${amount.toLocaleString()}** Patreon Tokens`,
          `• ${action === 'buy' && price !== null ? 'Limit price' : 'Price'}: ${EMOJIS.pokecoin} **${result.price.toLocaleString()}** each`,
        ];
        if (result.filled) {
          lines.push(`• Filled immediately: **${result.filled.toLocaleString()}** token${result.filled === 1 ? '' : 's'}`);
          if (action === 'buy' && result.averagePrice) {
            lines.push(`• Average fill price: ${EMOJIS.pokecoin} **${result.averagePrice.toLocaleString()}** each`);
          }
        }
        if (result.order) {
          lines.push(
            `• Open order: **#${result.order.id}** for **${result.order.remaining_amount.toLocaleString()}** token${result.order.remaining_amount === 1 ? '' : 's'}`,
            `• Expires <t:${Math.floor(result.order.expires_at / 1000)}:R>`
          );
          if (result.side === 'sell' && result.feeAmount) {
            lines.push(`• Up-front market fee: **${result.feeAmount.toLocaleString()}** token${result.feeAmount === 1 ? '' : 's'}`);
          }
          lines.push(`Cancel with \`${PREFIX}token cancel ${result.order.id}\`.`);
        } else if (result.side === 'buy' && result.filled < amount) {
          lines.push(`• Unfilled amount (**${(amount - result.filled).toLocaleString()}**) was not charged.`);
        }
        return message.reply(lines.join('\n'));
      }

      if (action === 'cancel') {
        const orderId = Number(args[1]);
        if (args.length !== 2 || !Number.isSafeInteger(orderId) || orderId < 1) {
          return message.reply(`Usage: \`${PREFIX}token cancel <order ID>\`.`);
        }
        const order = cancelPatreonTokenOrder(userId, orderId);
        if (!order) return message.reply('That open token order was not found. It may already be filled, cancelled, or expired.');
        const returned = order.side === 'buy'
          ? `${EMOJIS.pokecoin} **${(order.remaining_amount * order.unit_price).toLocaleString()} PokéCoins**`
          : `${EMOJIS.patreonToken} **${order.remaining_amount.toLocaleString()} Patreon Tokens**`;
        return message.reply(`✅ Cancelled token order **#${order.id}**. Returned ${returned}. Any sell-order fee already charged is not refunded.`);
      }
      if (action && !['buy', 'sell', 'cancel', 'orders', 'info', 'help'].includes(action)) {
        return message.reply(
          `Use \`${PREFIX}token\` to open the market, \`${PREFIX}token buy|sell\` to trade, ` +
          `\`${PREFIX}token orders\` to view your orders, or \`${PREFIX}token cancel <order ID>\`.`
        );
      }

      const stats = getPatreonTokenMarketStats();
      const monthName = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(new Date());
      let view = action === 'help'
        ? 'info'
        : ['buy', 'sell', 'orders', 'info'].includes(action) ? action : 'sell';
      const describeOrders = (orders, side) => orders.length
        ? orders.map((order) =>
          `• **${order.remaining_amount.toLocaleString()}** tokens — ${EMOJIS.pokecoin} **${order.unit_price.toLocaleString()}** each • expires <t:${Math.floor(order.expires_at / 1000)}:R>`
        ).join('\n')
        : `No open ${side} orders.`;
      const buildTokenEmbed = () => {
        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`🪙 Patreon Token Market — ${view === 'info' ? 'Information' : view === 'orders' ? 'Your orders' : `${view === 'buy' ? 'Buy' : 'Sell'} orders`}`)
          .addFields({
            name: `📊 Total tokens traded in ${monthName}`,
            value: `${EMOJIS.patreonToken} ${stats.volume.toLocaleString()}\n• Average price: ${EMOJIS.pokecoin} ${Math.round(stats.average_price).toLocaleString()} per token`,
            inline: false,
          });
        if (view === 'info') {
          embed.setDescription(
            `**Selling tokens**\n` +
            `• Place a sell order: \`${PREFIX}token sell <amount> <price>\`\n` +
            '• Matching buy orders fill immediately; any remainder stays open.\n' +
            '• Open sell orders pay a 5% up-front fee (2.5% for Patreon supporters). The fee is waived for tokens filled immediately.\n\n' +
            `**Buying tokens**\n` +
            `• Buy from the cheapest available sell order: \`${PREFIX}token buy <amount>\`\n` +
            `• Place a limit buy order: \`${PREFIX}token buy <amount> <price>\`\n` +
            '• A limit buy immediately matches sell orders priced at or below your limit; any affordable remainder is posted at your limit price. Coins are charged at the listed sell prices, and funds for open buy orders are held until filled, cancelled, or expired. There is no buy-order fee.\n\n' +
            '**Orders**\n' +
            '• Orders expire after 2 days (5 days for Patreon supporters).\n' +
            `• View or cancel open orders with \`${PREFIX}token orders\` and \`${PREFIX}token cancel <order ID>\`.\n` +
            '• Expired or cancelled orders return unfilled tokens or reserved coins; sell-order fees are not refunded.'
          );
        } else if (view === 'orders') {
          const orders = getUserPatreonTokenOrders(userId);
          embed.setDescription(orders.length
            ? orders.map((order) =>
              `**#${order.id} ${order.side.toUpperCase()}** — ${order.remaining_amount.toLocaleString()} token${order.remaining_amount === 1 ? '' : 's'} at ${EMOJIS.pokecoin} ${order.unit_price.toLocaleString()} each • expires <t:${Math.floor(order.expires_at / 1000)}:R>` +
              (order.side === 'sell' && order.fee_amount ? ` • fee paid: ${order.fee_amount} token${order.fee_amount === 1 ? '' : 's'}` : '') +
              `\nCancel: \`${PREFIX}token cancel ${order.id}\``
            ).join('\n\n')
            : 'You have no open token orders.');
        } else {
          const orders = getPatreonTokenOrderBook(view, 15);
          embed.setDescription(
            `Buy orders: \`${PREFIX}token buy <amount> [price]\`\n` +
            `Sell orders: \`${PREFIX}token sell <amount> <price>\`\n\n` +
            describeOrders(orders, view)
          );
        }
        return embed.addFields({
          name: 'Your balances',
          value: `${EMOJIS.pokecoin} ${getUser(userId).coins.toLocaleString()} PokéCoins • ${EMOJIS.patreonToken} ${getUser(userId).patreon_tokens.toLocaleString()} Patreon Tokens`,
          inline: false,
        });
      };
      const buildTokenButtons = (disabled = false) => new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('token-market:buy').setLabel('Buy orders')
          .setStyle(ButtonStyle.Success).setDisabled(disabled || view === 'buy'),
        new ButtonBuilder().setCustomId('token-market:sell').setLabel('Sell orders')
          .setStyle(ButtonStyle.Danger).setDisabled(disabled || view === 'sell'),
        new ButtonBuilder().setCustomId('token-market:orders').setLabel('Your orders')
          .setStyle(ButtonStyle.Secondary).setDisabled(disabled || view === 'orders'),
        new ButtonBuilder().setCustomId('token-market:info').setLabel('ℹ️')
          .setStyle(ButtonStyle.Secondary).setDisabled(disabled || view === 'info')
      );
      const tokenMessage = await message.reply({
        embeds: [buildTokenEmbed()],
        components: [buildTokenButtons()],
      });
      const collector = tokenMessage.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 120000,
      });
      collector.on('collect', async (interaction) => {
        if (interaction.user.id !== userId) {
          return interaction.reply({ content: `Run \`${PREFIX}token\` to open your own token market view.`, ephemeral: true });
        }
        view = interaction.customId.split(':')[1];
        await interaction.update({
          embeds: [buildTokenEmbed()],
          components: [buildTokenButtons()],
        });
      });
      collector.on('end', () => {
        tokenMessage.edit({ components: [buildTokenButtons(true)] }).catch((error) => {
          console.error(`Failed to disable token market buttons for user ${userId}:`, error);
        });
      });
      return;
    }

    if (command === 'market' || command === 'm') {
      if (args[0]?.toLowerCase() === 'claim') {
        const summary = getUserMarketSaleSummary(userId);
        if (!summary.sale_count) {
          return message.reply(
            'No tracked player market sales yet. Sale proceeds are credited automatically when a listing sells; ' +
            'sales completed before sale history was added are not available.'
          );
        }
        const pageSize = 10;
        const totalPages = Math.ceil(summary.sale_count / pageSize);
        let currentPage = 1;
        const pageEmbed = () => {
          const sales = getUserMarketSales(userId, pageSize, (currentPage - 1) * pageSize);
          return new EmbedBuilder()
            .setColor(0x1abc9c)
            .setTitle('🏪 Your Sold Market Listings')
            .setDescription(
              sales.map((sale) =>
                `**#${sale.listing_id} —** ${formatPokemonReward(sale)}\n` +
                `Sold for ${EMOJIS.pokecoin} **${sale.sale_price.toLocaleString()}** • ` +
                `${sale.tax_rate}% tax: ${EMOJIS.pokecoin} **${sale.tax_amount.toLocaleString()}** • ` +
                `Credited: ${EMOJIS.pokecoin} **${sale.payout_amount.toLocaleString()}**\n` +
                `Sold: ${sale.sold_at} • Buyer: <@${sale.buyer_id}>`
              ).join('\n\n')
            )
            .addFields(
              {
                name: 'Lifetime sales',
                value: `${summary.sale_count.toLocaleString()} listings • Gross: ${EMOJIS.pokecoin} ${summary.gross_amount.toLocaleString()}`,
                inline: true,
              },
              {
                name: 'Tax paid',
                value: `${EMOJIS.pokecoin} ${summary.tax_amount.toLocaleString()}`,
                inline: true,
              },
              {
                name: 'Total credited',
                value: `${EMOJIS.pokecoin} ${summary.payout_amount.toLocaleString()}`,
                inline: true,
              }
            )
            .setFooter({
              text: `Page ${currentPage}/${totalPages} • Proceeds are credited automatically when listings sell.`,
            });
        };
        if (totalPages === 1) return message.reply({ embeds: [pageEmbed()] });
        const pageButtons = () => new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('market-claim:prev')
            .setLabel('Previous')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage === 1),
          new ButtonBuilder()
            .setCustomId('market-claim:next')
            .setLabel('Next')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage === totalPages)
        );
        const claimMessage = await message.reply({
          embeds: [pageEmbed()],
          components: [pageButtons()],
        });
        const collector = claimMessage.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 90000,
        });
        collector.on('collect', async (interaction) => {
          try {
            if (interaction.user.id !== userId) {
              return interaction.reply({
                content: `Run \`${PREFIX}market claim\` to view your own sale history.`,
                ephemeral: true,
              });
            }
            currentPage = interaction.customId === 'market-claim:prev'
              ? Math.max(1, currentPage - 1)
              : Math.min(totalPages, currentPage + 1);
            await interaction.update({ embeds: [pageEmbed()], components: [pageButtons()] });
          } catch (error) {
            console.error(`Failed to change market claim page for user ${userId}:`, error);
            if (!interaction.replied && !interaction.deferred) {
              await interaction.reply({
                content: 'Could not change your market history page.',
                ephemeral: true,
              });
            }
          }
        });
        collector.on('end', () => {
          claimMessage.edit({ components: [] }).catch((error) => {
            console.error(`Failed to disable market claim buttons for user ${userId}:`, error);
          });
        });
        return;
      }

      if (args[0]?.toLowerCase() === 'list') {
        const values = args.slice(1);
        const price = parseAmount(values.pop());
        const amount = parseAmount(values.pop());
        const pokemonQuery = values.join(' ').trim();
        if (!pokemonQuery
            || !Number.isSafeInteger(amount) || amount < 1 || amount > 100
            || !Number.isSafeInteger(price) || price <= 0) {
          return message.reply(
            `Usage: \`${PREFIX}market list <Pokémon number or name> <amount 1-100> <price per Pokémon>\`.`
          );
        }
        const pokemon = resolvePokemonForm(pokemonQuery);
        if (!pokemon) {
          return message.reply(`No exact Pokémon or form named **${pokemonQuery}** was found in the catalog.`);
        }
        const listed = listPokemonOnMarket(userId, pokemon.id, amount, price);
        if (listed?.error === 'listing_limit') {
          return message.reply(
            `❌ You have **${listed.listingCount}/${listed.listingLimit}** active market listings. ` +
            `Remove or sell listings before adding ${amount} more.`
          );
        }
        if (!listed) {
          const available = db.prepare(`
            SELECT COUNT(*) AS count FROM catches
            WHERE user_id = ? AND pokemon_id = ? AND in_team = 0
          `).get(userId, pokemon.id).count;
          return message.reply(
            `You have **${available}** eligible ${pokemon.name} in your box; ` +
            `you need **${amount}** to create that listing. Pokémon on your active team cannot be listed.`
          );
        }

        const announcement = await announceMarketListings(
          message,
          listed.map((entry) => ({ ...entry, price }))
        );
        const announcementWarning = announcement.failures
          ? ' The listings were created, but their channel announcement failed.'
          : '';
        return message.reply(
          `🏪 Listed **${listed.length}x ${pokemon.name}** for ${EMOJIS.pokecoin} ` +
          `**${price.toLocaleString()} PokéCoins each**. Listing IDs: ` +
          `${listed.map((entry) => `#${entry.market_listing_id}`).join(', ')}.${announcementWarning}`
        );
      }

      if (args[0] === 'add') {
        const values = args.slice(1);
        const price = parseAmount(values.pop());
        const pokemonQuery = values.join(' ').trim();
        if (!pokemonQuery || !Number.isSafeInteger(price) || price <= 0) {
          return message.reply(`Usage: \`${PREFIX}market add <Pokémon name|Pokédex number> <price>\`.`);
        }
        const pokemon = resolvePokemonForm(pokemonQuery);
        if (!pokemon) {
          return message.reply(`No exact Pokémon or form named **${pokemonQuery}** was found in the catalog.`);
        }
        const listings = listPokemonOnMarket(userId, pokemon.id, 1, price);
        if (listings?.error === 'listing_limit') {
          return message.reply(
            `❌ You have **${listings.listingCount}/${listings.listingLimit}** active market listings. ` +
            `Remove or sell a listing before adding another.`
          );
        }
        if (!listings) {
          const available = db.prepare(`
            SELECT COUNT(*) AS count FROM catches
            WHERE user_id = ? AND pokemon_id = ? AND in_team = 0
          `).get(userId, pokemon.id).count;
          return message.reply(available
            ? 'Could not list that Pokémon. It may already be listed.'
            : `You have no eligible **${pokemon.name}** outside your active team.`);
        }
        const listed = listings[0];
        const announcement = await announceMarketListings(
          message,
          [{ ...listed, price }]
        );
        const announcementWarning = announcement.failures
          ? ' The listing was created, but its channel announcement failed.'
          : '';
        return message.reply(
          `🏪 Listed ${formatPokemonReward(listed)} on the market for ${EMOJIS.pokecoin} ` +
          `**${price.toLocaleString()} PokéCoins**!${announcementWarning}`
        );
      }

      let search = null;
      if (args[0]?.toLowerCase() === 'view') {
        search = args.slice(1).join(' ').trim();
        if (!search) {
          return message.reply(`Usage: \`${PREFIX}m view <Pokémon name|Pokédex number>\`.`);
        }
        const searchForm = resolvePokemonForm(search);
        if (searchForm) {
          search = searchForm.name;
        }
      }
      const pageSize = 10;
      const listingCount = getMarketListingCount(search);
      if (!listingCount) {
        return message.reply(search
          ? `No market listings found for **${search}**.`
          : `The market is currently empty! Sell something using \`${PREFIX}market list <Pokémon number or name> <amount> <price>\`.`);
      }
      const totalPages = Math.ceil(listingCount / pageSize);
      let currentPage = 1;
      const pageEmbed = () => {
        const listings = getMarketListings(search, pageSize, (currentPage - 1) * pageSize);
        const embed = new EmbedBuilder()
          .setColor(0x1abc9c)
          .setTitle(search ? `🏪 Market Search: ${search}` : '🏪 Umbreon Global Market')
          .setDescription(
            listings.map((listing) => {
              const rarity = getDisplayRarity(
                listing.rarity,
                listing.name,
                Boolean(listing.is_shiny)
              );
              return `**#${listing.id} —** ${formatPokemonReward(listing)}\n` +
                `Rarity: **${rarity}** • Price: **${listing.price.toLocaleString()}** ${EMOJIS.pokecoin}\n` +
                `Amount: **1** • Buy with \`${PREFIX}mbuy ${listing.id}\``;
            }).join('\n\n')
          )
          .setFooter({
            text: `Page ${currentPage}/${totalPages} • ${listingCount} listings • ` +
              `Your listings: ${getUserMarketListingCount(userId)}/${getMarketListingLimit(userId)}`,
          });
        return embed;
      };
      const pageButtons = () => new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('market:prev')
          .setLabel('Previous')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(currentPage === 1),
        new ButtonBuilder()
          .setCustomId('market:next')
          .setLabel('Next')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(currentPage === totalPages)
      );
      const marketMessage = await message.reply({
        embeds: [pageEmbed()],
        components: [pageButtons()],
      });
      const collector = marketMessage.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 90000,
      });
      collector.on('collect', async (interaction) => {
        try {
          if (interaction.user.id !== userId) {
            await interaction.reply({
              content: `Run \`${PREFIX}m${search ? ` view ${search}` : ''}\` to browse these listings yourself.`,
              ephemeral: true,
            });
            return;
          }
          if (interaction.customId === 'market:prev') {
            currentPage = Math.max(1, currentPage - 1);
          } else if (interaction.customId === 'market:next') {
            currentPage = Math.min(totalPages, currentPage + 1);
          }
          await interaction.deferUpdate();
          await marketMessage.edit({ embeds: [pageEmbed()], components: [pageButtons()] });
        } catch (error) {
          console.error('Failed to change market listing page:', error);
          if (interaction.deferred) {
            await interaction.followUp({ content: 'Could not change the market page.', ephemeral: true });
          } else if (!interaction.replied) {
            await interaction.reply({ content: 'Could not change the market page.', ephemeral: true });
          }
        }
      });
      collector.on('end', async () => {
        try {
          await marketMessage.edit({ components: [] });
        } catch (error) {
          console.error('Failed to disable market pagination buttons:', error);
        }
      });
      return;
    }

    if (command === 'mbuy') {
      const listingId = Number.parseInt(args[0], 10);
      if (!Number.isSafeInteger(listingId) || listingId <= 0) {
        return message.reply('Usage: `.mbuy <market_id>`');
      }
      const result = buyMarketItem(userId, listingId);
      if (result.error) return message.reply(`❌ ${result.error}`);
      if (result.sale && getMarketCompletionNotificationsEnabled(result.item.seller_id)) {
        try {
          const seller = await client.users.fetch(result.item.seller_id);
          await seller.send(
            `✅ Your market listing **#${listingId}** sold: ${formatPokemonReward(result.item)} ` +
            `for ${EMOJIS.pokecoin} **${result.sale.salePrice.toLocaleString()} PokéCoins**.\n` +
            `Market tax (${result.sale.taxRate}%): ${EMOJIS.pokecoin} **${result.sale.taxAmount.toLocaleString()}**\n` +
            `Credited to your balance: ${EMOJIS.pokecoin} **${result.sale.payoutAmount.toLocaleString()} PokéCoins**` +
            `${result.sale.boostPercent ? ` (includes ${result.sale.boostPercent}% coin boost)` : ''}.`
          );
        } catch (error) {
          console.error(`Failed to send market completion DM to seller ${result.item.seller_id}:`, error);
        }
      }
      return message.reply(
        `🎉 You bought ${formatPokemonReward(result.item)} for ${EMOJIS.pokecoin} **${result.item.price}** PokéCoins!`
      );
    }

    const parseEvolutionArguments = (parts, itemFirst) => {
      for (let split = 1; split < parts.length; split += 1) {
        const itemParts = itemFirst ? parts.slice(0, split) : parts.slice(split);
        const itemName = findEvolutionItem(itemParts.join(' '));
        if (itemName) {
          return {
            itemName,
            pokemon: (itemFirst ? parts.slice(split) : parts.slice(0, split)).join(' '),
          };
        }
      }
      return { itemName: null, pokemon: parts.join(' ') };
    };

    if (command === 'evoitems' || command === 'stones') {
      const owned = new Map(getUserItems(userId).map((row) => [row.item_name, row.amount]));
      const describe = ([name, item]) => {
        const targets = item.evolutions.map(([from, to]) => {
          const names = db.prepare(`
            SELECT species_name FROM pokemon_forms WHERE species_id IN (?, ?) AND is_default = 1
            ORDER BY CASE species_id WHEN ? THEN 0 ELSE 1 END
          `).all(from, to, from).map((row) => row.species_name);
          return `${names[0]}→${names[1]}`;
        }).join(', ');
        return `${item.emoji} **${name}** ×${owned.get(name) || 0}\n${targets}`;
      };
      const entries = Object.entries(EVOLUTION_ITEMS);
      const stoneText = entries.filter(([, item]) => item.kind === 'stone').map(describe).join('\n');
      const heldText = entries.filter(([, item]) => item.kind === 'held').map(describe).join('\n');
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle('Evolution Stones')
            .setDescription(
              `Use with \`${PREFIX}evolve <Pokémon> <stone>\` or \`${PREFIX}use <stone> <Pokémon>\`.\n\n${stoneText}`
            )
            .setFooter({ text: 'Find them in Lootboxes and giveaways.' }),
          new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle('Evolution Held Items')
            .setDescription(
              `Use directly with \`${PREFIX}evolve <Pokémon> <item>\` or give with ` +
              `\`${PREFIX}hold <item> <Pokémon>\` before \`${PREFIX}evolve <Pokémon>\`. ` +
              `Take a held item back with \`${PREFIX}unhold <Pokémon>\`.\n\n${heldText}`
            ),
        ],
      });
    }

    if (command === 'evolve' || (command === 'use' && findEvolutionItem(args[0] || ''))
        || (command === 'use' && args.length > 1 && parseEvolutionArguments(args, true).itemName)) {
      const parsed = command === 'use'
        ? parseEvolutionArguments(args, true)
        : parseEvolutionArguments(args, false);
      if (!parsed.pokemon) {
        return message.reply(
          `Usage: \`${PREFIX}evolve <Pokémon> [item]\` to evolve with an item or when level requirements are met, ` +
          `or \`${PREFIX}use <item> <Pokémon>\`.`
        );
      }
      let result = evolvePokemonWithItem(userId, parsed.pokemon, parsed.itemName);
      if (!parsed.itemName && result.error === 'no_held_item') {
        result = evolvePokemonByLevel(userId, parsed.pokemon);
      }
      const failures = {
        unknown_item: 'That is not a known evolution item. See `' + PREFIX + 'evoitems`.',
        pokemon_not_owned: `You do not own a **${parsed.pokemon}**.`,
        no_held_item: `**${result.pokemonName}** is not holding an evolution item.`,
        cannot_evolve: `**${result.pokemonName}** cannot evolve with **${result.itemName}**.`,
        cannot_evolve_by_level: `**${result.pokemonName}** has no available level-based evolution.`,
        level_required: `**${result.pokemonName}** must reach level **${result.requiredLevel}** to evolve.`,
        friendship_required: `**${result.pokemonName}** needs **${result.requiredFriendship}** friendship to evolve (currently **${result.friendship}**). ` +
          `Catch Pokémon while it is your buddy to raise it.`,
        wrong_time: `**${result.pokemonName}** can only evolve with high friendship during the **${result.timeOfDay}**.`,
        no_item: `You do not have a **${result.itemName}**.`,
      };
      if (result.error) return message.reply(`❌ ${failures[result.error]}`);
      const emoji = getRarityEmojis(result.rarity, result.to, result.isShiny);
      const evolutionMethod = result.itemName
        ? `${EVOLUTION_ITEMS[result.itemName].emoji} using **${result.itemName}**`
        : result.friendship !== undefined
          ? `with **${result.friendship}** friendship 💖`
          : result.timeOfDay
            ? `at **${result.timeOfDay}time** by reaching level **${result.level}**`
            : `by reaching level **${result.level}**`;
      const embed = new EmbedBuilder()
        .setColor(getRarityColor(result.rarity, result.to, result.isShiny))
        .setTitle('What? Your Pokémon is evolving!')
        .setDescription(
          `**${result.from}** evolved into ` +
          `${emoji ? `${emoji} ` : ''}${result.isShiny ? '✨ ' : ''}**${result.to}** ${evolutionMethod}!\n` +
          `Level ${result.level} and IVs were kept.`
        );
      const sprite = getPokemonShowdownSprite(result.slug, result.isShiny, result.sprite);
      if (sprite) embed.setImage(sprite);
      return message.reply({ embeds: [embed] });
    }

    if (command === 'hold') {
      const parsed = parseEvolutionArguments(args, true);
      if (!parsed.itemName || !parsed.pokemon) {
        return message.reply(`Usage: \`${PREFIX}hold <item> <Pokémon>\`. See \`${PREFIX}evoitems\`.`);
      }
      const result = holdEvolutionItem(userId, parsed.itemName, parsed.pokemon);
      const failures = {
        not_holdable: `**${parsed.itemName}** is a stone — use it directly with \`${PREFIX}evolve\`.`,
        pokemon_not_owned: `You do not own a **${parsed.pokemon}**.`,
        item_held: `Your **${parsed.pokemon}** is already holding an item.`,
        no_item: `You do not have a **${parsed.itemName}**.`,
      };
      if (result.error) return message.reply(`❌ ${failures[result.error]}`);
      return message.reply(
        `✅ **${result.pokemonName}** is now holding **${result.itemName}**. Run \`${PREFIX}evolve ${result.pokemonName}\` to evolve it.`
      );
    }

    if (command === 'unhold') {
      if (!args.length) return message.reply(`Usage: \`${PREFIX}unhold <Pokémon>\`.`);
      const result = unholdEvolutionItem(userId, args.join(' '));
      if (result.error === 'pokemon_not_owned') return message.reply(`❌ You do not own a **${args.join(' ')}**.`);
      if (result.error) return message.reply('❌ That Pokémon is not holding an evolution item.');
      return message.reply(`✅ Took **${result.itemName}** back from **${result.pokemonName}**.`);
    }

    if (command === 'boxes') {
      const owned = new Map(getUserItems(userId).map((row) => [row.item_name, row.amount]));
      const boxLines = Object.entries(BOXES)
        .filter(([name]) => owned.has(name))
        .map(([name, box]) => `${box.emoji} **${name}: ${owned.get(name).toLocaleString()}**`);
      const voteBoxLines = Object.entries(VOTE_BOXES)
        .filter(([name]) => owned.has(name))
        .map(([name, box]) => `${box.emoji} **${name}: ${owned.get(name).toLocaleString()}**`);
      const lootboxes = getUser(userId).lootboxes;
      if (lootboxes > 0) boxLines.unshift(`${LOOTBOX_EMOJI} **Lootbox: ${lootboxes.toLocaleString()}**`);
      const lines = [...boxLines, ...voteBoxLines];
      return message.reply(
        `**Your boxes**\n${lines.length ? lines.join('\n') : 'You do not have any boxes.'}`
      );
    }

    if (command === 'use') {
      return message.reply(
        `Specify an item to use. Examples: \`${PREFIX}use rarecandy [amount|all]\`, ` +
        `\`${PREFIX}use incense [amount]\`, \`${PREFIX}use pokeradar [amount]\`, ` +
        `\`${PREFIX}use repel [amount]\`, \`${PREFIX}use <box> [amount|all]\`, or ` +
        `\`${PREFIX}use <evolution item> <Pokémon>\`. Some items are used through their own flows, ` +
        `such as balls during a catch, Eggs with \`${PREFIX}egg\`, or abilities with \`${PREFIX}bud info <Pokémon>\`.`
      );
    }

    if (command === 'open') {
      if (args[0]?.toLowerCase() === 'vote') {
        return message.reply(
          `The \`${PREFIX}open vote <rarity>\` syntax was removed. Open a Vote Box by name or alias, ` +
          `for example \`${PREFIX}open voterare\`.`
        );
      }
      const voteBoxName = findVoteBox(args[0] || '');
      if (voteBoxName) {
        const amountArgument = args[1];
        const owned = getUserItems(userId).find((row) => row.item_name === voteBoxName)?.amount || 0;
        const amount = amountArgument?.toLowerCase() === 'all'
          ? owned
          : amountArgument === undefined ? 1 : parseAmount(amountArgument);
        if (!Number.isSafeInteger(amount) || amount < 1) {
          if (amountArgument?.toLowerCase() === 'all' && owned === 0) {
            return message.reply(`❌ You do not own any **${voteBoxName}**.`);
          }
          const alias = VOTE_BOXES[voteBoxName].aliases[0];
          return message.reply(`Usage: \`${PREFIX}open ${alias} [amount|all]\`.`);
        }
        const opened = openVoteBox(userId, voteBoxName, amount);
        if (opened.error === 'insufficient') {
          return message.reply(`❌ You only own **${opened.owned}x ${voteBoxName}**.`);
        }
        const box = VOTE_BOXES[voteBoxName];
        const dropLines = [
          `${EMOJIS.votecoin} **${opened.voteCoins} Vote Coin${opened.voteCoins === 1 ? '' : 's'}**`,
          `${EMOJIS.pokecoin} **${opened.awardedPokecoins.toLocaleString()} PokéCoins**`,
          opened.rareCandies
            ? `${EMOJIS.rarecandy} **${opened.rareCandies} Rare Cand${opened.rareCandies === 1 ? 'y' : 'ies'}**`
            : null,
          opened.eggs ? `${EMOJIS.pokeEgg} **${opened.eggs} Egg${opened.eggs === 1 ? '' : 's'}**` : null,
          opened.masterballs
            ? `${EMOJIS.masterball} **${opened.masterballs} Masterball${opened.masterballs === 1 ? '' : 's'}**`
            : null,
        ].filter(Boolean);
        return message.reply({
          embeds: [makeEmbed(
            `${box.emoji} Opened ${amount}x ${voteBoxName}!`,
            `You received:\n${dropLines.map((line) => `• ${line}`).join('\n')}`,
            0xf1c40f
          )],
        });
      }

      const boxName = findBox(args[0] || '');
      if (!boxName) {
        const owned = new Map(getUserItems(userId).map((row) => [row.item_name, row.amount]));
        return message.reply(
          '**Your boxes**\n' +
          `${LOOTBOX_EMOJI} Lootbox: **${getUser(userId).lootboxes}** (\`${PREFIX}lb all\`)\n` +
          Object.entries(BOXES)
            .map(([name, box]) => `${box.emoji} ${name}: **${owned.get(name) || 0}** (\`${PREFIX}open ${box.aliases[0]} all\`)`)
            .concat(Object.entries(VOTE_BOXES).map(([name, box]) =>
              `${box.emoji} ${name}: **${owned.get(name) || 0}** (\`${PREFIX}open ${box.aliases[0]} all\`)`
            ))
            .join('\n')
        );
      }
      const owned = getUserItems(userId).find((row) => row.item_name === boxName)?.amount || 0;
      const amount = args[1]?.toLowerCase() === 'all'
        ? owned
        : args[1] === undefined ? 1 : parseAmount(args[1]);
      if (!Number.isSafeInteger(amount) || amount < 1) {
        if (args[1]?.toLowerCase() === 'all' && owned === 0) {
          return message.reply(`❌ You do not own any **${boxName}**.`);
        }
        return message.reply(`Usage: \`${PREFIX}open ${BOXES[boxName].aliases[0]} [amount|all]\`.`);
      }
      const box = BOXES[boxName];
      const opened = db.transaction(() => {
        if (!takeUserItem(userId, boxName, amount)) return null;
        const results = [];
        let coins = 0;
        let greatballs = 0;
        let ultraballs = 0;
        for (let index = 0; index < amount; index += 1) {
          coins += box.coins[0] + Math.floor(Math.random() * (box.coins[1] - box.coins[0] + 1));
          if (Math.random() < box.pokemonDropChance) {
            const pokemon = getRandomPokemon(box.rarity, false, true, true);
            saveCatch(userId, pokemon, box.shiny);
            results.push({ ...pokemon, isShiny: box.shiny });
          } else {
            greatballs += Math.floor(Math.random() * 5) + 2;
            ultraballs += Math.floor(Math.random() * 3) + 1;
          }
        }
        const boostedCoins = awardCoinsWithBoost(userId, coins).finalAmount;
        incrementUser(userId, {
          greatballs,
          ultraballs,
        });
        return { results, coins: boostedCoins, greatballs, ultraballs };
      }).immediate();
      if (!opened) return message.reply(`❌ You don't own ${amount}x **${boxName}**. Check \`${PREFIX}open\`.`);
      const lines = opened.results.map((pokemon) => {
        const emoji = getRarityEmojis(pokemon.rarity, pokemon.name, pokemon.isShiny);
        return `${emoji ? `${emoji} ` : ''}**${pokemon.isShiny ? '✨ ' : ''}${pokemon.name}**`;
      });
      const displayLines = lines.slice(0, 30);
      if (lines.length > displayLines.length) {
        displayLines.push(`*...and ${lines.length - displayLines.length} more Pokémon.*`);
      }
      for (const pokemon of opened.results) {
        await announceRareSpawn(message.guild, message.author, pokemon);
      }
      return message.reply({
        embeds: [makeEmbed(
          `${box.emoji} Opened ${amount}x ${boxName}!`,
          `${displayLines.length ? displayLines.join('\n') : '*No Pokémon dropped this time.*'}\n\n` +
          `${EMOJIS.pokecoin} **${opened.coins.toLocaleString()}** PokéCoins\n` +
          `${EMOJIS.greatball} **${opened.greatballs}x** Greatballs\n` +
          `${EMOJIS.ultraball} **${opened.ultraballs}x** Ultraballs`,
          box.shiny ? 0xff69b4 : 0xf1c40f
        )],
      });
    }

    if (command === 'lb' || command === 'lootbox') {
      if (args.length > 2 || (args[0] && args[0].toLowerCase() !== 'open' && args.length > 1)) {
        return message.reply(`Usage: \`${PREFIX}lb [amount|all]\` or \`${PREFIX}lootbox open [amount|all]\`.`);
      }
      const amountArgument = args[0]?.toLowerCase() === 'open' ? args[1] : args[0];
      const amount = amountArgument === 'all'
        ? getUser(userId).lootboxes
        : amountArgument === undefined ? 1 : parseAmount(amountArgument);
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        if (amountArgument === 'all' && amount === 0) return message.reply('❌ You do not own any Lootboxes.');
        return message.reply(`Usage: \`${PREFIX}lb [amount|all]\` or \`${PREFIX}lootbox open [amount|all]\`.`);
      }
      const opened = db.transaction(() => {
        const user = getUser(userId);
        if (user.lootboxes < amount) return { error: 'insufficient', owned: user.lootboxes };
        const rewards = {
          coins: 0,
          pokeballs: 0,
          greatballs: 0,
          ultraballs: 0,
          masterballs: 0,
          repels: 0,
          goldenRazz: 0,
          eggs: 0,
          questResetScrolls: 0,
          rareCandies: 0,
        };
        const chanceBoost = 1 + getPatreonPerks(userId).lootboxBoost;
        const rollDrop = (chance) => Math.random() < Math.min(1, chance * chanceBoost);
        for (let index = 0; index < amount; index += 1) {
          rewards.coins += Math.floor(Math.random() * 1001) + 50;
          rewards.pokeballs += Math.floor(Math.random() * 4) + 3;
          if (rollDrop(0.75)) rewards.greatballs += Math.floor(Math.random() * 4) + 1;
          if (rollDrop(0.35)) rewards.ultraballs += Math.floor(Math.random() * 2) + 1;
          if (rollDrop(0.005)) rewards.masterballs += 1;
          if (rollDrop(0.12)) rewards.repels += 1;
          if (rollDrop(0.12)) rewards.goldenRazz += 1;
          if (rollDrop(0.09)) rewards.eggs += 1;
          if (rollDrop(0.08)) rewards.questResetScrolls += 1;
          if (rollDrop(0.01)) rewards.rareCandies += 1;
        }
        const boostedCoins = awardCoinsWithBoost(userId, rewards.coins).finalAmount;
        incrementUser(userId, {
          lootboxes: -amount,
          lootboxes_opened: amount,
          pokeballs: rewards.pokeballs,
          greatballs: rewards.greatballs,
          ultraballs: rewards.ultraballs,
          masterballs: rewards.masterballs,
          repels: rewards.repels,
          grazz_berries: rewards.goldenRazz,
          vote_eggs: rewards.eggs,
          quest_reset_scrolls: rewards.questResetScrolls,
          rare_candies: rewards.rareCandies,
        });
        return {
          rewards: { ...rewards, coins: boostedCoins },
          amount,
        };
      }).immediate();
      if (opened.error === 'insufficient') {
        return message.reply(
          `❌ You only own **${opened.owned}x Lootbox${opened.owned === 1 ? '' : 'es'}**.`
        );
      }
      const description = `You opened **${opened.amount}x Lootbox${opened.amount === 1 ? '' : 'es'}** and received:\n` +
        `• ${EMOJIS.pokecoin} **${opened.rewards.coins.toLocaleString()}** PokéCoins\n` +
        `• ${EMOJIS.pokeball} **${opened.rewards.pokeballs}x** Pokéballs\n` +
        `• ${EMOJIS.greatball} **${opened.rewards.greatballs}x** Greatballs\n` +
        `• ${EMOJIS.ultraball} **${opened.rewards.ultraballs}x** Ultraballs\n` +
        `• ${EMOJIS.masterball} **${opened.rewards.masterballs}x** Masterballs\n` +
        `• ${EMOJIS.repel} **${opened.rewards.repels}x** Repels\n` +
        `• ${EMOJIS.goldenRazz} **${opened.rewards.goldenRazz}x** Golden Razz Berries\n` +
        `• ${EMOJIS.pokeEgg} **${opened.rewards.eggs}x** Eggs\n` +
        `• 📜 **${opened.rewards.questResetScrolls}x** Quest Reset Scrolls\n` +
        `• ${EMOJIS.rarecandy} **${opened.rewards.rareCandies}x** Rare Candies`;
      return message.reply({
        embeds: [makeEmbed(`📦 Lootbox${opened.amount === 1 ? '' : 'es'} Unboxed!`, description, 0xf39c12)],
      });
    }

    if (command === 'profile' || command === 'pr' || command === 'pro') {
      const profileTarget = message.mentions.users.first() || message.author;
      const profileId = profileTarget.id;
      const user = getUser(profileId);

      // Badge row: Patreon tier rarity emoji, faction logo, purchased clan perk tiers (trainer icon is the author image).
      const badges = [];
      if (user.patreon_tier && EMOJIS[user.patreon_tier]) badges.push(EMOJIS[user.patreon_tier]);
      const profileFaction = getUserFaction(profileId);
      if (profileFaction?.team?.emoji) badges.push(profileFaction.team.emoji);
      const profileClan = getPlayerClan(profileId);
      if (profileClan) {
        for (let index = 1; index <= (profileClan.perk_rank || 0); index += 1) {
          const rankName = Object.keys(CLAN_RANK_EMOJIS)[index];
          if (rankName) badges.push(CLAN_RANK_EMOJIS[rankName]);
        }
      }

      const favorites = db.prepare(
        'SELECT name, is_shiny, is_golden FROM catches WHERE user_id = ? AND is_fav = 1 ORDER BY id LIMIT 10'
      ).all(profileId);
      const favoriteLine = favorites.length
        ? `**Favorite Pokémon:** ${favorites.map((row) => `${row.is_golden ? EMOJIS.golden : row.is_shiny ? EMOJIS.shiny : ''}${row.name}`).join(', ')}`
        : 'No favorite Pokémon to show! *Your favorite Pokémon will show on your profile if your box is unlocked.*';
      const collections = getUserRegisteredCollections(profileId).filter((row) => !row.is_private);
      const collectionLine = collections.length
        ? `**Collections:** ${collections.slice(0, 10).map((row) => row.pokemon_name).join(', ')}`
        : `No collections to show! *Pokémon from* \`${PREFIX}coll mine\` *will show here*`;

      return message.reply({
        embeds: [new EmbedBuilder()
          .setColor(0x2b2d31)
          .setAuthor({
            name: profileTarget.username,
            iconURL: getTrainerIconUrl(profileId) || profileTarget.displayAvatarURL(),
          })
          .setDescription(`${badges.join(' ')}\n\n• ${favoriteLine}\n• ${collectionLine}`)],
      });
    }

    if (command === 'stats' || command === 's') {
      return await handleStatsCommand(message);
    }

    if (command === 'events' || command === 'event') {
      if ((args[0]?.toLowerCase() === 'cl') && args[1]?.toLowerCase() === 'claim') {
        return await handleEventCommand(message, userId, args.slice(1), true);
      }
      return await handleEventCommand(message, userId, args);
    }

    if (command === 'e') {
      if (args[0]?.toLowerCase() === 'claim') {
        return await handleEventCommand(message, userId, ['cl', 'claim']);
      }
      if (args[0]?.toLowerCase() === 'cl') {
        return await handleEventCommand(message, userId, args.slice(1), true);
      }
      return await handleEventCommand(message, userId, args);
    }

    if (command === 'checklist' || command === 'cl') {
      resetChecklistIfNewDay(userId);
      const eventTaskActive = isEventOpen(halloweenEvent);
      const requirements = {
        catches: 25,
        fishes: 10,
        battles: 5,
        eventCatches: eventTaskActive ? 1 : 0,
      };
      const isComplete = (user) =>
        user.cl_daily_claimed === 1
        && user.cl_catches >= requirements.catches
        && user.cl_fishes >= requirements.fishes
        && user.cl_battles >= requirements.battles
        && user.cl_event_catches >= requirements.eventCatches;

      if (args[0]?.toLowerCase() === 'claim') {
        const claimResult = db.transaction(() => {
          resetChecklistIfNewDay(userId);
          const currentUser = getUser(userId);
          if (currentUser.cl_claimed === 1) return { error: 'already_claimed' };
          if (!isComplete(currentUser)) return { error: 'incomplete' };

          const reward = rollChecklistRewards();
          updateUser(userId, { cl_claimed: 1 });
          incrementUser(userId, reward.increments);
          const coins = awardCoinsWithBoost(userId, reward.coins).finalAmount;
          return {
            reward: {
              ...reward,
              description:
                `• ${EMOJIS.pokecoin} **${coins.toLocaleString()}** PokéCoins\n` +
                reward.description,
            },
          };
        }).immediate();
        if (claimResult.error === 'already_claimed') {
          return message.reply('❌ You have already claimed today’s checklist rewards!');
        }
        if (claimResult.error === 'incomplete') {
          return message.reply('❌ You have not completed all checklist tasks yet! Check `.cl` for progress.');
        }
        return message.reply({
          embeds: [makeEmbed(
            '📋 Daily Checklist Completed!',
            'Awesome job completing all daily tasks!\n\n**Rewards Claimed:**\n' +
            claimResult.reward.description,
            0x2ecc71
          )],
        });
      }

      const user = getUser(userId);
      const dailyDone = user.cl_daily_claimed === 1;
      const catchDone = user.cl_catches >= requirements.catches;
      const fishDone = user.cl_fishes >= requirements.fishes;
      const battleDone = user.cl_battles >= requirements.battles;
      const eventCatchDone = user.cl_event_catches >= requirements.eventCatches;
      const allComplete = isComplete(user);
      const mark = (done) => (done ? '✅' : '⬜');
      const status = user.cl_claimed
        ? 'Claimed'
        : (allComplete ? 'Ready to claim with `.cl claim`' : 'In progress');
      const description =
        `Complete every task to earn randomized rewards!\nStatus: **${status}**\n\n` +
        `${mark(dailyDone)} 🎁 **Claim \`.daily\`**\n` +
        `${mark(catchDone)} 🔴 **Catch Pokémon:** ${Math.min(user.cl_catches, requirements.catches)} / ${requirements.catches}\n` +
        `${mark(fishDone)} 🎣 **Catch Fish:** ${Math.min(user.cl_fishes, requirements.fishes)} / ${requirements.fishes}\n` +
        `${mark(battleDone)} ⚔️ **Win Battles:** ${Math.min(user.cl_battles, requirements.battles)} / ${requirements.battles}` +
        (eventTaskActive
          ? `\n${mark(eventCatchDone)} 🎃 **Catch an Event Mon:** ${Math.min(user.cl_event_catches, requirements.eventCatches)} / ${requirements.eventCatches}`
          : '');
      const embed = new EmbedBuilder()
        .setColor(allComplete ? 0x2ecc71 : 0x3498db)
        .setAuthor({
          name: `${message.author.username}'s Checklist`,
          iconURL: message.author.displayAvatarURL(),
        })
        .setTitle('Daily Checklist')
        .setDescription(description)
        .setFooter({
          text: `Complete all ${eventTaskActive ? 5 : 4} tasks, then use .cl claim to collect your randomized rewards.`,
        });
      return message.reply({
        embeds: [embed],
      });
    }

    if (command === 'trade' || command === 'tr') return await handleTrade(message, userId, args);

    if (command === 'give') {
      const recipient = message.mentions.users.first();
      const rest = args.filter((arg) => !/^<@!?\d+>$/.test(arg));
      const usage =
        `• To give ${EMOJIS.pokecoin} PokéCoins: \`${PREFIX}give @user coins {amt}\` (or \`${PREFIX}give @user {amt}\`)\n` +
        `• To give 🟠 Patreon tokens: \`${PREFIX}give @user tokens {amt}\`\n` +
        `• To give a fun item (Candy, Lollipop, Chocolate Bar, ...): \`${PREFIX}give @user <item> {amt}\``;
      if (!recipient) {
        return message.reply(`❌ **You must mention a user to give something to!**\n${usage}`);
      }
      if (recipient.id === userId) return message.reply('❌ You cannot give things to yourself!');
      if (recipient.bot) return message.reply('❌ You cannot give things to bots!');

      const lastWord = rest.at(-1);
      const hasAmount = rest.length > 0 && /^[\d,.]+[kmb]?$|^all$/i.test(lastWord);
      const amount = hasAmount ? parseAmount(lastWord) : 1;
      const nameWords = (hasAmount ? rest.slice(0, -1) : rest);
      const itemQuery = nameWords.join(' ').toLowerCase().trim();
      const normalized = itemQuery.replace(/[^a-z]/g, '');
      const isTokenTransfer = ['token', 'tokens', 'patreontoken', 'patreontokens'].includes(normalized);
      const isCoinTransfer = !itemQuery || ['coin', 'coins', 'pokecoin', 'pokecoins'].includes(normalized);
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        return message.reply(`❌ **Please specify a valid amount!**\n${usage}`);
      }

      if (!isTokenTransfer && !isCoinTransfer) {
        const funItem = Object.keys(FUN_ITEM_EMOJIS).find((name) =>
          name.toLowerCase().replace(/[^a-z]/g, '') === normalized
        );
        if (!funItem) return message.reply(`❌ I don't know what **${itemQuery}** is.\n${usage}`);
        const sentItem = db.transaction(() => {
          if (!takeUserItem(userId, funItem, amount)) return null;
          return addUserItem(recipient.id, funItem, amount);
        }).immediate();
        if (sentItem === null) {
          return message.reply(`❌ You don't have **${amount.toLocaleString()}x ${funItem}** to give.`);
        }
        const itemReply = await message.reply({
          content: `${FUN_ITEM_EMOJIS[funItem]} You gave **${amount.toLocaleString()}x ${funItem}** to <@${recipient.id}>!`,
          allowedMentions: { users: [recipient.id] },
        });
        announceQuestCompletions(recipient.id, message.channel, sentItem);
        return itemReply;
      }

      const field = isTokenTransfer ? 'patreon_tokens' : 'coins';
      const sent = db.transaction(() => {
        const balance = getUser(userId)[field] || 0;
        if (balance < amount) return { error: true, balance };
        getUser(recipient.id);
        incrementUser(userId, { [field]: -amount });
        incrementUser(recipient.id, { [field]: amount });
        return { error: false };
      }).immediate();

      if (sent.error) {
        return message.reply(isTokenTransfer
          ? `❌ You do not have enough Patreon tokens! You currently own **${sent.balance.toLocaleString()}**.`
          : `❌ You do not have enough PokéCoins! You currently have **${sent.balance.toLocaleString()}**.`);
      }
      return message.reply({
        content: isTokenTransfer
          ? `🟠 You gave **${amount.toLocaleString()}x Patreon Token(s)** to <@${recipient.id}>!`
          : `${EMOJIS.pokecoin} You gave **${amount.toLocaleString()} PokéCoins** to <@${recipient.id}>!`,
        allowedMentions: { users: [recipient.id] },
      });
    }
  } catch (error) {
    console.error(`Command "${command}" failed:`, error);
    await message.reply('❌ Something went wrong while processing that command.');
  }
});

client.once('clientReady', () => {
  console.log(`🚀 Pokémon bot online as ${client.user.tag}`);
  startTopggWebhook();
  const incenseEmoji = client.emojis.cache.find((emoji) => emoji.name === 'incense');
  if (incenseEmoji) EMOJIS.incense = incenseEmoji.toString();
  const pokeradarEmoji = client.emojis.cache.find((emoji) => emoji.name === 'pokeradar');
  if (pokeradarEmoji) EMOJIS.pokeradar = pokeradarEmoji.toString();
  const bossCoinEmoji = client.emojis.cache.find((emoji) => emoji.name === 'bosscoin');
  if (bossCoinEmoji) EMOJIS.bosscoin = bossCoinEmoji.toString();
  for (const config of Object.values(CHAMBER_CONFIG)) {
    const chamberEmoji = client.emojis.cache.find((emoji) => emoji.name.toLowerCase() === `mega${config.key}`);
    if (chamberEmoji) {
      config.icon = chamberEmoji.toString();
      MEGA_SPECIES_EMOJIS[config.key] = config.icon;
    }
  }
  setWorldBossAnnouncementChannel(WORLD_BOSS_GUILD_ID, WORLD_BOSS_CHANNEL_ID);
  setGiveawayChannel(WORLD_BOSS_GUILD_ID, GIVEAWAY_CHANNEL_ID);
  setLotteryChannel(WORLD_BOSS_GUILD_ID, LOTTERY_CHANNEL_ID);
  for (const pending of db.prepare('SELECT id, ends_at FROM active_giveaways WHERE ended = 0').all()) {
    scheduleGiveaway(pending.id, pending.ends_at);
  }
  runDailyGiveaways();
  setInterval(runDailyGiveaways, 60 * 1000);
  const expireTokenOrders = () => {
    try {
      expirePatreonTokenOrders();
    } catch (error) {
      console.error('[token-market] failed to expire orders:', error);
    }
  };
  expireTokenOrders();
  setInterval(expireTokenOrders, 60 * 1000);
  runPatreonMonthlyPayout();
  setInterval(runPatreonMonthlyPayout, 5 * 60 * 1000);
  startAutospawnScheduler();
  startLotteryScheduler();
  const millisecondsUntilNextHour = () => {
    const hourMs = 60 * 60 * 1000;
    return (Math.floor(Date.now() / hourMs) + 1) * hourMs - Date.now();
  };
  const spawnAndScheduleNextHour = () => {
    setTimeout(async () => {
      try {
        const regularBosses = WORLD_BOSS_POOL.filter((entry) => !entry.isShiny);
        const shinyBosses = WORLD_BOSS_POOL.filter((entry) => entry.isShiny);
        const template = Math.random() < 0.05
          ? shinyBosses[Math.floor(Math.random() * shinyBosses.length)]
          : regularBosses[Math.floor(Math.random() * regularBosses.length)];
        const previousBoss = getActiveWorldBoss();
        if (previousBoss) {
          await updateWorldBossAnnouncement(
            previousBoss,
            new EmbedBuilder()
              .setColor(0x5865f2)
              .setTitle(`World Boss Replaced: ${previousBoss.name}`)
              .setDescription('The hourly raid has started. Use `.wb` to view the new World Boss.')
          );
        }
        const boss = spawnWorldBoss(template);
        console.log(`Hourly World Boss spawned: ${boss.name}.`);
        await announceWorldBossEverywhere(boss);
      } catch (error) {
        console.error('Failed to spawn the hourly World Boss:', error);
      } finally {
        spawnAndScheduleNextHour();
      }
    }, millisecondsUntilNextHour());
  };
  spawnAndScheduleNextHour();
});

const token = process.env.BOT_TOKEN || process.env.DISCORD_TOKEN;
if (!token) throw new Error('Set BOT_TOKEN in .env before starting the bot.');
client.login(token);
