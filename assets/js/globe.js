/* ============================================================
   globe.js — the contact stage.

   Two canvases, one rAF loop:

   1. a star sphere the camera sits inside — points scattered
      through a ball around the reader, the whole cloud turning
      slowly on two axes so they sweep past on their own, the near
      ones fastest. Ported from the reference's r3f <Stars>;
   2. a hairline wireframe globe with fourteen edge nodes, live
      propagation arcs, and five satellites on inclined orbits
      named after the stages of a certificate's life —
      ISSUE, VALIDATE, DEPLOY, OCSP, ROTATE.

   The globe spins on its own and can be dragged to any angle, on
   both axes; the satellites keep their own orbital rates either way.

   No WebGL and no library. The 3D is a rotation matrix and a
   perspective divide, drawn to a 2D context: a couple of thousand
   multiply-adds a frame, which is cheaper than a texture upload.

   Everything is drawn in the page's own palette, read out of the
   CSS custom properties so there is still exactly one place the
   colours live.

   GLOBE SPEED: change SPIN below. Higher = faster idle rotation.
   ============================================================ */
(function () {
  'use strict';

  var section = document.getElementById('contact');
  var starCv  = document.getElementById('contactStars');
  var orbCv   = document.getElementById('orbCanvas');
  if (!section || !starCv || !orbCv) return;

  var TAU = Math.PI * 2;
  var RAD = Math.PI / 180;

  var SPIN     = 0.0011;   // <- idle rotation, radians per frame at 60fps
  var CAM      = 3.0;      // camera distance in globe radii
  var DRAG_K   = 0.006;    // radians per pixel dragged
  var FRICTION = 0.93;     // fling decay
  var LIFT     = 0.18;     // how far propagation arcs bow off the surface
  var PITCH_MAX = 1.45;    // ~83 degrees; past this the poles gimbal over
  /* ---------- star sphere, ported from the reference's r3f <Stars> ----
     It scatters 1667 points uniformly through a ball of radius 1.2 and
     parks the camera INSIDE it at z = 1, then turns the whole cloud on
     two axes at delta/10 and delta/15 under a fixed 45-degree roll.

     Sitting inside is the whole trick. The eye is off-centre, so one
     slow rotation sweeps the near stars right across the frame while
     the far ones barely move, and the field reads as depth rather than
     as a moving wallpaper. */
  var STAR_FOV  = 75;            // degrees, vertical — three.js default
  var STAR_BALL = 1.2;           // ball radius, world units
  var STAR_CAM  = 1.0;           // camera distance from the ball centre
  var STAR_NEAR = 0.1;           // three.js default near plane
  var STAR_ROLL = Math.PI / 4;   // the reference's fixed group roll
  var STAR_RX   = -0.1000;       // radians per second about X (delta/10)
  var STAR_RY   = -0.0667;       // radians per second about Y (delta/15)
  var STAR_SIZE = 0.0021;        // point size, world units, attenuated
  var STAR_MAX  = 2.6;           // px, cap so a near star is not a blob
  var STAR_PTR  = 0.05;          // how far the pointer shifts the camera
  /* The reference's stars are opaque pink on near-black. This page has
     no chromatic accent anywhere, so they are marble at part opacity
     instead — the field has to sit behind body copy and stay behind it. */
  var STAR_ALPHA = 0.62;         // alpha of a full-size, near star

  /* Windows reports prefers-reduced-motion when "Animation effects"
     is off, so this is a common state, not an edge case — a lot of
     readers land here without ever having asked for a still page.

     So this is not an on/off switch. Ambient motion runs at a
     quarter pace instead of stopping: the globe still turns, the
     satellites still keep station, the particles still drift. What
     `calm` does switch off is the motion that draws the eye rather
     than sitting behind the text — the propagation pulses firing
     across the sphere, and the per-particle twinkle.

     That is a deliberate softening of the accommodation. A frozen
     background reads as a broken one, and even at 0.4x the drift is
     slower than the page's own scroll. */
  var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* 0.4, not 0.25. At a quarter pace the median particle took nearly
     two minutes to cross one link gap, which is indistinguishable from
     frozen — the exact failure this is meant to avoid. 0.4 puts it
     around 70 seconds: clearly alive, still slower than the scroll. */
  var CALM_SCALE = 0.4;    // ambient pace multiplier under reduced motion
  var autoScale = calm ? CALM_SCALE : 1;

  /* ----------------------------------------------------------
     Loop state, declared above every bail-out. `var` hoists the
     declaration but not the assignment, so anything referenced
     from the loop has to be initialised here or it reads
     undefined and the transform math quietly becomes NaN.
     ---------------------------------------------------------- */
  var visible  = true;
  var yaw      = -0.55;
  var yawVel   = 0;
  var pitch    = 0.38;
  var pitchVel = 0;
  var pitchTo  = 0.38;   // where the pointer would like the tilt to rest
  var dragging = false;
  var lastX    = 0;
  var lastY    = 0;
  var ptr      = { x: 0, y: 0 };
  var pulses   = [];
  var nextPulse = 700;

  /* Once the reader has dragged, the pointer stops nudging the tilt —
     otherwise their chosen angle springs back the moment they move the
     mouse, which feels like the globe is fighting them. */
  var claimed = false;

  /* ---------- palette, single-sourced from the CSS ---------- */
  var cs = getComputedStyle(document.documentElement);

  function rgbOf(name, fb) {
    var h = (cs.getPropertyValue(name) || '').trim() || fb;
    if (h.charAt(0) !== '#') h = fb;
    if (h.length === 4) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
    return [
      parseInt(h.substr(1, 2), 16),
      parseInt(h.substr(3, 2), 16),
      parseInt(h.substr(5, 2), 16)
    ];
  }

  var VOID   = rgbOf('--void',   '#0B0B0C');
  var MARBLE = rgbOf('--marble', '#D8D4CD');
  var TAUPE  = rgbOf('--taupe',  '#948C81');
  var SLATE  = rgbOf('--slate',  '#8F8F91');
  var PATINA = rgbOf('--patina', '#57534E');

  function rgba(c, a) {
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a < 0 ? 0 : a > 1 ? 1 : a).toFixed(3) + ')';
  }

  var sctx = starCv.getContext('2d');
  var octx = orbCv.getContext('2d');

  /* ==========================================================
     GEOMETRY, precomputed once on the unit sphere. Per frame we
     only rotate and project — no trig inside the draw loop.
     ========================================================== */
  var wires = [];

  (function buildWires() {
    var LATS = [-60, -40, -20, 0, 20, 40, 60];
    var LAT_SEG = 64;
    var MERIDIANS = 12;
    var LON_SEG = 40;
    var i, j, pts, lat, cl, lon;

    for (i = 0; i < LATS.length; i++) {
      lat = LATS[i] * RAD;
      cl = Math.cos(lat);
      pts = [];
      for (j = 0; j <= LAT_SEG; j++) {
        lon = (j / LAT_SEG) * TAU;
        pts.push([cl * Math.sin(lon), Math.sin(lat), cl * Math.cos(lon)]);
      }
      wires.push(pts);
    }

    for (i = 0; i < MERIDIANS; i++) {
      lon = (i / MERIDIANS) * TAU;
      var sn = Math.sin(lon), cn = Math.cos(lon);
      pts = [];
      for (j = 0; j <= LON_SEG; j++) {
        lat = (-82 + (164 * j) / LON_SEG) * RAD;
        cl = Math.cos(lat);
        pts.push([cl * sn, Math.sin(lat), cl * cn]);
      }
      wires.push(pts);
    }
  })();

  /* Edge PoPs. Real coordinates — the shape of the scatter is the
     point, so made-up ones would read as decoration. Bangalore is
     flagged HOME because that is where the person answering this
     contact form actually sits. */
  var POPS = [
    { ll: [ 40.71,  -74.01] },
    { ll: [ 37.77, -122.42] },
    { ll: [ 43.65,  -79.38] },
    { ll: [-23.55,  -46.63] },
    { ll: [ 51.51,   -0.13] },
    { ll: [ 48.86,    2.35] },
    { ll: [ 50.11,    8.68] },
    { ll: [ 52.37,    4.90] },
    { ll: [ 25.20,   55.27] },
    { ll: [ 19.08,   72.88] },
    { ll: [ 12.97,   77.59], home: true, tag: 'BLR' },
    { ll: [  1.35,  103.82] },
    { ll: [ 35.68,  139.69] },
    { ll: [-33.87,  151.21] }
  ];

  POPS.forEach(function (p) {
    var lat = p.ll[0] * RAD, lon = p.ll[1] * RAD;
    var cl = Math.cos(lat);
    // +lon east, so the globe reads the way a map does
    p.v = [cl * Math.sin(lon), Math.sin(lat), cl * Math.cos(lon)];
  });

  /* Five satellites, one per stage a certificate actually passes
     through. These replace the ribbon strips in the reference: an orbit
     is a thing that comes back around on a schedule, which is what a
     cert now does every 47 days.

     `r` is orbit radius in globe radii — the largest one sets how much
     room the canvas needs, so read the note in fit() before raising it
     past 1.50. `inc` is inclination (negative = retrograde-looking),
     `raan` where the orbit crosses the equator, `w` angular speed per
     frame, `t` starting position so they do not launch in a row.

     The ladder was pulled in from 1.24–1.68 so R could go up from 0.22
     to 0.26 of the short side without the outermost orbit reaching any
     further across the canvas than it already did. Same footprint,
     bigger sphere. Every `w` is half what it was, in step with SPIN, so
     the orbits keep their relative rhythm against the globe. */
  var SATS = [
    { label: 'ISSUE',    r: 1.16, inc:  30, raan:  15, w:  0.0021, t: 0.0 },
    { label: 'VALIDATE', r: 1.30, inc: -57, raan: 128, w: -0.00155, t: 2.1 },
    { label: 'DEPLOY',   r: 1.40, inc:  74, raan: 252, w:  0.0012, t: 4.0 },
    { label: 'OCSP',     r: 1.22, inc: -18, raan: 200, w:  0.0018, t: 1.2 },
    { label: 'ROTATE',   r: 1.50, inc:  49, raan:  74, w: -0.00095, t: 5.2 }
  ];

  SATS.forEach(function (s) {
    var i = s.inc * RAD, o = s.raan * RAD;
    // node line, and the in-plane vector perpendicular to it
    s.u = [Math.sin(o), 0, Math.cos(o)];
    s.v = [Math.cos(i) * Math.cos(o), Math.sin(i), -Math.cos(i) * Math.sin(o)];
    s.path = [];
    for (var k = 0; k <= 72; k++) {
      var a = (k / 72) * TAU, ca = Math.cos(a), sa = Math.sin(a);
      s.path.push([
        s.r * (ca * s.u[0] + sa * s.v[0]),
        s.r * (ca * s.u[1] + sa * s.v[1]),
        s.r * (ca * s.u[2] + sa * s.v[2])
      ]);
    }
  });

  /* ==========================================================
     ROTATE + PROJECT. One scratch array, read immediately, so the
     hot loop allocates nothing.
     ========================================================== */
  var S = [0, 0, 0, 0];      // screen x, screen y, world z, perspective k
  var cyaw = 1, syaw = 0, cpit = 1, spit = 0;
  var R = 100, ox = 0, oy = 0;

  function orient() {
    cyaw = Math.cos(yaw); syaw = Math.sin(yaw);
    cpit = Math.cos(pitch); spit = Math.sin(pitch);
  }

  function clampPitch(p) {
    return p < -PITCH_MAX ? -PITCH_MAX : p > PITCH_MAX ? PITCH_MAX : p;
  }

  function project(p) {
    var x = p[0] * cyaw + p[2] * syaw;
    var z0 = -p[0] * syaw + p[2] * cyaw;
    var y = p[1] * cpit - z0 * spit;
    var z = p[1] * spit + z0 * cpit;
    var k = CAM / (CAM - z);
    S[0] = ox + x * R * k;
    S[1] = oy - y * R * k;
    S[2] = z;
    S[3] = k;
    return S;
  }

  // Behind the globe from the camera's side: past the equator of
  // sight and inside the silhouette.
  function hidden(sx, sy, z) {
    if (z >= 0) return false;
    var dx = sx - ox, dy = sy - oy;
    return dx * dx + dy * dy < (R * 0.99) * (R * 0.99);
  }

  /* ==========================================================
     DRAW: globe
     ========================================================== */
  var discR = 1, sphereFill = null, ow = 0, oh = 0;

  function strokeWires(front) {
    octx.beginPath();
    for (var i = 0; i < wires.length; i++) {
      var pts = wires[i];
      var hx = 0, hy = 0, hz = -1, started = false;
      for (var j = 0; j < pts.length; j++) {
        project(pts[j]);
        var x = S[0], y = S[1], z = S[2];
        if (started) {
          var isFront = z > 0 && hz > 0;
          if (isFront === front) {
            octx.moveTo(hx, hy);
            octx.lineTo(x, y);
          }
        }
        hx = x; hy = y; hz = z; started = true;
      }
    }
    octx.stroke();
  }

  function strokeOrbit(sat, front) {
    octx.beginPath();
    var pts = sat.path;
    var hx = 0, hy = 0, hidPrev = true, started = false;
    for (var j = 0; j < pts.length; j++) {
      project(pts[j]);
      var x = S[0], y = S[1];
      var hid = hidden(x, y, S[2]);
      if (started && !hid && !hidPrev) {
        var isFront = S[2] > 0;
        if (isFront === front) {
          octx.moveTo(hx, hy);
          octx.lineTo(x, y);
        }
      }
      hx = x; hy = y; hidPrev = hid; started = true;
    }
    octx.stroke();
  }

  function drawSat(sat, showLabels) {
    var a = Math.cos(sat.t), b = Math.sin(sat.t);
    project([
      sat.r * (a * sat.u[0] + b * sat.v[0]),
      sat.r * (a * sat.u[1] + b * sat.v[1]),
      sat.r * (a * sat.u[2] + b * sat.v[2])
    ]);
    var x = S[0], y = S[1], z = S[2], k = S[3];
    if (hidden(x, y, z)) return;

    // near side reads solid, far side thins out
    var alpha = z > 0 ? 0.9 : 0.34;
    var s = 3.4 * k;

    octx.strokeStyle = rgba(MARBLE, alpha);
    octx.lineWidth = 1;
    octx.beginPath();
    octx.rect(x - s / 2, y - s / 2, s, s);
    octx.moveTo(x - s * 1.9, y); octx.lineTo(x - s * 0.5, y);
    octx.moveTo(x + s * 0.5, y); octx.lineTo(x + s * 1.9, y);
    octx.stroke();

    octx.fillStyle = rgba(TAUPE, alpha * 0.85);
    octx.fillRect(x - s * 1.95, y - s * 0.55, s * 1.4, s * 1.1);
    octx.fillRect(x + s * 0.55, y - s * 0.55, s * 1.4, s * 1.1);

    if (showLabels && z > 0.35) {
      /* Only the near-facing half get named. With five satellites,
         labelling every one that peeks over the limb turns the rim
         into a word cloud; z > 0.35 keeps it to the two or three
         genuinely facing the reader.

         A satellite at the limb sits within a hair of the canvas edge,
         so a label always drawn to the right would run off it. Flip it
         inward once the marker crosses the centre line. */
      var right = x < ox;
      octx.textAlign = right ? 'left' : 'right';
      octx.fillStyle = rgba(SLATE, 0.62 * Math.min(1, (z - 0.35) * 4));
      octx.fillText(sat.label, x + (right ? s * 2.6 : -s * 2.6), y - s * 1.2);
      octx.textAlign = 'left';
    }
  }

  function drawNodes(showLabels) {
    for (var i = 0; i < POPS.length; i++) {
      var p = POPS[i];
      project(p.v);
      if (S[2] <= 0.02) continue;
      var x = S[0], y = S[1], k = S[3];
      var fade = Math.min(1, S[2] * 3.2);   // ease in at the limb

      if (p.home) {
        octx.fillStyle = rgba(TAUPE, 0.95 * fade);
        octx.beginPath();
        octx.arc(x, y, 2.6 * k, 0, TAU);
        octx.fill();
        octx.strokeStyle = rgba(TAUPE, 0.45 * fade);
        octx.lineWidth = 1;
        octx.beginPath();
        octx.arc(x, y, 6.5 * k, 0, TAU);
        octx.stroke();
        if (showLabels && p.tag) {
          octx.fillStyle = rgba(MARBLE, 0.7 * fade);
          octx.fillText(p.tag, x + 10 * k, y - 7 * k);
        }
      } else {
        octx.fillStyle = rgba(MARBLE, 0.8 * fade);
        octx.beginPath();
        octx.arc(x, y, 1.7 * k, 0, TAU);
        octx.fill();
      }
    }
  }

  /* Propagation: a great-circle arc from one PoP to another, bowed
     off the surface, drawn as far as it has travelled. */
  function slerp(a, b, ang, sinAng, t, out) {
    var s1 = Math.sin((1 - t) * ang) / sinAng;
    var s2 = Math.sin(t * ang) / sinAng;
    var lift = 1 + LIFT * Math.sin(Math.PI * t);
    out[0] = (a[0] * s1 + b[0] * s2) * lift;
    out[1] = (a[1] * s1 + b[1] * s2) * lift;
    out[2] = (a[2] * s1 + b[2] * s2) * lift;
    return out;
  }

  var arcScratch = [0, 0, 0];

  function drawPulses(now) {
    for (var i = 0; i < pulses.length; i++) {
      var pu = pulses[i];
      var age = (now - pu.t0) / pu.dur;
      if (age >= 1.35) continue;

      var q = Math.min(1, age);
      var eased = 1 - Math.pow(1 - q, 3);
      var fade = age > 1 ? Math.max(0, 1 - (age - 1) / 0.35) : 1;

      // origin ring
      project(POPS[pu.a].v);
      if (S[2] > 0) {
        octx.strokeStyle = rgba(TAUPE, 0.45 * (1 - q) * fade);
        octx.lineWidth = 1;
        octx.beginPath();
        octx.arc(S[0], S[1], (3 + 16 * q) * S[3], 0, TAU);
        octx.stroke();
      }

      for (var t = 0; t < pu.legs.length; t++) {
        var leg = pu.legs[t];
        var STEPS = 22;
        octx.strokeStyle = rgba(TAUPE, 0.5 * fade);
        octx.lineWidth = 1;
        octx.beginPath();

        var started = false, hx = 0, hy = 0, hidPrev = true;
        var headX = 0, headY = 0, headOn = false;

        for (var s = 0; s <= STEPS; s++) {
          var tt = (s / STEPS) * eased;
          slerp(POPS[pu.a].v, POPS[leg.b].v, leg.ang, leg.sin, tt, arcScratch);
          project(arcScratch);
          var x = S[0], y = S[1];
          var hid = hidden(x, y, S[2]);
          if (started && !hid && !hidPrev) {
            octx.moveTo(hx, hy);
            octx.lineTo(x, y);
          }
          hx = x; hy = y; hidPrev = hid; started = true;
          if (s === STEPS) { headX = x; headY = y; headOn = !hid; }
        }
        octx.stroke();

        if (headOn && q < 1) {
          octx.fillStyle = rgba(MARBLE, 0.95 * fade);
          octx.beginPath();
          octx.arc(headX, headY, 1.9, 0, TAU);
          octx.fill();
        }
      }
    }

    // drop finished pulses
    for (var k = pulses.length - 1; k >= 0; k--) {
      if ((now - pulses[k].t0) / pulses[k].dur >= 1.35) pulses.splice(k, 1);
    }
  }

  function spawnPulse(now) {
    var a = (Math.random() * POPS.length) | 0;
    var legs = [];
    var want = 2 + ((Math.random() * 2) | 0);
    var guard = 0;
    while (legs.length < want && guard++ < 24) {
      var b = (Math.random() * POPS.length) | 0;
      if (b === a) continue;
      var dup = false;
      for (var i = 0; i < legs.length; i++) if (legs[i].b === b) dup = true;
      if (dup) continue;
      var va = POPS[a].v, vb = POPS[b].v;
      var dot = va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2];
      var ang = Math.acos(Math.max(-1, Math.min(1, dot)));
      if (ang < 0.15) continue;
      legs.push({ b: b, ang: ang, sin: Math.sin(ang) });
    }
    if (legs.length) pulses.push({ a: a, legs: legs, t0: now, dur: 1500 + Math.random() * 800 });
  }

  function drawGlobe(now) {
    if (!ow || !oh) return;
    orient();
    octx.clearRect(0, 0, ow, oh);

    var showLabels = ow > 300;
    if (showLabels) {
      // steps with the box, so the labels keep their weight against a
      // sphere that is now 0.26 of the short side rather than 0.22
      octx.font = '400 ' + (ow > 520 ? 12 : ow > 420 ? 11 : 10) +
        'px "LM Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
      if ('letterSpacing' in octx) octx.letterSpacing = '0.14em';
      octx.textBaseline = 'alphabetic';
    }

    // far side of the orbits first — they pass behind the globe
    octx.setLineDash([2.5, 5]);
    octx.lineWidth = 1;
    octx.strokeStyle = rgba(PATINA, 0.55);
    for (var i = 0; i < SATS.length; i++) strokeOrbit(SATS[i], false);
    octx.setLineDash([]);

    // far side of the mesh
    octx.strokeStyle = rgba(PATINA, 0.48);
    strokeWires(false);

    // the body of the sphere, which is what makes the far side read
    // as far rather than as clutter
    if (sphereFill) {
      octx.fillStyle = sphereFill;
      octx.beginPath();
      octx.arc(ox, oy, discR, 0, TAU);
      octx.fill();
    }
    octx.strokeStyle = rgba(PATINA, 0.7);
    octx.lineWidth = 1;
    octx.beginPath();
    octx.arc(ox, oy, discR, 0, TAU);
    octx.stroke();

    // near side
    octx.strokeStyle = rgba(TAUPE, 0.5);
    strokeWires(true);

    drawNodes(showLabels);
    drawPulses(now);

    octx.setLineDash([2.5, 5]);
    octx.strokeStyle = rgba(SLATE, 0.4);
    for (var j = 0; j < SATS.length; j++) strokeOrbit(SATS[j], true);
    octx.setLineDash([]);

    for (var s = 0; s < SATS.length; s++) drawSat(SATS[s], showLabels);
  }

  /* ==========================================================
     DRAW: the star sphere

     The reference does this in three.js: 1667 points scattered
     through a ball, a camera inside the ball, and a per-frame
     rotation on two axes. Same thing here, by hand — rotate each
     point, subtract the camera, divide by depth.

     Two things the GPU did for free and we have to state:

     - Size IS depth. A point's screen radius is its world size over
       its distance, so the near ones are visibly fatter. That is the
       only depth cue in a field of identical dots, so it carries the
       whole illusion.
     - Sub-pixel points. Most of the field lands under one pixel
       across, and three clamps those to a 1px sprite. A 2D canvas
       cannot draw a third of a pixel, so below 1px we hold the
       radius and drop alpha by the area we could not draw. That
       keeps it fine dust instead of a coarse, crawling dot grid.
     ========================================================== */
  var parts = [], sw = 0, sh = 0;
  var starRX = 0, starRY = 0;       // accumulated rotation, radians
  var starProj = 1;                 // px per world unit at unit depth

  /* One fillStyle per frame per bucket instead of one per star: the
     rgba() string building was the single most expensive thing in the
     old draw loop, and at 1667 points it would have been ~1667 string
     allocations a frame. Fourteen shades is past the point the eye can
     separate them in dust this fine. */
  var STAR_BUCKETS = 14;
  var starFill = [], starBins = [];

  (function buildStarShades() {
    for (var i = 0; i < STAR_BUCKETS; i++) {
      // +0.5 so a bucket is drawn at its midpoint, not its floor
      starFill.push(rgba(MARBLE, STAR_ALPHA * (i + 0.5) / STAR_BUCKETS));
      starBins.push([]);
    }
  })();

  function seedStars() {
    /* Fixed count, not per-area like the old flat field. This one is a
       volume around the reader rather than a scatter across the panel,
       so its density is set by the ball, not by the canvas — a wider
       window should see more of the same sphere, not a denser one. */
    var n = 1667;                   // the reference's 5001 floats / 3
    parts.length = 0;
    for (var i = 0; i < n; i++) {
      /* Uniform through the volume: a Gaussian gives an unbiased
         direction, and cbrt(u) counters the r² growth in shell volume
         that would otherwise pile everything against the surface. */
      var x = gauss(), y = gauss(), z = gauss();
      var m = Math.sqrt(x * x + y * y + z * z) || 1;
      var r = STAR_BALL * Math.cbrt(Math.random());
      parts.push({ x: x / m * r, y: y / m * r, z: z / m * r });
    }
    return n;
  }

  // Box-Muller. Only ever called while seeding, so the cost is paid once.
  function gauss() {
    var u = 1 - Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * Math.random());
  }

  function drawStars(now, dt) {
    if (!sw || !sh || !parts.length) return;
    sctx.clearRect(0, 0, sw, sh);

    /* Seconds, because the reference's rates are per second — and
       clamped so a tab that was backgrounded for a minute resumes
       where it left off rather than snapping a third of a turn. */
    var sec = Math.min(0.05, dt / 1000) * autoScale;
    starRX += STAR_RX * sec;
    starRY += STAR_RY * sec;
    if (starRX < -TAU) starRX += TAU; else if (starRX > TAU) starRX -= TAU;
    if (starRY < -TAU) starRY += TAU; else if (starRY > TAU) starRY -= TAU;

    var cx = Math.cos(starRX), sx = Math.sin(starRX);
    var cy = Math.cos(starRY), sy = Math.sin(starRY);
    var cr = Math.cos(STAR_ROLL), sr = Math.sin(STAR_ROLL);

    /* The pointer leans the camera a little instead of shoving the
       points around, which is what the old flat field did. In a real
       volume that reads as the reader moving their head — the near
       stars slide further than the far ones, for free. */
    var ex = ptr.x * STAR_PTR, ey = ptr.y * STAR_PTR;

    var ox2 = sw / 2, oy2 = sh / 2;
    var i, b;

    for (i = 0; i < STAR_BUCKETS; i++) starBins[i].length = 0;

    for (i = 0; i < parts.length; i++) {
      var p = parts[i];

      // rotate: X, then Y, then the fixed roll about the view axis
      var y1 = p.y * cx - p.z * sx;
      var z1 = p.y * sx + p.z * cx;
      var x2 = p.x * cy + z1 * sy;
      var z2 = -p.x * sy + z1 * cy;
      var wx = x2 * cr - y1 * sr;
      var wy = x2 * sr + y1 * cr;

      // camera sits inside the ball, looking back down -Z
      var d = STAR_CAM - z2;
      if (d < STAR_NEAR) continue;

      var inv = starProj / d;
      var px = ox2 + (wx - ex) * inv;
      var py = oy2 - (wy - ey) * inv;
      if (px < -4 || px > sw + 4 || py < -4 || py > sh + 4) continue;

      var rad = STAR_SIZE * starProj / d;
      var a = STAR_ALPHA;
      if (rad > STAR_MAX) rad = STAR_MAX;
      else if (rad < 1) { a *= rad * rad; rad = 0.5; }

      b = (a / STAR_ALPHA * STAR_BUCKETS) | 0;
      if (b < 0) b = 0; else if (b >= STAR_BUCKETS) b = STAR_BUCKETS - 1;
      starBins[b].push(px, py, rad);
    }

    for (b = 0; b < STAR_BUCKETS; b++) {
      var bin = starBins[b];
      if (!bin.length) continue;
      sctx.fillStyle = starFill[b];
      sctx.beginPath();
      for (i = 0; i < bin.length; i += 3) {
        sctx.moveTo(bin[i] + bin[i + 2], bin[i + 1]);
        sctx.arc(bin[i], bin[i + 1], bin[i + 2], 0, TAU);
      }
      sctx.fill();
    }
  }

  /* ==========================================================
     SIZING
     ========================================================== */
  var dpr = 1;

  function fit() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    var sr = starCv.getBoundingClientRect();
    sw = sr.width; sh = sr.height;
    starCv.width  = Math.max(1, Math.round(sw * dpr));
    starCv.height = Math.max(1, Math.round(sh * dpr));
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    /* Focal length in px for the star camera: half the canvas height
       over tan(half the vertical fov), which is what a perspective
       camera reduces to once the aspect is handled by using the same
       scale on both axes. Recomputed here because it is the only part
       of the star field that depends on the canvas size at all. */
    starProj = (sh / 2) / Math.tan(STAR_FOV * RAD / 2);

    var orr = orbCv.getBoundingClientRect();
    ow = orr.width; oh = orr.height;
    orbCv.width  = Math.max(1, Math.round(ow * dpr));
    orbCv.height = Math.max(1, Math.round(oh * dpr));
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ox = ow / 2;
    oy = oh / 2;
    /* Sizing is set by the widest orbit, not by the sphere, and the
       perspective divide moves where that orbit actually peaks: under
       CAM = 3 an orbit of radius r reaches 3r/sqrt(9 - r*r) globe-radii
       from centre, and it gets there OFF-axis, not at 90 degrees. The
       outermost at 1.50 peaks at 1.7321 R, 60 degrees round.

       At R = 0.26 that lands at 0.450 of the short side — 90% of the
       half-width, the same footprint the old 0.22 / 1.68 pair had. The
       remaining 10% is label margin, and labels flip inward past the
       centre line so they never need a whole word of it.

       Raising R further means pulling the 1.50 orbit in to match; the
       two numbers move together or the orbit clips. */
    R = Math.min(ow, oh) * 0.26;
    discR = R * 1.0607;   // silhouette of a unit sphere at CAM = 3

    sphereFill = octx.createRadialGradient(
      ox - R * 0.34, oy - R * 0.4, R * 0.08,
      ox, oy, discR
    );
    sphereFill.addColorStop(0, rgba(TAUPE, 0.13));
    sphereFill.addColorStop(0.5, rgba(VOID, 0.6));
    sphereFill.addColorStop(1, rgba(VOID, 0.82));
  }

  /* ==========================================================
     INPUT
     ========================================================== */
  section.addEventListener('pointermove', function (e) {
    var r = section.getBoundingClientRect();
    ptr.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ptr.y = ((e.clientY - r.top) / r.height) * 2 - 1;
    if (!calm && !claimed) pitchTo = 0.38 - ptr.y * 0.12;
  }, { passive: true });

  orbCv.addEventListener('pointerdown', function (e) {
    dragging = true;
    claimed  = true;
    lastX = e.clientX;
    lastY = e.clientY;
    yawVel = 0;
    pitchVel = 0;
    if (orbCv.setPointerCapture) orbCv.setPointerCapture(e.pointerId);
  });

  orbCv.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    var dx = e.clientX - lastX;
    var dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    /* Horizontal is unbounded — yaw wraps, so the globe turns a full
       360 and keeps going in either direction. Vertical is clamped
       just short of the poles: past ~83 degrees the up vector flips
       and the whole thing tumbles, which reads as a glitch rather
       than as a control. */
    yaw += dx * DRAG_K;
    yawVel = dx * DRAG_K;

    pitch = clampPitch(pitch + dy * DRAG_K);
    pitchVel = dy * DRAG_K;
    pitchTo = pitch;
  });

  function release() { dragging = false; }
  orbCv.addEventListener('pointerup', release);
  orbCv.addEventListener('pointercancel', release);
  window.addEventListener('blur', release);

  // Same control from the keyboard, since the canvas is focusable.
  orbCv.addEventListener('keydown', function (e) {
    var k = e.key;
    if (k === 'ArrowLeft')       { yawVel = -0.05; claimed = true; e.preventDefault(); }
    else if (k === 'ArrowRight') { yawVel =  0.05; claimed = true; e.preventDefault(); }
    else if (k === 'ArrowUp')    { pitchVel = -0.04; claimed = true; e.preventDefault(); }
    else if (k === 'ArrowDown')  { pitchVel =  0.04; claimed = true; e.preventDefault(); }
    else if (k === 'Home') {
      // a way back to the default framing once you have spun it around
      yaw = -0.55; pitch = 0.38; pitchTo = 0.38;
      yawVel = 0; pitchVel = 0; claimed = false;
      e.preventDefault();
    }
  });

  /* ==========================================================
     LOOP
     ========================================================== */
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
    }, { rootMargin: '18% 0px' }).observe(section);
  }

  var last = 0;

  function frame(now) {
    if (visible) {
      var dt = last ? Math.min(64, now - last) : 16;
      last = now;
      /* Everything below is authored per-60fps-frame, so scale by real
         elapsed time — otherwise the globe spins twice as fast on a
         120Hz display as it does on a 60Hz one. */
      var f = dt / 16.667;

      /* Ambient motion is scaled, not gated. Under reduced motion
         autoScale drops it to CALM_SCALE rather than to nothing —
         see the note on `calm` at the top. */
      var af = f * autoScale;
      if (!dragging) yaw += SPIN * af;
      // the satellites keep station whether or not anyone is watching
      for (var i = 0; i < SATS.length; i++) {
        SATS[i].t += SATS[i].w * af;
        if (SATS[i].t > TAU) SATS[i].t -= TAU;
        else if (SATS[i].t < 0) SATS[i].t += TAU;
      }

      yaw += yawVel * f;
      yawVel *= Math.pow(FRICTION, f);
      if (Math.abs(yawVel) < 0.00002) yawVel = 0;
      // keep yaw in one turn so it never drifts into float mush
      if (yaw > TAU) yaw -= TAU; else if (yaw < -TAU) yaw += TAU;

      if (pitchVel) {
        pitch = clampPitch(pitch + pitchVel * f);
        pitchTo = pitch;
        pitchVel *= Math.pow(FRICTION, f);
        if (Math.abs(pitchVel) < 0.00002) pitchVel = 0;
      } else if (!dragging) {
        pitch = clampPitch(pitch + (pitchTo - pitch) * 0.06 * f);
      }

      if (!calm) {
        nextPulse -= dt;
        if (nextPulse <= 0) {
          spawnPulse(now);
          nextPulse = 1400 + Math.random() * 1600;
        }
      }

      drawStars(now, dt);
      drawGlobe(now);
    } else {
      last = 0;
    }
    requestAnimationFrame(frame);
  }

  var rt;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () {
      /* No reseed. Star positions are in world units, not pixels, so
         a resize only changes the projection — reseeding would deal a
         brand new sky every time a phone rotated. */
      fit();
      drawStars(performance.now(), 16.667);
      drawGlobe(performance.now());
    }, 140);
  });

  fit();
  var starCount = seedStars();
  drawStars(performance.now(), 16.667);
  drawGlobe(performance.now());
  requestAnimationFrame(frame);

  /* `mode` no longer has a STATIC state: reduced motion slows ambient
     motion to CALM_SCALE instead of stopping it, so both modes drift.
     The pace is printed so a "nothing is moving" report can be checked
     against it in one line. */
  console.log(
    '[globe] mode:', calm ? 'CALM (reduced-motion, ' + CALM_SCALE + 'x pace)' : 'LIVE (1x)',
    '| spin:', SPIN,
    '| particles:', starCount,
    '| sats:', SATS.length,
    '| orb:', Math.round(ow) + 'x' + Math.round(oh),
    '| dpr:', dpr
  );

  /* The commonest way this ends up invisible is a canvas with no
     layout box — an absolutely positioned parent that never got a
     size, or aspect-ratio unsupported. That looks exactly like a
     broken script from the outside, so name it. */
  if (ow < 8 || oh < 8) {
    console.warn('[globe] #orbCanvas measured ' + Math.round(ow) + 'x' + Math.round(oh) +
                 ' — no layout box, so nothing can draw.');
  }
  if (sw < 8 || sh < 8) {
    console.warn('[globe] #contactStars measured ' + Math.round(sw) + 'x' + Math.round(sh) +
                 ' — the particle field has no layout box.');
  }
})();
