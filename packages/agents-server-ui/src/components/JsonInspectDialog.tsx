import { X } from 'lucide-react'
import { Dialog, Icon, IconButton } from '../ui'
import styles from './JsonInspectDialog.module.css'

export function JsonInspectDialog({
  open,
  onOpenChange,
  title,
  value,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  value: unknown
}): React.ReactElement {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth={680} className={styles.dialog}>
        <div className={styles.header}>
          <div className={styles.headerText}>
            <Dialog.Title className={styles.title}>{title}</Dialog.Title>
          </div>
          <Dialog.Close
            render={
              <IconButton
                type="button"
                size={1}
                variant="ghost"
                tone="neutral"
                round
                aria-label="Close inspector"
                className={styles.close}
              >
                <Icon icon={X} size={2} />
              </IconButton>
            }
          />
        </div>
        <pre className={styles.pre}>{JSON.stringify(value, null, 2)}</pre>
      </Dialog.Content>
    </Dialog.Root>
  )
}
