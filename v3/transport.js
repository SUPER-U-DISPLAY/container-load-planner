/* Transport planning screen, not a securing certificate. mm / kg.
   Uses box-centre mass assumptions and 0.8g horizontal / 1g vertical
   screening in BOTH axes. These conservative trial assumptions are not
   route-specific CTU acceleration coefficients. Contact is only a candidate
   for blocking: unknown wall/package strength never becomes verified safety. */
(function(root){
 'use strict';
 const VERSION='3.1.0',EPS=.01,ACCEL=.8;
 const TYPES=['auto','ordinary','fragile','wooden','frame'];
 const known=n=>Number.isFinite(n)&&n>0;
 function fragile(c){
  if(c.packageType==='ordinary')return false;
  return c.packageType==='fragile'||/玻璃|镜子|镜柜|镜面|大理石|易碎|\b(glass|mirror|marble|fragile)\b/i.test((c.name||'')+' '+(c.note||''));
 }
 function protectedBase(c,settings={}){return settings.protectFragile!==false&&fragile(c)&&!known(c.topLoad);}
 function area(a,b){return Math.max(0,Math.min(a.x+a.dx,b.x+b.dx)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.dy,b.y+b.dy)-Math.max(a.y,b.y));}
 function ownRisk(b){return Math.max(0,ACCEL-b.dx/b.dz)+Math.max(0,ACCEL-b.dy/b.dz);}
 function contacts(b,load,boxes,bounds){
  const result={xMinus:null,xPlus:null,yMinus:null,yPlus:null},cg=load.z,other={x:'y',y:'x'};
  for(const axis of ['x','y'])for(const sign of [-1,1]){
   const key=axis+(sign<0?'Minus':'Plus'),edge=b[axis]+(sign>0?b['d'+axis]:0),cross=other[axis];
   // Door end is intentionally NOT treated as an available side restraint.
   if(bounds&&(axis==='y'||sign<0)&&Math.abs(edge-(sign<0?0:bounds.W))<=EPS){result[key]={kind:'wall',verified:false};continue;}
   for(const n of boxes){
    if(n.uid===b.uid||n.z>EPS||fragile(n)||ownRisk(n)>EPS||!known(n.weight))continue;
    const gap=sign<0?edge-(n[axis]+n['d'+axis]):n[axis]-edge;
    const span=Math.min(b[cross]+b['d'+cross],n[cross]+n['d'+cross])-Math.max(b[cross],n[cross]);
    // Exact nominal contact only; an unfilled small gap is not blocking.
    if(Math.abs(gap)>EPS||span<b['d'+cross]*.6||n.z>cg+EPS||n.z+n.dz<cg-EPS)continue;
    result[key]={kind:'cargo',uid:n.uid,verified:false};break;
   }
  }
  return result;
 }
 function loadsOf(boxes){
  const loads=new Map(boxes.map(b=>{const m=known(b.weight)?b.weight:Math.max(.001,b.dx*b.dy*b.dz/1e9);return [b.uid,{m,x:m*(b.x+b.dx/2),y:m*(b.y+b.dy/2),z:m*(b.z+b.dz/2),estimated:!known(b.weight)}];}));
  for(const b of [...boxes].sort((a,b)=>b.z-a.z)){
   const l=loads.get(b.uid),below=boxes.filter(a=>a.uid!==b.uid&&Math.abs(a.z+a.dz-b.z)<EPS&&area(a,b)>EPS),sum=below.reduce((n,a)=>n+area(a,b),0);
   for(const a of below){const f=area(a,b)/sum,t=loads.get(a.uid);for(const k of ['m','x','y','z'])t[k]+=l[k]*f;t.estimated ||=l.estimated;}
  }
  return loads;
 }
 function screen(boxes,bounds=null){
  const loads=loadsOf(boxes),risks=[];
  for(const b of boxes){
   const l=loads.get(b.uid),cg={x:l.x/l.m,y:l.y/l.m,z:l.z/l.m},height=cg.z-b.z;if(!(height>0))continue;
   const critical={xMinus:(cg.x-b.x)/height,xPlus:(b.x+b.dx-cg.x)/height,yMinus:(cg.y-b.y)/height,yPlus:(b.y+b.dy-cg.y)/height};
   const weak=Object.keys(critical).filter(k=>critical[k]+1e-9<ACCEL);if(!weak.length)continue;
   const sides=contacts(b,cg,boxes,bounds),exposed=weak.filter(k=>!sides[k]),deficit=weak.reduce((n,k)=>n+Math.max(0,ACCEL-critical[k]),0);
   risks.push({uid:b.uid,cargoId:b.id,name:b.name,ctnNo:b.ctnNo,critical,weak,exposed,contacts:sides,cog:cg,effectiveWeight:l.m,estimatedWeight:l.estimated,deficit});
  }
  return {version:VERSION,basis:'箱体几何中心、估算承载链；水平0.8g/竖直1g初筛，非航线加固验算',status:risks.length?'pending-securing':'screened',needsSecuring:risks.length,exposed:risks.filter(r=>r.exposed.length).length,cost:risks.reduce((n,r)=>n+r.deficit*(1+r.exposed.length),0),risks};
 }
 function warnings(report){
  const groups=new Map();
  for(const r of report.risks){let v=groups.get(r.cargoId);if(!v){v={severity:'warning',code:'tippingRisk',uid:r.uid,uids:[],cargoId:r.cargoId,name:r.name,needsSecuring:true,exposed:0};groups.set(r.cargoId,v);}v.uids.push(r.uid);if(r.exposed.length)v.exposed++;}
  return [...groups.values()].map(v=>({...v,message:v.name+'：'+v.uids.length+' 箱需防倾倒加固确认'+(v.exposed?'，其中 '+v.exposed+' 箱存在缺少侧挡候选的方向':'；邻货/柜壁接触仅为侧挡候选，尚未核实承力')+'。检查允许姿态、侧挡/支架、绑扎及装卸时临时支撑；当前仅为初筛，不能视为已加固。'}));
 }
 // Cheap placement heuristic. Final screen also checks accumulated loads.
 function placementCost(placed,existing,bounds,{directional=true}={}){
  return placed.reduce((sum,b)=>{
   const risk=ownRisk(b),cg={z:b.z+b.dz/2},sides=contacts(b,cg,existing,bounds),n=Object.entries(sides).filter(([key,v])=>v&&(!directional||b['d'+key[0]]/b.dz<ACCEL)).length;
   let stackRisk=0;
   if(b.z>EPS)for(const a of existing)if(Math.abs(a.z+a.dz-b.z)<EPS&&area(a,b)>EPS){
    const m=known(a.weight)&&known(b.weight)?[a.weight,b.weight]:[1,1],h=(m[0]*a.dz/2+m[1]*(b.z-a.z+b.dz/2))/(m[0]+m[1]);
    stackRisk=Math.max(stackRisk,Math.max(0,ACCEL-Math.min(a.dx,a.dy)/(2*h)));
   }
   return sum+risk*(1-n*.16)+stackRisk+(risk>EPS?b.z/10000:0);
  },0);
 }
 function compare(a,b){
  const pending=r=>r.containers.reduce((n,c)=>n+(c.transport?.needsSecuring||0),0),cost=r=>r.containers.reduce((n,c)=>n+(c.transport?.cost||0),0);
  return b.loaded-a.loaded||Number(pending(a)>0)-Number(pending(b)>0)||a.containers.length-b.containers.length||cost(a)-cost(b);
 }
 function overview(containers){const needsSecuring=containers.reduce((n,c)=>n+(c.transport?.needsSecuring||0),0);return {version:VERSION,status:needsSecuring?'pending-securing':'screened',needsSecuring,exposed:containers.reduce((n,c)=>n+(c.transport?.exposed||0),0),basis:'几何及承载链防倾倒初筛，非运输安全或加固验收'};}
 function note(r){const axis=r.weak.some(k=>k[0]==='x')?'前后':'',side=r.weak.some(k=>k[0]==='y')?'左右':'';return '防倾倒待确认（'+[axis,side].filter(Boolean).join('、')+'方向）'+(r.exposed.length?'：存在缺少有效侧挡候选的方向，需调整姿态/位置或制定支架、止挡、绑扎方案':'：附近虽有侧挡候选，仍须核实其承力、防护及固定')+'；装卸时也需临时支撑';}
 const api={VERSION,TYPES,fragile,protectedBase,intrinsicRisk:ownRisk,screen,warnings,placementCost,compare,overview,note};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.PlannerTransport=api;
})(typeof self!=='undefined'?self:globalThis);
