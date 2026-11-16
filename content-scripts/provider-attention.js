// Evidence only: preloaded CAPTCHA libraries and missing composers are not login proof.
(function(root) {
  'use strict';
  const reasons = {
    challenge: message('providerAttentionChallenge', 'Security verification required. Please complete it on the original site.'),
    login: message('providerAttentionLogin', 'Sign-in required. Please sign in on the original site.'),
    consent: message('providerAttentionConsent', 'Consent required. Please review it on the original site.'),
    'rate-limit': message('providerAttentionRateLimit', 'Usage limit reached. Please check the original site for details.'),
    error: message('providerAttentionError', 'An error occurred on the original site. Please check the page.'),
    startup: message('providerAttentionStartup', 'The page is still initializing. Please open it to finish loading.')
  };
  function message(key, fallback) {
    return root.chrome?.i18n?.getMessage(key) || fallback;
  }
  function classify(s) {
    const ui = [s.dialogText, s.alertText, !s.composer ? s.pageText : ''].filter(Boolean).join('\n');
    let kind;
    if (s.challengeVisible || /^(?:just a moment[.!…]*|請稍候[.!。…]*)$/i.test((s.title || '').trim()) || /正在執行安全驗證|verify (?:that )?you are human|驗證您是人類|確認你是人類|checking your browser/i.test(ui)) kind = 'challenge';
    else if (/too many requests|rate limit|usage limit|you.ve reached.*limit|使用上限|達到.*限制|稍後再試|请求过于频繁/i.test([s.alertText, s.dialogText, s.noticeText, !s.composer ? s.pageText : ''].join('\n'))) kind = 'rate-limit';
    else if (s.loginForm || (!s.composer && s.loginAction) || /https:\/\/(?:accounts\.google\.com\/(?:ServiceLogin|signin)|accounts\.x\.ai\/sign-in|auth\.openai\.com\/|(?:www\.)?(?:claude\.ai|meta\.ai)\/(?:login|logout|auth)(?:[/?#]|$)|chatgpt\.com\/(?:auth\/login|log-in-or-create-account))/.test(s.url || '') || (!s.composer && /sign in to (?:continue|use)|log in to (?:continue|use)|登入以繼續|登录以继续/i.test(ui))) kind = 'login';
    else if ((!s.composer || s.consentAction) && /before you continue|accept.{0,100}(?:terms|cookies)|consent required|同意.{0,100}(?:條款|隱私)|繼續之前/i.test(s.dialogText || '')) kind = 'consent';
    else if (/something went wrong|temporarily unavailable|service unavailable|an error (?:has )?occurred|發生錯誤|出了點問題|服務暫時無法/i.test([s.alertText, !s.composer ? s.pageText : ''].join('\n')) || /model (?:is )?(?:not available|unavailable)|(?:choose|select) (?:a different|another) model|此模型無法使用|選擇其他模型|此模型无法使用|选择其他模型/i.test(s.noticeText || '')) kind = 'error';
    return kind ? { kind, message: reasons[kind] } : null;
  }
  function fromStatus(status, challenge = false) {
    const kind = challenge ? 'challenge' : status === 401 ? 'login' : status === 429 ? 'rate-limit' : status === 403 || status >= 500 ? 'error' : null;
    return kind ? { kind, message: reasons[kind] } : null;
  }
  async function classifyResponse(response) {
    let challenge = response.headers?.get('cf-mitigated') === 'challenge';
    if (!response.ok && /text\/html/i.test(response.headers?.get('content-type') || '')) {
      try { challenge ||= /cloudflare|challenge-platform|just a moment|正在執行安全驗證|請稍候/i.test((await response.clone().text()).slice(0, 16000)); } catch {}
    }
    return fromStatus(response.status, challenge);
  }
  function isLoginControl(text) {
    return /^(?:log in|sign in|登入|登录|ログイン|iniciar sesión|se connecter|anmelden)$/i.test(String(text ?? '').trim());
  }
  function isVisible(el, doc, styleOf) {
    if (!el || el.closest?.('[hidden], [aria-hidden="true"]')) return false;
    for (let node = el; node; node = node.parentElement) {
      const style = styleOf.call(root, node);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || style.contentVisibility === 'hidden' || /inset\(50%\)|rect\(0px,? 0px,? 0px,? 0px\)/.test(style.clipPath || style.clip || '')) return false;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return true;
    // In display:none iframe documents all rects can be zero. The element's
    // own hidden state still matters; the extension's outer box must not hide
    // a newly inserted login / consent / challenge from this detector.
    return !!doc.documentElement && (doc.documentElement.clientWidth === 0 || doc.documentElement.clientHeight === 0);
  }
  function install(config) {
    if (root.parent === root || root.parent !== root.top || !root.document) return;
    const doc = root.document; let last = null, scheduled = false, httpAttention = null;
    const visible = el => isVisible(el, doc, getComputedStyle);
    const text = selector => Array.from(doc.querySelectorAll(selector)).filter(visible).slice(0, 8).map(el => el.textContent.slice(0, 1800)).join('\n');
    // ChatGPT puts "model unavailable" style notices in the thread where the answer would be.
    function lastTurnNotice() {
      const turn = Array.from(doc.querySelectorAll('[data-turn-key]')).pop();
      if (!turn || turn.querySelector('[data-markdown-text-style="assistant-message"]')) return '';
      return Array.from(turn.querySelectorAll('aside')).filter(visible).map(el => el.textContent.slice(0, 300)).join('\n');
    }
    function check() {
      scheduled = false; let composer = false;
      try { composer = !!config.detectTextarea(); } catch {}
      const challengeVisible = Array.from(doc.querySelectorAll('iframe[src*="challenges.cloudflare.com"], iframe[src*="hcaptcha.com"], iframe[src*="recaptcha"], #challenge-stage, .h-captcha, .cf-turnstile')).some(el => {
        if (!visible(el) || /[?&]size=invisible(?:&|$)/.test(el.getAttribute('src') || '')) return false;
        const height = el.getBoundingClientRect().height || parseFloat(getComputedStyle(el).height) || Number(el.getAttribute('height')) || 0;
        return height > 24;
      });
      const loginAction = Array.from(doc.querySelectorAll('a[href*="login"], a[href*="signin"], button, [role="button"]')).some(el => visible(el) && /^(?:log in|sign in|登入|登录|ログイン|iniciar sesión|se connecter|anmelden)(?:\s|$)/i.test(el.textContent.trim()));
      // A working composer with no sign-in button is newer evidence than an
      // earlier 401. Rate limits, challenges and errors are kept.
      if (composer && !loginAction && httpAttention?.kind === 'login') httpAttention = null;
      const next = classify({ url: location.href, composer, title: doc.title, challengeVisible,
        loginAction: !composer && loginAction,
        consentAction: Array.from(doc.querySelectorAll('[role="dialog"] button, dialog[open] button, [aria-modal="true"] button')).some(el => visible(el) && /^(?:accept(?: all)?|i agree|agree|continue|同意|接受|全部接受|繼續)$/i.test(el.textContent.trim())),
        loginForm: Array.from(doc.querySelectorAll('input[type="password"], form[action*="login"], form[action*="signin"]')).some(visible),
        dialogText: text('[role="dialog"], dialog[open], [aria-modal="true"]'),
        noticeText: lastTurnNotice(),
        alertText: text('[role="alert"], [data-testid="error-message"], [data-testid="rate-limit-message"]'),
        pageText: !composer ? (doc.body?.textContent || '').slice(0, 5000) : '' }) || httpAttention;
      const key = next?.kind || '';
      if (key !== last) {
        last = key;
        root.parent.postMessage({ type: 'AI_PROVIDER_ATTENTION', source: 'content-script', platform: config.id, kind: next?.kind || null, message: next?.message || '' }, '*');
      }
      root.__aiProviderAttention = next;
      return next;
    }
    // The page's own sign-in button: sign-in is done in a normal tab instead.
    doc.addEventListener('click', event => {
      const control = event.target?.closest?.('a, button, [role="button"]');
      if (!control || !isLoginControl(control.textContent)) return;
      if (control.closest('form')?.querySelector('input[type="password"]')) return;
      event.preventDefault(); event.stopImmediatePropagation();
      root.parent.postMessage({ type: 'AI_OPEN_LOGIN', source: 'content-script', platform: config.id }, '*');
    }, true);
    const schedule = () => { if (!scheduled) { scheduled = true; queueMicrotask(check); } };
    const observer = new MutationObserver(schedule);
    const start = () => { check(); observer.observe(doc.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'aria-hidden', 'class', 'style'] }); };
    if (doc.documentElement) start(); else root.addEventListener('DOMContentLoaded', start, { once: true });
    // Poll infrequently for navigation / attribute changes not represented by mutations.
    const poll = setInterval(check, 10000);
    root.addEventListener('pagehide', () => { observer.disconnect(); clearInterval(poll); }, { once: true });
    root.AIZooProviderAttention.check = check;
    root.AIZooProviderAttention.reportResponse = async response => {
      httpAttention = await classifyResponse(response);
      check(); return httpAttention;
    };
    root.AIZooProviderAttention.reportStatus = (status, challenge) => { httpAttention = fromStatus(status, challenge); check(); };
  }
  root.AIZooProviderAttention = { classify, classifyResponse, isLoginControl, isVisible, install, reasons };
  if (typeof module === 'object' && module.exports) module.exports = root.AIZooProviderAttention;
})(typeof window !== 'undefined' ? window : globalThis);
