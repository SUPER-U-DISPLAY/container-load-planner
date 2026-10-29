'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../core.js'),B=require('../bridge.js'),P=require('../layout.js'),E=require('../experience.js'),R=require('../rules.js');
const cargo=(id,extra={})=>({id,name:id,l:1200,w:1000,h:500,qty:1,weight:100,rotateMode:'upright',stackable:true,topLoad:300,maxLayers:0,...extra});
const project=cs=>({...B.empty(),cargos:cs});
const placed=(c,pos={})=>C.box({...c,uid:c.id+'#1',index:1},pos);
function constrained(){const p=project([cargo('base',{l:12000,w:2300,h:1650,weight:1000,topLoad:1000,rotateMode:'none'}),cargo('mirror',{name:'镜子柜',l:2230,w:480,h:780,weight:167,topLoad:0,rotateMode:'none'})]);p.settings.autoAdd=false;return p;}
test('联合预排保留有加固条件的上层布局，生成方向、作用位置、需求与核实事项，不能冒充安全通过',()=>{
 const p=constrained(),r=P.canonical(p,C.pack(p));assert.equal(r.loaded,2);assert.equal(r.containers.length,1);assert.equal(r.audit.ok,true);assert.equal(r.readiness.ready,false);assert.equal(r.readiness.status,'conditional-plan');
 const plan=r.containers[0].transport.plans.find(v=>v.uid==='mirror#1');assert.ok(plan);assert.equal(plan.verified,false);assert.ok(plan.actions.every(a=>a.at.z>1650&&a.demandN>0&&a.checks.length>=4));assert.ok(plan.actions.some(a=>a.method==='direct-lashing'));
 const record=E.makeCase({id:'conditional',final:{project:p,result:r}});assert.equal(E.eligible(record),false);assert.equal(record.transportPending,true);
 record.final.result.readiness.ready=true;record.final.result.transport.needsSecuring=0;record.final.result.containers[0].transport.plans=[];assert.equal(E.eligible(record),false);
});
test('同一箱单切换仅自稳模式仍严格拒绝危险高叠，不能用关闭优化或确认字段绕过',()=>{
 const p=constrained();p.settings.planningMode='self-stable';p.settings.stabilityAware=false;const r=C.pack(p);assert.equal(r.loaded,1);assert.equal(r.unpacked.length,1);
 const bad={containers:[{spec:{id:'40HQ'},boxes:[placed(p.cargos[0]),placed(p.cargos[1],{z:1650})],transport:{verified:true}}],unpacked:[],readiness:{ready:true}};assert.throws(()=>P.canonical(p,bad),/无约束高叠/);
});
test('单件2580mm可作落地进柜待核实预排，显式柜门余量冲突仍拒绝，叠高不被放宽',()=>{
 const p=project([cargo('tall',{h:2580,rotateMode:'none'})]);p.settings.reviewTallSingles=true;let r=C.pack(p);assert.equal(r.loaded,1);assert.equal(r.readiness.entryReview,1);assert.equal(r.readiness.ready,false);assert.equal(r.containers[0].boxes[0].z,0);
 p.settings.doorH=2585;r=C.pack(p);assert.equal(r.loaded,0);assert.equal(r.unpacked.length,1);
 p.settings.doorH=2610;r=C.pack(p);assert.equal(r.loaded,1);assert.equal(r.readiness.entryReview,1);
 p.settings.reviewTallSingles=false;assert.equal(C.pack(p).loaded,0);
 const bottom=placed(cargo('bottom',{h:1500})),top=placed(cargo('top',{h:1080,weight:20}),{z:1500});assert.ok(C.validatePlacement([bottom,top],C.DEFAULTS,C.SPECS['40HQ']).issues.some(i=>i.code==='height'));
});
test('承压空白仅允许条件预排；已知零承压、禁叠和易碎未确认承压继续拦截',()=>{
 const p=constrained();p.cargos[0].topLoad=null;let r=C.pack(p);assert.equal(r.loaded,2);assert.equal(r.readiness.ready,false);assert.ok(r.containers[0].issues.some(i=>i.code==='capacityUnknown'));
 for(const patch of [{topLoad:0},{stackable:false},{name:'玻璃底箱',topLoad:null}]){const q=C.clone(p);Object.assign(q.cargos[0],patch);assert.equal(C.pack(q).loaded,1);}
});
test('加固需求重算而非信任输入报告，邻货移动后路径更新且不会产生循环承力证明',()=>{
 const p=project([cargo('a',{w:200,h:1800,topLoad:0}),cargo('b',{w:200,h:1800,topLoad:0})]);
 let r=P.canonical(p,{containers:[{spec:{id:'40HQ'},boxes:[placed(p.cargos[0]),placed(p.cargos[1],{y:200})]}],unpacked:[]});
 const before=r.containers[0].transport.plans.find(x=>x.uid==='a#1').actions.find(x=>x.direction==='yPlus');assert.ok(before.path.includes('b#1'));
 r=P.move(p,r,'u:b#1',{x:2000,y:1000});const after=r.containers[0].transport.plans.find(x=>x.uid==='a#1').actions.find(x=>x.direction==='yPlus');assert.equal(after.path.includes('b#1'),false);assert.equal(r.readiness.ready,false);
});
test('人工保存组合仍整组落地并独占底面，联合搜索不会拆组或在顶部补箱',()=>{
 const p=project([cargo('a',{qty:2,h:400}),cargo('b',{l:600,w:500,h:200,weight:10})]);p.groups=[{id:'g',name:'固定组合',children:[{uid:'a#1',x:0,y:0,z:0,orientation:0},{uid:'a#2',x:0,y:0,z:400,orientation:0}]}];const r=P.canonical(p,C.pack(p));assert.equal(r.loaded,3);assert.equal(r.audit.ok,true);assert.equal(r.containers[0].boxes.find(x=>x.uid==='a#1').z,0);assert.throws(()=>P.move(p,r,'u:b#1',{x:0,y:0,z:800}),/独占/);
});
test('缺尺寸箱保持库存守恒，不计入货物体积；加固示意用量不抬高利用率',()=>{
 const p=constrained();p.cargos.push(cargo('unknown',{l:0,qty:2}));const r=P.canonical(p,C.pack(p));assert.equal(r.total,4);assert.equal(r.loaded,2);assert.equal(r.unpacked.length,2);assert.equal(r.readiness.missingDimensions,2);
 const ct=r.containers[0],expected=C.volume(ct.boxes);assert.equal(ct.volume,expected);assert.equal(ct.utilization,expected/(ct.spec.L*ct.spec.W*ct.spec.H/1e9));assert.equal(new Set([...ct.boxes,...r.unpacked].map(b=>b.uid)).size,4);
});
test('估算费用只在柜费和加固费用齐全时参与比较，不能混入默认零价',()=>{
 const p=constrained();assert.equal(C.pack(p).estimatedCost,null);p.settings.containerCosts={'40HQ':1000};p.settings.securingUnitCost=20;const r=C.pack(p);assert.equal(r.estimatedCost,1000+20*r.transport.planCount);
 const a={loaded:2,containers:[{}],estimatedCost:2000},b={loaded:2,containers:[{},{}],estimatedCost:1500};assert.ok(C.Transport.compare(a,b,{usePrices:true})>0);
});
test('包装模板按明确尺寸、重量范围、规则版本及生产依据复用，不按名称推断',()=>{
 const p=project([cargo('a'),cargo('b',{weight:80})]);const profile={id:'wood-v1',version:1,name:'同规格木箱',reference:'生产工艺A',dimensions:[1200,1000,500],maxWeight:100,rules:{packageType:'wooden',rotateMode:'upright',stackable:true,maxLayers:2,topLoad:120}};
 const next=R.applyProfile(p,['a','b'],profile);assert.equal(next.cargos[1].topLoad,120);assert.equal(next.cargos[1].profileId,profile.id);assert.notEqual(E.typeKey(next.cargos[1]),E.typeKey(p.cargos[1]));
 p.cargos[1].w=900;assert.throws(()=>R.applyProfile(p,['b'],profile),/范围/);assert.throws(()=>R.applyProfile(p,['a'],{...profile,reference:''}),/确认依据/);
});
test('目标柜数用于有界搜索，未找到目标不谎称数学上装不下，关闭自动加柜仍守上限',()=>{
 const p=project([cargo('big',{l:12000,w:2300,h:2400,qty:2,weight:1000,rotateMode:'none'})]);p.settings.targetContainers=1;const r=C.pack(p);assert.equal(r.loaded,2);assert.equal(r.containers.length,2);assert.equal(r.planning.targetFound,false);assert.match(r.planning.searchNote,/未找到.*不等于/);
 p.settings.autoAdd=false;assert.equal(C.pack(p).loaded,1);
});

test('估算重量即使几何稳定也不能成为已核实案例，来源变化切断模板精确匹配',()=>{const p=project([cargo('a',{weightSource:'estimated'})]),r=C.pack(p);assert.equal(r.transport.needsSecuring,0);assert.equal(r.readiness.ready,false);const c=E.makeCase({id:'estimate',final:{project:p,result:r}});assert.equal(E.eligible(c),false);assert.notEqual(E.typeKey(p.cargos[0]),E.typeKey({...p.cargos[0],weightSource:'measured'}));});

test('柜型比较有缺价时统一排序，费用齐全后才统一比较总费用',()=>{const p=project([cargo('small')]),presets=['20GP','40HQ'].map(id=>({id,name:id,...C.SPECS[id]}));p.settings.containerCosts={'40HQ':1000};let list=B.recommend(p,presets);assert.ok(list.every(r=>r.pricingComplete===false));assert.equal(list[0].id,'20GP');p.settings.containerCosts['20GP']=2000;list=B.recommend(p,presets);assert.ok(list.every(r=>r.pricingComplete));assert.equal(list[0].id,'40HQ');});
