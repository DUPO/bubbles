// ─── Configuration ───────────────────────────────────────────
const COL_COUNT = 30;
const BRIGHTNESS_THRESHOLD = 30;
const SPRING_STRENGTH = 0.04;
const DAMPING = 0.85;
const COUPLING = 0.012;
const MOUSE_RADIUS = 150;
const MOUSE_ATTRACT_STRENGTH = 0.07;
const MOUSE_SCALE_MAX = 2.2;
const RADIUS_EASE_IN = 0.12;
const RADIUS_EASE_OUT = 0.06;
const BG_COLOR = '#f5f0e8';
const CMYK_OFFSET_DIST = 0.35;
const CMYK_DOT_SCALE = 0.75;
const CMYK_ALPHA = 180;

const CMYK_CHANNELS = [
  { color: [0, 255, 255],   angle: 15 * Math.PI / 180,  cos: 0, sin: 0 },  // Cyan
  { color: [255, 0, 255],   angle: 75 * Math.PI / 180,  cos: 0, sin: 0 },  // Magenta
  { color: [255, 255, 0],   angle: 0,                   cos: 0, sin: 0 },  // Yellow
  { color: [0, 0, 0],       angle: 45 * Math.PI / 180,  cos: 0, sin: 0 },  // Key (Black)
];
for (let i = 0; i < CMYK_CHANNELS.length; i++) {
  CMYK_CHANNELS[i].cos = Math.cos(CMYK_CHANNELS[i].angle);
  CMYK_CHANNELS[i].sin = Math.sin(CMYK_CHANNELS[i].angle);
}

// ─── State ───────────────────────────────────────────────────
let particles = [];
let gridLookup = [];
let pg;
let currentText = 'DUPO';
let needsRebuild = true;
let cols, rows, spacing;
let offsetX, offsetY;
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
    rebuildGrid();
    needsRebuild = false;
  }

  background(BG_COLOR);
  blendMode(MULTIPLY);

  const mx = mouseX;
  const my = mouseY;
  const mrSq = MOUSE_RADIUS * MOUSE_RADIUS;

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];

    // ── 1. Mouse attraction + radius scaling ──
    const dx = mx - p.x;
    const dy = my - p.y;
    const distSq = dx * dx + dy * dy;

    if (distSq < mrSq && distSq > 0.01) {
      const dist = Math.sqrt(distSq);
      const force = map(dist, 0, MOUSE_RADIUS, MOUSE_ATTRACT_STRENGTH, 0);

      p.vx += dx * force * 0.3;
      p.vy += dy * force * 0.3;

      const scaleFactor = map(dist, 0, MOUSE_RADIUS, MOUSE_SCALE_MAX, 1.0);
      p.r = lerp(p.r, p.targetR * scaleFactor, RADIUS_EASE_IN);
    } else {
      p.r = lerp(p.r, p.targetR, RADIUS_EASE_OUT);
    }

    // ── 2. Neighbor coupling ──
    const neighbors = p.neighbors;
    for (let j = 0; j < neighbors.length; j++) {
      const n = particles[neighbors[j]];
      p.vx += (n.x - n.targetX) * COUPLING;
      p.vy += (n.y - n.targetY) * COUPLING;
    }

    // ── 3. Spring back to rest position ──
    p.vx += (p.targetX - p.x) * SPRING_STRENGTH;
    p.vy += (p.targetY - p.y) * SPRING_STRENGTH;

    // ── 4. Damping + integrate ──
    p.vx *= DAMPING;
    p.vy *= DAMPING;
    p.x += p.vx;
    p.y += p.vy;

    // ── 5. Animate radius toward base ──
    p.targetR = lerp(p.targetR, p.baseR, 0.08);

    // ── 6. Draw CMYK cluster ──
    if (p.r > 0.3) {
      const offsetR = p.r * CMYK_OFFSET_DIST;
      for (let ch = 0; ch < CMYK_CHANNELS.length; ch++) {
        const chan = CMYK_CHANNELS[ch];
        const dotR = p.r * CMYK_DOT_SCALE * p.cmyk[ch];
        if (dotR > 0.2) {
          fill(chan.color[0], chan.color[1], chan.color[2], CMYK_ALPHA);
          circle(p.x + chan.cos * offsetR, p.y + chan.sin * offsetR, dotR * 2);
        }
      }
    }
  }

  blendMode(BLEND);

  if (particles.some(p => p.baseR === 0 && p.r < 0.3)) {
    particles = particles.filter(p => !(p.baseR === 0 && p.r < 0.3));
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  needsRebuild = true;
}

// ─── Text Input ──────────────────────────────────────────────

function onTextChange(e) {
  const newText = e.target.value.toUpperCase().trim();
  if (newText.length > 0 && newText !== currentText) {
    currentText = newText;
    needsRebuild = true;
  }
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

// ─── Grid Building ───────────────────────────────────────────

function rebuildGrid() {
  const oldParticles = particles;
  const oldLookup = gridLookup;

  spacing = floor(width / COL_COUNT);
  if (spacing < 4) spacing = 4;
  cols = floor(width / spacing);
  rows = floor(height / spacing);
  offsetX = (width - cols * spacing) / 2 + spacing / 2;
  offsetY = (height - rows * spacing) / 2 + spacing / 2;

  const newParticles = [];
  const newLookup = [];

  for (let c = 0; c < cols; c++) {
    newLookup[c] = [];
    for (let r = 0; r < rows; r++) {
      const px = floor(map(c, 0, cols - 1, 0, pg.width - 1));
      const py = floor(map(r, 0, rows - 1, 0, pg.height - 1));
      const idx = (py * pg.width + px) * 4;
      const brightness = pg.pixels[idx];

      if (brightness > BRIGHTNESS_THRESHOLD) {
        const tx = offsetX + c * spacing;
        const ty = offsetY + r * spacing;
        const baseR = map(brightness, BRIGHTNESS_THRESHOLD, 255, 0.5, spacing * 0.42);

        let existingP = null;
        if (oldLookup[c] !== undefined && oldLookup[c][r] !== undefined) {
          existingP = oldParticles[oldLookup[c][r]];
        }

        const p = {
          x: existingP ? existingP.x : tx,
          y: existingP ? existingP.y : ty,
          vx: existingP ? existingP.vx : 0,
          vy: existingP ? existingP.vy : 0,
          targetX: tx,
          targetY: ty,
          r: existingP ? existingP.r : 0,
          targetR: existingP ? existingP.targetR : 0,
          baseR: baseR,
          cmyk: [1.0, 1.0, 1.0, 1.0],
          neighbors: [],
          col: c,
          row: r
        };

        newLookup[c][r] = newParticles.length;
        newParticles.push(p);
      }
    }
  }

  for (let i = 0; i < newParticles.length; i++) {
    const p = newParticles[i];
    const c = p.col;
    const r = p.row;

    if (c > 0 && newLookup[c - 1] && newLookup[c - 1][r] !== undefined) {
      p.neighbors.push(newLookup[c - 1][r]);
    }
    if (c < cols - 1 && newLookup[c + 1] && newLookup[c + 1][r] !== undefined) {
      p.neighbors.push(newLookup[c + 1][r]);
    }
    if (r > 0 && newLookup[c][r - 1] !== undefined) {
      p.neighbors.push(newLookup[c][r - 1]);
    }
    if (r < rows - 1 && newLookup[c][r + 1] !== undefined) {
      p.neighbors.push(newLookup[c][r + 1]);
    }
  }

  for (let i = 0; i < oldParticles.length; i++) {
    const op = oldParticles[i];
    const c = op.col;
    const r = op.row;

    if (newLookup[c] === undefined || newLookup[c][r] === undefined) {
      op.baseR = 0;
      op.neighbors = [];
      if (!op.cmyk) op.cmyk = [1.0, 1.0, 1.0, 1.0];
      newParticles.push(op);
    }
  }

  particles = newParticles;
  gridLookup = newLookup;
}
