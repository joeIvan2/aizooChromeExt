// Meta's initial SSR reveal can wait forever for rAF in a covered window.
// Give only that bootstrap queue a cancellable timer race. No visibility / UA spoofing,
// private React calls, network sends or challenge interaction.
(function() {
  'use strict';
  if (!['meta.ai', 'www.meta.ai'].includes(location.hostname) || window.self === window.top) return;
  const nativeRAF = window.requestAnimationFrame, nativeCancel = window.cancelAnimationFrame;
  if (typeof nativeRAF !== 'function' || typeof nativeCancel !== 'function') return;
  const pending = new Map(), deadline = performance.now() + 15000;
  let stopped = false;
  function stop() {
    stopped = true;
    if (window.requestAnimationFrame === schedule) window.requestAnimationFrame = nativeRAF;
    // Retain our cancel wrapper until outstanding raced callbacks are settled.
    if (!pending.size && window.cancelAnimationFrame === cancel) window.cancelAnimationFrame = nativeCancel;
  }
  function ready() {
    if (performance.now() >= deadline || document.querySelector('#challenge-stage, iframe[src*="challenges.cloudflare.com"], iframe[src*="hcaptcha.com"]')) return true;
    const mounted = Array.from(document.querySelectorAll('[data-testid="composer-input"]')).some(el => { const rect = el.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; });
    return !!(mounted && document.body?.offsetHeight > 0 && (!Array.isArray(window.$RB) || !window.$RB.length));
  }
  function schedule(callback) {
    if (stopped || ready()) { stop(); return Reflect.apply(nativeRAF, window, [callback]); }
    if (document.visibilityState !== 'hidden' || !Array.isArray(window.$RB) || !window.$RB.length) return Reflect.apply(nativeRAF, window, [callback]);
    let id;
    const run = time => {
      const entry = pending.get(id); if (!entry) return;
      pending.delete(id); clearTimeout(entry.timer); Reflect.apply(nativeCancel, window, [id]);
      try { callback(time); } finally { if (ready() || stopped) stop(); }
    };
    id = Reflect.apply(nativeRAF, window, [run]);
    const timer = setTimeout(() => run(performance.now()), 120);
    pending.set(id, { timer });
    return id;
  }
  function cancel(id) {
    const entry = pending.get(id);
    if (entry) { clearTimeout(entry.timer); pending.delete(id); }
    Reflect.apply(nativeCancel, window, [id]);
    if (stopped) stop();
  }
  window.requestAnimationFrame = schedule; window.cancelAnimationFrame = cancel;
  setTimeout(stop, 15000);
  window.addEventListener('pagehide', () => { for (const id of [...pending.keys()]) cancel(id); stop(); }, { once: true });
})();
