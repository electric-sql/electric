import { Code, Flex, Text } from '@radix-ui/themes'
import type { EntityTimelineContentItem } from '@electric-ax/agent-runtime'

type ToolCallItem = Extract<EntityTimelineContentItem, { kind: `tool_call` }>

const STATUS_ICON: Partial<Record<string, { icon: string; color: string }>> = {
  started: { icon: `○`, color: `var(--amber-9)` },
  args_complete: { icon: `⟳`, color: `var(--amber-9)` },
  executing: { icon: `⟳`, color: `var(--amber-9)` },
  completed: { icon: `✓`, color: `var(--green-9)` },
  failed: { icon: `✗`, color: `var(--red-9)` },
}

const DEFAULT_STATUS_ICON = { icon: `○`, color: `var(--amber-9)` }

function truncateResult(result: unknown, isError: boolean): string {
  if (typeof result === `string`) return result.slice(0, 200)
  if (isError) return `Error`
  return JSON.stringify(result).slice(0, 200)
}

export function ToolCallView({
  item,
}: {
  item: ToolCallItem
}): React.ReactElement {
  const { icon, color } =
    STATUS_ICON[item.status ?? `started`] ?? DEFAULT_STATUS_ICON

  return (
    <Flex direction="column" gap="1" py="1">
      <Flex align="center" gap="2">
        <Text size="2" style={{ color }}>
          {icon}
        </Text>
        <Code size="2" color="gray">
          {item.toolName}
        </Code>
      </Flex>
      {item.result && (
        <Text
          size="1"
          color={item.isError ? `red` : `gray`}
          style={{
            paddingLeft: 20,
            whiteSpace: `pre-wrap`,
            maxHeight: 100,
            overflow: `hidden`,
          }}
        >
          {truncateResult(item.result, !!item.isError)}
        </Text>
      )}
    </Flex>
  )
}
