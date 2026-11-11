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

function isExploreMoveBlocked(mapType, variant, x, y, nextX, nextY) {
  const map = getExploreMap(mapType, variant);
  const { width, height } = getExploreMapSize(mapType, variant);
  return (map.blockedAreas || []).some(([left, top, right, bottom]) => {
    const bounds = [
      [left * width / map.width - TRAINER_WIDTH, right * width / map.width, x, nextX - x],
      [top * height / map.height - TRAINER_HEIGHT, bottom * height / map.height, y, nextY - y],
    ];
    let enter = 0;
    let exit = 1;
    for (const [min, max, start, delta] of bounds) {
      if (delta === 0) {
        if (start <= min || start >= max) return false;
      } else {
        const first = (min - start) / delta;
        const last = (max - start) / delta;
        enter = Math.max(enter, Math.min(first, last));
        exit = Math.min(exit, Math.max(first, last));
      }
    }
    return enter < exit;
  });
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
  if (chestIcon) {
    ctx.drawImage(chestIcon, chest.x, chest.y, TRAINER_WIDTH, TRAINER_HEIGHT);
  }
  const scale = Math.min(TRAINER_WIDTH / trainer.width, TRAINER_HEIGHT / trainer.height);
  const trainerWidth = trainer.width * scale;
  const trainerHeight = trainer.height * scale;
  ctx.drawImage(trainer, posX + (TRAINER_WIDTH - trainerWidth) / 2,
    posY + TRAINER_HEIGHT - trainerHeight, trainerWidth, trainerHeight);
  return canvas.toBuffer('image/png');
}

module.exports = { MAP_THEMES, TRAINER_WIDTH, TRAINER_HEIGHT, getExploreMapSize, isExploreMoveBlocked, renderExploreMap };
