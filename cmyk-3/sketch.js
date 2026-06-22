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

// Mouse vortex — dots orbit the cursor on a tangential force
const MOUSE_RADIUS = 190;
const VORTEX_STRENGTH = 1.5;      // tangential push near the cursor (px/frame^2)
const VORTEX_INWARD = 0.06;       // slight inward draw so dots gather into the swirl

// Text mask — the letterforms cut a negative-space hole in the field
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
  const mrSq = MOUSE_RADIUS * MOUSE_RADIUS;

  drawField(mx, my, mrSq);

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
      // Vortex: spin around the cursor (tangential) + a touch inward, so
      // dots orbit and cross each other, blending C/M/Y/white as they pass.
      const dist = Math.sqrt(distSq);
      const inv = 1 / dist;
      const tx = -dy * inv;   // unit tangent (rotate cursor→dot vector 90° CCW)
      const ty = dx * inv;
      const spin = map(dist, 0, MOUSE_RADIUS, VORTEX_STRENGTH, 0);
      p.vx += tx * spin + dx * VORTEX_INWARD;
      p.vy += ty * spin + dy * VORTEX_INWARD;
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
