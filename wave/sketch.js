// ─── Per-mode presets (on-page dials edit the active one) ────
// A = solid paper reveal · B = see-through dots over the live video
const PRESETS = {
  A: {
    PUSH_RADIUS: 300, PUSH_STRENGTH: 20, SPRING: 0.035, DAMPING: 0.88,
    HAND_SMOOTH: 0.5, MOTION_GAIN: 0.15, DEPTH_INFLUENCE: 1.45,
    JITTER: 2.2, DOT_GAIN: 0.95, FIELD_COL_COUNT: 180,
  },
  B: {
    PUSH_RADIUS: 300, PUSH_STRENGTH: 20, SPRING: 0.035, DAMPING: 0.88,
    HAND_SMOOTH: 0.5, MOTION_GAIN: 0.15, DEPTH_INFLUENCE: 1.45,
    JITTER: 2.2, DOT_GAIN: 1.05, FIELD_COL_COUNT: 180,
  },
};
const P = Object.assign({}, PRESETS.A);   // live values for the active mode

const CONTROLS = [
  { key: 'PUSH_RADIUS',     label: 'Hand reach',       min: 40,  max: 400, step: 5 },
  { key: 'PUSH_STRENGTH',   label: 'Push strength',    min: 0,   max: 25,  step: 0.5 },
  { key: 'MOTION_GAIN',     label: 'Motion sensitivity', min: 0.02, max: 1, step: 0.01 },
  { key: 'SPRING',          label: 'Bounce-back',      min: 0.01, max: 0.2, step: 0.005 },
  { key: 'DAMPING',         label: 'Bounciness (low=more)', min: 0.6, max: 0.97, step: 0.01 },
  { key: 'HAND_SMOOTH',     label: 'Hand smoothing',   min: 0.1, max: 1,   step: 0.05 },
  { key: 'DEPTH_INFLUENCE', label: 'Depth influence',  min: 0,   max: 1.5, step: 0.05 },
  { key: 'JITTER',          label: 'Jitter',           min: 0,   max: 4,   step: 0.1 },
  { key: 'DOT_GAIN',        label: 'Dot gain',         min: 0.4, max: 2,   step: 0.05 },
  { key: 'FIELD_COL_COUNT', label: 'Resolution',       min: 40,  max: 180, step: 4, rebuild: true },
];

// MediaPipe assets
const MP_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// ─── Fixed configuration ─────────────────────────────────────
const PAPER = '#f5f0e8';
const OFFSET_FRAC = 0.16;
const DOT_MAX_FRAC = 0.62;
const DEPTH_REF = 0.18;                // wrist→knuckle span (normalized) at a "neutral" distance
const PALM_IDX = [0, 5, 9, 13, 17];   // landmarks averaged for a stable palm centre

const CHANNELS = [
  { color: [0, 255, 255], angle: 15 },
  { color: [255, 0, 255], angle: 75 },
  { color: [255, 255, 0], angle: 0 },
  { color: [0, 0, 0],     angle: 45 },
];
for (let i = 0; i < CHANNELS.length; i++) {
  const a = CHANNELS[i].angle * Math.PI / 180;
  CHANNELS[i].cos = Math.cos(a);
  CHANNELS[i].sin = Math.sin(a);
  CHANNELS[i].css = `rgb(${CHANNELS[i].color[0]},${CHANNELS[i].color[1]},${CHANNELS[i].color[2]})`;
}

// ─── State ───────────────────────────────────────────────────
let imgSource;
let bloomStatic;           // offscreen: paper + halftone (shown before camera starts)
let particles = [];        // one chip per grid cell
let cols, rows, spacing, cellMaxR, offset, ox, oy;
let needsRebuild = true;
let mode = 'A';            // A = solid paper reveal · B = see-through dots over video
let introActive = false;   // rain-in entrance
const INTRO_GRAVITY = 0.9; // px/frame² while chips fall in

// Camera + hand tracking
let videoEl = null;
let camReady = false;
let handLandmarker = null;
let lastVideoTime = -1;
let handPoints = [];       // smoothed hand centres in canvas coords

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
  setupCameraOverlay();
}

function draw() {
  if (needsRebuild) {
    buildPicture();
    needsRebuild = false;
  }

  background(PAPER);

  if (camReady && videoEl && videoEl.videoWidth) {
    drawVideoCover(drawingContext, videoEl, width, height);  // you, behind
    detectHands();
    updateChips();
    if (mode === 'A') renderModeA(drawingContext);           // solid print, windows punched
    else renderModeB(drawingContext);                        // dots multiply straight onto you
  } else {
    image(bloomStatic, 0, 0);                                // flowers while waiting
  }
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
  } else if (e.key === 'm' || e.key === 'M') {
    setMode(mode === 'A' ? 'B' : 'A');
  } else if (e.key === 'r' || e.key === 'R') {
    if (camReady) startIntro();          // replay the rain-in
  }
}

// Send every chip above the top edge to fall (rain) into its home spot
function startIntro() {
  introActive = true;
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    p.x = p.homeX;
    p.vx = 0;
    p.vy = 0;
    p.y = -random(spacing, height * 0.5) - spacing;   // staggered, above the top
    p.release = frameCount + floor(random(0, 45));     // scattered start → continuous rain
    p.landed = false;
  }
}

// Switch mode + load that mode's preset into the live dials
function setMode(m) {
  if (m === mode) return;
  const prevRes = P.FIELD_COL_COUNT;
  mode = m;
  Object.assign(P, PRESETS[m]);
  if (P.FIELD_COL_COUNT !== prevRes) needsRebuild = true;
  refreshControls();
  document.querySelectorAll('#mode-toggle button').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
}

// ─── Camera + MediaPipe hand tracking ────────────────────────

function whenMPVision() {
  return new Promise((resolve) => {
    if (window.MPVision) return resolve(window.MPVision);
    window.addEventListener('mpvision-ready', () => resolve(window.MPVision), { once: true });
  });
}

function setupCameraOverlay() {
  const btn = document.getElementById('cam-btn');
  const overlay = document.getElementById('cam-overlay');
  const sub = document.getElementById('cam-sub');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Connecting…';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      videoEl = document.createElement('video');
      videoEl.srcObject = stream;
      videoEl.playsInline = true;
      videoEl.muted = true;
      await videoEl.play();

      btn.textContent = 'Loading hand tracking…';
      const MP = await whenMPVision();
      const vision = await MP.FilesetResolver.forVisionTasks(MP_WASM);
      const makeLandmarker = (delegate) => MP.HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MP_MODEL, delegate },
        numHands: 2,
        runningMode: 'VIDEO',
      });
      try {
        handLandmarker = await makeLandmarker('GPU');
      } catch (gpuErr) {
        handLandmarker = await makeLandmarker('CPU');   // fall back if no GPU delegate
      }

      camReady = true;
      startIntro();
      if (overlay) overlay.classList.add('gone');
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Try again';
      if (sub) sub.textContent = 'Could not start camera + hand tracking. Check camera permission and your connection, then try again.';
    }
  });
}

// "cover" fit + horizontal mirror, into a 2D context of size (tw, th)
function coverRect(vw, vh, tw, th) {
  const s = Math.max(tw / vw, th / vh);
  const dw = vw * s, dh = vh * s;
  return { dx: (tw - dw) / 2, dy: (th - dh) / 2, dw, dh };
}

function drawVideoCover(ctx, vid, tw, th) {
  const { dx, dy, dw, dh } = coverRect(vid.videoWidth, vid.videoHeight, tw, th);
  ctx.save();
  ctx.translate(tw, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(vid, dx, dy, dw, dh);
  ctx.restore();
}

function detectHands() {
  if (!handLandmarker) return;
  // Only run detection on a fresh video frame (avoids duplicate-timestamp errors)
  if (videoEl.currentTime === lastVideoTime) return;
  lastVideoTime = videoEl.currentTime;

  const res = handLandmarker.detectForVideo(videoEl, performance.now());
  const { dx, dy, dw, dh } = coverRect(videoEl.videoWidth, videoEl.videoHeight, width, height);

  const next = [];
  if (res && res.landmarks) {
    for (const lm of res.landmarks) {
      let nx = 0, ny = 0;
      for (const i of PALM_IDX) { nx += lm[i].x; ny += lm[i].y; }
      nx /= PALM_IDX.length; ny /= PALM_IDX.length;
      // apparent hand size (wrist→middle knuckle) = depth proxy; bigger = closer
      const span = Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y);
      const depth = constrain(span / DEPTH_REF, 0.4, 2.2);
      next.push({ x: width - (dx + nx * dw), y: dy + ny * dh, spd: 0, depth });
    }
  }

  // Smooth toward last frame's same-index hand; derive speed from the move
  const k = P.HAND_SMOOTH;
  for (let i = 0; i < next.length; i++) {
    if (handPoints[i]) {
      const sx = lerp(handPoints[i].x, next[i].x, k);
      const sy = lerp(handPoints[i].y, next[i].y, k);
      next[i].spd = Math.hypot(sx - handPoints[i].x, sy - handPoints[i].y);
      next[i].x = sx; next[i].y = sy;
    }
  }
  handPoints = next;
}

// ─── Chip physics: repel from hands, spring home ─────────────

function updateChips() {
  // Precompute each hand's effective field: only moving hands push, and
  // closeness (depth) scales how far/hard the field reaches.
  const hands = [];
  for (let h = 0; h < handPoints.length; h++) {
    const hp = handPoints[h];
    const motion = Math.min(1, hp.spd * P.MOTION_GAIN);
    if (motion <= 0.001) continue;                          // still hand → no push
    const depthScale = lerp(1, hp.depth, P.DEPTH_INFLUENCE);
    const R = P.PUSH_RADIUS * depthScale;
    hands.push({ x: hp.x, y: hp.y, R, rSq: R * R, force: P.PUSH_STRENGTH * motion * depthScale });
  }

  let allLanded = true;
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];

    // ── Rain-in: fall under gravity until reaching home, then hand off ──
    if (!p.landed) {
      allLanded = false;
      if (frameCount < p.release) continue;               // still waiting above the top
      p.vy += INTRO_GRAVITY;
      p.y += p.vy;
      if (p.y >= p.homeY) { p.landed = true; p.vy *= 0.35; }  // land with a small bounce
      continue;                                            // no hand push while falling
    }

    for (let h = 0; h < hands.length; h++) {
      const H = hands[h];
      const dx = p.x - H.x, dy = p.y - H.y;
      const dSq = dx * dx + dy * dy;
      if (dSq < H.rSq && dSq > 0.01) {
        const d = Math.sqrt(dSq);
        const prox = 1 - d / H.R;
        const f = H.force * prox * prox;                    // soft toward the edge
        p.vx += (dx / d) * f;
        p.vy += (dy / d) * f;
      }
    }

    p.vx += (p.homeX - p.x) * P.SPRING;
    p.vy += (p.homeY - p.y) * P.SPRING;
    p.vx *= P.DAMPING;
    p.vy *= P.DAMPING;
    p.x += p.vx;
    p.y += p.vy;
  }

  if (introActive && allLanded) introActive = false;
}

// Mode A — solid print: opaque paper tiles (carried by each chip) cover you,
// gaps where chips were pushed reveal the webcam; dots multiply on the paper.
function renderModeA(ctx) {
  const ps = spacing + 1;
  const phalf = ps / 2;
  ctx.fillStyle = PAPER;
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    ctx.fillRect(p.x - phalf, p.y - phalf, ps, ps);
  }
  drawDots(ctx);
}

// Mode B — see-through: no paper; dots multiply straight onto the live video.
function renderModeB(ctx) {
  drawDots(ctx);
}

// CMYK rosette circles, jittered, multiplied onto whatever is below
function drawDots(ctx) {
  const J = P.JITTER;
  ctx.globalCompositeOperation = 'multiply';
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const jx = (Math.random() - 0.5) * J;
    const jy = (Math.random() - 0.5) * J;
    const ink = p.cmyk;
    for (let ch = 0; ch < 4; ch++) {
      if (ink[ch] <= 0.02) continue;
      const rad = cellMaxR * Math.sqrt(ink[ch]) * P.DOT_GAIN;
      if (rad < 0.15) continue;
      const chn = CHANNELS[ch];
      ctx.fillStyle = chn.css;
      ctx.beginPath();
      ctx.arc(p.x + chn.cos * offset + jx, p.y + chn.sin * offset + jy, rad, 0, TWO_PI);
      ctx.fill();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}

// ─── Build the static halftone, grid + chips ─────────────────

function buildPicture() {
  spacing = max(4, floor(width / P.FIELD_COL_COUNT));
  cols = floor(width / spacing);
  rows = floor(height / spacing);
  ox = (width - cols * spacing) / 2 + spacing / 2;
  oy = (height - rows * spacing) / 2 + spacing / 2;
  cellMaxR = spacing * DOT_MAX_FRAC;
  offset = spacing * OFFSET_FRAC;

  // Sample the source image
  const pg = createGraphics(width, height);
  pg.pixelDensity(1);
  pg.background(PAPER);
  if (imgSource) {
    const s = Math.max(width / imgSource.width, height / imgSource.height);
    const dw = imgSource.width * s, dh = imgSource.height * s;
    pg.image(imgSource, (width - dw) / 2, (height - dh) / 2, dw, dh);
  }
  pg.loadPixels();

  // Render the static CMYK halftone once + create chips
  const old = particles;
  particles = [];
  bloomStatic = createGraphics(width, height);
  bloomStatic.pixelDensity(1);
  bloomStatic.background(PAPER);
  bloomStatic.noStroke();
  bloomStatic.blendMode(MULTIPLY);
  let k = 0;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const hx = ox + c * spacing, hy = oy + r * spacing;
      const px = constrain(floor(hx), 0, pg.width - 1);
      const py = constrain(floor(hy), 0, pg.height - 1);
      const idx = (py * pg.width + px) * 4;
      const rr = pg.pixels[idx] / 255, gg = pg.pixels[idx + 1] / 255, bb = pg.pixels[idx + 2] / 255;
      const kk = 1 - Math.max(rr, gg, bb);
      let cy = 0, mg = 0, yl = 0;
      if (kk < 0.9999) {
        const inv = 1 / (1 - kk);
        cy = (1 - rr - kk) * inv; mg = (1 - gg - kk) * inv; yl = (1 - bb - kk) * inv;
      }
      const ink = [cy, mg, yl, kk];
      for (let ch = 0; ch < 4; ch++) {
        if (ink[ch] <= 0.02) continue;
        const rad = cellMaxR * Math.sqrt(ink[ch]) * P.DOT_GAIN;
        if (rad < 0.15) continue;
        const chn = CHANNELS[ch];
        bloomStatic.fill(chn.color[0], chn.color[1], chn.color[2]);
        bloomStatic.circle(hx + chn.cos * offset, hy + chn.sin * offset, rad * 2);
      }

      const prev = old[k++];
      particles.push({
        x: prev ? prev.x : hx,
        y: prev ? prev.y : hy,
        vx: prev ? prev.vx : 0,
        vy: prev ? prev.vy : 0,
        homeX: hx,
        homeY: hy,
        cmyk: ink,
        landed: true,
        release: 0,
      });
    }
  }
  bloomStatic.blendMode(BLEND);
  pg.remove();
}

// ─── On-page Dials ───────────────────────────────────────────

function buildControls() {
  const body = document.getElementById('panel-body');
  const head = document.getElementById('panel-head');
  if (!body || !head) return;

  head.addEventListener('click', () => {
    document.getElementById('panel').classList.toggle('collapsed');
  });

  // Bottom-right Solid / See-through toggle
  document.querySelectorAll('#mode-toggle button').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
    b.addEventListener('click', () => setMode(b.dataset.mode));
  });

  CONTROLS.forEach(cfg => {
    const row = document.createElement('div');
    row.className = 'ctl';

    const label = document.createElement('label');
    label.className = 'ctl-label';
    label.textContent = cfg.label;

    const value = document.createElement('span');
    value.className = 'ctl-value';
    value.id = 'val-' + cfg.key;
    value.textContent = fmtVal(P[cfg.key], cfg.step);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = 'ctl-' + cfg.key;
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

// Sync the sliders to the current P (after a mode/preset switch)
function refreshControls() {
  CONTROLS.forEach(cfg => {
    const s = document.getElementById('ctl-' + cfg.key);
    const v = document.getElementById('val-' + cfg.key);
    if (s) s.value = P[cfg.key];
    if (v) v.textContent = fmtVal(P[cfg.key], cfg.step);
  });
}

function fmtVal(v, step) {
  const decimals = step >= 1 ? 0 : (step < 0.01 ? 3 : 2);
  return v.toFixed(decimals);
}
