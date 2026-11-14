'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../content-scripts/platforms-config.js'), 'utf8');

// Minimal DOM fixture mirroring Grok's 2026-11 bubble markup: each bubble
// starts with a screen-reader heading naming the speaker ("您" / "Grok").
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
    get innerText() {
      return this.childNodes.map(child => child.nodeType === 3 ? child.textContent : child.innerText)
        .filter(Boolean).join(this.children.length ? '\n' : '');
    },
    getAttribute(name) { return attrs[name] ?? null; },
    matches(selectors) {
      return selectors.split(',').some(raw => {
        const selector = raw.trim();
        const tag = selector.match(/^\w+/)?.[0];
        if (tag && tag.toUpperCase() !== this.tagName) return false;
        const classes = [...selector.matchAll(/\.([\w-]+)/g)].map(match => match[1]);
        if (!classes.every(name => (attrs.class || '').split(/\s+/).includes(name))) return false;
        return [...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].every(([, name, value]) =>
          attrs[name] !== undefined && (value === undefined || attrs[name] === value));
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

function scrape(...bubbles) {
  const window = {};
  const document = element('main', {}, ...bubbles);
  vm.runInNewContext(source, {
    document, window, URL, location: { href: 'https://grok.com/c/1' },
    console: { log() {}, warn() {}, error() {} }
  });
  return window.PLATFORM_CONFIGS.grok.scrapeHistory();
}

const heading = text => element('h2', { class: 'sr-only', 'data-no-copy': 'true' }, text);
const actions = () => element('div', { 'data-testid': 'user-message-actions' },
  element('button', { 'aria-label': '編輯訊息' }));
const assistant = text => element('div', { 'data-testid': 'assistant-message', class: 'message-bubble' },
  heading('Grok'),
  element('div', { class: 'response-content-markdown' }, element('p', {}, text)));

test('Grok user turns exclude the screen-reader speaker heading', () => {
  const history = scrape(
    element('div', { 'data-testid': 'user-message', class: 'message-bubble' },
      heading('您'), element('span', { 'data-bubble-text': '' }, '單純回我 "hi"'), actions()),
    assistant('hi')
  );
  // The scraper runs in another realm, so copy its result into plain arrays.
  assert.deepEqual(Array.from(history, item => [item.role, item.content]), [
    ['user', '單純回我 "hi"'],
    ['assistant', 'hi']
  ]);
});

test('Grok user turns without a bubble-text node still drop the speaker heading', () => {
  const history = scrape(
    element('div', { 'data-testid': 'user-message', class: 'message-bubble' },
      heading('You'), element('p', {}, 'You said it twice')),
    assistant('ok')
  );
  assert.equal(history[0].content, 'You said it twice');
});

test('Grok legacy bubbles without a heading keep their full text', () => {
  const history = scrape(
    element('div', { 'data-testid': 'user-message', class: 'message-bubble' }, 'plain question'),
    assistant('answer')
  );
  assert.equal(history[0].content, 'plain question');
});
