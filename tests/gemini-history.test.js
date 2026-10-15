'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const utils = require('../content-scripts/shared-utils.js');

const source = fs.readFileSync(path.join(__dirname, '../content-scripts/platforms-config.js'), 'utf8');
const question = '2.5d 類似暗黑破壞神3 的遊戲 用AI 設計 網頁板 要用什麼套件更方便';

function userMessage(text, label = '你說了') {
  const lines = text.split('\n').map(line => ({
    innerText: line,
    textContent: line,
    closest: () => null
  }));
  const body = {
    innerText: `${label} ${text}\n\n${text}`,
    querySelectorAll: selector => selector === '.query-text-line' ? lines : []
  };
  return {
    tagName: 'USER-QUERY',
    innerText: body.innerText,
    querySelector: () => body,
    querySelectorAll: selector => body.querySelectorAll(selector)
  };
}

function assistantMessage(text) {
  return { tagName: 'MESSAGE-CONTENT', innerText: text, querySelectorAll: () => [] };
}

function scrape(nodes) {
  const window = {};
  vm.runInNewContext(source, {
    window,
    URL,
    location: { href: 'https://gemini.google.com/app/test' },
    console: { log() {} },
    document: {
      querySelectorAll(selector) {
        if (selector === 'user-query') return nodes.filter(node => node.tagName === 'USER-QUERY');
        if (selector === 'message-content') return nodes.filter(node => node.tagName === 'MESSAGE-CONTENT');
        if (selector === 'user-query, message-content') return nodes;
        return [];
      }
    }
  });
  return Array.from(window.PLATFORM_CONFIGS.gemini.scrapeHistory(), message => ({ ...message }));
}

test('Gemini reads the visible prompt once, excluding its screen-reader copy', () => {
  const history = scrape([userMessage(question), assistantMessage('Completed answer')]);
  assert.deepEqual(history, [
    { role: 'user', content: question },
    { role: 'assistant', content: 'Completed answer' }
  ]);
  assert.equal(utils.findAnswerAfterQuestion(history, question, 0).answer.content, 'Completed answer');
});

test('Gemini matching does not depend on the language of the accessibility label', () => {
  for (const label of ['你說了', 'You said', '你说了', 'Du hast gesagt']) {
    assert.equal(scrape([userMessage(question, label)])[0].content, question);
  }
});

test('Gemini preserves intentional repetition, UI-like words, and multiline prompt indentation', () => {
  const prompt = 'Copy\nCopy\nThinking\nYou said: keep this literal\n\nfunction example() {\n  return 1;\n}';
  const history = scrape([userMessage(prompt), assistantMessage('Code explanation')]);
  assert.equal(history[0].content, prompt);
  assert.equal(utils.findAnswerAfterQuestion(history, prompt, 0).questionIndex, 0);
});

test('Gemini binds a follow-up to its own answer and rereads history in order', () => {
  const next = '接著說明點擊移動';
  const nodes = [userMessage(question), assistantMessage('First answer'), userMessage(next), assistantMessage('Second answer')];
  const history = scrape(nodes);
  assert.equal(history.length, 4);
  assert.equal(utils.findAnswerAfterQuestion(history, question, 0).answer.content, 'First answer');
  assert.equal(utils.findAnswerAfterQuestion(history, next, 0).answer.content, 'Second answer');
  assert.deepEqual(scrape(nodes), history);
});

test('Gemini keeps genuinely repeated user turns and honors the submission baseline', () => {
  const history = scrape([userMessage(question), assistantMessage('First answer'), userMessage(question), assistantMessage('Second answer')]);
  assert.equal(utils.countExactUserQuestions(history, question), 2);
  assert.equal(utils.findAnswerAfterQuestion(history, question, 1).answer.content, 'Second answer');
  const pending = scrape([userMessage(question), userMessage(question)]);
  assert.equal(utils.countExactUserQuestions(pending, question), 2);
});

test('Smart Compare completes Gemini without appending a phantom question', () => {
  const popup = fs.readFileSync(path.join(__dirname, '../popup.js'), 'utf8');
  const start = popup.indexOf('function updateCompareFromHistory(');
  const end = popup.indexOf('\nfunction ', start + 1);
  assert.ok(start >= 0 && end > start);
  const history = scrape([userMessage(question), assistantMessage('Completed answer')]);
  const state = { question, sent: true, baselineOccurrences: 0, stableCount: 0 };
  let rendered;
  const context = {
    Date,
    window: { AIZooUtils: utils },
    compareWatchState: { gemini: state },
    findQuestionAnswer: utils.findAnswerAfterQuestion,
    isLikelyIncompleteAssistantAnswer: () => false,
    COMPARE_STABLE_POLLS_REQUIRED_BY_PLATFORM: {},
    COMPARE_STABLE_POLLS_REQUIRED: 2,
    COMPARE_QUIET_PERIOD_MS_BY_PLATFORM: {},
    COMPARE_QUIET_PERIOD_MS: 0,
    renderTrackedCompareHistory(_platform, messages, pending = '') {
      rendered = { messages, pending };
    },
    completeComparePlatform(_platform, messages) {
      state.complete = true;
      rendered = { messages, pending: '' };
    },
    updateStatus() {},
    t: (_key, fallback) => fallback
  };
  vm.runInNewContext(popup.slice(start, end), context);
  for (let poll = 0; poll < 3; poll += 1) {
    context.updateCompareFromHistory('gemini', history, false);
    assert.equal(rendered.messages.length, 2);
  }
  assert.equal(state.complete, true);
  assert.equal(rendered.pending, '');
});
