import type { DiscordRest } from '../discord-rest'

export interface EnsureThreadInput {
  rest: DiscordRest
  message: {
    id: string
    channel_id: string
    channel_is_thread: boolean
    threadName?: string
  }
}

export async function ensureThreadForMention(
  input: EnsureThreadInput
): Promise<string> {
  if (input.message.channel_is_thread) return input.message.channel_id
  const name = (input.message.threadName ?? `Electric bot session`).slice(
    0,
    100
  )
  const thread = (await input.rest.post(
    `/channels/${input.message.channel_id}/messages/${input.message.id}/threads`,
    { name, auto_archive_duration: 1440 }
  )) as { id: string }
  return thread.id
}
