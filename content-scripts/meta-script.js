// meta-script.js - Meta AI platform adapter
(function() {
  'use strict';

  if (location.hostname !== 'meta.ai' && location.hostname !== 'www.meta.ai') return;
  if (window.parent !== window && window.parent !== window.top) return;

  console.log('[Meta AI] Content script initializing...');

  const config = window.PLATFORM_CONFIGS.meta;
  if (window.parent !== window) window.InjectionCore.setupUrlMonitor(config);

  window.addEventListener('message', async (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object' || data.source !== 'popup') return;

    console.log('[Meta AI] Received message:', data.type);

    if (data.type === 'AI_SUBMIT_QUESTION' && data.platform === 'meta') {
      await window.InjectionCore.enqueueQuestion(config, data.question, {
        submissionId: data.submissionId
      });
    }

    if (data.type === 'AI_NEW_CHAT' && data.platform === 'meta') {
      window.InjectionCore.cancelOperations(config);
      window.location.href = 'https://www.meta.ai/';
    }

    if (data.type === 'AI_CANCEL_OPERATIONS' && data.platform === 'meta') {
      window.InjectionCore.cancelOperations(config);
    }

    if (data.type === 'AI_READY_CHECK' && data.platform === 'meta') {
      notifyReadyWhenUsable(true);
    }

    if (data.type === 'AI_SCRAPE_HISTORY_REQUEST' && data.platform === 'meta') {
      let history = [];
      try {
        history = await window.InjectionCore.scrapeHistory(config, data.timeoutMs || 1500);
      } catch (error) {
        console.error('[Meta AI] Scrape history error:', error);
      }

      if (window.parent !== window) {
        window.parent.postMessage({
          type: 'AI_SCRAPE_HISTORY_RESPONSE',
          platform: 'meta',
          requestId: data.requestId,
          navigationEpoch: data.navigationEpoch,
          history,
          isGenerating: window.InjectionCore.isGenerating(config),
          isComplete: window.InjectionCore.isResponseComplete(config),
          source: 'content-script'
        }, '*');
      }
    }
  });

  let readyNotified = false;
  function notifyReadyWhenUsable(force = false) {
    if ((!force && readyNotified) || window.parent === window) return readyNotified;

    try {
      if (!config.detectTextarea()) return false;
    } catch (error) {
      return false;
    }

    readyNotified = true;
    window.parent.postMessage({
      type: 'AI_READY',
      platform: 'meta',
      source: 'content-script'
    }, '*');
    return true;
  }

  function startReadyCheck() {
    setTimeout(() => {
      if (notifyReadyWhenUsable()) return;

      const intervalId = setInterval(() => {
        if (notifyReadyWhenUsable()) clearInterval(intervalId);
      }, 500);
      setTimeout(() => clearInterval(intervalId), 60000);
    }, 100);
  }

  if (document.readyState === 'complete') startReadyCheck();
  else window.addEventListener('load', startReadyCheck, { once: true });

  console.log('[Meta AI] Content script loaded');
})();
