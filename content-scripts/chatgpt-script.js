// chatgpt-script.js - ChatGPT 專用腳本
(function() {
  'use strict';

  console.log('[ChatGPT] Content script initializing...');

  const config = window.PLATFORM_CONFIGS.chatgpt;

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

    console.log('[ChatGPT] Received message:', data);

    if (data.type === 'AI_SUBMIT_QUESTION' && data.platform === 'chatgpt') {
      console.log('[ChatGPT] Received submit question command:', data.question);
      await window.InjectionCore.submitQuestion(config, data.question);
    }

    if (data.type === 'AI_NEW_CHAT' && data.platform === 'chatgpt') {
      console.log('[ChatGPT] Starting new chat...');
      window.location.href = 'https://chatgpt.com/';
    }

    if (data.type === 'AI_SCRAPE_HISTORY_REQUEST' && data.platform === 'chatgpt') {
      console.log('[ChatGPT] Received scrape history request');
      let history = [];
      try {
        history = await window.InjectionCore.scrapeHistory(config, data.timeoutMs || 1500);
      } catch (e) {
        console.error('[ChatGPT] Scrape history error:', e);
      }
      if (window.parent !== window) {
        window.parent.postMessage({
          type: 'AI_SCRAPE_HISTORY_RESPONSE',
          platform: 'chatgpt',
          requestId: data.requestId,
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
      platform: 'chatgpt',
      source: 'content-script'
    }, '*');
  }

  // --- Login Monitoring & Overlay Logic ---
  const LOGIN_OVERLAY_ID = 'ai-multichat-login-overlay';
  const LOGIN_CHECK_INTERVAL_MS = 30000;
  let loginCheckInFlight = false;
  let lastAuthenticatedState = null;

  function notifyLoginRequired() {
    if (window.parent === window) return;

    window.parent.postMessage({
      type: 'CHATGPT_NEEDS_LOGIN',
      platform: 'chatgpt',
      url: location.href,
      source: 'ai-login-handler'
    }, '*');
  }

  function hasUsableChatInput() {
    try {
      return !!config.detectTextarea();
    } catch (error) {
      return false;
    }
  }

  function createLoginOverlay() {
    if (document.getElementById(LOGIN_OVERLAY_ID)) return;
    if (!document.body) return;

    const overlay = document.createElement('div');
    overlay.id = LOGIN_OVERLAY_ID;
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.85);
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: white;
      font-family: sans-serif;
      text-align: center;
      pointer-events: auto;
    `;

    overlay.innerHTML = `
      <div style="background: #2d3748; padding: 30px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 400px; position: relative; z-index: 1;">
        <h2 style="margin-bottom: 20px; font-size: 24px;">需登入 ChatGPT</h2>
        <p style="margin-bottom: 20px; color: #cbd5e0;">由於安全限制，請點擊下方按鈕在新視窗中登入，登入完成後點擊「我已登入」。</p>
        <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
          <button id="ai-login-btn" style="
            background: #10a37f;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 6px;
            font-size: 16px;
            cursor: pointer;
            transition: background 0.3s;
            position: relative;
            z-index: 2;
            pointer-events: auto;
          ">在新視窗登入</button>
          <button id="ai-close-btn" style="
            background: #27ae60;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 6px;
            font-size: 16px;
            cursor: pointer;
            transition: background 0.3s;
            position: relative;
            z-index: 2;
            pointer-events: auto;
          ">我已登入</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('ai-login-btn').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('[ChatGPT] Login button clicked, opening new window...');
      window.open('https://chatgpt.com/auth/login', '_blank', 'width=500,height=700');
    }, { capture: true });

    document.getElementById('ai-close-btn').addEventListener('click', () => {
      console.log('[ChatGPT] User clicked "I am logged in", navigating to chat page...');
      overlay.remove();
      window.chatgptLoginCheckDisabled = true;
      window.location.href = 'https://chatgpt.com/';
    });
  }

  function reportLoginState(isAuthenticated, forceReport = false) {
    if (lastAuthenticatedState === isAuthenticated && !forceReport) return;
    lastAuthenticatedState = isAuthenticated;

    if (isAuthenticated) {
      const overlay = document.getElementById(LOGIN_OVERLAY_ID);
      if (overlay) {
        console.log('[ChatGPT] Authenticated session detected, removing login overlay...');
        overlay.remove();
      }
      notifyReady();
      return;
    }

    createLoginOverlay();
    notifyLoginRequired();
  }

  async function checkLoginState(forceReport = false) {
    if (window.self === window.top) return;

    if (window.chatgptLoginCheckDisabled) return;

    const isAuthPage = location.hostname === 'auth.openai.com' ||
                       location.pathname.includes('/auth/login') ||
                       location.pathname.includes('/log-in-or-create-account');

    if (isAuthPage) {
      console.log('[ChatGPT] Auth page detected in iframe, showing overlay...');
      reportLoginState(false, forceReport);
      return;
    }

    if (location.hostname !== 'chatgpt.com' || loginCheckInFlight) return;

    loginCheckInFlight = true;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch('https://chatgpt.com/backend-api/me', {
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal
      });

      if (response.status === 401 || response.status === 403) {
        reportLoginState(false, forceReport);
        return;
      }

      if (response.ok) {
        const data = await response.json();
        const isAuthenticated = !!(data?.id || data?.email);
        reportLoginState(isAuthenticated, forceReport);
        return;
      }

      // A confirmed composer is a safe positive fallback; its absence is not proof of logout.
      if (hasUsableChatInput()) {
        reportLoginState(true, forceReport);
      }
    } catch (error) {
      if (hasUsableChatInput()) {
        reportLoginState(true, forceReport);
      } else {
        console.warn('[ChatGPT] Could not confirm login state:', error);
      }
    } finally {
      clearTimeout(timeoutId);
      loginCheckInFlight = false;
    }
  }

  const runInitialLoginCheck = () => {
    setTimeout(() => checkLoginState(true), 100);
  };

  if (document.readyState === 'complete') {
    runInitialLoginCheck();
  } else {
    window.addEventListener('load', runInitialLoginCheck, { once: true });
  }
  setInterval(() => checkLoginState(), LOGIN_CHECK_INTERVAL_MS);
  // --- End Login Monitoring ---

  console.log('[ChatGPT] Content script loaded');
})();
