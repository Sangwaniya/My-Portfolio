# Mohit Sangwan — portfolio

Scroll-scrubbed video hero. Scroll position is the video's playhead: scroll down and it advances, up and it rewinds, stop and it holds a frame. Headline copy rolls on a 3D drum locked to the same playhead.

No build step, no dependencies, no framework. Three JS files, one stylesheet, static images.

## Run it

From this folder:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>.

Any static server works — `npx serve`, `php -S localhost:8000`, VS Code Live Server. Use a server rather than double-clicking `index.html`; some browsers restrict `file://` and the fonts won't load.

## What to check

- The first frame is visible immediately — no black flash on load.
- Scrolling drives the video **both** directions, and it holds a frame when you stop.
- The three text beats roll up and over the top edge in sync, rotating away rather than fading.
- With the mouse still at the top of the page, moving the pointer tilts the frame. It settles flat the instant you start scrolling.
- At the bottom of the hero it rests on the last frame, then the page continues normally.
- Resize the window — the frame re-covers with no letterboxing.
- Narrow the window under 768px and reload: the hero parallaxes the still, and on a 4G connection it upgrades to the mobile sequence. It must never request a `frames/` (desktop) image beyond `frame_0001.jpg`.
- On a real phone, scrolling should feel exactly like native — flick and it coasts. If it feels rubbery or stops dead on lift-off, the smooth-scroll layer has stopped bailing out on touch.
- In the contact section the globe turns on its own — slowly, one full turn per 95 seconds — and the five satellites keep orbiting at their own rates, 50s to 110s a lap. Drag it in any direction to spin it, horizontally and vertically, and let go for momentum. Arrow keys work once it's focused, `Home` resets the framing.
- Behind the section, particles drift and draw hairlines between any two that come close. Move the pointer through them and they push aside. This should be true whether or not reduced motion is on — the console prints `[globe] mode: LIVE (1x)` or `CALM (reduced-motion, 0.4x pace)`, and both drift.

## Tuning

**Globe speed** — `SPIN` at the top of `assets/js/globe.js`. Frame-rate independent, so this reads the same on a 60Hz and a 144Hz screen:

```js
var SPIN = 0.0011;   // radians per frame at 60fps — one turn per 95s
```

**Reduced motion** — `CALM_SCALE`, just below it. Windows reports `prefers-reduced-motion` whenever Animation effects is switched off, which a lot of machines have by default, so ambient motion is *slowed* to this multiplier rather than stopped:

```js
var CALM_SCALE = 0.4;   // globe, satellites and particles at 40% pace
```

Set it to `0` for a genuinely still background. Propagation pulses and particle twinkle stay off under reduced motion either way — they draw the eye rather than sitting behind the text.

**Satellite speed** — each entry in `SATS` (same file) carries its own `w`. Negative runs the other way round.

```js
{ label: 'ISSUE', r: 1.16, inc: 30, raan: 15, w: 0.0021, t: 0.0 },
```

`r` is orbit radius in globe radii, and it is coupled to the sphere size: under `CAM = 3` an orbit of radius r reaches `3r/√(9−r²)` radii from centre, and peaks *off*-axis, not at 90°. The outermost at `1.50` peaks at `1.7321 R` around 60°, which at `R = 0.26` of the short side lands at 90% of the half-width. Raise `R` in `fit()` and you have to pull `1.50` in to match, or the orbit clips the canvas.

**Globe size** — `R = Math.min(ow, oh) * 0.26` in `fit()`, plus `.orb__canvas { max-width: 40rem }` in the stylesheet. The canvas box is the safer of the two to change.

**Particle density and link range** — `LINK` at the top of `globe.js` is the longest line drawn between two particles, in px, and doubles as the spatial-grid cell size. Count comes from area in `seedStars()`: `(sw * sh) / 11500`, clamped 34–130. Drift speed is the `(0.06 + Math.random() * 0.11)` in the same function — about 1.4–9.5 px/sec.

**Scrub feel** — `EASE` at the top of `assets/js/hero.js`:

```js
var EASE = 0.1;   // lower = heavier and laggier, higher = tighter
```

That is the one number. `0.05` is syrupy, `0.2` is snappy, `1.0` removes the lag entirely.

**Scroll length** — `.hero__track { height: 600vh }` in `assets/css/main.css`. Taller means the same 241 frames spread over more scrolling, so the video plays slower.

## Structure

```
index.html
_headers                     cache + security headers (Cloudflare/Netlify)
assets/css/main.css
assets/js/smooth-scroll.js   momentum scrolling
assets/js/hero.js            canvas scrubber + text drum
assets/js/site.js            reveals + validity meters
assets/js/globe.js           contact-section globe + particle field
assets/fonts/                Latin Modern, subset
public/hero/frames/          241 JPEGs, 1920x1080, ~15 MB  (desktop)
public/hero/frames-mobile/   121 JPEGs, 720x405, ~1.8 MB   (phones, 4G only)
tools/                       asset encoding + browser tests, not served
Animation.mp4                source video (not served, not committed)
```

## Mobile

Three things behave differently under 768px, and they are deliberate.

**Scrolling is native.** `smooth-scroll.js` bails out on `(pointer: coarse)`
before it wires up a single listener. That layer is a main-thread rAF loop
calling `window.scrollTo` — an upgrade for a mouse wheel, a downgrade for a
finger. Native touch scroll runs on the compositor and has real fling
momentum; matching it in JS meant `preventDefault` on every `touchmove`, a
tween trailing the finger by ~9 frames, and no fling at all. Anchor taps
still glide, via native `scrollTo({behavior:'smooth'})`.

**The hero has two tiers.** Every phone gets scroll-driven parallax on the
still — a compositor-only transform, no extra bytes, driven by the same eased
progress the text drum reads so frame and copy can never drift apart. The
121-frame mobile sequence then loads and cross-fades into a real scrub once
~40% has arrived.

The upgrade gate is about **bandwidth, not motion**, and it fails *open*:

| condition | result | why |
|---|---|---|
| `saveData` on | still | explicit "don't" from the reader |
| `effectiveType` 3g / 2g / slow-2g | still | measured slow link |
| no Network Information API | **scrub** | unknown ≠ slow — iOS Safari and Firefox have never shipped it |
| `prefers-reduced-motion` | **scrub** | scrubbing is direct manipulation; the drift is what gets dropped |

Failing open matters: an earlier version treated a missing API as a failed
check, which silently pinned every iPhone on the planet to a single still.
Reduced motion keeps the frames — nothing moves unless the reader moves it —
but loses the parallax drift, which is the part that moves on its own.

**Reveals stagger per batch.** Anything crossing the threshold in the same
`IntersectionObserver` callback is treated as one visual group and cascades at
90 ms intervals, capped at 360 ms. A section arriving alone gets no delay, so
the rhythm comes from the content rather than hard-coded `nth-child` rules.

## Re-encoding the mobile frames

`tools/` is not a dependency of the site — it has no build step and no
`node_modules` at runtime. Install once, then run when the source video
changes:

```bash
cd tools && npm install
node tools/encode-mobile-frames.mjs      # from the repo root
```

It prints the frame count; put that in `MOBILE.count` in `assets/js/hero.js`.
Adjust `WIDTH`/`QUALITY`/`STEP` at the top of the script to trade size against
smoothness — `STEP = 2` means every second desktop frame.

## Tests

Real Chrome, real viewports, real scrolling. Needs `cd tools && npm install`
first (pulls `puppeteer-core`; Chrome itself is expected at the standard
Windows path — edit `CHROME` if yours differs).

```bash
node tools/test-mobile.mjs    # tier selection, parallax, reveals, no desktop frames on phones
node tools/test-gate.mjs      # the upgrade gate across 8 connection/motion combinations
node tools/test-touch.mjs     # touchmove not hijacked, desktop keeps smooth scroll, canvas really paints
node tools/shoot.mjs          # screenshots to tools/shots/ at four scroll depths
```

Note that headless Chrome reports `prefers-reduced-motion: reduce` **by
default** — every suite sets it explicitly, and forgetting to is a silent
way to test the wrong thing.

To decide whether something is a regression or was always broken, extract
any commit and shoot it side by side:

```bash
git archive v1.0 | tar -x -C /tmp/baseline
node tools/shoot-baseline.mjs /tmp/baseline
```


## Re-extracting frames

If you swap the video, re-run this and update `FRAME_COUNT` in `assets/js/hero.js` to the number of files that actually land on disk:

```bash
ffmpeg -y -i Animation.mp4 \
  -vf "crop=2560:1440:83:0,fps=30,scale=1920:-2" -q:v 6 \
  public/hero/frames/frame_%04d.jpg

ls public/hero/frames/*.jpg | wc -l    # this number is FRAME_COUNT
```

The `crop` strips 83px of black pillarbox baked into the source. A different video won't need it — check first, and note that ffmpeg's `cropdetect` misses these particular bars.

## Deploying

Static files, no build step. Cloudflare Pages:

1. Push to GitHub.
2. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git.
3. Framework preset **None**, build command **empty**, output directory `/`.

Every push to `main` redeploys. No environment variables, no build config.

Cloudflare over GitHub Pages or Netlify for one reason: a desktop visit pulls
the whole 15 MB frame sequence, and Cloudflare's free tier is the only one of
the three with unmetered bandwidth. The other two cap at 100 GB/month, which is
roughly 6,000 desktop visits. Both are still fine for portfolio traffic —
GitHub Pages is Settings → Pages → deploy from branch, root; Netlify is a
drag-and-drop of this folder onto app.netlify.com/drop.

`_headers` sets a one-year immutable cache on the frames and fonts, so a repeat
visit re-downloads nothing. Cloudflare Pages and Netlify both read it; GitHub
Pages ignores it and sends its own ten-minute cache instead.
