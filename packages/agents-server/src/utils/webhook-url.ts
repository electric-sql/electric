export function rewriteLoopbackWebhookUrl(
  value: string | undefined
): string | undefined {
  if (!value) return undefined

  const rewriteTarget =
    process.env.ELECTRIC_AGENTS_REWRITE_LOOPBACK_WEBHOOKS_TO?.trim()
  if (!rewriteTarget) return value

  const url = new URL(value)
  if (!isLoopbackHostname(url.hostname)) {
    return value
  }

  if (rewriteTarget.includes(`://`)) {
    const target = new URL(rewriteTarget)
    url.protocol = target.protocol
    url.username = target.username
    url.password = target.password
    url.hostname = target.hostname
    url.port = target.port
    return url.toString()
  }

  url.host = rewriteTarget
  return url.toString()
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === `localhost` || hostname === `127.0.0.1` || hostname === `::1`
  )
}
