const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { EXPLORE_MAPS: MAP_THEMES } = require('./exploreData');
const { CHEST_IMAGE_URL } = require('./exploreChests');

const MAP_WIDTH = 640;
const TRAINER_WIDTH = 32;
const TRAINER_HEIGHT = 32;
const mapCache = new Map();
const iconCache = new Map();

function getExploreMap(mapType, variant) {
  if (!Object.hasOwn(MAP_THEMES, mapType)) throw new TypeError(`Unknown Explore map: ${mapType}`);
  const map = MAP_THEMES[mapType].images[variant];
  if (!Number.isInteger(variant) || !map) throw new RangeError(`Invalid Explore map variant: ${variant}`);
  return map;
}

function getExploreMapSize(mapType, variant) {
  const map = getExploreMap(mapType, variant);
  return { width: MAP_WIDTH, height: Math.round(MAP_WIDTH * map.height / map.width) };
}

async function loadMap(map) {
  if (!mapCache.has(map.file)) {
    const pending = loadImage(path.join(__dirname, 'assets', 'explore', map.file)).then((image) => {
      if (image.width !== map.width || image.height !== map.height) {
        throw new Error(`Unexpected dimensions for Explore map ${map.file}.`);
      }
      return image;
    });
    mapCache.set(map.file, pending);
    pending.catch(() => mapCache.delete(map.file));
  }
  return mapCache.get(map.file);
}

async function loadTrainerIcon(url) {
  if (!url) throw new Error('No trainer icon is configured for Explore.');
  if (!iconCache.has(url)) {
    const pending = (async () => {
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`Trainer icon request failed with HTTP ${response.status}.`);
      return loadImage(Buffer.from(await response.arrayBuffer()));
    })();
    iconCache.set(url, pending);
    pending.catch(() => iconCache.delete(url));
    if (iconCache.size > 100) iconCache.delete(iconCache.keys().next().value);
  }
  return iconCache.get(url);
}

async function renderExploreMap(mapType, posX, posY, trainerUrl, variant = 0, chest = null) {
  const map = getExploreMap(mapType, variant);
  const { width, height } = getExploreMapSize(mapType, variant);
  const [background, trainer, chestIcon] = await Promise.all([
    loadMap(map), loadTrainerIcon(trainerUrl), chest ? loadTrainerIcon(CHEST_IMAGE_URL) : null,
  ]);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(background, 0, 0, width, height);
  ctx.drawImage(trainer, posX, posY, TRAINER_WIDTH, TRAINER_HEIGHT);
  if (chestIcon) {
    const samePosition = chest.x === posX && chest.y === posY;
    const size = samePosition ? 16 : TRAINER_WIDTH;
    ctx.drawImage(chestIcon, chest.x + (samePosition ? 16 : 0), chest.y, size, size);
  }
  return canvas.toBuffer('image/png');
}

module.exports = { MAP_THEMES, TRAINER_WIDTH, TRAINER_HEIGHT, getExploreMapSize, renderExploreMap };
