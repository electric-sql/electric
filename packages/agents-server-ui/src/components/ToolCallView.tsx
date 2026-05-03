import { useState } from 'react'
import type { EntityTimelineContentItem } from '@electric-ax/agents-runtime'
import { Badge, Box, Stack, Text } from '../ui'
import type { BadgeTone } from '../ui'
import styles from './ToolCallView.module.css'

type ToolCallItem = Extract<EntityTimelineContentItem, { kind: `tool_call` }>

interface ParsedResult {
  text: string
  details: Record<string, unknown>
}

function parseResult(result: string | undefined): ParsedResult {
  if (!result) return { text: ``, details: {} }
  try {
    const parsed = JSON.parse(result) as {
      content?: Array<{ text?: string }>
      details?: Record<string, unknown>
    }
    if (parsed.content) {
      const text = parsed.content
        .map((c) => c.text ?? ``)
        .join(``)
        .trim()
      return { text, details: parsed.details ?? {} }
    }
    return { text: result, details: {} }
  } catch {
    return { text: result, details: {} }
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + `…` : s
}

function getSummary(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case `bash`:
      return truncate((args.command as string) ?? ``, 60)
    case `read`:
      return (args.path as string) ?? ``
    case `write`:
      return (args.path as string) ?? ``
    case `edit`:
      return (args.path as string) ?? ``
    case `web_search`:
    case `brave_search`:
      return (args.query as string) ?? ``
    case `fetch_url`:
      return (args.url as string) ?? ``
    case `spawn_worker`:
      return truncate((args.initialMessage as string) ?? ``, 60)
    case `spawn_coder`:
    case `prompt_coder`:
      return truncate((args.prompt as string) ?? ``, 60)
    default:
      for (const field of [
        `command`,
        `file_path`,
        `path`,
        `pattern`,
        `url`,
        `query`,
        `text`,
      ]) {
        const v = args[field]
        if (typeof v === `string`) return truncate(v, 60)
      }
      return ``
  }
}

function statusToTone(item: ToolCallItem): {
  tone: BadgeTone
  label: string
} {
  const isComplete = item.status === `completed` || item.status === `failed`
  if (!isComplete) {
    return {
      tone: `neutral`,
      label: item.status === `executing` ? `running` : `pending`,
    }
  }
  return item.isError
    ? { tone: `danger`, label: `error` }
    : { tone: `success`, label: `ok` }
}

function ToolBody({ item }: { item: ToolCallItem }): React.ReactElement {
  const args = item.args
  const r = parseResult(item.result)

  switch (item.toolName) {
    case `bash`: {
      const exitCode = r.details.exitCode as number | undefined
      const timedOut = r.details.timedOut as boolean | undefined
      return (
        <Stack direction="column" gap={2}>
          <Text size={1} tone="muted" weight="medium">
            Command
          </Text>
          <pre className={styles.codeBlock}>{args.command as string}</pre>
          {r.text && (
            <>
              <Stack align="center" gap={2}>
                <Text size={1} tone="muted" weight="medium">
                  Output
                </Text>
                {exitCode !== undefined && exitCode !== 0 && (
                  <Badge tone="danger" variant="soft" size={1}>
                    exit {exitCode}
                  </Badge>
                )}
                {timedOut && (
                  <Badge tone="warning" variant="soft" size={1}>
                    timed out
                  </Badge>
                )}
              </Stack>
              <pre className={styles.codeBlock}>{r.text}</pre>
            </>
          )}
        </Stack>
      )
    }

    case `read`:
      return (
        <Stack direction="column" gap={2}>
          <Text size={1} tone="muted" weight="medium">
            Content
          </Text>
          <pre className={styles.codeBlock}>
            {r.text ? truncate(r.text, 2000) : `(empty)`}
          </pre>
        </Stack>
      )

    case `edit`:
      return (
        <Stack direction="column" gap={2}>
          {typeof args.old_string === `string` && (
            <>
              <Text size={1} tone="danger" weight="medium">
                Removed
              </Text>
              <pre className={`${styles.codeBlock} ${styles.codeBlockRemoved}`}>
                {truncate(args.old_string, 500)}
              </pre>
            </>
          )}
          {typeof args.new_string === `string` && (
            <>
              <Text size={1} tone="success" weight="medium">
                Added
              </Text>
              <pre className={`${styles.codeBlock} ${styles.codeBlockAdded}`}>
                {truncate(args.new_string, 500)}
              </pre>
            </>
          )}
          {r.text && (
            <Text size={1} tone={item.isError ? `danger` : `success`}>
              {r.text}
            </Text>
          )}
        </Stack>
      )

    case `write`:
      return (
        <Stack direction="column" gap={2}>
          {typeof args.content === `string` && (
            <>
              <Text size={1} tone="muted" weight="medium">
                Content
              </Text>
              <pre className={styles.codeBlock}>
                {truncate(args.content, 1000)}
              </pre>
            </>
          )}
          {r.text && (
            <Text size={1} tone={item.isError ? `danger` : `success`}>
              {r.text}
            </Text>
          )}
        </Stack>
      )

    default:
      return (
        <Stack direction="column" gap={2}>
          <Text size={1} tone="muted" weight="medium">
            Input
          </Text>
          <pre className={styles.codeBlock}>
            {JSON.stringify(args, null, 2)}
          </pre>
          {r.text && (
            <>
              <Text size={1} tone="muted" weight="medium">
                Output
              </Text>
              <pre className={styles.codeBlock}>{r.text}</pre>
            </>
          )}
        </Stack>
      )
  }
}

export function ToolCallView({
  item,
}: {
  item: ToolCallItem
}): React.ReactElement {
  // send_message: same container style but always expanded with the message text
  if (item.toolName === `send_message` && typeof item.args.text === `string`) {
    const { tone, label } = statusToTone(item)

    return (
      <Stack direction="column" className={styles.card}>
        <Stack align="center" gap={2} className={styles.header}>
          <span className={styles.toolName}>send_message</span>
          <Badge tone={tone} variant="soft" className={styles.statusBadge}>
            {label}
          </Badge>
        </Stack>
        <Box className={styles.sentMessage}>
          <Text size={2} className={styles.sentMessageBody}>
            {item.args.text}
          </Text>
        </Box>
      </Stack>
    )
  }

  const [expanded, setExpanded] = useState(false)
  const summary = getSummary(item.toolName, item.args)
  const { tone, label } = statusToTone(item)

  return (
    <Stack direction="column" className={styles.card}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={`${styles.header} ${styles.headerToggle}`}
        style={{ display: `flex`, alignItems: `center`, gap: 8 }}
      >
        <span className={styles.toggleArrow}>{expanded ? `▼` : `▶`}</span>
        <span className={styles.toolName}>{item.toolName}</span>
        {summary && <span className={styles.summary}>{summary}</span>}
        <Badge tone={tone} variant="soft" className={styles.statusBadge}>
          {label}
        </Badge>
      </button>
      {expanded && (
        <Box className={styles.body}>
          <ToolBody item={item} />
        </Box>
      )}
    </Stack>
  )
}
