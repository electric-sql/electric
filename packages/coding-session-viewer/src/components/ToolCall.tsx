import { useState } from 'react'
import type { ToolCallEvent, ToolResultEvent } from '../lib/types'

interface Props {
  call: ToolCallEvent
  result?: ToolResultEvent
}

function statusClass(call: ToolCallEvent, result?: ToolResultEvent): string {
  if (!result) return `running`
  return result.isError ? `error` : `success`
}

function statusLabel(call: ToolCallEvent, result?: ToolResultEvent): string {
  if (!result) return `running`
  return result.isError ? `error` : `ok`
}

function summarizeInput(input: Record<string, unknown>): string {
  if (typeof input.command === `string`) return input.command
  if (typeof input.cmd === `string`) return input.cmd
  if (typeof input.file_path === `string`) return input.file_path
  if (typeof input.path === `string`) return input.path
  if (typeof input.pattern === `string`) return input.pattern
  if (typeof input.url === `string`) return input.url
  return ``
}

export function ToolBlock({ call, result }: Props): React.ReactElement {
  const [expanded, setExpanded] = useState(false)
  const summary = summarizeInput(call.input)

  return (
    <div className={`tool${expanded ? ` expanded` : ``}`}>
      <button
        className="tool-header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="tool-icon">▶</span>
        <span className="tool-name">{call.tool}</span>
        {summary && (
          <span
            style={{
              color: `var(--c-text-3)`,
              fontFamily: `var(--font-mono)`,
              fontSize: `0.78rem`,
              overflow: `hidden`,
              textOverflow: `ellipsis`,
              whiteSpace: `nowrap`,
              maxWidth: `25rem`,
            }}
          >
            {summary}
          </span>
        )}
        <span className={`tool-status ${statusClass(call, result)}`}>
          {statusLabel(call, result)}
        </span>
      </button>
      {expanded && (
        <div className="tool-body">
          <div>
            <h4>Input</h4>
            <pre>{JSON.stringify(call.input, null, 2)}</pre>
          </div>
          {result && (
            <div>
              <h4>Output</h4>
              <pre>{result.output}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
