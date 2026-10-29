/* Case/template learning and bounded preference ranking. No safety-rule inference. */
(function(root){
 'use strict';
 const node=typeof module==='object',C=node?require('./core.js'):root.PlannerCore,S=node?require('./stacking.js'):root.PlannerStack,P=node?require('./layout.js'):root.PlannerLayout;
 const VERSION='3.3.0';
 const stable=v=>JSON.stringify(order(v));
 function order(v){if(Array.isArray(v))return v.map(order);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,order(v[k])]));return v;}
 function hash(v){const s=typeof v==='string'?v:stable(v);let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16).padStart(8,'0')+'-'+s.length;}
 function typeKey(c){return stable({profile:c.packageCode||c.profileId||String(c.name||'').trim().toLowerCase(),version:c.packageVersion||'unversioned',packageType:c.packageType||'auto',l:c.l,w:c.w,h:c.h,weight:C.known(c.weight)?c.weight:null,weightSource:c.weightSource||'provided',rotateMode:c.rotateMode,stackable:c.stackable!==false,maxLayers:c.maxLayers||0,topLoad:c.topLoad??null});}
 function inputKey(project){
  const cfg={...C.DEFAULTS,...project.settings};delete cfg.sameKindFirst;delete cfg.positionMode;delete cfg.preference;
  return stable({cargos:project.cargos.map(c=>({id:c.id,type:typeKey(c),qty:c.qty})).sort((a,b)=>a.id.localeCompare(b.id)),settings:cfg});
 }
 function comparable(a,b){return inputKey(a)===inputKey(b);}
 function layoutKey(result){return stable({containers:result.containers.map(ct=>({type:ct.spec.id,boxes:ct.boxes.map(b=>({uid:b.uid,x:b.x,y:b.y,z:b.z,orientation:b.orientation,groupId:b.groupId||null})).sort((a,b)=>a.uid.localeCompare(b.uid))})),unpacked:result.unpacked.map(b=>b.uid).sort()});}
 function groupKey(group,units){const byUid=new Map(units.map(u=>[u.uid,u]));return stable({allowRotate:group.allowRotate!==false,children:C.normalize(group.children,units).map(pos=>({type:typeKey(byUid.get(pos.uid)),x:pos.x,y:pos.y,z:pos.z,orientation:pos.orientation,manual:!!pos.manualOrientation})).sort((a,b)=>stable(a).localeCompare(stable(b)))});}
 function eligible(record){
  if(record?.kind!=='confirmed'||record.excluded||record.demo||!record.final?.project||!record.final?.result)return false;
  // Recheck old cases too. Editing metadata must never erase a current risk.
  try{const result=P.canonical(record.final.project,record.final.result,{keepEmpty:false});return result.readiness.ready;}catch{return false;}
 }
 function templateLibrary(cases){
  const map=new Map();
  for(const record of cases.filter(eligible)){
   const p=record.final.project,units=C.expand(p.cargos),byUid=new Map(units.map(u=>[u.uid,u]));
   for(const g of p.groups){
    if(g.children.length<2||!C.validatePlacement(C.groupBoxes(g,units),p.settings).ok)continue;
    const children=C.normalize(g.children,units).map(pos=>{const u=byUid.get(pos.uid),b=C.box(u,pos);return {type:typeKey(u),x:pos.x,y:pos.y,z:pos.z,dx:b.dx,dy:b.dy,dz:b.dz};});
    const k=stable({children:[...children].sort((a,b)=>stable(a).localeCompare(stable(b))),allowRotate:g.allowRotate!==false});
    if(!map.has(k))map.set(k,{id:'template-'+hash(k),key:k,name:'历史确认组合',children,allowRotate:g.allowRotate!==false,sources:[],projects:new Set()});
    const item=map.get(k),pid=record.familyId||record.projectId||p.id||record.id;
    if(!item.projects.has(pid)){item.projects.add(pid);item.sources.push({caseId:record.id,projectId:pid,evidence:record.evidence||'confirmed'});}
   }
  }
  return [...map.values()].map(({projects,...t})=>({...t,projectCount:projects.size})).sort((a,b)=>b.projectCount-a.projectCount||a.id.localeCompare(b.id));
 }
 function context(data){return Array.isArray(data)?{cases:data,templates:[],policy:null}:{cases:[],templates:[],policy:null,...data};}
 function combine(project,data=[],{replace=false}={}){
  const ctx=context(data),original=replace?[]:C.clone(project.groups),all=C.expand(project.cargos),used=new Set(original.flatMap(g=>g.children.map(c=>c.uid))),historical=[];
  const templates=[...ctx.templates.filter(t=>t.enabled!==false),...templateLibrary(ctx.cases)],seen=new Set();let skipped=0;
  for(const t of templates){
   if(seen.has(t.key||t.id))continue;seen.add(t.key||t.id);
   if(!Array.isArray(t.children)||t.children.length<2||t.children.length>3000)continue;
   for(let copy=0;copy<all.length;copy++){
    const local=new Set(),children=[];let valid=true;
    for(const saved of t.children){
     const u=all.find(u=>!u.pending&&!used.has(u.uid)&&!local.has(u.uid)&&typeKey(u)===saved.type);
     if(!u){valid=false;break;}
     // A manual exception in an old case never grants a new automatic orientation.
     const orientation=C.poses(u).findIndex(d=>d.every((n,i)=>Math.abs(n-[saved.dx,saved.dy,saved.dz][i])<C.EPS));
     if(orientation<0){valid=false;break;}
     local.add(u.uid);children.push({uid:u.uid,x:saved.x,y:saved.y,z:saved.z,orientation});
    }
    if(!valid)break;
    const group={id:'learned-'+hash([t.id,children.map(c=>c.uid)]),name:'经验组合 '+(original.length+historical.length+1),source:'experience',templateId:t.id,evidenceProjects:t.projectCount||0,allowRotate:project.settings.allowGroupRotate!==false&&t.allowRotate!==false&&children.every(pos=>all.find(u=>u.uid===pos.uid).rotateMode!=='none'),children};
    try{if(!C.validatePlacement(C.groupBoxes(group,all),project.settings).ok){skipped++;break;}}catch{skipped++;break;}
    historical.push(group);local.forEach(uid=>used.add(uid));
   }
  }
  const fallback=S.autoCombine({...project,groups:[...original,...historical],draft:null},{replace:false});
  const groups=[...historical,...fallback.groups],combined=groups.reduce((n,g)=>n+g.children.length,0);
  return {groups,replace,signature:C.fingerprint(project),combined,loose:all.length-original.reduce((n,g)=>n+g.children.length,0)-combined,pending:all.filter(u=>u.pending&&!used.has(u.uid)).length,learning:{historicalGroups:historical.length,templateIds:[...new Set(historical.map(g=>g.templateId))],skipped,policyVersion:ctx.policy?.id||'base'}};
 }
 function features(project,result){
  const boxes=result.containers.flatMap(ct=>ct.boxes.map(b=>({b,ct}))),n=boxes.length||1;let near=0,pairs=0;
  for(const ct of result.containers)for(let i=0;i<ct.boxes.length;i++)for(let j=i+1;j<ct.boxes.length;j++){
   const a=ct.boxes[i],b=ct.boxes[j];if(Math.abs(a.z-b.z)>C.EPS)continue;
   const touching=(Math.abs(a.x+a.dx-b.x)<20||Math.abs(b.x+b.dx-a.x)<20)&&a.y<b.y+b.dy&&b.y<a.y+a.dy||(Math.abs(a.y+a.dy-b.y)<20||Math.abs(b.y+b.dy-a.y)<20)&&a.x<b.x+b.dx&&b.x<a.x+a.dx;
   if(touching){pairs++;if(a.id===b.id)near++;}
  }
  return {lowPlacement:1-boxes.reduce((s,{b,ct})=>s+(b.z+b.dz/2)/ct.spec.H,0)/n,sameKindAdjacency:pairs?near/pairs:0,groupedShare:boxes.filter(({b})=>b.groupId).length/n};
 }
 const FEATURES=['lowPlacement','sameKindAdjacency','groupedShare'];
 function preferenceScore(project,result,weights={}){const f=features(project,result);return FEATURES.reduce((n,k)=>n+(Number.isFinite(weights[k])?weights[k]:0)*f[k],0);}
 function remapResult(record,project){
  const old=record.final.project,raw=record.final.result,from=C.expand(old.cargos),to=C.expand(project.cargos);
  const inventory=us=>stable(us.map(typeKey).sort());if(inventory(from)!==inventory(to))return null;
  const oldGroups=old.groups.map(g=>({g,k:groupKey(g,from)})),newGroups=project.groups.map(g=>({g,k:groupKey(g,to)}));if(stable(oldGroups.map(x=>x.k).sort())!==stable(newGroups.map(x=>x.k).sort()))return null;
  const mapping=new Map(),groupMapping=new Map(),used=new Set(),matchedGroups=new Set();
  for(const {g,k} of oldGroups){
   const current=newGroups.find(x=>x.k===k&&!matchedGroups.has(x.g.id))?.g;if(!current)return null;matchedGroups.add(current.id);groupMapping.set(g.id,current);
   for(const pos of g.children){const u=from.find(u=>u.uid===pos.uid),candidate=current.children.find(c=>!used.has(c.uid)&&typeKey(to.find(u=>u.uid===c.uid))===typeKey(u)&&['x','y','z','orientation'].every(a=>c[a]===pos[a]));if(!candidate)return null;mapping.set(pos.uid,candidate.uid);used.add(candidate.uid);}
  }
  for(const u of from)if(!mapping.has(u.uid)){const target=to.find(v=>!used.has(v.uid)&&typeKey(v)===typeKey(u));if(!target)return null;mapping.set(u.uid,target.uid);used.add(target.uid);}
  const byUid=new Map(to.map(u=>[u.uid,u]));
  try{return P.canonical(project,{containers:raw.containers.map(ct=>({spec:ct.spec,boxes:ct.boxes.map(b=>{const uid=mapping.get(b.uid),u=byUid.get(uid),g=b.groupId?groupMapping.get(b.groupId):null;return {...C.box(u,{...b,uid}),...(g?{groupId:g.id,groupName:g.name}:{}),blockId:g?.id||uid};})})),unpacked:raw.unpacked.map(b=>({uid:mapping.get(b.uid),reason:b.reason})),locks:[]},{keepEmpty:false});}catch{return null;}
 }
 function pack(project,data=[],onProgress=()=>{}){
  const ctx=context(data),base=P.canonical(project,C.pack(project,onProgress),{keepEmpty:false}),candidates=[{source:'基础规则',result:base}];
  for(const record of ctx.cases.filter(eligible).slice(-30).reverse()){const replay=remapResult(record,project);if(replay)candidates.push({source:'历史确认方案',caseId:record.id,result:replay});}
  if(ctx.policy?.enabled&&FEATURES.some(k=>Math.abs(ctx.policy.weights?.[k]||0)>0)){
   const low=P.canonical(project,C.pack(project,onProgress,{positionMode:'low'}),{keepEmpty:false});candidates.push({source:'低位候选',result:low});
   const alternative=C.clone(project);alternative.settings.sameKindFirst=!alternative.settings.sameKindFirst;
   const same=P.canonical(project,C.pack(alternative,onProgress),{keepEmpty:false});candidates.push({source:'同类候选',result:same});
  }
  const weights=ctx.policy?.enabled?ctx.policy.weights:{};
  for(const c of candidates)c.score=preferenceScore(project,c.result,weights);
  const usePrices=candidates.every(c=>Number.isFinite(c.result.estimatedCost));
  candidates.sort((a,b)=>C.Transport.compare(a.result,b.result,{usePrices})||b.score-a.score||(a.source==='历史确认方案'?-1:0)-(b.source==='历史确认方案'?-1:0));
  const best=candidates[0];best.result.learning={source:best.source,caseId:best.caseId||null,policyVersion:ctx.policy?.id||'base',candidates:candidates.map(c=>({source:c.source,loaded:c.result.loaded,containers:c.result.containers.length,preferenceScore:c.score})),transportOutcome:'unknown'};
  return best.result;
 }
 function differences(before,after){
  if(!before?.result||!after?.result)return {hasBaseline:false,moved:0,rotated:0,changedContainer:0,groupChanges:0};
  const old=new Map(before.result.containers.flatMap((ct,i)=>ct.boxes.map(b=>[b.uid,{...b,container:i}])));let moved=0,rotated=0,changedContainer=0;
  for(const [i,ct] of after.result.containers.entries())for(const b of ct.boxes){const a=old.get(b.uid);if(!a)continue;if(['x','y','z'].some(k=>Math.abs(a[k]-b[k])>C.EPS))moved++;if(a.orientation!==b.orientation)rotated++;if(a.container!==i)changedContainer++;}
  const groupChanges=before.project.groups.filter(g=>!after.project.groups.some(h=>groupKey(g,C.expand(before.project.cargos))===groupKey(h,C.expand(after.project.cargos)))).length+after.project.groups.filter(g=>!before.project.groups.some(h=>groupKey(g,C.expand(before.project.cargos))===groupKey(h,C.expand(after.project.cargos)))).length;
  return {hasBaseline:true,moved,rotated,changedContainer,groupChanges,containerDelta:after.result.containers.length-before.result.containers.length,unpackedDelta:after.result.unpacked.length-before.result.unpacked.length,sameInputs:comparable(before.project,after.project)};
 }
 function makeCase({id,projectId,baseline=null,final,reason='',demo=false,events=[]}){
  const Bridge=node?require('./bridge.js'):root.PlannerBridge;if(Bridge.dirty(final.project))throw Error('请先保存或放弃叠箱草稿，再确认最终方案');
  const project=C.clone(final.project);project.draft=null;delete project.currentResult;
  const result=P.canonical(project,final.result,{keepEmpty:false});let before=null,baselineNote='没有原始推荐，仅用于历史案例和模板';
  if(baseline?.project&&baseline?.result&&comparable(baseline.project,project)){
   try{const p=C.clone(baseline.project);p.draft=null;before={project:p,result:P.canonical(p,baseline.result,{keepEmpty:false})};baselineNote='相同输入与限制';}catch{baselineNote='原始推荐不完整，仅用于案例和模板';}
  }else if(baseline)baselineNote='输入或限制已变化，不作为偏好对';
  const finalValue={project,result},diff=differences(before,finalValue);
  const transportPending=!result.readiness.ready;
  return {id,projectId:projectId||project.id,familyId:project.context?.erpProjectId||project.context?.learningFamilyId||projectId||project.id,kind:'confirmed',createdAt:new Date().toISOString(),engineVersion:VERSION,evidence:'confirmed',transportPending,arrival:'unknown',demo:!!demo,reason:String(reason||'').slice(0,2000),baseline:before,baselineNote,final:finalValue,diff,events:C.clone(events).slice(-500),sampleKey:stable({projectId:projectId||project.id,input:inputKey(project),layout:layoutKey(result),groups:project.groups.map(g=>groupKey(g,C.expand(project.cargos))).sort()}),rankingEligible:!!before&&!demo&&!transportPending&&result.unpacked.length===0&&before.result.unpacked.length===0&&layoutKey(before.result)!==layoutKey(result),inferredReason:null};
 }
 function train(cases){
  const records=cases.filter(r=>eligible(r)&&r.rankingEligible&&r.baseline&&comparable(r.baseline.project,r.final.project)),byProject=new Map();
  for(const r of records)byProject.set(r.familyId||r.projectId||r.id,r);
  const pairs=[...byProject].sort((a,b)=>a[0].localeCompare(b[0])).map(([,r])=>r),holdout=pairs.length>=4?pairs.filter((_,i)=>i%4===0):[],training=pairs.filter(r=>!holdout.includes(r));
  const sufficient=training.length>=3&&holdout.length>=1,weights=Object.fromEntries(FEATURES.map(k=>[k,0]));
  if(sufficient){for(const r of training){const a=features(r.baseline.project,r.baseline.result),b=features(r.final.project,r.final.result);for(const k of FEATURES)weights[k]+=b[k]-a[k];}const sum=FEATURES.reduce((n,k)=>n+Math.abs(weights[k]),0);for(const k of FEATURES)weights[k]=sum?Math.max(-1,Math.min(1,weights[k]/sum)):0;}
  const agreement=list=>list.length?list.filter(r=>preferenceScore(r.final.project,r.final.result,weights)>preferenceScore(r.baseline.project,r.baseline.result,weights)+1e-9).length/list.length:null;
  const templates=templateLibrary(cases),validation={independentProjects:pairs.length,trainingProjects:training.length,holdoutProjects:holdout.length,holdoutAgreement:agreement(holdout),sufficient,reason:sufficient?'按独立项目留出验证':'偏好对不足，暂只更新组合模板'};
  const digest=hash(pairs.map(r=>[r.id,r.sampleKey]));
  return {id:'policy-'+Date.now().toString(36)+'-'+digest,engineVersion:VERSION,createdAt:new Date().toISOString(),enabled:false,status:'candidate',mode:sufficient?'templates-and-preferences':'templates-only',weights,templates,validation,sampleIds:pairs.map(r=>r.id),sampleDigest:digest,publishable:templates.length>0||sufficient,hardRulesChanged:false};
 }
 function publish(policy){
  if(!policy.publishable)throw Error('暂无可发布的有效模板或偏好样本');
  if(FEATURES.some(k=>!Number.isFinite(policy.weights[k])||Math.abs(policy.weights[k])>1))throw Error('偏好参数超出允许范围');
  if(policy.mode!=='templates-only'&&(!policy.validation.sufficient||policy.validation.holdoutAgreement<0.5))throw Error('留出项目验证未通过，不能发布偏好版本');
  return {...C.clone(policy),enabled:true,status:'published',publishedAt:new Date().toISOString()};
 }
 const api={VERSION,FEATURES,stable,hash,typeKey,inputKey,comparable,layoutKey,groupKey,eligible,templateLibrary,combine,features,preferenceScore,remapResult,pack,differences,makeCase,train,publish};
 if(node)module.exports=api;else root.PlannerExperience=api;
})(typeof self!=='undefined'?self:globalThis);
