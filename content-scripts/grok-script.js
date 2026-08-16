// grok-script.js - Grok 專用腳本
(function() {
  'use strict';

  console.log('[Grok] Content script initializing...');

  if (location.hostname === 'grok.com') {
    chrome.runtime.sendMessage({ type: 'GROK_PREPARE_WEBSOCKET' })
      .then((response) => {
        if (!response?.ok) {
          console.warn('[Grok] WebSocket cookie preparation did not complete:', response?.error);
        }
      })
      .catch((error) => {
        console.warn('[Grok] Could not request WebSocket cookie preparation:', error);
      });
  }

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

    if (data.type === 'AI_SCRAPE_HISTORY_REQUEST' && data.platform === 'grok') {
      console.log('[Grok] Received scrape history request');
      let history = [];
      try {
        history = await window.InjectionCore.scrapeHistory(config, data.timeoutMs || 1500);
      } catch (e) {
        console.error('[Grok] Scrape history error:', e);
      }
      if (window.parent !== window) {
        window.parent.postMessage({
          type: 'AI_SCRAPE_HISTORY_RESPONSE',
          platform: 'grok',
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
  const LOGIN_CHECK_INTERVAL_MS = 30000;
  let loginCheckInFlight = false;
  let lastAuthenticatedState = null;

  function notifyLoginRequired() {
    if (window.parent === window) return;

    window.parent.postMessage({
      type: 'GROK_NEEDS_LOGIN',
      platform: 'grok',
      url: location.href,
      source: 'grok-login-handler'
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
      console.log('[Grok] User clicked "I am logged in", returning to Grok...');
      overlay.remove();
      window.grokLoginCheckDisabled = true;
      window.location.href = 'https://grok.com/';
    });
  }

  function reportLoginState(isAuthenticated, forceReport = false) {
    if (lastAuthenticatedState === isAuthenticated && !forceReport) return;
    lastAuthenticatedState = isAuthenticated;

    if (isAuthenticated) {
      const overlay = document.getElementById(LOGIN_OVERLAY_ID);
      if (overlay) {
        console.log('[Grok] Authenticated session detected, removing login overlay...');
        overlay.remove();
      }
      notifyReady();
      return;
    }

    createLoginOverlay();
    notifyLoginRequired();
  }

  async function checkLoginState(forceReport = false) {
    // Only run this logic if we are inside an iframe
    if (window.self === window.top) return;

    // Skip check if manually disabled
    if (window.grokLoginCheckDisabled) return;

    // Detect if we are on X.ai auth/sign-in page (any sign-in URL)
    const isAuthPage = location.hostname === 'accounts.x.ai' && location.pathname.startsWith('/sign-in');

    if (isAuthPage) {
      console.log('[Grok] Sign-in page detected in iframe:', location.href);
      reportLoginState(false, forceReport);
      return;
    }

    if (location.hostname !== 'grok.com' || loginCheckInFlight) return;

    loginCheckInFlight = true;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch('https://grok.com/api/auth/session', {
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
        const isAuthenticated = data?.status === 'authenticated' && !!data.session;
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
        console.warn('[Grok] Could not confirm login state:', error);
      }
    } finally {
      clearTimeout(timeoutId);
      loginCheckInFlight = false;
    }
  }

  const runInitialLoginCheck = () => {
    // Run after the parent iframe load handler so the final status is not overwritten.
    setTimeout(() => checkLoginState(true), 100);
  };

  if (document.readyState === 'complete') {
    runInitialLoginCheck();
  } else {
    window.addEventListener('load', runInitialLoginCheck, { once: true });
  }
  setInterval(() => checkLoginState(), LOGIN_CHECK_INTERVAL_MS);
  // --- End Login Monitoring ---

  console.log('[Grok] Content script loaded');
})();
