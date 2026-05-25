// gemini-script.js - Gemini 專用腳本
(function() {
  'use strict';

  console.log('[Gemini] Content script initializing...');

  const config = window.PLATFORM_CONFIGS.gemini;

  // 初始化 XHR 監聽（Gemini 使用 XHR 而非 Fetch）
  window.InjectionCore.setupXHRMonitor(config);
  // 初始化 URL 監聽
  window.InjectionCore.setupUrlMonitor(config);

  // 監聽來自 popup 的消息
  window.addEventListener('message', async (event) => {
    const data = event.data;

    // 檢查消息來源和類型
    if (!data || typeof data !== 'object') return;
    if (data.source !== 'popup') return;

    console.log('[Gemini] Received message:', data);

    if (data.type === 'AI_SUBMIT_QUESTION' && data.platform === 'gemini') {
      console.log('[Gemini] Received submit question command:', data.question);
      await window.InjectionCore.submitQuestion(config, data.question);
    }

    if (data.type === 'AI_NEW_CHAT' && data.platform === 'gemini') {
      console.log('[Gemini] Starting new chat...');
      window.location.href = 'https://gemini.google.com/app';
    }

    if (data.type === 'AI_SCRAPE_HISTORY_REQUEST' && data.platform === 'gemini') {
      console.log('[Gemini] Received scrape history request');
      let history = [];
      try {
        history = await window.InjectionCore.scrapeHistory(config);
      } catch (e) {
        console.error('[Gemini] Scrape history error:', e);
      }
      if (window.parent !== window) {
        window.parent.postMessage({
          type: 'AI_SCRAPE_HISTORY_RESPONSE',
          platform: 'gemini',
          history: history,
          isGenerating: window.InjectionCore.isGenerating(config),
          source: 'content-script'
        }, '*');
      }
    }
  });

  // 通知準備就緒（發送給 parent window，即 popup.html）
  if (window.parent !== window) {
    window.parent.postMessage({
      type: 'AI_READY',
      platform: 'gemini',
      source: 'content-script'
    }, '*');
  }

  console.log('[Gemini] Content script loaded');
})();
