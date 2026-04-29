/**
 * Single-floor `HOME_SCENE` (v3).
 *
 * Reorientation from v2's stacked office tower to a wide ground-level
 * "campus floor". The big idea: every collaborator (humans, couriers,
 * inspectors, analysts, sweepers, server racks, screens, boards) lives
 * on the same plate so the eye can follow handoffs, fan-outs, and
 * propagations as horizontal motion across one stage rather than
 * cross-section motion between cramped floors.
 *
 *   ┌──────── one building, one floor, outline walls ──────────┐
 *   │ reception │ coord    │ workshop │ planning │ comms │ arc │
 *   │ desks +   │ board +  │ desks +  │ wall +   │ racks │ shel│
 *   │ screens   │ table +  │ screens  │ rv-desk  │ +     │ ves │
 *   │           │ chairs   │          │          │ pipes │     │
 *   └───────────┴──────────┴──────────┴──────────┴───────┴─────┘
 *           sidewalk + pedestrians + lights + trees (front)
 *
 *   substrate underneath (3 channels at z=-1.5) ───────────────
 *
 * Surface and actor IDs from v2 are preserved so the threads,
 * ambient script, and focus scripts can keep referencing them with
 * minimal coordinate edits.
 *
 * Coordinate budget: world cube ≈ 16 × 8 × 5 (x × y × z),
 * z spans -3.5 (faint underground) → +2.4 (top of outline walls).
 */

import type { Scene } from './types'

export const HOME_SCENE: Scene = {
  buildings: [
    {
      id: `main`,
      origin: [0.5, 0.5, 0],
      // Wide & shallow: 15 × 7 × 2.4. One floor.
      size: [15, 7, 2.4],
      floors: [
        {
          height: 2.4,
          zones: [
            // ── 1. Reception / front-of-house ───────────────────────
            {
              id: `front-of-house`,
              label: `Reception`,
              origin: [0.2, 0.2, 0],
              size: [3.0, 6.6, 0],
              furniture: [
                { kind: `desk`, id: `fh-desk-1`, at: [0.6, 4.4, 0], facing: 0 },
                { kind: `desk`, id: `fh-desk-2`, at: [1.5, 4.4, 0], facing: 0 },
                { kind: `desk`, id: `fh-desk-3`, at: [2.4, 4.4, 0], facing: 0 },
                {
                  kind: `screen`,
                  id: `fh-screen-1`,
                  at: [0.6, 3.95, 0.45],
                  facing: 0,
                  surface: `fh-screen-1`,
                  w: 0.75,
                  h: 0.55,
                },
                {
                  kind: `screen`,
                  id: `fh-screen-2`,
                  at: [1.5, 3.95, 0.45],
                  facing: 0,
                  surface: `fh-screen-2`,
                  w: 0.75,
                  h: 0.55,
                },
                {
                  kind: `screen`,
                  id: `fh-screen-3`,
                  at: [2.4, 3.95, 0.45],
                  facing: 0,
                  surface: `fh-screen-3`,
                  w: 0.75,
                  h: 0.55,
                },
                {
                  kind: `person`,
                  id: `human-fh-1`,
                  at: [0.6, 4.85, 0],
                  facing: 0,
                  pose: `sit`,
                },
                {
                  kind: `person`,
                  id: `human-fh-2`,
                  at: [1.5, 4.85, 0],
                  facing: 0,
                  pose: `sit`,
                },
                {
                  kind: `person`,
                  id: `human-fh-3`,
                  at: [2.4, 4.85, 0],
                  facing: 0,
                  pose: `sit`,
                },
                {
                  kind: `door-arc`,
                  id: `fh-door`,
                  at: [1.5, 6.4, 0],
                  facing: 0,
                  radius: 0.7,
                },
              ],
            },

            // ── 2. Coordination / war-room ───────────────────────────
            {
              id: `coordination`,
              label: `Coordination`,
              origin: [3.4, 0.2, 0],
              size: [4.0, 6.6, 0],
              furniture: [
                // Big board on the back wall (y=0).
                {
                  kind: `board`,
                  id: `ops-board-1`,
                  at: [1.0, 0.6, 0],
                  facing: 0,
                  cols: 2,
                  cards: [
                    { surface: `ops-board-1-card-0`, row: 0, col: 0 },
                    { surface: `ops-board-1-card-1`, row: 1, col: 0 },
                    { surface: `ops-board-1-card-2`, row: 2, col: 0 },
                    { surface: `ops-board-1-card-3`, row: 3, col: 0 },
                    { surface: `ops-board-1-card-4`, row: 0, col: 1 },
                    { surface: `ops-board-1-card-5`, row: 1, col: 1 },
                    { surface: `ops-board-1-card-6`, row: 2, col: 1 },
                    { surface: `ops-board-1-card-7`, row: 3, col: 1 },
                  ],
                },
                {
                  kind: `board`,
                  id: `ops-board-2`,
                  at: [3.0, 0.6, 0],
                  facing: 0,
                  cards: [
                    { surface: `ops-board-2-card-0`, row: 0 },
                    { surface: `ops-board-2-card-1`, row: 1 },
                    { surface: `ops-board-2-card-2`, row: 2 },
                    { surface: `ops-board-2-card-3`, row: 3 },
                  ],
                },
                // Roundtable + chairs — middle of zone.
                {
                  kind: `table`,
                  id: `mt-table`,
                  at: [2.0, 3.5, 0],
                  size: [1.4, 1.4],
                },
                // Chairs nudged out from the 1.4×1.4 table (which spans
                // 1.3..2.7 × 2.8..4.2) so 0.35-wide chairs don't overlap.
                {
                  kind: `chair`,
                  id: `mt-chair-1`,
                  at: [2.0, 2.5, 0],
                  facing: 180,
                },
                {
                  kind: `chair`,
                  id: `mt-chair-2`,
                  at: [3.0, 3.5, 0],
                  facing: 270,
                },
                {
                  kind: `chair`,
                  id: `mt-chair-3`,
                  at: [2.0, 4.5, 0],
                  facing: 0,
                },
                {
                  kind: `chair`,
                  id: `mt-chair-4`,
                  at: [1.0, 3.5, 0],
                  facing: 90,
                },
                {
                  kind: `person`,
                  id: `human-meet-1`,
                  at: [2.0, 2.5, 0],
                  facing: 180,
                  pose: `sit`,
                },
                {
                  kind: `person`,
                  id: `human-meet-2`,
                  at: [2.0, 4.5, 0],
                  facing: 0,
                  pose: `sit`,
                },
                {
                  kind: `person`,
                  id: `human-meet-3`,
                  at: [1.0, 3.5, 0],
                  facing: 90,
                  pose: `sit`,
                },
                // Side screen on the right wall.
                {
                  kind: `screen`,
                  id: `mt-screen`,
                  at: [3.7, 3.5, 0.6],
                  facing: 270,
                  surface: `meeting-screen`,
                  w: 0.9,
                  h: 0.55,
                },
              ],
            },

            // ── 3. Workshop / fulfilment ─────────────────────────────
            {
              id: `workshop`,
              label: `Workshop`,
              origin: [7.6, 0.2, 0],
              size: [2.6, 6.6, 0],
              furniture: [
                // Two workbench/desks with screens.
                { kind: `desk`, id: `ff-desk`, at: [0.6, 2.4, 0], facing: 0 },
                {
                  kind: `screen`,
                  id: `ff-screen-1`,
                  at: [0.6, 1.95, 0.45],
                  facing: 0,
                  surface: `ff-screen-1`,
                  w: 0.7,
                  h: 0.5,
                },
                { kind: `desk`, id: `ff-desk-2`, at: [1.8, 2.4, 0], facing: 0 },
                {
                  kind: `screen`,
                  id: `ff-screen-2`,
                  at: [1.8, 1.95, 0.45],
                  facing: 0,
                  surface: `ff-screen-2`,
                  w: 0.7,
                  h: 0.5,
                },
                {
                  kind: `person`,
                  id: `human-ff-1`,
                  at: [0.6, 2.85, 0],
                  facing: 0,
                  pose: `sit`,
                },
                {
                  kind: `person`,
                  id: `human-ff-2`,
                  at: [1.8, 2.85, 0],
                  facing: 0,
                  pose: `sit`,
                },
                // Counter / workbench at front (y=4-5).
                {
                  kind: `counter`,
                  id: `ff-counter`,
                  at: [1.2, 4.3, 0],
                  size: [1.6, 0.5],
                },
                { kind: `cooler`, id: `ff-cooler`, at: [0.4, 5.4, 0] },
              ],
            },

            // ── 4. Planning + analysis ───────────────────────────────
            {
              id: `planning`,
              label: `Planning`,
              origin: [10.4, 0.2, 0],
              size: [2.5, 6.6, 0],
              furniture: [
                // Wall-grid display covers the whole back wall.
                {
                  kind: `wall-grid`,
                  id: `planning-wall`,
                  at: [1.25, 0.4, 0.2],
                  facing: 0,
                  w: 2.2,
                  h: 1.4,
                  cols: 6,
                  rows: 4,
                  addressable: [
                    { surface: `plan-cell-0`, row: 0, col: 0 },
                    { surface: `plan-cell-1`, row: 1, col: 1 },
                    { surface: `plan-cell-2`, row: 2, col: 2 },
                    { surface: `plan-cell-3`, row: 0, col: 3 },
                    { surface: `plan-cell-4`, row: 1, col: 4 },
                    { surface: `plan-cell-5`, row: 3, col: 5 },
                  ],
                },
                // Review desk + screen in front of the wall.
                { kind: `desk`, id: `rv-desk`, at: [1.25, 3.4, 0], facing: 0 },
                {
                  kind: `screen`,
                  id: `rv-screen`,
                  at: [1.25, 2.95, 0.45],
                  facing: 0,
                  surface: `rv-screen`,
                  w: 1.0,
                  h: 0.6,
                },
                {
                  kind: `person`,
                  id: `human-plan-1`,
                  at: [0.7, 1.85, 0],
                  facing: 180,
                  pose: `stand`,
                },
                {
                  kind: `person`,
                  id: `human-plan-2`,
                  at: [1.8, 1.85, 0],
                  facing: 180,
                  pose: `stand`,
                },
                {
                  kind: `person`,
                  id: `human-rev-1`,
                  at: [1.25, 3.85, 0],
                  facing: 0,
                  pose: `sit`,
                },
              ],
            },

            // ── 5. Comms room (server racks visible) ─────────────────
            {
              id: `comms-room`,
              label: `Comms room`,
              origin: [13.1, 0.2, 0],
              size: [1.7, 3.5, 0],
              furniture: [
                // Server racks rendered as tall counters.
                {
                  kind: `counter`,
                  id: `rack-1`,
                  at: [0.4, 0.6, 0],
                  size: [0.45, 0.55],
                },
                {
                  kind: `counter`,
                  id: `rack-2`,
                  at: [0.4, 1.4, 0],
                  size: [0.45, 0.55],
                },
                {
                  kind: `counter`,
                  id: `rack-3`,
                  at: [0.4, 2.2, 0],
                  size: [0.45, 0.55],
                },
                {
                  kind: `counter`,
                  id: `rack-4`,
                  at: [1.2, 0.6, 0],
                  size: [0.45, 0.55],
                },
                {
                  kind: `counter`,
                  id: `rack-5`,
                  at: [1.2, 1.4, 0],
                  size: [0.45, 0.55],
                },
                {
                  kind: `counter`,
                  id: `rack-6`,
                  at: [1.2, 2.2, 0],
                  size: [0.45, 0.55],
                },
                {
                  kind: `screen`,
                  id: `disp-screen`,
                  at: [0.85, 3.1, 0.6],
                  facing: 0,
                  surface: `dispatch-screen`,
                  w: 0.7,
                  h: 0.45,
                },
                {
                  kind: `person`,
                  id: `human-disp-1`,
                  at: [0.85, 3.3, 0],
                  facing: 0,
                  pose: `stand`,
                },
              ],
            },

            // ── 6. Archives ──────────────────────────────────────────
            {
              id: `archives`,
              label: `Archives`,
              origin: [13.1, 3.9, 0],
              size: [1.7, 2.9, 0],
              furniture: [
                {
                  kind: `counter`,
                  id: `shelf-1`,
                  at: [0.4, 0.5, 0],
                  size: [0.45, 0.4],
                },
                {
                  kind: `counter`,
                  id: `shelf-2`,
                  at: [0.4, 1.2, 0],
                  size: [0.45, 0.4],
                },
                {
                  kind: `counter`,
                  id: `shelf-3`,
                  at: [0.4, 1.9, 0],
                  size: [0.45, 0.4],
                },
                {
                  kind: `counter`,
                  id: `shelf-4`,
                  at: [1.2, 0.5, 0],
                  size: [0.45, 0.4],
                },
                {
                  kind: `counter`,
                  id: `shelf-5`,
                  at: [1.2, 1.2, 0],
                  size: [0.45, 0.4],
                },
                {
                  kind: `counter`,
                  id: `shelf-6`,
                  at: [1.2, 1.9, 0],
                  size: [0.45, 0.4],
                },
              ],
            },
          ],
        },
      ],
    },
  ],

  // No skybridge — single building, single floor.
  skybridges: [],

  // ── Outdoor strip in front (south of building, y > 7.0) ───────────
  sidewalk: {
    origin: [-1.5, 7.6, 0],
    size: [18, 1.5],
  },
  outdoor: [
    { kind: `streetlight`, at: [1.5, 8.4, 0] },
    { kind: `streetlight`, at: [7.5, 8.4, 0] },
    { kind: `streetlight`, at: [13.0, 8.4, 0] },
    { kind: `tree`, at: [4.5, 8.4, 0] },
    { kind: `tree`, at: [10.5, 8.4, 0] },
    { kind: `tree`, at: [15.5, 8.4, 0] },
    { kind: `bench`, at: [6.0, 8.6, 0], facing: 0 },
    { kind: `bench`, at: [12.0, 8.6, 0], facing: 0 },
  ],
  pedestrians: [
    {
      id: `pedestrian-1`,
      loop: [
        [-1.5, 8.0, 0],
        [16.0, 8.0, 0],
        [-1.5, 8.0, 0],
      ],
      loopMs: 38_000,
      phase: 0,
    },
    {
      id: `pedestrian-2`,
      loop: [
        [16.0, 8.4, 0],
        [-1.5, 8.4, 0],
        [16.0, 8.4, 0],
      ],
      loopMs: 44_000,
      phase: 0.42,
    },
    {
      id: `pedestrian-3`,
      loop: [
        [3.0, 8.2, 0],
        [13.0, 8.2, 0],
        [3.0, 8.2, 0],
      ],
      loopMs: 28_000,
      phase: 0.18,
    },
    {
      id: `customer-1`,
      // Approach front door, "enter", then re-spawn at the left after
      // the loop wraps. Door is at (2.0, 6.6) → walks up into reception.
      loop: [
        [-0.5, 8.2, 0],
        [2.0, 8.2, 0],
        [2.0, 7.0, 0],
        [2.0, 5.0, 0],
        [-0.5, 8.2, 0],
      ],
      loopMs: 22_000,
      phase: 0.6,
    },
  ],

  // ── Substrate ─────────────────────────────────────────────────────
  // Three channels at z=-1.5 running roughly under the building. Risers
  // are SHORT (≤ 1.0 unit) since surfaces are all at floor level now.
  substrate: {
    channels: [
      {
        // Main bus along the front of the building (y=5.5 underground).
        id: `channel-a`,
        substrate: `streams`,
        path: [
          [-1.5, 5.5, -1.5],
          [3.0, 5.5, -1.5],
          [6.0, 5.5, -1.5],
          [9.5, 5.5, -1.5],
          [12.5, 5.5, -1.5],
          [16.5, 5.5, -1.5],
        ],
        portalLeft: true,
        portalRight: true,
        durable: [
          { threadId: `fulfilment-9c2b`, position: 0.18 },
          { threadId: `escalation-1f6a`, position: 0.36 },
          { threadId: `fulfilment-9c2b`, position: 0.55 },
          { threadId: `enrich-ab3`, position: 0.72 },
          { threadId: `fulfilment-9c2b`, position: 0.88 },
        ],
      },
      {
        // Back bus (y=1.5) — feeds the boards and planning wall.
        id: `channel-b`,
        substrate: `streams`,
        path: [
          [-1.5, 1.5, -1.9],
          [4.5, 1.5, -1.9],
          [8.5, 1.5, -1.9],
          [12.0, 1.5, -1.9],
          [16.5, 1.5, -1.9],
        ],
        portalLeft: true,
        portalRight: true,
        durable: [
          { threadId: `notify-5d8`, position: 0.22 },
          { threadId: `audit-7e1`, position: 0.42 },
          { threadId: `notify-5d8`, position: 0.66 },
          { threadId: `meeting-4f8`, position: 0.84 },
        ],
      },
      {
        // Branch connecting the two buses → comms room.
        id: `channel-c`,
        substrate: `streams`,
        path: [
          [13.5, 1.5, -1.9],
          [13.5, 3.5, -1.7],
          [13.5, 5.5, -1.5],
        ],
        durable: [
          { threadId: `dispatch-2c4`, position: 0.4 },
          { threadId: `dispatch-2c4`, position: 0.8 },
        ],
      },
      {
        // Deep feedback loop — exits left, re-enters right, runs across.
        id: `channel-d`,
        substrate: `streams`,
        path: [
          [-1.5, 3.5, -2.3],
          [4.5, 3.5, -2.3],
          [9.5, 3.5, -2.3],
          [16.5, 3.5, -2.3],
        ],
        portalLeft: true,
        portalRight: true,
        durable: [
          { threadId: `health-bg`, position: 0.15 },
          { threadId: `health-bg`, position: 0.45 },
          { threadId: `health-bg`, position: 0.75 },
        ],
      },
    ],
    junctions: [
      { id: `junction-1`, at: [4.5, 5.5, -1.5], channels: [`channel-a`] },
      { id: `junction-2`, at: [9.5, 5.5, -1.5], channels: [`channel-a`] },
      {
        id: `junction-3`,
        at: [13.5, 1.5, -1.9],
        channels: [`channel-b`, `channel-c`],
      },
      {
        id: `junction-4`,
        at: [13.5, 5.5, -1.5],
        channels: [`channel-a`, `channel-c`],
      },
      { id: `junction-5`, at: [4.5, 1.5, -1.9], channels: [`channel-b`] },
    ],
    risers: [
      // channel-a → reception screens (short risers, ~1.5 units tall).
      {
        id: `riser-1`,
        channelId: `channel-a`,
        channelT: 0.15,
        surface: `fh-screen-1`,
        topZ: 0.45,
      },
      {
        id: `riser-2`,
        channelId: `channel-a`,
        channelT: 0.18,
        surface: `fh-screen-2`,
        topZ: 0.45,
      },
      // channel-a → workshop screen.
      {
        id: `riser-3`,
        channelId: `channel-a`,
        channelT: 0.55,
        surface: `ff-screen-1`,
        topZ: 0.45,
      },
      // channel-b → coordination board.
      {
        id: `riser-4`,
        channelId: `channel-b`,
        channelT: 0.32,
        surface: `ops-board-1-card-0`,
        topZ: 0.9,
      },
      // channel-b → planning wall.
      {
        id: `riser-5`,
        channelId: `channel-b`,
        channelT: 0.68,
        surface: `plan-cell-2`,
        topZ: 1.4,
      },
      // channel-c → dispatch screen in comms room.
      {
        id: `riser-6`,
        channelId: `channel-c`,
        channelT: 0.95,
        surface: `dispatch-screen`,
        topZ: 0.6,
      },
      // channel-a → meeting screen in coordination.
      {
        id: `riser-7`,
        channelId: `channel-a`,
        channelT: 0.42,
        surface: `meeting-screen`,
        topZ: 0.85,
      },
    ],
    // A few faint underground server-rack silhouettes for depth.
    underground: [
      { at: [1.0, 3.0, -3.5], size: [0.8, 0.5, 0.6] },
      { at: [4.5, 7.0, -3.5], size: [0.8, 0.5, 0.6] },
      { at: [8.0, 3.0, -3.5], size: [0.8, 0.5, 0.6] },
      { at: [11.5, 7.0, -3.5], size: [0.8, 0.5, 0.6] },
      { at: [15.0, 3.0, -3.5], size: [0.8, 0.5, 0.6] },
    ],
  },

  // ── Actors — all at floor level (z=0) now ────────────────────────
  actors: [
    {
      id: `courier-1`,
      kind: `courier`,
      substrate: `agents`,
      position: [4.5, 5.5, 0],
      homeLoop: [
        [4.5, 5.5, 0],
        [4.5, 4.5, 0],
        [4.5, 5.5, 0],
      ],
    },
    {
      id: `courier-2`,
      kind: `courier`,
      substrate: `agents`,
      position: [9.0, 5.5, 0],
      homeLoop: [
        [9.0, 5.5, 0],
        [10.5, 5.5, 0],
        [9.0, 5.5, 0],
      ],
    },
    {
      id: `courier-3`,
      kind: `courier`,
      substrate: `agents`,
      position: [13.5, 5.5, 0],
      homeLoop: [
        [13.5, 5.5, 0],
        [12.0, 5.5, 0],
        [13.5, 5.5, 0],
      ],
    },
    {
      id: `inspector-1`,
      kind: `inspector`,
      substrate: `agents`,
      position: [4.4, 1.5, 0],
    },
    {
      id: `inspector-2`,
      kind: `inspector`,
      substrate: `agents`,
      position: [6.4, 1.5, 0],
    },
    {
      id: `analyst-1`,
      kind: `analyst`,
      substrate: `agents`,
      position: [11.4, 2.5, 0],
    },
    {
      id: `analyst-2`,
      kind: `analyst`,
      substrate: `agents`,
      position: [12.4, 2.5, 0],
    },
    {
      id: `sweeper-1`,
      kind: `sweeper`,
      substrate: `agents`,
      position: [13.95, 5.0, 0],
      homeLoop: [
        [13.95, 4.5, 0],
        [13.95, 6.5, 0],
        [13.95, 4.5, 0],
      ],
    },
    {
      id: `maintenance-1`,
      kind: `analyst`,
      substrate: `agents`,
      position: [13.95, 1.4, 0],
      homeLoop: [
        [13.95, 0.8, 0],
        [13.95, 2.6, 0],
        [13.95, 0.8, 0],
      ],
    },
  ],

  // ── Threads — same 8 as v2, all surface IDs preserved ────────────
  threads: [
    {
      id: `escalation-1f6a`,
      manifestations: [`fh-screen-1`, `ops-board-1-card-0`, `rv-screen`],
      hue: 0,
      dominant: `sync`,
      cadenceMs: 5_000,
    },
    {
      id: `fulfilment-9c2b`,
      manifestations: [`ops-board-1-card-1`, `rv-screen`, `ff-screen-1`],
      hue: 30,
      dominant: `streams`,
      cadenceMs: 7_000,
    },
    {
      id: `enrich-ab3`,
      manifestations: [`plan-cell-1`, `rv-screen`],
      hue: 60,
      dominant: `agents`,
      cadenceMs: 11_000,
    },
    {
      id: `notify-5d8`,
      manifestations: [`fh-screen-3`, `dispatch-screen`],
      hue: 90,
      dominant: `streams`,
      cadenceMs: 3_000,
    },
    {
      id: `audit-7e1`,
      manifestations: [
        `fh-screen-2`,
        `rv-screen`,
        `meeting-screen`,
        `plan-cell-3`,
      ],
      hue: 120,
      dominant: `sync`,
      cadenceMs: 13_000,
    },
    {
      id: `dispatch-2c4`,
      manifestations: [`dispatch-screen`, `ff-screen-2`],
      hue: 150,
      dominant: `agents`,
      cadenceMs: 19_000,
    },
    {
      id: `meeting-4f8`,
      manifestations: [`meeting-screen`, `plan-cell-5`],
      hue: 200,
      dominant: `sync`,
      cadenceMs: 17_000,
    },
    {
      id: `health-bg`,
      manifestations: [`plan-cell-0`, `plan-cell-4`],
      hue: 240,
      dominant: `streams`,
      cadenceMs: 2_000,
    },
  ],
}
