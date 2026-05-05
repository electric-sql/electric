import { useCallback, useEffect, useRef, useState } from 'react'
import { usePaneFind, usePaneFindRegistration } from '../../hooks/usePaneFind'
import styles from './PaneFindBar.module.css'

type Match = { node: Text; start: number; end: number }

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

  usePaneFindRegistration(tileId, { open, next, previous })

  useEffect(() => {
    if (active) open()
  }, [active, open])

  useEffect(() => {
    setIndex(0)
  }, [query])

  useEffect(() => {
    const root = rootRef.current
    clearHighlights(root)
    if (!active || !query || !root) {
      setCount(0)
      return
    }
    const matches = findMatches(root, query)
    setCount(matches.length)
    renderHighlights(root, matches, Math.min(index, matches.length - 1))
    return () => clearHighlights(root)
  }, [active, query, index, rootRef])

  if (!active) return null

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
      if (parent.closest(`[data-pane-find-bar], mark[data-pane-find]`)) {
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

function clearHighlights(root: HTMLElement | null): void {
  if (!root) return
  root.querySelectorAll(`mark[data-pane-find]`).forEach((mark) => {
    mark.replaceWith(document.createTextNode(mark.textContent ?? ``))
  })
  root.normalize()
}

function renderHighlights(
  root: HTMLElement,
  matches: Array<Match>,
  current: number
): void {
  let currentMark: HTMLElement | null = null
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i]
    if (!match?.node.parentNode) continue
    const range = document.createRange()
    try {
      range.setStart(match.node, match.start)
      range.setEnd(match.node, match.end)
    } catch {
      continue
    }
    const mark = document.createElement(`mark`)
    mark.dataset.paneFind = `true`
    mark.className = `${styles.highlight} ${i === current ? styles.current : ``}`
    range.surroundContents(mark)
    if (i === current) currentMark = mark
  }
  currentMark?.scrollIntoView({ block: `center`, inline: `nearest` })
}
