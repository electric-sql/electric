import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { useNavigate } from '@tanstack/react-router'
import { useLiveQuery } from '@tanstack/react-db'
import { Search } from 'lucide-react'
import { StatusDot } from './StatusDot'
import { useSearchPalette } from '../hooks/useSearchPalette'
import { useElectricAgents } from '../lib/ElectricAgentsProvider'
import { usePinnedEntities } from '../hooks/usePinnedEntities'
import { getEntityDisplayTitle } from '../lib/entityDisplay'
import styles from './SearchPalette.module.css'
import type { ElectricEntity } from '../lib/ElectricAgentsProvider'

type ResultGroup = { label: string; items: Array<ElectricEntity> }

/**
 * ⌘K session-search palette.
 *
 * Command-palette-style overlay anchored 12vh from the top of the
 * viewport. Searches sessions only — a future command palette will
 * land on a separate shortcut for actions (kill / fork / etc.).
 *
 * Keyboard:
 *   ↑ / ↓   move highlight (wraps)
 *   ↵       open the highlighted session and close
 *   esc     close (Base UI's Dialog handles this on the popup)
 */
export function SearchPalette(): React.ReactElement | null {
  const { isOpen, close } = useSearchPalette()
  const { entitiesCollection } = useElectricAgents()
  const { pinnedUrls } = usePinnedEntities()
  const navigate = useNavigate()

  const [query, setQuery] = useState(``)
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: entities = [] } = useLiveQuery(
    (q) => {
      if (!entitiesCollection) return undefined
      return q
        .from({ e: entitiesCollection })
        .orderBy(({ e }) => e.updated_at, `desc`)
    },
    [entitiesCollection]
  )

  const groups: Array<ResultGroup> = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matches = (entity: ElectricEntity): boolean => {
      if (!needle) return true
      const slug = entity.url.split(`/`).pop() ?? ``
      const { title } = getEntityDisplayTitle(entity)
      return (
        slug.toLowerCase().includes(needle) ||
        entity.type.toLowerCase().includes(needle) ||
        title.toLowerCase().includes(needle) ||
        entity.url.toLowerCase().includes(needle)
      )
    }
    const filtered = entities.filter(matches)
    const pinnedSet = new Set(pinnedUrls)
    const pinned = filtered.filter((e) => pinnedSet.has(e.url))
    const sessions = filtered.filter((e) => !pinnedSet.has(e.url))
    const out: Array<ResultGroup> = []
    if (pinned.length > 0) out.push({ label: `Pinned`, items: pinned })
    if (sessions.length > 0) out.push({ label: `Sessions`, items: sessions })
    return out
  }, [entities, pinnedUrls, query])

  const flatResults = useMemo(() => groups.flatMap((g) => g.items), [groups])

  // Reset selection when query or open state changes.
  useEffect(() => {
    setHighlight(0)
  }, [query, isOpen])

  // Reset query each time the palette closes so the next open starts
  // fresh; defer to next tick so the close animation can finish.
  useEffect(() => {
    if (!isOpen) {
      const t = window.setTimeout(() => setQuery(``), 200)
      return () => window.clearTimeout(t)
    }
    return undefined
  }, [isOpen])

  // Auto-focus the input each time the palette opens. Base UI's dialog
  // restores focus to the trigger on close, but doesn't reliably focus
  // a child input on open if it's not the first focusable element.
  useEffect(() => {
    if (!isOpen) return
    const id = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(id)
  }, [isOpen])

  const openResult = useCallback(
    (entity: ElectricEntity) => {
      navigate({
        to: `/entity/$`,
        params: { _splat: entity.url.replace(/^\//, ``) },
      })
      // Defer close to the next frame so React commits the navigation
      // before the dialog dismount; closing in the same render seems to
      // get coalesced and the dialog stays mounted.
      window.requestAnimationFrame(close)
    },
    [close, navigate]
  )

  const onInputKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (flatResults.length === 0) return
      if (e.key === `ArrowDown`) {
        e.preventDefault()
        setHighlight((h) => (h + 1) % flatResults.length)
      } else if (e.key === `ArrowUp`) {
        e.preventDefault()
        setHighlight((h) => (h - 1 + flatResults.length) % flatResults.length)
      } else if (e.key === `Enter`) {
        e.preventDefault()
        const target = flatResults[highlight]
        if (target) openResult(target)
      }
    },
    [flatResults, highlight, openResult]
  )

  let cursor = 0
  return (
    <BaseDialog.Root open={isOpen} onOpenChange={(open) => !open && close()}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className={styles.backdrop} />
        <BaseDialog.Popup className={styles.popup}>
          <div className={styles.searchRow}>
            <Search size={16} className={styles.searchIcon} />
            <input
              ref={inputRef}
              type="search"
              className={styles.searchInput}
              placeholder="Search sessions…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKeyDown}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className={styles.results} role="listbox">
            {flatResults.length === 0 && (
              <div className={styles.empty}>
                {query ? `No matches` : `No sessions yet`}
              </div>
            )}
            {groups.map((group) => (
              <div key={group.label}>
                <span className={styles.groupLabel}>{group.label}</span>
                {group.items.map((entity) => {
                  const idx = cursor++
                  const active = idx === highlight
                  const { title } = getEntityDisplayTitle(entity)
                  return (
                    <div
                      key={entity.url}
                      role="option"
                      aria-selected={active}
                      data-active={active}
                      className={styles.row}
                      onMouseEnter={() => setHighlight(idx)}
                      onClick={() => openResult(entity)}
                    >
                      <StatusDot status={entity.status} />
                      <span className={styles.rowTitle} title={title}>
                        {title}
                      </span>
                      <span className={styles.rowType}>{entity.type}</span>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}
