'use strict';
// A reloaded Gemini conversation shows its composer before the earlier turns
// load. A question sent in that gap is answered without the earlier context.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const configSource = fs.readFileSync(path.join(__dirname, '../content-scripts/platforms-config.js'), 'utf8');
const coreSource = fs.readFileSync(path.join(__dirname, '../content-scripts/injection-core.js'), 'utf8');

function geminiConfig(pathname, turns) {
  const window = {};
  vm.runInNewContext(configSource, {
    window, URL, console: { log() {} },
    location: { href: 'https://gemini.google.com' + pathname, pathname },
    document: { querySelector: selector => (selector.includes('user-query') && turns ? {} : null), querySelectorAll: () => [] }
  });
  return window.PLATFORM_CONFIGS.gemini;
}

function core() {
  const window = { postMessage() {} }; window.parent = window;
  vm.runInNewContext(coreSource, { window, console: { log() {} } });
  return window.InjectionCore;
}

test('Gemini: a saved conversation is not ready to send until its earlier turns are present', () => {
  assert.equal(geminiConfig('/app/ded2efe9643f1aad', 0).isConversationHydrated(), false);
  assert.equal(geminiConfig('/app/ded2efe9643f1aad', 3).isConversationHydrated(), true);
});

test('Gemini: a new chat has no earlier turns to wait for', () => {
  assert.equal(geminiConfig('/app', 0).isConversationHydrated(), true);
  assert.equal(geminiConfig('/app/', 0).isConversationHydrated(), true);
});

test('send waits for conversation hydration, but not forever', () => {
  const c = core();
  assert.equal(c.isWaitingForConversation({ isConversationHydrated: () => false }, 0), true);
  assert.equal(c.isWaitingForConversation({ isConversationHydrated: () => true }, 0), false);
  // A conversation that really is empty must not block sending indefinitely.
  assert.equal(c.isWaitingForConversation({ isConversationHydrated: () => false }, 10000), false);
  // Providers without the check, or with a throwing check, are unaffected.
  assert.equal(c.isWaitingForConversation({}, 0), false);
  assert.equal(c.isWaitingForConversation({ isConversationHydrated() { throw new Error('x'); } }, 0), false);
});
