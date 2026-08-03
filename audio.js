window.AudioEngine = (function () {
  var ctx = null;
  var master = null;
  var noiseBuf = null;
  var zeroTime = 0;

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
    start: function () {
      ensure();
      if (ctx.state === 'suspended') ctx.resume();
      schedule();
    },
    time: time,
    endTime: BARS * BAR_DUR + 2 * BEAT
  };
})();
