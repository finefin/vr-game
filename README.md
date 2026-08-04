# Rhythm Sword VR game

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

### Demos & pre-generated beatmaps
`beatmaps/manifest.json` lists the selectable demos shown in the VR demo picker:

```json
{
  "demos": [
    { "name": "LD46 Dancing Bear", "audio": "song.mp3", "chart": "song.json" }
  ]
}
```

- Every menu song must have a pre-generated beatmap JSON (its `chart`) to be playable — selecting a song never analyzes. A demo with an empty `chart` is listed but not playable until its beatmap exists.
- Analysis only happens for **uploaded** MP3s (the **Load MP3** button).
- `manifest.json` is generated from the folder contents — drop audio files and beatmap JSONs into `beatmaps/` and run:

  ```sh
  python3 beatmaps/scan.py
  ```

  It pairs each audio file with a beatmap JSON of the same name (falling back to a substring match, so `LD46_Dancing_Bear.json` pairs with the full `finefin - ... - 05 LD46 Dancing Bear.mp3`), keeps curated names/order, and appends new files. Names/`chart` overrides survive rescanning.

### Generating a beatmap (desktop only)
On weak devices (e.g., Quest 1) the built-in browser can't run the essentia WASM, so pre-generate charts once in a desktop browser:

1. Click **Load MP3** and pick the song from `beatmaps/`.
2. Click **Analyze** to generate the beatmap with essentia (shown in the status/system line).
3. Click **Save beatmap to folder…** and select the project's `beatmaps/` folder to write the JSON directly there (Chrome/Edge). On other browsers it falls back to **Download beatmap** — move the JSON into `beatmaps/` yourself.
4. Run `python3 beatmaps/scan.py` (or set the demo's `chart` manually).

The headset then loads the chart and plays the MP3 directly — no analysis on the device.

## Licenses & Credits

- **[A-Frame](https://aframe.io)** — MIT License. Copyright (c) 2015-present A-Frame authors.
- **[three.js](https://threejs.org)** — MIT License. Copyright (c) 2010-2024 three.js authors. Distributed as part of the A-Frame bundle.
- **[essentia.js](https://essentia.upf.edu)** — AGPL-3.0. Copyright (C) 2006-2020 Music Technology Group, Universitat Pompeu Fabra. Vendored in `vendor/essentia/` (`essentia-wasm.es.js`, `essentia-core.es.min.js`).
- **Demo beatmap** (`beatmaps/demo.json`) and all game code in this repository — project's own code.

### AGPL notice
`essentia.js` is licensed under the **Affero General Public License v3**. This project bundles it for personal/private use. If you **distribute** this project or make it available over a network, the AGPL-3.0 terms apply — including the obligation to offer the corresponding source code of the covered software (essentia.js) to users. See the license headers in `vendor/essentia/` for details.
