'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const utils=require('../content-scripts/shared-utils');
const {createSource}=require('../content-scripts/network-source');
const parsers=require('../content-scripts/network-parsers');
function harness(enabled=true) {
  let dom=[],changes=0;
  const config={id:'grok',scrapeHistory:()=>dom};
  const source=createSource(config,utils,()=>changes++,parsers);
  source.setEnabled(enabled);
  const send=async event=>source.accept({provider:'grok',streamId:'ws',transport:'grok-ws',phase:'data',data:JSON.stringify({event})});
  return {source,config,send,setDOM:x=>dom=x,changes:()=>changes,
    request:()=>source.accept({provider:'grok',streamId:'ws',transport:'grok-ws',phase:'request'})};
}
test('network history supplies hidden DOM, preserves repeated prompts and ignores prior turn deltas',async()=>{
  const h=harness();
  h.source.begin('same',{baselineOccurrences:0,submissionId:'one'});await h.request();
  await h.send({type:'response.created',response:{id:'r1'}});
  await h.send({type:'response.chunk',response_id:'r1',chunk:{text:{channel:'CHANNEL_ASSISTANT_RESPONSE',text:'first answer'}}});
  await h.send({type:'response.done',response:{id:'r1',status:'completed'}});
  assert.equal(h.source.snapshot().complete,true);
  h.source.begin('same',{baselineOccurrences:1,submissionId:'two'});await h.request();
  await h.send({type:'response.chunk',response_id:'r1',chunk:{text:{channel:'CHANNEL_ASSISTANT_RESPONSE',text:'stale'}}});
  assert.equal(h.source.snapshot(),null);
  await h.send({type:'response.created',response:{id:'r2'}});
  await h.send({type:'response.chunk',response_id:'r2',chunk:{text:{channel:'CHANNEL_ASSISTANT_RESPONSE',text:'second answer'}}});
  assert.deepEqual(h.config.scrapeHistory().map(m=>[m.role,m.content]),[['user','same'],['assistant','first answer'],['user','same'],['assistant','second answer']]);
  h.setDOM([{role:'user',content:'same'},{role:'assistant',content:'first truncated'},{role:'user',content:'same'},{role:'assistant',content:'second'}]);
  assert.equal(h.config.scrapeHistory().at(-1).content,'second answer');
  assert.equal(h.config.scrapeHistory().filter(m=>m.role==='assistant').length,2);
});
test('virtualized DOM cannot append an old repeated prompt after the newest network answer',async()=>{
  const h=harness();
  h.setDOM([{role:'user',content:'same'},{role:'assistant',content:'older native answer'}]);
  h.source.begin('same',{baselineOccurrences:1});await h.request();
  await h.send({type:'response.chunk',response_id:'short',chunk:{text:{channel:'CHANNEL_ASSISTANT_RESPONSE',text:'short answer'}}});
  await h.send({type:'response.done',response:{id:'short',status:'completed'}});
  h.source.begin('long question',{baselineOccurrences:0});await h.request();
  h.setDOM([{role:'user',content:'long question'},{role:'assistant',content:'long partial'}]);
  await h.send({type:'response.chunk',response_id:'long',chunk:{text:{channel:'CHANNEL_ASSISTANT_RESPONSE',text:'long complete answer'}}});
  const history=h.config.scrapeHistory();
  assert.equal(history.at(-1).content,'long complete answer');
  assert.deepEqual(history.filter(m=>m.role==='user').map(m=>m.content),['same','same','long question']);
  // A previously unrendered old occurrence can reappear after the send, while
  // the current user bubble still has not rendered. It is not a native suffix.
  h.setDOM([{role:'user',content:'long question'},{role:'assistant',content:'old long answer'},{role:'user',content:'same'},{role:'assistant',content:'short answer'}]);
  assert.equal(h.config.scrapeHistory().at(-1).content,'long complete answer');
});
test('a native request after a completed extension turn restores the original DOM history',async()=>{
  const h=harness();h.source.begin('q',{});await h.request();
  await h.send({type:'response.chunk',response_id:'r',chunk:{text:{channel:'CHANNEL_ASSISTANT_RESPONSE',text:'network answer'}}});
  await h.send({type:'response.done',response:{id:'r',status:'completed'}});
  const dom=[{role:'user',content:'native question'},{role:'assistant',content:'native answer'}];
  h.setDOM(dom);await h.request();
  await h.send({type:'response.created',response:{id:'native-turn'}});
  assert.equal(h.source.snapshot(),null);
  assert.equal(h.config.scrapeHistory(),dom);
});
test('Gemini post-completion channel acknowledgements cannot erase the completed network answer',async()=>{
  const f=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/network/gemini.json'),'utf8'));
  const config={id:'gemini',scrapeHistory:()=>[]},source=createSource(config,utils,()=>{},parsers);
  source.begin('q',{});
  await source.accept({provider:'gemini',transport:'gemini-channel',streamId:'post',phase:'request'});
  for(const data of f.packets)await source.accept({provider:'gemini',transport:'gemini-channel',streamId:'get',phase:'data',data});
  assert.equal(source.snapshot()?.complete,true);
  await source.accept({provider:'gemini',transport:'gemini-channel',streamId:'ack',phase:'request'});
  assert.equal(source.snapshot()?.text,f.expected);
  assert.equal(config.scrapeHistory().at(-1).content,f.expected);
});
test('disabled, absent and unknown network data retain the unchanged DOM fallback',async()=>{
  for(const enabled of [false,true]) {
    const h=harness(enabled),dom=[{role:'user',content:'q'},{role:'assistant',content:'DOM fallback answer'}];
    h.setDOM(dom);h.source.begin('q',{baselineOccurrences:0});await h.request();
    await h.send({type:'unknown.future_protocol',text:'untrusted'});
    assert.equal(h.config.scrapeHistory(),dom);
    assert.equal(h.source.snapshot(),null);
  }
});
test('a working network answer does not depend on a readable or stable DOM',async()=>{
  let broken=false;
  const config={id:'grok',scrapeHistory:()=>{if(broken)throw Error('DOM is unavailable');return [];}};
  const source=createSource(config,utils,()=>{},parsers);source.begin('q',{});
  await source.accept({provider:'grok',transport:'grok-ws',streamId:'ws',phase:'request'});
  await source.accept({provider:'grok',transport:'grok-ws',streamId:'ws',phase:'data',data:JSON.stringify({event:{type:'response.chunk',response_id:'r',chunk:{text:{channel:'CHANNEL_ASSISTANT_RESPONSE',text:'network answer'}}}})});
  broken=true;
  assert.equal(config.scrapeHistory().at(-1).content,'network answer');
});
test('cancelled and queued pre-send packets cannot publish into a new submission',async()=>{
  const h=harness();h.source.begin('old',{});await h.request();
  const old=h.send({type:'response.created',response:{id:'old'}});
  h.source.cancel();h.source.begin('new',{});await old;
  await h.request();
  await h.send({type:'response.chunk',response_id:'old',chunk:{text:{channel:'CHANNEL_ASSISTANT_RESPONSE',text:'late old answer'}}});
  assert.equal(h.source.snapshot(),null);
});
test('a failed network stream returns ownership to the DOM instead of freezing a partial answer',async()=>{
  const h=harness();h.source.begin('q',{});await h.request();
  await h.send({type:'response.chunk',response_id:'r',chunk:{text:{channel:'CHANNEL_ASSISTANT_RESPONSE',text:'partial'}}});
  assert.equal(h.source.snapshot().text,'partial');
  h.setDOM([{role:'user',content:'q'},{role:'assistant',content:'DOM recovered full answer'}]);
  await h.source.accept({provider:'grok',transport:'grok-ws',streamId:'ws',phase:'error'});
  assert.equal(h.source.snapshot(),null);
  assert.equal(h.config.scrapeHistory().at(-1).content,'DOM recovered full answer');
});
test('navigating to a different completed conversation clears network overlays',async()=>{
  const h=harness();h.source.begin('q',{});await h.request();
  await h.send({type:'response.chunk',response_id:'r',chunk:{text:{channel:'CHANNEL_ASSISTANT_RESPONSE',text:'old answer'}}});
  await h.send({type:'response.done',response:{id:'r',status:'completed'}});
  h.source.navigate('https://grok.com/c/second','https://grok.com/c/first');
  h.setDOM([{role:'user',content:'different conversation'}]);
  assert.equal(h.source.snapshot(),null);
  assert.equal(h.config.scrapeHistory().length,1);
});
test('only this frame and origin can feed the isolated bridge',async()=>{
  const window={AIZooUtils:utils,AIZooNetworkParsers:parsers,addEventListener(_type,cb){this.listener=cb;}};
  const config={id:'grok',scrapeHistory:()=>[]};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../content-scripts/network-source.js'),'utf8'),{window,location:{origin:'https://grok.com'},ArrayBuffer,URL});
  window.AIZooNetworkSource.install(config);
  const source=window.__aiNetworkSources.grok;source.begin('q',{});
  const packets=[{phase:'request'},{phase:'data',data:JSON.stringify({event:{type:'response.chunk',response_id:'r',chunk:{text:{channel:'CHANNEL_ASSISTANT_RESPONSE',text:'injected'}}}})}];
  for(const bad of [{source:{},origin:'https://grok.com'},{source:window,origin:'https://evil.invalid'}])for(const p of packets)window.listener({...bad,data:{source:'ai-zoo-network-v1',provider:'grok',transport:'grok-ws',streamId:'ws',...p}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(source.snapshot(),null);
});
test('every provider loads one MAIN observer and parser/bridge before its isolated adapter',()=>{
  const m=require('../manifest.json');
  const main=m.content_scripts.filter(s=>s.world==='MAIN');
  assert.equal(main.length,1);
  assert.equal(main[0].run_at,'document_start');
  for(const domain of ['grok.com','gemini.google.com','claude.ai','chatgpt.com','www.meta.ai'])assert.ok(main[0].matches.includes('*://'+domain+'/*'));
  for(const s of m.content_scripts.filter(s=>s.world!=='MAIN')) {
    assert.ok(s.js.indexOf('content-scripts/network-parsers.js')<s.js.indexOf('content-scripts/network-source.js'));
    assert.ok(s.js.indexOf('content-scripts/network-source.js')<s.js.indexOf('content-scripts/injection-core.js'));
  }
});
test('Claude thinking blocks cannot claim the submission before the real text block',async()=>{
  const f=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/network/claude-live-long.json'),'utf8'));
  const config={id:'claude',scrapeHistory:()=>[]},source=createSource(config,utils,()=>{},parsers);
  source.begin('q',{});
  await source.accept({provider:'claude',streamId:'action',transport:'claude-action',phase:'request'});
  for(const [i,data]of f.packets.entries())await source.accept({provider:'claude',streamId:f.streamIds?.[i]||'stream',transport:'claude-connect',phase:'data',data:new Uint8Array(Buffer.from(data,'base64'))});
  assert.equal(source.snapshot()?.text,f.expected);
  assert.equal(source.snapshot()?.complete,true);
});
test('Claude timeline subscription renewal does not discard an in-progress answer',async()=>{
  const f=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/network/claude-live-long.json'),'utf8'));
  const config={id:'claude',scrapeHistory:()=>[]},source=createSource(config,utils,()=>{},parsers);
  source.begin('q',{});
  await source.accept({provider:'claude',streamId:'action',transport:'claude-action',phase:'request'});
  let previous;
  for(const [i,data]of f.packets.entries()){
    const id=f.streamIds[i];
    if(previous&&previous!==id)await source.accept({provider:'claude',streamId:previous,transport:'claude-connect',phase:'end'});
    await source.accept({provider:'claude',streamId:id,transport:'claude-connect',phase:'data',data:new Uint8Array(Buffer.from(data,'base64'))});
    previous=id;
  }
  assert.equal(source.snapshot()?.text,f.expected);
  assert.equal(source.snapshot()?.complete,true);
});
test('network completion pushes existing lifecycle events without polling, DOM or quiet-time',async()=>{
  const events=[],intervals=new Map(),window={AIZooUtils:utils,postMessage:m=>events.push(m)};window.parent=window;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../content-scripts/injection-core.js'),'utf8'),{
    window,document:{body:{}},console:{log(){},error(){},warn(){}},Date,
    setInterval:cb=>{intervals.set(1,cb);return 1;},clearInterval:id=>intervals.delete(id)
  });
  const core=window.InjectionCore,config={id:'grok',scrapeHistory:()=>[],detectGenerating:()=>false};
  const source=createSource(config,utils,()=>window.__aiResponseLifecycleWatchers?.grok?.checkResponse(false),parsers);
  window.__aiNetworkSources={grok:source};
  source.begin('q',{submissionId:'now',baselineOccurrences:0});
  core.watchResponseLifecycle(config,'q',{submissionId:'now'});
  await source.accept({provider:'grok',transport:'grok-ws',streamId:'ws',phase:'request'});
  for(const event of [
    {type:'response.created',response:{id:'r'}},
    {type:'response.chunk',response_id:'r',chunk:{text:{channel:'CHANNEL_ASSISTANT_RESPONSE',text:'I will check the facts'}}},
    {type:'response.done',response:{id:'r',status:'completed'}}
  ])await source.accept({provider:'grok',transport:'grok-ws',streamId:'ws',phase:'data',data:JSON.stringify({event})});
  assert.equal(events.at(-1).type,'AI_RESPONSE_RECEIVED');
  assert.equal(events.at(-1).sourceKind,'network');
  assert.equal(events.at(-1).isComplete,true);
  assert.equal(events.at(-1).response,'I will check the facts');
  assert.equal(core.isGenerating(config),false);
  assert.equal(core.isResponseComplete(config),true);
  assert.equal(intervals.size,0);
});
test('silent network lease resumes DOM immediately and a later real packet recovers', async () => {
  const originalSet = global.setTimeout, originalClear = global.clearTimeout;
  const timers = new Map(); let next = 0;
  global.setTimeout = cb => { const id = ++next; timers.set(id, () => { timers.delete(id); cb(); }); return id; };
  global.clearTimeout = id => timers.delete(id);
  try {
    const h = harness(); h.source.begin('q', {}); await h.request();
    await h.send({ type: 'response.chunk', response_id: 'lease', chunk: { text: { channel: 'CHANNEL_ASSISTANT_RESPONSE', text: 'partial' } } });
    assert.equal(timers.size, 1);
    h.setDOM([{ role: 'assistant', content: 'DOM alive' }]);
    [...timers.values()][0](); assert.equal(h.source.snapshot(), null);
    assert.equal(h.config.scrapeHistory().at(-1).content, 'DOM alive');
    await h.send({ type: 'response.chunk', response_id: 'lease', chunk: { text: { channel: 'CHANNEL_ASSISTANT_RESPONSE', text: 'full real answer' } } });
    assert.equal(h.source.snapshot().text, 'partialfull real answer');
    h.source.setEnabled(false); assert.equal(h.source.snapshot(), null); assert.equal(timers.size, 0);
  } finally { global.setTimeout = originalSet; global.clearTimeout = originalClear; }
});
test('ChatGPT retains its native local conversation route before the hidden UI commits its URL', async () => {
  const config={id:'chatgpt',scrapeHistory:()=>[]},source=createSource(config,utils,()=>{},parsers),id='11111111-2222-3333-4444-555555555555';
  source.begin('q',{});await source.accept({provider:'chatgpt',transport:'chatgpt-ws',streamId:'ws',phase:'request',conversationId:id});
  await source.accept({provider:'chatgpt',transport:'chatgpt-ws',streamId:'ws',phase:'data',data:JSON.stringify({method:'item/completed',params:{turnId:'turn',item:{id:'item',type:'agentMessage',text:'real answer',phase:'final_answer'}}})});
  assert.equal(source.status().resumePath,'/local/'+id);
  source.cancel();assert.equal(source.status().resumePath,undefined);
});
