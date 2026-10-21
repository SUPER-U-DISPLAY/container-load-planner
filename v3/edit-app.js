(async function(){
 'use strict';
 const C=PlannerCore,P=PlannerLayout,L=PlannerLearning,U=PlannerLearningUI,$=id=>document.getElementById(id),esc=U.esc;
 await L.ready;const project=PlannerBridge.read();let layout=await L.currentResult(project),container=0,selection=null,history=[],saved=true;
 if(!layout){$('packingEditor').innerHTML='<div class="learning-empty">没有可调整的当前结果，请先去排柜。<a href="./">返回排柜页</a></div>';return;}
 $('editTitle').textContent=project.name;
 const scene=new PackingScene($('packingCanvas'),{bounds:layout.containers[0]?.spec,onSelect:k=>{selection=k;render();},assess:(k,pos)=>P.move(project,layout,k,{...pos,container}),onDrop:(unit,pos)=>act(()=>P.move(project,layout,unit.uid,{...pos,container}),'drag'),onFeedback:feedback});
 function feedback(message,valid){$('dragFeedback').textContent=message;$('dragFeedback').className=valid===true?'valid':valid===false?'invalid':'';}
 function act(fn,action){try{const previous=C.clone(layout),next=fn();layout=next;history.push(previous);if(history.length>40)history.shift();saved=false;L.saveResult(project,layout,action).catch(e=>U.toast(e.message));render();feedback('位置已调整，完成后保存并返回排柜',true);}catch(e){feedback(e.message,false);U.toast(e.message);}}
 function render(){
  if(container>=layout.containers.length)container=Math.max(0,layout.containers.length-1);const ct=layout.containers[container],found=P.selected(layout,selection),items=ct?.boxes||[],groups=new Map();
  const options=layout.containers.map((ct,i)=>'<option value="'+i+'">'+(i+1)+'号柜 · '+ct.spec.id+' · '+ct.boxes.length+'箱</option>').join('');$('editContainer').innerHTML=options;$('editContainer').value=container;$('targetContainer').innerHTML=options;$('targetContainer').value=found?.index??container;
  for(const b of items){const k=P.key(b);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(b);}
  $('editObjects').innerHTML=groups.size?[...groups].map(([k,boxes])=>'<button class="edit-object '+(selection===k?'selected':'')+'" data-layout-key="'+esc(k)+'">'+esc(boxes[0].groupName||boxes[0].name)+'<small>'+boxes.length+'箱'+(layout.locks.includes(k)?' · 已锁定':'')+'</small></button>').join(''):'<div class="edit-empty">本柜为空</div>';
  document.querySelectorAll('[data-layout-key]').forEach(b=>b.onclick=()=>{selection=b.dataset.layoutKey;render();});
  const held=new Map();for(const b of layout.unpacked){const g=project.groups.find(g=>g.children.some(c=>c.uid===b.uid)),k=g?'g:'+g.id:'u:'+b.uid;if(!held.has(k))held.set(k,{uid:b.uid,name:g?.name||b.name,count:g?.children.length||1});}
  $('heldObjects').innerHTML=held.size?[...held.values()].map(b=>'<button class="edit-object" data-place-held="'+esc(b.uid)+'">'+esc(b.name)+'<small>'+b.count+'箱 · 点击尝试放入本柜</small></button>').join(''):'<div class="edit-empty">全部已装入</div>';
  document.querySelectorAll('[data-place-held]').forEach(b=>b.onclick=()=>act(()=>P.placeHeld(project,layout,b.dataset.placeHeld,container),'place-held'));
  $('editCounts').textContent='已装入 '+layout.loaded+'/'+layout.total+' 箱，锁定 '+layout.locks.length+' 个单元';
  $('editSelected').textContent=found?(found.boxes[0].groupName||found.boxes[0].name)+' · '+found.boxes.length+'箱':'点击柜内模型或左侧列表';
  for(const axis of ['X','Y','Z']){$('edit'+axis).value=found?Math.min(...found.boxes.map(b=>b[axis.toLowerCase()])):'';$('edit'+axis).disabled=!found;}
  ['applyLayoutPosition','floorLayout','lockLayout','holdLayout','targetContainer'].forEach(id=>$(id).disabled=!found);
  $('lockLayout').textContent=found&&layout.locks.includes(found.key)?'解锁位置':'锁定位置';$('undoLayout').disabled=!history.length;
  document.querySelectorAll('[data-rotate-layout]').forEach(b=>b.disabled=!found||!!found.boxes[0].groupId&&b.dataset.rotateLayout!=='z');
  const warnings=[...new Set(layout.containers.flatMap(ct=>ct.issues.filter(i=>i.severity==='warning').map(i=>i.message)))];$('layoutWarnings').textContent=warnings.join('；');
  scene.options.bounds=ct?.spec;scene.setData(items,selection,project.settings);$('editStatus').textContent=saved?'当前调整已保存':'本机已暂存，完成后点“保存调整并去排柜”';
 }
 $('editContainer').onchange=()=>{container=+$('editContainer').value;selection=null;render();scene.fit();};
 $('applyLayoutPosition').onclick=()=>act(()=>P.move(project,layout,selection,{container:+$('targetContainer').value,x:+$('editX').value,y:+$('editY').value,z:+$('editZ').value}),'move-or-transfer');
 $('floorLayout').onclick=()=>act(()=>P.move(project,layout,selection,{z:0}),'floor');
 document.querySelectorAll('[data-rotate-layout]').forEach(b=>b.onclick=()=>act(()=>P.rotate(project,layout,selection,b.dataset.rotateLayout),'rotate'));
 $('lockLayout').onclick=()=>act(()=>P.lock(project,layout,selection,!layout.locks.includes(selection)),'lock');$('holdLayout').onclick=()=>act(()=>P.hold(project,layout,selection),'hold');
 $('addContainer').onclick=()=>act(()=>{const next=P.addContainer(project,layout);container=next.containers.length-1;return next;},'add-container');
 $('repackUnlocked').onclick=()=>act(()=>P.repackUnlocked(project,layout),'repack-unlocked');
 $('undoLayout').onclick=()=>{if(!history.length)return;layout=history.pop();saved=false;L.saveResult(project,layout,'undo').catch(e=>U.toast(e.message));render();};
 $('snapLayout').onchange=e=>scene.snap=e.target.checked;$('fitScene').onclick=()=>scene.fit();document.querySelectorAll('[data-scene-view]').forEach(b=>b.onclick=()=>scene.fit(b.dataset.sceneView));
 async function saveAndBack(){const raw=P.canonical(project,layout,{keepEmpty:false});await L.commitResult(project,raw);saved=true;location.href='./';}
 $('saveLayout').onclick=()=>saveAndBack().catch(e=>U.toast(e.message));
 $('exitEditor').onclick=()=>{if(saved){location.href='./';return;}U.dialog('离开调整页面','<p>调整已暂存在本机。保存后可在原排柜结果页继续查看、确认与导出。</p>',[{label:'保存并去排柜',primary:true,run:saveAndBack}]);};
 render();scene.fit();
})().catch(e=>PlannerLearningUI.toast(e.message));
