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

  try {
    if (sessionStorage.getItem(CLAUDE_PROTECT_ENABLED_KEY) === 'true') {
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
          localStorageSubset: Object.fromEntries(sidebarStorageKeys.map((key) => [key, localStorage.getItem(key)]))
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
  const CLAUDE_IFRAME_SIDEBAR_STYLE_ID = 'ai-multichat-claude-sidebar-style';

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
      div.shrink-0:has(> div.fixed.lg\\:sticky.z-sidebar),
      div.shrink-0:has(nav[aria-label="Sidebar"]) {
        width: 18rem !important;
        min-width: 18rem !important;
        max-width: 18rem !important;
        flex: 0 0 18rem !important;
        opacity: 1 !important;
        visibility: visible !important;
        overflow: visible !important;
      }
      div.fixed.lg\\:sticky.z-sidebar {
        width: 18rem !important;
        min-width: 18rem !important;
        max-width: 18rem !important;
        opacity: 1 !important;
        visibility: visible !important;
      }
      nav[aria-label="Sidebar"] {
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

  function ensureClaudeSidebarOpen() {
    if (window.self === window.top) return;
    if (location.hostname !== 'claude.ai') return;

    ensureClaudeSidebarStyle();

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

    const openSidebarButton = document.querySelector(
      '[data-testid="pin-sidebar-toggle"][data-state="closed"], button[aria-label="Open sidebar"]'
    );

    if (!openSidebarButton) return;

    console.log('[Claude] Expanding collapsed sidebar inside iframe...');
    claudeSidebarExpandedOnce = true;
    openSidebarButton.click();
  }

  if (window.self !== window.top) {
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
