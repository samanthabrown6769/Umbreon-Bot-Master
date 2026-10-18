# Pokemon Discord Bot

## Introduction

This repository is a Pokémon-catching game bot built with [Discord.js](https://discord.js.org/#/docs/main/stable/general/welcome).

The bot is a Pokémon-catching game for Discord. Commands use the `.` prefix by default (configurable with `PREFIX`).

## Installation

### 1. Clone the Repository

```sh
git clone https://github.com/harshil1712/pokemon-discord-bot.git

```

### 2. Install Packages

```sh
yarn install
```
or

```sh
npm install
```

### 3. Copy `.env.example` to `.env` in the root directory of the project.

### 4. Configure the bot token and admin IDs in `.env`.

```env
BOT_TOKEN=your_discord_bot_token_here
ADMIN_IDS=your_discord_user_id
```

`ADMIN_IDS` accepts one or more comma-separated Discord user IDs. Server members with the Discord **Administrator** permission can also use admin commands. `ADMIN_ID` is accepted as a legacy single-ID setting.

### Optional: Cloudinary sprite hosting

By default, Pokémon sprites are loaded from Pokémon Showdown's animated sprite CDN. To serve them from your own Cloudinary account instead:

1. Add your Cloudinary credentials to `.env`.

```env
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
CLOUDINARY_FOLDER=pokemon-sprites
```

2. Mirror the sprites into your Cloudinary account (one-time, re-runnable).

```sh
npm run upload-sprites
```

3. Restart the bot. While `CLOUDINARY_CLOUD_NAME` is set, sprites are served from Cloudinary; remove it to fall back to Pokémon Showdown.

### 5. Start the Bot

```sh
yarn start
```

or

```sh
npm start
```

### Top.gg vote rewards

To enable vote rewards, configure a Top.gg webhook for `POST https://<your-public-host>/topgg` and set the same secret in `TOPGG_WEBHOOK_AUTH`. Set `TOPGG_WEBHOOK_PORT` to the public port exposed by your host (or use `PORT`; the default is `3000`). The webhook listener starts only when `TOPGG_WEBHOOK_AUTH` is set. Keep the endpoint reachable from Top.gg and use a long, random secret. Top.gg test webhooks are acknowledged without granting rewards. `TOPGG_VOTE_URL` optionally overrides the `.vote` link; otherwise, the bot links to its own Top.gg vote page.

Each verified vote grants 1 Vote Coin, has a 1-in-5 chance to grant a Lootbox, and rolls for a Vote Box and a Golden Razz Berry (1-in-5). Uncommon Patreon and higher tiers double the regular Vote Coin reward, including streak and milestone Vote Coins; the additional global Vote Coin awarded on UTC calendar days 1–5 of each month is not doubled. A consecutive daily streak grants +1 Vote Coin from day 10, or +2 from day 50; the 25- and 50-day milestones also grant their listed +2 Vote Coins. Streaks advance once per UTC calendar day; additional votes on the same day still receive their normal vote rewards. Webhook retries delivered within 60 seconds are ignored.

The Vote Box roll uses mutually exclusive outcomes: Rare 50%, Super Rare 20%, Legendary 1-in-12, Shiny 1-in-30, or no box for the remaining probability. Vote Boxes are stored separately from normal boxes and opened by name or alias, such as `.open voterare` or `.open vrb` (the old `.open vote <rarity>` syntax is removed); each opened box grants 1 Vote Coin and PokéCoins, then independently rolls for Rare Candies, Eggs, and Masterballs:

| Vote Box | PokéCoins | Rare Candy | Egg | Masterball |
|---|---:|---:|---:|---:|
| Rare | 100–2,599 | 7.5% (1) | 5% (1) | 5% |
| Super Rare | 200–3,249 | 6.5% (1–2) | 6.5% (1) | 1% |
| Legendary | 750–4,249 | 33% (1) | 12.5% (1) | 10% |
| Shiny | 1,250–16,249 | 100% (1–5) | 30% (1–3) | 20% |

Use `.egg` to view Eggs, one free held-Egg slot, two regular Incubator slots, and six Super Incubator slots. Use `.excl egg` to view the Egg-exclusive hatch pools and rare Pokémon odds; `.excl swap` lists PokeSwap exclusives; `.excl patreon` lists Patreon-exclusive Shiny Pokémon from both sources. `.egg hold` consumes an Egg for the free slot; `.egg hatch` hatches it when ready. Start purchased incubators with `.egg use-incubator <i|si> <amount|all>` and hatch completed slots with `.egg hatch-incubator <i|si> <slot|all>`. Each successful catch advances every held/incubated Egg by one. Regular Incubators use the existing 30–130 catch target; Rare Patreon and higher tiers use 20–110; Super Incubators halve the chosen target (rounded up). Incubators cost 10,000 PokéCoins; Super Incubators cost 50,000. The early and late hatch pools and rare hatch rolls follow the supplied table: special standard Pokémon use their listed 1-in-100, 1-in-150, or 1-in-500 odds; special Shiny entries use their listed odds, with Shiny Chatot and Noibat restricted to Patreon accounts. Golden Wynaut uses 1-in-150. Eggs and unused incubators are visible in `.bag`.

`.excl fish` lists the Fishing-exclusive Shiny and Golden Pokémon. `.excl catchbot` lists CatchBot-exclusive Golden Aron and Swablu, each with a 1-in-1,000 chance per CatchBot catch when Luck is maxed.

Use `.vote` to view your Vote Coin balance, streak, milestones, and voting link. Vote Coins and Eggs are also shown in `.bag`.

### Hosting on Discloud

The project ships with `discloud.config` (bot type, `index.js` entry, 256MB RAM, auto-restart) and `.discloudignore`.

1. Zip the project (or use the Discloud VS Code extension / dashboard upload).
2. Keep `.env` in the zip — dotenv reads it from the app filesystem.
3. **First deploy:** temporarily remove `pokemon.sqlite` from `.discloudignore` to seed your data. **Later deploys:** keep it ignored — Discloud replaces files on every deploy, so an included database would wipe live data.
4. `better-sqlite3` installs from prebuilt binaries; if the install ever fails on a native build, enable `APT=tools` in `discloud.config`.
5. `RAM=256` needs a paid plan — on the free tier, change it to `RAM=100`. The bot loads its catalog data into memory, so watch for out-of-memory restarts on the free tier.

Make sure to add your bot to a server or open a direct message with it, to test the functionalities.

Enable the **Message Content Intent** for the bot in the Discord Developer Portal.

## Database

The SQLite database is created automatically as `pokemon.sqlite` when `db.js` is loaded. It stores users, catches, market listings, and the local Pokémon catalog. The generated SQLite database is excluded from Git; the catalog JSON is included.

The included `data/pokemon-catalog.json` contains the Pokémon entries and forms available to the game. Bot starts seed the local SQLite catalog from this file and do not need API access. Run `npm run sync-pokemon` to refresh the JSON catalog, evolution-chain lookup, and official minimum levels for level-based evolutions from PokéAPI; forms listed in `data/removed-pokemon-forms.json` remain excluded. Pumpkaboo Average is displayed as Pumpkaboo; Pumpkaboo Small and Large are excluded. The bot applies catalog removals after its next restart; previously caught Pokémon and market listings are retained.

Regional Pokémon forms use regional adjectives, such as `Alolan Vulpix`, `Galarian Ponyta`, `Hisuian Zorua`, and `Paldean Tauros Combat Breed`.

The `pokemon-database/` folder contains separate reference JSON files for the base Dex, shiny Dex, alternate forms, Mega, Shiny Mega, Gmax, and Shiny Gmax Pokémon. Regenerate them after syncing catalog data or rarity overrides with `npm run build-pokemon-database`. These files do not replace the bot's SQLite runtime database.

Full-odds shiny encounters have a base rate of 1/10,240 (1/8,192 for Patreon members). While an event is active, its listed shiny-target Pokémon use a base rate of 1/2,500. Each effective Shiny Charm bonus point (shop charms, Black Market Charm, Patreon, or clan perk) reduces the odds denominator by 1% of its base value; for example, one charm changes non-Patreon full-odds from 1/10,240 to 1/10,138 and event shiny odds from 1/2,500 to 1/2,475. An active Event Ticket further multiplies event shiny odds by 1/0.95 (1/2,500 becomes 1/2,375 with no charms). Applicable channel boosts and CatchBot modifiers also scale these rates.

Use `.d <Pokémon name|Pokédex number>` to browse forms across that Pokémon's evolution family, including cataloged Mega and Gmax forms. Button navigation is paginated for families with more than 20 entries.

Catalog rarity is a game classification, not an official Pokémon property: Legendary and Mythical species are Legendary; other forms are classified by base stat total and evolution stage. Pokémon encounter, catch-result, and Pokédex embed colors reflect rarity: Common dark blue, Uncommon light blue, Rare orange, Super Rare yellow, Legendary purple, and Shiny light pink. Event embeds use deep red. Catch encounters, Pokédex cards, buddy cards, and event announcements use Pokémon Showdown's animated normal or shiny GIFs based on the catalog form slug. Existing PokéAPI artwork remains as a fallback for custom Pokémon without a catalog slug.

The event checklist and shop are configured separately in `events/halloween-2026.js`, organized into labeled sections for schedule, ticket/shop, emojis, reward targets, rewards, and Pokémon. The comments there explain how to add checklist entries and match catalog form names. Update that file to change event settings or optional support/gift links. Wild encounters use default forms only, plus alternate forms explicitly listed in the active event checklist. During the event, an active ticket boosts checklist Pokémon spawn weight by the configured multiplier. Use `.admin event channel #channel` to configure per-server event announcements, `.admin event channel` to check the setting, or `.admin event channel off` to disable them. Event announcements include the Pokémon, catcher, checklist progress, and sprite, and are forwarded only on that trainer's first catch of each event entry. Claiming the full checklist reward also announces the trainer's completion and reward in the configured channel. Unconfigured support/gift links are omitted from the event command. Progress for the event's own rewards checklist is recorded only for trainers who own an event ticket; the daily checklist's event task counts matching event Pokémon while the event is active.

## Commands

- `.p` / `.pokemon`, `.fish` / `.f`, `.box`, `.team`, `.battle`; select Pokémon with a name or Pokédex number. Use `.team add <Pokédex number|name> [slot 1-3]` to add it to the next available slot or a chosen slot (replacing its occupant); name selection matches the exact form and variant, defaults to the regular non-Golden default form, and accepts `shiny` or `golden` prefixes (for example, `.team add grimer 1` or `.team add shiny garchomp 1`). `.team remove <name>` removes a matching team member, `.team remove dex <Pokédex number>` selects by Dex number (including 1–3), and `.team remove slot <slot 1-3>` removes by team slot
- `.toggle cooldown` — Open a personal interactive setting to choose whether your cooldown completion messages ping you or display your username.
- `.toggle rarespawn [on|off]` — Choose whether rare-spawn announcements show your username or say “somebody”; the setting is per user.
- `.dailycatchers` / `.dc` — View the top 10 trainers by successful wild catches since today's 5 AM EST daily reset (including `.p`, `.f`, and Explore; admin-guaranteed spawns are excluded).
- `.counters` / `.co` — View your Legendary and Shiny encounter counts since your last catch in each category for `.p` and `.f`; catching one resets your matching command/category counter.
- `.worldboss` / `.wb` — join the shared World Boss battle and attack with active-team move buttons; Eternatus Eternamax has 50 million HP and other World Bosses have 5 million HP; claim pending rewards with `.wb claim` before entering another raid; there is no cooldown between moves
- `.battle user <@user|id>` — spar against another trainer's team; switch your active Pokémon during battle, and the winner earns 200–2,000 Buddy/Exp. Share EXP.
- `.buddy` / `.bud` / `.buddy set [shiny] <Pokémon form name|Pokédex number>` / `.buddy clear` — inspect, select any owned form by name or Pokédex number, select its shiny variant with the `shiny` prefix, or clear your buddy; higher-rarity catches grant more EXP. Copies of the same form and variant share IVs, level, EXP, stats, HP, moves, and held item; setting one as buddy synchronizes its copies.
- `.buddy list [ivs|stats|num]` — view buddy history with one entry per form and variant.
- `.buddy info <Pokémon>` — view its current ability and open the Ability button to use an Ability Capsule or Ability Patch.
- `.ability` / `.ab` — browse all abilities; `.ability <Pokémon name|Pokédex number>` lists that Pokémon's abilities, and `.ability <ability name>` shows its effect and Pokémon that can have it.
- `.buddy nickname <name|reset>` — set or clear the nickname on your current buddy; the nickname appears on its Buddy card and moves embed.
- `.buddy rr <atk|def|hp|spd>` — spend 1 Vote Coin to reroll that buddy IV (0–31); matching duplicate Pokémon inherit the updated IV and stats.
- `.moves` — view the active buddy's equipped and learnable moves; use `.move replace <equipped move name|slot> <new move name>` to replace an equipped move, `.move delete <slot>` to clear a move slot for free, or `.move swap <slot> <slot>` to swap two equipped moves. Replacing a move uses the regular move-change cost; deleting and swapping slots are free. G-Max moves are learnable by their associated Pokémon species, and Eternatus Eternamax can learn Max Moves.
- `.battle npc 1` / `.b npc 1` — start the sequential regional Gym/Trial/Elite Four/Champion campaign with Brock; use `.npc list [region]` (or `.battle npc list [region]`) to browse challengers, `.battle npc volo` to challenge Volo's Giratina Origin team at any time, and `.league` to check progress. Switch Pokémon during battle; embeds show the active opponent's animated sprite and include a Forfeit Battle button. `.faction npc list` lists the battleable Grunts, Admins, and Leaders for every faction; `.faction battle` lists the challengers, and `.faction battle <trainer|faction>` challenges one by name. Faction NPCs have full Level 100 teams with 2×–3× combat stats; victories earn a random 1,000–10,000 base faction points (faction rank multipliers apply), and each challenger has a 1/1,000 chance to drop their faction icon. Drops are added to `.battle icons` and can be equipped with `.battle set-icon`. `.gym` remains the Kanto-only shortcut
- `.mc` — view Mega Chamber progress and earned stones; chambers are numbered 1 Sableye, 2 Gengar, 3 Mawile, and 4 Banette. Sacrifice eligible Pokémon with `.mc sacrifice <1-4|name> [amount]`, then use `.mc battle <1-4|name>` and choose move or switch buttons to fight a three-trainer gauntlet; battles show the active opponent's animated sprite and can be forfeited. Sacrifices bank without a cap; each win consumes 10 and awards the matching Mega Stone plus 15,000 PokéCoins, allowing multiple runs from a saved balance
- `.mega evo <Pokémon name>` — permanently Mega Evolve an owned Sableye, Gengar, Mawile, or Banette using its matching Mega Stone; requires the non-consumable Mega Bracelet (`.shop buy mega bracelet`, 5,000,000 PokéCoins, shop item 22). The stone is consumed and the Pokémon's stats update to its Mega form
- `.fish shop` — buy Diveballs for 50 Fishing Tokens each; use one on a fishing encounter for an 85% catch chance. Fishing quests can also reward Diveballs; view the item with `.item info diveball`
- `.balance` / `.bal` — Show your PokéCoins, Patreon tokens, Vote Coins, Fishing Tokens, Swap Tokens, and faction points (with your faction logo when joined) in a compact balance embed; use `.bag` / `.inv` / `.inventory [page]` for inventory pages
- Faction points and rank progress use your faction's logo. Each faction gets a randomly selected daily ball that is shared for that faction for the day and cannot repeat on consecutive days.
- `.bag` page 2 shows Cooldown Machines, Ability Capsules, and Ability Patches with their item emojis.
- Bot admins can use `.admin token @user <amount>` to grant Patreon tokens; use a negative amount to remove tokens without reducing the balance below zero.
- Bot admins can use `.admin pokemon rename <Pokémon|form|Pokédex number> -- <new name>` to rename a Pokémon form, or `.admin pokemon sprite <Pokémon|form|Pokédex number> <https sprite URL> [shiny https URL]` to update its sprite links. Changes are saved in `pokemon-database/z-requested-overrides.json` and take effect immediately.
- Automatic item giveaways start at 12 AM and 12 PM fixed EST each day, run for 12 hours, and award the configured PokéCoins and item bundle to each winner. Set the server channel with `.giveaway set [#channel]`; edit `giveaway-items.json` to configure reward ranges.
- Catch EXP by rarity: Common 100, Uncommon 250, Rare 400, Super Rare 1,500, Legendary 7,500, Shiny 10,000; egg hatches award 2,500. The Buddy receives the base amount; with Exp. Share enabled, active teammates get one-third (rounded down), and a Buddy on the active team gets 133% instead. Toggle the purchased Exp. Share with `.team expshare on|off`.
- `.use rarecandy [amount|all]` / `.use rc [amount|all]` — use Rare Candies to level up your buddy, which can be selected by Pokémon name or Pokédex number with `.buddy set`
- Successful `.fish` / `.f` catches award Fishing Tokens based on rarity; check `.balance` / `.bal` for your balances
- The shop sells Poke Balls for 200, Great Balls for 500, Ultra Balls for 1,500, Master Balls for 50,000, a one-time EXP Share unlock for 500,000 PokéCoins, Rare Candies for 1,000 PokéCoins each (`rc` alias), Incubators for 10,000 (`i` alias), Super Incubators for 50,000 (`si` alias), and up to 10 Amulet Coins for 150,000 PokéCoins each; use `.shop buy amulet coin [amount]` or item 11. Each Amulet Coin adds +5% to PokéCoin rewards. Clan Amulet perks and Patreon perks add invisible Amulet Coins.
- The wild encounter embed previews each ball's live catch chance. Catch success chance is the rarity's base chance plus the ball bonus and flat percentage-point bonuses, capped at 100%. Catch Rate IV gives Diamond and higher clan perk tiers +10 points; Patreon and each applicable channel boost add +5 points each. Non-Patreon Gen 1–8 baseline rates before clan, Patreon, and channel boosts:

  | Pokémon rarity | Pokéball | Greatball | Ultraball | Premierball | Masterball |
  | --- | ---: | ---: | ---: | ---: | ---: |
  | Common | 80% | 95% | 100% | 100% | 100% |
  | Uncommon | 70% | 85% | 95% | 100% | 100% |
  | Rare | 47% | 62% | 72% | 87% | 100% |
  | Super Rare | 30% | 45% | 55% | 70% | 100% |
  | Legendary | 15% | 30% | 40% | 55% | 100% |
  | Event Shiny | 10% | 25% | 35% | 50% | 100% |
  | Full-odds Shiny | 74% | 89% | 99% | 100% | 100% |

  Diamond and higher clan perk tiers, before Patreon or channel boosts:

  | Pokémon rarity | Pokéball | Greatball | Ultraball | Premierball | Masterball |
  | --- | ---: | ---: | ---: | ---: | ---: |
  | Common | 90% | 100% | 100% | 100% | 100% |
  | Uncommon | 80% | 95% | 100% | 100% | 100% |
  | Rare | 57% | 72% | 82% | 97% | 100% |
  | Super Rare | 40% | 55% | 65% | 80% | 100% |
  | Legendary | 25% | 40% | 50% | 65% | 100% |
  | Event Shiny | 20% | 35% | 45% | 60% | 100% |
  | Full-odds Shiny | 84% | 99% | 100% | 100% | 100% |

- Listed wild Pokémon have a 10% chance to spawn holding their associated item. The encounter shows the held-item icon and item; successfully catching the Pokémon adds the item to your inventory. For these encounters, the following pre-bonus rates replace the normal rates for the five standard balls; clan, Patreon, and channel bonuses still apply. Diveballs keep their existing 85% rate.

  | Pokémon rarity | Pokéball | Greatball | Ultraball | Premierball | Masterball |
  | --- | ---: | ---: | ---: | ---: | ---: |
  | Common | 35% | 50% | 60% | 75% | 100% |
  | Uncommon | 30% | 45% | 55% | 70% | 100% |
  | Rare | 25% | 40% | 50% | 65% | 100% |
  | Super Rare | 20% | 35% | 45% | 60% | 100% |
  | Legendary | 10% | 25% | 35% | 50% | 100% |
  | Event Shiny | 10% | 25% | 35% | 50% | 100% |
  | Full-odds Shiny | 10% | 25% | 35% | 50% | 100% |

  | Held item | Eligible Pokémon |
  | --- | --- |
  | Black Belt | Makuhita, Hariyama, Throh, Sawk, Mankey, Primeape, Tyrogue, Hitmontop, Hitmonchan |
  | Black Glasses | Poochyena, Mightyena, Sandile, Krokorok |
  | Charcoal | Torkoal, Turtonator, Vulpix |
  | Dragon Fang | Bagon, Shelgon, Druddigon |
  | Dragon Scale | Horsea, Seadra, Dratini, Dragonair |
  | Electirizer | Elekid, Electabuzz |
  | Fairy Feather | Ralts, Cleffa, Clefairy, Togepi |
  | Hard Stone | Aron, Lairon, Corsola, Dwebble, Crustle, Graveler, Onix, Roggenrola, Boldore |
  | Leftovers | Snorlax |
  | Magmarizer | Magby, Magmar |
  | Magnet | Magneton, Nosepass, Pikachu |
  | Metal Coat | Beldum, Metang, Bronzor, Bronzong, Magnemite, Skarmory |
  | Miracle Seed | Cherubi, Cherrim, Fomantis, Maractus |
  | Mystic Water | Castform, Dewpider, Araquanid, Goldeen, Seaking, Lapras |
  | Never-Melt Ice | Cryogonal, Seel, Dewgong, Snover, Abomasnow, Vanillite, Vanillish |
  | Poison Barb | Budew, Roselia, Cacnea, Arbok, Qwilfish, Skorupi, Drapion, Tentacool, Tentacruel, Beedrill, Vespiquen |
  | Razor Claw | Jangmo-o, Kommo-o, Sneasel |
  | Razor Fang | Bruxish, Gligar |
  | Sharp Beak | Doduo, Dodrio, Fearow |
  | Silk Scarf | Trubbish, Garbodor, Zigzagoon, Linoone, Skitty |
  | Silver Powder | Butterfree, Masquerain, Venomoth |
  | Soft Sand | Diglett, Dugtrio, Nincada, Sandslash, Trapinch, Stunfisk |
  | Spell Tag | Duskull, Dusclops, Haunter, Misdreavus, Sandygast, Banette, Yamask |
  | Twisted Spoon | Abra, Kadabra, Alakazam |

- Fishing starts with an Old Rod; buy Good Rod (`.shop buy 5`, 1,000 coins) or Super Rod (`.shop buy 6`, 2,500 coins). Golden Rod costs 1,000 Fishing Tokens and requires both. Buy Poké Lures (`.shop buy pl [amount]`, 50 Fishing Tokens each) or Misty's Lures (`.shop buy ml [amount]`, 150 Fishing Tokens each); activate them with `.use pl [amount]` or `.use ml [amount]`. Each lure is consumed by one successful fishing catch and enables the corresponding fishing quests. `.excl fish` lists Fishing-exclusive Pokémon. Inspect rods with `.item info <old rod|good rod|super rod|golden rod>`
- `.daily` resets at midnight UTC−5 (05:00 UTC); it is once per UTC−5 calendar day rather than a rolling 24-hour cooldown. `.quest` / `.q`, `.q rr <1-2>`, `.cb`, `.cb upgrade <pokemon|cost|duration|luck>`, `.cb run [hours]`, `.cb claim`, `.cl` / `.checklist [claim]`; quest rerolls cost 2,500 PokéCoins. `.cl` tracks claiming `.daily`, 25 Pokémon catches, 10 fish, 5 battle wins, and one matching event Pokémon catch while an event is active. CatchBot catches count toward the catch target. At maximum Luck, each CatchBot Pokémon has a 1/1,000 chance to be Golden Aron or Swablu; `.excl catchbot` lists them. The event task uses the active event's listed Pokémon and does not require an Event Ticket; a ticket is still required for the event's separate checklist rewards. Outside an active event, the event task is hidden. `.cl claim` grants 5,000–10,000 random PokéCoins and a randomized bonus of Lootboxes, Rare Candies, Fishing Tokens, Ultra Balls, or (rarely) a Masterball. `.quest` shows rotating quests drawn from both quest pools: encounter milestones, rarity/type catches, lure/shiny/event fishing, NPC and Mega Chamber battles, and item collection. Rewards can include balls, Lootboxes, candies, lures, berries, repel items, quest collectibles, and a 20% chance of one randomly selected evolution item or stone; when rolled, the item and its emoji appear on the quest's Rewards line before completion. Golden-fishing and Battle Tower quests are excluded until those mechanics are supported. Collectible-item quests remain in the pool; those items currently need to come from admin or event grants. The screenshot quest definitions are in `data/screenshot-quest-templates.json`; the original repeatable templates remain in `data/quest-templates.json`. Active progress is stored in SQLite. CatchBot upgrade costs increase by 1.25× per level. CatchBot runs have lower encounter weights for higher rarities, and `.cb claim` DMs a paginated Pokémon list with 20 catches per page. The bot also DMs a reminder when a run finishes, including after a restart. CatchBot batch rolls do not apply the event-ticket spawn multiplier, avoiding large retry loops; matching event catches still advance event progress. CatchBot halves the base shiny rate and has up to a 1.1× luck multiplier at max level. Upgrades increase catches/hour and duration and reduce the per-catch cost. At max upgrades it catches 31 Pokémon/hour for up to 12 hours at 100 coins each: 372 Pokémon for 37,200 coins.
- Wild land encounter rates display as whole numbers from the screenshot: Common 40%, Uncommon 30%, Rare 27%, Super Rare 2%, and Legendary 1/666 (1/500 with Golden Razz). Legendary generation checks run sequentially at 1/5 for Gen IV, V, VI, and VII, then fall back to Gen I–III; corresponding encounter odds are 1/1,626, 1/3,330, 1/4,163, 1/5,203, and 1/6,504 (with Golden Razz: 1/1,221, 1/2,500, 1/3,125, 1/3,907, and 1/4,883).
- Members boosting server `1560102297198006274` (role `1560407313251180585`) receive a global 5% relative increase to Legendary encounter odds and active event-checklist encounter weight across land, fishing, and CatchBot encounters.
- Use `.perks` to view the global server booster benefits and whether you are boosting the configured server.
- Repels cost 5,000 PokéCoins (shop item 12); Super Repels cost 10,000 (item 15), Max Repels 15,000 (item 16), and Honey 5,000 (item 17). `.repel`, `.superrepel` / `.sr`, `.maxrepel` / `.mr`, and `.honey` each last 30 land encounters per item; only one modifier can be active at a time. Their screenshot rarity weights are: Repel 15/50/31/3, Super Repel 12/48/35/4, Max Repel 7/48/39/5, and Honey 75/15/8/1 (Common/Uncommon/Rare/Super Rare). Each set of category weights is normalized by its total when selecting a non-Legendary encounter.
- Lootboxes always grant 50–1,050 PokéCoins and 3–6 Pokéballs. Independent additional drops: Greatballs 75% (1–4), Ultraballs 35% (1–2), Masterball 0.5%, Repel 12%, Golden Razz 12%, Egg 9%, Quest Reset Scroll 8%, and Rare Candy 1%. Patreon perks increase each item drop chance by 10% relative.
- Quest Reset Scrolls cost 10,000 PokéCoins each (shop item 13); use `.quest reset <1-3>` to replace an active quest without paying the normal reroll cost.
- `.hunt` assigns a rarity target uniformly from Common, Uncommon, Rare, Super Rare, and Legendary until midnight fixed EST (05:00 UTC); it can be rerolled once with `.hunt reroll`. Each matching-rarity catch advances progress at 10%, 12.5%, 20%, 33%, or 50%, respectively. Requirements and full completion rewards are Common 5 (2 Pokéballs, 1 Greatball), Uncommon 5 (3 Pokéballs, 2 Greatballs), Rare 2 (3 Greatballs, 1 Ultraball), Super Rare 1 (3 Ultraballs, 1 Premierball), and Legendary 1 (2 Masterballs).
- Run `.release` to see the release-lock guide and your current lock count. Accounts can lock up to 25 Pokémon; Common, Uncommon, and Rare Patreon tiers each add 5 slots (30, 35, and 40 total, respectively). Release Pokémon with `.release <name|Pokédex number>` (aliases `.r`, `.sacrifice`), or use `.release number <Pokédex number> [amount]` to release several. The response shows your selected trainer icon, username, released rarity and count, and total PokéCoins earned. Payouts are 150 Common, 300 Uncommon, 500 Rare, and 1,000 Super Rare PokéCoins per Pokémon, with coin boosts applied. Legendary, Shiny, Golden, Mega, Shiny Mega, Gmax, Shiny Gmax, active-team, and locked Pokémon cannot be released. `.release duplicates` (`.r d`) previews eligible duplicates, shows detailed counts, and requires confirmation; favourited Pokémon are also protected. `.release type <rarity>mons` releases eligible Pokémon by rarity. Use `.release lock|unlock <name|Pokédex number>` for matching Pokémon, or the presets `mega-line` (pre-evolutions of Mega Pokémon), `egg`, a rarity (such as `rare` or `super rare`), `event` (past and present event checklist Pokémon), and `starters` (starter evolutionary lines). `.release view-locks` summarizes fully locked preset categories and lists individual locks that do not form a complete category; `.release clear-locks` removes all of your release locks.
- PokeSwap is available with `.swap <Pokémon name|Pokédex number>` or `.swap shiny|golden <Pokémon name|Pokédex number>` (also `.sw` / `.pokeswap`); it trades one non-team, unlocked Pokémon for a random Pokémon, using one of six free swap tokens first, then a Swap Ticket, then costing 5,000 PokéCoins (Common Patreon and higher tiers receive a 50% discount). Swap results show payment, remaining balance, the offered Pokémon count, the received Pokémon and its sprite. Swap Ticket inventory is shown by `.swap` and tickets can be earned from quests. Use `.excl swap` to view the Swap-exclusive Shiny Pokémon (each 1/2,000) and Golden Goomy (1/5,000); Scraggy and Pancham are Patreon-only. `.excl patreon` lists all Patreon-exclusive Shiny Egg and PokeSwap Pokémon. The daily multiplier is 0% for swaps 1–19, rises by 1% every 20 swaps through a 10% maximum at swap 200, and resets at midnight EST (05:00 UTC). Offering a Shiny boosts Shiny odds by 35%, and offering a Golden boosts Golden odds by 65%; the respective offer bonus adds a further 25%, multiplicatively with the daily multiplier. Use `.swap info` to view the current multiplier and reset. Each Rotom released or swapped has a per-appliance 1/50 drop chance, or 1/10 for Shiny Rotom, for each of the six Rotom appliances.
- Manual land Pokémon encounters have additional special Legendary rolls: Darkrai at 1/100,000 from 6 PM–6 AM fixed EST; Shaymin at 1/100,000 from 6 AM–6 PM fixed EST; and Arceus at 1/100,000 at any time. Darkrai, Shaymin, and Arceus each have a 1/10 chance to be Shiny when found. Reshiram, Zekrom, Kyurem, and Meloetta are each 1/41,630; Diancie, Hoopa, and Volcanion are each 1/52,030. With Golden Razz active those rates become 1/31,250 and 1/39,070 respectively. Shiny Reshiram/Zekrom/Kyurem use 1/10,240 odds (1/8,192 for Patreon); Shiny Meloetta, Diancie, Hoopa, and Volcanion are 1/2 when the Pokémon is found. Keldeo joins the 1/41,630 pool once Cobalion, Terrakion, and Virizion are in the player's box (any of them may be Shiny); Genesect joins it while the player owns an Ancient Fossil. Both have a 1/2 Shiny chance when found. Ancient Fossils drop at 1/10,000 per successful Pokémon catch, excluding CatchBot. These species are reserved for the special encounter rules rather than ordinary rarity spawns; special rolls do not apply to fishing or CatchBot.
- Legendary-, Shiny-, and Golden-tier Patreon supporters and configured bot admins can use `.channel add boost` to give their own encounters in the current channel a +5 percentage-point catch-rate boost and +5% relative shiny-rate and Legendary spawn-rate boosts. Each user can boost up to 10 channels across all servers, except user `1514082847609061541`, who has no channel limit. All channels in server `1560102297198006274` also receive a server-wide +5 percentage-point catch-rate boost and +5% relative shiny-rate and Legendary spawn-rate boosts. `.channel remove boost` removes the invoking user's personal boost in the current channel; `.channel remove all` clears all of that user's personal boosts across servers without affecting server-wide boosts; `.channel boost` lists their personal boosted channels.
- `.perks` shows the active Patreon tier section for the author (or the mentioned user); tier buttons can still be used to browse other tiers.
- Common Patreon adds +5% catch rate, +25% full-odds shiny rate, +5% event shiny rate, Patreon-exclusive Shiny access, 50% off PokeSwap, double `.daily` PokéCoins including streak rewards, 5,000 extra daily PokéCoins, 1 daily Patreon Token, and 5 release-lock slots. It also grants 100,000 PokéCoins, 10 Rare Candies, 3 Masterballs, and 1 Egg monthly; monthly rewards are distributed automatically on the last day of each month at 10 PM Pacific Time.
- Uncommon Patreon inherits Common perks and doubles Vote Coins from votes, including streak bonuses; has four active quest slots; reduces Mega Chamber sacrifice requirements by 10%; gives a 10% Quick Hands chance to refund any ball, including a Masterball, on a successful catch; and reveals exact buddy IV numbers alongside their stars. IV stars represent rolls of 0 (0 stars), 1–15 (1 star), 16–30 (2 stars), and 31 (3 stars with 🎉). Replacing a buddy move with `.move replace` costs 50,000 PokéCoins (25,000 for Uncommon Patreon and higher); unchanged moves are free. Uncommon supporters can enable sale-completion DMs with `.toggle market [on|off]`.
- Rare Patreon inherits Uncommon perks and adds 75,000 daily PokéCoins, 15 daily Patreon Tokens, and monthly rewards of 5,000,000 PokéCoins, 100 Rare Candies, 10 Masterballs, 10 Eggs, 3 Super Incubators, and 1 Incense. It grants five active quest slots, halves the completed-quest refresh wait from 2 hours to 1 hour, +5 market listing slots (20 total), and +5 release-lock slots, adds a 5% fishing encounter chance, and reduces Egg catch targets to 20–110. Monthly rewards are distributed on the last day of each month at 10 PM Pacific Time.
- Completed quests pay their rewards immediately, then their slots wait 2 hours before receiving new quests; Rare Patreon and higher reduce this refresh wait to 1 hour. A ready quest is loaded when `.quest` is viewed or quest progress is next processed.
- Super Rare Patreon inherits Rare perks and provides 200,000 daily PokéCoins and 38 daily Patreon Tokens total. It adds a 10% discount on PokéCoin shop purchases, raises the Mega Chamber reduction to 20% total, adds 5 release-lock slots (45 total), and increases the chance of an extra Egg catch-progress step to 30%. Its Patreon tier page displays the Official Support Server role.
- Legendary Patreon inherits Super Rare benefits and gives 500,000 daily PokéCoins and 75 daily Patreon Tokens. It adds 10% relative drop odds to Lootbox bonus items, a further +25% full-odds shiny-rate bonus and +25 percentage points to the event shiny-rate bonus, +15 market slots (35 total), +5 release-lock slots (50 total), up to 10 personal channel boosts, and the Legendary Patreon role. Monthly rewards include 15,000,000 PokéCoins, 150 Rare Candies, 15 Masterballs, 50 Eggs, 10 Super Incubators, 5 Incubators, 10 Incense, 10 Pokeradars, 500 Patreon Tokens, 50 Cooldown Machines, 1 Ability Capsule, and 1 Ability Patch.
- Shiny Patreon inherits Legendary benefits and adds 1,000,000 daily PokéCoins, 150 daily Patreon Tokens, 0% Pokémon market tax, +5 market listings (40 total), +10 release locks (60 total), a 30% Mega Chamber cost reduction, 1 passive Shiny Charm, and 4 passive Amulet Coins. Its monthly bundle includes 15,000,000 PokéCoins, 150 Rare Candies, 15 Masterballs, 100 Eggs, 25 Super Incubators, 5 Incubators, 10 Incense, 10 Pokeradars, 2,000 Patreon Tokens (including the 1,500-token Shiny bonus), 110 Cooldown Machines, 3 Ability Capsules, and 2 Ability Patches.
- Golden Patreon inherits Shiny benefits and provides 3,000,000 daily PokéCoins and 500 daily Patreon Tokens. It adds a relative +25% to Golden-exclusive Fishing and PokeSwap odds and Promo item-drop rates, and requests for custom role icons and glow are subject to staff approval. Its monthly rewards include 15,000,000 PokéCoins, 150 Rare Candies, 15 Masterballs, 250 Eggs, 75 Super Incubators, 5 Incubators, 10 Incense, 10 Pokeradars, 1 Boss Coin, 6,000 bonus Patreon Tokens, 300 Cooldown Machines, 10 Ability Capsules, and 5 Ability Patches.
- Cooldown Machines are loaded with `.cooldown [quantity]` and assigned to `.pokemon` or `.fish`. They allow that command after half its usual cooldown for one charge; waiting for the full cooldown preserves the charge. Ability Capsules and Patches are used from `.bud info <Pokémon>`: a Capsule switches to another standard ability, while a Patch switches to the Hidden Ability. The bot retrieves ability options from PokéAPI when requested.
- Ability names, Pokémon abilities, and ability descriptions are retrieved from PokéAPI and cached in memory for the running bot process.
- Legendary members' event Shiny selections and Safari Zone runs remain manually administered; Safari Zone gameplay is not implemented by the bot.
- Patreon tiers and perks are synced from the supporter roles in the Official Support Server. Enable Discord's **Server Members Intent** for immediate role-removal updates; command-time role checks also refresh stored tiers.
- Server admins can run `.admin rarespawns setup` to create/configure a `#rarespawns` channel (the bot needs Manage Channels, Send Messages, and Embed Links). It forwards each trainer's first catch per event of every Pokémon species listed on `.e cl` (whether shiny or regular), Legendary, Shiny, or Gmax form, with rarity-colored embeds and in-game totals; configure an existing channel with `.admin rarespawns channel #channel` or disable it with `.admin rarespawns channel off`
- Configure a per-server `#market-listings` channel with `.admin market setup`, or use `.admin market channel #channel` to select an existing channel and `.admin market channel off` to disable announcements. New player listings are posted with the Pokémon, price, and `.mbuy` listing ID.
- Use `.collection` / `.coll` to browse a paginated feed of public Global Collections (`.coll <page>`, `.coll buyers`) and `.coll help` for commands. Register up to 15 Pokémon with `.coll register [shiny] <name|Pokédex number> [buy price]`; normal and shiny versions count as separate entries. Update or delete them (`.coll update all` refreshes every entry), and make entries private with `.coll private|unprivate [shiny] <name|Pokédex number|all>`. Browse recent entries by Pokémon name or Pokédex number, rarity, or buyer status with `.collection view`; prefix a name or number with `shiny` to view shiny collections. `.collection count <amount|percentage%>` filters by owned count or share of the matching Pokémon variant's total population. Public browsing shows entries updated in the past three months, up to 50 results; `.collection mine` includes your private entries.
- Evolution items: Lootboxes can drop evolution stones (Fire, Water, Thunder, Leaf, Moon, Sun, Shiny, Dusk, Dawn, Ice) and held evolution items (King's Rock, Metal Coat, Linking Cord, etc.), and giveaways can award them (`.gstart item <name> <amount> <winners> [minutes]`). View them with `.evoitems`. Use `.evolve <Pokémon> <item>` or `.use <item> <Pokémon>` to evolve directly with an item from inventory; held items can also be equipped first with `.hold <item> <Pokémon>` and used with `.evolve <Pokémon>` (take back with `.unhold`). `.evolve <Pokémon>` also performs an available level-based evolution when the Pokémon meets its official minimum level. Level, IVs, and shininess are kept.
- Wild encounter items can be equipped with `.hold <item> <Pokémon>` and reclaimed with `.unhold <Pokémon>`. Black Belt, Black Glasses, Charcoal, Dragon Fang, Fairy Feather, Hard Stone, Magnet, Metal Coat, Miracle Seed, Mystic Water, Never-Melt Ice, Poison Barb, Sharp Beak, Silk Scarf, Silver Powder, Soft Sand, Spell Tag, and Twisted Spoon each boost matching-type move damage by 20% in battles. Leftovers restores 1/16 of its holder's maximum HP at the end of each battle turn. These effects apply only while the Pokémon is holding the item.
- Boxes: Rare, Super Rare, Legendary and Shiny boxes (obtained from giveaways, events, and World Boss drops, not voting) award PokéCoins and have a 10% chance to drop a matching Pokémon; otherwise they award Greatballs and Ultraballs. Legendary and Shiny box Pokémon are forwarded to configured rare-spawn channels. Regular Lootboxes remain items-only. Open with `.open <box> [amount]`, view with `.item info <box>`, and hold one with `.team give <box> <slot|name>`.
- Server managers (Manage Server) can run giveaways: `.giveaway set [#channel]`, then `.gstart items <winners> [minutes]`, `.gstart coins <amount> <winners> [minutes]` or `.gstart pokemon <name> <true|false|golden> <winners> [minutes]`. Members can enter or leave with the giveaway buttons; bot admins can remove a mentioned entrant from the most recent active giveaway in the current channel with `.admin giveaway remove @User`. Winners are drawn when time runs out, even after a bot restart.
- Bot admins can grant Pokémon with `.admin pokemon @User <name|form|Pokédex number> [amount] [shiny|golden]`; Golden grants accept base Pokémon and regional forms from the catalog, using their Golden Pokédex numbers. Mega and Gmax forms are not supported.
- Server managers can run `.autospawn set [#channel]` to enable wild spawns in a channel: scheduled spawns happen at UTC :00, :10, :20, :30, :40, and :50; each :00 spawn at a UTC hour divisible by three is a guaranteed Legendary or Shiny. Message-triggered spawns also appear every 15–75 messages (or after 5 minutes of silence) with five name buttons, and the first correct guess catches it. Message-trigger progress is saved in SQLite and resumes after bot restarts. `.autospawn disable` turns it off.
- `.clan` shows a clan overview with ID, owners, member capacity, global rank, next-rank progress, treasury, unlocked perks, activity totals, and your contributions (catches, hatches, swaps, CatchBot runs, fish, donations, and join date). The creation date is shown in the embed body so Discord renders its timestamp correctly. Clan stats track catches independently for daily, weekly, monthly, and yearly periods; each hatched Egg counts once, each completed battle (win or loss) counts once, and each CatchBot run counts once. Activity totals are not backfilled. Use `.clan stats [daily|weekly|monthly]` to view period totals for catches, fish, hatches, swaps, CatchBot runs, and battles, with ranked member totals, usernames, selected battle icons, your rank, and period reset time; members without a selected icon use Brendan. Choose the sorting category from the menu. The period menu shows Daily; open weekly or monthly views with `.clan stats weekly` or `.clan stats monthly`. Stats reset at 05:00 UTC (daily, Monday weekly, and the first of each month), and period stats are not backfilled. Use `.clan hs` for the compact, paginated top-100 list ranked only by monthly catches. Monthly counts start accumulating after the activity tracker update and are not backfilled. Use `create <name>`, `join <name>`, `leave`, or `disband` (leader only). The leader can appoint one second owner with `.clan add co-owner @member` or `.clan add owner @member`; `.clan coowner remove` removes that role. Use `.clan transfer ownership @member` to transfer leadership to a clan member
- Any clan member can invite an unaffiliated player with `.clan invite @user`; the invitee can accept or deny using the buttons within 60 seconds. Clan capacity and membership are rechecked when accepting
- `.clan info ranks` lists Starter through Onyx requirements, treasury costs, perks, and member limits. Clan owners/co-owners upgrade the clan with `.clan upgrade <rank>`; collective rank requirements use clan catches (not fishing activity), and treasury costs are paid from clan donations. Use `.clan donate <amount>` to contribute coins (`.clan deposit` remains a backward-compatible alias). Rank upgrades only unlock perk tiers: each member must separately buy tiers in sequence with `.clan purchase <rank>`, using their own PokéCoins and personal catch contributions. The personal catch requirement is `floor(rank catch target ÷ current clan member count)`: Bronze uses 100,000, Silver 500,000, Gold 2,500,000, Diamond 5,000,000, Amethyst 7,500,000, and Onyx 15,000,000. For example, Bronze in a 20-member clan requires 5,000 catches; Amethyst in a 65-member clan requires 115,384. The corresponding perk purchase cost is the same base amount in PokéCoins (Bronze: 100,000).
- Purchased Catch/Shiny Rate perks affect encounters, Event Rate affects shiny odds for matching event Pokémon, Amulet Boost increases coin rewards, and Shop Boost discounts coin purchases. Amulet Coins add a further +5% each to PokéCoin rewards. Promo Rate, Quest bonus, and Hatch bonus are currently inactive because those feature paths are not implemented
- `.shop buy 8 [amount]` buys Shiny Charms for 1,000,000 PokéCoins each (maximum five shop charms); each adds one effective shiny-rate bonus point, reducing the base odds denominator by 1% for land and fishing shiny encounters. Bonuses stack with the Black Market Charm, Patreon, and clan Shiny Rate perks. Use `.item info shiny charm` for your effective bonus
- Amount and price inputs accept `k`, `m`, and `b` suffixes: `1k` = 1,000, `1m` = 1,000,000, and `1b` = 1,000,000,000 (for example, `.clan donate 1m` or `.market add pikachu 2.5m`)
- `.streak` / `.streaks` shows current and highest catch, daily-claim, vote, and rarity-based catch streaks. Catch streaks are tracked separately by rarity and do not reset when you catch a different rarity. Streaks award Lootboxes at milestones: Common every 15/50 catches (1 each), Uncommon every 10/35 (1 each), Rare every 5/10 (1/2), Super Rare every 5 (2), Legendary every 5 (3), Shiny every 5 (4), and General every 25 catches (1)
- `.balance` / `.bal` for currencies; `.bag` / `.inv`, `.shop`, `.shop buy <number|item> [amount]`, `.boxes` to show the box types you own and their quantities, `.lb [amount|all]` / `.lootbox open [amount|all]`, and `.open <box> [amount|all]`; use consumables with `.use <item> [amount]` (including Incense, Pokeradar, Double XP Tickets, Repels, Honey, Golden Razz, Incubators, Eggs, boxes, Ability items, Lures, Rare Candies, and evolution items); check `.item info lootbox` for Lootbox details. `rc`, `i`, and `si` are shortcuts for Rare Candy, Incubator, and Super Incubator in applicable commands.
- `.team give lootbox <slot|Pokémon name|Pokédex number>` gives a Lootbox to a Pokémon on your active team; use `dex <number>` to disambiguate a Pokédex number from a team slot numbered 1–3
- `.release <Pokémon name|Pokédex number>`, `.swap`, `.market` / `.m` to browse listings, `.market view <Pokémon name|Pokédex number>` / `.m view <Pokémon name|Pokédex number>` to search, `.market list` / `.m offer <Pokémon name|Pokédex number> <amount> <price>` to list owned copies (price is per Pokémon; amount is 1–100), `.market add <Pokémon name|Pokédex number> <price>` to list one copy, and `.mbuy <market listing number>` to buy; market pages show rarity, name, price, and amount and can be navigated with buttons. All player and admin-created listings are announced in the configured market channel. Pokémon in your active team cannot be listed. Player listings have a 10% market tax (0% for Shiny Patreon and higher); proceeds are credited automatically, and `.market claim` shows your sold listings, tax, and credited proceeds. `.token` opens the Patreon Token order book; `.token buy <amount> <price>` immediately buys sell listings at or below your limit, then posts any affordable unfilled remainder as a buy order at that limit. `.token buy <amount>` buys from the cheapest listings, while `.token sell <amount> <price>` places a sell order. Check `.token orders`, cancel with `.token cancel <order ID>`, and view fees/expiry rules with the info button. Open orders expire after 2 days (5 days for Patreon supporters). Configure the per-server listing announcement channel with `.admin market setup`
- `.shop buy <number|item> [amount]` / `.s b <number|item> [amount]` — Buy shop items
- `.profile [@user|user ID]` / `.pr`, `.stats [@user|user ID]` / `.s`, and admin-only `.admin perks [@user|user ID]` to inspect Patreon perks; `.trade @user <your Pokémon name|Pokédex number> <their Pokémon name|Pokédex number>`; alternatively, offer one Pokémon and let the recipient reply with theirs
- `.dex` / `.d` opens a Pokédex detail card with rarity, types, base stats, ownership counts, sprite, and buttons for forms and evolutionary relatives (including cataloged Mega and Gmax forms); button lists paginate for larger families. Search by name or number, and prefix with `shiny` (for example, `.d shiny pikachu`) to view the shiny entry
- `.pokedex [page]` / `.pdex [page]` also browse the Pokédex; interactive buttons page and sort it
- `.events [buy ticket|buy premierball <amount>]`, `.e cl` to view the event checklist, and `.e claim` (or `.e cl claim`) to claim an unlocked checklist reward
- `.help` / `.h` opens the interactive command guide; `.help clan` and other supported areas show focused command guides. The clan command no longer has a `.c` alias

Species-specific damaging move learnsets and move stats are stored in `data/pokemon-moves.json`. Refresh them with `npm run sync-pokemon-moves`. Kanto opponent teams and rewards are configured in `data/kanto-league.json`; Johto, Hoenn, Sinnoh, Unova, Kalos, Alola, Galar, and Paldea rosters are in `data/regional-npc-battles.js`, while special NPC battles such as Volo are configured in `index.js`. League progress, chamber sacrifices/clears, Mega Stones, and each caught Pokémon's equipped moves are stored in SQLite.

The full `.pokedex` lists regular and shiny entries separately, with independent caught status and in-game counts; default shiny entries normally use a second number range starting at #2001 (regular species number + 2000), with high-number species moved to #10001+ to avoid Mega ID collisions. The shiny Pumpkaboo and Rockruff entries use #7108 and #7123. Alternate forms, including regional and Totem forms, have individual regular numbers in the #7001 range and individual shiny numbers in the #8001 range; reserved shiny numbers are skipped, and `.dex` cards show both form-specific IDs. The compact PC box groups duplicate forms, displays the corresponding number for each regular or shiny entry, and has pagination and rarity/recent sorting. Use the displayed number or Pokémon name with `.team add <Pokémon name|Pokédex number> <slot>` or `.box fav <Pokémon name|Pokédex number|all>` / `.box unfav <Pokémon name|Pokédex number|all>`; comma-separate multiple favorites. Favorites apply to all matching duplicate copies of the selected form and variant. Filter with `.box fav`, `.box shiny`, `.box <rarity>`, `.box type <type>`, or a region name such as `.box kanto`. Add `@user` to view another trainer's box.

Wild encounters show the trainer, Pokémon, cumulative rarity catch total (excluding Mega and Gmax variants), ball counts, and ball-selection buttons. Catch EXP announcements name each Pokémon that received EXP in the message above the result embed. Mega and Gmax Pokémon are excluded from `.p` and `.f` wild spawns. Base catch rewards before boosts are Common 125–325, Uncommon 250–525, Rare 450–875, Super Rare 1,200–2,700, Legendary 10,000–25,000, and Shiny 10,000–25,000 PokéCoins. Each effective Amulet Coin adds 5% to catch coin rewards, up to +50% from the 10 purchasable coins; clan perks can boost the payout further. Fishing rods have different spawn chances, cooldowns, pull timers, shiny rates, and Legendary eligibility; fishing catches award rarity-based Fishing Tokens.

Configured bot admins can use `.p` and `.fish` without cooldowns and have guaranteed successful catches; their fishing casts always get a bite. Discord server administrators who are not configured bot admins follow the regular cooldowns and catch rates.

Admins can use `.admin` (or `.admingive`) to grant coins, currencies, items, or catalog Pokémon. `.admin item @user <item or currency> <amount>` supports the full item inventory (including cooldown and ability items, Double XP Tickets, Incubators, Mega Stones, Rotom appliances, vote boxes, and event promo items) plus supported balances such as PokéCoins, Patreon tokens, Vote Coins, Fishing Tokens, and Eggs. Use `.admin return cb [@user]` to bring an active CatchBot run back early; the owner can then collect its catches with `.cb claim`. Use `.p admin [shiny] <Pokémon name>` to spawn a catalog Pokémon for a guaranteed catch; the `shiny` option makes the spawned Pokémon shiny. Rarity spawn weights and catch chances are editable in the database:

- `.admin rarity list`
- `.admin rarity set <name> <spawn weight> <catch chance>` (for example, `.admin rarity set Super Rare 50 25`)
- `.admin pokemon rarity <Pokémon name|Pokédex number> -- <rarity name>`
- `.admin market listings` creates 10 distinct random market listings with prices based on rarity
- `.admin market clear confirm` removes all market listings and returns player-listed Pokémon to their owners
- `.admin set rarity [Pokémon name or Pokédex number] <c|u|r|sr|l|s|m|sm|g|sg>` changes rarity (Common, Uncommon, Rare, Super Rare, Legendary, Shiny, Mega, Shiny Mega, Gmax, Shiny Gmax); omit the Pokémon to change only your most recently caught instance, while specifying a Pokémon changes its catalog rarity
- `.admin pokemon add <rarity name> -- <Pokémon name> [https://sprite-url]`
- `.admin market stock <Pokémon name or Pokédex number> <quantity 1-100> <price> [shiny]` adds catalog Pokémon listings to the market

Pokédex cards show the current global in-game count, including Pokémon in player storage and active market listings, alongside trainer-specific Seen and Owned counts. Seen starts from that trainer's Pokémon currently in their box when this tracking is introduced and increases for each subsequent wild, fishing, or CatchBot catch. Owned counts matching Pokémon currently in that trainer's box; transfers and other rewards do not increment Seen.

Rarity weights are relative: their percentage of the total active weight determines the encounter rate. A newly added rarity starts with weight `0`, so configure a positive weight to make its Pokémon spawn. Pokémon additions and rarity overrides are stored in SQLite and survive catalog refreshes and restarts. `.streak` rarity counts are cumulative; a catch of another rarity does not reset them. Mega, Shiny Mega, Gmax, and Shiny Gmax catches neither add to nor reset those totals.

The complete editable Pokémon-to-rarity list is [`data/pokemon-rarities.json`](./data/pokemon-rarities.json), with one entry per form. `id` is the internal stable catalog key; use the displayed `dex_number` and (where applicable) `shiny_dex_number` for player-facing numbers. Edit the `rarity` field and restart the bot to apply changes. Admin rarity edits update this file too. After refreshing `pokemon-catalog.json`, run `npm run sync-rarities`; it adds new forms while preserving existing rarity choices and custom entries.

World Boss announcements can be configured per server with `.admin worldboss channel #channel` (check with `.admin worldboss channel`; use `off` to use the server's system channel for automatic spawns or the command channel for manual spawns). A random World Boss spawns automatically at the start of every UTC hour, replacing the previous raid; automatic announcements use each server's configured channel or system channel. An admin can also start a raid with `.adminboss [random|name|id]` (also `.admin boss`); any Gmax or Eternamax form in the Pokémon catalog can spawn as a boss. Eternatus Eternamax has 50 million HP; all other World Bosses have 5 million HP. The announcement channel receives the spawn announcement, live raid updates, and final results. Players can use `.wb` to view the shared raid or `.wb fight` from any channel to battle with their active team. Players can switch freely between living team members between attacks; if their entire team faints, using `.wb fight` again revives their raid team to full HP. The boss counterattacks after each move for 5× normal move damage. Player moves deal 3× their normal World Boss damage. Move controls are private to the trainer, and there is no cooldown between moves. Boss HP and contribution totals are shared across all trainers; the raid leaderboard determines MVP and participation rewards, with a chance to catch the defeated boss or earn a box. The final result displays the MVP's full team and remaining raid HP for each Pokémon.

Mega-form Pokémon use the `Mega` rarity; Gmax, Gigantamax, and Eternamax forms use `Gmax` (including Eternatus-Eternamax). Shiny encounters and catches are displayed as `Shiny`, `Shiny Mega`, or `Shiny Gmax`, with shiny encounter rates reflecting the independent 1% shiny roll. Mega and Gmax variants do not have catch streaks. Mega and Gmax each start with spawn weight 50 and 25% catch chance; shiny variants are not independently spawn-weighted, and their catch chances can be configured with `.admin rarity set`.

The Halloween event's dates, shop prices, checklist, rewards, and links are configured in `events/halloween-2026.js`; edit that file to update the event.

## Learn more

We created this bot on a Twitch [live stream](https://twitch.tv/harshil1712)! If you want to learn from the start you can checkout the recording on [YouTube](https://youtu.be/w6ce19rd4pg).

## Contribute

If you find bugs, or want to add more features to the bot, feel free to open a pull request.
