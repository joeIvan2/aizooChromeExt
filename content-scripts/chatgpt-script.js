// chatgpt-script.js - ChatGPT 專用腳本
(function() {
  'use strict';

  if (window.parent !== window && window.parent !== window.top) return;

  console.log('[ChatGPT] Content script initializing...');

  const config = window.PLATFORM_CONFIGS.chatgpt;

  if (window.parent !== window) window.InjectionCore.setupUrlMonitor(config);

  // 監聽來自 popup 的消息
  window.addEventListener('message', async (event) => {
    const data = event.data;

    // 檢查消息來源和類型
    if (!data || typeof data !== 'object') return;
    if (data.source !== 'popup') return;

    console.log('[ChatGPT] Received message:', data);

    if (data.type === 'AI_SUBMIT_QUESTION' && data.platform === 'chatgpt') {
      console.log('[ChatGPT] Received submit question command:', data.question);
      await window.InjectionCore.enqueueQuestion(config, data.question, {
        submissionId: data.submissionId
      });
    }

    if (data.type === 'AI_NEW_CHAT' && data.platform === 'chatgpt') {
      console.log('[ChatGPT] Starting new chat...');
      window.InjectionCore.cancelOperations(config);
      window.location.href = 'https://chatgpt.com/';
    }

    if (data.type === 'AI_CANCEL_OPERATIONS' && data.platform === 'chatgpt') {
      window.InjectionCore.cancelOperations(config);
    }

    if (data.type === 'AI_READY_CHECK' && data.platform === 'chatgpt') {
      if (hasUsableChatInput()) notifyReady();
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
      platform: 'chatgpt',
      source: 'content-script'
    }, '*');
  }

  // --- Login Monitoring & Overlay Logic ---
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

  async function checkLoginState(forceReport = false) {
    if (window.self === window.top) return;

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

      const blocker = await window.AIZooProviderAttention?.reportResponse?.(response);
      if (blocker && blocker.kind !== 'login') return;
      if (response.status === 401) {
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
