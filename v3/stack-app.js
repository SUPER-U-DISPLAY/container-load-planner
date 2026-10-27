(function(){
 'use strict';
 const C=PlannerCore,B=PlannerBridge,S=PlannerStack,$=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let p,readError='',selected=null,history=[],toastTimer;
 try{p=B.read();}catch(e){p=B.empty();readError=e.message;}
 const id=()=> 'stack-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7);
 const fresh=()=>({id:id(),name:'组合 '+(p.groups.length+1),allowRotate:p.settings.allowGroupRotate!==false,children:[]});
 let draft=p.draft||fresh();p.draft=draft;
 try{C.groupBoxes(draft,C.expand(p.cargos));}catch(e){readError='叠箱草稿引用的箱子不存在，请先导出备份并检查项目。';draft=fresh();p.draft=draft;}
 const scene=new StackScene($('stack3dCanvas'),{onSelect:uid=>{selected=uid;renderWorkbench();},onDrop:(unit,pos,existing)=>{
  if(!existing&&!available(unit.id).some(u=>u.uid===unit.uid)){toast('这只箱子已被使用，请重新选择。');return;}
  change(()=>{if(existing)draft.children=draft.children.map(c=>c.uid===unit.uid?{...c,...pos}:c);else draft.children.push(pos);selected=unit.uid;});feedback('已放置 '+unit.name+' · 离地 '+pos.z+' mm',true);
 },onFeedback:feedback});
 $('renderMode').textContent=scene.renderer.isSoftwareRenderer?'兼容 3D 模式':'';
 function units(){return C.expand(p.cargos);}
 function boxes(){return C.groupBoxes(draft,units());}
 function reserved(){return new Set([...p.groups.filter(g=>g.id!==draft.id).flatMap(g=>g.children.map(c=>c.uid)),...draft.children.map(c=>c.uid)]);}
 function available(cargoId){const used=reserved();return units().filter(u=>u.id===cargoId&&!u.pending&&!used.has(u.uid));}
 function feedback(message,valid){$('dragFeedback').textContent=message;$('dragFeedback').className=valid===true?'valid':valid===false?'invalid':'';}
 function toast(message){$('stackToast').textContent=message;$('stackToast').classList.add('on');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('stackToast').classList.remove('on'),4000);}
 function persist(action='stack-edit'){p.draft=draft;if(readError){$('saveStatus').textContent='原项目读取异常，请先备份';return false;}try{B.write(p,{action});$('saveStatus').textContent='已自动保存到本机';return true;}catch(e){$('saveStatus').textContent='保存失败';toast('保存失败：'+e.message);return false;}}
 function checkpoint(){history.push({draft:C.clone(draft),selected});if(history.length>40)history.shift();}
 function change(fn){checkpoint();fn();persist();render();}
 function dialog(title,body,actions){const d=$('stackDialog');$('stackDialogContent').innerHTML='<div class="sd-head"><h2>'+esc(title)+'</h2><button class="btn sm" data-close>关闭</button></div><div class="sd-body">'+body+'</div><div class="sd-actions">'+actions.map((a,i)=>'<button class="btn '+(a.primary?'primary':'')+'" data-action="'+i+'">'+esc(a.label)+'</button>').join('')+'</div>';$('stackDialogContent').querySelector('[data-close]').onclick=()=>d.close();$('stackDialogContent').querySelectorAll('[data-action]').forEach(el=>el.onclick=()=>actions[+el.dataset.action].run());if(!d.open)d.showModal();}
 function close(){ $('stackDialog').close(); }
 function discardDraft(){draft=C.clone(p.groups.find(g=>g.id===draft.id)||fresh());p.draft=draft;selected=null;history=[];persist();}
 function guard(action){if(!B.dirty({...p,draft})){action();return;}dialog('工作台有未保存的组合','请处理当前草稿后继续。已保存组合按右侧卡片中的摆放参与排柜。',[{label:'取消',run:close},{label:'放弃草稿并继续',run:()=>{discardDraft();close();action();}},{label:'保存并继续',primary:true,run:()=>{if(saveStack()){close();action();}}}]);}
 function renderCatalog(){
  const q=$('modelSearch').value.trim().toLowerCase(),used=reserved(),all=units();const cargos=p.cargos.filter(c=>(c.name+' '+(c.ctnNo||'')).toLowerCase().includes(q));
  $('catalogCount').textContent=p.cargos.length+' 种 / '+all.length+' 箱';
  $('catalogModels').innerHTML=cargos.length?cargos.map(c=>{const free=all.filter(u=>u.id===c.id&&!used.has(u.uid)),valid=free.filter(u=>!u.pending),status=S.supportClass(c),bound=p.groups.flatMap(g=>g.children).filter(b=>b.uid.startsWith(c.id+'#')).length;return '<article class="model-card '+(!valid.length?'unavailable':'')+'" data-cargo="'+esc(c.id)+'" aria-label="'+esc(c.name)+'，剩余 '+free.length+' 箱，可拖到工作台"><canvas aria-label="'+esc(c.name)+' 立体模型"></canvas><strong><span class="swatch" style="background:'+safeColor(c.color)+'"></span>'+esc(c.name)+'</strong><small>'+[c.l,c.w,c.h].join(' × ')+' mm'+(c.ctnNo?' · '+esc(c.ctnNo):'')+'</small><span class="count">剩余 '+free.length+' / '+c.qty+' 箱</span><span class="stack-tag '+(status==='topOnly'?'warn':status==='pending'?'bad':'')+'">'+(status==='pending'?'尺寸待补充':status==='topOnly'?'不可承叠 · 只能放顶层':'可灵活叠放')+'</span><small>已固定组合 '+bound+' 箱'+(!C.known(c.weight)?' · 重量待填':' · '+c.weight+' kg')+'</small><button class="btn sm model-add" data-add="'+esc(c.id)+'" '+(!valid.length?'disabled':'')+'>＋ 加入工作台</button></article>';}).join(''):'<div class="stack-empty">'+(p.cargos.length?'没有匹配的产品':'还没有装箱单。<br><a href="./">返回排柜页 → 导入装箱单</a><br>也可以点上方“试用叠箱示例”。')+'</div>';
  document.querySelectorAll('.model-card').forEach(card=>{const cargo=p.cargos.find(c=>c.id===card.dataset.cargo);if([cargo.l,cargo.w,cargo.h].every(n=>n>0))StackScene.preview(card.querySelector('canvas'),[C.box({...cargo,uid:cargo.id+'#preview'})]);card.addEventListener('pointerdown',e=>{if(e.target.closest('button'))return;const u=available(cargo.id)[0];if(u)scene.beginPaletteDrag(e,u);});});
  document.querySelectorAll('[data-add]').forEach(button=>button.onclick=()=>{const u=available(button.dataset.add)[0];if(!u)return;const options=S.suggest(u,boxes(),p.settings);const pos=options.beside[0]?.position;if(!pos){toast('无法加入工作台，请检查箱子尺寸或叠放高度。');return;}change(()=>{draft.children.push(pos);selected=u.uid;});scene.fit();feedback('已加入 '+u.name+'，拖到其他箱子的顶面即可叠放',true);});
 }
 function safeColor(s){return /^#[0-9a-fA-F]{3,8}$/.test(s||'')?s:'#739dbd';}
 function renderWorkbench(){
  const bs=boxes(),b=bs.find(b=>b.uid===selected),v=C.validatePlacement(bs,p.settings),saved=p.groups.some(g=>g.id===draft.id);
  v.issues.push(...C.Transport.warnings(C.Transport.screen(bs)));
  if(document.activeElement!==$('stackName'))$('stackName').value=draft.name;
  $('draftState').textContent=B.dirty({...p,draft})?'草稿 · 未保存组合':saved?'已保存':'新组合';$('draftState').className='stack-tag'+(B.dirty({...p,draft})?' warn':'');
  $('sceneEmpty').style.display=bs.length?'none':'';$('undo3d').disabled=!history.length;$('clear3d').disabled=!bs.length;
  $('selected3d').textContent=b?b.name+' · 第 '+b.index+' 箱 · '+b.dx+' × '+b.dy+' × '+b.dz+' mm':'点击模型选择箱子';
  $('rotate3d').disabled=!b||b.rotateMode==='none';$('flip3d').disabled=!b||b.rotateMode==='none';$('rotateSide3d').disabled=!b||b.rotateMode==='none';$('remove3d').disabled=!b;
  $('orientationHint').innerHTML=b?(b.manualOrientation?'当前箱已手动翻转':'箱型自动朝向：'+esc(PlannerRules.rotationLabel(b.rotateMode)))+' <button id="selectedRuleLink">修改此箱型规则</button>':'选中箱子后，可水平转、前后翻、左右翻，每次 90°。';if($('selectedRuleLink'))$('selectedRuleLink').onclick=()=>toolsDialog(b.id);
  ['alignStart3d','alignWidth3d','placeFloor3d'].forEach(id=>$(id).disabled=!b);
  for(const a of ['X','Y','Z']){$('coord'+a).value=b?b[a.toLowerCase()]:'';$('coord'+a).disabled=!b;}$('applyCoords').disabled=!b;
  $('currentMembers').innerHTML=[...bs].sort((a,b)=>a.z-b.z||a.x-b.x||a.y-b.y).map(b=>'<button class="member-chip '+(b.uid===selected?'selected':'')+'" data-select="'+esc(b.uid)+'">'+(b.z===0?'底层':'高 '+b.z+' mm')+' · '+esc(b.name)+' #'+b.index+'</button>').join('');
  document.querySelectorAll('[data-select]').forEach(n=>n.onclick=()=>{selected=n.dataset.select;renderWorkbench();});
  $('check3d').innerHTML=bs.length?(v.ok?'<div>✓ 几何摆放、朝向和已填写的限制符合当前规则</div>':'')+v.issues.map(i=>'<div class="'+(i.severity==='error'?'bad':'warn')+'">'+esc(i.message)+'</div>').join(''):'';
  const e=C.extent(bs);$('stackSize').textContent=bs.length?bs.length+' 箱 · '+[e.L-Math.min(...bs.map(b=>b.x)),e.W-Math.min(...bs.map(b=>b.y)),e.H].map(Math.round).join(' × ')+' mm':'0 箱';
  $('saveStack3d').disabled=!bs.length||!v.ok||!!readError;$('saveStack3d').textContent=saved?'保存组合修改':'保存组合';$('saveStackTop3d').disabled=$('saveStack3d').disabled;$('saveStackTop3d').textContent=saved?'保存修改':'保存组合';scene.setData(bs,selected,p.settings);
 }
 function renderGroups(){
  $('savedCount').textContent=p.groups.length+' 组';$('savedGroups').innerHTML=p.groups.length?p.groups.map(g=>{const bs=C.groupBoxes(g,units()),v=C.validatePlacement(bs,p.settings);return '<article class="saved-group '+(g.id===draft.id?'active':'')+'" data-group="'+esc(g.id)+'"><h3>'+esc(g.name)+'<span class="stack-tag '+(!v.ok?'bad':'')+'">'+(v.ok?(g.source==='auto'?'系统组合':'手动组合'):'需修正')+'</span></h3><canvas aria-label="'+esc(g.name)+' 立体组合"></canvas><div class="saved-members">'+[...bs].sort((a,b)=>a.z-b.z).map(b=>(b.z===0?'底层':'高 '+b.z+' mm')+'：'+esc(b.name)+' #'+b.index).join('<br>')+'</div><div class="stack-actions"><button class="btn xs" data-edit="'+esc(g.id)+'">调整</button><button class="btn xs" data-copy="'+esc(g.id)+'">复制一组</button><button class="btn xs" data-dissolve="'+esc(g.id)+'">解散</button></div></article>';}).join(''):'<div class="stack-empty">保存后在这里看到每一组。<br>同一只箱子只能属于一个组合。</div>';
  document.querySelectorAll('[data-group]').forEach(el=>{const g=p.groups.find(g=>g.id===el.dataset.group);StackScene.preview(el.querySelector('canvas'),C.groupBoxes(g,units()));});
  document.querySelectorAll('[data-edit]').forEach(el=>el.onclick=()=>guard(()=>{draft=C.clone(p.groups.find(g=>g.id===el.dataset.edit));selected=draft.children[0]?.uid||null;history=[];persist();render();scene.fit();feedback('正在编辑 '+draft.name+'；修改后请保存',null);}));
  document.querySelectorAll('[data-copy]').forEach(el=>el.onclick=()=>guard(()=>copyGroup(el.dataset.copy)));
  document.querySelectorAll('[data-dissolve]').forEach(el=>el.onclick=()=>guard(()=>{const g=p.groups.find(g=>g.id===el.dataset.dissolve);dialog('解散 '+g.name,'这组 '+g.children.length+' 只箱子将恢复为散箱，继续参加自动排柜。',[{label:'取消',run:close},{label:'解散组合',primary:true,run:()=>{p.groups=p.groups.filter(x=>x.id!==g.id);if(draft.id===g.id)draft=fresh();p.result=null;selected=null;history=[];persist();close();render();toast('组合已解散，数量已归还');}}]);}));
 }
 function render(){ $('projectTitle').textContent=p.name;renderCatalog();renderWorkbench();renderGroups();const saved=p.groups.reduce((n,g)=>n+g.children.length,0);$('stackOverview').textContent='已保存 '+p.groups.length+' 组 / '+saved+' 箱 · 散箱 '+(units().length-saved)+' 箱';feedback(draft.children.length?'拖动箱子调整位置，完成后保存组合':'从左侧拖入第一只底箱',null); }
 function saveStack(){
  if(readError){toast(readError);return false;}const bs=boxes(),v=C.validatePlacement(bs,p.settings);if(!bs.length||!v.ok){toast(bs.length?v.issues.find(i=>i.severity==='error').message:'请先加入箱子');return false;}
  const g={...C.clone(draft),name:draft.name.trim()||'未命名组合',children:C.normalize(draft.children,units())};const next={...p,groups:[...p.groups.filter(x=>x.id!==g.id),g],draft:g};try{C.checkProject(next);B.write(next);}catch(e){toast('保存失败：'+e.message);return false;}
  p=next;draft=C.clone(g);p.draft=draft;p.result=null;persist();render();scene.fit();toast('组合已保存，排柜时保持内部摆放');return true;
 }
 function copyGroup(groupId){const g=p.groups.find(g=>g.id===groupId),all=units(),used=new Set(p.groups.flatMap(g=>g.children.map(c=>c.uid))),byUid=new Map(all.map(u=>[u.uid,u]));const children=[];for(const pos of g.children){const source=byUid.get(pos.uid),next=all.find(u=>u.id===source.id&&!used.has(u.uid));if(!next){toast(source.name+' 的剩余数量不够复制这一组');return;}used.add(next.uid);children.push({...pos,uid:next.uid});}const copy={...C.clone(g),id:id(),name:g.name+'（副本）',children};p.groups.push(copy);draft=C.clone(copy);p.result=null;selected=null;history=[];persist();render();scene.fit();toast('已复制一组，使用新的实箱数量');}
 function changeOrientation(axis){
  const b=boxes().find(b=>b.uid===selected),pos=draft.children.find(c=>c.uid===selected);if(!b)return;
  const result=S.rotatePlacement(b,pos,axis,boxes(),p.settings,{manual:true});
  if(result.restricted){feedback('此箱型已设为固定朝向，不能直接翻转',false);toast('此箱型已设为固定朝向');return;}
  if(!result.ok){toast('无法旋转：'+result.message+'。可先移开上方或旁边的箱子。');return;}
  change(()=>draft.children=draft.children.map(c=>c.uid===selected?result.position:c));scene.fit();feedback('已翻转当前箱子，保存后保留这个朝向',true);
 }
 function applyPosition(pos){
  const children=draft.children.map(c=>c.uid===selected?{...c,...pos}:c),v=C.validatePlacement(C.groupBoxes({...draft,children},units()),p.settings);
  if(!v.ok){toast('位置未改变：'+v.issues.find(i=>i.severity==='error').message);return;}
  change(()=>draft.children=children);scene.fit();feedback('位置已调整，保存后用于排柜',true);
 }
 $('modelSearch').oninput=renderCatalog;$('snap3d').onchange=e=>scene.snap=e.target.checked;$('fitScene').onclick=()=>scene.fit();document.querySelectorAll('[data-scene-view]').forEach(b=>b.onclick=()=>scene.fit(b.dataset.sceneView));
 $('stackName').oninput=e=>{draft.name=e.target.value;persist();$('draftState').textContent='草稿 · 未保存组合';$('draftState').className='stack-tag warn';};
 $('saveStack3d').onclick=saveStack;$('saveStackTop3d').onclick=saveStack;$('newStack').onclick=()=>guard(()=>{draft=fresh();selected=null;history=[];persist();render();scene.fit();feedback('从左侧拖入第一只底箱',null);});
 $('clear3d').onclick=()=>dialog('清空工作台','清空当前草稿。已保存的组合仍可从右侧重新打开。',[{label:'取消',run:close},{label:'清空工作台',primary:true,run:()=>{change(()=>{draft=fresh();selected=null;});close();scene.fit();feedback('工作台已清空',null);}}]);
 $('undo3d').onclick=()=>{const old=history.pop();if(!old)return;draft=old.draft;selected=old.selected;persist('undo');render();feedback('已撤销上一步',null);};$('rotate3d').onclick=()=>changeOrientation('z');$('flip3d').onclick=()=>changeOrientation('x');$('rotateSide3d').onclick=()=>changeOrientation('y');
 $('remove3d').onclick=()=>{const children=draft.children.filter(c=>c.uid!==selected),v=C.validatePlacement(C.groupBoxes({...draft,children},units()),p.settings);if(!v.ok){toast('请先移开上方箱子：'+v.issues.find(i=>i.severity==='error').message);return;}change(()=>{draft.children=children;selected=null;});};
 $('applyCoords').onclick=()=>{if(selected)applyPosition({x:+$('coordX').value,y:+$('coordY').value,z:+$('coordZ').value});};
 $('alignStart3d').onclick=()=>{const b=boxes().find(b=>b.uid===selected);if(!b)return;const below=boxes().filter(a=>a.uid!==b.uid&&Math.abs(a.z+a.dz-b.z)<C.EPS);applyPosition({x:below.length?Math.min(...below.map(a=>a.x)):0});};
 $('alignWidth3d').onclick=()=>{const b=boxes().find(b=>b.uid===selected);if(!b)return;const below=boxes().filter(a=>a.uid!==b.uid&&Math.abs(a.z+a.dz-b.z)<C.EPS);if(!below.length){toast('先把箱子放到支撑箱顶面，再使用宽向居中');return;}const min=Math.min(...below.map(a=>a.y)),max=Math.max(...below.map(a=>a.y+a.dy));applyPosition({y:Math.max(0,(min+max-b.dy)/2)});};
 $('placeFloor3d').onclick=()=>{const b=boxes().find(b=>b.uid===selected);if(b)applyPosition({x:C.extent(boxes().filter(a=>a.uid!==b.uid)).L,y:0,z:0});};
 $('backResults').onclick=()=>guard(()=>{if(persist())location.href='./';});
 async function autoPreview(replace=false){
  if(!p.cargos.length){toast('先导入装箱单，或试用叠箱示例');return;}
  await PlannerLearning.ready;
  const proposal=PlannerExperience.combine({...p,draft:null},PlannerLearning.state,{replace}),all=units();proposal.signature=C.fingerprint(p);
  const warnings=[...new Set(proposal.groups.flatMap(g=>C.validatePlacement(C.groupBoxes(g,all),p.settings).issues.filter(i=>i.severity==='warning').map(i=>i.message)))];
  const pendingSecuring=proposal.groups.reduce((n,g)=>n+C.Transport.screen(C.groupBoxes(g,all)).needsSecuring,0);
  if(pendingSecuring)warnings.unshift(pendingSecuring+' 箱仍需防倾倒加固确认。采用组合仅保存相对位置；装柜和装卸时仍需落实侧挡、支架或绑扎，未确认的布局不会自动用于经验学习。');
  dialog('一键组合 · 先看方案，再调整',
    (p.groups.length?'<div class="auto-options"><button class="btn sm '+(!replace?'active':'')+'" id="autoRemaining">只组合剩余散箱</button><button class="btn sm '+(replace?'active':'')+'" id="autoReplace">重新组合全部</button></div>':'')+
    '<div class="auto-summary"><span>新组合 <b>'+proposal.groups.length+'</b> 组</span><span>本次组合 <b>'+proposal.combined+'</b> 箱</span><span>剩余散箱 <b>'+proposal.loose+'</b> 箱</span></div>'+
    '<p>'+(replace?'采用后替换原有组合。':'已保存的组合保持原样，只处理剩余散箱。')+'生成后可逐组调整、翻转或解散。'+(proposal.learning.historicalGroups?' 本次复用 '+proposal.learning.historicalGroups+' 组历史经验，已按当前规则重新检查。':' 暂无条件匹配的历史组合，本次使用基础规则。')+'</p>'+
    '<div class="auto-group-list">'+proposal.groups.map((g,i)=>'<article class="auto-group-preview"><strong>'+esc(g.name)+' · '+g.children.length+' 箱</strong><canvas data-auto-preview="'+i+'" aria-label="'+esc(g.name)+'预览"></canvas><p>'+g.children.map(c=>esc(all.find(u=>u.uid===c.uid).name)).join(' + ')+'</p></article>').join('')+'</div>'+
    (!proposal.groups.length?(proposal.loose===0?'<p>全部箱子已有组合。可在右侧调整已有组合，或选择“重新组合全部”生成新方案。</p>':'<p>没有找到符合当前规则的叠放搭配。可以手动组合，或在“项目与叠箱规则”中检查高度、朝向及承叠限制。</p>'):'')+
    (proposal.pending?'<p>另有 '+proposal.pending+' 箱尺寸待补充，保留为散箱。</p>':'')+
    (warnings.length?'<div class="auto-rule-notes">'+warnings.map(esc).join('<br>')+'</div>':''),
    [{label:'取消',run:close},...(proposal.groups.length?[{label:'采用并调整',primary:true,run:()=>{try{p=S.applyAutoCombine(p,proposal);PlannerLearning.noteRecommendation({...p,draft:null},null).catch(e=>toast(e.message));draft=p.draft||fresh();selected=draft.children[0]?.uid||null;history=[];if(!persist())return;close();render();scene.fit();feedback('已打开第一组，可拖动或翻转调整；右侧可切换其他组',true);toast('已采用 '+proposal.groups.length+' 组，可继续手动调整');}catch(e){toast(e.message);}}}]:[])]);
  $('autoRemaining')&&($('autoRemaining').onclick=()=>autoPreview(false));$('autoReplace')&&($('autoReplace').onclick=()=>autoPreview(true));
  document.querySelectorAll('[data-auto-preview]').forEach(canvas=>StackScene.preview(canvas,C.groupBoxes(proposal.groups[+canvas.dataset.autoPreview],all)));
 }
 $('autoStack3d').onclick=()=>guard(()=>autoPreview());
 function download(data,name){const url=URL.createObjectURL(new Blob([data],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function toolsDialog(cargoId=null){PlannerRules.open({
   getProject:()=>({...p,draft}),selectedCargoId:typeof cargoId==='string'?cargoId:null,
   onApply:next=>{p=next;draft=p.draft||fresh();history=[];if(!persist())return false;render();toast('规则已同步；需要修正的组合会标出来');},
   onBackup:()=>download(readError?localStorage.getItem(B.KEY):JSON.stringify({...p,draft,result:undefined},null,2),'SUPER-U-叠箱项目.json'),
   onOpen:()=>guard(()=>{$('stackProjectFile').click();}),onImport:()=>guard(()=>{if(persist())location.href='./';})
 });}
 $('projectTools').onclick=()=>toolsDialog();
 $('stackProjectFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{let next=JSON.parse(await file.text());if(next.schemaVersion!==2&&Array.isArray(next.cargos))next=B.fromLegacy(next,{preferredSpecs:next.ctnSpecs?.map(c=>({spec:{id:c.type},qty:c.qty}))});C.checkProject(next);if(next.draft)C.groupBoxes(next.draft,C.expand(next.cargos));p=next;draft=p.draft||fresh();readError='';selected=null;history=[];persist();render();scene.fit();toast('项目已打开');}catch(err){toast('无法打开项目：'+err.message);}e.target.value='';};
 $('demo3d').onclick=()=>{const load=()=>{p=B.empty();p.demo=true;p.name='3D 叠箱练习 · 22 箱';p.cargos=[{id:'base',name:'展示柜底箱',ctnNo:'A',l:1200,w:800,h:900,qty:6,weight:70,topLoad:160,maxLayers:3,rotateMode:'free',stackable:true,color:'#739dbd'},{id:'upper',name:'上柜纸箱',ctnNo:'B',l:600,w:800,h:600,qty:12,weight:20,topLoad:40,maxLayers:2,rotateMode:'free',stackable:true,color:'#d19b67'},{id:'flat',name:'易碎面板箱',ctnNo:'C',l:1200,w:800,h:180,qty:4,weight:12,topLoad:0,maxLayers:1,rotateMode:'upright',stackable:false,color:'#9cab6b'}];draft=fresh();p.draft=draft;readError='';selected=null;history=[];persist();close();render();scene.fit();feedback('先拖一个蓝色底箱，再把橙色上柜拖到箱顶',null);};if(p.cargos.length)dialog('载入叠箱示例','将替换当前测试项目。可以先导出备份，再载入示例。',[{label:'取消',run:close},{label:'导出当前项目',run:()=>download(JSON.stringify({...p,draft},null,2),'SUPER-U-当前项目备份.json')},{label:'载入 22 箱示例',primary:true,run:load}]);else load();};
 PlannerLearningUI.attachStack(()=>({...p,draft}));
 render();scene.fit();if(readError){feedback(readError,false);$('saveStatus').textContent='项目读取异常';}else persist();
})();
