// Enriches data/move-info.json with Bulbapedia move pages (type, category, power, accuracy, effect text).
// Run after sync-move-info.js: node scripts/sync-bulbapedia-moves.js
const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'data', 'move-info.json');
const API = 'https://bulbapedia.bulbagarden.net/w/api.php';
const HEADERS = { 'User-Agent': 'UmbreonBot/1.0 (Discord bot; move info sync)' };

function clean(text) {
  return text
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/\{\{MoveResearch[^}]*\}\}/gi, '')
    .replace(/\{\{tt\|([^|}]*)\|[^}]*\}\}/gi, '$1')
    .replace(/\{\{(?:type|status|stat|m|p|t|a|move|ability|pkmn|ma)\|([^}|]*)[^}]*\}\}/gi, '$1')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function infobox(wikitext, key) {
  const match = wikitext.match(new RegExp(`^\\|${key}=(.*)$`, 'm'));
  return match ? match[1].trim() : '';
}

function effectText(wikitext) {
  const section = wikitext.split(/^==\s*Effect\s*==\s*$/m)[1];
  if (!section) return '';
  const body = section.split(/^==[^=]/m)[0].replace(/^=+[^=\n]+=+\s*$/gm, '');
  const paragraphs = body.split(/\n\s*\n/).map(clean);
  return paragraphs.find((p) => p.length > 20 && !/^[|*#:{]/.test(p) && !/was lowered|was raised|changed to/.test(p)) || '';
}

async function fetchBatch(titles) {
  const url = `${API}?action=query&prop=revisions&rvprop=content&rvslots=main&redirects=1&format=json&formatversion=2` +
    `&titles=${encodeURIComponent(titles.join('|'))}`;
  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const moves = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const keys = Object.keys(moves);
  let updated = 0;
  for (let i = 0; i < keys.length; i += 20) {
    const slice = keys.slice(i, i + 20);
    const titles = slice.map((key) => `${moves[key].name} (move)`);
    let data;
    try {
      data = await fetchBatch(titles);
    } catch (error) {
      console.warn(`Batch ${i} failed: ${error.message}`);
      continue;
    }
    const redirects = new Map((data.query.redirects || []).map((r) => [r.from, r.to]));
    const normalized = new Map((data.query.normalized || []).map((r) => [r.from, r.to]));
    const pages = new Map(data.query.pages.map((page) => [page.title, page]));
    slice.forEach((key, index) => {
      let title = titles[index];
      title = normalized.get(title) || title;
      title = redirects.get(title) || title;
      const wikitext = pages.get(title)?.revisions?.[0]?.slots?.main?.content;
      if (!wikitext) return;
      const move = moves[key];
      const description = effectText(wikitext);
      if (description) move.description = description;
      const type = infobox(wikitext, 'type');
      if (/^[A-Za-z]+$/.test(type)) move.type = type;
      const category = infobox(wikitext, 'damagecategory');
      if (/^(Physical|Special|Status)$/i.test(category)) {
        move.damageClass = category.charAt(0).toUpperCase() + category.slice(1).toLowerCase();
      }
      const power = Number.parseInt(infobox(wikitext, 'power'), 10);
      if (Number.isFinite(power)) move.power = power;
      const accuracy = Number.parseInt(infobox(wikitext, 'accuracy'), 10);
      if (Number.isFinite(accuracy)) move.accuracy = accuracy;
      if (!move.accuracy) move.accuracy = 100;
      move.source = 'bulbapedia';
      updated += 1;
    });
    process.stdout.write(`\r${Math.min(i + 20, keys.length)}/${keys.length}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  fs.writeFileSync(FILE, `${JSON.stringify(moves)}\n`);
  console.log(`\nUpdated ${updated} moves from Bulbapedia.`);
}

main().catch((error) => { console.error(error); process.exit(1); });
