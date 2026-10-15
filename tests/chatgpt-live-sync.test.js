'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const utils = require('../content-scripts/shared-utils.js');
const root = path.resolve(__dirname, '..');
const coreSource = fs.readFileSync(path.join(root, 'content-scripts/injection-core.js'), 'utf8');
const popupSource = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const silentConsole = { log() {}, warn() {}, error() {} };

function responseHarness(question = 'current question', baselineOccurrences = 0) {
  let now = 1000;
  let history = [{ role: 'user', content: question }];
  let generating = true;
  const messages = [];
  const intervals = new Map();
  const observers = [];
  const window = { AIZooUtils: utils, postMessage: data => messages.push(data) };
  window.parent = window;
  vm.runInNewContext(coreSource, {
    window, document: { body: {} }, console: silentConsole,
    Date: { now: () => now },
    setInterval(callback) { const id = intervals.size + 1; intervals.set(id, callback); return id; },
    clearInterval: id => intervals.delete(id),
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
      observe() {}
      disconnect() { this.disconnected = true; }
    }
  });
  const core = window.InjectionCore;
  const config = {
    id: 'chatgpt', responseObserveMutations: true,
    responseStablePollsRequired: 8, responseQuietPeriodMs: 30000,
    scrapeHistory: () => history, detectGenerating: () => generating
  };
  core.watchResponseLifecycle(config, question, { submissionId: 'current', baselineOccurrences });
  return {
    core, window, config, messages, intervals, observers,
    setHistory: value => { history = value; },
    setGenerating: value => { generating = value; },
    advance: ms => { now += ms; },
    mutate: () => observers.at(-1).callback(),
    tick(ms = 1000) { now += ms; Array.from(intervals.values()).forEach(callback => callback()); }
  };
}

test('GPT pushes changed answer text while interval timers and popup history polls are idle', () => {
  const h = responseHarness();
  h.mutate();
  assert.equal(h.messages.at(-1).type, 'AI_RESPONSE_START');
  h.setHistory([{ role: 'user', content: 'current question' }, { role: 'assistant', content: 'first words' }]);
  h.mutate();
  const update = h.messages.at(-1);
  assert.equal(update.type, 'AI_RESPONSE_UPDATE');
  assert.equal(update.submissionId, 'current');
  assert.equal(update.history.at(-1).content, 'first words');
  assert.equal(update.isGenerating, true);
  h.setHistory([{ role: 'user', content: 'current question' }, { role: 'assistant', content: 'full answer' }]);
  h.setGenerating(false);
  h.mutate();
  assert.equal(h.messages.at(-1).history.at(-1).content, 'full answer');
  assert.equal(h.messages.at(-1).isGenerating, false);
  assert.equal(h.window.__aiResponseLifecycleWatchers.chatgpt.completedNotified, false);
  assert.equal(h.messages.some(m => m.type === 'AI_RESPONSE_RECEIVED'), false);
});

test('rapid DOM changes do not bypass GPT quiet-time and stable-poll completion checks', () => {
  const h = responseHarness();
  h.mutate();
  h.advance(40000);
  h.setHistory([{ role: 'user', content: 'current question' }, { role: 'assistant', content: 'Late final answer.' }]);
  h.setGenerating(false);
  h.mutate();
  for (let i = 0; i < 100; i++) h.mutate();
  for (let i = 0; i < 8; i++) h.tick();
  assert.equal(h.messages.some(m => m.type === 'AI_RESPONSE_RECEIVED'), false);
  h.advance(22000);
  for (let i = 0; i < 100; i++) h.mutate();
  assert.equal(h.messages.at(-1).type, 'AI_RESPONSE_RECEIVED');
  assert.equal(h.intervals.size, 0);
  assert.equal(h.observers.at(-1).disconnected, true);

  const noPolls = responseHarness();
  noPolls.setHistory([{ role: 'user', content: 'current question' }, { role: 'assistant', content: 'Final answer.' }]);
  noPolls.setGenerating(false);
  noPolls.mutate();
  noPolls.advance(40000);
  for (let i = 0; i < 100; i++) noPolls.mutate();
  assert.equal(noPolls.messages.some(m => m.type === 'AI_RESPONSE_RECEIVED'), false);
});

test('GPT update events bind to the repeated prompt after its submission boundary', () => {
  const h = responseHarness('same question', 1);
  h.setHistory([{ role: 'user', content: 'same question' }, { role: 'assistant', content: 'old answer' }]);
  h.setGenerating(false);
  h.mutate();
  assert.equal(h.messages.length, 0);
  h.setHistory([
    { role: 'user', content: 'same question' }, { role: 'assistant', content: 'old answer' },
    { role: 'user', content: 'same question' }
  ]);
  h.mutate();
  h.setHistory([
    { role: 'user', content: 'same question' }, { role: 'assistant', content: 'old answer' },
    { role: 'user', content: 'same question' }, { role: 'assistant', content: 'new answer' }
  ]);
  h.mutate();
  assert.equal(h.messages.at(-1).type, 'AI_RESPONSE_UPDATE');
  assert.equal(h.messages.at(-1).baselineOccurrences, 1);
  assert.equal(utils.findAnswerAfterQuestion(h.messages.at(-1).history, 'same question', 1).answer.content, 'new answer');
});

test('cancelled GPT observers cannot publish delayed callbacks into a new conversation', () => {
  const h = responseHarness();
  h.mutate();
  const before = h.messages.length;
  const observer = h.observers.at(-1);
  h.core.cancelOperations(h.config);
  assert.equal(observer.disconnected, true);
  assert.equal(h.intervals.size, 0);
  h.setHistory([{ role: 'user', content: 'current question' }, { role: 'assistant', content: 'stale answer' }]);
  observer.callback();
  assert.equal(h.messages.length, before);
});

function popupFunction(name) {
  const start = popupSource.indexOf(`function ${name}(`);
  const end = popupSource.indexOf('\nfunction ', start + 1);
  assert.ok(start >= 0 && end > start);
  return popupSource.slice(start, end);
}

test('Smart Compare renders current GPT updates before completion and rejects stale submissions', () => {
  const state = { question: 'current question', sent: true, baselineOccurrences: 0, startedAt: 1000, stableCount: 0 };
  let rendered;
  const context = {
    Date: { now: () => 2000 }, console: silentConsole,
    window: { AIZooUtils: utils },
    activeSubmissionIds: { chatgpt: 'current' }, compareWatchState: { chatgpt: state },
    findQuestionAnswer: utils.findAnswerAfterQuestion,
    isLikelyIncompleteAssistantAnswer: () => false,
    isPlatformEnabled: () => true,
    COMPARE_STABLE_POLLS_REQUIRED_BY_PLATFORM: { chatgpt: 8 }, COMPARE_STABLE_POLLS_REQUIRED: 3,
    COMPARE_QUIET_PERIOD_MS_BY_PLATFORM: { chatgpt: 30000 }, COMPARE_QUIET_PERIOD_MS: 6000,
    renderTrackedCompareHistory(_platform, messages, pending = '') { rendered = { messages, pending }; },
    completeComparePlatform() { assert.fail('A text update must not complete the response'); },
    updateStatus() {}, markComparePlatformPending() {}, ensureComparePollTimer() {},
    t: (_key, fallback) => fallback
  };
  const typesStart = popupSource.indexOf('const SUBMISSION_LIFECYCLE_TYPES');
  const typesEnd = popupSource.indexOf(']);', typesStart) + 3;
  vm.createContext(context);
  vm.runInContext([
    popupSource.slice(typesStart, typesEnd),
    ...['isCurrentSubmissionEvent', 'syncSubmissionBoundary', 'updateCompareFromHistory', 'handleMessage'].map(popupFunction)
  ].join('\n'), context);
  const message = {
    type: 'AI_RESPONSE_UPDATE', source: 'content-script', platform: 'chatgpt',
    submissionId: 'current', baselineOccurrences: 0, isGenerating: true,
    history: [{ role: 'user', content: 'current question' }, { role: 'assistant', content: 'Visible partial answer.' }]
  };
  context.handleMessage({ data: { ...message, submissionId: 'previous' } });
  assert.equal(rendered, undefined);
  context.handleMessage({ data: message });
  assert.equal(rendered.messages.at(-1).content, 'Visible partial answer.');
  assert.equal(rendered.pending, 'Responding...');
  assert.equal(state.complete, false);

  context.handleMessage({ data: { ...message, isGenerating: false } });
  assert.equal(rendered.messages.at(-1).content, 'Visible partial answer.');
  assert.equal(rendered.pending, '');
  assert.equal(state.complete, false, 'Quiet-time confirmation continues without a responding placeholder');

  context.handleMessage({ data: { ...message, history: [message.history[0], { role: 'assistant', content: 'Resumed final answer.' }] } });
  assert.equal(rendered.messages.at(-1).content, 'Resumed final answer.');
  assert.equal(rendered.pending, 'Responding...');
  assert.equal(state.complete, false);
});

function renderHistoryForTest(platform, history, pending = '') {
  const column = { innerHTML: '', scrollTop: 0, scrollHeight: 0, clientHeight: 0 };
  const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const context = {
    document: { getElementById: () => column, createElement: () => ({ innerHTML: '' }) },
    compareLatestHistories: {},
    t: (_key, fallback) => fallback,
    escapeHtml: escape,
    formatCompareMessageContent: escape,
    isLikelyIncompleteAssistantAnswer: (_platform, text) => text === 'Let me check.',
    setTimeout: callback => callback()
  };
  vm.createContext(context);
  vm.runInContext(['buildCompareBubble', 'filterPendingPlaceholderMessages', 'renderCompareHistory'].map(popupFunction).join('\n'), context);
  context.renderCompareHistory(platform, history, pending);
  return { html: column.innerHTML, cached: context.compareLatestHistories[platform] };
}

for (const platform of ['chatgpt', 'gemini']) {
  test(`${platform} keeps streaming progress in a single answer bubble`, () => {
    const history = [{ role: 'user', content: 'Current question' }, { role: 'assistant', content: 'Visible answer' }];
    const { html, cached } = renderHistoryForTest(platform, history, 'Responding...');
    assert.equal((html.match(/msg-bubble-assistant/g) || []).length, 1);
    assert.equal((html.match(/<b>AI:<\/b>/g) || []).length, 1);
    assert.ok(html.includes('Visible answer'));
    assert.ok(html.includes('class="compare-response-progress" role="status">Responding...</div>'));
    assert.ok(!html.includes('compare-pending-bubble'));
    assert.deepEqual(cached, history, 'Progress never enters saved conversation history');
    const stopped = renderHistoryForTest(platform, history);
    assert.ok(!stopped.html.includes('Responding...'));
    assert.equal((stopped.html.match(/msg-bubble-assistant/g) || []).length, 1);
  });

  test(`${platform} replaces its initial pending bubble when actual answer text arrives`, () => {
    const question = { role: 'user', content: 'Current question' };
    for (const history of [[question], [question, { role: 'assistant', content: 'Let me check.' }]]) {
      const initial = renderHistoryForTest(platform, history, 'Responding...');
      assert.equal((initial.html.match(/msg-bubble-assistant/g) || []).length, 1);
      assert.ok(initial.html.includes('compare-pending-bubble'));
      assert.ok(!initial.html.includes('compare-response-progress'));
      assert.ok(!initial.html.includes('Let me check.'));
    }
  });
}
