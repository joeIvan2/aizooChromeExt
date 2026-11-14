// Provider documents stay in the existing tab; only unused documents are released.
(function(root) {
  'use strict';
  function createController(providers, options = {}) {
    const now = options.now || Date.now, idleMs = options.idleMs ?? 30 * 60 * 1000;
    const states = Object.fromEntries(providers.map(p => [p, { enabled: false, loaded: false, viewed: false, busy: false, network: false, attention: null, reading: false, lastUsed: now(), suspended: false }]));
    function sync(p) {
      const s = states[p];
      if (!s.enabled && s.loaded) unload(p);
      if (s.enabled && s.viewed && !s.loaded) load(p);
      s.suspended = !!(s.loaded && s.network && !s.viewed && !s.attention && !s.reading);
      options.render?.(p, { ...s });
    }
    function load(p) { const s = states[p]; if (s.loaded || !s.enabled) return; s.loaded = true; s.lastUsed = now(); options.load?.(p); }
    function unload(p) { const s = states[p]; s.loaded = false; s.network = false; s.busy = false; s.attention = null; s.reading = false; options.unload?.(p); }
    return {
      state(p) { return { ...states[p] }; },
      update(p, patch) {
        const s = states[p];
        if (!s) return;
        if ((s.busy && patch.busy === false) || (s.attention && patch.attention === null) || patch.viewed === true) s.lastUsed = now();
        Object.assign(s, patch); sync(p);
      },
      use(p) { const s = states[p]; if (!s?.enabled) return false; s.lastUsed = now(); load(p); sync(p); return true; },
      release(p) {
        const s = states[p]; if (!s?.loaded || s.viewed || s.busy || s.attention) return false;
        unload(p); sync(p); return true;
      },
      sweep() {
        providers.forEach(p => {
          const s = states[p];
          if (s.loaded && s.enabled && !s.viewed && !s.busy && !s.attention && now() - s.lastUsed >= idleMs) { unload(p); sync(p); }
        });
      }
    };
  }
  root.AIZooProviderResources = { createController };
  if (typeof module === 'object' && module.exports) module.exports = root.AIZooProviderResources;
})(typeof window !== 'undefined' ? window : globalThis);
