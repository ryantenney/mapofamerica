// Checks OpenFreeMap's live Liberty style and sprite against what america.js
// assumes, since OpenFreeMap serves them unversioned: `npm run check-upstream`.
// Pass --update to refresh the test fixtures from the live files.
// Author: Ryan Tenney
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import America from '../america.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const fixture = (name) => path.join(ROOT, 'test', 'fixtures', name);

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

const style = await getJson(STYLE_URL);
const sprite = await getJson(`${style.sprite}.json`);
const out = America.americanize(style);
const problems = [];

const shields = out.layers.filter((l) => l.layout && l.layout['icon-text-fit']);
if (shields.length === 0) problems.push('no highway shield layer was recognised; the shield text-field may have changed');
else console.log(`shield layers: ${shields.map((l) => l.id).join(', ')}`);

for (const name of America.IMAGES) {
  if (!sprite[name]) problems.push(`the sprite no longer has "${name}"`);
}

const labelled = America.labelLayerIds(out).length;
console.log(`label layers rewritten: ${labelled}`);
if (labelled < 20) problems.push(`only ${labelled} label layers; the style may have changed shape`);

const same = (name, live) => JSON.stringify(JSON.parse(fs.readFileSync(fixture(name), 'utf8'))) === JSON.stringify(live);
const drift = [['liberty.json', style], ['sprite.json', sprite]].filter(([name, live]) => !same(name, live));
if (drift.length) {
  if (process.argv.includes('--update')) {
    for (const [name, live] of drift) {
      fs.writeFileSync(fixture(name), JSON.stringify(live));
      console.log(`updated test/fixtures/${name}`);
    }
  } else {
    console.log(`live ${drift.map(([n]) => n).join(' and ')} differ from the fixtures; run with --update to refresh them, then npm test`);
  }
} else {
  console.log('fixtures match the live style and sprite');
}

for (const p of problems) console.error(`problem: ${p}`);
process.exit(problems.length ? 1 : 0);
