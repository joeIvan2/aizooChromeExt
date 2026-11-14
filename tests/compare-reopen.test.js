'use strict';
// Closing and reopening Smart Compare after an answer arrived showed
// "Platform is not ready yet": the history request was refused because the
// network source still held the finished answer.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../popup.js'), 'utf8');
function extract(name) {
  const start = source.indexOf('function ' + name + '(');
  const end = /\r?\n}\r?\n/.exec(source.slice(start));
  return source.slice(start, start + end.index + end[0].length);
}
function setup({ delivering, watch }) {
  const posted = [];
  const context = {
    Date, posted,
    isPlatformEnabled: () => true,
    providerResources: { state: () => ({ loaded: true }) },
    providerRuntime: { gemini: { delivering, retainHistory: false } },
    compareWatchState: watch ? { gemini: watch } : {},
    compareLatestHistories: {}, compareHistoryRequestState: {}, compareHistoryRequestId: 0, compareNavigationEpoch: 0,
    COMPARE_HISTORY_REQUEST_STALE_MS: 1000, COMPARE_HISTORY_REQUEST_MIN_GAP_MS: 1000, COMPARE_HISTORY_SCRAPE_TIMEOUT_MS: 1000,
    iframes: { gemini: { contentWindow: { postMessage: message => posted.push(message) } } }
  };
  vm.runInNewContext(extract('isNetworkAnswerInProgress') + extract('requestPlatformHistory'), context);
  return context;
}

test('reopening after a finished network answer can load the conversation again', () => {
  const context = setup({ delivering: true, watch: null });
  assert.equal(context.requestPlatformHistory('gemini'), true);
  assert.equal(context.posted.length, 1);
  const done = setup({ delivering: true, watch: { complete: true } });
  assert.equal(done.requestPlatformHistory('gemini'), true);
});

test('while a network answer is still streaming the DOM is not read', () => {
  const context = setup({ delivering: true, watch: { complete: false } });
  assert.equal(context.requestPlatformHistory('gemini'), false);
  assert.equal(context.posted.length, 0);
});
