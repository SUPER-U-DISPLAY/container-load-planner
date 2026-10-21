'use strict';
const {Worker}=require('node:worker_threads'),path=require('node:path');
function execute(data,{timeoutMs=60000,memoryMb=256,onProgress=()=>{},onWorker=()=>{},signal}={}){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(Error('计算已取消'));return;}
  const worker=new Worker(path.join(__dirname,'compute.cjs'),{workerData:data,resourceLimits:{maxOldGenerationSizeMb:memoryMb},env:{}});onWorker(worker);let done=false;
  const timer=setTimeout(()=>finish(Error('计算超时，请分批或减少候选规模')),timeoutMs);
  const abort=()=>finish(Error('计算已取消'));signal?.addEventListener('abort',abort,{once:true});
  function finish(err,result){if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.terminate();if(err)reject(err);else resolve(result);}
  worker.on('message',msg=>{if(msg.progress)onProgress(msg.progress);else if(msg.error)finish(Error(msg.error));else if(Object.hasOwn(msg,'result'))finish(null,msg.result);});
  worker.on('error',e=>finish(e));worker.on('exit',code=>{if(!done)finish(Error('计算进程已退出（'+code+'）'));});
 });
}
let active=0;const waiting=[];
function pump(){if(active||!waiting.length)return;const task=waiting.shift();task.options.signal?.removeEventListener('abort',task.abort);active++;execute(task.data,task.options).then(task.resolve,task.reject).finally(()=>{active--;pump();});}
function compute(data,options={}){if(options.signal?.aborted)return Promise.reject(Error('计算已取消'));if(waiting.length>=8)return Promise.reject(Error('计算请求较多，请稍后重试'));return new Promise((resolve,reject)=>{const task={data,options,resolve,reject};task.abort=()=>{const i=waiting.indexOf(task);if(i>=0){waiting.splice(i,1);reject(Error('计算已取消'));}};options.signal?.addEventListener('abort',task.abort,{once:true});waiting.push(task);pump();});}
module.exports={compute};
