import { describe, expect, it } from 'vitest'
import { OpencodeAdapter } from '../../src/agents/opencode'

describe(`OpencodeAdapter — invocation shape`, () => {
  it(`baseline argv has run --format json --dangerously-skip-permissions and prompt on stdin`, () => {
    const r = OpencodeAdapter.buildCliInvocation({ prompt: `hi there` })
    expect(r.promptDelivery).toBe(`stdin`)
    expect(r.args[0]).toBe(`run`)
    expect(r.args).toContain(`--format`)
    expect(r.args).toContain(`json`)
    expect(r.args).toContain(`--dangerously-skip-permissions`)
    // Stdin delivery means no positional prompt and no trailing `--`.
    expect(r.args).not.toContain(`--`)
    expect(r.args).not.toContain(`hi there`)
  })

  it(`includes -m model when model is passed`, () => {
    const r = OpencodeAdapter.buildCliInvocation({
      prompt: `hi`,
      model: `anthropic/claude-haiku-4-5`,
    })
    const args = Array.from(r.args)
    const i = args.indexOf(`-m`)
    expect(i).toBeGreaterThan(-1)
    expect(args[i + 1]).toBe(`anthropic/claude-haiku-4-5`)
  })

  it(`includes -s sessionId when nativeSessionId is passed`, () => {
    const r = OpencodeAdapter.buildCliInvocation({
      prompt: `continue`,
      nativeSessionId: `ses_xyz789`,
    })
    const args = Array.from(r.args)
    const i = args.indexOf(`-s`)
    expect(i).toBeGreaterThan(-1)
    expect(args[i + 1]).toBe(`ses_xyz789`)
  })

  it(`captureCommand pipes opencode export through base64`, () => {
    const cmd = OpencodeAdapter.captureCommand({
      homeDir: `/home/agent`,
      cwd: `/work`,
      sessionId: `ses_abc`,
    })
    expect(cmd[0]).toBe(`sh`)
    // sessionId is shell-quoted to defend against injection.
    expect(cmd.join(` `)).toContain(`opencode export 'ses_abc'`)
    expect(cmd.join(` `)).toContain(`base64`)
  })

  it(`probeCommand checks opencode session list for the id`, () => {
    const cmd = OpencodeAdapter.probeCommand({
      homeDir: `/home/agent`,
      cwd: `/work`,
      sessionId: `ses_abc`,
    })
    expect(cmd[0]).toBe(`sh`)
    expect(cmd.join(` `)).toContain(`opencode session list`)
    expect(cmd.join(` `)).toContain(`ses_abc`)
  })

  it(`materialiseTargetPath is a /tmp path keyed by sessionId`, () => {
    const p = OpencodeAdapter.materialiseTargetPath({
      homeDir: `/home/agent`,
      cwd: `/work`,
      sessionId: `ses_abc`,
    })
    expect(p).toContain(`/tmp/`)
    expect(p).toContain(`ses_abc`)
  })

  it(`postMaterialiseCommand runs opencode import then removes the temp file`, () => {
    const cmd = OpencodeAdapter.postMaterialiseCommand!({
      homeDir: `/home/agent`,
      cwd: `/work`,
      sessionId: `ses_abc`,
    })
    expect(cmd[0]).toBe(`sh`)
    expect(cmd.join(` `)).toContain(`opencode import`)
    expect(cmd.join(` `)).toContain(`rm -f`)
    expect(cmd.join(` `)).toContain(`ses_abc`)
  })

  it(`defaultEnvVars includes both ANTHROPIC and OPENAI keys`, () => {
    expect(OpencodeAdapter.defaultEnvVars).toContain(`ANTHROPIC_API_KEY`)
    expect(OpencodeAdapter.defaultEnvVars).toContain(`OPENAI_API_KEY`)
  })

  it(`cliBinary is opencode and kind is opencode`, () => {
    expect(OpencodeAdapter.cliBinary).toBe(`opencode`)
    expect(OpencodeAdapter.kind).toBe(`opencode`)
  })
})
