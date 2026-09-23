import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createApp,validateConfig} from './server.mjs';
const token='test-only-admin-token-not-for-deployment-123456';

test('public prompt engine, authenticated updates, conflict, persistence and rollback',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'halfday-test-'));
 let server=await createApp({dataDir:dir,token});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let base=`http://127.0.0.1:${server.address().port}`;
 const getState=async()=>{const r=await fetch(base+'/api/admin/state',{headers:{Authorization:'Bearer '+token}});assert.equal(r.status,200);return r.json();};
 const change=async(route,revision,body,method='PUT',extra={})=>fetch(base+'/api/admin/'+route,{method,headers:{Authorization:'Bearer '+token,'If-Match':revision,'Content-Type':'application/json',...extra},body:typeof body==='string'?body:JSON.stringify(body)});
 try{
  assert.equal((await fetch(base+'/api/admin/state')).status,401);
  assert.equal((await fetch(base+'/data/state.json')).status,404);
  assert.equal((await fetch(base+'/.env')).status,404);
  const initial=await getState();assert.equal(Object.keys(initial.defaults.products).length,64);assert.equal(Object.keys(initial.defaults.scenes).length,36);
  const initialHtml=await(await fetch(base+'/')).text();
  const context={};context.window=context;vm.createContext(context);
  const scripts=[...initialHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
  for(const script of scripts.slice(0,-1))vm.runInContext(script,context,{timeout:1000});
  assert.equal(context.HalfdayEngine.scenes.length,36);
  assert.ok(context.HalfdayEngine.combinationCount()>0);
  for(const s of context.HalfdayEngine.scenes){const g=context.HalfdayEngine.guidance.goldens[s.id];assert.ok(s.allowedAngles.includes(g.angle),s.id+' angle');assert.ok(s.allowedLights.includes(g.light),s.id+' light');}
  const text='发布测试 </script><script>window.unwanted=true</script>';
  const config={products:{'01':{name:text}},common:{global:{quality:'测试摄影质量要求'}}};
  assert.equal((await change('config',initial.revision,config,'PUT',{Origin:'https://unrelated.example'})).status,403);
  assert.equal((await change('config',initial.revision,{products:{bad:{name:'x'}}})).status,400);
  assert.equal((await change('config',initial.revision,config)).status,200);
  assert.equal((await change('config',initial.revision,{})).status,409);
  const updated=await getState();assert.equal(updated.config.products['01'].name,text);assert.equal(updated.history.length,1);
  const changedHtml=await(await fetch(base+'/')).text();assert.ok(!changedHtml.includes('</script><script>window.unwanted'));
  const rendered={};rendered.window=rendered;vm.createContext(rendered);
  for(const m of [...changedHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].slice(0,-1))vm.runInContext(m[1],rendered,{timeout:1000});
  assert.equal(rendered.HALFDAY_PRODUCTS[0].name,text);assert.equal(rendered.HalfdayEngine.quality,'测试摄影质量要求');assert.equal(rendered.unwanted,undefined);
  assert.equal((await change('interface',updated.revision,'<html>broken</html>')).status,400);
  assert.equal((await change('rollback',updated.revision,{filename:'../../state.json'},'POST')).status,400);
  await new Promise(r=>server.close(r));server=await createApp({dataDir:dir,token});await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await getState()).config.products['01'].name,text);
  assert.equal((await change('rollback',updated.revision,{filename:updated.history[0]},'POST')).status,200);
  assert.deepEqual((await getState()).config,{});
  const current=await getState();
  // Upload the original source, not an already injected server response.
  const source=await readFile(new URL('./index.html',import.meta.url),'utf8');
  assert.equal((await change('interface',current.revision,source.replace('<title>','<title>测试版 · '))).status,200);
  assert.match(await(await fetch(base+'/')).text(),/<title>测试版/);
  assert.throws(()=>validateConfig(JSON.parse('{"__proto__":{}}'),initial.defaults));
 }finally{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
