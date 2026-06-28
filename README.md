# bubbles

A set of typographic / halftone experiments — dot fields that render text and
photos, and react to the cursor, the voice, and the hands. Each variant is a
self-contained, zero-build static page (plain HTML + [p5.js](https://p5js.org/));
the root page links them all.

## Variants

| | Variant | Folder | What it does |
|---|---|---|---|
| 🫧 | **Particle Repulsion** | [`particle-repulsion/`](particle-repulsion/) | Halftone text on an even grid with neighbour-repulsion physics so dots never overlap. Custom GT-Haptik typeface. Type a word to reshape it. |
| ⠿ | **Sparse Trails** | [`sparse-trails/`](sparse-trails/) | 13 quantized dot sizes; bright cores dissolve into trailing dots that fade into black. |
| ◍ | **Distance Field** | [`jovial-tharp/`](jovial-tharp/) | High-resolution distance field with a wide size ratio and wave physics — dense field, dramatic bloom. |
| 🖨 | **CMYK Halftone** | [`cmyk/`](cmyk/) | Offset-print look: cyan/magenta/yellow/black rosettes on paper, subtractive colour mixing. |
| ✦ | **CMYK Convergence** | [`cmyk-3/`](cmyk-3/) | Black field of small single-channel dots; additive blending. On hover they swirl and blend into new colours; the word reads as negative space. |
| 🌸 | **CMYK Bloom** | [`bloom/`](bloom/) | A photo recreated as an interactive CMYK offset halftone — smear it with the cursor and it springs back and reforms. |
| 🔊 | **Bloom Boom** | [`bloom-boom/`](bloom-boom/) | The bloom photo driven by your **voice**: loudness grows and stirs the dots, loud sounds coarsen the image, stereo-aware. Auto-calibrates the mic noise floor. |
| ✋ | **Wave** | [`wave/`](wave/) | **Hand-tracked** ([MediaPipe](https://ai.google.dev/edge/mediapipe)): wave to magnetically push the printed photo aside and reveal the live webcam (you) underneath. Only *moving* hands react; closer hands have a bigger field. Solid / See-through modes, with a rain-in intro. |

## Conventions

Most interactive variants share a small set of conventions:

- **`Ctrl + H`** — toggle the on-screen dial panel (live parameter tuning).
- **Copy values** — button in the dial panel that copies the current settings.
- Variants that need a **microphone** or **camera** show a one-click enable
  overlay first (permission is requested only after you click).

## Tech

- [p5.js](https://p5js.org/) (loaded from CDN) for canvas rendering.
- **Web Audio API** (`AnalyserNode`) for the voice variant.
- **MediaPipe HandLandmarker** for hand tracking in Wave.
- No build step, no framework, no server — every variant is static files.

## Run locally

Serve the repo root with any static server, then open the printed URL:

```bash
python3 -m http.server 8000
# → http://localhost:8000/
```

A local server (rather than opening the files directly) is required so the
camera/microphone variants get a secure context (`localhost` counts), and so
relative asset/CDN loads work.

## Deploy

Static site, deployed on [Vercel](https://vercel.com/) (`vercel.json` sets a
no-build, root-output config with clean URLs). Pushing to `main` redeploys.

## Ideas / roadmap

See [`VARIATIONS.md`](VARIATIONS.md) for directions still to explore (live-face
render, paint-with-photo, comic-ink edges, and more), each tagged with which part
of the engine it changes and a rough difficulty.
