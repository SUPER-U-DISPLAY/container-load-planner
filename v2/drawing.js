(function(root){
  'use strict';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function render(bs,{view='iso',bounds=null,selected=null,errors=[],container=false,compact=false}={}){
    const width=1000,height=620,pad=65,e=PlannerCore.extent(bs);
    const dim=bounds||{L:Math.max(2400,e.L+300),W:Math.max(2000,e.W+300),H:Math.max(2800,e.H+150)};
    const raw=(x,y,z)=>view==='top'?[x,y]:view==='side'?[x,-z]:[(x-y)*.86,(x+y)*.30-z*.9];
    const corners=[[0,0,0],[dim.L,0,0],[dim.L,dim.W,0],[0,dim.W,0],[0,0,dim.H],[dim.L,0,dim.H],[dim.L,dim.W,dim.H],[0,dim.W,dim.H]];
    const coords=corners.map(p=>raw(...p)),minx=Math.min(...coords.map(p=>p[0])),maxx=Math.max(...coords.map(p=>p[0])),miny=Math.min(...coords.map(p=>p[1])),maxy=Math.max(...coords.map(p=>p[1]));
    const scale=Math.min((width-pad*2)/(maxx-minx||1),(height-pad*2)/(maxy-miny||1)),ox=(width-(maxx-minx)*scale)/2-minx*scale,oy=(height-(maxy-miny)*scale)/2-miny*scale;
    const pt=(x,y,z)=>{const p=raw(x,y,z);return [p[0]*scale+ox,p[1]*scale+oy];},pstr=ps=>ps.map(p=>pt(...p).map(n=>n.toFixed(2)).join(',')).join(' ');
    const poly=(ps,fill,stroke='#8496ae',extra='')=>`<polygon points="${pstr(ps)}" fill="${fill}" stroke="${stroke}" ${extra}/>`;
    const line=(a,b,color='#e0e7f0',dash='')=>`<line x1="${pt(...a)[0]}" y1="${pt(...a)[1]}" x2="${pt(...b)[0]}" y2="${pt(...b)[1]}" stroke="${color}" stroke-width="1" ${dash?`stroke-dasharray="${dash}"`:''}/>`;
    const label=(p,text,opts='')=>`<text x="${pt(...p)[0]}" y="${pt(...p)[1]}" font-family="system-ui,Microsoft YaHei,sans-serif" font-size="13" fill="#718198" text-anchor="middle" ${opts}>${esc(text)}</text>`;
    let s=`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="620" viewBox="0 0 ${width} ${height}" role="img" aria-label="${container?'排柜':'叠箱'}${view==='top'?'俯视图':view==='side'?'侧视图':'立体示意图'}"><rect width="1000" height="620" fill="#f8fafc"/>`;
    s+=view==='side'?poly([[0,0,0],[dim.L,0,0],[dim.L,0,dim.H],[0,0,dim.H]],'#f3f6fb','#d4dfec'):poly(corners.slice(0,4),'#f1f5fa','#d4dfec');
    const step=Math.max(500,Math.ceil(dim.L/20/500)*500);
    for(let x=step;x<dim.L;x+=step)s+=line([x,0,0],view==='side'?[x,0,dim.H]:[x,dim.W,0]);
    if(view==='side'){for(let z=500;z<dim.H;z+=500)s+=line([0,0,z],[dim.L,0,z]);}
    else for(let y=500;y<dim.W;y+=500)s+=line([0,y,0],[dim.L,y,0]);
    if(view==='iso'&&container){s+=line(corners[0],corners[4],'#b4c4af');s+=line(corners[4],corners[5],'#b4c4af');s+=line(corners[4],corners[7],'#b4c4af');}
    const sorted=[...bs].sort(view==='top'?(a,b)=>a.z-b.z:view==='side'?(a,b)=>b.y-a.y||a.z-b.z:(a,b)=>(a.x+a.y)-(b.x+b.y)||a.z-b.z);
    for(const b of sorted){const {x,y,z,dx,dy,dz}=b;const col=/^#[0-9a-fA-F]{6}$/.test(b.color)?b.color:'#709a92';const stroke=errors.includes(b.uid)?'#c45246':selected===b.uid?'#1d4ed8':'#ffffff';const sw=selected===b.uid?4:errors.includes(b.uid)?3:1.5;
      s+=`<g class="box-shape" data-uid="${esc(b.uid)}" ${compact?'':'role="button" tabindex="0"'} aria-label="选择 ${esc(b.name)} ${esc(b.uid)}"><title>${esc(b.name)} · ${esc(b.uid)}\n${dx} × ${dy} × ${dz} mm · 位置 ${x}, ${y}, ${z}</title>`;
      if(view==='top'||view==='side'){
        const points=view==='top'?[[x,y,z+dz],[x+dx,y,z+dz],[x+dx,y+dy,z+dz],[x,y+dy,z+dz]]:[[x,y,z],[x+dx,y,z],[x+dx,y,z+dz],[x,y,z+dz]];
        s+=`<polygon points="${pstr(points)}" fill="${col}" fill-opacity=".83" stroke="${stroke}" stroke-width="${sw}"/>`;
        const cx=x+dx/2,cy=y+dy/2,cz=z+dz/2,txt=container?(b.groupName||b.name):b.name;
        if(dx*scale>40&&(view==='top'?dy:dz)*scale>23)s+=label([cx,cy,cz],txt.length>12?txt.slice(0,11)+'…':txt,'style="fill:white;font-weight:600;pointer-events:none"');
      }else{
        s+=poly([[x,y+dy,z],[x+dx,y+dy,z],[x+dx,y+dy,z+dz],[x,y+dy,z+dz]],col,stroke,`style="filter:brightness(.88)" stroke-width="${sw}"`);
        s+=poly([[x+dx,y,z],[x+dx,y+dy,z],[x+dx,y+dy,z+dz],[x+dx,y,z+dz]],col,stroke,`style="filter:brightness(.74)" stroke-width="${sw}"`);
        s+=poly([[x,y,z+dz],[x+dx,y,z+dz],[x+dx,y+dy,z+dz],[x,y+dy,z+dz]],col,stroke,`style="filter:brightness(1.15)" stroke-width="${sw}"`);
        if(dx*scale>60&&dy*scale>30)s+=label([x+dx/2,y+dy/2,z+dz],b.seq||b.index||'','style="fill:white;font-weight:700;pointer-events:none"');
      }
      s+='</g>';
    }
    if(container&&view==='iso'){s+=line(corners[5],corners[6],'#ad8562');s+=line(corners[6],corners[2],'#ad8562');s+=line(corners[5],corners[1],'#ad8562');s+=line(corners[7],corners[6],'#b4c4af','5 4');}
    const footY=height-23;if(!compact)s+=`<text x="42" y="${footY}" fill="#7f8fa6" font-size="12" font-family="system-ui">${container?'柜内最深处 ←   X 长度方向   → 柜门':'网格 500 mm · 箱体标注为品名或箱内序号'}</text><text x="958" y="${footY}" fill="#7f8fa6" text-anchor="end" font-size="12" font-family="system-ui">${Math.round(dim.L)} × ${Math.round(view==='side'?dim.H:dim.W)} mm</text>`;
    if(!bs.length)s+=`<text x="500" y="280" text-anchor="middle" fill="#8798af" font-size="22" font-family="system-ui">先从左侧选择一只底箱</text><text x="500" y="315" text-anchor="middle" fill="#8798af" font-size="14" font-family="system-ui">再选上箱，点击合适的摆放位置</text>`;
    s+='</svg>';return {svg:s,scale,ox,oy,width,height,bounds:dim};
  }
  root.PlannerDrawing={render,esc};
})(window);
