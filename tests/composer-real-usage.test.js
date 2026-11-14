'use strict';
// Regressions found in real use: a multi-line question never passed Claude's
// pre-send verification, and ChatGPT filled a leftover hidden composer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../content-scripts/platforms-config.js'), 'utf8');
const text = value => ({ nodeType: 3, textContent: value });
function el(tag, children = [], style = {}) {
  const node = { nodeType: 1, tagName: tag.toUpperCase(), childNodes: children, style, parentElement: null,
    get textContent() { return children.map(c => c.textContent).join(''); }, innerText: '' };
  children.forEach(c => { c.parentElement = node; });
  return node;
}
function load(document) {
  const window = {};
  vm.runInNewContext(source, { window, URL, console: { log() {} }, location: { href: 'https://x/', pathname: '/' }, document,
    getComputedStyle: node => ({ display: node.style?.display || 'block' }) });
  return window.PLATFORM_CONFIGS;
}
// Same normalisation the sender applies before comparing.
const normalize = s => s.trim().replace(/\r\n/g, '\n').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();

test('Claude: a multi-line question reads back with its line breaks', () => {
  // What Claude's editor holds after a three-line question is filled.
  const editor = el('div', [el('p', [text('AAA'), el('br'), text('BBB'), el('br'), text('CCC')])]);
  const claude = load({ querySelector: () => editor, querySelectorAll: () => [] }).claude;
  assert.equal(normalize(claude.getContent()), normalize('AAA\nBBB\nCCC'));
});

test('Claude: separate paragraphs read back as separate lines', () => {
  const editor = el('div', [el('p', [text('AAA')]), el('p', [text('BBB')])]);
  const claude = load({ querySelector: () => editor, querySelectorAll: () => [] }).claude;
  assert.equal(normalize(claude.getContent()), 'AAA BBB');
});

test('ChatGPT: the composer left hidden by the home page is not the one used', () => {
  const stale = el('div', [text('')]); stale.innerText = 'stale';
  el('div', [stale], { display: 'none' });
  const live = el('div', [text('')]); live.innerText = 'live';
  el('div', [live]);
  const chatgpt = load({ querySelector: () => stale, querySelectorAll: () => [stale, live] }).chatgpt;
  assert.equal(chatgpt.getContent(), 'live');
});

test('ChatGPT: with no rendered composer the first match is still used', () => {
  const only = el('div', [text('')]); only.innerText = 'only';
  el('div', [only], { display: 'none' });
  const chatgpt = load({ querySelector: () => only, querySelectorAll: () => [only] }).chatgpt;
  assert.equal(chatgpt.getContent(), 'only');
});

test('pre-send verification ignores whitespace an editor adds or drops around links and lines', () => {
  const { sameTextIgnoringWhitespace } = require('../content-scripts/shared-utils');
  // ChatGPT's composer turns a URL into a link and reads back with a space before it.
  assert.equal(sameTextIgnoringWhitespace('[RDMA](https://example.com/a)', '[RDMA]( https://example.com/a)'), true);
  assert.equal(sameTextIgnoringWhitespace('line one\nline two', 'line oneline two'), true);
  assert.equal(sameTextIgnoringWhitespace('ask about A', 'ask about B'), false);
  assert.equal(sameTextIgnoringWhitespace('full question', 'full'), false);
  assert.equal(sameTextIgnoringWhitespace('', ''), true);
});
