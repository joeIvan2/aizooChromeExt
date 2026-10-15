'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const utils = require(path.join(root, 'content-scripts', 'shared-utils.js'));

function loadPlatformConfig(documentStub = {}) {
  const source = fs.readFileSync(
    path.join(root, 'content-scripts', 'platforms-config.js'),
    'utf8'
  );
  const window = {};
  const context = {
    URL,
    console: { log() {}, warn() {}, error() {} },
    document: {
      querySelector: () => null,
      querySelectorAll: () => [],
      ...documentStub
    },
    location: { href: 'https://www.meta.ai/' },
    window
  };
  vm.runInNewContext(source, context, { filename: 'platforms-config.js' });
  return window;
}

function loadInjectionCore() {
  const source = fs.readFileSync(
    path.join(root, 'content-scripts', 'injection-core.js'),
    'utf8'
  );
  const window = {
    AIZooUtils: utils,
    postMessage() {}
  };
  window.parent = window;
  const fastTimeout = (callback, delay = 0) => setTimeout(callback, Math.min(delay, 5));
  const context = {
    Date,
    Request,
    TextDecoder,
    chrome: { i18n: { getMessage: () => '' } },
    clearInterval,
    clearTimeout,
    console: { log() {}, warn() {}, error() {} },
    setInterval,
    setTimeout: fastTimeout,
    window
  };
  vm.runInNewContext(source, context, { filename: 'injection-core.js' });
  return window;
}

test('a short question never binds to an older longer question', () => {
  const history = [
    { role: 'user', content: 'yes please continue' },
    { role: 'assistant', content: 'old answer' }
  ];

  assert.deepEqual(utils.findAnswerAfterQuestion(history, 'yes', 0), {
    questionIndex: -1,
    answer: null
  });
});

test('a repeated question binds to the exact occurrence after its baseline', () => {
  const history = [
    { role: 'user', content: 'same question' },
    { role: 'assistant', content: 'first answer' },
    { role: 'user', content: 'same question' },
    { role: 'assistant', content: 'second answer draft' },
    { role: 'assistant', content: 'second answer final' },
    { role: 'user', content: 'third question' },
    { role: 'assistant', content: 'must not be claimed' }
  ];

  const result = utils.findAnswerAfterQuestion(history, 'same question', 1);
  assert.equal(result.questionIndex, 2);
  assert.equal(result.answer.content, 'second answer final');
  assert.equal(utils.countExactUserQuestions(history, 'same question'), 2);
});

test('scraped answers retain code indentation and intentional blank lines', () => {
  const { AIZooPlatformUtils } = loadPlatformConfig();
  const cleaned = AIZooPlatformUtils.cleanScrapedHistoryText(
    'Copy\nfunction answer() {\n  const value = 1;\n    return value;\n}\n\nExplanation follows.\nShare'
  );

  assert.equal(
    cleaned,
    'function answer() {\n  const value = 1;\n    return value;\n}\n\nExplanation follows.'
  );
});

test('Meta AI treats a cancelled latest response as terminal', () => {
  const previous = {
    getAttribute(name) {
      if (name === 'data-streaming-complete') return 'false';
      if (name === 'data-streaming-state') return 'streaming';
      return null;
    }
  };
  const latest = {
    getAttribute(name) {
      if (name === 'data-streaming-complete') return 'false';
      if (name === 'data-streaming-state') return 'cancelled';
      return null;
    }
  };
  const { PLATFORM_CONFIGS } = loadPlatformConfig({
    querySelector: () => null,
    querySelectorAll: selector => selector === '[data-testid="assistant-message"]'
      ? [previous, latest]
      : []
  });

  assert.equal(PLATFORM_CONFIGS.meta.detectGenerating(), false);
});

test('Meta AI history recognizes the current group/user-message markup', () => {
  const makeContent = text => ({
    nodeType: 1,
    tagName: 'DIV',
    childNodes: [{ nodeType: 3, textContent: text }],
    parentElement: null,
    matches: () => false,
    closest: () => null,
    innerText: text,
    textContent: text,
    querySelectorAll: () => []
  });
  const userContent = makeContent('Meta user question');
  const assistantContent = makeContent('Meta assistant answer');
  const user = {
    classList: { contains: value => value === 'group/user-message' },
    getAttribute: () => null,
    querySelector: selector => selector.includes('text-response') ? userContent : null,
    querySelectorAll: () => []
  };
  const assistant = {
    matches: () => false,
    classList: { contains: () => false },
    getAttribute: name => name === 'data-testid' ? 'assistant-message' : null,
    querySelector: selector => selector === '.ur-markdown' ? assistantContent : null,
    querySelectorAll: selector => selector.includes('.ur-markdown') ? [assistantContent] : []
  };
  const { PLATFORM_CONFIGS } = loadPlatformConfig({
    querySelectorAll: selector => selector.includes('group/user-message')
      ? [user, assistant]
      : []
  });

  const history = PLATFORM_CONFIGS.meta.scrapeHistory();
  assert.equal(history.length, 2);
  assert.equal(history[0].role, 'user');
  assert.equal(history[0].content, 'Meta user question');
  assert.equal(history[1].role, 'assistant');
  assert.equal(history[1].content, 'Meta assistant answer');
});

test('every isolated platform script loads shared matching helpers first', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const isolatedPlatformEntries = manifest.content_scripts.filter(entry =>
    entry.js.includes('content-scripts/injection-core.js')
  );

  assert.equal(manifest.minimum_chrome_version, '130');
  assert.equal(isolatedPlatformEntries.length, 5);
  isolatedPlatformEntries.forEach(entry => {
    assert.equal(entry.js[0], 'content-scripts/shared-utils.js');
  });
});

test('response tracking has no fixed inactivity failure and keeps diagnostics non-fatal', () => {
  const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
  const core = fs.readFileSync(path.join(root, 'content-scripts', 'injection-core.js'), 'utf8');

  assert.doesNotMatch(popup, /COMPARE_INACTIVITY_TIMEOUT_MS/);
  assert.doesNotMatch(core, /maxRetries\s*=\s*30/);
  assert.doesNotMatch(core, /maxVerifyRetries/);
  assert.match(core, /AI_NETWORK_DIAGNOSTIC_ERROR/);
  assert.doesNotMatch(core, /includes\(normalizedQuestion\)/);
});

test('per-platform submissions remain FIFO until the previous lifecycle settles', async () => {
  const window = loadInjectionCore();
  const core = window.InjectionCore;
  const config = { id: 'chatgpt' };
  const submitted = [];

  core.submitQuestion = async (_config, question) => {
    submitted.push(question);
    if (question === 'first') {
      window.__aiResponseLifecycleWatchers = {
        chatgpt: { completedNotified: false, timer: null }
      };
    }
    return true;
  };

  await core.enqueueQuestion(config, 'first', { submissionId: 'one' });
  const second = core.enqueueQuestion(config, 'second', { submissionId: 'two' });
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.deepEqual(submitted, ['first']);

  window.__aiResponseLifecycleWatchers.chatgpt.completedNotified = true;
  await second;
  assert.deepEqual(submitted, ['first', 'second']);
});

test('cancelling a platform releases its queue without sending stale work', async () => {
  const window = loadInjectionCore();
  const core = window.InjectionCore;
  const config = { id: 'meta' };
  let submitted = false;

  window.__aiResponseLifecycleWatchers = {
    meta: { completedNotified: false, timer: null }
  };
  core.submitQuestion = async () => {
    submitted = true;
    return true;
  };

  const pending = core.enqueueQuestion(config, 'stale question', { submissionId: 'stale' });
  core.cancelOperations(config);
  assert.equal(await pending, false);
  assert.equal(submitted, false);
});

test('locale catalogs stay aligned and all manifest files exist', () => {
  const localesRoot = path.join(root, '_locales');
  const localeNames = fs.readdirSync(localesRoot);
  const catalogs = localeNames.map(locale => JSON.parse(
    fs.readFileSync(path.join(localesRoot, locale, 'messages.json'), 'utf8')
  ));
  const expectedKeys = Object.keys(catalogs[0]).sort();
  catalogs.forEach(catalog => assert.deepEqual(Object.keys(catalog).sort(), expectedKeys));

  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const referencedFiles = [
    manifest.background.service_worker,
    manifest.declarative_net_request.rule_resources[0].path,
    ...manifest.content_scripts.flatMap(entry => entry.js),
    ...Object.values(manifest.icons),
    manifest.action.default_icon['16'],
    manifest.action.default_icon['48'],
    manifest.action.default_icon['128']
  ];
  referencedFiles.forEach(file => {
    assert.equal(fs.existsSync(path.join(root, file)), true, `missing manifest file: ${file}`);
  });
});
