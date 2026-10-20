/* WebGL normally; the same 3D scene, camera and picking also work with Canvas on GPU-less browsers. */
(function(){
 'use strict';
 const T=THREE,Native=T.WebGLRenderer;
 class CanvasRenderer{
  constructor(options={}){this.domElement=options.canvas||document.createElement('canvas');this.context=this.domElement.getContext('2d');if(!this.context)throw Error('无法创建画布');this.isSoftwareRenderer=true;this.ratio=1;this.width=1;this.height=1;}
  setPixelRatio(r){this.ratio=Math.min(r||1,2);}
  setSize(w,h,style=true){this.width=Math.max(1,w);this.height=Math.max(1,h);this.domElement.width=Math.round(w*this.ratio);this.domElement.height=Math.round(h*this.ratio);if(style){this.domElement.style.width=w+'px';this.domElement.style.height=h+'px';}}
  setClearColor(c){this.clearColor=new T.Color(c);}
  dispose(){}
  render(scene,camera){
    const ctx=this.context,w=this.width,h=this.height;ctx.setTransform(this.ratio,0,0,this.ratio,0,0);ctx.clearRect(0,0,w,h);ctx.fillStyle='#'+(scene.background||this.clearColor||new T.Color('#f3f5f9')).getHexString();ctx.fillRect(0,0,w,h);
    scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);const jobs=[],p=new T.Vector3(),normal=new T.Vector3(),light=new T.Vector3(.5,1,.8).normalize();
    const project=(x,y,z,m)=>p.set(x,y,z).applyMatrix4(m).project(camera).clone();
    scene.traverseVisible(o=>{
      const material=Array.isArray(o.material)?o.material[0]:o.material;if(!material||material.visible===false)return;
      if(o.isSprite&&material.map?.image){const pos=o.getWorldPosition(new T.Vector3()),v=pos.clone().project(camera);if(v.z>1||v.z<-1)return;const sc=o.getWorldScale(new T.Vector3()),right=new T.Vector3().setFromMatrixColumn(camera.matrixWorld,0).multiplyScalar(sc.x/2).add(pos).project(camera),up=new T.Vector3().setFromMatrixColumn(camera.matrixWorld,1).multiplyScalar(sc.y/2).add(pos).project(camera);jobs.push({sprite:material.map.image,x:(v.x+1)*w/2,y:(1-v.y)*h/2,sw:Math.abs(right.x-v.x)*w,sh:Math.abs(up.y-v.y)*h,z:material.depthTest===false?-2:v.z,opacity:material.opacity});return;}
      const g=o.geometry,attr=g?.attributes?.position;if(!attr)return;
      if(o.isLineSegments){for(let i=0;i<attr.count;i+=2){const a=project(attr.getX(i),attr.getY(i),attr.getZ(i),o.matrixWorld),b=project(attr.getX(i+1),attr.getY(i+1),attr.getZ(i+1),o.matrixWorld);if(a.z>1||b.z>1||a.z<-1||b.z<-1)continue;jobs.push({line:true,pts:[a,b],z:material.depthTest===false?-1.5:(a.z+b.z)/2-1e-6,color:'#'+material.color.getHexString(),opacity:material.opacity,width:material.linewidth||1});}return;}
      if(!o.isMesh)return;
      const count=g.index?.count||attr.count;
      for(let j=0;j<count;j+=3){const ids=[0,1,2].map(k=>g.index?g.index.getX(j+k):j+k),world=ids.map(i=>new T.Vector3(attr.getX(i),attr.getY(i),attr.getZ(i)).applyMatrix4(o.matrixWorld)),vs=world.map(v=>v.clone().project(camera));if(vs.some(v=>v.z>1||v.z<-1))continue;normal.subVectors(world[1],world[0]).cross(new T.Vector3().subVectors(world[2],world[0])).normalize();const mid=world[0].clone().add(world[1]).add(world[2]).multiplyScalar(1/3);if(material.side!==T.DoubleSide&&normal.dot(camera.position.clone().sub(mid))<=0)continue;const col=material.color.clone().multiplyScalar(.7+.3*Math.max(0,normal.dot(light)));jobs.push({pts:vs,z:vs.reduce((a,v)=>a+v.z,0)/3,color:'#'+col.getHexString(),opacity:material.opacity});}
    });
    jobs.sort((a,b)=>b.z-a.z);
    for(const j of jobs){ctx.globalAlpha=j.opacity??1;if(j.sprite){ctx.drawImage(j.sprite,j.x-j.sw/2,j.y-j.sh/2,j.sw,j.sh);continue;}ctx.beginPath();j.pts.forEach((v,i)=>{const x=(v.x+1)*w/2,y=(1-v.y)*h/2;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});if(j.line){ctx.strokeStyle=j.color;ctx.lineWidth=j.width;ctx.stroke();}else{ctx.closePath();ctx.fillStyle=j.color;ctx.fill();}}ctx.globalAlpha=1;
  }
 }
 let software=false;
 T.WebGLRenderer=function(options){if(!software)try{return new Native(options);}catch(e){software=true;}return new CanvasRenderer(options);};
 window.PlannerCanvasRenderer=CanvasRenderer;
})();
