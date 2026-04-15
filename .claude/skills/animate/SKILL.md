---
name: animate
description: Add or modify animations, visual effects, and particle behaviors in the p5.js bubbles sketch
allowed-tools:
  - Read
  - Edit
  - Bash(node:*)
when_to_use: "Use when the user wants to add new animations, visual effects, particle behaviors, color transitions, mouse interactions, or motion patterns to the sketch. Examples: 'add a rainbow effect', 'make particles pulse', 'add a wave animation', 'new mouse interaction', 'add color cycling', 'particles should spiral', 'add a glow effect'"
---

# Animate: Add or Modify Visual Effects

You are working on a p5.js particle animation project located at `/home/user/bubbles`. All animation logic lives in `sketch.js` (246 lines).

## Architecture Overview

The project renders typed text as a grid of circular particles with spring-based physics.

**Key sections in sketch.js:**
- **Lines 1-13**: Configuration constants (COL_COUNT, SPRING_STRENGTH, DAMPING, COUPLING, MOUSE_RADIUS, etc.)
- **Lines 16-23**: State variables (particles array, gridLookup, offscreen graphics buffer)
- **Lines 27-33**: `setup()` - canvas creation, pixel density, input binding
- **Lines 36-107**: `draw()` - physics simulation loop (mouse attraction, neighbor coupling, spring forces, damping, radius animation, rendering)
- **Lines 126-147**: `renderTextToBuffer()` - offscreen text rendering for sampling
- **Lines 151-245**: `rebuildGrid()` - particle creation from text buffer, neighbor linkage, fade-out of old particles

**Particle object shape:**
```js
{
  x, y,             // current position
  vx, vy,           // velocity
  targetX, targetY, // rest position (grid slot)
  r,                // current display radius
  targetR,          // animating toward this radius
  baseR,            // final target radius (from text brightness)
  neighbors,        // indices of adjacent particles in the grid
  col, row          // grid coordinates
}
```

**Physics pipeline (per frame, per particle):**
1. Mouse attraction + radius scaling (distance-based force toward cursor)
2. Neighbor coupling (displacement propagation via COUPLING constant)
3. Spring return to rest position (SPRING_STRENGTH)
4. Velocity damping (DAMPING)
5. Position integration (x += vx, y += vy)
6. Radius animation (targetR lerps toward baseR)
7. Draw circle if radius > 0.3

## How to Add Animations

### Adding new per-particle behaviors
Insert new code inside the `for (let i = 0; i < particles.length; i++)` loop in `draw()`, between the existing physics steps. Respect the existing pipeline order.

### Adding global effects
Add after the particle loop but before the end of `draw()`. Use p5.js drawing primitives (e.g., `line()`, `rect()`, `push()`/`pop()` for transforms).

### Adding time-based animations
Use `frameCount` (built-in p5.js variable) or `millis()` for time-based oscillations. Common pattern:
```js
const phase = sin(frameCount * 0.02 + p.col * 0.1);
```

### Adding color effects
Replace or augment the single `fill(DOT_COLOR[0], DOT_COLOR[1], DOT_COLOR[2])` call before the particle loop. For per-particle color, move `fill()` inside the loop before each `circle()` call.

### Adding new state
Add new properties to the particle object in `rebuildGrid()` (around line 187). Preserve existing properties when reusing particles from `existingP`.

## Rules

- Always read the current state of `sketch.js` before making changes
- Preserve the existing physics pipeline order in draw()
- When adding per-particle properties, initialize them in rebuildGrid() for both new and reused particles
- Keep the configuration constants pattern: add new constants at the top of the file (lines 1-13 region)
- Do not break the text transition system (rebuildGrid fade-in/fade-out)
- Test that the animation works by checking for syntax errors: `node --check sketch.js`
- Use p5.js v1.11.3 API only (loaded via CDN in index.html)
- Maintain 60fps: avoid expensive operations inside the particle loop
