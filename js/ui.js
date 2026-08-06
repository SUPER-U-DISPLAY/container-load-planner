/* ============================================================
 * ui.js  —  主控制器
 * ============================================================ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var LS_KEY = 'container_load_planner_v1';

  var S = {
    title: '未命名装柜方案',
    cargos: [],
    spec: null,
    result: null,
    cur: 0,          // 当前柜索引
    playing: false,
    timer: null,
    filter: null
  };

  var viewer = null;

  /* ================= 工具 ================= */
  function toast(msg, type) {
    var d = document.createElement('div');
    d.className = 'toast-item' + (type ? ' ' + type : '');
    d.textContent = msg;
    $('toast').appendChild(d);
    setTimeout(function () {
      d.style.transition = '.3s'; d.style.opacity = 0; d.style.transform = 'translateY(-8px)';
      setTimeout(function () { d.remove(); }, 320);
    }, 2400);
  }
  function loading(on, text) {
    $('loadText').textContent = text || '正在计算…';
    $('loading').classList.toggle('on', !!on);
  }
  function fmt(n, d) { if (!isFinite(n)) n = 0; return (Math.round(n * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d); }
  function pct(n) { return (n * 100).toFixed(1) + '%'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function uid() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function modal(title, html, buttons) {
    var mask = document.createElement('div');
    mask.className = 'modal-mask';
    var btns = (buttons || [{ t: '关闭' }]).map(function (b, i) {
      return '<button class="btn ' + (b.cls || '') + '" data-i="' + i + '">' + esc(b.t) + '</button>';
    }).join('');
    mask.innerHTML = '<div class="modal"><h3>' + esc(title) + '</h3><div class="mbody">' + html + '</div><div class="mfoot">' + btns + '</div></div>';
    $('modalHost').appendChild(mask);
    function close() { mask.remove(); }
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
    mask.querySelectorAll('.mfoot .btn').forEach(function (b) {
      b.addEventListener('click', function () {
        var cfg = (buttons || [{}])[+b.dataset.i];
        if (cfg && cfg.fn) { if (cfg.fn(mask) === false) return; }
        close();
      });
    });
    return { el: mask, close: close };
  }

  /* ================= 集装箱 ================= */
  function initContainerSelect() {
    var sel = $('selContainer');
    var html = ContainerLib.PRESETS.map(function (p) {
      return '<option value="' + p.id + '">' + p.name + '　' + p.L + '×' + p.W + '×' + p.H + 'mm　' + p.maxWeight + 'kg</option>';
    }).join('');
    html += '<option value="__custom">自定义尺寸…</option>';
    sel.innerHTML = html;
    sel.value = '40HQ';
    applySpecFromSelect();
    sel.addEventListener('change', applySpecFromSelect);
    ['inCtnL', 'inCtnW', 'inCtnH', 'inCtnMax'].forEach(function (id) {
      $(id).addEventListener('input', function () {
        S.spec = {
          id: 'CUSTOM', name: '自定义柜型',
          L: +$('inCtnL').value || 1, W: +$('inCtnW').value || 1,
          H: +$('inCtnH').value || 1, maxWeight: +$('inCtnMax').value || 1
        };
        $('selContainer').value = '__custom';
        updCtnVolLab();
        save();
      });
    });
  }
  function applySpecFromSelect() {
    var v = $('selContainer').value;
    if (v === '__custom') {
      S.spec = { id: 'CUSTOM', name: '自定义柜型', L: +$('inCtnL').value || 12000, W: +$('inCtnW').value || 2350, H: +$('inCtnH').value || 2690, maxWeight: +$('inCtnMax').value || 26000 };
    } else {
      S.spec = ContainerLib.byId(v);
    }
    $('inCtnL').value = S.spec.L; $('inCtnW').value = S.spec.W;
    $('inCtnH').value = S.spec.H; $('inCtnMax').value = S.spec.maxWeight;
    updCtnVolLab(); save();
  }
  function updCtnVolLab() {
    $('ctnVolLab').textContent = '容积 ' + fmt(ContainerLib.volumeCbm(S.spec), 2) + ' cbm';
  }

  /* ================= 货物表 ================= */
  var ROT_LABEL = { free: '任意', upright: '水平', none: '固定' };

  // 等轴测 mini 立方体：高亮贴柜底那一面（底面=长×宽为默认；自由模式标自动）
  function boxSVG(c) {
    if (c.pending || !(c.l > 0 && c.w > 0 && c.h > 0)) return '<div class="foot-empty">?</div>';
    var bx, by, bz, tag, sub, col = c.color || '#3a7bd5';
    if (c._placedDim) {                       // 算完后：按实际摆放维度画
      bx = c._placedDim.dx; by = c._placedDim.dy; bz = c._placedDim.dz;
      tag = '实摆'; sub = Math.round(bx) + '×' + Math.round(by);
    } else if (c.rotateMode === 'free') {     // 任意：录入时未知朝向
      bx = c.l; by = c.w; bz = c.h; tag = '自动'; sub = '算后定';
    } else {                                  // 水平/固定：底面恒为长×宽（平躺）
      bx = c.l; by = c.w; bz = c.h;
      tag = (c.rotateMode === 'none') ? '固定' : '平卧';
      sub = Math.round(c.l) + '×' + Math.round(c.w);
    }
    var a = 0.866, b = 0.5;
    var O = [0, 0], A = [a * bx, -b * bx], Bm = [-a * by, -b * by], Cm = [a * (bx - by), -b * (bx + by)];
    var O2 = [0, -bz], A2 = [a * bx, -b * bx - bz], B2 = [-a * by, -b * by - bz], C2 = [a * (bx - by), -b * (bx + by) - bz];
    var pts = [O, A, Bm, Cm, O2, A2, B2, C2];
    var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
    var minx = Math.min.apply(null, xs), maxx = Math.max.apply(null, xs);
    var miny = Math.min.apply(null, ys), maxy = Math.max.apply(null, ys);
    var W = 44, H = 48, pad = 3, s = Math.min((W - 2 * pad) / (maxx - minx || 1), (H - 2 * pad) / (maxy - miny || 1));
    function P(p) { return [(p[0] - minx) * s + pad, (p[1] - miny) * s + pad]; }
    function poly(arr) { return arr.map(function (p) { var q = P(p); return q[0].toFixed(1) + ',' + q[1].toFixed(1); }).join(' '); }
    var svg = '<svg class="foot-mini" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" aria-hidden="true">';
    svg += '<polygon points="' + poly([O, A, Cm, Bm]) + '" fill="' + col + '" stroke="' + col + '" stroke-width="1" stroke-linejoin="round"/>';
    svg += '<polygon points="' + poly([O, Bm, B2, O2]) + '" fill="' + col + '33" stroke="' + col + '" stroke-width="0.8" stroke-linejoin="round"/>';
    svg += '<polygon points="' + poly([O, A, A2, O2]) + '" fill="' + col + '55" stroke="' + col + '" stroke-width="0.8" stroke-linejoin="round"/>';
    svg += '<polygon points="' + poly([O2, A2, C2, B2]) + '" fill="#ffffff" stroke="' + col + '" stroke-width="0.8" stroke-linejoin="round" opacity="0.85"/>';
    svg += '</svg><span class="foot-tag">' + tag + '</span><span class="foot-sub">' + sub + '</span>';
    return svg;
  }

  function renderCargoTable() {
    var tb = $('cargoBody'), html = '', totQty = 0;
    S.cargos.forEach(function (c, i) {
      totQty += (+c.qty || 0);
      html += '<tr data-i="' + i + '"' + (c.pending ? ' class="pending"' : '') + '>' +
        '<td><span class="swatch" data-act="color" style="background:' + esc(c.color) + '"></span></td>' +
        '<td><span class="cargo-name" title="' + esc(c.name) + (c.note ? ' | ' + esc(c.note) : '') + '">' + esc(c.name) + '</span>' +
          '<span class="cargo-sub">' + (c.ctnNo ? '箱号 ' + esc(c.ctnNo) : '') + (c.pending ? ' <b style="color:#e08a00">缺尺寸</b>' : '') + '</span></td>' +
        '<td><div style="display:flex;gap:1px">' +
          '<input class="mini-input" data-f="l" value="' + c.l + '">' +
          '<input class="mini-input" data-f="w" value="' + c.w + '">' +
          '<input class="mini-input" data-f="h" value="' + c.h + '"></div></td>' +
        '<td class="num"><input class="mini-input" data-f="qty" value="' + c.qty + '"></td>' +
        '<td class="num"><input class="mini-input" data-f="weight" value="' + c.weight + '"></td>' +
        '<td style="text-align:center"><input type="checkbox" data-f="stackable"' + (c.stackable ? ' checked' : '') + ' style="accent-color:var(--brand);cursor:pointer"></td>' +
        '<td><select data-f="rotateMode" style="padding:1px 2px;font-size:11.5px">' +
          ['upright', 'free', 'none'].map(function (k) { return '<option value="' + k + '"' + (c.rotateMode === k ? ' selected' : '') + '>' + ROT_LABEL[k] + '</option>'; }).join('') +
          '</select></td>' +
        '<td class="foot-td" title="姿态示意：高亮面 = 贴柜底（底面）">' + boxSVG(c) + '</td>' +
        '<td style="text-align:center"><button class="btn xs danger" data-act="del">×</button></td>' +
        '</tr>';
    });
    tb.innerHTML = html;
    $('cargoEmpty').style.display = S.cargos.length ? 'none' : '';
    $('cargoCount').textContent = S.cargos.length;
    $('cargoQty').textContent = totQty;
  }

  function bindCargoTable() {
    var tb = $('cargoBody');
    tb.addEventListener('change', function (e) {
      var tr = e.target.closest('tr'); if (!tr) return;
      var c = S.cargos[+tr.dataset.i]; if (!c) return;
      var f = e.target.dataset.f;
      if (!f) return;
      delete c._placedDim;   // 录入改动后旧摆放结果失效，小盒回到三档显示
      if (f === 'stackable') c.stackable = e.target.checked;
      else if (f === 'rotateMode') c.rotateMode = e.target.value;
      else {
        var v = parseFloat(e.target.value) || 0;
        c[f] = (f === 'qty') ? Math.max(0, Math.round(v)) : v;
        e.target.value = c[f];
        c.pending = !(c.l > 0 && c.w > 0 && c.h > 0);
      }
      renderCargoTable(); save();
    });
    tb.addEventListener('click', function (e) {
      var tr = e.target.closest('tr'); if (!tr) return;
      var i = +tr.dataset.i, c = S.cargos[i]; if (!c) return;
      var act = e.target.dataset.act;
      if (act === 'del') { S.cargos.splice(i, 1); renderCargoTable(); save(); }
      else if (act === 'color') {
        var ip = document.createElement('input');
        ip.type = 'color'; ip.value = c.color;
        ip.style.cssText = 'position:fixed;left:-9999px';
        document.body.appendChild(ip);
        ip.addEventListener('input', function () { c.color = ip.value; renderCargoTable(); save(); });
        ip.addEventListener('change', function () { setTimeout(function () { ip.remove(); }, 100); });
        ip.click();
      }
    });
  }

  /* ================= 计算 ================= */
  function calc() {
    var usable = S.cargos.filter(function (c) { return c.l > 0 && c.w > 0 && c.h > 0 && c.qty > 0; });
    if (!usable.length) { toast('没有可用货物，请先录入或导入数据', 'err'); return; }
    var skipped = S.cargos.length - usable.length;

    loading(true, '正在求解装柜方案…');
    setTimeout(function () {
      try {
        var opt = {
          supportRatio: (+$('rgSupport').value || 75) / 100,
          maxContainers: +$('inMaxCtn').value || 20,
          multiContainer: $('ckMulti').checked
        };
        var t0 = performance.now();
        S.result = Packer.pack(usable, S.spec, opt);
        var ms = Math.round(performance.now() - t0);
        S.cur = 0;
        renderResult();
        // 回写实际摆放维度到货物清单（供小盒显示真实姿态）
        var seen = {};
        S.result.containers.forEach(function (ct) {
          ct.items.forEach(function (it) {
            if (it.cargoId == null || seen[it.cargoId]) return;
            seen[it.cargoId] = true;
            for (var k = 0; k < S.cargos.length; k++) {
              if (S.cargos[k].id === it.cargoId) { S.cargos[k]._placedDim = { dx: it.dx, dy: it.dy, dz: it.dz }; break; }
            }
          });
        });
        renderCargoTable();
        var s = S.result.summary;
        toast('计算完成：' + s.containerCount + ' 个柜，装入 ' + s.packedUnits + '/' + s.totalUnits +
          ' 箱，平均利用率 ' + pct(s.avgVolumeRate) + '（耗时 ' + ms + 'ms）',
          s.unpackedUnits ? 'warn' : 'ok');
        if (skipped) toast(skipped + ' 条记录因缺少尺寸被跳过', 'warn');
        if (window._sgSet) window._sgSet(4);  /* 步骤指引跳到第4步 */
      } catch (err) {
        console.error(err);
        toast('计算失败：' + err.message, 'err');
      } finally {
        loading(false);
      }
    }, 30);
  }

  /* ================= 渲染结果 ================= */
  function renderResult() {
    var r = S.result;
    if (!r) return;
    renderTabs();
    renderSummary();
    showContainer(S.cur);
    renderUnpacked();
  }

  function renderTabs() {
    var r = S.result, html = '';
    if (!r.containers.length) { $('ctnTabs').innerHTML = '<span class="hint">无可装柜</span>'; return; }
    r.containers.forEach(function (ct, i) {
      html += '<div class="ctn-tab' + (i === S.cur ? ' active' : '') + '" data-i="' + i + '">第' + ct.index + '柜 · ' +
        ct.stats.count + '箱 · ' + pct(ct.stats.volumeRate) + '</div>';
    });
    $('ctnTabs').innerHTML = html;
    $('ctnTabs').querySelectorAll('.ctn-tab').forEach(function (t) {
      t.addEventListener('click', function () { S.cur = +t.dataset.i; renderTabs(); showContainer(S.cur); });
    });
  }

  function showContainer(i) {
    var ct = S.result.containers[i];
    if (!ct) return;
    viewer.build(ct.spec, ct.items);
    viewer.setShellMode($('selShell').value);
    viewer.setGrid($('ckGrid').checked);
    viewer.setLabels($('ckLabel').checked);
    S.filter = null;

    $('rgSeq').max = ct.items.length;
    $('rgSeq').value = ct.items.length;
    updSeqLab();
    viewer.showUpTo(ct.items.length);

    renderStat(ct);
    renderSeqList(ct);
    renderLegend(ct);
    renderBadge(ct);
    $('curCtnLab').textContent = '第 ' + ct.index + ' 柜';
    $('detail').innerHTML = '<div class="empty">点击 3D 视图中的货物</div>';
  }

  function renderBadge(ct) {
    var st = ct.stats;
    $('glBadge').style.display = '';
    $('glBadge').innerHTML =
      '第 ' + ct.index + ' 柜 · ' + esc(ct.spec.name) + '<br>' +
      '装入 <b>' + st.count + '</b> 箱 ｜ 体积利用率 <b>' + pct(st.volumeRate) + '</b><br>' +
      '毛重 <b>' + fmt(st.weight, 1) + '</b> kg ｜ 载重率 <b>' + pct(st.weightRate) + '</b>';
  }

  function renderSummary() {
    var s = S.result.summary;
    var okAll = s.unpackedUnits === 0;
    $('summaryBox').innerHTML =
      '<div class="stat-grid" style="margin-bottom:8px">' +
        '<div class="stat"><div class="k">所需柜数</div><div class="v">' + s.containerCount + '<small>个</small></div></div>' +
        '<div class="stat ' + (okAll ? 'ok' : 'danger') + '"><div class="k">装入 / 总数</div><div class="v">' + s.packedUnits + '<small>/' + s.totalUnits + '</small></div></div>' +
        '<div class="stat"><div class="k">总体积</div><div class="v">' + fmt(s.totalVolumeCbm, 2) + '<small>cbm</small></div></div>' +
        '<div class="stat"><div class="k">总毛重</div><div class="v">' + fmt(s.totalWeight, 0) + '<small>kg</small></div></div>' +
      '</div>' +
      '<div class="kv"><span class="k">平均体积利用率</span><span class="v">' + pct(s.avgVolumeRate) + '</span></div>' +
      '<div class="bar ' + (s.avgVolumeRate > .8 ? 'g' : s.avgVolumeRate > .55 ? '' : 'w') + '"><i style="width:' + Math.min(100, s.avgVolumeRate * 100) + '%"></i></div>' +
      (okAll ? '<div class="info-box" style="margin-top:8px">✓ 全部货物已装入</div>'
             : '<div class="err-box" style="margin-top:8px">⚠ 仍有 ' + s.unpackedUnits + ' 箱未装入，见下方清单</div>') +
      '<div class="hint" style="margin-top:8px;padding:6px 8px;background:#f7f9fc;border-radius:6px;line-height:1.8">' +
        '<b>📖 数据解读：</b><br>' +
        '• <b>体积利用率</b>：越高越省运费，一般 &gt;70% 为良好<br>' +
        '• <b>载重率</b>：总重÷柜限重，超100%则超载危险<br>' +
        '• <b>重心偏移</b>：相对柜中心，纵向建议 ±10% 内<br>' +
        '• <b>剩余空间</b>：未利用的容积（cbm）<br>' +
        '• 右侧「当前柜统计」查看每柜详情，3D区可拖拽旋转' +
      '</div>';
  }

  function renderStat(ct) {
    var st = ct.stats, sp = ct.spec;
    var lv = st.cogLevel;
    var lvTxt = { ok: '良好', warn: '偏移偏大', danger: '严重偏移' }[lv];
    $('statBox').innerHTML =
      '<div class="kv"><span class="k">装入件数</span><span class="v">' + st.count + ' 箱</span></div>' +
      '<div class="kv"><span class="k">装载体积</span><span class="v">' + fmt(st.volumeUsedCbm, 3) + ' / ' + fmt(st.volumeTotalCbm, 2) + ' cbm</span></div>' +
      '<div class="kv"><span class="k">体积利用率</span><span class="v">' + pct(st.volumeRate) + '</span></div>' +
      '<div class="bar ' + (st.volumeRate > .8 ? 'g' : st.volumeRate > .55 ? '' : 'w') + '" style="margin-bottom:5px"><i style="width:' + Math.min(100, st.volumeRate * 100) + '%"></i></div>' +
      '<div class="kv"><span class="k">装载重量</span><span class="v ' + (st.overweight ? 'danger' : '') + '">' + fmt(st.weight, 1) + ' / ' + sp.maxWeight + ' kg</span></div>' +
      '<div class="kv"><span class="k">载重利用率</span><span class="v ' + (st.weightRate > 1 ? 'danger' : st.weightRate > .9 ? 'warn' : '') + '">' + pct(st.weightRate) + '</span></div>' +
      '<div class="bar ' + (st.weightRate > 1 ? 'd' : st.weightRate > .9 ? 'w' : 'g') + '" style="margin-bottom:5px"><i style="width:' + Math.min(100, st.weightRate * 100) + '%"></i></div>' +
      '<div class="kv"><span class="k">剩余空间</span><span class="v">' + fmt(st.freeCbm, 3) + ' cbm</span></div>' +
      '<div class="kv"><span class="k">占用长 / 高</span><span class="v">' + Math.round(st.usedLength) + ' / ' + Math.round(st.usedHeight) + ' mm</span></div>' +
      '<div class="kv"><span class="k">重心 X/Y/Z</span><span class="v">' + Math.round(st.cog.x) + '/' + Math.round(st.cog.y) + '/' + Math.round(st.cog.z) + '</span></div>' +
      '<div class="kv"><span class="k">重心评估</span><span class="v"><span class="tag ' + lv + '">' + lvTxt + '</span></span></div>' +
      '<div class="hint" style="margin-top:5px">纵向偏移 ' + (st.cogDevX * 100).toFixed(1) + '%，横向偏移 ' + (st.cogDevY * 100).toFixed(1) + '%（相对柜中心；纵向建议 ±10% 内）</div>' +
      (st.overweight ? '<div class="err-box" style="margin-top:7px">⚠ 该柜超载，请拆分货物</div>' : '') +
      '<div class="hint" style="margin-top:5px">排序策略：' + esc(ct.strategy || '-') + '</div>';
  }

  function renderSeqList(ct) {
    var html = '';
    ct.items.forEach(function (it) {
      html += '<div class="it" data-seq="' + it.seq + '">' +
        '<span class="n">' + it.seq + '</span>' +
        '<span class="swatch" style="background:' + esc(it.color) + '"></span>' +
        '<span class="t" title="' + esc(it.name) + '">' + esc(it.name) + '</span>' +
        '<span class="m">' + Math.round(it.dx) + '×' + Math.round(it.dy) + '×' + Math.round(it.dz) + '</span></div>';
    });
    $('seqList').innerHTML = html || '<div class="empty">无</div>';
    $('seqList').querySelectorAll('.it').forEach(function (el) {
      el.addEventListener('click', function () {
        var sq = +el.dataset.seq;
        $('rgSeq').value = sq; updSeqLab(); viewer.showUpTo(sq);
        viewer.selectBySeq(sq);
      });
    });
  }

  function renderLegend(ct) {
    var groups = {}, order = [];
    ct.items.forEach(function (it) {
      if (!groups[it.cargoId]) { groups[it.cargoId] = { name: it.name, color: it.color, n: 0, id: it.cargoId }; order.push(it.cargoId); }
      groups[it.cargoId].n++;
    });
    var html = '';
    order.forEach(function (k) {
      var g = groups[k];
      html += '<div class="li" data-id="' + esc(g.id) + '"><span class="swatch" style="background:' + esc(g.color) + '"></span>' +
        '<span class="t">' + esc(g.name) + '</span><b>×' + g.n + '</b></div>';
    });
    var box = $('legend');
    box.innerHTML = html;
    box.style.display = html ? '' : 'none';
    box.querySelectorAll('.li').forEach(function (el) {
      el.addEventListener('click', function () {
        var id = el.dataset.id;
        S.filter = (S.filter === id) ? null : id;
        viewer.filterCargo(S.filter);
        box.querySelectorAll('.li').forEach(function (x) { x.classList.toggle('dim', !!S.filter && x.dataset.id !== S.filter); });
      });
    });
  }

  function renderUnpacked() {
    var un = S.result.unpacked;
    $('unpackCount').textContent = un.length;
    if (!un.length) { $('unpackBox').innerHTML = '<div class="info-box">✓ 无未装入货物</div>'; return; }
    var map = {};
    un.forEach(function (u) {
      var k = u.cargoId + '|' + (u._reason || '空间不足');
      if (!map[k]) map[k] = { name: u.name, l: u.l, w: u.w, h: u.h, r: u._reason || '柜内空间不足', n: 0, color: u.color };
      map[k].n++;
    });
    var html = '';
    Object.keys(map).forEach(function (k) {
      var g = map[k];
      html += '<div class="kv" style="align-items:flex-start"><span class="k"><span class="swatch" style="background:' + esc(g.color) + '"></span> ' +
        esc(g.name) + '<br><span class="hint">' + g.l + '×' + g.w + '×' + g.h + ' · ' + esc(g.r) + '</span></span>' +
        '<span class="v danger">×' + g.n + '</span></div>';
    });
    $('unpackBox').innerHTML = html;
  }

  function renderDetail(it) {
    if (!it) { $('detail').innerHTML = '<div class="empty">点击 3D 视图中的货物</div>'; return; }
    $('detail').innerHTML =
      '<div class="dt-color" style="background:' + esc(it.color) + '"></div>' +
      '<div style="font-weight:700;margin-bottom:5px">' + esc(it.name) + '</div>' +
      '<div class="kv"><span class="k">装柜顺序</span><span class="v">第 ' + it.seq + ' 件</span></div>' +
      (it.ctnNo ? '<div class="kv"><span class="k">箱号</span><span class="v">' + esc(it.ctnNo) + '</span></div>' : '') +
      '<div class="kv"><span class="k">原始尺寸</span><span class="v">' + it.origin.join(' × ') + '</span></div>' +
      '<div class="kv"><span class="k">摆放尺寸</span><span class="v">' + Math.round(it.dx) + ' × ' + Math.round(it.dy) + ' × ' + Math.round(it.dz) + '</span></div>' +
      '<div class="kv"><span class="k">坐标 X/Y/Z</span><span class="v">' + Math.round(it.x) + ' / ' + Math.round(it.y) + ' / ' + Math.round(it.z) + '</span></div>' +
      '<div class="kv"><span class="k">体积</span><span class="v">' + fmt(it.dx * it.dy * it.dz / 1e9, 4) + ' cbm</span></div>' +
      '<div class="kv"><span class="k">重量</span><span class="v">' + fmt(it.weight, 2) + ' kg</span></div>' +
      '<div class="kv"><span class="k">堆叠层</span><span class="v">第 ' + it.layer + ' 层' + (it.stackable ? '' : '（不可压顶）') + '</span></div>' +
      (it.note ? '<div class="hint" style="margin-top:6px">备注：' + esc(it.note) + '</div>' : '');
  }

  /* ================= 播放 ================= */
  function updSeqLab() {
    var mx = +$('rgSeq').max || 0;
    $('seqLab').textContent = $('rgSeq').value + ' / ' + mx;
  }
  function stopPlay() {
    S.playing = false;
    if (S.timer) { clearInterval(S.timer); S.timer = null; }
    $('btnPlay').textContent = '▶ 播放装柜';
    $('btnPlay').classList.remove('active');
  }
  function play() {
    if (!S.result || !S.result.containers.length) { toast('请先计算装柜方案', 'warn'); return; }
    if (S.playing) { stopPlay(); return; }
    var mx = +$('rgSeq').max;
    if (+$('rgSeq').value >= mx) $('rgSeq').value = 0;
    S.playing = true;
    $('btnPlay').textContent = '⏸ 暂停';
    $('btnPlay').classList.add('active');
    var iv = +$('selSpeed').value;
    S.timer = setInterval(function () {
      var v = +$('rgSeq').value + 1;
      if (v > mx) { stopPlay(); return; }
      $('rgSeq').value = v; updSeqLab(); viewer.showUpTo(v);
      var ct = S.result.containers[S.cur];
      var el = $('seqList').querySelector('.it[data-seq="' + v + '"]');
      $('seqList').querySelectorAll('.it.on').forEach(function (x) { x.classList.remove('on'); });
      if (el) { el.classList.add('on'); el.scrollIntoView({ block: 'nearest' }); }
    }, iv);
  }

  /* ================= 导入 ================= */
  function importFile(file, isTemplate) {
    var fr = new FileReader();
    loading(true, '正在解析文件…');
    fr.onload = function () {
      try {
        var res = Importer.parseArrayBuffer(fr.result, {});
        if (!res.cargos.length) {
          loading(false);
          toast('未识别到货物数据，请检查表格是否含「长/宽/高」或「Packing Size」列', 'err');
          return;
        }
        S.cargos = res.cargos;
        if (res.title) S.title = res.title;
        renderCargoTable();
        loading(false);
        toast('导入成功：' + res.cargos.length + ' 条货物记录' + (res.title ? '（' + res.title + '）' : ''), 'ok');
        if (res.warnings.length) {
          modal('导入提醒', '<div class="warn-box">以下记录缺少尺寸信息，需手动补填后才会参与装柜计算：</div><ul style="margin:10px 0 0 0;padding-left:20px;line-height:1.9;font-size:12.5px">' +
            res.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>', [{ t: '知道了', cls: 'primary' }]);
        }
        save();
        setTimeout(calc, 120);
      } catch (e) {
        loading(false);
        console.error(e);
        toast('解析失败：' + e.message, 'err');
      }
    };
    fr.onerror = function () { loading(false); toast('文件读取失败', 'err'); };
    fr.readAsArrayBuffer(file);
  }

  /* ================= 导出 ================= */
  function exportImage() {
    if (!S.result || !S.result.containers.length) { toast('请先计算装柜方案', 'warn'); return; }
    var ct = S.result.containers[S.cur], st = ct.stats;
    viewer.renderer.render(viewer.scene, viewer.camera);
    Exporter.exportPng(viewer.canvas, {
      title: S.title + ' — 第 ' + ct.index + ' 柜（' + ct.spec.name + '）',
      line: '装入 ' + st.count + ' 箱　体积利用率 ' + pct(st.volumeRate) + '　装载体积 ' + fmt(st.volumeUsedCbm, 3) +
            ' cbm　毛重 ' + fmt(st.weight, 1) + ' kg　载重率 ' + pct(st.weightRate) +
            '　重心 X' + Math.round(st.cog.x) + '/Y' + Math.round(st.cog.y) + '/Z' + Math.round(st.cog.z) + ' mm'
    }, S.title + '_第' + ct.index + '柜.png');
    toast('图片已导出', 'ok');
  }

  function exportPdf() {
    if (!S.result || !S.result.containers.length) { toast('请先计算装柜方案', 'warn'); return; }
    loading(true, '正在生成 PDF（逐柜渲染快照）…');
    var shots = {}, keep = S.cur;
    var chain = Promise.resolve();
    S.result.containers.forEach(function (ct, i) {
      chain = chain.then(function () {
        return new Promise(function (res) {
          S.cur = i;
          showContainer(i);
          viewer.setView('iso');
          setTimeout(function () {
            viewer.renderer.render(viewer.scene, viewer.camera);
            shots[ct.index] = viewer.canvas.toDataURL('image/png');
            res();
          }, 260);
        });
      });
    });
    chain.then(function () {
      return Exporter.exportPdf({ title: S.title, result: S.result, shots: shots }, S.title + '_装柜方案.pdf');
    }).then(function () {
      S.cur = keep; renderTabs(); showContainer(keep);
      loading(false); toast('PDF 已导出', 'ok');
    }).catch(function (e) {
      console.error(e); loading(false); toast('PDF 生成失败：' + e.message, 'err');
    });
  }

  /* ================= 工程存读 ================= */
  function save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ title: S.title, cargos: S.cargos, spec: S.spec }));
    } catch (e) { /* ignore */ }
  }
  function restore() {
    try {
      var d = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (d && d.cargos && d.cargos.length) {
        S.cargos = d.cargos; S.title = d.title || S.title;
        if (d.spec) {
          S.spec = d.spec;
          $('selContainer').value = ContainerLib.byId(d.spec.id) ? d.spec.id : '__custom';
          $('inCtnL').value = d.spec.L; $('inCtnW').value = d.spec.W;
          $('inCtnH').value = d.spec.H; $('inCtnMax').value = d.spec.maxWeight;
          updCtnVolLab();
        }
        return true;
      }
    } catch (e) { }
    return false;
  }

  /* ================= 柜型推荐 ================= */
  function recommend() {
    var usable = S.cargos.filter(function (c) { return c.l > 0 && c.w > 0 && c.h > 0 && c.qty > 0; });
    if (!usable.length) { toast('请先录入货物', 'err'); return; }
    loading(true, '正在评估各柜型…');
    setTimeout(function () {
      var list = Packer.recommend(usable, ContainerLib.PRESETS);
      loading(false);
      var html = '<table class="cargo-table"><thead><tr><th>柜型</th><th class="num">所需柜数</th><th class="num">平均利用率</th><th class="num">未装入</th><th></th></tr></thead><tbody>';
      list.forEach(function (r, i) {
        html += '<tr><td>' + esc(r.name) + (i === 0 ? ' <span class="tag ok">推荐</span>' : '') + '</td>' +
          '<td class="num"><b>' + r.containers + '</b></td>' +
          '<td class="num">' + pct(r.rate) + '</td>' +
          '<td class="num ' + (r.unpacked ? 'danger' : '') + '">' + r.unpacked + '</td>' +
          '<td><button class="btn xs" data-id="' + r.id + '">选用</button></td></tr>';
      });
      html += '</tbody></table><div class="hint" style="margin-top:8px">排序依据：未装入件数 → 所需柜数 → 平均体积利用率。仅作参考，实际还需考虑运费与柜型可得性。</div>';
      var m = modal('柜型推荐', html, [{ t: '关闭' }]);
      m.el.querySelectorAll('button[data-id]').forEach(function (b) {
        b.addEventListener('click', function () {
          $('selContainer').value = b.dataset.id;
          applySpecFromSelect();
          m.close();
          calc();
        });
      });
    }, 30);
  }

  /* ================= 初始化 ================= */
  function init() {
    viewer = new Viewer3D($('gl'));

    /* ===== 步骤指引 ===== */
    var sgSteps = document.querySelectorAll('.sg-step');
    function setStep(n) {
      sgSteps.forEach(function (s) {
        var sn = +s.dataset.step;
        s.classList.toggle('sg-active', sn === n);
        s.classList.toggle('sg-done', sn < n);
      });
    }
    setStep(1);
    sgSteps.forEach(function (s) {
      s.addEventListener('click', function () {
        var target = s.dataset.target;
        if (target) {
          var el = $(target);
          if (el) {
            // 如果是折叠卡片，展开它
            if (el.classList.contains('collapsed')) el.classList.remove('collapsed');
            el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            // 闪烁高亮目标区域
            el.style.transition = 'box-shadow .3s';
            el.style.boxShadow = '0 0 0 2px #1f6feb, 0 6px 20px rgba(31,111,235,.25)';
            setTimeout(function () { el.style.boxShadow = ''; }, 1200);
          }
        }
        setStep(+s.dataset.step);
      });
    });
    /* 计算完成后自动跳到第4步 */
    window._sgSet = setStep;
    viewer.onSelect = function (it) {
      renderDetail(it);
      $('seqList').querySelectorAll('.it.on').forEach(function (x) { x.classList.remove('on'); });
      if (it) {
        var el = $('seqList').querySelector('.it[data-seq="' + it.seq + '"]');
        if (el) { el.classList.add('on'); el.scrollIntoView({ block: 'nearest' }); }
      }
    };

    initContainerSelect();
    bindCargoTable();

    if (!restore()) { S.cargos = SampleData.qatar(); S.title = SampleData.QATAR_TITLE; }
    renderCargoTable();

    /* 顶栏 */
    $('btnImportTpl').addEventListener('click', function () { $('fileXlsx').dataset.tpl = '1'; $('fileXlsx').click(); });
    $('btnImportAny').addEventListener('click', function () { $('fileXlsx').dataset.tpl = ''; $('fileXlsx').click(); });
    $('fileXlsx').addEventListener('change', function (e) {
      var f = e.target.files[0];
      if (f) importFile(f, this.dataset.tpl === '1');
      e.target.value = '';
    });
    $('btnTplDown').addEventListener('click', function () { Importer.downloadTemplate(); toast('模板已下载', 'ok'); });
    $('btnExpImg').addEventListener('click', exportImage);
    $('btnExpPdf').addEventListener('click', exportPdf);
    $('btnExpXls').addEventListener('click', function () {
      if (!S.result) { toast('请先计算装柜方案', 'warn'); return; }
      Importer.exportPlan(S.result, S.title + '_装柜明细.xlsx', S.title);
      toast('明细表已导出', 'ok');
    });
    $('btnToggleRight').addEventListener('click', function () { $('colRight').classList.toggle('show'); });

    /* 左栏 */
    $('btnRecommend').addEventListener('click', recommend);
    $('rgSupport').addEventListener('input', function () { $('labSup').textContent = this.value + '%'; });
    $('btnAddCargo').addEventListener('click', function () {
      var name = $('nfName').value.trim() || ('货物 ' + (S.cargos.length + 1));
      var c = {
        id: uid(), itemNo: S.cargos.length + 1, name: name, nameEn: '',
        ctnNo: $('nfCtn').value.trim(),
        l: +$('nfL').value || 0, w: +$('nfW').value || 0, h: +$('nfH').value || 0,
        weight: +$('nfWt').value || 0, qty: Math.max(1, Math.round(+$('nfQty').value || 1)),
        pcsPerCtn: 1,
        stackable: $('nfStack').checked, maxLayers: +$('nfLayers').value || 0,
        rotateMode: $('nfRot').value, color: $('nfColor').value, note: '',
        pending: !(+$('nfL').value > 0 && +$('nfW').value > 0 && +$('nfH').value > 0)
      };
      if (c.pending) { toast('长宽高必须大于 0', 'err'); return; }
      S.cargos.push(c);
      renderCargoTable(); save();
      $('nfName').value = ''; $('nfCtn').value = '';
      $('nfColor').value = Importer.colorAt(S.cargos.length);
      toast('已添加：' + name, 'ok');
    });
    $('btnSample1').addEventListener('click', function () {
      S.cargos = SampleData.qatar(); S.title = SampleData.QATAR_TITLE;
      renderCargoTable(); save(); toast('已载入装箱单示例', 'ok'); calc();
    });
    $('btnSample2').addEventListener('click', function () {
      S.cargos = SampleData.general(); S.title = SampleData.GENERAL_TITLE;
      renderCargoTable(); save(); toast('已载入通用示例', 'ok'); calc();
    });
    $('btnExpCargo').addEventListener('click', function () {
      if (!S.cargos.length) { toast('无货物数据', 'warn'); return; }
      Importer.exportCargoList(S.cargos, S.title + '_货物清单.xlsx'); toast('已导出', 'ok');
    });
    $('btnSaveJson').addEventListener('click', function () {
      var blob = new Blob([JSON.stringify({ title: S.title, spec: S.spec, cargos: S.cargos }, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = S.title + '.json'; a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      toast('工程已保存', 'ok');
    });
    $('btnLoadJson').addEventListener('click', function () { $('fileJson').click(); });
    $('fileJson').addEventListener('change', function (e) {
      var f = e.target.files[0]; if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var d = JSON.parse(fr.result);
          if (!d.cargos) throw new Error('文件格式不正确');
          S.cargos = d.cargos; S.title = d.title || S.title;
          if (d.spec) { S.spec = d.spec; $('selContainer').value = ContainerLib.byId(d.spec.id) ? d.spec.id : '__custom'; $('inCtnL').value = d.spec.L; $('inCtnW').value = d.spec.W; $('inCtnH').value = d.spec.H; $('inCtnMax').value = d.spec.maxWeight; updCtnVolLab(); }
          renderCargoTable(); save(); toast('工程已载入', 'ok'); calc();
        } catch (err) { toast('读取失败：' + err.message, 'err'); }
      };
      fr.readAsText(f);
      e.target.value = '';
    });
    $('btnClear').addEventListener('click', function () {
      modal('确认清空', '<div class="err-box">将清空全部货物数据与当前方案，此操作不可撤销。</div>', [
        { t: '取消' },
        { t: '确认清空', cls: 'danger', fn: function () {
            S.cargos = []; S.result = null; stopPlay();
            renderCargoTable(); save();
            $('ctnTabs').innerHTML = '<span class="hint">尚未计算</span>';
            $('summaryBox').innerHTML = '<div class="empty">尚未计算</div>';
            $('statBox').innerHTML = '<div class="empty">尚未计算</div>';
            $('seqList').innerHTML = '<div class="empty">尚未计算</div>';
            $('unpackBox').innerHTML = '<div class="hint">无</div>';
            $('glBadge').style.display = 'none';
            $('legend').style.display = 'none';
            if (viewer.spec) viewer.build(S.spec, []);
            toast('已清空');
          } }
      ]);
    });

    /* 中栏 */
    $('btnCalc').addEventListener('click', function () { stopPlay(); calc(); });
    document.querySelectorAll('[data-view]').forEach(function (b) {
      b.addEventListener('click', function () { viewer.setView(b.dataset.view); });
    });
    $('selShell').addEventListener('change', function () { viewer.setShellMode(this.value); });
    $('ckGrid').addEventListener('change', function () { viewer.setGrid(this.checked); });
    $('ckLabel').addEventListener('change', function () { viewer.setLabels(this.checked); });

    $('btnPlay').addEventListener('click', play);
    $('btnStepF').addEventListener('click', function () {
      stopPlay();
      var v = Math.min(+$('rgSeq').max, +$('rgSeq').value + 1);
      $('rgSeq').value = v; updSeqLab(); viewer.showUpTo(v); viewer.selectBySeq(v);
    });
    $('btnStepB').addEventListener('click', function () {
      stopPlay();
      var v = Math.max(0, +$('rgSeq').value - 1);
      $('rgSeq').value = v; updSeqLab(); viewer.showUpTo(v); if (v) viewer.selectBySeq(v);
    });
    $('rgSeq').addEventListener('input', function () { stopPlay(); updSeqLab(); viewer.showUpTo(+this.value); });
    $('btnAll').addEventListener('click', function () {
      stopPlay();
      $('rgSeq').value = $('rgSeq').max; updSeqLab(); viewer.showUpTo(+$('rgSeq').max);
      viewer.select(null);
      S.filter = null; viewer.filterCargo(null);
      $('legend').querySelectorAll('.li').forEach(function (x) { x.classList.remove('dim'); });
    });

    /* 快捷键 */
    document.addEventListener('keydown', function (e) {
      if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
      if (e.key === ' ') { e.preventDefault(); play(); }
      else if (e.key === 'ArrowRight') { $('btnStepF').click(); }
      else if (e.key === 'ArrowLeft') { $('btnStepB').click(); }
      else if (e.key === 'Enter') { $('btnCalc').click(); }
    });

    /* ===== 左右栏折叠/展开 ===== */
    var mainEl = $('main');
    var colLeft = $('colLeft');
    var colRight = $('colRight');
    var toggleLeftBtn = $('toggleLeft');   /* 步骤指引条内的「◀ 收起」 */
    var toggleRightBtn = $('toggleRight');  /* 方案总览标题旁的「收起 ▶」 */
    var expandLeftBtn = $('expandLeft');    /* fixed 定位，左边缘伸出 */
    var expandRightBtn = $('expandRight');  /* fixed 定位，右边缘伸出 */

    function updateToggleState() {
      var hideL = colLeft.classList.contains('collapsed');
      var hideR = colRight.classList.contains('collapsed');
      // 更新 #main 的 grid class
      mainEl.classList.toggle('hide-left', hideL);
      mainEl.classList.toggle('hide-right', hideR);
      mainEl.classList.toggle('hide-both', hideL && hideR);
      // 折叠按钮：栏隐藏时连按钮一起藏（因为按钮在栏内部）
      // 展开按钮（fixed 定位，不受 overflow 裁切）
      expandLeftBtn.style.display = hideL ? '' : 'none';
      expandRightBtn.style.display = hideR ? '' : 'none';
      // 通知 3D 视口 resize
      setTimeout(function () { if (viewer && viewer.renderer) viewer.renderer.setSize(viewer.container.clientWidth, viewer.container.clientHeight); }, 50);
    }

    toggleLeftBtn.addEventListener('click', function () {
      colLeft.classList.add('collapsed');
      updateToggleState();
    });
    toggleRightBtn.addEventListener('click', function () {
      colRight.classList.add('collapsed');
      updateToggleState();
    });
    expandLeftBtn.addEventListener('click', function () {
      colLeft.classList.remove('collapsed');
      updateToggleState();
    });
    expandRightBtn.addEventListener('click', function () {
      colRight.classList.remove('collapsed');
      updateToggleState();
    });

    // 首次自动计算
    setTimeout(calc, 260);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
