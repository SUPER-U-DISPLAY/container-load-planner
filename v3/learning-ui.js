(function(){
 'use strict';
 const L=PlannerLearning,C=PlannerCore,E=PlannerExperience,B=PlannerBridge,$=id=>document.getElementById(id);
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function toast(message){let node=$('learningToast');if(!node){node=document.createElement('div');node.id='learningToast';node.className='learning-toast';document.body.append(node);}node.textContent=message;clearTimeout(node.timer);node.timer=setTimeout(()=>node.textContent='',5500);}
 function dialog(title,body,actions=[]){
  const node=document.createElement('dialog');node.className='learning-dialog';node.innerHTML='<h2>'+esc(title)+'</h2>'+body+'<p class="learning-error" role="status"></p><div class="learning-actions"><button class="btn" data-close>关闭</button>'+actions.map((a,i)=>'<button class="btn '+(a.primary?'primary':'')+'" data-action="'+i+'">'+esc(a.label)+'</button>').join('')+'</div>';document.body.append(node);node.querySelector('[data-close]').onclick=()=>node.close();node.addEventListener('close',()=>node.remove());
  node.querySelectorAll('[data-action]').forEach(btn=>btn.onclick=async()=>{btn.disabled=true;try{await actions[+btn.dataset.action].run(node);}catch(e){node.querySelector('.learning-error').textContent=e.message;}finally{btn.disabled=false;}});node.showModal();return node;
 }
 function status(node){if(!node)return;node.textContent=L.state.error?L.state.connection+' · '+L.state.error:L.state.connection;node.classList.toggle('error',!!L.state.error);}
 async function confirm(app){
  const p=app.getProject(),raw=app.getResult();if(!raw)throw Error('请先完成排柜，再确认最终方案');if(B.dirty(p))throw Error('请先保存或放弃叠箱草稿');
  const data=dialog('确认最终方案','<div class="learning-note">本次 '+raw.loaded+' / '+raw.total+' 箱，使用 '+raw.containers.filter(c=>c.boxes.length).length+' 柜。'+(raw.unpacked.length?'仍有 '+raw.unpacked.length+' 箱未装入，将保留未完成状态。':'')+'保存后保留独立版本，后续修改不会覆盖它。'+(raw.readiness&&!raw.readiness.ready?' 本次为条件预排，仍有加固、承压、进柜或缺失资料待处理；保存只保留布局，不代表运输验收，暂不用于经验学习。':'')+'</div><label>主要调整原因（可不填）<select id="confirmReason"><option value="">未填写</option><option>更稳固</option><option>方便装卸</option><option>减少柜数</option><option>一起卸货</option><option>本项目特殊要求</option><option>其他</option></select></label><label style="margin-top:12px">补充说明（可不填）<textarea id="confirmNote" placeholder="没有说明也可以直接确认"></textarea></label>'+(p.demo?'<p class="learning-help">这是练习项目，确认记录会保留，但不进入正式经验学习。</p>':''),[{label:'确认保存',primary:true,run:async d=>{
   const reason=[d.querySelector('#confirmReason').value,d.querySelector('#confirmNote').value.trim()].filter(Boolean).join('：'),answer=await L.confirm(p,raw,reason);d.close();toast(answer.pending?'已保存在本机，等待同步：'+answer.error:answer.duplicate?'该方案已有确认版本，未重复计入经验':answer.shared?'最终方案已确认并同步':answer.case?.transportPending?'布局已保存；仍需加固确认，未进入经验学习':'最终方案已确认，已保存到本机经验');status($('learningStatus'));
  }}]);return data;
 }
 function attachMain(app){
  const state=$('learningStatus');L.ready.then(async()=>{status(state);const raw=await L.currentResult(app.getProject());if(raw&&!app.getResult())app.applyResult(raw);}).catch(e=>toast(e.message));
  L.observe(app.getProject(),'open').catch(()=>{});
  window.addEventListener('planner-learning-status',()=>{status(state);let button=$('cancelLearningJob');if(L.state.activeJob&&!button){button=document.createElement('button');button.id='cancelLearningJob';button.className='btn';button.textContent='取消计算';button.onclick=()=>L.cancelJob().catch(e=>toast(e.message));$('loading')?.append(button);}else if(!L.state.activeJob&&button)button.remove();});
  $('btnLearningHistory').onclick=()=>{if(app.save())location.href='history.html';};
  $('btnEditLayout').onclick=async()=>{try{if(!app.getResult())throw Error('请先开始排柜');if(app.save()){await L.saveResult(app.getProject(),app.getResult(),'open-editor');location.href='edit.html';}}catch(e){toast(e.message);}};
  $('btnConfirmPlan').onclick=()=>confirm(app).catch(e=>toast(e.message));
 }
 function attachStack(getProject){
  const actions=document.querySelector('#stackHeader .stack-actions'),button=document.createElement('button');button.className='btn';button.textContent='历史与学习';button.onclick=()=>{B.write(getProject());location.href='history.html';};actions.insertBefore(button,actions.lastElementChild);
 }
 function download(value,filename){const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
 const outcomeNames={unknown:'未反馈',intact:'到货完好',moved:'有移位',crushed:'有压坏',broken:'有破损',other_damage:'其他货损'};
 const weightNames={lowPlacement:'低位摆放',sameKindAdjacency:'同类相邻',groupedShare:'组合占比'};
 async function historyPage(){
  await L.ready;let selectedTab='projects';
  const run=fn=>async()=>{try{await fn();}catch(e){toast(e.message);}};
  async function render(){
   status($('historyStatus'));
   if(selectedTab==='projects'){
    const list=await L.projects();$('projectsList').innerHTML=list.length?'<table class="learning-table"><thead><tr><th>方案项目</th><th>ERP 项目 / 发货批次</th><th>修订</th><th>操作</th></tr></thead><tbody>'+list.map(p=>'<tr><td>'+esc(p.name)+'</td><td>'+esc(p.context.erpProjectId||'未关联')+' / '+esc(p.context.batchId||'未填写')+'</td><td>'+esc(p.revision??'本机')+'</td><td><button class="btn sm" data-open-project="'+esc(p.id)+'">打开</button></td></tr>').join('')+'</tbody></table>':'<div class="learning-empty">先导入装箱单。项目和调整过程会自动保留在本机。</div>';
    document.querySelectorAll('[data-open-project]').forEach(button=>button.onclick=run(async()=>{await L.openProject(button.dataset.openProject);location.href='./';}));
   }
   if(selectedTab==='cases'){
    const records=await L.cases(),manager=L.state.identity?.roles.some(r=>['admin','policy_manager'].includes(r));
    $('casesList').innerHTML=records.length?records.map(c=>'<article class="learning-case"><h3>'+esc(c.final.project.name)+' <span class="learning-tag '+(c.excluded?'bad':'')+'">'+(c.pendingSync?'待同步':c.demo?'练习记录':c.excluded?'已排除学习':c.transportPending?'布局已保存 · 待加固，未用于学习':'已确认')+'</span></h3><p>'+esc(new Date(c.createdAt).toLocaleString('zh-CN'))+' · '+c.final.result.loaded+'/'+c.final.result.total+' 箱 · '+c.final.result.containers.length+' 柜 · '+esc(c.actorName||'本机试用')+'</p><p>'+esc(c.baselineNote)+'；到货：'+esc(outcomeNames[c.arrival||'unknown'])+(c.executed?'；已记录实装':'；未记录实装')+'</p>'+(c.excluded?'<p class="learning-error">'+esc(c.exclusionReason)+'</p>':'')+(c.reason?'<p>原因：'+esc(c.reason)+'</p>':'')+'<div class="learning-actions"><button class="btn sm" data-diff="'+esc(c.id)+'">查看差异</button><button class="btn sm" data-reuse="'+esc(c.id)+'">载入为新方案</button><button class="btn sm" data-feedback="'+esc(c.id)+'">现场 / 到货反馈</button>'+(manager?'<button class="btn sm" data-exclude="'+esc(c.id)+'">'+(c.excluded?'恢复案例':'停用经验')+'</button>':'')+'</div></article>').join(''):'<div class="learning-empty">排柜后点“确认最终方案”，这里就会保留原方案和人工最终方案。普通调整不需要选择理由。</div>';
    const find=key=>records.find(c=>c.id===key);
    document.querySelectorAll('[data-diff]').forEach(b=>b.onclick=()=>showDiff(find(b.dataset.diff)));
    document.querySelectorAll('[data-reuse]').forEach(b=>b.onclick=run(async()=>{const c=find(b.dataset.reuse),p=clone(c.final.project);p.id=L.uuid();p.name+='（新方案）';p.context={...p.context,learningFamilyId:c.familyId||p.context?.erpProjectId||c.projectId,sourceCaseId:c.id};B.write(p,{action:'reuse-case'});await L.saveResult(p,c.final.result,'reuse-case');location.href='./';}));
    document.querySelectorAll('[data-feedback]').forEach(b=>b.onclick=()=>feedbackDialog(find(b.dataset.feedback),render));
    document.querySelectorAll('[data-exclude]').forEach(b=>b.onclick=run(async()=>{const c=find(b.dataset.exclude);await L.exclude(c.id,!c.excluded);await render();}));
   }
   if(selectedTab==='policies'){
    if(!L.state.identity?.roles.some(r=>['admin','policy_manager'].includes(r))){$('policiesList').innerHTML='<div class="learning-empty">发布与回退由生产规则负责人操作。你的日常调整与确认无需进入此页。</div>';return;}
    const data=await L.policies(),released=new Set(data.versions.map(p=>p.id)),candidates=data.candidates.filter(p=>!released.has(p.id));
    $('policiesList').innerHTML='<p class="learning-help">当前版本：'+esc(data.active||'基础规则')+'。仅更新模板与偏好排序，不修改承压、禁压、朝向或组合落地规则。</p>'+(candidates.length||data.versions.length?[...candidates,...data.versions].map(p=>'<article class="learning-case"><h3>'+esc(p.id)+' <span class="learning-tag">'+(p.id===data.active?'当前使用':p.status==='published'?'已发布':'候选版本')+'</span></h3><p>'+p.templates.length+' 个组合模板；'+p.validation.independentProjects+' 个独立项目偏好对。训练 '+p.validation.trainingProjects+' 个，留出 '+p.validation.holdoutProjects+' 个，留出采纳倾向一致率 '+(p.validation.holdoutAgreement===null?'暂不可评估':Math.round(p.validation.holdoutAgreement*100)+'%')+'。</p><p>'+esc(p.validation.reason)+'。</p><p>'+Object.entries(p.weights).map(([k,v])=>esc(weightNames[k])+'：'+Number(v).toFixed(3)).join('；')+'</p><button class="btn sm '+(p.status==='published'?'':'primary')+'" data-policy="'+esc(p.id)+'" data-rollback="'+(p.status==='published'?'1':'0')+'" '+(!p.publishable&&p.status!=='published'?'disabled':'')+'>'+(p.status==='published'?'切换到此版本':'发布此版本')+'</button></article>').join(''):'<div class="learning-empty">确认真实项目后，点击“分析历史并生成候选”。案例不足时，先更新可匹配的组合模板。</div>');
    document.querySelectorAll('[data-policy]').forEach(b=>b.onclick=run(async()=>{await L.activate(b.dataset.policy,b.dataset.rollback==='1');toast('已更新新计算使用的经验版本，历史确认方案保持原记录');await render();}));
   }
  }
  function clone(v){return C.clone(v);}
  function showDiff(c){
   const before=c.baseline?.result,after=c.final.result,d=c.diff||{};const block=(name,r)=>'<article><strong>'+name+'</strong><p>'+(r?r.loaded+'/'+r.total+' 箱；'+r.containers.length+' 柜':'没有原始推荐')+'</p></article>';
   const node=dialog('原方案与最终方案','<div class="learning-diff">'+block('系统原始推荐',before)+block('人工最终方案',after)+'</div><p class="learning-help">有效差异：移动 '+(d.moved||0)+' 箱，旋转 '+(d.rotated||0)+' 箱，换柜 '+(d.changedContainer||0)+' 箱，组合变化 '+(d.groupChanges||0)+' 项。撤销试摆不会作为最终偏好。</p><p>'+esc(c.baselineNote)+'</p><p class="learning-help">确认、实装、到货反馈分别记录，尚未反馈不表示到货完好。</p><div id="casePhotos" class="learning-actions"></div>');
   const photos=[...new Set((c.feedback||[]).flatMap(f=>f.attachmentIds||[]))];for(const attachmentId of photos){const b=document.createElement('button');b.className='btn sm';b.textContent='查看现场照片';b.onclick=run(async()=>{const url=await L.photo(attachmentId),d=dialog('现场照片','<img class="learning-photo" alt="现场反馈照片">');d.querySelector('img').src=url;d.addEventListener('close',()=>URL.revokeObjectURL(url));});node.querySelector('#casePhotos').append(b);}
  }
  function feedbackDialog(c,refreshView){
   dialog('现场与到货反馈','<label>记录类型<select id="feedbackType"><option value="reason">补充调整原因</option><option value="execution">确认已按此版本实际装柜</option><option value="arrival">到货反馈</option></select></label><label style="margin-top:10px">到货情况<select id="feedbackOutcome"><option value="unknown">未反馈</option><option value="intact">完好</option><option value="moved">移位</option><option value="crushed">压坏</option><option value="broken">破损</option><option value="other_damage">其他货损</option></select></label><label style="margin-top:10px">说明（可选）<textarea id="feedbackReason"></textarea></label><label style="margin-top:10px">木架、垫板、绑扎等固定措施（可选）<input id="fixingMeasures"></label><label style="margin-top:10px">现场照片（可选，最多8张，每张8MB）<input id="feedbackPhotos" type="file" multiple accept="image/jpeg,image/png,image/webp"></label>',[{label:'保存反馈',primary:true,run:async d=>{const type=d.querySelector('#feedbackType').value,files=[...d.querySelector('#feedbackPhotos').files];if(files.length>8||files.some(f=>f.size>8*1024*1024))throw Error('最多8张照片，每张不超过8MB');await L.feedback(c.id,{type,outcome:type==='execution'?'executed':d.querySelector('#feedbackOutcome').value,reason:d.querySelector('#feedbackReason').value,fixingMeasures:d.querySelector('#fixingMeasures').value,files});d.close();toast('反馈已保存');await refreshView();}}]);
  }
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=run(async()=>{selectedTab=b.dataset.tab;document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.learning-tab').forEach(x=>x.hidden=x.id!=='tab-'+selectedTab);await render();}));
  $('refreshHistory').onclick=run(async()=>{await L.refresh();await render();toast('已刷新');});
  $('newProject').onclick=run(async()=>{B.write(B.empty(),{action:'new-project'});location.href='./';});
  $('syncNow').onclick=run(async()=>{const p=B.read();await L.flush(p);const results=await L.syncPending();toast(results.some(r=>!r.ok)?'仍有待同步记录，请检查版本冲突':'当前项目与待同步记录已处理');await render();});
  $('editContext').onclick=()=>{const p=B.read();dialog('关联项目与发货批次','<label>ERP 项目编号<input id="erpProjectId" value="'+esc(p.context?.erpProjectId||'')+'"></label><label style="margin-top:10px">发货批次<input id="shipmentBatchId" value="'+esc(p.context?.batchId||'')+'"></label><p class="learning-help">连接共享服务后，服务器会检查你是否有权访问对应 ERP 项目。此处填写编号不会授予权限。</p>',[{label:'保存关联',primary:true,run:async d=>{p.context={...p.context,erpProjectId:d.querySelector('#erpProjectId').value.trim(),batchId:d.querySelector('#shipmentBatchId').value.trim()};B.write(p);await L.flush(p);d.close();toast('关联已保存');await render();}}]);};
  $('analyseLearning').onclick=run(async()=>{const button=$('analyseLearning');button.disabled=true;try{await L.train();toast('已生成候选版本');await render();}finally{button.disabled=false;}});
  $('exportLearning').onclick=run(async()=>download(await L.exportArchive(),'SUPER-U-学习经验归档.json'));
  $('importLearning').onchange=run(async()=>{const file=$('importLearning').files[0];if(!file)return;const imported=await L.importArchive(JSON.parse(await file.text()));toast('已导入 '+imported+' 条案例；不伪造修改前推荐');$('importLearning').value='';await render();});
  $('serviceUrl').value=L.config.api||'';
  $('connectService').onclick=run(async()=>{await L.connection($('serviceUrl').value.trim(),$('serviceToken').value);$('serviceToken').value='';toast('连接成功');await render();});
  $('useLocalMode').onclick=run(async()=>{await L.connection('','');$('serviceUrl').value='';$('serviceToken').value='';toast('已切换本机试用，公司的共享记录保留在服务器');await render();});
  window.addEventListener('planner-learning-status',()=>status($('historyStatus')));await render();
 }
 window.PlannerLearningUI={attachMain,attachStack,historyPage,dialog,toast,esc,confirm};
})();
