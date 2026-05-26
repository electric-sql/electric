import type { ReactNode } from 'react'
import { Button, type ButtonTone } from './Button'
import { Dialog } from './Dialog'
import { Icon } from './Icon'
import { Text } from './Text'
import styles from './ConfirmDialog.module.css'
import type { LucideIcon } from 'lucide-react'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description: ReactNode
  confirmLabel: ReactNode
  cancelLabel?: ReactNode
  confirmTone?: ButtonTone
  confirmIcon?: LucideIcon
  loading?: boolean
  loadingLabel?: ReactNode
  error?: ReactNode
  maxWidth?: number | string
  onConfirm: () => void
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = `Cancel`,
  confirmTone = `accent`,
  confirmIcon,
  loading = false,
  loadingLabel,
  error,
  maxWidth = 440,
  onConfirm,
}: ConfirmDialogProps): React.ReactElement {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!loading) onOpenChange(nextOpen)
      }}
    >
      <Dialog.Content maxWidth={maxWidth}>
        <div className={styles.body}>
          <div>
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Description>{description}</Dialog.Description>
          </div>
          {error && (
            <Text size={2} tone="danger" className={styles.error}>
              {error}
            </Text>
          )}
          <div className={styles.actions}>
            <Dialog.Close
              render={
                <Button variant="soft" tone="neutral" disabled={loading}>
                  {cancelLabel}
                </Button>
              }
            />
            <Button tone={confirmTone} disabled={loading} onClick={onConfirm}>
              {confirmIcon && <Icon icon={confirmIcon} size={2} />}
              {loading ? (loadingLabel ?? confirmLabel) : confirmLabel}
            </Button>
          </div>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  )
}
