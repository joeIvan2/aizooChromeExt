'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const popupSource = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
const dragStart = popupSource.indexOf('  // --- Draggable Input Section Logic ---');
const dragEnd = popupSource.indexOf('  // --- 懸浮面板最小化與還原邏輯 ---', dragStart);
assert.ok(dragStart >= 0 && dragEnd > dragStart, 'test must execute the real drag setup');
const dragSource = popupSource.slice(dragStart, dragEnd);

function loadInputDrag({ minimized = false } = {}) {
  const listeners = new Map();
  const stored = new Map();
  const captures = new Set();
  const classes = new Set(minimized ? ['minimized'] : []);
  const calls = { capture: 0, release: 0, restore: 0, position: 0 };
  const panel = {
    style: {},
    classList: { contains: name => classes.has(name) },
    offsetWidth: 480,
    offsetHeight: 180,
    get offsetLeft() { return Number.parseFloat(this.style.left) || 100; },
    get offsetTop() { return Number.parseFloat(this.style.top) || 120; },
    getBoundingClientRect: () => ({ left: 100, top: 120, width: 480, height: 180 }),
    contains: node => node === panel || node?.insidePanel === true,
    addEventListener: (type, callback) => listeners.set(type, callback),
    setPointerCapture(id) { calls.capture++; captures.add(id); },
    hasPointerCapture: id => captures.has(id),
    releasePointerCapture(id) { calls.release++; captures.delete(id); }
  };
  vm.runInNewContext(dragSource, {
    console,
    document: { querySelector: () => panel },
    window: { innerWidth: 1000, innerHeight: 800, addEventListener() {} },
    localStorage: {
      getItem: key => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
      removeItem: key => stored.delete(key)
    },
    requestAnimationFrame: callback => callback(),
    positionSessionSwitcher() { calls.position++; },
    restoreInputSection() { calls.restore++; classes.delete('minimized'); }
  }, { filename: 'popup-input-drag.js' });

  function dispatch(type, target, extra = {}) {
    const event = {
      target, button: 0, pointerId: 1, clientX: 120, clientY: 140,
      prevented: false,
      preventDefault() { this.prevented = true; },
      stopPropagation() { throw new Error('drag must not intercept control propagation'); },
      ...extra
    };
    listeners.get(type)(event);
    return event;
  }
  return { panel, calls, stored, dispatch };
}

// closest() represents the browser's ancestor lookup; actual SVG hit-testing is
// also checked in Chrome. Keep the native selector contract explicit here.
function controlTarget(tagName, controlTag = 'button') {
  const control = { tagName: controlTag.toUpperCase(), insidePanel: true };
  return {
    tagName,
    closest(selector) {
      assert.ok(selector.split(',').map(value => value.trim()).includes(controlTag));
      return control;
    }
  };
}

for (const tagName of ['svg', 'path', 'circle', 'line', 'rect', 'polyline', 'SPAN']) {
  test(`pressing a button's ${tagName} descendant never captures the pointer`, () => {
    const { panel, calls, stored, dispatch } = loadInputDrag();
    const target = controlTarget(tagName);
    for (let press = 0; press < 5; press++) {
      assert.equal(dispatch('pointerdown', target).prevented, false);
      dispatch('pointermove', target, { clientX: 180, clientY: 200 });
      dispatch('pointerup', target);
    }
    assert.equal(calls.capture, 0, 'pointer capture would retarget the click away from the button');
    assert.equal(calls.position, 0);
    assert.equal(stored.size, 0, 'button presses must not persist a drag position');
    assert.deepEqual(panel.style, {});
  });
}

test('button edges and native form controls remain excluded from dragging', () => {
  for (const tag of ['button', 'textarea', 'input', 'select']) {
    const { calls, dispatch } = loadInputDrag();
    const target = controlTarget(tag.toUpperCase(), tag);
    dispatch('pointerdown', target);
    dispatch('pointerup', target);
    assert.equal(calls.capture, 0, tag);
  }
});

test('links, editable content and custom buttons are excluded with their descendants', () => {
  for (const selector of ['a[href]', '[contenteditable]:not([contenteditable="false"])', '[role="button"]']) {
    const { calls, dispatch } = loadInputDrag();
    const target = controlTarget('SPAN', selector);
    dispatch('pointerdown', target);
    dispatch('pointerup', target);
    assert.equal(calls.capture, 0, selector);
  }
});

test('non-interactive padding still captures, drags, releases and persists its position', () => {
  const { panel, calls, stored, dispatch } = loadInputDrag();
  const padding = { tagName: 'DIV', closest: () => null };
  dispatch('pointerdown', padding);
  assert.equal(calls.capture, 1);
  assert.equal(dispatch('pointermove', padding, { clientX: 123, clientY: 142 }).prevented, false);
  assert.equal(panel.style.left, '100px');
  assert.equal(panel.style.top, '120px');
  assert.equal(dispatch('pointermove', padding, { clientX: 150, clientY: 170 }).prevented, true);
  assert.equal(panel.style.left, '130px');
  assert.equal(panel.style.top, '150px');
  dispatch('pointerup', padding);
  assert.equal(calls.release, 1);
  assert.deepEqual(JSON.parse(stored.get('ai-chat-input-pos')), { left: '130px', top: '150px' });
});

test('padding drag is still clamped inside the viewport', () => {
  const { panel, dispatch } = loadInputDrag();
  const padding = { tagName: 'DIV', closest: () => null };
  dispatch('pointerdown', padding);
  dispatch('pointermove', padding, { clientX: 9999, clientY: 9999 });
  assert.equal(panel.style.left, '520px');
  assert.equal(panel.style.top, '620px');
  dispatch('pointermove', padding, { clientX: -9999, clientY: -9999 });
  assert.equal(panel.style.left, '0px');
  assert.equal(panel.style.top, '0px');
  dispatch('pointerup', padding);
});

test('minimized panel still supports a stationary press to restore', () => {
  const { panel, calls, dispatch } = loadInputDrag({ minimized: true });
  const target = { tagName: 'DIV', closest: () => panel };
  dispatch('pointerdown', target);
  dispatch('pointerup', target);
  assert.equal(calls.capture, 1);
  assert.equal(calls.release, 1);
  assert.equal(calls.restore, 1);
});

test('dragging the minimized panel does not restore it', () => {
  const { panel, calls, dispatch } = loadInputDrag({ minimized: true });
  const target = { tagName: 'DIV', closest: () => panel };
  dispatch('pointerdown', target);
  dispatch('pointermove', target, { clientX: 150, clientY: 170 });
  dispatch('pointerup', target);
  assert.equal(calls.release, 1);
  assert.equal(calls.restore, 0);
  assert.equal(panel.classList.contains('minimized'), true);
});

test('right and middle mouse buttons never start a drag', () => {
  for (const button of [1, 2]) {
    const { calls, dispatch } = loadInputDrag();
    dispatch('pointerdown', { tagName: 'DIV' }, { button });
    assert.equal(calls.capture, 0);
  }
});

test('pointer cancellation ends a real drag and later control presses remain independent', () => {
  const { panel, calls, dispatch } = loadInputDrag();
  const padding = { tagName: 'DIV', closest: () => null };
  dispatch('pointerdown', padding);
  dispatch('pointermove', padding, { clientX: 150, clientY: 170 });
  dispatch('pointercancel', padding);
  assert.equal(calls.release, 1);
  dispatch('pointerdown', controlTarget('path'));
  dispatch('pointermove', padding, { clientX: 300, clientY: 300 });
  dispatch('pointerup', padding);
  assert.equal(calls.capture, 1);
  assert.equal(panel.style.left, '130px');
  assert.equal(panel.style.top, '150px');
});
