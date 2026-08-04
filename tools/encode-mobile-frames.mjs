/* ============================================================
   encode-mobile-frames.mjs

   Writes public/hero/frames-mobile/ — the phone-sized frame set.
   Half the frames (every 2nd) at 720px wide, which lands around
   2.2 MB against the desktop set's 16 MB. That is small enough to
   hand a phone on a 4G connection and still be a real scrub.

   sharp is NOT a project dependency. The site itself has no build
   step and no node_modules; this is a one-off asset step you run by
   hand when the source video changes:

     npm install sharp
     node tools/encode-mobile-frames.mjs

   Re-run it after re-extracting the desktop frames (see README),
   then update MOBILE.count in assets/js/hero.js if the number of
   files that land here changes.
   ============================================================ */
import sharp from 'sharp';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Paths resolve against the project root, not the shell's cwd, so this
// runs the same from the repo root or from inside tools/.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SRC     = path.join(ROOT, 'public/hero/frames');
const OUT     = path.join(ROOT, 'public/hero/frames-mobile');
const WIDTH   = 720;
const QUALITY = 72;
const STEP    = 2;      // every 2nd frame: 241 sources -> 121 outputs

const pad = (n) => String(n).padStart(4, '0');

const files = (await readdir(SRC))
  .filter((f) => /^frame_\d+\.jpg$/.test(f))
  .sort();

if (!files.length) {
  console.error(`no frame_*.jpg in ${SRC} — extract the desktop frames first`);
  process.exit(1);
}

await mkdir(OUT, { recursive: true });

let bytes = 0;
let out = 0;

for (let i = 0; i < files.length; i += STEP) {
  out += 1;
  const dest = path.join(OUT, `frame_${pad(out)}.jpg`);

  /* mozjpeg + progressive: the same bytes decode noticeably better on
     a slow link, and progressive means a half-arrived frame still
     paints something rather than a grey box. */
  const buf = await sharp(path.join(SRC, files[i]))
    .resize({ width: WIDTH })
    .jpeg({ quality: QUALITY, mozjpeg: true, progressive: true })
    .toBuffer();

  // Write the buffer straight out. Handing it back to sharp would
  // decode and re-encode an already-compressed JPEG — generation loss
  // for nothing.
  await writeFile(dest, buf);
  bytes += buf.length;

  if (out % 20 === 0) process.stdout.write(`  ${out} frames…\n`);
}

console.log(
  `\n${out} frames -> ${OUT}\n` +
  `${(bytes / 1048576).toFixed(2)} MB total, ` +
  `${(bytes / out / 1024).toFixed(1)} KB average\n\n` +
  `Set MOBILE.count in assets/js/hero.js to ${out}.`
);
