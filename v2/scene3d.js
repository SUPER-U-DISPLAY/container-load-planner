/* True 3D picking and constrained dragging; uses the same scene with WebGL or software rendering. */
(function(){
 'use strict';
 const T=THREE,C=PlannerCore,M=PlannerDrag,MM=.001;
 function meshFor(b,selected=false){
  const g=new T.BoxGeometry(b.dx*MM,b.dz*MM,b.dy*MM),m=new T.Mesh(g,new T.MeshLambertMaterial({color:b.color||'#779bc3'}));
  m.position.set((b.x+b.dx/2)*MM,(b.z+b.dz/2)*MM,(b.y+b.dy/2)*MM);m.userData.box=b;
  const lines=new T.LineSegments(new T.EdgesGeometry(g),new T.LineBasicMaterial({color:selected?'#1457d4':'#35516c',linewidth:selected?2:1}));m.add(lines);return m;
 }
 function disposeObject(o){o.traverse(n=>{n.geometry?.dispose();if(Array.isArray(n.material))n.material.forEach(m=>m.dispose());else n.material?.dispose();});}
 function lighting(s){s.add(new T.AmbientLight(0xffffff,.7));const l=new T.DirectionalLight(0xffffff,.7);l.position.set(4,9,6);s.add(l);}
 class StackScene{
  constructor(canvas,options={}){
   this.canvas=canvas;this.options=options;this.boxes=[];this.meshes=[];this.selected=null;this.settings={};this.view='iso';this.snap=true;
   this.scene=new T.Scene();this.scene.background=new T.Color('#f3f5f9');lighting(this.scene);
   this.camera=new T.PerspectiveCamera(42,1,.01,100);this.renderer=new T.WebGLRenderer({canvas,antialias:true,alpha:false});this.renderer.setPixelRatio(window.devicePixelRatio);
   this.controls=new T.OrbitControls(this.camera,canvas);this.controls.enableDamping=false;this.controls.screenSpacePanning=true;this.controls.minDistance=.3;this.controls.maxDistance=40;this.controls.maxPolarAngle=Math.PI/2-.01;
   this.controls.mouseButtons.LEFT=undefined;this.controls.mouseButtons.MIDDLE=T.MOUSE.DOLLY;this.controls.mouseButtons.RIGHT=T.MOUSE.ROTATE;
   this.controls.addEventListener('change',()=>this.render());this.ray=new T.Raycaster();this.labels=document.getElementById('sceneLabels');
   canvas.addEventListener('contextmenu',e=>e.preventDefault());canvas.addEventListener('pointerdown',e=>this.pickDown(e));
   this.onMove=e=>this.move(e);this.onUp=e=>this.end(e);this.onCancel=()=>this.cancel();
   document.addEventListener('pointermove',this.onMove);document.addEventListener('pointerup',this.onUp);document.addEventListener('pointercancel',this.onCancel);window.addEventListener('blur',this.onCancel);document.addEventListener('keydown',e=>{if(e.key==='Escape')this.cancel();});
   this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas.parentElement);this.makeFloor();this.resize();this.fit();
  }
  setData(boxes,selected,settings){this.cancel(false);this.boxes=boxes;this.selected=selected;this.settings=settings;for(const m of this.meshes){this.scene.remove(m);disposeObject(m);}this.meshes=boxes.map(b=>meshFor(b,b.uid===selected));this.meshes.forEach(m=>this.scene.add(m));this.makeFloor();this.makeLabels();this.render();}
  makeFloor(){
   if(this.floor){this.scene.remove(this.floor);disposeObject(this.floor);}
   const e=C.extent(this.boxes);this.bed={L:Math.max(2.8,e.L*MM+.5),W:Math.max(2.5,e.W*MM+.5)};const s=Math.max(this.bed.L,this.bed.W);
   this.floor=new T.Group();const grid=new T.GridHelper(s,Math.max(5,Math.round(s/.25)),0xc0cddd,0xdce4ee);grid.position.set(s/2,-.004,s/2);this.floor.add(grid);
   const axes=new T.BufferGeometry().setFromPoints([new T.Vector3(0,0,0),new T.Vector3(s,0,0),new T.Vector3(0,0,0),new T.Vector3(0,0,s)]);this.floor.add(new T.LineSegments(axes,new T.LineBasicMaterial({color:'#8ba4c3'})));this.scene.add(this.floor);
  }
  makeLabels(){this.labels.replaceChildren();this.labelNodes=this.boxes.map(b=>{const n=document.createElement('span');n.className='scene-label'+(b.uid===this.selected?' selected':'');n.textContent=b.name+' · '+(b.ctnNo||'箱')+' '+b.index;n.dataset.uid=b.uid;this.labels.append(n);return {b,n};});}
  resize(){const r=this.canvas.parentElement.getBoundingClientRect();this.w=Math.max(1,r.width);this.h=Math.max(1,r.height);this.renderer.setSize(this.w,this.h,false);this.camera.aspect=this.w/this.h;this.camera.updateProjectionMatrix();this.render();}
  fit(view=this.view){this.view=view;const e=C.extent(this.boxes),has=this.boxes.length>0;let minX=has?Math.min(...this.boxes.map(b=>b.x))*MM:0,minY=has?Math.min(...this.boxes.map(b=>b.y))*MM:0;const l=has?e.L*MM-minX:1.8,w=has?e.W*MM-minY:1.6,h=has?e.H*MM:1;const center=new T.Vector3(minX+l/2,h*.4,minY+w/2),size=Math.max(l,w,h,1.5),dist=size*2.1/Math.min(1,this.camera.aspect);
   this.controls.target.copy(center);const direction=view==='top'?new T.Vector3(0,1,.001):view==='front'?new T.Vector3(.001,.13,1):new T.Vector3(1.2,1.1,1.45);this.camera.position.copy(center).add(direction.normalize().multiplyScalar(dist));this.camera.lookAt(center);this.controls.update();this.render();}
  render(){if(!this.w)return;this.renderer.render(this.scene,this.camera);for(const {b,n} of this.labelNodes||[]){const v=new T.Vector3((b.x+b.dx/2)*MM,(b.z+b.dz)*MM,(b.y+b.dy/2)*MM).project(this.camera);n.style.left=(v.x+1)*this.w/2+'px';n.style.top=(1-v.y)*this.h/2-8+'px';n.style.display=v.z>1||v.z<-1?'none':'';}this.options.onRender?.();}
  pointer(e){const r=this.canvas.getBoundingClientRect();this.ray.setFromCamera(new T.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),this.camera);return e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom;}
  pickDown(e){if(e.button!==0)return;this.pointer(e);const hit=this.ray.intersectObjects(this.meshes,false)[0];if(!hit){this.options.onSelect?.(null);return;}const b=hit.object.userData.box;
   // Selection can redraw the scene, so capture the picked box first.
   this.options.onSelect?.(b.uid);this.begin(e,b,true,{x:hit.point.x/MM-b.x,y:hit.point.z/MM-b.y});
  }
  beginPaletteDrag(e,unit){if(e.button!==0)return;this.begin(e,unit,false,null);}
  begin(e,unit,existing,anchor){e.preventDefault();this.cancel(false);this.drag={unit,existing,anchor,orientation:existing?unit.orientation:0,startX:e.clientX,startY:e.clientY,pointerId:e.pointerId,active:false,position:null,assessment:null};this.controls.enabled=false;this.canvas.style.cursor='grabbing';}
  move(e){const d=this.drag;if(!d||e.pointerId!==d.pointerId)return;if(!d.active&&Math.hypot(e.clientX-d.startX,e.clientY-d.startY)<4)return;d.active=true;e.preventDefault();const inside=this.pointer(e);
   if(!inside){this.clearGhost();d.position=null;this.options.onFeedback?.('把箱子拖进中间工作台，再松开鼠标',null);return;}
   const others=this.boxes.filter(b=>b.uid!==d.unit.uid),targets=this.meshes.filter(m=>m.userData.box.uid!==d.unit.uid);const hit=this.ray.intersectObjects(targets,false)[0];let support=hit?.object.userData.box||null;let level=support?(support.z+support.dz)*MM:0;let point=this.ray.ray.intersectPlane(new T.Plane(new T.Vector3(0,1,0),-level),new T.Vector3());
   if(!point)return;
   const pos=M.placement(d.unit,d.orientation,{x:point.x/MM,y:point.z/MM},support,others,this.snap,d.anchor);const check=M.assess(d.unit,pos,others,this.settings);d.position=pos;d.assessment=check;
   this.clearGhost();this.ghost=meshFor({...check.box,color:check.ok?'#58b781':'#d97676'});this.ghost.material.transparent=true;this.ghost.material.opacity=.72;this.scene.add(this.ghost);const moving=this.meshes.find(m=>m.userData.box.uid===d.unit.uid);if(d.existing&&moving)moving.visible=false;
   const reason=check.issues.find(i=>i.severity==='error')?.message;this.options.onFeedback?.(check.ok?'松开即可放置 · '+(support?'叠在 '+support.name+' 上方':'放在地面')+' · 离地 '+pos.z+' mm':'不能放置：'+reason,check.ok);this.render();
  }
  end(e){const d=this.drag;if(!d||e.pointerId!==d.pointerId)return;const valid=d.active&&d.position&&d.assessment?.ok,pos=d.position;const msg=d.assessment?.issues.find(i=>i.severity==='error')?.message;this.cancel(false);if(valid)this.options.onDrop?.(d.unit,pos,d.existing);else if(d.active)this.options.onFeedback?.(msg?'未放置：'+msg:'已取消拖动',false);}
  clearGhost(){if(this.ghost){this.scene.remove(this.ghost);disposeObject(this.ghost);this.ghost=null;}this.meshes.forEach(m=>m.visible=true);}
  cancel(render=true){this.drag=null;this.clearGhost();this.controls.enabled=true;this.canvas.style.cursor='default';if(render)this.render();}
  static preview(canvas,boxes){if(!boxes.length)return;const scene=new T.Scene();scene.background=new T.Color('#fafbfd');lighting(scene);boxes.forEach(b=>scene.add(meshFor(b)));const e=C.extent(boxes),minX=Math.min(...boxes.map(b=>b.x)),minY=Math.min(...boxes.map(b=>b.y)),minZ=Math.min(...boxes.map(b=>b.z));const center=new T.Vector3((minX+e.L)/2000,(minZ+e.H)/2000,(minY+e.W)/2000),size=Math.max(e.L-minX,e.W-minY,e.H-minZ)/1000;const r=canvas.getBoundingClientRect(),w=r.width||150,h=r.height||100,aspect=w/h,cam=new T.PerspectiveCamera(38,aspect,.01,100);cam.position.copy(center).add(new T.Vector3(1.25,1,1.5).normalize().multiplyScalar(Math.max(.1,size)*2/Math.min(1,aspect)));cam.lookAt(center);const renderer=new PlannerCanvasRenderer({canvas});renderer.setPixelRatio(window.devicePixelRatio);renderer.setSize(w,h,false);renderer.render(scene,cam);disposeObject(scene);}
 }
 window.StackScene=StackScene;
})();
