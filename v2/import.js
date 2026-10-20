(function(root){
  'use strict';
  const norm=v=>String(v??'').replace(/[\s\r\n（）()_.：:]/g,'').toLowerCase();
  const numeric=v=>v===null||v===undefined||String(v).trim()===''?null:Number(String(v).replace(/,/g,'').trim());
  const fields={name:['品名','中文品名','货物名称','名称','descriptionchinese','productname','name'],nameEn:['英文品名','descriptionenglish'],ctnNo:['箱号','ctnno','cartonno'],qty:['数量箱','箱数','数量','件数','包装数量箱','包装数量','packageqtyctn','packageqty','ctns','qty','quantity'],weight:['单箱毛重kg','重量','重量kg','单箱重量kg','单箱重量','单箱毛重','毛重kgs/ctn','毛重','grossweightkgs/ctn','grossweight','weightkg','weight'],totalWeight:['总毛重','totalgrossweight'],l:['长','长度','长mm','长度mm','length','lengthmm','l','lmm'],w:['宽','宽度','宽mm','宽度mm','width','widthmm','w','wmm'],h:['高','高度','高mm','高度mm','height','heightmm','h','hmm'],rotateMode:['摆放方向','旋转方式','rotatemode'],stackable:['允许承叠','可堆叠','stackable'],maxLayers:['最大层数','maxlayers'],topLoad:['上压重量kg','上压重量','允许上压重量','topload'],note:['备注','remark','note','箱内配件备注','itemscontainedinctn']};
  function locate(grid){
    const map={};let header=-1;
    for(let r=0;r<Math.min(grid.length,25);r++){
      const row=grid[r]||[];
      for(let c=0;c<row.length;c++){
        const n=norm(row[c]);
        for(const [k,keys] of Object.entries(fields))if(map[k]===undefined&&keys.includes(n)){map[k]=c;header=Math.max(header,r);}
      }
      if(map.l!==undefined&&map.w!==undefined&&map.h!==undefined)return {map,header};
    }return null;
  }
  function parseGrid(grid,sheet='Sheet1',scale=1){
    const loc=locate(grid),rows=[],warnings=[];
    if(!loc)return {sheet,rows,warnings:['未找到长、宽、高表头，未导入此工作表']};
    const {map,header}=loc,get=(r,k)=>map[k]===undefined?null:r[map[k]];
    for(let i=header+1;i<grid.length;i++){
      const row=grid[i]||[];if(!row.some(v=>String(v??'').trim()))continue;
      const rawName=String(get(row,'name')??get(row,'nameEn')??'').trim();
      if(/^(合计|总计|总数量|总方数|总重量|total\b|grand total\b)/i.test(rawName))continue;
      const dims=['l','w','h'].map(k=>numeric(get(row,k)));
      if(!rawName&&dims.every(n=>n===null||!Number.isFinite(n)))continue;
      const name=rawName||'待确认品名 · '+sheet+' 第 '+(i+1)+' 行';
      const rawQty=numeric(get(row,'qty')),qty=rawQty===null?1:rawQty;
      const rowWarnings=[];
      if(!rawName)rowWarnings.push('品名为空');
      if(rawQty===null)rowWarnings.push('箱数为空，暂按 1 箱，请核对');
      if(!Number.isInteger(qty)||qty<1||qty>2000){warnings.push('第 '+(i+1)+' 行箱数无效，请在原表修正后导入');rows.push({invalid:true,name,source:sheet+'!'+(i+1),rawQty,reason:'箱数必须为 1–2000 的整数'});continue;}
      let weight=numeric(get(row,'weight'));
      if(!(weight>0)){const total=numeric(get(row,'totalWeight'));weight=total>0?total/qty:null;}
      const v=['l','w','h'].map((k,j)=>dims[j]>0?Math.round(dims[j]*scale):0);
      if(v.some(n=>!n))rowWarnings.push('缺尺寸，保留为待补全货物');
      const rot=String(get(row,'rotateMode')??'').trim(),sk=String(get(row,'stackable')??'').trim();
      const cargo={id:'imp-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),name,nameEn:String(get(row,'nameEn')??''),pcsPerCtn:1,ctnNo:String(get(row,'ctnNo')??''),l:v[0],w:v[1],h:v[2],qty,weight,rotateMode:['free','自由','任意','任意翻转'].includes(rot)?'free':['none','固定','不可旋转'].includes(rot)?'none':'upright',stackable:!['false','否','不允许','不可堆叠','0'].includes(sk),maxLayers:Math.max(0,Math.floor(numeric(get(row,'maxLayers'))||0)),topLoad:numeric(get(row,'topLoad')),note:String(get(row,'note')??''),source:sheet+'!'+(i+1),color:PlannerCore.COLORS[rows.length%PlannerCore.COLORS.length]};
      rows.push({cargo,warnings:rowWarnings,source:cargo.source});warnings.push(...rowWarnings.map(w=>'第 '+(i+1)+' 行：'+w));
    }return {sheet,rows,warnings};
  }
  function workbook(wb,scale=1){return wb.SheetNames.map(name=>parseGrid(XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,defval:null,raw:true,blankrows:true}),name,scale));}
  const api={parseGrid,workbook};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.PlannerImport=api;
})(typeof window!=='undefined'?window:globalThis);
