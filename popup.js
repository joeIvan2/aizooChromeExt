// popup.js - AI Multi-Chat 主頁面控制邏輯

console.log('[AI Multi-Chat] Popup initializing...');

const platforms = ['grok', 'gemini', 'claude', 'chatgpt', 'meta'];
const platformDisplayNames = Object.freeze({
  grok: 'Grok',
  gemini: 'Gemini',
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  meta: 'Meta AI'
});
const PLATFORM_LAYOUT_STORAGE_KEY = 'ai-zoo-platform-layout-v1';
const LAYOUT_CONFIG_HASH = '#layout-config';
let activePlatformLayout = readStoredPlatformLayout();
let layoutDraft = [...activePlatformLayout];
let pendingLayoutDialogOpen = window.location.hash === LAYOUT_CONFIG_HASH;

function getPlatformDisplayName(platform) {
  return platformDisplayNames[platform] || platform;
}
const iframes = {};
const statusElements = {};
let currentMaximizedPlatform = null; // 當前放大的平台
const platformEnabledState = {};
const pendingDiagnostics = new Map();
const activeSubmissionIds = {};
const SUBMISSION_LIFECYCLE_TYPES = new Set([
  'AI_QUESTION_SENT',
  'AI_RESPONSE_START',
  'AI_RESPONSE_UPDATE',
  'AI_RESPONSE_RECEIVED',
  'AI_ERROR',
  'AI_INFO'
]);
let submissionSequence = 0;
let compareNavigationEpoch = 0;
let sessionLoadInProgress = false;
let shareLastFocusedElement = null;
const SESSION_LIST_STORAGE_KEY = 'ai-chat-session-list';
const MAX_SESSION_RECORDS = 50;
const SESSION_CAPTURE_WINDOW_MS = 2 * 60 * 1000;
const COMPARE_POLL_INTERVAL_MS = 2500;
const COMPARE_STABLE_POLLS_REQUIRED = 3;
const COMPARE_STABLE_POLLS_REQUIRED_BY_PLATFORM = { chatgpt: 8 };
const COMPARE_QUIET_PERIOD_MS = 6000;
const COMPARE_QUIET_PERIOD_MS_BY_PLATFORM = { chatgpt: 30000, meta: 8000 };
const COMPARE_COMPLETED_RECHECK_INTERVAL_MS = 10000;
const COMPARE_OPEN_REFRESH_DELAYS_MS = [1200, 3500, 8000, 15000, 30000];
const COMPARE_SEND_HISTORY_REFRESH_DELAYS_MS = [700, 2200, 5000, 10000, 20000, 35000];
const COMPARE_HISTORY_REQUEST_MIN_GAP_MS = 900;
const COMPARE_HISTORY_REQUEST_STALE_MS = 8000;
const COMPARE_HISTORY_SCRAPE_TIMEOUT_MS = 2500;
let activeSessionDraft = null;
let comparePollTimer = null;
let compareOpenRefreshTimers = [];
let compareHistoryRequestId = 0;
let compareIgnoreScrapeResponsesUntil = 0;
const compareWatchState = {};
const compareLatestHistories = {};
const compareHistoryRequestState = {};
const LANGUAGE_STORAGE_KEY = 'ai-zoo-language';
const DEFAULT_LANGUAGE = 'auto';
const SUMMARY_PROMPT_STORAGE_KEY = 'ai-zoo-summary-prompt';
const SUMMARY_PROMPT_CUSTOMIZED_STORAGE_KEY = 'ai-zoo-summary-prompt-customized';
const RESIZE_HINT_STORAGE_KEYS = {
  minimize: 'ai-zoo-resize-minimize-seen',
  maximize: 'ai-zoo-resize-maximize-seen',
  restore: 'ai-zoo-resize-restore-seen',
  panelRestore: 'ai-zoo-resize-panel-restore-seen'
};
const supportedLanguages = [
  { code: 'auto', label: 'Auto' },
  { code: 'de', label: 'Deutsch' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'ja', label: '日本語' },
  { code: 'zh_CN', label: '简体中文' },
  { code: 'zh_TW', label: '繁體中文' }
];
let selectedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY) || DEFAULT_LANGUAGE;
let selectedLanguageMessages = null;
const languageMessageCache = {};

let currentExtensionTabId = null;
const pendingLayoutRequests = [];

function processLayoutOpenRequest(request) {
  if (request?.type !== 'AI_ZOO_OPEN_LAYOUT_CONFIG') return;
  if (request.targetTabId !== undefined && currentExtensionTabId === null) {
    pendingLayoutRequests.push(request);
    return;
  }
  if (request.targetTabId !== undefined && request.targetTabId !== currentExtensionTabId) return;

  pendingLayoutDialogOpen = true;
  if (document.getElementById('layout-config-dialog')) {
    pendingLayoutDialogOpen = false;
    openPlatformLayoutDialog();
  }
}

chrome.runtime.onMessage.addListener((request) => {
  if (request?.type !== 'AI_ZOO_OPEN_LAYOUT_CONFIG') return;
  processLayoutOpenRequest(request);
});

chrome.tabs?.getCurrent?.().then((tab) => {
  currentExtensionTabId = tab?.id ?? -1;
  pendingLayoutRequests.splice(0).forEach(processLayoutOpenRequest);
}).catch(() => {
  currentExtensionTabId = -1;
  pendingLayoutRequests.splice(0).forEach(processLayoutOpenRequest);
});

// Register before any asynchronous initialization so early READY/load events
// from already-running provider frames cannot be missed.
window.addEventListener('message', handleMessage);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) requestCompareHistories({ includeCompleted: true, force: true });
});

const CLAUDE_NEW_CHAT_URL = 'https://claude.ai/new';

const defaultUrls = {
  grok: 'https://grok.com/',
  gemini: 'https://gemini.google.com/app',
  claude: CLAUDE_NEW_CHAT_URL,
  chatgpt: 'https://chatgpt.com/',
  meta: 'https://www.meta.ai/'
};

function normalizePlatformUrl(platform, url) {
  if (platform !== 'claude' || !url) return url;

  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'claude.ai' && parsed.pathname === '/new') {
      parsed.searchParams.delete('model');
      return parsed.toString();
    }
  } catch (error) {}

  return url;
}

const conversationUrlPatterns = {
  grok: /^https:\/\/grok\.com\/(?:chat|c)\//,
  gemini: /^https:\/\/gemini\.google\.com\/app\/[^/?#]+/,
  claude: /^https:\/\/claude\.ai\/chat\/[^/?#]+/,
  chatgpt: /^https:\/\/chatgpt\.com\/c\/[^/?#]+/,
  meta: /^https:\/\/(?:www\.)?meta\.ai\/prompt\/[^/?#]+/
};

function normalizePlatformLayout(value) {
  if (!Array.isArray(value)) return [...platforms];

  const normalized = value.filter((platform, index) => (
    platforms.includes(platform) && value.indexOf(platform) === index
  )).slice(0, platforms.length);

  return normalized.length > 0 ? normalized : [...platforms];
}

function readStoredPlatformLayout() {
  try {
    const stored = localStorage.getItem(PLATFORM_LAYOUT_STORAGE_KEY);
    return stored ? normalizePlatformLayout(JSON.parse(stored)) : [...platforms];
  } catch (error) {
    console.warn('[AI Multi-Chat] Could not read the saved platform layout:', error);
    return [...platforms];
  }
}

function getConfiguredPlatforms() {
  return [...activePlatformLayout];
}

function isPlatformInLayout(platform) {
  return activePlatformLayout.includes(platform);
}

function syncLayoutButton() {
  const button = document.getElementById('layout-config-btn');
  const badge = document.getElementById('layout-count-badge');
  const count = activePlatformLayout.length;
  const title = t('layoutButtonCurrentTitle', 'Layout: $1 panes', [count]);

  if (badge) badge.textContent = String(count);
  if (button) {
    button.title = title;
    button.setAttribute('aria-label', title);
  }
}

function applyPlatformLayout(nextLayout, options = {}) {
  const normalized = normalizePlatformLayout(nextLayout);
  const previousLayout = [...activePlatformLayout];
  const newlyAdded = normalized.filter(platform => !previousLayout.includes(platform));
  const removedPlatforms = previousLayout.filter(platform => !normalized.includes(platform));

  if (currentMaximizedPlatform && !normalized.includes(currentMaximizedPlatform)) {
    setMaximizedPlatform(currentMaximizedPlatform, { toggle: true });
  }

  activePlatformLayout = normalized;
  layoutDraft = [...normalized];

  if (options.persist) {
    localStorage.setItem(PLATFORM_LAYOUT_STORAGE_KEY, JSON.stringify(normalized));
  }

  const orderedPlatforms = [
    ...normalized,
    ...platforms.filter(platform => !normalized.includes(platform))
  ];
  const iframeContainer = document.querySelector('.iframes-container');
  const compareGrid = document.querySelector('.compare-grid');
  const sendOneMenu = document.getElementById('send-one-platform-menu');
  const summaryMenu = document.getElementById('summary-platform-menu');

  orderedPlatforms.forEach((platform, orderIndex) => {
    const wrapper = iframeContainer?.querySelector(`.iframe-wrapper[data-platform="${platform}"]`);
    const compareCol = compareGrid?.querySelector(`.compare-col[data-platform="${platform}"]`);
    const sendOneButton = sendOneMenu?.querySelector(`[data-send-one-platform="${platform}"]`);
    const summaryButton = summaryMenu?.querySelector(`[data-summary-platform="${platform}"]`);
    if (wrapper) wrapper.style.order = String(orderIndex);
    if (compareCol) compareCol.style.order = String(orderIndex);
    if (sendOneButton) sendOneMenu.appendChild(sendOneButton);
    if (summaryButton) summaryMenu.appendChild(summaryButton);
  });

  platforms.forEach((platform) => {
    const visible = normalized.includes(platform);
    const wrapper = document.querySelector(`.iframe-wrapper[data-platform="${platform}"]`);
    const compareCol = document.querySelector(`.compare-col[data-platform="${platform}"]`);

    [wrapper, compareCol].forEach((element) => {
      if (!element) return;
      element.classList.toggle('layout-platform-hidden', !visible);
      element.setAttribute('aria-hidden', String(!visible));
      element.inert = !visible;
    });

    renderPlatformToggle(platform, { preserveStatus: true });
  });

  document.documentElement.style.setProperty('--platform-layout-count', String(normalized.length));
  document.body.dataset.platformLayout = normalized.join(',');
  document.body.dataset.platformLayoutCount = String(normalized.length);
  syncLayoutButton();
  syncSendOnePlatformMenu();
  syncSummaryPlatformMenu();

  removedPlatforms.forEach(platform => clearPlatformRuntimeState(platform, {
    clearHistory: true,
    cancelRemote: true
  }));

  if (options.refreshAdded && newlyAdded.length > 0) {
    window.setTimeout(() => {
      newlyAdded.forEach((platform) => {
        if (iframes[platform]) refreshIframe(platform);
      });
    }, 80);
  }

  console.log('[AI Multi-Chat] Platform layout applied:', normalized.join(', '));
}

function setLayoutDraftCount(count) {
  const nextCount = Math.max(1, Math.min(platforms.length, Number(count) || platforms.length));

  if (nextCount < layoutDraft.length) {
    layoutDraft = layoutDraft.slice(0, nextCount);
  } else if (nextCount > layoutDraft.length) {
    const unused = platforms.filter(platform => !layoutDraft.includes(platform));
    layoutDraft = [...layoutDraft, ...unused.slice(0, nextCount - layoutDraft.length)];
  }

  renderLayoutConfig();
}

function moveLayoutSlot(index, direction) {
  const destination = index + direction;
  if (destination < 0 || destination >= layoutDraft.length) return;

  [layoutDraft[index], layoutDraft[destination]] = [layoutDraft[destination], layoutDraft[index]];
  renderLayoutConfig();
}

function renderLayoutConfig() {
  const dialog = document.getElementById('layout-config-dialog');
  const countOptions = document.getElementById('layout-count-options');
  const slotList = document.getElementById('layout-slot-list');
  const errorElement = document.getElementById('layout-config-error');
  if (!dialog || !countOptions || !slotList) return;

  countOptions.replaceChildren();
  for (let count = 1; count <= platforms.length; count += 1) {
    const button = document.createElement('button');
    const active = count === layoutDraft.length;
    button.type = 'button';
    button.className = 'layout-count-option';
    button.textContent = String(count);
    button.dataset.layoutCount = String(count);
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(active));
    button.setAttribute('aria-label', t('layoutPaneCountLabel', '$1 panes', [count]));
    button.addEventListener('click', () => setLayoutDraftCount(count));
    countOptions.appendChild(button);
  }

  slotList.replaceChildren();
  layoutDraft.forEach((selectedPlatform, index) => {
    const row = document.createElement('div');
    row.className = 'layout-slot-row';
    row.dataset.slotIndex = String(index);

    const label = document.createElement('label');
    const selectId = `layout-slot-select-${index}`;
    label.className = 'layout-slot-number';
    label.htmlFor = selectId;
    label.textContent = t('layoutSlotLabel', 'Pane $1', [index + 1]);

    const select = document.createElement('select');
    select.id = selectId;
    select.className = 'layout-slot-select';
    select.dataset.slotIndex = String(index);
    select.setAttribute('aria-label', label.textContent);

    platforms.forEach((platform) => {
      const option = document.createElement('option');
      option.value = platform;
      option.textContent = getPlatformDisplayName(platform);
      option.selected = platform === selectedPlatform;
      option.disabled = platform !== selectedPlatform && layoutDraft.includes(platform);
      select.appendChild(option);
    });

    select.addEventListener('change', () => {
      const nextPlatform = select.value;
      if (layoutDraft.some((platform, slotIndex) => platform === nextPlatform && slotIndex !== index)) {
        if (errorElement) {
          errorElement.textContent = t('layoutDuplicateError', 'Each pane must use a different AI platform.');
        }
        renderLayoutConfig();
        return;
      }

      layoutDraft[index] = nextPlatform;
      renderLayoutConfig();
    });

    const moveLeftButton = document.createElement('button');
    moveLeftButton.type = 'button';
    moveLeftButton.className = 'layout-slot-move';
    moveLeftButton.dataset.direction = '-1';
    moveLeftButton.textContent = '←';
    moveLeftButton.disabled = index === 0;
    moveLeftButton.title = t('layoutMoveLeft', 'Move left');
    moveLeftButton.setAttribute('aria-label', t('layoutMoveLeft', 'Move left'));
    moveLeftButton.addEventListener('click', () => moveLayoutSlot(index, -1));

    const moveRightButton = document.createElement('button');
    moveRightButton.type = 'button';
    moveRightButton.className = 'layout-slot-move';
    moveRightButton.dataset.direction = '1';
    moveRightButton.textContent = '→';
    moveRightButton.disabled = index === layoutDraft.length - 1;
    moveRightButton.title = t('layoutMoveRight', 'Move right');
    moveRightButton.setAttribute('aria-label', t('layoutMoveRight', 'Move right'));
    moveRightButton.addEventListener('click', () => moveLayoutSlot(index, 1));

    row.append(label, select, moveLeftButton, moveRightButton);
    slotList.appendChild(row);
  });

  if (errorElement) errorElement.textContent = '';
}

function openPlatformLayoutDialog() {
  const dialog = document.getElementById('layout-config-dialog');
  if (!dialog) {
    pendingLayoutDialogOpen = true;
    return;
  }

  closeLanguageMenu();
  closeSendOnePlatformMenu();
  closeSummaryPlatformMenu();
  layoutDraft = [...activePlatformLayout];
  renderLayoutConfig();

  if (!dialog.open) dialog.showModal();
  document.getElementById('layout-count-options')?.querySelector('[aria-checked="true"]')?.focus();

  if (window.location.hash === LAYOUT_CONFIG_HASH) {
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  }
}

function closePlatformLayoutDialog() {
  const dialog = document.getElementById('layout-config-dialog');
  if (dialog?.open) dialog.close();
  layoutDraft = [...activePlatformLayout];
}

function savePlatformLayout() {
  const normalized = normalizePlatformLayout(layoutDraft);
  const errorElement = document.getElementById('layout-config-error');
  const isValid = normalized.length === layoutDraft.length
    && new Set(layoutDraft).size === layoutDraft.length;

  if (!isValid) {
    if (errorElement) {
      errorElement.textContent = t('layoutDuplicateError', 'Each pane must use a different AI platform.');
    }
    return;
  }

  applyPlatformLayout(normalized, { persist: true, refreshAdded: true });
  closePlatformLayoutDialog();
}

function bindLayoutConfigurator() {
  const dialog = document.getElementById('layout-config-dialog');
  const form = document.getElementById('layout-config-form');

  document.getElementById('layout-config-btn')?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openPlatformLayoutDialog();
  });
  document.getElementById('close-layout-config-btn')?.addEventListener('click', closePlatformLayoutDialog);
  document.getElementById('cancel-layout-config-btn')?.addEventListener('click', closePlatformLayoutDialog);

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    savePlatformLayout();
  });

  dialog?.addEventListener('cancel', (event) => {
    event.preventDefault();
    closePlatformLayoutDialog();
  });
  dialog?.addEventListener('click', (event) => {
    if (event.target === dialog) closePlatformLayoutDialog();
  });
}

async function getRestorableGrokUrl(url) {
  const conversationId = String(url || '').match(
    /^https:\/\/grok\.com\/(?:chat|c)\/([^/?#]+)/
  )?.[1];
  if (!conversationId) return url;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(
      `https://grok.com/rest/app-chat/conversations_v2/${encodeURIComponent(conversationId)}?includeWorkspaces=true&includeTaskResult=true`,
      {
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal
      }
    );
    if (!response.ok) return url;

    const data = await response.json();
    const keys = data && typeof data === 'object' ? Object.keys(data) : [];
    if (keys.length === 1 && typeof data.shareLinkPath === 'string') {
      console.warn('[grok] Saved conversation is unavailable for the current account; using the Grok home page');
      return '';
    }
  } catch (error) {
    console.warn('[grok] Could not validate saved conversation URL:', error);
  } finally {
    clearTimeout(timeoutId);
  }

  return url;
}

function applySubstitutions(text, substitutions) {
  let result = text || '';
  const values = Array.isArray(substitutions)
    ? substitutions
    : (substitutions === undefined ? [] : [substitutions]);

  values.forEach((value, index) => {
    result = result.replaceAll(`$${index + 1}`, String(value));
  });

  return result;
}

function t(key, fallback = '', substitutions) {
  const overrideMessage = selectedLanguageMessages?.[key]?.message;
  if (overrideMessage) {
    return applySubstitutions(overrideMessage, substitutions);
  }

  const message = (typeof chrome !== 'undefined' && chrome?.i18n)
    ? chrome.i18n.getMessage(key, substitutions)
    : '';
  let text = message || fallback || '';

  return text;
}

// i18n 初始化函數
async function loadLanguageMessages(languageCode) {
  if (!languageCode || languageCode === DEFAULT_LANGUAGE) {
    selectedLanguageMessages = null;
    return;
  }

  if (!supportedLanguages.some(language => language.code === languageCode)) {
    selectedLanguageMessages = null;
    selectedLanguage = DEFAULT_LANGUAGE;
    localStorage.setItem(LANGUAGE_STORAGE_KEY, DEFAULT_LANGUAGE);
    return;
  }

  if (!languageMessageCache[languageCode]) {
    try {
      const response = await fetch(chrome.runtime.getURL(`_locales/${languageCode}/messages.json`));
      languageMessageCache[languageCode] = await response.json();
    } catch (error) {
      console.error('[AI Multi-Chat] Failed to load language messages:', languageCode, error);
      selectedLanguageMessages = null;
      return;
    }
  }

  selectedLanguageMessages = languageMessageCache[languageCode];
}

async function initI18n() {
  await loadLanguageMessages(selectedLanguage);

  // 處理 data-i18n 屬性（設置 textContent）
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const key = element.getAttribute('data-i18n');
    const message = t(key);
    if (message) {
      element.textContent = message;
    }
  });

  // 處理 data-i18n-placeholder 屬性（設置 placeholder）
  document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
    const key = element.getAttribute('data-i18n-placeholder');
    const message = t(key);
    if (message) {
      element.placeholder = message;
    }
  });

  // 處理 data-i18n-title 屬性（設置 title）
  document.querySelectorAll('[data-i18n-title]').forEach(element => {
    const key = element.getAttribute('data-i18n-title');
    const message = t(key);
    if (message) {
      element.title = message;
      if (element.matches('button') && !element.hasAttribute('aria-label')) {
        element.setAttribute('aria-label', message);
      }
    }
  });

  document.querySelectorAll('[data-i18n-aria-label]').forEach(element => {
    const key = element.getAttribute('data-i18n-aria-label');
    const message = t(key);
    if (message) {
      element.setAttribute('aria-label', message);
    }
  });

  document.querySelectorAll('[data-i18n-alt]').forEach(element => {
    const message = t(element.getAttribute('data-i18n-alt'));
    if (message) element.alt = message;
  });

  syncSummaryPromptInput();
  syncLanguageMenu();
  syncLayoutButton();
  if (document.getElementById('layout-config-dialog')?.open) {
    renderLayoutConfig();
  }
  console.log('[AI Multi-Chat] i18n initialized');
}

function requestPlatformReadyState(platform) {
  const iframe = iframes[platform];
  if (!iframe?.contentWindow || !isPlatformInLayout(platform)) return;
  iframe.contentWindow.postMessage({
    type: 'AI_READY_CHECK',
    platform,
    source: 'popup'
  }, '*');
}

function handleProviderFrameLoad(platform) {
  console.log(`[${platform}] iframe loaded`);
  updateStatus(platform, '⏳', t('statusWaitingReady', 'Waiting for readiness...'));

  // Ask the adapter directly instead of depending on a one-shot READY event.
  setTimeout(() => requestPlatformReadyState(platform), 100);
  setTimeout(() => requestPlatformReadyState(platform), 1200);

  if (isComparePanelVisible() && isPlatformEnabled(platform)) {
    const state = compareWatchState[platform];
    if (!state || state.complete) {
      const textEl = document.getElementById(`compare-text-${platform}`);
      if (textEl) textEl.textContent = t('loadingConversationHistory', 'Loading conversation history...');
      const navigationEpoch = Number(iframes[platform]?.dataset.navigationEpoch || compareNavigationEpoch);
      setTimeout(() => requestPlatformHistory(platform, {
        force: true,
        navigationEpoch
      }), 800);
    }
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  console.log('[AI Multi-Chat] DOM loaded, initializing...');
  syncResizeControlsHint();

  // Bind provider frames before any network/localization await.
  platforms.forEach(platform => {
    iframes[platform] = document.getElementById(`${platform}-iframe`);
    statusElements[platform] = document.getElementById(`${platform}-status`);
    iframes[platform]?.addEventListener('load', () => handleProviderFrameLoad(platform));
  });

  initI18n().catch(error => console.warn('[AI Multi-Chat] i18n initialization failed:', error));
  applyPlatformLayout(activePlatformLayout, { persist: false, refreshAdded: false });
  bindLayoutConfigurator();

  const storedGrokUrl = normalizePlatformUrl('grok', localStorage.getItem('ai-chat-url-grok'));
  const restoreEpoch = compareNavigationEpoch;
  getRestorableGrokUrl(storedGrokUrl).then(restorableGrokUrl => {
    if (restoreEpoch !== compareNavigationEpoch) return;
    if (storedGrokUrl !== normalizePlatformUrl('grok', localStorage.getItem('ai-chat-url-grok'))) return;
    if (storedGrokUrl && !restorableGrokUrl) localStorage.removeItem('ai-chat-url-grok');
    if (restorableGrokUrl && restorableGrokUrl !== defaultUrls.grok && iframes.grok) {
      iframes.grok.src = restorableGrokUrl;
    }
  }).catch(error => console.warn('[Grok] Saved URL validation failed:', error));

  // Restore all non-Grok URLs synchronously. Grok is validated above without
  // delaying the rest of the controller.
  platforms.forEach(platform => {
    if (platform === 'grok') return;
    const savedUrl = normalizePlatformUrl(platform, localStorage.getItem(`ai-chat-url-${platform}`));
    if (savedUrl && savedUrl !== defaultUrls[platform]) {
      console.log(`[${platform}] Restoring saved URL:`, savedUrl);
      iframes[platform].src = savedUrl;
    }
  });

  platforms.forEach(platform => requestPlatformReadyState(platform));

  // 發送按鈕
  const mainQuestionInput = document.getElementById('question-input');
  const sendAllBtn = document.getElementById('send-all-btn');
  if (sendAllBtn) {
    const sendAllFromButton = (e) => {
      e.preventDefault();
      e.stopPropagation();
      sendQuestionToAll(mainQuestionInput);
    };
    sendAllBtn.addEventListener('click', sendAllFromButton);
  }

  const sendOneBtn = document.getElementById('send-one-btn');
  if (sendOneBtn) {
    const toggleSendOneFromButton = (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleSendOnePlatformMenu();
    };

    sendOneBtn.addEventListener('click', toggleSendOneFromButton);
  }

  document.querySelectorAll('[data-send-one-platform]').forEach((button) => {
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      sendQuestionToOnePlatform(button.dataset.sendOnePlatform, mainQuestionInput);
    });
  });

  // 智慧對比按鈕
  const compareBtn = document.getElementById('compare-btn');
  if (compareBtn) {
    const toggleComparePanelFromButton = (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleComparePanel();
    };

    compareBtn.addEventListener('click', toggleComparePanelFromButton);
  }

  const closeCompareBtn = document.getElementById('close-compare-btn');
  if (closeCompareBtn) {
    closeCompareBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeComparePanel();
    });
  }

  const shareCompareBtn = document.getElementById('share-compare-btn');
  if (shareCompareBtn) {
    shareCompareBtn.addEventListener('click', openSharePanel);
  }

  const summaryCompareBtn = document.getElementById('summary-compare-btn');
  if (summaryCompareBtn) {
    summaryCompareBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleSummaryPlatformMenu();
    });
  }

  const summaryPromptInput = document.getElementById('summary-prompt-input');
  if (summaryPromptInput) {
    summaryPromptInput.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    summaryPromptInput.addEventListener('input', () => {
      localStorage.setItem(SUMMARY_PROMPT_STORAGE_KEY, summaryPromptInput.value);
      localStorage.setItem(SUMMARY_PROMPT_CUSTOMIZED_STORAGE_KEY, 'true');
    });
  }

  document.querySelectorAll('[data-summary-platform]').forEach((button) => {
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      sendCompareSummaryToPlatform(button.dataset.summaryPlatform);
    });
  });

  const languageBtn = document.getElementById('language-btn');
  if (languageBtn) {
    const toggleLanguageFromButton = (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleLanguageMenu();
    };

    languageBtn.addEventListener('click', toggleLanguageFromButton);
  }

  document.querySelectorAll('[data-language-option]').forEach((button) => {
    button.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await setSelectedLanguage(button.dataset.languageOption);
    });
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.compare-summary-wrap')) {
      closeSummaryPlatformMenu();
    }

    if (!e.target.closest('.single-send-wrap')) {
      closeSendOnePlatformMenu();
    }

    if (!e.target.closest('.language-wrap')) {
      closeLanguageMenu();
    }
  });

  document.getElementById('close-share-btn')?.addEventListener('click', closeSharePanel);
  document.getElementById('copy-share-btn')?.addEventListener('click', copyShareText);
  document.getElementById('download-share-btn')?.addEventListener('click', downloadShareMarkdown);
  document.getElementById('native-share-btn')?.addEventListener('click', nativeShareCompareText);
  document.getElementById('share-panel')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeSharePanel();
  });

  // 新對話按鈕
  const newChatBtn = document.getElementById('new-chat-btn');
  if (newChatBtn) {
    const startNewChatFromButton = (e) => {
      e.preventDefault();
      e.stopPropagation();
      startNewChatForAll();
    };

    newChatBtn.addEventListener('click', startNewChatFromButton);
  }

  document.getElementById('history-toggle-btn').addEventListener('click', toggleSessionSwitcher);
  document.getElementById('load-session-btn').addEventListener('click', loadSelectedSession);
  document.getElementById('delete-session-btn').addEventListener('click', deleteSelectedSession);
  document.getElementById('hide-session-btn').addEventListener('click', hideSessionSwitcher);

  document.querySelectorAll('[data-platform-toggle]').forEach((button) => {
    const platform = button.dataset.platformToggle;
    button.addEventListener('click', () => {
      setPlatformEnabled(platform, !isPlatformEnabled(platform));
    });
  });

  document.querySelectorAll('[data-diagnose-platform]').forEach((button) => {
    const platform = button.dataset.diagnosePlatform;
    button.addEventListener('click', () => {
      runPlatformDiagnostics(platform);
    });
  });

  document.querySelectorAll('[data-breakpoint-platform]').forEach((button) => {
    const platform = button.dataset.breakpointPlatform;
    button.addEventListener('click', () => {
      armPlatformBreakpoint(platform);
    });
  });

  document.querySelectorAll('[data-protect-platform]').forEach((button) => {
    const platform = button.dataset.protectPlatform;
    button.addEventListener('click', () => {
      enablePlatformSidebarProtection(platform);
    });
  });

  document.getElementById('close-diagnostics-btn').addEventListener('click', () => {
    document.getElementById('diagnostics-panel').classList.add('hidden');
  });

  // Enter 快捷鍵（Ctrl+Enter 發送）
  mainQuestionInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      sendQuestionToAll(mainQuestionInput);
    }
  });

  // 聚焦到輸入框
  mainQuestionInput.focus();

  // 全局焦點管理：防止 iframe 自動搶走焦點（僅在非放大狀態下）
  let userInteractedWithIframe = false;

  // 監聽用戶是否主動點擊 iframe
  document.querySelectorAll('.iframe-wrapper').forEach(wrapper => {
    wrapper.addEventListener('mousedown', () => {
      userInteractedWithIframe = true;
    });
  });

  // 監聽焦點變化
  document.addEventListener('focusin', (e) => {
    const targetInput = getPreferredQuestionInput();

    // 如果焦點跳到 iframe，且沒有放大任何 iframe，且用戶沒有主動點擊 iframe
    if (e.target.tagName === 'IFRAME' && !currentMaximizedPlatform && !userInteractedWithIframe) {
      console.log('[AI Multi-Chat] Focus stolen by iframe, refocusing question input');
      setTimeout(() => {
        if (targetInput) targetInput.focus();
      }, 50);
    }
  });

  // 當用戶開始在主輸入框輸入時，重置互動標記
  mainQuestionInput.addEventListener('focus', () => {
    userInteractedWithIframe = false;
  });

  // 全局鍵盤事件（用於切換放大的 iframe）
  document.addEventListener('keydown', (e) => {
    // Ctrl + 左/右箭頭切換放大的 iframe
    if (e.ctrlKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      if (currentMaximizedPlatform) {
        e.preventDefault();
        switchMaximizedIframe(e.key === 'ArrowLeft' ? -1 : 1);
      }
    }
  });

  window.addEventListener('resize', positionSessionSwitcher);

  function switchMaximizedIframe(direction) {
    if (!currentMaximizedPlatform) return;

    const configuredPlatforms = getConfiguredPlatforms();
    const currentIndex = configuredPlatforms.indexOf(currentMaximizedPlatform);
    let steps = 0;
    let newIndex = currentIndex;

    // 循環尋找下一個處於啟用狀態 (ON) 的平台，最多輪詢一圈防止死循環
    do {
      newIndex = newIndex + direction;
      if (newIndex < 0) {
        newIndex = configuredPlatforms.length - 1;
      } else if (newIndex >= configuredPlatforms.length) {
        newIndex = 0;
      }
      steps++;

      const potentialPlatform = configuredPlatforms[newIndex];
      if (isPlatformEnabled(potentialPlatform)) {
        console.log(`[AI Multi-Chat] Switching maximized iframe from ${currentMaximizedPlatform} to ${potentialPlatform}`);
        toggleMaximize(potentialPlatform);
        return;
      }
    } while (steps < configuredPlatforms.length);
  }

  document.querySelectorAll('.prev-platform-btn, .next-platform-btn').forEach(btn => {
    const switchFromButton = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const direction = btn.classList.contains('prev-platform-btn') ? -1 : 1;
      switchMaximizedIframe(direction);
    };

    btn.addEventListener('click', switchFromButton);
  });

  // --- Refresh iframe Logic ---
  // 為所有刷新按鈕添加事件監聽器
  document.querySelectorAll('.refresh-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const platform = btn.dataset.platform;
      refreshIframe(platform); // 調用全局函數
    });
  });

  // --- Maximize/Minimize iframe Logic ---
  // 為所有放大按鈕添加事件監聽器
  document.querySelectorAll('.maximize-btn').forEach(btn => {
    const toggleMaximizeFromButton = (e) => {
      e.preventDefault();
      e.stopPropagation();
      markResizeControlSeen(currentMaximizedPlatform === btn.dataset.platform ? 'restore' : 'maximize');
      const platform = btn.dataset.platform;
      toggleMaximize(platform);
    };

    btn.addEventListener('click', toggleMaximizeFromButton);
  });

  function toggleMaximize(platform) {
    setMaximizedPlatform(platform, { toggle: true });
  }

  // --- Draggable Input Section Logic ---
  const inputSection = document.querySelector('.input-section');
  const INPUT_DRAG_THRESHOLD_PX = 6;
  let isDragging = false;
  let hasMoved = false; // 用於區分拖拽與點擊恢復的 Flag
  let currentX;
  let currentY;
  let initialX;
  let initialY;
  let pointerStartX;
  let pointerStartY;
  function readSavedInputPosition() {
    const raw = localStorage.getItem('ai-chat-input-pos');
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      const left = Number.parseFloat(parsed.left ?? parsed.x);
      const top = Number.parseFloat(parsed.top ?? parsed.y);
      return Number.isFinite(left) && Number.isFinite(top) ? { left, top } : null;
    } catch (error) {
      console.warn('[AI Multi-Chat] Ignoring malformed input position:', error);
      localStorage.removeItem('ai-chat-input-pos');
      return null;
    }
  }

  function clampInputSectionPosition() {
    if (!inputSection.style.top) return;
    const rect = inputSection.getBoundingClientRect();
    const currentLeft = Number.parseFloat(inputSection.style.left);
    const currentTop = Number.parseFloat(inputSection.style.top);
    const maxLeft = Math.max(0, window.innerWidth - rect.width);
    const maxTop = Math.max(0, window.innerHeight - rect.height);
    inputSection.style.left = `${Math.max(0, Math.min(Number.isFinite(currentLeft) ? currentLeft : rect.left, maxLeft))}px`;
    inputSection.style.top = `${Math.max(0, Math.min(Number.isFinite(currentTop) ? currentTop : rect.top, maxTop))}px`;
    inputSection.style.bottom = 'auto';
    positionSessionSwitcher();
  }

  const savedPosition = readSavedInputPosition();
  if (savedPosition) {
    inputSection.style.bottom = 'auto';
    inputSection.style.left = `${savedPosition.left}px`;
    inputSection.style.top = `${savedPosition.top}px`;
    requestAnimationFrame(clampInputSectionPosition);
  }
  window.addEventListener('resize', clampInputSectionPosition);

  // Use Pointer Events for better capture (handles iframes and fast movement)
  inputSection.addEventListener('pointerdown', dragStart);
  inputSection.addEventListener('pointermove', drag);
  inputSection.addEventListener('pointerup', dragEnd);
  inputSection.addEventListener('pointercancel', dragEnd);

  function dragStart(e) {
    if (e.button !== undefined && e.button !== 0) return;

    // 圖示 (svg/path/span) 也是控制項的一部分，不能只比對直接 target 的 tagName。
    // 否則 setPointerCapture 會把 pointerup/click 轉交面板，造成按鈕中央點不到。
    const interactiveTarget = e.target.closest?.(
      'button, textarea, input, select, a[href], [contenteditable]:not([contenteditable="false"]), [role="button"]'
    );
    if (!inputSection.classList.contains('minimized') &&
        interactiveTarget && inputSection.contains(interactiveTarget)) {
      return;
    }

    // Initialize explicit top/left if only bottom is set
    if (!inputSection.style.top || inputSection.style.top === '') {
      const rect = inputSection.getBoundingClientRect();
      inputSection.style.bottom = 'auto';
      inputSection.style.left = rect.left + 'px';
      inputSection.style.top = rect.top + 'px';
    }

    // Calculate offset from mouse to element top-left
    pointerStartX = e.clientX;
    pointerStartY = e.clientY;
    initialX = e.clientX - inputSection.offsetLeft;
    initialY = e.clientY - inputSection.offsetTop;

    isDragging = true;
    hasMoved = false; // 開始拖拽時重置 moved 狀態
    try {
      if (e.pointerId !== undefined) {
        inputSection.setPointerCapture(e.pointerId); // Capture pointer to handle out-of-bounds/iframes
      }
    } catch (error) {}
  }

  function dragEnd(e) {
    if (!isDragging) return;

    const shouldRestoreMinimized = inputSection.classList.contains('minimized') && !hasMoved;
    isDragging = false;
    if (inputSection.hasPointerCapture?.(e.pointerId)) {
      inputSection.releasePointerCapture(e.pointerId);
    }

    // Save position
    const pos = {
      left: inputSection.style.left,
      top: inputSection.style.top
    };
    localStorage.setItem('ai-chat-input-pos', JSON.stringify(pos));
    positionSessionSwitcher();

    if (shouldRestoreMinimized) {
      restoreInputSection();
    }
  }

  function drag(e) {
    if (isDragging) {
      const deltaX = e.clientX - pointerStartX;
      const deltaY = e.clientY - pointerStartY;
      if (!hasMoved && Math.hypot(deltaX, deltaY) < INPUT_DRAG_THRESHOLD_PX) {
        return;
      }

      hasMoved = true;
      e.preventDefault();

      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;

      // Boundary checks
      const maxX = window.innerWidth - inputSection.offsetWidth;
      const maxY = window.innerHeight - inputSection.offsetHeight;

      currentX = Math.max(0, Math.min(currentX, maxX));
      currentY = Math.max(0, Math.min(currentY, maxY));

      inputSection.style.left = currentX + "px";
      inputSection.style.top = currentY + "px";

      positionSessionSwitcher();
    }
  }

  // --- 懸浮面板最小化與還原邏輯 ---
  const minimizeBtn = document.getElementById('minimize-input-btn');

  function syncMinimizedInputSemantics(minimized) {
    if (minimized) {
      inputSection.setAttribute('role', 'button');
      inputSection.tabIndex = 0;
      inputSection.setAttribute('aria-label', t('restoreInputPanelLabel', 'Restore question panel'));
    } else {
      inputSection.removeAttribute('role');
      inputSection.removeAttribute('tabindex');
      inputSection.removeAttribute('aria-label');
    }
  }

  function minimizeInputSection() {
    markResizeControlSeen('minimize');
    inputSection.classList.add('minimized');
    syncMinimizedInputSemantics(true);
    localStorage.setItem('ai-chat-input-minimized', 'true');
    closeSendOnePlatformMenu();
    closeSummaryPlatformMenu();
    closeLanguageMenu();
    hideSessionSwitcher(); // 最小化時順便隱藏歷史對話面板
  }

  function restoreInputSection() {
    inputSection.classList.remove('minimized');
    syncMinimizedInputSemantics(false);
    localStorage.setItem('ai-chat-input-minimized', 'false');
    document.getElementById('question-input')?.focus();
  }

  if (minimizeBtn) {
    const minimizeFromButton = (e) => {
      e.preventDefault();
      e.stopPropagation();
      minimizeInputSection();
    };

    minimizeBtn.addEventListener('click', minimizeFromButton);
  }

  // 點擊最小化後的懸浮球還原為完整面板
  inputSection.addEventListener('click', (e) => {
    if (inputSection.classList.contains('minimized')) {
      // 只有在純點擊（沒有拖拽移動）的情況下才還原
      if (!hasMoved) {
        markResizeControlSeen('panelRestore');
        restoreInputSection();
      }
    }
  });
  document.addEventListener('keydown', handlePopupKeydown);
  inputSection.addEventListener('keydown', (event) => {
    if (!inputSection.classList.contains('minimized')) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    markResizeControlSeen('panelRestore');
    restoreInputSection();
  });

  // 載入時復原之前的最小化狀態
  const isMinimized = localStorage.getItem('ai-chat-input-minimized') === 'true';
  if (isMinimized) {
    inputSection.classList.add('minimized');
    syncMinimizedInputSemantics(true);
  }

  console.log('[AI Multi-Chat] Popup initialized');
  initializePlatformToggles();
  renderSessionList();
  if (pendingLayoutDialogOpen) {
    pendingLayoutDialogOpen = false;
    openPlatformLayoutDialog();
  }
});

function getQuestionInputs() {
  return [
    document.getElementById('question-input')
  ].filter(Boolean);
}

function getPreferredQuestionInput() {
  return document.getElementById('question-input');
}

function hasSeenResizeControl(control) {
  return localStorage.getItem(RESIZE_HINT_STORAGE_KEYS[control]) === 'true';
}

function syncResizeControlsHint() {
  Object.keys(RESIZE_HINT_STORAGE_KEYS).forEach(control => {
    document.body.classList.toggle(`resize-${control}-unseen`, !hasSeenResizeControl(control));
  });
}

function markResizeControlSeen(control) {
  if (!RESIZE_HINT_STORAGE_KEYS[control]) return;

  if (!hasSeenResizeControl(control)) {
    localStorage.setItem(RESIZE_HINT_STORAGE_KEYS[control], 'true');
  }

  syncResizeControlsHint();
}

function setMaximizedPlatform(platform, options = {}) {
  const wrapper = document.querySelector(`.iframe-wrapper[data-platform="${platform}"]`);
  if (!wrapper) return;

  const shouldRestore = options.toggle && currentMaximizedPlatform === platform;

  document.querySelectorAll('.iframe-wrapper').forEach(w => {
    const isTarget = !shouldRestore && w.dataset.platform === platform;
    w.classList.toggle('maximized', isTarget);
    w.classList.toggle('dimmed', !shouldRestore && !isTarget);
  });

  document.querySelectorAll('.maximize-btn').forEach(btn => {
    const isTargetButton = !shouldRestore && btn.dataset.platform === platform;
    btn.textContent = isTargetButton ? '⤡' : '⤢';
    btn.title = isTargetButton
      ? t('restoreTitle', 'Restore')
      : t('maximizeTitle', 'Maximize');
  });

  currentMaximizedPlatform = shouldRestore ? null : platform;
  document.body.classList.toggle('iframe-maximized', !!currentMaximizedPlatform);
}

function clearSentQuestionInputs(sourceInput, question) {
  getQuestionInputs().forEach(input => {
    if (input === sourceInput || input.value.trim() === question) {
      input.value = '';
    }
  });
}

function createSubmissionId(platform) {
  submissionSequence += 1;
  return `${Date.now().toString(36)}-${submissionSequence.toString(36)}-${platform}`;
}

function cancelPlatformOperation(platform) {
  delete activeSubmissionIds[platform];
  const iframe = iframes[platform];
  if (!iframe?.contentWindow) return;
  try {
    iframe.contentWindow.postMessage({
      type: 'AI_CANCEL_OPERATIONS',
      platform,
      source: 'popup'
    }, '*');
  } catch (error) {
    console.warn(`[${platform}] Could not cancel pending operations:`, error);
  }
}

function clearPlatformRuntimeState(platform, options = {}) {
  if (options.cancelRemote !== false) cancelPlatformOperation(platform);
  delete compareWatchState[platform];
  delete compareHistoryRequestState[platform];
  if (options.clearHistory !== false) delete compareLatestHistories[platform];
  stopComparePollTimerIfDone();
}

function isCurrentSubmissionEvent(platform, data) {
  return !!data.submissionId && activeSubmissionIds[platform] === data.submissionId;
}

function syncSubmissionBoundary(platform, data) {
  const state = compareWatchState[platform];
  if (!state || !Number.isFinite(Number(data.baselineOccurrences))) return;
  state.baselineOccurrences = Math.max(0, Number(data.baselineOccurrences));
}

// 發送問題到所有 AI
function sendQuestionToAll(sourceInput = document.getElementById('question-input')) {
  const questionInput = sourceInput || document.getElementById('question-input');
  const question = questionInput.value.trim();
  if (!question) {
    alert(t('alertEnterQuestion', 'Please enter a question'));
    questionInput.focus();
    return;
  }

  console.log('[AI Multi-Chat] Sending question to all platforms:', question);
  window.lastSentQuestion = question; // 紀錄最新發送的問題
  startSessionCapture(question);
  startCompareWatch(question, { deferHistoryRequests: true });

  // 清空送出的輸入區；若另一個輸入區內容相同也一起清掉，避免殘留舊問題
  clearSentQuestionInputs(questionInput, question);

  platforms.forEach(platform => {
    sendQuestionToPlatform(platform, question);
  });

  scheduleCompareSendHistoryRefresh();
}

function sendQuestionToOnePlatform(platform, sourceInput = document.getElementById('question-input')) {
  closeSendOnePlatformMenu();
  if (!platforms.includes(platform)) return;

  const questionInput = sourceInput || document.getElementById('question-input');
  const question = questionInput.value.trim();
  if (!question) {
    alert(t('alertEnterQuestion', 'Please enter a question'));
    questionInput.focus();
    return;
  }

  console.log(`[AI Multi-Chat] Sending question to ${platform}:`, question);
  window.lastSentQuestion = question;
  startSessionCapture(question, [platform]);
  startComparePlatformWatch(platform, question, { deferHistoryRequests: true });
  clearSentQuestionInputs(questionInput, question);
  sendQuestionToPlatform(platform, question);
}

function resetComparePrompt() {
  const promptEl = document.getElementById('compare-prompt-text');
  if (promptEl) {
    promptEl.textContent = t('comparePromptWaiting', 'No question sent yet, or waiting for platform responses...');
  }
}

function resetCompareState(options = {}) {
  if (comparePollTimer) {
    clearInterval(comparePollTimer);
    comparePollTimer = null;
  }

  clearCompareOpenRefreshTimers();
  compareIgnoreScrapeResponsesUntil = options.ignoreScrapeResponsesUntil || 0;

  platforms.forEach(platform => {
    cancelPlatformOperation(platform);
    delete compareWatchState[platform];
    delete compareLatestHistories[platform];
    delete compareHistoryRequestState[platform];

    if (options.resetText) {
      const textEl = document.getElementById(`compare-text-${platform}`);
      if (!textEl) return;

      textEl.textContent = isPlatformEnabled(platform)
        ? t('platformNoConversation', 'This platform has no conversation content yet.')
        : t('platformDisabled', 'This platform is disabled');
    }
  });

  resetComparePrompt();
}

// 開啟所有平台的新對話
function startNewChatForAll() {
  if (!confirm(t('confirmNewChat', 'Start a new chat? This will reset the current conversation on all AI platforms.'))) {
    return;
  }

  console.log('[AI Multi-Chat] Starting new chat for all platforms');
  compareNavigationEpoch += 1;
  window.lastSentQuestion = '';
  resetCompareState({
    resetText: true,
    ignoreScrapeResponsesUntil: Date.now() + 4000
  });

  platforms.forEach(platform => {
    if (!isPlatformEnabled(platform)) {
      console.log(`[${platform}] Platform disabled, skipping new chat reset`);
      return;
    }

    // 清除儲存的 URL，恢復預設
    localStorage.removeItem(`ai-chat-url-${platform}`);

    const iframe = iframes[platform];
    if (iframe) {
      iframe.contentWindow.postMessage({
        type: 'AI_NEW_CHAT',
        platform: platform,
        source: 'popup'
      }, '*');
      updateStatus(platform, '🔄', t('statusResetting', 'Resetting...'));
    }
  });
}

// 發送問題到單個平台
function sendQuestionToPlatform(platform, question, options = {}) {
  if (!isPlatformEnabled(platform)) {
    console.log(`[${platform}] Platform disabled, skipping question send`);
    updateStatus(platform, '⏸️', t('statusDisabledNotSending', 'Disabled, not sending'));
    return;
  }

  const iframe = iframes[platform];
  if (!iframe) {
    console.error(`[${platform}] iframe not found`);
    updateStatus(platform, '❌', t('statusIframeNotFound', 'iframe not found'));
    return;
  }

  console.log(`[${platform}] Sending question...`);
  const submissionId = options.submissionId || createSubmissionId(platform);
  activeSubmissionIds[platform] = submissionId;
  if (compareWatchState[platform]) {
    compareWatchState[platform].submissionId = submissionId;
  }

  // 獲取 iframe 的 tab ID（通過 Chrome API）
  // 由於 iframe 在同一個 tab 中，我們需要直接向 iframe 中的頁面發送消息
  // 使用 postMessage 與 iframe 內的 content script 通訊

  try {
    // 直接通過 iframe 的 contentWindow 發送消息
    iframe.contentWindow.postMessage({
      type: 'AI_SUBMIT_QUESTION',
      question: question,
      platform: platform,
      submissionId,
      source: 'popup'
    }, '*');

    // 更新狀態
    updateStatus(platform, '🔄', t('statusSending'));
    return submissionId;
  } catch (error) {
    console.error(`[${platform}] Error sending message:`, error);
    updateStatus(platform, '❌', t('statusSendFailed', 'Send failed'));
    if (activeSubmissionIds[platform] === submissionId) delete activeSubmissionIds[platform];
    return null;
  }
}

// 處理來自 iframe 的消息
function handleMessage(event) {
  const data = event.data;

  // 安全檢查
  if (!data || typeof data !== 'object' || !data.type) {
    return;
  }

  // 處理登入相關消息
  if (data.source === 'ai-login-handler' || data.source === 'grok-login-handler') {
    handleLoginMessage(data);
    return;
  }

  // 只處理來自 content-script 的消息
  if (data.source !== 'content-script') {
    return;
  }

  const platform = data.platform;
  console.log(`[popup] Received message from ${platform}:`, data.type);

  if (SUBMISSION_LIFECYCLE_TYPES.has(data.type) && !isCurrentSubmissionEvent(platform, data)) {
    console.log(`[popup] Ignoring stale submission event for ${platform}:`, data.submissionId);
    return;
  }

  if (!isPlatformEnabled(platform)) {
    if (data.type === 'AI_SCRAPE_HISTORY_RESPONSE') clearCompareHistoryRequest(platform);
    updateStatus(platform, '⏸️', t('statusDisabled', 'Disabled'));
    return;
  }

  switch (data.type) {
    case 'AI_READY':
      console.log(`[${platform}] Ready`);
      updateStatus(platform, '✅', t('statusReady'));
      break;

    case 'AI_QUESTION_SENT':
      console.log(`[${platform}] Question sent successfully`);
      syncSubmissionBoundary(platform, data);
      if (compareWatchState[platform]) compareWatchState[platform].sent = true;
      updateStatus(platform, '🔄', t('statusWaiting'));
      markComparePlatformPending(platform, t('compareResponding', 'Responding...'));
      requestPlatformHistory(platform);
      break;

    case 'AI_RESPONSE_UPDATE':
    case 'AI_RESPONSE_START':
      console.log(`[${platform}] Response started`);
      syncSubmissionBoundary(platform, data);
      if (compareWatchState[platform]) compareWatchState[platform].sent = true;
      updateStatus(platform, '🔄', t('statusResponding', 'Responding...'));
      if (Array.isArray(data.history)) {
        updateCompareFromHistory(platform, data.history, !!data.isGenerating, { explicitComplete: !!data.isComplete });
      }
      markComparePlatformPending(platform, t('compareResponding', 'Responding...'));
      break;

    case 'AI_RESPONSE_RECEIVED':
      console.log(`[${platform}] Response received:`, String(data.response || '').substring(0, 100) + '...');
      syncSubmissionBoundary(platform, data);
      if (compareWatchState[platform]) compareWatchState[platform].sent = true;
      if (Array.isArray(data.history)) {
        // Content scripts can briefly lose ChatGPT's generating indicator between
        // tool/reasoning phases. Treat this as a completion hint and let the popup
        // confirm a quiet, stable tail instead of stopping immediately.
        updateCompareFromHistory(platform, data.history, false, { completionHint: true, explicitComplete: !!data.isComplete });
      } else if (compareWatchState[platform] && !compareWatchState[platform].complete) {
        updateStatus(platform, '🔄', t('statusSyncingResponse', 'Syncing response...'));
        requestPlatformHistory(platform);
      } else {
        updateStatus(platform, '✅', t('statusComplete', 'Complete'));
      }
      break;

    case 'AI_NETWORK_RESPONSE_START':
      console.log(`[${platform}] Network response started`);
      break;

    case 'AI_NETWORK_RESPONSE_RECEIVED':
      console.log(`[${platform}] Network response received`);
      break;

    case 'AI_NETWORK_DIAGNOSTIC_ERROR':
      console.warn(`[${platform}] Ignored network diagnostic error:`, data.message);
      break;

    case 'AI_ERROR':
      console.error(`[${platform}] Error:`, data.message);
      if (compareWatchState[platform] && !compareWatchState[platform].complete) {
        failComparePlatform(platform, data.message);
      } else {
        updateStatus(platform, '❌', data.message);
      }
      break;

    case 'AI_INFO':
      console.log(`[${platform}] Info:`, data.message);
      // info 訊息不改變狀態，只記錄
      break;

    case 'AI_URL_CHANGED':
      console.log(`[${platform}] URL changed:`, data.url);
      const normalizedUrl = normalizePlatformUrl(platform, data.url);
      localStorage.setItem(`ai-chat-url-${platform}`, normalizedUrl);
      captureSessionUrl(platform, normalizedUrl);
      break;

    case 'AI_REFRESH_IFRAME':
      console.log(`[${platform}] Refreshing iframe...`);
      refreshIframe(platform);
      break;

    case 'AI_DIAGNOSTICS_RESULT':
      resolvePlatformDiagnostics(platform, data.diagnostics);
      break;

    case 'AI_SCRAPE_HISTORY_RESPONSE':
      console.log(`[popup] Received scraped history for ${platform}`);
      if (Date.now() < compareIgnoreScrapeResponsesUntil) {
        clearCompareHistoryRequest(platform);
        break;
      }

      if (data.requestId !== undefined) {
        const requestState = compareHistoryRequestState[platform];
        if (!requestState || data.requestId !== requestState.requestId) {
          console.log(`[popup] Ignoring stale scraped history for ${platform}`);
          break;
        }
        if (data.navigationEpoch !== undefined && data.navigationEpoch !== requestState.navigationEpoch) {
          console.log(`[popup] Ignoring history from an older navigation for ${platform}`);
          break;
        }
      }

      clearCompareHistoryRequest(platform);
      const history = data.history || [];
      updateCompareFromHistory(platform, history, !!data.isGenerating, { explicitComplete: !!data.isComplete });
      break;

    default:
      // 忽略其他類型的消息
      break;
  }
}

function normalizeUrl(url) {
  return String(url || '').replace(/\/$/, '');
}

function isRecordableConversationUrl(platform, url) {
  if (!url || !conversationUrlPatterns[platform]) return false;
  if (normalizeUrl(url) === normalizeUrl(defaultUrls[platform])) return false;
  return conversationUrlPatterns[platform].test(url);
}

function getSessionList() {
  try {
    const raw = localStorage.getItem(SESSION_LIST_STORAGE_KEY);
    const sessions = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(sessions)) return [];

    return sessions.map((session) => {
      if (!session || typeof session !== 'object') return null;
      const id = typeof session.id === 'string' ? session.id : '';
      const title = typeof session.title === 'string' ? session.title : '';
      const createdAt = Number(session.createdAt);
      if (!id || !Number.isFinite(createdAt)) return null;

      const urls = {};
      if (session.urls && typeof session.urls === 'object') {
        platforms.forEach(platform => {
          if (typeof session.urls[platform] === 'string' && session.urls[platform]) {
            urls[platform] = session.urls[platform];
          }
        });
      }

      return {
        ...session,
        id,
        title: title || t('untitledConversation', 'Untitled conversation'),
        question: typeof session.question === 'string' ? session.question : '',
        createdAt,
        updatedAt: Number.isFinite(Number(session.updatedAt)) ? Number(session.updatedAt) : createdAt,
        urls,
        platforms: Object.keys(urls)
      };
    }).filter(Boolean);
  } catch (error) {
    console.error('[AI Multi-Chat] Failed to read session list:', error);
    return [];
  }
}

function saveSessionList(sessions) {
  localStorage.setItem(SESSION_LIST_STORAGE_KEY, JSON.stringify(sessions.slice(0, MAX_SESSION_RECORDS)));
}

function makeSessionTitle(question) {
  const text = (question || '').replace(/\s+/g, ' ').trim();
  if (!text) return t('untitledConversation', 'Untitled conversation');
  return text.length > 48 ? text.substring(0, 48) + '...' : text;
}

function getCurrentConversationUrl(platform) {
  const storedUrl = normalizePlatformUrl(
    platform,
    localStorage.getItem(`ai-chat-url-${platform}`)
  );

  return isRecordableConversationUrl(platform, storedUrl) ? storedUrl : '';
}

function saveActiveSessionDraft() {
  if (!activeSessionDraft || Object.keys(activeSessionDraft.urls).length === 0) return;

  const sessions = getSessionList();
  const existingIndex = sessions.findIndex(session => session.id === activeSessionDraft.id);
  const { targetPlatforms, ...sessionDraft } = activeSessionDraft;
  const nextSession = {
    ...sessionDraft,
    platforms: Object.keys(sessionDraft.urls)
  };

  if (existingIndex >= 0) {
    sessions[existingIndex] = nextSession;
  } else {
    sessions.unshift(nextSession);
  }

  saveSessionList(sessions);
  renderSessionList(activeSessionDraft.id);
}

function startSessionCapture(question, targetPlatforms = platforms.filter(isPlatformEnabled)) {
  const now = Date.now();
  const uniqueTargets = [...new Set(targetPlatforms.filter(platform => platforms.includes(platform)))];
  const urls = {};

  uniqueTargets.forEach(platform => {
    const currentUrl = getCurrentConversationUrl(platform);
    if (currentUrl) {
      urls[platform] = currentUrl;
    }
  });

  activeSessionDraft = {
    id: String(now),
    title: makeSessionTitle(question),
    question: question,
    createdAt: now,
    updatedAt: now,
    urls,
    targetPlatforms: uniqueTargets
  };

  saveActiveSessionDraft();
}

function captureSessionUrl(platform, url) {
  if (!activeSessionDraft) return;

  const age = Date.now() - activeSessionDraft.createdAt;
  if (age > SESSION_CAPTURE_WINDOW_MS) {
    activeSessionDraft = null;
    return;
  }

  if (!activeSessionDraft.targetPlatforms.includes(platform)) {
    return;
  }

  if (!isRecordableConversationUrl(platform, url)) {
    return;
  }

  activeSessionDraft.urls[platform] = url;
  activeSessionDraft.updatedAt = Date.now();
  saveActiveSessionDraft();
}

function formatSessionOption(session) {
  const locale = selectedLanguage === 'auto' ? undefined : selectedLanguage.replace('_', '-');
  const time = new Date(session.createdAt).toLocaleString(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
  const platformCount = Object.keys(session.urls || {}).length;
  return t('sessionOptionFormat', '$1 · $2 platforms · $3', [time, String(platformCount), session.title]);
}

function renderSessionList(selectedId) {
  const select = document.getElementById('session-select');
  const loadButton = document.getElementById('load-session-btn');
  const deleteButton = document.getElementById('delete-session-btn');
  if (!select || !loadButton || !deleteButton) return;

  const sessions = getSessionList();
  const previousValue = selectedId || select.value;
  select.innerHTML = '';

  if (sessions.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = t('noSessionGroups', 'No conversation groups');
    select.appendChild(option);
    select.disabled = true;
    loadButton.disabled = true;
    deleteButton.disabled = true;
    return;
  }

  sessions.forEach(session => {
    const option = document.createElement('option');
    option.value = session.id;
    option.textContent = formatSessionOption(session);
    select.appendChild(option);
  });

  select.disabled = false;
  loadButton.disabled = false;
  deleteButton.disabled = false;

  if (previousValue && sessions.some(session => session.id === previousValue)) {
    select.value = previousValue;
  } else {
    select.value = sessions[0].id;
  }
}

function getSelectedSession() {
  const select = document.getElementById('session-select');
  if (!select || !select.value) return null;
  return getSessionList().find(session => session.id === select.value) || null;
}

function positionSessionSwitcher() {
  const switcher = document.getElementById('session-switcher');
  const inputSection = document.querySelector('.input-section');
  if (!switcher || !inputSection || switcher.classList.contains('hidden')) return;

  const gap = 10;
  const margin = 10;
  const inputRect = inputSection.getBoundingClientRect();
  const panelWidth = switcher.offsetWidth;
  const panelHeight = switcher.offsetHeight;

  let left = inputRect.left;
  let top = inputRect.top - panelHeight - gap;

  if (top < margin) {
    top = inputRect.bottom + gap;
  }

  left = Math.max(margin, Math.min(left, window.innerWidth - panelWidth - margin));
  top = Math.max(margin, Math.min(top, window.innerHeight - panelHeight - margin));

  switcher.style.left = left + 'px';
  switcher.style.top = top + 'px';
  switcher.style.bottom = 'auto';
}

function showSessionSwitcher() {
  const switcher = document.getElementById('session-switcher');
  if (!switcher) return;
  renderSessionList();
  switcher.classList.remove('hidden');
  document.getElementById('history-toggle-btn')?.setAttribute('aria-expanded', 'true');
  positionSessionSwitcher();
  document.getElementById('session-select')?.focus();
}

function hideSessionSwitcher() {
  const switcher = document.getElementById('session-switcher');
  if (!switcher) return;
  switcher.classList.add('hidden');
  document.getElementById('history-toggle-btn')?.setAttribute('aria-expanded', 'false');
}

function toggleSessionSwitcher() {
  const switcher = document.getElementById('session-switcher');
  if (!switcher) return;

  if (switcher.classList.contains('hidden')) {
    showSessionSwitcher();
  } else {
    hideSessionSwitcher();
  }
}

function prepareComparePanelForSessionSwitch(session, navigationEpoch) {
  if (comparePollTimer) {
    clearInterval(comparePollTimer);
    comparePollTimer = null;
  }

  clearCompareOpenRefreshTimers();
  compareIgnoreScrapeResponsesUntil = 0;
  platforms.forEach(platform => {
    clearPlatformRuntimeState(platform, { clearHistory: true, cancelRemote: true });
    if (iframes[platform]) iframes[platform].dataset.navigationEpoch = String(navigationEpoch);
  });

  const promptEl = document.getElementById('compare-prompt-text');
  if (promptEl) {
    promptEl.textContent = session?.title
      ? t('historyConversationPrompt', 'History: $1', session.title)
      : t('switchingHistoryConversation', 'Switching history conversation...');
  }

  if (!isComparePanelVisible()) return;

  platforms.forEach(platform => {
    const textEl = document.getElementById(`compare-text-${platform}`);
    if (!textEl) return;

    if (!isPlatformEnabled(platform)) {
      textEl.textContent = t('platformDisabled', 'This platform is disabled');
    } else if (session?.urls?.[platform]) {
      textEl.textContent = t('switchingConversation', 'Switching conversation...');
    } else {
      textEl.textContent = t('sessionMissingPlatformUrl', 'This history group has no URL for this platform.');
    }
  });
}

async function loadSelectedSession() {
  const session = getSelectedSession();
  if (!session) return;

  const navigationEpoch = ++compareNavigationEpoch;
  sessionLoadInProgress = true;
  const loadButton = document.getElementById('load-session-btn');
  if (loadButton) {
    loadButton.disabled = true;
    loadButton.setAttribute('aria-busy', 'true');
  }
  prepareComparePanelForSessionSwitch(session, navigationEpoch);

  try {
    for (const platform of getConfiguredPlatforms()) {
      if (navigationEpoch !== compareNavigationEpoch) return;
      const url = session.urls && session.urls[platform];
      const iframe = iframes[platform];
      if (!iframe) continue;

      iframe.dataset.navigationEpoch = String(navigationEpoch);
      if (!url) {
        // A history group may predate a newly added platform. Leaving that
        // iframe on an unrelated current conversation makes the group look
        // mixed, so reset only the missing pane to its clean start page.
        localStorage.removeItem(`ai-chat-url-${platform}`);
        iframe.src = defaultUrls[platform];
        updateStatus(platform, '⏳', t('statusResetting', 'Resetting...'));
        continue;
      }

      let normalizedUrl = normalizePlatformUrl(platform, url);
      if (platform === 'grok') {
        normalizedUrl = await getRestorableGrokUrl(normalizedUrl);
        if (navigationEpoch !== compareNavigationEpoch) return;
        if (!normalizedUrl) {
          localStorage.removeItem('ai-chat-url-grok');
          iframe.src = defaultUrls.grok;
          updateStatus(platform, '⏳', t('loadingTitle', 'Loading...'));
          continue;
        }
      }

      localStorage.setItem(`ai-chat-url-${platform}`, normalizedUrl);
      iframe.src = normalizedUrl;
      updateStatus(platform, '⏳', t('switchingConversation', 'Switching conversation...'));
    }

    if (isComparePanelVisible()) {
      setTimeout(() => {
        if (navigationEpoch !== compareNavigationEpoch) return;
        platforms.forEach(platform => {
          if (isPlatformEnabled(platform) && session.urls?.[platform]) {
            requestPlatformHistory(platform, { force: true, navigationEpoch });
          }
        });
      }, 2500);
    }
    hideSessionSwitcher();
  } finally {
    if (navigationEpoch === compareNavigationEpoch) {
      sessionLoadInProgress = false;
      if (loadButton) {
        loadButton.disabled = false;
        loadButton.removeAttribute('aria-busy');
      }
    }
  }
}

function deleteSelectedSession() {
  const session = getSelectedSession();
  if (!session) return;

  if (!confirm(t('confirmDeleteSession', 'Delete conversation group "$1"?', session.title))) {
    return;
  }

  const sessions = getSessionList().filter(item => item.id !== session.id);
  saveSessionList(sessions);

  if (activeSessionDraft && activeSessionDraft.id === session.id) {
    activeSessionDraft = null;
  }

  renderSessionList();
}

// 更新狀態指示器
function updateStatus(platform, emoji, title) {
  const statusEl = statusElements[platform];
  if (statusEl) {
    statusEl.textContent = emoji;
    statusEl.title = `[${platform}] ${title}`;
    statusEl.setAttribute('aria-label', `${getPlatformDisplayName(platform)}: ${title}`);

    // 如果是載入中，添加旋轉動畫
    if (emoji === '⏳' || emoji === '🔄') {
      statusEl.classList.add('loading');
    } else {
      statusEl.classList.remove('loading');
    }
  }

  // 同步更新對比面板中的狀態指示器
  const compareStatusEl = document.getElementById(`compare-status-${platform}`);
  if (compareStatusEl) {
    compareStatusEl.textContent = emoji;
    compareStatusEl.title = `[${platform}] ${title}`;
    compareStatusEl.setAttribute('aria-label', `${getPlatformDisplayName(platform)}: ${title}`);
    if (emoji === '⏳' || emoji === '🔄') {
      compareStatusEl.classList.add('loading');
    } else {
      compareStatusEl.classList.remove('loading');
    }
  }
}

// 刷新 iframe（全局函數，可被多處調用）
function refreshIframe(platform) {
  const iframe = iframes[platform];
  const btn = document.querySelector(`.refresh-btn[data-platform="${platform}"]`);

  if (!iframe) return;
  clearPlatformRuntimeState(platform, { clearHistory: false, cancelRemote: true });

  // 添加旋轉動畫
  if (btn) {
    btn.classList.add('refreshing');
    setTimeout(() => {
      btn.classList.remove('refreshing');
    }, 600);
  }

  // 刷新 iframe：完整重新載入（包括 cookies）
  const currentSrc = iframe.src;
  iframe.src = '';
  setTimeout(() => {
    iframe.src = currentSrc;
    console.log(`[${platform}] iframe refreshed`);

    // 更新狀態為載入中
    updateStatus(platform, '⏳', t('loadingTitle', 'Loading...'));
  }, 50);
}

function requestPlatformDiagnostics(platform, timeoutMs = 6000) {
  const iframe = iframes[platform];
  if (!iframe || !iframe.contentWindow) {
    return Promise.reject(new Error(`${platform} iframe not available`));
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingDiagnostics.delete(platform);
      reject(new Error(`${platform} diagnostics timed out`));
    }, timeoutMs);

    pendingDiagnostics.set(platform, { resolve, reject, timeoutId });

    try {
      iframe.contentWindow.postMessage({
        type: 'AI_DIAGNOSTICS_REQUEST',
        platform,
        source: 'popup'
      }, '*');
    } catch (error) {
      clearTimeout(timeoutId);
      pendingDiagnostics.delete(platform);
      reject(error);
    }
  });
}

function resolvePlatformDiagnostics(platform, diagnostics) {
  const pending = pendingDiagnostics.get(platform);
  if (!pending) return;

  clearTimeout(pending.timeoutId);
  pendingDiagnostics.delete(platform);
  pending.resolve(diagnostics);
}

function formatDiagnosticsValue(value) {
  if (value === null || value === undefined || value === '') return '(empty)';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function renderDiagnostics(title, sections) {
  document.getElementById('diagnostics-title').textContent = title;
  document.getElementById('diagnostics-output').textContent = sections.join('\n\n');
  document.getElementById('diagnostics-panel').classList.remove('hidden');
}

async function runPlatformDiagnostics(platform) {
  const iframe = iframes[platform];
  if (!iframe) {
    renderDiagnostics(`${platform} diagnostics`, ['iframe not found']);
    return;
  }

  renderDiagnostics(`${platform} diagnostics`, [t('loading', 'Loading...')]);

  try {
    const diagnostics = await requestPlatformDiagnostics(platform);
    const iframeRect = iframe.getBoundingClientRect();
    const sections = [
      `Time=${new Date().toLocaleString()}`,
      `Platform=${platform}`,
      `Parent iframe size=${Math.round(iframeRect.width)}x${Math.round(iframeRect.height)}`,
      `Iframe src=${iframe.src}`,
      [
        'Reported diagnostics',
        `href=${formatDiagnosticsValue(diagnostics.href)}`,
        `inIframe=${formatDiagnosticsValue(diagnostics.inIframe)}`,
        `window.innerWidth=${formatDiagnosticsValue(diagnostics.innerWidth)}`,
        `window.innerHeight=${formatDiagnosticsValue(diagnostics.innerHeight)}`,
        `sidebarToggle=${formatDiagnosticsValue(diagnostics.sidebarToggle)}`,
        `sidebarNav=${formatDiagnosticsValue(diagnostics.sidebarNav)}`,
        `localStorageSubset=${formatDiagnosticsValue(diagnostics.localStorageSubset)}`
      ].join('\n')
    ];

    renderDiagnostics(`${platform} diagnostics`, sections);
    console.log(`[AI Multi-Chat] ${platform} diagnostics`, diagnostics);
  } catch (error) {
    renderDiagnostics(`${platform} diagnostics`, [`error=${error.message}`]);
    console.error(`[AI Multi-Chat] ${platform} diagnostics failed`, error);
  }
}

function armPlatformBreakpoint(platform) {
  const iframe = iframes[platform];
  if (!iframe || !iframe.contentWindow) {
    updateStatus(platform, '❌', t('statusCannotSetBreakpoint', 'Cannot set breakpoint'));
    return;
  }

  try {
    iframe.contentWindow.postMessage({
      type: 'AI_ARM_BREAKPOINT_DEBUG',
      platform,
      source: 'popup'
    }, '*');

    updateStatus(platform, '🧨', t('statusBreakpointSetReloading', 'Breakpoint set, reloading...'));

    setTimeout(() => {
      refreshIframe(platform);
    }, 150);
  } catch (error) {
    console.error(`[${platform}] Failed to arm breakpoint`, error);
    updateStatus(platform, '❌', t('statusBreakpointFailed', 'Breakpoint setup failed'));
  }
}

function enablePlatformSidebarProtection(platform) {
  const iframe = iframes[platform];
  if (!iframe || !iframe.contentWindow) {
    updateStatus(platform, '❌', t('statusCannotEnableProtection', 'Cannot enable protection'));
    return;
  }

  try {
    iframe.contentWindow.postMessage({
      type: 'AI_SET_SIDEBAR_PROTECTION',
      platform,
      enabled: true,
      source: 'popup'
    }, '*');

    updateStatus(platform, '🛡️', t('statusSidebarProtectionReloading', 'Sidebar protection enabled for 5 seconds, reloading...'));

    setTimeout(() => {
      refreshIframe(platform);
    }, 150);
  } catch (error) {
    console.error(`[${platform}] Failed to enable sidebar protection`, error);
    updateStatus(platform, '❌', t('statusProtectionFailed', 'Protection failed'));
  }
}

function getPlatformEnabledStorageKey(platform) {
  return `ai-platform-enabled-${platform}`;
}

function isPlatformToggleEnabled(platform) {
  if (!(platform in platformEnabledState)) {
    const saved = localStorage.getItem(getPlatformEnabledStorageKey(platform));
    platformEnabledState[platform] = saved === null ? true : saved === 'true';
  }

  return platformEnabledState[platform];
}

function isPlatformEnabled(platform) {
  return isPlatformInLayout(platform) && isPlatformToggleEnabled(platform);
}

function setPlatformEnabled(platform, enabled) {
  platformEnabledState[platform] = enabled;
  localStorage.setItem(getPlatformEnabledStorageKey(platform), String(enabled));
  if (!enabled) {
    clearPlatformRuntimeState(platform, { clearHistory: true, cancelRemote: true });
    const textEl = document.getElementById(`compare-text-${platform}`);
    if (textEl) textEl.textContent = t('platformDisabled', 'This platform is disabled');
  } else {
    requestPlatformReadyState(platform);
    if (isComparePanelVisible()) requestPlatformHistory(platform, { force: true });
  }
  renderPlatformToggle(platform);
  syncSummaryPlatformMenu();
  syncSendOnePlatformMenu();
}

function renderPlatformToggle(platform, options = {}) {
  const enabled = isPlatformEnabled(platform);
  const displayName = getPlatformDisplayName(platform);
  const toggleButtons = document.querySelectorAll(`[data-platform-toggle="${platform}"]`);
  const wrapper = document.querySelector(`.iframe-wrapper[data-platform="${platform}"]`);
  const compareCol = document.querySelector(`.compare-col[data-platform="${platform}"]`);

  toggleButtons.forEach(toggleButton => {
    toggleButton.textContent = enabled ? t('toggleOn', 'ON') : t('toggleOff', 'OFF');
    toggleButton.setAttribute('aria-pressed', String(enabled));
    toggleButton.title = enabled
      ? t('disablePlatformTitle', 'Disable $1', displayName)
      : t('enablePlatformTitle', 'Enable $1', displayName);
    toggleButton.classList.toggle('enabled', enabled);
    toggleButton.classList.toggle('disabled', !enabled);
  });

  if (wrapper) {
    wrapper.classList.toggle('platform-disabled', !enabled);
  }

  if (compareCol) {
    compareCol.classList.toggle('platform-disabled', !enabled);
  }

  if (!options.preserveStatus) {
    if (!enabled) {
      updateStatus(platform, '⏸️', t('statusDisabled', 'Disabled'));
    } else {
      updateStatus(platform, '⏳', t('statusWaitingReady', 'Waiting for readiness...'));
    }
  }
}

function syncPlatformToggleTitles() {
  platforms.forEach(platform => renderPlatformToggle(platform, { preserveStatus: true }));
}

function initializePlatformToggles() {
  platforms.forEach((platform) => {
    renderPlatformToggle(platform);
  });
}

// 處理 AI 平台登入相關消息
function handleLoginMessage(data) {
  console.log('[popup] Received login message:', data.type, data.platform);

  // 平台配置
  const platformUrls = {
    grok: {
      loginUrl: 'https://accounts.x.ai/sign-in?redirect=grok-com',
      homeUrl: 'https://grok.com/'
    },
    chatgpt: {
      loginUrl: 'https://auth.openai.com/log-in',
      homeUrl: 'https://chatgpt.com/'
    }
  };

  switch (data.type) {
    case 'GROK_NEEDS_LOGIN':
    case 'AI_NEEDS_LOGIN':
      const platform = data.platform || 'grok';
      console.log(`[popup] ${platform} needs login:`, data.url);
      // 登入流程被檢測到，已經在 content script 中顯示提示
      updateStatus(platform, '🔐', t('statusLoginRequired', 'Login verification required'));
      break;

    case 'CHATGPT_NEEDS_LOGIN':
      console.log('[popup] ChatGPT needs login:', data.url);
      updateStatus('chatgpt', '🔐', t('statusLoginRequired', 'Login verification required'));
      break;

    case 'OPEN_CHATGPT_LOGIN_WINDOW':
      console.log('[popup] Auto-opening ChatGPT login window...');
      const chatgptConfig = platformUrls.chatgpt;

      // 開啟新視窗（小視窗）
      const loginWindow = window.open(
        chatgptConfig.loginUrl,
        'chatgpt-login',
        'width=500,height=700,menubar=no,toolbar=no,location=no,status=no'
      );

        updateStatus('chatgpt', '🔐', t('statusLoginWindowOpened', 'Login window opened'));

      // 監聽視窗關閉
      if (loginWindow) {
        const checkWindowClosed = setInterval(() => {
          if (loginWindow.closed) {
            clearInterval(checkWindowClosed);
            console.log('[popup] Login window closed, reloading ChatGPT iframe...');

            // 延遲 2 秒後重新載入 iframe
            setTimeout(() => {
              const iframe = iframes.chatgpt;
              if (iframe) {
            updateStatus('chatgpt', '🔄', t('statusReloading', 'Reloading...'));
                iframe.src = chatgptConfig.homeUrl;

                // 3 秒後重置狀態
                setTimeout(() => {
              updateStatus('chatgpt', '⏳', t('statusWaitingReady', 'Waiting for readiness...'));
                }, 3000);
              }
            }, 2000);
          }
        }, 500);
      }
      break;

    case 'OPEN_GROK_LOGIN':
    case 'OPEN_AI_LOGIN':
      const loginPlatform = data.platform || 'grok';
      const config = platformUrls[loginPlatform];

      if (!config) {
        console.error(`[popup] Unknown platform: ${loginPlatform}`);
        return;
      }

      console.log(`[popup] Opening ${loginPlatform} login in new tab...`);

      chrome.tabs.create({
        url: config.loginUrl,
        active: true
      }, (tab) => {
        console.log('[popup] Login tab created:', tab.id);
      updateStatus(loginPlatform, '🔐', t('statusCompleteLoginInNewTab', 'Complete login in the new tab'));
      });
      break;

    case 'RELOAD_GROK':
    case 'RELOAD_AI':
      const reloadPlatform = data.platform || 'grok';
      const reloadConfig = platformUrls[reloadPlatform];

      if (!reloadConfig) {
        console.error(`[popup] Unknown platform: ${reloadPlatform}`);
        return;
      }

      console.log(`[popup] User requested reload, reloading ${reloadPlatform} iframe...`);

      // 重新載入 iframe
      const iframe = iframes[reloadPlatform];
      if (iframe) {
      updateStatus(reloadPlatform, '🔄', t('statusReloading', 'Reloading...'));
        iframe.src = reloadConfig.homeUrl;

        // 3 秒後重置狀態
        setTimeout(() => {
        updateStatus(reloadPlatform, '⏳', t('statusWaitingReady', 'Waiting for readiness...'));
        }, 3000);
      }
      break;

    default:
      break;
  }
}

// ==========================================
// 智慧對比對照面板輔助函數
// ==========================================

// 全局紀錄最新發送的問題，初始化為空字串
window.lastSentQuestion = '';

function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeCompareText(text) {
  return window.AIZooUtils.normalizeMatchText(text);
}

function isCompareHeadingLine(line) {
  const text = String(line || '').trim();
  if (!text) return false;
  if (/^#{1,6}\s+/.test(text)) return true;
  if (/^[一二三四五六七八九十]+[、.]\s*\S+/.test(text)) return true;
  if (/^\d+[.)、]\s+\S+/.test(text) && text.length <= 42) return true;
  if (/^[✅⚠️📈💡🎯🔥⭐]\s*\S+/.test(text) && text.length <= 48) return true;
  if (/：$/.test(text) && text.length <= 30) return true;
  return /^(目前|詳細|實際|建議|總結|結論|優點|缺點|最大問題|跟 ChatGPT 比|為什麼|如果你|坦白評估|订阅方式|用户反馈|相对位置|稳定性问题|SuperGrok|Heavy)/.test(text) && text.length <= 44;
}

function isCompareListLine(line) {
  return /^([-*•]|[0-9]+[.)])\s+\S+/.test(String(line || '').trim());
}

function formatCompareTableLine(line, sourceLinkState) {
  const cells = String(line || '')
    .split(/\t+/)
    .map(cell => cell.trim())
    .filter(Boolean);

  if (cells.length < 2) return '';

  return `<div class="compare-table-row">${cells.map(cell => (
    `<span>${formatCompareInlineHtml(cell, sourceLinkState)}</span>`
  )).join('')}</div>`;
}

function splitCompareParagraphText(text) {
  const labelPattern = '[^\\s。！？.!?：:\\n][^。！？.!?：:\\n]{0,28}[：:]';
  const raw = String(text || '')
    .replace(/\u2060/g, ' ')
    .trim();

  if (!raw) return [];

  if (raw.includes('\n')) {
    return raw
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .filter(Boolean);
  }

  const prepared = raw
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(new RegExp(`[ \\t\\f\\v]+(?=${labelPattern})`, 'g'), '\n')
    .trim();

  if (!prepared) return [];

  return prepared
    .split(/\n+/)
    .map(part => part.trim())
    .filter(Boolean);
}

function normalizeCompareSourceLinks(links) {
  return (Array.isArray(links) ? links : []).map(link => {
    const lines = String(link?.text || '')
      .replace(/\u2060/g, ' ')
      .split('\n')
      .map(line => line.replace(/\s+/g, ' ').trim())
      .filter(line => line && !/^\+\d+$/.test(line));
    const text = (lines[0] || '').replace(/\s+\+\d+(?:\s+.*)?$/, '').trim();
    if (!text || !link?.href) return null;

    try {
      const url = new URL(link.href);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      return { text, href: url.href };
    } catch (error) {
      return null;
    }
  }).filter(Boolean);
}

function createCompareSourceLinkState(links) {
  return {
    links: normalizeCompareSourceLinks(links),
    usedIndexes: new Set()
  };
}

function findCompareSourceLinkMatch(text, sourceLinkState) {
  const value = String(text || '');
  if (!sourceLinkState || !Array.isArray(sourceLinkState.links)) return null;

  for (let i = 0; i < sourceLinkState.links.length; i++) {
    if (sourceLinkState.usedIndexes.has(i)) continue;

    const link = sourceLinkState.links[i];
    const index = value.lastIndexOf(link.text);
    if (index < 0) continue;

    // 來源標籤通常在句尾，可能後面接標點（例如「…基本工資調整。」）或「+1」。
    const suffix = value.slice(index + link.text.length).trim();
    if (suffix && !/^[。．.，,、；;：:！!？?）)」』\]\s]*(?:\+\d+)?$/.test(suffix)) continue;

    sourceLinkState.usedIndexes.add(i);
    return { index, link };
  }

  return null;
}

function formatCompareInlineHtml(text, sourceLinkState) {
  const value = String(text || '');
  const match = findCompareSourceLinkMatch(value, sourceLinkState);
  const formatText = part => escapeHtml(part).replace(/\n/g, '<br>');
  if (!match) return formatText(value);

  const before = value.slice(0, match.index);
  const after = value.slice(match.index + match.link.text.length);
  const href = escapeHtml(match.link.href);
  const label = escapeHtml(match.link.text);
  const anchor = `<a class="compare-source-link" href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  return `${formatText(before)}${anchor}${formatText(after)}`;
}

function formatCompareParagraphHtml(text, sourceLinkState) {
  const trimmed = String(text || '').trim();
  const labelMatch = trimmed.includes('\n')
    ? null
    : trimmed.match(/^([^。！？.!?\n]{2,28}[：:])\s*(.+)$/);

  if (labelMatch) {
    return `<span class="compare-message-key">${escapeHtml(labelMatch[1])}</span>${formatCompareInlineHtml(labelMatch[2], sourceLinkState)}`;
  }

  return formatCompareInlineHtml(trimmed, sourceLinkState);
}

function formatCompareMessageContent(content, options = {}) {
  const allowHeadings = options.allowHeadings !== false;
  const sourceLinkState = createCompareSourceLinkState(options.links);
  const normalized = String(content || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u2060/g, ' ')
    .replace(/\s+(?=(?:風險與建議|最安全做法|不會被拒絕入住|不同飯店差異很大|但為了保險|簡單結論|總之|操作步驟|特點|按月訂閱|按年訂閱|月付|年付)[：:])/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!normalized) return '';

  // ChatGPT 引用標籤會多出單獨一行「+1」（表示還有其他來源），有來源連結時把它拿掉。
  const hasSourceLinks = sourceLinkState.links.length > 0;
  const lines = normalized.split('\n').filter(line => !(hasSourceLinks && /^\s*\+\d+\s*$/.test(line)));
  const blocks = [];
  let paragraphLines = [];

  function flushParagraph() {
    if (paragraphLines.length === 0) return;
    const text = paragraphLines.join('\n').trim();
    splitCompareParagraphText(text).forEach(paragraph => {
      blocks.push(`<p class="compare-message-paragraph">${formatCompareParagraphHtml(paragraph, sourceLinkState)}</p>`);
    });
    paragraphLines = [];
  }

  lines.forEach(rawLine => {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      return;
    }

    const tableLine = formatCompareTableLine(line, sourceLinkState);
    if (tableLine) {
      flushParagraph();
      blocks.push(tableLine);
      return;
    }

    if (allowHeadings && isCompareHeadingLine(line)) {
      flushParagraph();
      blocks.push(`<div class="compare-message-heading">${formatCompareInlineHtml(line.replace(/^#{1,6}\s+/, ''), sourceLinkState)}</div>`);
      return;
    }

    if (allowHeadings && isCompareListLine(line)) {
      flushParagraph();
      const item = line.replace(/^([-*•]|[0-9]+[.)])\s+/, '');
      blocks.push(`<div class="compare-message-list-item">${formatCompareInlineHtml(item, sourceLinkState)}</div>`);
      return;
    }

    paragraphLines.push(line);
  });

  flushParagraph();
  return blocks.join('');
}

function getComparePanel() {
  return document.getElementById('compare-panel');
}

function isComparePanelVisible() {
  const panel = getComparePanel();
  return !!panel && !panel.classList.contains('hidden');
}

function toggleComparePanel() {
  if (isComparePanelVisible()) {
    closeComparePanel();
  } else {
    openComparePanel();
  }
}

function setCompareInputDocked(isDocked) {
  const inputSection = document.querySelector('.input-section');
  if (!inputSection) return;

  inputSection.classList.toggle('compare-docked', isDocked);

  if (isDocked && inputSection.classList.contains('minimized')) {
    inputSection.classList.remove('minimized');
    localStorage.setItem('ai-chat-input-minimized', 'false');
  }
}

function showComparePanel() {
  const panel = getComparePanel();
  if (!panel) return;

  panel.classList.remove('hidden');
  setCompareInputDocked(true);
}

function buildCompareBubble(message, options = {}) {
  const role = message.role === 'user' ? 'user' : 'assistant';
  const label = role === 'user'
    ? `<b>${escapeHtml(t('compareUserLabel', 'You:'))}</b>`
    : `<b>${escapeHtml(t('compareAiLabel', 'AI:'))}</b>`;
  const isPending = !!options.pending;
  const bubbleBg = role === 'user'
    ? 'rgba(255, 255, 255, 0.04)'
    : (isPending ? 'rgba(59, 130, 246, 0.08)' : 'rgba(168, 85, 247, 0.05)');
  const borderColor = role === 'user'
    ? 'rgba(255, 255, 255, 0.06)'
    : (isPending ? 'rgba(96, 165, 250, 0.35)' : 'rgba(168, 85, 247, 0.18)');
  const pendingClass = isPending ? ' compare-pending-bubble' : '';
  const progressHtml = role === 'assistant' && options.progress
    ? `<div class="compare-response-progress" role="status">${escapeHtml(options.progress)}</div>`
    : '';

  return `<div class="compare-msg-bubble msg-bubble-${role}${pendingClass}" style="margin-bottom: 14px; padding: 11px 12px; border-radius: 10px; background: ${bubbleBg}; border: 1px solid ${borderColor}; box-shadow: 0 4px 10px rgba(0,0,0,0.15)"><div class="compare-bubble-label">${label}</div><div class="compare-message-content">${formatCompareMessageContent(message.content, { allowHeadings: role === 'assistant', links: message.links })}</div>${progressHtml}</div>`;
}

function filterPendingPlaceholderMessages(platform, messages, pendingMessage) {
  if (!pendingMessage || messages.length === 0) return messages;

  const lastIndex = messages.length - 1;
  const lastMessage = messages[lastIndex];
  if (
    lastMessage?.role === 'assistant' &&
    isLikelyIncompleteAssistantAnswer(platform, lastMessage.content)
  ) {
    return messages.slice(0, lastIndex);
  }

  return messages;
}

function renderCompareHistory(platform, history, pendingMessage = '', options = {}) {
  const colTextEl = document.getElementById(`compare-text-${platform}`);
  if (!colTextEl) return;

  const messages = Array.isArray(history) ? history.filter(m => m && m.content) : [];
  const visibleMessages = filterPendingPlaceholderMessages(platform, messages, pendingMessage);
  if (options.cache !== false) compareLatestHistories[platform] = visibleMessages;
  if (messages.length === 0 && !pendingMessage) {
    const emptyText = t('platformNoConversation', 'This platform has no conversation content yet.');
    if (colTextEl.textContent !== emptyText || colTextEl.children.length > 0) {
      colTextEl.textContent = emptyText;
    }
    return false;
  }

  // Once text arrives, keep the streaming status inside that answer's bubble.
  // A separate pending bubble is only needed before the answer starts.
  const lastIndex = visibleMessages.length - 1;
  const hasAnswerBubble = visibleMessages[lastIndex]?.role === 'assistant';
  let html = visibleMessages.map((message, index) => buildCompareBubble(message, {
    progress: pendingMessage && hasAnswerBubble && index === lastIndex ? pendingMessage : ''
  })).join('');
  if (pendingMessage && !hasAnswerBubble) {
    html += buildCompareBubble({ role: 'assistant', content: pendingMessage }, { pending: true });
  }

  const template = document.createElement('template');
  template.innerHTML = html || escapeHtml(pendingMessage);
  const nextHtml = template.innerHTML;

  // Polling often returns the same history. Rebuilding identical bubbles resets
  // the column scroll position and unnecessarily jumps the user to the bottom.
  if (colTextEl.innerHTML === nextHtml) {
    return false;
  }

  const previousScrollTop = colTextEl.scrollTop;
  const distanceFromBottom = colTextEl.scrollHeight - colTextEl.clientHeight - previousScrollTop;
  const shouldStickToBottom = distanceFromBottom <= 48;

  colTextEl.innerHTML = nextHtml;

  setTimeout(() => {
    if (shouldStickToBottom) {
      colTextEl.scrollTop = colTextEl.scrollHeight;
    } else {
      const maxScrollTop = Math.max(0, colTextEl.scrollHeight - colTextEl.clientHeight);
      colTextEl.scrollTop = Math.min(previousScrollTop, maxScrollTop);
    }
  }, 50);

  return true;
}

function getCompareStatusLabel(platform) {
  if (!isPlatformEnabled(platform)) return t('statusDisabled', 'Disabled');
  const state = compareWatchState[platform];
  if (state && !state.complete) return t('compareRespondingShort', 'Responding');
  if ((compareLatestHistories[platform] || []).length > 0) return t('compareOrganized', 'Organized');
  return t('compareNoContent', 'No content yet');
}

function getShareTitle() {
  const prompt = document.getElementById('compare-prompt-text')?.textContent || '';
  const clean = prompt.replace(/\s+/g, ' ').trim();
  if (!clean || clean.includes(t('comparePromptWaiting', 'No question sent yet, or waiting for platform responses...'))) {
    return t('shareDefaultTitle', 'AI Zoo Smart Compare');
  }
  return clean.length > 60 ? `${clean.slice(0, 60)}...` : clean;
}

function getSafeFilenamePart(text) {
  const cleaned = String(text || '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  return cleaned || 'ai-zoo-compare';
}

function formatShareTimestamp(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatMarkdownMessage(message) {
  const role = message.role === 'user' ? t('shareRoleYou', 'You') : t('shareRoleAI', 'AI');
  const content = String(message.content || '').trim();
  if (!content) return '';
  return `### ${role}\n\n${content}`;
}

function buildCompareShareMarkdown() {
  const title = getShareTitle();
  const promptText = document.getElementById('compare-prompt-text')?.textContent?.trim() || '';
  const hasPrompt = promptText && !promptText.includes(t('comparePromptWaiting', 'No question sent yet'));
  const lines = [
    `# ${title}`,
    '',
    `${t('shareGeneratedLabel', 'Generated')}: ${formatShareTimestamp()}`,
    '',
    `## ${t('shareStatusHeading', 'Status')}`,
    ''
  ];

  getConfiguredPlatforms().filter(isPlatformEnabled).forEach(platform => {
    lines.push(`- ${getPlatformDisplayName(platform)}: ${getCompareStatusLabel(platform)}`);
  });

  if (hasPrompt) {
    lines.push('', `## ${t('shareLatestQuestionHeading', 'Latest Question')}`, '', promptText);
  }

  getConfiguredPlatforms().filter(isPlatformEnabled).forEach(platform => {
    const messages = compareLatestHistories[platform] || [];
    lines.push('', `## ${getPlatformDisplayName(platform)}`, '');

    if (!messages.length) {
      lines.push(getCompareStatusLabel(platform));
      return;
    }

    messages.forEach(message => {
      const block = formatMarkdownMessage(message);
      if (block) lines.push(block, '');
    });
  });

  lines.push('', '---', 'Shared from AI Zoo Extension: https://chromewebstore.google.com/detail/ai-zoo/lfjmcgadcijkapkfhliebaojgmjbnmid');
  return lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n';
}

function getLanguageMenu() {
  return document.getElementById('language-menu');
}

function closeLanguageMenu() {
  getLanguageMenu()?.classList.add('hidden');
  document.getElementById('language-btn')?.setAttribute('aria-expanded', 'false');
}

function syncLanguageMenu() {
  const currentLanguage = supportedLanguages.find(language => language.code === selectedLanguage) || supportedLanguages[0];

  document.querySelectorAll('[data-language-option]').forEach(button => {
    const active = button.dataset.languageOption === currentLanguage.code;
    button.classList.toggle('active', active);
    button.setAttribute('aria-checked', String(active));
    button.setAttribute('aria-current', active ? 'true' : 'false');
  });

  const button = document.getElementById('language-btn');
  if (button) {
    const title = `${t('languageButtonTitle', 'Choose language')}: ${currentLanguage.label}`;
    button.title = title;
    button.setAttribute('aria-label', title);
  }
}

function toggleLanguageMenu() {
  const menu = getLanguageMenu();
  if (!menu) return;

  closeSendOnePlatformMenu();
  closeSummaryPlatformMenu();
  syncLanguageMenu();
  const willOpen = menu.classList.contains('hidden');
  menu.classList.toggle('hidden', !willOpen);
  document.getElementById('language-btn')?.setAttribute('aria-expanded', String(willOpen));
  if (willOpen) {
    (menu.querySelector('[aria-checked="true"]') || menu.querySelector('button:not([hidden]):not(:disabled)'))?.focus();
  }
}

async function setSelectedLanguage(languageCode) {
  const nextLanguage = supportedLanguages.some(language => language.code === languageCode)
    ? languageCode
    : DEFAULT_LANGUAGE;

  selectedLanguage = nextLanguage;
  localStorage.setItem(LANGUAGE_STORAGE_KEY, selectedLanguage);
  closeLanguageMenu();
  await initI18n();
  syncPlatformToggleTitles();
  syncSendOnePlatformMenu();
  syncSummaryPlatformMenu();
  syncLayoutButton();
  if (document.getElementById('layout-config-dialog')?.open) {
    renderLayoutConfig();
  }
  renderSessionList();
  positionSessionSwitcher();
}

function getSendOnePlatformMenu() {
  return document.getElementById('send-one-platform-menu');
}

function closeSendOnePlatformMenu() {
  getSendOnePlatformMenu()?.classList.add('hidden');
  document.getElementById('send-one-btn')?.setAttribute('aria-expanded', 'false');
}

function syncSendOnePlatformMenu() {
  document.querySelectorAll('[data-send-one-platform]').forEach(button => {
    const platform = button.dataset.sendOnePlatform;
    const inLayout = isPlatformInLayout(platform);
    const enabled = isPlatformEnabled(platform);
    button.hidden = !inLayout;
    button.disabled = !enabled;
    const capPlatform = getPlatformDisplayName(platform);
    button.title = enabled
      ? t('sendQuestionToPlatformTitle', `Send question to ${capPlatform}`, capPlatform)
      : t('statusDisabled', 'Disabled');
  });
}

function toggleSendOnePlatformMenu() {
  const menu = getSendOnePlatformMenu();
  if (!menu) return;

  closeLanguageMenu();
  closeSummaryPlatformMenu();
  syncSendOnePlatformMenu();
  const willOpen = menu.classList.contains('hidden');
  menu.classList.toggle('hidden', !willOpen);
  document.getElementById('send-one-btn')?.setAttribute('aria-expanded', String(willOpen));
  if (willOpen) menu.querySelector('button:not([hidden]):not(:disabled)')?.focus();
}

function getSummaryPlatformMenu() {
  return document.getElementById('summary-platform-menu');
}

function closeSummaryPlatformMenu() {
  getSummaryPlatformMenu()?.classList.add('hidden');
  document.getElementById('summary-compare-btn')?.setAttribute('aria-expanded', 'false');
}

function getDefaultSummaryPrompt() {
  return t(
    'summaryPromptDefault',
    "Synthesize everyone's points, compare similarities and differences, and provide a clear conclusion."
  );
}

function syncSummaryPromptInput() {
  const input = document.getElementById('summary-prompt-input');
  if (!input) return;

  const hasCustomizedPrompt = localStorage.getItem(SUMMARY_PROMPT_CUSTOMIZED_STORAGE_KEY) === 'true';
  const savedPrompt = localStorage.getItem(SUMMARY_PROMPT_STORAGE_KEY);
  const defaultPrompt = getDefaultSummaryPrompt();
  const nextPrompt = hasCustomizedPrompt && savedPrompt !== null
    ? savedPrompt
    : defaultPrompt;

  if (!hasCustomizedPrompt || savedPrompt === null) {
    localStorage.setItem(SUMMARY_PROMPT_STORAGE_KEY, defaultPrompt);
  }

  if (input.value !== nextPrompt) {
    input.value = nextPrompt;
  }
}

function getCompareSummaryInstruction() {
  const input = document.getElementById('summary-prompt-input');
  const prompt = (input?.value || localStorage.getItem(SUMMARY_PROMPT_STORAGE_KEY) || '').trim();
  return prompt || getDefaultSummaryPrompt();
}

function syncSummaryPlatformMenu() {
  document.querySelectorAll('[data-summary-platform]').forEach(button => {
    const platform = button.dataset.summaryPlatform;
    const inLayout = isPlatformInLayout(platform);
    const enabled = isPlatformEnabled(platform);
    button.hidden = !inLayout;
    button.disabled = !enabled;
    const capPlatform = getPlatformDisplayName(platform);
    button.title = enabled
      ? t('sendCompareToPlatformTitle', `Send compare content to ${capPlatform}`, capPlatform)
      : t('statusDisabled', 'Disabled');
  });
}

function toggleSummaryPlatformMenu() {
  const menu = getSummaryPlatformMenu();
  if (!menu) return;

  closeLanguageMenu();
  closeSendOnePlatformMenu();
  syncSummaryPromptInput();
  syncSummaryPlatformMenu();
  const willOpen = menu.classList.contains('hidden');
  menu.classList.toggle('hidden', !willOpen);
  document.getElementById('summary-compare-btn')?.setAttribute('aria-expanded', String(willOpen));
  if (willOpen) document.getElementById('summary-prompt-input')?.focus();
}

function buildCompareSummaryPrompt() {
  const content = buildCompareShareMarkdown().trim();
  return `${content}\n\n---\n\n${getCompareSummaryInstruction()}`;
}

function sendCompareSummaryToPlatform(platform) {
  closeSummaryPlatformMenu();
  if (!platforms.includes(platform)) return;
  if (!isPlatformEnabled(platform)) return;

  const prompt = buildCompareSummaryPrompt();
  console.log(`[AI Multi-Chat] Sending compare summary content to ${platform}`);
  startComparePlatformWatch(platform, prompt, {
    deferHistoryRequests: true,
    preservePanel: true
  });
  sendQuestionToPlatform(platform, prompt);
  setMaximizedPlatform(platform);
}

function setShareActionStatus(message) {
  const subtitle = document.querySelector('.share-subtitle');
  if (!subtitle) return;
  subtitle.textContent = message;
}

function getVisibleFocusableElements(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(
    'button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'
  )).filter(element => !element.hidden && element.getClientRects().length > 0);
}

function setShareBackgroundInert(inert) {
  document.querySelectorAll('.container > :not(#share-panel)').forEach(element => {
    element.inert = inert;
  });
}

function handlePopupKeydown(event) {
  const sharePanel = document.getElementById('share-panel');
  if (sharePanel && !sharePanel.classList.contains('hidden')) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSharePanel();
      return;
    }
    if (event.key === 'Tab') {
      const focusable = getVisibleFocusableElements(sharePanel);
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
    return;
  }

  if (event.key === 'Escape') {
    const openControls = [
      ['summary-platform-menu', 'summary-compare-btn', closeSummaryPlatformMenu],
      ['send-one-platform-menu', 'send-one-btn', closeSendOnePlatformMenu],
      ['language-menu', 'language-btn', closeLanguageMenu],
      ['session-switcher', 'history-toggle-btn', hideSessionSwitcher]
    ];
    for (const [panelId, triggerId, close] of openControls) {
      const panel = document.getElementById(panelId);
      if (!panel || panel.classList.contains('hidden')) continue;
      event.preventDefault();
      close();
      document.getElementById(triggerId)?.focus();
      return;
    }
  }

  const menu = event.target.closest?.('[role="menu"]');
  if (!menu || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const items = getVisibleFocusableElements(menu).filter(element => element.matches('[role^="menuitem"]'));
  if (!items.length) return;
  event.preventDefault();
  const currentIndex = Math.max(0, items.indexOf(document.activeElement));
  let nextIndex = currentIndex;
  if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length;
  if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length;
  if (event.key === 'Home') nextIndex = 0;
  if (event.key === 'End') nextIndex = items.length - 1;
  items[nextIndex].focus();
}

function openSharePanel() {
  const panel = document.getElementById('share-panel');
  const output = document.getElementById('share-output');
  if (!panel || !output) return;

  shareLastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  output.value = buildCompareShareMarkdown();
  setShareBackgroundInert(true);
  panel.classList.remove('hidden');
  setShareActionStatus(t('sharePanelSubtitle', 'Organized as Markdown. You can copy or download it. Nothing is uploaded automatically.'));
  setTimeout(() => output.focus(), 50);
}

function closeSharePanel(options = {}) {
  document.getElementById('share-panel')?.classList.add('hidden');
  setShareBackgroundInert(false);
  if (options.restoreFocus !== false && shareLastFocusedElement?.isConnected) {
    shareLastFocusedElement.focus();
  }
  shareLastFocusedElement = null;
}

async function copyShareText() {
  const output = document.getElementById('share-output');
  if (!output) return;

  try {
    await navigator.clipboard.writeText(output.value);
    setShareActionStatus(t('shareCopied', 'Copied to clipboard.'));
  } catch (error) {
    output.select();
    document.execCommand('copy');
    setShareActionStatus(t('shareCopyFallback', 'Tried copying with the fallback method.'));
  }
}

function downloadShareMarkdown() {
  const output = document.getElementById('share-output');
  if (!output) return;

  const filename = `${getSafeFilenamePart(getShareTitle())}.md`;
  const blob = new Blob([output.value], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setShareActionStatus(t('shareDownloaded', 'Downloaded $1', filename));
}

async function nativeShareCompareText() {
  const output = document.getElementById('share-output');
  if (!output) return;

  if (!navigator.share) {
    setShareActionStatus(t('shareNotSupported', 'System share is not supported here. Please copy or download instead.'));
    return;
  }

  try {
    await navigator.share({
      title: getShareTitle(),
      text: output.value
    });
    setShareActionStatus(t('shareOpened', 'System share opened.'));
  } catch (error) {
    if (error && error.name === 'AbortError') return;
    setShareActionStatus(t('shareFailed', 'System share failed. Please copy or download instead.'));
  }
}

function requestPlatformHistory(platform, options = {}) {
  if (!isPlatformEnabled(platform)) return false;
  const now = Date.now();
  const requestState = compareHistoryRequestState[platform];
  if (requestState && !options.force) {
    if (requestState.inFlight && now - requestState.startedAt < COMPARE_HISTORY_REQUEST_STALE_MS) {
      return true;
    }

    if (!requestState.inFlight && now - requestState.lastRequestedAt < COMPARE_HISTORY_REQUEST_MIN_GAP_MS) {
      return true;
    }
  }

  const iframe = iframes[platform];
  if (!iframe || !iframe.contentWindow) return false;

  compareHistoryRequestState[platform] = {
    inFlight: true,
    requestId: ++compareHistoryRequestId,
    navigationEpoch: options.navigationEpoch ?? compareNavigationEpoch,
    startedAt: now,
    lastRequestedAt: now
  };

  iframe.contentWindow.postMessage({
    type: 'AI_SCRAPE_HISTORY_REQUEST',
    platform: platform,
    requestId: compareHistoryRequestState[platform].requestId,
    navigationEpoch: compareHistoryRequestState[platform].navigationEpoch,
    timeoutMs: options.timeoutMs || COMPARE_HISTORY_SCRAPE_TIMEOUT_MS,
    source: 'popup'
  }, '*');
  return true;
}

function clearCompareHistoryRequest(platform) {
  const requestState = compareHistoryRequestState[platform];
  if (!requestState) return;

  requestState.inFlight = false;
  requestState.finishedAt = Date.now();
}

function findQuestionAnswer(history, question, baselineOccurrences = 0) {
  return window.AIZooUtils.findAnswerAfterQuestion(history, question, baselineOccurrences);
}

function isLikelyIncompleteAssistantAnswer(platform, text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!platforms.includes(platform) || !value || value.length > 620) return false;

  const startsLikePlanning = /^(i['’]ll|i will|let me|i’m going to|i am going to|我(?:先|會|來|要|幫你|可以先)|讓我|先(?:查|看|分析|整理|確認)|以下(?:我會|先)|好的[,，]?\s*我)/i.test(value);
  const containsPlanningAction = /(break|verify|check|look up|research|judge|analy[sz]e|compare|separate|before|查詢|查證|查看|搜尋|搜索|研究|分析|整理|確認|比較|拆解|判斷|評估|找資料|先看|網頁|來源)/i.test(value);
  const hasSubstantialStructure = /(\n|#{1,6}\s|^[-*•]\s|\d+[.)、]\s|[。！？.!?].+[。！？.!?].+[。！？.!?])/m.test(String(text || '').trim());

  return startsLikePlanning && containsPlanningAction && !hasSubstantialStructure;
}

function findLatestMessage(history, role) {
  if (!Array.isArray(history)) return null;

  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i];
    if (message && message.role === role && String(message.content || '').trim()) {
      return message;
    }
  }

  return null;
}

function renderTrackedCompareHistory(platform, history, pendingMessage = '', options = {}) {
  if (compareWatchState[platform]?.preservePanel) return false;
  return renderCompareHistory(platform, history, pendingMessage, options);
}

function markComparePlatformPending(platform, message = t('compareResponding', 'Responding...')) {
  const state = compareWatchState[platform];
  if (!state || state.complete || !isComparePanelVisible()) return;

  const colTextEl = document.getElementById(`compare-text-${platform}`);
  if (colTextEl && (!colTextEl.innerText || colTextEl.innerText.includes(t('loadingConversationHistory', 'Loading conversation history')))) {
    renderTrackedCompareHistory(platform, [{ role: 'user', content: state.question }], message, { cache: false });
  }
}

function completeComparePlatform(platform, history) {
  const state = compareWatchState[platform];
  if (state) {
    const now = Date.now();
    state.complete = true;
    state.isGenerating = false;
    state.completedAt = now;
    // Keep a low-frequency watcher alive while Smart Compare remains open.
    // Long tool/research runs can resume after looking complete for minutes.
    state.settleUntil = Number.POSITIVE_INFINITY;
    state.lastSettlingPollAt = 0;
  }

  renderTrackedCompareHistory(platform, history);
  updateStatus(platform, '✅', t('statusComplete', 'Complete'));
  ensureComparePollTimer();
  stopComparePollTimerIfDone();
}

function failComparePlatform(platform, message) {
  const state = compareWatchState[platform];
  if (state) {
    state.complete = true;
    state.isGenerating = false;
    state.failed = true;
    state.error = String(message || '');
    state.completedAt = Date.now();
    state.settleUntil = 0;
  }

  const latestHistory = compareLatestHistories[platform] || [];
  const hasCurrentQuestion = state && findQuestionAnswer(
    latestHistory,
    state.question,
    state.baselineOccurrences
  ).questionIndex >= 0;
  const visibleHistory = state && !hasCurrentQuestion
    ? latestHistory.concat([{ role: 'user', content: state.question }])
    : latestHistory;

  // Remove the animated "Responding..." placeholder immediately. The red
  // status icon retains the exact platform error in its tooltip.
  renderTrackedCompareHistory(platform, visibleHistory, '', { cache: hasCurrentQuestion });
  updateStatus(platform, '❌', message || t('statusSendFailed', 'Send failed'));
  stopComparePollTimerIfDone();
}

function updateCompareFromHistory(platform, history, isGenerating = false, options = {}) {
  const state = compareWatchState[platform];
  const messages = Array.isArray(history) ? history : [];

  if (!state) {
    renderCompareHistory(platform, messages);
    const latestUser = findLatestMessage(messages, 'user');
    const latestAssistant = findLatestMessage(messages, 'assistant');
    if (latestUser) {
      const latestUserMsg = latestUser.content;
      const promptEl = document.getElementById('compare-prompt-text');
      if (promptEl) promptEl.textContent = latestUserMsg;
      if (!window.lastSentQuestion) window.lastSentQuestion = latestUserMsg;

      if (isGenerating || isLikelyIncompleteAssistantAnswer(platform, latestAssistant?.content)) {
        const now = Date.now();
        compareWatchState[platform] = {
          question: latestUserMsg,
          baselineOccurrences: Math.max(
            0,
            window.AIZooUtils.countExactUserQuestions(messages, latestUserMsg) - 1
          ),
          sent: true,
          startedAt: now,
          complete: false,
          isGenerating: !!isGenerating,
          lastAnswerText: String(latestAssistant?.content || '').trim(),
          lastAnswerChangedAt: now,
          lastActivityAt: now,
          stableCount: 0,
          completionHintAt: 0,
          completedAt: 0,
          settleUntil: 0,
          lastSettlingPollAt: 0
        };
        renderCompareHistory(platform, messages, t('compareResponding', 'Responding...'));
        updateStatus(platform, '🔄', t('statusResponding', 'Responding...'));
        ensureComparePollTimer();
      }
    }
    return;
  }

  const now = Date.now();
  if (!state.sent) {
    compareLatestHistories[platform] = messages;
    const queuedHistory = messages.concat([{ role: 'user', content: state.question }]);
    renderTrackedCompareHistory(
      platform,
      queuedHistory,
      t('compareResponding', 'Responding...'),
      { cache: false }
    );
    return;
  }
  const wasGenerating = state.isGenerating;
  state.isGenerating = !!isGenerating;
  if (isGenerating && !wasGenerating) {
    state.lastActivityAt = now;
  }
  const result = findQuestionAnswer(messages, state.question, state.baselineOccurrences);

  if (result.questionIndex < 0) {
    renderTrackedCompareHistory(platform, messages.concat([{ role: 'user', content: state.question }]), t('compareResponding', 'Responding...'), { cache: false });
    return;
  }

  const answerText = result.answer ? String(result.answer.content || '').trim() : '';
  if (!answerText) {
    renderTrackedCompareHistory(platform, messages, t('compareResponding', 'Responding...'));
    return;
  }

  if (isLikelyIncompleteAssistantAnswer(platform, answerText)) {
    state.complete = false;
    state.lastAnswerText = answerText;
    state.lastAnswerChangedAt = now;
    state.lastActivityAt = now;
    state.stableCount = 0;
    state.completedAt = 0;
    state.settleUntil = 0;
    renderTrackedCompareHistory(platform, messages, t('compareResponding', 'Responding...'));
    updateStatus(platform, '🔄', t('statusResponding', 'Responding...'));
    ensureComparePollTimer();
    return;
  }

  if (options.completionHint) {
    state.completionHintAt = now;
  }

  if (answerText === state.lastAnswerText) {
    if (!isGenerating) {
      state.stableCount += 1;
    }
  } else {
    state.lastAnswerText = answerText;
    state.lastAnswerChangedAt = now;
    state.lastActivityAt = now;
    state.stableCount = 0;

    // A platform can emit a premature completion signal between long-answer
    // phases. If more text arrives during the settling window, resume the watch.
    if (state.complete) {
      state.complete = false;
      state.completedAt = 0;
      state.settleUntil = 0;
      ensureComparePollTimer();
    }
  }

  if (isGenerating) {
    state.complete = false;
    state.stableCount = 0;
    state.completedAt = 0;
    state.settleUntil = 0;
  }

  if (state.complete) {
    renderTrackedCompareHistory(platform, messages);
    updateStatus(platform, '✅', t('statusComplete', 'Complete'));
    return;
  }

  const stablePollsRequired = COMPARE_STABLE_POLLS_REQUIRED_BY_PLATFORM[platform]
    || COMPARE_STABLE_POLLS_REQUIRED;
  const quietPeriodMs = COMPARE_QUIET_PERIOD_MS_BY_PLATFORM[platform] || COMPARE_QUIET_PERIOD_MS;
  const isStable = state.stableCount >= stablePollsRequired;
  const isQuiet = now - (state.lastAnswerChangedAt || state.startedAt) >= quietPeriodMs;
  // 平台明確標記完成（ChatGPT turn-state、Meta streaming-state）時直接採信，不再等穩定輪數與安靜期。
  const isDone = !isGenerating && (!!options.explicitComplete || (isStable && isQuiet));

  if (isDone) {
    completeComparePlatform(platform, messages);
  } else {
    // Keep confirming a stable tail internally, but stop showing "Responding"
    // as soon as the platform stops generating a substantive answer.
    renderTrackedCompareHistory(platform, messages, isGenerating ? t('compareResponding', 'Responding...') : '');
    updateStatus(platform, '🔄', isGenerating ? t('statusResponding', 'Responding...') : t('statusConfirmingResponseDone', 'Confirming response completion...'));
  }
}

function pollActiveCompareHistories() {
  const now = Date.now();
  platforms.forEach(platform => {
    const state = compareWatchState[platform];
    if (!state) return;
    if (!isComparePanelVisible() || !isPlatformEnabled(platform)) return;

    if (state.complete) {
      if (!state.settleUntil || now >= state.settleUntil) return;
      if (now - (state.lastSettlingPollAt || 0) < COMPARE_COMPLETED_RECHECK_INTERVAL_MS) return;

      state.lastSettlingPollAt = now;
      requestPlatformHistory(platform, { force: true });
      return;
    }

    requestPlatformHistory(platform);
  });

  stopComparePollTimerIfDone();
}

function stopComparePollTimerIfDone() {
  const now = Date.now();
  const hasActive = platforms.some(platform => {
    const state = compareWatchState[platform];
    return isComparePanelVisible()
      && isPlatformEnabled(platform)
      && state
      && (!state.complete || (state.settleUntil && now < state.settleUntil));
  });
  if (!hasActive && comparePollTimer) {
    clearInterval(comparePollTimer);
    comparePollTimer = null;
  }
}

function ensureComparePollTimer() {
  if (comparePollTimer || !isComparePanelVisible()) return;
  comparePollTimer = setInterval(pollActiveCompareHistories, COMPARE_POLL_INTERVAL_MS);
}

function clearCompareOpenRefreshTimers() {
  compareOpenRefreshTimers.forEach(timer => clearTimeout(timer));
  compareOpenRefreshTimers = [];
}

function scheduleCompareOpenRefresh() {
  clearCompareOpenRefreshTimers();

  compareOpenRefreshTimers = COMPARE_OPEN_REFRESH_DELAYS_MS.map(delay => (
    setTimeout(() => {
      if (!isComparePanelVisible()) return;

      platforms.forEach(platform => {
        if (isPlatformEnabled(platform)) {
          requestPlatformHistory(platform, { force: true });
        }
      });
    }, delay)
  ));
}

function requestCompareHistories(options = {}) {
  if (!isComparePanelVisible()) return;

  platforms.forEach(platform => {
    const state = compareWatchState[platform];
    const shouldRequest = options.includeCompleted || (state && !state.complete);
    if (shouldRequest && isPlatformEnabled(platform)) {
      requestPlatformHistory(platform, {
        force: !!options.force,
        timeoutMs: options.timeoutMs
      });
    }
  });
}

function scheduleCompareSendHistoryRefresh() {
  clearCompareOpenRefreshTimers();

  compareOpenRefreshTimers = COMPARE_SEND_HISTORY_REFRESH_DELAYS_MS.map(delay => (
    setTimeout(() => {
      requestCompareHistories({
        includeCompleted: true,
        force: true
      });
    }, delay)
  ));
}

function createCompareWatchState(platform, question, options = {}) {
  const now = Date.now();
  const baselineOccurrences = options.baselineOccurrences ?? window.AIZooUtils.countExactUserQuestions(
    compareLatestHistories[platform] || [],
    question
  );
  return {
    question,
    baselineOccurrences,
    sent: !!options.sent,
    startedAt: now,
    complete: false,
    isGenerating: false,
    lastAnswerText: '',
    lastAnswerChangedAt: now,
    lastActivityAt: now,
    stableCount: 0,
    completionHintAt: 0,
    completedAt: 0,
    settleUntil: 0,
    lastSettlingPollAt: 0,
    preservePanel: !!options.preservePanel
  };
}

function startComparePlatformWatch(platform, question, options = {}) {
  if (!platforms.includes(platform) || !isPlatformEnabled(platform)) return;

  compareWatchState[platform] = createCompareWatchState(platform, question, options);

  if (isComparePanelVisible() && !options.preservePanel) {
    const promptEl = document.getElementById('compare-prompt-text');
    if (promptEl) promptEl.textContent = question;

    const latestHistory = compareLatestHistories[platform] || [];
    const hasCurrentQuestion = findQuestionAnswer(
      latestHistory,
      question,
      compareWatchState[platform].baselineOccurrences
    ).questionIndex >= 0;
    const visibleHistory = hasCurrentQuestion
      ? latestHistory
      : latestHistory.concat([{ role: 'user', content: question }]);
    renderCompareHistory(platform, visibleHistory, t('compareResponding', 'Responding...'), { cache: false });
  }

  if (!options.deferHistoryRequests) {
    requestPlatformHistory(platform);
  }
  ensureComparePollTimer();
}

function startCompareWatch(question, options = {}) {
  showComparePanel();
  const promptEl = document.getElementById('compare-prompt-text');
  if (promptEl) promptEl.textContent = question;

  platforms.forEach(platform => {
    if (!isPlatformEnabled(platform)) {
      delete compareWatchState[platform];
      const textEl = document.getElementById(`compare-text-${platform}`);
      if (textEl) textEl.textContent = t('platformDisabled', 'This platform is disabled');
      return;
    }

    compareWatchState[platform] = createCompareWatchState(platform, question);

    renderCompareHistory(platform, [{ role: 'user', content: question }], t('compareResponding', 'Responding...'), { cache: false });
    if (!options.deferHistoryRequests) {
      requestPlatformHistory(platform);
    }
  });

  ensureComparePollTimer();
}

function openComparePanel() {
  showComparePanel();
  ensureComparePollTimer();
  resetComparePrompt();

  platforms.forEach(platform => {
    const textEl = document.getElementById(`compare-text-${platform}`);
    if (!textEl) return;

    if (isPlatformEnabled(platform)) {
      const state = compareWatchState[platform];
      if (state && state.complete) {
        delete compareWatchState[platform];
      }

      if (!compareWatchState[platform]) {
        textEl.textContent = t('loadingConversationHistory', 'Loading conversation history...');
      }

      if (!requestPlatformHistory(platform)) {
        textEl.textContent = t('platformNotReady', 'Platform is not ready yet');
      }
    } else {
      textEl.textContent = t('platformDisabled', 'This platform is disabled');
    }
  });

  if (window.compareFocusTimeout) {
    clearTimeout(window.compareFocusTimeout);
  }
  window.compareFocusTimeout = setTimeout(() => {
    document.getElementById('question-input')?.focus();
    window.compareFocusTimeout = null;
  }, 80);

  scheduleCompareOpenRefresh();
}

function closeComparePanel() {
  const panel = document.getElementById('compare-panel');
  if (panel) panel.classList.add('hidden');
  setCompareInputDocked(false);
  closeSummaryPlatformMenu();
  clearCompareOpenRefreshTimers();
  stopComparePollTimerIfDone();
  if (window.compareFocusTimeout) {
    clearTimeout(window.compareFocusTimeout);
    window.compareFocusTimeout = null;
  }
}

console.log('[AI Multi-Chat] Popup script loaded');
