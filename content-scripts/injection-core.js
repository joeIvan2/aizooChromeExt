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
                type: 'AI_NETWORK_DIAGNOSTIC_ERROR',
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
              type: 'AI_NETWORK_DIAGNOSTIC_ERROR',
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

  // 平台自己標記的「已完成」訊號（例如 ChatGPT 的 turn-state、Meta 的 streaming-state）。
  // 沒有提供時回傳 false，改由「文字穩定 + 安靜期」判定。
  isResponseComplete(config) {
    try {
      return !!(config.detectResponseComplete && config.detectResponseComplete());
    } catch (error) {
      console.error(`[${config.id}] Completion detection error:`, error);
      return false;
    }
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
    return window.AIZooUtils.normalizeMatchText(text);
  },

  isLikelyPlanningOnlyAnswer(text) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    if (!value || value.length > 620) return false;

    const startsLikePlanning = /^(i['’]ll|i will|let me|i’m going to|i am going to|我(?:先|會|來|要|幫你|可以先)|讓我|先(?:查|看|分析|整理|確認)|以下(?:我會|先)|好的[,，]?\s*我)/i.test(value);
    const containsPlanningAction = /(break|verify|check|look up|research|judge|analy[sz]e|compare|separate|before|查詢|查證|查看|搜尋|搜索|研究|分析|整理|確認|比較|拆解|判斷|評估|找資料|先看|網頁|來源)/i.test(value);
    const hasSubstantialStructure = /(\n|#{1,6}\s|^[-*•]\s|\d+[.)、]\s|[。！？.!?].+[。！？.!?].+[。！？.!?])/m.test(String(text || '').trim());

    return startsLikePlanning && containsPlanningAction && !hasSubstantialStructure;
  },

  findAnswerAfterQuestion(history, question, baselineOccurrences = 0) {
    return window.AIZooUtils.findAnswerAfterQuestion(history, question, baselineOccurrences);
  },

  getOperationEpoch(platform) {
    window.__aiOperationEpochs = window.__aiOperationEpochs || {};
    return window.__aiOperationEpochs[platform] || 0;
  },

  isOperationCurrent(platform, epoch) {
    return this.getOperationEpoch(platform) === epoch;
  },

  stopResponseLifecycleWatcher(platform) {
    const watcher = window.__aiResponseLifecycleWatchers?.[platform];
    if (!watcher) return;
    if (watcher.timer) clearInterval(watcher.timer);
    watcher.observer?.disconnect();
    delete window.__aiResponseLifecycleWatchers[platform];
  },

  cancelOperations(config) {
    const platform = typeof config === 'string' ? config : config.id;
    window.__aiOperationEpochs = window.__aiOperationEpochs || {};
    window.__aiOperationEpochs[platform] = this.getOperationEpoch(platform) + 1;
    this.stopResponseLifecycleWatcher(platform);
    console.log(`[${platform}] Pending operations cancelled`);
  },

  async waitForPreviousLifecycleCompletion(config, epoch) {
    while (this.isOperationCurrent(config.id, epoch)) {
      const watcher = window.__aiResponseLifecycleWatchers?.[config.id];
      if (!watcher || watcher.completedNotified) return true;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    return false;
  },

  enqueueQuestion(config, question, options = {}) {
    window.__aiSubmitQueues = window.__aiSubmitQueues || {};
    const core = this;
    const epoch = this.getOperationEpoch(config.id);
    const previous = window.__aiSubmitQueues[config.id] || Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      if (!core.isOperationCurrent(config.id, epoch)) return false;
      const previousFinished = await core.waitForPreviousLifecycleCompletion(config, epoch);
      if (!previousFinished) return false;
      return core.submitQuestion(config, question, { ...options, epoch });
    });

    window.__aiSubmitQueues[config.id] = task.catch((error) => {
      console.error(`[${config.id}] Queued submission failed:`, error);
      return false;
    });
    return task;
  },

  watchResponseLifecycle(config, question, options = {}) {
    const pollMs = options.pollMs || 1000;
    const stablePollsRequired = options.stablePollsRequired || config.responseStablePollsRequired || 2;
    const quietPeriodMs = options.quietPeriodMs ?? config.responseQuietPeriodMs ?? 0;
    const submissionId = options.submissionId;
    const operationEpoch = options.epoch ?? this.getOperationEpoch(config.id);
    const baselineOccurrences = Math.max(0, Number(options.baselineOccurrences) || 0);

    window.__aiResponseLifecycleWatchers = window.__aiResponseLifecycleWatchers || {};
    this.stopResponseLifecycleWatcher(config.id);

    const startedAt = Date.now();
    let hasStarted = false;
    let lastAnswerText = '';
    let lastAnswerChangedAt = startedAt;
    let lastActivityAt = startedAt;
    let stableCount = 0;
    let completedNotified = false;
    let lastGenerating = null;
    const watcher = {
      timer: null,
      observer: null,
      submissionId,
      operationEpoch,
      baselineOccurrences,
      completedNotified: false,
      lastActivityAt
    };

    const checkResponse = (countStablePoll = true) => {
      if (window.__aiResponseLifecycleWatchers[config.id] !== watcher || watcher.completedNotified) return;
      if (!this.isOperationCurrent(config.id, operationEpoch)) {
        this.stopResponseLifecycleWatcher(config.id);
        return;
      }

      let history = [];
      let generating = false;

      try {
        history = config.scrapeHistory ? config.scrapeHistory() : [];
        generating = this.isGenerating(config);
      } catch (error) {
        console.error(`[${config.id}] Response lifecycle watch error:`, error);
      }

      const result = this.findAnswerAfterQuestion(history, question, baselineOccurrences);
      const answerText = result.answer ? String(result.answer.content || '').trim() : '';
      const hasFinalAnswerText = !!answerText && !this.isLikelyPlanningOnlyAnswer(answerText);
      const answerChanged = answerText !== lastAnswerText;
      const explicitComplete = hasFinalAnswerText && !generating && this.isResponseComplete(config);

      if (!hasStarted && (generating || result.questionIndex >= 0 || answerText)) {
        hasStarted = true;
        sendMessageToPopup({
          type: 'AI_RESPONSE_START',
          platform: config.id,
          submissionId,
          baselineOccurrences,
          history,
          isGenerating: generating,
          isComplete: explicitComplete
        });
      } else if (hasStarted && (answerChanged || generating !== lastGenerating)) {
        // Push visible text without waiting for the completion quiet period or
        // for the popup's next history request (which can be throttled).
        sendMessageToPopup({
          type: 'AI_RESPONSE_UPDATE',
          platform: config.id,
          submissionId,
          baselineOccurrences,
          history,
          isGenerating: generating,
          isComplete: explicitComplete
        });
      }
      lastGenerating = generating;

      if (completedNotified && (generating || answerChanged)) {
        completedNotified = false;
        watcher.completedNotified = false;
        stableCount = 0;
        sendMessageToPopup({
          type: 'AI_RESPONSE_START',
          platform: config.id,
          submissionId,
          baselineOccurrences,
          history,
          isGenerating: generating,
          isComplete: explicitComplete,
          resumed: true
        });
      }

      if (hasFinalAnswerText) {
        if (!answerChanged && !generating) {
          if (countStablePoll) stableCount++;
        } else {
          if (answerChanged) {
            lastAnswerText = answerText;
            lastAnswerChangedAt = Date.now();
            lastActivityAt = lastAnswerChangedAt;
            watcher.lastActivityAt = lastActivityAt;
          }
          stableCount = 0;
        }
      } else if (answerText) {
        if (answerText !== lastAnswerText) {
          lastAnswerText = answerText;
          lastAnswerChangedAt = Date.now();
          lastActivityAt = lastAnswerChangedAt;
          watcher.lastActivityAt = lastActivityAt;
        }
        stableCount = 0;
      }

      const isQuiet = Date.now() - lastAnswerChangedAt >= quietPeriodMs;
      // 平台明確標記完成時，只需再確認一次文字沒變就結束，不必等安靜期。
      const confirmedByPlatform = explicitComplete && stableCount >= 1;
      if (!completedNotified && hasFinalAnswerText && !generating &&
          (confirmedByPlatform || (stableCount >= stablePollsRequired && isQuiet))) {
        completedNotified = true;
        watcher.completedNotified = true;
        sendMessageToPopup({
          type: 'AI_RESPONSE_RECEIVED',
          platform: config.id,
          submissionId,
          baselineOccurrences,
          response: answerText,
          history,
          isGenerating: false,
          isComplete: explicitComplete
        });
        // The popup keeps a low-frequency recheck alive while Smart Compare is
        // open. Stop this fast DOM scan once the turn has settled.
        clearInterval(timer);
        watcher.timer = null;
        watcher.observer?.disconnect();
      }
    };

    const timer = setInterval(checkResponse, pollMs);
    watcher.timer = timer;
    window.__aiResponseLifecycleWatchers[config.id] = watcher;
    if (config.responseObserveMutations && typeof MutationObserver !== 'undefined' && document.body) {
      // DOM changes run even when Chrome delays interval timers in a hidden tab.
      // They publish text immediately but do not count as stable polling samples.
      watcher.observer = new MutationObserver(() => checkResponse(false));
      watcher.observer.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: [
          'aria-busy', 'aria-label', 'data-message-streaming', 'data-is-streaming',
          'data-chatgpt-search-unit-key', 'data-content-search-unit-key',
          'data-markdown-text-style'
        ]
      });
    }
  },

  /**
   * 提交問題（帶重試機制）
   */
  async submitQuestion(config, question, options = {}) {
    console.log(`[${config.id}] Submitting question:`, question);
    const submissionId = options.submissionId;
    const operationEpoch = options.epoch ?? this.getOperationEpoch(config.id);
    const emit = (data) => sendMessageToPopup({
      ...data,
      platform: config.id,
      submissionId
    });
    let retryCount = 0;

    // Step 1: 等待 textarea
    while (this.isOperationCurrent(config.id, operationEpoch)) {
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
        emit({
          type: 'AI_INFO',
          message: chrome.i18n.getMessage('infoWaitingTextarea') || '等待 textarea 準備好...'
        });
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
      retryCount++;
    }

    if (!this.isOperationCurrent(config.id, operationEpoch)) return false;

    let historyBeforeSubmit = [];
    try {
      historyBeforeSubmit = config.scrapeHistory ? config.scrapeHistory() : [];
    } catch (error) {
      console.warn(`[${config.id}] Could not capture the pre-send turn boundary:`, error);
    }
    const baselineOccurrences = window.AIZooUtils.countExactUserQuestions(historyBeforeSubmit, question);

    // Step 2: 填入問題
    try {
      const fillSuccess = config.fillQuestion(question);

      if (!fillSuccess) {
        emit({
          type: 'AI_ERROR',
          message: chrome.i18n.getMessage('errorFillFailed') || '❌ 填充問題失敗'
        });
        return false;
      }

      console.log(`[${config.id}] Question filled successfully`);
    } catch (error) {
      console.error(`[${config.id}] Fill question error:`, error);
      emit({
        type: 'AI_ERROR',
        message: (chrome.i18n.getMessage('errorFillFailed') || '❌ 填充問題異常') + ': ' + error.message
      });
      return false;
    }

    // Step 2.5: 驗證內容是否真的被覆蓋。Dynamic editors can
    // settle slowly for long prompts, so keep checking until the operation is
    // explicitly cancelled instead of converting a slow render into failure.
    let verifyRetries = 0;
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

    while (this.isOperationCurrent(config.id, operationEpoch)) {
      try {
        // 等待一小段時間讓 DOM 更新
        await new Promise(resolve => setTimeout(resolve, 200));

        const currentContent = config.getContent ? config.getContent() : '';
        const normalizedQuestion = normalizeText(question);
        const normalizedContent = normalizeText(currentContent);

        const shouldLogAttempt = verifyRetries === 0 || (verifyRetries + 1) % 10 === 0;
        if (shouldLogAttempt) {
          console.log(`[${config.id}] Verify attempt ${verifyRetries + 1}:`);
          console.log(`  Expected (${normalizedQuestion.length} chars): "${normalizedQuestion.substring(0, 80)}..."`);
          console.log(`  Actual   (${normalizedContent.length} chars): "${normalizedContent.substring(0, 80)}..."`);
        }

        if (normalizedContent === normalizedQuestion) {
          console.log(`[${config.id}] ✅ Content verified successfully`);
          contentVerified = true;
          break;
        } else {
          // 顯示詳細差異
          const diff = findDifference(normalizedQuestion, normalizedContent);
          if (diff && shouldLogAttempt) {
            console.log(`[${config.id}] ❌ Difference at position ${diff.position}:`);
            console.log(`  Expected: "${diff.context.expected}"`);
            console.log(`  Actual:   "${diff.context.actual}"`);
            console.log(`  Char diff: ${diff.context.char_expected} vs ${diff.context.char_actual}`);
          }
        }

        verifyRetries++;
        if (verifyRetries % 25 === 0 && this.isOperationCurrent(config.id, operationEpoch)) {
          // Some controlled editors replace their node while reconciling. Refill
          // occasionally so the verified value remains the user's full prompt.
          config.fillQuestion(question);
        }
      } catch (error) {
        console.error(`[${config.id}] Content verification error:`, error);
        verifyRetries++;
      }
    }

    if (!contentVerified) return false;

    // Step 3: 立即檢測並點擊按鈕（不等待固定時間）
    retryCount = 0;
    let hasShownWaitingMessage = false;

    while (this.isOperationCurrent(config.id, operationEpoch)) {
      try {
        const buttonFound = config.detectButton();
        if (!buttonFound) {
          if (!hasShownWaitingMessage) {
            emit({
              type: 'AI_INFO',
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
          emit({
            type: 'AI_QUESTION_SENT',
            baselineOccurrences
          });
          this.watchResponseLifecycle(config, question, {
            submissionId,
            epoch: operationEpoch,
            baselineOccurrences
          });
          return true;
        }

        // 按鈕存在但點擊失敗（可能被禁用），等待 1 秒後重試
        if (!hasShownWaitingMessage) {
          emit({
            type: 'AI_INFO',
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

    return false;
  }
};

// Export to global scope
window.InjectionCore = InjectionCore;

console.log('[AI Multi-Chat] Injection core loaded');
