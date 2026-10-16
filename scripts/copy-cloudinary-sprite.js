require('dotenv').config();

const { cloudinary, isCloudinaryEnabled } = require('../cloudinary');

// Copies an externally hosted sprite into the Cloudinary sprite folder so the
// bot serves it for Pokémon that have no Showdown animated sprite.
// Usage: node scripts/copy-cloudinary-sprite.js <sourceUrl> [slug] [--shiny]

const [sourceUrl, slugArg] = process.argv.slice(2);
const isShiny = process.argv.includes('--shiny');

if (!sourceUrl || !/^https:\/\//i.test(sourceUrl)) {
  console.error('Usage: node scripts/copy-cloudinary-sprite.js <sourceUrl> [slug] [--shiny]');
  process.exit(1);
}
if (!isCloudinaryEnabled()) {
  console.error('Cloudinary is not configured. Set CLOUDINARY_* values in .env first.');
  process.exit(1);
}

const slug = (slugArg || sourceUrl.split('/').pop().replace(/\.[a-z0-9]+$/i, ''))
  .toLowerCase().replace(/[^a-z0-9-]/g, '');
if (!slug) {
  console.error('Could not derive a slug; pass one explicitly.');
  process.exit(1);
}

const { getCloudinaryFolder } = require('../cloudinary');
const publicId = `${getCloudinaryFolder()}/${isShiny ? 'ani-shiny' : 'ani'}/${slug}`;

cloudinary.uploader
  .upload(sourceUrl, { public_id: publicId, overwrite: true, resource_type: 'image' })
  .then((result) => console.log(`Copied to ${result.public_id}: ${result.secure_url}`))
  .catch((error) => {
    console.error('Copy failed:', error.message || error);
    process.exit(1);
  });
