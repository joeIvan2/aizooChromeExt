// platforms-config.js - 平台配置（從 platformConfig.ts 轉換）

/**
 * Standard Android Chrome User Agent to avoid "disallowed_useragent" errors
 */
const ANDROID_USER_AGENT = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36';

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
      return bubbles.map(function(el) {
        var isUser = el.className.includes('bg-surface-l1') || el.className.includes('bg-surface-l');
        return {
          role: isUser ? 'user' : 'assistant',
          content: el.innerText.trim()
        };
      }).filter(function(m) { return m.content; });
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
      var userQueries = Array.from(document.querySelectorAll('user-query, .query-text, .user-query-content'));
      var assistantResponses = Array.from(document.querySelectorAll('message-content, .message-content, .model-response'));
      var history = [];
      var maxLen = Math.max(userQueries.length, assistantResponses.length);
      for (var i = 0; i < maxLen; i++) {
        if (userQueries[i]) {
          history.push({ role: 'user', content: userQueries[i].innerText.trim() });
        }
        if (assistantResponses[i]) {
          history.push({ role: 'assistant', content: assistantResponses[i].innerText.trim() });
        }
      }
      return history;
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
      var messages = Array.from(document.querySelectorAll('.font-user-message, .font-claude-message, div[data-testid="user-message"], div[data-testid="claude-message"]'));
      return messages.map(function(el) {
        var isUser = el.classList.contains('font-user-message') || el.getAttribute('data-testid') === 'user-message';
        return {
          role: isUser ? 'user' : 'assistant',
          content: el.innerText.trim()
        };
      }).filter(function(m) { return m.content; });
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
      var turns = Array.from(document.querySelectorAll('[data-testid^="conversation-turn"]'));
      return turns.map(function(turn) {
        var isUser = turn.querySelector('div.bg-token-main-surface-secondary') || turn.querySelector('.justify-end') || !turn.querySelector('.markdown');
        var markdownEl = turn.querySelector('.markdown');
        var text = markdownEl ? markdownEl.innerText : turn.innerText;
        return {
          role: isUser ? 'user' : 'assistant',
          content: text.trim()
        };
      }).filter(function(m) { return m.content; });
    },
    waitAfterFill: 500
  }
};

// Export configuration
window.PLATFORM_CONFIGS = PLATFORM_CONFIGS;

console.log('[AI Multi-Chat] Platform configurations loaded:', Object.keys(PLATFORM_CONFIGS));
