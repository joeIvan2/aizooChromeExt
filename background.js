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

// --- Cookie Synchronization Logic ---
chrome.cookies.onChanged.addListener(async (changeInfo) => {
  const { cookie, removed } = changeInfo;
  if (removed) return;

  // 定義需要處理的網域
  const targetDomains = ['chatgpt.com', 'openai.com', 'grok.com', 'google.com', 'claude.ai'];
  const isTarget = targetDomains.some(d => cookie.domain.includes(d));

  if (!isTarget) return;

  // 避免無窮迴圈：只有當 Cookie 不符合我們的要求時才修改
  // 我們需要 SameSite=None (no_restriction) 和 Secure=true 才能在 iframe 中使用
  if (cookie.sameSite !== 'no_restriction' || !cookie.secure) {
    // console.log(`[Cookie Fix] Updating cookie for iframe access: ${cookie.name} (${cookie.domain})`);

    const url = 'https://' + cookie.domain.replace(/^\./, '') + cookie.path;
    
    const newCookie = {
      url: url,
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      secure: true,
      httpOnly: cookie.httpOnly,
      expirationDate: cookie.expirationDate,
      storeId: cookie.storeId,
      sameSite: 'no_restriction' // 允許跨站 iframe 讀取
    };

    try {
      // 這裡需要暫時移除監聽器以避免迴圈嗎？通常 API 內部會有防呆，但為了保險起見我們在上面做了檢查
      await chrome.cookies.set(newCookie);
    } catch (error) {
      // 某些 Cookie (如 HostOnly) 可能無法通過這種方式簡單修改，忽略錯誤
      // console.error('[Cookie Fix] Update failed:', error);
    }
  }
});
// --- End Cookie Synchronization Logic ---
