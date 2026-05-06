import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { usePaneFind, usePaneFindRegistration } from '../../hooks/usePaneFind'
import styles from './PaneFindBar.module.css'
import type { PaneFindAdapter, PaneFindMatch } from '../../hooks/usePaneFind'

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
  const { activeTileId, close, getAdapter } = usePaneFind()
  const [query, setQuery] = useState(``)
  const [index, setIndex] = useState(0)
  const [count, setCount] = useState(0)
  const [domVersion, setDomVersion] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigationKeyRef = useRef<string | null>(null)
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
    if (!supported || !active || !query || !root) return

    let frame = 0
    const observer = new MutationObserver(() => {
      if (frame !== 0) return
      frame = requestAnimationFrame(() => {
        frame = 0
        setDomVersion((v) => v + 1)
      })
    })

    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    return () => {
      observer.disconnect()
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [active, query, rootRef, supported])

  useEffect(() => {
    const root = rootRef.current
    clearHighlights()
    if (!supported || !active || !query || !root) {
      setCount(0)
      navigationKeyRef.current = null
      return
    }

    const navigationKey = `${tileId}\0${query}\0${index}`
    const shouldReveal = navigationKeyRef.current !== navigationKey
    navigationKeyRef.current = navigationKey

    const adapter = getAdapter(tileId)
    if (adapter) {
      let cancelled = false
      const matches = adapter.search(query)
      const nextCount = matches.length
      setCount(nextCount)
      const match = matches[Math.min(index, nextCount - 1)]
      if (!match) return () => clearHighlights()

      const paint = () => {
        if (cancelled) return
        renderAdapterHighlights(adapter, matches, match, query, shouldReveal)
      }

      if (shouldReveal) {
        void Promise.resolve(adapter.reveal(match)).then(paint)
      } else {
        paint()
      }

      return () => {
        cancelled = true
        clearHighlights()
      }
    }

    const matches = findMatches(root, query)
    const nextCount = matches.length
    setCount(nextCount)
    renderRootHighlights(
      root,
      matches,
      Math.min(index, nextCount - 1),
      shouldReveal
    )
    return () => clearHighlights()
  }, [active, domVersion, getAdapter, index, query, rootRef, supported, tileId])

  if (!supported || !active) return null

  return (
    <div className={styles.bar} data-pane-find-bar>
      <Search size={16} className={styles.searchIcon} aria-hidden="true" />
      <input
        ref={inputRef}
        className={styles.input}
        value={query}
        placeholder="Find in pane..."
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
      <button
        type="button"
        className={styles.button}
        onClick={previous}
        title="Previous"
        aria-label="Previous match"
      >
        <ChevronUp size={16} />
      </button>
      <button
        type="button"
        className={styles.button}
        onClick={next}
        title="Next"
        aria-label="Next match"
      >
        <ChevronDown size={16} />
      </button>
      <span className={styles.divider} aria-hidden="true" />
      <button
        type="button"
        className={`${styles.button} ${styles.closeButton}`}
        onClick={close}
        title="Close"
        aria-label="Close find"
      >
        <X size={17} />
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

export function getTextMatchStarts(text: string, query: string): Array<number> {
  const needle = query.toLocaleLowerCase()
  if (!needle) return []
  const haystack = text.toLocaleLowerCase()
  const starts: Array<number> = []
  let from = 0
  for (;;) {
    const start = haystack.indexOf(needle, from)
    if (start === -1) break
    starts.push(start)
    from = start + Math.max(query.length, 1)
  }
  return starts
}

export function getCurrentMatchIndexInRoot(
  root: HTMLElement,
  query: string,
  match: PaneFindMatch & { rowOccurrence?: number }
): number {
  if (typeof match.rowOccurrence !== `number`) return 0
  const count = findMatches(root, query).length
  if (count === 0) return 0
  return Math.min(match.rowOccurrence, count - 1)
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

function renderRootHighlights(
  root: HTMLElement,
  matches: Array<Match>,
  current: number,
  scrollCurrent: boolean
): void {
  const matchRanges: Array<Range> = []
  let currentRange: Range | null = null

  for (let i = 0; i < matches.length; i++) {
    const range = createRange(matches[i]!)
    if (!range) continue
    if (i === current) {
      currentRange = range
    } else {
      matchRanges.push(range)
    }
  }

  renderHighlightRanges(matchRanges, currentRange, root, scrollCurrent)
}

function renderAdapterHighlights(
  adapter: PaneFindAdapter,
  matches: Array<PaneFindMatch>,
  currentMatch: PaneFindMatch,
  query: string,
  scrollCurrent: boolean
): void {
  const rootCurrentIndexes = new Map<HTMLElement, number | null>()

  for (const match of matches) {
    const root = adapter.getHighlightRoot(match)
    if (!root) continue
    if (!rootCurrentIndexes.has(root)) rootCurrentIndexes.set(root, null)
    if (match === currentMatch) {
      rootCurrentIndexes.set(
        root,
        adapter.getCurrentMatchIndex?.(match, query) ?? 0
      )
    }
  }

  const matchRanges: Array<Range> = []
  let currentRange: Range | null = null
  let currentRoot: HTMLElement | null = null

  for (const [root, currentIndex] of rootCurrentIndexes) {
    const rootMatches = findMatches(root, query)
    for (let i = 0; i < rootMatches.length; i++) {
      const range = createRange(rootMatches[i]!)
      if (!range) continue
      if (currentIndex !== null && i === currentIndex) {
        currentRange = range
        currentRoot = root
      } else {
        matchRanges.push(range)
      }
    }
  }

  renderHighlightRanges(matchRanges, currentRange, currentRoot, scrollCurrent)
}

function renderHighlightRanges(
  matchRanges: Array<Range>,
  currentRange: Range | null,
  currentRoot: HTMLElement | null,
  scrollCurrent: boolean
): void {
  const api = getHighlightApi()
  if (!api) return

  if (matchRanges.length > 0) {
    api.highlights.set(MATCH_HIGHLIGHT_NAME, new api.Highlight(...matchRanges))
  }
  if (currentRange) {
    api.highlights.set(CURRENT_HIGHLIGHT_NAME, new api.Highlight(currentRange))
    if (scrollCurrent && currentRoot) {
      scrollRangeIntoView(currentRoot, currentRange)
    }
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
