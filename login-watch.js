// Sign-in happens in a normal tab. Until it is done (or a time limit passes)
// the provider's session is re-read; when it changes, the embedded page is
// reloaded so it can pick the new session up.
(function(root) {
  'use strict';
  function createLoginWatch(o) {
    const now = o.now || Date.now, setTimer = o.setTimer || ((fn, ms) => setTimeout(fn, ms));
    const intervalMs = o.intervalMs ?? 2000, timeoutMs = o.timeoutMs ?? 5 * 60 * 1000;
    let baseline = null, startedAt = 0, active = false, reloaded = false, loading = false;
    function finish(result) { if (!active) return; active = false; o.done?.(result); }
    function reload() { reloaded = true; loading = true; o.reload(); }
    async function tick() {
      if (!active) return;
      if (now() - startedAt > timeoutMs) return finish('timeout');
      let current = baseline;
      try { current = await o.read(); } catch {}
      if (!active) return;
      if (current !== baseline) { baseline = current; reload(); }
      setTimer(tick, intervalMs);
    }
    return {
      get active() { return active; },
      async start() {
        startedAt = now(); active = true; reloaded = false;
        try { baseline = await o.read(); } catch { baseline = null; }
        setTimer(tick, intervalMs);
      },
      // The embedded page finished loading.
      pageReady() { loading = false; if (active && reloaded && !o.needsLogin()) finish('signed-in'); },
      // The embedded page loaded, signed in or not.
      pageLoaded() { loading = false; },
      // The user came back to the extension: check now instead of waiting.
      returned() { if (active && !loading) reload(); },
      tabClosed() { if (active && !loading) reload(); },
      stop() { active = false; }
    };
  }
  root.AIZooLoginWatch = { createLoginWatch };
  if (typeof module === 'object' && module.exports) module.exports = root.AIZooLoginWatch;
})(typeof window !== 'undefined' ? window : globalThis);
