// gemini-script.js - Gemini 專用腳本
(function() {
  'use strict';

  if (window.parent !== window && window.parent !== window.top) return;

  console.log('[Gemini] Content script initializing...');

  const config = window.PLATFORM_CONFIGS.gemini;

  if (window.parent !== window) window.InjectionCore.setupUrlMonitor(config);

  // 監聽來自 popup 的消息
  window.addEventListener('message', async (event) => {
    const data = event.data;

    // 檢查消息來源和類型
    if (!data || typeof data !== 'object') return;
    if (data.source !== 'popup') return;

    console.log('[Gemini] Received message:', data);

    if (data.type === 'AI_SUBMIT_QUESTION' && data.platform === 'gemini') {
      console.log('[Gemini] Received submit question command:', data.question);
      await window.InjectionCore.enqueueQuestion(config, data.question, {
        submissionId: data.submissionId
      });
    }

    if (data.type === 'AI_NEW_CHAT' && data.platform === 'gemini') {
      console.log('[Gemini] Starting new chat...');
      window.InjectionCore.cancelOperations(config);
      window.location.href = 'https://gemini.google.com/app';
    }

    if (data.type === 'AI_CANCEL_OPERATIONS' && data.platform === 'gemini') {
      window.InjectionCore.cancelOperations(config);
    }

    if (data.type === 'AI_READY_CHECK' && data.platform === 'gemini') {
      if (hasUsableChatInput()) notifyReady();
    }

    if (data.type === 'AI_SCRAPE_HISTORY_REQUEST' && data.platform === 'gemini') {
      console.log('[Gemini] Received scrape history request');
      let history = [];
      try {
        history = await window.InjectionCore.scrapeHistory(config, data.timeoutMs || 1500);
      } catch (e) {
        console.error('[Gemini] Scrape history error:', e);
      }
      if (window.parent !== window) {
        window.parent.postMessage({
          type: 'AI_SCRAPE_HISTORY_RESPONSE',
          platform: 'gemini',
          requestId: data.requestId,
          navigationEpoch: data.navigationEpoch,
          history: history,
          isGenerating: window.InjectionCore.isGenerating(config),
          source: 'content-script'
        }, '*');
      }
    }
  });

  function notifyReady() {
    if (window.parent === window) return;

    window.parent.postMessage({
      type: 'AI_READY',
      platform: 'gemini',
      source: 'content-script'
    }, '*');
  }

  function hasUsableChatInput() {
    try {
      return !!config.detectTextarea();
    } catch (error) {
      return false;
    }
  }

  const startReadyCheck = () => {
    const checkReady = () => {
      if (!hasUsableChatInput()) return false;
      notifyReady();
      return true;
    };

    // Run after the parent iframe load handler, then wait for Gemini's dynamic composer.
    setTimeout(() => {
      if (checkReady()) return;

      const intervalId = setInterval(() => {
        if (checkReady()) {
          clearInterval(intervalId);
        }
      }, 500);
      setTimeout(() => clearInterval(intervalId), 30000);
    }, 100);
  };

  if (document.readyState === 'complete') {
    startReadyCheck();
  } else {
    window.addEventListener('load', startReadyCheck, { once: true });
  }

  console.log('[Gemini] Content script loaded');
})();
