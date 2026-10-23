const fs = require('fs');
const path = require('path');
const { regionalPokemonName } = require('../pokemon-names');

const CUSTOM_FORMS_PATH = path.join(__dirname, '..', 'data', 'custom-pokemon-forms.json');

function appendCustomPokemonForms(catalog) {
  const customForms = JSON.parse(fs.readFileSync(CUSTOM_FORMS_PATH, 'utf8'));
  if (!Array.isArray(customForms)) {
    throw new Error(`Custom Pokémon forms file must contain an array: ${CUSTOM_FORMS_PATH}`);
  }

  const formsById = new Set(catalog.map((pokemon) => pokemon.id));
  const formsBySlug = new Map(catalog.map((pokemon) => [pokemon.slug, pokemon]));
  for (const customForm of customForms) {
    if (!Number.isSafeInteger(customForm.id)
        || typeof customForm.slug !== 'string' || !customForm.slug.trim()
        || typeof customForm.species_slug !== 'string' || !customForm.species_slug.trim()) {
      throw new Error(`Invalid custom Pokémon form definition: ${JSON.stringify(customForm)}`);
    }
    if (formsById.has(customForm.id)) {
      throw new Error(`Custom Pokémon form ID ${customForm.id} is already in use.`);
    }
    if (formsBySlug.has(customForm.slug)) {
      console.warn(
        `Custom Pokémon form "${customForm.slug}" already exists; keeping the catalog record.`
      );
      continue;
    }

    const baseForm = formsBySlug.get(customForm.species_slug);
    if (!baseForm) {
      throw new Error(
        `Missing base Pokémon form "${customForm.species_slug}" for custom form "${customForm.slug}".`
      );
    }

    const form = {
      ...baseForm,
      id: customForm.id,
      species_id: customForm.species_id ?? baseForm.species_id,
      species_name: customForm.species_name ?? baseForm.species_name,
      slug: customForm.slug,
      name: regionalPokemonName(customForm.slug),
      is_default: customForm.is_default ?? 0,
      is_legendary: customForm.is_legendary ?? baseForm.is_legendary,
      is_mythical: customForm.is_mythical ?? baseForm.is_mythical,
      rarity: customForm.rarity ?? baseForm.rarity,
    };
    if (![0, 1].includes(form.is_default)
        || ![0, 1].includes(form.is_legendary)
        || ![0, 1].includes(form.is_mythical)
        || typeof form.rarity !== 'string' || !form.rarity.trim()) {
      throw new Error(`Invalid custom Pokémon form flags or rarity: ${customForm.slug}`);
    }

    catalog.push(form);
    formsById.add(form.id);
    formsBySlug.set(form.slug, form);
  }
}

module.exports = { appendCustomPokemonForms };
