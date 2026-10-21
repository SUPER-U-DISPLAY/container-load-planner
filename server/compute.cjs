'use strict';
const {parentPort,workerData}=require('node:worker_threads'),E=require('../v3/experience.js'),P=require('../v3/layout.js');
try{
 let result;
 if(workerData.action==='pack')result=E.pack(workerData.project,workerData.experience,p=>parentPort.postMessage({progress:p}));
 else if(workerData.action==='confirm')result=E.makeCase(workerData.payload);
 else if(workerData.action==='validate')result=P.canonical(workerData.project,workerData.result);
 else if(workerData.action==='train')result=E.train(workerData.cases);
 else throw Error('未知计算任务');
 parentPort.postMessage({result});
}catch(e){parentPort.postMessage({error:e.message});}
