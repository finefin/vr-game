# Rhythm Sword VR game

A WebXR rhythm game. Notes fly at you in four lanes — slice red with the left saber, blue with the right. Beatmaps are generated from audio by melody, rhythm and onset detection.

## Layout

| Folder | What it is |
|---|---|
| `src/` | the game client — the only thing that ships |
| `shared/` | the analysis pipeline, shared by the browser and Node |
| `tools/` | Node app: beatmap generator, editor, dev server (never shipped) |
| `beatmaps/` | audio + chart JSON + `manifest.json` |
| `dist/` | build output — upload this |

## Getting started

```sh
cd tools
npm install
npm run dev
```

- game — <http://127.0.0.1:8000/>
- beatmap editor — <http://127.0.0.1:8000/editor/>

For a headset on the same machine: `adb reverse tcp:8000 tcp:8000`, then open `localhost:8000` in the Quest browser.

## Making a beatmap

Either from the command line:

```sh
cd tools
npm run beatmap -- ~/Music/song.mp3
```

The MP3 is copied into `beatmaps/`, analyzed, and its chart written next to it; the manifest updates automatically. Use `--all` for every song still missing a chart, `--force` to redo an existing one.

Or in the editor (`/editor/`): **Add MP3…** to import, **Analyze** to generate, drag notes around, then **Save to beatmaps/**. Analysis and saving both happen in Node — no browser download dance, no folder picker.

The game itself can also analyze an uploaded MP3 (the **Load MP3** button) for a one-off play, but songs in the menu always come from a pre-generated chart.

## Building for the web

```sh
node build.js
```

Produces `dist/`: the game, the shared pipeline, and only those songs that actually have a chart. Upload it anywhere static — a plain web host or a `gh-pages` branch. All paths are relative, so a subpath like `user.github.io/vr-game/` works.

The 2.4 MB essentia analyzer is loaded on demand, so visitors who just play a listed song never download it.

## Tech Stack

| Layer | Technology | License |
|-------|-----------|---------|
| VR / rendering | [A-Frame](https://aframe.io) 1.6.0 (WebXR) | MIT |
| 3D / WebGL | [three.js](https://threejs.org) (bundled with A-Frame) | MIT |
| Audio analysis | [essentia.js](https://essentia.upf.edu) (WASM port of Essentia) | AGPL-3.0 |
| Audio (browser) | Web Audio API | W3C standard |
| Audio (Node) | [node-web-audio-api](https://github.com/ircam-ismm/node-web-audio-api) | BSD-3-Clause |
| Language | Vanilla JavaScript, no build step | — |

### Analysis pipeline

Both the browser and the Node tool run the same code (`shared/chart-builder.js`):

- **Melody** — essentia `PredominantPitchMelodia`
- **Onsets** — essentia `OnsetDetectionGlobal` (infogain, hfc, flux combined)
- **BPM** — essentia `PercivalBpmEstimator` / `RhythmExtractor2013`, with a flux-autocorrelation fallback
- **Beat grid** — custom FFT/flux tracking (essentia provides BPM only, not beat-sync)
- **Fallback** — a pure-FFT path runs if essentia is unavailable

Note that Node and browser MP3 decoders differ slightly, so the same song analyzed in each produces the same note timings but somewhat different colors and lanes. Both are perfectly playable.

## Licenses & Credits

- **[A-Frame](https://aframe.io)** — MIT License. Copyright (c) 2015-present A-Frame authors.
- **[three.js](https://threejs.org)** — MIT License. Copyright (c) 2010-2024 three.js authors. Distributed as part of the A-Frame bundle.
- **[essentia.js](https://essentia.upf.edu)** — AGPL-3.0. Copyright (C) 2006-2020 Music Technology Group, Universitat Pompeu Fabra. Vendored in `src/vendor/essentia/`.
- All game code in this repository — project's own code.

### AGPL notice

`essentia.js` is licensed under the **Affero General Public License v3**. This project bundles it for personal/private use. If you **distribute** this project or make it available over a network, the AGPL-3.0 terms apply — including the obligation to offer the corresponding source code of the covered software (essentia.js) to users. See the license headers in `src/vendor/essentia/` for details.
