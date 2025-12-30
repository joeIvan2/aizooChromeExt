// grok-script.js - Grok 專用腳本
(function() {
  'use strict';

  console.log('[Grok] Content script initializing...');

  const config = window.PLATFORM_CONFIGS.grok;

  // 初始化 Fetch 監聽
  window.InjectionCore.setupFetchMonitor(config);
  // 初始化 URL 監聽
  window.InjectionCore.setupUrlMonitor(config);

  // 監聽來自 popup 的消息
  window.addEventListener('message', async (event) => {
    const data = event.data;

    // 檢查消息來源和類型
    if (!data || typeof data !== 'object') return;
    if (data.source !== 'popup') return;

    console.log('[Grok] Received message:', data);

    if (data.type === 'AI_SUBMIT_QUESTION' && data.platform === 'grok') {
      console.log('[Grok] Received submit question command:', data.question);
      await window.InjectionCore.submitQuestion(config, data.question);
    }

    if (data.type === 'AI_NEW_CHAT' && data.platform === 'grok') {
      console.log('[Grok] Starting new chat...');
      window.location.href = 'https://grok.com/';
    }
  });

  // 通知準備就緒（發送給 parent window，即 popup.html）
  if (window.parent !== window) {
    window.parent.postMessage({
      type: 'AI_READY',
      platform: 'grok',
      source: 'content-script'
    }, '*');
  }

  console.log('[Grok] Content script loaded');
})();
