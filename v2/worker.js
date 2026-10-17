importScripts('core.js?v=2.0.1');
self.onmessage = ({data}) => {
  try {
    if(data.action==='recommend') {
      const results=[];
      for(const type of ['20GP','40GP','40HQ','45HQ']) {
        const p=PlannerCore.clone(data.project);p.settings.containers=[{type,qty:1}];p.settings.autoAdd=true;
        const r=PlannerCore.pack(p);results.push({type,count:r.containers.length,unpacked:r.unpacked.length,volume:r.containers.reduce((s,c)=>s+c.spec.L*c.spec.W*c.spec.H/1e9,0),result:r});
        postMessage({type:'progress',job:data.job,progress:{message:'正在比较 '+type}});
      }
      results.sort((a,b)=>a.unpacked-b.unpacked||a.count-b.count||a.volume-b.volume);postMessage({type:'recommend',job:data.job,results});
    } else {
      const result=PlannerCore.pack(data.project,progress=>postMessage({type:'progress',job:data.job,progress}));
      postMessage({type:'result',job:data.job,result});
    }
  } catch(e){postMessage({type:'error',job:data.job,message:e.message});}
};
