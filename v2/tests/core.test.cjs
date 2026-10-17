const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../core.js');
global.PlannerCore=C;
const I=require('../import.js');
const cargo=(id,l=1000,w=1000,h=1000,extra={})=>({id,name:id,l,w,h,qty:1,weight:50,rotateMode:'upright',stackable:true,maxLayers:0,topLoad:500,color:'#528e91',...extra});
const p=(cargos,groups=[],settings={})=>({schemaVersion:2,name:'Regression',cargos,groups,settings:{...C.clone(C.DEFAULTS),...settings}});
const b=(c,pos={})=>C.box({...c,uid:c.id+'#1',index:1},pos);
const has=(v,code)=>v.issues.some(i=>i.code===code);
test('一托二：两个上箱共同匹配大底箱，保存后整组放入且箱数守恒',()=>{
 const a=cargo('base',1200,1000,1100,{weight:80}),u=cargo('upper',600,1000,650,{weight:18,qty:2});
 const g={id:'g',name:'一托二',children:[{uid:'base#1',x:0,y:0,z:0,orientation:0},{uid:'upper#1',x:0,y:0,z:1100,orientation:0},{uid:'upper#2',x:600,y:0,z:1100,orientation:0}]};
 const project=p([a,u],[g]),r=C.pack(project);assert.equal(r.loaded,3);assert.equal(r.unpacked.length,0);assert.equal(r.containers[0].blocks.length,1);assert.equal(r.audit.ok,true);assert.equal(r.containers[0].volume,2.1);
});
test('二托一：同高底箱联合支撑；不同高会被拒绝',()=>{
 const a=b(cargo('a',600,1000,1000)),d=b(cargo('d',600,1000,1000),{x:600}),top=b(cargo('top',1200,1000,500,{weight:10}),{z:1000});
 assert.equal(C.validate([a,d,top]).ok,true);d.dz=900;d.h=900;assert.equal(C.validate([a,d,top]).ok,false);
});
test('装柜明细的顺序确保二托一的两个底箱均先于上箱',()=>{
 const a=b(cargo('a',600,1000,1000)),d=b(cargo('d',600,1000,1000),{x:600}),top=b(cargo('top',1200,1000,500,{weight:10}),{z:1000});
 const order=C.loadingOrder([top,d,a]).map(b=>b.uid);assert.deepEqual(order,['a#1','d#1','top#1']);
});
test('悬空、重叠、负坐标和非法朝向均被拒绝',()=>{
 assert.equal(has(C.validate([b(cargo('a'),{z:10})]),'floating'),true);
 assert.equal(has(C.validate([b(cargo('a')),b(cargo('b'))]),'collision'),true);
 assert.equal(has(C.validate([b(cargo('a'),{x:-1})]),'negative'),true);
 assert.equal(has(C.validate([b(cargo('a',1000,600,700,{rotateMode:'none'}),{orientation:1})]),'dimensions'),true);
});
test('重箱在上被拒绝，已知轻箱可放在重箱上',()=>{
 const a=b(cargo('a',1000,1000,1000,{weight:5})),d=b(cargo('d',900,900,900,{weight:500}),{z:1000});assert.equal(has(C.validate([a,d]),'heavyAbove'),true);a.weight=600;assert.equal(C.validate([a,d]).ok,true);
});
test('支撑率通过仍不能长宽双向外挑，单向按两端总和限制',()=>{
 const a=b(cargo('a')),d=b(cargo('d',1100,1100,500,{weight:10}),{z:1000});assert.equal(has(C.validate([a,d],{minSupport:.75,overhang:100}),'twoAxisOverhang'),true);
 const t=b(cargo('t',1100,1000,500,{weight:10}),{z:1000});assert.equal(C.validate([a,t],{minSupport:.9,overhang:100}).ok,true);assert.equal(has(C.validate([a,t],{minSupport:.9,overhang:99}),'overhang'),true);
});
test('下层箱 maxLayers 向上传递，禁止通过更换品种绕过',()=>{
 const bs=[b(cargo('a',1000,1000,800,{maxLayers:2,weight:80})),b(cargo('b',1000,1000,800,{weight:60}),{z:800}),b(cargo('c',900,900,800,{weight:10}),{z:1600})];assert.equal(has(C.validate(bs),'layers'),true);
});
test('上压重量累计到每个底箱；0 kg 也正确阻止承叠',()=>{
 const bs=[b(cargo('a',1000,1000,800,{weight:100,topLoad:30})),b(cargo('b',1000,1000,800,{weight:20}),{z:800}),b(cargo('c',900,900,800,{weight:20}),{z:1600})];assert.equal(has(C.validate(bs),'topLoad'),true);bs[0].topLoad=0;assert.equal(has(C.validate(bs.slice(0,2)),'topLoad'),true);
});
test('未知重量不会静默当作已验证的 0 kg',()=>{const v=C.validate([b(cargo('a',1000,1000,800,{weight:null}))]);assert.equal(v.ok,true);assert.equal(has(v,'weightUnknown'),true);});
test('长箱先尝试 20GP 失败后仍会进入后面的 40HQ',()=>{
 const r=C.pack(p([cargo('long',7000,1000,1000,{rotateMode:'none'})],[],{containers:[{type:'20GP',qty:1},{type:'40HQ',qty:1}],autoAdd:false}));assert.equal(r.loaded,1);assert.equal(r.containers[0].spec.id,'40HQ');
});
test('禁止自动加柜不影响已配置的第二个柜',()=>{
 const r=C.pack(p([cargo('full',5800,2300,2200,{qty:2,rotateMode:'none'})],[],{containers:[{type:'20GP',qty:2}],autoAdd:false}));assert.equal(r.loaded,2);assert.equal(r.containers.length,2);
});
test('缺尺寸的箱子保留在未装入清单且总数不变',()=>{
 const r=C.pack(p([cargo('missing',0,1000,800,{qty:3}),cargo('ok')]));assert.equal(r.total,4);assert.equal(r.loaded,1);assert.equal(r.unpacked.length,3);assert.equal(r.audit.ok,true);
});
test('禁止同一个箱子在多个组合中重复使用',()=>{
 const child={uid:'a#1',x:0,y:0,z:0,orientation:0};assert.throws(()=>C.pack(p([cargo('a')],[{id:'g1',children:[child]},{id:'g2',children:[child]}])),/重复/);
});
test('组合真实体积不包含外包空隙',()=>{
 const cs=[cargo('a'),cargo('b',500,1000,500,{weight:10})],g={id:'g',name:'g',children:[{uid:'a#1',x:0,y:0,z:0,orientation:0},{uid:'b#1',x:0,y:0,z:1000,orientation:0}]};const r=C.pack(p(cs,[g]));assert.equal(r.containers[0].volume,1.25);assert.equal(r.containers[0].blocks[0].dz,1500);
});
test('自动同底面组合不会漏箱、重复或超高',()=>{
 const project=p([cargo('a',1200,1000,800,{qty:9,weight:50})]);project.groups=C.autoGroup(project);assert.equal(project.groups.length,3);assert.equal(new Set(project.groups.flatMap(g=>g.children.map(b=>b.uid))).size,9);const r=C.pack(project);assert.equal(r.loaded,9);assert.equal(r.audit.ok,true);
});
test('整组旋转正确转换子箱坐标，不允许旋转的子箱禁止组旋转',()=>{
 const cs=[cargo('a',1000,2400,1000,{weight:80}),cargo('b',500,2400,500,{weight:10})],g={id:'g',name:'g',children:[{uid:'a#1',x:0,y:0,z:0,orientation:0},{uid:'b#1',x:0,y:0,z:1000,orientation:0}]};let r=C.pack(p(cs,[g]));assert.equal(r.loaded,2);assert.equal(r.audit.ok,true);cs[0].rotateMode='none';r=C.pack(p(cs,[g]));assert.equal(r.loaded,0);assert.equal(r.unpacked.length,2);
});
test('审计捕获遗漏、重复、篡改属性和被移动的组合子箱',()=>{
 const project=p([cargo('a',1000,1000,1000,{qty:2})],[{id:'g',name:'g',children:[{uid:'a#1',x:0,y:0,z:0,orientation:0},{uid:'a#2',x:1000,y:0,z:0,orientation:0}]}]),r=C.pack(project);assert.equal(r.audit.ok,true);r.containers[0].boxes[1].x+=100;assert.equal(C.audit(project,r).ok,false);r.containers[0].boxes[1].weight=1;assert.ok(C.audit(project,r).issues.some(t=>t.includes('属性')));r.containers[0].boxes.pop();assert.equal(C.audit(project,r).ok,false);
});
test('柜门限制与柜内总载重参与计算',()=>{
 let r=C.pack(p([cargo('a',2000,2200,2000,{rotateMode:'none'})],[],{doorW:2100}));assert.equal(r.loaded,0);r=C.pack(p([cargo('a',1000,1000,1000,{weight:50000})]));assert.equal(r.loaded,0);
});
test('常规高度不自动放宽；补顶单列候选并保持标准结果',()=>{
 const project=p([cargo('base',12000,2300,2500,{weight:1000,topLoad:100}),cargo('cap',1000,1000,150,{weight:10})],[],{containers:[{type:'40HQ',qty:1}]});
 const r=C.pack(project);assert.equal(r.containers.length,2);assert.equal(r.containers[0].boxes.length,1);assert.ok(r.alternative);assert.equal(r.alternative.containers.length,1);assert.equal(r.alternative.audit.ok,true);assert.ok(r.alternative.containers[0].boxes.some(b=>b.manual));
});
test('修改规则、箱数或组合即改变输入指纹',()=>{const project=p([cargo('a')]),s=C.fingerprint(project);project.settings.standardHeight=2400;assert.notEqual(C.fingerprint(project),s);});
test('导入不会因品名空行停止，并保留缺尺寸行和源行号',()=>{
 const r=I.parseGrid([['品名','长mm','宽mm','高mm','箱数'],['第一箱',1000,1000,500,1],['',900,800,500,2],['第三箱',null,500,500,3],['合计',null,null,null,6]]);assert.equal(r.rows.length,3);assert.equal(r.rows[1].cargo.qty,2);assert.equal(r.rows[2].cargo.l,0);assert.equal(r.rows[2].source,'Sheet1!4');
});
test('导入单位换算、无效箱数阻止、每箱重量未知保留 null',()=>{
 const r=I.parseGrid([['品名','L','W','H','箱数'],['a',100,80,50,2],['b',50,50,50,2.5]],'S',10);assert.equal(r.rows[0].cargo.l,1000);assert.equal(r.rows[0].cargo.weight,null);assert.equal(r.rows[1].invalid,true);
});
test('批量 80 箱性能与确定性',()=>{
 const project=p([cargo('a',1200,1000,800,{qty:40,weight:80}),cargo('b',600,500,500,{qty:40,weight:10})]);project.groups=C.autoGroup(project);const r=C.pack(project),r2=C.pack(project);assert.equal(r.audit.ok,true);assert.equal(r.total,r.loaded+r.unpacked.length);assert.deepEqual(r.containers.map(c=>c.boxes),r2.containers.map(c=>c.boxes));
});
