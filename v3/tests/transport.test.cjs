'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../core.js'),T=C.Transport,B=require('../bridge.js'),P=require('../layout.js'),E=require('../experience.js'),R=require('../rules.js');
const cargo=(id,extra={})=>({id,name:id,l:2000,w:200,h:2000,qty:1,weight:100,topLoad:0,rotateMode:'upright',stackable:false,...extra});
const project=cs=>({...B.empty(),cargos:cs});
const placed=(c,pos={})=>C.box({...c,uid:c.id+'#1',index:1},pos);
test('窄高货物按前后和左右分别初筛，柜壁接触不代表已经固定',()=>{
 const b=placed(cargo('narrow')),r=T.screen([b],C.SPECS['40HQ']);assert.equal(r.needsSecuring,1);assert.deepEqual(r.risks[0].weak,['yMinus','yPlus']);assert.equal(r.risks[0].contacts.yMinus.kind,'wall');assert.equal(r.risks[0].contacts.yMinus.verified,false);assert.ok(r.risks[0].exposed.includes('yPlus'));
});
test('上叠累计重心参与检查：单箱稳的两层高塔仍然提示防倒',()=>{
 const c=cargo('layer',{l:1200,w:600,h:600,weight:50,qty:2,stackable:true,topLoad:100}),bs=[placed(c),C.box({...c,uid:'layer#2',index:2},{z:600})];
 assert.equal(T.screen([bs[0]]).needsSecuring,0);const r=T.screen(bs);assert.ok(r.risks.some(x=>x.uid==='layer#1'));assert.equal(r.risks.find(x=>x.uid==='layer#1').effectiveWeight,100);
});
test('低矮、易碎、自己不稳、存在缝隙的邻箱不算有效侧挡候选',()=>{
 const b=placed(cargo('target')),side=cargo('side',{l:2000,w:2000,h:2000,weight:300,stackable:true,topLoad:300});
 for(const change of [{h:500},{name:'玻璃箱'},{w:200},{gap:5}]){
  const n=placed({...side,...change},{y:200+(change.gap||0)}),r=T.screen([b,n],C.SPECS['40HQ']).risks.find(x=>x.uid===b.uid);assert.equal(r.contacts.yPlus,null);
 }
});
test('足够高的稳定邻货只降低暴露程度，未知承力不会被当作安全证明',()=>{
 const b=placed(cargo('target')),n=placed(cargo('side',{l:2000,w:2000,h:2000,weight:300}),{y:200}),r=T.screen([b,n],C.SPECS['40HQ']);
 assert.equal(r.exposed,0);assert.equal(r.needsSecuring,1);assert.equal(r.status,'pending-securing');assert.equal(r.risks[0].contacts.yPlus.verified,false);
});
test('虚拟组合不把各自窄底箱变成宽底刚性整体',()=>{
 const p=project([cargo('a',{qty:2})]);p.groups=[{id:'g',name:'仅保存位置',children:[{uid:'a#1',x:0,y:0,z:0,orientation:0},{uid:'a#2',x:0,y:200,z:0,orientation:0}]}];
 const r=C.pack(p);assert.equal(r.loaded,2);assert.equal(r.transport.needsSecuring,2);assert.equal(r.audit.ok,true);
});
test('只有已经允许的朝向才能参与自动降低高度，固定箱不被自动翻转',()=>{
 const free=project([cargo('free',{rotateMode:'free'})]),r=C.pack(free);assert.equal(r.loaded,1);assert.equal(r.containers[0].boxes[0].dz,200);assert.equal(r.transport.needsSecuring,0);
 const fixed=project([cargo('fixed',{rotateMode:'none'})]),s=C.pack(fixed);assert.equal(s.containers[0].boxes[0].dz,2000);assert.equal(s.transport.needsSecuring,1);
});
test('玻璃镜子未知承压不能当底箱；明确承压、禁压和包装类型分别生效',()=>{
 const a=cargo('base',{name:'玻璃门木箱',l:1200,w:1000,h:600,stackable:true,topLoad:null,packageType:'wooden'}),b=cargo('top',{l:1000,w:800,h:400,weight:20});
 const validate=()=>C.validate([placed(a),placed(b,{z:600})]);assert.ok(validate().issues.some(i=>i.code==='fragileCapacity'));
 a.topLoad=30;assert.equal(validate().ok,true);a.topLoad=0;assert.equal(validate().ok,false);
 a.topLoad=null;a.packageType='ordinary';assert.equal(validate().ok,true);a.stackable=false;assert.equal(validate().ok,false);
});
test('移走侧挡后重新计算相邻箱风险；伪造运输通过标记无效',()=>{
 const p=project([cargo('target'),cargo('side',{l:2000,w:2000,h:2000,weight:300})]);let r=P.canonical(p,{containers:[{spec:{id:'40HQ',...C.SPECS['40HQ']},boxes:[placed(p.cargos[0]),placed(p.cargos[1],{y:200})]}],unpacked:[]});
 assert.equal(r.containers[0].transport.exposed,0);r.transport={needsSecuring:0,status:'screened'};r.containers[0].transport={needsSecuring:0};r=P.canonical(p,r);assert.equal(r.transport.needsSecuring,1);
 const moved=P.move(p,r,'u:side#1',{x:3000});assert.equal(moved.containers[0].transport.exposed,1);assert.equal(moved.audit.ok,true);
});
test('旧历史或篡改元数据不能让未加固的布局进入学习',()=>{
 const p=project([cargo('a')]),r=C.pack(p),record=E.makeCase({id:'risk',final:{project:p,result:r}});assert.equal(record.transportPending,true);assert.equal(E.eligible(record),false);assert.equal(E.templateLibrary([record]).length,0);
 record.transportPending=false;record.final.result.transport.needsSecuring=0;record.final.result.containers[0].transport.needsSecuring=0;assert.equal(E.eligible(record),false);
});
test('包装类型和防误叠设置进入指纹、规则保存与模板条件',()=>{
 const p=project([cargo('a')]),s=C.fingerprint(p),next=R.applyChanges(p,{stabilityAware:false},[{id:'a',packageType:'wooden'}]);assert.notEqual(C.fingerprint(next),s);assert.notEqual(E.typeKey(p.cargos[0]),E.typeKey(next.cargos[0]));assert.throws(()=>R.applyChanges(p,{},[{id:'a',packageType:'invalid'}]),/包装类型/);
});
test('单箱超限高给出实际差额，库存守恒且增加同型柜不会伪称解决',()=>{
 const p=project([cargo('tall',{h:2580})]),r=C.pack(p);assert.equal(r.loaded,0);assert.equal(r.unpacked.length,1);assert.match(r.unpacked[0].reason,/2580.*2570.*10 mm/);assert.equal(r.audit.ok,true);
});
