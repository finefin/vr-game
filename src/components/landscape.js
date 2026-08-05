(function () {
  var STEP = 2.5;
  var X_HALF = 80;
  var Z_START = -150;
  var Z_END = 30;
  var FLAT_HALF = 12;
  var RISE = 60;
  var MAXH = 34;

  var FLAT = new THREE.Color(0x00f6ff);
  var PEAK = new THREE.Color(0xff2bd6);

  AFRAME.registerComponent('landscape', {
    schema: {
      speed: { type: 'number', default: 14 }
    },

    init: function () {
      this._offset = 0;

      function makeNoise(step) {
        var n = Math.ceil((2 * X_HALF) / step) + 3;
        var pts = [];
        for (var i = 0; i < n; i++) pts.push(Math.random());
        return function (x) {
          var u = (x + X_HALF) / step;
          var i = Math.floor(u);
          var f = u - i;
          if (i < 0) i = 0;
          else if (i > pts.length - 2) i = pts.length - 2;
          f = f * f * (3 - 2 * f);
          return pts[i] + (pts[i + 1] - pts[i]) * f;
        };
      }

      var coarse = makeNoise(7);
      var fine = makeNoise(2.5);

      function terrainY(x) {
        var d = Math.abs(x);
        if (d <= FLAT_HALF) return 0;
        var t = (d - FLAT_HALF) / (RISE - FLAT_HALF);
        if (t > 1) t = 1;
        var n = 0.55 * coarse(x) + 0.45 * fine(x);
        return t * t * MAXH * (0.25 + 0.75 * n);
      }

      var xs = [], zs = [];
      var x, z;
      for (x = -X_HALF; x <= X_HALF; x += STEP) xs.push(x);
      for (z = Z_START; z <= Z_END; z += STEP) zs.push(z);

      var pos = [];
      var col = [];
      var c = new THREE.Color();
      var i, j, x0, x1, yA, yB;

      function pushColor(y) {
        var t = Math.min(1, Math.max(0, y / MAXH));
        c.copy(FLAT).lerp(PEAK, t);
        col.push(c.r, c.g, c.b);
      }

      for (j = 0; j < zs.length; j++) {
        for (i = 0; i < xs.length - 1; i++) {
          x0 = xs[i];
          x1 = xs[i + 1];
          yA = terrainY(x0);
          yB = terrainY(x1);
          pos.push(x0, yA, zs[j], x1, yB, zs[j]);
          pushColor(yA);
          pushColor(yB);
        }
      }

      for (i = 0; i < xs.length; i++) {
        x0 = xs[i];
        for (j = 0; j < zs.length - 1; j++) {
          yA = terrainY(x0);
          pos.push(x0, yA, zs[j], x0, yA, zs[j + 1]);
          pushColor(yA);
          pushColor(yA);
        }
      }

      var ggeo = new THREE.BufferGeometry();
      ggeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      ggeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      var gmat = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      this.grid = new THREE.LineSegments(ggeo, gmat);
      this.el.object3D.add(this.grid);

      this.sun = new THREE.LineSegments(
        new THREE.WireframeGeometry(new THREE.SphereGeometry(6, 24, 12)),
        new THREE.LineBasicMaterial({
          color: 0xff2bd6,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
      );
      this.sun.position.set(0, 10, -140);
      this.el.object3D.add(this.sun);
    },

    tick: function (t, dt) {
      var speed = this.data.speed;
      this._offset += speed * dt / 1000;
      this.grid.position.z = this._offset % STEP;
      this.sun.rotation.y += dt / 1000 * 0.05;
    }
  });
})();
