// background.js - Service Worker for Manifest V3
console.log('[AI Multi-Chat] Service worker initializing...');

// 儲存 AI Multi-Chat 分頁的 ID
let aiChatTabId = null;

// Service worker 啟動時執行
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[AI Multi-Chat] Extension installed/updated:', details.reason);

  if (details.reason === 'install') {
    console.log('[AI Multi-Chat] First time installation');
    // 首次安裝時自動開啟
    openAIChatTab();
  } else if (details.reason === 'update') {
    console.log('[AI Multi-Chat] Extension updated');
  }
});

// 點擊擴充圖示時
chrome.action.onClicked.addListener(async (tab) => {
  console.log('[AI Multi-Chat] Extension icon clicked');
  await openAIChatTab();
});

// 開啟或聚焦到 AI Chat 分頁
async function openAIChatTab() {
  const url = chrome.runtime.getURL('popup.html');

  try {
    // 1. 檢查是否已有 AI Chat 分頁
    if (aiChatTabId !== null) {
      try {
        // 嘗試取得該分頁
        const tab = await chrome.tabs.get(aiChatTabId);

        // 如果分頁存在，聚焦到該分頁
        await chrome.tabs.update(aiChatTabId, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });

        console.log('[AI Multi-Chat] Focused to existing tab:', aiChatTabId);
        return;
      } catch (error) {
        // 分頁不存在了，清除 ID
        console.log('[AI Multi-Chat] Stored tab no longer exists');
        aiChatTabId = null;
      }
    }

    // 2. 搜尋是否有其他 AI Chat 分頁
    const tabs = await chrome.tabs.query({ url: url });
    if (tabs.length > 0) {
      // 找到現有分頁，聚焦過去
      const tab = tabs[0];
      aiChatTabId = tab.id;
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });

      console.log('[AI Multi-Chat] Focused to found tab:', tab.id);
      return;
    }

    // 3. 沒有現有分頁，創建新的
    const newTab = await chrome.tabs.create({
      url: url,
      active: true
    });

    aiChatTabId = newTab.id;
    console.log('[AI Multi-Chat] Created new tab:', newTab.id);

  } catch (error) {
    console.error('[AI Multi-Chat] Error opening tab:', error);
  }
}

// 監聽分頁關閉事件
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === aiChatTabId) {
    console.log('[AI Multi-Chat] AI Chat tab closed');
    aiChatTabId = null;
  }
});

// 監聽來自 content scripts 的消息（如果需要）
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[AI Multi-Chat] Message received:', request);

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
