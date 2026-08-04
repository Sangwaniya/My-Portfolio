/* Why is the phone not upgrading to the scrub? Tests the gate against
   conditions the first suite never covered: no Network Information API
   (all of iOS Safari), and Windows-style reduced-motion.
   node tools/test-gate.mjs */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });

async function probe(label, { conn, reduced }) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.emulateMediaFeatures([
    { name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }
  ]);
  await page.evaluateOnNewDocument((c) => {
    if (c === null) {
      // iOS Safari and Firefox ship no Network Information API at all.
      Object.defineProperty(navigator, 'connection', { configurable: true, value: undefined });
    } else {
      Object.defineProperty(navigator, 'connection', { configurable: true, value: { ...c, addEventListener() {} } });
    }
  }, conn);
  await page.goto(url, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 3500));
  const scrub = await page.evaluate(() => document.getElementById('hero').classList.contains('hero--scrub'));
  console.log(`  ${scrub ? 'SCRUB ' : 'still '}  ${label}`);
  await page.close();
  return scrub;
}

console.log('results:');
const r = {
  ios:       await probe('iOS Safari (no connection API)',        { conn: null, reduced: false }),
  reduced:   await probe('4g + reduced motion (Windows default)', { conn: { effectiveType: '4g', saveData: false }, reduced: true }),
  noType:    await probe('API present, effectiveType undefined',  { conn: { saveData: false }, reduced: false }),
  fourG:     await probe('4g, no save-data (control)',            { conn: { effectiveType: '4g', saveData: false }, reduced: false }),
  threeG:    await probe('3g',                                    { conn: { effectiveType: '3g', saveData: false }, reduced: false }),
  slow2g:    await probe('slow-2g',                               { conn: { effectiveType: 'slow-2g', saveData: false }, reduced: false }),
  saveData:  await probe('4g + save-data',                        { conn: { effectiveType: '4g', saveData: true }, reduced: false }),
  saveNoAPI: await probe('save-data on, no effectiveType',        { conn: { saveData: true }, reduced: false })
};

const checks = [
  ['iOS scrubs (unknown = capable)',   r.ios === true],
  ['reduced motion still scrubs',      r.reduced === true],
  ['missing effectiveType scrubs',     r.noType === true],
  ['4g scrubs',                        r.fourG === true],
  ['3g stays on still',                r.threeG === false],
  ['slow-2g stays on still',           r.slow2g === false],
  ['save-data stays on still',         r.saveData === false],
  ['save-data wins over unknown type', r.saveNoAPI === false]
];

console.log('\n===== ASSERTIONS =====');
let bad = 0;
for (const [name, ok] of checks) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) bad++; }
console.log(bad ? `\n${bad} FAILING` : '\nall green');

await browser.close();
server.close();
process.exit(bad ? 1 : 0);
