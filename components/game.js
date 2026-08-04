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
  songName: 'beatmap',
  demos: [],
  demoIdx: -1,

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
    this.demoSel = document.getElementById('demo');
    this.analyzeBtn = document.getElementById('analyze');
    this.demoSel.addEventListener('change', function () { Game.loadDemo(); });
    this.analyzeBtn.addEventListener('click', function () { Game.startAnalysis(); });

    document.querySelectorAll('[hand-controls]').forEach(function (h) {
      h.addEventListener('triggerdown', function () { Game.start(); });
      h.addEventListener('gripdown', function () { Game.start(); });
    });

    try {
      scene.renderer.xr.setFoveation && scene.renderer.xr.setFoveation(1);
    } catch (e) {}

    var self = this;
    fetch('beatmaps/manifest.json?t=' + Date.now())
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (manifest) { self.loadManifest(manifest); })
      .catch(function (e) {
        console.error('manifest load failed', e);
        self.loadChartFallback();
      });
  },

  loadManifest: function (manifest) {
    this.demos = manifest.demos || (Array.isArray(manifest) ? manifest : []);
    this.demoSel.innerHTML = '';
    var self = this;
    this.demos.forEach(function (d, i) {
      var opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = d.name || d.audio;
      self.demoSel.appendChild(opt);
    });
    console.log('[Game] demos loaded:', this.demos.map(function (d) {
      return (d.name || d.audio) + ' -> chart ' + (d.chart || 'NONE');
    }));
    if (this.demos.length) {
      this.demoSel.value = '0';
      this.loadDemo();
    } else {
      this.loadChartFallback();
    }
  },

  loadDemo: function () {
    var i = parseInt(this.demoSel.value, 10);
    var d = this.demos[i];
    if (!d || i === this.demoIdx) return;
    this.demoIdx = i;
    this.songName = d.name || d.audio.replace(/\.[^.]+$/, '');
    var url = 'beatmaps/' + d.audio;
    this.chart = null;
    this.setStartEnabled(false);
    this.setAnalyzeEnabled(false);
    this.setStatus('Loading "' + (d.name || d.audio) + '"...');
    var self = this;
    var ts = Date.now();
    fetch(url + '?t=' + ts)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer();
      })
      .then(function (buf) {
        if (d.chart) {
          AudioEngine.decode(buf, function (song) {
            AudioEngine.setSong(song);
            fetch('beatmaps/' + d.chart + '?t=' + ts)
              .then(function (r) { return r.json(); })
              .then(function (chart) {
                self.loadChart(chart);
                self.setStatus('Ready — ' + chart.notes.length + ' notes. Press Start.');
              })
              .catch(function (e) {
                console.error('chart load failed', e);
                self.setStatus('Beatmap file "beatmaps/' + d.chart + '" not found. Create it: Load MP3, Analyze, then Save beatmap to folder.');
              });
          }, function () {
            self.setStatus('Could not decode audio.');
          });
        } else {
          self.setStatus('No beatmap for "' + (d.name || d.audio) + '" yet. Load it as MP3, press Analyze, then Save beatmap to folder and set "chart" in beatmaps/manifest.json.');
        }
      })
      .catch(function (e) {
        console.error('demo load failed', e);
        self.setStatus('Could not load ' + url + '.');
      });
  },

  startAnalysis: function () {
    if (window.Analyzer && window.Analyzer.analyzeLoaded) {
      this.setAnalyzeEnabled(false);
      this.setStartEnabled(false);
      window.Analyzer.analyzeLoaded();
    }
  },

  onAudioReady: function () {
    this.setAnalyzeEnabled(true);
    this.setStartEnabled(false);
    this.setStatus('Audio loaded — press Analyze to generate the beatmap.');
  },

  onAudioError: function () {
    this.setStartEnabled(false);
  },

  setAnalyzeEnabled: function (enabled) {
    if (this.analyzeBtn) this.analyzeBtn.disabled = !enabled;
  },

  loadChartFallback: function () {
    var self = this;
    this.setStatus('No demos found — using built-in demo chart.');
    fetch('beatmaps/demo.json')
      .then(function (r) { return r.json(); })
      .then(function (json) { self.loadChart(json); })
      .catch(function (e) { console.error('beatmap load failed', e); });
  },

  loadChart: function (chart) {
    this.chart = chart;
    this.total = chart.notes.length;
    this.setStartEnabled(true);
    this.setAnalyzeEnabled(false);
  },

  setStatus: function (text) {
    if (window.Analyzer && window.Analyzer.setStatus) window.Analyzer.setStatus(text);
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

  spawnExplosion: function (n) {
    if (!window.AFRAME || !AFRAME.components.explosion) return;
    var hex = n.color === 'blue' ? '#33ccff' : '#ff3355';
    var w = new THREE.Vector3();
    n.el.object3D.getWorldPosition(w);
    var ex = document.createElement('a-entity');
    ex.setAttribute('explosion', { color: hex });
    ex.setAttribute('position', w.x + ' ' + w.y + ' ' + w.z);
    document.querySelector('a-scene').appendChild(ex);
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
        this.slice(n, color);
      }
    }
  },

  slice: function (n, color) {
    var ms = Math.abs(this._at - n.time) * 1000;
    var pts, grade;
    if (color !== n.color) {
      pts = -100;
      grade = 'WRONG';
      this.combo = 0;
    } else if (ms <= 50) { pts = 100; grade = 'PERFECT'; this.combo++; }
    else if (ms <= 100) { pts = 70; grade = 'GOOD'; this.combo++; }
    else { pts = 40; grade = 'OK'; this.combo++; }

    n.state = 'sliced';
    n.el.remove();
    this.notes.splice(this.notes.indexOf(n), 1);
    this.spawnExplosion(n);
    this.score += pts;
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
