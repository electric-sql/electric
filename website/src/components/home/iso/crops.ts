/**
 * Named camera crops + per-section animation tweaks for the homepage
 * isometric world (v2).
 *
 * Four crops (`world`, `coordination-floor`, `substrate-cutaway`,
 * `mirrored-surfaces`), each with desktop and mobile variants. Each
 * comes paired with:
 *  - a `CropTweaks` multiplier set, dampening or amplifying the shared
 *    ambient animations to suit the crop's product narrative;
 *  - an optional pre-applied `filter` (vignettes only) that the
 *    legend would otherwise drive on the hero;
 *  - a `CropScripts` pair: the always-running `AMBIENT_SCRIPT` plus a
 *    crop-specific `focus` script that commandeers actors for a
 *    tightly-timed 4-beat narrative.
 */

import type {
  CameraCrop,
  CropAspect,
  CropName,
  CropScripts,
  CropTweaks,
} from './types'
import { AMBIENT_SCRIPT } from './scripts/ambient'
import { AGENTS_FOCUS_SCRIPT } from './scripts/agents-focus'
import { STREAMS_FOCUS_SCRIPT } from './scripts/streams-focus'
import { SYNC_FOCUS_SCRIPT } from './scripts/sync-focus'

export const CROPS: Record<CropName, Record<CropAspect, CameraCrop>> = {
  // ── 1) Hero: the whole campus ─────────────────────────────────────
  world: {
    desktop: {
      worldBounds: {
        minX: -2.0,
        maxX: 16.5,
        minY: -1.5,
        maxY: 9.5,
        minZ: -3.5,
        maxZ: 3.0,
      },
      fadeMargin: 0.5,
      highlightThreads: [], // empty = "all live" in the simulator
      aspect: `desktop`,
      filter: null,
    },
    mobile: {
      // Tighter on mobile — keep building + substrate, trim the
      // sidewalk band a bit.
      worldBounds: {
        minX: -1.5,
        maxX: 16.0,
        minY: -1.0,
        maxY: 9.0,
        minZ: -3.0,
        maxZ: 3.0,
      },
      fadeMargin: 0.4,
      highlightThreads: [],
      aspect: `mobile`,
      filter: null,
    },
  },

  // ── 2) Agents — coordination floor ────────────────────────────────
  // Coordination + workshop + a slice of reception. Filter: agents.
  'coordination-floor': {
    desktop: {
      worldBounds: {
        minX: 2.0,
        maxX: 12.0,
        minY: -0.5,
        maxY: 7.5,
        minZ: -0.5,
        maxZ: 2.6,
      },
      fadeMargin: 0.4,
      highlightThreads: [],
      aspect: `desktop`,
      filter: `agents`,
    },
    mobile: {
      worldBounds: {
        minX: 3.0,
        maxX: 11.0,
        minY: 0.0,
        maxY: 7.0,
        minZ: -0.4,
        maxZ: 2.5,
      },
      fadeMargin: 0.3,
      highlightThreads: [],
      aspect: `mobile`,
      filter: `agents`,
    },
  },

  // ── 3) Streams — substrate cutaway ───────────────────────────────
  // Lower z range only. Building is mostly out of frame at the top —
  // the eye lives down on the channels and risers.
  'substrate-cutaway': {
    desktop: {
      worldBounds: {
        minX: -2.0,
        maxX: 16.5,
        minY: 0.0,
        maxY: 8.0,
        minZ: -3.5,
        maxZ: 0.6,
      },
      fadeMargin: 0.4,
      highlightThreads: [],
      aspect: `desktop`,
      filter: `streams`,
    },
    mobile: {
      // Crop tighter horizontally; keep all four channels visible.
      worldBounds: {
        minX: -1.5,
        maxX: 16.0,
        minY: 1.0,
        maxY: 6.5,
        minZ: -3.5,
        maxZ: 0.4,
      },
      fadeMargin: 0.3,
      highlightThreads: [],
      aspect: `mobile`,
      filter: `streams`,
    },
  },

  // ── 4) Sync — mirrored surfaces ──────────────────────────────────
  // Tight focus on reception screens, coord board, review screen, and
  // planning wall — the four surfaces a thread fans out across.
  'mirrored-surfaces': {
    desktop: {
      worldBounds: {
        minX: 0.5,
        maxX: 13.0,
        minY: 0.0,
        maxY: 6.0,
        minZ: -0.4,
        maxZ: 2.6,
      },
      fadeMargin: 0.4,
      highlightThreads: [],
      aspect: `desktop`,
      filter: `sync`,
    },
    mobile: {
      worldBounds: {
        minX: 0.5,
        maxX: 13.0,
        minY: 0.5,
        maxY: 5.5,
        minZ: -0.2,
        maxZ: 2.5,
      },
      fadeMargin: 0.3,
      highlightThreads: [],
      aspect: `mobile`,
      filter: `sync`,
    },
  },
}

/** Per-crop animation tweaks (substrate flow / pulse / walk multipliers). */
export const TWEAKS: Record<CropName, CropTweaks> = {
  world: {
    substrateFlow: 1.0,
    mirroredPulse: 1.0,
    courierWalk: 1.0,
  },
  'coordination-floor': {
    substrateFlow: 0.5,
    mirroredPulse: 0.5,
    courierWalk: 1.6,
  },
  'substrate-cutaway': {
    substrateFlow: 1.6,
    mirroredPulse: 0.4,
    courierWalk: 0.6,
  },
  'mirrored-surfaces': {
    substrateFlow: 0.3,
    mirroredPulse: 1.8,
    courierWalk: 0.4,
    pulseCadenceMs: 3000,
  },
}

/** Composition of ambient + focus scripts per crop. */
export const SCRIPTS: Record<CropName, CropScripts> = {
  world: { ambient: AMBIENT_SCRIPT, focus: null },
  'coordination-floor': { ambient: AMBIENT_SCRIPT, focus: AGENTS_FOCUS_SCRIPT },
  'substrate-cutaway': { ambient: AMBIENT_SCRIPT, focus: STREAMS_FOCUS_SCRIPT },
  'mirrored-surfaces': { ambient: AMBIENT_SCRIPT, focus: SYNC_FOCUS_SCRIPT },
}

/** Convenience selector: pick the right CameraCrop variant for a width. */
export function pickCrop(name: CropName, isMobile: boolean): CameraCrop {
  return CROPS[name][isMobile ? `mobile` : `desktop`]
}
