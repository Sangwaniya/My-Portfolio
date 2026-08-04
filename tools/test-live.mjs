/* Drives the deployed site, not a local copy. The local suites prove the
   logic; this proves what a real phone actually receives.
   node tools/test-live.mjs [url] */
import puppeteer from 'puppeteer-core';

const URL = process.argv[2] || 'https://my-portfolio.ms88hr.workers.dev/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });

async function probe(label, { conn, reduced, width = 390, height = 844 }) {
  const page = await browser.newPage();
  const frames = { mobile: 0, desktop: 0 };
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('response', (r) => {
    const u = r.url();
    if (u.includes('frames-mobile')) frames.mobile++;
    else if (/frames\/frame_/.test(u)) frames.desktop++;
  });

  await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: width < 768, hasTouch: width < 768 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }]);
  await page.evaluateOnNewDocument((c) => {
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: c === null ? undefined : { ...c, addEventListener() {} }
    });
  }, conn);

  await page.goto(URL, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 6000));

  await page.evaluate(() => {
    const t = document.getElementById('heroTrack');
    window.scrollTo(0, (t.getBoundingClientRect().height - innerHeight) * 0.5);
  });
  await new Promise((r) => setTimeout(r, 2500));

  const state = await page.evaluate(() => {
    const c = document.getElementById('heroCanvas');
    let painted = false;
    if (c.width) {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let lit = 0;
      for (let i = 0; i < d.length; i += 4 * 500) if ((d[i] + d[i+1] + d[i+2]) / 3 > 12) lit++;
      painted = lit > 10;
    }
    return {
      scrub: document.getElementById('hero').classList.contains('hero--scrub'),
      painted,
      smoothActive: window.SmoothScroll.active
    };
  });

  console.log(`  ${state.scrub ? 'SCRUB' : 'still'}  painted=${String(state.painted).padEnd(5)} mobileReq=${String(frames.mobile).padEnd(4)} desktopReq=${String(frames.desktop).padEnd(4)} ${label}`);
  await page.close();
  return { ...state, frames, errs };
}

console.log(`live: ${URL}\n`);
const ios      = await probe('iPhone (no connection API)',   { conn: null, reduced: false });
const iosCalm  = await probe('iPhone + Reduce Motion',       { conn: null, reduced: true });
const android  = await probe('Android Chrome 4g',            { conn: { effectiveType: '4g', saveData: false }, reduced: false });
const slow     = await probe('Android 3g',                   { conn: { effectiveType: '3g', saveData: false }, reduced: false });
const desktop  = await probe('desktop 1440w',                { conn: { effectiveType: '4g', saveData: false }, reduced: false, width: 1440, height: 900 });

const checks = [
  ['iPhone gets the scrub',            ios.scrub === true],
  ['iPhone canvas really paints',      ios.painted === true],
  ['iPhone pulled mobile frames',      ios.frames.mobile > 40],
  ['iPhone pulled no desktop frames',  ios.frames.desktop <= 1],
  ['iPhone+ReduceMotion still scrubs', iosCalm.scrub === true],
  ['Android 4g scrubs',                android.scrub === true],
  ['3g stays on still',                slow.scrub === false],
  ['3g pulled no mobile frames',       slow.frames.mobile === 0],
  ['phones get native scroll',         ios.smoothActive === false],
  ['desktop keeps smooth scroll',      desktop.smoothActive === true],
  ['desktop uses desktop frames',      desktop.frames.desktop > 100],
  ['desktop pulled no mobile frames',  desktop.frames.mobile === 0],
  ['no page errors anywhere',          [ios, iosCalm, android, slow, desktop].every((r) => r.errs.length === 0)]
];

console.log('\n===== LIVE ASSERTIONS =====');
let bad = 0;
for (const [n, ok] of checks) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}`); if (!ok) bad++; }
console.log(bad ? `\n${bad} FAILING` : '\nall green');
await browser.close();
process.exit(bad ? 1 : 0);
