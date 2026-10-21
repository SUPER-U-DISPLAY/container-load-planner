/* Beginner placement choices. Every suggested position uses the same validator as packing. */
(function(root){
  'use strict';
  const C=typeof module==='object'?require('./core.js'):root.PlannerCore;
  function supportClass(c){
    if(![c.l,c.w,c.h].every(n=>Number.isFinite(n)&&n>0))return 'pending';
    return c.stackable===false||c.maxLayers===1||c.topLoad===0?'topOnly':'flexible';
  }
  function suggest(unit,boxes,settings={},limit=4){
    const above=[],beside=[],seen=new Set(),failures=[];
    if(supportClass(unit)==='pending')return {above,beside,reason:'请先补充这个箱子的尺寸。'};
    const orientations=C.poses(unit).map((d,i)=>({d,i})).filter((p,i,a)=>a.findIndex(q=>q.d.join()===p.d.join())===i);
    const inspect=(x,y,z,orientation,type)=>{
      if(Math.min(x,y,z)<0)return;
      const pos={uid:unit.uid,x,y,z,orientation},key=[x,y,z,...C.poses(unit)[orientation]].join(',');
      if(seen.has(key))return;seen.add(key);
      const candidate=C.box(unit,pos),v=C.validate([...boxes,candidate],settings);
      if(!v.ok){if(type==='above')failures.push(v.issues.filter(i=>i.severity==='error'));return;}
      const supports=boxes.filter(b=>Math.abs(b.z+b.dz-z)<C.EPS&&x<b.x+b.dx-C.EPS&&b.x<x+candidate.dx-C.EPS&&y<b.y+b.dy-C.EPS&&b.y<y+candidate.dy-C.EPS);
      (type==='above'?above:beside).push({position:pos,supports:supports.map(b=>b.uid),issues:v.issues.filter(i=>i.severity==='warning')});
    };
    if(!boxes.length){inspect(0,0,0,0,'beside');return {above,beside,reason:''};}
    // Snap to all support edges at each height, including a top spanning two bottom boxes.
    const levels=[...new Set(boxes.map(b=>b.z+b.dz))].sort((a,b)=>a-b);
    let attempts=0;
    outer:for(const z of levels){const supports=boxes.filter(b=>Math.abs(b.z+b.dz-z)<C.EPS);
      for(const {d:[dx,dy],i} of orientations){
        const xs=[...new Set(supports.flatMap(b=>[b.x,b.x+b.dx-dx]))].filter(x=>x>=0).sort((a,b)=>a-b);
        const ys=[...new Set(supports.flatMap(b=>[b.y,b.y+b.dy-dy]))].filter(y=>y>=0).sort((a,b)=>a-b);
        for(const x of xs)for(const y of ys){if(++attempts>1600)break outer;inspect(x,y,z,i,'above');if(above.length>=limit)break outer;}
      }
    }
    const e=C.extent(boxes);
    inspect(e.L,0,0,0,'beside');inspect(0,e.W,0,0,'beside');
    const meaningful=failures.filter(fs=>!fs.some(f=>f.code==='collision'));
    const fs=(meaningful.length?meaningful:failures).sort((a,b)=>a.length-b.length)[0]||[];
    const reasons={nonStackable:'下方箱子上面不能压箱。',layers:'叠放后会超过箱子的层数限制。',topLoad:'上方重量会超过底箱的承压限制。',heavyAbove:'这个箱子比下方箱子重，不符合重箱在下的规则。',height:'叠放后超过当前允许高度。',support:'现有顶面不能完整支撑这个箱子。',overhang:'叠放后外挑超出允许范围。',twoAxisOverhang:'不能长宽两个方向同时外挑。',centerSupport:'箱子中心下方缺少支撑。'};
    const reason=above.length?'':(fs.map(f=>reasons[f.code]).find(Boolean)||'没有找到符合当前规则的上叠位置，可并排放置或用位置调整设置。');
    return {above,beside,reason};
  }
  function autoCombine(project,{replace=false,maxMembers=32}={}){
    const baseGroups=replace?[]:project.groups,COPY={...project,groups:baseGroups,draft:null},all=C.checkProject(COPY),used=new Set(baseGroups.flatMap(g=>g.children.map(c=>c.uid))),groups=[],ids=new Set(baseGroups.map(g=>g.id));
    const eligible=all.filter(u=>!u.pending&&!used.has(u.uid)),types=[...new Set(eligible.map(u=>u.id))].map(id=>eligible.filter(u=>u.id===id));
    const bestFloor=u=>C.poses(u).map((d,i)=>({d,i})).filter(p=>C.validate([C.box(u,{orientation:p.i})],project.settings).ok).sort((a,b)=>b.d[0]*b.d[1]-a.d[0]*a.d[1]||a.d[2]-b.d[2]||a.i-b.i)[0];
    const floors=new Map(types.map(us=>[us[0].id,bestFloor(us[0])]));
    const compare=(a,b)=>Number(supportClass(a)==='topOnly')-Number(supportClass(b)==='topOnly')||(floors.get(b.id)?.d[0]||0)*(floors.get(b.id)?.d[1]||0)-(floors.get(a.id)?.d[0]||0)*(floors.get(a.id)?.d[1]||0)||(b.weight||0)-(a.weight||0)||a.id.localeCompare(b.id);
    types.sort((a,b)=>compare(a[0],b[0]));const seeds=[...eligible].sort(compare);
    for(const seed of seeds){
      if(used.has(seed.uid))continue;const floor=floors.get(seed.id);if(!floor)continue;let bs=[C.box(seed,{orientation:floor.i})],children=[{uid:seed.uid,x:0,y:0,z:0,orientation:floor.i}],local=new Set([seed.uid]);
      while(children.length<maxMembers){let chosen=null;
        const pool=[...types].sort((a,b)=>(project.settings.sameKindFirst?Number(b[0].id===seed.id)-Number(a[0].id===seed.id):0)||compare(a[0],b[0]));
        for(const members of pool){const u=members.find(u=>!used.has(u.uid)&&!local.has(u.uid));if(!u)continue;const candidates=suggest(u,bs,project.settings,6).above;
          if(candidates.length){for(const candidate of candidates){const position=candidate.position,b=C.box(u,position),score=[project.settings.sameKindFirst&&u.id!==seed.id?1:0,bs.length===1&&supportClass(u)==='topOnly'?1:0,position.z,Math.max(C.extent(bs).H,b.z+b.dz),supportClass(u)==='topOnly'?1:0,-b.dx*b.dy,position.x,position.y];const better=!chosen||score.some((n,i)=>n<chosen.score[i]&&score.slice(0,i).every((v,k)=>v===chosen.score[k]));if(better)chosen={u,position,score};}}
        }
        if(!chosen)break;children.push(chosen.position);bs.push(C.box(chosen.u,chosen.position));local.add(chosen.u.uid);
      }
      if(children.length>1){let id='auto-'+seed.uid,suffix=1;while(ids.has(id))id='auto-'+seed.uid+'-'+suffix++;ids.add(id);local.forEach(uid=>used.add(uid));groups.push({id,name:'系统组合 '+(baseGroups.length+groups.length+1),source:'auto',allowRotate:project.settings.allowGroupRotate!==false&&bs.every(b=>b.rotateMode!=='none'),children:C.normalize(children,all)});}
    }
    return {groups,replace,signature:C.fingerprint(project),combined:groups.reduce((n,g)=>n+g.children.length,0),loose:all.filter(u=>!used.has(u.uid)).length,pending:all.filter(u=>u.pending&&!used.has(u.uid)).length};
  }
  function applyAutoCombine(project,proposal){
    if(proposal.signature!==C.fingerprint(project))throw Error('装箱单或规则已改变，请重新生成组合');
    const next=C.clone(project);next.groups=[...(proposal.replace?[]:next.groups),...C.clone(proposal.groups)];next.draft=proposal.groups.length?C.clone(proposal.groups[0]):null;delete next.result;C.checkProject(next);
    const all=C.expand(next.cargos);for(const g of proposal.groups)if(!C.validate(C.groupBoxes(g,all),next.settings).ok)throw Error('自动组合不符合当前规则，请重新生成');return next;
  }
  function rotatePlacement(unit,pos,axis,boxes,settings,{manual=false}={}){
    const manualOrientation=unit.manualOrientation===true||pos.manualOrientation===true||(manual&&axis!=='z'&&unit.rotateMode==='upright');
    if(manualOrientation)unit={...unit,manualOrientation:true};
    const current=C.box(unit,pos),target=axis==='x'?[current.dx,current.dz,current.dy]:axis==='y'?[current.dz,current.dy,current.dx]:[current.dy,current.dx,current.dz],orientation=C.poses(unit).findIndex(d=>d.every((v,k)=>Math.abs(v-target[k])<C.EPS));
    if(orientation<0)return {ok:false,restricted:true,message:'这个箱型当前'+(unit.rotateMode==='none'?'固定朝向':'仅允许水平旋转')+'。在“项目与叠箱规则 → 箱型规则”中可设置允许平放、侧放、立放。'};
    const next={...pos,orientation,...(manualOrientation?{manualOrientation:true}:{}),x:Math.max(0,current.x+(current.dx-target[0])/2),y:Math.max(0,current.y+(current.dy-target[1])/2)};
    const check=C.validate([...boxes.filter(b=>b.uid!==unit.uid),C.box(unit,next)],settings);
    return {...check,position:next,message:check.issues.find(i=>i.severity==='error')?.message};
  }
  const api={supportClass,suggest,autoCombine,applyAutoCombine,rotatePlacement};if(typeof module==='object')module.exports=api;else root.PlannerStack=api;
})(typeof window!=='undefined'?window:globalThis);
