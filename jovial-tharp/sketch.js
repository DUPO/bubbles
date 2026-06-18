// ─── Configuration ───────────────────────────────────────────
const COL_COUNT = 55;
const SPRING_STRENGTH = 0.035;     // firm enough to overshoot, not so stiff it snaps
const DAMPING = 0.96;              // very low friction — rings for 3-4 bounces
const COUPLING = 0.025;            // strong neighbor coupling = visible wave propagation
const MOUSE_RADIUS = 200;
const MOUSE_ATTRACT_STRENGTH = 0.06;  // gentler push — wave comes from the release, not the shove
const MAX_DISPLACEMENT = 1.2;
const MOUSE_SCALE_MAX = 3.5;
const RADIUS_EASE_IN = 0.2;
const RADIUS_EASE_OUT = 0.04;
const BG_COLOR = '#0a0a0a';
const DOT_COLOR = [250, 250, 250];

// Size mapping — wide range for legibility
const MAX_RADIUS_FACTOR = 0.52;    // text circles nearly touch — bold, readable
const MIN_RADIUS_FACTOR = 0.03;    // far dots are tiny specks — ~17:1 ratio
const FALLOFF_CURVE = 1.5;         // steeper near text so letters clearly pop
const SIZE_NOISE = 0.25;

// ─── State ───────────────────────────────────────────────────
let particles = [];
let gridLookup = [];
let pgSharp;           // full-res: crisp text
let blurField;         // low-res array: distance falloff values
let currentText = 'DUPO';
let needsRebuild = true;
let cols, rows, spacing;
let offsetX, offsetY;
let inputEl;
let mouseActive = false;  // ignore mouse until it actually moves

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
    buildBlurField();
    rebuildGrid();
    needsRebuild = false;
  }

  background(BG_COLOR);
  fill(DOT_COLOR[0], DOT_COLOR[1], DOT_COLOR[2]);

  const mx = mouseActive ? mouseX : -9999;
  const my = mouseActive ? mouseY : -9999;
  const mrSq = MOUSE_RADIUS * MOUSE_RADIUS;

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];

    // ── 1. Mouse attraction + radius scaling ──
    const dx = mx - p.x;
    const dy = my - p.y;
    const distSq = dx * dx + dy * dy;

    let rGoal = p.targetR; // default radius goal

    if (distSq < mrSq && distSq > 0.01) {
      const dist = Math.sqrt(distSq);
      const t = 1 - dist / MOUSE_RADIUS;
      const easedT = t * t;
      const force = MOUSE_ATTRACT_STRENGTH * easedT;

      // Attract toward cursor
      p.vx += dx * force * 0.3;
      p.vy += dy * force * 0.3;

      // Radius goal when hovered
      const scaleFactor = 1 + (MOUSE_SCALE_MAX - 1) * easedT;
      rGoal = p.targetR * scaleFactor;
    }

    // ── 2. Radius spring (bouncy!) ──
    // Low spring + high damping retention = multiple visible oscillations
    const rSpring = 0.045;
    const rDamp = 0.88;
    p.rv += (rGoal - p.r) * rSpring;
    p.rv *= rDamp;
    p.r += p.rv;
    // Clamp to prevent negative radius
    if (p.r < 0) { p.r = 0; p.rv = 0; }

    // ── 3. Neighbor coupling (wave propagation) ──
    const neighbors = p.neighbors;
    for (let j = 0; j < neighbors.length; j++) {
      const n = particles[neighbors[j]];

      // Position coupling — pulled toward neighbor's displacement
      p.vx += (n.x - n.targetX) * COUPLING * 0.5;
      p.vy += (n.y - n.targetY) * COUPLING * 0.5;

      // Velocity coupling — THIS is what makes waves travel
      // Neighbor's momentum transfers to this particle
      p.vx += n.vx * COUPLING * 0.4;
      p.vy += n.vy * COUPLING * 0.4;

      // Radius wave — size oscillation ripples outward
      p.rv += (n.r - n.baseR) * 0.005;
      p.rv += n.rv * 0.008;
    }

    // ── 4. Spring back to rest ──
    p.vx += (p.targetX - p.x) * SPRING_STRENGTH;
    p.vy += (p.targetY - p.y) * SPRING_STRENGTH;

    // ── 5. Damping + integrate ──
    p.vx *= DAMPING;
    p.vy *= DAMPING;
    p.x += p.vx;
    p.y += p.vy;

    // ── 5b. Soft clamp — bounces off limit instead of hard stop ──
    const maxD = spacing * MAX_DISPLACEMENT;
    const dispX = p.x - p.targetX;
    const dispY = p.y - p.targetY;
    if (dispX > maxD) { p.x = p.targetX + maxD; p.vx *= -0.5; }
    if (dispX < -maxD) { p.x = p.targetX - maxD; p.vx *= -0.5; }
    if (dispY > maxD) { p.y = p.targetY + maxD; p.vy *= -0.5; }
    if (dispY < -maxD) { p.y = p.targetY - maxD; p.vy *= -0.5; }

    // ── 6. Animate targetR toward base ──
    p.targetR = lerp(p.targetR, p.baseR, 0.08);

    // ── 7. Draw ──
    if (p.r > 0.2) {
      circle(p.x, p.y, p.r * 2);
    }
  }
}

function mouseMoved() {
  mouseActive = true;
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
  if (pgSharp) pgSharp.remove();

  pgSharp = createGraphics(width, height);
  pgSharp.pixelDensity(1);
  pgSharp.background(0);
  pgSharp.fill(255);
  pgSharp.noStroke();
  pgSharp.textAlign(CENTER, CENTER);
  pgSharp.textStyle(BOLD);
  pgSharp.textFont('Arial Black');

  let fontSize = (width * 0.75) / max(currentText.length, 1) * 1.6;
  fontSize = min(fontSize, height * 0.55);
  pgSharp.textSize(fontSize);
  pgSharp.text(currentText, width / 2, height / 2);
  pgSharp.loadPixels();
}

// ─── Distance Falloff Field ──────────────────────────────────
// Instead of blurring a full canvas (slow), we build a low-res
// distance field by flood-filling from text pixels on the grid.

function buildBlurField() {
  // Build distance field at 4x grid resolution for accurate letter shapes,
  // then downsample to grid resolution
  const sp = max(floor(width / COL_COUNT), 4);
  const gc = floor(width / sp);
  const gr = floor(height / sp);

  // High-res sampling (4x grid) to capture letter details
  const SCALE = 4;
  const hc = gc * SCALE;
  const hr = gr * SCALE;

  // Sample text pixels at high resolution
  const hDist = new Float32Array(hc * hr);
  for (let i = 0; i < hc; i++) {
    for (let j = 0; j < hr; j++) {
      const px = floor(map(i, 0, hc - 1, 0, pgSharp.width - 1));
      const py = floor(map(j, 0, hr - 1, 0, pgSharp.height - 1));
      const idx = (py * pgSharp.width + px) * 4;
      hDist[j * hc + i] = pgSharp.pixels[idx] > 30 ? 0 : 99999;
    }
  }

  // Chamfer distance transform at high resolution
  // Forward pass
  for (let i = 0; i < hc; i++) {
    for (let j = 0; j < hr; j++) {
      const k = j * hc + i;
      if (i > 0) hDist[k] = min(hDist[k], hDist[k - 1] + 1);
      if (j > 0) hDist[k] = min(hDist[k], hDist[(j - 1) * hc + i] + 1);
      if (i > 0 && j > 0) hDist[k] = min(hDist[k], hDist[(j - 1) * hc + i - 1] + 1.4);
      if (i < hc - 1 && j > 0) hDist[k] = min(hDist[k], hDist[(j - 1) * hc + i + 1] + 1.4);
    }
  }
  // Backward pass
  for (let i = hc - 1; i >= 0; i--) {
    for (let j = hr - 1; j >= 0; j--) {
      const k = j * hc + i;
      if (i < hc - 1) hDist[k] = min(hDist[k], hDist[k + 1] + 1);
      if (j < hr - 1) hDist[k] = min(hDist[k], hDist[(j + 1) * hc + i] + 1);
      if (i < hc - 1 && j < hr - 1) hDist[k] = min(hDist[k], hDist[(j + 1) * hc + i + 1] + 1.4);
      if (i > 0 && j < hr - 1) hDist[k] = min(hDist[k], hDist[(j + 1) * hc + i - 1] + 1.4);
    }
  }

  // Downsample to grid resolution — take the value at the center of each grid cell
  const c = gc;
  const r = gr;
  const isText = [];
  const dist = [];
  for (let i = 0; i < c; i++) {
    isText[i] = [];
    dist[i] = [];
    for (let j = 0; j < r; j++) {
      const hi = i * SCALE + floor(SCALE / 2);
      const hj = j * SCALE + floor(SCALE / 2);
      const hk = hj * hc + hi;
      dist[i][j] = hDist[hk];
      isText[i][j] = dist[i][j] === 0;
    }
  }

  // Find max distance for normalization
  let maxDist = 0;
  for (let i = 0; i < c; i++) {
    for (let j = 0; j < r; j++) {
      if (dist[i][j] < 99999) maxDist = max(maxDist, dist[i][j]);
    }
  }

  // Store normalized field (0 = on text, 1 = farthest away)
  blurField = { dist, isText, maxDist, cols: c, rows: r };
}

// ─── Grid Building ───────────────────────────────────────────

function rebuildGrid() {
  const oldParticles = particles;
  const oldLookup = gridLookup;

  spacing = max(floor(width / COL_COUNT), 4);
  cols = floor(width / spacing);
  rows = floor(height / spacing);
  offsetX = (width - cols * spacing) / 2 + spacing / 2;
  offsetY = (height - rows * spacing) / 2 + spacing / 2;

  const maxR = spacing * MAX_RADIUS_FACTOR;
  const minR = spacing * MIN_RADIUS_FACTOR;
  const md = max(blurField.maxDist, 1);

  const newParticles = [];
  const newLookup = [];

  for (let c = 0; c < cols; c++) {
    newLookup[c] = [];
    for (let r = 0; r < rows; r++) {
      const d = blurField.dist[c] ? (blurField.dist[c][r] !== undefined ? blurField.dist[c][r] : md) : md;
      const onText = blurField.isText[c] && blurField.isText[c][r];

      // Continuous size curve from distance field
      const normDist = min(d / md, 1);
      const sizeFactor = Math.pow(1 - normDist, FALLOFF_CURVE);

      // Perlin noise breaks up the concentric ring pattern
      // Sampling at grid scale so adjacent dots vary naturally
      const n = noise(c * 0.15, r * 0.15);
      const noiseOffset = 1 + (n - 0.5) * SIZE_NOISE; // 0.85 – 1.15 range

      let baseR = (minR + (maxR - minR) * sizeFactor) * noiseOffset;
      baseR = max(baseR, minR);

      const tx = offsetX + c * spacing;
      const ty = offsetY + r * spacing;

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
        rv: existingP ? existingP.rv : 0,
        targetR: existingP ? existingP.targetR : 0,
        baseR: baseR,
        neighbors: [],
        col: c,
        row: r
      };

      newLookup[c][r] = newParticles.length;
      newParticles.push(p);
    }
  }

  // Build neighbor references
  for (let i = 0; i < newParticles.length; i++) {
    const p = newParticles[i];
    const c = p.col;
    const r = p.row;
    if (c > 0) p.neighbors.push(newLookup[c - 1][r]);
    if (c < cols - 1) p.neighbors.push(newLookup[c + 1][r]);
    if (r > 0) p.neighbors.push(newLookup[c][r - 1]);
    if (r < rows - 1) p.neighbors.push(newLookup[c][r + 1]);
  }

  particles = newParticles;
  gridLookup = newLookup;
}
