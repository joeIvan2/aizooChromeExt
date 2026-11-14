'use strict';
// Grok's cookie notice came back on every open: inside the extension the page
// cannot read the cookie that says the notice was answered. The extension now
// remembers the choice (accept or reject) and hides the notice only after one
// was made.
const test = require('node:test'), assert = require('node:assert/strict');
const { classifyCookieChoice, readCookieChoice, COOKIE_CHOICE_KEY } = require('../content-scripts/shared-utils');

const storage = items => ({ getItem: key => (key in items ? items[key] : null) });

test('accept and reject buttons are told apart in the languages Grok shows', () => {
  for (const text of ['接受所有 Cookie', 'Accept all cookies', 'Accept All', 'すべて許可', 'Aceptar todas', 'Tout accepter', 'Alle akzeptieren', '接受所有']) assert.equal(classifyCookieChoice(text), 'accept', text);
  for (const text of ['全部拒絕', '全部拒绝', 'Reject all', 'すべて拒否', 'Rechazar todas', 'Tout refuser', 'Alle ablehnen']) assert.equal(classifyCookieChoice(text), 'reject', text);
});

test('other buttons are not a choice', () => {
  for (const text of ['Cookie 设置', 'Cookie settings', 'Manage', '', null, '×']) assert.equal(classifyCookieChoice(text), '', String(text));
});

test('the remembered choice is returned, accept or reject', () => {
  assert.equal(readCookieChoice(storage({ [COOKIE_CHOICE_KEY]: 'accept' })), 'accept');
  assert.equal(readCookieChoice(storage({ [COOKIE_CHOICE_KEY]: 'reject' })), 'reject');
});

test('a choice Grok itself stored earlier counts as answered', () => {
  assert.equal(readCookieChoice(storage({ _ca_consent: '{"analytics_consent":true,"advertising_consent":true}' })), 'accept');
  assert.equal(readCookieChoice(storage({ _ca_consent: '{"analytics_consent":false,"advertising_consent":false}' })), 'reject');
  assert.equal(readCookieChoice(storage({ _ca_consent: '{"analytics_consent":true,"advertising_consent":false}' })), 'custom');
});

test('with no choice on record the notice must stay visible', () => {
  assert.equal(readCookieChoice(storage({})), '');
  assert.equal(readCookieChoice(storage({ _ca_consent: 'not json' })), '');
  assert.equal(readCookieChoice(storage({ _ca_consent: '{}' })), '');
  assert.equal(readCookieChoice(storage({ [COOKIE_CHOICE_KEY]: 'whatever' })), '');
  assert.equal(readCookieChoice({ getItem() { throw new Error('blocked'); } }), '');
  assert.equal(readCookieChoice(null), '');
});
