// Renders a few views of the map with headless Chromium: `npm run screenshot`.
// Needs a browser: `npx playwright install chromium` (or set CHROME_PATH).
// Extra Chromium flags can be passed in CHROME_ARGS.
// Author: Ryan Tenney
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serve } from './serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs');
const VIEWS = [
  { name: 'usa', hash: '' },
  { name: 'great-lakes', hash: '#6.3/44.0/-80.5' },
  { name: 'gulf', hash: '#5.2/26.0/-89.5' },
  { name: 'manhattan', hash: '#14.6/40.7614/-73.9776' },
  { name: 'nags-head', hash: '#16.4/35.9356/-75.6130' },
  { name: 'shields', hash: '#10.5/37.55/-77.45' },
];
const only = process.argv.slice(2);

fs.mkdirSync(OUT, { recursive: true });
const server = await serve(0);
const base = `http://127.0.0.1:${server.address().port}/`;
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  proxy: proxy ? { server: proxy, bypass: '127.0.0.1,localhost' } : undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', ...(process.env.CHROME_ARGS || '').split(' ').filter(Boolean)],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.error('[page error]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.error(`[console ${m.type()}]`, m.text());
});

for (const view of VIEWS) {
  if (only.length && !only.includes(view.name)) continue;
  await page.goto('about:blank');
  await page.goto(base + view.hash, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__map && window.__map.loaded(), null, { timeout: 60000 });
  await page.evaluate(() => new Promise((resolve) => {
    const map = window.__map;
    const done = () => setTimeout(resolve, 600); // let labels fade in
    if (map.loaded() && map.areTilesLoaded() && !map.isMoving()) done();
    else map.once('idle', done);
    setTimeout(resolve, 30000);
  }));
  const file = path.join(OUT, `${view.name}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 82 });
  console.log('wrote', path.relative(ROOT, file));
}

await browser.close();
server.close();
