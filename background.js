// background.js - Service Worker for Manifest V3
console.log('[AI Multi-Chat] Service worker initializing...');

// 儲存 AI Multi-Chat 分頁的 ID
let aiChatTabId = null;
let openAIChatQueue = Promise.resolve();

const GROK_WEBSOCKET_COOKIE_RULE_ID = 9001;
const GROK_WEBSOCKET_COOKIE_URL = 'https://grok.com/ws/mgw/';
const GROK_EXTENSION_PARTITION_KEY = {
  topLevelSite: new URL(chrome.runtime.getURL('/')).origin,
  hasCrossSiteAncestor: true
};
let grokCookieRuleUpdate = Promise.resolve();

async function updateGrokWebSocketCookieRule(reason, targetTabId = aiChatTabId) {
  if (!Number.isInteger(targetTabId)) {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [GROK_WEBSOCKET_COOKIE_RULE_ID]
    });
    return;
  }
  const [unpartitionedCookies, partitionedCookies] = await Promise.all([
    chrome.cookies.getAll({
      url: GROK_WEBSOCKET_COOKIE_URL
    }),
    chrome.cookies.getAll({
      url: GROK_WEBSOCKET_COOKIE_URL,
      partitionKey: GROK_EXTENSION_PARTITION_KEY
    })
  ]);
  const cookies = [...unpartitionedCookies, ...partitionedCookies];
  const cookieHeader = cookies
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');

  const addRules = cookieHeader ? [{
    id: GROK_WEBSOCKET_COOKIE_RULE_ID,
    priority: 100,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{
        header: 'Cookie',
        operation: 'set',
        value: cookieHeader
      }]
    },
    condition: {
      urlFilter: '||grok.com/ws/mgw/',
      resourceTypes: ['websocket'],
      tabIds: [targetTabId]
    }
  }] : [];

  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [GROK_WEBSOCKET_COOKIE_RULE_ID],
    addRules
  });

  console.log(
    '[AI Multi-Chat] Grok WebSocket cookie rule updated:',
    reason,
    `(${unpartitionedCookies.length} regular, ${partitionedCookies.length} partitioned cookies)`
  );
}

function scheduleGrokWebSocketCookieRuleUpdate(reason, targetTabId = aiChatTabId) {
  grokCookieRuleUpdate = grokCookieRuleUpdate
    .catch(() => {})
    .then(() => updateGrokWebSocketCookieRule(reason, targetTabId));

  return grokCookieRuleUpdate;
}

// Service worker 啟動時執行
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[AI Multi-Chat] Extension installed/updated:', details.reason);

  scheduleGrokWebSocketCookieRuleUpdate(`extension-${details.reason}`)
    .catch((error) => {
      console.error('[AI Multi-Chat] Could not prepare Grok WebSocket cookies:', error);
    });

  if (details.reason === 'install') {
    console.log('[AI Multi-Chat] First time installation');
    // 首次安裝時自動開啟
    queueOpenAIChatTab();
  } else if (details.reason === 'update') {
    console.log('[AI Multi-Chat] Extension updated');
  }
});

chrome.runtime.onStartup.addListener(() => {
  scheduleGrokWebSocketCookieRuleUpdate('browser-startup').catch((error) => {
    console.error('[AI Multi-Chat] Could not prepare Grok WebSocket cookies:', error);
  });
});

chrome.cookies.onChanged.addListener((changeInfo) => {
  const domain = changeInfo.cookie?.domain?.replace(/^\./, '');
  if (domain !== 'grok.com' && !domain?.endsWith('.grok.com')) return;

  scheduleGrokWebSocketCookieRuleUpdate('grok-cookie-changed').catch((error) => {
    console.error('[AI Multi-Chat] Could not refresh Grok WebSocket cookies:', error);
  });
});

// 點擊擴充圖示時
chrome.action.onClicked.addListener(async (tab) => {
  console.log('[AI Multi-Chat] Extension icon clicked');
  await queueOpenAIChatTab({ openLayout: true });
});

function queueOpenAIChatTab(options = {}) {
  const task = openAIChatQueue.catch(() => {}).then(() => openAIChatTab(options));
  openAIChatQueue = task.catch(() => {});
  return task;
}

// 開啟或聚焦到 AI Chat 分頁
async function openAIChatTab(options = {}) {
  const url = chrome.runtime.getURL('popup.html');
  const launchUrl = options.openLayout ? `${url}#layout-config` : url;

  const requestLayoutConfigurator = async (tabId) => {
    if (!options.openLayout) return;

    try {
      await chrome.runtime.sendMessage({
        type: 'AI_ZOO_OPEN_LAYOUT_CONFIG',
        targetTabId: tabId,
        source: 'background'
      });
    } catch (error) {
      console.log('[AI Multi-Chat] Layout configurator message was not acknowledged:', error.message);
    }
  };

  try {
    // 1. 檢查是否已有 AI Chat 分頁
    if (aiChatTabId !== null) {
      try {
        // 嘗試取得該分頁
        const tab = await chrome.tabs.get(aiChatTabId);

        if (typeof tab.url !== 'string' || !tab.url.startsWith(url)) {
          aiChatTabId = null;
          throw new Error('Stored tab navigated away from AI Zoo');
        }

        // 如果分頁存在，聚焦到該分頁
        await chrome.tabs.update(aiChatTabId, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });

        console.log('[AI Multi-Chat] Focused to existing tab:', aiChatTabId);
        scheduleGrokWebSocketCookieRuleUpdate('focus-ai-chat', aiChatTabId).catch((error) => {
          console.warn('[AI Multi-Chat] Grok preparation failed; AI Zoo remains open:', error);
        });
        await requestLayoutConfigurator(aiChatTabId);
        return;
      } catch (error) {
        // 分頁不存在了，清除 ID
        console.log('[AI Multi-Chat] Stored tab no longer exists');
        aiChatTabId = null;
      }
    }

    // 2. 搜尋是否有其他 AI Chat 分頁
    const tabs = await chrome.tabs.query({});
    const existingTab = tabs.find(tab => typeof tab.url === 'string' && tab.url.startsWith(url));
    if (existingTab) {
      // 找到現有分頁，聚焦過去
      const tab = existingTab;
      aiChatTabId = tab.id;
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });

      console.log('[AI Multi-Chat] Focused to found tab:', tab.id);
      scheduleGrokWebSocketCookieRuleUpdate('focus-found-ai-chat', tab.id).catch((error) => {
        console.warn('[AI Multi-Chat] Grok preparation failed; AI Zoo remains open:', error);
      });
      await requestLayoutConfigurator(tab.id);
      return;
    }

    // 3. 沒有現有分頁，創建新的
    const newTab = await chrome.tabs.create({
      url: launchUrl,
      active: true
    });

    aiChatTabId = newTab.id;
    console.log('[AI Multi-Chat] Created new tab:', newTab.id);
    scheduleGrokWebSocketCookieRuleUpdate('created-ai-chat', newTab.id).catch((error) => {
      console.warn('[AI Multi-Chat] Grok preparation failed; AI Zoo remains open:', error);
    });

  } catch (error) {
    console.error('[AI Multi-Chat] Error opening tab:', error);
  }
}

// 監聽分頁關閉事件
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === aiChatTabId) {
    console.log('[AI Multi-Chat] AI Chat tab closed');
    aiChatTabId = null;
    scheduleGrokWebSocketCookieRuleUpdate('ai-chat-closed', null).catch(() => {});
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId !== aiChatTabId || !changeInfo.url) return;
  const popupUrl = chrome.runtime.getURL('popup.html');
  if (changeInfo.url.startsWith(popupUrl)) return;
  aiChatTabId = null;
  scheduleGrokWebSocketCookieRuleUpdate('ai-chat-navigated-away', null).catch(() => {});
});

// 監聽來自 content scripts 的消息（如果需要）
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[AI Multi-Chat] Message received:', request);

  if (request.type === 'GROK_PREPARE_WEBSOCKET') {
    const popupUrl = chrome.runtime.getURL('popup.html');
    const senderTabId = sender.tab?.id;
    const senderTopUrl = sender.tab?.url || '';
    if (!Number.isInteger(senderTabId) || !senderTopUrl.startsWith(popupUrl)) {
      sendResponse({ ok: false, error: 'Request did not come from an AI Zoo tab' });
      return false;
    }
    aiChatTabId = senderTabId;
    scheduleGrokWebSocketCookieRuleUpdate('grok-content-script', senderTabId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.error('[AI Multi-Chat] Could not prepare Grok WebSocket cookies:', error);
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  // 處理 OAuth 完成消息
  if (request.type === 'OAUTH_COMPLETE') {
    console.log('[AI Multi-Chat] OAuth completed for:', request.platform);

    // 通知 popup 頁面 OAuth 完成（如果需要）
    chrome.runtime.sendMessage({
      type: 'OAUTH_SUCCESS',
      platform: request.platform
    }).catch(err => {
      // popup 可能已經關閉，忽略錯誤
      console.log('[AI Multi-Chat] Could not notify popup:', err.message);
    });
  }

  // 異步回應需要 return true
  return true;
});

console.log('[AI Multi-Chat] Service worker loaded successfully');
console.log('[AI Multi-Chat] Headers will be modified by declarativeNetRequest rules');

scheduleGrokWebSocketCookieRuleUpdate('service-worker-start').catch((error) => {
  console.error('[AI Multi-Chat] Could not prepare Grok WebSocket cookies:', error);
});
