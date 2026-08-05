// Node-side analysis: decode + resample via node-web-audio-api, essentia.js
// engine, and the shared ChartBuilder pipeline — the same code the browser runs.
'use strict';

const path = require('path');
const fs = require('fs');
const { AudioContext, OfflineAudioContext } = require('node-web-audio-api');
const { Essentia, EssentiaWASM } = require('essentia.js');
const ChartBuilder = require('../shared/chart-builder.js');

const hooks = {
  status: (m) => process.stdout.write('  ' + m + '\n'),
  log: (m) => console.log('  [analyzer] ' + m),
  warn: (m) => console.warn('  [analyzer] ' + m)
};

async function decodeFile(file) {
  const bytes = fs.readFileSync(file);
  // decodeAudioData needs a real AudioContext; close it right after so the
  // process can exit.
  const ctx = new AudioContext();
  try {
    return await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  } finally {
    await ctx.close();
  }
}

async function resample44(data, sr) {
  if (sr === ChartBuilder.SR) return data;
  const ctx = new OfflineAudioContext(1, Math.ceil(data.length * ChartBuilder.SR / sr), ChartBuilder.SR);
  const buf = ctx.createBuffer(1, data.length, sr);
  buf.getChannelData(0).set(data);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  return out.getChannelData(0);
}

// audioFile -> chart object ({ bpm, source, system, notes }).
async function analyzeFile(file) {
  hooks.status('Decoding ' + path.basename(file) + '...');
  const buffer = await decodeFile(file);
  const data = ChartBuilder.mono(buffer);

  const engine = ChartBuilder.createEngine(Essentia, EssentiaWASM, hooks);
  if (!engine) {
    hooks.status('essentia unavailable — using fallback FFT');
    return new Promise((res) => ChartBuilder.analyzeFft(data, buffer.sampleRate, res));
  }

  ChartBuilder.sanitize(data);
  hooks.status('Resampling to 44.1kHz...');
  const data44 = await resample44(data, buffer.sampleRate);

  return new Promise((res) => {
    ChartBuilder.analyzeEssentia(data44, engine, hooks, (chart) => {
      ChartBuilder.disposeEngine(engine);
      res(chart);
    });
  });
}

module.exports = { analyzeFile, hooks };
