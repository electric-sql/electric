import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import type { CSSProperties, ReactNode } from 'react'
import styles from './Dialog.module.css'

interface RootProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  modal?: boolean | `trap-focus`
  children?: ReactNode
}

interface ContentProps {
  /** Pixel max-width — replaces Radix's `maxWidth="…"` prop. */
  maxWidth?: number | string
  className?: string
  style?: CSSProperties
  children?: ReactNode
  /** Whether to render the modal backdrop. Default true. */
  withBackdrop?: boolean
  /**
   * Render the popup outside the trigger's React tree (default true).
   * Disable only if you need the popup inside a specific stacking context.
   */
  inPortal?: boolean
}

/**
 * Modal dialog — wraps `@base-ui/react/dialog`.
 *
 * Replaces `Dialog.Root / Dialog.Content / Dialog.Title / Dialog.Description /
 * Dialog.Close` from `@radix-ui/themes` with the same shape:
 *
 *   <Dialog.Root open={open} onOpenChange={setOpen}>
 *     <Dialog.Content maxWidth={520}>
 *       <Dialog.Title>Edit profile</Dialog.Title>
 *       <Dialog.Description>...</Dialog.Description>
 *       <Dialog.Close>Cancel</Dialog.Close>
 *     </Dialog.Content>
 *   </Dialog.Root>
 *
 * Note: Base UI's <Dialog.Trigger> can be used instead of controlling
 * `open` from state. Re-exported as `Dialog.Trigger`.
 */
function Root({
  open,
  defaultOpen,
  onOpenChange,
  modal,
  children,
}: RootProps): React.ReactElement {
  return (
    <BaseDialog.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      modal={modal}
    >
      {children}
    </BaseDialog.Root>
  )
}

function Content({
  maxWidth,
  className,
  style,
  children,
  withBackdrop = true,
  inPortal = true,
}: ContentProps): React.ReactElement {
  const popupStyle: CSSProperties = maxWidth
    ? { maxWidth, ...style }
    : (style ?? {})
  const popup = (
    <>
      {withBackdrop && <BaseDialog.Backdrop className={styles.backdrop} />}
      <BaseDialog.Popup
        className={[styles.popup, className].filter(Boolean).join(` `)}
        style={popupStyle}
      >
        {children}
      </BaseDialog.Popup>
    </>
  )
  return inPortal ? <BaseDialog.Portal>{popup}</BaseDialog.Portal> : popup
}

function Title({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}): React.ReactElement {
  return (
    <BaseDialog.Title
      className={[styles.title, className].filter(Boolean).join(` `)}
    >
      {children}
    </BaseDialog.Title>
  )
}

function Description({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}): React.ReactElement {
  return (
    <BaseDialog.Description
      className={[styles.description, className].filter(Boolean).join(` `)}
    >
      {children}
    </BaseDialog.Description>
  )
}

export const Dialog = {
  Root,
  Trigger: BaseDialog.Trigger,
  Close: BaseDialog.Close,
  Content,
  Title,
  Description,
}
