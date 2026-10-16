// Parses a trade argument such as "mew", "25", "shinybulbasaur", "goldenbulbasaur" or "shinymega-charizard-x".
function parseTradeMonInput(input) {
  if (!input) return null;
  let text = String(input).toLowerCase().trim();
  if (!text) return null;

  if (/^\d+$/.test(text)) {
    return { dexNumber: Number(text), query: text, isShiny: false, isGolden: false };
  }

  let isShiny = false;
  let isGolden = false;
  if (text.startsWith('shiny')) {
    isShiny = true;
    text = text.replace(/^shiny-?/, '');
  } else if (text.startsWith('golden')) {
    isGolden = true;
    text = text.replace(/^golden-?/, '');
  }
  if (!text) return null;

  return { dexNumber: null, query: text.replace(/-/g, ' '), isShiny, isGolden };
}

module.exports = { parseTradeMonInput };
