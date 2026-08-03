window.Game = {
  active: false,
  ended: false,
  score: 0,
  combo: 0,
  maxCombo: 0,
  hits: 0,
  total: 0,

  chart: null,
  spawnIdx: 0,
  notes: [],
  _at: 0,

  laneX: [-1.2, -0.4, 0.4, 1.2],
  HEIGHT: 1.8,
  SPAWN_Z: 18,
  LEAD_TIME: 1.5,
  PASS_Z: 1.2,
  SPEED: 12,
  SWING_SPEED: 2.5,
  HIT_RADIUS: 0.45,
  WINDOW: 0.15,

  init: function () {
    var scene = document.querySelector('a-scene');
    scene.setAttribute('game-tick', '');
    this.scoreEl = document.querySelector('#score');
    this.comboEl = document.querySelector('#combo');
    this.notesEl = document.querySelector('#notes');
    this.overlay = document.getElementById('overlay');
    this.overlayTitle = this.overlay.querySelector('h1');
    this.overlaySub = document.getElementById('sub');
    this.startBtn = document.getElementById('start');

    document.querySelectorAll('[hand-controls]').forEach(function (h) {
      h.addEventListener('triggerdown', function () { Game.start(); });
      h.addEventListener('gripdown', function () { Game.start(); });
    });

    try {
      scene.renderer.xr.setFoveation && scene.renderer.xr.setFoveation(1);
    } catch (e) {}

    var self = this;
    fetch('beatmaps/demo.json')
      .then(function (r) { return r.json(); })
      .then(function (json) { self.loadChart(json); })
      .catch(function (e) { console.error('beatmap load failed', e); });
  },

  loadChart: function (chart) {
    this.chart = chart;
    this.total = chart.notes.length;
    this.setStartEnabled(true);
  },

  setStartEnabled: function (enabled) {
    if (this.startBtn) this.startBtn.disabled = !enabled;
  },

  start: function () {
    if (this.active) return;
    if (!this.chart) return;
    this.active = true;
    this.ended = false;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.hits = 0;
    this.spawnIdx = 0;
    this.notes.length = 0;
    this.notesEl.innerHTML = '';
    this.overlay.classList.add('hidden');
    AudioEngine.start();
    this.updateHud();
  },

  tick: function () {
    if (!this.active || !this.chart) return;
    var at = this._at;
    var list = this.chart.notes;
    while (this.spawnIdx < list.length && list[this.spawnIdx].t <= at + this.LEAD_TIME) {
      this.spawnNote(list[this.spawnIdx++]);
    }
    if (at > AudioEngine.endTime()) this.end();
  },

  spawnNote: function (d) {
    var el = document.createElement('a-box');
    el.setAttribute('geometry', { width: 0.35, height: 0.35, depth: 0.35 });
    el.setAttribute('note', { lane: d.lane, color: d.color, time: d.t, y: d.y || this.HEIGHT });
    this.notesEl.appendChild(el);
    this.notes.push({
      el: el,
      state: 'active',
      time: d.t,
      color: d.color
    });
  },

  trySlice: function (prev, curr, color) {
    if (!this.active) return;
    var list = this.notes.slice();
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      if (n.state !== 'active') continue;
      var p = n.el.object3D.position;
      if (p.z < -1.2 || p.z > 1.2) continue;
      if (segDist(prev, curr, p) <= this.HIT_RADIUS) {
        this.slice(n);
      }
    }
  },

  slice: function (n) {
    var ms = Math.abs(this._at - n.time) * 1000;
    var pts, grade;
    if (ms <= 50) { pts = 100; grade = 'PERFECT'; }
    else if (ms <= 100) { pts = 70; grade = 'GOOD'; }
    else { pts = 40; grade = 'OK'; }
    n.state = 'sliced';
    n.el.remove();
    this.notes.splice(this.notes.indexOf(n), 1);
    this.score += pts;
    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    this.hits++;
    this.updateHud(grade);
  },

  miss: function (el) {
    var idx = -1;
    for (var i = 0; i < this.notes.length; i++) {
      if (this.notes[i].el === el) { idx = i; break; }
    }
    if (idx !== -1) {
      this.notes[idx].state = 'missed';
      this.notes.splice(idx, 1);
    }
    if (el.parentNode) el.remove();
    this.combo = 0;
    this.updateHud('MISS');
  },

  end: function () {
    this.active = false;
    this.ended = true;
    this.updateHud();
    this.overlayTitle.textContent = 'Done!';
    this.overlaySub.textContent =
      'Score ' + this.score +
      '  ·  Max Combo ' + this.maxCombo +
      '  ·  ' + this.hits + '/' + this.total + ' hits';
    this.startBtn.textContent = 'Play again';
    this.overlay.classList.remove('hidden');
  },

  updateHud: function (grade) {
    this.scoreEl.setAttribute('text', 'value', 'SCORE ' + this.score);
    this.comboEl.setAttribute('text', 'value', grade ? grade + '  COMBO ' + this.combo : '');
  }
};

function segDist(a, b, p) {
  var abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  var apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
  var l2 = abx * abx + aby * aby + abz * abz;
  var t = (apx * abx + apy * aby + apz * abz) / (l2 || 1);
  t = Math.max(0, Math.min(1, t));
  var cx = a.x + abx * t, cy = a.y + aby * t, cz = a.z + abz * t;
  return Math.hypot(p.x - cx, p.y - cy, p.z - cz);
}

AFRAME.registerComponent('game-tick', {
  tick: function () {
    Game._at = AudioEngine.time();
    Game.tick();
  }
});

window.addEventListener('load', function () {
  Game.init();
});
