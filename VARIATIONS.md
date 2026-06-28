# Bubbles — variations to try

A running list of directions for the halftone/dot experiments. The engine has
two swappable seams; almost every idea below is "swap one seam":

- **Disturbance signal** — what moves the dots. Today: mouse position + velocity
  (`bloom`), or audio spectrum (`bloom-boom`). Could be voice, webcam motion, etc.
- **Source pixels** — what the dots draw. Today: a word rendered to a buffer
  (`cmyk-3`), or a still photo sampled once (`bloom`). Could be live video.
- **Force model** — how a disturbance translates to motion (vortex, drag, repel,
  clump, swirl…).

Status legend: ✅ done · ▶ next · 💡 parked

---

## Input sources (what drives the dots)

- ✅ **Mouse vortex** (`bloom`, `cmyk-3`) — cursor swirls/drags the field.
- ✅ **Voice spectrum** (`bloom-boom`) — mic FFT mapped across the image's X axis;
  pitch sweeps the disturbance left→right. *Swaps: disturbance signal.* Easy.
- 💡 **Voice — global agitation** — mic *volume* (not spectrum) shakes the whole
  image at once; silence = crisp, shout = everything blooms apart. *Disturbance
  signal.* Easy. (Alternative voice model to the spectrum one.)
- 💡 **Voice — volume + pitch split** — loudness = intensity, pitch = behavior
  (low = heavy push/swell, high = fast jitter). *Disturbance signal.* Easy-medium.
- 💡 **Voice — at a point** — volume drives strength of a disturbance emanating
  from one fixed point, like a voice-powered cursor. *Disturbance signal.* Easy.
- 💡 **Hand motion (webcam)** — `getUserMedia` video + per-frame frame-differencing
  to find where movement is; that moving hot-spot acts like a cursor pushing dots.
  **Bonus:** push dots *away* to reveal a hidden image underneath — a reason to
  wave your hands to wipe the picture away. *Disturbance signal + a 2nd source
  layer.* Medium (camera + motion diff + reveal layer).
- 💡 **Live face render** — webcam video becomes the live CMYK source: resample
  all dots every frame so your face is rendered as the halftone in real time.
  **Bonus:** background segmentation (e.g. MediaPipe Selfie Segmentation) drops in
  a fake/fictional backdrop so the user is placed somewhere imaginary instead of a
  flat color. *Swaps: source pixels (per-frame) + segmentation.* Hard (per-frame
  resample + ML segmentation + performance budget).

## Interactions (how a disturbance moves the dots)

- ✅ **Vortex / swirl** (`cmyk-3`, `bloom`) — tangential orbit around the cursor.
- 💡 **Local clumping** — near the cursor, dots tug toward their *neighbors* and
  merge into small in-place color clumps along the cursor's trail, instead of all
  swirling. Organic blooms. *Force model.* Easy.
- 💡 **Repel & carve** — dots flee the cursor, opening a clean void; crowd and
  brighten at the rim. *Force model.* Easy.
- 💡 **Speed-driven agitation / color-burst** — use mouse (or input) *speed* to
  pump a global shimmer or a chromatic burst, separate from the directional wake.
  *Force model.* Easy.
- 💡 **Per-dot brightness / hue jitter** — extra color diversity on top of the
  `cmyk-3` variety dial, so the palette reads even less like fixed buckets.
  *Render.* Easy.

## Source / image system (what the dots represent)

- ✅ **Word → negative space** (`cmyk-3`) — letters are a hole in a dot field.
- ✅ **Photo → offset halftone** (`bloom`) — RGB→CMYK rosettes on paper.
- 💡 **cmyk-4 — unified field** — one dot grid where the *letters emerge* from the
  field (dots grow/brighten inside the letterforms) instead of being cut out.
  More cohesive than the negative-space version. *Source + render.* Medium.
- 💡 **Paint-with-photo** — as you distort the dots, they *resample* the image at
  their new position, so dragging smears the actual picture like wet paint rather
  than springing back. *Source sampling per-frame on moved dots.* Medium.
- 💡 **Comic-ink edges / line work** — detect edges in the source and emphasize
  them as ink lines/heavier dots for a stronger comic-book look on top of the
  halftone. *Render + a preprocess pass.* Medium.
- 💡 **Multiple / uploadable images** — swap between several photos, or let the
  user drop in their own image to halftone. *Source.* Easy-medium.

---

### Rough "fastest to try" order
1. Any **voice** or **interaction** tweak (reuses the engine, no new media APIs).
2. **Hand motion** (camera + motion diff + reveal layer).
3. **Live face render** (per-frame resample + background segmentation).
