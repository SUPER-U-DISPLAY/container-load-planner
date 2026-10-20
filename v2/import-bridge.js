/* Keep the original import controls; fix independent dimension columns and preserve all sheets/rows. */
(function(root){
 'use strict';
 const I=typeof module==='object'?require('./import.js'):root.PlannerImport;
 function parse(ab,scale=1){
  const wb=root.XLSX.read(new Uint8Array(ab),{type:'array',cellDates:false}),result={cargos:[],warnings:[],title:'',sheet:''};
  for(const name of wb.SheetNames){const grid=root.XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,defval:null,raw:true,blankrows:true}),parsed=I.parseGrid(grid,name,scale);
   if(parsed.rows.length){const bad=parsed.rows.find(r=>r.invalid);if(bad)throw Error(bad.source+'：'+bad.reason+'，请修正箱数后导入');result.cargos.push(...parsed.rows.map(r=>({...r.cargo,pending:![r.cargo.l,r.cargo.w,r.cargo.h].every(n=>n>0)})));result.warnings.push(...parsed.warnings.map(w=>name+' · '+w));result.sheet+= (result.sheet?'、':'')+name;}
   else {const fallback=root.Importer.parseWorkbook({SheetNames:[name],Sheets:{[name]:wb.Sheets[name]}},{unitScale:scale});if(fallback.cargos.length){result.cargos.push(...fallback.cargos.map((c,i)=>({...c,id:'legacy-'+Date.now().toString(36)+'-'+result.cargos.length+'-'+i})));result.warnings.push(...fallback.warnings);result.sheet+=(result.sheet?'、':'')+name;if(fallback.title)result.title=fallback.title;}}
  }
  root.PlannerCore.expand(result.cargos);return result;
 }
 const api={parse};if(typeof module==='object')module.exports=api;else root.PlannerImportBridge=api;
})(typeof window!=='undefined'?window:globalThis);
