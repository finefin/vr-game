// Beatmap editor. Runs only under the local tools server (npm run dev) — it
// analyzes and saves through the API rather than in the page, so it never loads
// the essentia WASM and never touches showDirectoryPicker.
window.Editor = (function () {
  var map = null, wav = null, mapCtx = null, wavCtx = null;
  var chart = null;
  var buffer = null;
  var songName = 'beatmap';
  var audioFile = null;   // filename inside beatmaps/, what the server analyzes
  var chartFile = null;   // chart we loaded, so Save overwrites it rather than forking
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

  var Y_MIN = ChartBuilder.Y_MIN;
  var Y_MAX = ChartBuilder.Y_MAX;

  // Beat grid. `snap` is the subdivision notes land on; 0 means free placement
  // on the old flat 0.05s grid. `gridOffset` shifts the whole grid when the
  // analyzer's first beat is early or late.
  var SNAPS = [
    { label: 'off', div: 0 },
    { label: '1/1', div: 1 },
    { label: '1/2', div: 2 },
    { label: '1/4', div: 4 },
    { label: '1/8', div: 8 }
  ];
  var snapIdx = 2;
  var gridOffset = 0;
  var offsetManual = false;   // a hand-dialled offset is never overwritten by a re-fit
  var BEATS_PER_BAR = 4;
  var FREE_STEP = 0.05;

  var undoStack = [];
  var redoStack = [];
  var UNDO_LIMIT = 50;
  var dirty = false;

  function beatDur() {
    return (chart && chart.bpm > 0) ? 60 / chart.bpm : 0;
  }

  function snapDiv() {
    return SNAPS[snapIdx].div;
  }

  // Grid spacing in seconds, or 0 when there is no usable grid.
  function gridStep() {
    var b = beatDur();
    var d = snapDiv();
    return (b && d) ? b / d : 0;
  }

  function snapTime(t) {
    var step = gridStep();
    if (!step) return Math.round(t / FREE_STEP) * FREE_STEP;
    return Math.round((t - gridOffset) / step) * step + gridOffset;
  }

  // A BPM alone does not say where beat one falls, and a grid out of phase with
  // the song is worse than no grid. Recover the phase from the notes: sweep
  // candidate offsets across one grid step and keep the one that lands the most
  // notes on the grid.
  //
  // Averaging the phases does NOT work here — notes sit on beats and half-beats
  // alike, so opposite phases cancel and the mean lands nowhere useful. Counting
  // hits finds the true mode and shrugs off melody notes that are genuinely off
  // the grid.
  var OFFSET_TOL = 0.02;
  var OFFSET_STEPS = 400;

  function estimateGridOffset() {
    var step = gridStep();
    if (!step || !chart || chart.notes.length < 8) return 0;
    var notes = chart.notes;
    var best = 0, bestHits = -1;
    for (var i = 0; i < OFFSET_STEPS; i++) {
      var off = i / OFFSET_STEPS * step;
      var hits = 0;
      for (var k = 0; k < notes.length; k++) {
        var t = notes[k].t;
        if (Math.abs(t - (Math.round((t - off) / step) * step + off)) <= OFFSET_TOL) hits++;
      }
      if (hits > bestHits) { bestHits = hits; best = off; }
    }
    return Math.round(best * 1000) / 1000;
  }

  function resize() {
    if (!el.editor) return;
    var used = 48;
    ['editor-bar', 'editor-status', 'editor-controls', 'editor-grid', 'editor-tools', 'editor-help'].forEach(function (id) {
      var elm = document.getElementById(id);
      if (elm) used += elm.offsetHeight;
    });
    var h = Math.max(240, Math.min(900, window.innerHeight - used));
    mapH = h;
    mapW = Math.round(h * 0.656);
    wavH = h;
    wavW = Math.round(h * 0.25);
    map.width = mapW;
    map.height = mapH;
    wav.width = wavW;
    wav.height = wavH;
    render();
  }

  var el = {};

  function $(id) { return document.getElementById(id); }

  function setStatus(t) { if (el.status) el.status.textContent = t; }

  function sortNotes() {
    if (!chart) return;
    chart.notes.sort(function (a, b) { return a.t - b.t; });
  }

  // Undo is a plain snapshot stack: every mutating action calls checkpoint()
  // first. Notes are small and edits are user-paced, so copying the whole list
  // is far simpler than tracking deltas and fast enough to be invisible.
  function snapshot() {
    return {
      notes: JSON.parse(JSON.stringify(chart.notes)),
      bpm: chart.bpm || 0,
      selectedIdx: selected ? chart.notes.indexOf(selected) : -1
    };
  }

  function checkpoint() {
    if (!chart) return;
    undoStack.push(snapshot());
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack.length = 0;
    dirty = true;
    updateUndoButtons();
  }

  function restore(snap) {
    chart.notes = JSON.parse(JSON.stringify(snap.notes));
    chart.bpm = snap.bpm;
    selected = snap.selectedIdx >= 0 ? chart.notes[snap.selectedIdx] || null : null;
    dirty = true;
    render();
    updateUndoButtons();
  }

  function undo() {
    if (!chart || !undoStack.length) return;
    redoStack.push(snapshot());
    restore(undoStack.pop());
    setStatus('Undone. ' + chart.notes.length + ' notes.');
  }

  function redo() {
    if (!chart || !redoStack.length) return;
    undoStack.push(snapshot());
    restore(redoStack.pop());
    setStatus('Redone. ' + chart.notes.length + ' notes.');
  }

  function resetHistory() {
    undoStack.length = 0;
    redoStack.length = 0;
    dirty = false;
    updateUndoButtons();
  }

  function updateUndoButtons() {
    if (el.undo) el.undo.disabled = !chart || !undoStack.length;
    if (el.redo) el.redo.disabled = !chart || !redoStack.length;
    if (el.dirty) el.dirty.textContent = dirty ? '● unsaved' : '';
  }

  function timeWindow() {
    // While playing, keep the playhead near the bottom but honour the zoom so
    // zooming in to place a note precisely survives hitting Play.
    if (playing) {
      var span = 10 / zoom;
      return { t0: curTime - span * 0.8, t1: curTime + span * 0.2 };
    }
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
    return Math.max(6, Math.min(26, mapH / (w.t1 - w.t0) * 0.4));
  }

  function noteColor(n) { return n.color === 'blue' ? '#33ccff' : '#ff3355'; }

  // Horizontal beat lines: brightest on the downbeat, dimmer on beats, faintest
  // on subdivisions — so bar boundaries are readable at a glance while zoomed in.
  function drawBeatGrid(ctx, w, width, height) {
    var beat = beatDur();
    if (!beat) return;
    var div = snapDiv() || 1;

    // Drop to a coarser division rather than vanishing when the lines would
    // smear together: subdivisions -> beats -> bars, so there is always some
    // rhythmic reference on screen.
    var maxLines = height / 3;
    while (div > 1 && (w.t1 - w.t0) / (beat / div) > maxLines) div /= 2;
    var step = beat / div;
    if ((w.t1 - w.t0) / step > maxLines) {
      step = beat * BEATS_PER_BAR;
      div = 1 / BEATS_PER_BAR;
      if ((w.t1 - w.t0) / step > maxLines) return;
    }

    var first = Math.floor((w.t0 - gridOffset) / step);
    var last = Math.ceil((w.t1 - gridOffset) / step);
    ctx.lineWidth = 1;
    for (var k = first; k <= last; k++) {
      var t = k * step + gridOffset;
      if (t < 0) continue;
      var y = Math.round(yOf(t, w.t0, w.t1)) + 0.5;
      if (y < 0 || y > height) continue;
      // Classify from the time, not the loop index, so it stays right whichever
      // division we fell back to above.
      var beatNo = (t - gridOffset) / beat;
      var nearInt = function (v) { return Math.abs(v - Math.round(v)) < 1e-6; };
      var onBeat = nearInt(beatNo);
      var onBar = onBeat && nearInt(Math.round(beatNo) / BEATS_PER_BAR);
      ctx.strokeStyle = onBar ? 'rgba(255,204,51,0.34)'
        : onBeat ? 'rgba(255,255,255,0.17)'
          : 'rgba(255,255,255,0.06)';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }

  function drawMap(w) {
    var ctx = mapCtx;
    ctx.clearRect(0, 0, mapW, mapH);
    drawBeatGrid(ctx, w, mapW, mapH);
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
      if (ns >= 12 || n === selected) {
        ctx.fillStyle = '#000';
        ctx.font = Math.max(8, ns * 0.38) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((n.y || defaultY).toFixed(1), x, y);
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
    // Same grid over the waveform — the fastest way to see whether the detected
    // BPM and offset actually line up with the transients.
    drawBeatGrid(ctx, w, wavW, wavH);
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
    fetch('/beatmaps/manifest.json?t=' + Date.now())
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
    setSaveEnabled(false);
    setStatus('Loading "' + (d.name || d.audio) + '"...');
    var ts = Date.now();
    audioFile = d.audio;
    chartFile = d.chart || null;
    fetch('/beatmaps/' + encodeURIComponent(d.audio) + '?t=' + ts)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer();
      })
      .then(function (buf) { return Api.decode(buf); })
      .then(function (b) {
        buffer = b;
        AudioEngine.setSong(b);
        buildWaveData(b);
        el.analyze.disabled = false;
        el.play.disabled = false;
        if (d.chart) {
          fetch('/beatmaps/' + encodeURIComponent(d.chart) + '?t=' + ts)
            .then(function (r) { return r.json(); })
            .then(function (c) {
              chart = c;
              sortNotes();
              resetHistory();
              setSaveEnabled(true);
              offsetManual = false;
              gridOffset = estimateGridOffset();
              updateGridInfo();
              setStatus('Loaded "' + songName + '" — ' + chart.notes.length + ' notes' +
                (chart.bpm ? ' @ ' + Math.round(chart.bpm) + ' BPM' : ', no BPM (grid off)') + '. Edit, then save.');
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
      })
      .catch(function (e) {
        console.error('[Editor] demo load failed', e);
        setStatus('Could not load ' + d.audio + '.');
      });
  }

  // Uploading puts the MP3 in beatmaps/ so the server can analyze it and the
  // game can play it — no throwaway in-page-only songs.
  function loadFile(file) {
    setStatus('Uploading "' + file.name + '" to beatmaps/...');
    Api.uploadSong(file)
      .then(function (res) {
        audioFile = res.audio;
        songName = res.audio.replace(/\.[^.]+$/, '');
        chartFile = null;   // new song: Save mints a chart name from songName
        loadManifest();
        return file.arrayBuffer().then(function (ab) { return Api.decode(ab); });
      })
      .then(function (b) {
        buffer = b;
        AudioEngine.setSong(b);
        buildWaveData(b);
        curTime = 0;
        el.analyze.disabled = false;
        el.play.disabled = false;
        setStatus('Added "' + audioFile + '" to beatmaps/ — press Analyze to generate the beatmap, or Create empty beatmap.');
        render();
      })
      .catch(function (e) {
        console.error('[Editor] upload failed', e);
        setStatus('Could not add that file: ' + e.message);
      });
  }

  function analyze() {
    if (!audioFile) { setStatus('Load a song first.'); return; }
    // Confirm whenever there are notes to lose, not just when they are unsaved —
    // a freshly loaded hand-tuned chart is exactly what you least want to
    // silently replace.
    if (chart && chart.notes.length &&
        !window.confirm('Analyzing discards the current ' + chart.notes.length + ' notes' +
          (dirty ? ', including your unsaved edits' : '') + ', and generates a new beatmap.\n\n' +
          'Continue? (Ctrl+Z will undo it.)')) {
      return;
    }
    if (chart) checkpoint();
    el.analyze.disabled = true;
    setStatus('Analyzing on the server — this takes a while for a full song...');
    Api.analyze(audioFile)
      .then(function (c) {
        chart = c;
        sortNotes();
        el.analyze.disabled = false;
        setSaveEnabled(true);
        dirty = true;
        offsetManual = false;
        gridOffset = estimateGridOffset();
        updateGridInfo();
        updateUndoButtons();
        setStatus('Beatmap ready — ' + chart.notes.length + ' notes' +
          (chart.bpm ? ' @ ' + Math.round(chart.bpm) + ' BPM' : '') +
          '. Click notes to edit, press Play to audition, 1-4 add notes while playing.');
        render();
      })
      .catch(function (e) {
        console.error('[Editor] analyze failed', e);
        el.analyze.disabled = false;
        setStatus('Analysis failed: ' + e.message);
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
    checkpoint();
    var n = {
      t: Math.max(0, snapTime(t)),
      lane: lane,
      color: noteColor || color,
      y: defaultY
    };
    chart.notes.push(n);
    sortNotes();
    if (selectIt) selected = n;
    render();
  }

  function delSelected() {
    if (!chart || !selected) return;
    checkpoint();
    var idx = chart.notes.indexOf(selected);
    if (idx !== -1) chart.notes.splice(idx, 1);
    selected = null;
    render();
  }

  function clearAll() {
    if (!chart || !chart.notes.length) return;
    checkpoint();
    var n = chart.notes.length;
    chart.notes.length = 0;
    selected = null;
    setStatus('Deleted all ' + n + ' notes — Ctrl+Z to undo.');
    render();
  }

  // Time nudges step by one grid division when there is a grid, so a note stays
  // on the beat instead of drifting to an arbitrary offset.
  function timeStep() {
    return gridStep() || 0.5;
  }

  function moveSelected(which) {
    if (!chart || !selected) return;
    checkpoint();
    var n = selected;
    if (which === 'left') n.lane = Math.max(0, n.lane - 1);
    else if (which === 'right') n.lane = Math.min(3, n.lane + 1);
    else if (which === 'up') n.t = Math.max(0, n.t - timeStep());
    else if (which === 'down') n.t = n.t + timeStep();
    else if (which === 'hup') n.y = Math.min(Y_MAX, r2((n.y || defaultY) + 0.1));
    else if (which === 'hdown') n.y = Math.max(Y_MIN, r2((n.y || defaultY) - 0.1));
    sortNotes();
    render();
  }

  function flipColor() {
    if (!chart || !selected) return;
    checkpoint();
    selected.color = selected.color === 'red' ? 'blue' : 'red';
    render();
  }

  function randomizeY() {
    if (!chart || !chart.notes.length) return;
    checkpoint();
    var span = Y_MAX - Y_MIN;
    for (var i = 0; i < chart.notes.length; i++) {
      chart.notes[i].y = r2(Y_MIN + Math.random() * span);
    }
    setStatus('Randomized heights — Ctrl+Z to undo.');
    render();
  }

  function r2(v) { return Math.round(v * 100) / 100; }

  function updateSelInfo() {
    if (el.sel) {
      el.sel.textContent = selected
        ? selected.color + ' · lane ' + selected.lane + ' · t ' + selected.t.toFixed(2) + 's · y ' + (selected.y || defaultY).toFixed(2)
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
    } else if (chart && selected) {
      // First click on empty space clears the selection; only a second one adds
      // a note, so a stray click near a note cannot silently create one.
      selected = null;
      dragging = false;
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
      selected.t = Math.max(0, snapTime(tOf(p.y, w.t0, w.t1)));
      sortNotes();
      render();
    }
  }

  function onMouseUp() {
    wavDrag = false;
    dragWindow = null;
    dragging = false;
  }

  // Wheel zooms around the time under the cursor, so the spot you are looking
  // at stays put instead of sliding away as you zoom.
  function onWheel(evt) {
    evt.preventDefault();
    var w = timeWindow();
    var rect = evt.currentTarget.getBoundingClientRect();
    var anchor = tOf(evt.clientY - rect.top, w.t0, w.t1);
    var next = evt.deltaY < 0 ? zoom * 1.25 : zoom / 1.25;
    zoom = Math.max(1, Math.min(64, next));
    if (!playing) curTime = Math.max(0, anchor);
    updateZoom();
    render();
  }

  function onKeyDown(e) {
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
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (!el.save.disabled) save();
      return;
    }
    if (e.key === 'c' || e.key === 'C') {
      e.preventDefault();
      flipColor();
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

  function save() {
    if (!chart) return;
    el.save.disabled = true;
    Api.saveBeatmap(filename(), { bpm: chart.bpm || 0, notes: chart.notes })
      .then(function (res) {
        el.save.disabled = false;
        dirty = false;
        updateUndoButtons();
        loadManifest();
        setStatus('Saved ' + res.file + ' (' + chart.notes.length + ' notes) — manifest updated, ready to play.');
      })
      .catch(function (e) {
        console.error('[Editor] save failed', e);
        el.save.disabled = false;
        setStatus('Could not save: ' + e.message);
      });
  }

  function setSaveEnabled(on) {
    el.save.disabled = !on;
  }

  // Overwrite the chart we opened; only derive a name when this is a new one.
  function filename() {
    return chartFile || (songName || 'beatmap').replace(/[^\w\-]+/g, '_') + '.json';
  }

  function setColor(c) {
    color = c;
    el.colorRed.classList.toggle('active', c === 'red');
    el.colorBlue.classList.toggle('active', c === 'blue');
  }

  function newEmpty() {
    chart = { bpm: 0, notes: [] };
    selected = null;
    resetHistory();
    setSaveEnabled(true);
    updateGridInfo();
    setStatus('Empty beatmap created — click the map to add notes, or load an MP3 to audition it.');
    render();
  }

  function updateZoom() {
    if (el.zoom) el.zoom.textContent = '×' + (zoom >= 10 ? Math.round(zoom) : zoom.toFixed(1).replace(/\.0$/, ''));
  }

  function updateGridInfo() {
    if (el.snap) el.snap.textContent = SNAPS[snapIdx].label;
    if (el.bpm) {
      el.bpm.textContent = (chart && chart.bpm > 0)
        ? Math.round(chart.bpm) + ' BPM'
        : 'no BPM';
    }
    if (el.offset) el.offset.textContent = (gridOffset >= 0 ? '+' : '') + gridOffset.toFixed(3) + 's';
  }

  function cycleSnap(dir) {
    snapIdx = (snapIdx + dir + SNAPS.length) % SNAPS.length;
    // The phase is relative to the grid step, so a new division needs a new fit
    // — unless the offset was dialled in by hand, which always wins.
    if (!offsetManual) gridOffset = estimateGridOffset();
    updateGridInfo();
    render();
  }

  // Nudge the whole grid, in 5ms steps against the waveform.
  function nudgeOffset(delta) {
    gridOffset = Math.round((gridOffset + delta) * 1000) / 1000;
    offsetManual = true;
    updateGridInfo();
    render();
  }

  function fitGrid() {
    if (!gridStep()) { setStatus('No BPM on this chart, so there is no grid to fit.'); return; }
    offsetManual = false;
    gridOffset = estimateGridOffset();
    updateGridInfo();
    render();
    setStatus('Grid fitted to the notes — offset ' + gridOffset.toFixed(3) + 's.');
  }

  // Snap every note to the current grid — the bulk fix for a chart whose notes
  // sit a few milliseconds off the beat.
  function quantizeAll() {
    if (!chart || !chart.notes.length) return;
    if (!gridStep()) { setStatus('No BPM on this chart, so there is nothing to quantize to.'); return; }
    checkpoint();
    // Report how far notes actually travelled, not how many changed at all —
    // after a grid fit nearly every note shifts by a millisecond or two, which
    // is not what anyone means by "moved".
    var nudged = 0, shifted = 0, worst = 0;
    for (var i = 0; i < chart.notes.length; i++) {
      var n = chart.notes[i];
      var t = Math.max(0, Math.round(snapTime(n.t) * 1000) / 1000);
      var d = Math.abs(t - n.t);
      if (d > 0) {
        nudged++;
        if (d > OFFSET_TOL) shifted++;
        if (d > worst) worst = d;
      }
      n.t = t;
    }
    sortNotes();
    setStatus('Snapped to ' + SNAPS[snapIdx].label + ': ' + nudged + ' notes adjusted, ' +
      shifted + ' by more than ' + (OFFSET_TOL * 1000) + 'ms (largest ' + Math.round(worst * 1000) +
      'ms) — Ctrl+Z to undo.');
    render();
  }

  function zoomIn() {
    if (selected) curTime = selected.t;
    zoom = Math.min(32, zoom * 1.5);
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
      el.save = $('editor-save');
      el.colorRed = $('editor-color-red');
      el.colorBlue = $('editor-color-blue');
      el.zoom = $('editor-zoom');
      el.load = $('editor-load');
      el.undo = $('editor-undo');
      el.redo = $('editor-redo');
      el.dirty = $('editor-dirty');
      el.snap = $('editor-snap');
      el.bpm = $('editor-bpm');
      el.offset = $('editor-offset');

      map = $('editor-map');
      wav = $('editor-wave');
      mapCtx = map.getContext('2d');
      wavCtx = wav.getContext('2d');

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
      el.save.addEventListener('click', save);
      $('editor-zoom-in').addEventListener('click', zoomIn);
      $('editor-zoom-out').addEventListener('click', zoomOut);
      $('editor-undo').addEventListener('click', undo);
      $('editor-redo').addEventListener('click', redo);
      $('editor-snap-prev').addEventListener('click', function () { cycleSnap(-1); });
      $('editor-snap-next').addEventListener('click', function () { cycleSnap(1); });
      $('editor-offset-minus').addEventListener('click', function () { nudgeOffset(-0.005); });
      $('editor-offset-plus').addEventListener('click', function () { nudgeOffset(0.005); });
      $('editor-quantize').addEventListener('click', quantizeAll);
      $('editor-fit').addEventListener('click', fitGrid);
      $('editor-delete').addEventListener('click', delSelected);
      $('editor-clear').addEventListener('click', clearAll);
      $('editor-random-y').addEventListener('click', randomizeY);
      $('editor-color-red').addEventListener('click', function () { setColor('red'); });
      $('editor-color-blue').addEventListener('click', function () { setColor('blue'); });
      Array.prototype.forEach.call(document.querySelectorAll('[data-move]'), function (btn) {
        btn.addEventListener('click', function () { moveSelected(btn.getAttribute('data-move')); });
      });

      map.addEventListener('mousedown', onMouseDown);
      wav.addEventListener('mousedown', onWavMouseDown);
      map.addEventListener('wheel', onWheel, { passive: false });
      wav.addEventListener('wheel', onWheel, { passive: false });
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('resize', resize);
      window.addEventListener('beforeunload', function (e) {
        if (!dirty) return;
        e.preventDefault();
        e.returnValue = '';
      });

      updateZoom();
      updateGridInfo();
      updateUndoButtons();
      resize();
      rafId = requestAnimationFrame(loop);
      render();
    }
  };
})();

window.addEventListener('load', function () { Editor.init(); });
