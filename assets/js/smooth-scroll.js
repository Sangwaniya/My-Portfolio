/* ============================================================
   smooth-scroll.js — hand-rolled Lenis equivalent.

   Same contract as Lenis: duration 1.2s, exponential ease-out
   1.001 - 2^(-10t) clamped at 1, smooth wheel, touch multiplier
   1.6. Drives the *real* scroll position via scrollTo rather than
   transforming a wrapper, so position:sticky, getBoundingClientRect
   and IntersectionObserver all stay truthful — the hero depends on
   that. One rAF loop, full teardown on destroy, and skipped
   entirely when the system asks for reduced motion.
   ============================================================ */
(function () {
  'use strict';

  var DURATION = 1.2;          // seconds
  var TOUCH_MULTIPLIER = 1.6;
  var WHEEL_MULTIPLIER = 1;

  // Smooth scrolling is momentum the reader didn't ask for, so this
  // layer really does switch off. The hero keeps scrubbing either
  // way — it just tracks native scroll 1:1 instead.
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Public shim so callers don't branch. Replaced below when active.
  window.SmoothScroll = {
    active: false,
    scrollTo: function (target) { nativeScrollTo(target); },
    onScroll: function () {},
    destroy: function () {}
  };

  function resolveTarget(target) {
    var el = typeof target === 'string' ? document.querySelector(target) : target;
    if (typeof target === 'number') return target;
    if (!el) return null;
    return el.getBoundingClientRect().top + window.scrollY;
  }

  function nativeScrollTo(target) {
    var y = resolveTarget(target);
    if (y === null) return;
    window.scrollTo({ top: y, behavior: reduced ? 'auto' : 'smooth' });
  }

  // Anchor links work in both modes.
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    var id = a.getAttribute('href');
    if (!id || id === '#') return;
    var el = document.querySelector(id);
    if (!el) return;
    e.preventDefault();
    window.SmoothScroll.scrollTo(el);
    // Keep the URL and focus honest for keyboard users.
    history.pushState(null, '', id);
    el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
  });

  if (reduced) return; // native scrolling, nothing else to set up

  document.documentElement.classList.add('has-smooth');

  var current = window.scrollY;
  var from = current;
  var to = current;
  var startTime = 0;
  var animating = false;
  var lastSet = current;   // what we last handed to scrollTo
  var rafId = null;
  var touchY = 0;
  var pinching = false;

  function limit() {
    return Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight
    );
  }

  function clampScroll(v) {
    var max = limit();
    return v < 0 ? 0 : v > max ? max : v;
  }

  // The easing the brief specifies, and Lenis's own default.
  function ease(t) {
    return Math.min(1, 1.001 - Math.pow(2, -10 * t));
  }

  function startTo(value) {
    to = clampScroll(value);
    from = current;
    startTime = performance.now();
    animating = true;
  }

  function onWheel(e) {
    if (e.ctrlKey) return;            // pinch-zoom belongs to the browser
    var d = e.deltaY;
    if (e.deltaMode === 1) d *= 16;   // lines
    else if (e.deltaMode === 2) d *= window.innerHeight; // pages
    e.preventDefault();
    startTo(to + d * WHEEL_MULTIPLIER);
  }

  function onTouchStart(e) {
    if (e.touches.length > 1) { pinching = true; return; }
    pinching = false;
    touchY = e.touches[0].clientY;
    // Meet the finger where it is instead of snapping from a stale target.
    to = current;
    from = current;
    animating = false;
  }

  function onTouchMove(e) {
    // Multi-touch is a zoom gesture, not a scroll. Never preventDefault
    // on it — that is how sites break pinch-to-zoom.
    if (e.touches.length > 1) { pinching = true; return; }

    // Coming out of a pinch with a finger still down: touchY is stale,
    // so adopt the current position rather than jumping by the gap.
    if (pinching) {
      pinching = false;
      touchY = e.touches[0].clientY;
      to = current;
      from = current;
      return;
    }

    var y = e.touches[0].clientY;
    var delta = (touchY - y) * TOUCH_MULTIPLIER;
    touchY = y;
    e.preventDefault();
    startTo(to + delta);
  }

  // Scrollbar drag, keyboard, find-in-page: anything that moved the page
  // without going through us. Resync so we never fight the browser.
  function onScrollEvent() {
    if (Math.abs(window.scrollY - lastSet) < 1.5) return;
    current = window.scrollY;
    if (!animating) { to = current; from = current; }
  }

  function onKeyDown(e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
    var vh = window.innerHeight;
    var step = null;
    switch (e.key) {
      case 'ArrowDown':  step = to + 110; break;
      case 'ArrowUp':    step = to - 110; break;
      case 'PageDown':   step = to + vh * 0.9; break;
      case 'PageUp':     step = to - vh * 0.9; break;
      case ' ':          step = to + vh * (e.shiftKey ? -0.9 : 0.9); break;
      case 'Home':       step = 0; break;
      case 'End':        step = limit(); break;
      default: return;
    }
    e.preventDefault();
    startTo(step);
  }

  function frame(now) {
    if (animating) {
      var elapsed = (now - startTime) / 1000;
      var t = Math.min(1, elapsed / DURATION);
      var e = ease(t);
      current = from + (to - from) * e;

      if (t >= 1 || Math.abs(to - current) < 0.05) {
        current = to;
        animating = false;
      }

      lastSet = current;
      window.scrollTo(0, current);
      window.SmoothScroll.onScroll(current);
    }
    rafId = requestAnimationFrame(frame);
  }

  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('scroll', onScrollEvent, { passive: true });
  window.addEventListener('keydown', onKeyDown);
  rafId = requestAnimationFrame(frame);

  window.SmoothScroll = {
    active: true,
    get scroll() { return current; },
    scrollTo: function (target) {
      var y = resolveTarget(target);
      if (y === null) return;
      startTo(y);
    },
    onScroll: function () {},
    destroy: function () {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      window.removeEventListener('wheel', onWheel, { passive: false });
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove, { passive: false });
      window.removeEventListener('scroll', onScrollEvent);
      window.removeEventListener('keydown', onKeyDown);
      document.documentElement.classList.remove('has-smooth');
      this.active = false;
    }
  };

  // A resize can shrink the page under us; stay inside bounds.
  window.addEventListener('resize', function () {
    to = clampScroll(to);
    current = clampScroll(current);
  });
})();
