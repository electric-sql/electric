import { useEffect, useRef } from 'react'
import { highlightCodeBlocks, renderMarkdown } from '../lib/markdown'

interface UserProps {
  text: string
  user?: { name: string; email?: string }
  /**
   * When true, the prompt was received by the agent but hasn't been
   * processed yet (queue-channel submissions that land mid-turn).
   * Rendered with a muted "queued" badge so the submitter and other
   * viewers see immediate feedback instead of wondering if it was lost.
   */
  pending?: boolean
}

interface AssistantProps {
  text: string
  phase?: `commentary` | `final`
}

export function UserMessage({
  text,
  user,
  pending,
}: UserProps): React.ReactElement {
  return (
    <div className={`message user${pending ? ` pending` : ``}`}>
      {user?.name && (
        <div className="message-author">
          {user.name}
          {pending && <span className="message-badge">queued</span>}
        </div>
      )}
      <div className="message-bubble">{text}</div>
    </div>
  )
}

export function AssistantMessage({
  text,
  phase,
}: AssistantProps): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  const html = renderMarkdown(text)

  useEffect(() => {
    if (ref.current) {
      void highlightCodeBlocks(ref.current)
    }
  }, [html])

  return (
    <div className="message assistant">
      <div className="message-author">
        Assistant{phase === `commentary` ? ` · commentary` : ``}
      </div>
      <div
        className="message-bubble"
        ref={ref}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}

export function Thinking({ summary }: { summary: string }): React.ReactElement {
  return <div className="thinking">{summary}</div>
}

export function Compaction(): React.ReactElement {
  return <div className="compaction">compacted</div>
}

export function ErrorCallout({
  code,
  message,
}: {
  code?: string
  message: string
}): React.ReactElement {
  return (
    <div className="callout error">
      <strong>{code ?? `error`}:</strong> {message}
    </div>
  )
}

export function PermissionRequest({
  tool,
  input,
}: {
  tool: string
  input: Record<string, unknown>
}): React.ReactElement {
  return (
    <div className="callout warn">
      <strong>Approval requested</strong> for <code>{tool}</code>:{` `}
      <code>{JSON.stringify(input).slice(0, 80)}</code>
    </div>
  )
}

export function PermissionResponse({
  decision,
  user,
}: {
  decision: string
  user?: { name: string }
}): React.ReactElement {
  return (
    <div className="callout warn">
      <strong>{user?.name ?? `User`}</strong> {decision}
    </div>
  )
}
