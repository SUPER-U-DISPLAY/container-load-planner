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
    const orientations=C.poses(unit).slice(0,2).map((d,i)=>({d,i})).filter((p,i,a)=>a.findIndex(q=>q.d.join()===p.d.join())===i);
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
    const reason=above.length?'':(fs.map(f=>reasons[f.code]).find(Boolean)||'没有找到符合当前规则的上叠位置，可并排放置或在高级调整中设置。');
    return {above,beside,reason};
  }
  const api={supportClass,suggest};if(typeof module==='object')module.exports=api;else root.PlannerStack=api;
})(typeof window!=='undefined'?window:globalThis);
