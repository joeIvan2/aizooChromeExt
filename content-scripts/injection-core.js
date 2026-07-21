// injection-core.js - 核心注入邏輯（從 webviewInjection.ts 轉換）

// 輔助函數：發送消息給 popup
function sendMessageToPopup(data) {
  const message = {
    ...data,
    source: 'content-script'
  };

  // 發送給父窗口（popup.html）
  if (window.parent !== window) {
    window.parent.postMessage(message, '*');
  } else {
    // 如果沒有父窗口，發送給當前窗口（用於測試）
    window.postMessage(message, '*');
  }
}

const InjectionCore = {
  /**
   * 設置 Fetch 攔截監聽（用於 Grok, Claude, ChatGPT）
   */
  setupFetchMonitor(config) {
    if (window.__fetchMonitorInitialized) {
      console.log(`[${config.id}] Fetch monitor already initialized`);
      return;
    }
    window.__fetchMonitorInitialized = true;

    const origFetch = window.fetch;
    window.fetch = async function(...args) {
      const url = args[0];
      let method = 'GET';

      if (url instanceof Request) {
        method = url.method;
      } else if (args.length > 1 && args[1] && args[1].method) {
        method = args[1].method;
      }

      const isTarget = typeof url === 'string' &&
                      url.includes(config.responseApiPattern) &&
                      method.toUpperCase() === config.responseMethod;

      if (isTarget) {
        console.log(`[${config.id}] Detected target fetch:`, url);

        // Network events are only diagnostics; DOM watcher owns AI_RESPONSE_START/RECEIVED.
        sendMessageToPopup({
          type: 'AI_NETWORK_RESPONSE_START',
          platform: config.id
        });

        const response = await origFetch.apply(this, args);

        // 複製並讀取響應流
        if (response.body) {
          const clone = response.clone();
          const reader = clone.body.getReader();
          const decoder = new TextDecoder();
          let fullText = '';

          (async () => {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                fullText += decoder.decode(value, { stream: true });
              }

              // 解析並發送響應
              const parsedResponse = config.parseResponse(fullText);

              console.log(`[${config.id}] Response received:`, parsedResponse.substring(0, 100) + '...');

              sendMessageToPopup({
                type: 'AI_NETWORK_RESPONSE_RECEIVED',
                platform: config.id,
                response: parsedResponse
              });
            } catch (error) {
              console.error(`[${config.id}] Stream reading error:`, error);
              sendMessageToPopup({
                type: 'AI_ERROR',
                platform: config.id,
                message: '❌ 響應流讀取失敗: ' + error.message
              });
            }
          })();
        }

        return response;
      }

      return origFetch.apply(this, args);
    };

    console.log(`[${config.id}] Fetch monitor initialized`);
  },

  /**
   * 設置 XHR 攔截監聽（用於 Gemini）
   */
  setupXHRMonitor(config) {
    if (window.__xhrMonitorInitialized) {
      console.log(`[${config.id}] XHR monitor already initialized`);
      return;
    }
    window.__xhrMonitorInitialized = true;

    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
      this._url = url;
      this._method = method;
      return origOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function(body) {
      const xhr = this;
      const url = this._url || '';

      if (url.includes(config.responseApiPattern)) {
        console.log(`[${config.id}] Detected target XHR:`, url);

        // Network events are only diagnostics; DOM watcher owns AI_RESPONSE_START/RECEIVED.
        sendMessageToPopup({
          type: 'AI_NETWORK_RESPONSE_START',
          platform: config.id
        });

        xhr.addEventListener('load', function() {
          try {
            const rawText = xhr.responseText;

            // 解析並發送響應
            const parsedResponse = config.parseResponse(rawText);

            console.log(`[${config.id}] Response received:`, parsedResponse.substring(0, 100) + '...');

            sendMessageToPopup({
              type: 'AI_NETWORK_RESPONSE_RECEIVED',
              platform: config.id,
              response: parsedResponse
            });
          } catch (error) {
            console.error(`[${config.id}] Response parsing error:`, error);
            sendMessageToPopup({
              type: 'AI_ERROR',
              platform: config.id,
              message: '❌ 響應解析失敗: ' + error.message
            });
          }
        });
      }

      return origSend.apply(this, arguments);
    };

    console.log(`[${config.id}] XHR monitor initialized`);
  },

  /**
   * 監聽 URL 變化並回報
   */
  setupUrlMonitor(config) {
    if (window.__urlMonitorInitialized) return;
    window.__urlMonitorInitialized = true;

    let lastUrl = location.href;

    const reportUrlChange = () => {
      const currentUrl = location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        console.log(`[${config.id}] URL changed to:`, currentUrl);
        sendMessageToPopup({
          type: 'AI_URL_CHANGED',
          platform: config.id,
          url: currentUrl
        });
      }
    };

    // 1. 攔截 History API
    const origPushState = history.pushState;
    const origReplaceState = history.replaceState;

    history.pushState = function(...args) {
      const result = origPushState.apply(this, args);
      reportUrlChange();
      return result;
    };

    history.replaceState = function(...args) {
      const result = origReplaceState.apply(this, args);
      reportUrlChange();
      return result;
    };

    // 2. 監聽瀏覽器導航事件
    window.addEventListener('popstate', reportUrlChange);
    window.addEventListener('hashchange', reportUrlChange);

    // 3. 定時檢查（處理某些框架的邊緣情況）
    setInterval(reportUrlChange, 1000);

    console.log(`[${config.id}] URL monitor initialized`);
  },

  /**
   * 提交問題（帶重試機制）
   */
  async scrapeHistory(config, timeoutMs = 7000) {
    const start = Date.now();
    let lastHistory = [];

    while (Date.now() - start < timeoutMs) {
      try {
        lastHistory = config.scrapeHistory ? config.scrapeHistory() : [];
        if (Array.isArray(lastHistory) && lastHistory.length > 0) {
          return lastHistory;
        }
      } catch (error) {
        console.error(`[${config.id}] History scrape error:`, error);
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return Array.isArray(lastHistory) ? lastHistory : [];
  },

  isGenerating(config) {
    try {
      if (config.detectGenerating) {
        return !!config.detectGenerating();
      }
    } catch (error) {
      console.error(`[${config.id}] Generation detection error:`, error);
    }

    const stopSelectors = [
      'button[data-testid="stop-button"]',
      'button[aria-label*="Stop"]',
      'button[aria-label*="stop"]',
      'button[aria-label*="停止"]',
      'button[aria-label*="停止生成"]'
    ];
    if (document.querySelector(stopSelectors.join(','))) {
      return true;
    }

    return Array.from(document.querySelectorAll('button')).some(function(button) {
      const text = (button.innerText || button.textContent || '').trim().toLowerCase();
      return text === 'stop' || text === '停止' || text === '停止生成';
    });
  },

  normalizeLifecycleText(text) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  },

  isLikelyPlanningOnlyAnswer(text) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    if (!value || value.length > 620) return false;

    const startsLikePlanning = /^(i['’]ll|i will|let me|i’m going to|i am going to|我(?:先|會|來|要|幫你|可以先)|讓我|先(?:查|看|分析|整理|確認)|以下(?:我會|先)|好的[,，]?\s*我)/i.test(value);
    const containsPlanningAction = /(break|verify|check|look up|research|judge|analy[sz]e|compare|separate|before|查詢|查證|查看|搜尋|搜索|研究|分析|整理|確認|比較|拆解|判斷|評估|找資料|先看|網頁|來源)/i.test(value);
    const hasSubstantialStructure = /(\n|#{1,6}\s|^[-*•]\s|\d+[.)、]\s|[。！？.!?].+[。！？.!?].+[。！？.!?])/m.test(String(text || '').trim());

    return startsLikePlanning && containsPlanningAction && !hasSubstantialStructure;
  },

  findAnswerAfterQuestion(history, question) {
    const target = this.normalizeLifecycleText(question);
    if (!target || !Array.isArray(history)) {
      return { questionIndex: -1, answer: null };
    }

    let questionIndex = -1;
    for (let i = history.length - 1; i >= 0; i--) {
      const message = history[i];
      if (!message || message.role !== 'user') continue;

      const content = this.normalizeLifecycleText(message.content);
      if (content === target || content.includes(target) || target.includes(content)) {
        questionIndex = i;
        break;
      }
    }

    if (questionIndex < 0) return { questionIndex: -1, answer: null };

    let answer = null;
    for (let i = history.length - 1; i > questionIndex; i--) {
      const message = history[i];
      if (message && message.role === 'assistant' && String(message.content || '').trim()) {
        answer = message;
        break;
      }
    }

    return { questionIndex, answer };
  },

  watchResponseLifecycle(config, question, options = {}) {
    const pollMs = options.pollMs || 700;
    const timeoutMs = options.timeoutMs || 180000;
    const stablePollsRequired = options.stablePollsRequired || 2;

    window.__aiResponseLifecycleWatchers = window.__aiResponseLifecycleWatchers || {};
    if (window.__aiResponseLifecycleWatchers[config.id]) {
      clearInterval(window.__aiResponseLifecycleWatchers[config.id]);
    }

    const startedAt = Date.now();
    let hasStarted = false;
    let lastAnswerText = '';
    let stableCount = 0;

    const finish = (timer) => {
      clearInterval(timer);
      if (window.__aiResponseLifecycleWatchers) {
        delete window.__aiResponseLifecycleWatchers[config.id];
      }
    };

    const timer = setInterval(() => {
      let history = [];
      let generating = false;

      try {
        history = config.scrapeHistory ? config.scrapeHistory() : [];
        generating = this.isGenerating(config);
      } catch (error) {
        console.error(`[${config.id}] Response lifecycle watch error:`, error);
      }

      const result = this.findAnswerAfterQuestion(history, question);
      const answerText = result.answer ? String(result.answer.content || '').trim() : '';
      const hasFinalAnswerText = !!answerText && !this.isLikelyPlanningOnlyAnswer(answerText);

      if (!hasStarted && (generating || result.questionIndex >= 0 || answerText)) {
        hasStarted = true;
        sendMessageToPopup({
          type: 'AI_RESPONSE_START',
          platform: config.id,
          history,
          isGenerating: generating
        });
      }

      if (hasFinalAnswerText) {
        if (answerText === lastAnswerText) {
          stableCount++;
        } else {
          lastAnswerText = answerText;
          stableCount = 0;
        }
      } else if (answerText) {
        lastAnswerText = answerText;
        stableCount = 0;
      }

      if (hasFinalAnswerText && !generating && stableCount >= stablePollsRequired) {
        sendMessageToPopup({
          type: 'AI_RESPONSE_RECEIVED',
          platform: config.id,
          response: answerText,
          history,
          isGenerating: false
        });
        finish(timer);
        return;
      }

      if (Date.now() - startedAt > timeoutMs) {
        sendMessageToPopup({
          type: 'AI_ERROR',
          platform: config.id,
          message: '等待回覆完成逾時'
        });
        finish(timer);
      }
    }, pollMs);

    window.__aiResponseLifecycleWatchers[config.id] = timer;
  },

  /**
   * 提交問題（帶重試機制）
   */
  async submitQuestion(config, question) {
    console.log(`[${config.id}] Submitting question:`, question);

    const maxRetries = 30;
    let retryCount = 0;

    // Step 1: 等待 textarea
    while (retryCount < maxRetries) {
      try {
        const textareaFound = config.detectTextarea();
        if (textareaFound) {
          console.log(`[${config.id}] Textarea found`);
          break;
        }
      } catch (error) {
        console.error(`[${config.id}] Textarea detection error:`, error);
      }

      if (retryCount === 0) {
        sendMessageToPopup({
          type: 'AI_INFO',
          platform: config.id,
          message: chrome.i18n.getMessage('infoWaitingTextarea') || '等待 textarea 準備好...'
        });
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
      retryCount++;
    }

    if (retryCount >= maxRetries) {
      sendMessageToPopup({
        type: 'AI_ERROR',
        platform: config.id,
        message: chrome.i18n.getMessage('errorTextareaNotFound') || '❌ Textarea 未找到（超時）'
      });
      return;
    }

    // Step 2: 填入問題
    try {
      const fillSuccess = config.fillQuestion(question);

      if (!fillSuccess) {
        sendMessageToPopup({
          type: 'AI_ERROR',
          platform: config.id,
          message: chrome.i18n.getMessage('errorFillFailed') || '❌ 填充問題失敗'
        });
        return;
      }

      console.log(`[${config.id}] Question filled successfully`);
    } catch (error) {
      console.error(`[${config.id}] Fill question error:`, error);
      sendMessageToPopup({
        type: 'AI_ERROR',
        platform: config.id,
        message: (chrome.i18n.getMessage('errorFillFailed') || '❌ 填充問題異常') + ': ' + error.message
      });
      return;
    }

    // Step 2.5: 驗證內容是否真的被覆蓋（等待最多 5 秒）
    let verifyRetries = 0;
    const maxVerifyRetries = 5;
    let contentVerified = false;

    // 輔助函數：規範化文本以便比較（處理換行符、多餘空格等）
    function normalizeText(text) {
      return text
        .trim()
        .replace(/\r\n/g, '\n')  // 統一換行符
        .replace(/\n+/g, ' ')     // 將換行符轉為空格（因為 contenteditable 會這樣做）
        .replace(/\s+/g, ' ')     // 將多個空格合併為一個
        .trim();
    }

    // 輔助函數：找出兩個字串的差異位置
    function findDifference(str1, str2) {
      const maxLen = Math.max(str1.length, str2.length);
      for (let i = 0; i < maxLen; i++) {
        if (str1[i] !== str2[i]) {
          const start = Math.max(0, i - 20);
          const end = Math.min(maxLen, i + 20);
          return {
            position: i,
            context: {
              expected: str1.substring(start, end),
              actual: str2.substring(start, end),
              char_expected: str1[i] ? `'${str1[i]}' (U+${str1.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')})` : 'EOF',
              char_actual: str2[i] ? `'${str2[i]}' (U+${str2.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')})` : 'EOF'
            }
          };
        }
      }
      return null;
    }

    while (verifyRetries < maxVerifyRetries) {
      try {
        // 等待一小段時間讓 DOM 更新
        await new Promise(resolve => setTimeout(resolve, 200));

        const currentContent = config.getContent ? config.getContent() : '';
        const normalizedQuestion = normalizeText(question);
        const normalizedContent = normalizeText(currentContent);

        console.log(`[${config.id}] Verify attempt ${verifyRetries + 1}:`);
        console.log(`  Expected (${normalizedQuestion.length} chars): "${normalizedQuestion.substring(0, 80)}..."`);
        console.log(`  Actual   (${normalizedContent.length} chars): "${normalizedContent.substring(0, 80)}..."`);

        if (normalizedContent === normalizedQuestion) {
          console.log(`[${config.id}] ✅ Content verified successfully`);
          contentVerified = true;
          break;
        } else {
          // 顯示詳細差異
          const diff = findDifference(normalizedQuestion, normalizedContent);
          if (diff) {
            console.log(`[${config.id}] ❌ Difference at position ${diff.position}:`);
            console.log(`  Expected: "${diff.context.expected}"`);
            console.log(`  Actual:   "${diff.context.actual}"`);
            console.log(`  Char diff: ${diff.context.char_expected} vs ${diff.context.char_actual}`);
          }
        }

        verifyRetries++;
      } catch (error) {
        console.error(`[${config.id}] Content verification error:`, error);
        verifyRetries++;
      }
    }

    if (!contentVerified) {
      sendMessageToPopup({
        type: 'AI_ERROR',
        platform: config.id,
        message: chrome.i18n.getMessage('errorVerifyFailed') || '❌ 內容覆蓋驗證失敗，文字未正確填入'
      });
      return;
    }

    // Step 3: 立即檢測並點擊按鈕（不等待固定時間）
    retryCount = 0;
    let hasShownWaitingMessage = false;

    while (retryCount < maxRetries) {
      try {
        const buttonFound = config.detectButton();
        if (!buttonFound) {
          if (!hasShownWaitingMessage) {
            sendMessageToPopup({
              type: 'AI_INFO',
              platform: config.id,
              message: chrome.i18n.getMessage('infoWaitingButton') || '等待發送按鈕準備好...'
            });
            hasShownWaitingMessage = true;
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
          retryCount++;
          continue;
        }

        // 按鈕找到，嘗試點擊
        const clickSuccess = config.clickButton();
        if (clickSuccess) {
          console.log(`[${config.id}] Button clicked successfully`);
          sendMessageToPopup({
            type: 'AI_QUESTION_SENT',
            platform: config.id
          });
          this.watchResponseLifecycle(config, question);
          return;
        }

        // 按鈕存在但點擊失敗（可能被禁用），等待 1 秒後重試
        if (!hasShownWaitingMessage) {
          sendMessageToPopup({
            type: 'AI_INFO',
            platform: config.id,
            message: chrome.i18n.getMessage('infoWaitingButtonEnabled') || '等待按鈕啟用...'
          });
          hasShownWaitingMessage = true;
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
        retryCount++;
      } catch (error) {
        console.error(`[${config.id}] Button click error:`, error);
        await new Promise(resolve => setTimeout(resolve, 1000));
        retryCount++;
      }
    }

    sendMessageToPopup({
      type: 'AI_ERROR',
      platform: config.id,
      message: chrome.i18n.getMessage('errorButtonClickFailed') || '❌ 按鈕點擊失敗（超時）'
    });
  }
};

// Export to global scope
window.InjectionCore = InjectionCore;

console.log('[AI Multi-Chat] Injection core loaded');
