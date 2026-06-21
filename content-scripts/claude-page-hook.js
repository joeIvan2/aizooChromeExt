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


  const CLAUDE_SAFE_DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
  const CLAUDE_BAD_FALLBACK_MODEL = 'claude-3-5-haiku-latest';
  const CLAUDE_CONSOLE_DEFAULT_MODEL_FEATURE_KEY = 'console_default_model';
  const CLAUDE_CONSOLE_DEFAULT_MODEL_DJB2_KEY = '349923980';
  const isClaudeNewChatWithoutModelParam = () => {
    try {
      return window.self !== window.top &&
        location.hostname === 'claude.ai' &&
        location.pathname === '/new' &&
        !new URLSearchParams(location.search).has('model');
    } catch (error) {
      return false;
    }
  };

  const getClaudeBootstrapModelsConfig = (bootstrapJson) => {
    const directOrgModels = bootstrapJson?.account?.organization?.settings?.claude_ai_bootstrap_models_config;
    if (Array.isArray(directOrgModels) && directOrgModels.length) return directOrgModels;

    const memberships = bootstrapJson?.account?.memberships;
    if (!Array.isArray(memberships)) return [];

    const activeOrgUuid = bootstrapJson?.active_organization_uuid || bootstrapJson?.organization_uuid;
    const activeMembership = activeOrgUuid
      ? memberships.find((membership) => membership?.organization?.uuid === activeOrgUuid)
      : null;
    const activeModels = activeMembership?.organization?.claude_ai_bootstrap_models_config;
    if (Array.isArray(activeModels) && activeModels.length) return activeModels;

    const membershipWithModels = memberships.find((membership) => (
      Array.isArray(membership?.organization?.claude_ai_bootstrap_models_config) &&
      membership.organization.claude_ai_bootstrap_models_config.length
    ));

    return membershipWithModels?.organization?.claude_ai_bootstrap_models_config || [];
  };

  const getSafeClaudeDefaultModel = (bootstrapJson) => {
    const accountDefault = bootstrapJson?.account?.settings?.default_model;
    if (typeof accountDefault === 'string' && accountDefault && accountDefault !== CLAUDE_BAD_FALLBACK_MODEL) {
      return accountDefault;
    }

    const models = getClaudeBootstrapModelsConfig(bootstrapJson);
    const preferred = models.find((item) => item?.model === CLAUDE_SAFE_DEFAULT_MODEL && !item?.inactive) ||
      models.find((item) => typeof item?.model === 'string' && /haiku/i.test(item.model) && !item?.inactive) ||
      models.find((item) => typeof item?.model === 'string' && !item?.inactive && item.model !== CLAUDE_BAD_FALLBACK_MODEL) ||
      models.find((item) => typeof item?.model === 'string' && item.model !== CLAUDE_BAD_FALLBACK_MODEL);

    return preferred?.model || CLAUDE_SAFE_DEFAULT_MODEL;
  };

  const toClaudeModelSelectorOption = (item) => {
    if (!item || typeof item.model !== 'string' || !item.model) return null;

    const option = {
      id: item.model,
      name: item.name || item.model
    };

    if (item.description) option.description = item.description;
    if (item.notice_text) option.notice_text = item.notice_text;
    if (item.capabilities && typeof item.capabilities === 'object') option.capabilities = item.capabilities;
    if (item.knowledgeCutoff) option.knowledgeCutoff = item.knowledgeCutoff;
    if (item.overflow) option.section = 'overflow';
    if (item.inactive) option.section = option.section || 'deprecated';

    if (Array.isArray(item.thinking_modes) && item.thinking_modes.length) {
      const modeOptions = item.thinking_modes.map((mode) => ({
        id: mode.id || mode.mode || mode.paprika_mode_value,
        name: mode.title || mode.selection_title || mode.id || mode.mode || 'Thinking',
        description: mode.description,
        recommended: mode.id === 'auto'
      })).filter((mode) => mode.id);

      if (modeOptions.length) {
        option.thinking = {
          type: 'mode',
          description: modeOptions[0].description,
          mode_options: [
            { id: 'off', name: 'Off' },
            ...modeOptions
          ]
        };
      }
    }

    return option;
  };

  const ensureClaudeModelSelectorBootstrap = (bootstrapJson, model) => {
    const bootstrapModels = getClaudeBootstrapModelsConfig(bootstrapJson);
    const selectorModels = bootstrapModels
      .map(toClaudeModelSelectorOption)
      .filter(Boolean);

    if (!selectorModels.length) return;

    const ensureSurfaceConfig = (surface) => {
      if (!Array.isArray(bootstrapJson.model_selector_config)) {
        bootstrapJson.model_selector_config = [];
      }

      const existing = bootstrapJson.model_selector_config.find((entry) => entry?.id === surface);
      if (existing) {
        if (!Array.isArray(existing.models) || existing.models.length <= 1) {
          existing.models = selectorModels;
        }
        return;
      }

      bootstrapJson.model_selector_config.push({
        id: surface,
        models: selectorModels
      });
    };

    const ensureSurfaceState = (surface) => {
      if (!Array.isArray(bootstrapJson.model_selector_state)) {
        bootstrapJson.model_selector_state = [];
      }

      const existing = bootstrapJson.model_selector_state.find((entry) => entry?.id === surface);
      if (existing) {
        if (!existing.model || existing.model === CLAUDE_BAD_FALLBACK_MODEL) {
          existing.model = model;
        }
        return;
      }

      bootstrapJson.model_selector_state.push({
        id: surface,
        model,
        source: 'bootstrap_default'
      });
    };

    // /new uses the chat surface. The same bootstrap can be shared by adjacent
    // Claude surfaces, so keep the recovered config available there too.
    ['chat', 'cowork', 'code', 'baku'].forEach((surface) => {
      ensureSurfaceConfig(surface);
      ensureSurfaceState(surface);
    });
  };

  const patchClaudeBootstrapJson = (bootstrapJson) => {
    if (!bootstrapJson || typeof bootstrapJson !== 'object') return null;

    const model = getSafeClaudeDefaultModel(bootstrapJson);
    bootstrapJson.growthbook = bootstrapJson.growthbook || {};
    bootstrapJson.growthbook.features = bootstrapJson.growthbook.features || {};

    const featureValue = {
      model,
      overrideSticky: true
    };
    const featureConfig = {
      defaultValue: featureValue,
      rules: [{ force: featureValue }]
    };

    // Claude /new in an embedded frame can miss the top-level model selector
    // bootstrap rows even though the account membership still carries the full
    // model list. Rehydrate those rows from the existing bootstrap payload. This
    // keeps /new as a clean URL and preserves all model-picker options.
    ensureClaudeModelSelectorBootstrap(bootstrapJson, model);

    bootstrapJson.growthbook.features[CLAUDE_CONSOLE_DEFAULT_MODEL_FEATURE_KEY] = featureConfig;
    bootstrapJson.growthbook.features[CLAUDE_CONSOLE_DEFAULT_MODEL_DJB2_KEY] = featureConfig;

    try {
      localStorage.setItem('default-model', model);
      if (localStorage.getItem('sticky-model-selector') === CLAUDE_BAD_FALLBACK_MODEL) {
        localStorage.setItem('sticky-model-selector', model);
      }
    } catch (error) {}

    return bootstrapJson;
  };

  const isClaudeBootstrapRequest = (input) => {
    try {
      const url = new URL(typeof input === 'string' ? input : input?.url, location.href);
      return url.hostname === 'claude.ai' &&
        (url.pathname === '/edge-api/bootstrap' || /^\/edge-api\/bootstrap\/[^/]+\/app_start$/.test(url.pathname));
    } catch (error) {
      return false;
    }
  };

  const makePatchedBootstrapResponse = async (response) => {
    try {
      const clone = response.clone();
      const json = await clone.json();
      const patched = patchClaudeBootstrapJson(json);
      if (!patched) return response;

      const headers = new Headers(response.headers);
      headers.set('content-type', 'application/json');
      headers.delete('content-length');

      return new Response(JSON.stringify(patched), {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    } catch (error) {
      return response;
    }
  };

  if (isClaudeNewChatWithoutModelParam() && typeof window.fetch === 'function' && !window.__AI_MULTICHAT_CLAUDE_FETCH_PATCH__) {
    window.__AI_MULTICHAT_CLAUDE_FETCH_PATCH__ = true;
    const originalFetch = window.fetch;
    window.fetch = async function(input, init) {
      const response = await originalFetch.apply(this, arguments);
      if (!isClaudeBootstrapRequest(input)) return response;
      return makePatchedBootstrapResponse(response);
    };
  }

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

