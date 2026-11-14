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
