// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { ReasoningBlock, type ReasoningEntry } from './ReasoningSection'

beforeAll(() => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

const streamingEntry: ReasoningEntry = {
  key: `reasoning-1`,
  order: `1`,
  content: `Inspecting the code.`,
  status: `streaming`,
  summary_title: `Inspecting code`,
}

function renderReasoningBlock(
  root: Root,
  entry: ReasoningEntry,
  isStreaming: boolean
): void {
  act(() => {
    root.render(
      <ReasoningBlock
        entry={entry}
        isStreaming={isStreaming}
        expanded={false}
        onToggle={() => {}}
      />
    )
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe(`ReasoningBlock`, () => {
  it(`anchors live thinking elapsed time to the reasoning block start, not the run start`, () => {
    vi.useFakeTimers()
    try {
      const runStartedAt = new Date(`2026-01-01T00:00:00.000Z`).getTime()
      vi.setSystemTime(runStartedAt + 5 * 60 * 1000)

      const markup = renderToStaticMarkup(
        <ReasoningBlock
          entry={streamingEntry}
          isStreaming={true}
          expanded={false}
          onToggle={() => {}}
        />
      )

      expect(markup).toContain(`Elapsed time: 0s`)
      expect(markup).not.toContain(`Elapsed time: 5m`)
    } finally {
      vi.useRealTimers()
    }
  })

  it(`snapshots the reasoning duration when a live block completes`, () => {
    vi.useFakeTimers()
    const container = document.createElement(`div`)
    document.body.appendChild(container)
    const root = createRoot(container)

    try {
      const startedAt = new Date(`2026-01-01T00:00:00.000Z`).getTime()
      vi.setSystemTime(startedAt)
      renderReasoningBlock(root, streamingEntry, true)

      vi.setSystemTime(startedAt + 3_000)
      renderReasoningBlock(
        root,
        { ...streamingEntry, status: `completed` },
        false
      )

      expect(container.textContent).toContain(`Thought for 3s`)
    } finally {
      act(() => root.unmount())
      container.remove()
      vi.useRealTimers()
    }
  })
})
