window.AudioEngine = (function () {
  var ctx = null;
  var master = null;
  var noiseBuf = null;
  var zeroTime = 0;
  var songBuffer = null;
  var songVersion = 0;
  var src = null;

  var BPM = 112;
  var BEAT = 60 / BPM;
  var BAR_DUR = BEAT * 4;
  var BARS = 8;
  var ROOTS = [110, 110, 87.31, 87.31, 130.81, 130.81, 98, 98];

  function ensure() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.85;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function time() {
    return ctx ? ctx.currentTime - zeroTime : 0;
  }

  function stopSrc() {
    if (src) {
      try { src.stop(); } catch (e) {}
      src = null;
    }
  }

  function decode(arrayBuffer, onOk, onErr) {
    ensure();
    ctx.decodeAudioData(arrayBuffer, onOk, onErr || function () {});
  }

  function setSong(buffer) {
    songBuffer = buffer;
    songVersion++;
  }

  // RMS energy per bucket across the whole song, for anything that wants to
  // draw the song's shape (e.g. the mountain skyline). RMS rather than peak
  // amplitude — most mastered tracks sit near peak almost everywhere thanks
  // to loudness limiting, which makes peak a poor proxy for "this section is
  // quiet vs. loud"; RMS tracks perceived loudness instead. Downmixes to
  // mono. Returns null until a song is loaded.
  function waveform(buckets) {
    if (!songBuffer) return null;
    var ch0 = songBuffer.getChannelData(0);
    var ch1 = songBuffer.numberOfChannels > 1 ? songBuffer.getChannelData(1) : null;
    var len = ch0.length;
    var out = new Float32Array(buckets);
    var size = len / buckets;
    for (var b = 0; b < buckets; b++) {
      var start = Math.floor(b * size);
      var end = Math.min(len, Math.floor((b + 1) * size));
      var sum = 0;
      var n = 0;
      for (var i = start; i < end; i++) {
        var v = ch0[i];
        if (ch1) v = (v + ch1[i]) * 0.5;
        sum += v * v;
        n++;
      }
      out[b] = n ? Math.sqrt(sum / n) : 0;
    }
    return out;
  }

  function tone(type, freq, t, dur, vol) {
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function kick(t) {
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.16);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + 0.2);
  }

  function bass(t, f) {
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + 0.3);
  }

  function hat(t) {
    var s = ctx.createBufferSource();
    var f = ctx.createBiquadFilter();
    var g = ctx.createGain();
    s.buffer = noiseBuf;
    f.type = 'highpass';
    f.frequency.value = 7000;
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    s.connect(f);
    f.connect(g);
    g.connect(master);
    s.start(t);
    s.stop(t + 0.06);
  }

  function click(t) {
    tone('square', 880, t, 0.05, 0.2);
  }

  function schedule() {
    var t0 = ctx.currentTime + 0.06;
    click(t0 - 2 * BEAT);
    click(t0 - BEAT);
    zeroTime = t0;
    for (var bar = 0; bar < BARS; bar++) {
      var bs = t0 + bar * BAR_DUR;
      var root = ROOTS[bar];
      for (var b = 0; b < 4; b++) {
        var bt = bs + b * BEAT;
        kick(bt);
        bass(bt, root);
        hat(bt + BEAT / 2);
      }
    }
  }

  return {
    start: function (from) {
      ensure();
      if (ctx.state === 'suspended') ctx.resume();
      stopSrc();
      if (songBuffer) {
        from = from || 0;
        from = Math.max(0, Math.min(from, songBuffer.duration - 0.01));
        src = ctx.createBufferSource();
        src.buffer = songBuffer;
        src.connect(master);
        zeroTime = ctx.currentTime + 0.05 - from;
        src.start(ctx.currentTime + 0.05, from);
      } else {
        schedule();
      }
    },
    seek: function (t) {
      if (!songBuffer) return t;
      t = Math.max(0, Math.min(t, songBuffer.duration - 0.01));
      if (src) {
        stopSrc();
        src = ctx.createBufferSource();
        src.buffer = songBuffer;
        src.connect(master);
        zeroTime = ctx.currentTime + 0.05 - t;
        src.start(ctx.currentTime + 0.05, t);
      } else {
        zeroTime = ctx.currentTime - t;
      }
      return t;
    },
    stop: function () {
      stopSrc();
      return this.time();
    },
    time: time,
    decode: decode,
    setSong: setSong,
    waveform: waveform,
    songVersion: function () { return songVersion; },
    endTime: function () {
      return songBuffer ? songBuffer.duration : BARS * BAR_DUR + 2 * BEAT;
    }
  };
})();
