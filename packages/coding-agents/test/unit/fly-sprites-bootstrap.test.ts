import { describe, expect, it } from 'vitest'
import { BOOTSTRAP_SCRIPT } from '../../src/providers/fly-sprites/bootstrap'

describe(`Sprites bootstrap script`, () => {
  it(`includes idempotency marker check`, () => {
    expect(BOOTSTRAP_SCRIPT).toContain(`/opt/electric-ax/.bootstrapped`)
    expect(BOOTSTRAP_SCRIPT).toContain(`exit 0`)
  })

  it(`installs opencode-ai pinned (claude + codex are preinstalled in the sprite image)`, () => {
    expect(BOOTSTRAP_SCRIPT).toContain(`opencode-ai@1.14.31`)
  })

  it(`sanity-checks all three CLIs after install`, () => {
    expect(BOOTSTRAP_SCRIPT).toContain(`claude --version`)
    expect(BOOTSTRAP_SCRIPT).toContain(`codex --version`)
    expect(BOOTSTRAP_SCRIPT).toContain(`opencode --version`)
  })

  it(`creates /work and /run/agent.env`, () => {
    expect(BOOTSTRAP_SCRIPT).toContain(`mkdir -p /work`)
    expect(BOOTSTRAP_SCRIPT).toContain(`/run/agent.env`)
  })

  it(`writes the marker file at the end`, () => {
    expect(BOOTSTRAP_SCRIPT).toContain(`touch /opt/electric-ax/.bootstrapped`)
  })

  it(`is set -e so failures abort early`, () => {
    expect(BOOTSTRAP_SCRIPT).toContain(`set -e`)
  })
})
