# Pokémon reference datasets

These JSON files are generated from `data/pokemon-catalog.json` and
`data/pokemon-rarities.json`. They are reference datasets; the bot continues
to load its runtime catalog into SQLite.

Regional forms use regional adjectives, such as `Alolan Vulpix`,
`Galarian Ponyta`, `Hisuian Zorua`, and `Paldean Tauros Combat Breed`.

Run `npm run build-pokemon-database` after refreshing the catalog or changing
rarity overrides to regenerate all eight files:

- `base-dex.json` — regular default species entries, numbered 1–2000.
- `shiny-dex.json` — shiny default species entries, numbered at species ID + 2000 (2001–4000).
- `mega.json` — Mega forms numbered from 4001.
- `shiny-mega.json` — shiny Mega forms numbered from 4501.
- `gmax.json` — Gmax forms numbered from 5001.
- `shiny-gmax.json` — shiny Gmax forms numbered from 5501.
- `formes.json` — non-default forms excluding Mega and Gmax forms, numbered from 6001 (shiny form numbers from 7001).
- `golden-dex.json` — golden variants of base Dex species, numbered 8000 + species ID (8001–9999), plus regional forms from the catalog (starting at #10001), with `variant` set to `golden` and TPPC golden artwork as their `sprite` where available. If a regional Golden sprite is unavailable, `sprite` is `null` rather than showing the base form. Golden Pokémon never spawn in the wild; they are promo, event, and giveaway exclusives.

Each entry retains the catalog fields and has a `dex_number`. In the numbered
form datasets, `id` matches `dex_number`; the internal catalog ID is not
included. Alternate forms also include their shiny Dex number. Shiny entries
also set `variant` to `shiny` and use shiny artwork as their `sprite`.

## Editing the data (read by the bot at startup)

The bot reads every `*.json` file in this folder when it starts. Edit entries
by their `slug`, then restart the bot:

- `name`, `rarity`, `sprite`, `dex_number` (and `shiny_dex_number` on forms).
- `animated_sprite` / `shiny_animated_sprite` — GIF URLs used in embeds.
- Entries with `variant: "shiny"` supply the shiny sprite. Golden entries are ignored.

You can add your own `.json` files here (an array of entries). An entry with a
new `slug` that has `name`, `rarity` and `sprite` is added as a custom Pokémon.
Entries with an existing `slug` override that Pokémon. Re-running
`npm run build-pokemon-database` keeps these edits.