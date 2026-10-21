/* Packing-only drag mode. The original result viewer stays read-only. */
(function(){
 'use strict';
 const T=THREE,C=PlannerCore,P=PlannerLayout,MM=.001;
 class PackingScene extends StackScene{
  makeFloor(){
   super.makeFloor();const spec=this.options.bounds;if(!spec)return;
   const geometry=new T.BoxGeometry(spec.L*MM,spec.H*MM,spec.W*MM),wire=new T.LineSegments(new T.EdgesGeometry(geometry),new T.LineBasicMaterial({color:'#829ab3'}));geometry.dispose();wire.position.set(spec.L*MM/2,spec.H*MM/2,spec.W*MM/2);this.floor.add(wire);
   const bed=new T.Mesh(new T.PlaneGeometry(spec.L*MM,spec.W*MM),new T.MeshBasicMaterial({color:'#e6edf4',side:T.DoubleSide}));bed.rotation.x=-Math.PI/2;bed.position.set(spec.L*MM/2,-.008,spec.W*MM/2);this.floor.add(bed);
  }
  makeLabels(){super.makeLabels();for(const {b,n} of this.labelNodes)n.classList.toggle('selected',P.key(b)===this.selected);}
  setData(boxes,selected,settings){super.setData(boxes,selected,settings);for(const mesh of this.meshes)mesh.children[0]?.material.color.set(P.key(mesh.userData.box)===selected?'#1457d4':'#35516c');this.render();}
  fit(view=this.view){
   const spec=this.options.bounds;if(!spec){super.fit(view);return;}this.view=view;const center=new T.Vector3(spec.L/2000,spec.H/2500,spec.W/2000),size=Math.max(spec.L,spec.W,spec.H)/1000,distance=size*1.5/Math.min(1,this.camera.aspect);
   this.controls.maxDistance=100;this.controls.target.copy(center);const direction=view==='top'?new T.Vector3(0,1,.001):view==='front'?new T.Vector3(.001,.13,1):new T.Vector3(1.2,1.2,1.7);this.camera.position.copy(center).add(direction.normalize().multiplyScalar(distance));this.camera.lookAt(center);this.controls.update();this.render();
  }
  pickDown(e){
   if(e.button!==0)return;this.pointer(e);const hit=this.ray.intersectObjects(this.meshes,false)[0];if(!hit){this.options.onSelect?.(null);return;}
   const b=hit.object.userData.box,k=P.key(b),members=this.boxes.filter(a=>P.key(a)===k),x=Math.min(...members.map(a=>a.x)),y=Math.min(...members.map(a=>a.y)),z=Math.min(...members.map(a=>a.z)),extent=C.extent(members),unit={uid:k,l:extent.L-x,w:extent.W-y,h:extent.H-z,dx:extent.L-x,dy:extent.W-y,dz:extent.H-z,rotateMode:'none',groupId:b.groupId};
   this.options.onSelect?.(k);this.begin(e,unit,true,{x:hit.point.x/MM-x,y:hit.point.z/MM-y});this.drag.movingIds=new Set(members.map(a=>a.uid));
  }
  move(e){
   const d=this.drag;if(!d||e.pointerId!==d.pointerId)return;if(!d.active&&Math.hypot(e.clientX-d.startX,e.clientY-d.startY)<4)return;d.active=true;e.preventDefault();
   if(!this.pointer(e)){this.clearGhost();d.position=null;return;}if(d.lastFrame&&Date.now()-d.lastFrame<45)return;d.lastFrame=Date.now();
   const others=this.boxes.filter(b=>!d.movingIds.has(b.uid)),targets=this.meshes.filter(m=>!d.movingIds.has(m.userData.box.uid)),hit=this.ray.intersectObjects(targets,false)[0],support=d.unit.groupId?null:hit?.object.userData.box||null,level=support?(support.z+support.dz)*MM:0,point=this.ray.ray.intersectPlane(new T.Plane(new T.Vector3(0,1,0),-level),new T.Vector3());if(!point)return;
   const pos=PlannerDrag.placement(d.unit,0,{x:point.x/MM,y:point.z/MM},support,others,this.snap,d.anchor);let ok=false,message='';try{this.options.assess(d.unit.uid,pos);ok=true;}catch(e){message=e.message;}
   d.position=pos;d.assessment={ok,issues:message?[{severity:'error',message}]:[]};this.clearGhost();this.ghost=StackScene.boxMesh({...d.unit,...pos,color:ok?'#58b781':'#d97676'});this.ghost.material.transparent=true;this.ghost.material.opacity=.62;this.scene.add(this.ghost);this.meshes.filter(m=>d.movingIds.has(m.userData.box.uid)).forEach(m=>m.visible=false);this.options.onFeedback?.(ok?'松开即可放置 · '+pos.x+' / '+pos.y+' / '+pos.z+' mm':'不能放置：'+message,ok);this.render();
  }
 }
 window.PackingScene=PackingScene;
})();
