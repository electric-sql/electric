import { ref, onUnmounted, type Ref } from 'vue'

export interface StreamEvent {
  /** Monotonic offset (ULID-like, sortable) */
  id: string
  type: `user` | `product`
  /** Logical key — e.g. user id */
  key: string
  /** Operation: "insert" produces a new key; "update" mutates an existing one. */
  op: `insert` | `update`
  /** Materialized value at this offset for `key` */
  value: Record<string, any>
  /** Serialized JSON form (the wire shape) */
  raw: string
  timestamp: number
}

interface Fixture {
  type: `user` | `product`
  key: string
  base: Record<string, any>
  /** Subsequent updates applied in order, then cycled. */
  updates: Record<string, any>[]
}

/**
 * A small, deterministic-looking pool. Each simulator step picks the next
 * fixture in round-robin order, and alternates between insert (first time
 * we see the key) and update (subsequent visits).
 */
const FIXTURES: Fixture[] = [
  {
    type: `user`,
    key: `u_01`,
    base: { name: `Alice`, role: `admin`, status: `online` },
    updates: [{ status: `away` }, { role: `owner` }, { status: `online` }],
  },
  {
    type: `user`,
    key: `u_02`,
    base: { name: `Bob`, role: `viewer`, status: `online` },
    updates: [{ role: `editor` }, { status: `offline` }, { status: `online` }],
  },
  {
    type: `user`,
    key: `u_03`,
    base: { name: `Carol`, role: `editor`, status: `online` },
    updates: [{ status: `away` }, { role: `admin` }, { status: `online` }],
  },
  {
    type: `user`,
    key: `u_04`,
    base: { name: `Dan`, role: `viewer`, status: `online` },
    updates: [{ status: `offline` }, { role: `editor` }, { status: `online` }],
  },
  {
    type: `user`,
    key: `u_05`,
    base: { name: `Eve`, role: `owner`, status: `online` },
    updates: [{ status: `away` }, { role: `admin` }, { status: `online` }],
  },
]

/** Crockford-style base32 alphabet, used for ULID-ish offsets */
const CROCKFORD = `0123456789ABCDEFGHJKMNPQRSTVWXYZ`

function makeOffset(seq: number): string {
  // Encode seq into base32, left-padded to 4 chars, with a fixed prefix that
  // looks ULID-y so it reads as a real monotonic stream offset.
  let n = seq
  let suffix = ``
  for (let i = 0; i < 4; i++) {
    suffix = CROCKFORD[n & 0x1f] + suffix
    n >>>= 5
  }
  return `01JQXK5V${suffix.padStart(4, `0`)}`
}

export interface StreamSimulator {
  events: Ref<StreamEvent[]>
  latest: Ref<StreamEvent | null>
  reset: () => void
  destroy: () => void
}

export function useStreamSimulator(
  opts: {
    intervalMs?: number
    paused?: () => boolean
    /** Pre-seed N events so panels aren't empty on first paint. */
    seed?: number
  } = {}
): StreamSimulator {
  const intervalMs = opts.intervalMs ?? 2500
  const seedCount = opts.seed ?? 0

  const events = ref<StreamEvent[]>([])
  const latest = ref<StreamEvent | null>(null)

  let seq = 0
  /** How many times we've visited each key — drives insert vs. update */
  const visits = new Map<string, number>()
  /** Last materialized value per key — so updates merge cleanly */
  const materialized = new Map<string, Record<string, any>>()

  function buildEvent(): StreamEvent {
    const fx = FIXTURES[seq % FIXTURES.length]
    const visitCount = visits.get(fx.key) ?? 0
    visits.set(fx.key, visitCount + 1)

    const isInsert = visitCount === 0
    let value: Record<string, any>
    if (isInsert) {
      value = { id: fx.key, ...fx.base }
    } else {
      const update = fx.updates[(visitCount - 1) % fx.updates.length]
      const prev = materialized.get(fx.key) ?? { id: fx.key, ...fx.base }
      value = { ...prev, ...update }
    }
    materialized.set(fx.key, value)

    const id = makeOffset(seq)
    const ev: StreamEvent = {
      id,
      type: fx.type,
      key: fx.key,
      op: isInsert ? `insert` : `update`,
      value,
      raw: JSON.stringify({
        offset: id,
        type: fx.type,
        key: fx.key,
        value,
        headers: { operation: isInsert ? `insert` : `update` },
      }),
      timestamp: Date.now(),
    }
    seq++
    return ev
  }

  function tick() {
    if (opts.paused?.()) return
    const ev = buildEvent()
    latest.value = ev
    events.value = [...events.value, ev]
    // Cap retained history so the array doesn't grow without bound.
    if (events.value.length > 200) {
      events.value = events.value.slice(-200)
    }
  }

  function reset() {
    seq = 0
    visits.clear()
    materialized.clear()
    events.value = []
    latest.value = null
    if (seedCount > 0) {
      for (let i = 0; i < seedCount; i++) {
        const ev = buildEvent()
        latest.value = ev
        events.value.push(ev)
      }
    }
  }

  reset()

  const handle = setInterval(tick, intervalMs)

  function destroy() {
    clearInterval(handle)
  }

  onUnmounted(destroy)

  return { events, latest, reset, destroy }
}
