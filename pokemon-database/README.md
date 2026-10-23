# Pokémon reference datasets

These JSON files are generated from `data/pokemon-catalog.json` and
`data/pokemon-rarities.json`. They are reference datasets; the bot continues
to load its runtime catalog into SQLite.

Regional forms use regional adjectives, such as `Alolan Vulpix`,
`Galarian Ponyta`, `Hisuian Zorua`, and `Paldean Tauros Combat Breed`.

Catalog sync also merges `data/custom-pokemon-forms.json`. These definitions
reuse the referenced base species' stats, types, sprites, and rarity unless
overridden. Forms without a curated Dex number use the generated form numbers
until one is added to `pokemon-dex-numbers.js`. Supplemental forms are omitted
from Golden output so adding them does not renumber the existing Golden Dex.

Run `npm run build-pokemon-database` after refreshing the catalog or changing
rarity overrides to regenerate all eight files:

- `base-dex.json` — regular default species entries, usually numbered by species ID, with curated Dex-number overrides in `pokemon-dex-numbers.js`.
- `shiny-dex.json` — shiny default species #1–999 use numbers 1001–1999; later species (Archaludon onward) use #8300+ with shiny at normal +1. Curated Dex-number overrides are in `pokemon-dex-numbers.js`.
- `mega.json` — Mega forms numbered from 4001 unless a screenshot override assigns an exact number in `pokemon-dex-numbers.js`.
- `shiny-mega.json` — shiny Mega forms numbered from 4501.
- `gmax.json` — Gmax forms numbered from 5001 unless a screenshot override assigns an exact number in `pokemon-dex-numbers.js`.
- `shiny-gmax.json` — shiny Gmax forms numbered from 5501.
- `formes.json` — non-default forms excluding Mega and Gmax forms, numbered from 6001 (generated shiny form numbers from 11000), with curated Dex-number overrides in `pokemon-dex-numbers.js`.
- `golden-dex.json` — Golden base species use `9000 + species ID`, so Bulbasaur through Gimmighoul are numbered 9001–9999. Screenshot-listed Mega and alternate forms use curated numbers in `golden-pokemon.js`; regional forms use their curated assignments where present, and generated regional numbers follow the highest base-species number. Entries set `variant` to `golden` and use TPPC Golden artwork where available. If a Golden form sprite is unavailable, `sprite` is `null` rather than showing unrelated artwork. Golden Pokémon never spawn in the wild; they are promo, event, and giveaway exclusives.

Each entry retains the catalog fields and has a `dex_number`. In the numbered
form datasets, `id` matches `dex_number`; the internal catalog ID is not
included. Alternate forms also include their shiny Dex number. Shiny entries
also set `variant` to `shiny` and use shiny artwork as their `sprite`.

## Editing the data (read by the bot at startup)

The bot reads every `*.json` file in this folder when it starts. Edit entries
by their `slug`, then restart the bot:

- `name`, `rarity`, `sprite`, and `shiny_dex_number` on alternate forms.
- Curated Dex numbers belong in `pokemon-dex-numbers.js`; generated base shiny
  numbers are recalculated from the screenshot ranges.
- `animated_sprite` / `shiny_animated_sprite` — GIF URLs used in embeds.
- Entries with `variant: "shiny"` supply the shiny sprite. Golden entries are ignored.

You can add your own `.json` files here (an array of entries). An entry with a
new `slug` that has `name`, `rarity` and `sprite` is added as a custom Pokémon.
Entries with an existing `slug` override that Pokémon. Re-running
`npm run build-pokemon-database` keeps these edits. Curated Dex numbers belong
in `pokemon-dex-numbers.js`; generated Dex IDs in these files are not treated
as manual overrides.