'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../content-scripts/meta-startup'), 'utf8');
function boot() {
  const rafs = new Map(), timers = new Map(); let seq = 0, composer = false;
  const window = { $RB: [1], requestAnimationFrame(cb) { rafs.set(++seq, cb); return seq; }, cancelAnimationFrame(id) { rafs.delete(id); }, addEventListener() {} };
  window.self = window; window.top = {};
  const native = window.requestAnimationFrame;
  const document = { body: { offsetHeight: 680 }, visibilityState: 'hidden', querySelector: selector => selector.startsWith('[data-testid=') ? { getBoundingClientRect: () => ({ width: 300, height: composer ? 80 : 0 }) } : null, querySelectorAll: () => [{ getBoundingClientRect: () => ({ width: 300, height: composer ? 80 : 0 }) }] };
  vm.runInNewContext(source, { window, location: { hostname: 'www.meta.ai' }, document, performance: { now: () => 100 },
    setTimeout(cb) { timers.set(++seq, cb); return seq; }, clearTimeout(id) { timers.delete(id); } });
  return { window, document, native, rafs, timers, ready: () => { composer = true; } };
}
test('Meta hidden startup rAF runs once and honors cancellation', () => {
  const h = boot(); let calls = 0;
  const id = h.window.requestAnimationFrame(() => calls++);
  h.window.cancelAnimationFrame(id); assert.equal(h.rafs.size, 0); assert.equal(calls, 0);
  h.window.requestAnimationFrame(() => calls++);
  [...h.timers.values()].at(-1)(); for (const cb of h.rafs.values()) cb(); assert.equal(calls, 1);
});
test('Meta restores native scheduling when composer is mounted', () => {
  const h = boot(); h.ready(); h.window.$RB = []; h.window.requestAnimationFrame(() => {});
  assert.equal(h.window.requestAnimationFrame, h.native);
});
test('a hidden SSR composer is not mounted and cannot disable the bootstrap race', () => {
  const h = boot(); h.window.requestAnimationFrame(() => {});
  assert.notEqual(h.window.requestAnimationFrame, h.native);
  assert.equal(h.rafs.size, 1); assert.equal(h.timers.size, 2);
});
test('Meta stops even when its first composer is a hidden SSR duplicate', () => {
  const h = boot(); h.window.$RB = [];
  h.document.querySelectorAll = () => [0, 80].map(height => ({ getBoundingClientRect: () => ({ width: 300, height }) }));
  h.window.requestAnimationFrame(() => {}); assert.equal(h.window.requestAnimationFrame, h.native);
});
test('Meta preserves a later page wrapper while forwarding to native scheduling', () => {
  const h = boot(), bootstrap = h.window.requestAnimationFrame;
  const pageWrapper = callback => bootstrap(callback); h.window.requestAnimationFrame = pageWrapper;
  h.ready(); h.window.$RB = []; h.window.requestAnimationFrame(() => {});
  assert.equal(h.window.requestAnimationFrame, pageWrapper); assert.equal(h.rafs.size, 1); assert.equal(h.timers.size, 1);
});
