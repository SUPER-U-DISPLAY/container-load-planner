importScripts('transport.js?v=3.3.0','core.js?v=3.3.0','stacking.js?v=3.3.0','layout.js?v=3.3.0','experience.js?v=3.3.0','bridge.js?v=3.3.0');
self.onmessage=event=>{try{const result=PlannerExperience.pack(event.data.project,event.data.experience,p=>self.postMessage({progress:p}));self.postMessage({result});}catch(e){self.postMessage({error:e.message});}};
