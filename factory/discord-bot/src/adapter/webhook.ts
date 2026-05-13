import type { DiscordWakeMessage } from '../wake-message'

export interface WakeWebhookConfig {
  agentsServerUrl: string
  agentsServerToken: string
  fetch?: typeof globalThis.fetch
}

export interface WakeWebhookPayload {
  entityType: string
  entityId: string
  message: DiscordWakeMessage
}

export type WakeWebhookPoster = (payload: WakeWebhookPayload) => Promise<void>

export function createWakeWebhookPoster(
  cfg: WakeWebhookConfig
): WakeWebhookPoster {
  const fetchFn = cfg.fetch ?? globalThis.fetch
  const url = `${cfg.agentsServerUrl.replace(/\/$/, ``)}/webhook/discord-bot`
  return async (payload) => {
    const res = await fetchFn(url, {
      method: `POST`,
      headers: {
        'Content-Type': `application/json`,
        Authorization: `Bearer ${cfg.agentsServerToken}`,
      },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => ``)
      throw new Error(`wake webhook ${url} returned ${res.status}: ${body}`)
    }
  }
}
