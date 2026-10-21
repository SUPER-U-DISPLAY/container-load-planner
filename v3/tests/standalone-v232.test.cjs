const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../core.js'),S=require('../stacking.js'),R=require('../rules.js'),B=require('../bridge.js'),D=require('../scene-math.js');
const cargo=(id,extra={})=>({id,name:id,l:1200,w:800,h:500,qty:1,weight:50,topLoad:500,maxLayers:0,rotateMode:'upright',stackable:true,...extra});
const unit=c=>({...c,uid:c.id+'#1',index:1});
const project=(cargos,groups=[],settings={})=>({...B.empty(),cargos,groups,settings:{...C.clone(C.DEFAULTS),...settings}});
const fullGroup=()=>project([cargo('底箱',{l:5800,w:2300,h:1000,qty:2,rotateMode:'none'}),cargo('散箱',{l:500,w:500,h:300,weight:10,rotateMode:'none'})],[{id:'g',name:'柜底组合',allowRotate:false,children:[{uid:'底箱#1',x:0,y:0,z:0,orientation:0},{uid:'底箱#2',x:0,y:0,z:1000,orientation:0}]}],{containers:[{type:'20GP',qty:1}],autoAdd:false});
test('默认水平箱型可通过明确手动动作前后/左右翻，单只朝向保存且不改其他实箱',()=>{
 const c=cargo('a',{qty:2}),u=unit(c),pos={uid:u.uid,x:0,y:0,z:0,orientation:0};
 const first=S.rotatePlacement(u,pos,'x',[C.box(u,pos)],C.DEFAULTS,{manual:true});assert.equal(first.ok,true);assert.equal(first.position.manualOrientation,true);assert.deepEqual([C.box(u,first.position).dx,C.box(u,first.position).dy,C.box(u,first.position).dz],[1200,500,800]);
 const second=S.rotatePlacement(C.box(u,first.position),first.position,'y',[C.box(u,first.position)],C.DEFAULTS,{manual:true});assert.equal(second.ok,true);
 const p=project([c],[{id:'g',name:'手动翻转',allowRotate:false,children:[second.position]}]),saved=JSON.parse(JSON.stringify(p)),r=C.pack(saved),placed=r.containers.flatMap(ct=>ct.boxes).find(b=>b.uid==='a#1');
 assert.equal(r.audit.ok,true);assert.equal(r.loaded,2);assert.equal(placed.manualOrientation,true);assert.equal(saved.cargos[0].rotateMode,'upright');assert.equal(C.poses(C.expand(saved.cargos).find(u=>u.uid==='a#2')).length,2);assert.deepEqual([placed.dx,placed.dy,placed.dz],[800,500,1200]);
});
test('拖动和规则保存后不会丢失手动翻转；固定朝向仍不能翻转',()=>{
 const c=cargo('a',{qty:2}),u=unit(c),r=S.rotatePlacement(u,{uid:u.uid,x:0,y:0,z:0,orientation:0},'x',[],C.DEFAULTS,{manual:true});
 const moved=D.placement(C.box(u,r.position),r.position.orientation,{x:1500,y:500},null,[],true);assert.equal(moved.manualOrientation,true);
 const p=project([c],[{id:'g',name:'g',children:[moved],allowRotate:false}]);p.draft=C.clone(p.groups[0]);
 const next=R.applyChanges(p,{standardHeight:2400},[]);assert.equal(next.groups[0].children[0].manualOrientation,true);assert.equal(C.validate(C.groupBoxes(next.groups[0],C.expand(next.cargos)),next.settings).ok,true);
 const blocked=unit(cargo('fixed',{rotateMode:'none'}));assert.equal(S.rotatePlacement(blocked,{orientation:0,x:0,y:0,z:0},'x',[],C.DEFAULTS,{manual:true}).restricted,true);
 const reset=R.applyChanges(project([c],[{id:'reset',name:'reset',children:[{uid:'a#1',x:0,y:0,z:0,orientation:0,manualOrientation:true}]}]),{},[{id:'a',rotateMode:'none'}]);assert.equal(reset.groups[0].children[0].manualOrientation,undefined);assert.equal(C.pack(reset).audit.ok,true);
});
test('补顶空间足够也不往已保存组合上加散箱，且不开人工补顶绕过',()=>{
 const p=fullGroup(),r=C.pack(p);assert.equal(r.loaded,2);assert.equal(r.unpacked.length,1);assert.equal(r.unpacked[0].uid,'散箱#1');assert.match(r.unpacked[0].reason,/组合上方禁止加箱/);assert.equal(r.audit.ok,true);
 p.settings.autoAdd=true;p.settings.maxContainers=2;const multi=C.pack(p);assert.equal(multi.loaded,3);assert.equal(multi.containers.length,2);assert.equal(multi.alternative,undefined);assert.equal(multi.audit.ok,true);
 assert.equal(multi.containers.find(c=>c.boxes.some(b=>b.groupId==='g')).boxes.filter(b=>!b.groupId).length,0);
});
test('组合不能叠在散箱或另一个组合上，也不能共用占地上方空间',()=>{
 const p=project([cargo('g',{qty:2,h:500}),cargo('floor',{h:500,weight:200})],[{id:'g1',name:'组合一',children:[{uid:'g#1',x:0,y:0,z:0,orientation:0}]},{id:'g2',name:'组合二',children:[{uid:'g#2',x:0,y:0,z:0,orientation:0}]}]);
 const all=C.expand(p.cargos),floor=C.box(all.find(u=>u.uid==='floor#1'));
 const first=C.groupBoxes(p.groups[0],all).map(b=>({...b,z:500})),second=C.groupBoxes(p.groups[1],all).map(b=>({...b,z:1000}));
 const invalid=C.validate([floor,...first,...second],p.settings,C.SPECS['40HQ']);assert.ok(invalid.issues.some(i=>i.code==='groupFloor'));assert.ok(invalid.issues.some(i=>i.code==='groupIsolation'));
 const r=C.pack(p);assert.equal(r.audit.ok,true);for(const ct of r.containers)for(const g of p.groups){const members=ct.boxes.filter(b=>b.groupId===g.id);if(!members.length)continue;assert.equal(Math.min(...members.map(b=>b.z)),0);for(const other of ct.boxes.filter(b=>b.groupId!==g.id))assert.ok(other.x>=members[0].x+members[0].dx-C.EPS||other.x+other.dx<=members[0].x+C.EPS||other.y>=members[0].y+members[0].dy-C.EPS||other.y+other.dy<=members[0].y+C.EPS);}
});
test('组内编辑仍可叠箱；单独散箱之间继续按正常规则叠放',()=>{
 const p=fullGroup(),all=C.expand(p.cargos),members=C.groupBoxes(p.groups[0],all),cap=C.box(all.find(u=>u.uid==='散箱#1'),{z:2000});
 assert.equal(C.validate([...members,cap],p.settings).ok,true);assert.equal(C.validate([...members,cap],p.settings,C.SPECS['20GP']).ok,false);
 const loose=project([cargo('loose',{l:5800,w:2300,h:1000,qty:2,rotateMode:'none'})],[],{containers:[{type:'20GP',qty:1}],autoAdd:false});const r=C.pack(loose);assert.equal(r.loaded,2);assert.ok(r.containers[0].boxes.some(b=>b.z===1000));assert.equal(r.audit.ok,true);
});
test('审计拒绝被篡改为组合上方加散箱的结果和未经保存的手动朝向',()=>{
 const p=fullGroup();p.settings.autoAdd=true;p.settings.maxContainers=2;const r=C.pack(p),cap=r.containers[1].boxes[0];r.containers[0].boxes.push({...cap,x:0,y:0,z:2000,seq:3});r.containers.pop();assert.ok(C.audit(p,r).issues.some(t=>t.includes('上方不再安排')));
 const single=project([cargo('a')]),safe=C.pack(single);safe.containers[0].boxes[0].manualOrientation=true;assert.ok(C.audit(single,safe).issues.some(t=>t.includes('手动朝向')));
});
