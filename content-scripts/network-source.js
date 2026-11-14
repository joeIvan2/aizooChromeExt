// ISOLATED world：把有送出邊界的網路回合疊回既有 history / lifecycle。
(function(root) {
  'use strict';
  const transports = {
    grok: ['grok-ws'], gemini: ['gemini-channel'],
    claude: ['claude-connect', 'claude-action', 'claude-sse'],
    chatgpt: ['chatgpt-ws', 'chatgpt-sse'], meta: ['meta-ws']
  };
  function createSource(config, utils, onChange, parsers = root.AIZooNetworkParsers) {
    const readDOM = config.scrapeHistory?.bind(config) || (() => []);
    const knownTurns = new Map();
    let active = null, sequence = 0, processingSequence = 0, processingStream = '', enabled = true, queue = Promise.resolve();
    let lease = null;
    const clearLease = () => { if (lease !== null) clearTimeout(lease); lease = null; };
    const renewLease = () => {
      clearLease();
      if (!enabled || !active || active.complete || typeof setTimeout !== 'function') return;
      const turn = active;
      lease = setTimeout(() => {
        lease = null;
        if (active !== turn || turn.complete) return;
        turn.failed = 'stalled'; onChange();
      }, active.text ? 12000 : 45000);
      lease?.unref?.();
    };
    const failStream = streamId => {
      if (active?.streamId === streamId && !active.complete) { active.failed = true; clearLease(); onChange(); }
    };
    const parser = parsers.createParser(config.id, event => {
      if (!knownTurns.has(event.turnId)) knownTurns.set(event.turnId, processingSequence);
      if (knownTurns.size > 512) knownTurns.delete(knownTurns.keys().next().value);
      // A native-page submission has no extension begin() boundary. Release the
      // old overlay on its new protocol turn, not on transport control requests
      // (Gemini sends acknowledgements after an answer is already complete).
      if (enabled && active?.complete && event.turnId !== active.turnId && knownTurns.get(event.turnId) > active.barrier) {
        active = null; clearLease(); onChange(); return;
      }
      if (!enabled || !active || (active.failed && active.failed !== 'stalled') || active.requestSequence <= active.barrier) return;
      if (!active.turnId) {
        if (knownTurns.get(event.turnId) <= active.barrier) return;
        active.turnId = event.turnId;
        active.streamId = processingStream;
      }
      if (active.turnId !== event.turnId || typeof event.text !== 'string' || !event.text.trim()) return;
      active.streamId = processingStream;
      if (event.text.length < active.text.length) return;
      if (active.text === event.text && active.complete === !!event.complete) return;
      active.failed = false;
      active.text = event.text; active.complete = !!event.complete; renewLease();
      onChange();
    }, () => failStream(processingStream));
    function history() {
      if (!enabled || !active?.text || active.failed) return readDOM();
      // The pre-send prefix is the chronological anchor. A virtualized DOM can
      // remove old occurrences of a repeated question; never append those old
      // records after a newer turn just because they disappeared from the DOM.
      const result = active.before.map(m => ({ ...m }));
      result.push({ role: 'user', content: active.question }, { role: 'assistant', content: active.text });
      // Do not infer a suffix from DOM occurrences: an old repeated prompt can
      // reappear late. A subsequent native request releases this overlay below.
      return result;
    }
    config.scrapeHistory = history;
    return {
      begin(question, options = {}) {
        clearLease();
        const before = history();
        active = {
          question, submissionId: options.submissionId, baselineOccurrences: options.baselineOccurrences || 0,
          before: Array.isArray(before) ? before : [], barrier: sequence, requestSequence: 0,
          turnId: null, text: '', complete: false
        };
        renewLease();
      },
      cancel() { clearLease(); active = null; onChange(); },
      navigate(next, previous) {
        try {
          const key = value => new URL(value).pathname.match(/^\/(?:c|local|chat|prompt|app)\/([^/]+)/)?.[1];
          const oldKey = key(previous), newKey = key(next);
          if (oldKey && oldKey !== newKey && (!active || active.complete || !active.requestSequence)) {
            clearLease(); active = null; onChange();
          }
        } catch {}
      },
      snapshot() { return enabled && active?.text && !active.failed ? { text: active.text, complete: active.complete, turnId: active.turnId, submissionId: active.submissionId } : null; },
      status() { return { available: enabled && !active?.failed, delivering: !!(enabled && active?.text && !active.failed), ...(active?.text && active.conversationId ? { resumePath: '/local/' + active.conversationId } : {}) }; },
      setEnabled(value) { enabled = !!value; if (!enabled) clearLease(); onChange(); },
      accept(packet) {
        if (!packet || packet.provider !== config.id || !transports[config.id]?.includes(packet.transport) ||
            typeof packet.streamId !== 'string' || packet.streamId.length > 128 ||
            !['request', 'data', 'end', 'error'].includes(packet.phase)) return Promise.resolve();
        const receivedSequence = ++sequence;
        if (packet.phase === 'error' && Number.isInteger(packet.status)) root.AIZooProviderAttention?.reportStatus?.(packet.status, packet.challenge === true);
        if (packet.phase === 'request') {
          if (enabled && active) {
            active.requestSequence = receivedSequence;
            if (config.id === 'chatgpt' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(packet.conversationId || '')) active.conversationId = packet.conversationId;
          }
          return Promise.resolve();
        }
        if (packet.phase === 'data') {
          if (typeof packet.data !== 'string' && !ArrayBuffer.isView(packet.data) && !(packet.data instanceof ArrayBuffer)) return Promise.resolve();
          if ((typeof packet.data === 'string' ? packet.data.length : packet.data.byteLength) > 4 * 1024 * 1024) return Promise.resolve();
        }
        queue = queue.then(async () => {
          processingSequence = receivedSequence;
          processingStream = packet.streamId;
          await parser.push(packet);
          // Connect/WebChannel subscriptions are routinely renewed mid-answer.
          // EOF is neither a successful completion nor a parse failure there.
          if (packet.phase === 'error' || (packet.phase === 'end' && /-(?:sse|ws)$/.test(packet.transport))) failStream(packet.streamId);
        }).catch(() => {});
        return queue;
      }
    };
  }
  function install(config) {
    if (!root.AIZooNetworkParsers || !root.AIZooUtils || !transports[config.id]) return;
    root.__aiNetworkSources ||= {};
    if (root.__aiNetworkSources[config.id]) return;
    let lastState = '';
    const publish = (force = false) => {
      const state = source.status(), key = JSON.stringify(state);
      if (key !== lastState || force) {
        lastState = key;
        root.parent?.postMessage?.({ type: 'AI_NETWORK_STATE', platform: config.id, source: 'content-script', ...state }, '*');
      }
      root.__aiResponseLifecycleWatchers?.[config.id]?.checkResponse(false);
    };
    const source = createSource(config, root.AIZooUtils, publish);
    root.__aiNetworkSources[config.id] = source;
    publish();
    root.addEventListener('message', event => {
      if (event.source === root.parent && event.data?.source === 'popup' && event.data.type === 'AI_READY_CHECK' && event.data.platform === config.id) { publish(true); return; }
      // Page-world packets carry data only, never extension commands. MAIN world
      // is not a security boundary; still reject sibling/parent frames and origins.
      if (event.source !== root || event.origin !== location.origin || event.data?.source !== 'ai-zoo-network-v1') return;
      source.accept(event.data);
    });
  }
  const api = { createSource, install };
  root.AIZooNetworkSource = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
