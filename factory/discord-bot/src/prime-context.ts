import type { ChannelMessage } from './wake-message'

export interface PrimeContextEntry {
  key: string
  text: string
  attrs: { role: `background`; source: `discord-channel` }
}

export function buildPrimeContextEntries(input: {
  channelId: string
  threadId: string
  messages: ReadonlyArray<ChannelMessage>
}): Array<PrimeContextEntry> {
  if (input.messages.length === 0) return []
  const sorted = [...input.messages].sort((a, b) => a.timestamp - b.timestamp)
  const body = sorted.map((m) => `${m.author}: ${m.content}`).join(`\n`)
  return [
    {
      key: `discord-prime-${input.channelId}-${input.threadId}`,
      text:
        `# Recent messages in the parent channel (#${input.channelId})\n` +
        `These were the last messages before this thread started; treat as background.\n\n` +
        body,
      attrs: { role: `background`, source: `discord-channel` },
    },
  ]
}
