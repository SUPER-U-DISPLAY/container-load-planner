/* ============================================================
 * exporter.js  —  图片 / PDF 导出
 * 中文全部走 Canvas 绘制后嵌入 PDF，彻底规避 jsPDF 字体问题
 * ============================================================ */
(function (global) {
  'use strict';

  var FONT = '"Microsoft YaHei","PingFang SC",sans-serif';

  function fmt(n, d) { return (Math.round(n * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d); }
  function pct(n) { return (n * 100).toFixed(2) + '%'; }
  function nowStr() {
    var d = new Date(), p = function (v) { return v < 10 ? '0' + v : '' + v; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* ---------- 通用页画布 ---------- */
  function Page(w, h) {
    this.cv = document.createElement('canvas');
    this.cv.width = w; this.cv.height = h;
    this.g = this.cv.getContext('2d');
    this.g.fillStyle = '#ffffff';
    this.g.fillRect(0, 0, w, h);
    this.W = w; this.H = h;
  }
  Page.prototype.text = function (s, x, y, opt) {
    opt = opt || {};
    var g = this.g;
    g.save();
    g.font = (opt.bold ? 'bold ' : '') + (opt.size || 20) + 'px ' + FONT;
    g.fillStyle = opt.color || '#1f2a37';
    g.textAlign = opt.align || 'left';
    g.textBaseline = opt.baseline || 'middle';
    if (opt.maxWidth) {
      var t = s == null ? '' : String(s);
      while (g.measureText(t).width > opt.maxWidth && t.length > 1) t = t.slice(0, -1);
      if (t !== String(s == null ? '' : s)) t = t.slice(0, -1) + '…';
      g.fillText(t, x, y);
    } else {
      g.fillText(s == null ? '' : String(s), x, y);
    }
    g.restore();
  };
  Page.prototype.rect = function (x, y, w, h, fill, stroke, r) {
    var g = this.g;
    g.save();
    g.beginPath();
    if (r && g.roundRect) g.roundRect(x, y, w, h, r);
    else g.rect(x, y, w, h);
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.4; g.stroke(); }
    g.restore();
  };
  Page.prototype.line = function (x1, y1, x2, y2, c, w) {
    var g = this.g;
    g.save(); g.strokeStyle = c || '#dfe5ee'; g.lineWidth = w || 1.2;
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); g.restore();
  };
  Page.prototype.img = function (src, x, y, w, h) {
    // src: HTMLImageElement
    var g = this.g;
    var rw = src.width, rh = src.height;
    var s = Math.min(w / rw, h / rh);
    var dw = rw * s, dh = rh * s;
    g.drawImage(src, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  };
  Page.prototype.url = function () { return this.cv.toDataURL('image/jpeg', 0.92); };

  function loadImage(dataUrl) {
    return new Promise(function (res, rej) {
      var im = new Image();
      im.onload = function () { res(im); };
      im.onerror = rej;
      im.src = dataUrl;
    });
  }

  /* ---------- 页眉 / 页脚 ---------- */
  function header(pg, title, sub, pageNo) {
    pg.rect(0, 0, pg.W, 74, '#1b2736');
    pg.text(title, 40, 30, { size: 26, bold: true, color: '#ffffff' });
    pg.text(sub || '', 40, 56, { size: 15, color: '#9fb1c6' });
    pg.text('生成时间 ' + nowStr(), pg.W - 40, 30, { size: 14, color: '#9fb1c6', align: 'right' });
    if (pageNo) pg.text('第 ' + pageNo + ' 页', pg.W - 40, 56, { size: 14, color: '#9fb1c6', align: 'right' });
  }
  function footer(pg) {
    pg.line(40, pg.H - 42, pg.W - 40, pg.H - 42, '#e3e9f2');
    pg.text('集装箱装柜排柜模拟系统 · 本方案由算法自动生成，实际装柜请以现场为准', 40, pg.H - 24, { size: 13, color: '#95a3b6' });
  }

  /* ---------- 统计块 ---------- */
  function statBlock(pg, x, y, w, st, spec) {
    var LV = { ok: ['#12996b', '重心良好'], warn: ['#e08a00', '重心偏移偏大'], danger: ['#d93636', '重心严重偏移'] };
    var rows = [
      ['柜型规格', spec.name],
      ['内尺寸 (mm)', spec.L + ' × ' + spec.W + ' × ' + spec.H],
      ['装入件数', st.count + ' 箱'],
      ['装载体积', fmt(st.volumeUsedCbm, 3) + ' cbm / ' + fmt(st.volumeTotalCbm, 3) + ' cbm'],
      ['体积利用率', pct(st.volumeRate)],
      ['装载重量', fmt(st.weight, 2) + ' kg / ' + spec.maxWeight + ' kg'],
      ['载重利用率', pct(st.weightRate) + (st.overweight ? '  ⚠超载' : '')],
      ['剩余空间', fmt(st.freeCbm, 3) + ' cbm'],
      ['占用长度', Math.round(st.usedLength) + ' mm'],
      ['占用高度', Math.round(st.usedHeight) + ' mm'],
      ['重心坐标', 'X ' + Math.round(st.cog.x) + ' / Y ' + Math.round(st.cog.y) + ' / Z ' + Math.round(st.cog.z) + ' mm'],
      ['重心评估', LV[st.cogLevel][1] + '（纵向偏移 ' + (st.cogDevX * 100).toFixed(1) + '%）']
    ];
    var rh = 30;
    pg.rect(x, y, w, rows.length * rh + 12, '#f7f9fc', '#e3e9f2', 8);
    for (var i = 0; i < rows.length; i++) {
      var yy = y + 6 + rh * i + rh / 2;
      pg.text(rows[i][0], x + 14, yy, { size: 15, color: '#5b6b7f' });
      var col = '#1f2a37';
      if (rows[i][0] === '重心评估') col = LV[st.cogLevel][0];
      if (rows[i][0] === '载重利用率' && st.overweight) col = '#d93636';
      if (rows[i][0] === '体积利用率') col = '#1f6feb';
      pg.text(rows[i][1], x + w - 14, yy, { size: 15, bold: true, color: col, align: 'right', maxWidth: w - 170 });
      if (i < rows.length - 1) pg.line(x + 12, y + 6 + rh * (i + 1), x + w - 12, y + 6 + rh * (i + 1), '#edf1f7');
    }
    return y + rows.length * rh + 12;
  }

  /* ---------- 明细表 ---------- */
  function table(pg, x, y, w, cols, rows, maxRows) {
    var rh = 28, hh = 32;
    var total = 0, i, j;
    for (i = 0; i < cols.length; i++) total += cols[i].w;
    var k = w / total;

    pg.rect(x, y, w, hh, '#eaf0f9', '#d7e0ec', 6);
    var cx = x;
    for (i = 0; i < cols.length; i++) {
      var cw = cols[i].w * k;
      pg.text(cols[i].t, cols[i].a === 'r' ? cx + cw - 8 : cx + 8, y + hh / 2,
        { size: 14, bold: true, color: '#37475c', align: cols[i].a === 'r' ? 'right' : 'left', maxWidth: cw - 12 });
      cx += cw;
    }
    var yy = y + hh;
    var n = Math.min(rows.length, maxRows || rows.length);
    for (i = 0; i < n; i++) {
      if (i % 2 === 1) pg.rect(x, yy, w, rh, '#fafbfd');
      cx = x;
      for (j = 0; j < cols.length; j++) {
        var cw2 = cols[j].w * k;
        var v = rows[i][j];
        if (j === 0 && cols[j].color) {
          pg.rect(cx + 7, yy + rh / 2 - 6, 12, 12, rows[i].__color || '#3498db', '#00000022', 3);
          pg.text(v, cx + 25, yy + rh / 2, { size: 13.5, maxWidth: cw2 - 32 });
        } else {
          pg.text(v, cols[j].a === 'r' ? cx + cw2 - 8 : cx + 8, yy + rh / 2,
            { size: 13.5, color: '#2b3949', align: cols[j].a === 'r' ? 'right' : 'left', maxWidth: cw2 - 12 });
        }
        cx += cw2;
      }
      pg.line(x, yy + rh, x + w, yy + rh, '#eef2f7');
      yy += rh;
    }
    pg.rect(x, y, w, yy - y, null, '#d7e0ec', 6);
    return { endY: yy, drawn: n };
  }

  /* ---------- 导出 PNG（含统计浮层） ---------- */
  function exportPng(viewerCanvas, info, filename) {
    var W = viewerCanvas.width, H = viewerCanvas.height;
    var pad = 0;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H + 90;
    var g = cv.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, cv.width, cv.height);
    // 顶栏
    g.fillStyle = '#1b2736'; g.fillRect(0, 0, cv.width, 52);
    g.font = 'bold 22px ' + FONT; g.fillStyle = '#fff'; g.textBaseline = 'middle';
    g.fillText(info.title || '装柜方案', 20, 26);
    g.font = '15px ' + FONT; g.fillStyle = '#9fb1c6'; g.textAlign = 'right';
    g.fillText(nowStr(), cv.width - 20, 26);
    g.textAlign = 'left';
    // 3D
    g.drawImage(viewerCanvas, pad, 52, W, H);
    // 底栏统计
    g.fillStyle = '#f5f8fc'; g.fillRect(0, H + 52, cv.width, 38);
    g.strokeStyle = '#e0e7f0'; g.beginPath(); g.moveTo(0, H + 52); g.lineTo(cv.width, H + 52); g.stroke();
    g.font = '15px ' + FONT; g.fillStyle = '#37475c';
    g.fillText(info.line || '', 20, H + 52 + 19);
    var a = document.createElement('a');
    a.download = filename || '装柜方案.png';
    a.href = cv.toDataURL('image/png');
    a.click();
  }

  /* ---------- 导出 PDF ---------- */
  // ctx = { title, result, shots:{ '1': dataUrl, ... }, cargos }
  function exportPdf(ctx, filename) {
    var jsPDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    var doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    var PW = 297, PH = 210;
    var SW = 1754, SH = 1240;          // 画布像素（约 150dpi）
    var pageNo = 0, first = true;

    var res = ctx.result, sum = res.summary;
    var chain = Promise.resolve();
    var pages = [];

    /* ---- 封面 / 总览页 ---- */
    chain = chain.then(function () {
      var pg = new Page(SW, SH);
      pageNo++;
      header(pg, ctx.title || '集装箱装柜方案', '装柜排柜模拟报告 · Load Plan Report', pageNo);

      // 大数字卡
      var cards = [
        ['所需柜数', sum.containerCount + ' 个', '#1f6feb'],
        ['总件数', sum.totalUnits + ' 箱', '#37475c'],
        ['已装入', sum.packedUnits + ' 箱', '#12996b'],
        ['未装入', sum.unpackedUnits + ' 箱', sum.unpackedUnits ? '#d93636' : '#12996b'],
        ['总体积', fmt(sum.totalVolumeCbm, 3) + ' cbm', '#37475c'],
        ['总毛重', fmt(sum.totalWeight, 1) + ' kg', '#37475c'],
        ['平均利用率', pct(sum.avgVolumeRate), '#1f6feb']
      ];
      var cw = (SW - 80 - 6 * 14) / 7, cx = 40, cy = 110;
      for (var i = 0; i < cards.length; i++) {
        pg.rect(cx, cy, cw, 96, '#f7f9fc', '#e3e9f2', 10);
        pg.text(cards[i][0], cx + cw / 2, cy + 28, { size: 15, color: '#7b8ba0', align: 'center' });
        pg.text(cards[i][1], cx + cw / 2, cy + 64, { size: 26, bold: true, color: cards[i][2], align: 'center' });
        cx += cw + 14;
      }

      // 分柜统计表
      var cols = [
        { t: '柜号', w: 90 }, { t: '柜型', w: 190 }, { t: '装入件数', w: 100, a: 'r' },
        { t: '装载体积(cbm)', w: 140, a: 'r' }, { t: '体积利用率', w: 120, a: 'r' },
        { t: '重量(kg)', w: 120, a: 'r' }, { t: '载重率', w: 100, a: 'r' },
        { t: '重心 X/Y/Z (mm)', w: 200, a: 'r' }, { t: '重心评估', w: 130 }
      ];
      var LVT = { ok: '良好', warn: '偏移偏大', danger: '严重偏移' };
      var rows = [];
      for (var c = 0; c < res.containers.length; c++) {
        var ct = res.containers[c], st = ct.stats;
        rows.push([
          '第 ' + ct.index + ' 柜', ct.spec.name, st.count + '',
          fmt(st.volumeUsedCbm, 3), pct(st.volumeRate), fmt(st.weight, 1),
          pct(st.weightRate),
          Math.round(st.cog.x) + ' / ' + Math.round(st.cog.y) + ' / ' + Math.round(st.cog.z),
          LVT[st.cogLevel]
        ]);
      }
      pg.text('分柜统计', 40, 244, { size: 19, bold: true });
      var t1 = table(pg, 40, 260, SW - 80, cols, rows, 14);

      // 未装入
      var yy = t1.endY + 30;
      if (res.unpacked.length) {
        pg.text('未装入货物（' + res.unpacked.length + ' 箱）', 40, yy, { size: 19, bold: true, color: '#d93636' });
        var uc = [{ t: '品名', w: 320 }, { t: '箱号', w: 100 }, { t: '尺寸 L×W×H (mm)', w: 240 }, { t: '重量(kg)', w: 110, a: 'r' }, { t: '原因', w: 300 }];
        var ur = [];
        for (var u = 0; u < res.unpacked.length && u < 10; u++) {
          var un = res.unpacked[u];
          ur.push([un.name, un.ctnNo || '-', un.l + '×' + un.w + '×' + un.h, fmt(un.weight, 2), un._reason || '柜内空间不足']);
        }
        table(pg, 40, yy + 16, SW - 80, uc, ur, 10);
      } else {
        pg.rect(40, yy, 420, 46, '#e6f8f0', '#b8e8d3', 8);
        pg.text('✓ 全部货物已成功装入', 60, yy + 23, { size: 17, bold: true, color: '#12996b' });
      }
      footer(pg);
      pages.push(pg.url());
    });

    /* ---- 每柜一页 ---- */
    res.containers.forEach(function (ct) {
      chain = chain.then(function () {
        var shot = ctx.shots[ct.index];
        return shot ? loadImage(shot) : null;
      }).then(function (im) {
        var pg = new Page(SW, SH);
        pageNo++;
        header(pg, '第 ' + ct.index + ' 柜 装柜示意', (ctx.title || '') + ' · ' + ct.spec.name + ' · 排序策略：' + (ct.strategy || '-'), pageNo);

        var imgW = SW - 40 - 40 - 470 - 24;
        pg.rect(40, 100, imgW, 640, '#f2f5f9', '#e3e9f2', 10);
        if (im) pg.img(im, 46, 106, imgW - 12, 628);
        else pg.text('（无 3D 快照）', 40 + imgW / 2, 420, { size: 18, color: '#98a6b8', align: 'center' });

        statBlock(pg, 40 + imgW + 24, 100, 470, ct.stats, ct.spec);

        // 明细
        pg.text('装柜明细（' + ct.items.length + ' 箱）', 40, 772, { size: 19, bold: true });
        var cols = [
          { t: '顺序', w: 70, a: 'r' }, { t: '品名', w: 300, color: true }, { t: '箱号', w: 90 },
          { t: 'X', w: 80, a: 'r' }, { t: 'Y', w: 80, a: 'r' }, { t: 'Z', w: 80, a: 'r' },
          { t: '摆放长', w: 90, a: 'r' }, { t: '摆放宽', w: 90, a: 'r' }, { t: '摆放高', w: 90, a: 'r' },
          { t: '重量kg', w: 90, a: 'r' }, { t: '层', w: 55, a: 'r' }, { t: '备注', w: 260 }
        ];
        var rows = [];
        for (var i = 0; i < ct.items.length; i++) {
          var it = ct.items[i];
          var r = [it.seq + '', it.name, it.ctnNo || '-',
            Math.round(it.x) + '', Math.round(it.y) + '', Math.round(it.z) + '',
            Math.round(it.dx) + '', Math.round(it.dy) + '', Math.round(it.dz) + '',
            fmt(it.weight, 2), it.layer + '', it.note || ''];
          r.__color = it.color;
          rows.push(r);
        }
        var t = table(pg, 40, 790, SW - 80, cols, rows, 13);
        if (rows.length > t.drawn) {
          pg.text('… 其余 ' + (rows.length - t.drawn) + ' 条见续页 / Excel 明细表', 40, t.endY + 18, { size: 13.5, color: '#8a99ab' });
        }
        footer(pg);
        pages.push(pg.url());

        // 续页
        var rest = rows.slice(t.drawn);
        while (rest.length) {
          var pg2 = new Page(SW, SH);
          pageNo++;
          header(pg2, '第 ' + ct.index + ' 柜 装柜明细（续）', ctx.title || '', pageNo);
          var t2 = table(pg2, 40, 104, SW - 80, cols, rest, 36);
          rest = rest.slice(t2.drawn);
          footer(pg2);
          pages.push(pg2.url());
        }
      });
    });

    return chain.then(function () {
      for (var i = 0; i < pages.length; i++) {
        if (i > 0) doc.addPage('a4', 'landscape');
        doc.addImage(pages[i], 'JPEG', 0, 0, PW, PH, undefined, 'FAST');
      }
      doc.save(filename || '装柜方案.pdf');
    });
  }

  global.Exporter = { exportPng: exportPng, exportPdf: exportPdf };
})(window);
