import {
  buildEntityTimelineData,
  buildSections,
} from '@electric-ax/agents-runtime'
import type {
  EntityStreamDB,
  EntityTimelineContentItem,
  EntityTimelineData,
  EntityTimelineSection,
} from '@electric-ax/agents-runtime'

export interface EntityConversationViewOptions {
  entityUrl: string
}

const TOOL_RESULT_MAX_LINES = 5
const TOOL_RESULT_MAX_COLUMNS = 120

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value
}

function appendIndented(lines: Array<string>, text: string, prefix: string) {
  const textLines = text.split(/\r?\n/)
  for (const line of textLines) {
    lines.push(`${prefix}${line}`)
  }
}

function appendTextBlock(blocks: Array<string>, label: string, text: string) {
  const lines = [`${label}:`]
  appendIndented(lines, text, `  `)
  blocks.push(lines.join(`\n`))
}

function wakeReason(
  section: Extract<EntityTimelineSection, { kind: `wake` }>
): string {
  const { payload } = section
  if (payload.timeout) return `timeout`
  if (payload.finished_child) {
    return `child ${payload.finished_child.run_status}`
  }
  if (payload.changes.length > 0) {
    return `${payload.changes.length} ${payload.changes.length === 1 ? `change` : `changes`}`
  }
  if (payload.other_children && payload.other_children.length > 0) {
    return `${payload.other_children.length} child ${payload.other_children.length === 1 ? `update` : `updates`}`
  }
  return payload.source
}

function appendToolCall(
  lines: Array<string>,
  item: Extract<EntityTimelineContentItem, { kind: `tool_call` }>
) {
  const status = item.isError ? `failed` : item.status
  lines.push(`  [tool:${item.toolName}] ${status}`)

  if (item.result === undefined) {
    return
  }

  const resultLines = item.result.split(/\r?\n/)
  for (const line of resultLines.slice(0, TOOL_RESULT_MAX_LINES)) {
    lines.push(`    ${truncate(line, TOOL_RESULT_MAX_COLUMNS)}`)
  }
  const remaining = resultLines.length - TOOL_RESULT_MAX_LINES
  if (remaining > 0) {
    lines.push(`    ... ${remaining} more lines`)
  }
}

function appendAgentResponse(
  blocks: Array<string>,
  section: Extract<EntityTimelineSection, { kind: `agent_response` }>,
  label: string
) {
  const lines = [`${label}:`]

  for (const item of section.items) {
    if (item.kind === `text`) {
      appendIndented(lines, item.text, `  `)
      continue
    }

    appendToolCall(lines, item)
  }

  if (section.error) {
    appendIndented(lines, `[error] ${section.error}`, `  `)
  }

  if (lines.length === 1) {
    lines.push(`  (no output)`)
  }

  blocks.push(lines.join(`\n`))
}

export function formatEntityConversationView(
  data: EntityTimelineData,
  options: EntityConversationViewOptions
): string {
  const sections = buildSections(data.runs, data.inbox, data.wakes)

  if (sections.length === 0) {
    return `No conversation events found`
  }

  const blocks: Array<string> = []
  for (const section of sections) {
    if (section.kind === `user_message`) {
      appendTextBlock(blocks, section.from ?? `user`, section.text)
      continue
    }

    if (section.kind === `wake`) {
      appendTextBlock(
        blocks,
        `wake`,
        `${wakeReason(section)} from ${section.payload.source}`
      )
      continue
    }

    appendAgentResponse(blocks, section, options.entityUrl)
  }

  return blocks.join(`\n\n`)
}

export function formatEntityConversationViewFromDB(
  db: EntityStreamDB,
  options: EntityConversationViewOptions
): string {
  return formatEntityConversationView(buildEntityTimelineData(db), options)
}
