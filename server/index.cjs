'use strict';
const http=require('node:http'),path=require('node:path'),fs=require('node:fs/promises'),{openStore}=require('./store.cjs'),{PlannerService,id,clean}=require('./service.cjs'),A=require('./auth.cjs');
const API='/api/load-planner',ROOT=path.resolve(__dirname,'..');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.jpg':'image/jpeg'};
async function body(req,limit=12*1024*1024,binary=false){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw A.error(413,'文件或请求内容过大');chunks.push(chunk);}const buffer=Buffer.concat(chunks);if(binary)return buffer;try{const value=JSON.parse(buffer.toString('utf8')||'{}');if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw A.error(400,'请求须为 JSON 对象');}}
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
async function createApp({env=process.env,store:provided,authenticate:providedAuth,startQueue=true}={}){
 const store=provided||await openStore({databaseUrl:env.DATABASE_URL,sqlitePath:env.PLANNER_SQLITE_PATH||path.join(ROOT,'data/planner.sqlite')}),authenticate=providedAuth||A.authenticator(env),service=new PlannerService(store,{timeoutMs:Number(env.PLANNER_JOB_TIMEOUT_MS)||60000,memoryMb:Number(env.PLANNER_WORKER_MEMORY_MB)||256});
 const attachmentsDir=path.resolve(env.PLANNER_ATTACHMENTS_DIR||path.join(ROOT,'data/attachments')),origins=(env.PLANNER_ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean);
 if(startQueue)service.start();
 const server=http.createServer(async(req,res)=>{
  const requestId=id();res.setHeader('X-Request-Id',requestId);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
  try{
   const url=new URL(req.url,'http://localhost'),route=decodeURIComponent(url.pathname),origin=req.headers.origin;
   const sameOrigin=origin&&new URL(origin).host===req.headers.host;
   if(origin&&!sameOrigin&&!origins.includes(origin))throw A.error(403,'此页面来源未获服务端允许');
   if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, X-Operation-Id');res.setHeader('Access-Control-Allow-Methods','GET, POST, PUT, OPTIONS');}
   if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
   if(route===API+'/health'){json(res,200,{ok:true,version:'3.3.0',authMode:env.PLANNER_AUTH_MODE||'erp'});return;}
   if(route.startsWith(API+'/')){
    const user=await authenticate(req);let match;
    if(route===API+'/me'&&req.method==='GET'){json(res,200,user);return;}
    if(route===API+'/projects'&&req.method==='GET'){const result=await store.transaction(async tx=>(await tx.list('project')).filter(p=>A.canAccess(user,p)).map(p=>({id:p.id,name:p.project.name,context:p.project.context||{},revision:p._revision,updatedBy:p.updatedBy})));json(res,200,{projects:result});return;}
    if(route===API+'/projects'&&req.method==='POST'){json(res,201,await service.save(user,await body(req)));return;}
    if((match=/^\/projects\/([^/]+)$/.exec(route.slice(API.length)))){
     if(req.method==='GET'){const p=await store.transaction(tx=>service.project(tx,user,match[1]));json(res,200,{id:p.id,project:p.project,revision:p._revision,currentResult:p.currentResult||null});return;}
     if(req.method==='PUT'){json(res,200,await service.save(user,await body(req),match[1]));return;}
    }
    if((match=/^\/projects\/([^/]+)\/(events|confirm|jobs|layout)$/.exec(route.slice(API.length)))&&req.method==='POST'){
     const payload=await body(req),fn=match[2]==='events'?'events':match[2]==='confirm'?'confirm':match[2]==='layout'?'saveLayout':'submit';json(res,match[2]==='jobs'?202:200,await service[fn](user,match[1],payload));return;
    }
    if((match=/^\/jobs\/([^/]+)(\/cancel)?$/.exec(route.slice(API.length)))){
     if(req.method==='GET'&&!match[2]){json(res,200,await service.job(user,match[1]));return;}
     if(req.method==='POST'&&match[2]){json(res,200,await service.cancel(user,match[1],await body(req)));return;}
    }
    if(route===API+'/experience'&&req.method==='GET'){json(res,200,await store.transaction(tx=>service.experience(tx,user)));return;}
    if(route===API+'/cases'&&req.method==='GET'){json(res,200,{cases:await store.transaction(tx=>service.evidence(tx,user))});return;}
    if((match=/^\/cases\/([^/]+)\/(feedback|status)$/.exec(route.slice(API.length)))&&req.method==='POST'){json(res,200,await service[match[2]==='feedback'?'feedback':'caseStatus'](user,match[1],await body(req)));return;}
    if(route===API+'/policies'&&req.method==='GET'){
     if(!A.manager(user))throw A.error(403,'需要生产规则负责人权限');
     json(res,200,await store.transaction(async tx=>({candidates:(await tx.list('policy_candidate')).map(clean),versions:(await tx.list('policy_version')).map(clean),active:(await tx.get('active-policy'))?.policyId||null})));return;
    }
    if(route===API+'/policies/candidates'&&req.method==='POST'){json(res,200,await service.candidate(user,await body(req)));return;}
    if((match=/^\/policies\/([^/]+)\/(publish|rollback)$/.exec(route.slice(API.length)))&&req.method==='POST'){json(res,200,await service.activate(user,match[1],await body(req),{rollback:match[2]==='rollback'}));return;}
    if((match=/^\/cases\/([^/]+)\/attachments$/.exec(route.slice(API.length)))&&req.method==='POST'){
     const caseId=match[1],record=await store.transaction(async tx=>{const c=await tx.get('case:'+caseId);if(!c)throw A.error(404,'确认版本不存在');await service.project(tx,user,c.projectId);return c;});
     const type=(req.headers['content-type']||'').split(';')[0],extensions={'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp'};
     if(!extensions[type])throw A.error(415,'照片仅支持 JPG、PNG、WebP');
     const bytes=await body(req,8*1024*1024,true),valid=type==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
     if(!valid)throw A.error(415,'照片内容与格式不一致');
     const attachmentId=id(),filename=attachmentId+extensions[type],target=path.join(attachmentsDir,filename);await fs.mkdir(attachmentsDir,{recursive:true});await fs.writeFile(target,bytes,{flag:'wx',mode:0o600});
     try{await store.transaction(tx=>tx.insert('attachment','attachment:'+attachmentId,record.projectId,user.id,{id:attachmentId,projectId:record.projectId,caseId,filename,contentType:type,size:bytes.length,createdAt:new Date().toISOString()}));}catch(e){await fs.unlink(target);throw e;}
     json(res,201,{id:attachmentId,size:bytes.length});return;
    }
    if((match=/^\/attachments\/([^/]+)$/.exec(route.slice(API.length)))&&req.method==='GET'){
     const record=await store.transaction(async tx=>{const a=await tx.get('attachment:'+match[1]);if(!a)throw A.error(404,'照片不存在');await service.project(tx,user,a.projectId);return a;});
     const bytes=await fs.readFile(path.join(attachmentsDir,path.basename(record.filename)));res.writeHead(200,{'Content-Type':record.contentType,'Content-Length':bytes.length,'Cache-Control':'private, no-store'});res.end(bytes);return;
    }
    throw A.error(404,'接口不存在');
   }
   if(!['GET','HEAD'].includes(req.method))throw A.error(405,'不支持此请求方式');
   let relative=route.replace(/^\/load-planner(?=\/|$)/,'');if(relative==='/'||relative===''){res.writeHead(302,{Location:(route.startsWith('/load-planner')?'/load-planner':'')+'/v3/'});res.end();return;}
   if(relative.endsWith('/'))relative+='index.html';if(!/^\/(v3|js|css)\//.test(relative))throw A.error(404,'页面不存在');
   const file=path.resolve(ROOT,'.'+relative);if(!file.startsWith(ROOT+path.sep)||!MIME[path.extname(file)])throw A.error(404,'页面不存在');
   const bytes=await fs.readFile(file);res.writeHead(200,{'Content-Type':MIME[path.extname(file)],'Cache-Control':'no-cache','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; worker-src 'self' blob:; frame-ancestors 'self'"});res.end(req.method==='HEAD'?undefined:bytes);
  }catch(e){if(res.headersSent){res.end();return;}const status=e.status||(['ENOENT','ENOTDIR'].includes(e.code)?404:500);if(status>=500)console.error(JSON.stringify({requestId,error:'request_failed',code:e.code||'internal'}));json(res,status,{error:status>=500?'服务暂时不可用，请稍后重试':e.message,requestId});}
 });
 return {server,store,service,async close(){await service.stop();await new Promise(resolve=>server.listening?server.close(resolve):resolve());await store.close();}};
}
if(require.main===module){
 createApp().then(app=>{const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT)||8787;app.server.listen(port,host,()=>console.log('SUPER U learning planner listening on '+host+':'+port));for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.close().then(()=>process.exit(0)));}).catch(e=>{console.error(e.message);process.exitCode=1;});
}
module.exports={createApp};
