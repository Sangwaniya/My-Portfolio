/* ============================================================
   hero.js — scroll-scrubbed canvas video + rotating text drum.

   Scroll position is the playhead. Progress comes from the tall
   track's bounding rect, drives a *fractional* frame position,
   and eases toward it so nothing snaps. Sub-frame positions are
   cross-blended (floor frame solid, next frame at the fractional
   alpha) which is what stops the scrub from visibly stepping on a
   slow scroll.

   SCRUB SPEED: change EASE below. Lower = heavier, more lag.
   ============================================================ */
(function () {
  'use strict';

  var FRAME_COUNT = 241;                  // counted on disk, never guessed
  var PATH = 'public/hero/frames/frame_';
  var EASE = 0.1;                         // <- the one number for scrub feel
  var SNAP = 0.001;
  var TILT_DEG = 2.2;
  var TILT_FADE_FRAMES = 6;

  var track  = document.getElementById('heroTrack');
  var hero   = document.getElementById('hero');
  var canvas = document.getElementById('heroCanvas');
  var tilt   = document.getElementById('heroTilt');
  var drum   = document.getElementById('drum');
  if (!track || !canvas || !drum) return;

  var beats = Array.prototype.slice.call(drum.querySelectorAll('.beat'));
  var BEATS = beats.length;

  // Shared, eased progress. The drum reads this — never raw scroll.
  var progressRef = { value: 0 };

  /* Windows with "Animation effects" off, and macOS with "Reduce
     motion" on, both report prefers-reduced-motion: reduce. That no
     longer switches the hero off — see the bail-out below, it only
     calms it — so there is no override flag to remember either.
     The console still names the mode, because "why isn't it moving"
     is otherwise pure guesswork. */
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var small   = window.matchMedia('(max-width: 768px)').matches;

  console.log(
    '[hero] mode:', small ? 'STILL (narrow screen)' : reduced ? 'SCRUB (calm)' : 'SCRUB',
    '| prefers-reduced-motion:', reduced,
    '| width:', window.innerWidth
  );

  /* --------------------------------------------------------
     Off-screen gate. Declared up here, above the bail-outs,
     because the small-screen path starts the drum loop and
     returns — `var` would otherwise leave this undefined and
     the loop would never render a thing on a phone.
     -------------------------------------------------------- */
  var visible = true;
  var drumProgress = 0;

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
    }, { rootMargin: '10% 0px' }).observe(track);
  }

  /* --------------------------------------------------------
     Bail-out, decided with matchMedia *before* the loading
     path runs so a phone never pulls 241 images.

     Reduced motion deliberately does NOT bail out. Scrubbing is
     direct manipulation: nothing moves unless the reader moves it,
     and it stops the instant they stop. What the preference is
     actually asking us to drop is the *involuntary* motion, so
     `calm` kills the pointer tilt, the smoothing lag and the drum's
     3D tumble while the frames still track the scroll 1:1.
     -------------------------------------------------------- */
  var calm = reduced;

  if (small) {
    hero.classList.add('hero--still');
    layoutDrum(0);
    startDrumLoop(true);   // tracks scroll, but no canvas work
    return;
  }

  /* --------------------------------------------------------
     Frame loading — every src set at once so the browser
     pulls the whole sequence in parallel.
     -------------------------------------------------------- */
  var ctx = canvas.getContext('2d', { alpha: false });
  var frames = new Array(FRAME_COUNT);
  var loaded = new Array(FRAME_COUNT);
  var firstReady = false;

  function src(i) {
    return PATH + String(i + 1).padStart(4, '0') + '.jpg';
  }

  for (var i = 0; i < FRAME_COUNT; i++) {
    (function (idx) {
      var img = new Image();
      img.decoding = 'async';
      img.onload = function () {
        loaded[idx] = true;
        if (idx === 0 && !firstReady) {
          firstReady = true;
          resize();
          draw(0);
          fadeIn();
        }
      };
      img.src = src(idx);
      frames[idx] = img;
    })(i);
  }

  function fadeIn() {
    canvas.style.transition = 'opacity 600ms ease-out';
    // next frame, so the transition actually runs
    requestAnimationFrame(function () { canvas.style.opacity = '1'; });
  }

  /* --------------------------------------------------------
     Canvas sizing + object-fit: cover draw math
     -------------------------------------------------------- */
  var cssW = 0, cssH = 0;

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var r = canvas.getBoundingClientRect();
    cssW = r.width;
    cssH = r.height;
    canvas.width  = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function cover(img) {
    var s = Math.max(cssW / img.naturalWidth, cssH / img.naturalHeight);
    var w = img.naturalWidth * s;
    var h = img.naturalHeight * s;
    return { x: (cssW - w) / 2, y: (cssH - h) / 2, w: w, h: h };
  }

  function paint(img, alpha) {
    if (!img || !img.naturalWidth) return;
    var b = cover(img);
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, b.x, b.y, b.w, b.h);
    ctx.globalAlpha = 1;
  }

  // Draw a fractional frame position by cross-blending neighbours.
  function draw(pos) {
    if (!cssW || !cssH) return;
    var lo = Math.floor(pos);
    var frac = pos - lo;
    var hi = Math.min(lo + 1, FRAME_COUNT - 1);

    var base = nearestLoaded(lo);
    if (base === -1) return;
    paint(frames[base], 1);

    if (frac > 0.001 && hi !== base && loaded[hi]) {
      paint(frames[hi], frac);
    }
  }

  // Early on, later frames may not have arrived yet — fall back to
  // the closest one we have so there is always something on screen.
  function nearestLoaded(idx) {
    if (loaded[idx]) return idx;
    for (var d = 1; d < FRAME_COUNT; d++) {
      if (idx - d >= 0 && loaded[idx - d]) return idx - d;
      if (idx + d < FRAME_COUNT && loaded[idx + d]) return idx + d;
    }
    return -1;
  }

  /* --------------------------------------------------------
     Pointer tilt — only while the video is parked on frame 1.
     -------------------------------------------------------- */
  var pointer = { x: 0, y: 0 };
  var eased = { x: 0, y: 0 };

  window.addEventListener('pointermove', function (e) {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  function applyTilt(frame) {
    // Calm mode: the tilt is pure decoration and it moves without
    // being asked (the pointer isn't scrolling), so it's the first
    // thing to go.
    if (calm) return;

    eased.x += (pointer.x - eased.x) * 0.08;
    eased.y += (pointer.y - eased.y) * 0.08;

    // 1 on the held first frame, 0 a few frames in.
    var fade = Math.max(0, 1 - frame / TILT_FADE_FRAMES);
    var tx = eased.x * fade;
    var ty = eased.y * fade;

    tilt.style.transform =
      'perspective(1400px) rotateX(' + (-ty * TILT_DEG).toFixed(3) + 'deg) ' +
      'rotateY(' + (tx * TILT_DEG).toFixed(3) + 'deg) ' +
      'translate3d(' + (-tx * 8).toFixed(2) + 'px,' + (-ty * 8).toFixed(2) + 'px,0) ' +
      'scale(' + (1 + 0.05 * fade).toFixed(4) + ')';
  }

  /* --------------------------------------------------------
     The drum. Per-element perspective so each beat pitches
     straight up instead of swinging sideways.
     -------------------------------------------------------- */
  function layoutDrum(progress) {
    var vh = window.innerHeight;
    var pos = progress * (BEATS - 1);

    for (var b = 0; b < BEATS; b++) {
      var off = b - pos;
      var ty = off * 0.82 * vh;

      // Calm mode: a straight vertical slide. No depth, no pitch —
      // the beats still read in order, they just don't tumble.
      if (calm) {
        beats[b].style.transform = 'translateY(' + ty.toFixed(2) + 'px)';
      } else {
        var tz = -Math.abs(off) * 0.3 * vh;
        var rx = -off * 58;

        beats[b].style.transform =
          'perspective(900px) translateY(' + ty.toFixed(2) + 'px) ' +
          'translateZ(' + tz.toFixed(2) + 'px) ' +
          'rotateX(' + rx.toFixed(2) + 'deg)';
      }

      // Cheap win: stop the browser compositing beats that are
      // well past the top or bottom of the drum.
      beats[b].style.visibility = Math.abs(off) > 1.6 ? 'hidden' : 'visible';
    }
  }

  function rawProgress() {
    var r = track.getBoundingClientRect();
    var span = r.height - window.innerHeight;
    if (span <= 0) return 0;
    var p = -r.top / span;
    return p < 0 ? 0 : p > 1 ? 1 : p;
  }

  /* --------------------------------------------------------
     Loops  (the visibility gate is set up above the bail-outs)
     -------------------------------------------------------- */
  var currentFrame = 0;
  var lastDrawn = -1;

  // The lag is the best part of this, but lag is motion the reader
  // did not ask for. Calm mode pins the playhead directly to scroll.
  var SCRUB_K = calm ? 1 : EASE;

  function scrubLoop() {
    if (visible) {
      var target = rawProgress() * (FRAME_COUNT - 1);

      currentFrame += (target - currentFrame) * SCRUB_K;
      if (Math.abs(target - currentFrame) < SNAP) currentFrame = target;

      // Share the *eased* progress with the drum.
      progressRef.value = currentFrame / (FRAME_COUNT - 1);

      if (firstReady && Math.abs(currentFrame - lastDrawn) > 0.0005) {
        draw(currentFrame);
        lastDrawn = currentFrame;
      }

      applyTilt(currentFrame);
    }
    requestAnimationFrame(scrubLoop);
  }

  // Its own loop, reading the shared ref — as specified. In static
  // mode there is no scrubber to ease the value, so it eases here;
  // either way the drum never sees a raw scroll number.
  function startDrumLoop(staticMode) {
    // Calm mode tracks scroll 1:1. The lag is the nicest part of this
    // thing, but lag is also precisely what reduced motion asks us
    // to stop doing, so it goes.
    var k = calm ? 1 : EASE;

    (function loop() {
      if (visible) {
        if (staticMode) {
          var t = rawProgress();
          drumProgress += (t - drumProgress) * k;
          if (Math.abs(t - drumProgress) < SNAP / 100) drumProgress = t;
          layoutDrum(drumProgress);
        } else {
          layoutDrum(progressRef.value);
        }
      }
      requestAnimationFrame(loop);
    })();
  }

  var rt;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () {
      resize();
      if (firstReady) draw(currentFrame);
      layoutDrum(progressRef.value);
    }, 120);
  });

  resize();
  layoutDrum(0);
  requestAnimationFrame(scrubLoop);
  startDrumLoop(false);

  /* The pin is the whole hero. If any ancestor turns into a scroll
     container (overflow other than visible/clip), sticky resolves
     against that box instead of the viewport and silently does
     nothing — the frame just scrolls away. Say so out loud rather
     than leaving it to look like a JS bug. */
  requestAnimationFrame(function () {
    var stage = document.querySelector('.hero__stage');
    if (!stage) return;
    if (getComputedStyle(stage).position !== 'sticky') {
      console.warn('[hero] .hero__stage is not sticky — the pin is off.');
      return;
    }
    for (var el = stage.parentElement; el && el !== document.documentElement; el = el.parentElement) {
      var o = getComputedStyle(el);
      var bad = [o.overflow, o.overflowX, o.overflowY].filter(function (v) {
        return v !== 'visible' && v !== 'clip';
      });
      if (bad.length) {
        console.warn(
          '[hero] sticky is trapped: ancestor', el.tagName + (el.className ? '.' + el.className : ''),
          'has overflow', bad.join('/') + '. Use `clip`, not `hidden`.'
        );
        return;
      }
    }
    console.log('[hero] pin OK — track', Math.round(track.getBoundingClientRect().height) + 'px,',
                'span', Math.round(track.getBoundingClientRect().height - window.innerHeight) + 'px');
  });
})();
