// platforms-config.js - 平台配置（從 platformConfig.ts 轉換）

/**
 * Standard Android Chrome User Agent to avoid "disallowed_useragent" errors
 */
const ANDROID_USER_AGENT = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36';

function cleanScrapedHistoryText(text) {
  if (!text) return '';

  var rawText = String(text)
    .replace(/\u00a0/g, ' ')
    .replace(/(?:Thought for|思考了)\s*\d+\s*(?:s|sec|secs|seconds|秒)?/gi, '\n')
    .replace(/^\s*(?:Thinking|思考中|正在思考)\s*$/gim, '')
    .replace(/^\s*(?:(?:Thinking|思考中|正在思考)\s*)+/i, '');

  var blockedLines = [
    'Copy', 'Copy response', 'Copy message', 'Copy table', 'Edit', 'Edit message',
    'Retry', 'Regenerate', 'Share', 'Sources', 'More actions', 'Response actions',
    'Good response', 'Bad response', 'Switch model', 'Start dictation', 'Start Voice',
    '複製', '編輯', '重做', '分享及匯出', '答得好', '有待加強', '更多選項',
    '建立分享連結', '讚', '踩', '顯示更多選項', '複製提示詞'
  ];

  var lines = rawText
    .split('\n')
    .map(function(line) { return line.trim(); })
    .filter(function(line) {
      if (!line) return false;
      if (blockedLines.indexOf(line) !== -1) return false;
      if (/^(Thinking|思考中|正在思考)$/i.test(line)) return false;
      if (/^Thought process$/i.test(line)) return false;
      if (/^(Thought for|思考了)\s*\d+/i.test(line)) return false;
      if (/^\d+\s+sources$/i.test(line)) return false;
      if (/^清晨\d+:\d+$/.test(line)) return false;
      return true;
    });

  if (lines.length > 2 && lines[0] === lines[1] && lines[0].length <= 80) {
    lines.splice(0, 2);
  }

  return lines.join('\n')
    .replace(/^你說了\s*/i, '')
    .replace(/^Gemini 說了\s*/i, '')
    .replace(/^You said:\s*/i, '')
    .replace(/^Claude responded:\s*/i, '')
    .trim();
}

function normalizeScrapedHistory(messages) {
  var normalized = [];
  (messages || []).forEach(function(message) {
    var content = cleanScrapedHistoryText(message && message.content);
    if (!content) return;

    var previous = normalized[normalized.length - 1];
    if (previous && previous.role === message.role && previous.content === content) return;

    normalized.push({
      role: message.role === 'user' ? 'user' : 'assistant',
      content: content
    });
  });
  return normalized;
}

function textUntilNextConversationHeading(heading) {
  var chunks = [];
  var node = heading.nextElementSibling;

  while (node) {
    if (node.matches && node.matches('h1, h2')) {
      var headingText = (node.innerText || node.textContent || '').trim();
      if (/^(You said:|Claude responded:|你說了|Gemini 說了)/i.test(headingText)) break;
    }

    if (node.querySelector && node.querySelector('textarea, [contenteditable="true"], form')) break;

    var text = node.innerText || node.textContent || '';
    text = cleanScrapedHistoryText(text);
    if (text) chunks.push(text);
    node = node.nextElementSibling;
  }

  return chunks.join('\n\n').trim();
}

function isElementAfter(anchor, element) {
  if (!anchor || !element || anchor === element) return false;
  return !!(anchor.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function getNormalizedTextKey(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function findLatestClaudeUserElement() {
  var users = Array.from(document.querySelectorAll(
    'div[data-testid="user-message"], .font-user-message, [class*="font-user-message"]'
  )).filter(function(element) {
    return !element.closest('nav, aside, header, footer, button, [contenteditable="true"], textarea, input');
  });
  return users[users.length - 1] || null;
}

function appendLatestClaudeStreamingMessage(messages, latestUserElement) {
  if (!Array.isArray(messages) || messages.length === 0) return messages || [];
  if (messages[messages.length - 1].role !== 'user') return messages;

  var streamingText = findLatestClaudeStreamingText(latestUserElement || findLatestClaudeUserElement(), messages);
  if (streamingText) {
    messages.push({
      role: 'assistant',
      content: streamingText
    });
  }

  return messages;
}

function findLatestClaudeStreamingText(anchorElement, knownMessages) {
  if (!anchorElement) return '';

  var latestUserText = cleanScrapedHistoryText(anchorElement.innerText || anchorElement.textContent || '');
  var latestUserKey = getNormalizedTextKey(latestUserText);
  var knownAssistantKeys = {};

  (knownMessages || []).forEach(function(message) {
    if (!message || message.role !== 'assistant') return;
    knownAssistantKeys[getNormalizedTextKey(message.content)] = true;
  });

  var selectors = [
    'div[data-testid="claude-message"]',
    'div[data-testid="assistant-message"]',
    '[data-testid*="assistant"]',
    '[data-testid*="response"]',
    '[data-is-streaming="true"]',
    '[aria-live="polite"]',
    '.font-claude-message',
    '[class*="font-claude-message"]',
    '.prose',
    '[class*="prose"]'
  ];

  var candidates = Array.from(document.querySelectorAll(selectors.join(',')));
  var bestText = '';

  candidates.forEach(function(element) {
    var isAssistantContainer = element.matches && element.matches(
      'div[data-testid="claude-message"], div[data-testid="assistant-message"], [data-testid*="assistant"], [data-testid*="response"], [data-is-streaming="true"], .font-claude-message, [class*="font-claude-message"]'
    );
    if (!isElementAfter(anchorElement, element) && !(isAssistantContainer && element.closest('main'))) return;
    if (element.closest('nav, aside, header, footer')) return;
    if (element.matches && element.matches('button, textarea, input, [contenteditable="true"]')) return;
    if (element.closest('div[data-testid="user-message"], .font-user-message, [class*="font-user-message"]')) return;
    if (element.getAttribute('role') === 'status') return;
    if (element.getAttribute('aria-live')) return;
    if (element.classList && element.classList.contains('sr-only')) return;

    if (!isAssistantContainer && element.closest('button, [contenteditable="true"], textarea, input')) return;

    var textSource = isAssistantContainer ? element : (
      element.querySelector('[data-testid="message-content"], .font-claude-message, [class*="font-claude-message"], .prose, [class*="prose"]') || element
    );
    if (textSource.getAttribute && textSource.getAttribute('role') === 'status') return;
    if (textSource.getAttribute && textSource.getAttribute('aria-live')) return;
    if (textSource.classList && textSource.classList.contains('sr-only')) return;

    var text = cleanScrapedHistoryText(textSource.innerText || textSource.textContent || '');
    var key = getNormalizedTextKey(text);

    if (!key) return;
    if (latestUserKey && (key === latestUserKey || key.indexOf(latestUserKey) !== -1)) return;
    if (knownAssistantKeys[key]) return;
    if (/^(Claude can make mistakes|Claude is generating|Use shift|Press enter)/i.test(text)) return;

    if (text.length > bestText.length) {
      bestText = text;
    }
  });

  if (bestText) return bestText;

  var broadCandidates = Array.from(document.querySelectorAll('main div, main section, main p, main li, main pre, main code, [role="presentation"] div'));
  broadCandidates.forEach(function(element) {
    if (!isElementAfter(anchorElement, element)) return;
    if (element.closest('nav, aside, header, footer, button, [contenteditable="true"], textarea, input')) return;
    if (element.closest('div[data-testid="user-message"], .font-user-message, [class*="font-user-message"]')) return;
    if (element.getAttribute('role') === 'status') return;
    if (element.getAttribute('aria-live')) return;
    if (element.classList && element.classList.contains('sr-only')) return;

    var style = window.getComputedStyle ? window.getComputedStyle(element) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return;

    var childBlocks = Array.from(element.children || []).filter(function(child) {
      var childText = cleanScrapedHistoryText(child.innerText || child.textContent || '');
      return childText && childText.length > 30;
    });
    if (childBlocks.length > 2) return;

    var text = cleanScrapedHistoryText(element.innerText || element.textContent || '');
    var key = getNormalizedTextKey(text);

    if (!key || text.length < 8) return;
    if (latestUserKey && (key === latestUserKey || key.indexOf(latestUserKey) !== -1)) return;
    if (knownAssistantKeys[key]) return;
    if (/^(Claude can make mistakes|Claude is generating|Use shift|Press enter|识别|匯總|汇总|整合|分析師|綜合多方)/i.test(text)) return;

    if (text.length > bestText.length) {
      bestText = text;
    }
  });

  return bestText;
}

const PLATFORM_CONFIGS = {
  grok: {
    id: 'grok',
    name: 'Grok',
    color: '#e74c3c',
    url: 'https://grok.com/',
    // userAgent: ANDROID_USER_AGENT,
    detectTextarea: function() {
      return !!document.querySelector('.tiptap[contenteditable="true"]');
    },
    detectButton: function() {
      // 1. 檢測是否正在生成（顯示停止按鈕）
      // 匹配英文 "Stop" 和中文 "停止"
      const stopBtn = document.querySelector('button[aria-label*="Stop"], button[aria-label*="stop"], button[aria-label*="停止"]');
      if (stopBtn) return false;

      // 2. 檢測提交按鈕是否可用
      // 匹配英文 "Send", "Submit" 和中文 "提交", "發送" 以及 type="submit"
      const submitBtn = document.querySelector('button[aria-label*="Send"], button[aria-label*="send"], button[aria-label*="提交"], button[aria-label*="發送"], button[type="submit"]');

      if (submitBtn && !submitBtn.disabled) {
        return true;
      }

      return false;
    },
    detectGenerating: function() {
      return !!document.querySelector('button[aria-label*="Stop"], button[aria-label*="stop"], button[aria-label*="停止"]');
    },
    getContent: function() {
      var editor = document.querySelector('.tiptap[contenteditable="true"]');
      if (!editor) return '';
      return editor.textContent || '';
    },
    fillQuestion: function(q) {
      var editor = document.querySelector('.tiptap[contenteditable="true"]');
      if (!editor) return false;
      editor.focus();
      editor.textContent = q;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    },
    clickButton: function() {
      // 嘗試點擊有效的提交按鈕
      const submitBtn = document.querySelector('button[aria-label*="Send"], button[aria-label*="send"], button[aria-label*="提交"], button[aria-label*="發送"], button[type="submit"]');

      if (submitBtn && !submitBtn.disabled) {
        // Double check: 確保這個按鈕不是停止按鈕（雖然 detectButton 已經擋了一層，但多一層保護）
        const label = (submitBtn.getAttribute('aria-label') || '').toLowerCase();
        if (label.includes('stop') || label.includes('停止')) return false;

        submitBtn.click();
        return true;
      }
      return false;
    },
    responseType: 'fetch_stream',
    responseApiPattern: 'app-chat/conversations',
    responseMethod: 'POST',
    parseResponse: function(rawText) {
      if (typeof rawText !== 'string') return '';
      try {
        var data = JSON.parse(rawText);
        if (data.responses && Array.isArray(data.responses)) {
          for (var i = 0; i < data.responses.length; i++) {
            var resp = data.responses[i];
            if (resp.sender === 'assistant' && resp.message) {
              return resp.message;
            }
          }
        }
      } catch(e) {
        var lines = rawText.split('\n');
        var tokens = [];
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line) continue;
          try {
            var json = JSON.parse(line);
            if (json.result && json.result.sender && json.result.sender !== 'assistant') continue;
            if (json.result && json.result.response && json.result.response.sender && json.result.response.sender !== 'assistant') continue;
            if (json.result && json.result.token) tokens.push(json.result.token);
            else if (json.result && json.result.response && json.result.response.token) tokens.push(json.result.response.token);
          } catch(ex) {}
        }
        if (tokens.length > 0) return tokens.join('');
      }
      return '';
    },
    scrapeHistory: function() {
      var bubbles = Array.from(document.querySelectorAll('.message-bubble'));
      return normalizeScrapedHistory(bubbles.map(function(el) {
        var isUser = el.className.includes('bg-surface-l1') || el.className.includes('bg-surface-l');
        return {
          role: isUser ? 'user' : 'assistant',
          content: el.innerText.trim()
        };
      }));
    },
    waitAfterFill: 2000
  },

  gemini: {
    id: 'gemini',
    name: 'Gemini',
    color: '#8e44ad',
    url: 'https://gemini.google.com/app',
    // userAgent: ANDROID_USER_AGENT,
    detectTextarea: function() {
      return !!document.querySelector('.ql-editor[contenteditable="true"]');
    },
    detectButton: function() {
      const btn = document.querySelector(
        'button[aria-label*="傳送訊息"], button[aria-label*="Send message"], button[aria-label*="send message"], button[aria-label*="Send"], button[aria-label*="send"], button.submit'
      );
      if (!btn) return false;

      var ariaDisabled = btn.getAttribute('aria-disabled');
      return ariaDisabled !== 'true' && !btn.disabled;
    },
    detectGenerating: function() {
      return !!document.querySelector(
        'button[aria-label*="停止生成"], button[aria-label*="Stop generating"], button[aria-label*="Stop response"], mat-icon[data-mat-icon-name="stop"]'
      );
    },
    getContent: function() {
      var editor = document.querySelector('.ql-editor[contenteditable="true"]');
      if (!editor) return '';
      return editor.textContent || '';
    },
    fillQuestion: function(q) {
      var editor = document.querySelector('.ql-editor[contenteditable="true"]');
      if (!editor) return false;
      editor.focus();
      editor.textContent = q;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    },
    clickButton: function() {
      var btn = document.querySelector(
        'button[aria-label*="傳送訊息"], button[aria-label*="Send message"], button[aria-label*="send message"], button[aria-label*="Send"], button[aria-label*="send"], button.submit'
      );
      if (btn) {
        var ariaDisabled = btn.getAttribute('aria-disabled');
        if (ariaDisabled !== 'true' && !btn.disabled) {
          btn.click();
          return true;
        }
      }
      return false;
    },
    responseType: 'xhr_stream',
    responseApiPattern: 'StreamGenerate',
    responseMethod: 'POST',
    parseResponse: function(rawText) {
      if (typeof rawText !== 'string') return '';
      try {
        var lines = rawText.split('\n');
        for (var i = lines.length - 1; i >= 0; i--) {
          var line = lines[i].trim();
          if (line.startsWith('[["wrb.fr"')) {
            try {
              var outer = JSON.parse(line);
              if (outer[0] && outer[0][2]) {
                var inner = JSON.parse(outer[0][2]);
                if (inner[4] && inner[4][0] && inner[4][0][1]) {
                  var textArr = inner[4][0][1];
                  if (typeof textArr === 'string') return textArr;
                  else if (Array.isArray(textArr)) return textArr[0] || '';
                }
              }
            } catch(e) {}
          }
        }
      } catch(e) {}
      return '(解析失敗)';
    },
    scrapeHistory: function() {
      var userQueries = Array.from(document.querySelectorAll('user-query'));
      var assistantResponses = Array.from(document.querySelectorAll('message-content'));

      if (userQueries.length > 0 || assistantResponses.length > 0) {
        var all = Array.from(document.querySelectorAll('user-query, message-content'));
        return normalizeScrapedHistory(all.map(function(el) {
          var isUser = el.tagName === 'USER-QUERY';
          return {
            role: isUser ? 'user' : 'assistant',
            content: el.innerText.trim()
          };
        }));
      }

      var fallbacks = Array.from(document.querySelectorAll('.query-text, .user-query-content, .message-content, .model-response'));
      return normalizeScrapedHistory(fallbacks.map(function(el) {
        var isUser = el.className.includes('query-text') || el.className.includes('user-query-content');
        return {
          role: isUser ? 'user' : 'assistant',
          content: el.innerText.trim()
        };
      }));
    },
    waitAfterFill: 2000
  },

  claude: {
    id: 'claude',
    name: 'Claude',
    color: '#CC785C',
    url: 'https://claude.ai/new',
    // userAgent: ANDROID_USER_AGENT,
    detectTextarea: function() {
      return !!document.querySelector('div[contenteditable="true"][data-testid="chat-input"]');
    },
    detectButton: function() {
      return !!document.querySelector('button[aria-label="Send message"]');
    },
    detectGenerating: function() {
      if (document.querySelector(
        'button[data-testid*="stop"], [data-testid*="stop"], button[aria-label*="Stop"], button[aria-label*="stop"], button[aria-label*="Cancel"], button[aria-label*="Interrupt"], button[aria-label*="停止"], button[aria-label*="停止生成"]'
      )) {
        return true;
      }

      return Array.from(document.querySelectorAll('button')).some(function(button) {
        var text = (button.innerText || button.textContent || '').trim().toLowerCase();
        return text === 'stop' || text === 'cancel' || text === '停止' || text === '停止生成';
      });
    },
    getContent: function() {
      var inputArea = document.querySelector('div[contenteditable="true"][data-testid="chat-input"]');
      if (!inputArea) return '';
      return inputArea.textContent || '';
    },
    fillQuestion: function(q) {
      var inputArea = document.querySelector('div[contenteditable="true"][data-testid="chat-input"]');
      if (!inputArea) return false;
      inputArea.focus();
      inputArea.innerHTML = '<p>' + q + '</p>';
      inputArea.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    },
    clickButton: function() {
      var btn = document.querySelector('button[aria-label="Send message"]');
      if (btn && !btn.disabled) { btn.click(); return true; }
      return false;
    },
    responseType: 'fetch_stream',
    responseApiPattern: '/completion',
    treeResponsePattern: 'chat_conversations.*tree=True',
    responseMethod: 'POST',
    parseResponse: function(data) {
      var obj = data;
      if (typeof data === 'string') {
        try { obj = JSON.parse(data); } catch(e) { return ''; }
      }

      var messages = obj.chat_messages || [];
      var lastAssistantMsg = null;
      for (var i = messages.length - 1; i >= 0; i--) {
        if (messages[i].sender === 'assistant') {
          lastAssistantMsg = messages[i];
          break;
        }
      }
      if (!lastAssistantMsg) return '';

      var allTexts = [];
      function findTexts(obj) {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
          for (var j = 0; j < obj.length; j++) findTexts(obj[j]);
        } else {
          for (var key in obj) {
            if (key === 'text' && typeof obj[key] === 'string' && obj[key].trim()) {
              allTexts.push(obj[key]);
            } else {
              findTexts(obj[key]);
            }
          }
        }
      }
      findTexts(lastAssistantMsg);
      return allTexts.join('');
    },
    scrapeHistory: function() {
      var all = Array.from(document.querySelectorAll('div[data-testid="user-message"], div[data-testid="claude-message"]'));
      if (all.length > 0) {
        var latestUserElement = null;
        var directMessages = normalizeScrapedHistory(all.map(function(el) {
          var isUser = el.getAttribute('data-testid') === 'user-message';
          if (isUser) latestUserElement = el;
          return {
            role: isUser ? 'user' : 'assistant',
            content: el.innerText.trim()
          };
        }));

        appendLatestClaudeStreamingMessage(directMessages, latestUserElement);

        if (directMessages.length > 1) return directMessages;
      }

      var headingMessages = [];
      Array.from(document.querySelectorAll('h1, h2')).forEach(function(heading) {
        var headingText = cleanScrapedHistoryText(heading.innerText || heading.textContent || '');
        if (/^You said:/i.test(heading.innerText || heading.textContent || '')) {
          headingMessages.push({ role: 'user', content: headingText || textUntilNextConversationHeading(heading) });
        } else if (/^Claude responded:/i.test(heading.innerText || heading.textContent || '')) {
          var headingOnly = headingText;
          var sectionText = textUntilNextConversationHeading(heading);
          headingMessages.push({ role: 'assistant', content: sectionText || headingOnly });
        }
      });
      if (headingMessages.length > 0) {
        headingMessages = normalizeScrapedHistory(headingMessages);
        appendLatestClaudeStreamingMessage(headingMessages, findLatestClaudeUserElement());
        return headingMessages;
      }

      var fallbacks = Array.from(document.querySelectorAll('.font-user-message, .font-claude-message'));
      var latestFallbackUserElement = null;
      var fallbackMessages = normalizeScrapedHistory(fallbacks.map(function(el) {
        var isUser = el.className.includes('font-user-message');
        if (isUser) latestFallbackUserElement = el;
        return {
          role: isUser ? 'user' : 'assistant',
          content: el.innerText.trim()
        };
      }));

      appendLatestClaudeStreamingMessage(fallbackMessages, latestFallbackUserElement);

      return fallbackMessages;
    },
    waitAfterFill: 1000
  },

  chatgpt: {
    id: 'chatgpt',
    name: 'ChatGPT',
    color: '#27ae60',
    url: 'https://chat.openai.com/',
    // userAgent: ANDROID_USER_AGENT,
    detectTextarea: function() {
      return !!document.querySelector('#prompt-textarea');
    },
    detectButton: function() {
      return !!document.querySelector('button[data-testid="send-button"]');
    },
    detectGenerating: function() {
      return !!document.querySelector(
        'button[data-testid="stop-button"], button[aria-label*="Stop"], button[aria-label*="stop"]'
      );
    },
    getContent: function() {
      var textarea = document.querySelector('#prompt-textarea');
      if (!textarea) return '';
      return textarea.value || textarea.textContent || '';
    },
    fillQuestion: function(q) {
      var textarea = document.querySelector('#prompt-textarea');
      if (!textarea) return false;
      textarea.value = q;
      textarea.innerHTML = q;
      textarea.focus();
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    },
    clickButton: function() {
      var btn = document.querySelector('button[data-testid="send-button"]');
      if (btn && !btn.disabled) { btn.click(); return true; }
      return false;
    },
    responseType: 'fetch_stream',
    responseApiPattern: 'backend-api.*conversation',
    responseMethod: 'POST',
    parseResponse: function(rawText) {
      if (typeof rawText !== 'string') return '';
      var lines = rawText.split('\n');
      var lastContent = '';
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            var json = JSON.parse(line.substring(6));
            if (json.message && json.message.content && json.message.content.parts) {
              var parts = json.message.content.parts;
              if (parts.length > 0 && typeof parts[0] === 'string') {
                lastContent = parts[0];
              }
            }
          } catch(e) {}
        }
      }
      return lastContent;
    },
    scrapeHistory: function() {
      var turnMessages = [];
      var turns = Array.from(document.querySelectorAll('[data-testid^="conversation-turn"], article'));
      turns.forEach(function(turn) {
        var roleEl = turn.querySelector('[data-message-author-role]');
        var role = turn.getAttribute('data-turn') || (roleEl ? roleEl.getAttribute('data-message-author-role') : '');
        var rawText = '';

        if (role === 'assistant') {
          var assistantParts = Array.from(turn.querySelectorAll('[data-message-author-role="assistant"]'))
            .map(function(el) {
              var textEl = el.querySelector('.markdown, .whitespace-pre-wrap') || el;
              return textEl ? textEl.innerText : '';
            })
            .filter(function(text) { return cleanScrapedHistoryText(text); });

          rawText = assistantParts.length > 0
            ? assistantParts.join('\n\n')
            : ((turn.querySelector('.markdown, .whitespace-pre-wrap') || turn).innerText || '');
        } else {
          var textEl = roleEl ? (roleEl.querySelector('.markdown, .whitespace-pre-wrap') || roleEl) : null;
          rawText = textEl ? textEl.innerText : turn.innerText;
        }

        var isUser = role === 'user' || /Your message actions|Copy message|Edit message/.test(rawText || '');
        var isAssistant = role === 'assistant' || /Response actions|Copy response|Good response|Bad response/.test(rawText || '');
        if (isUser || isAssistant) {
          turnMessages.push({
            role: isUser ? 'user' : 'assistant',
            content: rawText
          });
        }
      });
      turnMessages = normalizeScrapedHistory(turnMessages);
      if (turnMessages.length > 1 && turnMessages.some(function(m) { return m.role === 'user'; })) {
        return turnMessages;
      }

      var all = Array.from(document.querySelectorAll('[data-message-author-role]'));
      if (all.length > 0) {
        return normalizeScrapedHistory(all.map(function(el) {
          var role = el.getAttribute('data-message-author-role');
          var textEl = el.querySelector('.markdown, .whitespace-pre-wrap') || el;
          return {
            role: role === 'user' ? 'user' : 'assistant',
            content: textEl.innerText.trim()
          };
        }));
      }

      return normalizeScrapedHistory(turns.map(function(turn) {
        var isUser = turn.querySelector('div.bg-token-main-surface-secondary') || turn.querySelector('.justify-end') || !turn.querySelector('.markdown');
        var markdownEl = turn.querySelector('.markdown');
        var text = markdownEl ? markdownEl.innerText : turn.innerText;
        return {
          role: isUser ? 'user' : 'assistant',
          content: text.trim()
        };
      }));
    },
    waitAfterFill: 500
  }
};

// Export configuration
window.PLATFORM_CONFIGS = PLATFORM_CONFIGS;

console.log('[AI Multi-Chat] Platform configurations loaded:', Object.keys(PLATFORM_CONFIGS));
