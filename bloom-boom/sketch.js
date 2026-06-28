// ─── Tunable parameters (exposed as on-page dials) ───────────
const P = {
  // Voice → spectrum / size
  SENSITIVITY: 3.4,      // gain on per-column band energy (tone)
  BAND_SMOOTH: 0.18,     // attack/decay of per-column level
  NOISE_GATE: 0,         // subtract this floor from vol/tone (kills mic hiss)
  VOLUME_SIZE: 2.4,      // how much overall loudness (RMS) grows ALL dots
  TONE_SIZE: 0,          // how much a column's own frequency grows its dots
  BAND_PUSH: 6.6,        // per-column "equalizer lift"
  RES_DROP: 4,           // loud → draw every Nth dot (coarser), survivors grow to fill
  FREQ_LO: 2,            // first usable FFT bin (skip DC/rumble)
  FREQ_HI: 220,          // last usable FFT bin
  FREQ_LOG: 1,           // 1 = log (musical) column→bin mapping, 0 = linear
  // Voice-powered motion emitter (replaces the cursor)
  VOICE_VORTEX: 13.4,    // tangential twirl around the emitter, × volume
  VOICE_PUSH: 11.6,      // radial push away from the emitter, × volume
  EMITTER_RADIUS: 1110,  // falloff radius of the emitter
  STEREO_BIAS: 0.9,      // how far the emitter slides toward the louder side
  // Shared field physics
  MOTION_COUPLING: 0.18,
  FIELD_JITTER: 0.6,
  FIELD_JITTER_MAX: 7.9,
  // Halftone
  DOT_GAIN: 1.4,
  FIELD_COL_COUNT: 180,
};

const CONTROLS = [
  { key: 'SENSITIVITY',     label: 'Mic sensitivity', min: 0.2, max: 4,   step: 0.1 },
  { key: 'BAND_SMOOTH',     label: 'Band smoothing',  min: 0.02, max: 0.6, step: 0.02 },
  { key: 'NOISE_GATE',      label: 'Noise gate',      min: 0,   max: 0.3, step: 0.005 },
  { key: 'VOLUME_SIZE',     label: 'Size · volume',   min: 0,   max: 6,   step: 0.1 },
  { key: 'TONE_SIZE',       label: 'Size · tone',     min: 0,   max: 6,   step: 0.1 },
  { key: 'BAND_PUSH',       label: 'Equalizer lift',  min: 0,   max: 8,   step: 0.2 },
  { key: 'RES_DROP',        label: 'Loud → coarsen',  min: 1,   max: 8,   step: 1 },
  { key: 'VOICE_VORTEX',    label: 'Voice twirl',     min: 0,   max: 16,  step: 0.2 },
  { key: 'VOICE_PUSH',      label: 'Voice push-out',  min: 0,   max: 16,  step: 0.2 },
  { key: 'EMITTER_RADIUS',  label: 'Emitter radius',  min: 150, max: 1400, step: 20 },
  { key: 'STEREO_BIAS',     label: 'Stereo bias',     min: 0,   max: 1,   step: 0.05 },
  { key: 'MOTION_COUPLING', label: 'Motion coupling', min: 0,   max: 0.3, step: 0.01 },
  { key: 'FIELD_JITTER',    label: 'Jitter (quiet)',  min: 0,   max: 3,   step: 0.1 },
  { key: 'FIELD_JITTER_MAX', label: 'Jitter (loud)',  min: 0,   max: 12,  step: 0.1 },
  { key: 'FREQ_LO',         label: 'Freq low bin',    min: 0,   max: 64,  step: 1, rebuild: true },
  { key: 'FREQ_HI',         label: 'Freq high bin',   min: 64,  max: 512, step: 4, rebuild: true },
  { key: 'FREQ_LOG',        label: 'Log freq (0/1)',  min: 0,   max: 1,   step: 1, rebuild: true },
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
let analyser = null;        // main (spectrum + volume); null until mic enabled
let freqData = null;        // frequency bins → per-column tone
let timeData = null;        // time-domain waveform → overall loudness (RMS)
let analyserL = null, analyserR = null;   // per-channel (balance), only if true stereo
let timeL = null, timeR = null;
let stereoActive = false;
let band = [];              // smoothed per-column level (0..1)
let colBin = [];            // FFT bin index per grid column
let volume = 0;             // smoothed overall loudness (0..1)
let balance = 0;            // smoothed L/R balance (-1 left … +1 right)

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

  updateAudio();
  updateMeter();

  background(PAPER);
  blendMode(MULTIPLY);          // overlapping inks darken (kept)

  // Emitter position: center, slid toward the louder side when truly stereo
  const ex = width / 2 + balance * P.STEREO_BIAS * (width / 2);
  const ey = height / 2;
  const erSq = P.EMITTER_RADIUS * P.EMITTER_RADIUS;

  drawDots(ex, ey, erSq);

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

// ─── Audio: mic enable + per-frame analysis ──────────────────

function setupMicOverlay() {
  const btn = document.getElementById('mic-btn');
  const overlay = document.getElementById('mic-overlay');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Connecting…';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 2,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream);

      // Main analyser → spectrum + volume
      const node = ctx.createAnalyser();
      node.fftSize = 1024;
      node.smoothingTimeConstant = 0.8;
      src.connect(node);
      analyser = node;
      freqData = new Uint8Array(node.frequencyBinCount);
      timeData = new Uint8Array(node.fftSize);

      // True stereo only if the device really gives 2 channels
      const settings = stream.getAudioTracks()[0].getSettings();
      stereoActive = (settings.channelCount || 1) >= 2;
      if (stereoActive) {
        const splitter = ctx.createChannelSplitter(2);
        src.connect(splitter);
        analyserL = ctx.createAnalyser(); analyserL.fftSize = 512;
        analyserR = ctx.createAnalyser(); analyserR.fftSize = 512;
        splitter.connect(analyserL, 0);
        splitter.connect(analyserR, 1);
        timeL = new Uint8Array(analyserL.fftSize);
        timeR = new Uint8Array(analyserR.fftSize);
      }

      if (overlay) overlay.classList.add('gone');
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Mic blocked';
      const sub = document.getElementById('mic-sub');
      if (sub) sub.textContent = 'No microphone access — enable it and reload to play.';
    }
  });
}

function rms(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i] - 128) / 128;
    s += v * v;
  }
  return Math.sqrt(s / buf.length);
}

function updateAudio() {
  if (!analyser) return;
  analyser.getByteFrequencyData(freqData);

  // Per-column band (tone) from the frequency bins
  const s = P.BAND_SMOOTH;
  for (let c = 0; c < cols; c++) {
    const raw = (freqData[colBin[c]] || 0) / 255;
    band[c] += (raw - band[c]) * s;
  }

  // Overall loudness from the raw waveform (RMS) — tracks how loud you are
  // regardless of where in the spectrum the energy sits.
  analyser.getByteTimeDomainData(timeData);
  volume += (rms(timeData) - volume) * s;

  // Stereo balance from per-channel time-domain RMS
  if (stereoActive) {
    analyserL.getByteTimeDomainData(timeL);
    analyserR.getByteTimeDomainData(timeR);
    const l = rms(timeL), r = rms(timeR);
    const bal = (l + r) > 0.0008 ? (r - l) / (r + l) : 0;
    balance += (bal - balance) * 0.1;
  }
}

// Live readout: lets you SEE input while silent (confirms mic hiss).
// "low" = left/bass columns, "high" = right/treble columns.
function updateMeter() {
  const m = document.getElementById('audio-meter');
  if (!m) return;
  if (!analyser) { m.textContent = 'mic off'; return; }
  const q = Math.max(1, Math.floor(cols * 0.25));
  let lo = 0, hi = 0;
  for (let i = 0; i < q; i++) lo += band[i];
  for (let i = cols - q; i < cols; i++) hi += band[i];
  lo /= q; hi /= q;
  const gated = Math.max(0, volume - P.NOISE_GATE);
  m.textContent =
    `vol ${volume.toFixed(3)}  gated ${gated.toFixed(3)}  ` +
    `bal ${balance >= 0 ? '+' : ''}${balance.toFixed(2)}  ` +
    `${stereoActive ? 'stereo' : 'mono'}\nlow ${lo.toFixed(2)}  high ${hi.toFixed(2)}`;
}

// ─── Halftone dots ───────────────────────────────────────────

function drawDots(ex, ey, erSq) {
  const vol = analyser ? Math.max(0, volume - P.NOISE_GATE) * P.SENSITIVITY : 0;

  // Loudness coarsens the picture: draw every `stride`th dot, grow it to fill.
  const loud = Math.min(1, vol);
  const stride = 1 + Math.round(loud * (P.RES_DROP - 1));

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];

    // ── Size from overall volume + this column's tone ──
    const tone = analyser ? Math.min(1.5, Math.max(0, band[p.col] - P.NOISE_GATE) * P.SENSITIVITY) : 0;
    let scale = 1 + vol * P.VOLUME_SIZE + tone * P.TONE_SIZE;
    if (scale > 7) scale = 7;
    let jitter = lerp(P.FIELD_JITTER, P.FIELD_JITTER_MAX, Math.min(1, Math.max(vol, tone)));

    // ── Per-column equalizer lift ──
    if (tone > 0.001) p.vy -= tone * P.BAND_PUSH;

    // ── Voice-powered emitter: twirl + push-out, intensity = volume ──
    if (vol > 0.001) {
      const dx = ex - p.x;
      const dy = ey - p.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < erSq && distSq > 0.01) {
        const dist = Math.sqrt(distSq);
        const inv = 1 / dist;
        const prox = map(dist, 0, P.EMITTER_RADIUS, 1, 0);
        const power = vol * prox;
        const tx = -dy * inv;            // tangent → twirl
        const ty = dx * inv;
        p.vx += tx * P.VOICE_VORTEX * power;
        p.vy += ty * P.VOICE_VORTEX * power;
        p.vx += (-dx * inv) * P.VOICE_PUSH * power;  // radial, away from emitter
        p.vy += (-dy * inv) * P.VOICE_PUSH * power;
      }
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

    // ── Coarsening: only the stride lattice is drawn; survivors fill the gap ──
    if (stride > 1 && (p.col % stride !== 0 || p.row % stride !== 0)) continue;
    const cover = stride;                 // grown radius + rosette spread fill the block
    const chOffset = offset * cover;

    // ── Draw the CMYK rosette for this cell ──
    const jx = p.x + (Math.random() - 0.5) * jitter;
    const jy = p.y + (Math.random() - 0.5) * jitter;
    for (let ch = 0; ch < 4; ch++) {
      const ink = p.cmyk[ch];
      if (ink <= 0.02) continue;
      const rad = cellMaxR * Math.sqrt(ink) * P.DOT_GAIN * scale * cover;
      if (rad < 0.15) continue;
      const chn = CHANNELS[ch];
      fill(chn.color[0], chn.color[1], chn.color[2]);
      circle(
        jx + chn.cos * chOffset + (Math.random() - 0.5) * CHANNEL_JITTER,
        jy + chn.sin * chOffset + (Math.random() - 0.5) * CHANNEL_JITTER,
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
  const lo = Math.max(1, Math.floor(P.FREQ_LO));
  const hi = Math.max(lo + 1, Math.floor(P.FREQ_HI));
  for (let c = 0; c < cols; c++) {
    const t = cols > 1 ? c / (cols - 1) : 0;
    colBin[c] = P.FREQ_LOG
      ? Math.round(lo * Math.pow(hi / lo, t))
      : Math.round(lo + (hi - lo) * t);
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
        row: r,
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

  // Live audio meter — read it while silent to confirm any phantom input
  const meter = document.createElement('div');
  meter.id = 'audio-meter';
  meter.textContent = 'enable mic to see levels';
  body.appendChild(meter);

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
