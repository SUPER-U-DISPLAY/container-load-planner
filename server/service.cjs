'use strict';
const crypto=require('node:crypto'),C=require('../v3/core.js'),E=require('../v3/experience.js'),{compute}=require('./worker-pool.cjs'),A=require('./auth.cjs');
const id=()=>crypto.randomUUID(),now=()=>new Date().toISOString(),digest=v=>crypto.createHash('sha256').update(E.stable(v)).digest('hex');
const clean=v=>{const {_revision,_ownerId,_createdAt,...rest}=v;return rest;};
const bad=(status,message)=>{throw A.error(status,message);};
const writable=u=>{if(!A.editor(u))bad(403,'当前账号没有排柜编辑权限');};
const managerial=u=>{if(!A.manager(u))bad(403,'需要生产规则负责人权限');};
class PlannerService{
 constructor(store,{timeoutMs=60000,memoryMb=256}={}){this.store=store;this.timeoutMs=timeoutMs;this.memoryMb=memoryMb;this.instance=id();this.running=new Map();this.controllers=new Map();this.stopped=false;}
 async project(tx,user,projectId){const record=await tx.get('project:'+projectId);if(!record)bad(404,'方案项目不存在');if(!A.canAccess(user,record))bad(403,'无权访问此项目');return record;}
 async mutate(user,action,body,fn){
  if(typeof body.opId!=='string'||body.opId.length<8||body.opId.length>160)bad(400,'缺少有效的唯一操作编号');
  const operation=digest([user.id,body.opId]),requestHash=digest([action,body]);
  return this.store.transaction(async tx=>{
   const old=await tx.operation(operation);if(old){if(old.actor_id!==user.id||old.request_hash!==requestHash)bad(409,'同一操作编号不能用于不同请求');return JSON.parse(old.response);}
   const result=await fn(tx);await tx.remember(operation,user.id,requestHash,result);return result;
  });
 }
 async replay(user,action,body){
  if(typeof body.opId!=='string'||body.opId.length<8||body.opId.length>160)bad(400,'缺少有效的唯一操作编号');
  const prior=await this.store.transaction(tx=>tx.operation(digest([user.id,body.opId])));
  if(!prior)return null;if(prior.request_hash!==digest([action,body]))bad(409,'同一操作编号不能用于不同请求');return JSON.parse(prior.response);
 }
 async save(user,body,projectId){
  writable(user);const p=C.clone(body.project);try{C.checkProject(p);}catch(e){bad(422,e.message);}
  if(typeof p.id!=='string'||p.id.length>120||!p.id)bad(422,'缺少项目编号');if(projectId&&p.id!==projectId)bad(422,'项目编号不一致');
  if(p.context?.erpProjectId&&!user.roles.includes('admin')&&!user.allProjects&&!user.projectIds.includes(String(p.context.erpProjectId)))bad(403,'无权关联此 ERP 项目');
  return this.mutate(user,'save:'+p.id,body,async tx=>{
   const old=await tx.get('project:'+p.id);let record;
   if(old){if(!A.canAccess(user,old))bad(403,'无权修改此项目');if(old._revision!==body.expectedRevision)bad(409,'方案已被其他人修改，请重新载入或另存方案');record=await tx.replace('project:'+p.id,body.expectedRevision,{...clean(old),project:p,currentResult:old.currentResult?.signature===C.fingerprint(p)?old.currentResult:null,updatedBy:user.id});}
   else{if(body.expectedRevision!==0)bad(409,'远端项目不存在，请另存为新方案');record=await tx.insert('project','project:'+p.id,p.id,user.id,{id:p.id,project:p,updatedBy:user.id});}
   // Every draft revision is retained independently of the mutable project pointer.
   await tx.insert('project_version','version:'+id(),p.id,user.id,{id:id(),projectId:p.id,revision:record._revision,project:p,createdAt:now(),actorId:user.id});
   return {id:p.id,revision:record._revision,project:p};
  });
 }
 async events(user,projectId,body){writable(user);if(!Array.isArray(body.events)||body.events.length>500)bad(422,'动作批次无效');return this.mutate(user,'events:'+projectId,body,async tx=>{await this.project(tx,user,projectId);const events=body.events.map(e=>({id:String(e.id||id()),at:String(e.at||now()),action:String(e.action||'edit').slice(0,80),before:e.before??null,after:e.after??null,undoOf:e.undoOf||null}));await tx.insert('events','events:'+id(),projectId,user.id,{projectId,actorId:user.id,events,createdAt:now()});return {accepted:events.length};});}
 async saveLayout(user,projectId,body){
  writable(user);const replay=await this.replay(user,'layout:'+projectId,body);if(replay)return replay;
  const current=await this.store.transaction(tx=>this.project(tx,user,projectId));if(current._revision!==body.expectedRevision)bad(409,'方案版本已改变，请重新载入');
  let result;try{result=await compute({action:'validate',project:current.project,result:body.result},{timeoutMs:this.timeoutMs,memoryMb:this.memoryMb});}catch(e){bad(422,e.message);}
  return this.mutate(user,'layout:'+projectId,body,async tx=>{const p=await this.project(tx,user,projectId);if(p._revision!==body.expectedRevision)bad(409,'方案在校验期间已改变');const saved=await tx.replace('project:'+projectId,p._revision,{...clean(p),currentResult:result,updatedBy:user.id});await tx.insert('layout_version','layout-version:'+id(),projectId,user.id,{id:id(),projectId,revision:saved._revision,result,createdAt:now(),actorId:user.id});return {id:projectId,project:p.project,revision:saved._revision,currentResult:result};});
 }
 async evidence(tx,user=null){
  const projects=new Map((await tx.list('project')).map(p=>[p.id,p])),feedback=await tx.list('feedback'),status=await tx.list('case_status');
  return (await tx.list('case')).filter(c=>!user||projects.has(c.projectId)&&A.canAccess(user,projects.get(c.projectId))).map(record=>{
   const related=feedback.filter(f=>f.caseId===record.id),arrivals=related.filter(f=>f.type==='arrival'),badArrival=arrivals.some(f=>['moved','crushed','broken','other_damage'].includes(f.outcome)),management=status.find(s=>s.caseId===record.id);
   return {...clean(record),excluded:badArrival||management?.excluded===true,exclusionReason:badArrival?'到货记录含移位或货损':management?.reason||'',arrival:arrivals[0]?.outcome||'unknown',executed:related.some(f=>f.type==='execution'),feedback:related.map(clean)};
  });
 }
 evidenceDigest(cases){return digest(cases.map(c=>[c.id,c.sampleKey,c.excluded,c.arrival]).sort((a,b)=>a[0].localeCompare(b[0])));}
 async experience(tx,user){
  const all=await this.evidence(tx); // Scope raw case data separately from approved templates.
  const scoped=await this.evidence(tx,user),pointer=await tx.get('active-policy'),release=pointer?.policyId?await tx.get('release:'+pointer.policyId):null;
  let policy=null,templates=[];
  if(release){
   const viable=new Set(all.filter(E.eligible).map(c=>c.id)),invalidTraining=release.sampleIds.some(caseId=>!viable.has(caseId));
   templates=release.templates.map(t=>({...t,sources:t.sources.filter(s=>viable.has(s.caseId))})).filter(t=>t.sources.length).map(({sources,...t})=>({...t,projectCount:new Set(sources.map(s=>s.projectId)).size}));
   policy={id:release.id,enabled:true,weights:invalidTraining?Object.fromEntries(E.FEATURES.map(k=>[k,0])):release.weights,mode:invalidTraining?'templates-only':release.mode,validation:release.validation,needsReview:invalidTraining};
  }
  return {cases:scoped.slice(0,100),templates,policy,scope:'authorized-projects-and-approved-templates'};
 }
 async confirm(user,projectId,body){
  writable(user);
  const replay=await this.replay(user,'confirm:'+projectId,body);if(replay)return replay;
  const snapshot=await this.store.transaction(tx=>this.project(tx,user,projectId));
  if(snapshot._revision!==body.expectedRevision)bad(409,'当前方案版本已改变，请重新载入');
  if(E.stable(snapshot.project)!==E.stable(body.final?.project))bad(409,'请先将当前修改同步为草稿，再确认');
  let baseline=null;
  if(body.baselineJobId){const job=await this.store.transaction(tx=>tx.get('job:'+body.baselineJobId));if(!job||job.projectId!==projectId||!['completed','stale'].includes(job.state)||!job.result)bad(422,'原始推荐任务不存在或尚未完成');baseline={project:job.project,result:job.result};}
  // A client-supplied before-layout is not evidence of a server recommendation.
  let record;try{record=await compute({action:'confirm',payload:{id:body.caseId||id(),projectId,baseline,final:body.final,reason:body.reason||'',demo:snapshot.project.demo===true,events:body.events||[]}},{timeoutMs:this.timeoutMs,memoryMb:this.memoryMb});}catch(e){bad(422,e.message);}
  return this.mutate(user,'confirm:'+projectId,body,async tx=>{
   const current=await this.project(tx,user,projectId);if(current._revision!==body.expectedRevision)bad(409,'方案在校验期间发生改变，请重新确认');
   const old=(await tx.list('case')).find(c=>c.projectId===projectId&&c.sampleKey===record.sampleKey);
   if(old)return {case:clean(old),duplicate:true};
   const saved=await tx.insert('case','case:'+record.id,projectId,user.id,{...record,actorId:user.id,actorName:user.name});
   await tx.insert('audit','audit:'+id(),projectId,user.id,{action:'confirm',caseId:record.id,at:now(),actorId:user.id});
   return {case:clean(saved),duplicate:false};
  });
 }
 async feedback(user,caseId,body){
  const types=['reason','execution','arrival'];if(!types.includes(body.type))bad(422,'反馈类型不正确');
  if(body.type==='arrival'&&!['unknown','intact','moved','crushed','broken','other_damage'].includes(body.outcome))bad(422,'到货状态不正确');
  if(body.type==='execution'&&body.outcome!=='executed')bad(422,'实装记录须明确已执行');
  return this.mutate(user,'feedback:'+caseId,body,async tx=>{
   const record=await tx.get('case:'+caseId);if(!record)bad(404,'确认版本不存在');await this.project(tx,user,record.projectId);
   const attachments=[...new Set(body.attachmentIds||[])];if(attachments.length>8)bad(422,'每次最多关联 8 张照片');
   for(const attachmentId of attachments){const a=await tx.get('attachment:'+attachmentId);if(!a||a.caseId!==caseId)bad(422,'照片不属于此确认版本');}
   const feedback={id:id(),caseId,projectId:record.projectId,type:body.type,outcome:body.type==='arrival'?body.outcome:body.type==='execution'?'executed':null,reason:String(body.reason||'').slice(0,2000),fixingMeasures:String(body.fixingMeasures||'').slice(0,2000),attachmentIds:attachments,actorId:user.id,actorName:user.name,createdAt:now()};
   await tx.insert('feedback','feedback:'+feedback.id,record.projectId,user.id,feedback);return feedback;
  });
 }
 async caseStatus(user,caseId,body){managerial(user);return this.mutate(user,'case-status:'+caseId,body,async tx=>{const c=await tx.get('case:'+caseId);if(!c)bad(404,'确认版本不存在');const status={id:id(),caseId,excluded:body.excluded===true,reason:String(body.reason||'').slice(0,2000),createdAt:now(),actorId:user.id};await tx.insert('case_status','case-status:'+status.id,c.projectId,user.id,status);return status;});}
 async candidate(user,body){
  managerial(user);const cases=await this.store.transaction(tx=>this.evidence(tx)),policy=await compute({action:'train',cases},{timeoutMs:this.timeoutMs,memoryMb:this.memoryMb});policy.evidenceDigest=this.evidenceDigest(cases);
  return this.mutate(user,'candidate',body,async tx=>{await tx.insert('policy_candidate','candidate:'+policy.id,null,user.id,policy);return policy;});
 }
 async activate(user,policyId,body,{rollback=false}={}){
  managerial(user);return this.mutate(user,(rollback?'rollback:':'publish:')+policyId,body,async tx=>{
   let release=await tx.get('release:'+policyId);
   if(!rollback){
    const candidate=await tx.get('candidate:'+policyId);if(!candidate)bad(404,'候选版本不存在');
    if(candidate.evidenceDigest!==this.evidenceDigest(await this.evidence(tx)))bad(409,'学习证据已更新，请重新分析候选版本');
    let value;try{value=E.publish(clean(candidate));}catch(e){bad(422,e.message);}
    if(!release)release=await tx.insert('policy_version','release:'+policyId,null,user.id,{...value,publishedBy:user.id});
   }else if(!release)bad(404,'只能回退到已发布版本');
   const pointer=await tx.get('active-policy'),next={policyId,updatedAt:now(),updatedBy:user.id};
   if(pointer)await tx.replace('active-policy',pointer._revision,next);else await tx.insert('state','active-policy',null,user.id,next);
   await tx.insert('audit','audit:'+id(),null,user.id,{action:rollback?'rollback':'publish',policyId,previousPolicyId:pointer?.policyId||null,actorId:user.id,at:now()});return {activePolicy:policyId};
  });
 }
 async submit(user,projectId,body){
  writable(user);return this.mutate(user,'pack-job:'+projectId,body,async tx=>{
   const current=await this.project(tx,user,projectId);if(current._revision!==body.expectedRevision)bad(409,'输入已更新，请重新提交计算');
   const busy=(await tx.list('job')).filter(j=>['queued','running'].includes(j.state));if(busy.filter(j=>j.actorId===user.id).length>=3||busy.length>=30)bad(429,'计算队列已满，请稍后重试');
   const job={id:id(),projectId,actorId:user.id,basisRevision:current._revision,project:C.clone(current.project),experience:await this.experience(tx,user),state:'queued',attempts:0,createdAt:now()};
   await tx.insert('job','job:'+job.id,projectId,user.id,job);return {id:job.id,state:job.state,basisRevision:job.basisRevision};
  });
 }
 async job(user,jobId){return this.store.transaction(async tx=>{const job=await tx.get('job:'+jobId);if(!job)bad(404,'计算任务不存在');await this.project(tx,user,job.projectId);const {project,experience,...publicJob}=clean(job);return publicJob;});}
 async cancel(user,jobId,body){
  writable(user);const result=await this.mutate(user,'cancel:'+jobId,body,async tx=>{const job=await tx.get('job:'+jobId);if(!job)bad(404,'计算任务不存在');await this.project(tx,user,job.projectId);if(!['running','queued'].includes(job.state))return {state:job.state};await tx.replace('job:'+jobId,job._revision,{...clean(job),state:'cancelled',finishedAt:now()});return {state:'cancelled'};});
  this.controllers.get(jobId)?.abort();this.running.get(jobId)?.terminate();return result;
 }
 async claim(){return this.store.transaction(async tx=>{
  const jobs=(await tx.list('job')).filter(j=>j.state==='queued'||j.state==='running'&&Date.parse(j.leaseUntil||0)<Date.now()).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  for(const job of jobs){if(job.attempts>=3){await tx.replace('job:'+job.id,job._revision,{...clean(job),state:'failed',error:'任务多次中断，请重新计算'});continue;}
   return tx.replace('job:'+job.id,job._revision,{...clean(job),state:'running',attempts:job.attempts+1,leaseOwner:this.instance,leaseUntil:new Date(Date.now()+90000).toISOString()});}
  return null;
 });}
 async runQueue(){
  if(this.stopped||this.running.size||this.claiming)return;this.claiming=true;let job,heartbeat;
  try{job=await this.claim();if(!job)return;let last=0;
   const update=async progress=>this.store.transaction(async tx=>{const current=await tx.get('job:'+job.id);if(current.state==='running'&&current.leaseOwner===this.instance)await tx.replace('job:'+job.id,current._revision,{...clean(current),progress,leaseUntil:new Date(Date.now()+90000).toISOString()});});
   const controller=new AbortController();this.controllers.set(job.id,controller);heartbeat=setInterval(()=>update(undefined).catch(()=>{}),10000);heartbeat.unref();
   const result=await compute({action:'pack',project:job.project,experience:job.experience},{timeoutMs:this.timeoutMs,memoryMb:this.memoryMb,signal:controller.signal,onWorker:w=>this.running.set(job.id,w),onProgress:p=>{if(Date.now()-last>500){last=Date.now();update(p).catch(()=>{});}}});
   await this.store.transaction(async tx=>{const current=await tx.get('job:'+job.id),project=await tx.get('project:'+job.projectId);if(current.state==='running'&&current.leaseOwner===this.instance)await tx.replace('job:'+job.id,current._revision,{...clean(current),state:project._revision===job.basisRevision?'completed':'stale',result,finishedAt:now()});});
  }catch(e){if(job)await this.store.transaction(async tx=>{const current=await tx.get('job:'+job.id);if(current?.state==='running'&&current.leaseOwner===this.instance)await tx.replace('job:'+job.id,current._revision,{...clean(current),state:'failed',error:String(e.message).slice(0,400),finishedAt:now()});}).catch(()=>{});}
  finally{clearInterval(heartbeat);if(job){this.running.delete(job.id);this.controllers.delete(job.id);}this.claiming=false;}
 }
 start(){this.timer=setInterval(()=>this.runQueue(),250);this.timer.unref();}
 async stop(){this.stopped=true;clearInterval(this.timer);for(const c of this.controllers.values())c.abort();await Promise.all([...this.running.values()].map(w=>w.terminate()));for(let i=0;this.claiming&&i<100;i++)await new Promise(r=>setTimeout(r,10));}
}
module.exports={PlannerService,clean,digest,id};
