'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {classifyGrokAuthResponse}=require('../content-scripts/shared-utils');
test('Grok block status is visible even outside an active submission',()=>{
  const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
  const source=fs.readFileSync(path.join(__dirname,'../popup.js'),'utf8');
  const start=source.indexOf('function handleMessage('),end=source.indexOf('\nfunction ',start+1);
  const typesStart=source.indexOf('const SUBMISSION_LIFECYCLE_TYPES'),typesEnd=source.indexOf(']);',typesStart)+3;
  let shown;
  const context={isPlatformEnabled:()=>true,isCurrentSubmissionEvent:()=>false,console:{log(){}},updateStatus:(...args)=>shown=args};
  vm.createContext(context);vm.runInContext(source.slice(typesStart,typesEnd)+'\n'+source.slice(start,end),context);
  context.handleMessage({data:{source:'content-script',type:'AI_BLOCKED',platform:'grok',message:'Needs verification'}});
  assert.deepEqual(shown,['grok','⚠️','Needs verification']);
});
test('Grok distinguishes challenge/forbidden from confirmed logout',async()=>{
  for(const [status,type,body,expected] of [
    [403,'text/html','<title>Just a moment...</title> Cloudflare','blocked'],
    [403,'application/json','{"error":"Forbidden"}','blocked'],
    [403,'application/json','{"status":"unauthenticated"}','logged-out'],
    [401,'application/json','{}','logged-out'],
    [401,'text/html','/cdn-cgi/challenge-platform/','blocked'],
    [200,'application/json','{"status":"authenticated","session":{}}','authenticated'],
    [200,'application/json','{"status":"unauthenticated"}','logged-out'],
    [200,'text/html','unknown HTML','unknown'],
    [503,'text/html','Cloudflare challenge-platform','blocked']
  ]) {
    const response=new Response(body,{status,headers:{'content-type':type}});
    assert.equal(await classifyGrokAuthResponse(response),expected,`${status} ${body}`);
    assert.equal(await response.text(),body,'classification must not consume caller body');
  }
  assert.equal(await classifyGrokAuthResponse(new Response('{}',{headers:{'cf-mitigated':'challenge'}})),'blocked');
});
