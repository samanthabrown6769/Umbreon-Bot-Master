require('dotenv').config();

const path = require('path');
const { cloudinary, getCloudinaryFolder, isCloudinaryEnabled } = require('../cloudinary');
const { showdownSpriteSlug } = require('../pokemon-sprites');

const SHOWDOWN_ANIMATED_SPRITE_BASE = 'https://play.pokemonshowdown.com/sprites';
const UPLOAD_CONCURRENCY = 10;

function collectSlugs() {
  const files = ['base-dex.json', 'formes.json', 'mega.json', 'gmax.json'];
  const slugs = new Set();
  for (const file of files) {
    const entries = require(path.resolve(__dirname, '..', 'pokemon-database', file));
    for (const entry of entries) {
      const slug = showdownSpriteSlug(entry.slug || entry.name);
      if (slug) slugs.add(slug);
    }
  }
  return [...slugs];
}

function shouldSkip(slug, isShiny) {
  if (!slug) return true;
  // These forms are not served from the animated sprite sets by pokemon-sprites.js.
  if (/gmax|gigantamax|eternamax/i.test(slug)) return true;
  if (slug === 'great-tusk') return true;
  if (slug === 'pikachu-world-cap') return true;
  if (isShiny && slug === 'flutter-mane') return true;
  return false;
}

async function uploadSprite(slug, isShiny) {
  const variant = isShiny ? 'ani-shiny' : 'ani';
  const publicId = `${getCloudinaryFolder()}/${variant}/${slug}`;
  const sourceUrl = `${SHOWDOWN_ANIMATED_SPRITE_BASE}/${variant}/${slug}.gif`;
  try {
    await cloudinary.uploader.upload(sourceUrl, {
      public_id: publicId,
      overwrite: false,
      resource_type: 'image',
    });
    return 'uploaded';
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (/already exists/i.test(message)) return 'exists';
    console.warn(`  skipped ${publicId}: ${message}`);
    return 'skipped';
  }
}

async function runBatch(tasks) {
  const results = await Promise.all(tasks.map((task) => task()));
  return results;
}

async function main() {
  if (!isCloudinaryEnabled()) {
    console.error(
      'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and ' +
        'CLOUDINARY_API_SECRET in your .env file first.'
    );
    process.exit(1);
  }

  const slugs = collectSlugs();
  const jobs = [];
  for (const slug of slugs) {
    for (const isShiny of [false, true]) {
      if (!shouldSkip(slug, isShiny)) jobs.push({ slug, isShiny });
    }
  }

  console.log(
    `Uploading ${jobs.length} sprites (${slugs.length} slugs, normal + shiny) to ` +
      `Cloudinary folder "${getCloudinaryFolder()}"...`
  );

  const counts = { uploaded: 0, exists: 0, skipped: 0 };
  for (let i = 0; i < jobs.length; i += UPLOAD_CONCURRENCY) {
    const batch = jobs.slice(i, i + UPLOAD_CONCURRENCY);
    const results = await runBatch(
      batch.map(({ slug, isShiny }) => () => uploadSprite(slug, isShiny))
    );
    for (const result of results) counts[result] += 1;
    const done = Math.min(i + UPLOAD_CONCURRENCY, jobs.length);
    if (done % 100 < UPLOAD_CONCURRENCY || done === jobs.length) {
      console.log(`  ${done}/${jobs.length} processed...`);
    }
  }

  console.log(
    `Done. Uploaded: ${counts.uploaded}, already existed: ${counts.exists}, skipped: ${counts.skipped}.`
  );
}

main().catch((error) => {
  console.error('Sprite upload failed:', error);
  process.exit(1);
});
