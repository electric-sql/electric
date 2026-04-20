# Interactive Prism Hero — Design & Implementation Plan

> **Goal:** Replace the static SVG hero on the Electric homepage with an interactive,
> multiplayer 3D visualisation of the Electric logo as a crystalline prism refracting
> light — built with Three.js, WebGPU shaders, and Electric's own Durable Streams
> for real-time presence.

## Table of Contents

- [Concept](#concept)
- [Reference Material](#reference-material)
- [Architecture Overview](#architecture-overview)
- [1. 3D Prism Geometry from the Logo SVG](#1-3d-prism-geometry-from-the-logo-svg)
- [2. Crystal Material (TSL)](#2-crystal-material-tsl)
- [3. Light Beam Refraction](#3-light-beam-refraction)
- [4. Particle Systems](#4-particle-systems)
- [5. Post-Processing](#5-post-processing)
- [6. Interactivity](#6-interactivity)
- [7. Multiplayer via Durable Streams](#7-multiplayer-via-durable-streams)
- [8. Renderer Strategy & Fallback](#8-renderer-strategy--fallback)
- [9. Integration into VitePress Homepage](#9-integration-into-vitepress-homepage)
- [10. Performance Budget](#10-performance-budget)
- [11. Visual Design](#11-visual-design)
- [12. File Structure](#12-file-structure)
- [13. Phased Delivery](#13-phased-delivery)
- [14. Open Questions](#14-open-questions)

---

## Concept

Electric is a prism. Data flows in as a single stream from Postgres and refracts
out into many synchronised streams to clients. The Electric logo's geometry — two
angular shapes forming a folded prism — already looks like a prism.

The visualisation:

```
                         ╱‾‾‾‾‾‾‾╲
    ━━━━━━━━━━━━━━━━━━► ╱  PRISM   ╲ ━━━━━► beam (blue)
     single input beam   ╲ (Electric ╱ ━━━━━━━► beam (cyan)
                          ╲  logo)  ╱  ━━━━━━━━━► beam (green)
                           ╲______╱   ━━━━━━━━━━━━► beam (yellow)
```

- A single coherent beam enters from the left (Postgres / data source).
- The Electric logo prism refracts it into a fan of spectral beams on the right
  (clients / agents receiving synced data).
- Visitors' cursors appear as small prisms that add their own refraction, visible
  to everyone on the page in real time via Durable Streams.

This is both a beautiful interactive hero _and_ a live demo of Electric's own
sync primitives.

---

## Reference Material

| Asset                             | Location                                                   | Notes                                                      |
| --------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| Reference image (blog header)     | `website/public/img/blog/electric-1.0-released/header.jpg` | Crystalline prism refracting light — the target aesthetic  |
| Electric icon SVG                 | `website/public/img/brand/icon.svg`                        | Two paths: upper parallelogram + lower triangle, `192×192` |
| Electric logo SVG (with wordmark) | `website/public/img/brand/logo.svg`                        | Mark + "electric" text, `1024×284`                         |
| Current hero SVG                  | `website/public/img/home/zap-with-halo.svg`                | Gradient halo — what we're replacing                       |
| Homepage                          | `website/index.md`                                         | VitePress `layout: home`, frontmatter hero                 |
| Durable Streams docs              | `website/primitives/durable-streams.md`                    | Persistent, addressable, real-time streams                 |

### Logo SVG Paths (icon.svg)

The geometry we need to extrude into 3D:

```svg
<!-- Upper parallelogram -->
<path d="M106.992 16.1244C107.711 15.4029 108.683 15
         109.692 15H170L84.0082 101.089C83.2888 101.811
         82.3171 102.213 81.3081 102.213H21L106.992 16.1244Z"/>

<!-- Lower right triangle -->
<path d="M96.4157 104.125C96.4157 103.066 97.2752 102.204
         98.331 102.204H170L96.4157 176V104.125Z"/>
```

The two shapes meet along a horizontal seam at y ≈ 102–104. Together they form
the iconic angular "bolt" that doubles as a prism shape.

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────────┐
│  HeroPrism.vue (Vue component wrapper)                             │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  <canvas>  ←  Three.js scene                                 │  │
│  │  ┌────────────────────────────────────────────────────────┐  │  │
│  │  │  WebGPURenderer (primary) / WebGLRenderer (fallback)   │  │  │
│  │  │                                                        │  │  │
│  │  │  ┌──────────┐  ┌────────────┐  ┌──────────────────┐   │  │  │
│  │  │  │  Prism    │  │  Light     │  │  Particle        │   │  │  │
│  │  │  │  Geometry │  │  Beams     │  │  Systems          │   │  │  │
│  │  │  │  (SVG→3D) │  │  (TSL)    │  │  (instanced)     │   │  │  │
│  │  │  └──────────┘  └────────────┘  └──────────────────┘   │  │  │
│  │  │                                                        │  │  │
│  │  │  ┌──────────────────┐  ┌──────────────────────────┐   │  │  │
│  │  │  │  Cursor Prisms   │  │  Post-Processing          │   │  │  │
│  │  │  │  (multiplayer)   │  │  (bloom, tone mapping)    │   │  │  │
│  │  │  └──────────────────┘  └──────────────────────────┘   │  │  │
│  │  └────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                              ↕                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Durable Stream  ("/homepage/presence")                      │  │
│  │  POST cursor position  ←→  GET/tail other cursors            │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Fallback: <img> or <video> for unsupported browsers         │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

---

## 1. 3D Prism Geometry from the Logo SVG

### Approach

The Electric icon SVG contains two simple shapes made of lines and cubic bezier
curves. Convert them to Three.js geometry:

1. **Parse SVG path data** into `THREE.Shape` objects.
   - The paths are simple enough (4–5 commands each: M, C, H, L, Z) to convert
     by hand or with a lightweight parser — no need for the full `SVGLoader`.
   - Normalise coordinates to center the shape at origin.

2. **Extrude** each shape using `THREE.ExtrudeGeometry`:
   - `depth`: ~25 units (gives the prism its 3D volume).
   - `bevelEnabled`: true, `bevelThickness`: 1, `bevelSize`: 0.5
     (subtle bevel for crystalline faceted edges).

3. **Group** both shapes into a `THREE.Group`:
   - The seam between upper and lower shapes (at y ≈ 102–104 in SVG space)
     creates a natural "crease" that catches light differently, matching the
     reference image where distinct upper/lower faces are visible.
   - Rotate the group so the "forward" direction of the prism faces right
     (light enters left, exits right).

### Coordinate Mapping

```
SVG space (icon.svg)        →    Three.js world
────────────────────             ────────────────
viewBox: 0 0 192 192             Centered at origin
x: 21–170 (width ~149)          x: -1 to +1 (normalised)
y: 15–176 (height ~161)         y: -1 to +1 (normalised)
                                 z: 0 to depth (extrusion axis)
```

Scale and position so the prism fits naturally in the hero area (~40% of the
canvas width).

---

## 2. Crystal Material (TSL)

Use Three.js's **TSL (Three Shading Language)** for the prism material. TSL
compiles to WGSL for WebGPU and GLSL for WebGL — one codebase, both renderers.

### Material Properties

Based on `MeshPhysicalNodeMaterial` with TSL enhancements:

| Property              | Value     | Purpose                              |
| --------------------- | --------- | ------------------------------------ |
| `transmission`        | 0.92      | High transparency (glass)            |
| `ior`                 | 1.52      | Index of refraction (crown glass)    |
| `roughness`           | 0.03      | Very smooth crystal surfaces         |
| `metalness`           | 0.0       | Non-metallic                         |
| `thickness`           | 15        | Volumetric light absorption depth    |
| `color`               | `#D0BCFF` | Brand purple tint                    |
| `attenuationColor`    | `#9b7dd4` | Purple-tinted light absorption       |
| `attenuationDistance` | 8         | How far light travels before tinting |
| `iridescence`         | 0.3       | Subtle rainbow edge effects          |
| `envMapIntensity`     | 0.8       | Ambient reflections                  |

### TSL Enhancements

```typescript
import {
  MeshPhysicalNodeMaterial,
  uniform,
  float,
  vec3,
  color,
  fresnel,
  normalWorld,
  cameraPosition,
  time,
} from 'three/tsl'

// Edge glow — stronger fresnel at glancing angles
const edgeGlow = fresnel({ power: 3.0 })
const glowColor = color('#D0BCFF')
material.emissiveNode = mul(glowColor, mul(edgeGlow, float(0.4)))

// Subtle animated internal caustics
const causticPattern = sin(
  add(mul(normalWorld.x, float(10)), mul(time, float(0.5)))
)
material.emissiveNode = add(
  material.emissiveNode,
  mul(glowColor, mul(causticPattern, float(0.05)))
)
```

---

## 3. Light Beam Refraction

The visual centrepiece. Uses a **hybrid art-directed + physics-inspired** approach.

### Refraction Math

Snell's law for chromatic dispersion:

```
n₁ × sin(θ₁) = n₂ × sin(θ₂)
```

Where `n₂` varies by wavelength (dispersion):

| Colour | Wavelength (nm) | IOR (n₂) | Refraction Angle Δ |
| ------ | --------------- | -------- | ------------------ |
| Violet | 380             | 1.532    | baseline           |
| Blue   | 450             | 1.525    | +0.8°              |
| Cyan   | 500             | 1.520    | +1.4°              |
| Green  | 550             | 1.517    | +1.8°              |
| Yellow | 580             | 1.515    | +2.1°              |

The exact angles are **art-directed** to look dramatic while staying physically
plausible. Pre-compute beam exit angles and directions at initialisation time,
not per-frame.

### Incoming Beam (Left Side)

- Single bright beam, purple/magenta gradient (`#7c3aed` → `#a855f7`).
- Rendered as a `THREE.TubeGeometry` along a straight path.
- Custom TSL material with:
  - Distance-based falloff from beam centre axis (Gaussian).
  - Additive blending for glow.
  - Animated "flow" via UV offset over time.

### Refracted Beams (Right Side)

- 8–12 beams fanning out at Snell's-law-derived angles.
- Each beam assigned a spectral colour (violet → blue → cyan → green → yellow).
- Same tube + glow material, but parametrised per beam colour/intensity.
- Slight curvature near the prism exit face (caustic bending) via bezier paths.
- Beams extend to the edge of the viewport and fade via distance attenuation.

### Beam Material (TSL)

```typescript
// Per-beam parameters
const beamColor = uniform(color('#06b6d4')) // cyan example
const beamIntensity = uniform(float(2.0))
const beamRadius = uniform(float(0.15))

// UV.y = distance from beam centre axis (0 = centre, 1 = edge)
const dist = abs(sub(uv().y, float(0.5)))
const glow = smoothstep(beamRadius, float(0.0), dist)
const flow = sin(add(mul(uv().x, float(20.0)), mul(time, float(2.0))))
const flowIntensity = add(float(0.8), mul(flow, float(0.2)))

material.colorNode = mul(
  beamColor,
  mul(glow, mul(beamIntensity, flowIntensity))
)
material.opacityNode = glow
```

### Beam Intersection with Prism

Where each beam enters/exits the prism surface, add a small bright "hotspot":

- Point light or emissive sprite at the entry/exit point.
- Animated ripple effect radiating outward.
- Intensity responds to beam brightness.

---

## 4. Particle Systems

Two particle layers for depth and atmosphere.

### Ambient Star Field

- ~2000 small particles scattered across the scene volume.
- Very low opacity, slight twinkle animation.
- Gives the dark space background depth.
- `THREE.InstancedMesh` with sprite geometry for performance.

### Beam Particles

- ~3000 particles distributed along beam paths (input + refracted).
- Each particle:
  - Colour-matched to its parent beam.
  - Animated velocity along beam direction.
  - Size attenuation with distance from camera.
  - Random slight offset perpendicular to beam for volume.
- Creates the volumetric sparkle/dust effect visible in the reference image.
- On WebGPU: use **compute shaders** for particle position updates.
- On WebGL: use CPU-side updates with typed arrays (still performant at 3000).

### Prism Dust

- ~500 particles inside the prism volume.
- Very small, slow-moving, purple-tinted.
- Creates internal scattering visible through the transparent crystal.
- Adds life to the prism itself.

---

## 5. Post-Processing

### Bloom

`UnrealBloomPass` (or TSL equivalent) with:

| Parameter   | Value | Notes                                |
| ----------- | ----- | ------------------------------------ |
| `strength`  | 1.2   | Strong enough for dramatic beam glow |
| `radius`    | 0.6   | Moderate spread                      |
| `threshold` | 0.3   | Only bright elements bloom           |

### Tone Mapping

- `ACESFilmicToneMapping` for cinematic HDR look.
- Exposure: ~1.2 (slightly bright to make beams pop).

### Optional

- Subtle vignette (darker corners) to draw focus to the prism.
- Very light film grain for texture (disable on mobile).

---

## 6. Interactivity

### Cursor → Beam Angle

The user's mouse position controls the incoming beam direction:

- **X-axis**: shifts the beam entry point up/down on the prism face.
- **Y-axis**: adjusts the beam angle slightly.
- This changes the refraction angles and the fan pattern of output beams.
- Refracted beam positions recalculate smoothly.

Smooth interpolation for fluid motion:

```typescript
const targetBeamAngle = new THREE.Vector2()
const currentBeamAngle = new THREE.Vector2()

canvas.addEventListener('mousemove', (e) => {
  targetBeamAngle.set(
    (e.clientX / window.innerWidth) * 2 - 1,
    -(e.clientY / window.innerHeight) * 2 + 1
  )
})

function animate() {
  currentBeamAngle.lerp(targetBeamAngle, 0.05)
  updateBeamPaths(currentBeamAngle)
  renderer.render(scene, camera)
}
```

### Scroll Parallax

- Subtle camera orbit as user scrolls past the hero.
- Prism rotates slightly on Y-axis (~5°), revealing different facets.
- Beam angles adjust naturally.
- `IntersectionObserver` to track hero visibility.

### Mobile Touch

- Touch position controls beam angle (same as mouse).
- Pinch-to-zoom disabled on the canvas.
- Reduced interactivity on small screens (gentle auto-animation instead).

### Reduced Motion

- Respect `prefers-reduced-motion`: disable particle animation, reduce beam
  flow animation, remove scroll parallax. Keep the scene static but visible.

---

## 7. Multiplayer via Durable Streams

This is the "dogfooding" showcase — the homepage itself demonstrates Electric's
real-time sync.

### How It Works

Every homepage visitor becomes part of the visualisation:

1. On load, generate a session UUID and assign a random hue.
2. Connect to a Durable Stream at a known URL.
3. Send cursor position (throttled to ~10 updates/second).
4. Receive all other visitors' cursor positions via stream tail.
5. Render each remote visitor as a **small floating prism** in the 3D scene.
6. These mini-prisms interact with the refracted beams, adding their own
   tiny dispersion effects.

### Visual Effect

- More visitors = more small prisms = more refraction = more beautiful.
- This is a visual metaphor for Electric's fan-out scaling.
- Each mini-prism has its visitor's assigned hue, tinting light uniquely.
- Idle cursors (no movement for 5s) fade to ghostly translucency.
- Departed visitors fade out over ~2 seconds.
- Subtle count indicator: "7 people here now".

### Data Protocol

```typescript
interface PresenceMessage {
  type: 'cursor'
  id: string // session UUID
  x: number // 0–1 normalised scene position
  y: number // 0–1 normalised scene position
  hue: number // 0–360 assigned colour hue
  ts: number // Unix ms timestamp for staleness detection
}
```

### Stream Connection

Using the Durable Streams HTTP protocol:

```typescript
const STREAM_URL = '/api/homepage-presence'

// --- Write (append cursor position) ---
async function sendCursor(msg: PresenceMessage) {
  await fetch(STREAM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(msg),
  })
}

// --- Read (tail the stream for other cursors) ---
async function* tailCursors(signal: AbortSignal) {
  const res = await fetch(STREAM_URL, { signal })
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // Parse newline-delimited JSON messages
    const lines = buffer.split('\n')
    buffer = lines.pop()!
    for (const line of lines) {
      if (line.trim()) yield JSON.parse(line) as PresenceMessage
    }
  }
}
```

### Staleness & Cleanup

| Condition           | Action                                                     |
| ------------------- | ---------------------------------------------------------- |
| No update for 3s    | Reduce mini-prism opacity to 50%                           |
| No update for 8s    | Fade mini-prism to 10% opacity                             |
| No update for 15s   | Remove from scene                                          |
| Tab hidden          | Stop sending, resume on visibility                         |
| Stream disconnected | Reconnect with exponential backoff, scene works without it |

### Proxy Endpoint

A server-side route (TanStack Start, Netlify Function, or similar) that:

1. Authenticates/rate-limits (prevent abuse).
2. Proxies to the Durable Stream backend.
3. Injects `source_secret` server-side (never exposed to browser).

```typescript
// /api/homepage-presence (server route)
export async function handler({ request }) {
  const STREAM_BACKEND = process.env.DURABLE_STREAM_URL
  // Proxy the request, adding auth
  return fetch(`${STREAM_BACKEND}/homepage-presence`, {
    method: request.method,
    headers: {
      ...Object.fromEntries(request.headers),
      Authorization: `Bearer ${process.env.STREAM_SECRET}`,
    },
    body: request.method === 'POST' ? request.body : undefined,
  })
}
```

---

## 8. Renderer Strategy & Fallback

### Detection & Cascade

```
navigator.gpu exists?
  ├── Yes → requestAdapter() succeeds?
  │   ├── Yes → THREE.WebGPURenderer
  │   │         TSL → WGSL shaders
  │   │         Compute shaders for particles ✓
  │   └── No  → fall through ↓
  └── No  → fall through ↓

canvas.getContext('webgl2') succeeds?
  ├── Yes → THREE.WebGLRenderer
  │         TSL → GLSL shaders
  │         CPU-side particle updates
  └── No  → fall through ↓

Show <img> (static) or <video> (looping animation)
```

### Implementation

```typescript
async function createRenderer(
  canvas: HTMLCanvasElement
): Promise<THREE.WebGPURenderer | THREE.WebGLRenderer | null> {
  // Try WebGPU first
  if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
    try {
      const adapter = await navigator.gpu.requestAdapter()
      if (adapter) {
        const renderer = new THREE.WebGPURenderer({
          canvas,
          antialias: true,
          alpha: true,
        })
        await renderer.init()
        return renderer
      }
    } catch {
      // WebGPU unavailable, try WebGL
    }
  }

  // Try WebGL2
  const gl = canvas.getContext('webgl2')
  if (gl) {
    return new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      context: gl,
    })
  }

  // No 3D support
  return null
}
```

### Fallback Assets

- **Static image**: high-quality render of the prism scene (WebP, ~200KB).
  Generated from a screenshot of the 3D scene or from the reference image.
- **Looping video**: 5–10 second animation of the prism with beams (WebM + MP4,
  ~1–2MB). Auto-plays muted, loops seamlessly.
- The fallback is rendered server-side by VitePress (no JS required).

### Browser Support (as of 2026)

| Browser      | WebGPU | WebGL2 | Fallback |
| ------------ | ------ | ------ | -------- |
| Chrome 113+  | ✅     | ✅     | —        |
| Edge 113+    | ✅     | ✅     | —        |
| Firefox 140+ | ✅     | ✅     | —        |
| Safari 18+   | ✅     | ✅     | —        |
| Safari 15–17 | ❌     | ✅     | —        |
| Older / bots | ❌     | ❌     | ✅       |

Expected: ~80%+ of visitors get WebGPU, ~15% WebGL2, <5% fallback.

---

## 9. Integration into VitePress Homepage

### Current State

The homepage (`website/index.md`) uses VitePress's default `VPHomeHero` driven
by YAML frontmatter. The hero image is a static SVG (`/img/home/zap-with-halo.svg`)
rendered via the `hero.image.src` property. Styles in `custom.css` position and
size it.

### Approach: Augment the Existing Hero

Rather than replacing the entire hero layout, **inject the 3D canvas into the
existing hero image slot**:

1. **Keep the frontmatter hero** — text, tagline, and CTA render immediately
   via SSR (good for SEO and first paint).
2. **Create `HeroPrism.vue`** — a Vue component that:
   - Renders a `<canvas>` element.
   - On mount, dynamically imports Three.js and initialises the scene.
   - Positions itself over the hero image area via CSS.
3. **Mount `HeroPrism.vue`** in the homepage's `<script setup>` and place it
   after the frontmatter content, using CSS to position it within the hero.
4. **Hide the static SVG** when the canvas is ready (CSS swap).

### Layout

```
Desktop (≥960px):
┌──────────────────────────────────────────────────────┐
│  "The data platform          ┌────────────────────┐  │
│   for multi-agent"           │                    │  │
│                              │   3D Prism Scene   │  │
│  Electric provides the...    │   (canvas)         │  │
│                              │                    │  │
│  [Start building now »]      │   ← beam → prism   │  │
│                              │        → beams →   │  │
│                              └────────────────────┘  │
└──────────────────────────────────────────────────────┘

Mobile (<960px):
┌────────────────────────┐
│  ┌──────────────────┐  │
│  │  3D Prism Scene   │  │
│  │  (canvas)         │  │
│  └──────────────────┘  │
│                        │
│  "The data platform    │
│   for multi-agent"     │
│                        │
│  [Start building »]    │
└────────────────────────┘
```

### CSS Integration

Override the existing VitePress hero image styles:

```css
/* Replace the static SVG with the canvas */
.VPHomeHero .image-container {
  position: relative;
}

.hero-prism-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
}

/* Extend beams beyond the image container */
.hero-prism-container {
  overflow: visible;
}

/* Hide static SVG when canvas is active */
.hero-prism-active .VPImage.image-src {
  opacity: 0;
  transition: opacity 0.5s ease;
}
```

### Lazy Loading

Three.js is ~180KB gzipped (tree-shaken). To avoid blocking first paint:

```typescript
onMounted(async () => {
  // Don't block — user sees the hero text + fallback image immediately
  const { initScene } = await import('./hero-prism/scene/createScene')
  // ... initialise
})
```

Timeline:

1. **0ms**: Hero text + static fallback image visible (SSR).
2. **~200ms**: Vue mounts, begins dynamic import.
3. **~500ms**: Three.js loaded, scene initialising.
4. **~800ms**: First frame rendered, canvas fades in, static image fades out.
5. **~1200ms**: Durable stream connected, multiplayer active.

---

## 10. Performance Budget

| Concern            | Target                       | Strategy                                       |
| ------------------ | ---------------------------- | ---------------------------------------------- |
| **Bundle size**    | < 200KB gzipped              | Tree-shake Three.js, dynamic `import()`        |
| **First paint**    | < 100ms                      | SSR hero text + fallback image, 3D loads async |
| **Scene ready**    | < 1000ms                     | Pre-compiled shaders, simple geometry          |
| **Triangle count** | < 1000                       | Prism is ~500 tris, beams are tubes            |
| **Particle count** | 5000 desktop / 1000 mobile   | `InstancedMesh`, compute shaders on WebGPU     |
| **Frame rate**     | 60fps desktop / 30fps mobile | Adaptive quality, `IntersectionObserver`       |
| **Battery**        | Minimal drain                | Pause when tab hidden or hero off-screen       |
| **Network**        | < 1KB/s for presence         | Throttled to 10 msgs/s, small JSON payloads    |
| **Memory**         | < 50MB GPU                   | Small textures, instanced geometry             |

### Adaptive Quality

```typescript
function getQualityLevel(): 'high' | 'medium' | 'low' {
  const isMobile = /Android|iPhone|iPad/.test(navigator.userAgent)
  const dpr = Math.min(window.devicePixelRatio, 2)

  if (isMobile || dpr < 1.5) return 'low'
  if (dpr < 2) return 'medium'
  return 'high'
}

const QUALITY = {
  high: { particles: 5000, bloomStrength: 1.2, beamSegments: 64 },
  medium: { particles: 2000, bloomStrength: 0.8, beamSegments: 32 },
  low: { particles: 800, bloomStrength: 0.5, beamSegments: 16 },
}
```

### Lifecycle

- **`IntersectionObserver`**: When the hero scrolls off-screen, pause the render
  loop entirely (no `requestAnimationFrame` calls).
- **`document.visibilityState`**: When the tab is hidden, pause rendering and
  stop sending cursor positions.
- **Idle detection**: After 30s with no mouse movement, reduce to 30fps and
  simplify particle animation.

---

## 11. Visual Design

### Colour Palette

Matching the reference image and Electric brand:

| Element           | Colour             | Hex                                    |
| ----------------- | ------------------ | -------------------------------------- |
| Background        | Deep space         | `#0a0a12` (blends with site `#131517`) |
| Prism tint        | Brand purple       | `#D0BCFF`                              |
| Prism edge glow   | Lighter purple     | `#e8d5ff`                              |
| Input beam        | Purple / magenta   | `#7c3aed` → `#a855f7`                  |
| Refracted beam 1  | Violet             | `#8b5cf6`                              |
| Refracted beam 2  | Blue               | `#3b82f6`                              |
| Refracted beam 3  | Cyan               | `#06b6d4`                              |
| Refracted beam 4  | Teal               | `#14b8a6`                              |
| Refracted beam 5  | Green              | `#22c55e`                              |
| Refracted beam 6  | Lime               | `#84cc16`                              |
| Refracted beam 7  | Yellow             | `#eab308`                              |
| Ambient particles | White, low opacity | `#ffffff` at 10%                       |
| Cursor prisms     | Per-visitor hue    | HSL-based                              |

### Lighting

- No directional lights (beams are self-illuminated via emissive materials).
- Subtle ambient light (`intensity: 0.1`) so the prism surfaces are barely
  visible even without beams.
- Environment map: subtle dark HDRI for reflections on prism faces (or
  procedural environment via TSL).

### Camera

- Perspective camera, `fov: 45`, positioned to frame the prism with space for
  beams on both sides.
- Slight off-centre framing (prism at ~40% from left) to match the hero layout
  where text is on the left.

---

## 12. File Structure

```
website/src/components/home/hero-prism/
├── HeroPrism.vue                # Vue wrapper — canvas, fallback, lifecycle
│
├── scene/
│   ├── createScene.ts           # Scene orchestrator: camera, renderer, loop
│   ├── prismGeometry.ts         # SVG path data → THREE.Shape → ExtrudeGeometry
│   ├── crystalMaterial.ts       # TSL MeshPhysicalNodeMaterial for glass/crystal
│   ├── lightBeams.ts            # Input beam + refracted beams (geometry + paths)
│   ├── beamMaterial.ts          # TSL additive glow material for beams
│   ├── particles.ts             # InstancedMesh particle systems (stars, beam dust)
│   ├── postProcessing.ts        # Bloom pass, tone mapping, optional vignette
│   └── responsiveCamera.ts      # Camera setup, resize handling, scroll parallax
│
├── multiplayer/
│   ├── presenceStream.ts        # Durable Stream connection (read + write)
│   └── cursorPrisms.ts          # Render remote visitors as mini-prisms
│
├── physics/
│   └── snellRefraction.ts       # Snell's law + chromatic dispersion calculations
│
└── utils/
    ├── capabilities.ts          # WebGPU/WebGL/fallback detection
    ├── svgToShape.ts            # SVG path `d` attribute → THREE.Shape
    └── qualitySettings.ts       # Adaptive quality based on device
```

### Fallback Assets

```
website/public/img/home/
├── prism-fallback.webp          # Static render for <img> fallback
├── prism-fallback.mp4           # Looping video fallback (H.264)
└── prism-fallback.webm          # Looping video fallback (VP9)
```

---

## 13. Phased Delivery

### Phase 1 — Static Prism Scene (3 days)

- [ ] Three.js setup with WebGPU/WebGL detection and renderer creation
- [ ] SVG path parser (`svgToShape.ts`)
- [ ] Prism geometry extrusion from logo paths
- [ ] Crystal material with transmission, IOR, iridescence
- [ ] Static light beams (input + 8 refracted) with glow material
- [ ] Bloom post-processing
- [ ] Integration into homepage (replace hero image slot)
- [ ] Fallback image for unsupported browsers
- [ ] Responsive sizing and mobile layout

### Phase 2 — Interactivity (2 days)

- [ ] Cursor-driven beam angle (mouse position → beam entry point)
- [ ] Smooth interpolation for fluid beam movement
- [ ] Scroll parallax (subtle camera orbit)
- [ ] Mobile touch support
- [ ] `prefers-reduced-motion` support
- [ ] Particle systems (ambient stars, beam dust, prism interior)

### Phase 3 — Multiplayer Presence (3 days)

- [ ] Durable Stream proxy endpoint
- [ ] Presence protocol (send/receive cursor positions)
- [ ] Remote cursor → mini-prism rendering
- [ ] Mini-prism refraction interaction with beams
- [ ] Staleness handling and fade-out
- [ ] Active visitor count indicator
- [ ] Reconnection with exponential backoff
- [ ] Rate limiting and abuse prevention

### Phase 4 — Polish (2 days)

- [ ] Performance profiling and optimisation
- [ ] Mobile-specific quality presets
- [ ] Loading transition animation (fade from fallback to 3D)
- [ ] Generate fallback video asset (screen record of the scene)
- [ ] Idle state (reduce FPS after inactivity)
- [ ] Accessibility audit
- [ ] Cross-browser testing (Chrome, Firefox, Safari, Edge)

---

## 14. Open Questions

1. **Durable Stream hosting** — Where will the `/homepage/presence` stream
   live? Electric Cloud, self-hosted, or a dedicated instance? Needs a backend
   endpoint and the stream provisioned.

2. **Beam rendering detail** — Tube geometry with glow shaders (simpler, more
   controllable, lower GPU cost) vs. volumetric ray marching (more realistic,
   significantly more expensive). Recommendation: **tubes + particles** for the
   best quality/performance ratio.

3. **Hero layout scope** — Should the beams be confined to the image area, or
   should they extend across the full viewport width (input beam from left edge,
   output beams to right edge)? Full-width is more dramatic but harder to
   integrate with the text layout.

4. **Three.js version** — Pin to r172+ for stable TSL and WebGPU support.
   This is a new dependency for the website (`pnpm add three`).

5. **Multiplayer scope for v1** — Ship Phase 1+2 first (interactive but
   single-player) and add multiplayer as a fast follow? Or build it all
   together?

6. **Environment map** — Use a small HDR cubemap for prism reflections (adds
   ~100KB) or generate a procedural environment via TSL (zero download, less
   realistic)?

7. **Mobile interactivity** — Full touch-driven beam control, or simplified
   auto-animation on mobile (gentler on battery, simpler UX)?
