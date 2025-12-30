// popup.js - AI Multi-Chat 主頁面控制邏輯

console.log('[AI Multi-Chat] Popup initializing...');

const platforms = ['grok', 'gemini', 'claude', 'chatgpt'];
const iframes = {};
const statusElements = {};
let currentMaximizedPlatform = null; // 當前放大的平台

const defaultUrls = {
  grok: 'https://grok.com/',
  gemini: 'https://gemini.google.com/app',
  claude: 'https://claude.ai/new',
  chatgpt: 'https://chatgpt.com/'
};

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  console.log('[AI Multi-Chat] DOM loaded, initializing...');

  // 獲取所有 iframe 和狀態元素
  platforms.forEach(platform => {
    iframes[platform] = document.getElementById(`${platform}-iframe`);
    statusElements[platform] = document.getElementById(`${platform}-status`);

    // 恢復上次的 URL
    const savedUrl = localStorage.getItem(`ai-chat-url-${platform}`);
    if (savedUrl && savedUrl !== defaultUrls[platform]) {
      console.log(`[${platform}] Restoring saved URL:`, savedUrl);
      iframes[platform].src = savedUrl;
    }

    // 監聽 iframe 載入
    if (iframes[platform]) {
      iframes[platform].addEventListener('load', () => {
        console.log(`[${platform}] iframe loaded`);
        updateStatus(platform, '⏳', '等待準備...');

        // iframe 載入後重新聚焦到主輸入框（防止焦點被 iframe 內部搶走）
        setTimeout(() => {
          const mainInput = document.getElementById('question-input');
          if (mainInput && document.activeElement !== mainInput) {
            mainInput.focus();
            console.log(`[${platform}] Refocused main input after iframe load`);
          }
        }, 100);
      });
    }
  });

  // 監聽來自 iframe 的消息
  window.addEventListener('message', handleMessage);

  // 發送按鈕
  document.getElementById('send-all-btn').addEventListener('click', sendQuestionToAll);

  // 新對話按鈕
  document.getElementById('new-chat-btn').addEventListener('click', startNewChatForAll);

  // Enter 快捷鍵（Ctrl+Enter 發送）
  document.getElementById('question-input').addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      sendQuestionToAll();
    }
  });

  // 聚焦到輸入框
  document.getElementById('question-input').focus();

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
    const mainInput = document.getElementById('question-input');

    // 如果焦點跳到 iframe，且沒有放大任何 iframe，且用戶沒有主動點擊 iframe
    if (e.target.tagName === 'IFRAME' && !currentMaximizedPlatform && !userInteractedWithIframe) {
      console.log('[AI Multi-Chat] Focus stolen by iframe, refocusing main input');
      setTimeout(() => {
        if (mainInput) mainInput.focus();
      }, 50);
    }
  });

  // 當用戶開始在主輸入框輸入時，重置互動標記
  document.getElementById('question-input').addEventListener('focus', () => {
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

  function switchMaximizedIframe(direction) {
    if (!currentMaximizedPlatform) return;

    const currentIndex = platforms.indexOf(currentMaximizedPlatform);
    let newIndex = currentIndex + direction;

    // 循環切換
    if (newIndex < 0) {
      newIndex = platforms.length - 1;
    } else if (newIndex >= platforms.length) {
      newIndex = 0;
    }

    const newPlatform = platforms[newIndex];
    console.log(`[AI Multi-Chat] Switching maximized iframe from ${currentMaximizedPlatform} to ${newPlatform}`);
    toggleMaximize(newPlatform);
  }

  // --- Maximize/Minimize iframe Logic ---
  // 為所有放大按鈕添加事件監聽器
  document.querySelectorAll('.maximize-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const platform = btn.dataset.platform;
      toggleMaximize(platform);
    });
  });

  function toggleMaximize(platform) {
    const wrapper = document.querySelector(`.iframe-wrapper[data-platform="${platform}"]`);
    const btn = document.querySelector(`.maximize-btn[data-platform="${platform}"]`);

    if (!wrapper || !btn) return;

    if (currentMaximizedPlatform === platform) {
      // 縮小：恢復所有 iframe 到原始狀態
      document.querySelectorAll('.iframe-wrapper').forEach(w => {
        w.classList.remove('maximized', 'dimmed');
      });

      // 更新按鈕圖標和提示
      btn.textContent = '⤢';
      btn.title = '放大';

      currentMaximizedPlatform = null;
    } else {
      // 如果已經有其他 iframe 被放大，先恢復
      if (currentMaximizedPlatform) {
        const prevWrapper = document.querySelector(`.iframe-wrapper[data-platform="${currentMaximizedPlatform}"]`);
        const prevBtn = document.querySelector(`.maximize-btn[data-platform="${currentMaximizedPlatform}"]`);
        if (prevWrapper) prevWrapper.classList.remove('maximized');
        if (prevBtn) {
          prevBtn.textContent = '⤢';
          prevBtn.title = '放大';
        }
      }

      // 放大當前 iframe
      document.querySelectorAll('.iframe-wrapper').forEach(w => {
        if (w.dataset.platform === platform) {
          w.classList.add('maximized');
          w.classList.remove('dimmed');
        } else {
          w.classList.add('dimmed');
          w.classList.remove('maximized');
        }
      });

      // 更新按鈕圖標和提示
      btn.textContent = '⤡';
      btn.title = '縮小';

      currentMaximizedPlatform = platform;
    }
  }

  // --- Draggable Input Section Logic ---
  const inputSection = document.querySelector('.input-section');
  let isDragging = false;
  let currentX;
  let currentY;
  let initialX;
  let initialY;
  let xOffset = 0;
  let yOffset = 0;

  // Load saved position
  const savedPosition = localStorage.getItem('ai-chat-input-pos');
  if (savedPosition) {
    const pos = JSON.parse(savedPosition);
    xOffset = pos.x;
    yOffset = pos.y;
    setTranslate(pos.x, pos.y, inputSection);
    // Remove bottom/left to allow transform to work fully or reset them
    inputSection.style.bottom = 'auto'; 
    inputSection.style.left = '0px';
    inputSection.style.top = '0px'; 
    // We are using translate, so we set top/left to 0 and move with transform
  } else {
    // Initial State is handled by CSS (bottom: 30px, left: 20px), 
    // but for translate logic, we might want to capture that or just start from 0,0 relative to its CSS position?
    // A simpler approach for absolute positioning: modify top/left directly.
    
    // Let's switch to top/left manipulation for simplicity and compatibility with resize.
    // However, CSS sets 'bottom'. Let's initialize top/left from computed style if not saved.
  }

  // Simpler Drag Implementation: Direct Top/Left manipulation
  // This avoids fighting with 'bottom' and transforms.
  
  if (savedPosition) {
    const pos = JSON.parse(savedPosition);
    inputSection.style.bottom = 'auto'; // clear bottom
    inputSection.style.left = pos.left;
    inputSection.style.top = pos.top;
  }

  // Use Pointer Events for better capture (handles iframes and fast movement)
  inputSection.addEventListener('pointerdown', dragStart);
  inputSection.addEventListener('pointermove', drag);
  inputSection.addEventListener('pointerup', dragEnd);
  inputSection.addEventListener('pointercancel', dragEnd);

  function dragStart(e) {
    // Prevent dragging if clicking on interactive elements
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') {
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
    initialX = e.clientX - inputSection.offsetLeft;
    initialY = e.clientY - inputSection.offsetTop;

    isDragging = true;
    inputSection.setPointerCapture(e.pointerId); // Capture pointer to handle out-of-bounds/iframes
  }

  function dragEnd(e) {
    if (!isDragging) return;

    isDragging = false;
    inputSection.releasePointerCapture(e.pointerId);

    // Save position
    const pos = {
      left: inputSection.style.left,
      top: inputSection.style.top
    };
    localStorage.setItem('ai-chat-input-pos', JSON.stringify(pos));
  }

  function drag(e) {
    if (isDragging) {
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
    }
  }
  
  function setTranslate(xPos, yPos, el) {
    el.style.transform = "translate3d(" + xPos + "px, " + yPos + "px, 0)";
  }

  console.log('[AI Multi-Chat] Popup initialized');
});

// 發送問題到所有 AI
function sendQuestionToAll() {
  const questionInput = document.getElementById('question-input');
  const question = questionInput.value.trim();
  if (!question) {
    alert('請輸入問題');
    return;
  }

  console.log('[AI Multi-Chat] Sending question to all platforms:', question);

  // 清空輸入區
  questionInput.value = '';

  platforms.forEach(platform => {
    sendQuestionToPlatform(platform, question);
  });
}

// 開啟所有平台的新對話
function startNewChatForAll() {
  if (!confirm('確定要開始新對話嗎？這將重置所有 AI 的當前會話。')) {
    return;
  }
  
  console.log('[AI Multi-Chat] Starting new chat for all platforms');
  platforms.forEach(platform => {
    // 清除儲存的 URL，恢復預設
    localStorage.removeItem(`ai-chat-url-${platform}`);

    const iframe = iframes[platform];
    if (iframe) {
       iframe.contentWindow.postMessage({
        type: 'AI_NEW_CHAT',
        platform: platform,
        source: 'popup'
      }, '*');
      updateStatus(platform, '🔄', '重置中...');
    }
  });
}

// 發送問題到單個平台
function sendQuestionToPlatform(platform, question) {
  const iframe = iframes[platform];
  if (!iframe) {
    console.error(`[${platform}] iframe not found`);
    updateStatus(platform, '❌', 'iframe 未找到');
    return;
  }

  console.log(`[${platform}] Sending question...`);

  // 獲取 iframe 的 tab ID（通過 Chrome API）
  // 由於 iframe 在同一個 tab 中，我們需要直接向 iframe 中的頁面發送消息
  // 使用 postMessage 與 iframe 內的 content script 通訊

  try {
    // 直接通過 iframe 的 contentWindow 發送消息
    iframe.contentWindow.postMessage({
      type: 'AI_SUBMIT_QUESTION',
      question: question,
      platform: platform,
      source: 'popup'
    }, '*');

    // 更新狀態
    updateStatus(platform, '🔄', '發送中...');
  } catch (error) {
    console.error(`[${platform}] Error sending message:`, error);
    updateStatus(platform, '❌', '發送失敗');
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

  switch (data.type) {
    case 'AI_READY':
      console.log(`[${platform}] Ready`);
      updateStatus(platform, '✅', '準備就緒');
      break;

    case 'AI_QUESTION_SENT':
      console.log(`[${platform}] Question sent successfully`);
      updateStatus(platform, '🔄', '等待回應...');
      break;

    case 'AI_RESPONSE_START':
      console.log(`[${platform}] Response started`);
      updateStatus(platform, '🔄', '正在回應...');
      break;

    case 'AI_RESPONSE_RECEIVED':
      console.log(`[${platform}] Response received:`, data.response.substring(0, 100) + '...');
      updateStatus(platform, '✅', '完成');
      // 可以在這裡顯示回應內容（未來功能）
      break;

    case 'AI_ERROR':
      console.error(`[${platform}] Error:`, data.message);
      updateStatus(platform, '❌', data.message);
      break;

    case 'AI_INFO':
      console.log(`[${platform}] Info:`, data.message);
      // info 訊息不改變狀態，只記錄
      break;

    case 'AI_URL_CHANGED':
      console.log(`[${platform}] URL changed:`, data.url);
      localStorage.setItem(`ai-chat-url-${platform}`, data.url);
      break;

    default:
      // 忽略其他類型的消息
      break;
  }
}

// 更新狀態指示器
function updateStatus(platform, emoji, title) {
  const statusEl = statusElements[platform];
  if (statusEl) {
    statusEl.textContent = emoji;
    statusEl.title = `[${platform}] ${title}`;

    // 如果是載入中，添加旋轉動畫
    if (emoji === '⏳' || emoji === '🔄') {
      statusEl.classList.add('loading');
    } else {
      statusEl.classList.remove('loading');
    }
  }
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
      updateStatus(platform, '🔐', '需要登入驗證');
      break;

    case 'CHATGPT_NEEDS_LOGIN':
      console.log('[popup] ChatGPT needs login:', data.url);
      updateStatus('chatgpt', '🔐', '需要登入驗證');
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

      updateStatus('chatgpt', '🔐', '登入視窗已開啟');

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
                updateStatus('chatgpt', '🔄', '重新載入中...');
                iframe.src = chatgptConfig.homeUrl;

                // 3 秒後重置狀態
                setTimeout(() => {
                  updateStatus('chatgpt', '⏳', '等待準備...');
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
        updateStatus(loginPlatform, '🔐', '請在新分頁中完成登入');
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
        updateStatus(reloadPlatform, '🔄', '重新載入中...');
        iframe.src = reloadConfig.homeUrl;

        // 3 秒後重置狀態
        setTimeout(() => {
          updateStatus(reloadPlatform, '⏳', '等待準備...');
        }, 3000);
      }
      break;

    default:
      break;
  }
}

console.log('[AI Multi-Chat] Popup script loaded');
