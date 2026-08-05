// Browser shell around ChartBuilder (shared/chart-builder.js): DOM status lines,
// file loading/decoding, resampling, and the essentia engine lifecycle.
(function () {
  var statusEl = null;
  var systemEl = null;
  var readyBuffer = null;

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function setSystem(text) {
    if (systemEl) systemEl.textContent = text;
  }

  var hooks = {
    status: setStatus,
    log: function (m) { console.log('[Analyzer] ' + m); },
    warn: function (m) { console.warn('[Analyzer] ' + m); }
  };

  // The essentia WASM is ~2.4 MB, so it is fetched on demand rather than at
  // page load — a player who only picks a pre-made chart never downloads it.
  // Resolves to the module pair, or null if it cannot be loaded at all.
  var enginePromise = null;

  function ensureEngine() {
    if (enginePromise) return enginePromise;
    setSystem('Analysis engine: loading essentia…');
    enginePromise = Promise.all([
      import('./vendor/essentia/essentia-wasm.es.js'),
      import('./vendor/essentia/essentia-core.es.min.js')
    ]).then(function (mods) {
      setSystem('Analysis engine: essentia (WASM) ready');
      return { Essentia: mods[1].default, EssentiaWASM: mods[0].EssentiaWASM };
    }).catch(function (e) {
      console.warn('[Analyzer] essentia module failed to load, using fallback FFT', e);
      setSystem('Analysis engine: fallback FFT (essentia could not be loaded)');
      return null;
    });
    return enginePromise;
  }

  function createEngine(mods) {
    if (!mods) return null;
    return ChartBuilder.createEngine(mods.Essentia, mods.EssentiaWASM, hooks);
  }

  function resample44(data, sr, cb) {
    if (sr === ChartBuilder.SR) {
      cb(data);
      return;
    }
    var ctx;
    try {
      ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, Math.ceil(data.length * ChartBuilder.SR / sr), ChartBuilder.SR);
    } catch (e) {
      console.warn('OfflineAudioContext unavailable, using original rate', ChartBuilder.errText(e));
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
      console.warn('resample failed, using original rate', ChartBuilder.errText(e));
      cb(data);
    });
  }

  function analyze(buffer, cb) {
    var sr = buffer.sampleRate;
    var data = ChartBuilder.mono(buffer);
    setStatus('Loading the analysis engine...');
    ensureEngine().then(function (mods) {
      var engine = createEngine(mods);
      if (!engine) {
        setStatus('Using basic analysis (essentia unavailable)...');
        ChartBuilder.analyzeFft(data, sr, cb);
        return;
      }
      ChartBuilder.sanitize(data);
      setStatus('Preparing audio (resampling to 44.1kHz)...');
      resample44(data, sr, function (data44) {
        ChartBuilder.analyzeEssentia(data44, engine, hooks, function (chart) {
          ChartBuilder.disposeEngine(engine);
          cb(chart);
        });
      });
    });
  }

  window.Analyzer = {
    init: function () {
      statusEl = document.getElementById('status');
      systemEl = document.getElementById('system');
      setSystem('Analysis engine: essentia, loaded on demand');
    },
    ensureEngine: ensureEngine,
    handleFile: function (file) {
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (e) {
        this.loadBuffer(e.target.result, file.name);
      }.bind(this);
      reader.readAsArrayBuffer(file);
    },
    loadUrl: function (url, name, onError) {
      fetch(url)
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.arrayBuffer();
        })
        .then(function (buf) {
          this.loadBuffer(buf, name || url);
        }.bind(this))
        .catch(function (err) {
          console.error('[Analyzer] failed to load ' + url, err);
          setStatus('Could not load ' + url + '.');
          if (window.Game && window.Game.setStartEnabled) window.Game.setStartEnabled(true);
          if (onError) onError(err);
        });
    },
    loadBuffer: function (arrayBuffer, name) {
      if (window.Game) window.Game.songName = name || (window.Game.songName || 'beatmap');
      setStatus('Decoding audio...');
      AudioEngine.decode(arrayBuffer, function (buffer) {
        AudioEngine.setSong(buffer);
        readyBuffer = buffer;
        if (window.Game && window.Game.onAudioReady) window.Game.onAudioReady(buffer);
      }, function () {
        setStatus('Could not decode that audio file.');
        if (window.Game && window.Game.onAudioError) window.Game.onAudioError();
      });
    },
    decodeBuffer: function (arrayBuffer, cb) {
      setStatus('Decoding audio...');
      AudioEngine.decode(arrayBuffer, cb, function () {
        setStatus('Could not decode that audio file.');
      });
    },
    analyzeBuffer: function (buffer, cb) {
      setStatus('Analyzing audio...');
      analyze(buffer, cb);
    },
    analyzeLoaded: function () {
      if (!readyBuffer) {
        setStatus('Load an MP3 first, then press Analyze.');
        return;
      }
      setStatus('Analyzing audio...');
      analyze(readyBuffer, function (chart) {
        var sys = chart.system === 'essentia' ? 'essentia' : 'fallback FFT';
        console.log('[Analyzer] beatmap generated with ' + sys + ' — ' + chart.notes.length + ' notes' + (chart.bpm ? ', ' + Math.round(chart.bpm) + ' BPM' : ''));
        console.log('[Analyzer] color mix per 20s: ' + ChartBuilder.colorMix(chart));
        Game.loadChart(chart);
        setStatus('Ready — ' + chart.notes.length + ' notes' + (chart.bpm ? ' @ ' + Math.round(chart.bpm) + ' BPM' : '') + '. Press Start.');
        setSystem('Analysis engine: ' + sys);
      });
    },
    setStatus: setStatus,
    setSystem: setSystem
  };

  window.addEventListener('load', function () {
    window.Analyzer.init();
  });
})();
