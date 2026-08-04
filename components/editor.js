window.Editor = (function () {
  var map = null, wav = null, mapCtx = null, wavCtx = null;
  var chart = null;
  var buffer = null;
  var songName = 'beatmap';
  var selected = null;
  var playing = false;
  var dragging = false;
  var curTime = 0;
  var rafId = null;
  var color = 'red';
  var defaultY = 1.8;
  var zoom = 1;
  var wavDrag = false;
  var dragWindow = null;
  var demos = [];

  var mapW = 420, mapH = 640;
  var wavW = 160, wavH = 640;
  var waveData = null;
  var WAVE_BUCKETS = 4096;

  var DIRS = {
    l:  { x: -1, y: 0 },
    r:  { x: 1, y: 0 },
    u:  { x: 0, y: -1 },
    d:  { x: 0, y: 1 },
    bl: { x: -1, y: 1 },
    br: { x: 1, y: 1 },
    tl: { x: -1, y: -1 },
    tr: { x: 1, y: -1 }
  };

  var el = {};

  function $(id) { return document.getElementById(id); }

  function setStatus(t) { if (el.status) el.status.textContent = t; }

  function sortNotes() {
    if (!chart) return;
    chart.notes.sort(function (a, b) { return a.t - b.t; });
  }

  function timeWindow() {
    if (playing) return { t0: curTime - 8, t1: curTime + 2 };
    var end = 10;
    if (buffer) end = buffer.duration;
    else if (chart && chart.notes.length) end = chart.notes[chart.notes.length - 1].t + 2;
    var full = { t0: -1, t1: Math.max(end + 1, 9) };
    if (zoom <= 1) return full;
    var span = (full.t1 - full.t0) / zoom;
    var center = (curTime > 0.05) ? curTime : (full.t0 + full.t1) / 2;
    return { t0: center - span / 2, t1: center + span / 2 };
  }

  function yOf(t, t0, t1) { return (t - t0) / (t1 - t0) * mapH; }
  function tOf(y, t0, t1) { return t0 + (y / mapH) * (t1 - t0); }

  function noteSize(w) {
    if (playing) return 24;
    return Math.max(6, Math.min(20, mapH / (w.t1 - w.t0) * 0.4));
  }

  function noteColor(n) { return n.color === 'blue' ? '#33ccff' : '#ff3355'; }

  function drawMap(w) {
    var ctx = mapCtx;
    ctx.clearRect(0, 0, mapW, mapH);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (var i = 0; i <= 4; i++) {
      var lx = Math.round(mapW * i / 4) + 0.5;
      ctx.beginPath(); ctx.moveTo(lx, 0); ctx.lineTo(lx, mapH); ctx.stroke();
    }
    if (!chart) {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('no beatmap', mapW / 2, mapH / 2);
      return;
    }
    var ns = noteSize(w);
    var list = chart.notes;
    for (var k = 0; k < list.length; k++) {
      var n = list[k];
      var x = mapW * (n.lane + 0.5) / 4;
      var y = yOf(n.t, w.t0, w.t1);
      if (y < -ns || y > mapH + ns) continue;
      ctx.fillStyle = noteColor(n);
      ctx.fillRect(x - ns / 2, y - ns / 2, ns, ns);
      if (n === selected) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.strokeRect(x - ns / 2, y - ns / 2, ns, ns);
      }
      var d = DIRS[n.dir];
      if (d) {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x + d.x * ns / 3, y + d.y * ns / 3, Math.max(2, ns / 6), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    var py = yOf(curTime, w.t0, w.t1);
    if (py >= 0 && py <= mapH) {
      ctx.strokeStyle = '#ffcc33';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, py + 0.5); ctx.lineTo(mapW, py + 0.5); ctx.stroke();
    }
  }

  function drawWave(w) {
    var ctx = wavCtx;
    ctx.clearRect(0, 0, wavW, wavH);
    ctx.strokeStyle = '#5aa0ff';
    ctx.lineWidth = 1;
    if (!waveData) {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('no audio', wavW / 2, wavH / 2);
      return;
    }
    var mid = wavW / 2;
    var span = mid * 0.9;
    var dur = buffer.duration;
    for (var y = 0; y < wavH; y++) {
      var t = w.t0 + (y / wavH) * (w.t1 - w.t0);
      var fb = t / dur * WAVE_BUCKETS;
      var b0 = Math.max(0, Math.floor(fb - 0.5));
      var b1 = Math.min(WAVE_BUCKETS, Math.ceil(fb + 0.5));
      var mn = 1, mx = -1;
      for (var b = b0; b < b1; b++) {
        var ww = waveData[b];
        if (ww.min < mn) mn = ww.min;
        if (ww.max > mx) mx = ww.max;
      }
      if (mn > mx) { mn = 0; mx = 0; }
      ctx.beginPath();
      ctx.moveTo(mid + mn * span, y + 0.5);
      ctx.lineTo(mid + mx * span, y + 0.5);
      ctx.stroke();
    }
    var py = yOf(curTime, w.t0, w.t1);
    if (py >= 0 && py <= wavH) {
      ctx.strokeStyle = '#ffcc33';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, py + 0.5); ctx.lineTo(wavW, py + 0.5); ctx.stroke();
    }
  }

  function render() {
    var w = timeWindow();
    drawMap(w);
    drawWave(w);
    if (el.time) el.time.textContent = curTime.toFixed(1) + 's';
    updateSelInfo();
  }

  function loop() {
    if (playing) {
      curTime = AudioEngine.time();
      if (curTime > AudioEngine.endTime()) stop();
    }
    render();
    rafId = requestAnimationFrame(loop);
  }

  function buildWaveData(buf) {
    waveData = [];
    var n = buf.length;
    var ch = buf.numberOfChannels;
    var data = new Float32Array(n);
    for (var c = 0; c < ch; c++) {
      var d = buf.getChannelData(c);
      for (var i = 0; i < n; i++) data[i] += d[i] / ch;
    }
    for (var b = 0; b < WAVE_BUCKETS; b++) {
      var s = Math.floor(b * n / WAVE_BUCKETS);
      var e = Math.max(s + 1, Math.floor((b + 1) * n / WAVE_BUCKETS));
      var mn = 1, mx = -1;
      for (var i = s; i < e; i++) {
        var v = data[i];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      waveData.push({ min: mn, max: mx });
    }
  }

  function loadManifest() {
    fetch('beatmaps/manifest.json?t=' + Date.now())
      .then(function (r) { return r.json(); })
      .then(function (m) {
        demos = m.demos || (Array.isArray(m) ? m : []);
        el.load.innerHTML = '<option value="">Load existing…</option>';
        demos.forEach(function (d, i) {
          var opt = document.createElement('option');
          opt.value = String(i);
          opt.textContent = d.name || d.audio;
          el.load.appendChild(opt);
        });
      })
      .catch(function (e) { console.error('[Editor] manifest load failed', e); });
  }

  function onLoadDemo() {
    var i = parseInt(el.load.value, 10);
    var d = demos[i];
    el.load.value = '';
    if (!d) return;
    loadDemo(d);
  }

  function loadDemo(d) {
    stop();
    songName = d.name || d.audio.replace(/\.[^.]+$/, '');
    chart = null;
    selected = null;
    curTime = 0;
    el.download.disabled = true;
    el.save.disabled = true;
    setStatus('Loading "' + (d.name || d.audio) + '"...');
    var ts = Date.now();
    fetch('beatmaps/' + d.audio + '?t=' + ts)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer();
      })
      .then(function (buf) {
        Analyzer.decodeBuffer(buf, function (b) {
          buffer = b;
          AudioEngine.setSong(b);
          buildWaveData(b);
          el.analyze.disabled = false;
          el.play.disabled = false;
          if (d.chart) {
            fetch('beatmaps/' + d.chart + '?t=' + ts)
              .then(function (r) { return r.json(); })
              .then(function (c) {
                chart = c;
                sortNotes();
                el.download.disabled = false;
                el.save.disabled = false;
                setStatus('Loaded "' + songName + '" — ' + chart.notes.length + ' notes. Edit, then save.');
                render();
              })
              .catch(function (e) {
                console.error('[Editor] chart load failed', e);
                setStatus('Audio loaded, but chart "' + d.chart + '" is missing. Press Analyze or Create empty beatmap.');
              });
          } else {
            setStatus('Audio loaded — press Analyze to generate the beatmap, or Create empty beatmap.');
          }
          render();
        });
      })
      .catch(function (e) {
        console.error('[Editor] demo load failed', e);
        setStatus('Could not load ' + d.audio + '.');
      });
  }

  function loadFile(file) {
    var reader = new FileReader();
    reader.onload = function (ev) {
      setStatus('Decoding audio...');
      Analyzer.decodeBuffer(ev.target.result, function (b) {
        buffer = b;
        songName = file.name.replace(/\.[^.]+$/, '');
        AudioEngine.setSong(b);
        buildWaveData(b);
        curTime = 0;
        el.analyze.disabled = false;
        el.play.disabled = false;
        setStatus(chart ? 'Audio loaded — edit your beatmap or press Analyze to regenerate it.' : 'Audio loaded — press Analyze to generate the beatmap, or Create empty beatmap.');
        render();
      });
    };
    reader.readAsArrayBuffer(file);
  }

  function analyze() {
    if (!buffer) { setStatus('Load an MP3 first.'); return; }
    el.analyze.disabled = true;
    Analyzer.analyzeBuffer(buffer, function (c) {
      chart = c;
      sortNotes();
      el.analyze.disabled = false;
      el.download.disabled = false;
      el.save.disabled = false;
      setStatus('Beatmap ready — ' + chart.notes.length + ' notes. Click notes to edit, press Play to audition, Space adds a note while playing.');
      render();
    });
  }

  function togglePlay() {
    if (playing) { stop(); return; }
    if (!buffer) { setStatus('Load an MP3 first.'); return; }
    if (curTime >= buffer.duration - 0.05) curTime = 0;
    AudioEngine.start(curTime);
    playing = true;
    el.play.textContent = 'Stop';
    setStatus('Playing — 1-4 add a note in that lane, 0 switches color, Space stops, drag the waveform to seek.');
  }

  function stop() {
    if (playing) AudioEngine.stop();
    playing = false;
    el.play.textContent = 'Play';
  }

  function addNote(t, lane, selectIt, noteColor) {
    if (!chart) return;
    var n = {
      t: Math.round(t * 20) / 20,
      lane: lane,
      color: noteColor || color,
      y: defaultY,
      dir: ''
    };
    chart.notes.push(n);
    sortNotes();
    if (selectIt) selected = n;
    render();
  }

  function delSelected() {
    if (!chart || !selected) return;
    var idx = chart.notes.indexOf(selected);
    if (idx !== -1) chart.notes.splice(idx, 1);
    selected = null;
    render();
  }

  function clearAll() {
    if (!chart || !chart.notes.length) return;
    if (!window.confirm('Delete all ' + chart.notes.length + ' notes?')) return;
    chart.notes.length = 0;
    selected = null;
    setStatus('All notes deleted.');
    render();
  }

  function moveSelected(which) {
    if (!chart || !selected) return;
    var n = selected;
    if (which === 'left') n.lane = Math.max(0, n.lane - 1);
    else if (which === 'right') n.lane = Math.min(3, n.lane + 1);
    else if (which === 'up') n.t = Math.max(0, n.t - 0.5);
    else if (which === 'down') n.t = n.t + 0.5;
    else if (which === 'hup') n.y = Math.min(4, (n.y || defaultY) + 0.1);
    else if (which === 'hdown') n.y = Math.max(0.4, (n.y || defaultY) - 0.1);
    sortNotes();
    render();
  }

  function updateSelInfo() {
    if (el.sel) {
      el.sel.textContent = selected
        ? 'lane ' + selected.lane + ' · t ' + selected.t.toFixed(2) + 's · y ' + (selected.y || defaultY).toFixed(1)
        : '—';
    }
  }

  function mapPos(evt) {
    var rect = map.getBoundingClientRect();
    return {
      x: evt.clientX - rect.left,
      y: evt.clientY - rect.top,
      lane: Math.min(3, Math.max(0, Math.floor((evt.clientX - rect.left) / rect.width * 4)))
    };
  }

  function hitTest(x, y) {
    if (!chart) return null;
    var w = timeWindow();
    var ns = noteSize(w);
    var best = null, bestD = ns * 0.6;
    var list = chart.notes;
    for (var k = 0; k < list.length; k++) {
      var n = list[k];
      var nx = mapW * (n.lane + 0.5) / 4;
      var ny = yOf(n.t, w.t0, w.t1);
      var d = Math.hypot(x - nx, y - ny);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  function onMouseDown(evt) {
    if (playing) return;
    var p = mapPos(evt);
    var n = hitTest(p.x, p.y);
    if (n) {
      selected = n;
      dragging = true;
    } else if (chart) {
      addNote(tOf(p.y, timeWindow().t0, timeWindow().t1), p.lane, true);
      dragging = false;
    } else {
      selected = null;
    }
    render();
  }

  function wavePos(evt, w) {
    var rect = wav.getBoundingClientRect();
    var y = evt.clientY - rect.top;
    var t = tOf(y, w.t0, w.t1);
    if (buffer) t = Math.max(0, Math.min(t, buffer.duration));
    else t = Math.max(0, t);
    return t;
  }

  function seekTo(t) {
    curTime = t;
    if (playing) AudioEngine.seek(t);
    render();
  }

  function onWavMouseDown(evt) {
    evt.preventDefault();
    wavDrag = true;
    dragWindow = timeWindow();
    seekTo(wavePos(evt, dragWindow));
  }

  function onMouseMove(evt) {
    if (wavDrag && dragWindow) { seekTo(wavePos(evt, dragWindow)); return; }
    var p = mapPos(evt);
    if (dragging && selected) {
      var w = timeWindow();
      selected.lane = p.lane;
      selected.t = Math.max(0, Math.round(tOf(p.y, w.t0, w.t1) * 20) / 20);
      sortNotes();
      render();
    }
  }

  function onMouseUp() {
    wavDrag = false;
    dragWindow = null;
    dragging = false;
  }

  function onKeyDown(e) {
    if ($('editor').classList.contains('hidden')) return;
    var tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === '0') {
      e.preventDefault();
      var next = color === 'red' ? 'blue' : 'red';
      setColor(next);
      setStatus('Add color: ' + next + '.');
      return;
    }
    if (e.key >= '1' && e.key <= '4') {
      if (playing && chart) {
        e.preventDefault();
        var lane = parseInt(e.key, 10) - 1;
        var laneColor = lane < 2 ? 'red' : 'blue';
        addNote(curTime, lane, true, laneColor);
        setStatus('Added note at ' + curTime.toFixed(2) + 's, lane ' + lane + ' (' + laneColor + ').');
      }
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
      return;
    }
    if (!selected) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      delSelected();
      return;
    }
    if (e.key === 'ArrowLeft') { e.preventDefault(); moveSelected('left'); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); moveSelected('right'); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSelected(e.shiftKey ? 'hup' : 'up'); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); moveSelected(e.shiftKey ? 'hdown' : 'down'); }
  }

  function download() {
    if (!chart) return;
    var json = chartJSON();
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename();
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 100);
  }

  function saveToFolder() {
    if (!chart) return;
    var json = chartJSON();
    var fname = filename();
    if (window.showDirectoryPicker) {
      window.showDirectoryPicker()
        .then(function (dir) {
          return dir.getFileHandle(fname, { create: true })
            .then(function (fh) { return fh.createWritable(); })
            .then(function (w) { return w.write(json).then(function () { return w.close(); }); });
        })
        .then(function () {
          setStatus('Saved "' + fname + '" to the selected folder. Set "chart": "' + fname + '" for it in manifest.json.');
        })
        .catch(function (e) {
          if (e && e.name === 'AbortError') { setStatus('Save cancelled.'); return; }
          console.error('save to folder failed', e);
          setStatus('Could not write to that folder. Choose the project "beatmaps" folder and allow access.');
        });
    } else {
      download();
      setStatus('This browser can only download. Pick the project "beatmaps" folder in your file manager (use Chrome or Edge to save directly to a folder).');
    }
  }

  function chartJSON() {
    return JSON.stringify({ bpm: chart.bpm || 0, notes: chart.notes }, null, 2);
  }

  function filename() {
    return (songName || 'beatmap').replace(/[^\w\-]+/g, '_') + '.json';
  }

  function setColor(c) {
    color = c;
    el.colorRed.classList.toggle('active', c === 'red');
    el.colorBlue.classList.toggle('active', c === 'blue');
  }

  function newEmpty() {
    chart = { bpm: 0, notes: [] };
    selected = null;
    el.download.disabled = false;
    el.save.disabled = false;
    setStatus('Empty beatmap created — click the map to add notes, or load an MP3 to audition it.');
    render();
  }

  function updateZoom() {
    if (el.zoom) el.zoom.textContent = '×' + (zoom >= 10 ? Math.round(zoom) : zoom.toFixed(1).replace(/\.0$/, ''));
  }

  function zoomIn() {
    if (selected) curTime = selected.t;
    zoom = Math.min(16, zoom * 1.5);
    updateZoom();
    render();
  }

  function zoomOut() {
    if (selected) curTime = selected.t;
    zoom = Math.max(1, zoom / 1.5);
    updateZoom();
    render();
  }

  return {
    init: function () {
      el.editor = $('editor');
      el.status = $('editor-status');
      el.sel = $('editor-sel');
      el.time = $('editor-time');
      el.analyze = $('editor-analyze');
      el.play = $('editor-play');
      el.download = $('editor-download');
      el.save = $('editor-save');
      el.colorRed = $('editor-color-red');
      el.colorBlue = $('editor-color-blue');
      el.zoom = $('editor-zoom');
      el.load = $('editor-load');

      map = $('editor-map');
      wav = $('editor-wave');
      mapCtx = map.getContext('2d');
      wavCtx = wav.getContext('2d');

      $('editor-back').addEventListener('click', function () { Editor.close(); });
      $('editor-load').addEventListener('change', onLoadDemo);
      loadManifest();
      $('editor-upload').addEventListener('click', function () { $('editor-file').click(); });
      $('editor-empty').addEventListener('click', newEmpty);
      $('editor-file').addEventListener('change', function () {
        if (this.files[0]) loadFile(this.files[0]);
        this.value = '';
      });
      el.analyze.addEventListener('click', analyze);
      el.play.addEventListener('click', togglePlay);
      el.download.addEventListener('click', download);
      el.save.addEventListener('click', saveToFolder);
      $('editor-zoom-in').addEventListener('click', zoomIn);
      $('editor-zoom-out').addEventListener('click', zoomOut);
      $('editor-delete').addEventListener('click', delSelected);
      $('editor-clear').addEventListener('click', clearAll);
      $('editor-color-red').addEventListener('click', function () { setColor('red'); });
      $('editor-color-blue').addEventListener('click', function () { setColor('blue'); });
      Array.prototype.forEach.call(document.querySelectorAll('[data-move]'), function (btn) {
        btn.addEventListener('click', function () { moveSelected(btn.getAttribute('data-move')); });
      });

      map.addEventListener('mousedown', onMouseDown);
      wav.addEventListener('mousedown', onWavMouseDown);
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
      window.addEventListener('keydown', onKeyDown);
    },

    open: function () {
      $('overlay').classList.add('hidden');
      el.editor.classList.remove('hidden');
      updateZoom();
      if (!rafId) rafId = requestAnimationFrame(loop);
      render();
    },

    close: function () {
      stop();
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      el.editor.classList.add('hidden');
      $('overlay').classList.remove('hidden');
    }
  };
})();

window.Editor.init();
