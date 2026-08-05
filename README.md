# 集装箱装柜排柜模拟系统

纯前端、零后端、可离线的集装箱装箱排柜 3D 计算器。参考 SeaRates Load Calculator。

## 功能
- 货物录入（长/宽/高、重量、数量、可否堆叠、摆放方向、颜色），支持 Excel 一键导入
- 极点法装箱算法：自动计算最优摆放、多柜分配、体积/载重/重心校验
- Three.js 3D 可视化：拖拽旋转/缩放/平移、标准视角切换、装柜顺序播放
- 统计面板（利用率/载重/重心/未装入清单）+ PNG/PDF 导出

## 本地离线使用
下载项目后**双击 `index.html`** 即可运行，需搭配本地 `js/vendor/` 中的库文件，完全离线。
本 GitHub Pages 在线版通过 CDN 加载 three.js / SheetJS / jsPDF，首次加载需联网。

## 部署（GitHub Pages）
仓库 Settings → Pages → Source 选 `main` 分支、`/root` 目录 → Save，1~2 分钟后生效。

## 一键导入模板
顶栏「导入装箱单」选择 Excel 装箱清单，即可自动解析并生成 3D 装柜模拟图。
