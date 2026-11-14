'use strict';
// After the extension starts, no provider page is loaded, so the answers view
// had nothing to read. Opening it now loads the providers that have a saved
// conversation; the idle timer releases them again later.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../popup.js'), 'utf8');
function extract(name) {
  const start = source.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, name + ' exists');
  const end = /\r?\n}\r?\n/.exec(source.slice(start));
  return source.slice(start, start + end.index + end[0].length);
}
function setup({ saved = {}, loaded = [], disabled = [], cached = {} } = {}) {
  const used = [], reading = [], timers = [];
  let refreshes = 0;
  const context = {
    used, reading, timers,
    get refreshes() { return refreshes; },
    scheduleCompareOpenRefresh: () => { refreshes += 1; },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); },
    platforms: ['grok', 'gemini', 'claude'],
    defaultUrls: { grok: 'https://grok.com/', gemini: 'https://gemini.google.com/app', claude: 'https://claude.ai/new' },
    localStorage: { getItem: key => saved[key.replace('ai-chat-url-', '')] ?? null },
    normalizePlatformUrl: (platform, url) => url,
    isPlatformEnabled: platform => !disabled.includes(platform),
    providerResources: {
      state: platform => ({ loaded: loaded.includes(platform) }),
      update: (platform, patch) => { if ('reading' in patch) reading.push([platform, patch.reading]); }
    },
    compareLatestHistories: cached,
    useProvider: platform => used.push(platform)
  };
  vm.runInNewContext(extract('loadSavedConversationsForCompare'), context);
  return context;
}

test('providers with a saved conversation are loaded when the answers view opens', () => {
  const context = setup({ saved: { grok: 'https://grok.com/c/abc', gemini: 'https://gemini.google.com/app/123' } });
  context.loadSavedConversationsForCompare();
  assert.deepEqual(context.used, ['grok', 'gemini']);
});

test('a provider with no conversation, or only its home page, stays unloaded', () => {
  const context = setup({ saved: { gemini: 'https://gemini.google.com/app' } });
  context.loadSavedConversationsForCompare();
  assert.deepEqual(context.used, []);
});

test('disabled, already loaded, and already shown providers are left alone', () => {
  const saved = { grok: 'https://grok.com/c/abc', gemini: 'https://gemini.google.com/app/123', claude: 'https://claude.ai/chat/1' };
  const context = setup({ saved, disabled: ['grok'], loaded: ['gemini'], cached: { claude: [{ role: 'user', content: 'hi' }] } });
  context.loadSavedConversationsForCompare();
  assert.deepEqual(context.used, []);
});

// Grok draws only the part of a conversation that is on screen. A hidden page
// has no size, so nothing is drawn and nothing can be read.
test('a provider loaded for the answers view stays drawn until it has been read', () => {
  const context = setup({ saved: { grok: 'https://grok.com/c/abc' } });
  context.loadSavedConversationsForCompare();
  assert.deepEqual(context.reading, [['grok', true]]);
  assert.equal(context.refreshes, 1, 'the conversation is asked for again while the page finishes loading');
  context.timers.forEach(timer => timer.fn());
  assert.deepEqual(context.reading, [['grok', true], ['grok', false]], 'and is hidden again even if nothing could be read');
});

test('nothing is scheduled when no provider had to be loaded', () => {
  const context = setup();
  context.loadSavedConversationsForCompare();
  assert.equal(context.refreshes, 0);
  assert.equal(context.timers.length, 0);
});
