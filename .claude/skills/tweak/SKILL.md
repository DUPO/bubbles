---
name: tweak
description: Interactively adjust physics and visual configuration constants in the bubbles sketch
allowed-tools:
  - Read
  - Edit
when_to_use: "Use when the user wants to adjust, tune, or change configuration values like spring strength, damping, mouse radius, colors, particle density, or any other numeric/color constants. Examples: 'make it bouncier', 'increase mouse radius', 'change the color', 'more particles', 'less damping', 'make dots bigger', 'change background color', 'slower animation'"
argument-hint: "<what to adjust>"
arguments:
  - adjustment
---

# Tweak: Adjust Configuration Constants

You are tuning the configuration constants in `/home/user/bubbles/sketch.js`. These constants control all visual and physics behavior.

## Current Configuration (lines 1-13 of sketch.js)

Read lines 1-13 of sketch.js first, then present the current values to the user.

## Configuration Reference

| Constant | Purpose | Typical Range | Effect of Increasing |
|---|---|---|---|
| `COL_COUNT` | Grid columns across screen width | 15-60 | More particles, finer detail, higher CPU |
| `BRIGHTNESS_THRESHOLD` | Min brightness to place a particle | 10-100 | Fewer particles (more selective) |
| `SPRING_STRENGTH` | How hard particles snap to grid position | 0.01-0.15 | Stiffer, snappier return |
| `DAMPING` | Velocity multiplier per frame (friction) | 0.7-0.95 | Less friction, more floaty/bouncy |
| `COUPLING` | How much neighbors influence each other | 0.001-0.05 | More wave propagation, jelly-like |
| `MOUSE_RADIUS` | Pixel radius of mouse influence | 50-400 | Larger area of effect |
| `MOUSE_ATTRACT_STRENGTH` | Force pulling particles toward cursor | 0.01-0.2 | Stronger pull |
| `MOUSE_SCALE_MAX` | Max radius multiplier near cursor | 1.0-4.0 | Bigger dots near cursor |
| `RADIUS_EASE_IN` | How fast dots grow when cursor is near | 0.05-0.3 | Faster size increase |
| `RADIUS_EASE_OUT` | How fast dots shrink when cursor leaves | 0.02-0.15 | Faster size decrease |
| `BG_COLOR` | Background color (CSS string) | Any hex/CSS color | Changes background |
| `DOT_COLOR` | Particle color [R, G, B] | 0-255 per channel | Changes dot color |

## Common Presets

**"Bouncy"**: SPRING_STRENGTH=0.02, DAMPING=0.92, COUPLING=0.02
**"Stiff"**: SPRING_STRENGTH=0.1, DAMPING=0.8, COUPLING=0.005
**"Jelly"**: SPRING_STRENGTH=0.03, DAMPING=0.88, COUPLING=0.04
**"Fine detail"**: COL_COUNT=50, BRIGHTNESS_THRESHOLD=20
**"Coarse"**: COL_COUNT=15, BRIGHTNESS_THRESHOLD=40

## Workflow

### 1. Read current values
Read lines 1-13 of `sketch.js` and present them.

### 2. Understand intent
If `$adjustment` is provided, interpret what the user wants. Map natural language to constants:
- "bouncier/springier" -> lower DAMPING or higher SPRING_STRENGTH
- "bigger/smaller dots" -> MOUSE_SCALE_MAX or COL_COUNT
- "more/less particles" -> COL_COUNT or BRIGHTNESS_THRESHOLD
- "faster/slower" -> DAMPING, SPRING_STRENGTH
- "more/less squishy" -> COUPLING, DAMPING
- "larger/smaller mouse effect" -> MOUSE_RADIUS, MOUSE_ATTRACT_STRENGTH

### 3. Apply changes
Edit only the constant declarations on lines 1-13. Do not modify any other code.

### 4. Summarize
Tell the user what was changed and what effect to expect. Suggest further adjustments if relevant.

## Rules

- Only modify lines 1-13 of sketch.js (the configuration block)
- Preserve the exact variable declaration format: `const NAME = value;`
- For colors: BG_COLOR is a CSS string in quotes, DOT_COLOR is an array `[R, G, B]`
- Keep values within the typical ranges listed above to avoid broken physics
- When adjusting multiple related constants (e.g., making it "bouncier"), change them together for a coherent effect
