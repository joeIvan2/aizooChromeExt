'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const locales = ['en', 'zh_TW', 'zh_CN', 'ja', 'es', 'fr', 'de'];
const messages = Object.fromEntries(locales.map(locale => [locale,
  JSON.parse(fs.readFileSync(path.join(root, '_locales', locale, 'messages.json'), 'utf8'))
]));
const english = {
  providerStartupNotice: 'The original site is still loading. You may need to sign in, give consent, or open this view to finish setup. Please check this page.',
  providerUnloadedStatus: 'Not loaded; loads when you send a question or open the original site',
  providerBackToAnswers: 'Back to answers',
  providerSignIn: 'Sign in in a new tab',
  providerLoadingBeforeSend: 'Sending once the original site loads…',
  providerAttentionChallenge: 'Security verification required. Please complete it on the original site.',
  providerAttentionLogin: 'Sign-in required. Please sign in on the original site.',
  providerAttentionConsent: 'Consent required. Please review it on the original site.',
  providerAttentionRateLimit: 'Usage limit reached. Please check the original site for details.',
  providerAttentionError: 'An error occurred on the original site. Please check the page.',
  providerAttentionStartup: 'The page is still initializing. Please open it to finish loading.',
  grokBlockedNotice: 'Grok access is blocked or security verification is required. Please complete verification in the Grok view. Sign-in status cannot be confirmed yet.'
};
const reasonKeys = {
  challenge: 'providerAttentionChallenge', login: 'providerAttentionLogin',
  consent: 'providerAttentionConsent', 'rate-limit': 'providerAttentionRateLimit',
  error: 'providerAttentionError', startup: 'providerAttentionStartup'
};
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function extract(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
function attention(chrome) {
  const context = { chrome, Response };
  vm.runInNewContext(read('content-scripts/provider-attention.js'), context);
  return context.AIZooProviderAttention;
}

for (const locale of locales) test(`${locale}: all ${Object.keys(english).length} provider messages are present and non-empty`, () => {
  for (const key of Object.keys(english)) {
    assert.equal(typeof messages[locale][key]?.message, 'string', `${locale}/${key}`);
    assert.ok(messages[locale][key].message.trim(), `${locale}/${key}`);
  }
});

test('provider attention works without Chrome and uses the English default messages', async () => {
  const api = attention();
  for (const [kind, key] of Object.entries(reasonKeys)) {
    assert.equal(api.reasons[kind], english[key]);
    assert.equal(messages.en[key].message, english[key]);
  }
  assert.equal(api.classify({ challengeVisible: true }).message, english.providerAttentionChallenge);
  assert.equal((await api.classifyResponse(new Response('', { status: 429 }))).message, english.providerAttentionRateLimit);
});

test('content-script notices use Chrome language, independently of the popup preference', async () => {
  for (const locale of locales) {
    const api = attention({ i18n: { getMessage: key => messages[locale][key]?.message || '' } });
    for (const [kind, key] of Object.entries(reasonKeys)) assert.equal(api.reasons[kind], messages[locale][key].message);
    assert.equal(api.classify({ loginForm: true }).message, messages[locale].providerAttentionLogin.message);
    assert.equal((await api.classifyResponse(new Response('', { status: 503 }))).message, messages[locale].providerAttentionError.message);
  }
  assert.equal(attention({ i18n: { getMessage: () => '' } }).classify({ loginForm: true }).message, english.providerAttentionLogin);
});

test('new popup resource messages honor the selected language and fall back to English', () => {
  const source = read('popup.js');
  const context = { selectedLanguageMessages: null };
  vm.runInNewContext(['applySubstitutions', 't'].map(name => extract(source, name)).join('\n'), context);
  for (const locale of locales) {
    context.selectedLanguageMessages = messages[locale];
    context.chrome = { i18n: { getMessage: key => messages.zh_TW[key]?.message || '' } };
    for (const [key, fallback] of Object.entries(english).slice(0, 4)) assert.equal(context.t(key, fallback), messages[locale][key].message);
  }
  context.selectedLanguageMessages = null;
  assert.equal(context.t('providerBackToAnswers', english.providerBackToAnswers), messages.zh_TW.providerBackToAnswers.message);
  delete context.chrome;
  assert.equal(context.t('providerBackToAnswers', english.providerBackToAnswers), english.providerBackToAnswers);
});

test('resource controls and queued status actually use popup lookups', () => {
  const source = read('popup.js');
  const init = extract(source, 'initializeProviderResources');
  assert.match(init, /setAttribute\('data-i18n', 'providerBackToAnswers'\)/, 'the dynamic button must update after async initialization and language switching');
  for (const [name, key] of [
    ['watchProviderStartup', 'providerStartupNotice'],
    ['initializeProviderResources', 'providerUnloadedStatus'],
    ['initializeProviderResources', 'providerBackToAnswers'],
    ['sendQuestionToPlatform', 'providerLoadingBeforeSend']
  ]) assert.ok(extract(source, name).includes(`t('${key}',`), `${name}/${key}`);
  const statuses = [];
  const context = {
    window: {}, console: { log() {} }, isPlatformEnabled: () => true,
    iframes: { grok: { contentWindow: { postMessage() { throw Error('must queue'); } } } },
    activeSubmissionIds: {}, compareWatchState: {}, createSubmissionId: () => 'test',
    providerResources: { update() {} }, providerRuntime: { grok: { ready: false, pending: [] } },
    t: key => `translated:${key}`, updateStatus: (...args) => statuses.push(args), requestPlatformReadyState() {}
  };
  vm.runInNewContext(extract(source, 'sendQuestionToPlatform'), context);
  context.sendQuestionToPlatform('grok', 'Harmless fixture');
  assert.equal(statuses.at(-1)[2], 'translated:providerLoadingBeforeSend');
});

test('Grok blocked notice uses Chrome i18n with an English fallback', () => {
  const source = read('content-scripts/grok-script.js');
  const start = source.indexOf('  function reportBlocked(');
  const fn = source.slice(start, source.indexOf('\n  }', start) + 4);
  for (const locale of [...locales, null]) {
    let sent;
    const context = {
      document: { getElementById: () => null }, LOGIN_OVERLAY_ID: 'fixture', lastAuthenticatedState: null,
      chrome: { i18n: { getMessage: key => locale ? messages[locale][key]?.message || '' : '' } },
      sendMessageToPopup: data => { sent = data; }
    };
    vm.runInNewContext(fn, context);
    context.reportBlocked();
    assert.equal(sent.message, locale ? messages[locale].grokBlockedNotice.message : english.grokBlockedNotice);
  }
});

test('provider UI contains no Chinese literals; language names, detection patterns and comments are excluded', () => {
  const popup = read('popup.js');
  const resourceUI = ['watchProviderStartup', 'initializeProviderResources', 'sendQuestionToPlatform']
    .map(name => extract(popup, name)).join('\n').split('\n')
    .filter(line => !/^\s*(?:\/\/|console\.)/.test(line)).join('\n');
  assert.doesNotMatch(resourceUI, /\p{Script=Han}/u);
  const attentionSource = read('content-scripts/provider-attention.js');
  assert.doesNotMatch(attentionSource.slice(0, attentionSource.indexOf('  function classify(')), /\p{Script=Han}/u);
  const grok = read('content-scripts/grok-script.js');
  const start = grok.indexOf('  function reportBlocked(');
  assert.doesNotMatch(grok.slice(start, grok.indexOf('\n  }', start) + 4), /\p{Script=Han}/u);
  const overlay = grok.indexOf('  function createLoginOverlay(');
  assert.doesNotMatch(grok.slice(overlay, grok.indexOf('\n  }', overlay) + 4).split('\n')
    .filter(line => !/^\s*(?:\/\/|console\.)/.test(line)).join('\n'), /\p{Script=Han}/u);
});
