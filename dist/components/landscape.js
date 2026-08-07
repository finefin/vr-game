(function () {
  var STEP = 2.5;
  var X_HALF = 80;
  var Z_START = -150;
  var Z_END = 30;

  // Grid floor is flat (no terrain bumps) — a pure perspective grid, brighter
  // near the player and fading toward the horizon.
  var GRID_NEAR = new THREE.Color(0xff36c8);
  var GRID_FAR = new THREE.Color(0x3a1568);

  var SUN_POS = { x: 0, y: 9, z: -132 };
  var SUN_RADIUS = 9;

  // Canyon walls flanking the flight path. FLAT_HALF is the clear corridor
  // the player flies down (must stay well outside note lane range, ±1.2);
  // beyond it the walls rise, height driven by the song's own waveform. The
  // whole mesh is baked once for the full song, with world Z encoding song
  // time exactly like notes do (z = SPEED*(at - time)) — see tick(), which
  // just translates the group by elapsed time. No per-frame rebuilding.
  var WALL_STEP_X = 5;
  var WALL_STEP_Z = 4;
  var WALL_FLAT_HALF = 12;
  var WALL_RISE = 60;
  var WALL_MAXH = 30;
  var WALL_MAX_ROWS = 2500;
  var WALL_FLAT = new THREE.Color(0x00f6ff);
  var WALL_PEAK = new THREE.Color(0xff2bd6);
  // Rows within this many neighbors get averaged together before normalizing,
  // so a single loud drum hit reads as part of a hill/mountain rather than a
  // one-row needle spike.
  var WALL_SMOOTH_RADIUS = 2;
  // >1 pushes mid-loudness rows down, so "loud" reads as clearly taller than
  // "medium" rather than the two blending together.
  var WALL_GAMMA = 1.5;

  // Smoothed noise over [0, duration] seconds — used only as a stand-in for
  // the real waveform before any song has loaded.
  function makeTimeNoise(stepSec, durationSec) {
    var n = Math.ceil(durationSec / stepSec) + 3;
    var pts = [];
    for (var i = 0; i < n; i++) pts.push(Math.random());
    return function (tSec) {
      var u = tSec / stepSec;
      var i2 = Math.floor(u);
      var f = u - i2;
      if (i2 < 0) i2 = 0;
      else if (i2 > pts.length - 2) i2 = pts.length - 2;
      f = f * f * (3 - 2 * f);
      return pts[i2] + (pts[i2 + 1] - pts[i2]) * f;
    };
  }

  // Classic retro sun: a vertical gradient from pale yellow into magenta, with
  // horizontal bands cut out of the lower half that widen further down.
  function makeSunTexture() {
    var size = 256;
    var canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    var ctx = canvas.getContext('2d');

    var grad = ctx.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, '#fff6c8');
    grad.addColorStop(0.32, '#ffcf3d');
    grad.addColorStop(0.58, '#ff7a3d');
    grad.addColorStop(0.82, '#ff2bd6');
    grad.addColorStop(1, '#7d1fae');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    ctx.globalCompositeOperation = 'destination-out';
    var y = size * 0.44;
    var idx = 0;
    while (y < size) {
      var h = 3 + idx * 1.1;
      ctx.fillRect(0, y, size, h);
      y += h + 5 + idx * 0.7;
      idx++;
    }
    ctx.globalCompositeOperation = 'source-over';

    var tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace || tex.colorSpace;
    return tex;
  }

  function makeGlowTexture() {
    var size = 128;
    var canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    var ctx = canvas.getContext('2d');
    var grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,150,220,0.55)');
    grad.addColorStop(0.45, 'rgba(255,90,210,0.22)');
    grad.addColorStop(1, 'rgba(255,90,210,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
  }

  function buildGrid() {
    var xs = [], zs = [];
    var x, z;
    for (x = -X_HALF; x <= X_HALF; x += STEP) xs.push(x);
    for (z = Z_START; z <= Z_END; z += STEP) zs.push(z);

    var pos = [], col = [];
    var c = new THREE.Color();
    var i, j;

    function pushColor(zv) {
      var t = Math.min(1, Math.max(0, (zv - Z_START) / (Z_END - Z_START)));
      c.copy(GRID_FAR).lerp(GRID_NEAR, t);
      col.push(c.r, c.g, c.b);
    }

    for (j = 0; j < zs.length; j++) {
      for (i = 0; i < xs.length - 1; i++) {
        pos.push(xs[i], 0, zs[j], xs[i + 1], 0, zs[j]);
        pushColor(zs[j]);
        pushColor(zs[j]);
      }
    }
    for (i = 0; i < xs.length; i++) {
      for (j = 0; j < zs.length - 1; j++) {
        pos.push(xs[i], 0, zs[j], xs[i], 0, zs[j + 1]);
        pushColor(zs[j]);
        pushColor(zs[j + 1]);
      }
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    var mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    return new THREE.LineSegments(geo, mat);
  }

  // Smoothed, per-song-normalized amplitude for every row of the canyon: the
  // real waveform when a song is loaded, renormalized so THIS song's own
  // quietest moment maps to 0 (flat land) and its loudest to 1 (full peak
  // height) — otherwise a song that's loud throughout would never show real
  // valleys, and a quiet one would never reach the peak height at all.
  // Falls back to smooth noise before any audio has loaded. `dt` is the
  // seconds each row represents (row spacing / speed).
  function wallAmplitude(rows, dt) {
    var raw = window.AudioEngine && window.AudioEngine.waveform
      ? window.AudioEngine.waveform(rows)
      : null;

    if (!raw) {
      var duration = rows * dt;
      var n1 = makeTimeNoise(1.3, duration);
      var n2 = makeTimeNoise(0.4, duration);
      raw = new Float32Array(rows);
      for (var r = 0; r < rows; r++) {
        raw[r] = 0.6 * n1(r * dt) + 0.4 * n2(r * dt);
      }
    }

    // Box-smooth over neighboring rows so a single loud hit doesn't spike
    // alone — reads as a hill/mountain instead of a needle.
    var smoothed = new Float32Array(rows);
    var i, k, sum, n;
    for (i = 0; i < rows; i++) {
      sum = 0; n = 0;
      for (k = Math.max(0, i - WALL_SMOOTH_RADIUS); k <= Math.min(rows - 1, i + WALL_SMOOTH_RADIUS); k++) {
        sum += raw[k]; n++;
      }
      smoothed[i] = sum / n;
    }

    var min = Infinity, max = -Infinity;
    for (i = 0; i < rows; i++) {
      if (smoothed[i] < min) min = smoothed[i];
      if (smoothed[i] > max) max = smoothed[i];
    }
    var range = max - min || 1;

    var out = new Float32Array(rows);
    for (i = 0; i < rows; i++) {
      out[i] = Math.pow((smoothed[i] - min) / range, WALL_GAMMA);
    }
    return out;
  }

  // Builds the whole song's canyon walls in one shot. Local Z encodes song
  // time directly (row i sits at localZ = -WALL_STEP_Z*i, i.e. i*dt seconds
  // into the song); tick() then sets the group's position.z = SPEED*at each
  // frame, which reproduces exactly the note formula z = SPEED*(at-time) for
  // every row simultaneously — see the tick() comment for the derivation.
  function buildWalls(speed) {
    var dt = WALL_STEP_Z / speed;
    var duration = window.AudioEngine ? window.AudioEngine.endTime() : 20;
    var rows = Math.min(WALL_MAX_ROWS, Math.ceil(duration / dt) + 2);
    var heights = wallAmplitude(rows, dt);

    var xs = [];
    var x;
    for (x = -X_HALF; x <= X_HALF; x += WALL_STEP_X) xs.push(x);

    function envelope(xv) {
      var d = Math.abs(xv);
      if (d <= WALL_FLAT_HALF) return 0;
      var t = Math.min(1, (d - WALL_FLAT_HALF) / WALL_RISE);
      return t * t;
    }

    var pos = [], col = [];
    var c = new THREE.Color();
    var i, j, z0, z1, xv, h;

    function pushColor(hv) {
      var t = Math.min(1, hv / WALL_MAXH);
      c.copy(WALL_FLAT).lerp(WALL_PEAK, t);
      col.push(c.r, c.g, c.b);
    }

    function heightAt(xv, rowIdx) {
      return envelope(xv) * WALL_MAXH * heights[rowIdx];
    }

    for (j = 0; j < rows; j++) {
      z0 = -WALL_STEP_Z * j;
      for (i = 0; i < xs.length - 1; i++) {
        h = heightAt(xs[i], j);
        var h2 = heightAt(xs[i + 1], j);
        pos.push(xs[i], h, z0, xs[i + 1], h2, z0);
        pushColor(h); pushColor(h2);
      }
    }
    for (i = 0; i < xs.length; i++) {
      xv = xs[i];
      for (j = 0; j < rows - 1; j++) {
        z0 = -WALL_STEP_Z * j;
        z1 = -WALL_STEP_Z * (j + 1);
        h = heightAt(xv, j);
        var h3 = heightAt(xv, j + 1);
        pos.push(xv, h, z0, xv, h3, z1);
        pushColor(h); pushColor(h3);
      }
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    var mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    return new THREE.LineSegments(geo, mat);
  }

  function disposeWalls(mesh) {
    mesh.geometry.dispose();
    mesh.material.dispose();
  }

  function buildSun() {
    var group = new THREE.Group();

    var glow = new THREE.Mesh(
      new THREE.CircleGeometry(SUN_RADIUS * 2.6, 32),
      new THREE.MeshBasicMaterial({
        map: makeGlowTexture(), transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, fog: false
      })
    );
    glow.position.set(SUN_POS.x, SUN_POS.y, SUN_POS.z + 0.5);
    group.add(glow);

    var disc = new THREE.Mesh(
      new THREE.CircleGeometry(SUN_RADIUS, 48),
      new THREE.MeshBasicMaterial({ map: makeSunTexture(), transparent: true, depthWrite: false, fog: false })
    );
    disc.position.set(SUN_POS.x, SUN_POS.y, SUN_POS.z);
    group.add(disc);

    group.userData.glow = glow;
    return group;
  }

  function buildStars() {
    var count = 500;
    var positions = new Float32Array(count * 3);
    for (var i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 320;
      positions[i * 3 + 1] = 18 + Math.random() * 130;
      positions[i * 3 + 2] = -40 - Math.random() * 280;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    var mat = new THREE.PointsMaterial({
      color: 0xffffff, size: 0.55, sizeAttenuation: true,
      transparent: true, opacity: 0.8, fog: false
    });
    return new THREE.Points(geo, mat);
  }

  AFRAME.registerComponent('landscape', {
    schema: {
      speed: { type: 'number', default: 14 }
    },

    init: function () {
      this._offset = 0;
      this._t = 0;
      this._wallSongVersion = window.AudioEngine && window.AudioEngine.songVersion
        ? window.AudioEngine.songVersion() : -1;

      this.grid = buildGrid();
      this.el.object3D.add(this.grid);

      this.walls = buildWalls(this.data.speed);
      this.el.object3D.add(this.walls);

      this.sun = buildSun();
      this.el.object3D.add(this.sun);

      this.stars = buildStars();
      this.el.object3D.add(this.stars);
    },

    tick: function (t, dt) {
      var speed = this.data.speed;
      this._offset += speed * dt / 1000;
      this._t += dt / 1000;
      this.grid.position.z = this._offset % STEP;

      // Rebuild the walls whenever a new song loads, so the canyon always
      // matches whatever is about to play.
      var av = window.AudioEngine && window.AudioEngine.songVersion ? window.AudioEngine.songVersion() : -1;
      if (av !== this._wallSongVersion) {
        this._wallSongVersion = av;
        this.el.object3D.remove(this.walls);
        disposeWalls(this.walls);
        this.walls = buildWalls(speed);
        this.el.object3D.add(this.walls);
      }

      // Row i of the walls sits at local z = -WALL_STEP_Z*i, i.e. i*dt seconds
      // into the song (dt = WALL_STEP_Z/speed). We want it to appear at world
      // z = SPEED*(at - i*dt) — the same formula notes use. Setting the whole
      // group's position.z = SPEED*at satisfies that for every row at once:
      // worldZ = speed*at + localZ = speed*at - WALL_STEP_Z*i
      //        = speed*(at - i*dt)  since WALL_STEP_Z*i = speed*dt*i = speed*(i*dt).
      var at = window.AudioEngine ? window.AudioEngine.time() : 0;
      this.walls.position.z = speed * at;

      var glow = this.sun.userData.glow;
      if (glow) glow.material.opacity = 0.85 + 0.15 * Math.sin(this._t * 0.6);
    }
  });
})();
