// Talks to the local tools server. Analysis and all disk writes happen there.
window.Api = (function () {
  var decodeCtx = null;

  function json(res) {
    return res.text().then(function (body) {
      var data = null;
      try { data = JSON.parse(body); } catch (e) {}
      if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
      return data;
    });
  }

  return {
    // Decoding stays in the browser — the editor needs an AudioBuffer for
    // playback and the waveform anyway.
    decode: function (arrayBuffer) {
      if (!decodeCtx) decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
      return decodeCtx.decodeAudioData(arrayBuffer);
    },

    analyze: function (audioFile) {
      return fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: audioFile })
      }).then(json);
    },

    saveBeatmap: function (file, chart) {
      return fetch('/api/beatmap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: file, chart: chart })
      }).then(json);
    },

    uploadSong: function (file) {
      return fetch('/api/song?name=' + encodeURIComponent(file.name), {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file
      }).then(json);
    }
  };
})();
