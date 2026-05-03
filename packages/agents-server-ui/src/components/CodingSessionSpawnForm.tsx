import { useCallback, useMemo, useState } from 'react'
import { Button, Field, Input, Select, Stack } from '../ui'
import styles from './CodingSessionSpawnForm.module.css'

type AgentType = `claude` | `codex`
type Mode = `create` | `attach` | `import`

/**
 * Inline form for spawning a coding session (Claude Code / Codex).
 * Lives in the new-session page — replaces the previous modal dialog.
 */
export function CodingSessionSpawnForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (args: Record<string, unknown>) => void
  onCancel?: () => void
}): React.ReactElement {
  const [mode, setMode] = useState<Mode>(`create`)
  const [targetAgent, setTargetAgent] = useState<AgentType>(`claude`)
  const [cwd, setCwd] = useState(``)
  const [nativeSessionId, setNativeSessionId] = useState(``)
  const [sourceAgent, setSourceAgent] = useState<AgentType>(`claude`)
  const [sourceSessionId, setSourceSessionId] = useState(``)

  const canSubmit = useMemo(() => {
    if (mode === `attach`) return nativeSessionId.trim().length > 0
    if (mode === `import`) return sourceSessionId.trim().length > 0
    return true
  }, [mode, nativeSessionId, sourceSessionId])

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (!canSubmit) return
      const args: Record<string, unknown> = { agent: targetAgent }
      if (cwd.trim()) args.cwd = cwd.trim()
      if (mode === `attach`) {
        args.nativeSessionId = nativeSessionId.trim()
      }
      if (mode === `import`) {
        args.importFrom = {
          agent: sourceAgent,
          sessionId: sourceSessionId.trim(),
        }
      }
      onSubmit(args)
    },
    [
      canSubmit,
      mode,
      targetAgent,
      cwd,
      nativeSessionId,
      sourceAgent,
      sourceSessionId,
      onSubmit,
    ]
  )

  return (
    <>
      <ModeTabs mode={mode} onChange={setMode} />
      <form onSubmit={handleSubmit}>
        <Stack direction="column" gap={3} className={styles.fieldsetSpacing}>
          <Field label="Target agent">
            <AgentSelect value={targetAgent} onChange={setTargetAgent} />
          </Field>
          {mode === `attach` && (
            <Field
              label="Native session id"
              required
              description="UUID of an existing local Claude/Codex session (e.g. as listed in ~/.claude/projects/... or ~/.codex/sessions/...)."
            >
              <Input
                type="text"
                value={nativeSessionId}
                onChange={(e) => setNativeSessionId(e.target.value)}
                placeholder="e.g. 3f2a…"
                autoFocus
              />
            </Field>
          )}
          {mode === `import` && (
            <>
              <Field
                label="Source agent"
                description="Agent that produced the session you're importing from."
              >
                <AgentSelect value={sourceAgent} onChange={setSourceAgent} />
              </Field>
              <Field
                label="Source session id"
                required
                description="UUID of the source session. Same-agent imports are lossless; cross-agent imports round-trip through the normalized event stream."
              >
                <Input
                  type="text"
                  value={sourceSessionId}
                  onChange={(e) => setSourceSessionId(e.target.value)}
                  placeholder="e.g. 3f2a…"
                  autoFocus
                />
              </Field>
            </>
          )}
          <Field
            label="Working directory"
            description="Path the CLI runs in. Leave blank to use the server's default cwd (or, for imports, the source session's cwd)."
          >
            <Input
              type="text"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="optional"
            />
          </Field>
        </Stack>
        <Stack gap={3} justify="end" className={styles.actions}>
          {onCancel && (
            <Button
              variant="soft"
              tone="neutral"
              type="button"
              onClick={onCancel}
            >
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={!canSubmit}>
            {mode === `create`
              ? `Create`
              : mode === `attach`
                ? `Attach`
                : `Import`}
          </Button>
        </Stack>
      </form>
    </>
  )
}

function ModeTabs({
  mode,
  onChange,
}: {
  mode: Mode
  onChange: (m: Mode) => void
}): React.ReactElement {
  const tabs: Array<[Mode, string]> = [
    [`create`, `Create`],
    [`attach`, `Attach`],
    [`import`, `Import`],
  ]
  return (
    <Stack className={styles.tabs}>
      {tabs.map(([m, label]) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={`${styles.tab} ${m === mode ? styles.tabActive : ``}`}
        >
          {label}
        </button>
      ))}
    </Stack>
  )
}

function AgentSelect({
  value,
  onChange,
}: {
  value: AgentType
  onChange: (v: AgentType) => void
}): React.ReactElement {
  return (
    <Select.Root<AgentType>
      value={value}
      onValueChange={(v) => {
        if (v !== null) onChange(v)
      }}
    >
      <Select.Trigger className={styles.agentSelectTrigger} />
      <Select.Content>
        <Select.Item value="claude">Claude Code</Select.Item>
        <Select.Item value="codex">Codex</Select.Item>
      </Select.Content>
    </Select.Root>
  )
}
