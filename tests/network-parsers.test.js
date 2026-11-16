'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createParser } = require('../content-scripts/network-parsers.js');
const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/network',name+'.json'),'utf8'));

for (const name of ['grok','gemini','claude','chatgpt','meta','chatgpt-sse','claude-live','claude-live-long']) {
  test(`${name}: real sanitized capture streams exact text and protocol completion`, async () => {
    const f=fixture(name), events=[];
    const p=createParser(name.split('-')[0], e=>events.push(e));
    for(const [packetIndex,packet] of f.packets.entries()) {
      const data=f.binary?new Uint8Array(Buffer.from(packet,'base64')):packet;
      // Arbitrary HTTP fragmentation, including protobuf varints, gzip headers and UTF-8.
      const step=f.transport.endsWith('-ws')?data.length:17;
      for(let i=0;i<data.length;i+=step)await p.push({transport:f.transport,streamId:f.streamIds?.[packetIndex]||'capture',data:data.slice(i,i+step)});
    }
    const answers=events.filter(e=>e.text);
    assert.ok(answers.length>0);
    assert.equal(answers.at(-1).text,f.expected);
    assert.equal(answers.at(-1).complete,true,'transport EOF is not protocol completion');
    if(name!=='chatgpt-sse')assert.ok(answers.some(e=>!e.complete&&e.text.length<f.expected.length),'incremental prefix');
    for(let i=1;i<answers.length;i++)if(answers[i].turnId===answers[i-1].turnId)assert.ok(answers[i].text.length>=answers[i-1].text.length,'no regression');
  });
}

test('unknown, truncated, heartbeat and echoed request traffic never becomes an answer', async () => {
  for(const provider of ['grok','gemini','claude','chatgpt','meta']) {
    const events=[],p=createParser(provider,e=>events.push(e));
    await p.push({streamId:'bad',transport:provider==='claude'?'claude-connect':provider+'-ws',data:provider==='claude'?new Uint8Array([1,0,0,2]):'not a valid frame'});
    await p.push({streamId:'bad',transport:provider+'-ws',data:JSON.stringify({method:'turn/addUserMessage',params:{input:[{text:'pong'}]},event:{type:'pong'}})});
    assert.equal(events.some(e=>e.text||e.complete),false);
  }
});

test('ChatGPT keeps old turns and commentary separate; item completion is not turn completion', async () => {
  const events=[],p=createParser('chatgpt',e=>events.push(e));
  const send=x=>p.push({transport:'chatgpt-ws',streamId:'ws',data:JSON.stringify(x)});
  await send({method:'turn/started',params:{turn:{id:'one'}}});
  await send({method:'item/started',params:{turnId:'one',item:{id:'reason',type:'agentMessage',phase:'commentary',text:'private reasoning'}}});
  await send({method:'item/agentMessage/delta',params:{turnId:'one',itemId:'reason',delta:' more'}});
  await send({method:'item/completed',params:{turnId:'one',item:{id:'a',type:'agentMessage',phase:'final_answer',text:'answer one'}}});
  assert.equal(events.at(-1).complete,false);
  await send({method:'turn/completed',params:{turn:{id:'one',status:'completed'}}});
  await send({method:'turn/started',params:{turn:{id:'two'}}});
  await send({method:'item/agentMessage/delta',params:{turnId:'two',itemId:'b',delta:'answer two'}});
  await send({method:'turn/completed',params:{turn:{id:'one',status:'completed'}}});
  assert.equal(events.at(-1).turnId,'two');
  assert.equal(events.at(-1).complete,false);
  assert.equal(events.some(e=>e.text?.includes('private')),false);
});

test('Grok deduplicates retransmission and ignores other response channels', async () => {
  const events=[],p=createParser('grok',e=>events.push(e));
  const send=event=>p.push({transport:'grok-ws',streamId:'ws',data:JSON.stringify({event})});
  await send({type:'response.created',response:{id:'one'}});
  const delta={type:'response.chunk',response_id:'one',event_id:'unique',chunk:{text:{channel:'CHANNEL_ASSISTANT_RESPONSE',text:'pong'}}};
  await send(delta);await send(delta);
  await send({...delta,event_id:'thought',chunk:{text:{channel:'CHANNEL_ASSISTANT_NOTETAKER',text:'thought'}}});
  assert.equal(events.at(-1).text,'pong');
  assert.equal(events.at(-1).complete,false);
  await send({type:'response.done',response:{id:'one',status:'completed'}});
  assert.equal(events.at(-1).complete,true);
});

// Claude answers a question that needs a web search in several steps: a short
// opening sentence, the searches, then the real answer. Every step has its own
// id, and only the opening sentence used to be kept.
function claudeFrames(parts) {
  const varint = n => { const out = []; let v = BigInt(n); do { let c = Number(v & 127n); v >>= 7n; if (v) c |= 128; out.push(c); } while (v); return out; };
  const enc = fields => Buffer.from(fields.flatMap(([no, value]) => typeof value === 'number'
    ? [...varint(no * 8), ...varint(value)]
    : (b => [...varint(no * 8 + 2), ...varint(b.length), ...b])(Buffer.isBuffer(value) ? value : typeof value === 'string' ? Buffer.from(value, 'utf8') : enc(value))));
  return parts.map(part => { const body = enc([[1, [part]]]), head = Buffer.alloc(5); head.writeUInt32BE(body.length, 1); return new Uint8Array(Buffer.concat([head, body])); });
}
test('claude: an answer written around a web search is one answer, not just its opening sentence', async () => {
  const M = 'message-0001', message = extra => [3, [[1, M], [3, 2], ...extra]];
  const step = (id, index, type) => [4, [[1, id], [2, M], [3, index], [4, type]]];
  const textBlock = (id, parent, content, done) => [5, [[1, id], [2, parent], ...(done ? [[4, 1], [24, 3]] : []), [9, content]]];
  const frames = claudeFrames([
    [1, [message([]), step('step-1', 1, 1), textBlock('b1', 'step-1', '我先', false)]],
    [1, [textBlock('b1', 'step-1', '我先查證。', true)]],
    [1, [step('step-2', 2, 2), [5, [[1, 'tool-1'], [2, 'step-2'], [13, 'search results']]]]],
    [1, [step('step-3', 3, 1), textBlock('b2', 'step-3', '結果', false)]],
    [2, [[1, 'b2'], [2, '如下']]],
    [1, [textBlock('b2', 'step-3', '結果如下：完整內容。', true)]],
    [1, [message([[6, 1], [7, 1]])]]
  ]);
  const events = [], p = createParser('claude', e => events.push(e));
  const seen = [];
  for (const frame of frames) { await p.push({ transport: 'claude-connect', streamId: 's', data: frame }); seen.push(events.filter(e => e.text).at(-1)); }
  const answers = events.filter(e => e.text);
  assert.equal(new Set(answers.map(e => e.turnId)).size, 1, 'every step belongs to the same answer');
  assert.equal(answers.at(-1).text, '我先查證。\n\n結果如下：完整內容。');
  assert.equal(answers.at(-1).complete, true);
  assert.equal(seen[2].complete, false, 'the search step reopens an answer that looked finished');
  assert.equal(seen[4].text, '我先查證。\n\n結果如下');
  assert.equal(seen[4].complete, false);
});
test('claude: a reloaded conversation with a searched answer gives the whole answer', async () => {
  const M = 'message-0001';
  const frames = claudeFrames([[1, [[3, [[1, M], [3, 2], [6, 1], [7, 1]]],
    [4, [[1, 'step-1'], [2, M], [3, 1], [4, 1]]], [4, [[1, 'step-2'], [2, M], [3, 2], [4, 2]]], [4, [[1, 'step-3'], [2, M], [3, 3], [4, 1]]],
    [5, [[1, 'b1'], [2, 'step-1'], [4, 1], [24, 3], [9, '我先查證。']]], [5, [[1, 'tool-1'], [2, 'step-2'], [13, 'x']]],
    [5, [[1, 'b2'], [2, 'step-3'], [4, 1], [24, 3], [9, '完整內容。']]]]]]);
  const events = [], p = createParser('claude', e => events.push(e));
  for (const frame of frames) await p.push({ transport: 'claude-connect', streamId: 's', data: frame });
  const last = events.filter(e => e.text).at(-1);
  assert.equal(last.text, '我先查證。\n\n完整內容。'); assert.equal(last.complete, true);
});

test('ChatGPT citation markers never reach the panel, including a half-received one', async () => {
  for (const transport of ['chatgpt-ws', 'chatgpt-sse']) {
    const events = [], p = createParser('chatgpt', e => events.push(e));
    const pieces = ['營業到 22:00。', '\ue200cite\ue202turn1', 'search2\ue202turn1search3\ue201', '\n請看', '\ue200entity\ue202["place","晴空塔","東京"]\ue201', '官網。'];
    if (transport === 'chatgpt-ws') {
      const send = x => p.push({ transport, streamId: 'ws', data: JSON.stringify(x) });
      await send({ method: 'turn/started', params: { turn: { id: 't' } } });
      for (const delta of pieces) await send({ method: 'item/agentMessage/delta', params: { turnId: 't', itemId: 'a', delta } });
      await send({ method: 'turn/completed', params: { turn: { id: 't', status: 'completed' } } });
    } else {
      const send = x => p.push({ transport, streamId: 's', data: 'data: ' + JSON.stringify(x) + '\n\n' });
      await send({ v: { message: { id: 'm', author: { role: 'assistant' }, content: { content_type: 'text', parts: [''] } } } });
      for (const v of pieces) await send({ p: '/message/content/parts/0', o: 'append', v });
      await send({ type: 'message_stream_complete' });
    }
    assert.ok(events.every(e => !/[\ue200-\ue202]|turn1|search/.test(e.text)), transport + ' leaked a marker');
    assert.equal(events.at(-1).text, '營業到 22:00。\n請看晴空塔官網。');
    assert.equal(events.at(-1).complete, true);
  }
});
