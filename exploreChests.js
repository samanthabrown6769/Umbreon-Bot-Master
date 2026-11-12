const CHEST_EMOJI = '<:treasurebox:1569732869364912259>';
const CHEST_IMAGE_URL = 'https://cdn.discordapp.com/emojis/1569732869364912259.png';
const CHEST_SPAWN_CHANCE = 0.1;
const CHEST_SPECIAL_CHANCE = 0.01;
const EXPLORE_ITEMS = {
  scanner: {
    name: 'Scanner', field: 'explore_scanner', emoji: '<:scanner:1570537683824943184>',
    description: 'Shows the seconds remaining in an Explore session when the message refreshes, with ❗❗ below 15 seconds.',
  },
  ring: {
    name: 'Item Ring', field: 'explore_item_ring', emoji: '<:itemring:1570537681795031133>',
    description: 'Increases the Explore chest spawn chance by 10% relative, from 10% to 11% per eligible movement.',
  },
  dowsing: {
    name: 'Dowsing Machine', field: 'explore_dowsing_machine', emoji: '<:dowsingmachine:1570537679781634109>',
    description: 'Alerts you when a chest appears, has 2 movements left, or disappears.',
  },
  pack: {
    name: 'Large Pack', field: 'explore_large_pack', emoji: '<:largepack:1570537677185618121>',
    description: 'Keeps newly spawned Explore chests on the map for 5 extra movements.',
  },
};

function spawnExploreChest(x, y, maxX, maxY, step, random = Math.random, isMoveAllowed = null) {
  let reachable;
  if (isMoveAllowed) {
    reachable = new Set([`${x},${y}`]);
    let frontier = [{ x, y }];
    for (let distance = 0; distance < 4; distance += 1) {
      const next = [];
      for (const position of frontier) {
        for (let dx = -1; dx <= 1; dx += 1) {
          for (let dy = -1; dy <= 1; dy += 1) {
            if (dx === 0 && dy === 0) continue;
            const targetX = position.x + dx * step;
            const targetY = position.y + dy * step;
            const key = `${targetX},${targetY}`;
            if (targetX < 0 || targetX > maxX || targetY < 0 || targetY > maxY
                || reachable.has(key) || !isMoveAllowed(position.x, position.y, targetX, targetY)) continue;
            reachable.add(key);
            next.push({ x: targetX, y: targetY });
          }
        }
      }
      frontier = next;
    }
  }
  const positions = [];
  for (let dx = -4; dx <= 4; dx += 1) {
    for (let dy = -4; dy <= 4; dy += 1) {
      if (dx === 0 && dy === 0) continue;
      const targetX = x + dx * step;
      const targetY = y + dy * step;
      if (targetX < 0 || targetX > maxX || targetY < 0 || targetY > maxY) continue;
      if (reachable && !reachable.has(`${targetX},${targetY}`)) continue;
      positions.push({ x: targetX, y: targetY });
    }
  }
  if (!positions.length) throw new Error('Explore map has no reachable chest positions.');
  const position = positions[Math.floor(random() * positions.length)];
  return { ...position, stepsRemaining: 5 + Math.floor(random() * 11) };
}

function chooseExploreChestReward(user, basicRewards, random = Math.random) {
  const specialRoll = random();
  if (specialRoll < CHEST_SPECIAL_CHANCE && !user.explore_shiny_charm) return { special: 'shiny' };
  if (specialRoll >= CHEST_SPECIAL_CHANCE && specialRoll < 2 * CHEST_SPECIAL_CHANCE
      && !user.explore_amulet_coin) return { special: 'amulet' };
  const itemKeys = Object.keys(EXPLORE_ITEMS);
  const itemIndex = Math.floor(specialRoll / CHEST_SPECIAL_CHANCE) - 2;
  const itemKey = itemKeys[itemIndex];
  if (itemKey && !user[EXPLORE_ITEMS[itemKey].field]) return { special: itemKey };
  const reward = basicRewards[Math.floor(random() * basicRewards.length)];
  return { ...reward, quantity: reward.min + Math.floor(random() * (reward.max - reward.min + 1)) };
}

module.exports = { CHEST_EMOJI, CHEST_IMAGE_URL, CHEST_SPAWN_CHANCE, EXPLORE_ITEMS, spawnExploreChest, chooseExploreChestReward };
