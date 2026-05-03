import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = `electric-agents-ui.tree.expanded`

function readInitial(): Set<string> {
  if (typeof window === `undefined`) return new Set()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((v): v is string => typeof v === `string`))
  } catch {
    return new Set()
  }
}

/**
 * Per-row tree expansion state for the sidebar, persisted across reloads.
 *
 * Children are collapsed by default — a row only expands when the user
 * clicks its caret (or when an external caller forces it via `expand`).
 */
export function useExpandedTreeNodes(): {
  isExpanded: (url: string) => boolean
  toggle: (url: string) => void
  expand: (url: string) => void
  collapse: (url: string) => void
} {
  const [expanded, setExpanded] = useState<Set<string>>(readInitial)

  useEffect(() => {
    if (typeof window === `undefined`) return
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Array.from(expanded))
    )
  }, [expanded])

  const toggle = useCallback((url: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(url)) next.delete(url)
      else next.add(url)
      return next
    })
  }, [])

  const expand = useCallback((url: string) => {
    setExpanded((prev) => {
      if (prev.has(url)) return prev
      const next = new Set(prev)
      next.add(url)
      return next
    })
  }, [])

  const collapse = useCallback((url: string) => {
    setExpanded((prev) => {
      if (!prev.has(url)) return prev
      const next = new Set(prev)
      next.delete(url)
      return next
    })
  }, [])

  const isExpanded = useCallback((url: string) => expanded.has(url), [expanded])

  return { isExpanded, toggle, expand, collapse }
}
