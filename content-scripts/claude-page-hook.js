// claude-page-hook.js - injected into Claude's page world to hook iframe-specific behavior
(function() {
  'use strict';

  if (window.self === window.top) return;
  if (location.hostname !== 'claude.ai') return;
  if (window.__AI_MULTICHAT_CLAUDE_PAGE_HOOK__) return;

  const BREAKPOINT_KEY = 'ai-multichat-claude-sidebar-breakpoint';
  const PROTECT_KEY = 'ai-multichat-claude-protect-sidebar';
  const PROTECT_UNTIL_KEY = 'ai-multichat-claude-protect-sidebar-until';
  const PROTECT_ENABLED_KEY = 'ai-multichat-claude-protect-enabled';
  const SIDEBAR_SELECTORS = [
    'nav[aria-label="Sidebar"]',
    '[data-testid="pin-sidebar-toggle"]',
    'button[aria-label="Open sidebar"]',
    'button[aria-label="Close sidebar"]'
  ];

  window.__AI_MULTICHAT_CLAUDE_PAGE_HOOK__ = true;
  window.__AI_MULTICHAT_CLAUDE_IFRAME_SHIM__ = true;

  const defineWindowGetter = (name, getter) => {
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: false,
        get: getter
      });
    } catch (error) {}
  };

  try {
    Object.defineProperty(Document.prototype, 'referrer', {
      configurable: true,
      get() {
        return '';
      }
    });
  } catch (error) {}

  defineWindowGetter('frameElement', () => null);

  try {
    if (sessionStorage.getItem(PROTECT_ENABLED_KEY) === 'true') {
      sessionStorage.setItem(PROTECT_KEY, 'true');
      sessionStorage.setItem(PROTECT_UNTIL_KEY, String(Date.now() + 5000));
    }
  } catch (error) {}

  const isBreakpointArmed = () => {
    try {
      return sessionStorage.getItem(BREAKPOINT_KEY) === 'armed';
    } catch (error) {
      return false;
    }
  };

  const shouldProtectSidebar = () => {
    try {
      if (sessionStorage.getItem(PROTECT_KEY) !== 'true') return false;

      const protectUntil = Number(sessionStorage.getItem(PROTECT_UNTIL_KEY) || '0');
      if (!protectUntil) return false;

      if (Date.now() > protectUntil) {
        sessionStorage.removeItem(PROTECT_KEY);
        sessionStorage.removeItem(PROTECT_UNTIL_KEY);
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  };

  const matchesSidebar = (node) => {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;

    return SIDEBAR_SELECTORS.some((selector) => {
      try {
        return node.matches(selector) || !!node.querySelector(selector);
      } catch (error) {
        return false;
      }
    });
  };

  const triggerDomHookBreakpoint = (reason, payload) => {
    if (!isBreakpointArmed()) return;

    console.warn('[Claude DOM Hook] Sidebar breakpoint triggered:', reason, payload);
    debugger;
  };

  const isHidingStyleChange = (name, value) => {
    const normalizedName = String(name || '').toLowerCase();
    const normalizedValue = String(value || '').toLowerCase().replace(/\s+/g, '');

    if (normalizedName === 'display' && normalizedValue === 'none') return true;
    if (normalizedName === 'visibility' && normalizedValue === 'hidden') return true;
    if (normalizedName === 'opacity' && (normalizedValue === '0' || normalizedValue === '0.0')) return true;
    if (['width', 'min-width', 'max-width', 'flex-basis'].includes(normalizedName) && normalizedValue.startsWith('0')) return true;
    if (normalizedName === 'transform' && normalizedValue !== 'none') return true;

    return false;
  };

  const isHidingAttributeChange = (name, value) => {
    const normalizedName = String(name || '').toLowerCase();
    const normalizedValue = String(value || '').toLowerCase();

    if (normalizedName === 'hidden' || normalizedName === 'aria-hidden') return true;
    if (normalizedName === 'style') {
      return /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0|width\s*:\s*0|min-width\s*:\s*0|max-width\s*:\s*0|flex-basis\s*:\s*0|transform\s*:/.test(normalizedValue);
    }

    return false;
  };

  const originalRemove = Element.prototype.remove;
  Element.prototype.remove = function() {
    if (matchesSidebar(this)) {
      if (shouldProtectSidebar()) {
        console.warn('[Claude DOM Hook] Prevented sidebar removal via element.remove', this);
        return;
      }

      triggerDomHookBreakpoint('element.remove', {
        target: this.outerHTML ? this.outerHTML.slice(0, 1000) : this.tagName
      });
    }

    return originalRemove.apply(this, arguments);
  };

  const originalRemoveChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function(child) {
    if (matchesSidebar(child)) {
      if (shouldProtectSidebar()) {
        console.warn('[Claude DOM Hook] Prevented sidebar removal via node.removeChild', child);
        return child;
      }

      triggerDomHookBreakpoint('node.removeChild', {
        parent: this && this.nodeType === Node.ELEMENT_NODE && this.outerHTML ? this.outerHTML.slice(0, 500) : null,
        child: child.outerHTML ? child.outerHTML.slice(0, 1000) : child.nodeName
      });
    }

    return originalRemoveChild.apply(this, arguments);
  };

  const originalReplaceChild = Node.prototype.replaceChild;
  Node.prototype.replaceChild = function(newChild, oldChild) {
    if (matchesSidebar(oldChild)) {
      if (shouldProtectSidebar()) {
        console.warn('[Claude DOM Hook] Prevented sidebar replacement via node.replaceChild', oldChild);
        return oldChild;
      }

      triggerDomHookBreakpoint('node.replaceChild', {
        oldChild: oldChild.outerHTML ? oldChild.outerHTML.slice(0, 1000) : oldChild.nodeName,
        newChild: newChild && newChild.outerHTML ? newChild.outerHTML.slice(0, 1000) : (newChild ? newChild.nodeName : null)
      });
    }

    return originalReplaceChild.apply(this, arguments);
  };

  const originalSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    if (matchesSidebar(this) && (name === 'style' || name === 'class' || name === 'hidden' || name === 'aria-hidden')) {
      if (shouldProtectSidebar() && isHidingAttributeChange(name, value)) {
        console.warn('[Claude DOM Hook] Prevented sidebar attribute change', {
          name,
          value,
          target: this
        });
        return;
      }

      triggerDomHookBreakpoint('element.setAttribute', {
        name,
        value,
        target: this.outerHTML ? this.outerHTML.slice(0, 1000) : this.tagName
      });
    }

    return originalSetAttribute.apply(this, arguments);
  };

  const originalSetProperty = CSSStyleDeclaration.prototype.setProperty;
  CSSStyleDeclaration.prototype.setProperty = function(name, value, priority) {
    const owner = this.ownerElement || this.parentRule?.parentStyleSheet?.ownerNode || null;
    if (matchesSidebar(owner) && ['display', 'visibility', 'opacity', 'width', 'min-width', 'max-width', 'transform'].includes(name)) {
      if (shouldProtectSidebar() && isHidingStyleChange(name, value)) {
        console.warn('[Claude DOM Hook] Prevented sidebar style change', {
          name,
          value,
          priority,
          target: owner
        });
        return;
      }

      triggerDomHookBreakpoint('style.setProperty', {
        name,
        value,
        priority,
        target: owner.outerHTML ? owner.outerHTML.slice(0, 1000) : owner.tagName
      });
    }

    return originalSetProperty.apply(this, arguments);
  };
})();
