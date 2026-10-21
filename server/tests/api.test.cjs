'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../index.cjs'),{openStore}=require('../store.cjs'),A=require('../auth.cjs'),C=require('../../v3/core.js'),B=require('../../v3/bridge.js'),P=require('../../v3/layout.js');
const uid=()=>crypto.randomUUID();
function project(){const p=B.empty();p.context={erpProjectId:'erp-1',batchId:'shipment-1'};p.cargos=[{id:'base',name:'底箱',l:1200,w:800,h:500,qty:1,weight:50,rotateMode:'upright',stackable:true,topLoad:100,maxLayers:2},{id:'cap',name:'顶箱',l:600,w:800,h:300,qty:2,weight:10,rotateMode:'upright',stackable:false,topLoad:0,maxLayers:1}];p.groups=[{id:'g',name:'一托二',allowRotate:true,children:[{uid:'base#1',x:0,y:0,z:0,orientation:0},{uid:'cap#1',x:0,y:0,z:500,orientation:0},{uid:'cap#2',x:600,y:0,z:500,orientation:0}]}];return p;}
async function setup(t,{startQueue=true}={}){
 const users={admin:A.identity({id:'admin',name:'负责人',roles:['admin'],allProjects:true}),planner:A.identity({id:'planner',name:'排柜员',roles:['planner'],projectIds:['erp-1']}),viewer:A.identity({id:'viewer',roles:['viewer'],projectIds:['erp-1']}),outsider:A.identity({id:'outsider',roles:['viewer'],projectIds:['erp-2']})};
 const store=await openStore({sqlitePath:':memory:'}),app=await createApp({store,startQueue,env:{},authenticate:async req=>{const user=users[(req.headers.authorization||'').replace('Bearer ','')];if(!user)throw A.error(401,'unauthorized');return user;}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());const base='http://127.0.0.1:'+app.server.address().port+'/api/load-planner';
 async function call(route,method='GET',payload,who='admin'){const response=await fetch(base+route,{method,headers:{Authorization:'Bearer '+who,...(payload?{'Content-Type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined});return {status:response.status,body:await response.json()};}
 async function save(p,expectedRevision=0,who='admin',opId=uid()){return call(expectedRevision?'/projects/'+p.id:'/projects',expectedRevision?'PUT':'POST',{opId,project:p,expectedRevision},who);}
 async function packed(p){const saved=await save(p);assert.equal(saved.status,201);const job=await call('/projects/'+p.id+'/jobs','POST',{opId:uid(),expectedRevision:1});assert.equal(job.status,202);for(let i=0;i<150;i++){const r=await call('/jobs/'+job.body.id);if(r.body.state==='completed')return {result:r.body.result,jobId:job.body.id};if(r.body.state==='failed')throw Error(r.body.error);await new Promise(r=>setTimeout(r,20));}throw Error('job timeout');}
 return {app,store,call,save,packed,base};
}
test('API 拒绝未认证、越权项目和查看者写入，忽略客户端身份字段',async t=>{
 const {call,save}=await setup(t),p=project();assert.equal((await call('/projects','GET',null,'missing')).status,401);assert.equal((await save(p,0,'planner')).status,201);assert.equal((await call('/projects/'+p.id,'GET',null,'outsider')).status,403);assert.equal((await call('/projects','GET',null,'outsider')).body.projects.length,0);assert.equal((await save(p,1,'viewer')).status,403);
 const invalid=project();invalid.context.erpProjectId='erp-2';assert.equal((await save(invalid,0,'planner')).status,403);
});
test('保存请求幂等；两人使用同一修订保存时只有一方成功',async t=>{
 const {save,store}=await setup(t),p=project(),op=uid(),first=await save(p,0,'planner',op),duplicate=await save(p,0,'planner',op);assert.deepEqual(duplicate.body,first.body);
 assert.equal((await store.transaction(tx=>tx.list('project_version'))).length,1);
 const a=C.clone(p),b=C.clone(p);a.name='A修改';b.name='B修改';const result=await Promise.all([save(a,1,'planner'),save(b,1,'admin')]);assert.deepEqual(result.map(r=>r.status).sort(),[200,409]);
});
test('后台计算和服务端复核保持组合规则；确认无需理由且不重复计样本',async t=>{
 const {call,packed}=await setup(t),p=project(),{result,jobId}=await packed(p);assert.equal(result.audit.ok,true);const final=P.move(p,result,'g:g',{x:1800});
 const layoutPayload={opId:uid(),expectedRevision:1,result:final},layout=await call('/projects/'+p.id+'/layout','POST',layoutPayload);assert.equal(layout.status,200);assert.deepEqual((await call('/projects/'+p.id+'/layout','POST',layoutPayload)).body,layout.body);
 const payload={opId:uid(),expectedRevision:2,baselineJobId:jobId,actorId:'spoof',final:{project:p,result:final}};
 const answer=await call('/projects/'+p.id+'/confirm','POST',payload);assert.equal(answer.status,200);assert.equal(answer.body.case.reason,'');assert.equal(answer.body.case.actorId,'admin');assert.equal(answer.body.case.arrival,'unknown');assert.equal(answer.body.case.rankingEligible,true);
 const duplicate=await call('/projects/'+p.id+'/confirm','POST',{...payload,opId:uid()});assert.equal(duplicate.body.duplicate,true);assert.equal((await call('/cases')).body.cases.length,1);
 const retry=await call('/projects/'+p.id+'/confirm','POST',payload);assert.deepEqual(retry.body,answer.body);
});
test('客户端伪造原始推荐不能形成服务器偏好对；篡改柜型和尺寸被拒绝',async t=>{
 const {call,packed}=await setup(t),p=project(),{result}=await packed(p),fake=P.move(p,result,'g:g',{x:1000});
 const confirmed=await call('/projects/'+p.id+'/confirm','POST',{opId:uid(),expectedRevision:1,baseline:{project:p,result:fake},final:{project:p,result}});assert.equal(confirmed.status,200);assert.equal(confirmed.body.case.baseline,null);assert.equal(confirmed.body.case.rankingEligible,false);
 const invalid=C.clone(result);invalid.containers[0].spec.maxWeight=1e9;assert.equal((await call('/projects/'+p.id+'/layout','POST',{opId:uid(),expectedRevision:1,result:invalid})).status,422);
});
test('输入改变后旧任务标为过期，取消队列任务不再计算',async t=>{
 const {app,call,save}=await setup(t,{startQueue:false}),p=project();await save(p);const job=await call('/projects/'+p.id+'/jobs','POST',{opId:uid(),expectedRevision:1});p.name='新修订';await save(p,1);await app.service.runQueue();assert.equal((await call('/jobs/'+job.body.id)).body.state,'stale');
 const next=await call('/projects/'+p.id+'/jobs','POST',{opId:uid(),expectedRevision:2});await call('/jobs/'+next.body.id+'/cancel','POST',{opId:uid()});await app.service.runQueue();assert.equal((await call('/jobs/'+next.body.id)).body.state,'cancelled');
});
test('过期租约在重启后重新领取，计算结果仍绑定原始修订',async t=>{
 const {app,store,call,save}=await setup(t,{startQueue:false}),p=project();await save(p);const submitted=await call('/projects/'+p.id+'/jobs','POST',{opId:uid(),expectedRevision:1}),key='job:'+submitted.body.id;
 await store.transaction(async tx=>{const job=await tx.get(key);await tx.replace(key,job._revision,{...job,state:'running',attempts:1,leaseOwner:'old-process',leaseUntil:new Date(Date.now()-1000).toISOString()});});await app.service.runQueue();const finished=await call('/jobs/'+submitted.body.id);assert.equal(finished.body.state,'completed');assert.equal(finished.body.attempts,2);assert.equal(finished.body.result.loaded,3);
});
test('发布和回退需要负责人；到货货损会停用对应模板，未反馈不当成完好',async t=>{
 const {call,packed}=await setup(t),p=project(),{result}=await packed(p);const confirmed=await call('/projects/'+p.id+'/confirm','POST',{opId:uid(),expectedRevision:1,final:{project:p,result}}),caseId=confirmed.body.case.id;
 const candidate=await call('/policies/candidates','POST',{opId:uid()});assert.equal(candidate.body.mode,'templates-only');assert.equal(candidate.body.templates.length,1);
 assert.equal((await call('/policies/'+candidate.body.id+'/publish','POST',{opId:uid()},'planner')).status,403);
 assert.equal((await call('/policies/'+candidate.body.id+'/publish','POST',{opId:uid()})).status,200);
 const shared=await call('/experience','GET',null,'outsider');assert.equal(shared.body.cases.length,0);assert.equal(shared.body.templates.length,1);assert.equal(shared.body.templates[0].sources,undefined);
 assert.equal((await call('/cases/'+caseId+'/feedback','POST',{opId:uid(),type:'arrival',outcome:'broken',reason:''},'viewer')).status,200);const after=await call('/experience');assert.equal(after.body.templates.length,0);assert.equal(after.body.cases[0].excluded,true);
 assert.equal((await call('/policies/'+candidate.body.id+'/rollback','POST',{opId:uid()})).status,200);assert.equal((await call('/experience')).body.templates.length,0);
});
test('重新打开共享项目能取回人工位置；静态服务不暴露后端和数据库',async t=>{
 const {call,packed,base}=await setup(t),p=project(),{result}=await packed(p),edited=P.move(p,result,'g:g',{x:2000});await call('/projects/'+p.id+'/layout','POST',{opId:uid(),expectedRevision:1,result:edited});const loaded=await call('/projects/'+p.id);assert.equal(loaded.body.currentResult.containers[0].boxes[0].x,2000);
 const origin=base.replace('/api/load-planner','');assert.equal((await fetch(origin+'/server/store.cjs')).status,404);assert.equal((await fetch(origin+'/data/planner.sqlite')).status,404);assert.equal((await fetch(origin+'/v3/')).status,200);
});
test('SQLite 重开保留项目修订、确认版本及幂等记录',async t=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'planner-db-test-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));const filename=path.join(folder,'planner.sqlite');let db=await openStore({sqlitePath:filename});await db.transaction(async tx=>{await tx.insert('case','case:test','p','u',{id:'test',kind:'confirmed'});await tx.remember('op','u','hash',{saved:true});});await db.close();db=await openStore({sqlitePath:filename});assert.equal((await db.transaction(tx=>tx.get('case:test'))).kind,'confirmed');assert.equal((await db.transaction(tx=>tx.operation('op'))).request_hash,'hash');await db.close();
});
