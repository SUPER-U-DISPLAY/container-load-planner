/* ============================================================
 * sample.js  —  内置示例数据
 * ============================================================ */
(function (global) {
  'use strict';

  var P = window.Importer.PALETTE;
  function C(i) { return P[i % P.length]; }

  function mk(i, o) {
    return {
      id: 'S' + i,
      itemNo: i + 1,
      name: o.name,
      nameEn: o.nameEn || '',
      ctnNo: o.ctnNo || String(i + 1),
      l: o.l, w: o.w, h: o.h,
      weight: o.weight,
      qty: o.qty,
      pcsPerCtn: o.pcs || 1,
      stackable: o.stackable !== false,
      maxLayers: o.maxLayers || 0,
      rotateMode: o.rot || 'upright',
      color: C(i),
      note: o.note || '',
      pending: !(o.l > 0 && o.w > 0 && o.h > 0)
    };
  }

  var QATAR = [
    { name: '接待台：柜体',            ctnNo: '1',    l: 3450, w: 980, h: 1570, qty: 1, weight: 546.742, pcs: 1,  stackable: false, note: '含LOGO,变压器，柜外配PVC管现场用' },
    { name: '接待台：内嵌柜',          ctnNo: '2',    l: 1730, w: 780, h: 490,  qty: 1, weight: 68.104,  pcs: 1 },
    { name: '地柜：左弧形柜',          ctnNo: '3',    l: 680,  w: 530, h: 1030, qty: 1, weight: 38.235,  pcs: 1 },
    { name: '地柜：中间柜',            ctnNo: '4',    l: 2760, w: 530, h: 1030, qty: 1, weight: 155.188, pcs: 1 },
    { name: '地柜：右弧形柜',          ctnNo: '5',    l: 1960, w: 910, h: 1030, qty: 1, weight: 189.222, pcs: 1 },
    { name: '地柜墙面板2套 / 墙架2一套', ctnNo: '6',   l: 2700, w: 200, h: 1300, qty: 1, weight: 72.306,  pcs: 3, note: '含变压器' },
    { name: '墙架1(拆装)',             ctnNo: '7',    l: 2270, w: 520, h: 1120, qty: 1, weight: 136.171, pcs: 13, note: '中间背板大5件&1，左右小2件，导电T柱6件' },
    { name: '墙架1(拆装)',             ctnNo: '8-9',  l: 1520, w: 730, h: 860,  qty: 2, weight: 98.288,  pcs: 1, note: '左右地柜（含变压器）' },
    { name: '墙架1(拆装)',             ctnNo: '10',   l: 2020, w: 730, h: 860,  qty: 1, weight: 130.620, pcs: 1, note: '中间地柜' },
    { name: '墙架1(拆装)',             ctnNo: '11',   l: 1000, w: 550, h: 1150, qty: 1, weight: 65.148,  pcs: 15, note: '层板12件，挂杆3件' },
    { name: '墙面LOGO牌',              ctnNo: '12',   l: 0,    w: 0,   h: 0,    qty: 1, weight: 0,       pcs: 1, note: '箱子尺寸待定' },
    { name: '吊柜',                    ctnNo: '13',   l: 2550, w: 880, h: 1700, qty: 1, weight: 392.924, pcs: 1, stackable: false },
    { name: '立体墙灯布',              ctnNo: '14',   l: 0,    w: 0,   h: 0,    qty: 1, weight: 0,       pcs: 1, note: '箱子尺寸待定' },
    { name: '配件箱',                  ctnNo: '15',   l: 330,  w: 300, h: 200,  qty: 1, weight: 2.039,   pcs: 41, note: '安装所需螺丝配件；墙架2挂钩40件' }
  ];

  var GENERAL = [
    { name: '大纸箱 A',   nameEn: 'Carton A', l: 1200, w: 800, h: 900, qty: 12, weight: 120, rot: 'upright' },
    { name: '中纸箱 B',   nameEn: 'Carton B', l: 800,  w: 600, h: 600, qty: 24, weight: 45,  rot: 'free' },
    { name: '小纸箱 C',   nameEn: 'Carton C', l: 600,  w: 400, h: 400, qty: 40, weight: 18,  rot: 'free' },
    { name: '木托盘货 D', nameEn: 'Pallet D', l: 1200, w: 1000, h: 1400, qty: 6, weight: 620, stackable: false, note: '不可压顶' },
    { name: '长条箱 E',   nameEn: 'Long Box', l: 2400, w: 300, h: 300, qty: 10, weight: 60,  rot: 'upright' }
  ];

  function build(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) out.push(mk(i, list[i]));
    return out;
  }

  global.SampleData = {
    qatar: function () { return build(QATAR); },
    general: function () { return build(GENERAL); },
    QATAR_TITLE: '卡塔尔宠物医院订单3（内置装箱单示例）',
    GENERAL_TITLE: '通用混装示例'
  };
})(window);
