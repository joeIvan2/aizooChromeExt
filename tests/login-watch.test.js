'use strict';
// Signing in happens in a normal tab, not inside the embedded page. While that
// tab is open the extension re-reads the provider's session for a while and
// reloads the embedded page once the session has changed.
const test = require('node:test'), assert = require('node:assert/strict');
const { createLoginWatch } = require('../login-watch');
const { isLoginControl } = require('../content-scripts/provider-attention');

function setup({ needsLogin = true } = {}) {
  const state = { session: 'a', now: 0, reloads: 0, done: [], needsLogin, timers: [] };
  const watch = createLoginWatch({
    read: async () => state.session, reload: () => { state.reloads += 1; }, needsLogin: () => state.needsLogin,
    done: result => state.done.push(result), now: () => state.now,
    setTimer: fn => { state.timers.push(fn); }, intervalMs: 5000, timeoutMs: 300000
  });
  const tick = async ms => { state.now += ms; const fn = state.timers.shift(); if (fn) await fn(); };
  return { state, watch, tick };
}

test('nothing is reloaded while the session has not changed', async () => {
  const { state, watch, tick } = setup();
  await watch.start(); await tick(5000); await tick(5000);
  assert.equal(state.reloads, 0); assert.deepEqual(state.done, []);
});

test('a changed session reloads the page, and the watch ends as signed in once the page is ready', async () => {
  const { state, watch, tick } = setup();
  await watch.start(); state.session = 'a,b'; await tick(5000);
  assert.equal(state.reloads, 1);
  state.needsLogin = false; watch.pageReady();
  assert.deepEqual(state.done, ['signed-in']);
  await tick(5000); assert.equal(state.reloads, 1, 'and it stops reading');
});

test('a page that still asks for sign-in after the reload keeps being watched', async () => {
  const { state, watch, tick } = setup();
  await watch.start(); state.session = 'a,b'; await tick(5000); watch.pageReady();
  assert.deepEqual(state.done, []);
  state.session = 'a,b,c'; await tick(5000); assert.equal(state.reloads, 2);
});

test('a page that was ready before anything changed does not end the watch', async () => {
  const { state, watch } = setup({ needsLogin: false });
  await watch.start(); watch.pageReady();
  assert.deepEqual(state.done, []);
});

test('closing the sign-in tab checks once more by reloading', async () => {
  const { state, watch } = setup();
  await watch.start(); watch.tabClosed();
  assert.equal(state.reloads, 1);
});

test('the watch gives up after its time limit', async () => {
  const { state, watch, tick } = setup();
  await watch.start(); await tick(300001);
  assert.deepEqual(state.done, ['timeout']); assert.equal(state.reloads, 0);
});

test('sign-in buttons are recognised, other buttons and sign-up are not', () => {
  for (const text of ['登入', '登录', 'Log in', 'Sign in', ' log in ', 'ログイン', 'Iniciar sesión', 'Se connecter', 'Anmelden']) assert.equal(isLoginControl(text), true, text);
  for (const text of ['註冊', '免費註冊', 'Sign up', 'Send', '', null, 'Sign in with a passkey and continue to the next step']) assert.equal(isLoginControl(text), false, String(text));
});

// The extension used to draw its own panel over the page, with an "I have
// signed in" button. Sign-in state is now read automatically instead.
test('no provider page draws its own sign-in panel any more', () => {
  const fs = require('node:fs'), path = require('node:path');
  for (const name of ['grok', 'chatgpt', 'claude']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'content-scripts', name + '-script.js'), 'utf8');
    assert.doesNotMatch(source, /createLoginOverlay|ai-close-btn|ai-login-btn|LoginCheckDisabled|ai-multichat-login-overlay/, name);
    assert.match(source, /reportStatus\?\.\(401\)/, name + ' reports signed-out through the shared notice');
    assert.match(source, /reportStatus\?\.\(200\)/, name + ' clears it once signed in');
  }
  for (const locale of ['en', 'zh_TW', 'zh_CN', 'ja', 'es', 'fr', 'de']) {
    const messages = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '_locales', locale, 'messages.json'), 'utf8'));
    for (const key of ['grokLoginTitle', 'grokLoginInstructions', 'grokLoginOpenWindow', 'grokLoginDone']) assert.equal(key in messages, false, locale + '/' + key);
  }
});

test('coming back to the extension checks the sign-in state at once', async () => {
  const { state, watch } = setup();
  await watch.start(); watch.returned();
  assert.equal(state.reloads, 1);
  watch.returned();
  assert.equal(state.reloads, 1, 'but not again before that reload has finished');
  watch.pageReady(); watch.returned();
  assert.equal(state.reloads, 2);
});

test('a page that loaded but still shows the sign-in wall can be checked again', async () => {
  const { state, watch } = setup();
  await watch.start(); watch.returned(); watch.pageLoaded(); watch.returned();
  assert.equal(state.reloads, 2); assert.deepEqual(state.done, []);
});

// After signing in, the reloaded page had nothing to report, so it said
// nothing, and the extension kept showing "sign-in required".
test('a freshly loaded page always reports its state, also when nothing is wrong', () => {
  const posted = [];
  const doc = { documentElement: { clientWidth: 300, clientHeight: 300 }, title: '', body: { textContent: '' }, querySelectorAll: () => [], addEventListener() {}, getElementById: () => null };
  const root = { document: doc, location: { href: 'https://example.test/' }, addEventListener() {}, queueMicrotask, setInterval: () => 0, clearInterval() {},
    MutationObserver: class { observe() {} disconnect() {} }, getComputedStyle: () => ({}) };
  root.top = { postMessage() {} }; root.parent = { postMessage: message => posted.push(message) }; root.parent.top = root.top;
  root.top = root.parent;
  const vm = require('node:vm'), fs = require('node:fs');
  const context = vm.createContext({ window: root, globalThis: root, location: root.location, getComputedStyle: root.getComputedStyle, MutationObserver: root.MutationObserver, setInterval: root.setInterval, clearInterval() {}, queueMicrotask });
  vm.runInContext('(function(){' + fs.readFileSync(require.resolve('../content-scripts/provider-attention.js'), 'utf8').replace("typeof window !== 'undefined' ? window : globalThis", 'window') + '})()', context);
  root.AIZooProviderAttention.install({ id: 'meta', detectTextarea: () => true });
  assert.deepEqual(posted.map(m => [m.type, m.platform, m.kind]), [['AI_PROVIDER_ATTENTION', 'meta', null]]);
});

// Claude's "you were signed out" page was remembered as the conversation to
// reopen, so Claude came back signed out on every start, even after sign-in.
test('sign-in, sign-out and terms pages are never remembered as a conversation', () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('../popup.js'), 'utf8');
  const start = source.indexOf('function normalizePlatformUrl(');
  const context = { URL };
  vm.runInNewContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
  const keep = (platform, url) => context.normalizePlatformUrl(platform, url);
  for (const [platform, url] of [['claude', 'https://claude.ai/logout?involuntary=1&returnTo=%2Flogin'], ['claude', 'https://claude.ai/login?from=logout'],
    ['grok', 'https://grok.com/tos-gate'], ['grok', 'https://accounts.x.ai/sign-in?redirect=grok-com'], ['chatgpt', 'https://chatgpt.com/auth/login'],
    ['chatgpt', 'https://auth.openai.com/log-in'], ['gemini', 'https://accounts.google.com/ServiceLogin?x=1'], ['meta', 'https://www.meta.ai/login/']]) assert.equal(keep(platform, url), '', url);
  assert.equal(keep('claude', 'https://claude.ai/chat/abc'), 'https://claude.ai/chat/abc');
  assert.equal(keep('grok', 'https://grok.com/c/abc?rid=1'), 'https://grok.com/c/abc?rid=1');
  assert.equal(keep('gemini', 'https://gemini.google.com/app/123'), 'https://gemini.google.com/app/123');
  assert.equal(keep('claude', 'https://claude.ai/new?model=x'), 'https://claude.ai/new');
  assert.equal(keep('meta', null), null);
});

// ---- Edge cases found by reviewing a second implementation of this fix ----
function attentionPage({ composer = true, buttons = [], href = 'https://example.test/' } = {}) {
  const posted = [], page = { composer, buttons };
  const el = text => ({ textContent: text, closest: () => null, parentElement: null, getAttribute: () => null, getBoundingClientRect: () => ({ width: 10, height: 10 }) });
  const doc = { documentElement: { clientWidth: 300, clientHeight: 300 }, title: '', body: { textContent: '' }, addEventListener() {}, getElementById: () => null,
    querySelectorAll: selector => /button/.test(selector) && !/dialog/.test(selector) ? page.buttons.map(el) : [] };
  const root = { document: doc, location: { href }, addEventListener() {}, queueMicrotask, setInterval: () => 0, clearInterval() {},
    MutationObserver: class { observe() {} disconnect() {} }, getComputedStyle: () => ({}) };
  root.parent = { postMessage: message => posted.push(message) }; root.top = root.parent;
  const vm = require('node:vm'), fs = require('node:fs');
  const context = vm.createContext({ window: root, globalThis: root, location: root.location, getComputedStyle: root.getComputedStyle, MutationObserver: root.MutationObserver, setInterval: root.setInterval, clearInterval() {}, queueMicrotask });
  vm.runInContext('(function(){' + fs.readFileSync(require.resolve('../content-scripts/provider-attention.js'), 'utf8').replace("typeof window !== 'undefined' ? window : globalThis", 'window') + '})()', context);
  root.AIZooProviderAttention.install({ id: 'gemini', detectTextarea: () => page.composer });
  return { page, api: root.AIZooProviderAttention, kinds: () => posted.filter(m => m.type === 'AI_PROVIDER_ATTENTION').map(m => m.kind) };
}

// The page had answered 401 once; later it showed a working composer, but the
// old answer was still being reported as "sign-in required".
test('an old 401 is dropped once the page shows a composer and no sign-in button', () => {
  const { page, api, kinds } = attentionPage({ composer: false });
  api.reportStatus(401);
  assert.deepEqual(kinds(), [null, 'login']);
  page.composer = true; api.check();
  assert.deepEqual(kinds(), [null, 'login', null]);
  api.check();
  assert.deepEqual(kinds(), [null, 'login', null], 'and it does not come back');
});

test('a 401 stays while the page still offers its own sign-in button, composer or not', () => {
  const { api, kinds } = attentionPage({ composer: true, buttons: ['Log in'] });
  api.reportStatus(401); api.check();
  assert.deepEqual(kinds(), [null, 'login']);
});

test('other problems reported by the site are not dropped because a composer is there', () => {
  const { api, kinds } = attentionPage({ composer: true });
  api.reportStatus(429); api.check();
  assert.deepEqual(kinds(), [null, 'rate-limit']);
});

test('a sign-in wall is recognised in every language the extension ships', () => {
  for (const label of ['Log in', 'Sign in', '登入', '登录', 'ログイン', 'Iniciar sesión', 'Se connecter', 'Anmelden']) {
    const { kinds } = attentionPage({ composer: false, buttons: [label] });
    assert.deepEqual(kinds(), ['login'], label);
  }
  assert.deepEqual(attentionPage({ composer: false, buttons: ['Login history', 'Signing in is optional'] }).kinds(), [null]);
});

test("Claude's signed-out page counts as needing sign-in", () => {
  const { classify } = require('../content-scripts/provider-attention');
  assert.equal(classify({ url: 'https://claude.ai/logout?involuntary=1&returnTo=%2Fnew', composer: false })?.kind, 'login');
  assert.equal(classify({ url: 'https://chatgpt.com/auth/login', composer: false })?.kind, 'login');
  assert.equal(classify({ url: 'https://claude.ai/chat/logout-notes', composer: true }), null);
});

function popupFunctions(names, context) {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('../popup.js'), 'utf8');
  const extract = name => { const start = source.indexOf(`function ${name}(`); assert.notEqual(start, -1, name); return source.slice(start, source.indexOf('\n}', start + 1) + 2); };
  vm.runInNewContext(names.map(extract).join('\n'), context);
  return context;
}

// The sign-out page used to wipe the conversation that was open before it.
test('a sign-in or sign-out page does not replace the remembered conversation', () => {
  const stored = { 'ai-chat-url-claude': 'https://claude.ai/chat/abc' }, captured = [];
  const context = popupFunctions(['normalizePlatformUrl', 'rememberPlatformUrl'], { URL,
    localStorage: { setItem: (key, value) => { stored[key] = value; } }, captureSessionUrl: (platform, url) => captured.push(url) });
  context.rememberPlatformUrl('claude', 'https://claude.ai/logout?involuntary=1');
  context.rememberPlatformUrl('claude', 'https://claude.ai/login');
  assert.equal(stored['ai-chat-url-claude'], 'https://claude.ai/chat/abc'); assert.deepEqual(captured, []);
  context.rememberPlatformUrl('claude', 'https://claude.ai/chat/def');
  assert.equal(stored['ai-chat-url-claude'], 'https://claude.ai/chat/def'); assert.deepEqual(captured, ['https://claude.ai/chat/def']);
});

test('sign-up, consent and create-account pages are not conversations either', () => {
  const context = popupFunctions(['normalizePlatformUrl'], { URL });
  for (const url of ['https://chatgpt.com/log-in-or-create-account', 'https://claude.ai/signup', 'https://grok.com/sign-up', 'https://www.meta.ai/consent/'])
    assert.equal(context.normalizePlatformUrl('x', url), '', url);
  assert.equal(context.normalizePlatformUrl('claude', 'https://claude.ai/chat/signup-ideas'), 'https://claude.ai/chat/signup-ideas');
});

function messageHarness(attention) {
  const sent = [], opened = [], frame = { contentWindow: { postMessage: m => sent.push(m) } };
  const state = { loaded: true, attention };
  const context = popupFunctions(['isProviderOrigin', 'releasePendingQuestions', 'onProviderResourceMessage'], { URL, console: { log() {}, warn() {} },
    defaultUrls: { grok: 'https://grok.com/', meta: 'https://www.meta.ai/' },
    providerResources: { state: () => ({ ...state }), update: (_, patch) => Object.assign(state, patch) },
    providerRuntime: { grok: { ready: false, pending: [{ question: 'queued' }], generation: 0 }, meta: { ready: false, pending: [] } },
    iframes: { grok: frame, meta: frame }, compareWatchState: {}, loginWatches: {}, isCurrentSubmissionEvent: () => true, updateStatus() {},
    openProviderLogin: platform => opened.push(platform) });
  const post = (data, origin = 'https://grok.com') => context.onProviderResourceMessage({ source: frame.contentWindow, origin, data: { platform: 'grok', ...data } });
  return { sent, opened, post, frame, context };
}

// A question typed while a provider still needs sign-in must wait for the
// signed-in page; handing it to the sign-in wall loses it.
test('a queued question is not handed to a page that still needs sign-in', () => {
  const { sent, post } = messageHarness('login');
  post({ type: 'AI_READY' });
  assert.deepEqual(sent, []);
  post({ type: 'AI_PROVIDER_ATTENTION', kind: null, message: '' });
  assert.deepEqual(sent.map(m => m.question), ['queued'], 'sent once sign-in is no longer needed');
  post({ type: 'AI_READY' });
  assert.equal(sent.length, 1, 'and only once');
});

test('a queued question still waits for READY when sign-in was never needed', () => {
  const { sent, post } = messageHarness(null);
  post({ type: 'AI_PROVIDER_ATTENTION', kind: null, message: '' });
  assert.deepEqual(sent, []);
  post({ type: 'AI_READY' });
  assert.equal(sent.length, 1);
});

test("only the provider's own page can ask for a sign-in tab", () => {
  const { opened, post, context, frame } = messageHarness('login');
  post({ type: 'AI_OPEN_LOGIN' }, 'https://grok.com');
  post({ type: 'AI_OPEN_LOGIN' }, 'https://accounts.x.ai');
  assert.deepEqual(opened, ['grok', 'grok']);
  for (const origin of ['https://evil.example', 'https://grok.com.evil.example', 'null', '', 'about:blank']) post({ type: 'AI_OPEN_LOGIN' }, origin);
  assert.equal(opened.length, 2);
  context.onProviderResourceMessage({ source: {}, origin: 'https://grok.com', data: { type: 'AI_OPEN_LOGIN', platform: 'grok' } });
  assert.equal(opened.length, 2, 'nor can another window');
  context.onProviderResourceMessage({ source: frame.contentWindow, origin: 'https://meta.ai', data: { type: 'AI_OPEN_LOGIN', platform: 'meta' } });
  assert.deepEqual(opened, ['grok', 'grok', 'meta']);
});
