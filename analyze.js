(function () {
  var FFT_SIZE = 1024;
  var HOP_S = 0.05;
  var MIN_GAP = 0.22;
  var THRESH = 0.12;
  var F_MIN = 40;
  var F_MAX = 12000;
  var MAX_NOTES = 1000;
  var CROSSOVER = 0.15;
  var SR = 44100;

  var BANDS = [
    { lo: 30, hi: 120 },
    { lo: 120, hi: 300 },
    { lo: 300, hi: 2000 },
    { lo: 2000, hi: 6000 },
    { lo: 6000, hi: 14000 }
  ];

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function r3(v) { return Math.round(v * 1000) / 1000; }
  function r2(v) { return Math.round(v * 100) / 100; }

  function decodeWasmException(err) {
    try {
      if (typeof err !== 'number' || !isFinite(err) || !essentia || !essentia.module) return null;
      var heap = essentia.module.HEAPU8;
      var heap32 = essentia.module.HEAPU32;
      if (!heap || !heap32 || err + 40 >= heap.length) return null;
      var size = heap32[(err + 8) >> 2];
      if (!size || size > 4096) return null;
      var base = size <= 22 ? err + 16 : heap32[(err + 16) >> 2];
      if (typeof base !== 'number' || !isFinite(base)) return null;
      var out = '';
      for (var i = 0; i < size; i++) {
        var c = heap[base + i];
        if (c === 0) break;
        out += String.fromCharCode(c);
      }
      return out || null;
    } catch (e) { return null; }
  }

  function errText(err) {
    try {
      if (err instanceof Error && err.message) return err.message;
      if (err && err.message) return err.message;
      var wasmMsg = decodeWasmException(err);
      if (wasmMsg) return wasmMsg;
      return String(err);
    } catch (e) { return 'unknown'; }
  }

  function sanitize(data) {
    var i, v;
    for (i = 0; i < data.length; i++) {
      v = data[i];
      if (v !== v || v === Infinity || v === -Infinity) data[i] = 0;
    }
    return data;
  }

  function mono(buffer) {
    var ch = buffer.numberOfChannels;
    var len = buffer.length;
    var out = new Float32Array(len);
    if (ch === 1) {
      out.set(buffer.getChannelData(0));
    } else {
      var i, d = buffer.getChannelData(0);
      for (i = 0; i < len; i++) out[i] = d[i];
      for (var c = 1; c < ch; c++) {
        d = buffer.getChannelData(c);
        for (i = 0; i < len; i++) out[i] = (out[i] + d[i]) * 0.5;
      }
    }
    return out;
  }

  function fft(re, im) {
    var n = re.length;
    var i, j, k, bit, len, half, ang, wRe, wIm, curRe, curIm, nRe, uRe, uIm, vRe, vIm, t;
    for (i = 1, j = 0; i < n; i++) {
      bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j |= bit;
      if (i < j) {
        t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (len = 2; len <= n; len <<= 1) {
      half = len >> 1;
      ang = -2 * Math.PI / len;
      wRe = Math.cos(ang);
      wIm = Math.sin(ang);
      for (i = 0; i < n; i += len) {
        curRe = 1;
        curIm = 0;
        for (k = 0; k < half; k++) {
          uRe = re[i + k];
          uIm = im[i + k];
          vRe = re[i + k + half] * curRe - im[i + k + half] * curIm;
          vIm = re[i + k + half] * curIm + im[i + k + half] * curRe;
          re[i + k] = uRe + vRe;
          im[i + k] = uIm + vIm;
          re[i + k + half] = uRe - vRe;
          im[i + k + half] = uIm - vIm;
          nRe = curRe * wRe - curIm * wIm;
          curIm = curRe * wIm + curIm * wRe;
          curRe = nRe;
        }
      }
    }
  }

  function heightFor(type, u) {
    switch (type) {
      case 'kick': return 0.4;
      case 'bass': return 0.45 + 0.5 * u;
      case 'snare': return 1.05 + 0.5 * u;
      case 'mid': return 1.7 + 0.5 * u;
      case 'lead': return 2.25 + 0.35 * u;
      case 'hat': return 2.6 + 0.25 * u;
    }
    return 1.7;
  }

  function baseColor(type) {
    return (type === 'mid' || type === 'lead') ? 'blue' : 'red';
  }

  function bandFrames(data, sr, hop) {
    var size = Math.min(FFT_SIZE, 4096);
    var win = new Float32Array(size);
    var i;
    for (i = 0; i < size; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1));
    var n = data.length;
    var re = new Float32Array(size);
    var im = new Float32Array(size);
    var mags = new Float32Array(size / 2);
    var frames = [];
    var maxE = 0;
    var start = 0;
    while (start + size <= n) {
      for (i = 0; i < size; i++) re[i] = data[start + i] * win[i];
      im.fill(0);
      fft(re, im);
      var e = 0, sumC = 0, sumW = 0, logSum = 0;
      for (i = 1; i < size / 2; i++) {
        var m = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
        mags[i] = m;
        e += m;
        var f = i * sr / size;
        if (f >= F_MIN && f <= F_MAX) { sumC += Math.log(f) * m; sumW += m; }
        logSum += Math.log(m + 1e-9);
      }
      var flat = Math.exp(logSum / (size / 2 - 1)) / (e / (size / 2 - 1) + 1e-9);
      var bands = [];
      var tot = 0;
      for (var b = 0; b < BANDS.length; b++) {
        var bl = Math.max(1, Math.ceil(BANDS[b].lo * size / sr));
        var bh = Math.min(size / 2, Math.floor(BANDS[b].hi * size / sr));
        var s = 0;
        for (var k = bl; k < bh; k++) s += mags[k];
        bands.push(s);
        tot += s;
      }
      frames.push({ e: e, bands: bands, tot: tot, flat: flat, logc: sumW > 0 ? sumC / sumW : Math.log(F_MIN) });
      if (e > maxE) maxE = e;
      start += hop;
    }
    var hopTime = hop / sr;
    for (i = 1; i < frames.length - 1; i++) {
      var fr = frames[i];
      var total = fr.tot + 1e-9;
      var onsetSharp = (fr.e - 0.5 * (frames[i - 1].e + frames[i + 1].e)) / (fr.e + 1e-9);
      var perc = onsetSharp > 0.22 && fr.flat > 0.18;
      var type;
      if (perc) {
        if (fr.bands[4] / total > 0.3) type = 'hat';
        else if (fr.bands[0] / total > 0.3) type = 'kick';
        else type = 'snare';
      } else {
        if (fr.bands[0] / total > 0.35) type = 'bass';
        else if (fr.bands[2] >= fr.bands[3]) type = 'mid';
        else type = 'lead';
      }
      var u = clamp((fr.logc - Math.log(F_MIN)) / (Math.log(F_MAX) - Math.log(F_MIN)), 0, 1);
      fr.type = type;
      fr.u = u;
      fr.y = r2(heightFor(type, u));
      fr.color = baseColor(type);
    }
    return { frames: frames, hopTime: hopTime, maxE: maxE };
  }

  function balance(arr) {
    var r = 0, b = 0, i;
    for (i = 0; i < arr.length; i++) arr[i].color === 'red' ? r++ : b++;
    var flip = r > b * 1.4 ? 'red' : b > r * 1.4 ? 'blue' : '';
    if (!flip) return;
    var other = flip === 'red' ? 'blue' : 'red';
    var cnt = 0;
    for (i = 0; i < arr.length; i++) {
      if (arr[i].color === flip) {
        if (cnt % 2 === 0) arr[i].color = other;
        cnt++;
      }
    }
  }

  function markTriplets(arr) {
    for (var i = 1; i < arr.length - 1; i++) {
      if (arr[i].mel) continue;
      var g1 = arr[i].t - arr[i - 1].t;
      var g2 = arr[i + 1].t - arr[i].t;
      if (Math.abs(g1 - g2) < 0.035 && g1 < 0.35 && g2 < 0.35) {
        var a = arr[i - 1], b = arr[i], c = arr[i + 1];
        if (i % 2) {
          a.color = 'blue'; b.color = 'red'; c.color = 'blue';
        } else {
          a.color = 'red'; b.color = 'blue'; c.color = 'red';
        }
        i += 2;
      }
    }
  }

  function thin(arr) {
    var step = Math.ceil(arr.length / MAX_NOTES);
    var out = [];
    for (var i = 0; i < arr.length; i += step) out.push(arr[i]);
    return out;
  }

  function assignLanes(arr) {
    var prev = -1;
    for (var i = 0; i < arr.length; i++) {
      var nn = arr[i];
      var side = nn.color === 'red' ? [0, 1] : [2, 3];
      if (Math.random() < CROSSOVER) side = side[0] === 0 ? [2, 3] : [0, 1];
      var lane = Math.random() < 0.5 ? side[0] : side[1];
      if (lane === prev) lane = lane === side[0] ? side[1] : side[0];
      nn.lane = lane;
      prev = lane;
    }
  }

  function assignLanesSplit(arr) {
    var lastRed = -1, lastBlue = -1;
    for (var i = 0; i < arr.length; i++) {
      var nn = arr[i];
      if (nn.color === 'red') {
        nn.lane = lastRed === 0 ? 1 : 0;
        lastRed = nn.lane;
      } else {
        nn.lane = lastBlue === 2 ? 3 : 2;
        lastBlue = nn.lane;
      }
    }
  }

  function assemble(primary, melody, bpm) {
    var all = primary.concat(melody);
    all.sort(function (a, b) { return a.t - b.t; });
    var out = [];
    for (var i = 0; i < all.length; i++) {
      if (out.length && all[i].t - out[out.length - 1].t < MIN_GAP) continue;
      out.push(all[i]);
    }
    balance(out);
    markTriplets(out);
    if (out.length > MAX_NOTES) out = thin(out);
    assignLanes(out);
    var chart = [];
    for (i = 0; i < out.length; i++) {
      chart.push({ t: out[i].t, lane: out[i].lane, color: out[i].color, y: out[i].y });
    }
    return { bpm: bpm, source: 'mp3', system: 'fft', notes: chart };
  }

  function balanceSplit(arr) {
    var bucket = 8;
    var bStart = -Infinity;
    var reds = [], blues = [];

    function flush() {
      if (reds.length >= blues.length) { reds = []; blues = []; return; }
      var toFlip = Math.floor((blues.length - reds.length) / 2);
      if (toFlip <= 0) { reds = []; blues = []; return; }
      var flipped = 0;
      for (var k = 0; k < blues.length && flipped < toFlip; k++) {
        var nn = arr[blues[k]];
        if (nn.mel) continue;
        var ok = true;
        for (var r = 0; r < arr.length; r++) {
          if (arr[r].color === 'red' && Math.abs(arr[r].t - nn.t) < MIN_GAP) { ok = false; break; }
        }
        if (!ok) continue;
        nn.color = 'red';
        flipped++;
      }
      reds = []; blues = [];
    }

    for (var i = 0; i < arr.length; i++) {
      var nn = arr[i];
      if (nn.t - bStart >= bucket) { flush(); bStart = nn.t; }
      if (nn.color === 'red') reds.push(i); else blues.push(i);
    }
    flush();
  }

  function assembleSplit(primary, melody, bpm) {
    var all = primary.concat(melody);
    all.sort(function (a, b) { return a.t - b.t; });
    var out = [];
    var lastRedT = -Infinity, lastBlueT = -Infinity;
    for (var i = 0; i < all.length; i++) {
      var nn = all[i];
      var lastT = nn.color === 'red' ? lastRedT : lastBlueT;
      if (nn.t - lastT < MIN_GAP) continue;
      out.push(nn);
      if (nn.color === 'red') lastRedT = nn.t; else lastBlueT = nn.t;
    }
    if (out.length > MAX_NOTES) out = thin(out);
    balanceSplit(out);
    assignLanesSplit(out);
    var chart = [];
    for (i = 0; i < out.length; i++) {
      chart.push({ t: out[i].t, lane: out[i].lane, color: out[i].color, y: out[i].y });
    }
    return { bpm: bpm, source: 'mp3', system: 'essentia', notes: chart };
  }

  function analyzeFft(data, sr, cb) {
    var hop = Math.max(1, Math.round(sr * HOP_S));
    var B = bandFrames(data, sr, hop);
    var frames = B.frames;
    var maxE = B.maxE;
    var hopTime = B.hopTime;
    var i;

    var notes = [];
    var gap = Math.max(1, Math.round(MIN_GAP / HOP_S));
    var lastPeak = -Infinity;
    for (i = 1; i < frames.length - 1; i++) {
      var fr = frames[i];
      if (fr.e < frames[i - 1].e || fr.e < frames[i + 1].e) continue;
      if (fr.e < THRESH * maxE) continue;
      if (i - lastPeak < gap) continue;
      notes.push({ t: r3(i * hopTime), type: fr.type, u: fr.u, y: fr.y, color: fr.color });
      lastPeak = i;
    }

    var melody = [];
    var run = 0;
    var lastVal = null;
    var lastT = -Infinity;
    for (i = 0; i < frames.length; i++) {
      var fr2 = frames[i];
      var t2 = i * hopTime;
      var pitchy = fr2.flat < 0.22 &&
        (fr2.bands[2] + fr2.bands[3]) > 0.4 * (fr2.tot + 1e-9) &&
        fr2.e > 0.06 * maxE;
      if (!pitchy) { run = 0; lastVal = null; continue; }
      run++;
      if (run < 8) continue;
      var val = fr2.logc;
      if (lastVal === null) { lastVal = val; continue; }
      if (Math.abs(val - lastVal) > 0.06 * Math.abs(lastVal) && t2 - lastT >= 0.25) {
        var melU = clamp((fr2.logc - Math.log(300)) / (Math.log(4000) - Math.log(300)), 0, 1);
        melody.push({ t: r3(t2), y: r2(1.7 + 0.95 * melU), color: 'blue', mel: true });
        lastT = t2;
        lastVal = val;
      }
    }

    cb(assemble(notes, melody, 0));
  }

  var essentia = null;

  function ensureEssentia() {
    if (essentia) return true;
    try {
      if (window.Essentia && window.EssentiaWASM) {
        essentia = new window.Essentia(window.EssentiaWASM);
        return true;
      }
    } catch (err) {
      essentia = null;
      console.warn('essentia init failed, using fallback analysis', err);
    }
    return false;
  }

  function cleanupEssentia(vec) {
    try {
      if (vec && typeof vec.delete === 'function') vec.delete();
    } catch (e) {}
    try { if (essentia) essentia.delete(); } catch (e) {}
    essentia = null;
  }

  function combineOnsets(vec) {
    var sum = null;
    var n = 0;
    var methods = ['infogain', 'hfc', 'flux'];
    for (var m = 0; m < methods.length; m++) {
      try {
        var o = essentia.OnsetDetectionGlobal(vec, 2048, 512, methods[m], SR);
        var a = essentia.vectorToArray(o.onsetDetections);
        if (!sum) sum = new Float32Array(a.length);
        if (a.length !== sum.length) continue;
        for (var i = 0; i < a.length; i++) sum[i] += a[i];
        n++;
      } catch (err) {
        console.warn('onset method ' + methods[m] + ' failed: ' + errText(err));
      }
    }
    if (!n || !sum) return null;
    for (var j = 0; j < sum.length; j++) sum[j] /= n;
    return sum;
  }

  function fluxOnsets(data) {
    var hop = 512;
    var B = bandFrames(data, SR, hop);
    var frames = B.frames;
    var hopTime = B.hopTime;
    var o = new Float32Array(frames.length);
    var i;
    for (i = 1; i < frames.length - 1; i++) {
      var d = frames[i].e - 0.5 * (frames[i - 1].e + frames[i + 1].e);
      o[i] = d > 0 ? d : 0;
    }
    return { o: o, hopTime: hopTime, frames: frames, maxE: B.maxE };
  }

  function fluxBpm(o, hopTime) {
    var maxLag = Math.round(2.0 / hopTime);
    var minLag = Math.round(0.25 / hopTime);
    var bestLag = 60 / 120, bestScore = -1;
    for (var lag = minLag; lag <= maxLag; lag++) {
      var s = 0;
      for (var i = 0; i + lag < o.length; i++) s += o[i] * o[i + lag];
      s /= (o.length - lag);
      if (s > bestScore) { bestScore = s; bestLag = lag * hopTime; }
    }
    return 60 / bestLag;
  }

  function fluxBeats(o, hopTime, bpm) {
    var grid = 60 / bpm;
    var dur = o.length * hopTime;
    var maxO = 0, i;
    for (i = 0; i < o.length; i++) if (o[i] > maxO) maxO = o[i];
    var first = -1;
    for (i = 0; i < o.length; i++) {
      if (o[i] > 0.5 * maxO) { first = i * hopTime; break; }
    }
    if (first < 0) return [];
    var start = first - grid * Math.floor((first - 0.5) / grid);
    if (start < 0.5) start += grid;
    var beats = [];
    var t = start;
    while (t < dur - 0.25) { beats.push(r3(t)); t += grid; }
    return beats;
  }

  function essentiaBpm(vec) {
    try {
      var pb = essentia.PercivalBpmEstimator(vec);
      if (pb.bpm) {
        console.log('[Analyzer] BPM via essentia PercivalBpmEstimator: ' + Math.round(pb.bpm));
        return pb.bpm;
      }
    } catch (err) {
      console.warn('[Analyzer] essentia PercivalBpmEstimator threw: ' + errText(err));
    }
    try {
      var cur = essentia.RhythmExtractor2013(vec, 208, 'multifeature', 40);
      if (cur.bpm) {
        console.log('[Analyzer] BPM via essentia RhythmExtractor2013: ' + Math.round(cur.bpm));
        return cur.bpm;
      }
    } catch (err) {
      console.warn('[Analyzer] essentia RhythmExtractor2013 threw: ' + errText(err));
    }
    return null;
  }

  function detectBeats(data) {
    var env = fluxOnsets(data);
    var vec = null;
    var bpm = null;
    try {
      vec = essentia.arrayToVector(data);
      bpm = essentiaBpm(vec);
    } catch (err) {
      console.warn('[Analyzer] essentia vector init threw: ' + errText(err));
    }
    if (!bpm) {
      bpm = fluxBpm(env.o, env.hopTime);
      console.log('[Analyzer] BPM via flux autocorrelation: ' + Math.round(bpm));
    }
    if (!bpm) return null;
    var beats = fluxBeats(env.o, env.hopTime, bpm);
    if (beats.length < 3) {
      console.warn('[Analyzer] flux grid too sparse (' + beats.length + ' beats)');
      return null;
    }
    console.log('[Analyzer] beat grid from flux: ' + Math.round(bpm) + ' bpm, ' + beats.length + ' beats');
    return { bpm: bpm, beats: beats, vec: vec, env: env };
  }

  function analyzeEssentia(data, cb) {
    var duration = data.length / SR;
    var vec = null;

    function fail() {
      cleanupEssentia(vec);
      setStatus('Beat grid failed — using basic analysis (fallback FFT)...');
      analyzeFft(data, SR, cb);
    }

    setStatus('Finding the beat (flux + essentia BPM)...');
    setTimeout(function () {
      var res = detectBeats(data);
      if (!res) {
        fail();
        return;
      }
      vec = res.vec;
      var beats = res.beats;
      var bpm = res.bpm;
      var env = res.env;
      var pitch = null;
      var onsetDet = null;

      if (vec) {
        setStatus('Tracking the melody (essentia)...');
        setTimeout(function () {
          try {
            var mel = essentia.PredominantPitchMelodia(vec);
            pitch = essentia.vectorToArray(mel.pitch);
          } catch (err) {
            console.warn('essentia melody analysis failed, continuing without melody: ' + errText(err));
          }
          setStatus('Detecting onsets (essentia)...');
          setTimeout(function () {
            try {
              onsetDet = combineOnsets(vec);
            } catch (err) {
              console.warn('essentia onset analysis failed, continuing without fills: ' + errText(err));
            }
            finishBuild(beats, bpm, pitch, onsetDet);
          }, 30);
        }, 30);
      } else {
        setStatus('Building the beat map...');
        finishBuild(beats, bpm, pitch, onsetDet);
      }

      function finishBuild(beats2, bpm2, pitch2, onsetDet2) {
        setStatus('Building the beat map...');
        setTimeout(function () {
          var chart = null;
          try {
            chart = buildChart(data, SR, { bpm: bpm2, beats: beats2, pitch: pitch2, onsetDet: onsetDet2, duration: duration, env: env });
          } catch (err) {
            console.warn('beat map build failed: ' + errText(err));
          }
          cleanupEssentia(vec);
          if (!chart) { fail(); return; }
          cb(chart);
        }, 30);
      }
    }, 30);
  }

  function buildChart(data, sr, es) {
    var hop = 512;
    var B = es.env || bandFrames(data, sr, hop);
    var frames = B.frames;
    var maxE = B.maxE;
    var hopTime = B.hopTime;
    var dur = es.duration;

    var beats = es.beats;
    var bpm = es.bpm;
    var grid = 60 / bpm;
    var i;

    if (!frames.length) return assembleSplit([], [], bpm);

    function frameAt(t) {
      var idx = Math.round(t / hopTime);
      if (idx < 0) idx = 0;
      if (idx >= frames.length) idx = frames.length - 1;
      return frames[idx];
    }

    function localMax(t) {
      var win = Math.round(1.2 / hopTime);
      var c = Math.round(t / hopTime);
      var lo = Math.max(0, c - win);
      var hi = Math.min(frames.length - 1, c + win);
      var m = 0;
      for (var k = lo; k <= hi; k++) if (frames[k].e > m) m = frames[k].e;
      return m;
    }

    function classifyEvent(t) {
      var fr = frameAt(t);
      if (!fr) return null;
      var lm = localMax(t);
      if (fr.e < THRESH * lm) return null;
      if (fr.e < 0.02 * maxE) return null;
      return { t: r3(t), type: fr.type, u: fr.u, y: fr.y, color: fr.color };
    }

    var primary = [];
    var lastT = -Infinity;
    for (i = 0; i < beats.length; i++) {
      var t = beats[i];
      if (t >= dur - 0.25) break;
      if (t < 0.25) continue;
      var ev = classifyEvent(t);
      if (!ev) continue;
      if (t - lastT < MIN_GAP) continue;
      primary.push(ev);
      lastT = t;
    }

    if (es.onsetDet) {
      var onHopTime = 512 / SR;
      var on = es.onsetDet;
      var cnt = on.length;
      var maxO = 0;
      for (i = 0; i < cnt; i++) if (on[i] > maxO) maxO = on[i];
      var winF = Math.max(4, Math.round(1.0 / onHopTime));
      var base = new Float32Array(cnt);
      var acc = 0;
      for (i = 0; i < cnt; i++) {
        acc += on[i];
        if (i >= winF) acc -= on[i - winF];
        base[i] = acc / Math.min(i + 1, winF);
      }
      var cands = [];
      for (i = 2; i < cnt - 1; i++) {
        if (on[i] <= on[i - 1] || on[i] <= on[i + 1]) continue;
        if (on[i] < 2.0 * base[i] || on[i] < 0.05 * maxO) continue;
        var t0 = i * onHopTime;
        if (t0 < 0.5 || t0 > dur - 0.5) continue;
        var nearBeat = false;
        for (var b = 0; b < beats.length; b++) {
          if (Math.abs(t0 - beats[b]) < 0.12) { nearBeat = true; break; }
        }
        if (nearBeat) continue;
        var snap = bpm > 145 ? grid : grid / 2;
        var ts = Math.round(t0 / snap) * snap;
        if (ts < 0.5 || ts > dur - 0.5) continue;
        var ev2 = classifyEvent(t0);
        if (!ev2) continue;
        cands.push({ t: r3(ts), y: ev2.y, color: ev2.color, strength: on[i] });
      }
      cands.sort(function (a, b) { return a.t - b.t; });
      lastT = -Infinity;
      var windowCount = 0;
      var windowStart = -Infinity;
      for (i = 0; i < cands.length; i++) {
        var c = cands[i];
        if (c.t - lastT < 0.14) continue;
        if (c.t - windowStart >= 0.6) { windowCount = 0; windowStart = c.t; }
        if (windowCount >= 4) continue;
        primary.push(c);
        lastT = c.t;
        windowCount++;
      }
    }

    var melody = [];
    if (es.pitch) {
      var melHop = 128 / SR;
      var p = es.pitch;
      var runSem = -999;
      var runStart = -1;
      var lastM = -Infinity;

      function flushMel(endIdx) {
        if (runSem < 0) return;
        var startT = runStart * melHop;
        var endT = endIdx * melHop;
        var dlen = endT - startT;
        if (dlen >= 0.25) {
          var midF = 55 * Math.pow(2, runSem / 12);
          var u2 = clamp((Math.log(midF) - Math.log(80)) / (Math.log(2500) - Math.log(80)), 0, 1);
          var y2 = r2(1.75 + 0.95 * u2);

          function addMel(tm) {
            if (tm > 0.5 && tm < dur - 0.5 && tm - lastM >= 0.28) {
              melody.push({ t: r3(tm), y: y2, color: 'blue', mel: true });
              lastM = tm;
            }
          }

          addMel(startT);
          if (dlen >= 0.8) {
            var snap = grid;
            for (var tm2 = startT + snap; tm2 < endT - 0.2; tm2 += snap) addMel(tm2);
          }
        }
        runSem = -999;
        runStart = -1;
      }

      for (var j = 0; j < p.length; j++) {
        var f = p[j];
        if (f <= 0) { flushMel(j); continue; }
        var sem = Math.round(12 * Math.log2(f / 55));
        if (sem !== runSem) { flushMel(j); runSem = sem; runStart = j; }
      }
      flushMel(p.length);
    }

    return assembleSplit(primary, melody, bpm);
  }

  var statusEl = null;
  var systemEl = null;

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function setSystem(text) {
    if (systemEl) systemEl.textContent = text;
  }

  function resample44(data, sr, cb) {
    if (sr === SR || data.length === 0) { cb(data); return; }
    var ctx;
    try {
      ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, Math.ceil(data.length * SR / sr), SR);
    } catch (e) {
      console.warn('OfflineAudioContext unavailable, using original rate', errText(e));
      cb(data);
      return;
    }
    var buf = ctx.createBuffer(1, data.length, sr);
    buf.getChannelData(0).set(data);
    var src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start();
    ctx.startRendering().then(function (out) {
      cb(out.getChannelData(0));
    }, function (e) {
      console.warn('resample failed, using original rate', errText(e));
      cb(data);
    });
  }

  function analyze(buffer, cb) {
    var sr = buffer.sampleRate;
    var data = mono(buffer);
    if (!ensureEssentia()) {
      setStatus('Using basic analysis (essentia unavailable)...');
      analyzeFft(data, sr, cb);
      return;
    }
    sanitize(data);
    setStatus('Preparing audio (resampling to 44.1kHz)...');
    resample44(data, sr, function (data44) {
      analyzeEssentia(data44, cb);
    });
  }

  window.Analyzer = {
    init: function () {
      statusEl = document.getElementById('status');
      systemEl = document.getElementById('system');
      if (window.Essentia && window.EssentiaWASM) {
        setSystem('Analysis engine: essentia (WASM) ready');
        console.log('[Analyzer] essentia.js WASM loaded');
      } else {
        setSystem('Analysis engine: fallback FFT (essentia not loaded)');
        console.warn('[Analyzer] essentia.js not loaded — analysis will use fallback FFT');
      }
    },
    handleFile: function (file) {
      if (!file) return;
      if (window.Game && window.Game.setStartEnabled) window.Game.setStartEnabled(false);
      var reader = new FileReader();
      reader.onload = function (e) {
        setStatus('Analyzing "' + file.name + '"...');
        AudioEngine.decode(e.target.result, function (buffer) {
          AudioEngine.setSong(buffer);
          analyze(buffer, function (chart) {
            var sys = chart.system === 'essentia' ? 'essentia' : 'fallback FFT';
            console.log('[Analyzer] beatmap generated with ' + sys + ' — ' + chart.notes.length + ' notes' + (chart.bpm ? ', ' + Math.round(chart.bpm) + ' BPM' : ''));
            var buckets = {}, k;
            for (k = 0; k < chart.notes.length; k++) {
              var nn = chart.notes[k];
              var b = Math.floor(nn.t / 20) * 20;
              buckets[b] = buckets[b] || { red: 0, blue: 0 };
              if (nn.color === 'red') buckets[b].red++; else buckets[b].blue++;
            }
            var parts = [];
            if (chart.notes.length) {
              for (k = 0; k <= Math.floor(chart.notes[chart.notes.length - 1].t / 20) * 20; k += 20) {
                if (buckets[k]) parts.push(k + 's:R' + buckets[k].red + '/B' + buckets[k].blue);
              }
            }
            console.log('[Analyzer] color mix per 20s: ' + parts.join('  '));
            Game.loadChart(chart);
            setStatus('Ready — ' + chart.notes.length + ' notes' + (chart.bpm ? ' @ ' + Math.round(chart.bpm) + ' BPM' : '') + '. Press Start.');
            setSystem('Analysis engine: ' + sys);
          });
        }, function () {
          setStatus('Could not decode that audio file.');
          if (window.Game && window.Game.setStartEnabled) window.Game.setStartEnabled(true);
        });
      };
      reader.readAsArrayBuffer(file);
    }
  };

  window.addEventListener('load', function () {
    window.Analyzer.init();
  });
})();
