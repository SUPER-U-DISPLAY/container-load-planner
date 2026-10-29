/* Transport planning screen, not a securing certificate. mm / kg.
   Uses box-centre mass assumptions and 0.8g horizontal / 1g vertical
   screening in BOTH axes. These conservative trial assumptions are not
   route-specific CTU acceleration coefficients. Contact is only a candidate
   for blocking: unknown wall/package strength never becomes verified safety. */
(function(root){
 'use strict';
 const VERSION='3.3.0',EPS=.01,ACCEL=.8;
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
  const loads=new Map(boxes.map(b=>{const m=known(b.weight)?b.weight:Math.max(.001,b.dx*b.dy*b.dz/1e9);return [b.uid,{m,x:m*(b.x+b.dx/2),y:m*(b.y+b.dy/2),z:m*(b.z+b.dz/2),estimated:!known(b.weight)||b.weightSource==='estimated'}];}));
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
 function stackFailures(boxes,bounds=null,settings={}){
  // Assisted mode is explicitly a conditional planning document. Geometry,
  // pressure and orientation remain hard constraints; a generated securing
  // requirement never becomes an approval or evidence for learning.
  if(settings.planningMode==='assisted')return [];
  if(!boxes.some(b=>b.z>EPS))return [];
  const bases=new Set();
  for(const b of boxes)if(boxes.some(a=>a.uid!==b.uid&&Math.abs(a.z-b.z-b.dz)<EPS&&area(a,b)>EPS))bases.add(b.uid);
  const byUid=new Map(boxes.map(b=>[b.uid,b]));
  const unknown=boxes.filter(b=>(b.z>EPS||bases.has(b.uid))&&!known(b.weight)).map(b=>({severity:'error',code:'stackWeightUnknown',uid:b.uid,uids:[b.uid],cargoId:b.id,name:b.name,message:b.name+'：叠放承载链的重量未确认，不能判断高叠重心；请补充重量，或先落地摆放。'}));
  // Virtual grouping and mere wall/neighbour contact are not proof of a
  // restraint. With no rated securing model, an unstable loaded support
  // chain or upper box cannot be accepted as a normal stacking placement.
  return unknown.concat(screen(boxes,bounds).risks.filter(r=>byUid.get(r.uid).z>EPS||bases.has(r.uid)).map(r=>({
   severity:'error',code:'unrestrainedStack',uid:r.uid,uids:[r.uid],cargoId:r.cargoId,name:r.name,
   message:r.name+'：无约束高叠被阻止（'+[r.weak.some(k=>k[0]==='x')?'前后':'',r.weak.some(k=>k[0]==='y')?'左右':''].filter(Boolean).join('、')+'方向存在倾倒风险）。请落地、降层或调整允许朝向；邻货/柜壁接触不能代替经过确认的侧向约束。'
  })));
 }
 const DIRECTIONS={xMinus:'柜头侧',xPlus:'柜门侧',yMinus:'左侧',yPlus:'右侧'};
 function securingPlan(boxes,bounds,settings={}){
  const report=screen(boxes,bounds);report.plans=[];
  if(!bounds)return report;
  for(const risk of report.risks){
   const b=boxes.find(b=>b.uid===risk.uid),actions=[];
   for(const direction of risk.weak){
    const axis=direction[0],cross=axis==='x'?'y':'x',sign=direction.endsWith('Minus')?-1:1;
    let current=b,edge=b[axis]+(sign>0?b['d'+axis]:0),chain=[],gaps=[],seen=new Set([b.uid]);
    const boundary=sign<0?0:axis==='x'?bounds.L:bounds.W;
    // A monotone path to a boundary is a *proposed* load path, never a
    // circular assumption that two unstable neighbours secure each other.
    for(let step=0;step<=boxes.length;step++){
     let next=null,distance=Math.abs(boundary-edge);
     for(const n of boxes){
      if(seen.has(n.uid)||n.z>risk.cog.z+EPS||n.z+n.dz<risk.cog.z-EPS)continue;
      const span=Math.min(b[cross]+b['d'+cross],n[cross]+n['d'+cross])-Math.max(b[cross],n[cross]);
      const gap=sign<0?edge-n[axis]-n['d'+axis]:n[axis]-edge;
      if(span<b['d'+cross]*.6||gap<-EPS||gap>=distance-EPS)continue;
      next=n;distance=Math.max(0,gap);
     }
     gaps.push({from:edge,to:next?(sign<0?next[axis]+next['d'+axis]:next[axis]):boundary,mm:distance});
     if(!next)break;chain.push(next.uid);seen.add(next.uid);current=next;edge=current[axis]+(sign>0?current['d'+axis]:0);
    }
    const maxGap=Math.max(0,...gaps.map(g=>g.mm)),canBlock=maxGap<=300;
    const method=settings.securingMethod==='blocking'?'blocking':settings.securingMethod==='lashing'?'direct-lashing':canBlock?'blocking':'direct-lashing';
    // Forces below are a conservative demand at the assumed CG with zero
    // friction credit. They are NOT a strap count, wall rating or design.
    const demandN=risk.estimatedWeight?null:Math.ceil(risk.effectiveWeight*9.81*ACCEL);
    const at={x:b.x+b.dx/2,y:b.y+b.dy/2,z:Math.round(risk.cog.z)};at[axis]=b[axis]+(sign>0?b['d'+axis]:0);
    actions.push({direction,label:DIRECTIONS[direction],method,at,path:chain,gaps,maxGapMm:Math.round(maxGap),demandN,
     boundary:axis==='x'&&sign>0?'door-end':'container-boundary',verified:false,
     specification:method==='blocking'?'拟设侧挡/撑木，作用高度约 '+at.z+' mm；最大待处理间隙 '+Math.round(maxGap)+' mm。需核实撑木截面、固定、防护及沿途包装侧压能力。':'拟设直接固定，作用高度约 '+at.z+' mm。需现场确定绑扎点、有效方向、路径、额定承力及护角；不得直接捆压玻璃或饰面。',
     checks:['实际重量与偏心重心','包装及柜体/固定点承力','材料规格与数量','装卸临时支撑与作业空间',...(axis==='x'&&sign>0?['柜门端独立挡货与开门防倒']:[])]});
   }
   const uniqueGaps=new Map();for(const action of actions)if(action.method==='blocking')for(const gap of action.gaps)if(gap.mm>EPS)uniqueGaps.set(action.direction+':'+gap.from+':'+gap.to,gap.mm);
   // Material volume is separate from cargo utilization. This is only a
   // 40x40 mm sketch allowance, pending an actual member specification.
   const allowanceM3=[...uniqueGaps.values()].reduce((n,mm)=>n+mm*40*40/1e9,0);
   report.plans.push({id:'secure-'+b.uid,uid:b.uid,cargoId:b.id,name:b.name,ctnNo:b.ctnNo,actions,
    status:'proposed',verified:false,allowanceM3,materialBasis:'40×40 mm示意用量，不是强度选型',
    source:settings.securingReference||'',unitCost:Number.isFinite(settings.securingUnitCost)?settings.securingUnitCost:null,
    instructions:'先完成底部承托及临时支撑，再按核实后的加固工序施工；卸柜时按相反依赖顺序拆除。'});
  }
  report.status=report.needsSecuring?'conditional-plan':'screened';
  report.materialAllowanceM3=report.plans.reduce((n,p)=>n+p.allowanceM3,0);
  report.planCount=report.plans.length;
  report.planEffort=report.plans.reduce((n,p)=>n+p.actions.reduce((v,a)=>v+(a.method==='blocking'?1+a.maxGapMm/300+a.path.length*.2:6+a.at.z/bounds.H),0),0);
  return report;
 }
 function groupingCost(placed,existing,bounds){
  let cost=0;
  for(const b of placed){
   const risk=ownRisk(b);if(risk<=EPS)continue;const height=b.z+b.dz/2;
   for(const axis of ['x','y']){
    if(b['d'+axis]/b.dz>=ACCEL)continue;
    const cross=axis==='x'?'y':'x';let close=0;
    for(const sign of [-1,1]){
     const edge=b[axis]+(sign>0?b['d'+axis]:0),boundary=sign<0?0:axis==='x'?bounds.L:bounds.W;
     if(Math.abs(edge-boundary)<EPS){close++;continue;}
     if(existing.some(n=>{const gap=sign<0?edge-n[axis]-n['d'+axis]:n[axis]-edge,span=Math.min(b[cross]+b['d'+cross],n[cross]+n['d'+cross])-Math.max(b[cross],n[cross]);return Math.abs(gap)<EPS&&span>=b['d'+cross]*.6&&n.z<=height&&n.z+n.dz>=height;}))close++;
    }
    // A packing preference only. No contact earns verified securing status.
    cost+=risk*(2-close)*(1+b.z/bounds.H);
   }
  }
  return cost;
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
 function compare(a,b,{usePrices=false}={}){
  const pending=r=>r.containers.reduce((n,c)=>n+(c.transport?.needsSecuring||0),0),cost=r=>r.containers.reduce((n,c)=>n+(c.transport?.cost||0),0);
  // Callers enable prices only once for an entirely priced candidate set.
  // Pairwise fallback would produce a non-transitive comparator.
  const priced=usePrices&&Number.isFinite(a.estimatedCost)&&Number.isFinite(b.estimatedCost)?a.estimatedCost-b.estimatedCost:0;
  const effort=r=>r.containers.reduce((n,c)=>n+(c.transport?.planEffort??c.transport?.cost??0),0);
  return b.loaded-a.loaded||priced||a.containers.length-b.containers.length||effort(a)-effort(b)||pending(a)-pending(b)||cost(a)-cost(b);
 }
 function overview(containers){const needsSecuring=containers.reduce((n,c)=>n+(c.transport?.needsSecuring||0),0);return {version:VERSION,status:needsSecuring?'conditional-plan':'screened',needsSecuring,planCount:containers.reduce((n,c)=>n+(c.transport?.plans?.length||0),0),materialAllowanceM3:containers.reduce((n,c)=>n+(c.transport?.materialAllowanceM3||0),0),exposed:containers.reduce((n,c)=>n+(c.transport?.exposed||0),0),basis:'几何及承载链初筛；加固为待核实施工条件，不是运输验收'};}
 function note(r){const axis=r.weak.some(k=>k[0]==='x')?'前后':'',side=r.weak.some(k=>k[0]==='y')?'左右':'';return '防倾倒待确认（'+[axis,side].filter(Boolean).join('、')+'方向）'+(r.exposed.length?'：存在缺少有效侧挡候选的方向，需调整姿态/位置或制定支架、止挡、绑扎方案':'：附近虽有侧挡候选，仍须核实其承力、防护及固定')+'；装卸时也需临时支撑';}
 const api={VERSION,TYPES,DIRECTIONS,fragile,protectedBase,intrinsicRisk:ownRisk,screen,warnings,stackFailures,securingPlan,groupingCost,placementCost,compare,overview,note};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.PlannerTransport=api;
})(typeof self!=='undefined'?self:globalThis);
