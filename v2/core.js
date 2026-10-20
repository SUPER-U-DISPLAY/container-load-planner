/* Super U planner v2 — geometry, inventory, validation and deterministic packing.
   Millimetres / kilograms. x: deep end -> door, y: width, z: up.
   No DOM dependencies. Shared by browser, worker and node regression tests. */
(function (root) {
  'use strict';
  const EPS = 0.01;
  const COLORS = ['#528e91','#d19b67','#8394c3','#bd8093','#9cab6b','#739dbd','#b29170','#8f82af'];
  const SPECS = {
    '20GP': {L:5898,W:2352,H:2393,maxWeight:28080},
    '40GP': {L:12032,W:2352,H:2393,maxWeight:26700},
    '40HQ': {L:12032,W:2352,H:2698,maxWeight:26460},
    '45HQ': {L:13556,W:2352,H:2698,maxWeight:27600},
    '20HQ': {L:5898,W:2352,H:2698,maxWeight:28000},
    '53HQ': {L:16154,W:2500,H:2695,maxWeight:30000},
    '20RF': {L:5449,W:2290,H:2244,maxWeight:27400},
    '40RH': {L:11577,W:2286,H:2249,maxWeight:29520},
    'LCL': {L:1200,W:1000,H:1800,maxWeight:1000}
  };
  const DEFAULTS = {standardHeight:2570,minSupport:1,overhang:0,heavyBelow:true,autoAdd:true,maxContainers:12,doorW:null,doorH:null,manualMaxWeight:25,containers:[{type:'40HQ',qty:1}]};
  const clone = x => JSON.parse(JSON.stringify(x));
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const known = n => finite(n) && n > 0;
  function poses(c) {
    const {l,w,h} = c;
    const a = [[l,w,h],[w,l,h],[l,h,w],[h,l,w],[w,h,l],[h,w,l]];
    return a.slice(0,c.rotateMode === 'none' ? 1 : c.rotateMode === 'free' ? 6 : 2);
  }
  function expand(cargos) {
    const out=[];
    for (const c of cargos) {
      if (!Number.isInteger(c.qty) || c.qty<1 || c.qty>2000) throw Error('箱数必须为 1–2000 的整数：'+c.name);
      for(let i=1;i<=c.qty;i++) out.push({...c,uid:c.id+'#'+i,index:i,pending:![c.l,c.w,c.h].every(n=>finite(n)&&n>0)});
    }
    if(out.length>3000) throw Error('当前测试版单项目最多 3000 箱，请分批测试。');
    if(new Set(out.map(u=>u.uid)).size!==out.length) throw Error('货物 ID 重复，请检查项目文件。');
    return out;
  }
  function box(u, p={}) {
    const orientation = p.orientation ?? 0;
    const d = poses(u)[orientation] || [NaN,NaN,NaN];
    return {...u,x:p.x??0,y:p.y??0,z:p.z??0,dx:d[0],dy:d[1],dz:d[2],orientation};
  }
  function extent(bs) {return {L:Math.max(0,...bs.map(b=>b.x+b.dx)),W:Math.max(0,...bs.map(b=>b.y+b.dy)),H:Math.max(0,...bs.map(b=>b.z+b.dz))};}
  function volume(bs){return bs.reduce((s,b)=>s+b.dx*b.dy*b.dz/1e9,0);}
  function overlap(a,b) {return a.x<b.x+b.dx-EPS&&b.x<a.x+a.dx-EPS&&a.y<b.y+b.dy-EPS&&b.y<a.y+a.dy-EPS&&a.z<b.z+b.dz-EPS&&b.z<a.z+a.dz-EPS;}
  function intersection(a,b) {
    const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),x2=Math.min(a.x+a.dx,b.x+b.dx),y2=Math.min(a.y+a.dy,b.y+b.dy);
    return x2>x+EPS&&y2>y+EPS ? {x,y,x2,y2,area:(x2-x)*(y2-y)} : null;
  }
  function unionArea(rs) {
    const xs=[...new Set(rs.flatMap(r=>[r.x,r.x2]))].sort((a,b)=>a-b);let area=0;
    for(let i=1;i<xs.length;i++) {
      const strips=rs.filter(r=>r.x<xs[i]&&r.x2>xs[i-1]).sort((a,b)=>a.y-b.y);let lo=0,hi=0,len=0;
      for(const r of strips){if(r.y>hi){len+=hi-lo;lo=r.y;hi=r.y2;}else hi=Math.max(hi,r.y2);} len+=hi-lo;area+=(xs[i]-xs[i-1])*len;
    }return area;
  }
  function validate(bs, settings={}, bounds=null, opts={}) {
    const cfg={...DEFAULTS,...settings},issues=[],support=new Map(),depth=new Map(),load=new Map();
    const add=(severity,code,b,message)=>issues.push({severity,code,uid:b?.uid,message});
    for(let i=0;i<bs.length;i++) {
      const b=bs[i],label=b.name+' ['+b.uid+']';
      if(![b.x,b.y,b.z,b.dx,b.dy,b.dz].every(finite)||Math.min(b.dx,b.dy,b.dz)<=0){add('error','dimensions',b,label+' 尺寸不完整');continue;}
      if(Math.min(b.x,b.y,b.z)<-EPS)add('error','negative',b,label+' 超出原点边界');
      if(!poses(b).some(p=>p.every((d,k)=>Math.abs(d-[b.dx,b.dy,b.dz][k])<EPS)))add('error','orientation',b,label+' 摆放方向不允许');
      if(bounds&&(b.x+b.dx>bounds.L+EPS||b.y+b.dy>bounds.W+EPS||b.z+b.dz>bounds.H+EPS))add('error','bounds',b,label+' 超出柜内尺寸');
      if(!opts.manual&&b.z+b.dz>Math.min(cfg.standardHeight,bounds?.H??Infinity)+EPS)add('error','height',b,label+' 超过常规叠箱高度');
      for(let j=0;j<i;j++) if(overlap(b,bs[j]))add('error','collision',b,label+' 与 '+bs[j].name+' 重叠');
      if(b.z<=EPS){support.set(b.uid,[]);continue;}
      const below=bs.filter(a=>a.uid!==b.uid&&Math.abs(a.z+a.dz-b.z)<EPS&&intersection(b,a));
      const rects=below.map(a=>intersection(b,a)),area=unionArea(rects),ratio=area/(b.dx*b.dy);
      support.set(b.uid,below.map((a,i)=>({b:a,area:rects[i].area})));
      if(!below.length){add('error','floating',b,label+' 悬空，底部没有支撑');continue;}
      if(ratio+1e-6<cfg.minSupport)add('error','support',b,label+' 支撑率 '+(ratio*100).toFixed(1)+'%，低于 '+Math.round(cfg.minSupport*100)+'%');
      const minX=Math.min(...below.map(a=>a.x)),minY=Math.min(...below.map(a=>a.y));
      const maxX=Math.max(...below.map(a=>a.x+a.dx)),maxY=Math.max(...below.map(a=>a.y+a.dy));
      const ox=Math.max(0,minX-b.x)+Math.max(0,b.x+b.dx-maxX),oy=Math.max(0,minY-b.y)+Math.max(0,b.y+b.dy-maxY);
      if(ox>EPS&&oy>EPS)add('error','twoAxisOverhang',b,label+' 长、宽两个方向同时外挑');
      if(Math.max(ox,oy)>cfg.overhang+EPS)add('error','overhang',b,label+' 单方向总外挑 '+Math.round(Math.max(ox,oy))+' mm 超限');
      const cx=b.x+b.dx/2,cy=b.y+b.dy/2;
      if(!rects.some(r=>cx>=r.x-EPS&&cx<=r.x2+EPS&&cy>=r.y-EPS&&cy<=r.y2+EPS))add('error','centerSupport',b,label+' 中心下方没有直接支撑');
      const sum=rects.reduce((s,r)=>s+r.area,0);
      below.forEach((a,i)=>{
        if(a.stackable===false)add('error','nonStackable',b,a.name+' 禁止承叠');
        if(cfg.heavyBelow&&known(b.weight)&&known(a.weight)&&b.weight*rects[i].area/sum>a.weight+EPS)add('error','heavyAbove',b,label+' 分担重量大于下方箱子，请调整重箱在下');
      });
    }
    // Traverse from the highest boxes down: maxLayers on EVERY supporting box,
    // plus accumulated top load transferred proportionally to contact area.
    for(const b of [...bs].sort((a,b)=>b.z-a.z)) {
      const d=depth.get(b.uid)||1,above=load.get(b.uid)||0;
      if(b.maxLayers>0&&d>b.maxLayers)add('error','layers',b,b.name+' 上方堆叠超出 '+b.maxLayers+' 层限制（含自身）');
      if(finite(b.topLoad)&&b.topLoad>=0&&(above>b.topLoad+EPS||(b.topLoad===0&&d>1)))add('error','topLoad',b,b.name+' 承受上方累计重量 '+above.toFixed(1)+' kg，超过承重值');
      const below=support.get(b.uid)||[],sum=below.reduce((s,r)=>s+r.area,0);
      for(const r of below){depth.set(r.b.uid,Math.max(depth.get(r.b.uid)||1,d+1));load.set(r.b.uid,(load.get(r.b.uid)||0)+(above+(known(b.weight)?b.weight:0))*r.area/sum);}
    }
    if(bs.some(b=>!known(b.weight)))add('warning','weightUnknown',null,'有箱子未填写重量：载重、轻重关系与承重校验不完整');
    if(bs.some(b=>b.z>EPS)&&bs.some(b=>(support.get(b.uid)||[]).length)&&bs.some(b=>!finite(b.topLoad)&&b.stackable!==false))add('warning','capacityUnknown',null,'未填写允许上压重量的箱子，实际承压能力需生产确认');
    const weight=bs.reduce((s,b)=>s+(known(b.weight)?b.weight:0),0);
    if(bounds&&weight>bounds.maxWeight+EPS)add('error','payload',null,'已知货物重量超过柜型载重');
    return {ok:!issues.some(i=>i.severity==='error'),issues,supportRatios:bs.map(b=>({uid:b.uid,ratio:b.z<=EPS?1:unionArea((support.get(b.uid)||[]).map(r=>intersection(b,r.b)))/(b.dx*b.dy)})),weight,volume:volume(bs)};
  }
  function groupBoxes(g, units) {
    const byId=new Map(units.map(u=>[u.uid,u]));
    return g.children.map(p=>{const u=byId.get(p.uid);if(!u)throw Error('组合引用的箱子不存在：'+p.uid);return {...box(u,p),groupId:g.id,groupName:g.name};});
  }
  function normalize(children,units) {
    const bs=groupBoxes({id:'draft',children},units);if(!bs.length)return children;
    const min={x:Math.min(...bs.map(b=>b.x)),y:Math.min(...bs.map(b=>b.y)),z:Math.min(...bs.map(b=>b.z))};
    return children.map(p=>({...p,x:p.x-min.x,y:p.y-min.y,z:p.z-min.z}));
  }
  function rotateBoxes(bs) {
    const e=extent(bs);
    return bs.map(b=>{
      const dims=[b.dy,b.dx,b.dz],orientation=poses(b).findIndex(p=>p.every((d,k)=>Math.abs(d-dims[k])<EPS));
      return {...b,x:e.W-b.y-b.dy,y:b.x,dx:b.dy,dy:b.dx,orientation};
    });
  }
  function fingerprint(p){return JSON.stringify({engineVersion:"2.2.0",cargos:p.cargos,groups:p.groups,settings:p.settings});}
  function checkProject(p) {
    if(p.schemaVersion!==2||!Array.isArray(p.cargos)||!Array.isArray(p.groups)||!p.settings)throw Error('请选择 v2 项目文件');
    if(p.cargos.some(c=>!c.id||!c.name||!['none','upright','free'].includes(c.rotateMode)))throw Error('货物字段不完整');
    const units=expand(p.cargos),seen=new Set(),cfg={...DEFAULTS,...p.settings};
    if(!finite(cfg.standardHeight)||cfg.standardHeight<=0||!finite(cfg.minSupport)||cfg.minSupport<0.75||cfg.minSupport>1||!finite(cfg.overhang)||cfg.overhang<0||cfg.overhang>100||!Number.isInteger(cfg.maxContainers)||cfg.maxContainers<1||cfg.maxContainers>60)throw Error('规则参数超出允许范围');
    if(!cfg.containers.length||cfg.containers.some(c=>!SPECS[c.type]||!Number.isInteger(c.qty)||c.qty<1||c.qty>60)||cfg.containers.reduce((s,c)=>s+c.qty,0)>60)throw Error('柜型或柜数无效（最多 60 柜）');
    if(new Set(p.groups.map(g=>g.id)).size!==p.groups.length)throw Error('组合 ID 重复');
    for(const g of p.groups){if(!g.id||!g.children.length)throw Error('空组合无效');for(const b of groupBoxes(g,units)){if(seen.has(b.uid))throw Error('同一箱子重复加入组合：'+b.uid);seen.add(b.uid);}}
    if(p.draft?.children?.length){
      const draftSeen=new Set(),occupied=new Set(p.groups.filter(g=>g.id!==p.draft.id).flatMap(g=>g.children.map(c=>c.uid)));
      for(const b of groupBoxes(p.draft,units)){if(draftSeen.has(b.uid)||occupied.has(b.uid))throw Error('草稿重复占用箱子：'+b.uid);draftSeen.add(b.uid);}
    }
    return units;
  }
  function makeItems(project) {
    const units=checkProject(project),claimed=new Set(),items=[],unpacked=[];
    for(const g of project.groups){
      const bs=groupBoxes(g,units);bs.forEach(b=>claimed.add(b.uid));
      const v=validate(bs,project.settings);
      if(!v.ok){bs.forEach(b=>unpacked.push({uid:b.uid,name:b.name,reason:'组合“'+g.name+'”需修正：'+v.issues.filter(i=>i.severity==='error').map(i=>i.message).join('；')}));continue;}
      const r=rotateBoxes(bs),variants=[bs];
      if(r.every(b=>b.orientation>=0&&b.rotateMode!=='none')&&g.allowRotate!==false)variants.push(r);
      items.push({id:g.id,name:g.name,group:true,variants,volume:v.volume,weight:v.weight,count:bs.length});
    }
    for(const u of units.filter(u=>!claimed.has(u.uid))) {
      if(u.pending){unpacked.push({uid:u.uid,name:u.name,reason:'尺寸待补充'});continue;}
      const variants=poses(u).map((_,orientation)=>[box(u,{orientation})]);
      items.push({id:u.uid,name:u.name,group:false,variants,volume:u.l*u.w*u.h/1e9,weight:known(u.weight)?u.weight:0,count:1});
    }
    return {units,items,unpacked};
  }
  function placeOne(item,ct,cfg,manual=false) {
    const height=manual?ct.spec.H:Math.min(ct.spec.H,cfg.standardHeight),candidates=[];
    const points=[{x:0,y:0,z:0}];
    for(const a of ct.blocks){
      points.push({x:a.x+a.dx,y:a.y,z:0},{x:a.x,y:a.y+a.dy,z:0},{x:a.x+a.dx,y:0,z:0},{x:0,y:a.y+a.dy,z:0});
      if(!item.group)points.push({x:a.x,y:a.y,z:a.z+a.dz});
    }
    // Top surfaces inside a composite have true geometry. Its envelope is still reserved.
    if(!item.group)for(const a of ct.boxes)if(a.z+a.dz>EPS)points.push({x:a.x,y:a.y,z:a.z+a.dz});
    const unique=[...new Map(points.map(p=>[[p.x,p.y,p.z].join(','),p])).values()];
    unique.sort((a,b)=>a.x-b.x||a.z-b.z||a.y-b.y);
    for(let vi=0;vi<item.variants.length;vi++) {
      const raw=item.variants[vi],e=extent(raw);
      if(e.L>ct.spec.L+EPS||e.W>ct.spec.W+EPS||e.H>height+EPS)continue;
      if(cfg.doorW&&e.W>cfg.doorW+EPS)continue;
      if(!manual&&cfg.doorH&&e.H>cfg.doorH+EPS)continue;
      for(const p of unique.slice(0,1500)) {
        const block={...p,dx:e.L,dy:e.W,dz:e.H,id:item.id};
        if(p.x+e.L>ct.spec.L+EPS||p.y+e.W>ct.spec.W+EPS||p.z+e.H>height+EPS||ct.blocks.some(a=>overlap(a,block)))continue;
        if(ct.weight+item.weight>ct.spec.maxWeight+EPS)continue;
        const bs=raw.map(b=>({...b,x:b.x+p.x,y:b.y+p.y,z:b.z+p.z,blockId:item.id,manual:manual&&b.z+p.z+b.dz>cfg.standardHeight}));
        const test=validate([...ct.boxes,...bs],cfg,ct.spec,{manual});
        if(!test.ok)continue;
        // Fill deep sections first; higher completed stacks stay towards the closed end.
        const sameSupport=cfg.sameKindFirst&&!item.group&&bs.some(b=>ct.boxes.some(a=>a.id===b.id&&Math.abs(a.z+a.dz-b.z)<EPS&&intersection(b,a)));
        const score=p.x*1e7+p.z*1e3+p.y+(ct.spec.H-e.H)*0.01-(sameSupport?1e9:0);
        candidates.push({block,bs,score,vi});
      }
    }
    candidates.sort((a,b)=>a.score-b.score||a.vi-b.vi);
    const best=candidates[0];if(!best)return false;
    ct.blocks.push(best.block);ct.boxes.push(...best.bs);ct.weight+=item.weight;ct.itemIds.push(item.id);return true;
  }
  function packToSpec(items,spec,cfg,index) {
    const strategies=[
      (a,b)=>Number(b.group)-Number(a.group)||Math.max(...b.variants.map(v=>extent(v).H))-Math.max(...a.variants.map(v=>extent(v).H))||b.volume-a.volume,
      (a,b)=>b.volume-a.volume||b.weight-a.weight,
      (a,b)=>b.weight-a.weight||b.volume-a.volume
    ];
    let best=null;
    for(const sort of strategies){
      const ct={index,spec,boxes:[],blocks:[],weight:0,itemIds:[]},left=[];
      for(const it of [...items].sort((a,b)=>sort(a,b)||a.id.localeCompare(b.id)))if(!placeOne(it,ct,cfg))left.push(it);
      const score=ct.boxes.length*1e6+volume(ct.boxes);
      if(!best||score>best.score)best={ct,left,score};
    }return best;
  }
  function loadingOrder(boxes) {
    const remaining=[...boxes],done=new Set(),ordered=[];
    const below=new Map(boxes.map(b=>[b.uid,boxes.filter(a=>a.uid!==b.uid&&Math.abs(a.z+a.dz-b.z)<EPS&&intersection(b,a)).map(a=>a.uid)]));
    const compare=(a,b)=>a.x-b.x||a.z-b.z||a.y-b.y||a.uid.localeCompare(b.uid);
    while(remaining.length){
      const ready=remaining.filter(b=>(below.get(b.uid)||[]).every(id=>done.has(id))).sort(compare);
      const next=ready[0]||remaining.sort(compare)[0];
      remaining.splice(remaining.indexOf(next),1);done.add(next.uid);ordered.push(next);
    }
    return ordered;
  }
  function summarize(ct,cfg) {
    const v=validate(ct.boxes,cfg,ct.spec,{manual:ct.boxes.some(b=>b.manual)});
    ct.boxes=loadingOrder(ct.boxes);ct.boxes.forEach((b,i)=>b.seq=i+1);
    ct.volume=v.volume;ct.utilization=v.volume/(ct.spec.L*ct.spec.W*ct.spec.H/1e9);ct.issues=v.issues;
    ct.unknownWeights=ct.boxes.filter(b=>!known(b.weight)).length;
    ct.cog=ct.weight>0?['x','y','z'].map((a,k)=>ct.boxes.reduce((s,b)=>s+(known(b.weight)?b.weight:0)*(b[a]+[b.dx,b.dy,b.dz][k]/2),0)/ct.weight):null;
    return ct;
  }
  function pack(project,onProgress=()=>{}) {
    const cfg={...DEFAULTS,...project.settings},input=makeItems(project);let left=input.items;
    const queue=cfg.containers.flatMap(c=>Array.from({length:c.qty},()=>({id:c.type,...SPECS[c.type]}))),containers=[];
    const limit=cfg.autoAdd?Math.max(queue.length,cfg.maxContainers):queue.length;
    for(let i=0;i<limit&&left.length;i++){
      const spec=queue[i]||queue[queue.length-1],r=packToSpec(left,spec,cfg,i);
      left=r.left;if(r.ct.boxes.length)containers.push(summarize(r.ct,cfg));
      onProgress({step:i+1,total:limit,loaded:input.units.length-left.reduce((s,t)=>s+t.count,0)-input.unpacked.length});
      if(!r.ct.boxes.length&&i>=queue.length-1)break;
    }
    for(const it of left)for(const b of it.variants[0])input.unpacked.push({uid:b.uid,name:b.name,reason:it.group?'组合无法整组放入：检查柜型、柜门、剩余位置或叠箱规则':'当前柜型/剩余空间/支撑或重量规则不满足；可增加柜型或调整摆放'});
    const result={signature:fingerprint(project),containers,unpacked:input.unpacked,total:input.units.length,loaded:containers.reduce((s,c)=>s+c.boxes.length,0),createdAt:new Date().toISOString()};
    result.audit=audit(project,result);
    // Offer a separate alternative ONLY when <=2 known light loose cartons eliminate a whole last container.
    if(containers.length>1&&!result.unpacked.length){
      const last=containers[containers.length-1];
      if(last.boxes.length<=2&&last.boxes.every(b=>!b.groupId&&known(b.weight)&&b.weight<=cfg.manualMaxWeight)){
        const alt=clone(result),tail=alt.containers.pop();let success=true;
        for(const b of tail.boxes){const it=input.items.find(i=>i.id===b.uid);let fit=false;for(const ct of alt.containers)if(placeOne(it,ct,cfg,true)){fit=true;break;}if(!fit){success=false;break;}}
        if(success&&alt.containers.some(ct=>ct.boxes.some(b=>b.manual))){alt.containers=alt.containers.map(ct=>summarize(ct,cfg));alt.manualAlternative=true;alt.audit=audit(project,alt);result.alternative=alt;}
      }
    }
    return result;
  }
  function audit(project,result) {
    const units=expand(project.cargos),expected=new Set(units.map(u=>u.uid)),unitMap=new Map(units.map(u=>[u.uid,u])),seen=new Set(),issues=[];
    const actual=result.containers.flatMap(c=>c.boxes).concat(result.unpacked);
    for(const b of actual){if(!expected.has(b.uid))issues.push('出现未知箱号 '+b.uid);if(seen.has(b.uid))issues.push('重复箱号 '+b.uid);seen.add(b.uid);}
    for(const u of units)if(!seen.has(u.uid))issues.push('丢失箱号 '+u.uid);
    for(const ct of result.containers){
      for(const b of ct.boxes){const u=unitMap.get(b.uid);if(u&&['l','w','h','weight','stackable','maxLayers','topLoad','rotateMode'].some(k=>(u[k]??null)!==(b[k]??null)))issues.push('箱子属性与原始清单不一致：'+b.uid);}
      for(const b of ct.boxes)if(ct.boxes.some(a=>a.uid!==b.uid&&Math.abs(a.z+a.dz-b.z)<EPS&&intersection(b,a)&&a.seq>=b.seq))issues.push('上箱装入顺序早于支撑箱：'+b.uid);
      const v=validate(ct.boxes,project.settings,ct.spec,{manual:ct.boxes.some(b=>b.manual)});issues.push(...v.issues.filter(i=>i.severity==='error').map(i=>i.message));
    }
    for(const g of project.groups){
      const members=new Set(g.children.map(b=>b.uid));
      const placements=result.containers.map(ct=>({ct,bs:ct.boxes.filter(b=>members.has(b.uid))})).filter(x=>x.bs.length);
      if(placements.length>1)issues.push('组合被拆到多个柜：'+g.name);
      if(placements.length&&placements[0].bs.length!==g.children.length)issues.push('组合缺箱：'+g.name);
      if(placements.length===1&&placements[0].bs.length===g.children.length){
        const actual=placements[0].bs,base=groupBoxes(g,units),variants=[base];
        if(g.allowRotate!==false&&base.every(b=>b.rotateMode!=='none'))variants.push(rotateBoxes(base));
        const same=variants.some(bs=>{const first=actual.find(b=>b.uid===bs[0].uid),shift={x:first.x-bs[0].x,y:first.y-bs[0].y,z:first.z-bs[0].z};return bs.every(b=>{const a=actual.find(a=>a.uid===b.uid);return a.groupId===g.id&&['x','y','z'].every(k=>Math.abs(a[k]-b[k]-shift[k])<EPS)&&['dx','dy','dz'].every(k=>Math.abs(a[k]-b[k])<EPS);});});
        if(!same)issues.push('组合内部位置或方向被改变：'+g.name);
      }
    }
    return {ok:!issues.length,issues};
  }
  function autoGroup(project) {
    const units=expand(project.cargos),used=new Set(project.groups.flatMap(g=>g.children.map(c=>c.uid))),groups=[];
    const loose=units.filter(u=>!u.pending&&!used.has(u.uid)).sort((a,b)=>b.l*b.w-a.l*a.w||(b.weight||0)-(a.weight||0)||a.uid.localeCompare(b.uid));
    for(const u of loose){if(used.has(u.uid))continue;let bs=[box(u)],children=[{uid:u.uid,x:0,y:0,z:0,orientation:0}];
      for(const v of loose){if(v.uid===u.uid||used.has(v.uid))continue;
        for(let o=0;o<poses(v).length;o++){
          const b=box(v,{orientation:o,z:extent(bs).H});
          if(Math.abs(b.dx-bs[0].dx)>EPS||Math.abs(b.dy-bs[0].dy)>EPS)continue;
          if(validate([...bs,b],project.settings).ok){bs.push(b);children.push({uid:v.uid,x:0,y:0,z:b.z,orientation:o});used.add(v.uid);break;}
        }
      }
      if(children.length>1){used.add(u.uid);groups.push({id:'auto-'+u.uid,name:'同底面组合 '+(project.groups.length+groups.length+1),allowRotate:true,children});}
    }return groups;
  }
  const api={EPS,COLORS,SPECS,DEFAULTS,clone,known,poses,expand,box,extent,volume,overlap,unionArea,validate,groupBoxes,normalize,rotateBoxes,fingerprint,checkProject,makeItems,pack,audit,autoGroup,loadingOrder,summarize};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.PlannerCore=api;
})(typeof self!=='undefined'?self:globalThis);
