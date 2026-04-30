import { useState } from 'react'
import { Badge, Box, Flex, Text } from '@radix-ui/themes'
import type { EntityTimelineContentItem } from '@electric-ax/agents-runtime'

type ToolCallItem = Extract<EntityTimelineContentItem, { kind: `tool_call` }>

const codeBlockStyle: React.CSSProperties = {
  margin: 0,
  padding: 8,
  background: `var(--gray-a2)`,
  border: `1px solid var(--gray-a4)`,
  borderRadius: `var(--radius-2)`,
  fontSize: `var(--font-size-1)`,
  fontFamily: `var(--font-mono)`,
  whiteSpace: `pre-wrap`,
  wordBreak: `break-word`,
  maxHeight: 320,
  overflow: `auto`,
}

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
    case `spawn_coding_agent`:
    case `prompt_coding_agent`:
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

function ToolBody({ item }: { item: ToolCallItem }): React.ReactElement {
  const args = item.args
  const r = parseResult(item.result)

  switch (item.toolName) {
    case `bash`: {
      const exitCode = r.details.exitCode as number | undefined
      const timedOut = r.details.timedOut as boolean | undefined
      return (
        <Flex direction="column" gap="2">
          <Text size="1" color="gray" weight="medium">
            Command
          </Text>
          <pre style={codeBlockStyle}>{args.command as string}</pre>
          {r.text && (
            <>
              <Flex align="center" gap="2">
                <Text size="1" color="gray" weight="medium">
                  Output
                </Text>
                {exitCode !== undefined && exitCode !== 0 && (
                  <Badge color="red" variant="soft" size="1">
                    exit {exitCode}
                  </Badge>
                )}
                {timedOut && (
                  <Badge color="amber" variant="soft" size="1">
                    timed out
                  </Badge>
                )}
              </Flex>
              <pre style={codeBlockStyle}>{r.text}</pre>
            </>
          )}
        </Flex>
      )
    }

    case `read`:
      return (
        <Flex direction="column" gap="2">
          <Text size="1" color="gray" weight="medium">
            Content
          </Text>
          <pre style={codeBlockStyle}>
            {r.text ? truncate(r.text, 2000) : `(empty)`}
          </pre>
        </Flex>
      )

    case `edit`:
      return (
        <Flex direction="column" gap="2">
          {typeof args.old_string === `string` && (
            <>
              <Text size="1" color="red" weight="medium">
                Removed
              </Text>
              <pre style={{ ...codeBlockStyle, background: `var(--red-a2)` }}>
                {truncate(args.old_string, 500)}
              </pre>
            </>
          )}
          {typeof args.new_string === `string` && (
            <>
              <Text size="1" color="green" weight="medium">
                Added
              </Text>
              <pre style={{ ...codeBlockStyle, background: `var(--green-a2)` }}>
                {truncate(args.new_string, 500)}
              </pre>
            </>
          )}
          {r.text && (
            <Text size="1" color={item.isError ? `red` : `green`}>
              {r.text}
            </Text>
          )}
        </Flex>
      )

    case `write`:
      return (
        <Flex direction="column" gap="2">
          {typeof args.content === `string` && (
            <>
              <Text size="1" color="gray" weight="medium">
                Content
              </Text>
              <pre style={codeBlockStyle}>{truncate(args.content, 1000)}</pre>
            </>
          )}
          {r.text && (
            <Text size="1" color={item.isError ? `red` : `green`}>
              {r.text}
            </Text>
          )}
        </Flex>
      )

    default:
      return (
        <Flex direction="column" gap="2">
          <Text size="1" color="gray" weight="medium">
            Input
          </Text>
          <pre style={codeBlockStyle}>{JSON.stringify(args, null, 2)}</pre>
          {r.text && (
            <>
              <Text size="1" color="gray" weight="medium">
                Output
              </Text>
              <pre style={codeBlockStyle}>{r.text}</pre>
            </>
          )}
        </Flex>
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
    const isComplete = item.status === `completed` || item.status === `failed`
    const statusColor = !isComplete ? `gray` : item.isError ? `red` : `green`
    const statusLabel = !isComplete ? `pending` : item.isError ? `error` : `ok`

    return (
      <Flex
        direction="column"
        style={{
          border: `1px solid var(--gray-a4)`,
          borderRadius: `var(--radius-2)`,
          overflow: `hidden`,
        }}
      >
        <Flex
          align="center"
          gap="2"
          style={{
            padding: `6px 10px`,
            background: `var(--gray-a2)`,
            fontSize: `var(--font-size-2)`,
            fontFamily: `var(--font-mono)`,
          }}
        >
          <span style={{ fontWeight: 500 }}>send_message</span>
          <Badge
            color={statusColor}
            variant="soft"
            style={{ marginLeft: `auto` }}
          >
            {statusLabel}
          </Badge>
        </Flex>
        <Box
          style={{
            padding: `8px 12px`,
            borderTop: `1px solid var(--gray-a4)`,
            background: `var(--accent-a2)`,
          }}
        >
          <Text size="2" style={{ whiteSpace: `pre-wrap` }}>
            {item.args.text}
          </Text>
        </Box>
      </Flex>
    )
  }

  const [expanded, setExpanded] = useState(false)
  const summary = getSummary(item.toolName, item.args)
  const isComplete = item.status === `completed` || item.status === `failed`
  const statusColor = !isComplete ? `gray` : item.isError ? `red` : `green`
  const statusLabel = !isComplete
    ? item.status === `executing`
      ? `running`
      : `pending`
    : item.isError
      ? `error`
      : `ok`

  return (
    <Flex
      direction="column"
      style={{
        border: `1px solid var(--gray-a4)`,
        borderRadius: `var(--radius-2)`,
        overflow: `hidden`,
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        style={{
          all: `unset`,
          display: `flex`,
          alignItems: `center`,
          gap: 8,
          padding: `6px 10px`,
          cursor: `pointer`,
          background: `var(--gray-a2)`,
          fontSize: `var(--font-size-2)`,
          fontFamily: `var(--font-mono)`,
        }}
      >
        <span style={{ opacity: 0.5 }}>{expanded ? `▼` : `▶`}</span>
        <span style={{ fontWeight: 500 }}>{item.toolName}</span>
        {summary && (
          <span
            style={{
              color: `var(--gray-11)`,
              overflow: `hidden`,
              textOverflow: `ellipsis`,
              whiteSpace: `nowrap`,
              maxWidth: `36ch`,
            }}
          >
            {summary}
          </span>
        )}
        <Badge
          color={statusColor}
          variant="soft"
          style={{ marginLeft: `auto` }}
        >
          {statusLabel}
        </Badge>
      </button>
      {expanded && (
        <Box
          style={{
            padding: `8px 12px`,
            borderTop: `1px solid var(--gray-a4)`,
            background: `var(--gray-a1)`,
          }}
        >
          <ToolBody item={item} />
        </Box>
      )}
    </Flex>
  )
}
