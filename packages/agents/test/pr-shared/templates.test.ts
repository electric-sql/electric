import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url))

const T = (name: string) =>
  readFileSync(
    path.resolve(TEST_DIR, `../../skills/pr/templates`, name),
    `utf8`
  )

describe(`templates`, () => {
  it(`pr-description.md has the three required headings and the managed-summary markers`, () => {
    const t = T(`pr-description.md`)
    for (const h of [`## Summary`, `## Linked issues`, `## Test plan`])
      expect(t).toContain(h)
    expect(t).toContain(`<!-- agent-managed:summary -->`)
    expect(t).toContain(`<!-- /agent-managed:summary -->`)
  })
  it(`review-thread.md has placeholders + agent-thread-id trailer`, () => {
    const t = T(`review-thread.md`)
    expect(t).toContain(`{severity}`)
    expect(t).toContain(`{category}`)
    expect(t).toContain(`{body}`)
    expect(t).toContain(`agent-thread-id`)
  })
  it(`status-comment.md is a reference copy with the trailer`, () => {
    expect(T(`status-comment.md`)).toContain(`<!-- agent-managed-status -->`)
  })
  it(`commit-message.md describes the [agent:role] subject prefix`, () => {
    expect(T(`commit-message.md`)).toMatch(/\[agent:\{role\}\]/)
  })
  it(`thread-reply.md uses the addressed-in-{sha} format`, () => {
    expect(T(`thread-reply.md`)).toContain(`Addressed in {sha}`)
  })
})
