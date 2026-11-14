'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../content-scripts/platforms-config.js'), 'utf8');

function element(tag, attrs = {}, children = []) {
  const node = {
    tagName: tag.toUpperCase(), attrs, children, parentElement: null,
    innerText: '', textContent: '', disabled: false, clicks: 0, events: [],
    getAttribute(name) { return this.attrs[name] ?? null; },
    focus() {},
    click() { this.clicks++; },
    dispatchEvent(event) { this.events.push(event); },
    matches(selectors) {
      return selectors.split(',').some(raw => {
        let selector = raw.trim();
        if (selector.startsWith('form ')) {
          if (!this.closest('form')) return false;
          selector = selector.slice(5);
        }
        const tag = selector.match(/^\w+/)?.[0];
        const id = selector.match(/#([\w-]+)/)?.[1];
        const cls = selector.match(/\.([\w-]+)/)?.[1];
        if (tag && tag.toUpperCase() !== this.tagName) return false;
        if (id && this.attrs.id !== id) return false;
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
    closest(selector) {
      for (let current = this; current; current = current.parentElement) {
        if (current.matches(selector)) return current;
      }
      return null;
    },
    querySelectorAll(selector) {
      return this.children.flatMap(child => [
        ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)
      ]);
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  };
  children.forEach(child => { child.parentElement = node; });
  return node;
}

function fixture({ legacy = false, insertSucceeds = true } = {}) {
  const composer = element(legacy ? 'textarea' : 'div', legacy
    ? { id: 'prompt-textarea' }
    : { contenteditable: 'true', class: 'ProseMirror', 'data-composer-markdown': '', role: 'textbox' });
  // A contenteditable's stray value property must never mask its real text.
  composer.value = 'stale value';
  Object.defineProperty(composer, 'innerHTML', { set() { throw new Error('Prompt must remain plain text'); } });
  const send = element('button', legacy ? { 'data-testid': 'send-button' } : { type: 'submit', 'aria-label': 'Send' });
  const unrelatedSend = element('button', { type: 'submit' });
  const form = element('form', {}, [composer, send]);
  const body = element('body', {}, [unrelatedSend, form]);
  let selected;
  const document = {
    body,
    querySelector: selector => body.querySelector(selector),
    querySelectorAll: selector => body.querySelectorAll(selector),
    createRange: () => ({ selectNodeContents(node) { this.node = node; } }),
    execCommand(command, unused, text) {
      if (!insertSucceeds || !selected) return false;
      selected.innerText = selected.textContent = command === 'delete' ? '' : text;
      return true;
    }
  };
  class Textarea {}
  Object.defineProperty(Textarea.prototype, 'value', {
    set(value) { this.nativeValue = value; }
  });
  const window = {
    HTMLTextAreaElement: Textarea,
    getSelection: () => ({ removeAllRanges() {}, addRange(range) { selected = range.node; } })
  };
  class InputEvent {
    constructor(type, options) { this.type = type; Object.assign(this, options); }
  }
  vm.runInNewContext(source, {
    document, window, InputEvent, URL, location: { href: 'https://chatgpt.com/' },
    console: { log() {}, warn() {}, error() {} }
  });
  return { config: window.PLATFORM_CONFIGS.chatgpt, composer, send, unrelatedSend, form };
}

test('ChatGPT finds the current composer without an ID and submits only its own form', () => {
  const { config, send, unrelatedSend } = fixture();
  assert.equal(config.detectTextarea(), true);
  assert.equal(config.detectButton(), true);
  assert.equal(config.clickButton(), true);
  assert.equal(send.clicks, 1);
  assert.equal(unrelatedSend.clicks, 0);
});

test('ChatGPT replaces a draft with literal multiline text and ignores a stale value property', () => {
  const { config, composer } = fixture();
  composer.innerText = composer.textContent = 'old draft';
  const prompt = '中文 <tag> & "quoted"\nsecond line\n\n    indented';
  assert.equal(config.fillQuestion(prompt), true);
  assert.equal(config.getContent(), prompt);
  assert.equal(composer.value, 'stale value');
  assert.equal(config.fillQuestion('follow-up'), true);
  assert.equal(config.getContent(), 'follow-up');
});

test('ChatGPT does not report success when native editing fails', () => {
  const { config } = fixture({ insertSucceeds: false });
  assert.equal(config.fillQuestion('unsent'), false);
  assert.equal(config.getContent(), '');
});

test('ChatGPT refuses disabled and aria-disabled send buttons', () => {
  const { config, send } = fixture();
  send.disabled = true;
  assert.equal(config.detectButton(), false);
  assert.equal(config.clickButton(), false);
  send.disabled = false;
  send.attrs['aria-disabled'] = 'true';
  assert.equal(config.detectButton(), false);
  assert.equal(config.clickButton(), false);
  assert.equal(send.clicks, 0);
});

test('ChatGPT never clicks the submit control while it represents Stop', () => {
  const { config, send } = fixture();
  send.attrs['aria-label'] = 'Stop generating';
  assert.equal(config.detectGenerating(), true);
  assert.equal(config.detectButton(), false);
  assert.equal(config.clickButton(), false);
  assert.equal(send.clicks, 0);
});

test('ChatGPT retains legacy textarea and send-button support through the native value setter', () => {
  const { config, composer, send } = fixture({ legacy: true });
  assert.equal(config.detectTextarea(), true);
  assert.equal(config.fillQuestion('legacy prompt'), true);
  assert.equal(composer.nativeValue, 'legacy prompt');
  assert.equal(composer.events[0].type, 'input');
  assert.equal(composer.events[0].data, 'legacy prompt');
  assert.equal(config.clickButton(), true);
  assert.equal(send.clicks, 1);
});

test('ChatGPT does not submit an unrelated form when its composer is absent', () => {
  const { config, form, unrelatedSend } = fixture();
  form.children = [];
  assert.equal(config.detectTextarea(), false);
  assert.equal(config.detectButton(), false);
  assert.equal(config.clickButton(), false);
  assert.equal(unrelatedSend.clicks, 0);
});

// 2026-11 ChatGPT home composer: no <form>, send button is type="button" with
// only a localized aria-label, sitting in [data-composer-trailing-controls].
function formlessFixture({ sendLabel = '傳送' } = {}) {
  const composer = element('div', {
    contenteditable: 'true', class: 'ProseMirror', 'data-composer-markdown': '', role: 'textbox'
  });
  const model = element('button', { type: 'button', 'aria-label': '選擇模型', 'aria-haspopup': 'menu' });
  const dictation = element('button', { type: 'button', 'aria-label': '聽寫', 'data-dictation-button': 'idle' });
  const send = element('button', { type: 'button', 'aria-label': sendLabel });
  const trailing = element('div', { 'data-composer-trailing-controls': 'true' }, [model, dictation, send]);
  const root = element('div', { 'data-composer-layout': 'multiline' }, [
    element('div', { 'data-composer-input': '' }, [composer]), trailing
  ]);
  const sidebar = element('button', { type: 'button', 'aria-label': '顯示側邊欄' });
  const body = element('body', {}, [sidebar, root]);
  let selected;
  const document = {
    body,
    querySelector: selector => body.querySelector(selector),
    querySelectorAll: selector => body.querySelectorAll(selector),
    createRange: () => ({ selectNodeContents(node) { this.node = node; } }),
    execCommand(command, unused, text) {
      selected.innerText = selected.textContent = command === 'delete' ? '' : text;
      return true;
    }
  };
  const window = {
    HTMLTextAreaElement: class {},
    getSelection: () => ({ removeAllRanges() {}, addRange(range) { selected = range.node; } })
  };
  vm.runInNewContext(source, {
    document, window, InputEvent: class {}, URL, location: { href: 'https://chatgpt.com/' },
    console: { log() {}, warn() {}, error() {} }
  });
  return { config: window.PLATFORM_CONFIGS.chatgpt, composer, send, model, dictation, sidebar };
}

test('ChatGPT submits through the form-less composer send button', () => {
  const { config, send, model, dictation, sidebar } = formlessFixture();
  assert.equal(config.fillQuestion('hi'), true);
  assert.equal(config.detectButton(), true);
  assert.equal(config.clickButton(), true);
  assert.equal(send.clicks, 1);
  assert.equal(model.clicks + dictation.clicks + sidebar.clicks, 0);
});

test('ChatGPT form-less send button is found without relying on its localized label', () => {
  const { config, send, dictation } = formlessFixture({ sendLabel: 'Envoyer' });
  assert.equal(config.fillQuestion('hi'), true);
  assert.equal(config.clickButton(), true);
  assert.equal(send.clicks, 1);
  assert.equal(dictation.clicks, 0);
});

test('ChatGPT form-less composer never clicks an unrecognized trailing control while empty', () => {
  const { config, send } = formlessFixture({ sendLabel: 'Voice' });
  assert.equal(config.detectButton(), false);
  assert.equal(config.clickButton(), false);
  assert.equal(send.clicks, 0);
});

// The 2026-11 thread is a virtualized list that only renders turns near the
// viewport and does not follow a new turn unless it is already at the bottom.
test('ChatGPT scrolls the thread to the newest turn after submitting', () => {
  const composer = element('div', {
    contenteditable: 'true', class: 'ProseMirror', 'data-composer-markdown': '', role: 'textbox'
  });
  const send = element('button', { type: 'button', 'aria-label': '傳送' });
  const composerRoot = element('div', { 'data-composer-layout': 'multiline' }, [
    composer, element('div', { 'data-composer-trailing-controls': 'true' }, [send])
  ]);
  const turn = element('div', { 'data-turn-key': 'history-content:turn:1' });
  const scroller = element('div', { class: 'thread-scroller' }, [element('div', {}, [turn])]);
  Object.assign(scroller, { scrollHeight: 4912, clientHeight: 614, scrollTop: 3264, overflowY: 'auto' });
  const body = element('body', {}, [scroller, composerRoot]);
  const timers = [];
  let selected;
  const document = {
    body,
    querySelector: selector => body.querySelector(selector),
    querySelectorAll: selector => body.querySelectorAll(selector),
    createRange: () => ({ selectNodeContents(node) { this.node = node; } }),
    execCommand(command, unused, text) { selected.innerText = selected.textContent = text; return true; }
  };
  const window = {
    HTMLTextAreaElement: class {},
    getSelection: () => ({ removeAllRanges() {}, addRange(range) { selected = range.node; } }),
    getComputedStyle: node => ({ overflowY: node.overflowY || 'visible' })
  };
  vm.runInNewContext(source, {
    document, window, InputEvent: class {}, URL, location: { href: 'https://chatgpt.com/local/1' },
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); },
    console: { log() {}, warn() {}, error() {} }
  });
  const config = window.PLATFORM_CONFIGS.chatgpt;

  assert.equal(config.fillQuestion('next question'), true);
  assert.equal(config.clickButton(), true);
  assert.equal(send.clicks, 1);
  assert.equal(scroller.scrollTop, 3264, 'the new turn is not in the DOM yet at click time');
  assert.ok(timers.length > 0, 'expected follow-up scrolls after the turn is appended');
  scroller.scrollHeight = 5143;
  timers.forEach(timer => timer.callback());
  assert.equal(scroller.scrollTop, 5143);
});
