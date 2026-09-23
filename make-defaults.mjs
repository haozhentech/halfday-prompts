import {readFileSync,writeFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const context={}; context.window=context; vm.createContext(context);
// Only the supplied data declarations and pure prompt engine; no DOM, network or Node APIs.
for(const script of scripts.slice(0,4)) vm.runInContext(script,context,{timeout:1000});
const E=context.HalfdayEngine;
const strings=o=>Object.fromEntries(Object.entries(o).filter(([k,v])=>typeof v==='string'&&!['id','original_id','replace_for','sceneId','handheld'].includes(k)));
const byId=list=>Object.fromEntries(list.map(x=>[x.id,strings(x)]));
const defaults={products:byId(context.HALFDAY_PRODUCTS),scenes:Object.fromEntries(E.scenes.map(s=>[s.id,{name:s.name,desc:s.desc||'',text:s.scene(context.HALFDAY_PRODUCTS[0],'whole')}])),angles:byId(E.angleList),lights:byId(E.lightList),compositions:byId(E.compositions),flavors:byId(E.flavors),cuts:Object.fromEntries(Object.entries(E.guidance.cuts).map(([k,v])=>[k,strings(v)])),packaging:Object.fromEntries(Object.entries(E.guidance.packaging).map(([k,v])=>[k,strings(v)])),goldens:Object.fromEntries(Object.entries(E.guidance.goldens).map(([k,v])=>[k,{label:v.label,why:v.why}])),common:{global:{quality:E.quality,negative:E.negative}}};
writeFileSync(new URL('./defaults.json',import.meta.url),JSON.stringify(defaults,null,2)+'\n');
console.log(`Defaults: ${Object.keys(defaults.products).length} products, ${Object.keys(defaults.scenes).length} scenes`);
