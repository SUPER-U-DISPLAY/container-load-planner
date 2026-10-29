/* IndexedDB drafts/outbox and authenticated ERP service adapter. */
(function(){
 'use strict';
 const C=PlannerCore,E=PlannerExperience,P=PlannerLayout,uuid=()=>crypto.randomUUID(),clone=C.clone;
 const CONFIG='superu-learning-connection-v3',TOKEN='superu-learning-token-v3';
 const state={cases:[],templates:[],policy:null,identity:null,connection:'本机试用',error:'',queue:Promise.resolve(),sync:Promise.resolve()};
 let db,lastSeen=new Map(),config={api:''},autosaveTimer;const remoteBases=new Map(),startupProject=PlannerBridge.read();try{config=JSON.parse(localStorage.getItem(CONFIG)||'{"api":""}');}catch{}
 function notify(){window.dispatchEvent(new CustomEvent('planner-learning-status',{detail:{connection:state.connection,error:state.error,shared:!!config.api}}));}
 function issue(e){state.error=e.message||String(e);notify();}
 const ready=new Promise((resolve,reject)=>{const r=indexedDB.open('superu-planner-learning-v3',1);r.onupgradeneeded=()=>r.result.createObjectStore('records',{keyPath:'key'});r.onsuccess=()=>{db=r.result;resolve();};r.onerror=()=>reject(Error('无法打开经验存储，请检查浏览器隐私或存储设置'));});
 function get(key){return ready.then(()=>new Promise((resolve,reject)=>{const tx=db.transaction('records'),r=tx.objectStore('records').get(key);r.onsuccess=()=>resolve(r.result?.value??null);r.onerror=()=>reject(r.error);}));}
 function put(key,value){return ready.then(()=>new Promise((resolve,reject)=>{const tx=db.transaction('records','readwrite');tx.objectStore('records').put({key,value});tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(Error('经验保存失败，可能已超出本机存储空间'));tx.onabort=()=>reject(Error('经验保存被中断'));}));}
 function remove(key){return ready.then(()=>new Promise((resolve,reject)=>{const tx=db.transaction('records','readwrite');tx.objectStore('records').delete(key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);}));}
 function all(prefix){return ready.then(()=>new Promise((resolve,reject)=>{const tx=db.transaction('records'),r=tx.objectStore('records').getAll();r.onsuccess=()=>resolve(r.result.filter(x=>x.key.startsWith(prefix)).map(x=>x.value));r.onerror=()=>reject(r.error);}));}
 function enqueue(fn){const next=state.queue.then(fn);state.queue=next.catch(issue);return next;}
 function apiUrl(route=''){return config.api.replace(/\/$/,'')+route;}
 async function request(route,{method='GET',payload,bytes,contentType}={}){
  if(!config.api)throw Error('尚未连接共享服务');
  let response;try{response=await fetch(apiUrl(route),{method,headers:{Authorization:'Bearer '+(sessionStorage.getItem(TOKEN)||''),...(payload?{'Content-Type':'application/json'}:{}),...(contentType?{'Content-Type':contentType}:{})},body:bytes||payload&&JSON.stringify(payload),signal:AbortSignal.timeout(70000),cache:'no-store'});}catch{throw Object.assign(Error('共享服务暂时不可用，修改已保留在本机'),{network:true});}
  if(!response.ok){const value=await response.json().catch(()=>({}));throw Object.assign(Error(value.error||'共享服务请求失败'),{status:response.status});}
  return response.json();
 }
 function scope(){return config.api?'remote:'+config.api+':'+(state.identity?.id||'disconnected'):'local';}
 async function refresh(){
  await ready;
  if(config.api){
   try{state.identity=await request('/me');const data=await request('/experience');Object.assign(state,data);state.connection='已连接共享服务 · '+state.identity.name;state.error='';}
   catch(e){state.connection='共享服务未连接';state.cases=[];state.templates=[];state.policy=null;issue(e);throw e;}
  }else{
   state.identity={id:'browser',name:'本机试用',roles:['admin','planner','policy_manager']};
   const feedback=await all('feedback:local:'),statuses=await all('case-status:');
   state.cases=(await all('case:local:')).map(c=>{
    const f=feedback.filter(f=>f.caseId===c.id).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)),bad=f.some(f=>f.type==='arrival'&&['moved','crushed','broken','other_damage'].includes(f.outcome)),status=statuses.filter(s=>s.caseId===c.id).sort((a,b)=>a.at.localeCompare(b.at)).at(-1);
    return {...c,feedback:f,executed:f.some(f=>f.type==='execution'),arrival:f.filter(f=>f.type==='arrival').at(-1)?.outcome||'unknown',excluded:bad||status?.excluded===true,exclusionReason:bad?'到货记录含移位或货损':status?.reason||''};
   }).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
   const active=await get('active-policy:local');state.policy=active?await get('policy:local:'+active):null;
   const viable=new Set(state.cases.filter(E.eligible).map(c=>c.id));
   if(state.policy){state.policy=clone(state.policy);state.policy.templates=state.policy.templates.map(t=>({...t,sources:t.sources.filter(s=>viable.has(s.caseId))})).filter(t=>t.sources.length);if(state.policy.sampleIds.some(id=>!viable.has(id))){state.policy.weights=Object.fromEntries(E.FEATURES.map(k=>[k,0]));state.policy.needsReview=true;}}
   state.templates=state.policy?.templates||[];state.connection='本机试用 · 经验仅在此浏览器';state.error='';
  }
  notify();return state;
 }
 const initialized=ready.then(async()=>{if(config.api){const base=await get('remote:'+config.api+':'+startupProject.id);if(base)remoteBases.set(startupProject.id,{...base,mismatch:E.stable(base.project)!==E.stable(startupProject)});}return refresh();}).catch(e=>{issue(e);return state;});
 function projection(p){return {input:E.inputKey(p),positions:[...p.groups.map(g=>({id:g.id,children:g.children})),...(p.draft?[{id:'draft:'+p.draft.id,children:p.draft.children}]:[])]};}
 function projectPositions(p){const map=new Map();for(const g of p.groups)for(const pos of g.children)map.set(pos.uid,{...pos,groupId:g.id});if(p.draft)for(const pos of p.draft.children)map.set(pos.uid,{...pos,groupId:p.draft.id,draft:true});return map;}
 function positionDiff(before,after){const ids=new Set([...before.keys(),...after.keys()]),changes=[];for(const uid of ids)if(E.stable(before.get(uid)||null)!==E.stable(after.get(uid)||null))changes.push({uid,before:before.get(uid)||null,after:after.get(uid)||null});return {before:changes.map(c=>({uid:c.uid,position:c.before})),after:changes.map(c=>({uid:c.uid,position:c.after}))};}
 async function observe(p,action='edit'){
  const project=clone(p);return enqueue(async()=>{
   await initialized;const previous=lastSeen.get(project.id)||await get('project:'+project.id),changed=previous&&E.stable(projection(previous))!==E.stable(projection(project));
   let session=await get('session:'+project.id),input=E.inputKey(project);
   if(!session||session.input!==input){if(session?.events.length)await put('session-archive:'+session.id,session);session={id:uuid(),projectId:project.id,input,baseline:null,baselineJobId:null,events:[],startedAt:new Date().toISOString()};}
   if(changed){const delta=E.inputKey(previous)!==input?{before:{input:E.hash(E.inputKey(previous))},after:{input:E.hash(input)}}:positionDiff(projectPositions(previous),projectPositions(project));session.events.push({id:uuid(),at:new Date().toISOString(),action:E.inputKey(previous)!==input?'inputs-updated':action,...delta,undoOf:action==='undo'?session.events.at(-1)?.id||null:null});if(session.events.length>500)session.events.shift();}
   await put('session:'+project.id,session);await put('project:'+project.id,project);lastSeen.set(project.id,project);notify();
   if(config.api){clearTimeout(autosaveTimer);const endpoint=config.api;autosaveTimer=setTimeout(()=>{if(config.api===endpoint)syncProject(project).catch(issue);},1200);}
  });
 }
 async function noteRecommendation(p,result,jobId=null){
  const project=clone(p);return enqueue(async()=>{
   let session=await get('session:'+project.id);if(!session||session.input!==E.inputKey(project))session={id:uuid(),projectId:project.id,input:E.inputKey(project),events:[],baseline:null,startedAt:new Date().toISOString()};
   if(!session.baseline)session.baseline={project,result:result?clone(result):C.pack(project)};
   if(jobId&&C.fingerprint(session.baseline.project)===C.fingerprint(project))session.baselineJobId=jobId;
   await put('session:'+project.id,session);
  });
 }
 async function saveRemote(p){
  const project=clone(p),remoteKey='remote:'+config.api+':'+project.id;let remote=remoteBases.get(project.id);
  if(remote?.mismatch)throw Object.assign(Error('此标签页的草稿与共享版本不同，请重新载入或另存方案'),{status:409});
  if(!remote){
   try{const existing=await request('/projects/'+encodeURIComponent(project.id));if(E.stable(existing.project)!==E.stable(project))throw Object.assign(Error('共享端已有不同版本，请到历史页重新载入或另存方案'),{status:409});remote=existing;remoteBases.set(project.id,remote);await put(remoteKey,remote);}catch(e){if(e.status!==404)throw e;}
  }
  if(remote&&E.stable(remote.project)===E.stable(project))return remote;
  const payload={opId:uuid(),expectedRevision:remote?.revision||0,project};
  const saved=await request(remote?'/projects/'+encodeURIComponent(project.id):'/projects',{method:remote?'PUT':'POST',payload});remoteBases.set(project.id,saved);await put(remoteKey,saved);state.error='';state.connection='已同步到共享服务 · '+(state.identity?.name||'');notify();return saved;
 }
 async function syncEvents(p){
  const key='event-upload:'+config.api+':'+p.id,sentKey='events-sent:'+config.api+':'+p.id,sent=new Set(await get(sentKey)||[]);let pending=await get(key);
  if(!pending){const sessions=[...(await all('session-archive:')).filter(s=>s.projectId===p.id),await get('session:'+p.id)].filter(Boolean),events=sessions.flatMap(s=>s.events).filter(e=>!sent.has(e.id)).slice(0,500);if(!events.length)return;pending={opId:uuid(),events};await put(key,pending);}
  await request('/projects/'+encodeURIComponent(p.id)+'/events',{method:'POST',payload:pending});pending.events.forEach(e=>sent.add(e.id));await put(sentKey,[...sent]);await remove(key);
 }
 function syncProject(p){const endpoint=config.api,task=state.sync.then(async()=>{if(config.api!==endpoint)throw Error('连接已改变，请重新同步当前项目');const saved=await saveRemote(p);await syncEvents(p);return saved;});state.sync=task.catch(issue);return task;}
 async function flush(p){await observe(p,'save');await state.queue;if(!config.api)return {revision:0,project:p};return syncProject(p);}
 async function poll(jobId,onProgress=()=>{}){
  const started=Date.now();while(Date.now()-started<130000){const job=await request('/jobs/'+encodeURIComponent(jobId));if(job.progress)onProgress(job.progress);if(job.state==='completed')return job;if(['failed','cancelled','stale'].includes(job.state))throw Error(job.state==='stale'?'输入已改变，旧任务结果未采用':job.error||'计算已取消');await new Promise(r=>setTimeout(r,400));}throw Error('等待计算超时，可在共享服务恢复后重试');
 }
 async function compute(p,onProgress=()=>{}){
  await initialized;
  let result,jobId=null;
  if(config.api){const remote=await flush(p),job=await request('/projects/'+encodeURIComponent(p.id)+'/jobs',{method:'POST',payload:{opId:uuid(),expectedRevision:remote.revision}});jobId=job.id;state.activeJob=job.id;notify();try{result=(await poll(job.id,onProgress)).result;}finally{state.activeJob=null;notify();}}
  else result=await new Promise((resolve,reject)=>{
   const worker=new Worker('learning-worker.js?v=3.3.0');let done=false;state.activeJob='local';state.localWorker=worker;
   const timer=setTimeout(()=>finish(Error('本机计算超时，请分批测试')),120000);
   function finish(err,value){if(done)return;done=true;clearTimeout(timer);worker.terminate();state.activeJob=null;state.localWorker=null;state.cancelLocal=null;notify();if(err)reject(err);else resolve(value);}
   state.cancelLocal=()=>finish(Error('计算已取消'));worker.onmessage=event=>{const message=event.data;if(message.progress)onProgress(message.progress);else if(message.error)finish(Error(message.error));else if(message.result)finish(null,message.result);};worker.onerror=()=>finish(Error('本机计算进程启动失败，请通过网页地址打开系统'));notify();worker.postMessage({project:p,experience:{cases:state.cases,templates:state.templates,policy:state.policy}});
  });
  await noteRecommendation(p,result,jobId);await saveResult(p,result,'automatic-result');return result;
 }
 async function cancelJob(){if(state.cancelLocal){state.cancelLocal();return;}if(state.activeJob)await request('/jobs/'+state.activeJob+'/cancel',{method:'POST',payload:{opId:uuid()}});}
 async function saveResult(p,result,action='packing-edit'){
  const checked=P.canonical(p,result),project=clone(p);return enqueue(async()=>{
   const prior=await get('result:'+project.id),session=await get('session:'+project.id);
   if(session&&prior&&E.layoutKey(prior.result)!==E.layoutKey(checked)&&action!=='automatic-result'){
    const positions=r=>new Map(r.containers.flatMap((ct,index)=>ct.boxes.map(b=>[b.uid,{x:b.x,y:b.y,z:b.z,orientation:b.orientation,groupId:b.groupId||null,container:index}])));const delta=positionDiff(positions(prior.result),positions(checked));session.events.push({id:uuid(),at:new Date().toISOString(),action,...delta,undoOf:action==='undo'?session.events.at(-1)?.id||null:null});session.events=session.events.slice(-500);await put('session:'+project.id,session);
   }
   await put('result:'+project.id,{projectId:project.id,signature:C.fingerprint(project),result:checked,updatedAt:new Date().toISOString()});return checked;
  });
 }
 async function currentResult(p){await state.queue;const record=await get('result:'+p.id);if(!record||record.signature!==C.fingerprint(p))return null;try{return P.canonical(p,record.result);}catch{return null;}}
 async function commitResult(p,result){
  const checked=await saveResult(p,result,'save-layout');if(!config.api)return checked;
  const endpoint=config.api,task=state.sync.then(async()=>{
   if(config.api!==endpoint)throw Error('连接已改变');const uploadKey='layout-upload:'+endpoint+':'+p.id;
   async function send(payload){const saved=await request('/projects/'+encodeURIComponent(p.id)+'/layout',{method:'POST',payload});remoteBases.set(p.id,saved);await put('remote:'+endpoint+':'+p.id,saved);await remove(uploadKey);return saved;}
   const pending=await get(uploadKey);if(pending){await send(pending);if(E.layoutKey(pending.result)===E.layoutKey(checked)){await syncEvents(p);return checked;}}
   const remote=await saveRemote(p),payload={opId:uuid(),expectedRevision:remote.revision,result:checked};await put(uploadKey,payload);await send(payload);await syncEvents(p);return checked;
  });state.sync=task.catch(issue);return task;
 }
 async function confirm(p,result,reason=''){
  await initialized;await observe(p,'save');await state.queue;const session=await get('session:'+p.id),record=E.makeCase({id:uuid(),projectId:p.id,baseline:session?.baseline,final:{project:p,result},reason,demo:p.demo===true,events:session?.events||[]});
  if(!config.api){const old=state.cases.find(c=>c.sampleKey===record.sampleKey);if(old)return {case:old,duplicate:true};await put('case:local:'+record.id,record);await refresh();return {case:record,shared:false};}
  const payload={opId:uuid(),caseId:record.id,expectedRevision:null,baselineJobId:session?.baselineJobId||null,final:{project:clone(p),result:P.canonical(p,result)},reason,events:session?.events||[]},pending={id:payload.opId,api:config.api,actorId:state.identity.id,route:'/projects/'+encodeURIComponent(p.id)+'/confirm',payload,record,draftRevision:remoteBases.get(p.id)?.revision||0,draftOpId:uuid(),createdAt:new Date().toISOString()};
  await put('outbox:'+pending.id,pending);
  try{const remote=await syncProject(p);pending.payload.expectedRevision=remote.revision;await put('outbox:'+pending.id,pending);const answer=await request(pending.route,{method:'POST',payload});await remove('outbox:'+pending.id);await put('case:'+scope()+':'+answer.case.id,answer.case);await refresh();return {...answer,shared:true};}
  catch(e){issue(e);await put('case:'+scope()+':'+record.id,{...record,pendingSync:true});return {case:record,pending:true,error:e.message};}
 }
 async function syncPending(){
  if(!config.api)return [];const results=[];
  for(const pending of await all('outbox:')){
   if(pending.api!==config.api||pending.actorId!==state.identity?.id)continue;
   try{
    if(pending.payload.expectedRevision===null){
     const p=pending.payload.final.project;let remote;
     try{remote=await request('/projects/'+encodeURIComponent(p.id));}catch(e){if(e.status!==404)throw e;}
     if(!remote||E.stable(remote.project)!==E.stable(p)){
      if((remote?.revision||0)!==pending.draftRevision)throw Error('待同步方案与共享版本冲突，请保留此记录并重新载入处理');
      remote=await request(remote?'/projects/'+encodeURIComponent(p.id):'/projects',{method:remote?'PUT':'POST',payload:{opId:pending.draftOpId,expectedRevision:pending.draftRevision,project:p}});
     }
     remoteBases.set(p.id,remote);await put('remote:'+config.api+':'+p.id,remote);pending.payload.expectedRevision=remote.revision;await put('outbox:'+pending.id,pending);
    }
    const answer=await request(pending.route,{method:'POST',payload:pending.payload});await remove('outbox:'+pending.id);await remove('case:'+scope()+':'+pending.record.id);await put('case:'+scope()+':'+answer.case.id,answer.case);results.push({id:pending.id,ok:true});
   }
   catch(e){results.push({id:pending.id,ok:false,error:e.message});}
  }
  await refresh();return results;
 }
 async function connection(api,token){
  clearTimeout(autosaveTimer);await state.sync;
  let endpoint='';if(api){const u=new URL(api,location.href);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw Error('服务地址须为不含凭证、查询参数的 HTTP(S) 地址');if(u.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(u.hostname))throw Error('共享服务须使用 HTTPS');endpoint=u.href.replace(/\/$/,'');}
  const previous={...config},oldToken=sessionStorage.getItem(TOKEN);config={api:endpoint};sessionStorage.setItem(TOKEN,token||'');
  try{await refresh();remoteBases.clear();localStorage.setItem(CONFIG,JSON.stringify(config));await syncPending();return state.identity;}
  catch(e){config=previous;if(oldToken)sessionStorage.setItem(TOKEN,oldToken);else sessionStorage.removeItem(TOKEN);throw e;}
 }
 async function projects(){await initialized;if(config.api)return (await request('/projects')).projects;return (await all('project:')).filter(p=>p.cargos.length).map(p=>({id:p.id,name:p.name,context:p.context||{},revision:null}));}
 async function openProject(projectId){let p;if(config.api){const remote=await request('/projects/'+encodeURIComponent(projectId));p=remote.project;remoteBases.set(projectId,remote);await put('remote:'+config.api+':'+projectId,remote);if(remote.currentResult)await saveResult(p,remote.currentResult,'load-shared-layout');}else p=await get('project:'+projectId);if(!p)throw Error('项目不存在');PlannerBridge.write(p,{action:'open'});return p;}
 async function cases(){await initialized;if(config.api){const data=await request('/cases');const pending=(await all('case:'+scope()+':')).filter(c=>c.pendingSync);return [...pending,...data.cases];}await refresh();return state.cases;}
 async function feedback(caseId,{type,outcome,reason='',fixingMeasures='',files=[]}){
  const value={id:uuid(),caseId,type,outcome:outcome||null,reason,fixingMeasures,createdAt:new Date().toISOString(),actorName:state.identity?.name||'本机试用',attachmentIds:[]};
  if(config.api){for(const file of files){const uploaded=await request('/cases/'+caseId+'/attachments',{method:'POST',bytes:file,contentType:file.type});value.attachmentIds.push(uploaded.id);}await request('/cases/'+caseId+'/feedback',{method:'POST',payload:{...value,opId:uuid()}});}
  else{for(const file of files){if(file.size>8*1024*1024)throw Error('单张照片不能超过8MB');const photoId=uuid();await put('photo:'+photoId,{blob:file,caseId});value.attachmentIds.push(photoId);}await put('feedback:local:'+value.id,value);}
  await refresh();return value;
 }
 async function photo(attachmentId){if(!config.api){const saved=await get('photo:'+attachmentId);if(!saved)throw Error('照片不存在');return URL.createObjectURL(saved.blob);}const r=await fetch(apiUrl('/attachments/'+attachmentId),{headers:{Authorization:'Bearer '+sessionStorage.getItem(TOKEN)}});if(!r.ok)throw Error('无法读取照片');return URL.createObjectURL(await r.blob());}
 async function policies(){if(config.api)return request('/policies');const active=await get('active-policy:local'),versions=await all('policy:local:'),candidates=await all('candidate:local:');return {active,versions,candidates};}
 async function train(){await refresh();if(config.api)return request('/policies/candidates',{method:'POST',payload:{opId:uuid()}});const candidate=E.train(state.cases);candidate.evidenceKey=E.stable(state.cases.map(c=>[c.id,c.excluded,c.arrival]));await put('candidate:local:'+candidate.id,candidate);return candidate;}
 async function activate(policyId,rollback=false){
  if(config.api)await request('/policies/'+policyId+(rollback?'/rollback':'/publish'),{method:'POST',payload:{opId:uuid()}});
  else{if(rollback){if(!await get('policy:local:'+policyId))throw Error('只能回退到已发布版本');}else{const candidate=await get('candidate:local:'+policyId);await refresh();if(candidate.evidenceKey!==E.stable(state.cases.map(c=>[c.id,c.excluded,c.arrival])))throw Error('学习证据已更新，请重新分析');const policy=E.publish(candidate);await put('policy:local:'+policyId,policy);}await put('active-policy:local',policyId);}
  await refresh();
 }
 async function exclude(caseId,excluded,reason=''){if(config.api)await request('/cases/'+caseId+'/status',{method:'POST',payload:{opId:uuid(),excluded,reason}});else await put('case-status:'+uuid(),{caseId,excluded,reason,at:new Date().toISOString()});await refresh();}
 async function exportArchive(){await initialized;const manager=state.identity?.roles.some(r=>['admin','policy_manager'].includes(r));return {schema:'superu-learning-archive-v1',exportedAt:new Date().toISOString(),scope:config.api?'authorized-shared-records':'local',projects:await projects(),cases:await cases(),policies:manager?await policies():{active:state.policy?.id||null,versions:[],candidates:[]}};}
 async function importArchive(value){
  if(config.api)throw Error('历史归档先在本机导入核对，共享确认版本请通过确认功能提交');
  if(value.schema!=='superu-learning-archive-v1'||!Array.isArray(value.cases))throw Error('经验归档格式不正确');
  const seen=new Set(state.cases.map(c=>c.sampleKey));let imported=0;
  for(const source of value.cases){
   if(!source.final?.project||!source.final?.result)continue;
   const record=E.makeCase({id:uuid(),projectId:source.projectId||source.final.project.id,baseline:null,final:source.final,reason:source.reason||'',demo:source.demo===true});record.imported=true;record.baselineNote='归档导入，仅用于案例和模板，不伪造原始推荐';if(seen.has(record.sampleKey))continue;
   await put('case:local:'+record.id,record);await put('project:'+record.final.project.id,record.final.project);seen.add(record.sampleKey);
   const feedback=Array.isArray(source.feedback)?source.feedback:[],damage=['moved','crushed','broken','other_damage'];
   for(const old of feedback){if(!['reason','execution','arrival'].includes(old.type))continue;const f={id:uuid(),caseId:record.id,type:old.type,outcome:old.outcome||null,reason:String(old.reason||''),fixingMeasures:String(old.fixingMeasures||''),createdAt:old.createdAt||new Date().toISOString(),actorName:'归档导入',attachmentIds:[],imported:true};await put('feedback:local:'+f.id,f);}
   if(source.excluded===true||damage.includes(source.arrival)||feedback.some(f=>f.type==='arrival'&&damage.includes(f.outcome)))await put('case-status:'+uuid(),{caseId:record.id,excluded:true,reason:source.exclusionReason||'归档中已停用或含货损记录',at:new Date().toISOString()});
   imported++;
  }
  await refresh();return imported;
 }
 window.PlannerLearning={ready:initialized,state,uuid,get config(){return {...config};},get,put,all,observe,noteRecommendation,refresh,request,flush,compute,cancelJob,saveResult,commitResult,currentResult,confirm,syncPending,connection,projects,openProject,cases,feedback,photo,policies,train,activate,exclude,exportArchive,importArchive};
 window.addEventListener('message',event=>{if(event.origin===location.origin&&event.source===parent&&event.data?.type==='planner:auth')connection(event.data.api||'/api/load-planner',event.data.token).catch(issue);});
 ready.catch(issue);
})();
