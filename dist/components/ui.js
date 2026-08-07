// In-game UI — the menu, the results screen and the 4-3-2-1 countdown all
// live in the 3D scene instead of a DOM overlay. Buttons are a-planes picked
// out by the raycaster/cursor components on the desktop camera (mouse) and on
// both hand controllers (lasers + trigger/grip).
//
// A-Frame 1.6.0 does not ship the `look-at` component, so panels are
// re-positioned and re-oriented toward the camera every frame (see _place).

window.UI = (function () {
  var uiEl = null;
  var cam = null;
  var hud = null;
  var ready = false;

  var state = 'menu'; // 'menu' | 'countdown' | 'playing' | 'results'

  var menu, results, countdown, countdownNum;
  var menuSong, statusText, systemText;
  var startBtn, analyzeBtn;
  var resSong, resScore, resCombo, resHits;

  // --- small builders -------------------------------------------------

  function makeText(parent, value, pos, o) {
    o = o || {};
    var t = document.createElement('a-text');
    t.setAttribute('value', value);
    t.setAttribute('align', o.align || 'center');
    t.setAttribute('anchor', o.anchor || 'center');
    t.setAttribute('baseline', o.baseline || 'center');
    t.setAttribute('color', o.color || '#ffffff');
    t.setAttribute('font', 'fonts/Orbitron-Bold.json');
    t.setAttribute('shader', 'msdf');
    t.setAttribute('z-offset', 0.02);
    if (o.scale) t.setAttribute('scale', o.scale);
    if (o.width) t.setAttribute('width', o.width);
    if (o.opacity != null) t.setAttribute('opacity', o.opacity);
    t.setAttribute('position', pos);
    parent.appendChild(t);
    return t;
  }

  function makeButton(parent, label, pos, w, h, color, hover, onClick) {
    var b = document.createElement('a-plane');
    b.classList.add('ui-button');
    b.setAttribute('position', pos);
    b.setAttribute('width', w);
    b.setAttribute('height', h);
    b.setAttribute('ui-button', 'color: ' + color + '; hover: ' + hover);
    b.uiClick = onClick;
    parent.appendChild(b);
    makeText(b, label, '0 0 0.02', { scale: '0.8 0.8 1' });
    return b;
  }

  // --- panels ---------------------------------------------------------

  function buildMenu() {
    menu = document.createElement('a-entity');
    menu.setAttribute('visible', false);
    uiEl.appendChild(menu);

    var border = document.createElement('a-plane');
    border.setAttribute('width', 4.6);
    border.setAttribute('height', 3.6);
    border.setAttribute('position', '0 0 -0.05');
    border.setAttribute('material', 'shader: flat; color: #ff2bd6; transparent: true; opacity: 0.55');
    menu.appendChild(border);

    var bg = document.createElement('a-plane');
    bg.setAttribute('width', 4.4);
    bg.setAttribute('height', 3.4);
    bg.setAttribute('position', '0 0 -0.02');
    bg.setAttribute('material', 'shader: flat; color: #12081f; transparent: true; opacity: 0.94');
    menu.appendChild(bg);

    makeText(menu, 'RHYTHM SWORD', '0 1.4 0', { color: '#ff2bd6', scale: '1.5 1.5 1' });
    makeText(menu, 'Slice the cubes on the beat with the matching colored saber', '0 1.06 0',
      { color: '#cfc8ff', scale: '0.55 0.55 1' });
    makeText(menu, 'Perfect 50ms / Good 100ms / OK 150ms / Wrong saber -100', '0 0.82 0',
      { color: '#33ccff', scale: '0.45 0.45 1' });

    makeText(menu, 'SONG', '0 0.6 0', { color: '#8a6ae0', scale: '0.35 0.35 1' });

    makeButton(menu, '<', '-1.85 0.44 0.02', 0.5, 0.5, '#33226b', '#8a6ae0', function () {
      window.Game.selectSong(-1);
    });
    makeButton(menu, '>', '1.85 0.44 0.02', 0.5, 0.5, '#33226b', '#8a6ae0', function () {
      window.Game.selectSong(1);
    });
    menuSong = makeText(menu, '', '0 0.44 0', { color: '#ffffff', scale: '0.5 0.5 1', width: 3 });

    startBtn = makeButton(menu, 'START', '0 -0.12 0.02', 1.9, 0.45, '#ff2bd6', '#ff7ae8', function () {
      window.Game.begin();
    });

    makeButton(menu, 'LOAD MP3', '-0.75 -0.62 0.02', 1.3, 0.4, '#4a2f8a', '#8a6ae0', function () {
      if (window.Analyzer) window.Analyzer.ensureEngine();
      var f = document.getElementById('file');
      if (f) f.click();
    });
    analyzeBtn = makeButton(menu, 'ANALYZE', '0.75 -0.62 0.02', 1.3, 0.4, '#4a2f8a', '#8a6ae0', function () {
      window.Game.startAnalysis();
    });

    statusText = makeText(menu, 'Loading songs...', '0 -1.08 0',
      { color: '#cfc8ff', scale: '0.4 0.4 1', width: 4 });
    systemText = makeText(menu, '', '0 -1.36 0',
      { color: '#6f6a99', scale: '0.3 0.3 1', width: 4 });
  }

  function buildResults() {
    results = document.createElement('a-entity');
    results.setAttribute('visible', false);
    uiEl.appendChild(results);

    var border = document.createElement('a-plane');
    border.setAttribute('width', 4.6);
    border.setAttribute('height', 3.6);
    border.setAttribute('position', '0 0 -0.05');
    border.setAttribute('material', 'shader: flat; color: #33ccff; transparent: true; opacity: 0.55');
    results.appendChild(border);

    var bg = document.createElement('a-plane');
    bg.setAttribute('width', 4.4);
    bg.setAttribute('height', 3.4);
    bg.setAttribute('position', '0 0 -0.02');
    bg.setAttribute('material', 'shader: flat; color: #12081f; transparent: true; opacity: 0.94');
    results.appendChild(bg);

    makeText(results, 'LEVEL COMPLETE', '0 1.32 0', { color: '#33ccff', scale: '1.1 1.1 1' });
    resSong = makeText(results, '', '0 1.0 0', { color: '#cfc8ff', scale: '0.45 0.45 1', width: 4 });
    resScore = makeText(results, 'SCORE 0', '0 0.5 0', { color: '#ffffff', scale: '1.2 1.2 1' });
    resCombo = makeText(results, 'MAX COMBO 0', '0 0.08 0', { color: '#ffdd55', scale: '0.6 0.6 1' });
    resHits = makeText(results, 'HITS 0 / 0', '0 -0.28 0', { color: '#33ccff', scale: '0.6 0.6 1' });

    makeButton(results, 'PLAY AGAIN', '0 -0.78 0.02', 1.9, 0.45, '#ff2bd6', '#ff7ae8', function () {
      window.Game.begin();
    });
    makeButton(results, 'MENU', '0 -1.32 0.02', 1.3, 0.38, '#4a2f8a', '#8a6ae0', function () {
      window.UI.showMenu();
    });
  }

  function buildCountdown() {
    countdown = document.createElement('a-entity');
    countdown.setAttribute('visible', false);
    uiEl.appendChild(countdown);
    countdownNum = document.createElement('a-text');
    countdownNum.setAttribute('value', '');
    countdownNum.setAttribute('align', 'center');
    countdownNum.setAttribute('anchor', 'center');
    countdownNum.setAttribute('baseline', 'center');
    countdownNum.setAttribute('color', '#ffdd55');
    countdownNum.setAttribute('font', 'fonts/Orbitron-Bold.json');
    countdownNum.setAttribute('shader', 'msdf');
    countdownNum.setAttribute('countdown-num', '');
    countdown.appendChild(countdownNum);
  }

  // --- helpers --------------------------------------------------------

  function setHud(show) {
    if (hud) hud.setAttribute('visible', show);
  }

  function setLaser(show) {
    var hands = document.querySelectorAll('[hand-controls]');
    for (var i = 0; i < hands.length; i++) {
      hands[i].setAttribute('raycaster', 'showLine', show);
    }
  }

  function placePanel(panel, dist, y) {
    if (!panel || panel.getAttribute('visible') === false) return;
    var o = cam.object3D;
    var pos = new THREE.Vector3();
    var dir = new THREE.Vector3();
    o.getWorldPosition(pos);
    // getWorldDirection is the object's +Z axis, but the camera looks along
    // its -Z — negate to get the actual view direction.
    o.getWorldDirection(dir);
    dir.multiplyScalar(-1);
    panel.object3D.position.copy(pos).addScaledVector(dir, dist);
    panel.object3D.position.y = y;
    // Non-camera objects: +Z points at the target, so the plane faces the
    // player once positioned in front of the camera.
    panel.object3D.lookAt(pos);
  }

  // --- public API -----------------------------------------------------

  return {
    _init: function (el) {
      uiEl = el;
      cam = document.getElementById('cam');
      hud = document.getElementById('hud');
      ready = true;
      buildMenu();
      buildResults();
      buildCountdown();
      state = 'menu';
      this.enableStart(false);
      this.enableAnalyze(false);
      setHud(false);
      this.showMenu();
    },

    _place: function () {
      if (!ready) return;
      if (state === 'menu') placePanel(menu, 3, 1.7);
      else if (state === 'results') placePanel(results, 3, 1.7);
      else if (state === 'countdown') placePanel(countdown, 3, 1.95);
    },

    isInteractive: function () {
      return state === 'menu' || state === 'results';
    },

    setStatus: function (text) {
      if (ready && statusText) statusText.setAttribute('text', 'value', text);
    },

    setSystem: function (text) {
      if (ready && systemText) systemText.setAttribute('text', 'value', text);
    },

    setSongName: function (name) {
      if (ready && menuSong) menuSong.setAttribute('text', 'value', name || '');
    },

    enableStart: function (enabled) {
      if (!ready) return;
      startBtn.uiDisabled = !enabled;
      startBtn.setAttribute('material', 'opacity', enabled ? 0.95 : 0.35);
    },

    enableAnalyze: function (enabled) {
      if (!ready) return;
      analyzeBtn.uiDisabled = !enabled;
      analyzeBtn.setAttribute('material', 'opacity', enabled ? 0.95 : 0.35);
    },

    showMenu: function () {
      state = 'menu';
      if (results) results.setAttribute('visible', false);
      if (menu) menu.setAttribute('visible', true);
      if (countdown) countdown.setAttribute('visible', false);
      setHud(false);
      setLaser(true);
    },

    startCountdown: function (onDone) {
      state = 'countdown';
      if (menu) menu.setAttribute('visible', false);
      if (results) results.setAttribute('visible', false);
      setHud(false);
      setLaser(false);
      countdown.setAttribute('visible', true);
      var nums = [4, 3, 2, 1];
      nums.forEach(function (n, i) {
        setTimeout(function () {
          countdownNum.components['countdown-num'].show(n);
          if (window.AudioEngine && window.AudioEngine.blip) {
            window.AudioEngine.blip(n === 1 ? 660 : 440);
          }
        }, i * 900);
      });
      setTimeout(function () {
        countdownNum.components['countdown-num'].hide();
        if (onDone) onDone();
      }, nums.length * 900 + 120);
    },

    onGameStart: function () {
      state = 'playing';
      if (menu) menu.setAttribute('visible', false);
      if (results) results.setAttribute('visible', false);
      if (countdown) countdown.setAttribute('visible', false);
      setHud(true);
      setLaser(false);
    },

    onGameEnd: function (stats) {
      state = 'results';
      setHud(false);
      resSong.setAttribute('text', 'value', stats.song || '');
      resScore.setAttribute('text', 'value', 'SCORE ' + stats.score);
      resCombo.setAttribute('text', 'value', 'MAX COMBO ' + stats.maxCombo);
      resHits.setAttribute('text', 'value', 'HITS ' + stats.hits + ' / ' + stats.total);
      results.setAttribute('visible', true);
      setLaser(true);
    }
  };
})();

AFRAME.registerComponent('ui-button', {
  schema: {
    color: { type: 'color', default: '#4a2f8a' },
    hover: { type: 'color', default: '#8a6ae0' }
  },

  init: function () {
    var el = this.el;
    el.setAttribute('material', { shader: 'flat', color: this.data.color, transparent: true, opacity: 0.95 });
    this.hovered = false;
    this.onEnter = this.onEnter.bind(this);
    this.onLeave = this.onLeave.bind(this);
    this.onClick = this.onClick.bind(this);
    el.addEventListener('mouseenter', this.onEnter);
    el.addEventListener('mouseleave', this.onLeave);
    el.addEventListener('click', this.onClick);
  },

  onEnter: function () {
    if (this.hovered) return;
    if (!window.UI || !window.UI.isInteractive() || this.el.uiDisabled) return;
    this.hovered = true;
    this.el.setAttribute('material', 'color', this.data.hover);
    var s = this.el.object3D.scale;
    this.el.object3D.scale.set(s.x * 1.08, s.y * 1.08, 1);
  },

  onLeave: function () {
    if (!this.hovered) return;
    this.hovered = false;
    this.el.setAttribute('material', 'color', this.data.color);
    var s = this.el.object3D.scale;
    this.el.object3D.scale.set(s.x / 1.08, s.y / 1.08, 1);
  },

  onClick: function () {
    if (!window.UI || !window.UI.isInteractive()) return;
    if (this.el.uiDisabled) return;
    if (this.el.uiClick) this.el.uiClick();
  }
});

AFRAME.registerComponent('countdown-num', {
  init: function () {
    this.age = 1;
    this.el.object3D.scale.set(1, 1, 1);
  },

  show: function (n) {
    this.age = 0;
    this.el.setAttribute('visible', true);
    this.el.setAttribute('text', 'value', String(n));
  },

  hide: function () {
    this.el.setAttribute('visible', false);
  },

  tick: function (time, timeDelta) {
    if (this.el.getAttribute('visible') === false) return;
    this.age += (timeDelta || 16) / 1000;
    // Pop in, then settle at full size.
    var s = 1 + Math.max(0, 0.6 - this.age) * 1.4;
    this.el.object3D.scale.set(s, s, 1);
    if (this.age > 1.1) this.el.setAttribute('visible', false);
  }
});

AFRAME.registerComponent('ui-manager', {
  init: function () {
    window.UI._init(this.el);
  },
  tick: function () {
    if (window.UI && window.UI._place) window.UI._place();
  }
});
