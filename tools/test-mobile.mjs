/* Mobile hero + scroll smoke test. Not part of the site.
   node tools/test-mobile.mjs */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.jpg': 'image/jpeg', '.woff': 'font/woff', '.svg': 'image/svg+xml'
};

const requested = [];

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  requested.push(rel);
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('nope'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const url = `http://localhost:${port}/index.html`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--enable-features=NetworkService']
});

async function run(label, { width, height, saveData, effectiveType, reduced }) {
  requested.length = 0;
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));

  await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  /* Headless Chrome reports prefers-reduced-motion: reduce by default,
     which silently put every earlier run into calm mode. Always state
     the preference explicitly — never rely on the default. */
  await page.emulateMediaFeatures([
    { name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }
  ]);

  // Fake the Network Information API before any script runs.
  await page.evaluateOnNewDocument((et, sd) => {
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: { effectiveType: et, saveData: sd, addEventListener() {} }
    });
  }, effectiveType, saveData);

  await page.goto(url, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 2500));

  const before = await page.evaluate(() => {
    const t = document.getElementById('heroTilt');
    return { transform: getComputedStyle(t).transform, scrollY: window.scrollY };
  });

  // Scroll a third of the way down the hero track.
  await page.evaluate(() => window.scrollTo(0, window.innerHeight * 1.2));
  await new Promise((r) => setTimeout(r, 1800));

  const after = await page.evaluate(() => {
    const t = document.getElementById('heroTilt');
    const hero = document.getElementById('hero');
    const beats = [...document.querySelectorAll('.beat')].map((b) => b.style.transform);
    return {
      transform: getComputedStyle(t).transform,
      scrollY: window.scrollY,
      scrub: hero.classList.contains('hero--scrub'),
      still: hero.classList.contains('hero--still'),
      canvasOpacity: getComputedStyle(document.getElementById('heroCanvas')).opacity,
      beat0: beats[0]
    };
  });

  // Reveals further down.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.55));
  await new Promise((r) => setTimeout(r, 1200));
  const reveals = await page.evaluate(() => {
    const all = [...document.querySelectorAll('.reveal')];
    const shown = all.filter((e) => e.classList.contains('is-in'));
    return {
      total: all.length,
      shown: shown.length,
      delays: shown.slice(0, 6).map((e) => e.style.transitionDelay || '0s')
    };
  });

  const mobileFrames = requested.filter((r) => r.includes('frames-mobile')).length;
  const desktopFrames = requested.filter((r) => /frames\/frame_/.test(r)).length;

  console.log(`\n=== ${label} ===`);
  console.log(`  hero--still: ${after.still}   hero--scrub: ${after.scrub}`);
  console.log(`  mobile frames requested:  ${mobileFrames}`);
  console.log(`  desktop frames requested: ${desktopFrames}`);
  console.log(`  canvas opacity: ${after.canvasOpacity}`);
  console.log(`  tilt transform @0:    ${before.transform}`);
  console.log(`  tilt transform @1.2vh: ${after.transform}`);
  console.log(`  parallax moved: ${before.transform !== after.transform}`);
  console.log(`  beat0 transform: ${after.beat0.slice(0, 60)}`);
  console.log(`  reveals: ${reveals.shown}/${reveals.total}  delays: ${reveals.delays.join(', ')}`);
  const errs = logs.filter((l) => l.startsWith('PAGEERROR'));
  console.log(`  hero log: ${logs.find((l) => l.includes('[hero]')) || '(none)'}`);
  if (errs.length) console.log(`  ERRORS: ${errs.join(' | ')}`);

  await page.close();
  return { after, before, mobileFrames, desktopFrames, reveals, errs };
}

const r1 = await run('phone, 4g, no save-data', {
  width: 390, height: 844, saveData: false, effectiveType: '4g'
});
const r2 = await run('phone, 3g', {
  width: 390, height: 844, saveData: false, effectiveType: '3g'
});
const r3 = await run('phone, 4g + save-data', {
  width: 390, height: 844, saveData: true, effectiveType: '4g'
});
const r4 = await run('phone, 4g, reduced motion', {
  width: 390, height: 844, saveData: false, effectiveType: '4g', reduced: true
});
console.log('\n\n===== ASSERTIONS =====');
const checks = [
  ['4g upgrades to scrub',            r1.after.scrub === true],
  ['4g pulled mobile frames',         r1.mobileFrames > 40],
  ['4g pulled NO desktop frames',     r1.desktopFrames <= 1],
  ['3g stays on still',               r2.after.scrub === false],
  ['3g pulled no mobile frames',      r2.mobileFrames === 0],
  ['3g still parallaxes',             r2.before.transform !== r2.after.transform],
  ['save-data stays on still',        r3.after.scrub === false],
  ['save-data pulled no frames',      r3.mobileFrames === 0],
  // Reduced motion keeps the scrub — it is direct manipulation, same
  // reasoning the desktop path uses. What it drops is the drift.
  ['reduced motion still scrubs',     r4.after.scrub === true],
  ['reduced motion: no parallax drift', r4.before.transform === r4.after.transform],
  ['reveals fire',                    r1.reveals.shown > 0],
  ['reveals staggered',               new Set(r1.reveals.delays).size > 1],
  ['no page errors',                  [r1, r2, r3, r4].every((r) => r.errs.length === 0)]
];
let bad = 0;
for (const [name, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) bad++;
}
console.log(bad ? `\n${bad} FAILING` : '\nall green');

await browser.close();
server.close();
process.exit(bad ? 1 : 0);
