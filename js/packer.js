/* ============================================================
 * packer.js  —  三维装箱核心算法
 *
 * 算法：Extreme-Point (极点法) + First-Fit-Decreasing 多策略择优
 *   1. 货物按数量展开为独立单元
 *   2. 多套「排序策略 × 落位偏好」组合分别求解，取最优
 *   3. 每次放置在候选极点中评分选位（Deepest-Bottom-Left 或 Bottom-First）
 *   4. 放置后沿 -z / -x / -y 精确贴紧（一次扫描求最近障碍面），消除空洞
 *   5. 支撑率检测、可堆叠 / 层数限制、载重校验、重心计算
 *   6. 装不下自动开新柜
 *
 * 坐标系：x = 柜长(L, 柜尾→柜门)  y = 柜宽(W)  z = 柜高(H, 向上)
 *         原点 (0,0,0) 在柜内最里侧、左侧、底部
 * 单位：mm / kg
 * ============================================================ */
(function (global) {
  'use strict';

  var EPS = 1e-6;
  var TOL = 1.0;          // 支撑面齐平容差 mm
  var MAX_EP_SCAN = 900;  // 单件最多扫描的极点数
  var MAX_EP_KEEP = 2600; // 极点池上限

  /* ---------- 朝向枚举 ---------- */
  // rotateMode: 'free' 任意翻转(6向) | 'upright' 仅水平旋转(2向) | 'none' 固定(1向)
  function orientations(l, w, h, rotateMode) {
    if (rotateMode === 'none') return [[l, w, h]];
    var raw;
    if (rotateMode === 'upright') raw = [[l, w, h], [w, l, h]];
    else raw = [[l, w, h], [w, l, h], [l, h, w], [h, l, w], [w, h, l], [h, w, l]];
    var seen = {}, out = [];
    for (var i = 0; i < raw.length; i++) {
      var k = raw[i][0] + '_' + raw[i][1] + '_' + raw[i][2];
      if (!seen[k]) { seen[k] = 1; out.push(raw[i]); }
    }
    return out;
  }

  function overlap3(a, b) {
    return (a.x < b.x + b.dx - EPS) && (b.x < a.x + a.dx - EPS) &&
           (a.y < b.y + b.dy - EPS) && (b.y < a.y + a.dy - EPS) &&
           (a.z < b.z + b.dz - EPS) && (b.z < a.z + a.dz - EPS);
  }
  function rectInter(ax, ay, adx, ady, bx, by, bdx, bdy) {
    var ox = Math.min(ax + adx, bx + bdx) - Math.max(ax, bx);
    var oy = Math.min(ay + ady, by + bdy) - Math.max(ay, by);
    if (ox <= EPS || oy <= EPS) return 0;
    return ox * oy;
  }

  /* ============================================================
   * 单柜装载器
   * ============================================================ */
  function ContainerPacker(spec, opt, cap) {
    this.spec = spec;
    this.opt = opt;
    this.placed = [];
    this.eps = [{ x: 0, y: 0, z: 0 }];
    this.epKey = { '0_0_0': 1 };
    this.weight = 0;
    this.dirty = false;

    // 扁平坐标数组（碰撞检测热点，避免对象属性访问）
    var c = Math.max(64, cap || 64);
    this.n = 0; this.cap = c;
    this.X = new Float64Array(c); this.Y = new Float64Array(c); this.Z = new Float64Array(c);
    this.X2 = new Float64Array(c); this.Y2 = new Float64Array(c); this.Z2 = new Float64Array(c);
    this.SK = new Uint8Array(c);   // stackable
    this.LY = new Int32Array(c);   // layer
  }

  ContainerPacker.prototype._grow = function () {
    if (this.n < this.cap) return;
    var c = this.cap * 2, k;
    var keys = ['X', 'Y', 'Z', 'X2', 'Y2', 'Z2'];
    for (k = 0; k < keys.length; k++) {
      var a = new Float64Array(c); a.set(this[keys[k]]); this[keys[k]] = a;
    }
    var s = new Uint8Array(c); s.set(this.SK); this.SK = s;
    var l = new Int32Array(c); l.set(this.LY); this.LY = l;
    this.cap = c;
  };

  ContainerPacker.prototype._store = function (b, stackable, layer) {
    this._grow();
    var i = this.n++;
    this.X[i] = b.x; this.Y[i] = b.y; this.Z[i] = b.z;
    this.X2[i] = b.x + b.dx; this.Y2[i] = b.y + b.dy; this.Z2[i] = b.z + b.dz;
    this.SK[i] = stackable ? 1 : 0;
    this.LY[i] = layer;
  };

  ContainerPacker.prototype._inside = function (b) {
    return b.x > -EPS && b.y > -EPS && b.z > -EPS &&
           b.x + b.dx <= this.spec.L + EPS &&
           b.y + b.dy <= this.spec.W + EPS &&
           b.z + b.dz <= this.spec.H + EPS;
  };

  ContainerPacker.prototype._free = function (b) {
    var n = this.n, X = this.X, Y = this.Y, Z = this.Z, X2 = this.X2, Y2 = this.Y2, Z2 = this.Z2;
    var ax = b.x, ay = b.y, az = b.z;
    var ax2 = ax + b.dx, ay2 = ay + b.dy, az2 = az + b.dz;
    for (var i = n - 1; i >= 0; i--) {
      if (ax < X2[i] - EPS && X[i] < ax2 - EPS &&
          ay < Y2[i] - EPS && Y[i] < ay2 - EPS &&
          az < Z2[i] - EPS && Z[i] < az2 - EPS) return false;
    }
    return true;
  };

  ContainerPacker.prototype._fits = function (b) {
    return this._inside(b) && this._free(b);
  };

  /* 精确贴紧：沿指定轴负方向落到最近障碍面（一次 O(n) 扫描） */
  ContainerPacker.prototype._drop = function (b, axis) {
    var n = this.n, X = this.X, Y = this.Y, Z = this.Z, X2 = this.X2, Y2 = this.Y2, Z2 = this.Z2;
    var best = 0, i;
    if (axis === 'z') {
      var ax = b.x, ax2 = ax + b.dx, ay = b.y, ay2 = ay + b.dy, az = b.z;
      for (i = 0; i < n; i++) {
        var t = Z2[i];
        if (t > az + EPS || t <= best) continue;
        if (X2[i] <= ax + EPS || X[i] >= ax2 - EPS) continue;
        if (Y2[i] <= ay + EPS || Y[i] >= ay2 - EPS) continue;
        best = t;
      }
    } else if (axis === 'x') {
      var by = b.y, by2 = by + b.dy, bz = b.z, bz2 = bz + b.dz, bx = b.x;
      for (i = 0; i < n; i++) {
        var t2 = X2[i];
        if (t2 > bx + EPS || t2 <= best) continue;
        if (Y2[i] <= by + EPS || Y[i] >= by2 - EPS) continue;
        if (Z2[i] <= bz + EPS || Z[i] >= bz2 - EPS) continue;
        best = t2;
      }
    } else {
      var cx = b.x, cx2 = cx + b.dx, cz = b.z, cz2 = cz + b.dz, cy = b.y;
      for (i = 0; i < n; i++) {
        var t3 = Y2[i];
        if (t3 > cy + EPS || t3 <= best) continue;
        if (X2[i] <= cx + EPS || X[i] >= cx2 - EPS) continue;
        if (Z2[i] <= cz + EPS || Z[i] >= cz2 - EPS) continue;
        best = t3;
      }
    }
    return best;
  };

  ContainerPacker.prototype._settle = function (b) {
    var order = this.opt.dblFirst ? ['x', 'z', 'y'] : ['z', 'x', 'y'];
    for (var r = 0; r < 2; r++) {
      for (var i = 0; i < order.length; i++) {
        var ax = order[i], cur = b[ax];
        if (cur <= EPS) continue;
        var v = this._drop(b, ax);
        if (v < cur - EPS) {
          b[ax] = v;
          if (!this._free(b)) b[ax] = cur;   // 极端情形回退
        }
      }
    }
    return b;
  };

  /* 支撑检测 */
  var SUP_FAIL = { ok: false };
  ContainerPacker.prototype._support = function (b) {
    if (b.z <= TOL) return { ok: true, layer: 1 };
    var need = this.opt.supportRatio * b.dx * b.dy;
    var area = 0, layer = 1, i;
    var n = this.n, X = this.X, Y = this.Y, X2 = this.X2, Y2 = this.Y2, Z2 = this.Z2;
    var bx = b.x, by = b.y, bx2 = bx + b.dx, by2 = by + b.dy, bz = b.z;
    for (i = 0; i < n; i++) {
      var d = Z2[i] - bz;
      if (d > TOL || d < -TOL) continue;
      var ox = Math.min(X2[i], bx2) - Math.max(X[i], bx);
      if (ox <= EPS) continue;
      var oy = Math.min(Y2[i], by2) - Math.max(Y[i], by);
      if (oy <= EPS) continue;
      if (!this.SK[i]) return SUP_FAIL;
      area += ox * oy;
      if (this.LY[i] + 1 > layer) layer = this.LY[i] + 1;
    }
    if (area + EPS < need) return SUP_FAIL;
    return { ok: true, layer: layer };
  };

  ContainerPacker.prototype._addEP = function (x, y, z) {
    if (x > this.spec.L - EPS || y > this.spec.W - EPS || z > this.spec.H - EPS) return;
    var k = Math.round(x) + '_' + Math.round(y) + '_' + Math.round(z);
    if (this.epKey[k]) return;
    this.epKey[k] = 1;
    this.eps.push({ x: x, y: y, z: z });
    this.dirty = true;
  };

  ContainerPacker.prototype._pushEP = function (b) {
    this._addEP(b.x + b.dx, b.y, b.z);
    this._addEP(b.x, b.y + b.dy, b.z);
    this._addEP(b.x, b.y, b.z + b.dz);
    // 顶面另两角，利于错位堆叠
    this._addEP(b.x + b.dx, b.y, b.z + b.dz);
    this._addEP(b.x, b.y + b.dy, b.z + b.dz);
    this._purgeEP(b);
  };

  /* 回收失效极点：落在新放置盒子内部的点已不可用 */
  ContainerPacker.prototype._purgeEP = function (b) {
    var out = [], E = this.eps, i, p;
    for (i = 0; i < E.length; i++) {
      p = E[i];
      var inside = (p.x >= b.x - EPS && p.x < b.x + b.dx - EPS) &&
                   (p.y >= b.y - EPS && p.y < b.y + b.dy - EPS) &&
                   (p.z >= b.z - EPS && p.z < b.z + b.dz - EPS);
      if (inside) { delete this.epKey[Math.round(p.x) + '_' + Math.round(p.y) + '_' + Math.round(p.z)]; continue; }
      out.push(p);
    }
    this.eps = out;
  };

  ContainerPacker.prototype._sortEP = function () {
    if (!this.dirty) return;
    this.dirty = false;
    if (this.opt.dblFirst) {
      this.eps.sort(function (a, b) { return (a.x - b.x) || (a.z - b.z) || (a.y - b.y); });
    } else {
      this.eps.sort(function (a, b) { return (a.z - b.z) || (a.x - b.x) || (a.y - b.y); });
    }
    if (this.eps.length > MAX_EP_KEEP) this.eps.length = MAX_EP_KEEP;
  };

  ContainerPacker.prototype.tryPlace = function (unit) {
    if (this.weight + unit.weight > this.spec.maxWeight + EPS) return null;
    this._sortEP();

    var ors = unit._ors || (unit._ors = orientations(unit.l, unit.w, unit.h, unit.rotateMode));
    var maxDim = unit._maxDim || (unit._maxDim = Math.max(unit.l, unit.w, unit.h));
    var best = null, bestScore = Infinity, bestPrim = Infinity, sinceHit = 0;
    var dbl = this.opt.dblFirst;
    var N = Math.min(this.eps.length, MAX_EP_SCAN);

    for (var ei = 0; ei < N; ei++) {
      var ep = this.eps[ei];
      // 剪枝：后续极点主坐标只增不减，settle 最多回退一个货物长度
      if (best && (dbl ? ep.x : ep.z) > bestPrim + maxDim) break;
      for (var oi = 0; oi < ors.length; oi++) {
        var o = ors[oi];
        var b = { x: ep.x, y: ep.y, z: ep.z, dx: o[0], dy: o[1], dz: o[2] };
        if (!this._inside(b)) continue;
        if (!this._free(b)) continue;
        this._settle(b);
        if (!this._fits(b)) continue;
        var sup = this._support(b);
        if (!sup.ok) continue;
        if (unit.maxLayers && sup.layer > unit.maxLayers) continue;
        var score = dbl
          ? (b.x * 1e7 + b.z * 1e3 + b.y + b.dz * 1e-3)
          : (b.z * 1e7 + b.x * 1e3 + b.y + b.dz * 1e-3);
        if (score < bestScore) {
          bestScore = score;
          bestPrim = dbl ? b.x : b.z;
          best = { x: b.x, y: b.y, z: b.z, dx: b.dx, dy: b.dy, dz: b.dz, layer: sup.layer, ori: oi };
          sinceHit = 0;
        }
      }
      if (best) { sinceHit++; if (sinceHit > 140) break; }
    }
    if (!best) return null;

    var rec = {
      uid: unit.uid, cargoId: unit.cargoId, name: unit.name, nameEn: unit.nameEn,
      ctnNo: unit.ctnNo, color: unit.color, weight: unit.weight, note: unit.note,
      x: best.x, y: best.y, z: best.z, dx: best.dx, dy: best.dy, dz: best.dz,
      layer: best.layer, stackable: unit.stackable, seq: this.placed.length + 1,
      origin: [unit.l, unit.w, unit.h]
    };
    this.placed.push(rec);
    this._store(rec, unit.stackable, best.layer);
    this.weight += unit.weight;
    this._pushEP(rec);
    return rec;
  };

  /* ---------- 统计 ---------- */
  function statsOf(spec, placed) {
    var volC = spec.L * spec.W * spec.H;
    var volG = 0, wt = 0, cx = 0, cy = 0, cz = 0, i, p;
    var maxX = 0, maxY = 0, maxZ = 0;
    for (i = 0; i < placed.length; i++) {
      p = placed[i];
      volG += p.dx * p.dy * p.dz;
      wt += p.weight;
      cx += (p.x + p.dx / 2) * p.weight;
      cy += (p.y + p.dy / 2) * p.weight;
      cz += (p.z + p.dz / 2) * p.weight;
      if (p.x + p.dx > maxX) maxX = p.x + p.dx;
      if (p.y + p.dy > maxY) maxY = p.y + p.dy;
      if (p.z + p.dz > maxZ) maxZ = p.z + p.dz;
    }
    var cog = wt > 0 ? { x: cx / wt, y: cy / wt, z: cz / wt }
                     : { x: spec.L / 2, y: spec.W / 2, z: 0 };
    var devX = (cog.x - spec.L / 2) / spec.L;
    var devY = (cog.y - spec.W / 2) / spec.W;
    return {
      count: placed.length,
      volumeUsedCbm: volG / 1e9,
      volumeTotalCbm: volC / 1e9,
      volumeRate: volC ? volG / volC : 0,
      weight: wt,
      maxWeight: spec.maxWeight,
      weightRate: spec.maxWeight ? wt / spec.maxWeight : 0,
      overweight: wt > spec.maxWeight + EPS,
      freeCbm: (volC - volG) / 1e9,
      usedLength: maxX, usedWidth: maxY, usedHeight: maxZ,
      cog: cog, cogDevX: devX, cogDevY: devY,
      cogWarn: Math.abs(devX) > 0.10 || Math.abs(devY) > 0.05,
      cogLevel: (Math.abs(devX) > 0.15 || Math.abs(devY) > 0.08) ? 'danger'
              : (Math.abs(devX) > 0.10 || Math.abs(devY) > 0.05) ? 'warn' : 'ok'
    };
  }

  /* ---------- 排序策略 ---------- */
  var STRATEGIES = [
    { key: 'volume',  label: '体积降序',   fn: function (a, b) { return (b.l * b.w * b.h) - (a.l * a.w * a.h); } },
    { key: 'base',    label: '底面积降序', fn: function (a, b) { return (b.l * b.w) - (a.l * a.w) || (b.h - a.h); } },
    { key: 'maxside', label: '最长边降序', fn: function (a, b) { return Math.max(b.l, b.w, b.h) - Math.max(a.l, a.w, a.h); } },
    { key: 'height',  label: '高度降序',   fn: function (a, b) { return (b.h - a.h) || ((b.l * b.w) - (a.l * a.w)); } },
    { key: 'weight',  label: '重量降序',   fn: function (a, b) { return (b.weight - a.weight) || ((b.l * b.w * b.h) - (a.l * a.w * a.h)); } }
  ];

  function expand(cargos) {
    var units = [], i, k;
    for (i = 0; i < cargos.length; i++) {
      var c = cargos[i];
      var qty = Math.max(0, Math.floor(Number(c.qty) || 0));
      if (!(c.l > 0 && c.w > 0 && c.h > 0)) continue;
      for (k = 0; k < qty; k++) {
        units.push({
          uid: c.id + '#' + (k + 1),
          cargoId: c.id,
          name: c.name,
          nameEn: c.nameEn || '',
          ctnNo: c.ctnNo || '',
          note: c.note || '',
          l: Number(c.l), w: Number(c.w), h: Number(c.h),
          weight: Number(c.weight) || 0,
          stackable: c.stackable !== false,
          maxLayers: Number(c.maxLayers) || 0,
          rotateMode: c.rotateMode || 'upright',
          color: c.color
        });
      }
    }
    return units;
  }

  /* ---------- 单柜多方案择优 ---------- */
  function packOne(spec, units, opt) {
    var n = units.length;
    var strat = STRATEGIES;
    var modes = [true, false];             // dblFirst: 深度优先 / 贴地优先
    if (n > 200) { strat = STRATEGIES.slice(0, 3); }
    if (n > 450) { strat = STRATEGIES.slice(0, 2); modes = [true]; }
    if (n > 1200) { strat = STRATEGIES.slice(0, 1); modes = [true]; }

    var best = null;
    for (var m = 0; m < modes.length; m++) {
      for (var s = 0; s < strat.length; s++) {
        var o = Object.assign({}, opt, { dblFirst: modes[m] });
        var sorted = units.slice().sort(strat[s].fn);
        var pk = new ContainerPacker(spec, o, n + 8);
        var placed = [], left = [];
        for (var i = 0; i < sorted.length; i++) {
          var r = pk.tryPlace(sorted[i]);
          if (r) placed.push(r); else left.push(sorted[i]);
        }
        var st = statsOf(spec, placed);
        var score = placed.length * 1e6 + st.volumeRate * 1000;
        if (!best || score > best.score) {
          best = {
            score: score, placed: placed, left: left, stats: st,
            strategy: strat[s].label + ' · ' + (modes[m] ? '深度优先' : '贴地优先')
          };
        }
        if (left.length === 0 && st.volumeRate > 0.93) return best;
      }
    }
    return best;
  }

  /* ---------- 主入口 ---------- */
  function pack(cargos, spec, options) {
    var opt = Object.assign({
      supportRatio: 0.75,
      maxContainers: 20,
      multiContainer: true
    }, options || {});

    var units = expand(cargos);
    var total = units.length;

    var oversize = [], feasible = [], i, o;
    for (i = 0; i < units.length; i++) {
      var u = units[i];
      var ors = orientations(u.l, u.w, u.h, u.rotateMode);
      var ok = false;
      for (o = 0; o < ors.length; o++) {
        if (ors[o][0] <= spec.L + EPS && ors[o][1] <= spec.W + EPS && ors[o][2] <= spec.H + EPS) { ok = true; break; }
      }
      if (!ok) { u._reason = '尺寸超出柜内空间'; oversize.push(u); }
      else if (u.weight > spec.maxWeight + EPS) { u._reason = '单件重量超过柜体载重'; oversize.push(u); }
      else feasible.push(u);
    }

    var results = [], remain = feasible, guard = 0;
    while (remain.length > 0 && guard < opt.maxContainers) {
      guard++;
      var r = packOne(spec, remain, opt);
      if (!r || r.placed.length === 0) {
        for (var q = 0; q < remain.length; q++) remain[q]._reason = remain[q]._reason || '无可行摆放位置';
        break;
      }
      results.push({ index: results.length + 1, spec: spec, items: r.placed, stats: r.stats, strategy: r.strategy });
      remain = r.left;
      if (!opt.multiContainer) break;
    }
    if (opt.multiContainer && remain.length && guard >= opt.maxContainers) {
      for (var z = 0; z < remain.length; z++) remain[z]._reason = remain[z]._reason || '已达柜数上限';
    }

    var unpacked = oversize.concat(remain);
    var sumCount = 0, sumVol = 0, sumWt = 0;
    for (var c = 0; c < results.length; c++) {
      sumCount += results[c].stats.count;
      sumVol += results[c].stats.volumeUsedCbm;
      sumWt += results[c].stats.weight;
    }
    var capOne = spec.L * spec.W * spec.H / 1e9;
    return {
      containers: results,
      unpacked: unpacked,
      summary: {
        totalUnits: total,
        packedUnits: sumCount,
        unpackedUnits: unpacked.length,
        containerCount: results.length,
        totalVolumeCbm: sumVol,
        totalWeight: sumWt,
        avgVolumeRate: results.length ? sumVol / (results.length * capOne) : 0
      }
    };
  }

  /* ---------- 柜型推荐 ---------- */
  function recommend(cargos, presets) {
    var out = [];
    for (var i = 0; i < presets.length; i++) {
      var sp = presets[i];
      if (sp.id === 'LCL') continue;
      var r = pack(cargos, sp, { maxContainers: 12 });
      out.push({
        id: sp.id, name: sp.name,
        containers: r.summary.containerCount,
        rate: r.summary.avgVolumeRate,
        unpacked: r.summary.unpackedUnits
      });
    }
    out.sort(function (a, b) {
      return (a.unpacked - b.unpacked) || (a.containers - b.containers) || (b.rate - a.rate);
    });
    return out;
  }

  global.Packer = {
    pack: pack, recommend: recommend,
    orientations: orientations, statsOf: statsOf,
    STRATEGIES: STRATEGIES
  };
})(window);
