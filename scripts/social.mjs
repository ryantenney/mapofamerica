// Builds the link-preview assets: docs/og-image.jpg (1200x630, rendered from the
// live map) and the PNG icons at the site root, from docs/icon.svg.
// `npm run social`. Needs a browser like scripts/screenshot.mjs does
// (`npx playwright install chromium`, or CHROME_PATH; extra flags in CHROME_ARGS).
// Author: Ryan Tenney
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serve } from './serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = 1200, H = 630;
const TITLE = 'Map of America';
const SUBTITLE = 'Every road, town, lake, school, state and city, renamed America.';
const CONUS = [[-125.0, 24.4], [-66.9, 49.4]];

const OVERLAY_CSS = `
  #badge, .maplibregl-ctrl-top-right, .maplibregl-ctrl-scale { display: none !important; }
  .maplibregl-ctrl-attrib { font-size: 13px !important; }
  #og-card {
    position: fixed; left: 50%; transform: translateX(-50%); bottom: 28px; z-index: 5;
    width: max-content; max-width: 600px; box-sizing: border-box; padding: 22px 32px 26px;
    border-radius: 18px; background: rgba(255,255,255,0.95); box-shadow: 0 3px 14px rgba(0,0,0,0.28);
    font-family: "Liberation Sans", Arial, Helvetica, sans-serif; color: #1b1b1b;
  }
  #og-card h1 { margin: 0; font-size: 60px; line-height: 1.05; letter-spacing: -0.015em; font-weight: 700; }
  #og-card p { margin: 10px 0 0; font-size: 25px; line-height: 1.3; color: #555; }
`;

const server = await serve(0);
const base = `http://127.0.0.1:${server.address().port}/`;
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  proxy: proxy ? { server: proxy, bypass: '127.0.0.1,localhost' } : undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', ...(process.env.CHROME_ARGS || '').split(' ').filter(Boolean)],
});

// Preview image: the whole country with a title card, saved as a JPEG small
// enough for every platform (WhatsApp's limit is the tightest, 600 KB).
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.error('[page error]', e.message));
await page.goto(base, { waitUntil: 'load' });
await page.waitForFunction(() => window.__map && window.__map.loaded(), null, { timeout: 120000 });
await page.addStyleTag({ content: OVERLAY_CSS });
await page.evaluate(({ TITLE, SUBTITLE, CONUS }) => {
  const card = document.createElement('div');
  card.id = 'og-card';
  card.innerHTML = '<h1></h1><p></p>';
  card.querySelector('h1').textContent = TITLE;
  card.querySelector('p').textContent = SUBTITLE;
  document.body.appendChild(card);
  window.__map.fitBounds(CONUS, { padding: 14, duration: 0 });
}, { TITLE, SUBTITLE, CONUS });
await page.evaluate(() => new Promise((resolve) => {
  const map = window.__map;
  const done = () => setTimeout(resolve, 800);
  if (map.loaded() && map.areTilesLoaded() && !map.isMoving()) done();
  else map.once('idle', done);
  setTimeout(resolve, 45000);
}));
for (const quality of [86, 82, 78, 74, 70, 66, 62, 58]) {
  const buf = await page.screenshot({ type: 'jpeg', quality, scale: 'css' });
  if (buf.length <= 290 * 1024 || quality === 58) {
    fs.writeFileSync(path.join(ROOT, 'docs', 'og-image.jpg'), buf);
    console.log(`wrote docs/og-image.jpg (quality ${quality}, ${buf.length} bytes)`);
    break;
  }
}
await page.close();

// Icons, rendered from the SVG at each size.
const svg = fs.readFileSync(path.join(ROOT, 'docs', 'icon.svg'), 'utf8');
for (const [size, name] of [[512, 'icon-512.png'], [180, 'apple-touch-icon.png'], [32, 'favicon-32.png']]) {
  const p = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await p.setContent(`<!doctype html><html><head><style>html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden}svg{display:block}</style></head><body>${svg}</body></html>`);
  const buf = await p.screenshot({ type: 'png', clip: { x: 0, y: 0, width: size, height: size } });
  fs.writeFileSync(path.join(ROOT, name), buf);
  console.log(`wrote ${name} (${buf.length} bytes)`);
  await p.close();
}

await browser.close();
server.close();
