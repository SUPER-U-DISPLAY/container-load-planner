/* Drag placement uses packaging dimensions in millimetres, independent of rendering. */
(function(root){
 'use strict';
 const C=typeof module==='object'?require('./core.js'):root.PlannerCore;
 function placement(unit,orientation,point,support,boxes,snap=true,anchor=null){
  const d=C.poses(unit)[orientation],a=anchor||{x:d[0]/2,y:d[1]/2};
  let x=point.x-a.x,y=point.y-a.y,z=support?support.z+support.dz:0;
  if(snap){
   if(support){
    if(d[0]<=support.dx+C.EPS)x=Math.max(support.x,Math.min(support.x+support.dx-d[0],x));
    if(d[1]<=support.dy+C.EPS)y=Math.max(support.y,Math.min(support.y+support.dy-d[1],y));
   }
   const near=(n,values)=>{let best=n,dist=100;for(const v of values){const diff=Math.abs(n-v);if(v>=0&&diff<dist){best=v;dist=diff;}}return best===n?Math.round(n/10)*10:best;};
   const atLevel=boxes.filter(b=>Math.abs(b.z+b.dz-z)<C.EPS||z===0&&b.z===0);
   x=near(x,[0,...atLevel.flatMap(b=>[b.x,b.x+b.dx-d[0],b.x+(b.dx-d[0])/2,b.x+b.dx,b.x-d[0]])]);
   y=near(y,[0,...atLevel.flatMap(b=>[b.y,b.y+b.dy-d[1],b.y+(b.dy-d[1])/2,b.y+b.dy,b.y-d[1]])]);
  }
  return {uid:unit.uid,...(unit.manualOrientation?{manualOrientation:true}:{}),x:Math.max(0,Math.round(x)),y:Math.max(0,Math.round(y)),z:Math.round(z),orientation};
 }
 function assess(unit,pos,boxes,settings){const next=C.box(unit,pos);return {box:next,...C.validatePlacement([...boxes,next],settings)};}
 const api={placement,assess};if(typeof module==='object')module.exports=api;else root.PlannerDrag=api;
})(typeof window!=='undefined'?window:globalThis);
