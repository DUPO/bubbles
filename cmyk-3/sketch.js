// ─── Configuration ───────────────────────────────────────────
const BG_COLOR = '#000000';

// Field (background) dots — small, single-channel, jittery
const FIELD_COL_COUNT = 84;       // density of the small-dot grid
const FIELD_DOT_MIN = 1.2;        // px radius at grid rest
const FIELD_DOT_MAX = 2.8;        // px radius variation
const FIELD_JITTER = 1.3;         // constant micro-vibrato (px)
const FIELD_SPRING = 0.05;        // pull back to home cell
const FIELD_DAMPING = 0.85;
const FIELD_ALPHA = 165;          // moderate so overlaps build new hues
const FIELD_SCALE_MAX = 2.6;      // radius growth under cursor

// Mouse converge
const MOUSE_RADIUS = 175;
const MOUSE_PULL = 0.14;          // how hard field dots rush to cursor

// Text (foreground) dots — multi-channel CMYK halftone clusters
const TEXT_COL_COUNT = 45;
const TEXT_BRIGHTNESS_THRESHOLD = 30;
const TEXT_SPRING = 0.03;
const TEXT_DAMPING = 0.88;
const TEXT_COUPLING = 0.018;
const TEXT_MOUSE_ATTRACT = 0.05;
const TEXT_SCALE_MAX = 1.8;
const CMYK_OFFSET_DIST = 0.45;    // channel separation within a cluster
const CMYK_DOT_SCALE = 0.62;
const CMYK_ALPHA = 200;
const TEXT_JITTER = 1.8;          // cluster vibrato
const TEXT_JITTER_CHANNEL = 0.6;  // per-channel vibrato
const RADIUS_EASE_IN = 0.12;
const RADIUS_EASE_OUT = 0.06;

// Channels: Cyan, Magenta, Yellow, White (K → white on black, additive)
const CHANNELS = [
  { color: [0, 255, 255], cos: 0, sin: 0 },   // Cyan
  { color: [255, 0, 255], cos: 0, sin: 0 },   // Magenta
  { color: [255, 255, 0], cos: 0, sin: 0 },   // Yellow
  { color: [255, 255, 255], cos: 0, sin: 0 }, // White (key)
];
const CHANNEL_ANGLES = [15, 75, 0, 45].map(d => d * Math.PI / 180);
for (let i = 0; i < CHANNELS.length; i++) {
  CHANNELS[i].cos = Math.cos(CHANNEL_ANGLES[i]);
  CHANNELS[i].sin = Math.sin(CHANNEL_ANGLES[i]);
}

// ─── State ───────────────────────────────────────────────────
let pg;                    // offscreen text buffer (shared by both layers)
let textParticles = [];    // CMYK clusters forming the letters
let textLookup = [];
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
}

function draw() {
  if (needsRebuild) {
    renderTextToBuffer();
    rebuildTextClusters();
    rebuildField();
    needsRebuild = false;
  }

  background(BG_COLOR);
  blendMode(SCREEN);          // additive: overlaps brighten and mix

  const mx = mouseX;
  const my = mouseY;
  const mrSq = MOUSE_RADIUS * MOUSE_RADIUS;

  drawField(mx, my, mrSq);
  drawTextClusters(mx, my, mrSq);

  blendMode(BLEND);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  needsRebuild = true;
}

// ─── Field Layer ─────────────────────────────────────────────

function drawField(mx, my, mrSq) {
  for (let i = 0; i < fieldParticles.length; i++) {
    const p = fieldParticles[i];

    const dx = mx - p.x;
    const dy = my - p.y;
    const distSq = dx * dx + dy * dy;

    if (distSq < mrSq && distSq > 0.01) {
      // Converge: rush toward the cursor and swell so dots overlap & blend
      const dist = Math.sqrt(distSq);
      const pull = map(dist, 0, MOUSE_RADIUS, MOUSE_PULL, 0);
      p.vx += dx * pull;
      p.vy += dy * pull;
      const scale = map(dist, 0, MOUSE_RADIUS, FIELD_SCALE_MAX, 1.0);
      p.r = lerp(p.r, p.baseR * scale, RADIUS_EASE_IN);
    } else {
      p.r = lerp(p.r, p.baseR, RADIUS_EASE_OUT);
    }

    // Spring home + damping
    p.vx += (p.homeX - p.x) * FIELD_SPRING;
    p.vy += (p.homeY - p.y) * FIELD_SPRING;
    p.vx *= FIELD_DAMPING;
    p.vy *= FIELD_DAMPING;
    p.x += p.vx;
    p.y += p.vy;

    // Vibrato + draw
    const jx = p.x + (Math.random() - 0.5) * FIELD_JITTER;
    const jy = p.y + (Math.random() - 0.5) * FIELD_JITTER;
    const c = p.channel.color;
    fill(c[0], c[1], c[2], FIELD_ALPHA);
    circle(jx, jy, p.r * 2);
  }
}

function rebuildField() {
  const old = fieldParticles;
  const spacing = max(4, floor(width / FIELD_COL_COUNT));
  const cols = floor(width / spacing);
  const rows = floor(height / spacing);
  const ox = (width - cols * spacing) / 2 + spacing / 2;
  const oy = (height - rows * spacing) / 2 + spacing / 2;

  const next = [];
  let k = 0;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const hx = ox + c * spacing;
      const hy = oy + r * spacing;

      // Skip cells that fall on the letterforms — field is the surround
      const px = constrain(floor(hx / width * (pg.width - 1)), 0, pg.width - 1);
      const py = constrain(floor(hy / height * (pg.height - 1)), 0, pg.height - 1);
      if (pg.pixels[(py * pg.width + px) * 4] > TEXT_BRIGHTNESS_THRESHOLD) continue;

      // Deterministic per-cell channel + size so it's stable across rebuilds
      const seed = (c * 73856093) ^ (r * 19349663);
      const channelIdx = ((seed >>> 4) & 3);
      const sizeNoise = ((seed >>> 8) & 255) / 255;
      const baseR = FIELD_DOT_MIN + sizeNoise * (FIELD_DOT_MAX - FIELD_DOT_MIN);

      const prev = old[k++];
      next.push({
        x: prev ? prev.x : hx,
        y: prev ? prev.y : hy,
        vx: prev ? prev.vx : 0,
        vy: prev ? prev.vy : 0,
        homeX: hx,
        homeY: hy,
        r: prev ? prev.r : baseR,
        baseR,
        channel: CHANNELS[channelIdx],
      });
    }
  }
  fieldParticles = next;
}

// ─── Text Layer (CMYK clusters) ──────────────────────────────

function drawTextClusters(mx, my, mrSq) {
  for (let i = 0; i < textParticles.length; i++) {
    const p = textParticles[i];

    const dx = mx - p.x;
    const dy = my - p.y;
    const distSq = dx * dx + dy * dy;

    if (distSq < mrSq && distSq > 0.01) {
      const dist = Math.sqrt(distSq);
      const force = map(dist, 0, MOUSE_RADIUS, TEXT_MOUSE_ATTRACT, 0);
      p.vx += dx * force * 0.3;
      p.vy += dy * force * 0.3;
      const scale = map(dist, 0, MOUSE_RADIUS, TEXT_SCALE_MAX, 1.0);
      p.r = lerp(p.r, p.targetR * scale, RADIUS_EASE_IN);
    } else {
      p.r = lerp(p.r, p.targetR, RADIUS_EASE_OUT);
    }

    const neighbors = p.neighbors;
    for (let j = 0; j < neighbors.length; j++) {
      const n = textParticles[neighbors[j]];
      p.vx += (n.x - n.targetX) * TEXT_COUPLING;
      p.vy += (n.y - n.targetY) * TEXT_COUPLING;
    }

    p.vx += (p.targetX - p.x) * TEXT_SPRING;
    p.vy += (p.targetY - p.y) * TEXT_SPRING;
    p.vx *= TEXT_DAMPING;
    p.vy *= TEXT_DAMPING;
    p.x += p.vx;
    p.y += p.vy;

    p.targetR = lerp(p.targetR, p.baseR, 0.08);

    if (p.r > 0.3) {
      const jx = p.x + (Math.random() - 0.5) * TEXT_JITTER;
      const jy = p.y + (Math.random() - 0.5) * TEXT_JITTER;
      const offsetR = p.r * CMYK_OFFSET_DIST;
      for (let ch = 0; ch < CHANNELS.length; ch++) {
        const chan = CHANNELS[ch];
        const dotR = p.r * CMYK_DOT_SCALE;
        if (dotR > 0.2) {
          fill(chan.color[0], chan.color[1], chan.color[2], CMYK_ALPHA);
          circle(
            jx + chan.cos * offsetR + (Math.random() - 0.5) * TEXT_JITTER_CHANNEL,
            jy + chan.sin * offsetR + (Math.random() - 0.5) * TEXT_JITTER_CHANNEL,
            dotR * 2
          );
        }
      }
    }
  }
}

function rebuildTextClusters() {
  const oldParticles = textParticles;
  const oldLookup = textLookup;

  const spacing = max(4, floor(width / TEXT_COL_COUNT));
  const cols = floor(width / spacing);
  const rows = floor(height / spacing);
  const offsetX = (width - cols * spacing) / 2 + spacing / 2;
  const offsetY = (height - rows * spacing) / 2 + spacing / 2;

  const newParticles = [];
  const newLookup = [];

  for (let c = 0; c < cols; c++) {
    newLookup[c] = [];
    for (let r = 0; r < rows; r++) {
      const px = floor(map(c, 0, cols - 1, 0, pg.width - 1));
      const py = floor(map(r, 0, rows - 1, 0, pg.height - 1));
      const brightness = pg.pixels[(py * pg.width + px) * 4];

      if (brightness > TEXT_BRIGHTNESS_THRESHOLD) {
        const tx = offsetX + c * spacing;
        const ty = offsetY + r * spacing;
        const baseR = map(brightness, TEXT_BRIGHTNESS_THRESHOLD, 255, 0.5, spacing * 0.42);

        let existing = null;
        if (oldLookup[c] !== undefined && oldLookup[c][r] !== undefined) {
          existing = oldParticles[oldLookup[c][r]];
        }

        newLookup[c][r] = newParticles.length;
        newParticles.push({
          x: existing ? existing.x : tx,
          y: existing ? existing.y : ty,
          vx: existing ? existing.vx : 0,
          vy: existing ? existing.vy : 0,
          targetX: tx,
          targetY: ty,
          r: existing ? existing.r : 0,
          targetR: existing ? existing.targetR : 0,
          baseR,
          neighbors: [],
          col: c,
          row: r,
        });
      }
    }
  }

  for (let i = 0; i < newParticles.length; i++) {
    const p = newParticles[i];
    const c = p.col;
    const r = p.row;
    if (c > 0 && newLookup[c - 1] && newLookup[c - 1][r] !== undefined) p.neighbors.push(newLookup[c - 1][r]);
    if (c < cols - 1 && newLookup[c + 1] && newLookup[c + 1][r] !== undefined) p.neighbors.push(newLookup[c + 1][r]);
    if (r > 0 && newLookup[c][r - 1] !== undefined) p.neighbors.push(newLookup[c][r - 1]);
    if (r < rows - 1 && newLookup[c][r + 1] !== undefined) p.neighbors.push(newLookup[c][r + 1]);
  }

  textParticles = newParticles;
  textLookup = newLookup;
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
