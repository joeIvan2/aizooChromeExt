'use strict';
// Claude's history drawer needs the chat organization. The page no longer
// leaves it in localStorage, and the browser's resource log (first 250 entries
// only) is full of static files before any organization request is recorded.
const test = require('node:test'), assert = require('node:assert/strict');
const { pickClaudeChatOrganization } = require('../content-scripts/shared-utils');

const CHAT = '11111111-2222-4333-8444-555555555555', API = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

test('the organization that can chat is chosen over an API-only one, whatever the order', () => {
  const list = [{ uuid: API, capabilities: ['api'] }, { uuid: CHAT, capabilities: ['claude_max', 'chat'] }];
  assert.equal(pickClaudeChatOrganization(list), CHAT);
  assert.equal(pickClaudeChatOrganization(list.slice().reverse()), CHAT);
});

test('without capability information the first valid organization is used', () => {
  assert.equal(pickClaudeChatOrganization([{ uuid: 'not-a-uuid' }, { uuid: API }]), API);
});

test('unusable responses give no organization instead of throwing', () => {
  for (const value of [null, undefined, {}, [], [{}], [{ uuid: 'x' }], 'text']) assert.equal(pickClaudeChatOrganization(value), '');
});
