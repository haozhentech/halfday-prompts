import http from 'node:http';
import {readFile,writeFile,mkdir,rename,readdir,unlink} from 'node:fs/promises';
import {createHash,timingSafeEqual,randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Script} from 'node:vm';

const root=path.dirname(fileURLToPath(import.meta.url));
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=(status,message)=>Object.assign(new Error(message),{status});
const scriptMarker="<script>\n(function(){\n'use strict';\nconst E=window.HalfdayEngine";

export function validateConfig(config,defaults){
  if(!config||typeof config!=='object'||Array.isArray(config)) throw fail(400,'提示词必须是对象');
  for(const [group,items] of Object.entries(config)){
    if(!Object.hasOwn(defaults,group)||!items||typeof items!=='object'||Array.isArray(items)) throw fail(400,'未知分类');
    for(const [id,fields] of Object.entries(items)){
      if(!Object.hasOwn(defaults[group],id)||!fields||typeof fields!=='object'||Array.isArray(fields)) throw fail(400,'未知条目');
      for(const [key,value] of Object.entries(fields)){
        if(!Object.hasOwn(defaults[group][id],key)||typeof value!=='string'||value.length>20000) throw fail(400,'字段无效或超过 20000 字');
        if(key==='name'&&!value.trim()) throw fail(400,'名称不能为空');
      }
    }
  }
}
export function validateHtml(html){
  if(typeof html==='string')html=html.replace(/\r\n/g,'\n');
  if(typeof html==='string'&&html.includes('function applyConfig(config)'))throw fail(400,'请上传源码中的 index.html，不要上传浏览器保存的线上页面');
  if(typeof html!=='string'||!html.includes(scriptMarker)||!html.includes('window.HALFDAY_PRODUCTS =')||!html.includes('root.HalfdayEngine=')) throw fail(400,'请上传兼容的完整 index.html');
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if(scripts.length<6) throw fail(400,'网页缺少必要脚本');
  try{for(const match of scripts)new Script(match[1]);}catch{throw fail(400,'网页 JavaScript 存在语法错误');}
  return html;
}
function applyConfig(config){
  const E=window.HalfdayEngine;
  const lists={products:window.HALFDAY_PRODUCTS,angles:E.angleList,lights:E.lightList,compositions:E.compositions,flavors:E.flavors};
  for(const [group,list] of Object.entries(lists))for(const item of list)Object.assign(item,config[group]?.[item.id]||{});
  for(const [id,fields] of Object.entries(config.scenes||{})){
    const scene=E.getScene(id); const {text,...rest}=fields; Object.assign(scene,rest);
    if(text!==undefined)scene.scene=()=>text;
  }
  for(const group of ['cuts','packaging','goldens'])for(const [id,fields] of Object.entries(config[group]||{}))Object.assign(E.guidance[group][id],fields);
  Object.assign(E,config.common?.global||{});
}
export function renderHtml(state){
  const json=JSON.stringify(state.config).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  const injection=`<script>(${applyConfig.toString()})(${json});</script>\n`;
  return state.html.replace(scriptMarker,injection+scriptMarker);
}
async function atomic(file,data){const temp=file+'.'+randomUUID()+'.tmp'; await writeFile(temp,data,{mode:0o600}); try{await rename(temp,file);}catch(error){await unlink(temp).catch(()=>{});throw error;}}

export async function createApp({dataDir=process.env.DATA_DIR||path.join(root,'data'),token=process.env.ADMIN_TOKEN}={}){
  if(!token||token.length<32)throw new Error('Set ADMIN_TOKEN to a random string of at least 32 characters');
  const defaults=JSON.parse(await readFile(path.join(root,'defaults.json'),'utf8'));
  await mkdir(path.join(dataDir,'history'),{recursive:true,mode:0o700});
  let state;
  try{state=JSON.parse(await readFile(path.join(dataDir,'state.json'),'utf8'));}
  catch(error){if(error.code!=='ENOENT')throw error;state={html:validateHtml(await readFile(path.join(root,'index.html'),'utf8')),config:{}};await atomic(path.join(dataDir,'state.json'),JSON.stringify(state));}
  state.html=validateHtml(state.html);validateConfig(state.config,defaults);
  const revision=()=>hash(JSON.stringify(state));
  let writing=false;
  const attempts=new Map();
  async function save(next){
    next={...next,html:validateHtml(next.html)};validateConfig(next.config,defaults);
    const filename=new Date().toISOString().replace(/[:.]/g,'-')+'-'+revision().slice(0,12)+'.json';
    await atomic(path.join(dataDir,'history',filename),JSON.stringify(state));
    await atomic(path.join(dataDir,'state.json'),JSON.stringify(next)); state=next;
  }
  async function body(req){
    let size=0;const chunks=[];
    for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw fail(413,'文件超过 2 MB');chunks.push(chunk);}
    return Buffer.concat(chunks).toString('utf8');
  }
  const tokenHash=Buffer.from(hash(token),'hex');
  const server=http.createServer(async(req,res)=>{
    const headers={'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"};
    const send=(status,data,type='application/json; charset=utf-8')=>{res.writeHead(status,{...headers,'Content-Type':type});res.end(type.startsWith('application/json')?JSON.stringify(data):data);};
    try{
      const url=new URL(req.url,'http://localhost');const route=url.pathname;
      if(route==='/api/health'&&req.method==='GET')return send(200,{ok:true});
      if(route.startsWith('/api/admin/')){
        const origin=req.headers.origin;
        if(origin&&new URL(origin).host!==req.headers.host)throw fail(403,'不接受跨站请求');
        const address=process.env.TRUST_CADDY==='1'?(req.headers['x-halfday-client-ip']||req.socket.remoteAddress):req.socket.remoteAddress;
        const now=Date.now();for(const [key,item]of attempts)if(item.until<=now)attempts.delete(key);
        const attempt=attempts.get(address);
        if(attempt&&attempt.count>=15)throw fail(429,'尝试过多，请 15 分钟后再试');
        const supplied=(req.headers.authorization||'').replace(/^Bearer /,'');
        if(!timingSafeEqual(Buffer.from(hash(supplied),'hex'),tokenHash)){
          if(attempts.size>10000)attempts.delete(attempts.keys().next().value);
          attempts.set(address,{count:(attempt?.count||0)+1,until:attempt?.until||now+15*60*1000});throw fail(401,'管理口令错误');
        }
        attempts.delete(address);
        if(req.method==='GET'&&route==='/api/admin/state')return send(200,{revision:revision(),config:state.config,defaults,history:(await readdir(path.join(dataDir,'history'))).filter(f=>/^[\w-]+\.json$/.test(f)).sort().reverse().slice(0,30)});
        if(!['PUT','POST'].includes(req.method))throw fail(405,'不支持的请求');
        // ponytail: one process and one writer; move to transactional storage before running multiple replicas.
        if(writing)throw fail(409,'另一个更新正在进行，请稍后重试');writing=true;
        try{
          if(req.headers['if-match']!==revision())throw fail(409,'页面版本已变化，请重新载入后再修改');
          const raw=await body(req);
          if(route==='/api/admin/config'&&req.method==='PUT'){
            let config;try{config=JSON.parse(raw);}catch{throw fail(400,'JSON 格式错误');}
            await save({...state,config});
          }else if(route==='/api/admin/interface'&&req.method==='PUT'){
            await save({html:validateHtml(raw.replace(/\r\n/g,'\n')),config:state.config});
          }else if(route==='/api/admin/rollback'&&req.method==='POST'){
            let filename;try{filename=JSON.parse(raw).filename;}catch{throw fail(400,'回退参数错误');}
            if(typeof filename!=='string'||!/^\d{4}-[\w-]+\.json$/.test(filename))throw fail(400,'无效历史版本');
            let previous;try{previous=JSON.parse(await readFile(path.join(dataDir,'history',filename),'utf8'));}catch{throw fail(404,'历史版本不存在');}
            await save(previous);
          }else throw fail(404,'接口不存在');
          return send(200,{ok:true,revision:revision()});
        }finally{writing=false;}
      }
      if(!['GET','HEAD'].includes(req.method))throw fail(405,'不支持的请求');
      if(route==='/'||route==='/index.html')return send(200,req.method==='HEAD'?'':renderHtml(state),'text/html; charset=utf-8');
      const files={'/admin/':['admin.html','text/html; charset=utf-8'],'/admin/admin.js':['admin.js','text/javascript; charset=utf-8'],'/admin/admin.css':['admin.css','text/css; charset=utf-8']};
      if(route==='/admin'){res.writeHead(302,{Location:'/admin/'});return res.end();}
      if(files[route]){
        headers['Content-Security-Policy']="default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
        headers['X-Robots-Tag']='noindex, nofollow';
        const [file,type]=files[route];return send(200,req.method==='HEAD'?'':await readFile(path.join(root,file),'utf8'),type);
      }
      if(route==='/robots.txt')return send(200,'User-agent: *\nDisallow: /admin/\nDisallow: /api/\n','text/plain; charset=utf-8');
      throw fail(404,'页面不存在');
    }catch(error){if(!res.headersSent)send(error.status||500,{error:error.status?error.message:'服务暂时不可用，请重试'});if(!error.status)console.error('Request failed:',error.code||error.name);}
  });
  server.requestTimeout=20000;server.headersTimeout=10000;
  return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const server=await createApp();server.listen(Number(process.env.PORT||4190),process.env.HOST||'0.0.0.0',()=>console.log('Halfday server listening',server.address().port));
}
