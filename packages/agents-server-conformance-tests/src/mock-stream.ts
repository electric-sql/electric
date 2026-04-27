import type { StreamFn } from '@mariozechner/pi-agent-core'

export function createMockStreamFn(text: string): StreamFn {
  return () => {
    const partial = {
      role: `assistant` as const,
      stopReason: `stop` as const,
      content: [] as Array<{ type: `text`; text: string }>,
      api: `anthropic-messages` as const,
      provider: `anthropic` as const,
      model: `mock`,
      usage: {
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 15,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
      timestamp: Date.now(),
    }
    partial.content.push({ type: `text`, text: `` })

    const events: Array<unknown> = []
    events.push({ type: `start`, partial })
    events.push({ type: `text_start`, contentIndex: 0, partial })
    const chunks = text.match(/.{1,10}/g) ?? [text]
    for (const chunk of chunks) {
      const textContent = partial.content[0]
      if (textContent) textContent.text += chunk
      events.push({
        type: `text_delta`,
        contentIndex: 0,
        delta: chunk,
        partial,
      })
    }
    const textContent = partial.content[0]
    events.push({
      type: `text_end`,
      contentIndex: 0,
      content: textContent?.text ?? ``,
      partial,
    })
    events.push({ type: `done`, reason: `stop`, message: partial })

    let resolved = false
    let resolveResult!: (v: unknown) => void
    const resultPromise = new Promise((res) => {
      resolveResult = res
    })

    const asyncIterable = {
      [Symbol.asyncIterator]() {
        let idx = 0
        return {
          async next() {
            if (idx < events.length) {
              const value = events[idx++]
              if (
                !resolved &&
                (value as Record<string, unknown>).type === `done`
              ) {
                resolved = true
                resolveResult((value as Record<string, unknown>).message)
              }
              return { value, done: false } as IteratorYieldResult<unknown>
            }
            return {
              value: undefined,
              done: true,
            } as IteratorReturnResult<undefined>
          },
        }
      },
      result() {
        return resultPromise
      },
    }
    return asyncIterable as ReturnType<StreamFn>
  }
}
