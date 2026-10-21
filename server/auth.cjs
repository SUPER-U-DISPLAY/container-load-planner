'use strict';
const crypto=require('node:crypto');
function error(status,message){return Object.assign(Error(message),{status});}
function equal(a,b){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y);}
function identity(value){
 if(!value||typeof value.id!=='string'||!value.id||value.active===false)throw error(401,'ERP 身份无效或账号已停用');
 return {id:value.id,name:String(value.name||value.id),roles:Array.isArray(value.roles)?value.roles.filter(v=>['viewer','planner','policy_manager','admin'].includes(v)):['viewer'],projectIds:Array.isArray(value.projectIds)?value.projectIds.map(String):[],allProjects:value.allProjects===true};
}
function authenticator(env=process.env){
 const mode=env.PLANNER_AUTH_MODE||'erp';
 if(mode==='erp'&&!env.ERP_AUTH_URL)throw Error('ERP 模式须配置 ERP_AUTH_URL；本地测试请显式启用 development 模式');
 if(mode==='development'&&!env.PLANNER_DEV_TOKEN)throw Error('本地测试须配置 PLANNER_DEV_TOKEN');
 if(!['erp','development'].includes(mode))throw Error('不支持的认证模式');
 const cache=new Map();
 return async req=>{
  const match=/^Bearer ([^\s]+)$/.exec(req.headers.authorization||'');if(!match)throw error(401,'请连接 ERP 登录凭证');const token=match[1];
  if(mode==='development'){
   if(!equal(token,env.PLANNER_DEV_TOKEN))throw error(401,'测试凭证不正确');
   return identity({id:'local-admin',name:'本地测试负责人',roles:['planner','policy_manager','admin'],allProjects:true});
  }
  const k=crypto.createHash('sha256').update(token).digest('hex'),hit=cache.get(k);if(hit&&hit.expires>Date.now())return hit.value;
  let response;try{response=await fetch(env.ERP_AUTH_URL,{headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(5000),redirect:'error'});}catch{throw error(503,'ERP 身份服务暂时不可用');}
  if(!response.ok)throw error(response.status===403?403:401,'ERP 身份验证未通过');
  const user=identity(await response.json());if(cache.size>2000)cache.clear();cache.set(k,{expires:Date.now()+5000,value:user});return user;
 };
}
const manager=user=>user.roles.includes('admin')||user.roles.includes('policy_manager');
const editor=user=>manager(user)||user.roles.includes('planner');
function canAccess(user,project){if(user.roles.includes('admin'))return true;if(project.project?.context?.erpProjectId)return user.allProjects||user.projectIds.includes(String(project.project.context.erpProjectId));return project._ownerId===user.id;}
module.exports={authenticator,identity,manager,editor,canAccess,error};
