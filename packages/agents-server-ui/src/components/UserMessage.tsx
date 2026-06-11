import { memo, useState } from 'react'
import { Streamdown } from 'streamdown'
import {
  Download,
  File as FileIcon,
  Image as ImageIcon,
  Reply,
  Square,
} from 'lucide-react'
import type { EntityTimelineSection } from '@electric-ax/agents-runtime/client'
import { Icon, IconButton, Stack, Text, Tooltip } from '../ui'
import { downloadAttachment, formatAttachmentSize } from '../lib/attachments'
import {
  streamdownComponents,
  streamdownControls,
} from '../lib/streamdownConfig'
import {
  AttachmentImagePreviewDialog,
  useAttachmentObjectUrl,
} from './AttachmentImagePreviewDialog'
import { TimeText } from './TimeText'
import styles from './UserMessage.module.css'
import { formatSender } from '../lib/principals'
import type { ElectricUser } from '../lib/ElectricAgentsProvider'

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

export type ForkFromHereAction = {
  disabled?: boolean
  onFork?: () => void
}

export const UserMessage = memo(function UserMessage({
  section,
  attachments = [],
  showStop = false,
  stopPending = false,
  currentPrincipal,
  usersById,
  onStop,
  onReply,
}: {
  section: UserMessageSection
  attachments?: Array<UserMessageAttachment>
  showStop?: boolean
  stopPending?: boolean
  currentPrincipal?: string
  usersById?: Map<string, ElectricUser>
  onStop?: () => void
  onReply?: () => void
}): React.ReactElement {
  const sender = formatSender(section.from, { currentPrincipal, usersById })

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
        {section.text ? <UserMessageBody text={section.text} /> : null}
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
        {onReply && (
          <span className={styles.metaActions}>
            <Tooltip content="Reply" side="top">
              <IconButton
                size={1}
                variant="ghost"
                tone="neutral"
                className={styles.metaActionButton}
                onClick={onReply}
                aria-label="Reply to message"
                title="Reply"
              >
                <Icon icon={Reply} size={1} />
              </IconButton>
            </Tooltip>
          </span>
        )}
      </Stack>
    </Stack>
  )
})

const userMessageAllowedMarkdownElements = [
  `p`,
  `br`,
  `a`,
  `strong`,
  `em`,
  `del`,
  `code`,
  `pre`,
  `blockquote`,
  `ul`,
  `ol`,
  `li`,
] as const

const UserMessageBody = memo(function UserMessageBody({
  text,
}: {
  text: string
}): React.ReactElement {
  return (
    <div className={`agent-ui-markdown ${styles.body}`}>
      <Streamdown
        isAnimating={false}
        linkSafety={{ enabled: false }}
        allowedElements={userMessageAllowedMarkdownElements}
        unwrapDisallowed
        controls={streamdownControls}
        components={streamdownComponents}
      >
        {text}
      </Streamdown>
    </div>
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
          <div className={styles.imageThumb}>
            {objectUrl ? (
              <img src={objectUrl} alt={attachment.name} loading="lazy" />
            ) : (
              <div className={styles.imageLoading}>
                <Icon icon={ImageIcon} size={2} />
              </div>
            )}
          </div>
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
