const cloudinary = require('cloudinary').v2;

let configured = false;

function getCloudinaryFolder() {
  return (process.env.CLOUDINARY_FOLDER || 'pokemon-sprites').replace(/^\/+|\/+$/g, '');
}

function configureCloudinary() {
  if (configured) return true;
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  if (!cloudName) return false;
  cloudinary.config({
    cloud_name: cloudName,
    api_key: process.env.CLOUDINARY_API_KEY || undefined,
    api_secret: process.env.CLOUDINARY_API_SECRET || undefined,
    secure: true,
  });
  configured = true;
  return true;
}

function isCloudinaryEnabled() {
  return configureCloudinary();
}

function getCloudinaryUrl(publicId, options = {}) {
  if (!isCloudinaryEnabled()) return null;
  return cloudinary.url(publicId, { secure: true, analytics: false, ...options });
}

function getCloudinaryPokemonSprite(spriteSlug, isShiny = false) {
  if (typeof spriteSlug !== 'string' || !spriteSlug.trim()) return null;
  const variant = isShiny ? 'ani-shiny' : 'ani';
  return getCloudinaryUrl(`${getCloudinaryFolder()}/${variant}/${spriteSlug}.gif`, {
    resource_type: 'image',
  });
}

module.exports = {
  cloudinary,
  getCloudinaryFolder,
  getCloudinaryPokemonSprite,
  getCloudinaryUrl,
  isCloudinaryEnabled,
};
