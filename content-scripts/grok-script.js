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

  // --- Cookie Banner Suppression ---
  const COOKIE_BANNER_STYLE_ID = 'ai-multichat-hide-grok-cookie-banner';
  const COOKIE_BANNER_SELECTORS = [
    '#onetrust-banner-sdk',
    '#onetrust-consent-sdk',
    '.onetrust-pc-dark-filter',
    '.onetrust-close-btn-handler',
    '[id^="onetrust-banner-sdk"]',
    '[id^="onetrust-consent-sdk"]'
  ];

  function ensureCookieBannerHidden() {
    if (location.hostname !== 'grok.com') return;

    if (!document.getElementById(COOKIE_BANNER_STYLE_ID) && document.head) {
      const style = document.createElement('style');
      style.id = COOKIE_BANNER_STYLE_ID;
      style.textContent = `
        ${COOKIE_BANNER_SELECTORS.join(',\n')} {
          display: none !important;
          visibility: hidden !important;
          pointer-events: none !important;
        }
      `;
      document.head.appendChild(style);
    }

    let hiddenAny = false;
    for (const selector of COOKIE_BANNER_SELECTORS) {
      document.querySelectorAll(selector).forEach((node) => {
        node.style.setProperty('display', 'none', 'important');
        node.style.setProperty('visibility', 'hidden', 'important');
        node.style.setProperty('pointer-events', 'none', 'important');
        hiddenAny = true;
      });
    }

    if (hiddenAny) {
      document.documentElement.style.removeProperty('overflow');
      document.body?.style?.removeProperty('overflow');
    }
  }

  if (location.hostname === 'grok.com') {
    ensureCookieBannerHidden();

    const cookieBannerObserver = new MutationObserver(() => {
      ensureCookieBannerHidden();
    });

    const startCookieBannerObserver = () => {
      if (!document.documentElement) return;
      cookieBannerObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class']
      });
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startCookieBannerObserver, { once: true });
    } else {
      startCookieBannerObserver();
    }

    setInterval(ensureCookieBannerHidden, 1500);
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
        <h2 style="margin-bottom: 20px; font-size: 24px;">需登入 Grok</h2>
        <p style="margin-bottom: 20px; color: #cbd5e0;">由於安全限制，請點擊下方按鈕在新視窗中登入，登入完成後點擊「我已登入」。</p>
        <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
          <button id="ai-login-btn" style="
            background: #e74c3c;
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
      console.log('[Grok] Login button clicked, opening new window...');
      window.open('https://accounts.x.ai/sign-in?redirect=grok-com', '_blank', 'width=500,height=700');
    }, { capture: true });

    document.getElementById('ai-close-btn').addEventListener('click', () => {
      console.log('[Grok] User clicked "I am logged in", reloading page...');
      // Remove overlay
      overlay.remove();
      // Disable auto-check for 5 seconds to prevent re-showing during navigation
      window.grokLoginCheckDisabled = true;
      setTimeout(() => {
        window.grokLoginCheckDisabled = false;
      }, 5000);
      // Force full page reload to detect login state
      window.location.reload();
    });
  }

  function checkLoginState() {
    // Only run this logic if we are inside an iframe
    if (window.self === window.top) return;

    // Skip check if manually disabled
    if (window.grokLoginCheckDisabled) return;

    // Detect if we are on X.ai auth/sign-in page (any sign-in URL)
    const isAuthPage = location.hostname === 'accounts.x.ai' && location.pathname.startsWith('/sign-in');

    if (isAuthPage) {
      if (!document.getElementById(LOGIN_OVERLAY_ID)) {
        console.log('[Grok] Sign-in page detected in iframe:', location.href);
        createLoginOverlay();
      }
      return;
    }

    // Check for Grok's chat interface elements (more comprehensive)
    const hasChatInterface =
      document.querySelector('textarea') ||
      document.querySelector('[contenteditable="true"]') ||
      document.querySelector('button[aria-label*="Send"]') ||
      document.querySelector('button[aria-label*="Stop"]') ||
      document.querySelector('[data-testid="chat-input"]') ||
      // Check if we're on grok.com and NOT on a login/landing page
      (location.hostname === 'grok.com' && !location.pathname.includes('login') && document.body && document.body.textContent.length > 1000);

    if (hasChatInterface) {
      // Logged in: remove overlay if it exists
      const overlay = document.getElementById(LOGIN_OVERLAY_ID);
      if (overlay) {
        console.log('[Grok] Chat interface detected, removing overlay...');
        overlay.remove();
      }
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
