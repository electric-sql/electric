import { useCallback, useEffect, useRef, useState } from 'react'
import { usePaneFind, usePaneFindRegistration } from '../../hooks/usePaneFind'
import styles from './PaneFindBar.module.css'

type Match = { node: Text; start: number; end: number }

const MATCH_HIGHLIGHT_NAME = `electric-pane-find-match`
const CURRENT_HIGHLIGHT_NAME = `electric-pane-find-current`

type HighlightRegistry = {
  set: (name: string, highlight: unknown) => void
  delete: (name: string) => void
}

type HighlightConstructor = new (...ranges: Array<Range>) => unknown

function getHighlightApi(): {
  highlights: HighlightRegistry
  Highlight: HighlightConstructor
} | null {
  if (typeof window === `undefined`) return null
  const css = window.CSS as unknown as { highlights?: HighlightRegistry }
  const HighlightCtor = (
    window as unknown as { Highlight?: HighlightConstructor }
  ).Highlight
  if (!css.highlights || !HighlightCtor) return null
  return { highlights: css.highlights, Highlight: HighlightCtor }
}

export function supportsPaneFind(): boolean {
  return getHighlightApi() !== null
}

export function PaneFindBar({
  tileId,
  rootRef,
}: {
  tileId: string
  rootRef: React.RefObject<HTMLElement | null>
}): React.ReactElement | null {
  const { activeTileId, close } = usePaneFind()
  const [query, setQuery] = useState(``)
  const [index, setIndex] = useState(0)
  const [count, setCount] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const supported = supportsPaneFind()
  const active = activeTileId === tileId

  const open = useCallback(() => {
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [])
  const next = useCallback(() => {
    setIndex((i) => (count ? (i + 1) % count : 0))
  }, [count])
  const previous = useCallback(() => {
    setIndex((i) => (count ? (i - 1 + count) % count : 0))
  }, [count])

  usePaneFindRegistration(tileId, supported ? { open, next, previous } : null)

  useEffect(() => {
    if (active) open()
  }, [active, open])

  useEffect(() => {
    setIndex(0)
  }, [query])

  useEffect(() => {
    const root = rootRef.current
    clearHighlights()
    if (!supported || !active || !query || !root) {
      setCount(0)
      return
    }
    const matches = findMatches(root, query)
    setCount(matches.length)
    renderHighlights(root, matches, Math.min(index, matches.length - 1))
    return () => clearHighlights()
  }, [active, query, index, rootRef, supported])

  if (!supported || !active) return null

  return (
    <div className={styles.bar} data-pane-find-bar>
      <input
        ref={inputRef}
        className={styles.input}
        value={query}
        placeholder="Find in pane"
        onChange={(e) => setQuery(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === `Escape`) close()
          if (e.key === `Enter`) {
            e.preventDefault()
            e.shiftKey ? previous() : next()
          }
        }}
      />
      <span className={styles.count}>
        {count ? `${Math.min(index + 1, count)}/${count}` : query ? `0/0` : ``}
      </span>
      <button className={styles.button} onClick={previous} title="Previous">
        ↑
      </button>
      <button className={styles.button} onClick={next} title="Next">
        ↓
      </button>
      <button className={styles.button} onClick={close} title="Close">
        ×
      </button>
    </div>
  )
}

function findMatches(root: HTMLElement, query: string): Array<Match> {
  const needle = query.toLocaleLowerCase()
  const matches: Array<Match> = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      if (parent.closest(`[data-pane-find-bar]`)) {
        return NodeFilter.FILTER_REJECT
      }
      if (!node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })
  let node: Text | null
  while ((node = walker.nextNode() as Text | null)) {
    const text = node.nodeValue ?? ``
    const lower = text.toLocaleLowerCase()
    let from = 0
    for (;;) {
      const start = lower.indexOf(needle, from)
      if (start === -1) break
      matches.push({ node, start, end: start + query.length })
      from = start + Math.max(query.length, 1)
    }
  }
  return matches
}

function clearHighlights(): void {
  const api = getHighlightApi()
  api?.highlights.delete(MATCH_HIGHLIGHT_NAME)
  api?.highlights.delete(CURRENT_HIGHLIGHT_NAME)
}

function createRange(match: Match): Range | null {
  const range = document.createRange()
  try {
    range.setStart(match.node, match.start)
    range.setEnd(match.node, match.end)
    return range
  } catch {
    return null
  }
}

function renderHighlights(
  root: HTMLElement,
  matches: Array<Match>,
  current: number
): void {
  const api = getHighlightApi()
  if (!api) return

  const matchRanges: Array<Range> = []
  let currentRange: Range | null = null

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    if (!match?.node.parentNode) continue
    const range = createRange(match)
    if (!range) continue
    if (i === current) {
      currentRange = range
    } else {
      matchRanges.push(range)
    }
  }

  if (matchRanges.length > 0) {
    api.highlights.set(MATCH_HIGHLIGHT_NAME, new api.Highlight(...matchRanges))
  }
  if (currentRange) {
    api.highlights.set(CURRENT_HIGHLIGHT_NAME, new api.Highlight(currentRange))
    scrollRangeIntoView(root, currentRange)
  }
}

function scrollRangeIntoView(root: HTMLElement, range: Range): void {
  const rect = range.getBoundingClientRect()
  if (rect.width > 0 || rect.height > 0) {
    const rootRect = root.getBoundingClientRect()
    if (rect.top >= rootRect.top && rect.bottom <= rootRect.bottom) return
  }
  range.startContainer.parentElement?.scrollIntoView({
    block: `center`,
    inline: `nearest`,
  })
}
