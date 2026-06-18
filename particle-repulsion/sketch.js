// ─── Configuration ───────────────────────────────────────────
const COL_COUNT = 55;
const SPRING_STRENGTH = 0.035;
const DAMPING = 0.96;
const COUPLING = 0.025;
const MOUSE_RADIUS = 200;
const MOUSE_ATTRACT_STRENGTH = 0.06;
const MAX_DISPLACEMENT = 1.2;
const MOUSE_SCALE_MAX = 2.6;        // 25% less than 3.5
const BG_COLOR = '#0a0a0a';
const DOT_COLOR = [250, 250, 250];

// Size mapping — exactly 13 distinct circle sizes
const SIZE_STEPS = 13;
const MAX_RADIUS_FACTOR = 0.46;    // stays within grid cell — no overlap at rest
const MIN_RADIUS_FACTOR = 0.008;
const FALLOFF_CURVE = 1.0;
const SIZE_NOISE = 0.4;            // noise pushes dots between adjacent steps

// Sparse trails — longer reach, gentler thinning
const TRAIL_RADIUS = 0.85;          // dots extend to 85% of max distance — more tiny specks
const TRAIL_DENSITY_CURVE = 1.1;    // very gentle dropoff — lots of small dots survive far out

// ─── State ───────────────────────────────────────────────────
let particles = [];
let gridLookup = [];
let pgSharp;
let blurField;
let currentText = 'DUPO';
let needsRebuild = true;
let cols, rows, spacing;
let offsetX, offsetY;
let inputEl;
let mouseActive = false;
let customFont;

// ─── p5.js Lifecycle ─────────────────────────────────────────

function preload() {
  customFont = loadFont('fonts/GT-Haptik-Bold.ttf');
}

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

  const mx = mouseActive ? mouseX : -9999;
  const my = mouseActive ? mouseY : -9999;
  const mrSq = MOUSE_RADIUS * MOUSE_RADIUS;

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];

    // ── 1. Mouse attraction + radius scaling ──
    const dx = mx - p.x;
    const dy = my - p.y;
    const distSq = dx * dx + dy * dy;

    let rGoal = p.targetR;

    if (distSq < mrSq && distSq > 0.01) {
      const dist = Math.sqrt(distSq);
      const t = 1 - dist / MOUSE_RADIUS;
      const easedT = t * t;

      // Only scale radius — no position movement toward cursor
      // This prevents clustering/overlap entirely
      const scaleFactor = 1 + (MOUSE_SCALE_MAX - 1) * easedT;
      rGoal = p.targetR * scaleFactor;
    }

    // ── 2. Radius spring ──
    const rSpring = 0.045;
    const rDamp = 0.88;
    p.rv += (rGoal - p.r) * rSpring;
    p.rv *= rDamp;
    p.r += p.rv;
    if (p.r < 0) { p.r = 0; p.rv = 0; }

    // ── 3. Neighbor radius coupling (wave propagation) ──
    const neighbors = p.neighbors;
    for (let j = 0; j < neighbors.length; j++) {
      const n = particles[neighbors[j]];
      // Radius wave — size oscillation ripples through neighbors
      p.rv += (n.r - n.baseR) * 0.006;
      p.rv += n.rv * 0.01;
    }

    // ── 4. Gentle position drift (small, cosmetic — not attraction) ──
    p.vx += (p.targetX - p.x) * SPRING_STRENGTH;
    p.vy += (p.targetY - p.y) * SPRING_STRENGTH;
    p.vx *= DAMPING;
    p.vy *= DAMPING;
    p.x += p.vx;
    p.y += p.vy;

    // ── 5. Keep near grid position ──
    const maxD = spacing * 0.3;
    const dispX = p.x - p.targetX;
    const dispY = p.y - p.targetY;
    if (dispX > maxD) { p.x = p.targetX + maxD; p.vx *= -0.5; }
    if (dispX < -maxD) { p.x = p.targetX - maxD; p.vx *= -0.5; }
    if (dispY > maxD) { p.y = p.targetY + maxD; p.vy *= -0.5; }
    if (dispY < -maxD) { p.y = p.targetY - maxD; p.vy *= -0.5; }

    // ── 6. Animate targetR toward base ──
    p.targetR = lerp(p.targetR, p.baseR, 0.08);

    // ── 7. Draw with size-based opacity ──
    if (p.r > 0.2) {
      // Map radius to opacity: largest circles → full opaque, tiny specks → faint
      const maxR = spacing * MAX_RADIUS_FACTOR;
      const opacityT = constrain(p.r / maxR, 0, 1);
      const alpha = 40 + 215 * opacityT; // range: 40 (tiny) → 255 (large)
      fill(DOT_COLOR[0], DOT_COLOR[1], DOT_COLOR[2], alpha);
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
  pgSharp.textFont(customFont);

  let fontSize = (width * 0.75) / max(currentText.length, 1) * 1.6;
  fontSize = min(fontSize, height * 0.55);
  pgSharp.textSize(fontSize);

  // Render each character with extra spacing for legibility
  const charSpacing = fontSize * 0.08;
  let totalWidth = 0;
  for (let i = 0; i < currentText.length; i++) {
    totalWidth += pgSharp.textWidth(currentText[i]);
    if (i < currentText.length - 1) totalWidth += charSpacing;
  }
  let xPos = (width - totalWidth) / 2;
  for (let i = 0; i < currentText.length; i++) {
    const charW = pgSharp.textWidth(currentText[i]);
    pgSharp.text(currentText[i], xPos + charW / 2, height / 2);
    xPos += charW + charSpacing;
  }

  pgSharp.loadPixels();
}

// ─── Distance Falloff Field ──────────────────────────────────

function buildBlurField() {
  const sp = max(floor(width / COL_COUNT), 4);
  const gc = floor(width / sp);
  const gr = floor(height / sp);

  const SCALE = 4;
  const hc = gc * SCALE;
  const hr = gr * SCALE;

  const hDist = new Float32Array(hc * hr);
  for (let i = 0; i < hc; i++) {
    for (let j = 0; j < hr; j++) {
      const px = floor(map(i, 0, hc - 1, 0, pgSharp.width - 1));
      const py = floor(map(j, 0, hr - 1, 0, pgSharp.height - 1));
      const idx = (py * pgSharp.width + px) * 4;
      hDist[j * hc + i] = pgSharp.pixels[idx] > 30 ? 0 : 99999;
    }
  }

  // Chamfer distance transform
  for (let i = 0; i < hc; i++) {
    for (let j = 0; j < hr; j++) {
      const k = j * hc + i;
      if (i > 0) hDist[k] = min(hDist[k], hDist[k - 1] + 1);
      if (j > 0) hDist[k] = min(hDist[k], hDist[(j - 1) * hc + i] + 1);
      if (i > 0 && j > 0) hDist[k] = min(hDist[k], hDist[(j - 1) * hc + i - 1] + 1.4);
      if (i < hc - 1 && j > 0) hDist[k] = min(hDist[k], hDist[(j - 1) * hc + i + 1] + 1.4);
    }
  }
  for (let i = hc - 1; i >= 0; i--) {
    for (let j = hr - 1; j >= 0; j--) {
      const k = j * hc + i;
      if (i < hc - 1) hDist[k] = min(hDist[k], hDist[k + 1] + 1);
      if (j < hr - 1) hDist[k] = min(hDist[k], hDist[(j + 1) * hc + i] + 1);
      if (i < hc - 1 && j < hr - 1) hDist[k] = min(hDist[k], hDist[(j + 1) * hc + i + 1] + 1.4);
      if (i > 0 && j < hr - 1) hDist[k] = min(hDist[k], hDist[(j + 1) * hc + i - 1] + 1.4);
    }
  }

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

  let maxDist = 0;
  for (let i = 0; i < c; i++) {
    for (let j = 0; j < r; j++) {
      if (dist[i][j] < 99999) maxDist = max(maxDist, dist[i][j]);
    }
  }

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
  const trailCutoff = md * TRAIL_RADIUS; // max distance for any dot

  const newParticles = [];
  const newLookup = [];

  for (let c = 0; c < cols; c++) {
    newLookup[c] = [];
    for (let r = 0; r < rows; r++) {
      const d = blurField.dist[c] ? (blurField.dist[c][r] !== undefined ? blurField.dist[c][r] : md) : md;

      // Skip cells beyond trail radius — this creates the black space
      if (d > trailCutoff) continue;

      // How far through the trail zone (0 = on text, 1 = at cutoff edge)
      const trailT = d / trailCutoff;

      // Probability of placing a dot decreases with distance
      // On text (trailT=0): always place. At edge: rarely place.
      const placeProbability = Math.pow(1 - trailT, TRAIL_DENSITY_CURVE);

      // Use deterministic noise so the pattern is stable across frames
      const noiseVal = noise(c * 0.3, r * 0.3);
      if (noiseVal > placeProbability && d > 0) continue; // always place on-text dots

      let baseR;

      {
        const sizeFactor = Math.pow(1 - trailT, FALLOFF_CURVE);
        const nLow = noise(c * 0.1, r * 0.1);
        const nHigh = noise(c * 0.5 + 100, r * 0.5 + 100);
        const nVHigh = noise(c * 1.2 + 200, r * 1.2 + 200);

        let noiseShift;
        if (d === 0) {
          // ON TEXT: strong noise across top 9 steps (4–12)
          // Three noise layers create visible jumps between sizes
          noiseShift = (nLow - 0.5) * 0.5
                     + (nHigh - 0.5) * 0.35
                     + (nVHigh - 0.5) * 0.25;
        } else {
          // Off-text: noise strongest near letter edges
          const edgeZone = trailT < 0.02 ? trailT / 0.02
                         : trailT < 0.25 ? 1.0
                         : max(0, 1 - (trailT - 0.25) / 0.35);
          const edgeNoise = edgeZone * 0.6;
          const bNoise = SIZE_NOISE * 0.4;
          noiseShift = (nLow - 0.5) * (bNoise + edgeNoise)
                     + (nHigh - 0.5) * (bNoise + edgeNoise) * 0.6
                     + (nVHigh - 0.5) * edgeNoise * 0.4;
        }

        let t = constrain(sizeFactor + noiseShift, 0, 1);
        if (d === 0) t = constrain(t, 0.3, 1.0); // floor at step 4 — spans 9 sizes
        const step = floor(t * SIZE_STEPS);
        const clampedStep = constrain(step, 0, SIZE_STEPS - 1);

        const stepT = clampedStep / (SIZE_STEPS - 1);
        const expT = Math.pow(stepT, 1.8);
        baseR = minR + (maxR - minR) * expT;
      }

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

  // Build neighbor references (only for cells that exist)
  for (let i = 0; i < newParticles.length; i++) {
    const p = newParticles[i];
    const c = p.col;
    const r = p.row;
    if (c > 0 && newLookup[c - 1] && newLookup[c - 1][r] !== undefined)
      p.neighbors.push(newLookup[c - 1][r]);
    if (c < cols - 1 && newLookup[c + 1] && newLookup[c + 1][r] !== undefined)
      p.neighbors.push(newLookup[c + 1][r]);
    if (r > 0 && newLookup[c][r - 1] !== undefined)
      p.neighbors.push(newLookup[c][r - 1]);
    if (r < rows - 1 && newLookup[c][r + 1] !== undefined)
      p.neighbors.push(newLookup[c][r + 1]);
  }

  particles = newParticles;
  gridLookup = newLookup;
}
