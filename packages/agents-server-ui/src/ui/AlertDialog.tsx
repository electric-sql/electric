import { AlertDialog as BaseAlertDialog } from '@base-ui/react/alert-dialog'
import type { CSSProperties, ReactNode } from 'react'
import dialogStyles from './Dialog.module.css'

interface RootProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children?: ReactNode
}

interface ContentProps {
  maxWidth?: number | string
  className?: string
  style?: CSSProperties
  children?: ReactNode
}

/**
 * Confirmation dialog (requires explicit user response) — wraps
 * `@base-ui/react/alert-dialog`. Re-uses the Dialog visual styles so the
 * two stay in sync. Use this instead of `<Dialog>` for destructive
 * confirmations like "Kill entity".
 */
function Root({
  open,
  defaultOpen,
  onOpenChange,
  children,
}: RootProps): React.ReactElement {
  return (
    <BaseAlertDialog.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
    >
      {children}
    </BaseAlertDialog.Root>
  )
}

function Content({
  maxWidth,
  className,
  style,
  children,
}: ContentProps): React.ReactElement {
  const popupStyle: CSSProperties = maxWidth
    ? { maxWidth, ...style }
    : (style ?? {})
  return (
    <BaseAlertDialog.Portal>
      <BaseAlertDialog.Backdrop className={dialogStyles.backdrop} />
      <BaseAlertDialog.Popup
        className={[dialogStyles.popup, className].filter(Boolean).join(` `)}
        style={popupStyle}
      >
        {children}
      </BaseAlertDialog.Popup>
    </BaseAlertDialog.Portal>
  )
}

function Title({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}): React.ReactElement {
  return (
    <BaseAlertDialog.Title
      className={[dialogStyles.title, className].filter(Boolean).join(` `)}
    >
      {children}
    </BaseAlertDialog.Title>
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
    <BaseAlertDialog.Description
      className={[dialogStyles.description, className]
        .filter(Boolean)
        .join(` `)}
    >
      {children}
    </BaseAlertDialog.Description>
  )
}

export const AlertDialog = {
  Root,
  Trigger: BaseAlertDialog.Trigger,
  Close: BaseAlertDialog.Close,
  Content,
  Title,
  Description,
}
