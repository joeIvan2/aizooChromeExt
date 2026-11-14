// MAIN world / document_start。只觀察回答端點，不跨 bridge 傳 URL、request body 或 headers。
(function() {
  'use strict';
  if (window.self === window.top || window.AIZooPageCapture) return;
  const providers = { 'grok.com': 'grok', 'gemini.google.com': 'gemini', 'claude.ai': 'claude', 'chatgpt.com': 'chatgpt', 'meta.ai': 'meta', 'www.meta.ai': 'meta' };
  const provider = providers[location.hostname];
  if (!provider) return;
  const MAX_PACKET = 4 * 1024 * 1024;

  function endpoint(input, method = 'GET', websocket = false) {
    try {
      const u = new URL(typeof input === 'string' ? input : input?.url || String(input), location.href);
      if (websocket) {
        if (provider === 'grok' && u.hostname === 'grok.com' && /^\/ws\/mgw\/?$/.test(u.pathname)) return 'grok-ws';
        if (provider === 'chatgpt' && u.hostname === 'codex-cloud-backend.chatgpt.com') return 'chatgpt-ws';
        if (provider === 'meta' && u.hostname === 'gateway.meta.ai' && u.pathname === '/ws/clippy') return 'meta-ws';
        return null;
      }
      if (provider === 'gemini' && u.hostname === 'geminiweb-pa.clients6.google.com' && u.pathname === '/v1/processSession') return 'gemini-channel';
      if (provider === 'claude' && u.hostname === 'claude.ai' && method === 'POST') {
        if (u.pathname === '/claudeai-rpc/anthropic.bard.api.v1alpha.ConversationService/StreamTimeline') return 'claude-connect';
        if (u.pathname === '/claudeai-rpc/anthropic.bard.api.v1alpha.ConversationService/PerformAction') return 'claude-action';
        if (/^\/api\/organizations\/[^/]+\/chat_conversations\/[^/]+\/completion$/.test(u.pathname)) return 'claude-sse';
      }
      if (provider === 'chatgpt' && u.hostname === 'chatgpt.com' && method === 'POST' && /^\/backend-api\/(?:f\/)?conversation$/.test(u.pathname)) return 'chatgpt-sse';
    } catch { /* A bad observer must never change a native request. */ }
    return null;
  }
  function projectMessage(data, transport) {
    let m; try { m = JSON.parse(data); } catch { return null; }
    if (transport === 'grok-ws') {
      const e = m?.event;
      if (!e || !['response.created', 'response.chunk', 'response.output_text.done', 'response.done'].includes(e.type)) return null;
      const event = { type: e.type, event_id: e.event_id, response_id: e.response_id };
      if (e.response) event.response = { id: e.response.id, status: e.response.status };
      if (e.chunk?.text?.channel === 'CHANNEL_ASSISTANT_RESPONSE') event.chunk = { text: { channel: e.chunk.text.channel, text: e.chunk.text.text } };
      if (e.type === 'response.chunk' && !event.chunk) return null;
      if (e.type === 'response.output_text.done') event.text = e.text;
      return JSON.stringify({ event });
    }
    const p = m?.params;
    if (!p || !/^(turn\/(started|completed)|item\/(started|completed|agentMessage\/delta))$/.test(m.method || '')) return null;
    if (m.method.startsWith('item/') && m.method !== 'item/agentMessage/delta' && p.item?.type !== 'agentMessage') return null;
    const params = { turnId: p.turnId, itemId: p.itemId, delta: p.delta };
    if (p.turn) params.turn = { id: p.turn.id, status: p.turn.status };
    if (p.item) params.item = { id: p.item.id, type: p.item.type, text: p.item.text, phase: p.item.phase };
    return JSON.stringify({ method: m.method, params });
  }
  let installed = false, nextId = 0;
  function install(expectedProvider) {
    if (installed || expectedProvider !== provider) return;
    installed = true;
    const emit = (transport, streamId, phase, data, status, challenge, conversationId) => {
      try {
        if (data && (typeof data === 'string' ? data.length : data.byteLength) > MAX_PACKET) return;
        // Raw binary is cloned by postMessage; never detach the page's buffer.
        window.postMessage({ source: 'ai-zoo-network-v1', provider, transport, streamId, phase, data, ...(status ? { status, challenge: !!challenge } : {}), ...(conversationId ? { conversationId } : {}) }, location.origin || '*');
      } catch { /* Fail open. */ }
    };
    // ISOLATED History wrappers do not see SPA calls in MAIN. A throttled
    // one-second URL poll can otherwise unload a newly created conversation
    // while its saved URL is still the home page. Forward a pulse, never URLs.
    for (const method of ['pushState', 'replaceState']) {
      try {
      const native = window.history?.[method];
      if (typeof native !== 'function') continue;
      window.history[method] = function() {
        const result = Reflect.apply(native, this, arguments);
        try { window.postMessage({ source: 'ai-zoo-page-state-v1', provider, kind: 'navigation' }, location.origin || '*'); } catch {}
        return result;
      };
      } catch { /* A frozen History object must not disable network capture. */ }
    }
    const nativeFetch = window.fetch;
    if (typeof nativeFetch === 'function') {
      window.fetch = function(input, init) {
        let transport, method;
        try { method = String(init?.method || input?.method || 'GET').toUpperCase(); transport = endpoint(input, method); } catch {}
        const id = String(++nextId);
        if (transport && transport !== 'claude-connect' && !(transport === 'gemini-channel' && method === 'GET')) emit(transport, id, 'request');
        const promise = Reflect.apply(nativeFetch, this, arguments);
        if (!transport || transport === 'claude-action') return promise;
        // Observation runs independently; response identity, errors and original body stay native.
        promise.then(response => {
          try {
            if (!response.ok) { emit(transport, id, 'error', undefined, response.status, response.headers.get('cf-mitigated') === 'challenge'); return; }
            if (!response.body) return;
            const reader = response.clone().body.getReader();
            (async () => {
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  emit(transport, id, 'data', value);
                }
                emit(transport, id, 'end');
              } catch { emit(transport, id, 'error'); }
            })().catch(() => {});
          } catch { emit(transport, id, 'error'); }
        }, () => emit(transport, id, 'error')).catch(() => {});
        return promise;
      };
    }

    const XHR = window.XMLHttpRequest;
    if (XHR?.prototype) {
      const nativeOpen = XHR.prototype.open, nativeSend = XHR.prototype.send, meta = new WeakMap();
      XHR.prototype.open = function(method, input) {
        const result = Reflect.apply(nativeOpen, this, arguments);
        try { meta.set(this, { method: String(method).toUpperCase(), transport: endpoint(input, String(method).toUpperCase()) }); } catch {}
        return result;
      };
      XHR.prototype.send = function() {
        const info = meta.get(this);
        if (info?.transport && info.transport !== 'claude-action') {
          const id = String(++nextId), xhr = this;
          let seen = 0;
          if (info.method !== 'GET') emit(info.transport, id, 'request');
          const read = () => {
            try {
              if (xhr.status >= 400) return;
              if (xhr.responseType === '' || xhr.responseType === 'text') {
                const value = xhr.responseText || '';
                if (value.length > seen) emit(info.transport, id, 'data', value.slice(seen));
                seen = value.length;
              }
            } catch {}
          };
          const end = () => {
            read();
            try {
              if (!(xhr.status >= 400) && xhr.responseType === 'arraybuffer' && xhr.response) emit(info.transport, id, 'data', new Uint8Array(xhr.response));
            } catch {}
            if (xhr.status >= 400) emit(info.transport, id, 'error', undefined, xhr.status, xhr.getResponseHeader?.('cf-mitigated') === 'challenge');
            else emit(info.transport, id, 'end');
            xhr.removeEventListener('progress', read); xhr.removeEventListener('loadend', end);
          };
          try { xhr.addEventListener('progress', read); xhr.addEventListener('loadend', end); } catch {}
        }
        return Reflect.apply(nativeSend, this, arguments);
      };
    }

    const NativeSocket = window.WebSocket;
    if (typeof NativeSocket === 'function') {
      window.WebSocket = new Proxy(NativeSocket, {
        construct(target, args, newTarget) {
          const ws = Reflect.construct(target, args, newTarget);
          try {
            const transport = endpoint(args[0], 'GET', true);
            if (!transport) return ws;
            const id = String(++nextId), nativeSend = ws.send;
            let order = Promise.resolve();
            ws.send = function(data) {
              try {
                let request = false, conversationId;
                if (typeof data === 'string') {
                  const m = JSON.parse(data);
                  request = transport === 'grok-ws' ? m.event?.type === 'response.create' : m.method === 'turn/addUserMessage';
                  if (transport === 'chatgpt-ws' && request && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(m.params?.threadId || '')) conversationId = m.params.threadId;
                } else if (transport === 'meta-ws') {
                  const b = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
                  request = !!b && b[0] === 13 && b.length > 8;
                }
                if (request) emit(transport, id, 'request', undefined, undefined, undefined, conversationId);
              } catch {}
              return Reflect.apply(nativeSend, this, arguments);
            };
            ws.addEventListener('message', event => {
              const data = event.data;
              order = order.then(async () => {
                if (typeof data === 'string') {
                  const projected = projectMessage(data, transport);
                  if (projected) emit(transport, id, 'data', projected);
                } else if (transport === 'meta-ws') {
                  const b = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
                  if (b?.[0] === 13) emit(transport, id, 'data', b);
                }
              }).catch(() => {});
            });
            ws.addEventListener('close', () => { order = order.then(() => emit(transport, id, 'end')).catch(() => {}); });
          } catch { /* Socket remains usable even if observation fails. */ }
          return ws;
        }
      });
    }
  }
  window.AIZooPageCapture = Object.freeze({ install });
  // Claude's existing page hook owns installation there; no competing Claude hook.
  if (provider !== 'claude') install(provider);
})();
