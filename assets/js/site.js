/* ============================================================
   site.js — everything below the hero.
   Scroll reveals, and the X.509 validity meters that compute
   their own geometry from real ISO dates so the active bar keeps
   growing on its own after this page is built.
   ============================================================ */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- validity meters ---------- */
  var TIMELINE_START = Date.parse('2021-01-01');

  function fmtSpan(ms) {
    var days = Math.round(ms / 86400000);
    var years = Math.floor(days / 365);
    var months = Math.round((days % 365) / 30.44);
    if (months === 12) { years += 1; months = 0; }
    if (years && months) return years + 'y ' + months + 'm';
    if (years) return years + 'y';
    return months + 'm';
  }

  var now = Date.now();
  var timelineEnd = now;
  var span = timelineEnd - TIMELINE_START;

  Array.prototype.forEach.call(document.querySelectorAll('.cert'), function (cert) {
    var from = Date.parse(cert.dataset.from);
    var to = cert.dataset.to ? Date.parse(cert.dataset.to) : now;
    if (isNaN(from)) return;

    var x = ((from - TIMELINE_START) / span) * 100;
    var w = ((to - from) / span) * 100;

    var bar = cert.querySelector('.cert__bar');
    if (bar) {
      bar.style.setProperty('--x', Math.max(0, x).toFixed(2) + '%');
      bar.style.setProperty('--w', Math.max(0.6, Math.min(100 - x, w)).toFixed(2) + '%');
    }

    var len = cert.querySelector('.cert__len');
    if (len) len.textContent = fmtSpan(to - from);
  });

  /* ---------- scroll reveals ---------- */
  var targets = document.querySelectorAll('.reveal');

  if (reduced || !('IntersectionObserver' in window)) {
    Array.prototype.forEach.call(targets, function (el) { el.classList.add('is-in'); });
    return;
  }

  /* Stagger is per *batch*, not per element. Anything crossing the
     threshold in the same callback is one visual group — the three
     cards, the three certs — so they cascade instead of snapping in
     as one slab. A section that arrives alone gets no delay at all,
     which is the point: the rhythm comes from the content, not from
     hard-coded nth-child rules.

     Entries are not handed to us in document order, so sort by
     position first or the cascade runs at random. */
  var STEP = 90;    // ms between siblings
  var CAP  = 360;   // never hold the last item longer than this

  var io = new IntersectionObserver(function (entries) {
    var arriving = entries.filter(function (e) { return e.isIntersecting; });

    arriving.sort(function (a, b) {
      return a.boundingClientRect.top - b.boundingClientRect.top;
    });

    arriving.forEach(function (entry, i) {
      entry.target.style.transitionDelay = Math.min(i * STEP, CAP) + 'ms';
      entry.target.classList.add('is-in');
      io.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

  Array.prototype.forEach.call(targets, function (el) { io.observe(el); });
})();
