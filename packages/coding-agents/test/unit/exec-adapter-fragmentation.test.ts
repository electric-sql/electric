import { describe, it, expect } from 'vitest'
import { StreamQueue } from '../../src/providers/fly-sprites/exec-adapter'

// Tier 2 Phase A: regression fuzz for the C2 line-tail-buffer fix in
// providers/fly-sprites/exec-adapter.ts. Splits each canonical input
// at random points and asserts every partition produces the same line
// sequence as the un-split reference.

// Deterministic LCG → seed-stable cuts.
function partition(s: string, seed: number): Array<string> {
  let state = seed >>> 0
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state
  }
  const cutCount = next() % 9
  const cuts = Array.from(
    { length: cutCount },
    () => next() % (s.length + 1)
  ).sort((a, b) => a - b)
  const out: Array<string> = []
  let prev = 0
  for (const c of cuts) {
    out.push(s.slice(prev, c))
    prev = c
  }
  out.push(s.slice(prev))
  return out
}

async function lineSeq(parts: Array<string>): Promise<Array<string>> {
  const q = new StreamQueue()
  for (const p of parts) q.feed(p)
  q.end()
  const out: Array<string> = []
  const iter = q.iterator()
  for (;;) {
    const r = await iter.next()
    if (r.done) break
    out.push(r.value)
  }
  return out
}

describe(`StreamQueue.feed — fragmentation fuzz (C2 regression)`, () => {
  // Inputs cover the typical claude/codex stream-json shape: short
  // JSONL lines plus a few mid-line splits, plus inputs without a
  // trailing newline (the bug's natural habitat).
  const inputs = [
    `a\nb\nc\n`,
    `a\nb\nc`,
    `\n\n\n`,
    `single line, no newline`,
    `{"type":"session_init"}\n{"type":"assistant_message","text":"hello"}\n`,
    `line1\nline2\nline3\nline4\nline5\n`,
    `prefix\nx`.repeat(20),
  ]

  for (const input of inputs) {
    it(`partitioned feed equals whole feed: ${JSON.stringify(input.slice(0, 40))}`, async () => {
      const reference = await lineSeq([input])
      for (let seed = 1; seed <= 200; seed++) {
        const parts = partition(input, seed)
        const got = await lineSeq(parts)
        expect(got, `seed=${seed} parts=${JSON.stringify(parts)}`).toEqual(
          reference
        )
      }
    })
  }
})
