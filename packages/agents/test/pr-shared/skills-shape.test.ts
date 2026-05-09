import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const S = (name: string) =>
  readFileSync(path.resolve(HERE, `../../skills`, `pr-${name}`), `utf8`)

const COMMON = [
  `agents_disabled`,
  `iterations`,
  `cap`,
  `consumed_by`,
  `persistent timeline`,
]

describe(`skill bodies`, () => {
  it.each([`manager.md`, `reviewer.md`, `build-doctor.md`, `doc-editor.md`])(
    `%s mentions the protocol invariants`,
    (file) => {
      const body = S(file)
      for (const tok of COMMON) expect(body).toContain(tok)
    }
  )

  it(`reviewer.md describes review/address two-pass decision tree`, () => {
    const r = S(`reviewer.md`)
    for (const t of [
      `review pass`,
      `address pass`,
      `last_reviewed_sha`,
      `iterations_skipped_since_review`,
      `review_skipped`,
      `review_complete`,
    ]) {
      expect(r).toContain(t)
    }
  })

  it(`build-doctor.md references reproduce-in-worktree and check timeline`, () => {
    const b = S(`build-doctor.md`)
    for (const t of [`failing`, `reproduce`, `timeline`, `commits_pushed`])
      expect(b).toContain(t)
  })

  it(`doc-editor.md emits a no-op doc_plan row when no doc changes are needed`, () => {
    const d = S(`doc-editor.md`)
    expect(d).toContain(`no doc changes required`)
    expect(d).toContain(`doc_plan`)
  })

  it(`manager.md describes gate evaluation + status comment + label`, () => {
    const m = S(`manager.md`)
    for (const t of [
      `ready_to_merge`,
      `agents:ready`,
      `gate_state_changed`,
      `status_comment_id`,
    ]) {
      expect(m).toContain(t)
    }
  })
})
