/* Shared project and adapter: new stacking rules, unchanged original result interface. */
(function(root){
 'use strict';
 const C=typeof module==='object'?require('./core.js'):root.PlannerCore;
 const KEY='super-u-learning-v3';
 const newId=()=>globalThis.crypto.randomUUID();
 function empty(){return {schemaVersion:2,appVersion:'3.2.0',id:newId(),context:{},demo:false,name:'未命名装柜方案',cargos:[],groups:[],settings:C.clone(C.DEFAULTS),draft:null};}
 function cleanCargo(c){const n=C.clone(c);delete n._placedDim;delete n.manualOrientation;return {...n,id:String(c.id),name:c.name||'未命名货物',l:+c.l||0,w:+c.w||0,h:+c.h||0,qty:+c.qty,weight:C.known(+c.weight)?+c.weight:null,rotateMode:c.rotateMode||'upright',stackable:c.stackable!==false,maxLayers:+c.maxLayers||0,topLoad:c.topLoad===null||c.topLoad===undefined||c.topLoad===''?null:+c.topLoad};}
 function fromLegacy(state,opt={}){
   if(!state.id)state.id=newId();
   const p={...empty(),id:state.id,context:C.clone(state.context||{}),demo:state.demo===true,name:state.title||state.name||'未命名装柜方案',cargos:state.cargos.filter(c=>+c.qty>0).map(cleanCargo),groups:C.clone(state.groups||[]),draft:state.draft?C.clone(state.draft):null,settings:{...C.DEFAULTS,...state.settings}};
   if(opt.supportRatio!==undefined)p.settings.minSupport=opt.supportRatio;
   if(opt.maxContainers!==undefined)p.settings.maxContainers=opt.maxContainers;
   if(opt.multiContainer!==undefined)p.settings.autoAdd=opt.multiContainer;
   if(opt.sameKindFirst!==undefined)p.settings.sameKindFirst=opt.sameKindFirst;
   if(opt.preferredSpecs)p.settings.containers=opt.preferredSpecs.map(c=>({type:c.spec.id,qty:c.qty}));
   return p;
 }
 function dirty(p){const d=p.draft;if(!d)return false;const g=p.groups.find(g=>g.id===d.id);if(!g)return !!d.children?.length;return JSON.stringify(g.children)!==JSON.stringify(d.children)||g.name!==d.name||g.allowRotate!==d.allowRotate;}
 function read(){const raw=localStorage.getItem(KEY)||localStorage.getItem('super-u-prestack-v2');if(!raw)return empty();const p=JSON.parse(raw);C.checkProject(p);return {...p,id:p.id||newId(),context:p.context||{},appVersion:'3.2.0',settings:{...C.DEFAULTS,...p.settings}};}
 function write(p,options={}){C.checkProject(p);p.id=p.id||newId();p.context=p.context||{};p.appVersion='3.2.0';localStorage.setItem(KEY,JSON.stringify(p));root.PlannerLearning?.observe(p,options.action||'stack-edit').catch(()=>{});}
 function toLegacy(p,r){
   if(!r.audit.ok)throw Error('排柜结果校验失败：'+r.audit.issues[0]);
   const units=C.expand(p.cargos),map=new Map(units.map(u=>[u.uid,u]));
   const containers=r.containers.map((ct,i)=>{
     const layers=new Map(),items=ct.boxes.map(b=>{const u=map.get(b.uid),below=ct.boxes.filter(a=>a.uid!==b.uid&&Math.abs(a.z+a.dz-b.z)<C.EPS&&a.x<b.x+b.dx-C.EPS&&b.x<a.x+a.dx-C.EPS&&a.y<b.y+b.dy-C.EPS&&b.y<a.y+a.dy-C.EPS),layer=1+Math.max(0,...below.map(a=>layers.get(a.uid)||0));layers.set(b.uid,layer);
       const risk=ct.transport?.risks.find(r=>r.uid===b.uid);
       const notes=[u.note,b.groupName?'组合：'+b.groupName:'',!C.known(u.weight)?'重量待确认':'',ct.issues.some(x=>x.code==='capacityUnknown'&&x.uids?.includes(b.uid))?'上压承重待确认':'',risk?C.Transport.note(risk):''].filter(Boolean);
       return {...b,cargoId:b.id,origin:[u.l,u.w,u.h],ctnNo:u.ctnNo?u.ctnNo+(u.qty>1?'-'+u.index:''):b.uid,weight:C.known(u.weight)?u.weight:0,layer,note:notes.join('；')};});
     const spec={...(root.ContainerLib?.byId(ct.spec.id)||{}),...ct.spec,name:root.ContainerLib?.byId(ct.spec.id)?.name||ct.spec.id};
     const stats=root.Packer.statsOf(spec,items);stats.cogWarn=Math.abs(stats.cogDevX)>.05||Math.abs(stats.cogDevY)>.05;stats.cogLevel=Math.abs(stats.cogDevX)>.10||Math.abs(stats.cogDevY)>.10?'danger':stats.cogWarn?'warn':'ok';
     return {index:i+1,spec,items,stats,transport:ct.transport,strategy:'组合保持完整 · 支撑、承压与防倾倒初筛'};
   });
   const unpacked=r.unpacked.map(b=>({...map.get(b.uid),cargoId:map.get(b.uid)?.id,...b,_reason:b.reason}));
   const vol=containers.reduce((s,c)=>s+c.stats.volumeUsedCbm,0),cap=containers.reduce((s,c)=>s+c.stats.volumeTotalCbm,0);
   return {containers,unpacked,transport:C.Transport.overview(r.containers),summary:{totalUnits:r.total,packedUnits:r.loaded,unpackedUnits:unpacked.length,containerCount:containers.length,totalVolumeCbm:vol,totalWeight:containers.reduce((s,c)=>s+c.stats.weight,0),avgVolumeRate:cap?vol/cap:0},warningDetails:r.containers.flatMap(c=>c.issues.filter(i=>i.severity==='warning')),warnings:[...new Set(r.containers.flatMap(c=>c.issues.filter(i=>i.severity==='warning').map(i=>i.message)))],signature:r.signature};
 }
 function packProject(p){if(dirty(p))throw Error('请先保存或放弃叠箱草稿。');return toLegacy(p,C.pack(p));}
 function recommend(p,presets){if(dirty(p))throw Error('请先到叠箱页保存或放弃草稿。');return presets.filter(s=>s.id!=='LCL').map(s=>{const q=C.clone(p);q.settings.containers=[{type:s.id,qty:1}];q.settings.autoAdd=true;const r=C.pack(q),vol=r.containers.reduce((n,c)=>n+c.volume,0),cap=r.containers.reduce((n,c)=>n+c.spec.L*c.spec.W*c.spec.H/1e9,0);return {id:s.id,name:s.name,containers:r.containers.length,unpacked:r.unpacked.length,rate:cap?vol/cap:0,capacity:cap};}).sort((a,b)=>a.unpacked-b.unpacked||a.containers-b.containers||a.capacity-b.capacity);}
 const api={KEY,empty,cleanCargo,fromLegacy,dirty,read,write,toLegacy,packProject,recommend};if(typeof module==='object')module.exports=api;else root.PlannerBridge=api;
})(typeof window!=='undefined'?window:globalThis);
