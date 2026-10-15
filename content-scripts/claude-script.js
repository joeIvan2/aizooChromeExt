// claude-script.js - Claude 專用腳本
(function() {
  'use strict';

  if (window.parent !== window && window.parent !== window.top) return;

  console.log('[Claude] Content script initializing...');

  const config = window.PLATFORM_CONFIGS.claude;
  const CLAUDE_BREAKPOINT_SESSION_KEY = 'ai-multichat-claude-sidebar-breakpoint';
  const CLAUDE_PROTECT_ENABLED_KEY = 'ai-multichat-claude-protect-enabled';
  const CLAUDE_NEW_CHAT_URL = 'https://claude.ai/new';
  const CLAUDE_SAFE_DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
  const CLAUDE_BAD_FALLBACK_MODEL = 'claude-3-5-haiku-latest';
  const CLAUDE_MODEL_STORAGE_KEYS = ['default-model', 'sticky-model-selector'];
  const CLAUDE_MODEL_SEEDED_SESSION_KEY = 'ai-multichat-claude-model-seeded';
  const CLAUDE_SIDEBAR_SELECTORS = [
    'nav[aria-label="Sidebar"]',
    '[data-testid="pin-sidebar-toggle"]',
    'button[aria-label="Open sidebar"]',
    'button[aria-label="Close sidebar"]'
  ];
  // Claude's current responsive UI already provides an accessible native
  // sidebar toggle. The old custom implementation forced obsolete DOM nodes
  // to 18rem and could prevent React from cleaning up responsive layouts.
  const CLAUDE_CUSTOM_SIDEBAR_ENABLED = false;
  const CLAUDE_HISTORY_DRAWER_ENABLED = true;
  let claudeSidebarBreakpointEnabled = false;
  let lastClaudeSidebarState = null;

  function claudeT(key, fallback) {
    return chrome.i18n.getMessage(key) || fallback;
  }

  try {
    claudeSidebarBreakpointEnabled = sessionStorage.getItem(CLAUDE_BREAKPOINT_SESSION_KEY) === 'armed';
  } catch (error) {}

  try {
    sessionStorage.setItem(CLAUDE_PROTECT_ENABLED_KEY, 'false');
    sessionStorage.setItem('ai-multichat-claude-protect-sidebar', 'false');
    sessionStorage.removeItem('ai-multichat-claude-protect-sidebar-until');
  } catch (error) {}

  function ensureClaudeNewChatDefaultModel() {
    try {
      if (window.self === window.top) return;
      if (location.hostname !== 'claude.ai') return;
      if (location.pathname !== '/new') return;
      if (new URLSearchParams(location.search).has('model')) return;

      // Claude's iframe /new can miss the dynamic console_default_model bootstrap
      // and falls back to the old literal "claude-3-5-haiku-latest".  Do not use
      // ?model= here: Claude treats that as a one-model override and the selector
      // collapses to a single option.  Seed only Claude's own sticky/default keys
      // when absent or already polluted by the bad fallback, preserving any real
      // user-selected model such as Sonnet/Opus.
      let changed = false;
      CLAUDE_MODEL_STORAGE_KEYS.forEach((key) => {
        const value = localStorage.getItem(key);
        if (!value || value === CLAUDE_BAD_FALLBACK_MODEL) {
          localStorage.setItem(key, CLAUDE_SAFE_DEFAULT_MODEL);
          changed = true;
        }
      });

      // If Claude already read the missing/default model during this document's
      // earliest bootstrap, the new key only takes effect on the next /new load.
      // Reload once, guarded by sessionStorage, so a fresh iframe install does
      // not show the bad fallback until the user manually refreshes.
      if (changed && sessionStorage.getItem(CLAUDE_MODEL_SEEDED_SESSION_KEY) !== 'true') {
        sessionStorage.setItem(CLAUDE_MODEL_SEEDED_SESSION_KEY, 'true');
        setTimeout(() => window.location.reload(), 0);
        return true;
      } else if (!changed) {
        sessionStorage.removeItem(CLAUDE_MODEL_SEEDED_SESSION_KEY);
      }
    } catch (error) {}
    return false;
  }

  if (ensureClaudeNewChatDefaultModel()) return;

  function refreshClaudeProtectionWindow(durationMs = 5000) {
    try {
      sessionStorage.setItem('ai-multichat-claude-protect-sidebar', 'true');
      sessionStorage.setItem('ai-multichat-claude-protect-sidebar-until', String(Date.now() + durationMs));
    } catch (error) {}
  }

  function getShortText(element, limit = 260) {
    if (!element) return '';
    return (element.innerText || element.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, limit);
  }

  function collectClaudeDomSamples(selector, limit = 8) {
    return Array.from(document.querySelectorAll(selector)).slice(-limit).map((element) => ({
      tag: element.tagName,
      className: typeof element.className === 'string' ? element.className.slice(0, 180) : '',
      dataTestId: element.getAttribute('data-testid'),
      ariaLive: element.getAttribute('aria-live'),
      ariaLabel: element.getAttribute('aria-label'),
      role: element.getAttribute('role'),
      text: getShortText(element)
    }));
  }

  function collectClaudeAfterLastUserSamples(limit = 12) {
    const users = Array.from(document.querySelectorAll('div[data-testid="user-message"], .font-user-message, [class*="font-user-message"]'));
    const lastUser = users[users.length - 1];
    if (!lastUser) return [];

    return Array.from(document.querySelectorAll('main div, main section, main p, main li, main pre, main code, [role="presentation"] div'))
      .filter((element) => {
        if (element === lastUser) return false;
        if (!(lastUser.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
        if (element.closest('nav, aside, header, footer, button, [contenteditable="true"], textarea, input')) return false;
        if (element.closest('div[data-testid="user-message"], .font-user-message, [class*="font-user-message"]')) return false;
        if (element.getAttribute('role') === 'status') return false;
        if (element.getAttribute('aria-live')) return false;
        if (element.classList && element.classList.contains('sr-only')) return false;

        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;

        const text = getShortText(element, 900);
        return text.length >= 8;
      })
      .map((element) => ({
        tag: element.tagName,
        className: typeof element.className === 'string' ? element.className.slice(0, 220) : '',
        dataTestId: element.getAttribute('data-testid'),
        role: element.getAttribute('role'),
        textLength: (element.innerText || element.textContent || '').trim().length,
        text: getShortText(element, 420)
      }))
      .sort((a, b) => b.textLength - a.textLength)
      .slice(0, limit);
  }

  function getClaudeScrapeDiagnostics() {
    const selectors = {
      userMessage: 'div[data-testid="user-message"], .font-user-message, [class*="font-user-message"]',
      claudeMessage: 'div[data-testid="claude-message"], .font-claude-response, .font-claude-message, [class*="font-claude-message"]',
      assistantLike: '[data-testid*="assistant"], [data-testid*="response"], [data-is-streaming]',
      prose: '.prose, [class*="prose"]',
      ariaLive: '[aria-live]',
      articles: 'article, [role="article"]',
      stopButtons: 'button[data-testid*="stop"], [data-testid*="stop"], button[aria-label*="Stop"], button[aria-label*="stop"], button[aria-label*="Cancel"], button[aria-label*="Interrupt"], button[aria-label*="停止"]'
    };

    const counts = Object.fromEntries(Object.entries(selectors).map(([key, selector]) => [
      key,
      document.querySelectorAll(selector).length
    ]));

    let scrapedHistory = [];
    try {
      scrapedHistory = config.scrapeHistory ? config.scrapeHistory() : [];
    } catch (error) {
      scrapedHistory = [{ role: 'error', content: error.message }];
    }

    return {
      counts,
      isGenerating: window.InjectionCore.isGenerating(config),
      scrapedHistoryLength: Array.isArray(scrapedHistory) ? scrapedHistory.length : 0,
      scrapedHistoryTail: Array.isArray(scrapedHistory) ? scrapedHistory.slice(-4) : scrapedHistory,
      samples: {
        userMessage: collectClaudeDomSamples(selectors.userMessage),
        claudeMessage: collectClaudeDomSamples(selectors.claudeMessage),
        assistantLike: collectClaudeDomSamples(selectors.assistantLike),
        prose: collectClaudeDomSamples(selectors.prose),
        ariaLive: collectClaudeDomSamples(selectors.ariaLive),
        articles: collectClaudeDomSamples(selectors.articles, 4),
        stopButtons: collectClaudeDomSamples(selectors.stopButtons),
        afterLastUser: collectClaudeAfterLastUserSamples()
      }
    };
  }

  try {
    if (CLAUDE_CUSTOM_SIDEBAR_ENABLED && window.self !== window.top && location.hostname === 'claude.ai') {
      refreshClaudeProtectionWindow(8000);
    } else if (CLAUDE_CUSTOM_SIDEBAR_ENABLED && sessionStorage.getItem(CLAUDE_PROTECT_ENABLED_KEY) === 'true') {
      refreshClaudeProtectionWindow(5000);
    }
  } catch (error) {}

  function injectClaudeTopLevelShim() {
    if (window.self === window.top) return;
    if (location.hostname !== 'claude.ai') return;
    if (document.documentElement.dataset.aiMultichatClaudeShimInjected === 'true') return;

    document.documentElement.dataset.aiMultichatClaudeShimInjected = 'true';

    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('content-scripts/claude-page-hook.js');
    script.async = false;

    (document.documentElement || document.head || document.body).appendChild(script);
    script.addEventListener('load', () => script.remove(), { once: true });
    script.addEventListener('error', () => script.remove(), { once: true });
  }

  injectClaudeTopLevelShim();

  if (window.parent !== window) window.InjectionCore.setupUrlMonitor(config);

  window.addEventListener('message', async (event) => {
    const data = event.data;

    if (!data || typeof data !== 'object') return;
    if (data.source !== 'popup') return;

    console.log('[Claude] Received message:', data);

    if (data.type === 'AI_SUBMIT_QUESTION' && data.platform === 'claude') {
      console.log('[Claude] Received submit question command:', data.question);
      await window.InjectionCore.enqueueQuestion(config, data.question, {
        submissionId: data.submissionId
      });
    }

    if (data.type === 'AI_NEW_CHAT' && data.platform === 'claude') {
      console.log('[Claude] Starting new chat...');
      window.InjectionCore.cancelOperations(config);
      window.location.href = CLAUDE_NEW_CHAT_URL;
    }

    if (data.type === 'AI_CANCEL_OPERATIONS' && data.platform === 'claude') {
      window.InjectionCore.cancelOperations(config);
    }

    if (data.type === 'AI_READY_CHECK' && data.platform === 'claude') {
      try { if (config.detectTextarea()) notifyReady(); } catch (error) {}
    }

    if (data.type === 'AI_SCRAPE_HISTORY_REQUEST' && data.platform === 'claude') {
      console.log('[Claude] Received scrape history request');
      let history = [];
      try {
        history = await window.InjectionCore.scrapeHistory(config, data.timeoutMs || 1500);
      } catch (e) {
        console.error('[Claude] Scrape history error:', e);
      }
      if (window.parent !== window) {
        window.parent.postMessage({
          type: 'AI_SCRAPE_HISTORY_RESPONSE',
          platform: 'claude',
          requestId: data.requestId,
          navigationEpoch: data.navigationEpoch,
          history: history,
          isGenerating: window.InjectionCore.isGenerating(config),
          source: 'content-script'
        }, '*');
      }
    }

    if (data.type === 'AI_SET_SIDEBAR_PROTECTION' && data.platform === 'claude') {
      try {
        if (data.enabled) {
          sessionStorage.setItem(CLAUDE_PROTECT_ENABLED_KEY, 'true');
          refreshClaudeProtectionWindow(5000);
        } else {
          sessionStorage.setItem(CLAUDE_PROTECT_ENABLED_KEY, 'false');
          sessionStorage.setItem('ai-multichat-claude-protect-sidebar', 'false');
          sessionStorage.removeItem('ai-multichat-claude-protect-sidebar-until');
        }
      } catch (error) {}

      console.warn(`[Claude] Sidebar protection ${data.enabled ? 'enabled' : 'disabled'}`);
    }

    if (data.type === 'AI_ARM_BREAKPOINT_DEBUG' && data.platform === 'claude') {
      claudeSidebarBreakpointEnabled = true;
      try {
        sessionStorage.setItem(CLAUDE_BREAKPOINT_SESSION_KEY, 'armed');
      } catch (error) {}

      console.warn('[Claude] Sidebar breakpoint armed');
      window.parent.postMessage({
        type: 'AI_INFO',
        platform: 'claude',
        source: 'content-script',
        message: 'Claude sidebar breakpoint armed'
      }, '*');
    }

    if (data.type === 'AI_DIAGNOSTICS_REQUEST' && data.platform === 'claude') {
      const sidebarToggle = document.querySelector('[data-testid="pin-sidebar-toggle"], button[aria-label="Open sidebar"], button[aria-label="Close sidebar"]');
      const sidebarNav = document.querySelector('nav[aria-label="Sidebar"]');
      const customReopenButton = document.getElementById(CLAUDE_LIVE_REOPEN_BUTTON_ID);
      const customCloseHitArea = document.getElementById(CLAUDE_CLOSE_HITAREA_ID);
      const historyLauncher = document.getElementById(CLAUDE_HISTORY_LAUNCHER_ID);
      const historyDrawer = document.getElementById(CLAUDE_HISTORY_DRAWER_ID);
      const sidebarStorageKeys = Object.keys(localStorage).filter((key) => /sidebar|nav|recents|drawer|collapsed|panel|model|paprika|console/i.test(key));

      window.parent.postMessage({
        type: 'AI_DIAGNOSTICS_RESULT',
        platform: 'claude',
        source: 'content-script',
        diagnostics: {
          href: location.href,
          inIframe: window.self !== window.top,
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          sidebarToggle: sidebarToggle ? {
            ariaLabel: sidebarToggle.getAttribute('aria-label'),
            dataState: sidebarToggle.getAttribute('data-state'),
            text: (sidebarToggle.innerText || sidebarToggle.textContent || '').trim()
          } : null,
          sidebarNav: sidebarNav ? {
            exists: true,
            width: getComputedStyle(sidebarNav).width,
            minWidth: getComputedStyle(sidebarNav).minWidth,
            maxWidth: getComputedStyle(sidebarNav).maxWidth,
            display: getComputedStyle(sidebarNav).display,
            transform: getComputedStyle(sidebarNav).transform,
            visibility: getComputedStyle(sidebarNav).visibility,
            opacity: getComputedStyle(sidebarNav).opacity
          } : {
            exists: false
          },
          customSidebar: {
            enabled: CLAUDE_CUSTOM_SIDEBAR_ENABLED,
            collapsed: claudeSidebarCollapsed,
            autoCollapsedOnce: claudeSidebarAutoCollapsedOnce,
            expandedOnce: claudeSidebarExpandedOnce,
            userExpanded: claudeSidebarUserExpanded,
            primedOnce: claudeSidebarPrimedOnce,
            htmlExpandedFlag: document.documentElement.dataset.aiMultichatClaudeSidebarExpanded || null,
            reopenButton: customReopenButton ? {
              display: getComputedStyle(customReopenButton).display,
              visibility: getComputedStyle(customReopenButton).visibility,
              opacity: getComputedStyle(customReopenButton).opacity,
              ariaLabel: customReopenButton.getAttribute('aria-label')
            } : null,
            closeHitArea: customCloseHitArea ? {
              display: getComputedStyle(customCloseHitArea).display,
              visibility: getComputedStyle(customCloseHitArea).visibility,
              opacity: getComputedStyle(customCloseHitArea).opacity,
              ariaLabel: customCloseHitArea.getAttribute('aria-label')
            } : null
          },
          historyDrawer: {
            enabled: CLAUDE_HISTORY_DRAWER_ENABLED,
            launcherExists: !!historyLauncher,
            open: historyDrawer?.dataset.open === 'true',
            itemCount: historyDrawer?.querySelectorAll('.ai-multichat-history-item').length || 0,
            organizationReady: !!getClaudeOrganizationId()
          },
          localStorageSubset: Object.fromEntries(sidebarStorageKeys.map((key) => [key, localStorage.getItem(key)])),
          scrape: getClaudeScrapeDiagnostics()
        }
      }, '*');
    }
  });

  function notifyReady() {
    if (window.parent === window) return;

    window.parent.postMessage({
      type: 'AI_READY',
      platform: 'claude',
      source: 'content-script'
    }, '*');
  }

  let claudeSidebarExpandedOnce = false;
  let claudeSidebarCollapsed = false;
  let claudeSidebarAutoCollapsedOnce = false;
  let claudeSidebarUserExpanded = false;
  let claudeSidebarPrimedOnce = false;
  const CLAUDE_IFRAME_SIDEBAR_STYLE_ID = 'ai-multichat-claude-sidebar-style';
  const CLAUDE_LIVE_REOPEN_BUTTON_ID = 'ai-multichat-claude-live-reopen-btn';
  const CLAUDE_CLOSE_HITAREA_ID = 'ai-multichat-claude-close-hitarea';
  const CLAUDE_HISTORY_STYLE_ID = 'ai-multichat-claude-history-style';
  const CLAUDE_HISTORY_LAUNCHER_ID = 'ai-multichat-claude-history-launcher';
  const CLAUDE_HISTORY_DRAWER_ID = 'ai-multichat-claude-history-drawer';
  const CLAUDE_HISTORY_BACKDROP_ID = 'ai-multichat-claude-history-backdrop';
  const CLAUDE_HISTORY_LIST_ID = 'ai-multichat-claude-history-list';
  let claudeHistoryLastFocusedElement = null;

  function getClaudeOrganizationId() {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const storageKeys = ['lastActiveOrg', 'last-active-org', 'last_active_org'];

    for (const key of storageKeys) {
      try {
        const value = localStorage.getItem(key);
        if (value && uuidPattern.test(value)) return value;
      } catch (error) {}
    }

    try {
      const resources = performance.getEntriesByType('resource');
      for (let index = resources.length - 1; index >= 0; index -= 1) {
        const match = String(resources[index].name || '').match(/\/api\/organizations\/([0-9a-f-]{36})(?:\/|\?)/i);
        if (match && uuidPattern.test(match[1])) return match[1];
      }
    } catch (error) {}

    return '';
  }

  function getCurrentClaudeConversationId() {
    const match = location.pathname.match(/^\/chat\/([0-9a-f-]{36})(?:\/|$)/i);
    return match ? match[1] : '';
  }

  function ensureClaudeHistoryStyle() {
    if (document.getElementById(CLAUDE_HISTORY_STYLE_ID) || !document.head) return;

    const style = document.createElement('style');
    style.id = CLAUDE_HISTORY_STYLE_ID;
    style.textContent = `
      #${CLAUDE_HISTORY_LAUNCHER_ID} {
        position: fixed;
        left: 12px;
        top: 12px;
        z-index: 1000;
        width: 44px;
        height: 44px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(161, 161, 170, 0.28);
        border-radius: 12px;
        background: rgba(24, 24, 27, 0.92);
        color: rgb(212, 212, 216);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
        cursor: pointer;
        transition: color 180ms ease, background-color 180ms ease, border-color 180ms ease;
      }
      #${CLAUDE_HISTORY_LAUNCHER_ID}:hover {
        color: rgb(250, 250, 250);
        background: rgba(39, 39, 42, 0.98);
        border-color: rgba(212, 212, 216, 0.45);
      }
      #${CLAUDE_HISTORY_LAUNCHER_ID}:focus-visible,
      #${CLAUDE_HISTORY_DRAWER_ID} button:focus-visible,
      #${CLAUDE_HISTORY_DRAWER_ID} a:focus-visible {
        outline: 2px solid rgb(147, 197, 253);
        outline-offset: 2px;
      }
      #${CLAUDE_HISTORY_BACKDROP_ID} {
        position: fixed;
        inset: 0;
        z-index: 1090;
        display: none;
        border: 0;
        background: rgba(0, 0, 0, 0.48);
        cursor: pointer;
      }
      #${CLAUDE_HISTORY_BACKDROP_ID}[data-open="true"] {
        display: block;
      }
      #${CLAUDE_HISTORY_DRAWER_ID} {
        position: fixed;
        inset: 0 auto 0 0;
        z-index: 1100;
        width: min(320px, calc(100vw - 24px));
        display: flex;
        flex-direction: column;
        background: rgba(24, 24, 27, 0.98);
        color: rgb(244, 244, 245);
        border-right: 1px solid rgba(161, 161, 170, 0.24);
        box-shadow: 18px 0 44px rgba(0, 0, 0, 0.34);
        transform: translateX(-102%);
        visibility: hidden;
        transition: transform 200ms ease, visibility 0s linear 200ms;
      }
      #${CLAUDE_HISTORY_DRAWER_ID}[data-open="true"] {
        transform: translateX(0);
        visibility: visible;
        transition: transform 200ms ease;
      }
      #${CLAUDE_HISTORY_DRAWER_ID} .ai-multichat-history-header {
        min-height: 68px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 12px 12px 18px;
        border-bottom: 1px solid rgba(161, 161, 170, 0.2);
      }
      #${CLAUDE_HISTORY_DRAWER_ID} .ai-multichat-history-title {
        margin: 0;
        font: 600 16px/1.3 ui-sans-serif, system-ui, sans-serif;
      }
      #${CLAUDE_HISTORY_DRAWER_ID} .ai-multichat-history-close {
        width: 44px;
        height: 44px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: 10px;
        background: transparent;
        color: rgb(212, 212, 216);
        cursor: pointer;
      }
      #${CLAUDE_HISTORY_DRAWER_ID} .ai-multichat-history-close:hover {
        background: rgba(63, 63, 70, 0.72);
        color: rgb(250, 250, 250);
      }
      #${CLAUDE_HISTORY_DRAWER_ID} .ai-multichat-history-new-chat {
        min-height: 44px;
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 12px;
        padding: 0 14px;
        border: 1px solid rgba(251, 146, 60, 0.38);
        border-radius: 10px;
        background: rgba(194, 65, 12, 0.18);
        color: rgb(255, 237, 213);
        font: 600 14px/1.35 ui-sans-serif, system-ui, sans-serif;
        text-decoration: none;
        cursor: pointer;
      }
      #${CLAUDE_HISTORY_DRAWER_ID} .ai-multichat-history-new-chat:hover {
        background: rgba(194, 65, 12, 0.3);
      }
      #${CLAUDE_HISTORY_LIST_ID} {
        min-height: 0;
        flex: 1;
        overflow-y: auto;
        padding: 0 8px 16px;
      }
      #${CLAUDE_HISTORY_LIST_ID} .ai-multichat-history-status {
        padding: 20px 12px;
        color: rgb(161, 161, 170);
        font: 400 14px/1.5 ui-sans-serif, system-ui, sans-serif;
      }
      #${CLAUDE_HISTORY_LIST_ID} .ai-multichat-history-item {
        min-height: 52px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 3px;
        padding: 9px 12px;
        border-radius: 10px;
        color: rgb(212, 212, 216);
        text-decoration: none;
        cursor: pointer;
      }
      #${CLAUDE_HISTORY_LIST_ID} .ai-multichat-history-item:hover,
      #${CLAUDE_HISTORY_LIST_ID} .ai-multichat-history-item[aria-current="page"] {
        background: rgba(63, 63, 70, 0.76);
        color: rgb(250, 250, 250);
      }
      #${CLAUDE_HISTORY_LIST_ID} .ai-multichat-history-name {
        overflow: hidden;
        color: inherit;
        font: 500 14px/1.35 ui-sans-serif, system-ui, sans-serif;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${CLAUDE_HISTORY_LIST_ID} .ai-multichat-history-time {
        color: rgb(161, 161, 170);
        font: 400 12px/1.3 ui-sans-serif, system-ui, sans-serif;
      }
      @media (prefers-color-scheme: light) {
        #${CLAUDE_HISTORY_LAUNCHER_ID},
        #${CLAUDE_HISTORY_DRAWER_ID} {
          background: rgba(250, 250, 249, 0.98);
          color: rgb(28, 25, 23);
        }
        #${CLAUDE_HISTORY_LAUNCHER_ID} {
          border-color: rgba(68, 64, 60, 0.24);
        }
        #${CLAUDE_HISTORY_LAUNCHER_ID}:hover,
        #${CLAUDE_HISTORY_DRAWER_ID} .ai-multichat-history-close:hover,
        #${CLAUDE_HISTORY_LIST_ID} .ai-multichat-history-item:hover,
        #${CLAUDE_HISTORY_LIST_ID} .ai-multichat-history-item[aria-current="page"] {
          background: rgba(231, 229, 228, 0.96);
          color: rgb(12, 10, 9);
        }
        #${CLAUDE_HISTORY_LIST_ID} .ai-multichat-history-item {
          color: rgb(41, 37, 36);
        }
        #${CLAUDE_HISTORY_LIST_ID} .ai-multichat-history-time,
        #${CLAUDE_HISTORY_LIST_ID} .ai-multichat-history-status {
          color: rgb(87, 83, 78);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        #${CLAUDE_HISTORY_LAUNCHER_ID},
        #${CLAUDE_HISTORY_DRAWER_ID} {
          transition: none !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function setClaudeHistoryStatus(message) {
    const list = document.getElementById(CLAUDE_HISTORY_LIST_ID);
    if (!list) return;

    list.replaceChildren();
    const status = document.createElement('div');
    status.className = 'ai-multichat-history-status';
    status.setAttribute('role', 'status');
    status.textContent = message;
    list.appendChild(status);
  }

  function formatClaudeHistoryTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';

    try {
      return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(date);
    } catch (error) {
      return date.toLocaleString();
    }
  }

  function renderClaudeHistory(conversations) {
    const list = document.getElementById(CLAUDE_HISTORY_LIST_ID);
    if (!list) return;
    list.replaceChildren();

    if (!Array.isArray(conversations) || conversations.length === 0) {
      setClaudeHistoryStatus(claudeT('claudeHistoryEmpty', 'No previous conversations found.'));
      return;
    }

    const currentConversationId = getCurrentClaudeConversationId();
    conversations.forEach((conversation) => {
      if (!conversation || !conversation.uuid) return;

      const link = document.createElement('a');
      link.className = 'ai-multichat-history-item';
      link.href = `/chat/${conversation.uuid}`;
      if (conversation.uuid === currentConversationId) {
        link.setAttribute('aria-current', 'page');
      }

      const name = document.createElement('span');
      name.className = 'ai-multichat-history-name';
      name.textContent = String(conversation.name || claudeT('claudeHistoryUntitled', 'Untitled conversation'));
      link.appendChild(name);

      const updatedAt = formatClaudeHistoryTime(conversation.updated_at || conversation.created_at);
      if (updatedAt) {
        const time = document.createElement('span');
        time.className = 'ai-multichat-history-time';
        time.textContent = updatedAt;
        link.appendChild(time);
      }

      link.addEventListener('click', (event) => {
        event.preventDefault();
        closeClaudeHistoryDrawer({ restoreFocus: false });
        window.location.assign(link.href);
      });
      list.appendChild(link);
    });
  }

  async function loadClaudeHistory() {
    setClaudeHistoryStatus(claudeT('claudeHistoryLoading', 'Loading conversations...'));

    const organizationId = getClaudeOrganizationId();
    if (!organizationId) {
      setClaudeHistoryStatus(claudeT('claudeHistoryNotReady', 'Claude history is not ready yet. Please try again.'));
      return;
    }

    try {
      const response = await fetch(
        `/api/organizations/${encodeURIComponent(organizationId)}/chat_conversations_v2?limit=30&offset=0&consistency=eventual`,
        { credentials: 'include', headers: { Accept: 'application/json' } }
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const payload = await response.json();
      const conversations = Array.isArray(payload) ? payload : payload?.data;
      renderClaudeHistory(conversations);
    } catch (error) {
      console.error('[Claude] Failed to load history drawer', error);
      setClaudeHistoryStatus(claudeT('claudeHistoryLoadFailed', 'Could not load Claude history. Please try again.'));
    }
  }

  function closeClaudeHistoryDrawer(options = {}) {
    const launcher = document.getElementById(CLAUDE_HISTORY_LAUNCHER_ID);
    const drawer = document.getElementById(CLAUDE_HISTORY_DRAWER_ID);
    const backdrop = document.getElementById(CLAUDE_HISTORY_BACKDROP_ID);
    if (!drawer || !backdrop) return;

    drawer.dataset.open = 'false';
    drawer.setAttribute('aria-hidden', 'true');
    backdrop.dataset.open = 'false';
    launcher?.setAttribute('aria-expanded', 'false');

    if (options.restoreFocus !== false && claudeHistoryLastFocusedElement instanceof HTMLElement) {
      claudeHistoryLastFocusedElement.focus({ preventScroll: true });
    }
  }

  function openClaudeHistoryDrawer() {
    ensureClaudeHistoryDrawer();
    const launcher = document.getElementById(CLAUDE_HISTORY_LAUNCHER_ID);
    const drawer = document.getElementById(CLAUDE_HISTORY_DRAWER_ID);
    const backdrop = document.getElementById(CLAUDE_HISTORY_BACKDROP_ID);
    if (!drawer || !backdrop) return;

    claudeHistoryLastFocusedElement = document.activeElement;
    drawer.dataset.open = 'true';
    drawer.setAttribute('aria-hidden', 'false');
    backdrop.dataset.open = 'true';
    launcher?.setAttribute('aria-expanded', 'true');
    drawer.querySelector('.ai-multichat-history-close')?.focus({ preventScroll: true });
    loadClaudeHistory();
  }

  function ensureClaudeHistoryDrawer() {
    if (!CLAUDE_HISTORY_DRAWER_ENABLED) return;
    if (window.self === window.top || location.hostname !== 'claude.ai') return;
    if (!document.body) return;

    ensureClaudeHistoryStyle();

    let launcher = document.getElementById(CLAUDE_HISTORY_LAUNCHER_ID);
    if (!launcher) {
      launcher = document.createElement('button');
      launcher.id = CLAUDE_HISTORY_LAUNCHER_ID;
      launcher.type = 'button';
      launcher.title = claudeT('claudeHistoryTitle', 'Claude history');
      launcher.setAttribute('aria-label', claudeT('claudeHistoryOpen', 'Open Claude history'));
      launcher.setAttribute('aria-controls', CLAUDE_HISTORY_DRAWER_ID);
      launcher.setAttribute('aria-expanded', 'false');
      launcher.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8"></path>
          <path d="M3 3v5h5"></path>
          <path d="M12 7v5l3 2"></path>
        </svg>
      `;
      launcher.addEventListener('click', openClaudeHistoryDrawer);
      document.body.appendChild(launcher);
    }

    let backdrop = document.getElementById(CLAUDE_HISTORY_BACKDROP_ID);
    if (!backdrop) {
      backdrop = document.createElement('button');
      backdrop.id = CLAUDE_HISTORY_BACKDROP_ID;
      backdrop.type = 'button';
      backdrop.dataset.open = 'false';
      backdrop.setAttribute('aria-label', claudeT('claudeHistoryClose', 'Close Claude history'));
      backdrop.addEventListener('click', () => closeClaudeHistoryDrawer());
      document.body.appendChild(backdrop);
    }

    let drawer = document.getElementById(CLAUDE_HISTORY_DRAWER_ID);
    if (!drawer) {
      drawer = document.createElement('aside');
      drawer.id = CLAUDE_HISTORY_DRAWER_ID;
      drawer.dataset.open = 'false';
      drawer.setAttribute('role', 'dialog');
      drawer.setAttribute('aria-modal', 'true');
      drawer.setAttribute('aria-hidden', 'true');
      drawer.setAttribute('aria-label', claudeT('claudeHistoryTitle', 'Claude history'));

      const header = document.createElement('div');
      header.className = 'ai-multichat-history-header';

      const title = document.createElement('h2');
      title.className = 'ai-multichat-history-title';
      title.textContent = claudeT('claudeHistoryTitle', 'Claude history');
      header.appendChild(title);

      const closeButton = document.createElement('button');
      closeButton.className = 'ai-multichat-history-close';
      closeButton.type = 'button';
      closeButton.setAttribute('aria-label', claudeT('claudeHistoryClose', 'Close Claude history'));
      closeButton.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M18 6 6 18"></path>
          <path d="m6 6 12 12"></path>
        </svg>
      `;
      closeButton.addEventListener('click', () => closeClaudeHistoryDrawer());
      header.appendChild(closeButton);
      drawer.appendChild(header);

      const newChat = document.createElement('a');
      newChat.className = 'ai-multichat-history-new-chat';
      newChat.href = CLAUDE_NEW_CHAT_URL;
      newChat.textContent = `＋  ${claudeT('claudeHistoryNewChat', 'New chat')}`;
      newChat.addEventListener('click', (event) => {
        event.preventDefault();
        closeClaudeHistoryDrawer({ restoreFocus: false });
        window.location.assign(CLAUDE_NEW_CHAT_URL);
      });
      drawer.appendChild(newChat);

      const list = document.createElement('nav');
      list.id = CLAUDE_HISTORY_LIST_ID;
      list.setAttribute('aria-label', claudeT('claudeHistoryPastLabel', 'Past Claude conversations'));
      drawer.appendChild(list);

      document.body.appendChild(drawer);
    }
  }

  function initializeClaudeHistoryDrawer() {
    ensureClaudeHistoryDrawer();
    window.addEventListener('keydown', (event) => {
      const drawer = document.getElementById(CLAUDE_HISTORY_DRAWER_ID);
      if (drawer?.dataset.open !== 'true') return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeClaudeHistoryDrawer();
        return;
      }
      if (event.key === 'Tab') {
        const focusable = Array.from(drawer.querySelectorAll('button:not(:disabled), a[href]'));
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });
  }

  if (CLAUDE_HISTORY_DRAWER_ENABLED && window.self !== window.top && location.hostname === 'claude.ai') {
    const scheduleClaudeHistoryDrawer = () => setTimeout(initializeClaudeHistoryDrawer, 600);
    if (document.readyState === 'complete') {
      scheduleClaudeHistoryDrawer();
    } else {
      window.addEventListener('load', scheduleClaudeHistoryDrawer, { once: true });
    }
  }

  function nodeMatchesClaudeSidebar(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;

    return CLAUDE_SIDEBAR_SELECTORS.some((selector) => {
      try {
        return node.matches(selector) || !!node.querySelector(selector);
      } catch (error) {
        return false;
      }
    });
  }

  function getClaudeSidebarState() {
    const sidebarToggle = document.querySelector('[data-testid="pin-sidebar-toggle"], button[aria-label="Open sidebar"], button[aria-label="Close sidebar"]');
    const sidebarNav = document.querySelector('nav[aria-label="Sidebar"]');
    const navStyle = sidebarNav ? getComputedStyle(sidebarNav) : null;

    return {
      href: location.href,
      hasToggle: !!sidebarToggle,
      toggleLabel: sidebarToggle ? sidebarToggle.getAttribute('aria-label') : null,
      toggleState: sidebarToggle ? sidebarToggle.getAttribute('data-state') : null,
      navExists: !!sidebarNav,
      navDisplay: navStyle ? navStyle.display : null,
      navVisibility: navStyle ? navStyle.visibility : null,
      navOpacity: navStyle ? navStyle.opacity : null,
      navWidth: navStyle ? navStyle.width : null,
      navTransform: navStyle ? navStyle.transform : null
    };
  }

  function triggerClaudeSidebarBreakpoint(reason, payload) {
    if (!claudeSidebarBreakpointEnabled) return;

    console.warn('[Claude] Sidebar breakpoint triggered:', reason, payload);
    console.trace('[Claude] Sidebar breakpoint trace');

    claudeSidebarBreakpointEnabled = false;
    try {
      sessionStorage.removeItem(CLAUDE_BREAKPOINT_SESSION_KEY);
    } catch (error) {}

    debugger;
  }

  function inspectClaudeSidebarMutations(mutations) {
    const currentState = getClaudeSidebarState();

    if (!claudeSidebarBreakpointEnabled) {
      lastClaudeSidebarState = currentState;
      return;
    }

    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        for (const node of mutation.removedNodes) {
          if (nodeMatchesClaudeSidebar(node)) {
            triggerClaudeSidebarBreakpoint('sidebar-node-removed', {
              currentState,
              removedHtml: node.outerHTML ? node.outerHTML.slice(0, 1000) : null
            });
            lastClaudeSidebarState = currentState;
            return;
          }
        }
      }

      if (mutation.type === 'attributes' && nodeMatchesClaudeSidebar(mutation.target)) {
        const hiddenNow = currentState.navExists && (
          currentState.navDisplay === 'none' ||
          currentState.navVisibility === 'hidden' ||
          currentState.navOpacity === '0' ||
          currentState.navWidth === '0px'
        );

        if (hiddenNow) {
          triggerClaudeSidebarBreakpoint('sidebar-hidden-via-attribute', {
            attributeName: mutation.attributeName,
            currentState
          });
          lastClaudeSidebarState = currentState;
          return;
        }
      }
    }

    if (lastClaudeSidebarState && (lastClaudeSidebarState.navExists || lastClaudeSidebarState.hasToggle) && !currentState.navExists && !currentState.hasToggle) {
      triggerClaudeSidebarBreakpoint('sidebar-disappeared', {
        previousState: lastClaudeSidebarState,
        currentState
      });
      lastClaudeSidebarState = currentState;
      return;
    }

    lastClaudeSidebarState = currentState;
  }

  function ensureClaudeSidebarStyle() {
    if (window.self === window.top) return;
    if (location.hostname !== 'claude.ai') return;
    if (document.getElementById(CLAUDE_IFRAME_SIDEBAR_STYLE_ID) || !document.head) return;

    const style = document.createElement('style');
    style.id = CLAUDE_IFRAME_SIDEBAR_STYLE_ID;
    style.textContent = `
      #${CLAUDE_LIVE_REOPEN_BUTTON_ID}:hover {
        background: rgba(39, 39, 42, 0.92) !important;
      }
      html[data-ai-multichat-claude-sidebar-expanded="true"] div.shrink-0:has(> div.fixed.lg\\:sticky.z-sidebar),
      html[data-ai-multichat-claude-sidebar-expanded="true"] div.shrink-0:has(nav[aria-label="Sidebar"]) {
        width: 18rem !important;
        min-width: 18rem !important;
        max-width: 18rem !important;
        flex: 0 0 18rem !important;
        opacity: 1 !important;
        visibility: visible !important;
        overflow: visible !important;
      }
      html[data-ai-multichat-claude-sidebar-expanded="true"] div.fixed.lg\\:sticky.z-sidebar {
        width: 18rem !important;
        min-width: 18rem !important;
        max-width: 18rem !important;
        opacity: 1 !important;
        visibility: visible !important;
      }
      html[data-ai-multichat-claude-sidebar-expanded="true"] nav[aria-label="Sidebar"] {
        width: 288px !important;
        min-width: 288px !important;
        max-width: 288px !important;
        transform: none !important;
        visibility: visible !important;
        opacity: 1 !important;
        overflow: hidden !important;
      }
    `;
    document.head.appendChild(style);
  }

  function setClaudeSidebarExpandedFlag(isExpanded) {
    try {
      document.documentElement.dataset.aiMultichatClaudeSidebarExpanded = isExpanded ? 'true' : 'false';
    } catch (error) {}
  }

  function getClaudeSidebarElements() {
    const nav = document.querySelector('nav[aria-label="Sidebar"]');
    const sticky = document.querySelector('div.fixed.lg\\:sticky.z-sidebar');
    const wrapper = Array.from(document.querySelectorAll('div.shrink-0')).find((element) => {
      try {
        return !!element.querySelector('nav[aria-label="Sidebar"]');
      } catch (error) {
        return false;
      }
    }) || null;

    return { nav, sticky, wrapper };
  }

  function getClaudeNativeSidebarToggle() {
    return Array.from(document.querySelectorAll('[data-testid="pin-sidebar-toggle"], button[aria-label="Open sidebar"], button[aria-label="Close sidebar"]'))
      .find((button) => button.id !== CLAUDE_LIVE_REOPEN_BUTTON_ID && button.id !== CLAUDE_CLOSE_HITAREA_ID) || null;
  }

  function isClaudeNativeSidebarClosed() {
    const toggle = getClaudeNativeSidebarToggle();
    if (!toggle) return false;

    const label = toggle.getAttribute('aria-label') || '';
    const state = toggle.getAttribute('data-state') || '';
    return /open sidebar/i.test(label) || state === 'closed';
  }

  function openClaudeNativeSidebar() {
    const openSidebarButton = Array.from(document.querySelectorAll(
      '[data-testid="pin-sidebar-toggle"][data-state="closed"], button[aria-label="Open sidebar"]'
    )).find((button) => button.id !== CLAUDE_LIVE_REOPEN_BUTTON_ID && button.id !== CLAUDE_CLOSE_HITAREA_ID);
    if (!openSidebarButton) return false;

    console.log('[Claude] Expanding native sidebar inside iframe...');
    claudeSidebarExpandedOnce = true;
    openSidebarButton.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    try {
      openSidebarButton.focus({ preventScroll: true });
    } catch (error) {}
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((eventType) => {
      try {
        const EventConstructor = eventType.startsWith('pointer') && typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
        openSidebarButton.dispatchEvent(new EventConstructor(eventType, {
          bubbles: true,
          cancelable: true,
          view: window,
          pointerType: 'mouse',
          button: 0,
          buttons: eventType.endsWith('down') ? 1 : 0
        }));
      } catch (error) {}
    });
    openSidebarButton.click();
    return true;
  }

  function clearClaudeCollapsedInlineStyles() {
    const { nav, sticky, wrapper } = getClaudeSidebarElements();

    [wrapper, sticky, nav].filter(Boolean).forEach((element) => {
      [
        'width', 'min-width', 'max-width', 'flex', 'flex-basis', 'flex-grow', 'flex-shrink',
        'overflow', 'opacity', 'visibility', 'pointer-events', 'transform'
      ].forEach((property) => {
        element.style.removeProperty(property);
      });
    });
  }

  function isClaudeSidebarContentReady() {
    const { nav } = getClaudeSidebarElements();
    if (!nav) return false;

    const text = (nav.innerText || nav.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length >= 8) return true;

    return !!nav.querySelector('a[href], [role="link"], [data-testid], button:not(#ai-multichat-claude-live-reopen-btn):not(#ai-multichat-claude-close-hitarea)');
  }

  function ensureClaudeReopenButton() {
    if (window.self === window.top) return;
    if (location.hostname !== 'claude.ai') return;

    let button = document.getElementById(CLAUDE_LIVE_REOPEN_BUTTON_ID);
    if (!button) {
      button = document.createElement('button');
      button.id = CLAUDE_LIVE_REOPEN_BUTTON_ID;
      button.type = 'button';
      button.title = 'Open sidebar';
      button.setAttribute('aria-label', 'AI Multi-Chat open Claude sidebar');
      button.style.cssText = `
        position: fixed;
        left: 12px;
        top: 16px;
        z-index: 2147483646;
        width: 36px;
        height: 36px;
        display: none;
        align-items: center;
        justify-content: center;
        border: none;
        border-radius: 10px;
        background: transparent;
        color: rgb(113, 113, 122);
        cursor: pointer;
        padding: 0;
      `;
      button.innerHTML = `
        <div style="position: relative; width: 16px; height: 16px; display: flex; align-items: center; justify-content: center;">
          <div style="width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="flex-shrink: 0;">
              <path d="M16.5 4A1.5 1.5 0 0 1 18 5.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 2 14.5v-9A1.5 1.5 0 0 1 3.5 4zM7 15h9.5a.5.5 0 0 0 .5-.5v-9a.5.5 0 0 0-.5-.5H7zM3.5 5a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5H6V5z"></path>
            </svg>
          </div>
        </div>
      `;
      button.addEventListener('mouseenter', () => {
        button.style.color = 'rgb(244, 244, 245)';
      });
      button.addEventListener('mouseleave', () => {
        button.style.color = 'rgb(113, 113, 122)';
      });
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        restoreClaudeSidebar({ userInitiated: true });
      }, true);
      document.body.appendChild(button);
    }
  }

  function ensureClaudeCloseHitArea() {
    if (window.self === window.top) return;
    if (location.hostname !== 'claude.ai') return;

    let hitArea = document.getElementById(CLAUDE_CLOSE_HITAREA_ID);
    if (!hitArea) {
      hitArea = document.createElement('button');
      hitArea.id = CLAUDE_CLOSE_HITAREA_ID;
      hitArea.type = 'button';
      hitArea.title = 'Collapse sidebar';
      hitArea.setAttribute('aria-label', 'Collapse sidebar');
      hitArea.style.cssText = `
        position: fixed;
        left: 250px;
        top: 10px;
        z-index: 2147483646;
        width: 36px;
        height: 36px;
        border: none;
        background: transparent;
        cursor: pointer;
        display: block;
      `;
      hitArea.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        collapseClaudeSidebar({ auto: false });
      }, true);
      document.body.appendChild(hitArea);
    }
  }

  function collapseClaudeSidebar(options = {}) {
    const { nav, sticky, wrapper } = getClaudeSidebarElements();
    if (!nav && !sticky && !wrapper) return false;

    claudeSidebarCollapsed = true;
    claudeSidebarUserExpanded = false;
    setClaudeSidebarExpandedFlag(false);
    if (options.auto) {
      claudeSidebarAutoCollapsedOnce = true;
    }

    if (wrapper) {
      wrapper.style.display = '';
      wrapper.style.setProperty('width', '0px', 'important');
      wrapper.style.setProperty('min-width', '0px', 'important');
      wrapper.style.setProperty('max-width', '0px', 'important');
      wrapper.style.setProperty('flex', '0 0 0px', 'important');
      wrapper.style.setProperty('flex-basis', '0px', 'important');
      wrapper.style.setProperty('overflow', 'hidden', 'important');
      wrapper.style.setProperty('opacity', '0', 'important');
      wrapper.style.setProperty('visibility', 'hidden', 'important');
      wrapper.style.setProperty('pointer-events', 'none', 'important');
    }

    if (sticky) {
      sticky.style.display = '';
      sticky.style.setProperty('width', '0px', 'important');
      sticky.style.setProperty('min-width', '0px', 'important');
      sticky.style.setProperty('max-width', '0px', 'important');
      sticky.style.setProperty('overflow', 'hidden', 'important');
      sticky.style.setProperty('opacity', '0', 'important');
      sticky.style.setProperty('visibility', 'hidden', 'important');
      sticky.style.setProperty('pointer-events', 'none', 'important');
    }

    if (nav) {
      nav.style.display = '';
      nav.style.setProperty('width', '0px', 'important');
      nav.style.setProperty('min-width', '0px', 'important');
      nav.style.setProperty('max-width', '0px', 'important');
      nav.style.setProperty('overflow', 'hidden', 'important');
      nav.style.setProperty('opacity', '0', 'important');
      nav.style.setProperty('visibility', 'hidden', 'important');
      nav.style.setProperty('pointer-events', 'none', 'important');
      nav.style.setProperty('transform', 'translateX(-100%)', 'important');
    }

    const button = document.getElementById(CLAUDE_LIVE_REOPEN_BUTTON_ID);
    if (button) button.style.display = 'flex';

    const hitArea = document.getElementById(CLAUDE_CLOSE_HITAREA_ID);
    if (hitArea) hitArea.style.display = 'none';

    return true;
  }

  function restoreClaudeSidebar(options = {}) {
    const { nav, sticky, wrapper } = getClaudeSidebarElements();
    claudeSidebarCollapsed = false;
    setClaudeSidebarExpandedFlag(true);
    if (options.userInitiated) {
      claudeSidebarAutoCollapsedOnce = true;
      claudeSidebarUserExpanded = true;
    }

    if (wrapper) {
      wrapper.style.display = '';
      wrapper.style.setProperty('width', '18rem', 'important');
      wrapper.style.setProperty('min-width', '18rem', 'important');
      wrapper.style.setProperty('max-width', '18rem', 'important');
      wrapper.style.setProperty('flex', '0 0 18rem', 'important');
      wrapper.style.setProperty('opacity', '1', 'important');
      wrapper.style.setProperty('visibility', 'visible', 'important');
      wrapper.style.setProperty('overflow', 'visible', 'important');
      wrapper.style.setProperty('pointer-events', 'auto', 'important');
    }

    if (sticky) {
      sticky.style.display = '';
      sticky.style.setProperty('width', '18rem', 'important');
      sticky.style.setProperty('min-width', '18rem', 'important');
      sticky.style.setProperty('max-width', '18rem', 'important');
      sticky.style.setProperty('opacity', '1', 'important');
      sticky.style.setProperty('visibility', 'visible', 'important');
      sticky.style.setProperty('overflow', 'visible', 'important');
      sticky.style.setProperty('pointer-events', 'auto', 'important');
    }

    if (nav) {
      nav.style.display = '';
      nav.style.setProperty('width', '18rem', 'important');
      nav.style.setProperty('min-width', '18rem', 'important');
      nav.style.setProperty('max-width', '18rem', 'important');
      nav.style.setProperty('opacity', '1', 'important');
      nav.style.setProperty('visibility', 'visible', 'important');
      nav.style.setProperty('transform', 'none', 'important');
      nav.style.setProperty('pointer-events', 'auto', 'important');
    }

    const button = document.getElementById(CLAUDE_LIVE_REOPEN_BUTTON_ID);
    if (button) button.style.display = 'none';

    const hitArea = document.getElementById(CLAUDE_CLOSE_HITAREA_ID);
    if (hitArea) hitArea.style.display = 'block';

    if (options.userInitiated && isClaudeNativeSidebarClosed()) {
      requestAnimationFrame(() => {
        openClaudeNativeSidebar();
        setTimeout(() => {
          clearClaudeCollapsedInlineStyles();
          restoreClaudeSidebar({ userInitiated: false });
        }, 350);
      });
    }
  }

  function ensureClaudeSidebarOpen() {
    if (window.self === window.top) return;
    if (location.hostname !== 'claude.ai') return;

    ensureClaudeSidebarStyle();
    ensureClaudeReopenButton();
    ensureClaudeCloseHitArea();

    const sidebarElements = getClaudeSidebarElements();
    const sidebarIsRebuilt = !!(sidebarElements.nav && (sidebarElements.sticky || sidebarElements.wrapper));
    const nativeSidebarClosed = isClaudeNativeSidebarClosed();

    if (nativeSidebarClosed && !claudeSidebarUserExpanded && !claudeSidebarPrimedOnce) {
      claudeSidebarPrimedOnce = true;
      claudeSidebarCollapsed = false;
      setClaudeSidebarExpandedFlag(true);
      clearClaudeCollapsedInlineStyles();
      openClaudeNativeSidebar();
      setTimeout(() => {
        if (!claudeSidebarUserExpanded) {
          collapseClaudeSidebar({ auto: true });
        }
      }, 1800);
      return;
    }

    if (nativeSidebarClosed && !claudeSidebarUserExpanded) {
      collapseClaudeSidebar({ auto: true });
      return;
    }

    if (sidebarIsRebuilt && !claudeSidebarAutoCollapsedOnce && !claudeSidebarUserExpanded) {
      if (!isClaudeSidebarContentReady()) {
        return;
      }

      requestAnimationFrame(() => {
        setTimeout(() => {
          if (!claudeSidebarAutoCollapsedOnce) {
            console.log('[Claude] Sidebar rebuilt, auto-collapsing by default...');
            collapseClaudeSidebar({ auto: true });
          }
        }, 120);
      });
      return;
    }

    if (claudeSidebarCollapsed) {
      setClaudeSidebarExpandedFlag(false);
      const button = document.getElementById(CLAUDE_LIVE_REOPEN_BUTTON_ID);
      if (button) button.style.display = 'flex';

      const hitArea = document.getElementById(CLAUDE_CLOSE_HITAREA_ID);
      if (hitArea) hitArea.style.display = 'none';
      return;
    }

    const sidebarSticky = document.querySelector('div.fixed.lg\\:sticky.z-sidebar');
    if (sidebarSticky) {
      sidebarSticky.style.setProperty('width', '18rem', 'important');
      sidebarSticky.style.setProperty('min-width', '18rem', 'important');
      sidebarSticky.style.setProperty('max-width', '18rem', 'important');
      sidebarSticky.style.setProperty('opacity', '1', 'important');
      sidebarSticky.style.setProperty('visibility', 'visible', 'important');
    }

    const sidebarWrapper = Array.from(document.querySelectorAll('div.shrink-0')).find((element) => {
      try {
        return !!element.querySelector('div.fixed.lg\\:sticky.z-sidebar, nav[aria-label="Sidebar"], button[aria-label="Open sidebar"], button[aria-label="Close sidebar"]');
      } catch (error) {
        return false;
      }
    });

    if (sidebarWrapper) {
      sidebarWrapper.style.setProperty('width', '18rem', 'important');
      sidebarWrapper.style.setProperty('min-width', '18rem', 'important');
      sidebarWrapper.style.setProperty('max-width', '18rem', 'important');
      sidebarWrapper.style.setProperty('flex-basis', '18rem', 'important');
      sidebarWrapper.style.setProperty('flex-grow', '0', 'important');
      sidebarWrapper.style.setProperty('flex-shrink', '0', 'important');
      sidebarWrapper.style.setProperty('opacity', '1', 'important');
      sidebarWrapper.style.setProperty('visibility', 'visible', 'important');
      sidebarWrapper.style.setProperty('overflow', 'visible', 'important');
    }

    const sidebarNav = document.querySelector('nav[aria-label="Sidebar"]');
    if (sidebarNav) {
      sidebarNav.style.setProperty('width', '288px', 'important');
      sidebarNav.style.setProperty('min-width', '288px', 'important');
      sidebarNav.style.setProperty('max-width', '288px', 'important');
      sidebarNav.style.setProperty('transform', 'none', 'important');
      sidebarNav.style.setProperty('visibility', 'visible', 'important');
      sidebarNav.style.setProperty('opacity', '1', 'important');
    }

    if (claudeSidebarExpandedOnce) return;
  }

  if (window.self !== window.top && CLAUDE_CUSTOM_SIDEBAR_ENABLED) {
    const sidebarObserver = new MutationObserver((mutations) => {
      inspectClaudeSidebarMutations(mutations);
      ensureClaudeSidebarOpen();
    });

    const startSidebarObserver = () => {
      if (!document.documentElement) return;
      sidebarObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['aria-label', 'data-state', 'class', 'style']
      });
      lastClaudeSidebarState = getClaudeSidebarState();
      ensureClaudeSidebarOpen();
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startSidebarObserver, { once: true });
    } else {
      startSidebarObserver();
    }

    ensureClaudeSidebarStyle();
    setTimeout(ensureClaudeSidebarOpen, 1500);
    setTimeout(ensureClaudeSidebarOpen, 4000);
    setInterval(ensureClaudeSidebarOpen, 3000);
  }

  // --- Login Monitoring & Overlay Logic ---
  const LOGIN_OVERLAY_ID = 'ai-multichat-login-overlay';
  const LOGIN_CHECK_INTERVAL_MS = 30000;
  let loginCheckInFlight = false;
  let lastAuthenticatedState = null;

  function notifyLoginRequired() {
    if (window.parent === window) return;

    window.parent.postMessage({
      type: 'AI_NEEDS_LOGIN',
      platform: 'claude',
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
        <h2 style="margin-bottom: 20px; font-size: 24px;">需登入 Claude</h2>
        <p style="margin-bottom: 20px; color: #cbd5e0;">由於安全限制，請點擊下方按鈕在新視窗中登入，登入完成後點擊「我已登入」。</p>
        <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
          <button id="ai-login-btn" style="
            background: #CC785C;
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
      console.log('[Claude] Login button clicked, opening new window...');
      window.open('https://claude.ai/login', '_blank', 'width=500,height=700');
    }, { capture: true });

    document.getElementById('ai-close-btn').addEventListener('click', () => {
      console.log('[Claude] User clicked "I am logged in", navigating to chat page...');
      overlay.remove();
      window.claudeLoginCheckDisabled = true;
      window.location.href = CLAUDE_NEW_CHAT_URL;
    });
  }

  function reportLoginState(isAuthenticated, forceReport = false) {
    if (lastAuthenticatedState === isAuthenticated && !forceReport) return;
    lastAuthenticatedState = isAuthenticated;

    if (isAuthenticated) {
      const overlay = document.getElementById(LOGIN_OVERLAY_ID);
      if (overlay) {
        console.log('[Claude] Authenticated session detected, removing login overlay...');
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
    if (window.claudeLoginCheckDisabled) return;

    const isLoginPage = location.hostname === 'claude.ai' && location.pathname.startsWith('/login');

    if (isLoginPage) {
      console.log('[Claude] Login page detected in iframe, showing overlay...');
      reportLoginState(false, forceReport);
      return;
    }

    if (location.hostname !== 'claude.ai' || loginCheckInFlight) return;

    loginCheckInFlight = true;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch('https://claude.ai/api/account', {
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
        const isAuthenticated = !!(data?.uuid || data?.tagged_id || data?.email_address);
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
        console.warn('[Claude] Could not confirm login state:', error);
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

  console.log('[Claude] Content script loaded');
})();
