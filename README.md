# Rhythm Slicer VR game

A WebXR rhythm game. Load an MP3, and a beatmap is generated on the fly: melody, rhythm, and onset detection drive colored notes you slice with left (red) and right (blue) sabers in VR.

## Tech Stack

| Layer | Technology | Version | License |
|-------|-----------|---------|---------|
| VR / rendering | [A-Frame](https://aframe.io) (WebXR framework) | 1.6.0 | MIT |
| 3D / WebGL | [three.js](https://threejs.org) (bundled with A-Frame) | (bundled) | MIT |
| Audio analysis | [essentia.js](https://essentia.upf.edu) (WASM port of Essentia) | vendored in `vendor/essentia/` | AGPL-3.0 |
| Audio playback / decoding | Web Audio API (`AudioContext`, `decodeAudioData`, `OfflineAudioContext`) | — | W3C standard |
| Language | Vanilla JavaScript (ES5-style, no build step) | — | — |


### Beatmap analysis pipeline (`analyze.js`)
- **Resampling** to 44.1 kHz via `OfflineAudioContext` (no WASM resampler)
- **Melody**: essentia `PredominantPitchMelodia`
- **Onsets**: essentia `OnsetDetectionGlobal` (infogain, hfc, flux combined)
- **BPM**: essentia `PercivalBpmEstimator` / `RhythmExtractor2013`, with a flux-autocorrelation fallback
- **Beat grid**: custom FFT/flux onset tracking (essentia provides BPM only, not beat-sync)
- **Fallback**: a pure-FFT heuristic path runs if essentia.js fails to load

The engine used for a given analysis (essentia vs. fallback FFT) is shown in the UI and in the browser console.

## Licenses & Credits

- **[A-Frame](https://aframe.io)** — MIT License. Copyright (c) 2015-present A-Frame authors.
- **[three.js](https://threejs.org)** — MIT License. Copyright (c) 2010-2024 three.js authors. Distributed as part of the A-Frame bundle.
- **[essentia.js](https://essentia.upf.edu)** — AGPL-3.0. Copyright (C) 2006-2020 Music Technology Group, Universitat Pompeu Fabra. Vendored in `vendor/essentia/` (`essentia-wasm.es.js`, `essentia-core.es.min.js`).
- **Demo beatmap** (`beatmaps/demo.json`) and all game code in this repository — project's own code.

### AGPL notice
`essentia.js` is licensed under the **Affero General Public License v3**. This project bundles it for personal/private use. If you **distribute** this project or make it available over a network, the AGPL-3.0 terms apply — including the obligation to offer the corresponding source code of the covered software (essentia.js) to users. See the license headers in `vendor/essentia/` for details.
