/* ============================================================
 * importer.js  —  装箱单模板解析 / 通用导入导出
 * 依赖：SheetJS (xlsx.full.min.js)
 * ============================================================ */
(function (global) {
  'use strict';

  var PALETTE = [
    '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
    '#1abc9c', '#e67e22', '#34495e', '#16a085', '#c0392b',
    '#2980b9', '#27ae60', '#d35400', '#8e44ad', '#7f8c8d',
    '#f1c40f', '#e84393', '#00b894', '#6c5ce7', '#fd79a8'
  ];
  function colorAt(i) { return PALETTE[i % PALETTE.length]; }

  function norm(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/[\s\u3000\r\n]+/g, '').toLowerCase();
  }
  function numOf(v) {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return v;
    var s = String(v).replace(/[^\d.\-]/g, '');
    var n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }

  /* ---------- 把 sheet 转成二维数组 ---------- */
  function sheetToGrid(ws) {
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true, blankrows: true });
  }

  /* ---------- 在前 N 行中定位列 ---------- */
  var FIELD_RULES = [
    { key: 'itemNo',   kw: ['itemno', '货号', '序号', 'no.'] },
    { key: 'name',     kw: ['description(chinese)', '品名', '中文品名', '货物名称', '名称', 'productname'] },
    { key: 'nameEn',   kw: ['description(english)', '英文品名', 'englishname'] },
    { key: 'ctnNo',    kw: ['ctnno.', 'ctnno', '箱号', 'cartonno'] },
    { key: 'ctnQty',   kw: ['packageqty.(ctn)', 'packageqty', '包装数量（箱）', '包装数量', '箱数', '件数', 'ctns'] },
    { key: 'pcsPerCtn',kw: ['qtypackedper(pcs/ctn)', '箱内数量（件）', '箱内数量'] },
    { key: 'totalPcs', kw: ['orderqty.(pcs)', 'orderqty', '货物总数（件）', '货物总数', '总件数'] },
    { key: 'cbmPerCtn',kw: ['measurement(cbm/ctn)', '每箱体积'] },
    { key: 'totalCbm', kw: ['measurement(totalcbm)', '合计方数', '总体积'] },
    { key: 'gwPerCtn', kw: ['grossweight', '毛重（kgs/ctn）', '毛重', '单箱毛重', '单件重量'] },
    { key: 'totalGw',  kw: ['totalgrossweight', '总毛重'] },
    { key: 'note',     kw: ['itemscontainedinctn', '箱内配件备注', '备注', 'remark'] }
  ];

  var STOP_KW = ['总数量', '总方数', '总重量', '包装方式', '备注：', 'total', '合计'];

  function locate(grid) {
    var map = {}, headerRow = -1, dimStart = -1, r, c, cell, i, k;
    var scan = Math.min(grid.length, 20);

    // 1) 找 L / W / H 三连行（尺寸子表头）
    for (r = 0; r < scan; r++) {
      var row = grid[r] || [];
      for (c = 0; c + 2 < row.length; c++) {
        if (norm(row[c]) === 'l' && norm(row[c + 1]) === 'w' && norm(row[c + 2]) === 'h') {
          dimStart = c; headerRow = Math.max(headerRow, r);
          break;
        }
      }
      if (dimStart >= 0) break;
    }

    // 2) 关键字匹配其余列
    for (r = 0; r < scan; r++) {
      var row2 = grid[r] || [];
      for (c = 0; c < row2.length; c++) {
        cell = norm(row2[c]);
        if (!cell) continue;
        for (i = 0; i < FIELD_RULES.length; i++) {
          var f = FIELD_RULES[i];
          if (map[f.key] !== undefined) continue;
          for (k = 0; k < f.kw.length; k++) {
            var kw = norm(f.kw[k]);
            if (cell === kw || (kw.length >= 3 && cell.indexOf(kw) >= 0)) {
              map[f.key] = c;
              if (r > headerRow) headerRow = r;
              break;
            }
          }
        }
      }
    }

    // 3) 尺寸列兜底：找「包装规格 / packingsize」所在列
    if (dimStart < 0) {
      for (r = 0; r < scan; r++) {
        var row3 = grid[r] || [];
        for (c = 0; c < row3.length; c++) {
          var s = norm(row3[c]);
          if (s.indexOf('packingsize') >= 0 || s.indexOf('包装规格') >= 0 || s.indexOf('外箱尺寸') >= 0) {
            dimStart = c; if (r > headerRow) headerRow = r;
          }
        }
      }
    }
    // 4) 独立 长/宽/高 列
    if (dimStart < 0) {
      var L = -1, W = -1, H = -1;
      for (r = 0; r < scan; r++) {
        var row4 = grid[r] || [];
        for (c = 0; c < row4.length; c++) {
          var t = norm(row4[c]);
          if (L < 0 && (t === '长' || t === '长度' || t === 'length' || t === 'l(mm)')) L = c;
          if (W < 0 && (t === '宽' || t === '宽度' || t === 'width'  || t === 'w(mm)')) W = c;
          if (H < 0 && (t === '高' || t === '高度' || t === 'height' || t === 'h(mm)')) H = c;
          if (L >= 0 && W >= 0 && H >= 0 && r > headerRow) headerRow = r;
        }
      }
      if (L >= 0 && W >= 0 && H >= 0) return { map: map, headerRow: headerRow, dims: [L, W, H] };
    }

    if (dimStart < 0) return null;
    return { map: map, headerRow: headerRow, dims: [dimStart, dimStart + 1, dimStart + 2] };
  }

  function isStopRow(row) {
    for (var c = 0; c < row.length; c++) {
      var s = String(row[c] === null || row[c] === undefined ? '' : row[c]);
      for (var i = 0; i < STOP_KW.length; i++) {
        if (s.indexOf(STOP_KW[i]) >= 0) return true;
      }
    }
    return false;
  }

  /* ---------- 主解析 ---------- */
  function parseWorkbook(wb, opts) {
    opts = opts || {};
    var unitScale = opts.unitScale || 1;   // 表格尺寸单位换算到 mm 的系数
    var result = { cargos: [], warnings: [], title: '', sheet: '' };

    for (var si = 0; si < wb.SheetNames.length; si++) {
      var name = wb.SheetNames[si];
      var grid = sheetToGrid(wb.Sheets[name]);
      var loc = locate(grid);
      if (!loc) continue;

      // 标题：表头之前最后一个非空短文本
      for (var t = loc.headerRow - 1; t >= 0; t--) {
        var rowT = grid[t] || [];
        var joined = rowT.filter(function (v) { return v !== null && v !== ''; }).join(' ').trim();
        if (joined && joined.length < 60 && joined.toLowerCase().indexOf('packing list') < 0) {
          result.title = joined; break;
        }
      }

      var m = loc.map, D = loc.dims, idx = 0;
      for (var r = loc.headerRow + 1; r < grid.length; r++) {
        var row = grid[r] || [];
        var nonEmpty = row.filter(function (v) { return v !== null && v !== ''; }).length;
        if (nonEmpty === 0) continue;
        if (isStopRow(row)) break;

        var nm = m.name !== undefined ? row[m.name] : null;
        var L = numOf(row[D[0]]) * unitScale;
        var W = numOf(row[D[1]]) * unitScale;
        var H = numOf(row[D[2]]) * unitScale;
        var qty = m.ctnQty !== undefined ? numOf(row[m.ctnQty]) : 0;
        var gw = m.gwPerCtn !== undefined ? numOf(row[m.gwPerCtn]) : 0;

        if (!nm && !L && !W && !H) continue;
        if (!nm) nm = '货物 ' + (idx + 1);
        if (!qty) qty = 1;

        // 只有总毛重没有单箱毛重时反推
        if (!gw && m.totalGw !== undefined) {
          var tg = numOf(row[m.totalGw]);
          if (tg && qty) gw = tg / qty;
        }

        var ctnNo = m.ctnNo !== undefined && row[m.ctnNo] !== null ? String(row[m.ctnNo]) : '';
        var cargo = {
          id: 'C' + (Date.now() % 100000) + '_' + idx,
          itemNo: m.itemNo !== undefined ? row[m.itemNo] : (idx + 1),
          name: String(nm).replace(/\r?\n/g, ' / ').trim(),
          nameEn: m.nameEn !== undefined && row[m.nameEn] ? String(row[m.nameEn]).trim() : '',
          ctnNo: ctnNo,
          l: Math.round(L), w: Math.round(W), h: Math.round(H),
          weight: Math.round(gw * 1000) / 1000,
          qty: Math.round(qty),
          pcsPerCtn: m.pcsPerCtn !== undefined ? numOf(row[m.pcsPerCtn]) : 1,
          stackable: true,
          maxLayers: 0,
          rotateMode: 'upright',
          color: colorAt(idx),
          note: m.note !== undefined && row[m.note] ? String(row[m.note]).replace(/\r?\n/g, ' ').trim() : '',
          pending: !(L > 0 && W > 0 && H > 0)
        };
        if (cargo.pending) {
          result.warnings.push('第 ' + (r + 1) + ' 行「' + cargo.name + '」缺少尺寸，需手动补填后才能参与装柜');
        }
        result.cargos.push(cargo);
        idx++;
      }

      if (result.cargos.length) { result.sheet = name; break; }
    }
    return result;
  }

  function parseArrayBuffer(ab, opts) {
    var wb = XLSX.read(new Uint8Array(ab), { type: 'array', cellDates: false });
    return parseWorkbook(wb, opts);
  }

  /* ---------- 导出：货物清单 ---------- */
  function exportCargoList(cargos, filename) {
    var rows = [[
      '序号', '货号', '品名', '英文品名', '箱号',
      '长(mm)', '宽(mm)', '高(mm)', '数量(箱)', '单箱毛重(kg)',
      '单箱体积(cbm)', '总体积(cbm)', '总重(kg)', '可堆叠', '摆放方向', '备注'
    ]];
    var RM = { free: '任意翻转', upright: '仅水平旋转', none: '固定朝向' };
    for (var i = 0; i < cargos.length; i++) {
      var c = cargos[i];
      var v = c.l * c.w * c.h / 1e9;
      rows.push([
        i + 1, c.itemNo || '', c.name, c.nameEn || '', c.ctnNo || '',
        c.l, c.w, c.h, c.qty, c.weight,
        +(v).toFixed(6), +(v * c.qty).toFixed(6), +(c.weight * c.qty).toFixed(3),
        c.stackable ? '是' : '否', RM[c.rotateMode] || c.rotateMode, c.note || ''
      ]);
    }
    var ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{wch:6},{wch:8},{wch:26},{wch:20},{wch:10},{wch:9},{wch:9},{wch:9},{wch:10},{wch:13},{wch:13},{wch:13},{wch:11},{wch:9},{wch:13},{wch:28}];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '货物清单');
    XLSX.writeFile(wb, filename || '货物清单.xlsx');
  }

  /* ---------- 导出：装柜方案明细 ---------- */
  function exportPlan(result, filename, planName) {
    var wb = XLSX.utils.book_new();

    // 汇总表
    var s = result.summary;
    var sum = [
      ['装柜方案汇总', ''],
      ['方案名称', planName || ''],
      ['生成时间', new Date().toLocaleString('zh-CN')],
      ['柜型', result.containers.length ? result.containers[0].spec.name : ''],
      ['所需柜数', s.containerCount],
      ['总件数(箱)', s.totalUnits],
      ['已装入(箱)', s.packedUnits],
      ['未装入(箱)', s.unpackedUnits],
      ['装载总体积(cbm)', +s.totalVolumeCbm.toFixed(4)],
      ['总毛重(kg)', +s.totalWeight.toFixed(2)],
      ['平均体积利用率', (s.avgVolumeRate * 100).toFixed(2) + '%'],
      [], ['分柜统计', ''],
      ['柜号', '装入件数', '装载体积(cbm)', '利用率', '重量(kg)', '载重率', '重心X(mm)', '重心Y(mm)', '重心Z(mm)', '重心评估']
    ];
    var LV = { ok: '良好', warn: '偏移偏大', danger: '严重偏移' };
    for (var i = 0; i < result.containers.length; i++) {
      var ct = result.containers[i], st = ct.stats;
      sum.push([
        '第 ' + ct.index + ' 柜', st.count, +st.volumeUsedCbm.toFixed(4),
        (st.volumeRate * 100).toFixed(2) + '%', +st.weight.toFixed(2),
        (st.weightRate * 100).toFixed(2) + '%',
        Math.round(st.cog.x), Math.round(st.cog.y), Math.round(st.cog.z), LV[st.cogLevel]
      ]);
    }
    var wsS = XLSX.utils.aoa_to_sheet(sum);
    wsS['!cols'] = [{wch:18},{wch:14},{wch:16},{wch:12},{wch:12},{wch:12},{wch:12},{wch:12},{wch:12},{wch:12}];
    XLSX.utils.book_append_sheet(wb, wsS, '汇总');

    // 每柜明细
    for (var c2 = 0; c2 < result.containers.length; c2++) {
      var ct2 = result.containers[c2];
      var rows = [['装柜顺序', '品名', '箱号', 'X(mm)', 'Y(mm)', 'Z(mm)', '摆放长(mm)', '摆放宽(mm)', '摆放高(mm)', '原始尺寸(L×W×H)', '重量(kg)', '层', '备注']];
      for (var k = 0; k < ct2.items.length; k++) {
        var it = ct2.items[k];
        rows.push([
          it.seq, it.name, it.ctnNo || '',
          Math.round(it.x), Math.round(it.y), Math.round(it.z),
          Math.round(it.dx), Math.round(it.dy), Math.round(it.dz),
          it.origin.join('×'), it.weight, it.layer, it.note || ''
        ]);
      }
      var ws2 = XLSX.utils.aoa_to_sheet(rows);
      ws2['!cols'] = [{wch:10},{wch:26},{wch:10},{wch:10},{wch:10},{wch:10},{wch:12},{wch:12},{wch:12},{wch:20},{wch:11},{wch:6},{wch:26}];
      XLSX.utils.book_append_sheet(wb, ws2, '第' + ct2.index + '柜明细');
    }

    // 未装入
    if (result.unpacked.length) {
      var ur = [['品名', '箱号', '长', '宽', '高', '重量(kg)', '原因']];
      for (var u = 0; u < result.unpacked.length; u++) {
        var un = result.unpacked[u];
        ur.push([un.name, un.ctnNo || '', un.l, un.w, un.h, un.weight, un._reason || '柜内空间不足']);
      }
      var wsU = XLSX.utils.aoa_to_sheet(ur);
      wsU['!cols'] = [{wch:26},{wch:10},{wch:9},{wch:9},{wch:9},{wch:11},{wch:24}];
      XLSX.utils.book_append_sheet(wb, wsU, '未装入货物');
    }

    XLSX.writeFile(wb, filename || '装柜方案.xlsx');
  }

  /* ---------- 模板文件下载 ---------- */
  function downloadTemplate() {
    var rows = [
      ['品名', '英文品名', '箱号', '长', '宽', '高', '包装数量（箱）', '毛重', '备注'],
      ['示例货物A', 'Sample A', '1', 1200, 800, 900, 4, 120, '可堆叠'],
      ['示例货物B', 'Sample B', '2', 600, 400, 500, 10, 25, '']
    ];
    var ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{wch:20},{wch:18},{wch:10},{wch:9},{wch:9},{wch:9},{wch:14},{wch:10},{wch:20}];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '装箱清单');
    XLSX.writeFile(wb, '装箱单导入模板.xlsx');
  }

  global.Importer = {
    parseArrayBuffer: parseArrayBuffer,
    parseWorkbook: parseWorkbook,
    exportCargoList: exportCargoList,
    exportPlan: exportPlan,
    downloadTemplate: downloadTemplate,
    colorAt: colorAt,
    PALETTE: PALETTE
  };
})(window);
