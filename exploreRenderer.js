const { createCanvas, loadImage } = require('@napi-rs/canvas');

const { EXPLORE_MAPS: MAP_THEMES } = require('./exploreData');

const MAP_WIDTH = 640;
const MAP_HEIGHT = 320;
const TRAINER_WIDTH = 64;
const TRAINER_HEIGHT = 64;

const backgroundCache = new Map();

async function loadBackground(url) {
  if (!backgroundCache.has(url)) backgroundCache.set(url, loadImage(url).catch(() => null));
  return backgroundCache.get(url);
}

async function renderExploreMap(mapType, posX, posY, activeMon, trainerUrl, backgroundUrl) {
  const canvas = createCanvas(MAP_WIDTH, MAP_HEIGHT);
  const ctx = canvas.getContext('2d');
  const theme = MAP_THEMES[mapType] || MAP_THEMES.grass;

  const background = backgroundUrl ? await loadBackground(backgroundUrl) : null;
  if (background) {
    ctx.drawImage(background, 0, 0, MAP_WIDTH, MAP_HEIGHT);
  } else {
    ctx.fillStyle = theme.bgColor;
    ctx.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
  }

  if (activeMon?.img) {
    try {
      const monImg = await loadImage(activeMon.img);
      ctx.drawImage(monImg, MAP_WIDTH - 180, 96, 96, 96);
    } catch (_) {}
  }

  let drawn = false;
  if (trainerUrl) {
    try {
      const trainer = await loadImage(trainerUrl);
      ctx.drawImage(trainer, posX, posY, TRAINER_WIDTH, TRAINER_HEIGHT);
      drawn = true;
    } catch (_) {}
  }
  if (!drawn) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(posX + 16, posY + 8, 32, 48);
  }

  return canvas.toBuffer('image/png');
}

module.exports = { MAP_THEMES, MAP_WIDTH, MAP_HEIGHT, TRAINER_WIDTH, TRAINER_HEIGHT, renderExploreMap };
