import { memo } from 'react'
import { Reply } from 'lucide-react'
import type {
  CommentSnapshot,
  CommentTarget,
} from '@electric-ax/agents-runtime/client'
import type { EntityTimelineCommentRow } from '../lib/comments'
import { Icon, IconButton, Text, Tooltip } from '../ui'
import { principalKeyFromInput } from '../lib/principals'
import { TimeText } from './TimeText'
import type { ElectricUser } from '../lib/ElectricAgentsProvider'
import styles from './CommentBubble.module.css'

export const CommentBubble = memo(function CommentBubble({
  comment,
  currentPrincipal,
  usersById,
  showMeta = true,
  onReply,
  onTargetClick,
}: {
  comment: EntityTimelineCommentRow
  currentPrincipal?: string
  usersById?: Map<string, ElectricUser>
  showMeta?: boolean
  onReply?: (comment: EntityTimelineCommentRow) => void
  onTargetClick?: (target: CommentTarget) => void
}): React.ReactElement {
  const isOwn =
    principalKeyFromInput(comment.from) ===
    principalKeyFromInput(currentPrincipal)
  const sender = formatSender(comment.from, {
    currentPrincipal,
    usersById,
  })
  const timestamp = Date.parse(comment.timestamp)
  const deleted = Boolean(comment.deleted_at)
  const singleLine = !deleted && !/[\r\n]/.test(comment.body)

  return (
    <div
      className={styles.root}
      data-own={isOwn ? `true` : `false`}
      data-single-line={singleLine ? `true` : `false`}
    >
      <div className={styles.column}>
        {comment.target_snapshot && (
          <ReplyPreview
            snapshot={comment.target_snapshot}
            onClick={
              comment.reply_to && onTargetClick
                ? () => onTargetClick(comment.reply_to!)
                : undefined
            }
          />
        )}
        <div className={styles.message}>
          <div className={styles.bubble}>
            <div className={deleted ? styles.deletedBody : styles.body}>
              {deleted ? `Comment deleted` : comment.body}
            </div>
          </div>
          {showMeta && (
            <div className={styles.meta}>
              <Text size={1} tone="muted" title={sender.title}>
                {sender.label}
              </Text>
              {Number.isFinite(timestamp) && (
                <>
                  <Text size={1} tone="muted">
                    -
                  </Text>
                  <TimeText ts={timestamp} />
                </>
              )}
              {comment.edited_at && !deleted && (
                <>
                  <Text size={1} tone="muted">
                    -
                  </Text>
                  <Text size={1} tone="muted">
                    edited
                  </Text>
                </>
              )}
              {onReply && !deleted && (
                <span className={styles.metaActions}>
                  <Tooltip content="Reply" side="top">
                    <IconButton
                      size={1}
                      variant="ghost"
                      tone="neutral"
                      className={styles.metaActionButton}
                      aria-label="Reply to comment"
                      title="Reply"
                      onClick={() => onReply(comment)}
                    >
                      <Icon icon={Reply} size={1} />
                    </IconButton>
                  </Tooltip>
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

function ReplyPreview({
  snapshot,
  onClick,
}: {
  snapshot: CommentSnapshot
  onClick?: () => void
}): React.ReactElement {
  const content = (
    <>
      <Icon icon={Reply} size={1} className={styles.previewIcon} />
      <div className={styles.previewContent}>
        <div className={styles.previewLabel}>{snapshot.label}</div>
        {snapshot.text && (
          <div className={styles.previewText}>{snapshot.text}</div>
        )}
      </div>
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        className={`${styles.preview} ${styles.previewButton}`}
        aria-label={`Show ${snapshot.label}`}
        title={`Show ${snapshot.label}`}
        onClick={onClick}
      >
        {content}
      </button>
    )
  }

  return <div className={styles.preview}>{content}</div>
}

function formatSender(
  from: string | null | undefined,
  options: {
    currentPrincipal?: string
    usersById?: Map<string, ElectricUser>
  } = {}
): {
  label: string
  title?: string
} {
  const key = principalKeyFromInput(from)
  if (!key) return { label: from || `user` }
  if (key === principalKeyFromInput(options.currentPrincipal)) {
    return { label: `Me`, title: key }
  }
  const colon = key.indexOf(`:`)
  if (colon <= 0) return { label: key, title: key }
  const kind = key.slice(0, colon)
  const id = key.slice(colon + 1)
  if (kind === `user`) {
    const user = options.usersById?.get(id)
    const label = user?.display_name || user?.email
    if (label) return { label, title: key }
  }
  return {
    label: `${kind}:${formatPrincipalId(id)}`,
    title: key,
  }
}

function formatPrincipalId(id: string): string {
  if (id.length <= 18) return id
  return `${id.slice(0, 8)}...${id.slice(-6)}`
}
