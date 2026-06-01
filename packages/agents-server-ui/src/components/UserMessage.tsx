import { memo, useState } from 'react'
import {
  Download,
  File as FileIcon,
  Image as ImageIcon,
  Square,
} from 'lucide-react'
import type { EntityTimelineSection } from '@electric-ax/agents-runtime/client'
import { Icon, Stack, Text } from '../ui'
import { downloadAttachment, formatAttachmentSize } from '../lib/attachments'
import {
  AttachmentImagePreviewDialog,
  useAttachmentObjectUrl,
} from './AttachmentImagePreviewDialog'
import { TimeText } from './TimeText'
import styles from './UserMessage.module.css'

type UserMessageSection = Extract<
  EntityTimelineSection,
  { kind: `user_message` }
>

export type UserMessageAttachment = {
  id: string
  name: string
  mimeType: string
  byteLength?: number
  status?: string
  url: string
}

export const UserMessage = memo(function UserMessage({
  section,
  attachments = [],
  showStop = false,
  stopPending = false,
  onStop,
}: {
  section: UserMessageSection
  attachments?: Array<UserMessageAttachment>
  showStop?: boolean
  stopPending?: boolean
  onStop?: () => void
}): React.ReactElement {
  const sender = formatSender(section.from)

  return (
    <Stack
      direction="column"
      gap={1}
      className={`${styles.root} mobile-user-message-root`}
    >
      <Stack
        direction="column"
        gap={2}
        p={3}
        className={[styles.bubble, showStop ? styles.withStop : null]
          .filter(Boolean)
          .join(` `)}
      >
        {showStop && onStop && (
          <button
            type="button"
            aria-label="Stop generating"
            title="Stop generating"
            className={[
              styles.stopButton,
              stopPending ? styles.stopPending : null,
            ]
              .filter(Boolean)
              .join(` `)}
            disabled={stopPending}
            onClick={onStop}
          >
            <Icon icon={Square} size={2} fill="currentColor" strokeWidth={0} />
          </button>
        )}
        {attachments.length > 0 && (
          <div className={styles.attachments}>
            {attachments.map((attachment) => (
              <AttachmentPreview key={attachment.id} attachment={attachment} />
            ))}
          </div>
        )}
        {section.text ? (
          <Text size={2} className={styles.body}>
            {section.text}
          </Text>
        ) : null}
      </Stack>
      <Stack gap={2} align="center" className={styles.meta}>
        <Text size={1} tone="muted" title={sender.title}>
          {sender.label}
        </Text>
        {section.timestamp && (
          <>
            <Text size={1} tone="muted">
              ·
            </Text>
            <TimeText ts={section.timestamp} />
          </>
        )}
      </Stack>
    </Stack>
  )
})

function AttachmentPreview({
  attachment,
}: {
  attachment: UserMessageAttachment
}): React.ReactElement {
  const isImage =
    attachment.status === `complete` && attachment.mimeType.startsWith(`image/`)
  const label = `${attachment.name} · ${formatAttachmentSize(attachment.byteLength)}`
  const objectUrl = useAttachmentObjectUrl(attachment.url, isImage)
  const [previewOpen, setPreviewOpen] = useState(false)

  if (isImage) {
    return (
      <>
        <button
          type="button"
          className={styles.imageAttachment}
          title={label}
          onClick={() => setPreviewOpen(true)}
        >
          {objectUrl ? (
            <img src={objectUrl} alt={attachment.name} loading="lazy" />
          ) : (
            <div className={styles.imageLoading}>
              <Icon icon={ImageIcon} size={2} />
            </div>
          )}
          <span>
            <Icon icon={ImageIcon} size={1} />
            {attachment.name}
          </span>
        </button>
        <AttachmentImagePreviewDialog
          attachment={attachment}
          objectUrl={objectUrl}
          open={previewOpen}
          onOpenChange={setPreviewOpen}
        />
      </>
    )
  }

  return (
    <button
      type="button"
      className={styles.fileAttachment}
      title={label}
      onClick={() => {
        void downloadAttachment({
          url: attachment.url,
          filename: attachment.name,
        }).catch((error) => {
          console.error(`Attachment download failed`, error)
        })
      }}
    >
      <Icon icon={FileIcon} size={2} />
      <span>
        <strong>{attachment.name}</strong>
        <small>{formatAttachmentSize(attachment.byteLength)}</small>
      </span>
      <Icon icon={Download} size={1} />
    </button>
  )
}

function formatSender(from: string | null | undefined): {
  label: string
  title?: string
} {
  if (!from) return { label: `user` }
  if (!from.startsWith(`/principal/`)) return { label: from }
  const segment = from.slice(`/principal/`.length)
  if (!segment || segment.includes(`/`)) return { label: from }
  try {
    const key = decodeURIComponent(segment)
    const colon = key.indexOf(`:`)
    if (colon <= 0) return { label: key, title: from }
    const kind = key.slice(0, colon)
    const id = key.slice(colon + 1)
    return {
      label: `${kind}:${formatPrincipalId(id)}`,
      title: key,
    }
  } catch {
    return { label: from }
  }
}

function formatPrincipalId(id: string): string {
  if (id.length <= 18) return id
  return `${id.slice(0, 8)}…${id.slice(-6)}`
}
