// ─── Tunable parameters (exposed as on-page dials) ───────────
const P = {
  MOUSE_RADIUS: 140,
  VORTEX_STRENGTH: 4.1,
  VORTEX_INWARD: 0,
  MOUSE_DRAG: 0.36,
  FIELD_SCALE_MAX: 2.3,
  MOTION_COUPLING: 0.18,
  FIELD_JITTER: 0.3,
  FIELD_JITTER_MAX: 7.9,
  DOT_GAIN: 1.25,
  FIELD_COL_COUNT: 180,
};

const CONTROLS = [
  { key: 'MOUSE_RADIUS',    label: 'Vortex radius',   min: 40,  max: 400, step: 5 },
  { key: 'VORTEX_STRENGTH', label: 'Vortex strength', min: 0,   max: 8,   step: 0.1 },
  { key: 'VORTEX_INWARD',   label: 'Inward pull',     min: 0,   max: 0.15, step: 0.005 },
  { key: 'MOUSE_DRAG',      label: 'Mouse drag (speed)', min: 0, max: 1,  step: 0.02 },
  { key: 'FIELD_SCALE_MAX', label: 'Dot swell',       min: 1,   max: 5,   step: 0.1 },
  { key: 'MOTION_COUPLING', label: 'Motion coupling', min: 0,   max: 0.3, step: 0.01 },
  { key: 'FIELD_JITTER',    label: 'Jitter (base)',   min: 0,   max: 3,   step: 0.1 },
  { key: 'FIELD_JITTER_MAX', label: 'Jitter (near cursor)', min: 0, max: 10, step: 0.1 },
  { key: 'DOT_GAIN',        label: 'Dot gain',        min: 0.4, max: 2,   step: 0.05 },
  { key: 'FIELD_COL_COUNT', label: 'Resolution',      min: 40,  max: 180, step: 4, rebuild: true },
];

// ─── Fixed configuration ─────────────────────────────────────
const PAPER = '#f5f0e8';
const FIELD_SPRING = 0.05;        // pull back to home cell
const FIELD_DAMPING = 0.85;
const OFFSET_FRAC = 0.16;         // rosette channel separation (× spacing)
const DOT_MAX_FRAC = 0.62;        // full-ink dot radius (× spacing)
const CHANNEL_JITTER = 0.5;       // per-channel vibrato within a rosette

// Process CMYK inks, each on its own screen angle (classic offset rosette)
const CHANNELS = [
  { color: [0, 255, 255], angle: 15 },  // Cyan
  { color: [255, 0, 255], angle: 75 },  // Magenta
  { color: [255, 255, 0], angle: 0 },   // Yellow
  { color: [0, 0, 0],     angle: 45 },  // Key (black)
];
for (let i = 0; i < CHANNELS.length; i++) {
  const a = CHANNELS[i].angle * Math.PI / 180;
  CHANNELS[i].cos = Math.cos(a);
  CHANNELS[i].sin = Math.sin(a);
}

// ─── State ───────────────────────────────────────────────────
let imgSource;            // the source photo
let pg;                   // offscreen buffer: image drawn at canvas size, sampled per cell
let particles = [];       // one per grid cell, carrying its CMYK ink mix
let cols, rows, spacing, cellMaxR, offset;
let needsRebuild = true;

// ─── p5.js Lifecycle ─────────────────────────────────────────

function preload() {
  imgSource = loadImage('superbloom.jpg');
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);
  noStroke();
  buildControls();
}

function draw() {
  if (needsRebuild) {
    buildPicture();
    needsRebuild = false;
  }

  background(PAPER);
  blendMode(MULTIPLY);        // subtractive: overlapping inks darken (offset print)

  const mx = mouseX;
  const my = mouseY;
  const mvx = mouseX - pmouseX;
  const mvy = mouseY - pmouseY;
  const mrSq = P.MOUSE_RADIUS * P.MOUSE_RADIUS;

  drawDots(mx, my, mrSq, mvx, mvy);

  blendMode(BLEND);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  needsRebuild = true;
}

// ─── Halftone dots ───────────────────────────────────────────

function drawDots(mx, my, mrSq, mvx, mvy) {
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];

    const dx = mx - p.x;
    const dy = my - p.y;
    const distSq = dx * dx + dy * dy;

    let scale = 1;
    let jitter = P.FIELD_JITTER;

    if (distSq < mrSq && distSq > 0.01) {
      // Vortex + speed-drag smear the wet ink near the cursor
      const dist = Math.sqrt(distSq);
      const inv = 1 / dist;
      const tx = -dy * inv;
      const ty = dx * inv;
      const prox = map(dist, 0, P.MOUSE_RADIUS, 1, 0);
      p.vx += tx * P.VORTEX_STRENGTH * prox + dx * P.VORTEX_INWARD;
      p.vy += ty * P.VORTEX_STRENGTH * prox + dy * P.VORTEX_INWARD;
      p.vx += mvx * P.MOUSE_DRAG * prox;
      p.vy += mvy * P.MOUSE_DRAG * prox;
      scale = lerp(1, P.FIELD_SCALE_MAX, prox);
      jitter = lerp(P.FIELD_JITTER, P.FIELD_JITTER_MAX, prox);
    }

    // Motion coupling — disturbance propagates through neighbors (colors stay put)
    const nb = p.neighbors;
    const n = nb.length;
    if (n > 0) {
      let avx = 0, avy = 0;
      for (let j = 0; j < n; j++) {
        const q = particles[nb[j]];
        avx += q.vx; avy += q.vy;
      }
      const invN = 1 / n;
      p.vx += (avx * invN - p.vx) * P.MOTION_COUPLING;
      p.vy += (avy * invN - p.vy) * P.MOTION_COUPLING;
    }

    // Spring home + damping + integrate
    p.vx += (p.homeX - p.x) * FIELD_SPRING;
    p.vy += (p.homeY - p.y) * FIELD_SPRING;
    p.vx *= FIELD_DAMPING;
    p.vy *= FIELD_DAMPING;
    p.x += p.vx;
    p.y += p.vy;

    // Draw the CMYK rosette for this cell
    const jx = p.x + (Math.random() - 0.5) * jitter;
    const jy = p.y + (Math.random() - 0.5) * jitter;
    for (let ch = 0; ch < 4; ch++) {
      const ink = p.cmyk[ch];
      if (ink <= 0.02) continue;
      const rad = cellMaxR * Math.sqrt(ink) * P.DOT_GAIN * scale;
      if (rad < 0.15) continue;
      const chn = CHANNELS[ch];
      fill(chn.color[0], chn.color[1], chn.color[2]);
      circle(
        jx + chn.cos * offset + (Math.random() - 0.5) * CHANNEL_JITTER,
        jy + chn.sin * offset + (Math.random() - 0.5) * CHANNEL_JITTER,
        rad * 2
      );
    }
  }
}

// ─── Sample the image into a grid of CMYK cells ──────────────

function buildPicture() {
  if (pg) pg.remove();
  pg = createGraphics(width, height);
  pg.pixelDensity(1);
  pg.background(PAPER);
  if (imgSource) {
    // "cover" fit: scale to fill the canvas, center-crop the overflow
    const s = Math.max(width / imgSource.width, height / imgSource.height);
    const dw = imgSource.width * s;
    const dh = imgSource.height * s;
    pg.image(imgSource, (width - dw) / 2, (height - dh) / 2, dw, dh);
  }
  pg.loadPixels();

  spacing = max(4, floor(width / P.FIELD_COL_COUNT));
  cols = floor(width / spacing);
  rows = floor(height / spacing);
  const ox = (width - cols * spacing) / 2 + spacing / 2;
  const oy = (height - rows * spacing) / 2 + spacing / 2;
  cellMaxR = spacing * DOT_MAX_FRAC;
  offset = spacing * OFFSET_FRAC;

  const old = particles;
  const next = [];
  const lookup = [];
  let k = 0;
  for (let c = 0; c < cols; c++) {
    lookup[c] = [];
    for (let r = 0; r < rows; r++) {
      const hx = ox + c * spacing;
      const hy = oy + r * spacing;
      const px = constrain(floor(hx), 0, pg.width - 1);
      const py = constrain(floor(hy), 0, pg.height - 1);
      const idx = (py * pg.width + px) * 4;
      const rr = pg.pixels[idx] / 255;
      const gg = pg.pixels[idx + 1] / 255;
      const bb = pg.pixels[idx + 2] / 255;

      // RGB → CMYK
      const kk = 1 - Math.max(rr, gg, bb);
      let cy = 0, mg = 0, yl = 0;
      if (kk < 0.9999) {
        const inv = 1 / (1 - kk);
        cy = (1 - rr - kk) * inv;
        mg = (1 - gg - kk) * inv;
        yl = (1 - bb - kk) * inv;
      }

      const prev = old[k++];
      lookup[c][r] = next.length;
      next.push({
        x: prev ? prev.x : hx,
        y: prev ? prev.y : hy,
        vx: prev ? prev.vx : 0,
        vy: prev ? prev.vy : 0,
        homeX: hx,
        homeY: hy,
        cmyk: [cy, mg, yl, kk],
        neighbors: [],
      });
    }
  }

  // Wire 4 grid neighbors (full grid — every cell has a dot)
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const nb = next[lookup[c][r]].neighbors;
      if (c > 0) nb.push(lookup[c - 1][r]);
      if (c < cols - 1) nb.push(lookup[c + 1][r]);
      if (r > 0) nb.push(lookup[c][r - 1]);
      if (r < rows - 1) nb.push(lookup[c][r + 1]);
    }
  }

  particles = next;
}

// ─── On-page Dials ───────────────────────────────────────────

function buildControls() {
  const body = document.getElementById('panel-body');
  const head = document.getElementById('panel-head');
  if (!body || !head) return;

  head.addEventListener('click', () => {
    document.getElementById('panel').classList.toggle('collapsed');
  });

  CONTROLS.forEach(cfg => {
    const row = document.createElement('div');
    row.className = 'ctl';

    const label = document.createElement('label');
    label.className = 'ctl-label';
    label.textContent = cfg.label;

    const value = document.createElement('span');
    value.className = 'ctl-value';
    value.textContent = fmtVal(P[cfg.key], cfg.step);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = cfg.min;
    slider.max = cfg.max;
    slider.step = cfg.step;
    slider.value = P[cfg.key];
    slider.addEventListener('input', () => {
      P[cfg.key] = parseFloat(slider.value);
      value.textContent = fmtVal(P[cfg.key], cfg.step);
      if (cfg.rebuild) needsRebuild = true;
    });

    const labelRow = document.createElement('div');
    labelRow.className = 'ctl-top';
    labelRow.appendChild(label);
    labelRow.appendChild(value);

    row.appendChild(labelRow);
    row.appendChild(slider);
    body.appendChild(row);
  });

  const copy = document.createElement('button');
  copy.id = 'panel-copy';
  copy.textContent = 'Copy values';
  copy.addEventListener('click', () => {
    const lines = Object.keys(P).map(key => `  ${key}: ${P[key]},`).join('\n');
    const text = `const P = {\n${lines}\n};`;
    navigator.clipboard.writeText(text).then(() => {
      copy.textContent = 'Copied!';
      setTimeout(() => { copy.textContent = 'Copy values'; }, 1200);
    }).catch(() => {
      copy.textContent = 'Copy failed';
      setTimeout(() => { copy.textContent = 'Copy values'; }, 1200);
    });
  });
  body.appendChild(copy);
}

function fmtVal(v, step) {
  const decimals = step >= 1 ? 0 : (step < 0.01 ? 3 : 2);
  return v.toFixed(decimals);
}
