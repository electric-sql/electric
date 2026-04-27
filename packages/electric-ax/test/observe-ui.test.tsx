import { describe, expect, it } from 'vitest'
import { render } from 'ink-testing-library'
import {
  AgentTextView,
  ToolCallView,
  ToolResultView,
  UserMessageView,
  formatTime,
  truncate,
} from '../src/observe-ui'

// ============================================================================
// Helper functions
// ============================================================================

describe(`formatTime`, () => {
  it(`returns empty string for undefined`, () => {
    expect(formatTime(undefined)).toBe(``)
  })

  it(`returns a string for invalid date (Date constructor doesn't throw)`, () => {
    // new Date("not-a-date") produces Invalid Date, which toLocaleTimeString
    // returns as "Invalid Date" — the function doesn't catch this case
    const result = formatTime(`not-a-date`)
    expect(typeof result).toBe(`string`)
  })

  it(`formats a valid ISO timestamp`, () => {
    const result = formatTime(`2026-03-12T04:41:37.761Z`)
    // Should be a time string with hours:minutes:seconds
    expect(result).toMatch(/\d{1,2}:\d{2}:\d{2}/)
  })
})

describe(`truncate`, () => {
  it(`returns string unchanged when under max`, () => {
    expect(truncate(`hello`, 10)).toBe(`hello`)
  })

  it(`returns string unchanged at exactly max`, () => {
    expect(truncate(`hello`, 5)).toBe(`hello`)
  })

  it(`truncates and adds ellipsis when over max`, () => {
    expect(truncate(`hello world`, 8)).toBe(`hello...`)
  })

  it(`handles very short max`, () => {
    expect(truncate(`hello`, 4)).toBe(`h...`)
  })
})

// ============================================================================
// Ink component rendering
// ============================================================================

describe(`UserMessageView`, () => {
  it(`renders user name and text payload`, () => {
    const { lastFrame } = render(
      <UserMessageView
        msg={{
          key: `msg-1`,
          from: `alice`,
          payload: { text: `hello world` },
          timestamp: `2026-03-12T04:41:37.761Z`,
        }}
      />
    )
    const output = lastFrame()
    expect(output).toContain(`alice`)
    expect(output).toContain(`hello world`)
  })

  it(`renders string payload directly`, () => {
    const { lastFrame } = render(
      <UserMessageView
        msg={{
          key: `msg-1`,
          from: `bob`,
          payload: `raw string`,
          timestamp: ``,
        }}
      />
    )
    expect(lastFrame()).toContain(`raw string`)
  })

  it(`renders non-text object payload as JSON`, () => {
    const { lastFrame } = render(
      <UserMessageView
        msg={{
          key: `msg-1`,
          from: `bob`,
          payload: { count: 42 },
          timestamp: ``,
        }}
      />
    )
    expect(lastFrame()).toContain(`42`)
  })

  it(`renders multiline text`, () => {
    const { lastFrame } = render(
      <UserMessageView
        msg={{
          key: `msg-1`,
          from: `alice`,
          payload: { text: `line 1\nline 2\nline 3` },
          timestamp: ``,
        }}
      />
    )
    const output = lastFrame()
    expect(output).toContain(`line 1`)
    expect(output).toContain(`line 2`)
    expect(output).toContain(`line 3`)
  })
})

describe(`AgentTextView`, () => {
  it(`renders accumulated text with default assistant header`, () => {
    const { lastFrame } = render(
      <AgentTextView
        text={{ key: `msg-0`, status: `completed` }}
        accumulatedText="Hello, how can I help?"
      />
    )
    const output = lastFrame()
    expect(output).toContain(`assistant`)
    expect(output).toContain(`Hello, how can I help?`)
  })

  it(`renders custom label instead of assistant`, () => {
    const { lastFrame } = render(
      <AgentTextView
        text={{ key: `msg-0`, status: `completed` }}
        accumulatedText="Hello"
        label="/chat/test"
      />
    )
    const output = lastFrame()
    expect(output).toContain(`/chat/test`)
    expect(output).not.toContain(`assistant`)
  })

  it(`shows cursor when streaming`, () => {
    const { lastFrame } = render(
      <AgentTextView
        text={{ key: `msg-0`, status: `streaming` }}
        accumulatedText="Thinking"
      />
    )
    expect(lastFrame()).toContain(`▌`)
  })

  it(`hides cursor when completed`, () => {
    const { lastFrame } = render(
      <AgentTextView
        text={{ key: `msg-0`, status: `completed` }}
        accumulatedText="Done"
      />
    )
    expect(lastFrame()).not.toContain(`▌`)
  })

  it(`renders multiline text`, () => {
    const { lastFrame } = render(
      <AgentTextView
        text={{ key: `msg-0`, status: `completed` }}
        accumulatedText={`line 1\nline 2`}
      />
    )
    const output = lastFrame()
    expect(output).toContain(`line 1`)
    expect(output).toContain(`line 2`)
  })
})

describe(`ToolCallView`, () => {
  it(`shows checkmark for completed tool call`, () => {
    const { lastFrame } = render(
      <ToolCallView
        tc={{
          kind: `tool_call`,
          toolCallId: `tc-0`,
          toolName: `search`,
          args: {},
          status: `completed`,
          result: `found 3 items`,
          isError: false,
        }}
      />
    )
    const output = lastFrame()
    expect(output).toContain(`✓`)
    expect(output).toContain(`search`)
  })

  it(`shows X for failed tool call`, () => {
    const { lastFrame } = render(
      <ToolCallView
        tc={{
          kind: `tool_call`,
          toolCallId: `tc-0`,
          toolName: `fetch`,
          args: {},
          status: `failed`,
          result: `timeout`,
          isError: true,
        }}
      />
    )
    const output = lastFrame()
    expect(output).toContain(`✗`)
    expect(output).toContain(`fetch`)
    expect(output).toContain(`timeout`)
  })

  it(`shows spinner for executing tool call`, () => {
    const { lastFrame } = render(
      <ToolCallView
        tc={{
          kind: `tool_call`,
          toolCallId: `tc-0`,
          toolName: `compute`,
          args: {},
          status: `executing`,
          isError: false,
        }}
      />
    )
    const output = lastFrame()
    expect(output).toContain(`⟳`)
    expect(output).toContain(`compute`)
  })

  it(`shows circle for started tool call`, () => {
    const { lastFrame } = render(
      <ToolCallView
        tc={{
          kind: `tool_call`,
          toolCallId: `tc-0`,
          toolName: `lookup`,
          args: {},
          status: `started`,
          isError: false,
        }}
      />
    )
    expect(lastFrame()).toContain(`○`)
  })

  it(`renders JSON result for non-string results`, () => {
    const { lastFrame } = render(
      <ToolCallView
        tc={{
          kind: `tool_call`,
          toolCallId: `tc-0`,
          toolName: `api`,
          args: {},
          status: `completed`,
          result: `{"data":[1,2,3]}`,
          isError: false,
        }}
      />
    )
    expect(lastFrame()).toContain(`[1,2,3]`)
  })
})

describe(`ToolResultView`, () => {
  it(`shows up to 5 lines of result`, () => {
    const lines = Array.from({ length: 8 }, (_, i) => `line ${i + 1}`)
    const { lastFrame } = render(<ToolResultView result={lines.join(`\n`)} />)
    const output = lastFrame()
    expect(output).toContain(`line 1`)
    expect(output).toContain(`line 5`)
    expect(output).toContain(`3 more lines`)
    expect(output).not.toContain(`line 6`)
  })

  it(`renders short result without truncation message`, () => {
    const { lastFrame } = render(<ToolResultView result="short result" />)
    const output = lastFrame()
    expect(output).toContain(`short result`)
    expect(output).not.toContain(`more lines`)
  })
})
