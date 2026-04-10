import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import * as fc from 'fast-check'

import { canonicalShapeKey, ShapeStream } from '../src/client'
import type { ShapeStreamInterface, LogMode } from '../src/client'
import { isVisibleInSnapshot } from '../src/helpers'
import { SnapshotTracker } from '../src/snapshot-tracker'
import { UpToDateTracker } from '../src/up-to-date-tracker'
import { Shape } from '../src/shape'
import {
  snakeToCamel,
  camelToSnake,
  snakeCamelMapper,
} from '../src/column-mapper'
import { FetchError } from '../src/error'
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '../src/constants'
import type {
  ChangeMessage,
  Message,
  Offset,
  Row,
  SnapshotMetadata,
} from '../src/types'

// Soak-style defaults. Override with env vars for focused hunts.
const NUM_RUNS = Number(process.env.PBT_MICRO_RUNS ?? `500`)
const SEED = process.env.PBT_MICRO_SEED
  ? Number(process.env.PBT_MICRO_SEED)
  : undefined
const PATH = process.env.PBT_MICRO_PATH

const pbtOpts: fc.Parameters<unknown> = {
  numRuns: NUM_RUNS,
  ...(SEED !== undefined ? { seed: SEED } : {}),
  ...(PATH ? { path: PATH } : {}),
  verbose: 2,
}

// ═══════════════════════════════════════════════════════════════════
// TARGET 1: canonicalShapeKey
// ═══════════════════════════════════════════════════════════════════
//
// Hypothesis: non-protocol params with multiple values (duplicate keys)
// silently lose all but the last value because canonicalShapeKey calls
// cleanUrl.searchParams.set() in a loop — .set() replaces rather than
// .append()-ing.
//
// A shape key is used to look up expired handles / cached responses.
// If two shapes with `?table=a&table=b` and `?table=c&table=b` both
// canonicalize to `?table=b`, the client could confuse them.

describe(`canonicalShapeKey PBT`, () => {
  it(`deterministic: duplicate non-protocol param keys preserve ALL values`, () => {
    const input = new URL(`http://e.com/v1/shape?table=foo&table=bar`)
    const key = canonicalShapeKey(input)
    const out = new URL(key)
    expect(out.searchParams.getAll(`table`)).toEqual([`foo`, `bar`])
  })

  it(`PBT: every non-protocol (key, value) pair in input is preserved in canonical output`, () => {
    const nonProtocolKey = fc
      .string({ minLength: 1, maxLength: 8 })
      .filter(
        (s) =>
          /^[a-z_][a-z0-9_]*$/.test(s) &&
          !ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(s)
      )

    const paramEntry = fc.tuple(
      nonProtocolKey,
      fc
        .string({ minLength: 0, maxLength: 8 })
        .filter((v) => /^[a-z0-9]*$/.test(v))
    )

    fc.assert(
      fc.property(
        fc.array(paramEntry, { minLength: 1, maxLength: 6 }),
        (entries) => {
          const url = new URL(`http://e.com/v1/shape`)
          for (const [k, v] of entries) url.searchParams.append(k, v)

          const canonical = new URL(canonicalShapeKey(url))

          // Every (k, v) tuple from input must be present in output — including duplicates.
          const inCounts = new Map<string, string[]>()
          for (const [k, v] of entries) {
            const list = inCounts.get(k) ?? []
            list.push(v)
            inCounts.set(k, list)
          }
          for (const [k, vs] of inCounts) {
            const outVs = canonical.searchParams.getAll(k).slice().sort()
            const expected = vs.slice().sort()
            expect(outVs, `key "${k}" values mismatch`).toEqual(expected)
          }
          return true
        }
      ),
      pbtOpts
    )
  })

  it(`PBT: adding/removing protocol params never changes the canonical key`, () => {
    const protocolParam = fc.constantFrom(...ELECTRIC_PROTOCOL_QUERY_PARAMS)
    const value = fc
      .string({ minLength: 0, maxLength: 8 })
      .filter((v) => /^[a-z0-9]*$/.test(v))

    fc.assert(
      fc.property(
        fc.array(fc.tuple(protocolParam, value), {
          minLength: 0,
          maxLength: 5,
        }),
        fc.array(fc.tuple(protocolParam, value), {
          minLength: 0,
          maxLength: 5,
        }),
        (protoA, protoB) => {
          const a = new URL(`http://e.com/v1/shape?table=foo`)
          for (const [k, v] of protoA) a.searchParams.append(k, v)
          const b = new URL(`http://e.com/v1/shape?table=foo`)
          for (const [k, v] of protoB) b.searchParams.append(k, v)
          expect(canonicalShapeKey(a)).toEqual(canonicalShapeKey(b))
          return true
        }
      ),
      pbtOpts
    )
  })

  it(`PBT: canonicalShapeKey is idempotent`, () => {
    fc.assert(
      fc.property(
        fc
          .webUrl({ withQueryParameters: true })
          .filter((u) => u.startsWith(`http`)),
        (urlStr) => {
          const url = new URL(urlStr)
          const once = canonicalShapeKey(url)
          const twice = canonicalShapeKey(new URL(once))
          expect(twice).toEqual(once)
          return true
        }
      ),
      pbtOpts
    )
  })
})

// ═══════════════════════════════════════════════════════════════════
// TARGET 2: isVisibleInSnapshot
// ═══════════════════════════════════════════════════════════════════
//
// MVCC visibility predicate:
//   xid < xmin                              → visible
//   xid >= xmax                             → not visible
//   xmin <= xid < xmax AND xid in xip_list  → not visible
//   xmin <= xid < xmax AND xid not in xip   → visible
//
// Let PBT explore boundary conditions and number/bigint/string input
// equivalence. Historically Postgres xids are uint64 — anything above
// Number.MAX_SAFE_INTEGER must round-trip correctly through all three
// accepted input types.

describe(`isVisibleInSnapshot PBT`, () => {
  // Keep xids below 2^53 for the number path; use bigint for larger.
  const smallXid = fc.bigInt({
    min: BigInt(0),
    max: BigInt(`9000000000000000`),
  })

  const snapshotArb = fc
    .tuple(smallXid, smallXid, fc.array(smallXid, { maxLength: 8 }))
    .map(([a, b, xip]) => {
      const xmin = a < b ? a : b
      const xmax = a < b ? b : a
      return {
        xmin: `${xmin}` as `${bigint}`,
        xmax: `${xmax}` as `${bigint}`,
        xip_list: xip.map((x) => `${x}` as `${bigint}`),
      }
    })

  it(`PBT: xid < xmin always visible regardless of xip contents`, () => {
    fc.assert(
      fc.property(snapshotArb, (snap) => {
        const xminBig = BigInt(snap.xmin)
        if (xminBig === BigInt(0)) return true // no xid below 0
        const below = xminBig - BigInt(1)
        return isVisibleInSnapshot(below, snap) === true
      }),
      pbtOpts
    )
  })

  it(`PBT: xid >= xmax always NOT visible`, () => {
    fc.assert(
      fc.property(snapshotArb, smallXid, (snap, extra) => {
        const xmaxBig = BigInt(snap.xmax)
        const at = xmaxBig + extra
        return isVisibleInSnapshot(at, snap) === false
      }),
      pbtOpts
    )
  })

  it(`PBT: xid in xip_list is never visible (even inside [xmin, xmax))`, () => {
    fc.assert(
      fc.property(
        snapshotArb.filter((s) => s.xip_list.length > 0),
        (snap) => {
          for (const xip of snap.xip_list) {
            const x = BigInt(xip)
            const xmin = BigInt(snap.xmin)
            const xmax = BigInt(snap.xmax)
            // Only check xips that are actually inside the window;
            // Postgres guarantees xmin <= xip <= xmax but the arbitrary
            // generator might produce xips outside the window.
            if (x >= xmin && x < xmax) {
              expect(isVisibleInSnapshot(x, snap)).toBe(false)
            }
          }
          return true
        }
      ),
      pbtOpts
    )
  })

  it(`PBT: number/bigint/string equivalence for the same xid`, () => {
    fc.assert(
      fc.property(
        snapshotArb,
        fc.bigInt({ min: BigInt(0), max: BigInt(`9000000000000000`) }),
        (snap, x) => {
          // All three input types must yield the same visibility result.
          const asBig = isVisibleInSnapshot(x, snap)
          const asStr = isVisibleInSnapshot(`${x}` as `${bigint}`, snap)
          if (x <= BigInt(Number.MAX_SAFE_INTEGER)) {
            const asNum = isVisibleInSnapshot(Number(x), snap)
            expect(asNum).toEqual(asBig)
          }
          expect(asStr).toEqual(asBig)
          return true
        }
      ),
      pbtOpts
    )
  })
})

// ═══════════════════════════════════════════════════════════════════
// TARGET 3: SnapshotTracker (stateful / model-based)
// ═══════════════════════════════════════════════════════════════════
//
// SnapshotTracker keeps two reverse indexes (`xmaxSnapshots`,
// `snapshotsByDatabaseLsn`) that are *populated* on addSnapshot but
// *never cleaned up* on removeSnapshot. Any sequence that:
//   1. add a snapshot
//   2. remove it (or let shouldRejectMessage evict it)
//   3. add a different snapshot that happens to reuse the same xmax
//      or database_lsn as #1
// leaves stale entries in the reverse index. Later eviction loops
// then mutate the reverse index unexpectedly, potentially causing the
// wrong snapshot to be removed.
//
// We run commands against the real tracker AND a simple oracle model,
// and check that shouldRejectMessage agrees at every step.

describe(`SnapshotTracker stateful PBT`, () => {
  type ModelSnap = {
    mark: number
    xmin: bigint
    xmax: bigint
    xip: bigint[]
    keys: Set<string>
    dbLsn: bigint
  }

  class OracleModel {
    snapshots = new Map<number, ModelSnap>()

    add(s: ModelSnap) {
      this.snapshots.set(s.mark, s)
    }
    remove(mark: number) {
      this.snapshots.delete(mark)
    }
    lastSeenUpdate(lsn: bigint) {
      for (const [mark, s] of this.snapshots) {
        if (s.dbLsn <= lsn) this.snapshots.delete(mark)
      }
    }
    shouldReject(msg: ChangeMessage<Row<unknown>>): boolean {
      const txids = msg.headers.txids || []
      if (txids.length === 0) return false
      const xid = BigInt(Math.max(...txids))
      // Evict any snapshot whose xmax <= xid — matches real tracker behavior.
      for (const [mark, s] of this.snapshots) {
        if (xid >= s.xmax) this.snapshots.delete(mark)
      }
      for (const s of this.snapshots.values()) {
        if (!s.keys.has(msg.key)) continue
        if (xid < s.xmin) return true
        if (xid < s.xmax && !s.xip.includes(xid)) return true
      }
      return false
    }
  }

  // Shared key universe so overlaps are possible.
  const keyArb = fc.constantFrom(`k1`, `k2`, `k3`)

  const bi = (n: number) => BigInt(n)
  const addCmdArb = fc
    .record({
      mark: fc.integer({ min: 1, max: 6 }), // small range → collisions possible
      xmin: fc.bigInt({ min: bi(1), max: bi(50) }),
      xmaxDelta: fc.bigInt({ min: bi(1), max: bi(50) }),
      xip: fc.array(fc.bigInt({ min: bi(1), max: bi(100) }), { maxLength: 3 }),
      keys: fc.array(keyArb, { minLength: 1, maxLength: 3 }),
      dbLsn: fc.bigInt({ min: bi(1), max: bi(20) }),
    })
    .map((r) => ({
      kind: `add` as const,
      mark: r.mark,
      xmin: r.xmin,
      xmax: r.xmin + r.xmaxDelta,
      xip: r.xip,
      keys: new Set(r.keys),
      dbLsn: r.dbLsn,
    }))

  const removeCmdArb = fc
    .integer({ min: 1, max: 6 })
    .map((mark) => ({ kind: `remove` as const, mark }))

  const lastSeenCmdArb = fc
    .bigInt({ min: bi(0), max: bi(25) })
    .map((lsn) => ({ kind: `lastSeen` as const, lsn }))

  const rejectCmdArb = fc
    .record({
      key: keyArb,
      txid: fc.integer({ min: 1, max: 100 }),
    })
    .map((r) => ({ kind: `reject` as const, ...r }))

  const cmdArb = fc.oneof(addCmdArb, removeCmdArb, lastSeenCmdArb, rejectCmdArb)

  it(`PBT: oracle and SnapshotTracker agree across arbitrary command sequences`, () => {
    fc.assert(
      fc.property(fc.array(cmdArb, { minLength: 1, maxLength: 40 }), (cmds) => {
        const real = new SnapshotTracker()
        const oracle = new OracleModel()

        for (const cmd of cmds) {
          switch (cmd.kind) {
            case `add`: {
              const meta: SnapshotMetadata = {
                snapshot_mark: cmd.mark,
                xmin: `${cmd.xmin}` as `${bigint}`,
                xmax: `${cmd.xmax}` as `${bigint}`,
                xip_list: cmd.xip.map((x) => `${x}` as `${bigint}`),
                database_lsn: `${cmd.dbLsn}`,
              }
              real.addSnapshot(meta, cmd.keys)
              oracle.add({
                mark: cmd.mark,
                xmin: cmd.xmin,
                xmax: cmd.xmax,
                xip: cmd.xip,
                keys: cmd.keys,
                dbLsn: cmd.dbLsn,
              })
              break
            }
            case `remove`: {
              real.removeSnapshot(cmd.mark)
              oracle.remove(cmd.mark)
              break
            }
            case `lastSeen`: {
              real.lastSeenUpdate(cmd.lsn)
              oracle.lastSeenUpdate(cmd.lsn)
              break
            }
            case `reject`: {
              const msg: ChangeMessage<Row<unknown>> = {
                key: cmd.key,
                value: { id: 1 },
                headers: { operation: `insert`, txids: [cmd.txid] },
              }
              const realResult = real.shouldRejectMessage(msg)
              const oracleResult = oracle.shouldReject(msg)
              expect(
                realResult,
                `divergence at ${JSON.stringify(cmd)}`
              ).toEqual(oracleResult)
              break
            }
          }
        }
        return true
      }),
      pbtOpts
    )
  })
})

// ═══════════════════════════════════════════════════════════════════
// TARGET 4: UpToDateTracker (stateful / model-based with fake timers)
// ═══════════════════════════════════════════════════════════════════
//
// UpToDateTracker has interesting invariants:
//   - recordUpToDate followed by shouldEnterReplayMode within 60s
//     must return the recorded cursor
//   - after 60s, shouldEnterReplayMode must return null
//   - LRU: after recording > maxEntries (250) distinct keys, the
//     oldest-by-timestamp entry must be evicted
//   - clear() empties everything
//
// Commands: record, check, delete, clear, advanceTime.
// Use vi.useFakeTimers() so the PBT can drive Date.now() deterministically.

describe(`UpToDateTracker stateful PBT`, () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(`2026-01-01T00:00:00Z`))
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  type ModelEntry = { cursor: string; recordedAt: number }

  class OracleModel {
    data = new Map<string, ModelEntry>()
    maxEntries = 250
    ttl = 60_000

    record(key: string, cursor: string, now: number) {
      this.data.set(key, { cursor, recordedAt: now })
      if (this.data.size > this.maxEntries) {
        // Evict the entry with the smallest recordedAt
        let oldestKey: string | null = null
        let oldestTs = Infinity
        for (const [k, v] of this.data) {
          if (v.recordedAt < oldestTs) {
            oldestTs = v.recordedAt
            oldestKey = k
          }
        }
        if (oldestKey !== null) this.data.delete(oldestKey)
      }
    }
    check(key: string, now: number): string | null {
      const entry = this.data.get(key)
      if (!entry) return null
      if (now - entry.recordedAt >= this.ttl) return null
      return entry.cursor
    }
    delete(key: string) {
      this.data.delete(key)
    }
    clear() {
      this.data.clear()
    }
  }

  const keyArb = fc.constantFrom(`shape-a`, `shape-b`, `shape-c`, `shape-d`)
  const cursorArb = fc.string({ minLength: 1, maxLength: 4 })

  const recordCmd = fc
    .tuple(keyArb, cursorArb)
    .map(([key, cursor]) => ({ kind: `record` as const, key, cursor }))
  const checkCmd = keyArb.map((key) => ({ kind: `check` as const, key }))
  const deleteCmd = keyArb.map((key) => ({ kind: `delete` as const, key }))
  const clearCmd = fc.constant({ kind: `clear` as const })
  const advanceCmd = fc
    .integer({ min: 0, max: 120_000 })
    .map((ms) => ({ kind: `advance` as const, ms }))

  const cmdArb = fc.oneof(
    recordCmd,
    recordCmd,
    checkCmd,
    checkCmd,
    deleteCmd,
    clearCmd,
    advanceCmd,
    advanceCmd
  )

  it(`PBT: oracle and UpToDateTracker agree across arbitrary command sequences`, () => {
    fc.assert(
      fc.property(fc.array(cmdArb, { minLength: 1, maxLength: 40 }), (cmds) => {
        localStorage.clear()
        vi.setSystemTime(new Date(`2026-01-01T00:00:00Z`))
        const real = new UpToDateTracker()
        const oracle = new OracleModel()

        for (const cmd of cmds) {
          const now = Date.now()
          switch (cmd.kind) {
            case `record`: {
              real.recordUpToDate(cmd.key, cmd.cursor)
              oracle.record(cmd.key, cmd.cursor, now)
              break
            }
            case `check`: {
              const realResult = real.shouldEnterReplayMode(cmd.key)
              const oracleResult = oracle.check(cmd.key, now)
              expect(
                realResult,
                `divergence on check("${cmd.key}") at t=${now}`
              ).toEqual(oracleResult)
              break
            }
            case `delete`: {
              real.delete(cmd.key)
              oracle.delete(cmd.key)
              break
            }
            case `clear`: {
              real.clear()
              oracle.clear()
              break
            }
            case `advance`: {
              vi.advanceTimersByTime(cmd.ms)
              break
            }
          }
        }
        return true
      }),
      pbtOpts
    )
  })
})

// ═══════════════════════════════════════════════════════════════════
// TARGET 5: Shape notification clobber on must-refetch
// ═══════════════════════════════════════════════════════════════════
//
// Shape#process uses ASSIGNMENT (not OR) for `shouldNotify` and
// `#updateShapeStatus` returns true only for the transition TO
// `up-to-date`. Consequences:
//
//   1. A bare [must-refetch] batch delivered while the Shape is in
//      `up-to-date` clears #data and #insertedKeys but does NOT
//      notify subscribers. Reachable via client.ts:927 (409 handler
//      publishes [{ control: must-refetch }] directly).
//
//   2. A batch like [up-to-date, change, ...] notifies for up-to-date
//      and then the subsequent change clobbers shouldNotify back to
//      false. Hard to reach in practice (server puts up-to-date at
//      the tail) but the code path is wrong.

describe(`Shape#process notification PBT`, () => {
  type RowT = Row<unknown>

  class MockStream implements ShapeStreamInterface<RowT> {
    isUpToDate = false
    lastOffset: Offset = `-1`
    shapeHandle: string | undefined = undefined
    error: unknown = undefined
    mode: LogMode = `full`

    #subs = new Set<(msgs: Message<RowT>[]) => void>()

    subscribe(
      callback: (
        msgs: Message<RowT>[]
      ) => unknown | { columns?: (keyof RowT)[] }
    ): () => void {
      const fn = callback as (m: Message<RowT>[]) => void
      this.#subs.add(fn)
      return () => this.#subs.delete(fn)
    }
    unsubscribeAll() {
      this.#subs.clear()
    }
    publish(batch: Message<RowT>[]) {
      for (const cb of this.#subs) cb(batch)
    }
    isLoading() {
      return false
    }
    lastSyncedAt() {
      return 0
    }
    lastSynced() {
      return 0
    }
    isConnected() {
      return true
    }
    hasStarted() {
      return true
    }
    async forceDisconnectAndRefresh() {}
    async requestSnapshot() {
      return { metadata: {} as SnapshotMetadata, data: [] }
    }
    async fetchSnapshot() {
      return {
        metadata: {} as SnapshotMetadata,
        data: [] as ChangeMessage<RowT>[],
      }
    }
  }

  const insertMsg = (key: string, n: number): ChangeMessage<RowT> => ({
    key,
    value: { id: key, n },
    headers: { operation: `insert` },
  })

  const deleteMsg = (key: string): ChangeMessage<RowT> => ({
    key,
    value: { id: key },
    headers: { operation: `delete` },
  })

  const upToDateMsg = (): Message<RowT> =>
    ({
      headers: { control: `up-to-date`, global_last_seen_lsn: `1` },
    }) as unknown as Message<RowT>

  const mustRefetchMsg = (): Message<RowT> =>
    ({ headers: { control: `must-refetch` } }) as unknown as Message<RowT>

  it(`deterministic: [must-refetch] from up-to-date state notifies subscribers`, () => {
    const stream = new MockStream()
    const shape = new Shape(stream)

    const observed: number[] = []
    shape.subscribe(({ rows }) => observed.push(rows.length))

    stream.publish([insertMsg(`k1`, 1), upToDateMsg()])
    expect(shape.currentRows.length).toBe(1)
    expect(shape.isUpToDate).toBe(true)
    const notifyCountBefore = observed.length
    expect(notifyCountBefore).toBeGreaterThan(0)

    // Matches the single-message batch client.ts:927 publishes on 409.
    stream.publish([mustRefetchMsg()])

    expect(shape.currentRows.length).toBe(0)

    // BUG: no notification, so subscribers still believe the shape
    // contains the pre-refetch row set.
    expect(
      observed.length,
      `subscribers should have been notified that data was cleared`
    ).toBeGreaterThan(notifyCountBefore)
  })

  it(`deterministic: [up-to-date, insert] — subscriber's last view must match shape`, () => {
    const stream = new MockStream()
    const shape = new Shape(stream)

    let lastSize = -1
    shape.subscribe(({ rows }) => {
      lastSize = rows.length
    })

    stream.publish([upToDateMsg(), insertMsg(`k1`, 1)])

    expect(shape.currentRows.length).toBe(1)
    // BUG: shouldNotify gets set to true by up-to-date and then
    // overwritten to false by the trailing change's status update.
    expect(lastSize).toBe(shape.currentRows.length)
  })

  // Regression: the real sync-service initial fetch (offset=-1) returns
  // data without an `electric-up-to-date` header (server sets
  // `up_to_date: false` for before_all_offset requests, see
  // sync-service api.ex:523-527). The client's handleMessageBatch only
  // sets lastSyncedAt when `hasUpToDateMessage` is true, so the stream's
  // lastSyncedAt stays undefined after the first batch. Bug #2's fix
  // made Shape notify subscribers on every change message — which now
  // fires the callback with `shape.lastSyncedAt()` still undefined.
  it(`regression: subscriber must not see undefined lastSyncedAt during initial sync with real ShapeStream`, async () => {
    let callCount = 0
    const fetchClient = async (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      callCount++
      const url = new URL(input.toString())
      const isInitial = url.searchParams.get(`offset`) === `-1`

      if (isInitial) {
        // First response: data rows, NO up-to-date header or message.
        // Mirrors what sync-service returns for offset=-1.
        return new Response(
          JSON.stringify([
            {
              key: `"public"."issues"/"1"`,
              value: { id: 1 },
              headers: { operation: `insert` },
            },
          ]),
          {
            status: 200,
            headers: {
              'electric-handle': `h1`,
              'electric-offset': `5_0`,
              'electric-schema': `{"id":"int4"}`,
              'electric-cursor': `c1`,
            },
          }
        )
      }
      if (callCount === 2) {
        // First live request: up-to-date. Subscriber should now be notified
        // and lastSyncedAt must be defined (not undefined).
        return new Response(
          JSON.stringify([{ headers: { control: `up-to-date` } }]),
          {
            status: 200,
            headers: {
              'electric-handle': `h1`,
              'electric-offset': `5_0`,
              'electric-schema': `{"id":"int4"}`,
              'electric-cursor': `c2`,
              'electric-up-to-date': ``,
            },
          }
        )
      }
      // Subsequent (live) requests: hang until abort, then return a
      // network error (mirroring a fetch that was cancelled mid-flight)
      // so the stream does not see a missing-headers response.
      if (init?.signal?.aborted) return Response.error()
      return new Promise<Response>((resolve) => {
        init?.signal?.addEventListener(
          `abort`,
          () => resolve(Response.error()),
          { once: true }
        )
      })
    }

    const aborter = new AbortController()
    const stream = new ShapeStream<{ id: number }>({
      url: `https://example.com/v1/shape`,
      params: { table: `test_table` },
      fetchClient,
      signal: aborter.signal,
    })
    const shape = new Shape<{ id: number }>(stream)

    const observations: Array<number | undefined> = []
    shape.subscribe(({ rows }) => {
      if (rows.length > 0) observations.push(shape.lastSyncedAt())
    })

    // Wait for the initial fetch + any follow-up.
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 10))
      if (observations.length > 0) break
    }

    try {
      expect(observations.length).toBeGreaterThan(0)
      for (const v of observations) {
        expect(v).toBeDefined()
      }
    } finally {
      aborter.abort()
    }
    void callCount
  })

  it(`PBT: subscriber's last observation matches shape whenever data or up-to-date state changes`, () => {
    type Op =
      | { kind: `insert`; key: string }
      | { kind: `delete`; key: string }
      | { kind: `upToDate` }
      | { kind: `mustRefetch` }

    const keyArb = fc.constantFrom(`k1`, `k2`, `k3`)
    const opArb: fc.Arbitrary<Op> = fc.oneof(
      keyArb.map((key) => ({ kind: `insert` as const, key })),
      keyArb.map((key) => ({ kind: `delete` as const, key })),
      fc.constant<Op>({ kind: `upToDate` }),
      fc.constant<Op>({ kind: `mustRefetch` })
    )
    const batchArb = fc.array(opArb, { minLength: 1, maxLength: 5 })
    const batchesArb = fc.array(batchArb, { minLength: 1, maxLength: 8 })

    fc.assert(
      fc.property(batchesArb, (batches) => {
        const stream = new MockStream()
        const shape = new Shape(stream)

        let modelData = new Map<string, unknown>()
        let modelStatus: `syncing` | `up-to-date` = `syncing`

        let lastObservedSize = 0
        shape.subscribe(({ rows }) => {
          lastObservedSize = rows.length
        })

        let counter = 0
        for (const batch of batches) {
          // Simulate Shape#process message-by-message to determine
          // exactly when the real shape fires #notify. The invariant:
          // after a notification, the subscriber's view must match the
          // shape's currentRows.
          let shouldHaveNotified = false
          const msgs: Message<RowT>[] = []
          for (const op of batch) {
            switch (op.kind) {
              case `insert`: {
                counter += 1
                msgs.push(insertMsg(op.key, counter))
                const wasUpToDate = modelStatus === `up-to-date`
                modelData.set(op.key, { id: op.key, n: counter })
                modelStatus = `syncing`
                if (wasUpToDate) shouldHaveNotified = true
                break
              }
              case `delete`: {
                msgs.push(deleteMsg(op.key))
                const wasUpToDate = modelStatus === `up-to-date`
                const hadKey = modelData.has(op.key)
                modelData.delete(op.key)
                modelStatus = `syncing`
                // Shape#process sets shouldNotify on delete in full mode
                // regardless of whether the key existed — match that.
                void hadKey
                if (wasUpToDate) shouldHaveNotified = true
                break
              }
              case `upToDate`: {
                msgs.push(upToDateMsg())
                if (modelStatus !== `up-to-date`) shouldHaveNotified = true
                modelStatus = `up-to-date`
                break
              }
              case `mustRefetch`: {
                msgs.push(mustRefetchMsg())
                const hadData = modelData.size > 0
                modelData = new Map()
                modelStatus = `syncing`
                if (hadData) shouldHaveNotified = true
                break
              }
            }
          }

          stream.publish(msgs)

          if (shouldHaveNotified) {
            expect(
              lastObservedSize,
              `batch=${JSON.stringify(batch)} observed=${lastObservedSize} expected=${shape.currentRows.length}`
            ).toEqual(shape.currentRows.length)
          }
        }
        return true
      }),
      pbtOpts
    )
  })
})

// ═══════════════════════════════════════════════════════════════════
// TARGET 6: SubsetParams falsy-drops limit=0 / offset=0 on GET path
// ═══════════════════════════════════════════════════════════════════
//
// client.ts #constructUrl uses truthiness checks when serializing
// SubsetParams into the query string:
//
//   if (subsetParams.limit)  setQueryParam(..., SUBSET_PARAM_LIMIT, ...)
//   if (subsetParams.offset) setQueryParam(..., SUBSET_PARAM_OFFSET, ...)
//
// Both 0 and NaN evaluate falsy, so `limit: 0` is silently dropped on
// the GET path. The POST path in #buildSubsetBody correctly uses
// `opts.limit !== undefined`, so the behavior of the same API call
// depends on the transport.
//
// Consequence: `requestSnapshot({ limit: 0 })` on a stream using the
// default `method: 'GET'` sends no limit at all, and the server
// returns the full result set instead of the empty result the caller
// asked for. This is a silent divergence between GET and POST.

describe(`SubsetParams GET serialization PBT`, () => {
  // Minimal valid snapshot response body.
  const emptySnapshotResponse = JSON.stringify({
    metadata: {
      snapshot_mark: 1,
      xmin: `0`,
      xmax: `0`,
      xip_list: [],
      database_lsn: `0`,
    },
    data: [],
  })

  const makeStream = (captured: URL[]) =>
    new ShapeStream({
      url: `http://e.com/v1/shape`,
      params: { table: `t` },
      subscribe: false,
      log: `changes_only`,
      subsetMethod: `GET`,
      backoffOptions: {
        initialDelay: 0,
        maxDelay: 0,
        multiplier: 1,
        maxRetries: 0,
      },
      fetchClient: async (input, _init) => {
        const url = new URL(
          input instanceof URL
            ? input.toString()
            : typeof input === `string`
              ? input
              : (input as Request).url
        )
        captured.push(url)
        return new Response(emptySnapshotResponse, {
          status: 200,
          headers: {
            'electric-schema': JSON.stringify({}),
            'electric-offset': `0_0`,
            'electric-handle': `h1`,
            'electric-up-to-date': ``,
          },
        })
      },
    })

  it(`deterministic: limit: 0 must be sent as subset__limit=0 on GET`, async () => {
    const captured: URL[] = []
    const stream = makeStream(captured)
    await stream.fetchSnapshot({ limit: 0, orderBy: `id ASC` })
    expect(captured.length).toBe(1)
    const url = captured[0]
    // BUG: limit=0 is dropped because `if (subsetParams.limit)` is
    // false for 0. The server receives no subset__limit and returns
    // the full set instead of the empty result the caller asked for.
    expect(
      url.searchParams.get(`subset__limit`),
      `subset__limit should be "0", got ${url.searchParams.get(`subset__limit`)}`
    ).toBe(`0`)
  })

  it(`deterministic: offset: 0 must be sent as subset__offset=0 on GET`, async () => {
    const captured: URL[] = []
    const stream = makeStream(captured)
    await stream.fetchSnapshot({
      limit: 10,
      offset: 0,
      orderBy: `id ASC`,
    })
    expect(captured.length).toBe(1)
    const url = captured[0]
    // BUG: offset=0 is dropped by `if (subsetParams.offset)`.
    expect(
      url.searchParams.get(`subset__offset`),
      `subset__offset should be "0", got ${url.searchParams.get(`subset__offset`)}`
    ).toBe(`0`)
  })

  it(`PBT: any non-negative integer limit must round-trip through the GET URL`, async () => {
    // Bias the generator toward 0 so the edge case is hit reliably even
    // in short runs. The bug is a truthiness check, so 0 is the only
    // integer value that triggers it.
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          { arbitrary: fc.constant(0), weight: 3 },
          { arbitrary: fc.integer({ min: 1, max: 1000 }), weight: 1 }
        ),
        async (limit) => {
          const captured: URL[] = []
          const stream = makeStream(captured)
          await stream.fetchSnapshot({ limit, orderBy: `id ASC` })
          const got = captured[0].searchParams.get(`subset__limit`)
          expect(got, `limit=${limit} → subset__limit=${got}`).toBe(
            String(limit)
          )
          return true
        }
      ),
      { ...pbtOpts, numRuns: Math.min(NUM_RUNS, 30) }
    )
  })
})

// ═══════════════════════════════════════════════════════════════════
// TARGET 7: Shape #requestedSubSnapshots non-canonical JSON dedup
// ═══════════════════════════════════════════════════════════════════
//
// shape.ts:148 stores each subset snapshot request in a dedup set
// keyed by `bigintSafeStringify(params)`. JSON.stringify preserves
// insertion order, so two semantically identical param objects with
// different key orders (`{limit, offset}` vs `{offset, limit}`) produce
// different strings and both live in `#requestedSubSnapshots` forever.
//
// On must-refetch, `#reexecuteSnapshots` iterates the set and calls
// `stream.requestSnapshot` once per entry. A user who issued two calls
// with the same logical params in different key orders therefore ends
// up re-fetching twice per must-refetch event — silent duplicated work
// that scales with the number of distinct orderings the caller happens
// to use.

describe(`Shape subset snapshot dedup PBT`, () => {
  type RowT = Row<unknown>

  class DedupMockStream implements ShapeStreamInterface<RowT> {
    isUpToDate = true
    lastOffset: Offset = `-1`
    shapeHandle: string | undefined = undefined
    error: unknown = undefined
    mode: LogMode = `changes_only`
    snapshotCalls: Array<unknown> = []

    #subs = new Set<(msgs: Message<RowT>[]) => void>()

    subscribe(
      callback: (
        msgs: Message<RowT>[]
      ) => unknown | { columns?: (keyof RowT)[] }
    ): () => void {
      const fn = callback as (m: Message<RowT>[]) => void
      this.#subs.add(fn)
      return () => this.#subs.delete(fn)
    }
    unsubscribeAll() {
      this.#subs.clear()
    }
    publish(batch: Message<RowT>[]) {
      for (const cb of this.#subs) cb(batch)
    }
    isLoading() {
      return false
    }
    lastSyncedAt() {
      return 0
    }
    lastSynced() {
      return 0
    }
    isConnected() {
      return true
    }
    hasStarted() {
      return true
    }
    async forceDisconnectAndRefresh() {}
    async requestSnapshot(params: unknown) {
      this.snapshotCalls.push(params)
      return { metadata: {} as SnapshotMetadata, data: [] }
    }
    async fetchSnapshot() {
      return {
        metadata: {} as SnapshotMetadata,
        data: [] as ChangeMessage<RowT>[],
      }
    }
  }

  const upToDateDedupMsg = (): Message<RowT> =>
    ({
      headers: { control: `up-to-date`, global_last_seen_lsn: `1` },
    }) as unknown as Message<RowT>
  const mustRefetchDedupMsg = (): Message<RowT> =>
    ({ headers: { control: `must-refetch` } }) as unknown as Message<RowT>

  async function flushMicrotasks(): Promise<void> {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  }

  it(`deterministic: shape.requestSnapshot dedups by logical params, not JSON key order`, async () => {
    const stream = new DedupMockStream()
    const shape = new Shape(stream)

    // Two semantically identical calls with different insertion orders.
    await shape.requestSnapshot({ limit: 10, offset: 0, orderBy: `id ASC` })
    await shape.requestSnapshot({ orderBy: `id ASC`, offset: 0, limit: 10 })

    // Reset call tracking and trigger must-refetch + up-to-date to drive
    // reexecute from the dedup set.
    stream.snapshotCalls = []
    stream.publish([mustRefetchDedupMsg(), upToDateDedupMsg()])
    await flushMicrotasks()

    // BUG: `bigintSafeStringify(params)` depends on JS key insertion
    // order, so two logically equal param objects stringify differently
    // and both entries live in `#requestedSubSnapshots`. After
    // must-refetch, both are reexecuted — the user sees 2× fetches.
    expect(
      stream.snapshotCalls.length,
      `expected 1 reexecuted snapshot, got ${stream.snapshotCalls.length}`
    ).toBe(1)
  })

  it(`PBT: permutation-equivalent SubsetParams dedup to a single reexecute`, async () => {
    const paramArb = fc.record({
      limit: fc.integer({ min: 1, max: 100 }),
      offset: fc.integer({ min: 0, max: 100 }),
      orderBy: fc.constant(`id ASC`),
    })

    await fc.assert(
      fc.asyncProperty(paramArb, async (params) => {
        const stream = new DedupMockStream()
        const shape = new Shape(stream)

        // Build a permutation-equivalent variant by reversing entries.
        const reversed = Object.fromEntries(
          Object.entries(params).reverse()
        ) as typeof params

        await shape.requestSnapshot(params)
        await shape.requestSnapshot(reversed)

        stream.snapshotCalls = []
        stream.publish([mustRefetchDedupMsg(), upToDateDedupMsg()])
        await flushMicrotasks()

        expect(
          stream.snapshotCalls.length,
          `permutation of ${JSON.stringify(params)} should dedup; got ${stream.snapshotCalls.length} reexecutes`
        ).toBe(1)
        return true
      }),
      { ...pbtOpts, numRuns: Math.min(NUM_RUNS, 20) }
    )
  })
})

// ═══════════════════════════════════════════════════════════════════
// TARGET 8: snakeCamelMapper collapses multi-underscore columns,
//           producing silent decode collisions
// ═══════════════════════════════════════════════════════════════════
//
// snakeToCamel (`column-mapper.ts:77`) uses `/_+([a-z])/g` which is
// greedy over underscores, so any run of 1+ underscores collapses to
// the same camelCase boundary. As a result:
//
//   snakeToCamel("user_id")   === "userId"
//   snakeToCamel("user__id")  === "userId"
//   snakeToCamel("user___id") === "userId"
//
// These are three DISTINCT Postgres columns mapping to ONE application
// column name. The reverse direction camelToSnake always inserts
// exactly one underscore, so the decoder is NOT injective on any db
// schema that contains both `X_Y` and `X__Y`.
//
// The applyColumnMapper closure inside client.ts (`constructor` in
// the ShapeStream) walks `Object.entries(row)` and writes decoded
// keys into a fresh object, so collisions silently OVERWRITE row
// values. The user receives only one column's data under the camelCase
// key and has no way to detect which db column it came from.

describe(`snakeCamelMapper collision PBT`, () => {
  it(`deterministic: distinct underscore counts decode to distinct app keys`, () => {
    // Single-underscore input collapses as usual.
    expect(snakeToCamel(`user_id`)).toBe(`userId`)
    // Multi-underscore inputs preserve (n-1) literal underscores so
    // they don't collide with the single-underscore version.
    expect(snakeToCamel(`user__id`)).toBe(`user_Id`)
    expect(snakeToCamel(`user___id`)).toBe(`user__Id`)
    expect(snakeToCamel(`user__id`)).not.toBe(snakeToCamel(`user_id`))
  })

  it(`deterministic: snakeCamelMapper decode is injective across underscore counts`, () => {
    const mapper = snakeCamelMapper()
    // Two different PG columns must decode to different app keys.
    const a = mapper.decode(`user_id`)
    const b = mapper.decode(`user__id`)
    expect(
      a,
      `expected distinct app keys for distinct db columns, both → ${a}`
    ).not.toBe(b)
  })

  it(`deterministic: camel ⇄ snake round-trip preserves underscore count`, () => {
    const input = `user__id`
    const rt = camelToSnake(snakeToCamel(input))
    expect(rt, `round-trip should be identity, got ${rt}`).toBe(input)
  })

  it(`deterministic: applyColumnMapper preserves distinct columns differing only in underscore count`, () => {
    // Simulates the applyColumnMapper closure in client.ts.
    const mapper = snakeCamelMapper()
    const row: Record<string, unknown> = {
      user_id: `from_single_underscore`,
      user__id: `from_double_underscore`,
    }
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(row)) {
      result[mapper.decode(k)] = v
    }
    expect(
      Object.keys(result).length,
      `both db columns should be present in the result, got ${JSON.stringify(result)}`
    ).toBe(2)
  })

  it(`PBT: snakeToCamel is injective on names differing only in underscore count`, () => {
    // Two snake_case column names structurally differ only in the
    // number of underscores between segments. They are distinct PG
    // columns that snakeToCamel must map to distinct app keys.
    const segment = fc
      .string({ minLength: 1, maxLength: 6 })
      .filter((s) => /^[a-z][a-z0-9]*$/.test(s))

    fc.assert(
      fc.property(
        fc.tuple(
          segment,
          segment,
          fc.integer({ min: 1, max: 3 }),
          fc.integer({ min: 1, max: 3 })
        ),
        ([a, b, n1, n2]) => {
          fc.pre(n1 !== n2)
          const x = a + `_`.repeat(n1) + b
          const y = a + `_`.repeat(n2) + b
          expect(
            snakeToCamel(x),
            `snakeToCamel("${x}") === snakeToCamel("${y}")`
          ).not.toBe(snakeToCamel(y))
          return true
        }
      ),
      { ...pbtOpts, numRuns: Math.min(NUM_RUNS, 50) }
    )
  })
})

// ═══════════════════════════════════════════════════════════════════
// TARGET 9: Shape#reexecuteSnapshots silently swallows snapshot
//           fetch errors on must-refetch
// ═══════════════════════════════════════════════════════════════════
//
// shape.ts:243-257 #reexecuteSnapshots wraps each remembered subset
// call in try/catch and comments "errors will be surfaced via stream
// onError". That claim is wrong: `#handleError` is only wired as the
// error callback of `this.stream.subscribe(...)` at shape.ts:67-70,
// which delivers message-stream errors. `stream.requestSnapshot()`
// rejects its own promise — that rejection never reaches the
// subscriber's onError path.
//
// Consequence: after a must-refetch, if any remembered subset fetch
// fails (network, 4xx, validation), the Shape:
//   • does NOT populate `#error`,
//   • does NOT notify subscribers of the failure,
//   • in `changes_only` mode, silently loses all data for that subset.
//
// In changes_only mode the Shape is *only* the union of its requested
// snapshots, so this is a silent total data loss bug from the user's
// perspective.

describe(`Shape #reexecuteSnapshots silent error swallowing`, () => {
  type RowT = Row<unknown>

  class ThrowingSnapshotMockStream implements ShapeStreamInterface<RowT> {
    isUpToDate = true
    lastOffset: Offset = `-1`
    shapeHandle: string | undefined = undefined
    error: unknown = undefined
    mode: LogMode = `changes_only`
    snapshotCalls = 0
    throwOnNextSnapshot: FetchError | null = null

    #subs = new Set<(msgs: Message<RowT>[]) => void>()
    #errorSubs = new Set<(e: Error) => void>()

    subscribe(
      callback: (
        msgs: Message<RowT>[]
      ) => unknown | { columns?: (keyof RowT)[] },
      onError?: (e: Error) => void
    ): () => void {
      const fn = callback as (m: Message<RowT>[]) => void
      this.#subs.add(fn)
      if (onError) this.#errorSubs.add(onError)
      return () => {
        this.#subs.delete(fn)
        if (onError) this.#errorSubs.delete(onError)
      }
    }
    unsubscribeAll() {
      this.#subs.clear()
      this.#errorSubs.clear()
    }
    publish(batch: Message<RowT>[]) {
      for (const cb of this.#subs) cb(batch)
    }
    isLoading() {
      return false
    }
    lastSyncedAt() {
      return 0
    }
    lastSynced() {
      return 0
    }
    isConnected() {
      return true
    }
    hasStarted() {
      return true
    }
    async forceDisconnectAndRefresh() {}
    async requestSnapshot(_params: unknown) {
      this.snapshotCalls++
      if (this.throwOnNextSnapshot) throw this.throwOnNextSnapshot
      return { metadata: {} as SnapshotMetadata, data: [] }
    }
    async fetchSnapshot() {
      return {
        metadata: {} as SnapshotMetadata,
        data: [] as ChangeMessage<RowT>[],
      }
    }
  }

  const upToDateMsg = (): Message<RowT> =>
    ({
      headers: { control: `up-to-date`, global_last_seen_lsn: `1` },
    }) as unknown as Message<RowT>
  const mustRefetchMsg = (): Message<RowT> =>
    ({ headers: { control: `must-refetch` } }) as unknown as Message<RowT>

  async function flushMicrotasks(): Promise<void> {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  }

  it(`deterministic: reexecute snapshot failure after must-refetch is silently swallowed`, async () => {
    const stream = new ThrowingSnapshotMockStream()
    const shape = new Shape(stream)

    // Record errors observed by Shape subscribers via shape.error.
    const notifiedErrors: Array<unknown> = []
    shape.subscribe(() => {
      if (shape.error) notifiedErrors.push(shape.error)
    })

    // First snapshot call succeeds so the key lands in #requestedSubSnapshots.
    await shape.requestSnapshot({ limit: 10, offset: 0, orderBy: `id ASC` })
    expect(stream.snapshotCalls).toBe(1)

    // Now arm the mock to throw on the NEXT snapshot call (the reexecute).
    stream.throwOnNextSnapshot = new FetchError(
      500,
      `upstream boom`,
      undefined,
      {},
      `http://mock/snapshot`,
      `upstream boom`
    )

    // Drive must-refetch + up-to-date, which fires #reexecuteSnapshots.
    stream.publish([mustRefetchMsg(), upToDateMsg()])
    await flushMicrotasks()

    // The reexecute attempt DID happen:
    expect(
      stream.snapshotCalls,
      `expected reexecute to fire a snapshot call`
    ).toBe(2)

    // BUG: the FetchError was caught and discarded. shape.error is
    // still false, and no subscriber was notified of an error state.
    // The user's subset data has silently disappeared.
    expect(
      shape.error,
      `expected shape.error to reflect the reexecute failure`
    ).not.toBe(false)
    expect(
      notifiedErrors.length,
      `expected subscribers to be notified of the reexecute failure`
    ).toBeGreaterThan(0)
  })

  it(`deterministic: a successful reexecute after one failing sibling still leaks the failure`, async () => {
    // Two subset snapshots in the dedup set. Arm the mock so the next
    // call throws: because reexecutes run concurrently via Promise.all,
    // this guarantees at least one remembered subset silently fails.
    const stream = new ThrowingSnapshotMockStream()
    const shape = new Shape(stream)

    await shape.requestSnapshot({ limit: 5, offset: 0, orderBy: `id ASC` })
    await shape.requestSnapshot({ limit: 5, offset: 5, orderBy: `id ASC` })
    expect(stream.snapshotCalls).toBe(2)

    stream.throwOnNextSnapshot = new FetchError(
      502,
      `gateway`,
      undefined,
      {},
      `http://mock/snapshot`,
      `gateway`
    )

    stream.publish([mustRefetchMsg(), upToDateMsg()])
    await flushMicrotasks()

    // At least one of the two concurrent reexecutes threw. BUG: none of
    // that shows up in shape.error.
    expect(
      shape.error,
      `at least one reexecute threw; expected shape.error to be set`
    ).not.toBe(false)
  })

  it(`PBT: any reexecute failure must be visible on shape.error`, async () => {
    // Generate 1..5 remembered subset calls with distinct params, then
    // arm the mock to throw. After must-refetch + up-to-date, shape.error
    // should reflect the failure regardless of how many subsets existed.
    const subsetArb = fc.uniqueArray(
      fc.record({
        limit: fc.integer({ min: 1, max: 100 }),
        offset: fc.integer({ min: 0, max: 1000 }),
        orderBy: fc.constant(`id ASC`),
      }),
      {
        minLength: 1,
        maxLength: 5,
        selector: (r) => `${r.limit}:${r.offset}`,
      }
    )

    await fc.assert(
      fc.asyncProperty(subsetArb, async (subsets) => {
        const stream = new ThrowingSnapshotMockStream()
        const shape = new Shape(stream)

        for (const s of subsets) {
          await shape.requestSnapshot(s)
        }

        stream.throwOnNextSnapshot = new FetchError(
          503,
          `unavailable`,
          undefined,
          {},
          `http://mock/snapshot`,
          `unavailable`
        )

        stream.publish([mustRefetchMsg(), upToDateMsg()])
        await flushMicrotasks()

        // At least one reexecute call must have been attempted.
        expect(stream.snapshotCalls).toBeGreaterThan(subsets.length)

        // BUG: no error surfaces through shape.error.
        expect(
          shape.error,
          `with ${subsets.length} remembered subset(s), reexecute failure should surface`
        ).not.toBe(false)
        return true
      }),
      { ...pbtOpts, numRuns: Math.min(NUM_RUNS, 20) }
    )
  })
})

// ═══════════════════════════════════════════════════════════════════
// TARGET 10: cross-module canonicalShapeKey invariants
// ═══════════════════════════════════════════════════════════════════
//
// `canonicalShapeKey` is the pivot for cache coherence between five
// subsystems that all key off the "same logical shape":
//
//   • expiredShapesCache.markExpired   (client.ts:908, 1925)
//   • expiredShapesCache.getExpiredHandle (client.ts:1168, 1214)
//   • upToDateTracker.recordUpToDate   (client.ts:1312)
//   • upToDateTracker.shouldEnterReplayMode (client.ts:1351)
//
// The intended invariant is bidirectional:
//
//   STABILITY: any combination of Electric protocol params
//     (handle, offset, live, live_sse, cursor, cache-buster,
//      expired_handle, log, subset__*) added/removed from a URL
//     must NOT change the canonical key. Two call sites looking at
//     the same logical shape must agree.
//
//   DISTINCTNESS: any change to origin/pathname or any custom
//     (user-defined) query param MUST change the canonical key.
//     Otherwise two genuinely-distinct shapes collide in the same
//     cache slot.
//
// A violation of stability produces cache misses (stale-but-valid
// replay mode is never entered, 409s are never pre-empted).
//
// A violation of distinctness produces cache hits for the *wrong*
// shape — cross-shape leaks through the expired-handle machinery.

describe(`canonicalShapeKey cross-module invariants PBT`, () => {
  const safeName = fc.stringMatching(/^[a-z][a-z0-9_]{0,5}$/)
  const safeValue = fc.stringMatching(/^[a-z0-9]{1,6}$/)

  const protocolParamArb = fc.oneof(
    ...ELECTRIC_PROTOCOL_QUERY_PARAMS.map((name) => fc.constant(name))
  )

  const buildBaseUrl = (customParams: Array<[string, string]>): URL => {
    const u = new URL(`http://host.example/v1/shape`)
    for (const [k, v] of customParams) u.searchParams.set(k, v)
    return u
  }

  const addProtocolNoise = (url: URL, noise: Array<[string, string]>): URL => {
    const u = new URL(url.toString())
    for (const [k, v] of noise) u.searchParams.set(k, v)
    return u
  }

  it(`PBT stability: protocol-param noise never changes the canonical key`, () => {
    const customArb = fc.uniqueArray(fc.tuple(safeName, safeValue), {
      minLength: 0,
      maxLength: 4,
      selector: (t) => t[0],
    })

    const noiseArb = fc.array(fc.tuple(protocolParamArb, safeValue), {
      minLength: 0,
      maxLength: 6,
    })

    fc.assert(
      fc.property(customArb, noiseArb, (custom, noise) => {
        const customClean = custom.filter(
          ([k]) => !ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(k)
        )
        const base = buildBaseUrl(customClean)
        const noisy = addProtocolNoise(base, noise)

        const baseKey = canonicalShapeKey(base)
        const noisyKey = canonicalShapeKey(noisy)
        expect(
          noisyKey,
          `protocol noise ${JSON.stringify(noise)} perturbed key for custom=${JSON.stringify(customClean)}`
        ).toBe(baseKey)
        return true
      }),
      { ...pbtOpts, numRuns: Math.min(NUM_RUNS, 200) }
    )
  })

  it(`PBT distinctness: changing a custom param MUST change the canonical key`, () => {
    fc.assert(
      fc.property(safeName, safeValue, safeValue, (name, v1, v2) => {
        fc.pre(v1 !== v2)
        fc.pre(!ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(name))
        const a = buildBaseUrl([[name, v1]])
        const b = buildBaseUrl([[name, v2]])
        expect(
          canonicalShapeKey(a),
          `custom param ${name}=${v1} vs ${v2} must distinguish shapes`
        ).not.toBe(canonicalShapeKey(b))
        return true
      }),
      { ...pbtOpts, numRuns: Math.min(NUM_RUNS, 200) }
    )
  })

  it(`PBT distinctness: changing pathname MUST change the canonical key`, () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^\/v1\/[a-z]{1,6}$/),
        fc.stringMatching(/^\/v1\/[a-z]{1,6}$/),
        (p1, p2) => {
          fc.pre(p1 !== p2)
          const a = new URL(`http://host.example${p1}?table=t`)
          const b = new URL(`http://host.example${p2}?table=t`)
          expect(canonicalShapeKey(a)).not.toBe(canonicalShapeKey(b))
          return true
        }
      ),
      { ...pbtOpts, numRuns: Math.min(NUM_RUNS, 100) }
    )
  })

  it(`deterministic: log mode is stripped — full vs changes_only collide`, () => {
    // `log` is on the protocol strip list (constants.ts:35). That
    // means two ShapeStreams on the same base URL but with different
    // log modes have the same canonical key. A 409 on one of them
    // leaks an `expired_handle` hint into requests from the other.
    const full = new URL(`http://host.example/v1/shape?table=t&log=full`)
    const changes = new URL(
      `http://host.example/v1/shape?table=t&log=changes_only`
    )
    // This test CONFIRMS the collision. If fixed by excluding `log`
    // from ELECTRIC_PROTOCOL_QUERY_PARAMS, flip the assertion.
    expect(
      canonicalShapeKey(full),
      `log-mode collision: full and changes_only currently share a key`
    ).toBe(canonicalShapeKey(changes))
  })

  it(`deterministic: subset__* params stripped — distinct snapshot requests collide`, () => {
    const a = new URL(
      `http://host.example/v1/shape?table=t&subset__limit=10&subset__offset=0`
    )
    const b = new URL(
      `http://host.example/v1/shape?table=t&subset__limit=20&subset__offset=100`
    )
    expect(
      canonicalShapeKey(a),
      `subset params collapse: distinct snapshot URLs share a key`
    ).toBe(canonicalShapeKey(b))
  })

  it(`deterministic: cross-module cache-key agreement under full protocol noise`, () => {
    const base = new URL(`http://host.example/v1/shape?table=t&where=x%3D1`)

    const freshRequest = new URL(base.toString())
    freshRequest.searchParams.set(`offset`, `-1`)
    freshRequest.searchParams.set(`cache-buster`, `0.123456789`)

    const liveLongPoll = new URL(base.toString())
    liveLongPoll.searchParams.set(`handle`, `h-abc`)
    liveLongPoll.searchParams.set(`offset`, `0_1`)
    liveLongPoll.searchParams.set(`cursor`, `42`)
    liveLongPoll.searchParams.set(`live`, `true`)

    const sseRetry = new URL(base.toString())
    sseRetry.searchParams.set(`live_sse`, `true`)
    sseRetry.searchParams.set(`handle`, `h-abc`)
    sseRetry.searchParams.set(`cursor`, `43`)
    sseRetry.searchParams.set(`cache-buster`, `0.987654321`)

    const post409 = new URL(base.toString())
    post409.searchParams.set(`handle`, `h-new`)
    post409.searchParams.set(`expired_handle`, `h-abc`)
    post409.searchParams.set(`offset`, `-1`)

    const k1 = canonicalShapeKey(freshRequest)
    const k2 = canonicalShapeKey(liveLongPoll)
    const k3 = canonicalShapeKey(sseRetry)
    const k4 = canonicalShapeKey(post409)

    expect(k1, `fresh vs live long-poll keys must agree`).toBe(k2)
    expect(k2, `live long-poll vs SSE retry keys must agree`).toBe(k3)
    expect(k3, `SSE retry vs post-409 keys must agree`).toBe(k4)
  })
})

// ═══════════════════════════════════════════════════════════════════
// TARGET 11: Shape #fetchSnapshotWithRetry 409 loop invariants
// ═══════════════════════════════════════════════════════════════════
//
// Exhaustive property coverage of the L6 loop-back path documented in
// SPEC.md (client.ts:1859). The existing model-based test only drives
// the L4 (main stream) path via Respond409Cmd/Respond409NoHandleCmd;
// the snapshot retry path has zero runtime coverage.
//
// Invariants under test:
//
//   A. Retry bound: #maxSnapshotRetries = 5. After 5 consecutive 409s,
//      the 6th attempt produces a FetchError(502) "stuck in 409 retry
//      loop" and does NOT issue a 7th fetch.
//
//   B. Unconditional cache buster: every retry URL carries a unique
//      `cache-buster` param, regardless of whether the 409 response
//      included a handle. This is the runtime counterpart of the
//      static-analysis rule `conditional-409-cache-buster` and the
//      "Invariant: unconditional 409 cache buster" in SPEC.md.
//
//   C. Main stream state preservation: the fetchSnapshot retry loop
//      must NEVER mutate the main stream's offset or isUpToDate. It
//      is ALLOWED to update the handle via withHandle() (SPEC L6).
//      I11 in SPEC.md says withHandle preserves everything else.
//
//   D. Handle propagation: on a 409 with a new-handle header, the
//      NEXT retry URL must reflect that handle.
//
//   E. 200 terminates the loop: as soon as any attempt returns 200,
//      no further fetches are issued.

describe(`Shape #fetchSnapshotWithRetry 409 loop PBT`, () => {
  const emptySnapshotResponseBody = JSON.stringify({
    metadata: {
      snapshot_mark: 1,
      xmin: `0`,
      xmax: `0`,
      xip_list: [],
      database_lsn: `0`,
    },
    data: [],
  })

  const successResponse = () =>
    new Response(emptySnapshotResponseBody, {
      status: 200,
      headers: {
        'electric-schema': JSON.stringify({}),
        'electric-offset': `0_0`,
        'electric-handle': `h-success`,
        'electric-up-to-date': ``,
      },
    })

  const conflictResponse = (headerHandle?: string) => {
    const headers: Record<string, string> = {}
    if (headerHandle) headers[`electric-handle`] = headerHandle
    return new Response(`{"code":409}`, { status: 409, headers })
  }

  type ResponseSpec =
    | { kind: `200` }
    | { kind: `409-new`; handle: string }
    | { kind: `409-same` }
    | { kind: `409-none` }

  const makeStream = (
    specs: ResponseSpec[],
    captured: URL[]
  ): { stream: ShapeStream; fetchCount: () => number } => {
    let step = 0
    const stream = new ShapeStream({
      url: `http://e.com/v1/shape`,
      params: { table: `t` },
      subscribe: false,
      log: `changes_only`,
      subsetMethod: `GET`,
      backoffOptions: {
        initialDelay: 0,
        maxDelay: 0,
        multiplier: 1,
        maxRetries: 0,
      },
      fetchClient: async (input, _init) => {
        const url = new URL(
          input instanceof URL
            ? input.toString()
            : typeof input === `string`
              ? input
              : (input as Request).url
        )
        captured.push(url)
        const spec = specs[Math.min(step, specs.length - 1)]
        step++
        if (spec.kind === `200`) return successResponse()
        if (spec.kind === `409-new`) return conflictResponse(spec.handle)
        if (spec.kind === `409-same`) return conflictResponse(`h-same`)
        return conflictResponse(undefined)
      },
    })
    return { stream, fetchCount: () => step }
  }

  it(`deterministic A: 5 consecutive 409s then 200 succeeds with exactly 6 fetches`, async () => {
    const captured: URL[] = []
    const specs: ResponseSpec[] = [
      { kind: `409-new`, handle: `h-1` },
      { kind: `409-new`, handle: `h-2` },
      { kind: `409-new`, handle: `h-3` },
      { kind: `409-new`, handle: `h-4` },
      { kind: `409-new`, handle: `h-5` },
      { kind: `200` },
    ]
    const { stream, fetchCount } = makeStream(specs, captured)
    await stream.fetchSnapshot({ limit: 5, orderBy: `id ASC` })
    expect(fetchCount(), `exactly 6 fetches expected`).toBe(6)
    expect(captured.length).toBe(6)
  })

  it(`deterministic A: 6 consecutive 409s throws 502 on exactly the 6th fetch`, async () => {
    const captured: URL[] = []
    const specs: ResponseSpec[] = Array.from({ length: 6 }, (_, i) => ({
      kind: `409-new` as const,
      handle: `h-${i}`,
    }))
    const { stream, fetchCount } = makeStream(specs, captured)
    let thrown: unknown = null
    try {
      await stream.fetchSnapshot({ limit: 5, orderBy: `id ASC` })
    } catch (e) {
      thrown = e
    }
    expect(thrown, `expected a throw`).toBeInstanceOf(FetchError)
    expect((thrown as FetchError).status).toBe(502)
    expect((thrown as FetchError).message).toContain(`stuck in 409 retry loop`)
    // A retry loop that throws after the 6th 409 should NOT issue a
    // 7th fetch. #maxSnapshotRetries = 5, so attempts are {1..6} and
    // the 6th throws before a further call.
    expect(fetchCount(), `expected exactly 6 fetches before throwing`).toBe(6)
  })

  it(`deterministic B: every retry URL carries a distinct cache-buster`, async () => {
    const captured: URL[] = []
    const specs: ResponseSpec[] = [
      { kind: `409-new`, handle: `h-1` },
      { kind: `409-same` },
      { kind: `409-none` },
      { kind: `200` },
    ]
    const { stream } = makeStream(specs, captured)
    await stream.fetchSnapshot({ limit: 5, orderBy: `id ASC` })
    expect(captured.length).toBe(4)

    // First fetch has no cache-buster yet (initial call).
    // Every retry AFTER the first MUST carry a cache-buster param.
    const busters: Array<string | null> = captured.map((u) =>
      u.searchParams.get(`cache-buster`)
    )
    // captured[0] is the first attempt (no prior 409)
    // captured[1..3] are retries following 409s
    for (let i = 1; i < busters.length; i++) {
      expect(
        busters[i],
        `retry #${i} URL missing cache-buster: ${captured[i].toString()}`
      ).not.toBeNull()
    }
    // All cache busters across retries must be unique. A stale buster
    // would mean CDN caches could still serve the prior 409 response.
    const retryBusters = busters.slice(1) as string[]
    const uniq = new Set(retryBusters)
    expect(
      uniq.size,
      `retries shared a cache-buster: ${JSON.stringify(retryBusters)}`
    ).toBe(retryBusters.length)
  })

  it(`deterministic C: main stream state is preserved across snapshot 409 retries`, async () => {
    const captured: URL[] = []
    const specs: ResponseSpec[] = [
      { kind: `409-new`, handle: `h-1` },
      { kind: `409-new`, handle: `h-2` },
      { kind: `200` },
    ]
    const { stream } = makeStream(specs, captured)

    const preOffset = stream.lastOffset
    const preIsUpToDate = stream.isUpToDate
    await stream.fetchSnapshot({ limit: 5, orderBy: `id ASC` })
    // isUpToDate and offset are expected to be unchanged by the
    // snapshot retry loop itself — only a full message-stream update
    // should move them.
    expect(stream.lastOffset, `lastOffset moved mid-snapshot-retry`).toBe(
      preOffset
    )
    expect(stream.isUpToDate, `isUpToDate flipped mid-snapshot-retry`).toBe(
      preIsUpToDate
    )
    // Handle propagation: the stream should now reflect the last
    // handle it saw in a 409 header, not the success handle (since
    // the success response is processed but we did advance through
    // h-1 → h-2 via withHandle before the 200).
    expect(stream.shapeHandle).toBeDefined()
  })

  it(`deterministic D: main stream state is preserved across a 502-throwing snapshot retry loop`, async () => {
    const captured: URL[] = []
    const specs: ResponseSpec[] = Array.from({ length: 6 }, (_, i) => ({
      kind: `409-new` as const,
      handle: `h-${i}`,
    }))
    const { stream } = makeStream(specs, captured)

    const preOffset = stream.lastOffset
    const preIsUpToDate = stream.isUpToDate
    try {
      await stream.fetchSnapshot({ limit: 5, orderBy: `id ASC` })
    } catch {
      // expected
    }
    expect(stream.lastOffset, `offset leaked from failed retry loop`).toBe(
      preOffset
    )
    expect(stream.isUpToDate, `isUpToDate leaked from failed retry loop`).toBe(
      preIsUpToDate
    )
  })

  it(`deterministic D: handle propagates through 409-new responses into retry URLs`, async () => {
    const captured: URL[] = []
    const specs: ResponseSpec[] = [
      { kind: `409-new`, handle: `rotate-1` },
      { kind: `409-new`, handle: `rotate-2` },
      { kind: `200` },
    ]
    const { stream } = makeStream(specs, captured)
    await stream.fetchSnapshot({ limit: 5, orderBy: `id ASC` })
    // captured[0]: first attempt, no handle (fresh stream)
    // captured[1]: after first 409 with rotate-1 → URL should carry handle=rotate-1
    // captured[2]: after second 409 with rotate-2 → URL should carry handle=rotate-2
    expect(captured.length).toBe(3)
    expect(
      captured[1].searchParams.get(`handle`),
      `retry 1 should carry rotated handle`
    ).toBe(`rotate-1`)
    expect(
      captured[2].searchParams.get(`handle`),
      `retry 2 should carry rotated handle`
    ).toBe(`rotate-2`)
  })

  it(`PBT A+E: any sequence of N <= 5 409s followed by 200 uses exactly N+1 fetches`, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 5 }),
        async (conflictCount) => {
          const captured: URL[] = []
          const specs: ResponseSpec[] = [
            ...Array.from({ length: conflictCount }, (_, i) => ({
              kind: `409-new` as const,
              handle: `h-${i}`,
            })),
            { kind: `200` as const },
          ]
          const { stream, fetchCount } = makeStream(specs, captured)
          await stream.fetchSnapshot({ limit: 5, orderBy: `id ASC` })
          expect(
            fetchCount(),
            `conflictCount=${conflictCount}: expected ${conflictCount + 1} fetches`
          ).toBe(conflictCount + 1)
          return true
        }
      ),
      { ...pbtOpts, numRuns: Math.min(NUM_RUNS, 20) }
    )
  })

  it(`PBT A: 6+ consecutive 409s always throw 502 at exactly the 6th fetch`, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 6, max: 12 }),
        async (conflictCount) => {
          const captured: URL[] = []
          const specs: ResponseSpec[] = Array.from(
            { length: conflictCount },
            (_, i) => ({ kind: `409-new` as const, handle: `h-${i}` })
          )
          const { stream, fetchCount } = makeStream(specs, captured)
          let thrown: unknown = null
          try {
            await stream.fetchSnapshot({ limit: 5, orderBy: `id ASC` })
          } catch (e) {
            thrown = e
          }
          expect(
            thrown,
            `conflictCount=${conflictCount}: expected a FetchError`
          ).toBeInstanceOf(FetchError)
          expect((thrown as FetchError).status).toBe(502)
          expect(
            fetchCount(),
            `conflictCount=${conflictCount}: loop should stop at exactly 6 fetches`
          ).toBe(6)
          return true
        }
      ),
      { ...pbtOpts, numRuns: Math.min(NUM_RUNS, 10) }
    )
  })

  it(`PBT B: every retry (after a 409) carries a unique cache-buster`, async () => {
    // Sequence up to 5 409s (mixed kinds) then 200. Verify that every
    // retry URL carries a cache-buster and all of them are unique.
    const specArb: fc.Arbitrary<ResponseSpec> = fc.oneof(
      fc
        .integer({ min: 1, max: 9999 })
        .map((n) => ({ kind: `409-new` as const, handle: `h-${n}` })),
      fc.constant<ResponseSpec>({ kind: `409-same` }),
      fc.constant<ResponseSpec>({ kind: `409-none` })
    )

    await fc.assert(
      fc.asyncProperty(
        fc.array(specArb, { minLength: 0, maxLength: 5 }),
        async (conflicts) => {
          const captured: URL[] = []
          const specs: ResponseSpec[] = [...conflicts, { kind: `200` as const }]
          const { stream } = makeStream(specs, captured)
          await stream.fetchSnapshot({ limit: 5, orderBy: `id ASC` })

          // captured[0] is the initial attempt. captured[1..] are retries.
          const retryBusters: Array<string | null> = captured
            .slice(1)
            .map((u) => u.searchParams.get(`cache-buster`))
          for (let i = 0; i < retryBusters.length; i++) {
            expect(
              retryBusters[i],
              `retry #${i + 1} URL missing cache-buster`
            ).not.toBeNull()
          }
          const uniq = new Set(retryBusters)
          expect(
            uniq.size,
            `retries shared cache-busters: ${JSON.stringify(retryBusters)}`
          ).toBe(retryBusters.length)
          return true
        }
      ),
      { ...pbtOpts, numRuns: Math.min(NUM_RUNS, 20) }
    )
  })
})

// ═══════════════════════════════════════════════════════════════════
// TARGET 12: Shape#awaitUpToDate hangs forever on a terminally-
//            errored stream
// ═══════════════════════════════════════════════════════════════════
//
// shape.ts:260-277 #awaitUpToDate polls stream.isUpToDate via a 10ms
// setInterval and a new stream subscription. Neither the error
// callback nor the stream.error field are ever inspected:
//
//   async #awaitUpToDate(): Promise<void> {
//     if (this.stream.isUpToDate) return
//     await new Promise<void>((resolve) => {
//       const check = () => {
//         if (this.stream.isUpToDate) { ...; resolve() }
//       }
//       const interval = setInterval(check, 10)
//       const unsub = this.stream.subscribe(
//         () => check(),
//         () => check(),   // <-- sees the error, still only resolves on isUpToDate
//       )
//       check()
//     })
//   }
//
// When the real ShapeStream enters a terminal error state (e.g. a
// non-retryable 4xx, or a disposed stream with a sticky `error` set),
// isUpToDate stays false and there is no escape. All public callers
// of #awaitUpToDate — `shape.requestSnapshot` and the must-refetch
// reexecute path — hang indefinitely and never reject.

describe(`Shape #awaitUpToDate hangs on terminally-errored stream`, () => {
  type RowT = Row<unknown>

  class NeverUpToDateErrorStream implements ShapeStreamInterface<RowT> {
    isUpToDate = false
    lastOffset: Offset = `-1`
    shapeHandle: string | undefined = undefined
    error: unknown = new FetchError(
      403,
      `forbidden`,
      undefined,
      {},
      `http://mock/shape`,
      `forbidden`
    )
    mode: LogMode = `changes_only`

    #subs = new Set<(msgs: Message<RowT>[]) => void>()
    #errorSubs = new Set<(e: Error) => void>()

    subscribe(
      callback: (
        msgs: Message<RowT>[]
      ) => unknown | { columns?: (keyof RowT)[] },
      onError?: (e: Error) => void
    ): () => void {
      const fn = callback as (m: Message<RowT>[]) => void
      this.#subs.add(fn)
      if (onError) {
        this.#errorSubs.add(onError)
        // Mimic a real ShapeStream emitting the sticky error to every
        // new subscriber, exactly as client.ts does on subscribe when
        // the stream is already in its error-terminal state.
        queueMicrotask(() => onError(this.error as FetchError))
      }
      return () => {
        this.#subs.delete(fn)
        if (onError) this.#errorSubs.delete(onError)
      }
    }
    unsubscribeAll() {
      this.#subs.clear()
      this.#errorSubs.clear()
    }
    isLoading() {
      return false
    }
    lastSyncedAt() {
      return 0
    }
    lastSynced() {
      return 0
    }
    isConnected() {
      return false
    }
    hasStarted() {
      return true
    }
    async forceDisconnectAndRefresh() {}
    async requestSnapshot(_params: unknown) {
      return { metadata: {} as SnapshotMetadata, data: [] }
    }
    async fetchSnapshot() {
      return {
        metadata: {} as SnapshotMetadata,
        data: [] as ChangeMessage<RowT>[],
      }
    }
  }

  async function raceWithTimeout<T>(
    promise: Promise<T>,
    ms: number
  ): Promise<`resolved` | `rejected` | `timeout`> {
    return Promise.race([
      promise.then(
        () => `resolved` as const,
        () => `rejected` as const
      ),
      new Promise<`timeout`>((resolve) =>
        setTimeout(() => resolve(`timeout`), ms)
      ),
    ])
  }

  it(`deterministic: shape.requestSnapshot rejects (not hangs) when stream is in terminal error state`, async () => {
    const stream = new NeverUpToDateErrorStream()
    const shape = new Shape(stream)

    // The stream is already in a terminal error state, so a newly
    // issued requestSnapshot should propagate that error back to the
    // caller rather than silently wait for a happy state that can
    // never arrive.
    const p = shape.requestSnapshot({
      limit: 10,
      offset: 0,
      orderBy: `id ASC`,
    })

    const outcome = await raceWithTimeout(p, 150)

    // BUG: result is `timeout` — #awaitUpToDate polls isUpToDate and
    // never checks stream.error, so requestSnapshot can never unblock.
    expect(
      outcome,
      `shape.requestSnapshot should have rejected with the stream's terminal error, not hung`
    ).toBe(`rejected`)

    // Cleanup: release the poller so vitest doesn't leak the interval.
    stream.isUpToDate = true
    await new Promise((r) => setTimeout(r, 20))
  })

  it(`deterministic: reexecute after must-refetch does not hang the stream's message loop when subsequent up-to-date never arrives`, async () => {
    // Mirror scenario: stream delivers must-refetch followed by a
    // real up-to-date on a happy replay, but in an error path the
    // up-to-date never comes. #reexecuteSnapshots awaits
    // #awaitUpToDate and, having no error escape, the pending
    // reexecute promise is orphaned forever.

    class ControlledStream extends NeverUpToDateErrorStream {
      // Stays `false` until we flip it — replay never happens in this
      // scenario, simulating a stream that enters terminal error after
      // the must-refetch control is emitted.
      override isUpToDate = true
      override error: unknown = undefined
    }
    const stream = new ControlledStream()
    const shape = new Shape(stream)

    // Seed a subset request so #reexecuteSnapshots has work to do.
    await shape.requestSnapshot({ limit: 5, offset: 0, orderBy: `id ASC` })

    // Now push the stream into a fake terminal error state without
    // ever emitting a fresh up-to-date.
    stream.isUpToDate = false
    stream.error = new FetchError(
      503,
      `unavailable`,
      undefined,
      {},
      `http://mock/shape`,
      `unavailable`
    )

    // Issue a second user-facing requestSnapshot — the exact same
    // hang pattern as #reexecuteSnapshots because both paths go
    // through #awaitUpToDate.
    const p = shape.requestSnapshot({ limit: 5, offset: 5, orderBy: `id ASC` })
    const outcome = await raceWithTimeout(p, 150)

    expect(
      outcome,
      `requestSnapshot issued after terminal stream error should reject, not hang`
    ).toBe(`rejected`)

    stream.isUpToDate = true
    await new Promise((r) => setTimeout(r, 20))
  })

  it(`PBT: for any non-empty subset-params arbitrary, requestSnapshot on a terminal-error stream must not hang`, async () => {
    const subsetArb = fc.record({
      limit: fc.integer({ min: 1, max: 100 }),
      offset: fc.integer({ min: 0, max: 10_000 }),
      orderBy: fc.constantFrom(`id ASC`, `id DESC`, `created_at DESC`),
    })

    await fc.assert(
      fc.asyncProperty(subsetArb, async (subset) => {
        const stream = new NeverUpToDateErrorStream()
        const shape = new Shape(stream)

        const p = shape.requestSnapshot(subset)
        const outcome = await raceWithTimeout(p, 100)

        try {
          expect(
            outcome,
            `subset=${JSON.stringify(subset)} — requestSnapshot hung on terminal error`
          ).toBe(`rejected`)
        } finally {
          stream.isUpToDate = true
          await new Promise((r) => setTimeout(r, 5))
        }
        return true
      }),
      { ...pbtOpts, numRuns: Math.min(NUM_RUNS, 10) }
    )
  })
})
