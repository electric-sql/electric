import { useCallback, useMemo, useState } from 'react'
import { Check, Folder, FolderOpen, Home, X } from 'lucide-react'
import { Combobox, IconButton } from '../ui'
import { useRecentWorkingDirectories } from '../hooks/useRecentWorkingDirectories'
import { detectHomeDir, tildifyPath } from '../lib/pathDisplay'
import styles from './WorkingDirectoryPicker.module.css'

type WorkingDirectoryPickerProps = {
  value: string | null
  onChange: (path: string | null) => void
  /** Optional default path the native picker should start in. */
  defaultPath?: string | null
  disabled?: boolean
}

/**
 * Sentinel values for the special, non-path rows. Both are valid
 * `Combobox.Item` values (the wrapped `Combobox<V extends string>`
 * doesn't allow `null` item values, matching `Select`), and both are
 * intercepted in `handleValueChange` before propagating to `onChange`.
 *
 *   - NONE_VALUE     → maps to external `null` (use server default)
 *   - BROWSE_VALUE   → fires the native folder picker, doesn't commit
 */
const NONE_VALUE = `__none__`
const BROWSE_VALUE = `__browse__`

/**
 * Combobox for choosing the `workingDirectory` spawn arg.
 *
 * Built on the shared `Combobox` UI primitive so popup surface, row
 * geometry, and indicator placement match every other dropdown in
 * the app. Selecting "None" clears the spawn arg (the agent runs in
 * the server's configured cwd); selecting "Open folder…" shells out
 * to the native folder picker (Electron only).
 *
 * Per-row trailing affordance:
 *   - Resting + selected            → ✓ check
 *   - Hovered / kbd-highlighted     → ✕ remove (recents only)
 * Both icons share the same trailing slot so swapping them never
 * shifts the row's layout.
 */
export function WorkingDirectoryPicker({
  value,
  onChange,
  defaultPath,
  disabled,
}: WorkingDirectoryPickerProps): React.ReactElement {
  const [inputValue, setInputValue] = useState(``)
  const { recents, addRecent, removeRecent } = useRecentWorkingDirectories()

  const isDesktop =
    typeof window !== `undefined` && Boolean(window.electronAPI?.pickDirectory)

  const homeDir = useMemo(
    () => detectHomeDir([defaultPath, ...recents]),
    [recents, defaultPath]
  )

  const triggerLabel = useMemo(
    () => (value ? tildifyPath(value, homeDir) : `None`),
    [value, homeDir]
  )

  const filteredRecents = useMemo(() => {
    const q = inputValue.trim().toLowerCase()
    if (!q) return recents
    return recents.filter((p) => p.toLowerCase().includes(q))
  }, [recents, inputValue])

  // External `value` (string|null) → internal Combobox value (string).
  // `null` maps to the NONE_VALUE sentinel so the "None" row reads as
  // the active selection in the popup.
  const internalValue = value ?? NONE_VALUE

  const commit = useCallback(
    (path: string | null) => {
      const trimmed = path?.trim() || null
      onChange(trimmed)
      if (trimmed) addRecent(trimmed)
    },
    [onChange, addRecent]
  )

  const handleBrowse = useCallback(async () => {
    if (!window.electronAPI?.pickDirectory) return
    const picked = await window.electronAPI.pickDirectory({
      defaultPath: value ?? defaultPath ?? undefined,
    })
    if (picked) commit(picked)
  }, [commit, defaultPath, value])

  const handleValueChange = useCallback(
    (next: string | null) => {
      // Routing: special sentinels run actions instead of committing.
      if (next === BROWSE_VALUE) {
        void handleBrowse()
        return
      }
      if (next === NONE_VALUE || next === null) {
        commit(null)
        return
      }
      commit(next)
    },
    [commit, handleBrowse]
  )

  return (
    <Combobox.Root<string>
      value={internalValue}
      onValueChange={handleValueChange}
      inputValue={inputValue}
      onInputValueChange={setInputValue}
      disabled={disabled}
    >
      <Combobox.Trigger
        render={
          <button
            type="button"
            className={styles.trigger}
            data-empty={value === null ? `true` : undefined}
            aria-label={
              value ? `Working directory: ${value}` : `Set working directory`
            }
            title={value ?? `Use the server's default working directory`}
          >
            <Folder size={12} className={styles.triggerIcon} />
            <span className={styles.triggerLabel}>{triggerLabel}</span>
          </button>
        }
      />
      <Combobox.Content side="bottom" align="start" className={styles.popup}>
        <Combobox.Input
          placeholder="Filter recents or paste a path…"
          spellCheck={false}
        />
        <Combobox.List>
          {/* Every row uses the same `.menuRow` inner wrapper as
              ServerPicker's saved-server rows. The wrapper is what
              carries `min-height: 24px` (sized to match an inline
              `IconButton size={1}`), so rows with a trailing control
              and rows without one stay on a uniform 30px row pitch
              (24px content + 6px item padding). Mirrors the trick
              `ServerPicker.module.css → .menuRow` uses to stop the
              menu jumping between saved and discovered groups. */}
          <Combobox.Item value={NONE_VALUE}>
            <span className={styles.menuRow}>
              <Home size={14} className={styles.menuRowIcon} />
              <span className={styles.menuRowLabel}>None</span>
              <span className={styles.trailing}>
                {value === null && (
                  <span className={styles.trailingCheck}>
                    <Check size={14} />
                  </span>
                )}
              </span>
            </span>
          </Combobox.Item>

          {filteredRecents.map((path) => {
            const isSelected = path === value
            return (
              <Combobox.Item
                key={path}
                value={path}
                title={path}
                className={styles.recentItem}
              >
                <span className={styles.menuRow}>
                  <Folder size={14} className={styles.menuRowIcon} />
                  <span className={styles.menuRowLabel}>
                    {tildifyPath(path, homeDir)}
                  </span>
                  {/* Trailing slot is a 24×24 box (matching
                      IconButton size={1}) with the check and the
                      remove IconButton stacked via absolute
                      positioning. Opacity-only swap on row hover /
                      kbd-highlight keeps the row pitch identical to
                      every other row in the popup. */}
                  <span className={styles.trailing}>
                    {isSelected && (
                      <span className={styles.trailingCheck}>
                        <Check size={14} />
                      </span>
                    )}
                    <IconButton
                      size={1}
                      variant="ghost"
                      tone="neutral"
                      className={styles.trailingRemove}
                      onClick={(e) => {
                        // Stop the click from bubbling up to the
                        // Combobox.Item's selection handler —
                        // without this, removing a recent would
                        // also commit it.
                        e.stopPropagation()
                        e.preventDefault()
                        removeRecent(path)
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      aria-label={`Remove ${path} from recents`}
                      title="Remove from recents"
                    >
                      <X size={14} />
                    </IconButton>
                  </span>
                </span>
              </Combobox.Item>
            )
          })}

          {isDesktop && (
            <>
              <Combobox.Separator />
              <Combobox.Item value={BROWSE_VALUE}>
                <span className={styles.menuRow}>
                  <FolderOpen size={14} className={styles.menuRowIcon} />
                  <span className={styles.menuRowLabel}>Open folder…</span>
                </span>
              </Combobox.Item>
            </>
          )}
        </Combobox.List>
      </Combobox.Content>
    </Combobox.Root>
  )
}
