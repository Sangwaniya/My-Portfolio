/* Screenshots the mobile hero at several scroll depths so the result can
   be looked at, not just asserted about. node tools/shoot.mjs */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tools', 'shots');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MIME = { '.html':'text/html','.css':'text/css','.js':'text/javascript','.jpg':'image/jpeg','.woff':'font/woff','.svg':'image/svg+xml' };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const url = `http://localhost:${server.address().port}/index.html`;

fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });

async function shoot(tag, { width, height, mobile, fast }) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  if (mobile) {
    await page.evaluateOnNewDocument((f) => {
      Object.defineProperty(navigator, 'connection', {
        configurable: true,
        value: { effectiveType: f ? '4g' : '3g', saveData: false, addEventListener() {} }
      });
    }, fast);
  }
  await page.goto(url, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, mobile && fast ? 4000 : 1800));

  for (const frac of [0, 0.35, 0.7, 1.0]) {
    await page.evaluate((f) => {
      const track = document.getElementById('heroTrack');
      const span = track.getBoundingClientRect().height - window.innerHeight;
      window.scrollTo(0, span * f);
    }, frac);
    await new Promise((r) => setTimeout(r, 1700));
    await page.screenshot({ path: path.join(OUT, `${tag}-${Math.round(frac * 100)}.png`) });
  }
  await page.close();
}

await shoot('phone-4g', { width: 390, height: 844, mobile: true, fast: true });
await shoot('phone-3g', { width: 390, height: 844, mobile: true, fast: false });
await shoot('desktop',  { width: 1440, height: 900, mobile: false, fast: true });

console.log('shots in tools/shots:');
for (const f of fs.readdirSync(OUT).sort()) {
  console.log('  ' + f + '  ' + (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0) + ' KB');
}
await browser.close();
server.close();
