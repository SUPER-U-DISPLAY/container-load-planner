'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),C=require('../core.js'),B=require('../bridge.js'),S=require('../stacking.js'),P=require('../layout.js'),E=require('../experience.js');
const cargo=(id,extra={})=>({id,name:id,l:600,w:800,h:500,qty:1,weight:30,topLoad:100,maxLayers:2,stackable:true,rotateMode:'upright',...extra});
function fixture(prefix=''){
 const p=B.empty();p.id='project-'+prefix;p.cargos=[cargo(prefix+'base',{name:'底箱',qty:2}),cargo(prefix+'cap',{name:'顶板箱',l:1200,h:200,weight:10,topLoad:0,maxLayers:1,stackable:false})];
 const manual=C.clone(p);manual.groups=[{id:'manual-'+prefix,name:'人工二托一',allowRotate:true,children:[{uid:prefix+'base#1',x:0,y:0,z:0,orientation:0},{uid:prefix+'base#2',x:600,y:0,z:0,orientation:0},{uid:prefix+'cap#1',x:0,y:0,z:500,orientation:0}]}];
 const auto=C.clone(p);auto.groups=S.autoCombine(p).groups;
 const record=E.makeCase({id:'case-'+prefix,projectId:p.id,baseline:{project:auto,result:C.pack(auto)},final:{project:manual,result:C.pack(manual)}});
 return {p,manual,auto,record};
}
test('人工二托一确认后，新箱单能复用基础算法不会搭出的多底箱组合',()=>{
 const {record}=fixture('old-'),{p}=fixture('new-'),plain=S.autoCombine(p),learned=E.combine(p,[record]);
 assert.ok(!plain.groups.some(g=>g.children.length===3));assert.equal(learned.learning.historicalGroups,1);assert.equal(learned.groups[0].children.length,3);
 const applied=S.applyAutoCombine(p,learned),result=P.canonical(applied,C.pack(applied));assert.equal(result.loaded,3);assert.equal(result.audit.ok,true);assert.equal(E.templateLibrary([record,record]).length,1);assert.equal(E.templateLibrary([record,record])[0].projectCount,1);
});
test('模板匹配检查包装版本、尺寸、重量和当前限制，不放宽承压与禁转',()=>{
 const {record}=fixture('old-');for(const change of [{packageVersion:'new-v2'},{weight:29},{topLoad:0},{l:610},{rotateMode:'none'}]){
  const {p}=fixture('new-');Object.assign(p.cargos[0],change);const learned=E.combine(p,[record]);assert.equal(learned.learning.historicalGroups,0);for(const g of learned.groups)assert.equal(C.validate(C.groupBoxes(g,C.expand(p.cargos)),p.settings).ok,true);
 }
 const {p}=fixture('short-');p.settings.standardHeight=600;assert.equal(E.combine(p,[record]).learning.historicalGroups,0);
});
test('手动翻转例外不会变成新箱子的自动允许朝向',()=>{
 const p=B.empty();p.id='manual-flip';p.cargos=[cargo('a',{qty:2,h:300,weight:20})];p.groups=[{id:'g',name:'flip',allowRotate:false,children:[{uid:'a#1',x:0,y:0,z:0,orientation:2,manualOrientation:true},{uid:'a#2',x:0,y:0,z:800,orientation:2,manualOrientation:true}]}];
 const record=E.makeCase({id:'flip-case',final:{project:p,result:C.pack(p)}}),q=C.clone(p);q.groups=[];assert.equal(E.combine(q,[record]).learning.historicalGroups,0);assert.equal(q.cargos[0].rotateMode,'upright');
});
test('变更输入切断偏好对，无理由不推断容易倒，原样采纳不自我训练',()=>{
 const {record,manual,auto}=fixture();assert.equal(record.inferredReason,null);assert.equal(record.reason,'');
 const changed=C.clone(manual);changed.cargos[0].weight=31;const r=E.makeCase({id:'changed',baseline:{project:auto,result:C.pack(auto)},final:{project:changed,result:C.pack(changed)}});assert.equal(r.baseline,null);assert.equal(r.rankingEligible,false);
 const adopted=E.makeCase({id:'adopt',baseline:{project:manual,result:C.pack(manual)},final:{project:manual,result:C.pack(manual)}});assert.equal(adopted.rankingEligible,false);assert.equal(adopted.arrival,'unknown');
});
test('练习、被排除案例不参与学习；同项目派生版本不膨胀独立项目数',()=>{
 const {record}=fixture();assert.equal(E.templateLibrary([{...record,demo:true},{...record,excluded:true}]).length,0);
 const family=Array.from({length:6},(_,i)=>({...record,id:'case'+i,projectId:'copy'+i,familyId:'same-erp-project'}));assert.equal(E.train(family).validation.independentProjects,1);assert.equal(E.templateLibrary(family)[0].projectCount,1);
});
test('偏好策略按独立项目留出验证，模板可先发布且不改变硬规则',()=>{
 const before=JSON.stringify(C.DEFAULTS),one=E.train([fixture('one-').record]);assert.equal(one.mode,'templates-only');assert.equal(one.validation.sufficient,false);assert.equal(E.publish(one).enabled,true);
 const records=Array.from({length:8},(_,i)=>fixture('project'+i+'-').record),candidate=E.train(records);assert.ok(candidate.validation.holdoutProjects>=1);assert.ok(candidate.validation.trainingProjects>=3);assert.deepEqual(new Set(candidate.sampleIds).size,8);assert.equal(JSON.stringify(C.DEFAULTS),before);
 const bad={...candidate,publishable:true,mode:'templates-and-preferences',validation:{sufficient:true,holdoutAgreement:0}};assert.throws(()=>E.publish(bad),/验证未通过/);
});
test('历史整柜位置映射到新实箱编号，并重新校验柜型与组合',()=>{
 const {manual,record}=fixture('old-'),original=C.pack(manual),shifted=P.move(manual,original,'g:'+manual.groups[0].id,{x:2000});record.final.result=shifted;
 const {manual:next}=fixture('new-'),replay=E.remapResult(record,next);assert.ok(replay);assert.equal(Math.min(...replay.containers[0].boxes.map(b=>b.x)),2000);assert.ok(replay.containers[0].boxes.every(b=>b.uid.startsWith('new-')));
 const packed=E.pack(next,[record]);assert.equal(packed.learning.source,'历史确认方案');assert.equal(packed.audit.ok,true);
 next.settings.containers=[{type:'20GP',qty:1}];next.settings.autoAdd=false;const r=E.pack(next,[record]);assert.equal(r.containers[0].spec.id,'20GP');
});
test('柜内整组移动、换柜保持内部布局与落地限制',()=>{
 const {manual:p}=fixture(),r=P.addContainer(p,C.pack(p)),k='g:'+p.groups[0].id,shift=P.move(p,r,k,{container:1,x:1200,y:100,z:0});assert.equal(shift.containers[0].boxes.length,0);assert.equal(shift.containers[1].boxes.length,3);assert.equal(shift.audit.ok,true);
 assert.throws(()=>P.move(p,shift,k,{z:100}),/柜底|悬空/);const rotated=P.rotate(p,shift,k);assert.equal(rotated.audit.ok,true);assert.equal(P.rotate(p,rotated,k).audit.ok,true);assert.throws(()=>P.rotate(p,rotated,k,'x'),/只能整体水平/);
});
test('锁定上箱包含支撑，局部重排不移动锁定位置，暂存仍守恒',()=>{
 const p=B.empty();p.id='locks';p.cargos=[cargo('a',{qty:3,l:5800,w:2300,h:900,rotateMode:'none'})];p.settings.containers=[{type:'20GP',qty:2}];p.settings.autoAdd=false;
 let r=P.canonical(p,C.pack(p)),upper=r.containers[0].boxes.find(b=>b.z>0);assert.ok(upper);r=P.lock(p,r,P.key(upper));assert.equal(r.locks.length,2);const before=r.containers.flatMap(ct=>ct.boxes).filter(b=>r.locks.includes(P.key(b))).map(b=>[b.uid,b.x,b.y,b.z]);const after=P.repackUnlocked(p,r);assert.deepEqual(after.containers.flatMap(ct=>ct.boxes).filter(b=>r.locks.includes(P.key(b))).map(b=>[b.uid,b.x,b.y,b.z]),before);assert.throws(()=>P.move(p,r,P.key(upper),{x:10}),/锁定/);
 const free=after.containers.flatMap(ct=>ct.boxes).find(b=>!after.locks.includes(P.key(b))),held=P.hold(p,after,P.key(free));assert.equal(held.loaded+held.unpacked.length,3);assert.equal(held.audit.ok,true);
});
test('服务端同一校验拒绝篡改柜型、外来尺寸、超高补顶、归属与重复箱号',()=>{
 const {manual:p}=fixture(),r=C.pack(p);for(const mutate of [r=>r.containers[0].spec.maxWeight=1e9,r=>r.containers[0].boxes[0].dx=1,r=>r.containers[0].boxes[0].manual=true,r=>r.containers[0].boxes[0].groupId='other',r=>r.containers[0].boxes.push(r.containers[0].boxes[0])]){const next=C.clone(r);mutate(next);assert.throws(()=>P.canonical(p,next));}
 const cfg=C.clone(p);cfg.settings.doorW=500;assert.throws(()=>P.canonical(cfg,r),/柜门/);
});
module.exports={fixture,cargo};
