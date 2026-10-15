'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const utils = require('../content-scripts/shared-utils.js');
const source = fs.readFileSync(path.join(__dirname, '../content-scripts/platforms-config.js'), 'utf8');

// Small DOM fixture implementing the element/text operations used by the
// scraper. Real Chromium DOM checks cover the provider's rendered markup too.
function element(tag, attrs = {}, ...children) {
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    className: attrs.class || '',
    parentElement: null,
    childNodes: children.flat().map(child => typeof child === 'string'
      ? { nodeType: 3, textContent: child }
      : child),
    get children() { return this.childNodes.filter(child => child.nodeType === 1); },
    get textContent() { return this.childNodes.map(child => child.textContent).join(''); },
    get innerText() { return this.textContent; },
    get href() { return attrs.href || ''; },
    get rows() { return this.querySelectorAll('tr').filter(row => row.closest('table') === this); },
    get cells() { return this.children.filter(child => /^(TH|TD)$/.test(child.tagName)); },
    get caption() { return this.children.find(child => child.tagName === 'CAPTION') || null; },
    getAttribute(name) { return attrs[name] ?? null; },
    classList: { contains: name => (attrs.class || '').split(/\s+/).includes(name) },
    matches(selectors) {
      return selectors.split(',').some(raw => {
        const selector = raw.trim();
        if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
        const attribute = selector.match(/^(\w+)?\[([\w-]+)(?:="([^"]*)")?\]$/);
        if (attribute) return (!attribute[1] || this.tagName === attribute[1].toUpperCase()) &&
          attrs[attribute[2]] !== undefined && (attribute[3] === undefined || attrs[attribute[2]] === attribute[3]);
        return this.tagName === selector.toUpperCase();
      });
    },
    closest(selector) {
      for (let current = this; current; current = current.parentElement) {
        if (current.matches(selector)) return current;
      }
      return null;
    },
    contains(other) { return this === other || this.children.some(child => child.contains(other)); },
    querySelectorAll(selector) {
      return this.children.flatMap(child => [
        ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)
      ]);
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  };
  node.childNodes.forEach(child => { child.parentElement = node; });
  return node;
}

const prose = text => element('div', { class: 'markdown-content' },
  element('div', { class: 'ur-markdown' }, element('p', {}, text)));
const answer = (...blocks) => element('div', { 'data-testid': 'assistant-message' }, ...blocks);
const user = text => element('div', { 'data-message-type': 'user' },
  element('div', { class: 'text-response' }, text));
const table = rows => element('table', {}, element('tbody', {}, rows.map(row =>
  element('tr', {}, row.map(cell => element('td', {}, cell))))));

function loadConfig(messages) {
  const window = {};
  const document = element('main', {}, ...messages);
  vm.runInNewContext(source, {
    window, document, URL, location: { href: 'https://www.meta.ai/prompt/test' },
    console: { log() {}, warn() {}, error() {} }
  });
  return window.PLATFORM_CONFIGS.meta;
}

test('Meta keeps the intro, all table rows, and the conclusion in one answer', () => {
  const intro = '差異不是容量，是頻寬和 GPU 規模：';
  const conclusion = '表格之後的完整結論。';
  const config = loadConfig([user('比較兩台主機'), answer(
    element('div', { class: 'markdown-content' }, element('div', { role: 'button' },
      element('div', { 'data-testid': 'thinking-status' }, 'Show thinking'))),
    prose(intro),
    element('div', { class: 'markdown-content' }, table([
      ['', 'MS-S1 MAX P495', 'Mac Studio M5 Ultra 256GB'],
      ['記憶體', '192GB LPDDR5X-8533', '256GB']
    ])),
    prose(conclusion)
  )]);
  const history = config.scrapeHistory();
  assert.equal(history.length, 2);
  assert.equal(history[1].content,
    `${intro}\n\n—\tMS-S1 MAX P495\tMac Studio M5 Ultra 256GB\n記憶體\t192GB LPDDR5X-8533\t256GB\n\n${conclusion}`);
  assert.doesNotMatch(history[1].content, /Show thinking/);
});

test('Meta table-only answers retain empty cells and multiline cell content', () => {
  const config = loadConfig([answer(table([
    ['項目', 'A', 'B'],
    ['頻寬', '', element('p', {}, '第一行', element('br'), '第二行')]
  ]))]);
  assert.equal(config.scrapeHistory()[0].content, '項目\tA\tB\n頻寬\t—\t第一行 第二行');
});

test('Meta reads every legacy markdown block instead of picking only the longest', () => {
  const config = loadConfig([answer(
    element('div', { class: 'markdown-content' }, 'first'),
    element('div', { class: 'markdown-content' }, 'a much longer middle'),
    element('div', { class: 'markdown-content' }, 'last')
  )]);
  assert.equal(config.scrapeHistory()[0].content, 'first\n\na much longer middle\n\nlast');
});

test('nested Meta markdown/table blocks appear once, including links after the table', () => {
  const config = loadConfig([answer(element('div', { class: 'markdown-content' },
    element('div', { class: 'ur-markdown' },
      element('p', {}, 'intro'), table([['A', 'B'], ['1', '2']]),
      element('p', {}, element('a', { href: 'https://example.com/source' }, 'Source label'))
    )
  ))]);
  const message = config.scrapeHistory()[0];
  assert.equal(message.content, 'intro\n\nA\tB\n1\t2\n\nSource label');
  assert.equal(message.links.length, 1);
  assert.equal(message.links[0].href, 'https://example.com/source');
});

test('Meta retains code indentation and excludes message controls and hidden text', () => {
  const config = loadConfig([answer(
    prose('before code'),
    element('div', { class: 'markdown-content' },
      element('button', {}, 'Copy code'),
      element('pre', {}, element('code', {}, 'function example() {\n  return 1;\n}'))),
    element('div', { class: 'markdown-content', 'aria-hidden': 'true' }, 'hidden duplicate'),
    prose('after code')
  )]);
  const text = config.scrapeHistory()[0].content;
  assert.equal(text, 'before code\n\nfunction example() {\n  return 1;\n}\n\nafter code');
});

test('Meta follow-ups and repeated history reads retain each complete answer', () => {
  const config = loadConfig([
    user('question one'), answer(prose('intro one'), table([['A', 'B']]), prose('tail one')),
    user('question two'), answer(prose('intro two'), prose('tail two'))
  ]);
  const history = config.scrapeHistory();
  assert.equal(history.length, 4);
  assert.match(utils.findAnswerAfterQuestion(history, 'question one', 0).answer.content, /tail one$/);
  assert.match(utils.findAnswerAfterQuestion(history, 'question two', 0).answer.content, /tail two$/);
  assert.deepEqual(config.scrapeHistory(), history);
});

test('Meta captures blocks arriving after an earlier prose segment', () => {
  const first = prose('first segment');
  const message = answer(first);
  const config = loadConfig([message]);
  assert.equal(config.scrapeHistory()[0].content, 'first segment');
  const late = prose('late segment');
  late.parentElement = message;
  message.childNodes.push(late);
  assert.equal(config.scrapeHistory()[0].content, 'first segment\n\nlate segment');
});

test('Meta plain-text fallback excludes controls without changing the DOM', () => {
  const message = answer(element('p', {}, 'unwrapped answer'), element('button', {}, 'Action menu'));
  const before = message.textContent;
  assert.equal(loadConfig([message]).scrapeHistory()[0].content, 'unwrapped answer');
  assert.equal(message.textContent, before);
});

test('Meta thinking controls alone are not an assistant answer', () => {
  const config = loadConfig([answer(element('div', { class: 'markdown-content' },
    element('div', { 'data-testid': 'thinking-status' }, 'Show thinking')))]);
  assert.equal(config.scrapeHistory().length, 0);
});
