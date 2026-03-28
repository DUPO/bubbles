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
const BG_COLOR = '#0a0a0a';
const DOT_COLOR = [250, 250, 250]; // #fafafa

// ─── State ───────────────────────────────────────────────────
let particles = [];
let gridLookup = [];   // 2D array [col][row] → particle index
let pg;                // offscreen graphics buffer
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
  fill(DOT_COLOR[0], DOT_COLOR[1], DOT_COLOR[2]);

  const mx = mouseX;
  const my = mouseY;
  const mrSq = MOUSE_RADIUS * MOUSE_RADIUS;

  // Physics update + render in single pass
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];

    // ── 1. Mouse attraction + radius scaling ──
    const dx = mx - p.x;
    const dy = my - p.y;
    const distSq = dx * dx + dy * dy;

    if (distSq < mrSq && distSq > 0.01) {
      const dist = Math.sqrt(distSq);
      const force = map(dist, 0, MOUSE_RADIUS, MOUSE_ATTRACT_STRENGTH, 0);

      // Attract toward cursor
      p.vx += dx * force * 0.3;
      p.vy += dy * force * 0.3;

      // Scale up radius
      const scaleFactor = map(dist, 0, MOUSE_RADIUS, MOUSE_SCALE_MAX, 1.0);
      p.r = lerp(p.r, p.targetR * scaleFactor, RADIUS_EASE_IN);
    } else {
      // Ease radius back to target
      p.r = lerp(p.r, p.targetR, RADIUS_EASE_OUT);
    }

    // ── 2. Neighbor coupling ──
    const neighbors = p.neighbors;
    for (let j = 0; j < neighbors.length; j++) {
      const n = particles[neighbors[j]];
      // Nudge toward neighbor's displacement from rest
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

    // ── 5. Animate radius toward base (for text transitions) ──
    p.targetR = lerp(p.targetR, p.baseR, 0.08);

    // ── 6. Draw ──
    if (p.r > 0.3) {
      circle(p.x, p.y, p.r * 2);
    }
  }

  // Clean up dead particles (baseR shrunk to 0 and fully faded)
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
  pg.pixelDensity(1); // Critical for Retina displays
  pg.background(0);
  pg.fill(255);
  pg.noStroke();
  pg.textAlign(CENTER, CENTER);
  pg.textStyle(BOLD);

  // Try bold system fonts in order of preference
  pg.textFont('Arial Black');

  // Auto-size: fit text to ~75% of canvas width
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

  // Calculate grid dimensions
  spacing = floor(width / COL_COUNT);
  if (spacing < 4) spacing = 4;
  cols = floor(width / spacing);
  rows = floor(height / spacing);
  offsetX = (width - cols * spacing) / 2 + spacing / 2;
  offsetY = (height - rows * spacing) / 2 + spacing / 2;

  // Build new particles from buffer sampling
  const newParticles = [];
  const newLookup = [];

  for (let c = 0; c < cols; c++) {
    newLookup[c] = [];
    for (let r = 0; r < rows; r++) {
      // Map grid position to pixel in offscreen buffer
      const px = floor(map(c, 0, cols - 1, 0, pg.width - 1));
      const py = floor(map(r, 0, rows - 1, 0, pg.height - 1));
      const idx = (py * pg.width + px) * 4;
      const brightness = pg.pixels[idx]; // Red channel

      if (brightness > BRIGHTNESS_THRESHOLD) {
        const tx = offsetX + c * spacing;
        const ty = offsetY + r * spacing;
        const baseR = map(brightness, BRIGHTNESS_THRESHOLD, 255, 0.5, spacing * 0.42);

        // Try to find an existing particle at this grid position for smooth transition
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
          r: existingP ? existingP.r : 0, // Start at 0 for entrance animation
          targetR: existingP ? existingP.targetR : 0, // Will animate toward baseR
          baseR: baseR,
          neighbors: [], // Populated below
          col: c,
          row: r
        };

        newLookup[c][r] = newParticles.length;
        newParticles.push(p);
      }
    }
  }

  // Build neighbor references
  for (let i = 0; i < newParticles.length; i++) {
    const p = newParticles[i];
    const c = p.col;
    const r = p.row;

    // Check 4 cardinal neighbors
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

  // Mark old particles that no longer exist for fade-out
  for (let i = 0; i < oldParticles.length; i++) {
    const op = oldParticles[i];
    const c = op.col;
    const r = op.row;

    if (newLookup[c] === undefined || newLookup[c][r] === undefined) {
      // This particle is no longer in the new text — shrink it out
      op.baseR = 0;
      op.neighbors = [];
      newParticles.push(op);
    }
  }

  particles = newParticles;
  gridLookup = newLookup;
}
