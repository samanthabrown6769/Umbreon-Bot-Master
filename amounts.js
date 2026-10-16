function parseAmount(value) {
  if (typeof value !== 'string') return Number.NaN;
  const normalized = value.trim().replace(/,/g, '');
  const match = normalized.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))([kmb])?$/i);
  if (!match) return Number.NaN;

  const suffixMultiplier = {
    k: 1_000,
    m: 1_000_000,
    b: 1_000_000_000,
  };
  const multiplier = match[2] ? suffixMultiplier[match[2].toLowerCase()] : 1;
  const result = Number(match[1]) * multiplier;
  return Number.isSafeInteger(result) ? result : Number.NaN;
}

module.exports = { parseAmount };
