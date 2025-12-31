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

  // --- Login Monitoring & Overlay Logic ---
  const LOGIN_OVERLAY_ID = 'ai-multichat-login-overlay';

  function createLoginOverlay() {
    if (document.getElementById(LOGIN_OVERLAY_ID)) return;

    const overlay = document.createElement('div');
    overlay.id = LOGIN_OVERLAY_ID;
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.85);
      z-index: 999999;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: white;
      font-family: sans-serif;
      text-align: center;
    `;

    overlay.innerHTML = `
      <div style="background: #2d3748; padding: 30px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 400px;">
        <h2 style="margin-bottom: 20px; font-size: 24px;">需登入 Grok</h2>
        <p style="margin-bottom: 20px; color: #cbd5e0;">由於安全限制，請點擊下方按鈕在新視窗中登入，完成後關閉視窗並重整此頁面。</p>
        <div style="display: flex; gap: 10px; justify-content: center;">
          <button id="ai-login-btn" style="
            background: #e74c3c;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 6px;
            font-size: 16px;
            cursor: pointer;
            transition: background 0.3s;
          ">在新視窗登入</button>
          <button id="ai-refresh-btn" style="
            background: #4a5568;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 6px;
            font-size: 16px;
            cursor: pointer;
            transition: background 0.3s;
          ">重整頁面</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('ai-login-btn').addEventListener('click', () => {
      window.open('https://grok.com/', '_blank', 'width=500,height=700');
    });

    document.getElementById('ai-refresh-btn').addEventListener('click', () => {
      console.log('[Grok] Requesting parent to refresh iframe...');
      if (window.parent !== window) {
        window.parent.postMessage({
          type: 'AI_REFRESH_IFRAME',
          platform: 'grok',
          source: 'content-script'
        }, '*');
      }
    });
  }

  function checkLoginState() {
    // Only run this logic if we are inside an iframe
    if (window.self === window.top) return;

    // Detect if we are on X.ai auth page
    const isAuthPage = location.hostname === 'accounts.x.ai';

    if (isAuthPage) {
      if (!document.getElementById(LOGIN_OVERLAY_ID)) {
        console.log('[Grok] Auth page detected in iframe, showing overlay...');
        createLoginOverlay();
      }
      return;
    }

    // Check for Grok's chat interface elements
    const hasChatInterface = document.querySelector('textarea[placeholder*="Ask"]') ||
                            document.querySelector('textarea') ||
                            document.querySelector('[data-testid="chat-input"]');

    if (hasChatInterface) {
      // Logged in: remove overlay if it exists
      const overlay = document.getElementById(LOGIN_OVERLAY_ID);
      if (overlay) overlay.remove();
    } else {
      // Not logged in: ensure overlay exists
      if (!document.getElementById(LOGIN_OVERLAY_ID)) {
        console.log('[Grok] Login overlay missing, restoring...');
        createLoginOverlay();
      }
    }
  }

  // Run check every 1 second
  setInterval(checkLoginState, 1000);
  // --- End Login Monitoring ---

  console.log('[Grok] Content script loaded');
})();
