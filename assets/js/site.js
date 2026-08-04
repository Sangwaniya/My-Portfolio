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

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-in');
      io.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

  Array.prototype.forEach.call(targets, function (el) { io.observe(el); });
})();
