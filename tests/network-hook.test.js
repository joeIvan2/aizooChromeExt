'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../content-scripts/network-hook.js'),'utf8');
function harness(host='grok.com',failBridge=false,freezeHistory=false) {
  const messages=[], sockets=[],requests=[];
  class Socket extends EventTarget {
    static OPEN=1;
    constructor(...args){super();this.args=args;sockets.push(this);this.binaryType='blob';}
    send(data){this.lastSent=data;return 'native-send';}
  }
  class XHR extends EventTarget {
    open(...args){this.args=args;return 'native-open';}
    send(data){this.body=data;return 'native-xhr-send';}
  }
  const window={WebSocket:Socket,XMLHttpRequest:XHR,fetch:async (...args)=>{
    requests.push(args);return new Response(new Uint8Array([0,255,1,128]));
  },postMessage:data=>{if(failBridge)throw Error('bridge unavailable');messages.push(data);}};
  window.history={pushState(...args){this.last=args;return 'native-push';},replaceState(...args){this.last=args;return 'native-replace';}};
  if(freezeHistory)Object.freeze(window.history);
  window.self=window;window.parent={};window.top=window.parent;
  const context={window,location:{hostname:host,href:'https://'+host+'/'},URL,Request,Response,Blob,ArrayBuffer,Uint8Array,TextEncoder,Promise,Reflect,Proxy,WeakMap};
  vm.runInNewContext(source,context);
  return {window,messages,sockets,requests,Socket,XHR,context};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('MAIN hook preserves native WebSocket behavior and forwards only allowlisted answer fields',async()=>{
  const h=harness(),WS=h.window.WebSocket;
  assert.equal(WS.OPEN,1);
  assert.throws(()=>WS('wss://grok.com/ws/mgw/'),TypeError);
  const ws=new WS('wss://grok.com/ws/mgw/?token=secret');
  assert.ok(ws instanceof h.Socket);assert.ok(ws instanceof WS);
  assert.equal(ws.binaryType,'blob');
  assert.equal(ws.send(JSON.stringify({event:{type:'response.create'},castle_request_token:'secret'})),'native-send');
  const event={type:'response.chunk',response_id:'answer',event_id:'a',chunk:{text:{channel:'CHANNEL_ASSISTANT_RESPONSE',text:'pong'}},resume_conversation_token:'secret'};
  ws.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({event,token:'secret'})}));
  ws.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({event:{type:'conversation.history.item',title:'private title'}})}));
  await flush();
  assert.equal(h.messages.filter(m=>m.phase==='data').length,1);
  assert.equal(JSON.stringify(h.messages).includes('secret'),false);
  assert.equal(JSON.stringify(h.messages).includes('private title'),false);
  assert.equal(JSON.stringify(h.messages).includes('wss:'),false,'no query/URL crosses bridge');
  vm.runInNewContext(source,h.context);
  assert.equal(h.window.WebSocket,WS,'idempotent');
});
test('fetch observes clone bytes without consuming or changing the page response',async()=>{
  const h=harness('claude.ai');h.window.AIZooPageCapture.install('claude');
  const response=await h.window.fetch(new URL('https://claude.ai/claudeai-rpc/anthropic.bard.api.v1alpha.ConversationService/StreamTimeline'),{method:'POST'});
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[0,255,1,128]);
  await flush();
  const packet=h.messages.find(m=>m.phase==='data');
  assert.deepEqual([...packet.data],[0,255,1,128]);
  assert.equal(packet.transport,'claude-connect');
});
test('hook failures pass through; unrelated requests are not observed',async()=>{
  const h=harness('grok.com',true);
  const response=await h.window.fetch('https://grok.com/api/auth/session');
  assert.equal(response.status,200);
  const ws=new h.window.WebSocket('wss://grok.com/ws/mgw/');
  assert.equal(ws.send(JSON.stringify({event:{type:'response.create'}})),'native-send');
  ws.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({event:{type:'response.done',response:{id:'one',status:'completed'}}})}));
  await flush();
  assert.equal(h.requests.length,1);
  assert.equal(h.messages.length,0);
});
test('XHR observes incremental text once and leaves native calls and events intact',()=>{
  const h=harness('gemini.google.com');const xhr=new h.window.XMLHttpRequest();
  assert.equal(xhr.open('GET','https://geminiweb-pa.clients6.google.com/v1/processSession?SID=secret'),'native-open');
  assert.equal(xhr.send(),'native-xhr-send');xhr.responseType='';
  xhr.responseText='part';xhr.dispatchEvent(new Event('progress'));
  xhr.responseText='partial';xhr.dispatchEvent(new Event('progress'));xhr.dispatchEvent(new Event('loadend'));
  assert.deepEqual(h.messages.filter(m=>m.phase==='data').map(m=>m.data),['part','ial']);
  assert.equal(JSON.stringify(h.messages).includes('secret'),false);
});
test('Meta Blob conversion preserves incoming frame order without changing binaryType',async()=>{
  const h=harness('www.meta.ai'),ws=new h.window.WebSocket('wss://gateway.meta.ai/ws/clippy?token=secret');
  ws.dispatchEvent(new MessageEvent('message',{data:new Blob([new Uint8Array([13,0,0,2,0,0,1,0])])}));
  ws.dispatchEvent(new MessageEvent('message',{data:new Uint8Array([13,0,0,2,0,0,2,0]).buffer}));
  await flush();await flush();
  assert.deepEqual(h.messages.filter(m=>m.phase==='data').map(m=>m.data[6]),[1,2]);
  assert.equal(ws.binaryType,'blob');
});
test('Gemini failed XHR forwards only status and challenge flag, never response or headers', () => {
  const h = harness('gemini.google.com'), xhr = new h.window.XMLHttpRequest();
  xhr.open('POST', 'https://geminiweb-pa.clients6.google.com/v1/processSession');
  xhr.send(); xhr.status = 429; xhr.responseType = ''; xhr.responseText = 'sensitive error body';
  xhr.getResponseHeader = () => null; xhr.dispatchEvent(new Event('loadend'));
  const error = h.messages.find(m => m.phase === 'error');
  assert.equal(error?.status, 429);
  assert.equal(JSON.stringify(h.messages).includes('sensitive'), false);
  const binary = new h.window.XMLHttpRequest();
  binary.open('POST', 'https://geminiweb-pa.clients6.google.com/v1/processSession');binary.send();
  binary.status = 403; binary.responseType = 'arraybuffer'; binary.response = new Uint8Array([1,2,3]).buffer;
  binary.dispatchEvent(new Event('loadend'));
  assert.equal(h.messages.filter(m => m.phase === 'data').length, 0, 'error bodies stay in the page');
});
test('native SPA navigation signals are immediate and contain no URL, query or state', () => {
  const h=harness('chatgpt.com');
  assert.equal(h.window.history.pushState({secret:'not-forwarded'},'', '/c/private-id?token=not-forwarded'),'native-push');
  const pulse=h.messages.find(m=>m.source==='ai-zoo-page-state-v1');
  assert.equal(pulse?.kind,'navigation');assert.equal(pulse?.provider,'chatgpt');
  assert.equal(JSON.stringify(h.messages).includes('not-forwarded'),false);
  const failed=harness('chatgpt.com',true);assert.equal(failed.window.history.replaceState({},'', '/'),'native-replace');
});
test('a frozen History API cannot prevent transparent network observation', async () => {
  const h=harness('grok.com',false,true),ws=new h.window.WebSocket('wss://grok.com/ws/mgw/');
  ws.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({event:{type:'response.done',response:{id:'one',status:'completed'}}})}));
  await flush();assert.ok(h.messages.some(m=>m.phase==='data'));
});
test('ChatGPT forwards only a validated native conversation ID for UI-independent resume', () => {
  const h=harness('chatgpt.com'),ws=new h.window.WebSocket('wss://codex-cloud-backend.chatgpt.com/');
  const id='11111111-2222-3333-4444-555555555555';
  ws.send(JSON.stringify({method:'turn/addUserMessage',params:{threadId:id,input:'not-forwarded',token:'not-forwarded'}}));
  assert.equal(h.messages.find(m=>m.phase==='request')?.conversationId,id);
  assert.equal(JSON.stringify(h.messages).includes('not-forwarded'),false);
});
