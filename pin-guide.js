// 整頁教學只使用介面示意，不接上實際發送事件。
(() => {
  const dismissedKey = 'ai-zoo-interface-guide-dismissed';
  const svgNS = 'http://www.w3.org/2000/svg';
  const toolbar = [
    ['new-chat-btn', 'newChatButton', '新對話', 'tourNewChatHint', '開啟新的一組對話，重新開始。'],
    ['history-toggle-btn', 'historyButton', '歷史對話', 'tourHistoryHint', '找回之前記錄的對話組。'],
    ['compare-btn', 'compareButton', '智慧對比', 'tourCompareHint', '並排閱讀各平台的回答，找出不同觀點。'],
    ['layout-config-btn', 'layoutButtonTitle', '版面設定', 'tourLayoutHint', '選擇 1–5 格、平台與排列順序。'],
    ['language-btn', 'languageButtonTitle', '語言', 'tourLanguageHint', '切換 AI Zoo 的介面語言。'],
    ['minimize-input-btn', 'minimizeInputTitle', '縮小面板', 'tourMinimizeHint', '收起輸入面板；點浮動圖示可展開。'],
    ['send-one-btn', 'sendOneTitle', '發送給單一 AI', 'tourSingleHint', '選一個啟用的平台，只送給它。'],
    ['send-all-btn', 'sendToAllButton', '發送到所有 AI', 'tourAllHint', '同時送給已啟用的平台，停用的會略過。']
  ];
  function textElement(tag, key, fallback) {
    const element = document.createElement(tag);
    element.dataset.i18n = key;
    element.textContent = fallback;
    return element;
  }
  document.addEventListener('DOMContentLoaded', () => {
    const guide = document.getElementById('pin-guide');
    const openButton = document.getElementById('pin-guide-open');
    const closeButton = document.getElementById('pin-guide-close');
    const doneButton = document.getElementById('pin-guide-done');
    if (!guide || !openButton || !closeButton || !doneButton) return;
    const demoPlatforms = [
      ['grok', 'Grok', 'toggle', 1], ['gemini', 'Gemini', 'refresh', 2],
      ['claude', 'Claude', 'maximize', 3], ['chatgpt', 'ChatGPT', 'status', 4],
      ['meta', 'Meta AI', '', 0]
    ];
    demoPlatforms.forEach(([platform, name, target, number]) => {
      const panel = document.createElement('div');
      panel.className = 'tour-provider tour-' + platform;
      const header = document.createElement('div');
      header.className = 'tour-provider-header';
      const title = document.createElement('b');
      title.textContent = name;
      header.append(title);
      [['toggle', 'ON'], ['refresh', '⟳'], ['maximize', '⤢'], ['status', '✓']].forEach(([kind, text]) => {
        const control = document.createElement('span');
        control.className = 'tour-provider-' + kind;
        control.textContent = text;
        if (kind === target) {
          control.dataset.guideTarget = target;
          const badge = document.createElement('em');
          badge.className = 'tour-target-number';
          badge.textContent = number;
          control.append(badge);
        }
        header.append(control);
      });
      const body = document.createElement('div');
      body.className = 'tour-provider-body';
      const nameLabel = document.createElement('strong');
      nameLabel.textContent = name;
      body.append(nameLabel);
      for (let i = 0; i < 3; i++) body.append(document.createElement('span'));
      panel.append(header, body);
      document.getElementById('tour-platforms').append(panel);
    });
    toolbar.forEach(([icon, titleKey, title, hintKey, hint], index) => {
      const tool = document.createElement('div');
      tool.className = 'tour-demo-tool';
      tool.dataset.tourIcon = icon;
      tool.dataset.guideTarget = icon;
      const badge = document.createElement('em');
      badge.className = 'tour-target-number';
      badge.textContent = index + 6;
      tool.append(badge);
      document.getElementById('tour-toolbar').append(tool);
      const note = document.createElement('div');
      note.className = 'tour-note';
      note.dataset.guideTo = icon;
      const heading = document.createElement('b');
      const label = document.createElement('i');
      label.textContent = index + 6;
      heading.append(label, textElement('span', titleKey, title));
      note.append(heading, textElement('p', hintKey, hint));
      document.getElementById('tour-toolbar-notes').append(note);
    });
    // 只複製原介面的 SVG，不複製按鈕、ID 或事件。
    guide.querySelectorAll('[data-tour-icon]').forEach(slot => {
      const source = document.getElementById(slot.dataset.tourIcon)?.querySelector('svg');
      if (!source) return;
      const icon = source.cloneNode(true);
      icon.removeAttribute('id');
      icon.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
      icon.setAttribute('aria-hidden', 'true');
      slot.prepend(icon);
    });
    let frame = 0;
    function drawWires() {
      frame = 0;
      if (!guide.open) return;
      guide.querySelectorAll('.tour-wired').forEach(map => {
        const svg = map.querySelector('.tour-wires');
        const rect = map.getBoundingClientRect();
        svg.setAttribute('viewBox', '0 0 ' + rect.width + ' ' + rect.height);
        svg.replaceChildren();
        map.querySelectorAll('[data-guide-to]').forEach(note => {
          const target = map.querySelector('[data-guide-target="' + note.dataset.guideTo + '"]');
          if (!target) return;
          const a = note.getBoundingClientRect(), b = target.getBoundingClientRect();
          const down = a.top < b.top;
          const x1 = a.left + a.width / 2 - rect.left;
          const y1 = (down ? a.bottom : a.top) - rect.top;
          const x2 = b.left + b.width / 2 - rect.left;
          const y2 = (down ? b.top : b.bottom) - rect.top;
          const middle = (y1 + y2) / 2;
          const path = document.createElementNS(svgNS, 'path');
          path.setAttribute('d', 'M ' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + middle + ', ' + x2 + ' ' + middle + ', ' + x2 + ' ' + y2);
          const dot = document.createElementNS(svgNS, 'circle');
          dot.setAttribute('cx', x2); dot.setAttribute('cy', y2); dot.setAttribute('r', '3');
          svg.append(path, dot);
        });
      });
    }
    function scheduleWires() { if (!frame) frame = requestAnimationFrame(drawWires); }
    const background = document.querySelector('.container');
    let backgroundWasInert = false;
    function open() {
      if (guide.open) return;
      backgroundWasInert = background?.inert || false;
      if (background) background.inert = true;
      guide.showModal();
      guide.scrollTop = 0;
      openButton.hidden = true;
      openButton.setAttribute('aria-expanded', 'true');
      closeButton.focus({ preventScroll: true });
      scheduleWires();
    }
    function dismiss(moveFocus = true) {
      if (!guide.open) return;
      try { localStorage.setItem(dismissedKey, 'true'); }
      catch (error) { console.warn('[AI Zoo] Could not remember the guide dismissal:', error); }
      guide.close();
      if (background) background.inert = backgroundWasInert;
      openButton.hidden = false;
      openButton.setAttribute('aria-expanded', 'false');
      if (moveFocus) openButton.focus({ preventScroll: true });
    }
    openButton.addEventListener('click', open);
    closeButton.addEventListener('click', () => dismiss());
    doneButton.addEventListener('click', () => dismiss());
    guide.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
    guide.addEventListener('keydown', event => event.stopPropagation());
    // AI 網站可能在載入後主動 focus；教學期間焦點留在教學內。
    document.addEventListener('focusin', event => {
      if (guide.open && !guide.contains(event.target)) closeButton.focus({ preventScroll: true });
    }, true);
    guide.querySelectorAll('a[href^="#"]').forEach(link => {
      link.addEventListener('click', event => {
        event.preventDefault();
        guide.querySelector(link.getAttribute('href'))?.scrollIntoView({ block: 'start' });
      });
    });
    window.addEventListener('storage', event => {
      if (event.key === dismissedKey && event.newValue === 'true') dismiss(false);
    });
    window.addEventListener('resize', scheduleWires);
    const observer = new ResizeObserver(scheduleWires);
    guide.querySelectorAll('.tour-wired, .tour-note, [data-guide-target]').forEach(element => observer.observe(element));
    const textObserver = new MutationObserver(scheduleWires);
    guide.querySelectorAll('[data-i18n]').forEach(element => {
      textObserver.observe(element, { childList: true, characterData: true, subtree: true });
    });
    document.fonts?.ready.then(scheduleWires);
    let dismissed = false;
    try { dismissed = localStorage.getItem(dismissedKey) === 'true'; }
    catch (error) { console.warn('[AI Zoo] Could not read the guide preference:', error); }
    // 待主介面初始化後顯示，避免版面設定或輸入焦點蓋過首次教學。
    if (!dismissed) setTimeout(open, 0);
  });
})();
