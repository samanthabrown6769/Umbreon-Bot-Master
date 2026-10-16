require('dotenv').config();

const fs = require('fs');
const { cloudinary, isCloudinaryEnabled, getCloudinaryFolder } = require('../cloudinary');

async function listAllResources() {
  const resources = [];
  let cursor;
  do {
    const res = await cloudinary.api.resources({
      type: 'upload',
      prefix: `${getCloudinaryFolder()}/`,
      max_results: 500,
      ...(cursor ? { next_cursor: cursor } : {}),
    });
    resources.push(...res.resources);
    cursor = res.next_cursor;
  } while (cursor);
  return resources;
}

async function main() {
  if (!isCloudinaryEnabled()) {
    console.error('Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME etc. in your .env file first.');
    process.exit(1);
  }

  const resources = await listAllResources();
  resources.sort((a, b) => a.public_id.localeCompare(b.public_id));
  const urls = resources.map((r) => r.secure_url);
  fs.writeFileSync('cloudinary-sprites.txt', urls.join('\n') + '\n');
  console.log(`total sprites: ${resources.length}`);
  console.log('written to cloudinary-sprites.txt');
  console.log('sample:');
  urls.slice(0, 3).forEach((u) => console.log(' ', u));
}

main().catch((error) => {
  console.error('failed:', error && error.message ? error.message : error);
  process.exit(1);
});
