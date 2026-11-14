// platforms-config.js - 平台配置（從 platformConfig.ts 轉換）

/**
 * Standard Android Chrome User Agent to avoid "disallowed_useragent" errors
 */
const ANDROID_USER_AGENT = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36';

function cleanScrapedHistoryText(text) {
  if (!text) return '';

  var rawText = String(text)
    .replace(/\u00a0/g, ' ')
    .replace(/(?:Thought for|Worked for|思考了|運作了|运行了)\s*\d+\s*(?:s|sec|secs|seconds|秒)?/gi, '\n')
    .replace(/^\s*(?:Thinking|思考中|正在思考)\s*$/gim, '')
    .replace(/^\s*(?:(?:Thinking|思考中|正在思考)\s*)+/i, '');

  var blockedLines = [
    'Copy', 'Copy response', 'Copy message', 'Copy table', 'Edit', 'Edit message',
    'Retry', 'Regenerate', 'Share', 'Sources', 'More actions', 'Response actions',
    'Good response', 'Bad response', 'Switch model', 'Start dictation', 'Start Voice',
    'Searched the web',
    '複製', '編輯', '重做', '分享及匯出', '答得好', '有待加強', '更多選項',
    '建立分享連結', '讚', '踩', '顯示更多選項', '複製提示詞'
  ];

  var lines = [];
  rawText.split('\n').forEach(function(line) {
    // Compare UI labels with trimmed text, but retain indentation and blank
    // lines in the returned content so code blocks remain valid.
    var rightTrimmed = line.replace(/[ \t]+$/g, '');
    var comparable = rightTrimmed.trim();
    if (blockedLines.indexOf(comparable) !== -1) return;
    if (/^(Thinking|思考中|正在思考)$/i.test(comparable)) return;
    if (/^Thought process$/i.test(comparable)) return;
    if (/^(Thought for|Worked for|思考了)\s*\d+/i.test(comparable)) return;
    if (/^\d+\s+sources$/i.test(comparable)) return;
    if (/^清晨\d+:\d+$/.test(comparable)) return;

    if (!comparable) {
      if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
      return;
    }
    lines.push(rightTrimmed);
  });

  if (lines.length > 2 && lines[0].trim() === lines[1].trim() && lines[0].trim().length <= 80) {
    lines.splice(0, 2);
  }

  return lines.join('\n')
    .replace(/^你說了\s*/i, '')
    .replace(/^Gemini 說了\s*/i, '')
    .replace(/^You said:\s*/i, '')
    .replace(/^Claude responded:\s*/i, '')
    .replace(/^\n+|\n+$/g, '');
}

function getScrapedLinkLabel(text) {
  var lines = String(text || '')
    .replace(/\u2060/g, ' ')
    .split('\n')
    .map(function(line) { return line.replace(/\s+/g, ' ').trim(); })
    .filter(function(line) { return line && !/^\+\d+$/.test(line); });

  return (lines[0] || '')
    .replace(/\s+\+\d+(?:\s+.*)?$/, '')
    .trim();
}

function normalizeScrapedLinks(links) {
  return (Array.isArray(links) ? links : []).map(function(link) {
    var text = getScrapedLinkLabel(link && link.text);
    var rawHref = link && link.href;
    if (!text || !rawHref) return null;

    try {
      var url = new URL(rawHref, location.href);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      return { text: text, href: url.href };
    } catch (error) {
      return null;
    }
  }).filter(Boolean);
}

function collectScrapedLinks(element) {
  if (!element || !element.querySelectorAll) return [];

  return normalizeScrapedLinks(Array.from(element.querySelectorAll('a[href]')).map(function(anchor) {
    return {
      text: anchor.innerText || anchor.textContent || '',
      href: anchor.href || anchor.getAttribute('href') || ''
    };
  }));
}

function normalizeScrapedHistory(messages, options) {
  var normalized = [];
  (messages || []).forEach(function(message) {
    // A provider's canonical user-text nodes contain no UI labels. Do not
    // remove literal words such as "Copy", repeated lines, or real user turns.
    var preserveUserContent = options && options.preserveUserContent && message && message.role === 'user';
    var content = preserveUserContent
      ? String(message.content || '').replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n').trim()
      : cleanScrapedHistoryText(message && message.content);
    var links = normalizeScrapedLinks(message && message.links);
    if (!content) return;

    var previous = normalized[normalized.length - 1];
    if (!preserveUserContent && previous && previous.role === message.role && previous.content === content) {
      if (links.length > 0 && (!previous.links || previous.links.length === 0)) {
        previous.links = links;
      }
      return;
    }

    var normalizedMessage = {
      role: message.role === 'user' ? 'user' : 'assistant',
      content: content
    };
    if (links.length > 0) normalizedMessage.links = links;
    normalized.push(normalizedMessage);
  });
  return normalized;
}

function readGeminiUserQuery(element) {
  var content = element.querySelector('.query-text, .user-query-content') || element;
  var uiSelector = '.screen-reader-user-query-label, .cdk-visually-hidden, [aria-hidden="true"], button';
  var lines = Array.from(content.querySelectorAll('.query-text-line')).filter(function(line) {
    return !line.closest(uiSelector);
  });

  // Gemini repeats the entire prompt in a visually hidden <h5>. Reading the
  // enclosing user-query.innerText includes both copies and breaks exact turn
  // matching. Read the actual prompt paragraphs without text-based deduping.
  if (lines.length > 0) {
    return lines.map(function(line) {
      return line.innerText !== undefined ? line.innerText : line.textContent || '';
    }).join('\n').trim();
  }

  // Older layouts do not have query-text-line. Remove only provider UI from a
  // detached copy, retaining paragraph/line boundaries and the live page DOM.
  var copy = content.cloneNode(true);
  copy.querySelectorAll(uiSelector).forEach(function(node) { node.remove(); });
  copy.querySelectorAll('br').forEach(function(node) { node.replaceWith('\n'); });
  copy.querySelectorAll('p, div, li, pre').forEach(function(node) { node.append('\n'); });
  return (copy.textContent || '').trim();
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

function readTopLevelBlocksText(root, selector, excludeSelector) {
  // 只讀正文區塊（巢狀的同類區塊只算一次），排除思考狀態、螢幕閱讀器標題、操作列等 UI 文字。
  var blocks = Array.from(root.querySelectorAll(selector)).filter(function(block) {
    if (excludeSelector && block.closest(excludeSelector)) return false;
    var parent = block.parentElement && block.parentElement.closest(selector);
    return !parent || !root.contains(parent);
  });
  return blocks.map(function(block) {
    return block.innerText || block.textContent || '';
  }).filter(function(text) { return text.trim(); }).join('\n\n');
}

function readClaudeAssistantContent(element) {
  var text = readTopLevelBlocksText(
    element,
    '.standard-markdown, .prose',
    '.sr-only, [class*="group/status"], [data-testid="message-actions"]'
  );
  if (text) return text;
  // 沒有正文區塊時才退回整塊文字，並去掉螢幕閱讀器標題（例如「Claude 已回覆：」）。
  var raw = (element.innerText || element.textContent || '').trim();
  var heading = element.querySelector('h1.sr-only, h2.sr-only');
  var headingText = heading ? (heading.innerText || heading.textContent || '').trim() : '';
  if (headingText && raw.indexOf(headingText) === 0) raw = raw.slice(headingText.length);
  return raw;
}

function readTextWithoutSpeakerHeading(element) {
  // Grok 每則訊息開頭有螢幕閱讀器用的發話者標題（「您」、「Grok」），不屬於訊息內容。
  var raw = (element.innerText || element.textContent || '').trim();
  var heading = element.querySelector('h1.sr-only, h2.sr-only');
  var headingText = heading ? (heading.innerText || heading.textContent || '').trim() : '';
  if (headingText && raw.indexOf(headingText) === 0) raw = raw.slice(headingText.length).trim();
  return raw;
}

function readGrokAssistantContent(element) {
  // 正文在 .response-content-markdown；.thinking-container 是「運作了 5s」之類的思考標籤。
  return readTopLevelBlocksText(element, '.response-content-markdown', '.thinking-container') ||
    readTextWithoutSpeakerHeading(element);
}

function readGrokUserContent(element) {
  // 提問本文在 [data-bubble-text]；沒有時退回整塊文字並去掉發話者標題。
  var parts = Array.from(element.querySelectorAll('[data-bubble-text]')).map(function(part) {
    return part.innerText || part.textContent || '';
  }).filter(function(text) { return text.trim(); });
  return parts.length > 0 ? parts.join('\n') : readTextWithoutSpeakerHeading(element);
}

function scrapeClaudeArticleHistory() {
  var articles = Array.from(document.querySelectorAll('article, [role="article"]'));
  var messages = [];

  articles.forEach(function(article) {
    var heading = article.querySelector('h1, h2');
    var rawHeadingText = (heading && (heading.innerText || heading.textContent) || '').trim();
    var userElement = article.querySelector(
      'div[data-testid="user-message"], .font-user-message, [class*="font-user-message"]'
    );
    var assistantElement = article.querySelector('.font-claude-response') || article.querySelector(
      'div[data-testid="claude-message"], div[data-testid="assistant-message"], .font-claude-message, [data-is-streaming]'
    );
    var role = null;

    if (/^You said:/i.test(rawHeadingText) || (userElement && !/^Claude responded:/i.test(rawHeadingText))) {
      role = 'user';
    } else if (/^Claude responded:/i.test(rawHeadingText) || assistantElement) {
      role = 'assistant';
    }

    if (!role) return;

    var textElement = role === 'user' ? userElement : assistantElement;
    var content = cleanScrapedHistoryText(
      textElement
        ? (role === 'assistant' ? readClaudeAssistantContent(textElement) : (textElement.innerText || textElement.textContent || ''))
        : rawHeadingText
    );

    if (!content) return;
    messages.push({
      role: role,
      content: content,
      links: collectScrapedLinks(textElement || article)
    });
  });

  return normalizeScrapedHistory(messages);
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
    '[data-is-streaming]',
    '[aria-live="polite"]',
    '.font-claude-response',
    '.font-claude-message',
    '[class*="font-claude-message"]',
    '.prose',
    '[class*="prose"]'
  ];

  var candidates = Array.from(document.querySelectorAll(selectors.join(',')));
  var bestText = '';

  candidates.forEach(function(element) {
    var isAssistantContainer = element.matches && element.matches(
      'div[data-testid="claude-message"], div[data-testid="assistant-message"], [data-testid*="assistant"], [data-testid*="response"], [data-is-streaming], .font-claude-response, .font-claude-message, [class*="font-claude-message"]'
    );
    if (!isElementAfter(anchorElement, element) && !(isAssistantContainer && element.closest('main'))) return;
    if (element.closest('nav, aside, header, footer')) return;
    if (element.matches && element.matches('button, textarea, input, [contenteditable="true"]')) return;
    if (element.closest('div[data-testid="user-message"], .font-user-message, [class*="font-user-message"]')) return;
    if (element.getAttribute('role') === 'status') return;
    if (element.getAttribute('aria-live')) return;
    if (element.classList && element.classList.contains('sr-only')) return;

    if (!isAssistantContainer && element.closest('button, [contenteditable="true"], textarea, input')) return;

    var textSource = element.querySelector(
      '.font-claude-response, [data-testid="message-content"], .font-claude-message, [class*="font-claude-message"], .prose, [class*="prose"]'
    ) || element;
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

function isVisibleMetaComposer(element) {
  if (!element || !element.isConnected) return false;

  var style = window.getComputedStyle(element);
  var rect = element.getBoundingClientRect();
  return style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    rect.width > 0 &&
    rect.height > 0;
}

function getMetaComposer() {
  var candidates = Array.from(document.querySelectorAll(
    '[data-testid="composer-input"][contenteditable="true"], textarea[data-testid="composer-input"]'
  ));

  return candidates.find(isVisibleMetaComposer) || null;
}

function fillMetaComposer(question) {
  var composer = getMetaComposer();
  if (!composer) return false;

  var value = String(question || '');
  composer.focus();

  if (composer.tagName === 'TEXTAREA') {
    var valueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    )?.set;
    if (valueSetter) valueSetter.call(composer, value);
    else composer.value = value;

    composer.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: value
    }));
    return true;
  }

  try {
    // Meta uses Lexical. A DOM range alone does not update Lexical's internal
    // selection, so a later paste is appended to an existing draft. Select all
    // through the editing command and let Lexical process a beforeinput delete.
    document.execCommand('selectAll', false, null);
    composer.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      composed: true,
      inputType: 'deleteContentBackward',
      data: null
    }));

    if (/\r|\n/.test(value)) {
      // execCommand('insertText') flattens every newline in Meta's Lexical
      // composer. Lexical's paste handler converts plain-text newlines to <br>
      // nodes while preserving its internal editor state.
      var clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', value);
      composer.dispatchEvent(new ClipboardEvent('paste', {
        clipboardData: clipboardData,
        bubbles: true,
        cancelable: true,
        composed: true
      }));
    } else {
      document.execCommand('insertText', false, value);
    }

    return true;
  } catch (error) {
    console.warn('[Meta AI] Native text insertion failed:', error);
    return false;
  }
}

const META_HISTORY_UI_SELECTOR = 'button, [role="button"], [aria-hidden="true"], [hidden], script, style, svg, .sr-only, [data-testid="thinking-status"], [data-testid="subagent-cot-list"]';

function readMetaHistoryNode(node) {
  if (node.nodeType === 3) return node.textContent || '';
  if (node.nodeType !== 1 || node.matches(META_HISTORY_UI_SELECTOR)) return '';
  if (node.tagName === 'BR') return '\n';

  if (node.matches('.ur-markdown') && !node.querySelector('table, pre')) {
    // Keep the provider's rendered spacing for normal prose, lists and math.
    // Only structured table/code blocks need the node-by-node conversion.
    return '\n\n' + (node.innerText || node.textContent || '') + '\n\n';
  }

  if (node.tagName === 'TABLE') {
    // A cell can contain several paragraphs. Keep each row on one line with
    // tab-separated columns, which Smart Compare already renders as a table.
    var rows = Array.from(node.rows).filter(function(row) {
      return !row.closest(META_HISTORY_UI_SELECTOR);
    }).map(function(row) {
      return Array.from(row.cells).map(function(cell) {
        // Preserve an empty column (including the top-left header), rather
        // than shifting every subsequent value into the wrong column.
        return readMetaHistoryNode(cell).replace(/\s+/g, ' ').trim() || '—';
      }).join('\t');
    }).filter(Boolean);
    var caption = node.caption ? readMetaHistoryNode(node.caption).trim() + '\n' : '';
    return '\n\n' + caption + rows.join('\n') + '\n\n';
  }

  if (node.tagName === 'PRE') {
    var code = node.querySelector('code') || node;
    return '\n\n' + (code.innerText || code.textContent || '') + '\n\n';
  }

  var text = Array.from(node.childNodes).map(readMetaHistoryNode).join('');
  if (/^(P|DIV|H[1-6]|LI|UL|OL|BLOCKQUOTE|SECTION|ARTICLE|FIGURE|FIGCAPTION|DL|DT|DD)$/.test(node.tagName)) {
    return '\n\n' + text + '\n\n';
  }
  return text;
}

function readMetaAssistantContent(messageElement) {
  // Meta renders prose, tables and code in separate sibling blocks. Selecting
  // just the first .ur-markdown (or the longest block) truncates the response.
  var selectors = '.markdown-content, .ur-markdown, table, pre';

  // 「你偏好哪一則回覆？」並排比較會把兩則候選回覆各渲染兩份（寬版並排 + 分頁版），
  // 整塊讀會重複三四次；只讀目前選中的那個分頁。
  var panels = Array.from(messageElement.querySelectorAll('[role="tabpanel"]'));
  if (panels.length > 1) {
    messageElement = panels.filter(function(panel) {
      return panel.getAttribute('aria-hidden') !== 'true';
    })[0] || panels[0];
  }

  var candidates = messageElement.matches(selectors)
    ? [messageElement]
    : Array.from(messageElement.querySelectorAll(selectors));
  var candidateSet = new Set(candidates);
  var blocks = candidates.filter(function(element) {
    if (element.closest(META_HISTORY_UI_SELECTOR)) return false;
    for (var parent = element.parentElement; parent && parent !== messageElement; parent = parent.parentElement) {
      if (candidateSet.has(parent)) return false;
    }
    return true;
  });
  if (candidates.length === 0) blocks = [messageElement];

  var parts = [];
  var links = [];
  blocks.forEach(function(block) {
    var text = readMetaHistoryNode(block).trim();
    if (!text) return;
    parts.push(text);
    links = links.concat(collectScrapedLinks(block));
  });
  return { content: parts.join('\n\n'), links: links };
}

// Text of a rich editor with its line breaks. textContent drops <br> and
// paragraph boundaries, and innerText does the same when the frame is not rendered.
function readEditorText(root) {
  var out = '';
  (function walk(node) {
    Array.prototype.forEach.call(node.childNodes || [], function(child) {
      if (child.nodeType === 3) { out += child.textContent; return; }
      if (child.nodeType !== 1) return;
      if (child.tagName === 'BR') { out += '\n'; return; }
      var block = /^(P|DIV|LI|PRE|BLOCKQUOTE|H[1-6])$/.test(child.tagName);
      if (block && out && !/\n$/.test(out)) out += '\n';
      walk(child);
      if (block && !/\n$/.test(out)) out += '\n';
    });
  })(root);
  return out.replace(/\n$/, '');
}

function isInsideHiddenContainer(element) {
  if (typeof getComputedStyle !== 'function') return false;
  for (var node = element; node; node = node.parentElement) {
    try { if (getComputedStyle(node).display === 'none') return true; } catch (e) { return false; }
  }
  return false;
}

function getChatGPTComposer() {
  var selector = '#prompt-textarea, [data-composer-markdown][contenteditable="true"], form .ProseMirror[contenteditable="true"]';
  // After the first question the home page's composer stays in the page inside a
  // display:none container. It matches first, but it cannot be filled.
  var matches = Array.prototype.slice.call(document.querySelectorAll(selector));
  for (var i = 0; i < matches.length; i++) {
    if (!isInsideHiddenContainer(matches[i])) return matches[i];
  }
  return matches[0] || document.querySelector(selector);
}

function getChatGPTSendButton() {
  var composer = getChatGPTComposer();
  if (!composer) return null;

  var form = composer.closest('form');
  var selectors = 'button[data-testid="send-button"], button[data-testid="composer-submit-button"], button#composer-submit-button';
  // 新版移除了 send-button test ID；只在此輸入框的表單內尋找 submit。
  if (form) selectors += ', button[type="submit"]';
  var button = (form || document).querySelector(selectors);
  if (button || form) return button;
  return getChatGPTFormlessSendButton(composer);
}

function getChatGPTFormlessSendButton(composer) {
  // 2026-11 新版首頁輸入區沒有 <form>，送出鈕是 type="button"、沒有 data-testid，
  // 只能從輸入框所屬輸入區的 [data-composer-trailing-controls] 裡找。
  var root = composer.parentElement;
  while (root && !root.querySelector('[data-composer-trailing-controls]')) root = root.parentElement;
  if (!root) return null;

  var trailing = root.querySelector('[data-composer-trailing-controls]');
  var candidates = Array.from(trailing.querySelectorAll('button')).filter(function(button) {
    // 排除聽寫鈕與會開選單的控制項（模型、權限等）。
    return button.getAttribute('data-dictation-button') === null &&
      button.getAttribute('aria-haspopup') === null &&
      button.getAttribute('aria-expanded') === null;
  });
  var labelled = candidates.filter(function(button) {
    return /send|submit|傳送|发送|送出|送信/i.test(button.getAttribute('aria-label') || '');
  });
  if (labelled.length > 0) return labelled[labelled.length - 1];

  // 其他介面語言認不出 aria-label 時：輸入框有內容，最後一個控制項才會是送出鈕
  // （空白時同一位置可能是語音鈕，不能按）。
  var text = composer.innerText || composer.textContent || '';
  return text.trim() ? (candidates[candidates.length - 1] || null) : null;
}

// 以下送出 / 停止鈕都優先用不分語言的屬性（data-testid、圖示名稱、表單 submit），
// aria-label 只當備援，避免介面切成中文或其他語言就找不到按鈕。
function getGrokStopButton() {
  var icon = document.querySelector('form g[id="name=player-stop"]');
  return (icon && icon.closest('button')) ||
    document.querySelector('button[aria-label*="Stop"], button[aria-label*="stop"], button[aria-label*="停止"]');
}

function getGrokSubmitButton() {
  return document.querySelector('button[data-testid="chat-submit"]') ||
    document.querySelector('form button[type="submit"]') ||
    document.querySelector('button[aria-label*="Send"], button[aria-label*="send"], button[aria-label*="提交"], button[aria-label*="發送"]');
}

function getGeminiSendButton() {
  var icon = document.querySelector(
    '.send-button mat-icon[fonticon="arrow_upward"], .send-button mat-icon[data-mat-icon-name="arrow_upward"], ' +
    '.send-button mat-icon[fonticon="send"], .send-button mat-icon[data-mat-icon-name="send"]'
  );
  return (icon && icon.closest('button')) ||
    document.querySelector('.send-button.submit button') ||
    document.querySelector('button[aria-label*="傳送訊息"], button[aria-label*="Send message"], button[aria-label*="send message"]');
}

function getClaudeSendButton() {
  // aria-label 會隨介面語言改變（例如「傳送訊息」），優先用不分語言的 data-testid。
  return document.querySelector('button[data-testid="chat-input-send"], button[aria-label="Send message"]');
}

function getChatGPTStopButton() {
  // 新版停止鈕沒有 data-testid，外觀也和語音鈕相同；不分語言的生成判斷改靠 data-talvt-turn-state，
  // 這裡的 aria-label 只當中英文介面的輔助訊號。
  return document.querySelector(
    'button[data-testid="stop-button"], button[data-testid="composer-stop-button"], ' +
    'button[aria-label*="stop" i], button[aria-label*="停止"]'
  );
}

function scrollChatGPTThreadToLatest() {
  // 2026-11 對話是虛擬清單：只渲染畫面附近的輪次，而且頁面不在底部時送出新問題不會自動跟上，
  // 新的一輪不在 DOM 裡就讀不到回覆。找到包住對話的捲動容器並捲到底。
  var turn = document.querySelector('[data-turn-key], [data-content-search-unit-key]');
  var getStyle = typeof window !== 'undefined' && window.getComputedStyle;
  for (var node = turn && turn.parentElement; node && getStyle; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight + 1 &&
        /auto|scroll/.test(getStyle.call(window, node).overflowY || '')) {
      node.scrollTop = node.scrollHeight;
      return true;
    }
  }
  return false;
}

function getChatGPTLatestTurnState() {
  var turns = document.querySelectorAll('[data-talvt-turn-state]');
  var latest = turns[turns.length - 1];
  return latest ? String(latest.getAttribute('data-talvt-turn-state') || '').trim().toLowerCase() : '';
}

function getChatGPTSearchUnits() {
  // 新版頁面有兩個 <main>（外殼與對話），只查第一個會抓不到對話；改查整份文件。
  var units = Array.from(document.querySelectorAll(
    '[data-chatgpt-search-unit-key], [data-content-search-unit-key]'
  )).map(function(element) {
    var key = element.getAttribute('data-chatgpt-search-unit-key') ||
      element.getAttribute('data-content-search-unit-key') || '';
    var suffix = key.match(/:(user|assistant)$/);
    if (suffix) return { element: element, role: suffix[1] };

    // 2026-11「local」對話的 key 是「<turn>:<訊息 ID>」，不含角色；
    // 角色只標在訊息標題的 data-conversation-role 上。
    var heading = element.querySelector('[data-conversation-role]');
    var role = heading ? heading.getAttribute('data-conversation-role') : '';
    return role === 'user' || role === 'assistant' ? { element: element, role: role } : null;
  }).filter(Boolean);

  // 同一則訊息的外層與內容層都有 search key，只讀最外層一次。
  return units.filter(function(unit) {
    return !units.some(function(parent) {
      return parent !== unit && parent.element.contains(unit.element);
    });
  });
}

function scrapeChatGPTSearchUnitHistory(units) {
  return normalizeScrapedHistory(units.map(function(unit) {
    var contentElements;
    if (unit.role === 'user') {
      var bubble = unit.element.querySelector('[data-user-message-bubble]') || unit.element;
      contentElements = [bubble.querySelector('.whitespace-pre-wrap') || bubble];
    } else {
      // 新版 Markdown 不再使用 .markdown；只抓正文，不含角色標題與操作列。
      contentElements = Array.from(unit.element.querySelectorAll(
        '[data-markdown-text-style="assistant-message"]'
      ));
    }

    var links = [];
    var parts = contentElements.map(function(element) {
      links = links.concat(collectScrapedLinks(element));
      return element.innerText || element.textContent || '';
    });
    return { role: unit.role, content: parts.join('\n\n'), links: links };
  }), { preserveUserContent: true });
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
      // 生成中（顯示停止按鈕）時不送出，避免誤按停止
      if (getGrokStopButton()) return false;

      const submitBtn = getGrokSubmitButton();
      return !!submitBtn && !submitBtn.disabled;
    },
    detectGenerating: function() {
      return !!getGrokStopButton();
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
      const submitBtn = getGrokSubmitButton();

      if (submitBtn && !submitBtn.disabled) {
        // Double check: 確保這個按鈕不是停止按鈕（雖然 detectButton 已經擋了一層，但多一層保護）
        if (submitBtn === getGrokStopButton()) return false;

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
        if (data.result && data.result.token) return data.result.token;
        if (data.result && data.result.response && data.result.response.token) return data.result.response.token;
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
      var bubbles = Array.from(document.querySelectorAll(
        '[data-testid="user-message"], [data-testid="assistant-message"]'
      ));
      if (bubbles.length === 0) {
        bubbles = Array.from(document.querySelectorAll('.message-bubble'));
      }

      return normalizeScrapedHistory(bubbles.map(function(el) {
        var testId = el.getAttribute('data-testid');
        var isUser = testId === 'user-message' || (
          !testId && (el.className.includes('bg-surface-l1') || el.className.includes('bg-surface-l'))
        );
        return {
          role: isUser ? 'user' : 'assistant',
          content: (isUser ? readGrokUserContent(el) : readGrokAssistantContent(el)).trim(),
          links: collectScrapedLinks(el)
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
    // A reloaded conversation shows its composer before the earlier turns.
    // Sending in that gap is answered without the earlier context.
    isConversationHydrated: function() {
      if (!/^\/app\/[^/]+/.test(location.pathname)) return true;
      return !!document.querySelector('user-query, message-content');
    },
    detectButton: function() {
      if (this.detectGenerating()) return false;
      const btn = getGeminiSendButton();
      if (!btn) return false;

      var ariaDisabled = btn.getAttribute('aria-disabled');
      return ariaDisabled !== 'true' && !btn.disabled;
    },
    detectGenerating: function() {
      // 停止鈕的 mat-icon 名稱不隨語言改變；aria-label 只當備援。
      return !!document.querySelector(
        'mat-icon[fonticon="stop"], mat-icon[data-mat-icon-name="stop"], button[aria-label*="停止"], button[aria-label*="Stop generating"], button[aria-label*="Stop response"]'
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
      if (this.detectGenerating()) return false;
      var btn = getGeminiSendButton();
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
            content: isUser ? readGeminiUserQuery(el) : el.innerText.trim(),
            links: collectScrapedLinks(el)
          };
        }), { preserveUserContent: true });
      }

      var fallbacks = Array.from(document.querySelectorAll('.query-text, .user-query-content, .message-content, .model-response'));
      // The fallback selectors can match both a message and its descendants.
      fallbacks = fallbacks.filter(function(element) {
        return !fallbacks.some(function(parent) { return parent !== element && parent.contains(element); });
      });
      return normalizeScrapedHistory(fallbacks.map(function(el) {
        var isUser = el.className.includes('query-text') || el.className.includes('user-query-content');
        return {
          role: isUser ? 'user' : 'assistant',
          content: isUser ? readGeminiUserQuery(el) : el.innerText.trim(),
          links: collectScrapedLinks(el)
        };
      }), { preserveUserContent: true });
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
      return !!getClaudeSendButton();
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
      return readEditorText(inputArea);
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
      var btn = getClaudeSendButton();
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
      var articleMessages = scrapeClaudeArticleHistory();
      if (articleMessages.some(function(message) { return message.role === 'assistant'; })) {
        return articleMessages;
      }

      var all = Array.from(document.querySelectorAll(
        'div[data-testid="user-message"], div[data-testid="claude-message"], .font-claude-response'
      ));
      if (all.length > 0) {
        var latestUserElement = null;
        var directMessages = normalizeScrapedHistory(all.map(function(el) {
          var isUser = el.getAttribute('data-testid') === 'user-message';
          if (isUser) latestUserElement = el;
          return {
            role: isUser ? 'user' : 'assistant',
            content: (isUser ? el.innerText : readClaudeAssistantContent(el)).trim(),
            links: collectScrapedLinks(el)
          };
        }));

        appendLatestClaudeStreamingMessage(directMessages, latestUserElement);

        if (directMessages.some(function(message) { return message.role === 'assistant'; })) {
          return directMessages;
        }
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

      var fallbacks = Array.from(document.querySelectorAll(
        '.font-user-message, .font-claude-response, .font-claude-message'
      ));
      var latestFallbackUserElement = null;
      var fallbackMessages = normalizeScrapedHistory(fallbacks.map(function(el) {
        var isUser = el.className.includes('font-user-message');
        if (isUser) latestFallbackUserElement = el;
        return {
          role: isUser ? 'user' : 'assistant',
          content: el.innerText.trim(),
          links: collectScrapedLinks(el)
        };
      }));

      appendLatestClaudeStreamingMessage(fallbackMessages, latestFallbackUserElement);

      return fallbackMessages.length > 0 ? fallbackMessages : articleMessages;
    },
    waitAfterFill: 1000
  },

  chatgpt: {
    id: 'chatgpt',
    name: 'ChatGPT',
    color: '#27ae60',
    url: 'https://chatgpt.com/',
    // userAgent: ANDROID_USER_AGENT,
    detectTextarea: function() {
      return !!getChatGPTComposer();
    },
    detectButton: function() {
      var button = getChatGPTSendButton();
      return !!button && !button.disabled && button.getAttribute('aria-disabled') !== 'true' && !this.detectGenerating();
    },
    detectGenerating: function() {
      if (getChatGPTStopButton()) return true;

      var turnState = getChatGPTLatestTurnState();
      if (turnState) return !/^(complete|completed|done|error|failed|cancel(l)?ed|stopped)$/i.test(turnState);

      var units = getChatGPTSearchUnits();
      var latestUnit = units[units.length - 1];
      var latestTurn = latestUnit ? latestUnit.element :
        Array.from(document.querySelectorAll('[data-testid^="conversation-turn"]')).pop();
      // 只看最新一輪；整頁掃 aria-busy 會撞到「個人檔案選單」等常駐元素而永遠判定生成中。
      return !!(latestTurn && latestTurn.querySelector(
        '[data-message-streaming="true"], [data-is-streaming="true"], [aria-busy="true"]'
      ));
    },
    // 明確完成訊號：ChatGPT 在每一輪標記 data-talvt-turn-state，完成時為 "complete"。
    detectResponseComplete: function() {
      if (getChatGPTStopButton()) return false;
      if (getChatGPTLatestTurnState() === 'complete') return true;

      // 2026-11「local」對話沒有 turn-state；回覆結束後，最新一則回覆才會出現傳送時間。
      var units = getChatGPTSearchUnits();
      var latest = units[units.length - 1];
      return !!(latest && latest.role === 'assistant' &&
        latest.element.querySelector('[data-assistant-message-sent-time]'));
    },
    getContent: function() {
      var composer = getChatGPTComposer();
      if (!composer) return '';
      return composer.tagName === 'TEXTAREA'
        ? composer.value
        : (composer.innerText || composer.textContent || '');
    },
    fillQuestion: function(q) {
      var composer = getChatGPTComposer();
      if (!composer) return false;
      composer.focus();

      if (composer.tagName === 'TEXTAREA') {
        var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(composer, q);
        composer.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText',
          data: q
        }));
        return true;
      }

      // 透過原生編輯更新 ProseMirror 狀態，保留純文字、換行與縮排。
      var range = document.createRange();
      range.selectNodeContents(composer);
      var selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return document.execCommand(q ? 'insertText' : 'delete', false, q);
    },
    clickButton: function() {
      if (!this.detectButton()) return false;
      var button = getChatGPTSendButton();
      if (!button) return false;
      button.click();
      // 新的一輪要等送出後才加進對話，分幾次把對話捲到最新。
      if (typeof setTimeout === 'function') {
        [400, 1200, 2500, 5000].forEach(function(delay) {
          setTimeout(scrollChatGPTThreadToLatest, delay);
        });
      }
      return true;
    },
    responseType: 'fetch_stream',
    responseApiPattern: '/backend-api/conversation',
    responseMethod: 'POST',
    responseStablePollsRequired: 8,
    responseQuietPeriodMs: 30000,
    responseObserveMutations: true,
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
      var units = getChatGPTSearchUnits();
      if (units.length > 0) return scrapeChatGPTSearchUnitHistory(units);

      var turnMessages = [];
      // 不再退回讀取所有 <article>：新版首頁的「試試看」推薦卡也是 article，會被誤當成提問。
      var turns = Array.from(document.querySelectorAll('[data-testid^="conversation-turn"]'));

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
            content: rawText,
            links: collectScrapedLinks(roleEl || turn)
          });
        }
      });
      turnMessages = normalizeScrapedHistory(turnMessages);
      if (
        turnMessages.some(function(message) { return message.role === 'user'; }) &&
        turnMessages.some(function(message) { return message.role === 'assistant'; })
      ) {
        return turnMessages;
      }

      var all = Array.from(document.querySelectorAll('[data-message-author-role]'));
      if (all.length > 0) {
        return normalizeScrapedHistory(all.map(function(el) {
          var role = el.getAttribute('data-message-author-role');
          var textEl = el.querySelector('.markdown, .whitespace-pre-wrap') || el;
          return {
            role: role === 'user' ? 'user' : 'assistant',
            content: textEl.innerText.trim(),
            links: collectScrapedLinks(el)
          };
        }));
      }

      return normalizeScrapedHistory(turns.map(function(turn) {
        var isUser = turn.querySelector('div.bg-token-main-surface-secondary') || turn.querySelector('.justify-end') || !turn.querySelector('.markdown');
        var markdownEl = turn.querySelector('.markdown');
        var text = markdownEl ? markdownEl.innerText : turn.innerText;
        return {
          role: isUser ? 'user' : 'assistant',
          content: text.trim(),
          links: collectScrapedLinks(turn)
        };
      }));
    },
    waitAfterFill: 500
  },

  meta: {
    id: 'meta',
    name: 'Meta AI',
    color: '#5b8def',
    url: 'https://www.meta.ai/',
    detectTextarea: function() {
      return !!getMetaComposer();
    },
    detectButton: function() {
      if (this.detectGenerating()) return false;

      var button = document.querySelector('button[data-testid="composer-send-button"]');
      return !!button && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
    },
    detectGenerating: function() {
      if (document.querySelector(
        'button[data-testid="composer-stop-button"], button[aria-label="Stop"], button[aria-label*="Stop generating" i]'
      )) {
        return true;
      }

      var messages = Array.from(document.querySelectorAll('[data-testid="assistant-message"]'));
      var message = messages[messages.length - 1];
      if (!message) return false;

      var complete = message.getAttribute('data-streaming-complete');
      var state = (message.getAttribute('data-streaming-state') || '').trim();
      if (/^(done|complete|completed|failed|error|cancelled|canceled)$/i.test(state)) return false;
      if (complete === 'true') return false;
      if (complete === 'false') return true;
      return !!state;
    },
    // 明確完成訊號：最後一則回覆的 data-streaming-state 由 INIT → STREAMING → DONE。
    detectResponseComplete: function() {
      if (this.detectGenerating()) return false;
      var messages = document.querySelectorAll('[data-testid="assistant-message"]');
      var message = messages[messages.length - 1];
      if (!message) return false;
      var state = (message.getAttribute('data-streaming-state') || '').trim();
      return /^(done|complete|completed)$/i.test(state) || message.getAttribute('data-streaming-complete') === 'true';
    },
    getContent: function() {
      var composer = getMetaComposer();
      if (!composer) return '';
      return composer.tagName === 'TEXTAREA'
        ? composer.value
        : (composer.innerText || composer.textContent || '');
    },
    fillQuestion: function(question) {
      return fillMetaComposer(question);
    },
    clickButton: function() {
      var button = document.querySelector('button[data-testid="composer-send-button"]');
      if (button && !button.disabled && button.getAttribute('aria-disabled') !== 'true') {
        button.click();
        return true;
      }
      return false;
    },
    scrapeHistory: function() {
      var messages = Array.from(document.querySelectorAll(
        '[data-message-type="user"], [class~="group/user-message"], [data-testid="assistant-message"]'
      ));

      return normalizeScrapedHistory(messages.map(function(message) {
        var isUser = message.getAttribute('data-message-type') === 'user' ||
          (message.classList && message.classList.contains('group/user-message'));
        if (!isUser) {
          var assistant = readMetaAssistantContent(message);
          return { role: 'assistant', content: assistant.content, links: assistant.links };
        }
        var contentElement = message.querySelector('.text-response.whitespace-pre-wrap') ||
          message.querySelector('.text-response') || message;

        return {
          role: 'user',
          content: (contentElement.innerText || contentElement.textContent || '').trim(),
          links: collectScrapedLinks(contentElement)
        };
      }));
    },
    responseStablePollsRequired: 3,
    responseQuietPeriodMs: 2500,
    waitAfterFill: 500
  }
};

// Export configuration
window.PLATFORM_CONFIGS = PLATFORM_CONFIGS;
window.AIZooPlatformUtils = Object.freeze({
  cleanScrapedHistoryText: cleanScrapedHistoryText,
  normalizeScrapedHistory: normalizeScrapedHistory
});

console.log('[AI Multi-Chat] Platform configurations loaded:', Object.keys(PLATFORM_CONFIGS));
