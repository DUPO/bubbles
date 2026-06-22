// ─── Tunable parameters (exposed as on-page dials) ───────────
const P = {
  MOUSE_RADIUS: 260,
  VORTEX_STRENGTH: 0.8,
  VORTEX_INWARD: 0,
  MOUSE_DRAG: 1,
  FIELD_SCALE_MAX: 4.4,
  MOTION_COUPLING: 0.24,
  COLOR_BLEED: 0.6,
  COLOR_RECOVER: 0.235,
  COLOR_VARIETY: 1,
  ACTIVITY_SCALE: 3,
  FIELD_ALPHA: 225,
  FIELD_JITTER: 2.1,
  FIELD_JITTER_MAX: 6.7,
  FIELD_COL_COUNT: 80,
};

// Dial definitions → generate the on-page sliders. `rebuild: true` means
// changing it re-lays-out the field (grid density), so we flag a rebuild.
const CONTROLS = [
  { key: 'MOUSE_RADIUS',    label: 'Vortex radius',   min: 40,    max: 400, step: 5 },
  { key: 'VORTEX_STRENGTH', label: 'Vortex strength', min: 0,     max: 8,   step: 0.1 },
  { key: 'VORTEX_INWARD',   label: 'Inward pull',     min: 0,     max: 0.15, step: 0.005 },
  { key: 'MOUSE_DRAG',      label: 'Mouse drag (speed)', min: 0,  max: 1,   step: 0.02 },
  { key: 'FIELD_SCALE_MAX', label: 'Dot swell',       min: 1,     max: 8,   step: 0.1 },
  { key: 'MOTION_COUPLING', label: 'Motion coupling', min: 0,     max: 0.3, step: 0.01 },
  { key: 'COLOR_BLEED',     label: 'Color bleed',     min: 0,     max: 0.6, step: 0.01 },
  { key: 'COLOR_RECOVER',   label: 'Color recover',   min: 0.005, max: 0.3, step: 0.005 },
  { key: 'COLOR_VARIETY',   label: 'Color variety',   min: 0,     max: 1,   step: 0.05, rebuild: true },
  { key: 'ACTIVITY_SCALE',  label: 'Activity thresh', min: 0.5,   max: 8,   step: 0.1 },
  { key: 'FIELD_ALPHA',     label: 'Dot opacity',     min: 30,    max: 255, step: 5 },
  { key: 'FIELD_JITTER',    label: 'Jitter (base)',   min: 0,     max: 4,   step: 0.1 },
  { key: 'FIELD_JITTER_MAX', label: 'Jitter (near cursor)', min: 0, max: 10, step: 0.1 },
  { key: 'FIELD_COL_COUNT', label: 'Field density',   min: 30,    max: 140, step: 2, rebuild: true },
];

// ─── Fixed configuration ─────────────────────────────────────
const BG_COLOR = '#000000';
const FIELD_DOT_MIN = 1.2;        // px radius at grid rest
const FIELD_DOT_MAX = 2.8;        // px radius variation
const FIELD_SPRING = 0.05;        // pull back to home cell
const FIELD_DAMPING = 0.85;
const TEXT_BRIGHTNESS_THRESHOLD = 30;
const RADIUS_EASE_IN = 0.12;
const RADIUS_EASE_OUT = 0.06;

// Channels: Cyan, Magenta, Yellow, White (additive on black)
const CHANNELS = [
  { color: [0, 255, 255] },   // Cyan
  { color: [255, 0, 255] },   // Magenta
  { color: [255, 255, 0] },   // Yellow
  { color: [255, 255, 255] }, // White
];

// ─── State ───────────────────────────────────────────────────
let pg;                    // offscreen text buffer — masks the field's negative space
let fieldParticles = [];   // small single-channel background dots
let currentText = 'DUPO';
let needsRebuild = true;
let inputEl;

// ─── p5.js Lifecycle ─────────────────────────────────────────

function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);
  noStroke();

  inputEl = document.getElementById('text-input');
  inputEl.addEventListener('input', onTextChange);

  buildControls();
  window.addEventListener('keydown', onKey);
}

function onKey(e) {
  // Ctrl+H toggles the dials — a combo, so plain typing in the word field is untouched
  if ((e.key === 'h' || e.key === 'H') && e.ctrlKey) {
    e.preventDefault();
    document.getElementById('panel').classList.toggle('hidden');
    const hint = document.getElementById('key-hint');
    if (hint) hint.style.display = 'none';
  }
}

function draw() {
  if (needsRebuild) {
    renderTextToBuffer();   // still used as the negative-space mask for the field
    rebuildField();
    needsRebuild = false;
  }

  background(BG_COLOR);
  blendMode(SCREEN);          // additive: overlaps brighten and mix

  const mx = mouseX;
  const my = mouseY;
  const mvx = mouseX - pmouseX;   // cursor velocity this frame (px)
  const mvy = mouseY - pmouseY;
  const mrSq = P.MOUSE_RADIUS * P.MOUSE_RADIUS;

  drawField(mx, my, mrSq, mvx, mvy);

  blendMode(BLEND);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  needsRebuild = true;
}

// ─── Field Layer ─────────────────────────────────────────────

function drawField(mx, my, mrSq, mvx, mvy) {
  for (let i = 0; i < fieldParticles.length; i++) {
    const p = fieldParticles[i];

    const dx = mx - p.x;
    const dy = my - p.y;
    const distSq = dx * dx + dy * dy;

    let jitter = P.FIELD_JITTER;   // ramps up with proximity below

    if (distSq < mrSq && distSq > 0.01) {
      // Vortex: spin around the cursor (tangential) + a touch inward, so
      // dots orbit and cross each other, blending C/M/Y/white as they pass.
      const dist = Math.sqrt(distSq);
      const inv = 1 / dist;
      const tx = -dy * inv;   // unit tangent (rotate cursor→dot vector 90° CCW)
      const ty = dx * inv;
      const proximity = map(dist, 0, P.MOUSE_RADIUS, 1, 0);   // 1 at cursor → 0 at edge
      const spin = P.VORTEX_STRENGTH * proximity;
      p.vx += tx * spin + dx * P.VORTEX_INWARD;
      p.vy += ty * spin + dy * P.VORTEX_INWARD;
      // Drag/wake: shove dots along the cursor's travel, scaled by speed & proximity
      p.vx += mvx * P.MOUSE_DRAG * proximity;
      p.vy += mvy * P.MOUSE_DRAG * proximity;
      const scale = lerp(1.0, P.FIELD_SCALE_MAX, proximity);
      p.r = lerp(p.r, p.baseR * scale, RADIUS_EASE_IN);
      // More vibrato the closer the dot is to the cursor
      jitter = lerp(P.FIELD_JITTER, P.FIELD_JITTER_MAX, proximity);
    } else {
      p.r = lerp(p.r, p.baseR, RADIUS_EASE_OUT);
    }

    // Neighbor coupling — one pass over grid neighbors for both motion & color
    const nb = p.neighbors;
    const n = nb.length;
    if (n > 0) {
      let avx = 0, avy = 0, ar = 0, ag = 0, ab = 0;
      for (let j = 0; j < n; j++) {
        const q = fieldParticles[nb[j]];
        avx += q.vx; avy += q.vy;
        ar += q.col[0]; ag += q.col[1]; ab += q.col[2];
      }
      const invN = 1 / n;
      // Motion: drift toward neighbors' average velocity → disturbances propagate
      p.vx += (avx * invN - p.vx) * P.MOTION_COUPLING;
      p.vy += (avy * invN - p.vy) * P.MOTION_COUPLING;
      // Color: bleed toward neighbors' average, but only as much as this dot is moving
      const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      const bleed = P.COLOR_BLEED * Math.min(1, speed / P.ACTIVITY_SCALE);
      p.col[0] += (ar * invN - p.col[0]) * bleed;
      p.col[1] += (ag * invN - p.col[1]) * bleed;
      p.col[2] += (ab * invN - p.col[2]) * bleed;
    }

    // Relax color back toward the dot's base channel when things calm down
    p.col[0] += (p.base[0] - p.col[0]) * P.COLOR_RECOVER;
    p.col[1] += (p.base[1] - p.col[1]) * P.COLOR_RECOVER;
    p.col[2] += (p.base[2] - p.col[2]) * P.COLOR_RECOVER;

    // Spring home + damping
    p.vx += (p.homeX - p.x) * FIELD_SPRING;
    p.vy += (p.homeY - p.y) * FIELD_SPRING;
    p.vx *= FIELD_DAMPING;
    p.vy *= FIELD_DAMPING;
    p.x += p.vx;
    p.y += p.vy;

    // Vibrato + draw (jitter ramps up near the cursor)
    const jx = p.x + (Math.random() - 0.5) * jitter;
    const jy = p.y + (Math.random() - 0.5) * jitter;
    fill(p.col[0], p.col[1], p.col[2], P.FIELD_ALPHA);
    circle(jx, jy, p.r * 2);
  }
}

// Integer hash with good avalanche — same (c,r) always maps to the same
// value, but neighbors land far apart, so colors scatter without a pattern.
function hashCell(c, r) {
  let h = Math.imul(c, 374761393) + Math.imul(r, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

function rebuildField() {
  const old = fieldParticles;
  const spacing = max(4, floor(width / P.FIELD_COL_COUNT));
  const cols = floor(width / spacing);
  const rows = floor(height / spacing);
  const ox = (width - cols * spacing) / 2 + spacing / 2;
  const oy = (height - rows * spacing) / 2 + spacing / 2;

  const next = [];
  const lookup = [];
  let k = 0;
  for (let c = 0; c < cols; c++) {
    lookup[c] = [];
    for (let r = 0; r < rows; r++) {
      const hx = ox + c * spacing;
      const hy = oy + r * spacing;

      // Skip cells that fall on the letterforms — field is the surround
      const px = constrain(floor(hx / width * (pg.width - 1)), 0, pg.width - 1);
      const py = constrain(floor(hy / height * (pg.height - 1)), 0, pg.height - 1);
      if (pg.pixels[(py * pg.width + px) * 4] > TEXT_BRIGHTNESS_THRESHOLD) continue;

      // Well-mixed per-cell hash → scattered channel/size with no visible pattern
      const h = hashCell(c, r);
      const channelIdx = h & 3;
      const sizeNoise = ((h >>> 2) & 1023) / 1023;
      const baseR = FIELD_DOT_MIN + sizeNoise * (FIELD_DOT_MAX - FIELD_DOT_MIN);

      // Drift this dot's base color a random amount toward another channel,
      // turning 4 pure colors into a continuum of in-between hues.
      const src = CHANNELS[channelIdx].color;
      const dst = CHANNELS[(channelIdx + 1 + ((h >>> 12) % 3)) & 3].color;
      const t = ((h >>> 20) & 255) / 255 * P.COLOR_VARIETY;
      const base = [
        src[0] + (dst[0] - src[0]) * t,
        src[1] + (dst[1] - src[1]) * t,
        src[2] + (dst[2] - src[2]) * t,
      ];

      const prev = old[k++];
      lookup[c][r] = next.length;
      next.push({
        x: prev ? prev.x : hx,
        y: prev ? prev.y : hy,
        vx: prev ? prev.vx : 0,
        vy: prev ? prev.vy : 0,
        homeX: hx,
        homeY: hy,
        r: prev ? prev.r : baseR,
        baseR,
        base,
        col: prev ? prev.col : [base[0], base[1], base[2]],
        neighbors: [],
      });
    }
  }

  // Wire each dot to its 4 grid neighbors (skipped letter cells leave gaps)
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const idx = lookup[c][r];
      if (idx === undefined) continue;
      const nb = next[idx].neighbors;
      if (c > 0 && lookup[c - 1][r] !== undefined) nb.push(lookup[c - 1][r]);
      if (c < cols - 1 && lookup[c + 1][r] !== undefined) nb.push(lookup[c + 1][r]);
      if (r > 0 && lookup[c][r - 1] !== undefined) nb.push(lookup[c][r - 1]);
      if (r < rows - 1 && lookup[c][r + 1] !== undefined) nb.push(lookup[c][r + 1]);
    }
  }

  fieldParticles = next;
}

// ─── Offscreen Text Rendering ────────────────────────────────

function renderTextToBuffer() {
  if (pg) pg.remove();

  pg = createGraphics(width, height);
  pg.pixelDensity(1);
  pg.background(0);
  pg.fill(255);
  pg.noStroke();
  pg.textAlign(CENTER, CENTER);
  pg.textStyle(BOLD);
  pg.textFont('Arial Black');

  let fontSize = (width * 0.75) / max(currentText.length, 1) * 1.6;
  fontSize = min(fontSize, height * 0.55);
  pg.textSize(fontSize);

  pg.text(currentText, width / 2, height / 2);
  pg.loadPixels();
}

// ─── Text Input ──────────────────────────────────────────────

function onTextChange(e) {
  const newText = e.target.value.toUpperCase().trim();
  if (newText.length > 0 && newText !== currentText) {
    currentText = newText;
    needsRebuild = true;
  }
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
    const lines = Object.keys(P).map(k => `  ${k}: ${P[k]},`).join('\n');
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
