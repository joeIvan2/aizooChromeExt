// shared-utils.js - pure helpers shared by the popup and provider adapters
(function(root) {
  'use strict';

  function normalizeMatchText(value) {
    return String(value || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function countExactUserQuestions(history, question) {
    const target = normalizeMatchText(question);
    if (!target || !Array.isArray(history)) return 0;

    return history.reduce((count, message) => {
      if (!message || message.role !== 'user') return count;
      return count + (normalizeMatchText(message.content) === target ? 1 : 0);
    }, 0);
  }

  /**
   * Find the first exact user turn added after baselineOccurrences, then return
   * only an assistant answer belonging to that turn. Stopping at the next user
   * turn prevents a delayed watcher from claiming a later question's answer.
   */
  function findAnswerAfterQuestion(history, question, baselineOccurrences) {
    const target = normalizeMatchText(question);
    const baseline = Math.max(0, Number(baselineOccurrences) || 0);
    if (!target || !Array.isArray(history)) {
      return { questionIndex: -1, answer: null };
    }

    let seen = 0;
    let questionIndex = -1;
    for (let index = 0; index < history.length; index += 1) {
      const message = history[index];
      if (!message || message.role !== 'user') continue;
      if (normalizeMatchText(message.content) !== target) continue;

      if (seen >= baseline) {
        questionIndex = index;
        break;
      }
      seen += 1;
    }

    if (questionIndex < 0) return { questionIndex: -1, answer: null };

    let answer = null;
    for (let index = questionIndex + 1; index < history.length; index += 1) {
      const message = history[index];
      if (!message) continue;
      if (message.role === 'user') break;
      if (message.role === 'assistant' && String(message.content || '').trim()) {
        answer = message;
      }
    }

    return { questionIndex, answer };
  }

  async function classifyGrokAuthResponse(response) {
    try {
      if (response.headers.get('cf-mitigated') === 'challenge') return 'blocked';
      const body = await response.clone().text();
      const isHTML = /text\/html/i.test(response.headers.get('content-type') || '');
      if (isHTML && /cloudflare|challenge-platform|just a moment|正在執行安全驗證|請稍候/i.test(body)) return 'blocked';
      let data;
      if (!isHTML) { try { data = JSON.parse(body); } catch {} }
      if (response.ok && data?.status === 'authenticated' && data.session) return 'authenticated';
      if (data?.status === 'unauthenticated' || data?.status === 'unauthorized') return 'logged-out';
      if (response.status === 401) return 'logged-out';
      // A generic 403 is insufficient evidence of logout; leave the challenge visible.
      if (response.status === 403) return 'blocked';
    } catch {}
    return 'unknown';
  }

  // From Claude's organization list: the one that can chat (an account can
  // also hold an API-only organization, which has no conversations).
  function pickClaudeChatOrganization(list) {
    if (!Array.isArray(list)) return '';
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const valid = list.filter(item => item && uuid.test(item.uuid || ''));
    const chat = valid.find(item => Array.isArray(item.capabilities) && item.capabilities.includes('chat'));
    return (chat || valid[0])?.uuid || '';
  }

  // Rich editors add or drop whitespace (around auto-linked URLs, between
  // lines), so the pre-send check compares everything except whitespace.
  function sameTextIgnoringWhitespace(a, b) {
    const strip = value => String(value ?? '').replace(/\s+/g, '');
    return strip(a) === strip(b);
  }

  const api = Object.freeze({
    pickClaudeChatOrganization,
    sameTextIgnoringWhitespace,
    normalizeMatchText,
    countExactUserQuestions,
    findAnswerAfterQuestion,
    classifyGrokAuthResponse
  });

  root.AIZooUtils = api;
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
