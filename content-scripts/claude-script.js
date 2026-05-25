// claude-script.js - Claude 專用腳本
(function() {
  'use strict';

  console.log('[Claude] Content script initializing...');

  const config = window.PLATFORM_CONFIGS.claude;
  const CLAUDE_BREAKPOINT_SESSION_KEY = 'ai-multichat-claude-sidebar-breakpoint';
  const CLAUDE_PROTECT_ENABLED_KEY = 'ai-multichat-claude-protect-enabled';
  const CLAUDE_SIDEBAR_SELECTORS = [
    'nav[aria-label="Sidebar"]',
    '[data-testid="pin-sidebar-toggle"]',
    'button[aria-label="Open sidebar"]',
    'button[aria-label="Close sidebar"]'
  ];
  let claudeSidebarBreakpointEnabled = false;
  let lastClaudeSidebarState = null;

  try {
    claudeSidebarBreakpointEnabled = sessionStorage.getItem(CLAUDE_BREAKPOINT_SESSION_KEY) === 'armed';
  } catch (error) {}

  try {
    sessionStorage.setItem(CLAUDE_PROTECT_ENABLED_KEY, 'true');
    refreshClaudeProtectionWindow(5000);
  } catch (error) {}

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
      claudeMessage: 'div[data-testid="claude-message"], .font-claude-message, [class*="font-claude-message"]',
      assistantLike: '[data-testid*="assistant"], [data-testid*="response"], [data-is-streaming="true"]',
      prose: '.prose, [class*="prose"]',
      ariaLive: '[aria-live]',
      articles: 'article',
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
    if (window.self !== window.top && location.hostname === 'claude.ai') {
      refreshClaudeProtectionWindow(8000);
    } else if (sessionStorage.getItem(CLAUDE_PROTECT_ENABLED_KEY) === 'true') {
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

  window.InjectionCore.setupFetchMonitor(config);
  window.InjectionCore.setupUrlMonitor(config);

  window.addEventListener('message', async (event) => {
    const data = event.data;

    if (!data || typeof data !== 'object') return;
    if (data.source !== 'popup') return;

    console.log('[Claude] Received message:', data);

    if (data.type === 'AI_SUBMIT_QUESTION' && data.platform === 'claude') {
      console.log('[Claude] Received submit question command:', data.question);
      await window.InjectionCore.submitQuestion(config, data.question);
    }

    if (data.type === 'AI_NEW_CHAT' && data.platform === 'claude') {
      console.log('[Claude] Starting new chat...');
      window.location.href = 'https://claude.ai/new';
    }

    if (data.type === 'AI_SCRAPE_HISTORY_REQUEST' && data.platform === 'claude') {
      console.log('[Claude] Received scrape history request');
      let history = [];
      try {
        history = await window.InjectionCore.scrapeHistory(config);
      } catch (e) {
        console.error('[Claude] Scrape history error:', e);
      }
      if (window.parent !== window) {
        window.parent.postMessage({
          type: 'AI_SCRAPE_HISTORY_RESPONSE',
          platform: 'claude',
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
      const sidebarStorageKeys = Object.keys(localStorage).filter((key) => /sidebar|nav|recents|drawer|collapsed|panel/i.test(key));

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
          localStorageSubset: Object.fromEntries(sidebarStorageKeys.map((key) => [key, localStorage.getItem(key)])),
          scrape: getClaudeScrapeDiagnostics()
        }
      }, '*');
    }
  });

  if (window.parent !== window) {
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
  const CLAUDE_CUSTOM_SIDEBAR_ENABLED = true;

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
      window.location.href = 'https://claude.ai/new';
      overlay.remove();
      window.claudeLoginCheckDisabled = true;
      setTimeout(() => {
        window.claudeLoginCheckDisabled = false;
      }, 5000);
    });
  }

  function checkLoginState() {
    if (window.self === window.top) return;
    if (window.claudeLoginCheckDisabled) return;

    const isLoginPage = location.href.includes('claude.ai/login');

    if (isLoginPage) {
      if (!document.getElementById(LOGIN_OVERLAY_ID)) {
        console.log('[Claude] Login page detected in iframe, showing overlay...');
        createLoginOverlay();
      }
      return;
    }

    const hasChatInterface = document.querySelector('[contenteditable="true"]') ||
      document.querySelector('textarea') ||
      document.querySelector('[data-testid="chat-input"]');

    if (hasChatInterface) {
      const overlay = document.getElementById(LOGIN_OVERLAY_ID);
      if (overlay) overlay.remove();
    }
  }

  setTimeout(() => {
    setInterval(checkLoginState, 1000);
  }, 2000);

  console.log('[Claude] Content script loaded');
})();
