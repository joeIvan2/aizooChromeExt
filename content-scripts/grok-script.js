// grok-script.js - Grok 專用腳本
(function() {
  'use strict';

  if (window.parent !== window && window.parent !== window.top) return;

  console.log('[Grok] Content script initializing...');

  if (location.hostname === 'grok.com' && window.parent !== window) {
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

  // Installs the isolated network bridge and keeps the original DOM fallback.
  if (window.parent !== window) window.InjectionCore.setupUrlMonitor(config);

  // 監聽來自 popup 的消息
  window.addEventListener('message', async (event) => {
    const data = event.data;

    // 檢查消息來源和類型
    if (!data || typeof data !== 'object') return;
    if (data.source !== 'popup') return;

    console.log('[Grok] Received message:', data);

    if (data.type === 'AI_SUBMIT_QUESTION' && data.platform === 'grok') {
      console.log('[Grok] Received submit question command:', data.question);
      await window.InjectionCore.enqueueQuestion(config, data.question, {
        submissionId: data.submissionId
      });
    }

    if (data.type === 'AI_NEW_CHAT' && data.platform === 'grok') {
      console.log('[Grok] Starting new chat...');
      window.InjectionCore.cancelOperations(config);
      window.location.href = 'https://grok.com/';
    }

    if (data.type === 'AI_CANCEL_OPERATIONS' && data.platform === 'grok') {
      window.InjectionCore.cancelOperations(config);
    }

    if (data.type === 'AI_READY_CHECK' && data.platform === 'grok') {
      try { if (config.detectTextarea()) notifyReady(); } catch (error) {}
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
          navigationEpoch: data.navigationEpoch,
          ...window.InjectionCore.buildHistoryResponse(config, history),
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

    // Grok's own notice. Embedded here the page cannot read the cookie that
    // says it was answered, so it would return on every open. It is hidden
    // only once a choice (accept or reject) is on record.
    if (window.AIZooUtils.readCookieChoice(localStorage)) {
      document.querySelectorAll(GROK_COOKIE_NOTICE_SELECTOR).forEach((node) => {
        node.style.setProperty('display', 'none', 'important');
      });
    }
  }

  const GROK_COOKIE_NOTICE_SELECTOR = '[data-cookie-banner="true"]';

  function rememberCookieChoice(event) {
    const button = event.target?.closest?.('button');
    if (!button?.closest(GROK_COOKIE_NOTICE_SELECTOR)) return;
    const choice = window.AIZooUtils.classifyCookieChoice(button.textContent);
    if (!choice) return;
    try { localStorage.setItem(window.AIZooUtils.COOKIE_CHOICE_KEY, choice); } catch {}
  }

  if (location.hostname === 'grok.com' && window.self !== window.top) {
    document.addEventListener('click', rememberCookieChoice, true);
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

  function reportLoginState(isAuthenticated, forceReport = false) {
    if (lastAuthenticatedState === isAuthenticated && !forceReport) return;
    lastAuthenticatedState = isAuthenticated;

    if (isAuthenticated) {
      window.AIZooProviderAttention?.reportStatus?.(200);
      notifyReady();
      return;
    }

    window.AIZooProviderAttention?.reportStatus?.(401);
    notifyLoginRequired();
  }

  function reportBlocked(forceReport = false) {
    if (lastAuthenticatedState === 'blocked' && !forceReport) return;
    lastAuthenticatedState = 'blocked';
    sendMessageToPopup({
      type: 'AI_BLOCKED', platform: 'grok',
      message: chrome.i18n.getMessage('grokBlockedNotice') || 'Grok access is blocked or security verification is required. Please complete verification in the Grok view. Sign-in status cannot be confirmed yet.'
    });
  }

  async function checkLoginState(forceReport = false) {
    // Only run this logic if we are inside an iframe
    if (window.self === window.top) return;

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

      const blocker = await window.AIZooProviderAttention?.reportResponse?.(response);
      if (blocker && blocker.kind !== 'login') return;
      const authState = await window.AIZooUtils.classifyGrokAuthResponse(response);
      if (authState === 'blocked') {
        reportBlocked(forceReport);
        return;
      }
      if (authState === 'logged-out') {
        reportLoginState(false, forceReport);
        return;
      }

      if (authState === 'authenticated') {
        reportLoginState(true, forceReport);
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
