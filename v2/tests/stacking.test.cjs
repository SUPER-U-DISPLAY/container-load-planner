const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../core.js'),S=require('../stacking.js');
const u=(id,l,w,h,extra={})=>({id,uid:id+'#1',name:id,l,w,h,qty:1,weight:50,rotateMode:'upright',stackable:true,maxLayers:0,topLoad:500,...extra});
test('快捷摆放支持一托二：第二只上箱只能推荐未占用且有支撑的位置',()=>{
 const base=C.box(u('base',1200,1000,1100,{weight:80})),a=u('top',600,1000,650,{weight:18}),first=S.suggest(a,[base]);
 assert.ok(first.above.some(o=>o.position.x===0&&o.position.z===1100));
 const placed=C.box(a,first.above[0].position),second=u('top2',600,1000,650,{weight:18}),r=S.suggest(second,[base,placed]);
 assert.ok(r.above.some(o=>o.position.x===600&&o.position.z===1100));
 for(const o of [...r.above,...r.beside])assert.equal(C.validate([base,placed,C.box(second,o.position)]).ok,true);
});
test('快捷摆放支持二托一：同时识别两只底箱的支撑',()=>{
 const a=C.box(u('a',600,1000,1000)),b=C.box(u('b',600,1000,1000),{x:600}),top=u('top',1200,1000,500,{weight:10});
 const r=S.suggest(top,[a,b]);assert.ok(r.above.some(o=>o.supports.length===2&&o.position.z===1000));
});
test('不能承叠的箱子仍能放顶层，但不提供在其上方压箱的选项',()=>{
 const base=C.box(u('base',1000,1000,1000)),top=u('top',1000,1000,500,{weight:10,stackable:false});
 assert.equal(S.supportClass(top),'topOnly');assert.ok(S.suggest(top,[base]).above.length);
 const r=S.suggest(u('other',1000,1000,300,{weight:5}),[C.box(top)]);assert.equal(r.above.length,0);assert.match(r.reason,/不能压箱/);assert.equal(r.beside.length,2);
});
test('快捷选项会拦截重箱在上、超高和累计承压问题',()=>{
 const b=C.box(u('base',1000,1000,1800,{weight:10,topLoad:5}));
 for(const top of [u('heavy',1000,1000,500,{weight:20}),u('tall',1000,1000,900,{weight:1}),u('load',1000,1000,400,{weight:6})])assert.equal(S.suggest(top,[b]).above.length,0);
});
test('未知重量保留待确认提示；缺尺寸、层数和零承压分类明确',()=>{
 const base=C.box(u('base',1000,1000,1000)),top=u('top',1000,1000,500,{weight:null}),r=S.suggest(top,[base]);assert.ok(r.above.length);assert.ok(r.above[0].issues.some(i=>i.code==='weightUnknown'));
 assert.equal(S.supportClass({...top,l:0}),'pending');assert.equal(S.suggest({...top,l:0},[base]).above.length,0);
 assert.equal(S.supportClass({...top,maxLayers:1}),'topOnly');assert.equal(S.supportClass({...top,topLoad:0}),'topOnly');
});
