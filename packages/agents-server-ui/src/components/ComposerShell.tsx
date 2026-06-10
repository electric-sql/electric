import { type MouseEvent, type ReactNode, useCallback, useRef } from 'react'

import styles from './ComposerShell.module.css'

const cn = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(` `)

/**
 * Resolve the editor's contenteditable inside the shell. ProseMirror owns the
 * concrete element via `<ComposerEditor>`, which the shell receives as
 * opaque `children`. Rather than thread a focus ref through every variant we
 * find it lazily by scanning the shell on click — the shell is guaranteed to
 * contain exactly one ProseMirror contenteditable.
 */
const findEditorIn = (shell: HTMLElement | null): HTMLElement | null =>
  shell?.querySelector<HTMLElement>(`[contenteditable="true"]`) ?? null

export interface ComposerShellProps {
  /**
   * The editor itself. Typically `<ComposerEditor ... />` passed through with
   * no wrapper. The shell never renders padding around it — the
   * `--composer-editor-padding-*` variables set on the shell's outer
   * element (via the variant `className`) push the inset down into
   * `.proseMirrorEditor`, which keeps clicks-in-the-padding focusing the
   * input and lets the footer paint over the editor's extra bottom inset.
   */
  children: ReactNode
  /** Optional row pinned above the editor (e.g. the chat editing banner). */
  banner?: ReactNode
  /** Optional attachment preview tray rendered between banner and editor. */
  attachments?: ReactNode
  /** Left-aligned footer slot. e.g. `<AttachmentActionMenu />` plus pills. */
  controls?: ReactNode
  /** Right-aligned footer slot. e.g. the send / stop button. */
  send?: ReactNode
  /** Visual disabled state (50% opacity). */
  disabled?: boolean
  /** When true, paint the drag-and-drop highlight ring. */
  dropActive?: boolean
  /**
   * Variant class supplied by the call-site. Sets the four
   * `--composer-editor-padding-*` variables (and `--composer-footer-h`) so
   * a single shell can host both the compact chat composer and the
   * roomier spawn-page composer.
   */
  className?: string
  /** Paste handler — typically routed to the attachment-drafts hook. */
  onPaste?: React.ClipboardEventHandler<HTMLDivElement>
  /** Drag-and-drop props (drag enter/over/leave/drop) from the same hook. */
  dropZoneProps?: React.HTMLAttributes<HTMLDivElement>
}

/**
 * Shared frame for the message composer. Renders a bordered card with the
 * editor's typing surface sized to clear an absolutely-positioned footer
 * row beneath it.
 *
 * The two big affordances:
 *  - All padding lives on the contenteditable inside `<ComposerEditor>`,
 *    not on this frame, so clicking anywhere in the inset focuses the
 *    input.
 *  - The footer row is `position: absolute; bottom: 0` over the editor's
 *    reserved bottom padding, so the editor expands underneath the
 *    controls without pushing them.
 */
export function ComposerShell({
  children,
  banner,
  attachments,
  controls,
  send,
  disabled,
  dropActive,
  className,
  onPaste,
  dropZoneProps,
}: ComposerShellProps): React.ReactElement {
  const hasFooter = Boolean(controls || send)
  const shellRef = useRef<HTMLDivElement | null>(null)

  /**
   * Route clicks on the footer's bare background (i.e. the gap between
   * the controls and the send cluster, plus the fade strip overlaying
   * the editor's last line) back into the editor. We restrict to
   * `target === currentTarget` so bubbled clicks from a real control
   * — which already handle their own activation — don't steal focus.
   */
  const handleFooterClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    findEditorIn(shellRef.current)?.focus()
  }, [])

  return (
    <div
      ref={shellRef}
      className={cn(
        styles.shell,
        disabled ? styles.disabled : null,
        dropActive ? styles.dropActive : null,
        className
      )}
      onPaste={onPaste}
      {...dropZoneProps}
    >
      {banner}
      {attachments}
      {children}
      {hasFooter && (
        <div className={styles.footer} onClick={handleFooterClick}>
          <div className={styles.controls}>{controls}</div>
          <div className={styles.sendCluster}>{send}</div>
        </div>
      )}
    </div>
  )
}
