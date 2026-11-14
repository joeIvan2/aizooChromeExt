// 網路協定解析：僅處理回答資料；不使用 DOM、憑證或第三方套件。
// 欄位路徑來自實際流量；未知格式不猜測成功，交由原有 DOM 路徑處理。
(function(root) {
  'use strict';
  const MAX_BUFFER = 4 * 1024 * 1024;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const text = bytes => { try { return decoder.decode(bytes); } catch { return ''; } };
  const bytes = value => value instanceof Uint8Array ? value : new Uint8Array(value);
  const base64 = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const concat = (a, b) => { const out = new Uint8Array(a.length + b.length); out.set(a); out.set(b, a.length); return out; };

  function fields(input) {
    const b = bytes(input), out = [];
    let p = 0;
    function varint() {
      let value = 0n;
      for (let shift = 0n; shift < 70n; shift += 7n) {
        if (p >= b.length) throw Error('Truncated protobuf');
        const n = b[p++];
        value |= BigInt(n & 127) << shift;
        if (!(n & 128)) return value;
      }
      throw Error('Invalid protobuf varint');
    }
    while (p < b.length) {
      const tag = Number(varint()), number = Math.floor(tag / 8), wire = tag & 7;
      if (!number || !Number.isSafeInteger(tag)) throw Error('Invalid protobuf field');
      let value;
      if (wire === 0) value = varint();
      else if (wire === 2) {
        const n = Number(varint());
        if (!Number.isSafeInteger(n) || n < 0 || p + n > b.length) throw Error('Truncated protobuf bytes');
        value = b.subarray(p, p + n); p += n;
      } else if (wire === 1 || wire === 5) {
        p += wire === 1 ? 8 : 4;
        if (p > b.length) throw Error('Truncated protobuf fixed field');
      } else throw Error('Unsupported protobuf wire');
      out.push({ number, wire, value });
    }
    return out;
  }
  function at(input, path) {
    let nodes = [input];
    for (const number of path) nodes = nodes.flatMap(b => {
      if (!(b instanceof Uint8Array)) return [];
      try { return fields(b).filter(f => f.number === number).map(f => f.value); } catch { return []; }
    });
    return nodes;
  }
  const str = (b, path) => { const v = at(b, path)[0]; return v instanceof Uint8Array ? text(v) : ''; };
  const numberIs = (b, path, n) => at(b, path).includes(BigInt(n));
  async function decompress(b) {
    const stream = new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'));
    const reader = stream.getReader();
    let out = new Uint8Array();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return out;
        if (out.length + value.length > MAX_BUFFER) throw Error('Oversize compressed frame');
        out = concat(out, value);
      }
    } finally { reader.cancel().catch(() => {}); }
  }

  function createParser(provider, onEvent, onError = () => {}) {
    const turns = new Map(), streams = new Map(), blocks = new Map();
    let queue = Promise.resolve();
    function turn(id) {
      if (!id) return null;
      if (!turns.has(id)) {
        turns.set(id, { id, text: '', complete: false, items: new Map(), seen: new Set() });
        if (turns.size > 64) turns.delete(turns.keys().next().value);
        onEvent({ turnId: id, text: '', complete: false, started: true });
      }
      return turns.get(id);
    }
    function publish(t, value = t?.text, complete = false) {
      if (!t || typeof value !== 'string' || value.length > MAX_BUFFER) return;
      // Cumulative snapshots can be retransmitted after newer deltas.
      if (value.length < t.text.length) return;
      if (t.text === value && (!complete || t.complete)) return;
      t.text = value; t.complete = t.complete || complete;
      onEvent({ turnId: t.id, text: value, complete: t.complete });
    }
    function grok(msg) {
      const e = msg?.event;
      if (!e || !/^response\./.test(e.type || '')) return;
      const id = e.response_id || e.response?.id;
      const t = turn(id);
      if (!t) return;
      if (e.event_id) {
        if (t.seen.has(e.event_id)) return;
        t.seen.add(e.event_id);
        if (t.seen.size > 20000) t.seen.delete(t.seen.values().next().value);
      }
      if (e.type === 'response.chunk' && e.chunk?.text?.channel === 'CHANNEL_ASSISTANT_RESPONSE') {
        const delta = e.chunk.text.text;
        if (typeof delta === 'string') publish(t, t.text + delta);
      }
      if (e.type === 'response.output_text.done' && typeof e.text === 'string' && t.text && e.text.startsWith(t.text)) publish(t, e.text);
      if (e.type === 'response.done' && e.response?.status === 'completed') publish(t, t.text, true);
    }
    function chat(msg) {
      const p = msg?.params;
      if (!p || typeof msg.method !== 'string') return;
      const id = p.turnId || p.turn?.id;
      if (!id || !/^(turn\/(started|completed)|item\/(started|completed|agentMessage\/delta))$/.test(msg.method)) return;
      const t = turn(id);
      if (msg.method === 'turn/completed') {
        if (p.turn?.status === 'completed') publish(t, t.text, true);
        return;
      }
      if (msg.method === 'item/started' || msg.method === 'item/completed') {
        if (p.item?.type !== 'agentMessage' || !p.item.id) return;
        const old = t.items.get(p.item.id) || { text: '', phase: 'final_answer' };
        t.items.set(p.item.id, { text: p.item.text || old.text, phase: p.item.phase || old.phase });
      }
      if (msg.method === 'item/agentMessage/delta' && p.itemId && typeof p.delta === 'string') {
        const item = t.items.get(p.itemId) || { text: '', phase: 'final_answer' };
        item.text += p.delta; t.items.set(p.itemId, item);
      }
      publish(t, [...t.items.values()].filter(v => !v.phase || /^(final|final_answer)$/.test(v.phase)).map(v => v.text).filter(Boolean).join('\n\n'));
    }
    function gemini(b) {
      for (const candidate of at(b, [2, 7, 1, 4, 4])) {
        const id = str(candidate, [5, 1]);
        const answer = at(candidate, [5, 2, 1]).filter(v => v instanceof Uint8Array).map(text).join('');
        if (!id || !answer) continue;
        const t = turn(id);
        publish(t, answer, numberIs(candidate, [5, 9, 1], 2));
      }
    }
    function claude(b, state) {
      for (const snapshot of at(b, [1, 1])) {
        const sender = at(snapshot, [3, 3])[0];
        if (sender !== undefined) state.sender = sender;
        for (const block of at(snapshot, [5])) {
          const id = str(block, [1]), parent = str(block, [2]);
          if (!id || !parent) continue;
          const old = blocks.get(id) || { parent, text: '', answer: false };
          // Live first snapshots omit f24 (final snapshots add it only AFTER
          // the completion event). Sender=2 identifies the streaming answer.
          old.answer ||= numberIs(block, [24], 3) || (state.sender === 2n && at(block, [9]).length > 0);
          if (at(block, [9]).length) old.text = str(block, [9]);
          blocks.set(id, old);
          if (blocks.size > 256) blocks.delete(blocks.keys().next().value);
          if (old.answer) {
            state.active = parent;
            const t = turn(parent);
            publish(t, [...blocks.values()].filter(v => v.parent === parent && v.answer).map(v => v.text).join('\n\n'),
              numberIs(block, [24], 3) && numberIs(block, [4], 1));
          }
        }
      }
      for (const delta of at(b, [1, 2])) {
        const block = blocks.get(str(delta, [1]));
        if (!block?.answer) continue;
        block.text += str(delta, [2]);
        const t = turn(block.parent);
        publish(t, [...blocks.values()].filter(v => v.parent === block.parent && v.answer).map(v => v.text).join('\n\n'));
      }
      // A timeline stays open after this event; HTTP EOF/heartbeat is not completion.
      if (state.active && numberIs(b, [1, 4, 1], 1)) {
        const t = turns.get(state.active);
        if (t?.text) publish(t, t.text, true);
      }
    }
    const metaSections = sections => Array.isArray(sections) ? sections.map(s => s?.view_model?.primitive?.text || '').filter(v => typeof v === 'string') : [];
    function meta(frame) {
      if (frame.length < 8 || frame[0] !== 13) return;
      const n = frame[3] + frame[4] * 256 + frame[5] * 65536;
      if (n !== frame.length - 6) return;
      const b = frame.subarray(8), id = str(b, [4]);
      const answer = at(b, [1, 4])[0];
      if (!id || !answer) return;
      const t = turn(id);
      const cumulative = at(answer, [2]), delta = str(answer, [1]);
      let value = cumulative.length ? str(answer, [2]) : t.text + delta;
      const jsonText = str(answer, [10]);
      if (jsonText) {
        try {
          const json = JSON.parse(jsonText);
          if (json.type === 'full' && json.response?.sections) t.sections = metaSections(json.response.sections);
          else if (!json.type && json.sections) t.sections = metaSections(json.sections);
          else if (json.type === 'patch' && Array.isArray(json.operations) && Number.isInteger(json.seq) && json.seq > (t.seq ?? -1)) {
            t.sections ||= [];
            for (const op of json.operations) {
              const m = /^\/sections\/(\d+)\/view_model\/primitive\/text$/.exec(op.path || '');
              if (m && typeof op.value === 'string') {
                const i = Number(m[1]);
                if (i > 1000) continue;
                if (op.op === 'delta' || op.op === 'append') t.sections[i] = (t.sections[i] || '') + op.value;
                else if (op.op === 'replace' || op.op === 'add') t.sections[i] = op.value;
              }
              if (op.path === '/sections/-' && op.op === 'add') t.sections.push(...metaSections([op.value]));
            }
          }
          if (Number.isInteger(json.seq)) t.seq = Math.max(t.seq ?? -1, json.seq);
          if (t.sections?.length && !cumulative.length) value = t.sections.filter(Boolean).join('\n\n');
        } catch { /* Protobuf cumulative text remains authoritative. */ }
      }
      publish(t, value, numberIs(b, [3], 1) || numberIs(answer, [5], 1));
    }
    function sseFrame(frame, state, transport, streamId) {
      const data = frame.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
      if (!data) return;
      if (data === '[DONE]') { const t = turns.get(state.active); if (t?.text) publish(t, t.text, true); return; }
      let msg; try { msg = JSON.parse(data); } catch { return; }
      if (transport === 'claude-sse') {
        const id = msg.message?.id || state.active || streamId;
        if (msg.type === 'message_start') { state.active = id; turn(id); }
        const t = turns.get(state.active);
        if (msg.type === 'content_block_delta' && msg.delta?.type === 'text_delta' && t) publish(t, t.text + msg.delta.text);
        if (msg.type === 'message_stop' && t?.text) publish(t, t.text, true);
        return;
      }
      const message = msg.v?.message || msg.message;
      if (message) {
        state.eligible = message.author?.role === 'assistant' && message.content?.content_type === 'text' && (!message.channel || message.channel === 'final');
        if (!state.eligible) return;
        state.active = message.id || streamId;
        const t = turn(state.active);
        t.parts = (message.content.parts || []).map(v => typeof v === 'string' ? v : '');
        publish(t, t.parts.join(''));
        if (message.status === 'finished_successfully') publish(t, t.text, true);
        return;
      }
      const t = turns.get(state.active);
      if (t && state.eligible) {
        const ops = Array.isArray(msg.v) ? msg.v : [msg];
        for (const op of ops) {
          const m = /^\/message\/content\/parts\/(\d+)$/.exec(op.p || '');
          if (!m || typeof op.v !== 'string' || Number(m[1]) > 1000) continue;
          const i = Number(m[1]);
          if (op.o === 'append') t.parts[i] = (t.parts[i] || '') + op.v;
          else if (op.o === 'replace' || op.o === 'add') t.parts[i] = op.v;
        }
        publish(t, t.parts.join(''), msg.type === 'message_stream_complete');
      }
    }
    async function process(packet) {
      const { streamId, transport } = packet;
      if (typeof streamId !== 'string' || typeof transport !== 'string' || !transport.startsWith(provider + '-')) return;
      if (packet.phase === 'end' || packet.phase === 'error') { streams.delete(streamId); return; }
      if (!streams.has(streamId)) {
        streams.set(streamId, { binary: new Uint8Array(), buffer: '', decoder: new TextDecoder(), active: null });
        if (streams.size > 16) streams.delete(streams.keys().next().value);
      }
      const s = streams.get(streamId);
      if (transport === 'meta-ws') { meta(bytes(packet.data)); return; }
      if (transport === 'grok-ws' || transport === 'chatgpt-ws') {
        let msg; try { msg = JSON.parse(packet.data); } catch { return; }
        if (provider === 'grok') grok(msg); else chat(msg);
        return;
      }
      if (transport === 'claude-connect') {
        const b = bytes(packet.data);
        if (s.binary.length + b.length > MAX_BUFFER) { streams.delete(streamId); return; }
        s.binary = concat(s.binary, b);
        while (s.binary.length >= 5) {
          const flags = s.binary[0], n = new DataView(s.binary.buffer, s.binary.byteOffset + 1, 4).getUint32(0);
          if (flags > 3 || n > MAX_BUFFER) { streams.delete(streamId); return; }
          if (s.binary.length < n + 5) break;
          let frame = s.binary.slice(5, 5 + n); s.binary = s.binary.slice(5 + n);
          if (flags & 2) continue;
          if (flags & 1) frame = await decompress(frame);
          claude(frame, s);
        }
        return;
      }
      s.buffer += typeof packet.data === 'string' ? packet.data : s.decoder.decode(bytes(packet.data), { stream: true });
      if (s.buffer.length > MAX_BUFFER) { streams.delete(streamId); return; }
      if (transport === 'gemini-channel') {
        while (s.buffer.length) {
          s.buffer = s.buffer.trimStart();
          const nl = s.buffer.indexOf('\n'); if (nl < 0) break;
          if (!/^\d+$/.test(s.buffer.slice(0, nl))) { s.buffer = ''; break; }
          const n = Number(s.buffer.slice(0, nl));
          if (n > MAX_BUFFER) { s.buffer = ''; break; }
          if (s.buffer.length < nl + 1 + n) break;
          const frame = s.buffer.slice(nl + 1, nl + 1 + n); s.buffer = s.buffer.slice(nl + 1 + n);
          let pairs; try { pairs = JSON.parse(frame); } catch { continue; }
          if (!Array.isArray(pairs)) continue;
          for (const pair of pairs) for (const payload of Array.isArray(pair?.[1]) ? pair[1] : []) {
            if (typeof payload !== 'string' || payload.length < 16) continue;
            try { gemini(base64(payload)); } catch { /* Control/unknown channel message. */ }
          }
        }
      } else if (transport.endsWith('-sse')) {
        s.buffer = s.buffer.replace(/\r\n/g, '\n');
        let end;
        while ((end = s.buffer.indexOf('\n\n')) >= 0) {
          const frame = s.buffer.slice(0, end); s.buffer = s.buffer.slice(end + 2);
          sseFrame(frame, s, transport, streamId);
        }
      }
    }
    return {
      push(packet) {
        // Blob/gzip decoding is asynchronous; preserve wire order across pushes.
        queue = queue.then(() => process(packet)).catch(() => onError());
        return queue;
      }
    };
  }
  const api = { createParser, fields, at, text };
  root.AIZooNetworkParsers = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
