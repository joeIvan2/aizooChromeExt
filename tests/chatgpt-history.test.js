'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const utils = require('../content-scripts/shared-utils.js');
const source = fs.readFileSync(path.join(__dirname, '../content-scripts/platforms-config.js'), 'utf8');

function element(tag, attrs = {}, ...children) {
  const node = {
    tagName: tag.toUpperCase(), attrs, children: children.flat(), parentElement: null,
    get textContent() { return this.children.map(child => typeof child === 'string' ? child : child.textContent).join(''); },
    get innerText() { return this.textContent; },
    get href() { return this.attrs.href || ''; },
    getAttribute(name) { return this.attrs[name] ?? null; },
    contains(other) { return this === other || this.children.some(child => typeof child !== 'string' && child.contains(other)); },
    matches(selectors) {
      return selectors.split(',').some(raw => {
        const selector = raw.trim();
        const tag = selector.match(/^\w+/)?.[0];
        const cls = selector.match(/\.([\w-]+)/)?.[1];
        if (tag && tag.toUpperCase() !== this.tagName) return false;
        if (cls && !(this.attrs.class || '').split(' ').includes(cls)) return false;
        return [...selector.matchAll(/\[([\w-]+)(?:(\^=|\*=|=)"([^"]*)"( i)?)?\]/g)].every(([, name, operator, value, insensitive]) => {
          let actual = this.getAttribute(name);
          if (actual === null) return false;
          if (!operator) return true;
          if (insensitive) { actual = actual.toLowerCase(); value = value.toLowerCase(); }
          return operator === '*=' ? actual.includes(value)
            : operator === '^=' ? actual.startsWith(value) : actual === value;
        });
      });
    },
    querySelectorAll(selector) {
      return this.children.filter(child => typeof child !== 'string').flatMap(child => [
        ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)
      ]);
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  };
  node.children.forEach(child => { if (typeof child !== 'string') child.parentElement = node; });
  return node;
}

// Captured from the live GPT page: no article, conversation-turn test ID,
// data-message-author-role, or .markdown. User search keys appear twice.
function user(text, index = 0) {
  const key = `fallback-turn-${index}:0:user`;
  return element('div', { 'data-chatgpt-search-unit-key': key },
    element('div', { 'data-content-search-unit-key': key },
      element('div', { 'data-user-message-bubble': 'true' },
        element('div', { class: 'text-size-chat whitespace-pre-wrap' }, text)),
      element('button', { 'aria-label': 'Copy message' }, 'Copy message')));
}

const markdown = text => element('div', { 'data-markdown-text-style': 'assistant-message' }, text);
function answer(...parts) {
  return element('div', {
    'data-chatgpt-search-unit-key': 'fallback-turn-0:1:assistant',
    'data-content-search-unit-key': 'fallback-turn-0:1:assistant'
  }, element('h4', { 'data-conversation-role': 'assistant' }, 'ChatGPT said:'), ...parts,
  element('button', { 'aria-label': 'Copy' }, 'Copy'));
}

function loadConfig(messages) {
  const window = {};
  const main = element('main', {}, ...messages);
  const document = element('body', {}, main);
  document.body = document;
  vm.runInNewContext(source, {
    window, document, URL, location: { href: 'https://chatgpt.com/c/test' },
    console: { log() {}, warn() {}, error() {} }
  });
  return window.PLATFORM_CONFIGS.chatgpt;
}

const plain = history => JSON.parse(JSON.stringify(history));

test('ChatGPT reads the live Say Hi markup and rereads existing conversation history', () => {
  const config = loadConfig([user('say "hi"'), answer(markdown('hi'))]);
  const expected = [{ role: 'user', content: 'say "hi"' }, { role: 'assistant', content: 'hi' }];
  assert.deepEqual(plain(config.scrapeHistory()), expected);
  assert.deepEqual(plain(config.scrapeHistory()), expected);
  assert.equal(utils.findAnswerAfterQuestion(config.scrapeHistory(), 'say "hi"', 0).answer.content, 'hi');
});

test('ChatGPT retains literal prompts and repeated turns while removing nested search-key duplicates', () => {
  const prompt = 'Copy\nCopy\nThinking\nYou said: literal\n\n    <tag> & "quoted"';
  const history = loadConfig([user(prompt), answer(markdown('first')), user(prompt, 1), answer(markdown('second'))]).scrapeHistory();
  assert.equal(history.length, 4);
  assert.equal(history[0].content, prompt);
  assert.equal(history[2].content, prompt);
  assert.equal(utils.countExactUserQuestions(history, prompt), 2);
  assert.equal(utils.findAnswerAfterQuestion(history, prompt, 1).answer.content, 'second');
});

test('ChatGPT joins all answer blocks, retains code indentation and links, and excludes message controls', () => {
  const response = answer(markdown('intro\n\nfunction example() {\n  return 1;\n}'),
    element('div', { 'data-markdown-text-style': 'assistant-message' },
      element('a', { href: 'https://example.com/source' }, 'Source'), '\nfinal paragraph'));
  const history = loadConfig([user('explain'), response]).scrapeHistory();
  assert.equal(history[1].content, 'intro\n\nfunction example() {\n  return 1;\n}\n\nSource\nfinal paragraph');
  assert.equal(history[1].links[0].href, 'https://example.com/source');
  assert.doesNotMatch(history[1].content, /ChatGPT said:|Copy/);
});

test('ChatGPT does not capture a thinking heading as an answer and captures late text on the next poll', () => {
  const response = answer(element('div', {}, 'Thinking'));
  const config = loadConfig([user('question'), response]);
  assert.deepEqual(plain(config.scrapeHistory()), [{ role: 'user', content: 'question' }]);
  response.children.push(markdown('completed answer'));
  assert.equal(config.scrapeHistory()[1].content, 'completed answer');
});

test('ChatGPT checks streaming on the latest new message and ignores a busy older message', () => {
  const oldResponse = answer(markdown('old answer'), element('div', { 'aria-busy': 'true' }));
  const latestResponse = answer(markdown('new answer'));
  const config = loadConfig([user('old'), oldResponse, user('new', 1), latestResponse]);
  assert.equal(config.detectGenerating(), false);
  latestResponse.children.push(element('div', { 'data-is-streaming': 'true' }));
  assert.equal(config.detectGenerating(), true);
});

test('ChatGPT retains legacy conversation-turn and author-role history support', () => {
  const legacyTurn = (role, text, index) => element('article', { 'data-testid': `conversation-turn-${index}`, 'data-turn': role },
    element('div', { 'data-message-author-role': role }, element('div', { class: role === 'user' ? 'whitespace-pre-wrap' : 'markdown' }, text)));
  const history = loadConfig([legacyTurn('user', 'old question', 0), legacyTurn('assistant', 'old answer', 1)]).scrapeHistory();
  assert.deepEqual(plain(history), [{ role: 'user', content: 'old question' }, { role: 'assistant', content: 'old answer' }]);
});
