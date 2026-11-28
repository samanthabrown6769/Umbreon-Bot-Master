const CLONE_FORM_IDS = [20086, 20087, 20088, 20089];

function removePokemonCopies(db, { addUserItem, incrementUser }, formIds, variant = null) {
  const formIdSet = new Set(formIds);
  const placeholders = formIds.map(() => '?').join(', ');
  const variantFilter = variant === null ? '' : variant === 'golden'
    ? ' AND COALESCE(is_golden, 0) = 1'
    : ` AND COALESCE(is_golden, 0) = 0 AND COALESCE(is_shiny, 0) = ${variant === 'shiny' ? 1 : 0}`;
  const matches = (pokemon) => formIdSet.has(Number(pokemon.pokemon_id))
    && (variant === null || (pokemon.is_golden || pokemon.isGolden ? 'golden'
      : pokemon.is_shiny || pokemon.isShiny ? 'shiny' : 'base') === variant);
  db.transaction(() => {
    const catches = db.prepare(`
      SELECT id, user_id, pokemon_id, is_shiny, is_golden, held_item
      FROM catches WHERE pokemon_id IN (${placeholders}) ${variantFilter} ORDER BY id
    `).all(...formIds);
    const catchIds = new Set(catches.map((row) => row.id));
    const heldItems = new Set();
    for (const row of catches) {
      const identity = JSON.stringify([row.user_id, row.pokemon_id, row.is_shiny, row.is_golden]);
      if (row.held_item && !heldItems.has(identity)) {
        addUserItem(row.user_id, row.held_item);
        heldItems.add(identity);
      }
    }

    const clearBuddy = db.prepare('UPDATE users SET buddy_catch_id = NULL WHERE buddy_catch_id = ?');
    for (const id of catchIds) clearBuddy.run(id);

    const savedTeams = db.prepare(`
      SELECT id, pokemon_ids FROM saved_teams
      WHERE EXISTS (
        SELECT 1 FROM json_each(saved_teams.pokemon_ids)
        WHERE CAST(value AS INTEGER) IN (SELECT id FROM catches WHERE pokemon_id IN (${placeholders}) ${variantFilter})
      )
    `);
    const updateSavedTeam = db.prepare('UPDATE saved_teams SET pokemon_ids = ? WHERE id = ?');
    const registrations = db.prepare(
      `SELECT boss_id, user_id, team_pokemon_ids FROM world_boss_registrations
       WHERE EXISTS (
         SELECT 1 FROM json_each(world_boss_registrations.team_pokemon_ids)
         WHERE CAST(value AS INTEGER) IN (SELECT id FROM catches WHERE pokemon_id IN (${placeholders}) ${variantFilter})
       )`
    );
    const updateRegistration = db.prepare(
      'UPDATE world_boss_registrations SET team_pokemon_ids = ? WHERE boss_id = ? AND user_id = ?'
    );
    const deleteRegistration = db.prepare(
      'DELETE FROM world_boss_registrations WHERE boss_id = ? AND user_id = ?'
    );
    const remainingTeam = (json) => {
      const team = JSON.parse(json);
      if (!Array.isArray(team)) throw new TypeError('Expected a Pokémon team array.');
      const remaining = team.filter((id) => !catchIds.has(Number(id)));
      return remaining.length === team.length ? null : remaining;
    };
    if (catchIds.size) {
      for (const team of savedTeams.all(...formIds)) {
        const remaining = remainingTeam(team.pokemon_ids);
        if (remaining) updateSavedTeam.run(JSON.stringify(remaining), team.id);
      }
      for (const registration of registrations.all(...formIds)) {
        const remaining = remainingTeam(registration.team_pokemon_ids);
        if (remaining && remaining.length) {
          updateRegistration.run(JSON.stringify(remaining), registration.boss_id, registration.user_id);
        } else if (remaining) {
          deleteRegistration.run(registration.boss_id, registration.user_id);
        }
      }
    }

    db.prepare(`DELETE FROM catches WHERE pokemon_id IN (${placeholders}) ${variantFilter}`).run(...formIds);
    for (const table of [
      'market', 'pokemon_gifts', 'pokemon_user_seen_counts', 'user_pokemon_state_snapshots',
      'global_collections',
    ]) {
      db.prepare(`DELETE FROM ${table} WHERE pokemon_id IN (${placeholders}) ${variantFilter}`).run(...formIds);
    }
    if (variant === null) {
      db.prepare(`DELETE FROM pokemon_rarity_overrides WHERE pokemon_id IN (${placeholders})`).run(...formIds);
    }

    const pendingGifts = db.prepare(`
      SELECT id, pokemon_json FROM pending_gifts
      WHERE claimed = 0 AND pokemon_json IS NOT NULL
        AND (${formIds.map(() => 'pokemon_json LIKE ?').join(' OR ')})
    `).all(...formIds.map((id) => `%${id}%`));
    const updatePendingGift = db.prepare('UPDATE pending_gifts SET pokemon_json = ? WHERE id = ?');
    for (const gift of pendingGifts) {
      const pokemon = JSON.parse(gift.pokemon_json);
      if (!Array.isArray(pokemon)) throw new TypeError(`Invalid Pokémon list in pending gift ${gift.id}.`);
      const remaining = pokemon.filter((entry) => !matches(entry));
      if (remaining.length !== pokemon.length) updatePendingGift.run(JSON.stringify(remaining), gift.id);
    }

    const activeAuctions = db.prepare(
      'SELECT id, pokemon_json, bidder_id, bid_amount FROM pokemon_auctions WHERE ended_at IS NULL'
    ).all();
    const deleteBids = db.prepare('DELETE FROM pokemon_auction_bids WHERE auction_id = ?');
    const deleteNotifications = db.prepare('DELETE FROM pokemon_auction_notifications WHERE auction_id = ?');
    const deleteAuction = db.prepare('DELETE FROM pokemon_auctions WHERE id = ?');
    for (const auction of activeAuctions) {
      if (!matches(JSON.parse(auction.pokemon_json))) continue;
      if (auction.bidder_id) incrementUser(auction.bidder_id, { patreon_tokens: auction.bid_amount });
      deleteBids.run(auction.id);
      deleteNotifications.run(auction.id);
      deleteAuction.run(auction.id);
    }

    const lockTable = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'release_category_locks'"
    ).get();
    if (lockTable) {
      const deleteLock = db.prepare('DELETE FROM release_category_locks WHERE category = ?');
      for (const id of formIds) {
        for (const lockedVariant of variant ? [variant] : ['base', 'shiny', 'golden']) {
          deleteLock.run(`exact:${id}:${lockedVariant}`);
        }
      }
    }
  }).immediate();
}

function removeClonePokemon(db, helpers) {
  removePokemonCopies(db, helpers, CLONE_FORM_IDS);
}

module.exports = { CLONE_FORM_IDS, removeClonePokemon, removePokemonCopies };
