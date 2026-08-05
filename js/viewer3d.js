/* ============================================================
 * viewer3d.js  —  集装箱三维可视化
 * 依赖：three.min.js (r128) + OrbitControls.js
 *
 * 坐标映射：装箱坐标 (x=长, y=宽, z=高)  →  Three (x, z, y)
 * ============================================================ */
(function (global) {
  'use strict';

  var MM = 0.001; // mm → m

  function makeLabelSprite(text, color, scalePx) {
    var pad = 12, fs = 64;
    var cv = document.createElement('canvas');
    var ctx = cv.getContext('2d');
    ctx.font = 'bold ' + fs + 'px "Microsoft YaHei",sans-serif';
    var w = Math.ceil(ctx.measureText(text).width) + pad * 2;
    var h = fs + pad * 2;
    cv.width = w; cv.height = h;
    ctx = cv.getContext('2d');
    ctx.font = 'bold ' + fs + 'px "Microsoft YaHei",sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.strokeStyle = color || '#333';
    ctx.lineWidth = 4;
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(2, 2, w - 4, h - 4, 14); ctx.fill(); ctx.stroke(); }
    else { ctx.fillRect(0, 0, w, h); ctx.strokeRect(2, 2, w - 4, h - 4); }
    ctx.fillStyle = color || '#333';
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.fillText(text, w / 2, h / 2);
    var tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.LinearFilter;
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    var s = (scalePx || 0.5);
    sp.scale.set(w / h * s, s, 1);
    sp.renderOrder = 999;
    return sp;
  }

  function Viewer(canvas) {
    this.canvas = canvas;
    this.onSelect = null;

    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf2f5f9);
    this.scene = scene;

    var camera = new THREE.PerspectiveCamera(45, 1, 0.05, 500);
    camera.position.set(12, 9, 12);
    this.camera = camera;

    var renderer = new THREE.WebGLRenderer({
      canvas: canvas, antialias: true, preserveDrawingBuffer: true, alpha: false
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer = renderer;

    var controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.minDistance = 0.6;
    controls.maxDistance = 120;
    this.controls = controls;

    scene.add(new THREE.AmbientLight(0xffffff, 0.72));
    var d1 = new THREE.DirectionalLight(0xffffff, 0.55); d1.position.set(1, 2, 1.2); scene.add(d1);
    var d2 = new THREE.DirectionalLight(0xffffff, 0.30); d2.position.set(-1.4, 1.1, -1); scene.add(d2);
    var d3 = new THREE.DirectionalLight(0xffffff, 0.18); d3.position.set(0.4, -1, 0.6); scene.add(d3);

    this.grid = new THREE.GridHelper(60, 60, 0xc4ccd8, 0xe2e8f0);
    this.grid.position.y = -0.005;
    scene.add(this.grid);

    this.root = new THREE.Group();      // 整柜（已居中）
    scene.add(this.root);
    this.shellGroup = new THREE.Group();
    this.cargoGroup = new THREE.Group();
    this.labelGroup = new THREE.Group();
    this.root.add(this.shellGroup, this.cargoGroup, this.labelGroup);

    this.meshes = [];
    this.selected = null;
    this.highlight = null;
    this.spec = null;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this._bindPick();

    var self = this;
    this._loop = function () {
      self._raf = requestAnimationFrame(self._loop);
      controls.update();
      renderer.render(scene, camera);
    };
    this.resize();
    this._loop();
    window.addEventListener('resize', function () { self.resize(); });
  }

  Viewer.prototype.resize = function () {
    var el = this.canvas.parentElement;
    var w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  Viewer.prototype._bindPick = function () {
    var self = this, downPos = null;
    this.canvas.addEventListener('pointerdown', function (e) { downPos = { x: e.clientX, y: e.clientY }; });
    this.canvas.addEventListener('pointerup', function (e) {
      if (!downPos) return;
      if (Math.abs(e.clientX - downPos.x) > 4 || Math.abs(e.clientY - downPos.y) > 4) return;
      var rect = self.canvas.getBoundingClientRect();
      self.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      self.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      self.raycaster.setFromCamera(self.pointer, self.camera);
      var vis = self.meshes.filter(function (m) { return m.visible; });
      var hits = self.raycaster.intersectObjects(vis, false);
      if (hits.length) self.select(hits[0].object.userData.item);
      else self.select(null);
    });
  };

  /* ---------- 构建场景 ---------- */
  Viewer.prototype.build = function (spec, items) {
    var i;
    this.spec = spec;
    while (this.shellGroup.children.length) this.shellGroup.remove(this.shellGroup.children[0]);
    while (this.cargoGroup.children.length) this.cargoGroup.remove(this.cargoGroup.children[0]);
    while (this.labelGroup.children.length) this.labelGroup.remove(this.labelGroup.children[0]);
    this.meshes = [];
    this.selected = null;
    this.highlight = null;

    var L = spec.L * MM, W = spec.W * MM, H = spec.H * MM;
    this.dims = { L: L, W: W, H: H };
    this.root.position.set(-L / 2, 0, -W / 2);

    /* 柜体外壳：五面半透明 + 线框 */
    var shellMat = new THREE.MeshPhongMaterial({
      color: 0x8fa6c4, transparent: true, opacity: 0.10,
      side: THREE.DoubleSide, depthWrite: false
    });
    var shell = new THREE.Mesh(new THREE.BoxGeometry(L, H, W), shellMat);
    shell.position.set(L / 2, H / 2, W / 2);
    this.shellGroup.add(shell);
    this.shellMesh = shell;

    var edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(L, H, W)),
      new THREE.LineBasicMaterial({ color: 0x2c3e50, linewidth: 2 })
    );
    edges.position.set(L / 2, H / 2, W / 2);
    this.shellGroup.add(edges);
    this.shellEdges = edges;

    /* 柜底板 */
    var floor = new THREE.Mesh(
      new THREE.BoxGeometry(L, 0.012, W),
      new THREE.MeshPhongMaterial({ color: 0xb0895e })
    );
    floor.position.set(L / 2, -0.006, W / 2);
    this.shellGroup.add(floor);

    /* 柜门标识（x = L 端） */
    var doorMat = new THREE.MeshBasicMaterial({ color: 0xe74c3c, transparent: true, opacity: 0.22, side: THREE.DoubleSide });
    var door = new THREE.Mesh(new THREE.PlaneGeometry(W, H), doorMat);
    door.rotation.y = Math.PI / 2;
    door.position.set(L + 0.002, H / 2, W / 2);
    this.shellGroup.add(door);

    /* 尺寸标签 */
    var scaleLab = Math.max(0.22, Math.min(L, 14) * 0.045);
    var lbL = makeLabelSprite('长 ' + spec.L + ' mm', '#2c3e50', scaleLab);
    lbL.position.set(L / 2, -0.32, -0.22); this.labelGroup.add(lbL);
    var lbW = makeLabelSprite('宽 ' + spec.W + ' mm', '#2c3e50', scaleLab);
    lbW.position.set(-0.35, -0.32, W / 2); this.labelGroup.add(lbW);
    var lbH = makeLabelSprite('高 ' + spec.H + ' mm', '#2c3e50', scaleLab);
    lbH.position.set(-0.35, H / 2, -0.15); this.labelGroup.add(lbH);
    var lbD = makeLabelSprite('柜门', '#e74c3c', scaleLab);
    lbD.position.set(L + 0.35, H * 0.5, W / 2); this.labelGroup.add(lbD);

    /* 货物 */
    for (i = 0; i < items.length; i++) {
      var it = items[i];
      var g = new THREE.BoxGeometry(it.dx * MM, it.dz * MM, it.dy * MM);
      var mat = new THREE.MeshPhongMaterial({
        color: new THREE.Color(it.color || '#3498db'),
        transparent: true, opacity: 0.94, shininess: 24
      });
      var mesh = new THREE.Mesh(g, mat);
      mesh.position.set(
        (it.x + it.dx / 2) * MM,
        (it.z + it.dz / 2) * MM,
        (it.y + it.dy / 2) * MM
      );
      mesh.userData.item = it;
      mesh.userData.baseOpacity = 0.94;
      this.cargoGroup.add(mesh);
      this.meshes.push(mesh);

      var wire = new THREE.LineSegments(
        new THREE.EdgesGeometry(g),
        new THREE.LineBasicMaterial({ color: 0x1b2430, transparent: true, opacity: 0.55 })
      );
      wire.position.copy(mesh.position);
      mesh.userData.wire = wire;
      this.cargoGroup.add(wire);
    }

    this.setView('iso');
    return this;
  };

  /* ---------- 视角 ---------- */
  Viewer.prototype.setView = function (mode) {
    if (!this.dims) return;
    var L = this.dims.L, W = this.dims.W, H = this.dims.H;
    var r = Math.max(L, W, H);
    var c = this.controls, cam = this.camera;
    c.target.set(0, H / 2, 0);
    switch (mode) {
      case 'top':    cam.position.set(0.001, r * 1.5, 0); break;
      case 'front':  cam.position.set(0, H / 2, r * 1.35); break;  // 侧面(长边)
      case 'side':   cam.position.set(r * 1.35, H / 2, 0); break;  // 柜门方向
      case 'back':   cam.position.set(-r * 1.35, H / 2, 0); break;
      case 'iso2':   cam.position.set(-r * 0.85, r * 0.62, -r * 0.75); break;
      default:       cam.position.set(r * 0.85, r * 0.62, r * 0.75); break;
    }
    cam.updateProjectionMatrix();
    c.update();
  };

  Viewer.prototype.fit = function () { this.setView('iso'); };

  /* ---------- 外壳显示模式 ---------- */
  Viewer.prototype.setShellMode = function (mode) {
    if (!this.shellMesh) return;
    if (mode === 'hidden') {
      this.shellGroup.visible = false;
    } else {
      this.shellGroup.visible = true;
      this.shellMesh.visible = (mode !== 'wire');
      if (mode === 'solid') this.shellMesh.material.opacity = 0.32;
      else this.shellMesh.material.opacity = 0.10;
    }
  };
  Viewer.prototype.setGrid = function (on) { this.grid.visible = !!on; };
  Viewer.prototype.setLabels = function (on) { this.labelGroup.visible = !!on; };

  /* ---------- 分步显示 ---------- */
  Viewer.prototype.showUpTo = function (n) {
    for (var i = 0; i < this.meshes.length; i++) {
      var m = this.meshes[i];
      var on = m.userData.item.seq <= n;
      m.visible = on;
      if (m.userData.wire) m.userData.wire.visible = on;
    }
  };

  /* ---------- 按货物类型过滤 ---------- */
  Viewer.prototype.filterCargo = function (cargoId) {
    for (var i = 0; i < this.meshes.length; i++) {
      var m = this.meshes[i];
      var hit = !cargoId || m.userData.item.cargoId === cargoId;
      m.material.opacity = hit ? m.userData.baseOpacity : 0.12;
      if (m.userData.wire) m.userData.wire.material.opacity = hit ? 0.55 : 0.06;
    }
  };

  /* ---------- 选中 ---------- */
  Viewer.prototype.select = function (item) {
    if (this.highlight) { this.root.remove(this.highlight); this.highlight = null; }
    this.selected = item || null;
    if (item) {
      var g = new THREE.BoxGeometry(item.dx * MM * 1.008, item.dz * MM * 1.008, item.dy * MM * 1.008);
      var hl = new THREE.LineSegments(
        new THREE.EdgesGeometry(g),
        new THREE.LineBasicMaterial({ color: 0xffd400, linewidth: 3 })
      );
      hl.position.set((item.x + item.dx / 2) * MM, (item.z + item.dz / 2) * MM, (item.y + item.dy / 2) * MM);
      hl.renderOrder = 998;
      hl.material.depthTest = false;
      this.root.add(hl);
      this.highlight = hl;
    }
    if (this.onSelect) this.onSelect(item);
  };

  Viewer.prototype.selectBySeq = function (seq) {
    for (var i = 0; i < this.meshes.length; i++) {
      if (this.meshes[i].userData.item.seq === seq) { this.select(this.meshes[i].userData.item); return; }
    }
  };

  /* ---------- 截图 ---------- */
  Viewer.prototype.snapshot = function (scale) {
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL('image/png');
  };

  global.Viewer3D = Viewer;
})(window);
