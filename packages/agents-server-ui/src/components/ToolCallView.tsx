import { useState } from 'react'
import { Box, Code, Flex, Text } from '@radix-ui/themes'
import type { EntityTimelineContentItem } from '@electric-ax/agents-runtime'

type ToolCallItem = Extract<EntityTimelineContentItem, { kind: `tool_call` }>

const STATUS_ICON: Partial<Record<string, { icon: string; color: string }>> = {
  started: { icon: `○`, color: `var(--amber-9)` },
  args_complete: { icon: `⟳`, color: `var(--amber-9)` },
  executing: { icon: `⟳`, color: `var(--amber-9)` },
  completed: { icon: `✓`, color: `var(--green-9)` },
  failed: { icon: `✗`, color: `var(--red-9)` },
}

const DEFAULT_STATUS_ICON = { icon: `○`, color: `var(--amber-9)` }

const codeStyle = {
  display: `block`,
  whiteSpace: `pre-wrap` as const,
  wordBreak: `break-all` as const,
  padding: `6px 8px`,
  borderRadius: `var(--radius-2)`,
  background: `var(--gray-a2)`,
  fontSize: `var(--font-size-1)`,
  maxHeight: 150,
  overflow: `auto`,
}

const resultStyle = {
  paddingLeft: 20,
  whiteSpace: `pre-wrap` as const,
  maxHeight: 100,
  overflow: `hidden` as const,
}

/** Extract a one-line summary from tool args */
function getSummary(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case `bash`:
      return (args.command as string) ?? ``
    case `read`:
      return (args.path as string) ?? ``
    case `write`:
      return (args.path as string) ?? ``
    case `edit`:
      return (args.path as string) ?? ``
    case `send_message`:
      return truncate((args.text as string) ?? ``, 120)
    case `web_search`:
    case `brave_search`:
      return (args.query as string) ?? ``
    case `fetch_url`:
      return (args.url as string) ?? ``
    case `spawn_worker`:
      return truncate((args.initialMessage as string) ?? ``, 80)
    case `spawn_coder`:
      return truncate((args.prompt as string) ?? ``, 80)
    case `prompt_coder`:
      return truncate((args.prompt as string) ?? ``, 80)
    default: {
      // Fallback: check common field names
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
        if (typeof v === `string`) return truncate(v, 100)
      }
      return ``
    }
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + `…` : s
}

/** Tool-specific detail rendering */
function ToolDetail({
  item,
}: {
  item: ToolCallItem
}): React.ReactElement | null {
  const args = item.args
  const result = item.result

  switch (item.toolName) {
    case `bash`:
      return (
        <Flex direction="column" gap="1" style={{ paddingLeft: 20 }}>
          <code style={codeStyle}>{args.command as string}</code>
          {result && (
            <Text
              size="1"
              color={item.isError ? `red` : `gray`}
              style={resultStyle}
            >
              {truncate(result, 500)}
            </Text>
          )}
        </Flex>
      )

    case `read`:
      return result ? (
        <Box style={{ paddingLeft: 20 }}>
          <Text
            size="1"
            color={item.isError ? `red` : `gray`}
            style={resultStyle}
          >
            {truncate(result, 500)}
          </Text>
        </Box>
      ) : null

    case `write`:
    case `edit`:
      return (
        <Flex direction="column" gap="1" style={{ paddingLeft: 20 }}>
          {item.toolName === `edit` && typeof args.old_string === `string` && (
            <code style={{ ...codeStyle, background: `var(--red-a2)` }}>
              {`- ${truncate(args.old_string, 200)}`}
            </code>
          )}
          {item.toolName === `edit` && typeof args.new_string === `string` && (
            <code style={{ ...codeStyle, background: `var(--green-a2)` }}>
              {`+ ${truncate(args.new_string, 200)}`}
            </code>
          )}
          {result && (
            <Text size="1" color={item.isError ? `red` : `green`}>
              {result}
            </Text>
          )}
        </Flex>
      )

    case `send_message`:
      return (
        <Box style={{ paddingLeft: 20 }}>
          <Text size="2" style={{ whiteSpace: `pre-wrap` }}>
            {args.text as string}
          </Text>
        </Box>
      )

    case `web_search`:
    case `brave_search`:
      return result ? (
        <Box style={{ paddingLeft: 20 }}>
          <Text size="1" color="gray" style={resultStyle}>
            {truncate(result, 500)}
          </Text>
        </Box>
      ) : null

    case `fetch_url`:
      return result ? (
        <Box style={{ paddingLeft: 20 }}>
          <Text
            size="1"
            color={item.isError ? `red` : `gray`}
            style={resultStyle}
          >
            {truncate(result, 300)}
          </Text>
        </Box>
      ) : null

    case `spawn_worker`:
    case `spawn_coder`:
    case `prompt_coder`:
      return result ? (
        <Box style={{ paddingLeft: 20 }}>
          <Text size="1" color={item.isError ? `red` : `green`}>
            {result}
          </Text>
        </Box>
      ) : null

    default:
      // Fallback: show truncated result
      return result ? (
        <Box style={{ paddingLeft: 20 }}>
          <Text
            size="1"
            color={item.isError ? `red` : `gray`}
            style={resultStyle}
          >
            {truncate(result, 300)}
          </Text>
        </Box>
      ) : null
  }
}

export function ToolCallView({
  item,
}: {
  item: ToolCallItem
}): React.ReactElement {
  const { icon, color } =
    STATUS_ICON[item.status ?? `started`] ?? DEFAULT_STATUS_ICON
  const summary = getSummary(item.toolName, item.args)
  const [expanded, setExpanded] = useState(false)
  const isComplete = item.status === `completed` || item.status === `failed`

  return (
    <Flex direction="column" gap="1" py="1">
      <Flex
        align="center"
        gap="2"
        style={{ cursor: isComplete ? `pointer` : undefined }}
        onClick={() => isComplete && setExpanded((v) => !v)}
      >
        <Text size="2" style={{ color }}>
          {icon}
        </Text>
        <Code size="2" color="gray">
          {item.toolName}
        </Code>
        {summary && (
          <Text
            size="1"
            color="gray"
            style={{
              overflow: `hidden`,
              textOverflow: `ellipsis`,
              whiteSpace: `nowrap`,
              flex: 1,
            }}
          >
            {summary}
          </Text>
        )}
        {isComplete && (
          <Text size="1" color="gray">
            {expanded ? `▼` : `▶`}
          </Text>
        )}
      </Flex>
      {expanded && <ToolDetail item={item} />}
    </Flex>
  )
}
