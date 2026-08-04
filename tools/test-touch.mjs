/* Verifies the two things the smoke test can't see: that touch scroll is
   genuinely native on a phone, and that the mobile canvas has real pixels
   in it (opacity:1 on a blank canvas would pass the other test).
   node tools/test-touch.mjs */
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
const results = [];

/* ---- 1. touchmove must NOT be preventDefaulted on a phone ---- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await page.goto(url, { waitUntil: 'load' });

  const defaultPrevented = await page.evaluate(() => new Promise((resolve) => {
    // Listen last, so we observe whatever the site's own handler did.
    window.addEventListener('touchmove', (e) => resolve(e.defaultPrevented), { passive: true, once: true });
    const t = (y) => new Touch({ identifier: 1, target: document.body, clientX: 50, clientY: y });
    document.body.dispatchEvent(new TouchEvent('touchstart', { touches: [t(500)], bubbles: true, cancelable: true }));
    document.body.dispatchEvent(new TouchEvent('touchmove',  { touches: [t(400)], bubbles: true, cancelable: true }));
    setTimeout(() => resolve('no-event'), 500);
  }));

  const smoothActive = await page.evaluate(() => window.SmoothScroll.active);
  const hasSmoothClass = await page.evaluate(() => document.documentElement.classList.contains('has-smooth'));

  console.log('=== touch (phone) ===');
  console.log(`  touchmove defaultPrevented: ${defaultPrevented}   (must be false)`);
  console.log(`  SmoothScroll.active:        ${smoothActive}   (must be false)`);
  console.log(`  html.has-smooth:            ${hasSmoothClass}   (must be false)`);
  results.push(['touchmove not hijacked', defaultPrevented === false]);
  results.push(['smooth-scroll inert on touch', smoothActive === false]);
  results.push(['no has-smooth class on touch', hasSmoothClass === false]);

  // Anchor taps should still glide.
  const scrolledBy = await page.evaluate(async () => {
    const y0 = window.scrollY;
    document.querySelector('a[href="#contact"]').click();
    await new Promise((r) => setTimeout(r, 1200));
    return window.scrollY - y0;
  });
  console.log(`  anchor tap scrolled: ${Math.round(scrolledBy)}px`);
  results.push(['anchor links still work on touch', scrolledBy > 500]);
  await page.close();
}

/* ---- 2. desktop must KEEP the smooth layer ---- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, isMobile: false, hasTouch: false });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await page.goto(url, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 600));
  const active = await page.evaluate(() => window.SmoothScroll.active);
  const cls = await page.evaluate(() => document.documentElement.classList.contains('has-smooth'));
  console.log('\n=== desktop (mouse) ===');
  console.log(`  SmoothScroll.active: ${active}   (must be true)`);
  console.log(`  html.has-smooth:     ${cls}   (must be true)`);
  results.push(['desktop keeps smooth scroll', active === true]);
  results.push(['desktop keeps has-smooth', cls === true]);
  await page.close();
}

/* ---- 3. mobile canvas must contain actual image data ---- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'connection', {
      configurable: true, value: { effectiveType: '4g', saveData: false, addEventListener() {} }
    });
  });
  await page.goto(url, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 3000));
  await page.evaluate(() => window.scrollTo(0, window.innerHeight * 1.5));
  await new Promise((r) => setTimeout(r, 1500));

  const px = await page.evaluate(() => {
    const c = document.getElementById('heroCanvas');
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let nonBlack = 0, sum = 0;
    for (let i = 0; i < d.length; i += 4 * 400) {
      const lum = (d[i] + d[i+1] + d[i+2]) / 3;
      sum += lum;
      if (lum > 12) nonBlack++;
    }
    return { w: c.width, h: c.height, nonBlack, samples: Math.floor(d.length / 1600), avgLum: sum / Math.floor(d.length / 1600) };
  });

  // Scrub to a different point — the drawn frame must actually change.
  const changed = await page.evaluate(async () => {
    const c = document.getElementById('heroCanvas');
    const g = c.getContext('2d');
    const grab = () => { const d = g.getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 4 * 400) s += d[i] + d[i+1] + d[i+2]; return s; };
    const a = grab();
    window.scrollTo(0, window.innerHeight * 2.6);
    await new Promise((r) => setTimeout(r, 1600));
    const b = grab();
    return { a, b, differs: Math.abs(a - b) > a * 0.01 };
  });

  console.log('\n=== mobile canvas pixels ===');
  console.log(`  canvas backing store: ${px.w}x${px.h}`);
  console.log(`  non-black samples: ${px.nonBlack}/${px.samples}  avg luminance: ${px.avgLum.toFixed(1)}`);
  console.log(`  frame changed on scrub: ${changed.differs}  (${changed.a} -> ${changed.b})`);
  results.push(['canvas has non-zero size', px.w > 0 && px.h > 0]);
  results.push(['canvas actually painted', px.nonBlack > px.samples * 0.5]);
  results.push(['scrub advances the frame', changed.differs === true]);
  await page.close();
}

console.log('\n===== ASSERTIONS =====');
let bad = 0;
for (const [name, ok] of results) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) bad++; }
console.log(bad ? `\n${bad} FAILING` : '\nall green');

await browser.close();
server.close();
process.exit(bad ? 1 : 0);
