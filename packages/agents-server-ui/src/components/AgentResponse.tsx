import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Streamdown } from 'streamdown'
import { createCodePlugin } from '../lib/codeHighlighter'
import {
  getCachedMarkdownRender,
  hashMarkdownContent,
  isMarkdownRenderCacheReady,
  setCachedMarkdownRender,
  warmMarkdownRenderCache,
} from '../lib/markdownRenderCache'
import { Stack, Text } from '../ui'
import { ToolCallView } from './ToolCallView'
import styles from './AgentResponse.module.css'
import type {
  EntityTimelineContentItem,
  EntityTimelineSection,
} from '@electric-ax/agents-runtime'

type AgentResponseSection = Extract<
  EntityTimelineSection,
  { kind: `agent_response` }
>

const SHIKI_SETTLE_MS = 80

const codePluginSingleton = createCodePlugin()
const streamdownPlugins = { code: codePluginSingleton }

const MarkdownSegment = memo(function MarkdownSegment({
  text,
  contentHash,
  isStreaming,
  renderWidth,
  canCache,
}: {
  text: string
  contentHash: number
  isStreaming: boolean
  renderWidth: number
  canCache: boolean
}): React.ReactElement {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  // Tracks the content hash that the currently-displayed `cachedHtml`
  // belongs to, so we can distinguish "the underlying text changed and our
  // cached HTML is now stale" from "only the column width changed and our
  // cached HTML is still semantically correct, just laid out for a
  // different width".
  const cachedHtmlHashRef = useRef<number | null>(null)
  const [cachedHtml, setCachedHtmlState] = useState<string | null>(() => {
    if (!canCache || !isMarkdownRenderCacheReady() || renderWidth <= 0)
      return null
    const hit = getCachedMarkdownRender(contentHash, renderWidth, text)
    if (!hit) return null
    cachedHtmlHashRef.current = contentHash
    return hit.html
  })

  const setCachedHtml = (next: string | null, hash: number | null) => {
    cachedHtmlHashRef.current = next === null ? null : hash
    setCachedHtmlState(next)
  }

  useEffect(() => {
    if (!canCache) {
      setCachedHtml(null, null)
      return
    }

    const cached =
      renderWidth > 0
        ? getCachedMarkdownRender(contentHash, renderWidth, text)
        : null
    if (cached) {
      setCachedHtml(cached.html, contentHash)
      return
    }

    // Cache miss at the requested width.
    //
    // - If the displayed `cachedHtml` belongs to a DIFFERENT content hash
    //   (e.g. the agent message text was replaced after streaming ended,
    //   or this row was reused for a different segment), drop it
    //   immediately so we render the new content via Streamdown.
    //
    // - If it belongs to the SAME content hash, KEEP showing it: the
    //   cached HTML is just static markup and reflows correctly at any
    //   width. Dropping back to a live Streamdown render here would
    //   briefly clear the row and produce a visible flicker plus a
    //   row-height jump that the virtualizer has to chase.
    if (cachedHtmlHashRef.current !== contentHash) {
      setCachedHtml(null, null)
    }

    let cancelled = false
    void warmMarkdownRenderCache().then(() => {
      if (cancelled) return
      const resolvedWidth =
        renderWidth > 0
          ? renderWidth
          : Math.round(wrapperRef.current?.getBoundingClientRect().width ?? 0)
      if (resolvedWidth <= 0) return
      const hit = getCachedMarkdownRender(contentHash, resolvedWidth, text)
      if (hit) setCachedHtml(hit.html, contentHash)
    })

    return () => {
      cancelled = true
    }
  }, [canCache, contentHash, renderWidth, text])

  useLayoutEffect(() => {
    if (!canCache || cachedHtml !== null) return

    const element = wrapperRef.current
    if (!element) return

    let settledTimer: ReturnType<typeof setTimeout> | null = null
    let disposed = false

    const capture = () => {
      if (disposed) return
      const html = element.innerHTML
      const rect = element.getBoundingClientRect()
      const width = Math.round(rect.width)
      const height = Math.round(rect.height)

      if (html.length === 0 || width <= 0 || height <= 0) return
      setCachedMarkdownRender(contentHash, {
        html,
        width,
        height,
        sourceText: text,
      })
    }

    const scheduleCapture = () => {
      if (settledTimer !== null) {
        clearTimeout(settledTimer)
      }
      settledTimer = setTimeout(capture, SHIKI_SETTLE_MS)
    }

    const observer = new MutationObserver(scheduleCapture)
    observer.observe(element, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    })
    scheduleCapture()

    return () => {
      disposed = true
      observer.disconnect()
      if (settledTimer !== null) {
        clearTimeout(settledTimer)
      }
    }
  }, [cachedHtml, canCache, contentHash, text])

  // When we are displaying previously cached HTML at a width that itself
  // has no cache entry yet (e.g. the column resized after we cached at
  // an earlier width), re-persist the same HTML keyed by the new
  // measured width so subsequent lookups at this width hit immediately
  // and we never have to drop back to a live Streamdown re-render.
  useLayoutEffect(() => {
    if (!canCache) return
    if (cachedHtml === null) return

    const element = wrapperRef.current
    if (!element) return

    const rect = element.getBoundingClientRect()
    const width = Math.round(rect.width)
    const height = Math.round(rect.height)
    if (width <= 0 || height <= 0) return

    if (getCachedMarkdownRender(contentHash, width, text)) return
    setCachedMarkdownRender(contentHash, {
      html: cachedHtml,
      width,
      height,
      sourceText: text,
    })
  }, [cachedHtml, canCache, contentHash, renderWidth, text])

  if (cachedHtml !== null) {
    return (
      <div
        ref={wrapperRef}
        className={`agent-ui-markdown ${styles.markdown}`}
        dangerouslySetInnerHTML={{ __html: cachedHtml }}
      />
    )
  }

  return (
    <div ref={wrapperRef} className={`agent-ui-markdown ${styles.markdown}`}>
      <Streamdown
        isAnimating={isStreaming}
        plugins={streamdownPlugins}
        linkSafety={{ enabled: false }}
      >
        {text}
      </Streamdown>
    </div>
  )
})

export const AgentResponse = memo(function AgentResponse({
  section,
  isStreaming,
  timestamp,
  renderWidth = 0,
}: {
  section: AgentResponseSection
  isStreaming: boolean
  timestamp?: number | null
  renderWidth?: number
}): React.ReactElement {
  const time = timestamp
    ? new Date(timestamp).toLocaleTimeString([], {
        hour: `2-digit`,
        minute: `2-digit`,
      })
    : null

  const canCache = !isStreaming && section.done === true

  return (
    <Stack direction="column" gap={2} className={styles.root}>
      {section.items.map((item: EntityTimelineContentItem, i: number) => {
        if (item.kind === `text`) {
          const isLastText = isStreaming && i === section.items.length - 1
          const contentHash = canCache ? hashMarkdownContent(item.text) : 0
          return (
            <MarkdownSegment
              key={`text-${i}`}
              text={item.text}
              contentHash={contentHash}
              isStreaming={isLastText}
              renderWidth={renderWidth}
              canCache={canCache}
            />
          )
        }

        return <ToolCallView key={item.toolCallId} item={item} />
      })}

      <Stack align="center" gap={3}>
        {section.done && (
          <Text size={1} tone="muted" className={styles.doneText}>
            ✓ done
          </Text>
        )}
        {section.error && (
          <Text size={1} tone="danger">
            ✗ {section.error}
          </Text>
        )}
        {time && (
          <Text size={1} tone="muted" className={styles.timeText}>
            {time}
          </Text>
        )}
      </Stack>
    </Stack>
  )
})
