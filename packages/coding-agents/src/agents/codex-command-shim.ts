/**
 * Codex stream-json (`codex exec --json`) emits shell tool invocations as
 * `{type:'item.completed', item:{type:'command_execution', command, aggregated_output, exit_code}}`.
 * The patched `agent-session-protocol@0.0.2` only handles `function_call` /
 * `function_call_output` items — `command_execution` is silently dropped, and
 * the resulting events collection is missing every shell call codex made.
 *
 * Until asp grows a `command_execution` branch upstream, expand each such
 * item into the equivalent `function_call` + `function_call_output` pair on
 * the wire so asp's existing matchers fire. Order is preserved (call before
 * output, both share the item's `id` so asp pairs them correctly).
 *
 * Cheap, self-contained, no upstream patch maintenance.
 */
export function expandCodexCommandExecutions(
  lines: ReadonlyArray<string>
): Array<string> {
  const out: Array<string> = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith(`{`)) {
      out.push(line)
      continue
    }
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      out.push(line)
      continue
    }
    const item = obj.item as Record<string, unknown> | undefined
    if (
      obj.type !== `item.completed` ||
      !item ||
      item.type !== `command_execution`
    ) {
      out.push(line)
      continue
    }
    // Mint stable call_id from item.id so asp pairs the synthesised
    // call/output correctly.
    const callId = String(item.id ?? ``)
    const command = String(item.command ?? ``)
    const output = String(item.aggregated_output ?? ``)
    const exitCode =
      typeof item.exit_code === `number` ? item.exit_code : undefined
    out.push(
      JSON.stringify({
        type: `item.completed`,
        item: {
          id: callId,
          call_id: callId,
          type: `function_call`,
          name: `shell`,
          arguments: JSON.stringify({ command }),
        },
      })
    )
    out.push(
      JSON.stringify({
        type: `item.completed`,
        item: {
          id: callId,
          call_id: callId,
          type: `function_call_output`,
          // asp's function_call_output handler tries to JSON.parse the output
          // and looks for {output, metadata.exit_code}. Conform to that
          // shape so isError flows through.
          output: JSON.stringify({
            output,
            metadata: exitCode !== undefined ? { exit_code: exitCode } : {},
          }),
        },
      })
    )
  }
  return out
}
