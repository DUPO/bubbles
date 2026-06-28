// ─── Tunable parameters (exposed as on-page dials) ───────────
const P = {
  // Voice → spectrum
  SENSITIVITY: 1.4,      // gain on band energy before it drives forces
  BAND_SMOOTH: 0.18,     // attack/decay of per-column level (low = smoother/slower)
  BAND_PUSH: 3.2,        // upward "equalizer lift" force per unit level
  FREQ_LO: 2,            // first usable FFT bin (skip DC/rumble)
  FREQ_HI: 220,          // last usable FFT bin (top bins are usually empty)
  FREQ_LOG: 1,           // 1 = log frequency mapping (musical), 0 = linear
  // Shared field physics (from bloom)
  FIELD_SCALE_MAX: 2.3,
  FIELD_JITTER: 0.3,
  FIELD_JITTER_MAX: 7.9,
  MOTION_COUPLING: 0.18,
  // Mouse vortex (fallback + bonus, composes with voice)
  MOUSE_RADIUS: 140,
  VORTEX_STRENGTH: 4.1,
  MOUSE_DRAG: 0.36,
  // Halftone
  DOT_GAIN: 1.25,
  FIELD_COL_COUNT: 180,
};

const CONTROLS = [
  { key: 'SENSITIVITY',     label: 'Mic sensitivity', min: 0.2, max: 4,   step: 0.1 },
  { key: 'BAND_SMOOTH',     label: 'Band smoothing',  min: 0.02, max: 0.6, step: 0.02 },
  { key: 'BAND_PUSH',       label: 'Equalizer lift',  min: 0,   max: 10,  step: 0.2 },
  { key: 'FREQ_LO',         label: 'Freq low bin',    min: 0,   max: 64,  step: 1, rebuild: true },
  { key: 'FREQ_HI',         label: 'Freq high bin',   min: 64,  max: 512, step: 4, rebuild: true },
  { key: 'FREQ_LOG',        label: 'Log freq (0/1)',  min: 0,   max: 1,   step: 1, rebuild: true },
  { key: 'FIELD_SCALE_MAX', label: 'Dot swell',       min: 1,   max: 5,   step: 0.1 },
  { key: 'FIELD_JITTER',    label: 'Jitter (quiet)',  min: 0,   max: 3,   step: 0.1 },
  { key: 'FIELD_JITTER_MAX', label: 'Jitter (loud)',  min: 0,   max: 12,  step: 0.1 },
  { key: 'MOTION_COUPLING', label: 'Motion coupling', min: 0,   max: 0.3, step: 0.01 },
  { key: 'VORTEX_STRENGTH', label: 'Mouse vortex',    min: 0,   max: 8,   step: 0.1 },
  { key: 'MOUSE_DRAG',      label: 'Mouse drag',      min: 0,   max: 1,   step: 0.02 },
  { key: 'DOT_GAIN',        label: 'Dot gain',        min: 0.4, max: 2,   step: 0.05 },
  { key: 'FIELD_COL_COUNT', label: 'Resolution',      min: 40,  max: 180, step: 4, rebuild: true },
];

// ─── Fixed configuration ─────────────────────────────────────
const PAPER = '#f5f0e8';
const FIELD_SPRING = 0.05;
const FIELD_DAMPING = 0.85;
const OFFSET_FRAC = 0.16;
const DOT_MAX_FRAC = 0.62;
const CHANNEL_JITTER = 0.5;

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
let imgSource;
let pg;
let particles = [];
let cols, rows, spacing, cellMaxR, offset;
let needsRebuild = true;

// Audio
let analyser = null;        // null until the user enables the mic
let freqData = null;        // Uint8Array of FFT bin energies
let band = [];              // smoothed level per grid column (0..1)
let colBin = [];            // precomputed FFT bin index per grid column

// ─── p5.js Lifecycle ─────────────────────────────────────────

function preload() {
  imgSource = loadImage('superbloom.jpg');
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);
  noStroke();
  buildControls();
  window.addEventListener('keydown', onKey);
  setupMicOverlay();
}

function draw() {
  if (needsRebuild) {
    buildPicture();
    needsRebuild = false;
  }

  updateBands();

  background(PAPER);
  blendMode(MULTIPLY);

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

function onKey(e) {
  if ((e.key === 'h' || e.key === 'H') && e.ctrlKey) {
    e.preventDefault();
    document.getElementById('panel').classList.toggle('hidden');
    const hint = document.getElementById('key-hint');
    if (hint) hint.style.display = 'none';
  }
}

// ─── Audio: mic enable + per-frame spectrum ──────────────────

function setupMicOverlay() {
  const btn = document.getElementById('mic-btn');
  const overlay = document.getElementById('mic-overlay');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Connecting…';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream);
      const node = ctx.createAnalyser();
      node.fftSize = 1024;                  // → 512 frequency bins
      node.smoothingTimeConstant = 0.8;
      src.connect(node);
      analyser = node;
      freqData = new Uint8Array(node.frequencyBinCount);
      if (overlay) overlay.classList.add('gone');
    } catch (err) {
      // Permission denied / no mic → fall back to mouse-only
      btn.disabled = false;
      btn.textContent = 'Mic blocked — use mouse instead';
      const sub = document.getElementById('mic-sub');
      if (sub) sub.textContent = 'No microphone access. The image still reacts to your cursor.';
      setTimeout(() => { if (overlay) overlay.classList.add('gone'); }, 2200);
    }
  });
}

// Smooth each grid column's level toward its mapped FFT bin energy.
function updateBands() {
  if (!analyser) return;                    // mouse-only until mic is on
  analyser.getByteFrequencyData(freqData);
  const s = P.BAND_SMOOTH;
  for (let c = 0; c < cols; c++) {
    const raw = (freqData[colBin[c]] || 0) / 255;
    band[c] += (raw - band[c]) * s;
  }
}

// ─── Halftone dots ───────────────────────────────────────────

function drawDots(mx, my, mrSq, mvx, mvy) {
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];

    let scale = 1;
    let jitter = P.FIELD_JITTER;

    // ── Voice: this dot's column band drives swell / jitter / lift ──
    const level = analyser ? Math.min(1.5, band[p.col] * P.SENSITIVITY) : 0;
    if (level > 0.001) {
      scale = lerp(1, P.FIELD_SCALE_MAX, Math.min(1, level));
      jitter = lerp(P.FIELD_JITTER, P.FIELD_JITTER_MAX, Math.min(1, level));
      p.vy -= level * P.BAND_PUSH;          // equalizer lift
    }

    // ── Mouse vortex + drag (composes with voice; sole input if no mic) ──
    const dx = mx - p.x;
    const dy = my - p.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < mrSq && distSq > 0.01) {
      const dist = Math.sqrt(distSq);
      const inv = 1 / dist;
      const tx = -dy * inv;
      const ty = dx * inv;
      const prox = map(dist, 0, P.MOUSE_RADIUS, 1, 0);
      p.vx += tx * P.VORTEX_STRENGTH * prox;
      p.vy += ty * P.VORTEX_STRENGTH * prox;
      p.vx += mvx * P.MOUSE_DRAG * prox;
      p.vy += mvy * P.MOUSE_DRAG * prox;
      scale = Math.max(scale, lerp(1, P.FIELD_SCALE_MAX, prox));
      jitter = Math.max(jitter, lerp(P.FIELD_JITTER, P.FIELD_JITTER_MAX, prox));
    }

    // ── Motion coupling — disturbance ripples through neighbors ──
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

    // ── Spring home + damping + integrate ──
    p.vx += (p.homeX - p.x) * FIELD_SPRING;
    p.vy += (p.homeY - p.y) * FIELD_SPRING;
    p.vx *= FIELD_DAMPING;
    p.vy *= FIELD_DAMPING;
    p.x += p.vx;
    p.y += p.vy;

    // ── Draw the CMYK rosette for this cell ──
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

  // Map each column → an FFT bin (linear or log across the usable range)
  band = new Array(cols).fill(0);
  colBin = new Array(cols);
  const lo = Math.max(0, Math.floor(P.FREQ_LO));
  const hi = Math.max(lo + 1, Math.floor(P.FREQ_HI));
  for (let c = 0; c < cols; c++) {
    const t = cols > 1 ? c / (cols - 1) : 0;
    let bin;
    if (P.FREQ_LOG) {
      bin = Math.round(lo * Math.pow(hi / lo, t));   // log sweep
    } else {
      bin = Math.round(lo + (hi - lo) * t);          // linear sweep
    }
    colBin[c] = bin;
  }

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
        col: c,
        cmyk: [cy, mg, yl, kk],
        neighbors: [],
      });
    }
  }

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
