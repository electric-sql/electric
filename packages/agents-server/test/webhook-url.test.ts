import { afterEach, describe, expect, it } from 'vitest'
import { rewriteLoopbackWebhookUrl } from '../src/webhook-url'

describe(`rewriteLoopbackWebhookUrl`, () => {
  afterEach(() => {
    delete process.env.ELECTRIC_AGENTS_REWRITE_LOOPBACK_WEBHOOKS_TO
  })

  it(`rewrites localhost webhook URLs when configured`, () => {
    process.env.ELECTRIC_AGENTS_REWRITE_LOOPBACK_WEBHOOKS_TO = `host.docker.internal`

    expect(rewriteLoopbackWebhookUrl(`http://localhost:3000/webhook`)).toBe(
      `http://host.docker.internal:3000/webhook`
    )
    expect(rewriteLoopbackWebhookUrl(`http://127.0.0.1:3000/webhook`)).toBe(
      `http://host.docker.internal:3000/webhook`
    )
  })

  it(`supports a full replacement origin`, () => {
    process.env.ELECTRIC_AGENTS_REWRITE_LOOPBACK_WEBHOOKS_TO = `https://devbox.internal:8443`

    expect(rewriteLoopbackWebhookUrl(`http://localhost:3000/webhook`)).toBe(
      `https://devbox.internal:8443/webhook`
    )
  })

  it(`leaves non-loopback URLs unchanged`, () => {
    process.env.ELECTRIC_AGENTS_REWRITE_LOOPBACK_WEBHOOKS_TO = `host.docker.internal`

    expect(rewriteLoopbackWebhookUrl(`http://runtime:3000/webhook`)).toBe(
      `http://runtime:3000/webhook`
    )
  })
})
