'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createController } = require('../provider-resources');
const { classify } = require('../content-scripts/provider-attention');
test('HTTP fixtures distinguish challenges, confirmed logout, rate limit and generic denial', async () => {
  const { classifyResponse } = require('../content-scripts/provider-attention');
  for (const [response, kind] of [
    [new Response('', { status: 403, headers: { 'cf-mitigated': 'challenge' } }), 'challenge'],
    [new Response('<html>Just a moment... Cloudflare</html>', { status: 503, headers: { 'content-type': 'text/html' } }), 'challenge'],
    [new Response('{}', { status: 401 }), 'login'], [new Response('{}', { status: 403 }), 'error'],
    [new Response('{}', { status: 429 }), 'rate-limit'], [new Response('{}', { status: 503 }), 'error'],
    [new Response('{}', { status: 200 }), null]
  ]) assert.equal((await classifyResponse(response))?.kind || null, kind);
});

test('unused and disabled providers never load; viewing or sending loads once', () => {
  const calls = [], c = createController(['a', 'b'], { load: p => calls.push(['load', p]), unload: p => calls.push(['unload', p]) });
  c.update('a', { enabled: true, viewed: false }); c.update('b', { enabled: false, viewed: true });
  assert.deepEqual(calls, []);
  c.use('a'); c.use('a'); assert.deepEqual(calls, [['load', 'a']]);
  c.update('a', { enabled: false }); assert.deepEqual(calls.at(-1), ['unload', 'a']);
  c.update('b', { enabled: true }); assert.deepEqual(calls.at(-1), ['load', 'b']);
});
test('idle unloading protects viewed, generating, pending and attention pages; reuse reloads state', () => {
  let now = 0; const calls = [];
  const c = createController(['a'], { now: () => now, idleMs: 100, load: p => calls.push('load'), unload: p => calls.push('unload') });
  c.update('a', { enabled: true, viewed: true });
  now = 200; c.sweep(); assert.equal(c.state('a').loaded, true);
  c.update('a', { viewed: false, busy: true }); now = 400; c.sweep(); assert.equal(c.state('a').loaded, true);
  c.update('a', { busy: false, attention: 'challenge' }); now = 600; c.sweep(); assert.equal(c.state('a').loaded, true);
  c.update('a', { attention: null }); now = 701; c.sweep(); assert.equal(c.state('a').loaded, false);
  c.use('a'); assert.deepEqual(calls, ['load', 'unload', 'load']);
});
test('render suspension requires network ownership and loses to view, fallback or attention', () => {
  const c = createController(['a']); c.update('a', { enabled: true }); c.use('a');
  assert.equal(c.state('a').suspended, false);
  c.update('a', { network: true }); assert.equal(c.state('a').suspended, true);
  for (const patch of [{ viewed: true }, { viewed: false, attention: 'login' }, { attention: null, network: false }]) {
    c.update('a', patch); assert.equal(c.state('a').suspended, false);
  }
});
test('manual idle release never unloads a pending answer, human screen, or viewed page', () => {
  const c = createController(['a']); c.update('a', { enabled: true }); c.use('a');
  for (const patch of [{ busy: true }, { busy: false, attention: 'login' }, { attention: null, viewed: true }]) {
    c.update('a', patch); assert.equal(c.release('a'), false);
  }
  c.update('a', { viewed: false }); assert.equal(c.release('a'), true); assert.equal(c.state('a').loaded, false);
});
for (const provider of ['grok', 'gemini', 'claude', 'chatgpt', 'meta']) {
  test(`${provider}: challenge, login, consent, rate limit and error fixtures; no prompt false positives`, () => {
    for (const [sample, reason] of [
      [{ title: 'Just a moment...', pageText: 'Performing security verification' }, 'challenge'],
      [{ challengeVisible: true, composer: true }, 'challenge'],
      [{ loginForm: true }, 'login'],
      [{ dialogText: 'Before you continue, please accept the terms' }, 'consent'],
      [{ alertText: 'Too many requests. Try again later.' }, 'rate-limit'],
      [{ alertText: 'Something went wrong. Please retry.' }, 'error'],
      [{ composer: true, pageText: 'User asks: verify you are human; too many requests; log in', captchaScript: true }, null],
      [{ composer: true, loginLink: true, hiddenChallenge: true }, null],
      [{ composer: true, title: 'How to verify you are human online' }, null],
      [{ composer: true, dialogText: 'You can accept settings in the privacy terms', consentAction: false }, null],
      [{ composer: true, dialogText: 'Before you continue, accept the terms', consentAction: true }, 'consent'],
      [{ composer: false, pageText: '' }, null]
    ]) assert.equal(classify({ provider, ...sample })?.kind || null, reason);
  });
}
test('real URL login walls are distinguished from incidental account subframes', () => {
  assert.equal(classify({ url: 'https://accounts.google.com/ServiceLogin' }).kind, 'login');
  assert.equal(classify({ url: 'https://www.meta.ai/login' }).kind, 'login');
  assert.equal(classify({ url: 'https://gemini.google.com/app', composer: true, pageText: 'Sign in' }), null);
});
test('HTML does not eagerly navigate disabled providers before settings load', () => {
  const html = fs.readFileSync(require.resolve('../popup.html'), 'utf8');
  const tags = html.match(/<iframe id="\w+-iframe"[^>]*>/g);
  assert.equal(tags.length, 5); tags.forEach(t => assert.doesNotMatch(t, /\ssrc="https:/));
});

test('network owner detaches DOM interval/observer and immediately reattaches on failure', () => {
  const intervals = new Map(), observers = []; let n = 0, reads = 0, snapshot = null;
  const window = { AIZooUtils: require('../content-scripts/shared-utils'), postMessage() {}, __aiNetworkSources: { grok: { snapshot: () => snapshot, cancel() {} } } }; window.parent = window;
  vm.runInNewContext(fs.readFileSync(require.resolve('../content-scripts/injection-core'), 'utf8'), {
    window, document: { body: {} }, Date, console: { log() {}, error() {} },
    setInterval(cb) { intervals.set(++n, cb); return n; }, clearInterval(id) { intervals.delete(id); },
    MutationObserver: class { constructor(cb) { this.cb = cb; observers.push(this); } observe() { this.connected = true; } disconnect() { this.connected = false; } }
  });
  const config = { id: 'grok', responseObserveMutations: true, scrapeHistory() { reads++; return []; }, detectGenerating: () => false };
  window.InjectionCore.watchResponseLifecycle(config, 'q', { submissionId: 's' });
  snapshot = { text: 'streaming', submissionId: 's', complete: false };
  const w = window.__aiResponseLifecycleWatchers.grok; w.checkResponse(false);
  assert.equal(intervals.size, 0); assert.equal(observers.at(-1).connected, false);
  const before = reads; observers.at(-1).cb(); assert.equal(reads, before);
  snapshot = null; w.checkResponse(false);
  assert.equal(intervals.size, 1); assert.equal(observers.at(-1).connected, true);
  window.InjectionCore.cancelOperations(config); assert.equal(intervals.size, 0);
});
test('cold submissions retain FIFO until READY and cancel removes pending sends', () => {
  const source = fs.readFileSync(require.resolve('../popup.js'), 'utf8');
  const extract = name => { const start = source.indexOf(`function ${name}(`); return source.slice(start, source.indexOf('\n}', start + 1) + 2); };
  const sent = [], frame = { contentWindow: { postMessage: m => sent.push(m) } };
  const context = {
    window: {}, console: { log() {}, warn() {} }, document: {},
    providerResources: { state: () => ({ loaded: true }), update() {} },
    providerRuntime: { grok: { ready: false, pending: [], generation: 0 } },
    iframes: { grok: frame }, activeSubmissionIds: {}, compareWatchState: {}, loginWatches: {},
    isPlatformEnabled: () => true, isCurrentSubmissionEvent: () => true, createSubmissionId: () => 's', updateStatus() {}, t: (_, s) => s, requestPlatformReadyState() {}
  };
  vm.runInNewContext(['sendQuestionToPlatform', 'onProviderResourceMessage', 'cancelPlatformOperation'].map(extract).join('\n'), context);
  context.sendQuestionToPlatform('grok', 'first'); context.sendQuestionToPlatform('grok', 'second');
  assert.equal(context.providerRuntime.grok.pending.length, 2); assert.equal(sent.length, 0);
  context.onProviderResourceMessage({ source: frame.contentWindow, data: { type: 'AI_READY', platform: 'grok' } });
  assert.deepEqual(sent.map(m => m.question), ['first', 'second']);
  context.providerRuntime.grok.ready = false; context.sendQuestionToPlatform('grok', 'cancelled');
  context.cancelPlatformOperation('grok');
  context.onProviderResourceMessage({ source: frame.contentWindow, data: { type: 'AI_READY', platform: 'grok' } });
  assert.equal(sent.filter(m => m.question === 'cancelled').length, 0);
});
test('restoring a session never navigates an unloaded or disabled provider', () => {
  const source = fs.readFileSync(require.resolve('../popup.js'), 'utf8'), start = source.indexOf('function navigateProvider(');
  assert.notEqual(start, -1);
  const context = { providerResources: { state: () => ({ loaded: false }), update() {} }, providerRuntime: { grok: {} }, iframes: { grok: { src: 'about:blank' } }, isPlatformEnabled: () => true };
  vm.runInNewContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
  context.navigateProvider('grok', 'https://grok.com/'); assert.equal(context.iframes.grok.src, 'about:blank');
  context.providerResources.state = () => ({ loaded: true }); context.isPlatformEnabled = () => false;
  context.navigateProvider('grok', 'https://grok.com/'); assert.equal(context.iframes.grok.src, 'about:blank');
  context.isPlatformEnabled = () => true; context.navigateProvider('grok', 'https://grok.com/'); assert.equal(context.iframes.grok.src, 'https://grok.com/');
});
test('a loaded iframe navigating outside permitted origins loses READY and remains rendered', () => {
  const source = fs.readFileSync(require.resolve('../popup.js'), 'utf8'), start = source.indexOf('function handleProviderFrameLoad('), patches = [];
  const context = { loginWatches: {}, providerResources: { state: () => ({ loaded: true }), update: (_, patch) => patches.push(patch) }, providerRuntime: { gemini: { ready: true } },
    watchProviderStartup(p) { context.providerRuntime[p].ready = false; }, requestPlatformReadyState() {}, updateStatus() {}, t: (_, text) => text,
    isComparePanelVisible: () => false, console: { log() {} }, setTimeout() {} };
  vm.runInNewContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
  context.handleProviderFrameLoad('gemini'); assert.equal(context.providerRuntime.gemini.ready, false); assert.equal(patches.at(-1).network, false);
});
test('SPA navigation saves the actual conversation URL without a single poll tick', () => {
  const listeners = {}, messages = [], location = { origin: 'https://chatgpt.com', href: 'https://chatgpt.com/' };
  const window = { postMessage: m => messages.push(m), addEventListener(type, cb) { (listeners[type] ||= []).push(cb); } }; window.parent = window;
  vm.runInNewContext(fs.readFileSync(require.resolve('../content-scripts/injection-core'), 'utf8'), {
    window, location, history: { pushState() {}, replaceState() {} }, console: { log() {} }, setInterval() {}
  });
  window.InjectionCore.setupUrlMonitor({ id: 'chatgpt' }); location.href = 'https://chatgpt.com/c/test-conversation';
  const pulse = { source: window, origin: location.origin, data: { source: 'ai-zoo-page-state-v1', provider: 'chatgpt', kind: 'navigation' } };
  listeners.message.forEach(cb => cb(pulse));
  assert.equal(messages.length, 1);assert.equal(messages[0].type, 'AI_URL_CHANGED');assert.equal(messages[0].url, location.href);
});
test('human UI remains detectable when the extension removes the outer iframe layout box', () => {
  const { isVisible } = require('../content-scripts/provider-attention');
  const el = { closest: () => null, getBoundingClientRect: () => ({ width: 0, height: 0 }), parentElement: null };
  const doc = { documentElement: { clientWidth: 0, clientHeight: 0 } };
  const style = { display: 'block', visibility: 'visible', opacity: '1', width: '300px', height: '65px' };
  assert.equal(isVisible(el, doc, () => style), true);
  assert.equal(isVisible(el, doc, () => ({ ...style, opacity: '0' })), false);
  assert.equal(isVisible(el, doc, () => ({ ...style, display: 'none' })), false);
  assert.equal(isVisible(el, doc, () => ({ ...style, clipPath: 'inset(50%)' })), false);
  assert.equal(isVisible(el, { documentElement: { clientWidth: 300, clientHeight: 680 } }, () => style), false);
});
test('a delayed DOM history reply cannot replace an authoritative completed answer with pending UI', () => {
  const source=fs.readFileSync(require.resolve('../popup.js'),'utf8'),start=source.indexOf('function updateCompareFromHistory('),renders=[];
  const state={question:'q',baselineOccurrences:0,sent:true,complete:true,protocolComplete:true,lastAnswerText:'real completed answer'};
  const context={compareWatchState:{grok:state},findQuestionAnswer:require('../content-scripts/shared-utils').findAnswerAfterQuestion,Date,renderTrackedCompareHistory:(...args)=>renders.push(args),t:(_,s)=>s};
  vm.runInNewContext(source.slice(start,source.indexOf('\n}',start)+2),context);
  context.updateCompareFromHistory('grok',[],false,{});
  assert.equal(renders.length,0);assert.equal(state.complete,true);assert.equal(state.lastAnswerText,'real completed answer');
});
test('history reply samples the network history and its metadata together after an async DOM scrape', () => {
  const window={postMessage(){}};window.parent=window;
  vm.runInNewContext(fs.readFileSync(require.resolve('../content-scripts/injection-core'),'utf8'),{window,console:{log(){}}});
  const core=window.InjectionCore,current=[{role:'assistant',content:'latest network text'}],config={id:'grok',scrapeHistory:()=>current};
  window.__aiNetworkSources={grok:{snapshot:()=>({text:'latest network text',complete:true})}};
  const reply=core.buildHistoryResponse(config,[]);
  assert.equal(reply.history,current);assert.equal(reply.sourceKind,'network');assert.equal(reply.isComplete,true);assert.equal(reply.isGenerating,false);
});

test('an idle provider is released automatically only after thirty minutes by default', () => {
  let now = 0; const calls = [];
  const c = require('../provider-resources.js').createController(['a'], { now: () => now, load: () => calls.push('load'), unload: () => calls.push('unload') });
  c.update('a', { enabled: true }); c.use('a');
  now = 29 * 60 * 1000; c.sweep(); assert.deepEqual(calls, ['load']);
  now = 30 * 60 * 1000; c.sweep(); assert.deepEqual(calls, ['load', 'unload']);
});

test('a page that still has to be read is not hidden, and unloading forgets that', () => {
  const { createController } = require('../provider-resources');
  const controller = createController(['grok'], {});
  controller.update('grok', { enabled: true });
  controller.use('grok');
  controller.update('grok', { network: true, reading: true });
  assert.equal(controller.state('grok').suspended, false);
  controller.update('grok', { reading: false });
  assert.equal(controller.state('grok').suspended, true);
  controller.update('grok', { reading: true, enabled: false });
  assert.equal(controller.state('grok').reading, false);
});

// Claude's send button finishes an animation after a cold load. A page that is
// not drawn runs no animation, so the button never became usable.
test('a provider that is sending a question stays drawn until it has answered', () => {
  const { createController } = require('../provider-resources');
  const controller = createController(['claude'], {});
  controller.update('claude', { enabled: true });
  controller.use('claude');
  controller.update('claude', { network: true, busy: true });
  assert.equal(controller.state('claude').suspended, false);
  controller.update('claude', { busy: false });
  assert.equal(controller.state('claude').suspended, true);
});

// Three logged-out providers each covered the whole window, stacked on top of
// each other: only the last one could be seen and nothing else could be used.
test('a provider that needs the user stays in its own column while that column is on screen', () => {
  const { createController } = require('../provider-resources');
  const controller = createController(['claude', 'chatgpt', 'meta'], {});
  for (const p of ['claude', 'chatgpt', 'meta']) { controller.update(p, { enabled: true, viewed: true }); controller.update(p, { attention: 'login' }); }
  assert.deepEqual(['claude', 'chatgpt', 'meta'].map(p => controller.state(p).overlay), [false, false, false]);
});

test('when the columns are not on screen, only one provider at a time covers the window', () => {
  const { createController } = require('../provider-resources');
  const shown = {};
  const controller = createController(['claude', 'chatgpt', 'meta'], { render: (p, s) => { shown[p] = s.overlay; } });
  for (const p of ['claude', 'chatgpt', 'meta']) { controller.update(p, { enabled: true }); controller.use(p); }
  controller.update('chatgpt', { attention: 'challenge' });
  controller.update('meta', { attention: 'challenge' });
  assert.deepEqual(shown, { claude: false, chatgpt: true, meta: false });
  controller.update('chatgpt', { attention: null });
  assert.deepEqual(shown, { claude: false, chatgpt: false, meta: true }, 'the next one takes its place');
  controller.update('meta', { viewed: true });
  assert.deepEqual(shown, { claude: false, chatgpt: false, meta: false });
});

test('a provider that only needs sign-in never covers the window', () => {
  const { createController } = require('../provider-resources');
  const controller = createController(['claude', 'meta'], {});
  for (const p of ['claude', 'meta']) { controller.update(p, { enabled: true }); controller.use(p); }
  controller.update('claude', { attention: 'login' });
  controller.update('meta', { attention: 'challenge' });
  assert.equal(controller.state('claude').overlay, false);
  assert.equal(controller.state('meta').overlay, true);
});
