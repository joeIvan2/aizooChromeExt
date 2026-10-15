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

  const api = Object.freeze({
    normalizeMatchText,
    countExactUserQuestions,
    findAnswerAfterQuestion
  });

  root.AIZooUtils = api;
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
