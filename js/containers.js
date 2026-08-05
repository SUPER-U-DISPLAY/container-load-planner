/* ============================================================
 * containers.js  —  集装箱规格库
 * 所有尺寸为「内尺寸」，单位 mm；载重单位 kg
 * ============================================================ */
(function (global) {
  'use strict';

  var PRESETS = [
    { id: '20GP',  name: '20 尺标准柜 (20GP)',      L: 5898,  W: 2352, H: 2393, maxWeight: 28080, tare: 2200 },
    { id: '20HQ',  name: '20 尺高柜 (20HQ)',        L: 5898,  W: 2352, H: 2698, maxWeight: 28000, tare: 2400 },
    { id: '40GP',  name: '40 尺标准柜 (40GP)',      L: 12032, W: 2352, H: 2393, maxWeight: 26700, tare: 3800 },
    { id: '40HQ',  name: '40 尺高柜 (40HQ)',        L: 12032, W: 2352, H: 2698, maxWeight: 26460, tare: 3940 },
    { id: '45HQ',  name: '45 尺高柜 (45HQ)',        L: 13556, W: 2352, H: 2698, maxWeight: 27600, tare: 4800 },
    { id: '53HQ',  name: '53 尺高柜 (53HQ)',        L: 16154, W: 2500, H: 2695, maxWeight: 30000, tare: 5000 },
    { id: '20RF',  name: '20 尺冷藏柜 (20RF)',      L: 5449,  W: 2290, H: 2244, maxWeight: 27400, tare: 3080 },
    { id: '40RH',  name: '40 尺冷高柜 (40RH)',      L: 11577, W: 2286, H: 2249, maxWeight: 29520, tare: 4800 },
    { id: 'LCL',   name: '散货 / 拼箱托盘位',        L: 1200,  W: 1000, H: 1800, maxWeight: 1000,  tare: 25   }
  ];

  function volumeCbm(c) {
    return (c.L * c.W * c.H) / 1e9;
  }

  function byId(id) {
    for (var i = 0; i < PRESETS.length; i++) {
      if (PRESETS[i].id === id) return JSON.parse(JSON.stringify(PRESETS[i]));
    }
    return null;
  }

  global.ContainerLib = {
    PRESETS: PRESETS,
    byId: byId,
    volumeCbm: volumeCbm
  };
})(window);
