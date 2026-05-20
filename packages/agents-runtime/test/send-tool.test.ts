import { describe, expect, it, vi } from 'vitest'
import { createSendTool } from '../src/tools/send'

describe(`send tool`, () => {
  it(`calls the runtime send function with target, payload, type, and delay`, async () => {
    const send = vi.fn(async () => ({
      sent: true as const,
      targetUrl: `http://localhost:4437/entities/agent-1`,
    }))
    const tool = createSendTool(send)

    const result = await tool.execute?.(`call-1`, {
      entityUrl: `http://localhost:4437/entities/agent-1`,
      payload: { text: `hello` },
      type: `note`,
      afterMs: 250,
    })

    expect(send).toHaveBeenCalledWith(
      `http://localhost:4437/entities/agent-1`,
      { text: `hello` },
      { type: `note`, afterMs: 250 }
    )
    expect(result).toMatchObject({
      details: {},
      content: [
        {
          type: `text`,
          text: JSON.stringify(
            {
              sent: true,
              entityUrl: `http://localhost:4437/entities/agent-1`,
              type: `note`,
              afterMs: 250,
              result: {
                sent: true,
                targetUrl: `http://localhost:4437/entities/agent-1`,
              },
            },
            null,
            2
          ),
        },
      ],
    })
  })

  it(`returns structured error results when send fails`, async () => {
    const send = vi.fn(async () => {
      throw new Error(`server returned 500`)
    })
    const tool = createSendTool(send)

    const result = await tool.execute?.(`call-1`, {
      entityUrl: `http://localhost:4437/entities/agent-1`,
      payload: `hello`,
    })

    expect(result).toMatchObject({
      details: {},
      content: [
        {
          type: `text`,
          text: JSON.stringify(
            {
              sent: false,
              error: true,
              entityUrl: `http://localhost:4437/entities/agent-1`,
              message: `Failed to send to http://localhost:4437/entities/agent-1: server returned 500`,
            },
            null,
            2
          ),
        },
      ],
    })
  })

  it(`rejects invalid delay values`, async () => {
    const tool = createSendTool(
      vi.fn(async () => ({ sent: true, targetUrl: `target` }))
    )

    await expect(
      tool.execute?.(`call-1`, {
        entityUrl: `target`,
        payload: `hello`,
        afterMs: -1,
      })
    ).rejects.toThrow(`afterMs must be a non-negative finite number`)
  })
})
