/* Canonical layout editing. Shared by browser, tests and the API worker. */
(function(root){
 'use strict';
 const C=typeof module==='object'?require('./core.js'):root.PlannerCore;
 const key=b=>b.groupId?'g:'+b.groupId:'u:'+b.uid;
 const fail=message=>{throw Error(message);};
 function blockList(boxes){
  const map=new Map();for(const b of boxes){const k=key(b);if(!map.has(k))map.set(k,[]);map.get(k).push(b);}
  return [...map].map(([k,bs])=>{const x=Math.min(...bs.map(b=>b.x)),y=Math.min(...bs.map(b=>b.y)),z=Math.min(...bs.map(b=>b.z)),e=C.extent(bs);return {id:bs[0].groupId||bs[0].uid,key:k,group:!!bs[0].groupId,x,y,z,dx:e.L-x,dy:e.W-y,dz:e.H-z};});
 }
 function limits(project,containers){
  const cfg={...C.DEFAULTS,...project.settings},configured=new Map();
  for(const row of cfg.containers)configured.set(row.type,(configured.get(row.type)||0)+row.qty);
  const count=cfg.containers.reduce((n,c)=>n+c.qty,0),max=cfg.autoAdd?Math.max(count,cfg.maxContainers):count,last=cfg.containers.at(-1).type,used=new Map();
  if(containers.length>max)fail('柜数超过当前项目允许数量');
  for(const ct of containers){const type=ct.spec.id;used.set(type,(used.get(type)||0)+1);if(!configured.has(type))fail('柜型不在当前配置中');}
  for(const [type,n] of used)if(n>configured.get(type)&&(!cfg.autoAdd||type!==last))fail('只有配置列表最后一种柜型可自动追加');
 }
 function canonical(project,input,{keepEmpty=true}={}){
  const units=C.checkProject(project),byUid=new Map(units.map(u=>[u.uid,u])),groupByUid=new Map(),approved=new Set();
  for(const g of project.groups)for(const pos of g.children){groupByUid.set(pos.uid,g);if(pos.manualOrientation)approved.add(pos.uid);}
  if(!input||!Array.isArray(input.containers)||!Array.isArray(input.unpacked))fail('排柜结果格式不正确');
  const cfg={...C.DEFAULTS,...project.settings};
  const containers=input.containers.map((original,index)=>{
   const type=original.spec?.id,spec=C.SPECS[type];if(!spec)fail('未知柜型');
   for(const field of ['L','W','H','maxWeight'])if(original.spec[field]!==undefined&&original.spec[field]!==spec[field])fail('柜型参数不能被方案修改');
   if(!Array.isArray(original.boxes))fail('箱子位置清单不完整');
   const boxes=original.boxes.map(pos=>{
    const u=byUid.get(pos.uid);if(!u)fail('出现未知箱号 '+pos.uid);
    if(pos.manual)fail('当前版本不允许绕过常规高度的摆法');
    const g=groupByUid.get(pos.uid);if((pos.groupId||null)!==(g?.id||null))fail('箱子的组合归属被改变');
    if(!!pos.manualOrientation!==approved.has(pos.uid))fail('手动朝向必须来自已保存组合');
    const b={...C.box(u,{x:pos.x,y:pos.y,z:pos.z,orientation:pos.orientation,manualOrientation:approved.has(pos.uid)}),...(g?{groupId:g.id,groupName:g.name}:{}),blockId:g?.id||u.uid};
    for(const field of ['x','y','z','dx','dy','dz'])if(!Number.isFinite(b[field]))fail('位置或朝向无效：'+u.name);
    for(const field of ['dx','dy','dz'])if(pos[field]!==undefined&&Math.abs(pos[field]-b[field])>C.EPS)fail('摆放尺寸与箱型朝向不一致：'+u.name);
    return b;
   });
   const ct={index,spec:{id:type,...spec},boxes,blocks:blockList(boxes),itemIds:[],weight:boxes.reduce((n,b)=>n+(C.known(b.weight)?b.weight:0),0)};
   ct.itemIds=ct.blocks.map(b=>b.id);
   for(const b of ct.blocks){if(cfg.doorW&&b.dy>cfg.doorW+C.EPS)fail('单元宽度超过柜门宽度');if(cfg.doorH&&b.dz>cfg.doorH+C.EPS)fail('单元高度超过柜门高度');}
   return C.summarize(ct,cfg);
  }).filter(ct=>keepEmpty||ct.boxes.length);
  limits(project,containers);
  const unpacked=input.unpacked.map(b=>{const u=byUid.get(b.uid);if(!u)fail('未装入清单出现未知箱号');return {uid:u.uid,name:u.name,reason:b.reason||'人工暂存为未装入'};});
  const result={signature:C.fingerprint(project),containers,unpacked,total:units.length,loaded:containers.reduce((n,c)=>n+c.boxes.length,0),createdAt:input.createdAt||new Date().toISOString(),locks:[...new Set(input.locks||[])]};
  C.resultMeta(project,result);
  result.audit=C.audit(project,result);
  if(!result.audit.ok)fail(result.audit.issues[0]);
  const existing=new Set(containers.flatMap(ct=>ct.boxes.map(key)));
  result.locks=result.locks.filter(k=>existing.has(k));
  if(input.learning)result.learning=C.clone(input.learning);
  if(input.planning)result.planning={...C.clone(input.planning),targetFound:containers.length<=input.planning.targetContainers&&result.loaded===units.filter(u=>!u.pending).length};
  return result;
 }
 function selected(result,selection){
  for(let index=0;index<result.containers.length;index++){const boxes=result.containers[index].boxes.filter(b=>key(b)===selection||b.uid===selection);if(boxes.length)return {index,boxes,key:key(boxes[0])};}
  return null;
 }
 function move(project,result,selection,position){
  const next=C.clone(result),found=selected(next,selection);if(!found)fail('请先选择柜内箱子或组合');
  if((next.locks||[]).includes(found.key))fail('该位置已锁定，请先解锁');
  const target=position.container??found.index;if(!next.containers[target])fail('目标柜不存在');
  const x=Math.min(...found.boxes.map(b=>b.x)),y=Math.min(...found.boxes.map(b=>b.y)),z=Math.min(...found.boxes.map(b=>b.z));
  const shift={x:(position.x??x)-x,y:(position.y??y)-y,z:(position.z??z)-z};
  next.containers[found.index].boxes=next.containers[found.index].boxes.filter(b=>key(b)!==found.key);
  next.containers[target].boxes.push(...found.boxes.map(b=>({...b,x:b.x+shift.x,y:b.y+shift.y,z:b.z+shift.z})));
  return canonical(project,next);
 }
 function rotate(project,result,selection,axis='z'){
  const next=canonical(project,result),found=selected(next,selection);if(!found)fail('请先选择箱子或组合');if(next.locks.includes(found.key))fail('该位置已锁定');
  const first=found.boxes[0],x=Math.min(...found.boxes.map(b=>b.x)),y=Math.min(...found.boxes.map(b=>b.y));let replacements;
  if(first.groupId){
   if(axis!=='z')fail('保存组合只能整体水平转向，组内翻转请到叠箱页');
   const group=project.groups.find(g=>g.id===first.groupId),base=C.groupBoxes(group,C.expand(project.cargos));
   if(group.allowRotate===false||base.some(b=>b.rotateMode==='none'))fail('该组合不允许整组转向');
   const normal=C.normalize(found.boxes.map(b=>({uid:b.uid,x:b.x,y:b.y,z:b.z,orientation:b.orientation,manualOrientation:b.manualOrientation})),C.expand(project.cargos));
   const original=normal.every(pos=>{const b=base.find(b=>b.uid===pos.uid);return ['x','y','z'].every(k=>Math.abs(pos[k]-b[k])<C.EPS)&&pos.orientation===b.orientation;});
   replacements=(original?C.rotateBoxes(base):base).map(b=>({...b,x:b.x+x,y:b.y+y,blockId:group.id}));
  }else{
   const target=axis==='x'?[first.dx,first.dz,first.dy]:axis==='y'?[first.dz,first.dy,first.dx]:[first.dy,first.dx,first.dz];
   const orientation=C.poses(first).findIndex(d=>d.every((v,i)=>Math.abs(v-target[i])<C.EPS));
   if(orientation<0)fail('此箱型不允许这个朝向。可在叠箱页明确翻转并保存，或修改箱型允许朝向');
   replacements=[{...C.box(first,{x:first.x,y:first.y,z:first.z,orientation}),blockId:first.uid}];
  }
  next.containers[found.index].boxes=next.containers[found.index].boxes.filter(b=>key(b)!==found.key).concat(replacements);
  return canonical(project,next);
 }
 function hold(project,result,selection){
  const next=canonical(project,result),found=selected(next,selection);if(!found)fail('请先选择箱子或组合');if(next.locks.includes(found.key))fail('该位置已锁定');
  next.containers[found.index].boxes=next.containers[found.index].boxes.filter(b=>key(b)!==found.key);
  next.unpacked.push(...found.boxes.map(b=>({uid:b.uid,name:b.name,reason:'人工暂存为未装入'})));return canonical(project,next);
 }
 function addContainer(project,result){
  const next=C.clone(result),cfg={...C.DEFAULTS,...project.settings},queue=cfg.containers.flatMap(c=>Array(c.qty).fill(c.type));
  const type=queue[next.containers.length]||queue.at(-1);next.containers.push({spec:{id:type,...C.SPECS[type]},boxes:[]});return canonical(project,next);
 }
 function lock(project,result,selection,enabled=true){
  const next=canonical(project,result),found=selected(next,selection);if(!found)fail('请先选择柜内箱子');const locks=new Set(next.locks);
  if(!enabled){locks.delete(found.key);next.locks=[...locks];return next;}
  locks.add(found.key);let changed=true;
  while(changed){changed=false;for(const ct of next.containers)for(const b of ct.boxes.filter(b=>locks.has(key(b))))for(const below of ct.boxes){
   if(Math.abs(below.z+below.dz-b.z)<C.EPS&&C.overlap({...b,z:0,dz:1},{...below,z:0,dz:1})&&!locks.has(key(below))){locks.add(key(below));changed=true;}
  }}
  next.locks=[...locks];return next;
 }
 function placeHeld(project,result,uid,container=0){
  const next=canonical(project,result),input=C.makeItems(project),item=input.items.find(it=>it.variants[0].some(b=>b.uid===uid));if(!item)fail('箱子不可用，先检查组合规则或尺寸');
  if(!item.variants[0].every(b=>next.unpacked.some(u=>u.uid===b.uid)))fail('组合成员必须全部在未装入清单');
  const ct=next.containers[container];if(!ct)fail('请先增加一个柜');
  if(!C.placeOne(item,ct,{...C.DEFAULTS,...project.settings}))fail('本柜没有找到符合规则的位置，可拖动或调整空间');
  const ids=new Set(item.variants[0].map(b=>b.uid));next.unpacked=next.unpacked.filter(b=>!ids.has(b.uid));return canonical(project,next);
 }
 function repackUnlocked(project,result){
  let saved=canonical(project,result);for(const k of [...saved.locks])saved=lock(project,saved,k,true);
  const locks=new Set(saved.locks),input=C.makeItems(project),fixed=saved.containers.map(ct=>({...ct,boxes:ct.boxes.filter(b=>locks.has(key(b)))}));
  const claimed=new Set(fixed.flatMap(ct=>ct.boxes.map(b=>b.uid)));let left=input.items.filter(it=>!it.variants[0].some(b=>claimed.has(b.uid)));
  const cfg={...C.DEFAULTS,...project.settings},queue=cfg.containers.flatMap(c=>Array(c.qty).fill(c.type)),limit=cfg.autoAdd?Math.max(queue.length,cfg.maxContainers):queue.length,containers=[];
  for(let i=0;i<limit&&(left.length||i<fixed.length);i++){
   const type=fixed[i]?.spec.id||queue[i]||queue.at(-1),seed=fixed[i]||{spec:{id:type,...C.SPECS[type]},boxes:[]};
   seed.blocks=blockList(seed.boxes);seed.weight=seed.boxes.reduce((n,b)=>n+(C.known(b.weight)?b.weight:0),0);seed.itemIds=seed.blocks.map(b=>b.id);
   const attempt=C.packToSpec(left,{id:type,...C.SPECS[type]},cfg,i,seed);left=attempt.left;containers.push(attempt.ct);
   if(!attempt.ct.boxes.length&&i>=Math.max(queue.length,fixed.length)-1)break;
  }
  const unpacked=input.unpacked.concat(left.flatMap(it=>it.variants[0].map(b=>({uid:b.uid,name:b.name,reason:'锁定位置及当前规则下未找到位置'}))));
  return canonical(project,{containers,unpacked,locks:[...locks]});
 }
 const api={key,blockList,limits,canonical,selected,move,rotate,hold,addContainer,lock,placeHeld,repackUnlocked};
 if(typeof module==='object')module.exports=api;else root.PlannerLayout=api;
})(typeof self!=='undefined'?self:globalThis);
