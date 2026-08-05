#!/usr/bin/env node
// Generate beatmaps from the command line.
//
//   npm run beatmap -- "beatmaps/song.mp3"   analyze one song, write its JSON
//   npm run beatmap -- ~/Music/new.mp3       copy the MP3 into beatmaps/ first
//   npm run beatmap -- --all                 every audio file without a chart
//   npm run beatmap -- --force song.mp3      re-analyze even if a chart exists
//
// Charts land next to the audio in beatmaps/ and the manifest is regenerated.
'use strict';

const fs = require('fs');
const path = require('path');
const { analyzeFile } = require('./analyzer.js');
const manifest = require('./manifest.js');
const ChartBuilder = require('../shared/chart-builder.js');

const BEATMAPS = path.join(__dirname, '..', 'beatmaps');
const AUDIO_EXT = ['.mp3', '.ogg', '.wav', '.m4a', '.flac'];

// Must match the editor's filename(): songName with non-word runs collapsed to _.
function chartName(audioFile) {
  const stem = path.basename(audioFile).replace(/\.[^.]+$/, '');
  return stem.replace(/[^\w\-]+/g, '_') + '.json';
}

function chartJSON(chart) {
  return JSON.stringify({ bpm: chart.bpm || 0, notes: chart.notes }, null, 2);
}

async function processSong(audioPath, force) {
  const base = path.basename(audioPath);
  const target = path.join(BEATMAPS, base);

  if (path.resolve(audioPath) !== path.resolve(target)) {
    if (!fs.existsSync(audioPath)) {
      console.error('not found: ' + audioPath);
      process.exitCode = 1;
      return;
    }
    fs.copyFileSync(audioPath, target);
    console.log('copied ' + base + ' into beatmaps/');
  }

  const jsonPath = path.join(BEATMAPS, chartName(base));
  if (fs.existsSync(jsonPath) && !force) {
    console.log('chart exists, skipping (use --force to redo): ' + path.basename(jsonPath));
    return;
  }

  console.log('analyzing ' + base);
  const chart = await analyzeFile(target);
  fs.writeFileSync(jsonPath, chartJSON(chart) + '\n');
  console.log('  -> ' + path.basename(jsonPath) + ': ' + chart.notes.length + ' notes' +
    (chart.bpm ? ' @ ' + Math.round(chart.bpm) + ' BPM' : '') + ' (' + chart.system + ')');
  const mix = ChartBuilder.colorMix(chart);
  if (mix) console.log('  color mix per 20s: ' + mix);
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const all = args.includes('--all');
  const files = args.filter((a) => a !== '--force' && a !== '--all');

  let songs;
  if (all) {
    const audio = fs.readdirSync(BEATMAPS)
      .filter((f) => AUDIO_EXT.includes(path.extname(f).toLowerCase()));
    songs = audio
      .map((f) => path.join(BEATMAPS, f))
      .filter((f) => force || !fs.existsSync(path.join(BEATMAPS, chartName(f))));
    if (!songs.length) {
      console.log('every audio file already has a chart');
    }
  } else if (files.length) {
    songs = files;
  } else {
    console.log('usage: npm run beatmap -- <audio file> [--force] | --all');
    process.exitCode = 1;
    return;
  }

  for (const s of songs) {
    await processSong(s, force);
  }

  const demos = manifest.regenerate(BEATMAPS);
  console.log('manifest.json updated (' + demos.length + ' demos)');
}

main().then(() => process.exit(process.exitCode || 0), (e) => {
  console.error(e);
  process.exit(1);
});
