const CHEST_EMOJI = '<:treasurebox:1569732869364912259>';
const CHEST_IMAGE_URL = 'https://cdn.discordapp.com/emojis/1569732869364912259.png';
const CHEST_SPAWN_CHANCE = 0.1;
const CHEST_SPECIAL_CHANCE = 0.01;

function spawnExploreChest(x, y, maxX, maxY, step, random = Math.random) {
  const positions = [];
  for (let dx = -4; dx <= 4; dx += 1) {
    for (let dy = -4; dy <= 4; dy += 1) {
      if (dx === 0 && dy === 0) continue;
      const targetX = x + dx * step;
      const targetY = y + dy * step;
      if (targetX < 0 || targetX > maxX || targetY < 0 || targetY > maxY) continue;
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
  const reward = basicRewards[Math.floor(random() * basicRewards.length)];
  return { ...reward, quantity: reward.min + Math.floor(random() * (reward.max - reward.min + 1)) };
}

module.exports = { CHEST_EMOJI, CHEST_IMAGE_URL, CHEST_SPAWN_CHANCE, spawnExploreChest, chooseExploreChestReward };
