import { useEffect, useState } from 'react'
import { Image as ImageIcon, X } from 'lucide-react'
import { Dialog, Icon, IconButton } from '../ui'
import { formatAttachmentSize } from '../lib/attachments'
import { serverFetch } from '../lib/auth-fetch'
import styles from './AttachmentImagePreviewDialog.module.css'

export type AttachmentImagePreviewItem = {
  name: string
  url: string
  mimeType?: string
  byteLength?: number
}

export function AttachmentImagePreviewDialog({
  attachment,
  objectUrl,
  open,
  onOpenChange,
}: {
  attachment: AttachmentImagePreviewItem
  objectUrl?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.ReactElement {
  const fetchedObjectUrl = useAttachmentObjectUrl(
    attachment.url,
    open && !objectUrl
  )
  const imageUrl = objectUrl ?? fetchedObjectUrl
  const size = formatAttachmentSize(attachment.byteLength)
  const label = attachment.mimeType ? `${attachment.mimeType} · ${size}` : size

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content className={styles.imagePreviewDialog}>
        <div className={styles.imagePreviewToolbar}>
          <div className={styles.imagePreviewTitle}>
            <span>{attachment.name}</span>
            <small>{label}</small>
          </div>
          <Dialog.Close
            render={
              <IconButton
                aria-label="Close image preview"
                title="Close image preview"
                size={2}
                variant="soft"
                tone="neutral"
              >
                <Icon icon={X} size={2} />
              </IconButton>
            }
          />
        </div>
        <div className={styles.imagePreviewStage}>
          {imageUrl ? (
            <img src={imageUrl} alt={attachment.name} />
          ) : (
            <div className={styles.imagePreviewLoading}>
              <Icon icon={ImageIcon} size={4} />
            </div>
          )}
        </div>
      </Dialog.Content>
    </Dialog.Root>
  )
}

export function useAttachmentObjectUrl(
  url: string,
  enabled: boolean
): string | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) {
      setObjectUrl(null)
      return
    }

    let cancelled = false
    let nextObjectUrl: string | null = null

    serverFetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`)
        }
        return response.blob()
      })
      .then((blob) => {
        if (cancelled) return
        nextObjectUrl = URL.createObjectURL(blob)
        setObjectUrl(nextObjectUrl)
      })
      .catch(() => {
        if (!cancelled) setObjectUrl(null)
      })

    return () => {
      cancelled = true
      if (nextObjectUrl) {
        URL.revokeObjectURL(nextObjectUrl)
      }
    }
  }, [enabled, url])

  return objectUrl
}
