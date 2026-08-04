/* Screenshots the pristine v1.0 (git HEAD, extracted elsewhere) so the
   beat-overlap question can be answered against a real baseline rather
   than from memory. Point BASE at the extracted tree.
   node tools/shoot-baseline.mjs <path-to-extracted-HEAD> */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

// Normalise separators up front: an arg like C:/x/y stays forward-slashed
// while path.join returns C:\x\y, so the containment check below would
// reject every request and serve nothing but 404s.
const BASE = process.argv[2] ? path.resolve(process.argv[2]) : '';
if (!BASE || !fs.existsSync(path.join(BASE, 'index.html'))) {
  console.error('pass the extracted HEAD dir (must contain index.html)');
  process.exit(1);
}
const OUT = path.join(BASE, 'shots');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MIME = { '.html':'text/html','.css':'text/css','.js':'text/javascript','.jpg':'image/jpeg','.woff':'font/woff','.svg':'image/svg+xml' };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(BASE, rel);
  if (!file.startsWith(BASE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const url = `http://localhost:${server.address().port}/index.html`;

fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
await page.goto(url, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1800));

for (const frac of [0, 0.35, 0.7]) {
  await page.evaluate((f) => {
    const track = document.getElementById('heroTrack');
    const span = track.getBoundingClientRect().height - window.innerHeight;
    window.scrollTo(0, span * f);
  }, frac);
  await new Promise((r) => setTimeout(r, 1700));
  await page.screenshot({ path: path.join(OUT, `BASE-phone-${Math.round(frac * 100)}.png`) });
}

console.log('baseline shots:');
for (const f of fs.readdirSync(OUT).sort()) console.log('  ' + path.join(OUT, f));
await browser.close();
server.close();
