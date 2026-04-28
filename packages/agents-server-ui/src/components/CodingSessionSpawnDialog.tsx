import { useCallback, useMemo, useState } from 'react'
import { Button, Dialog, Flex, Text } from '@radix-ui/themes'

type AgentType = `claude` | `codex`
type Mode = `create` | `attach` | `import`

interface CodingSessionSpawnDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSpawn: (args: Record<string, unknown>) => void
}

export function CodingSessionSpawnDialog({
  open,
  onOpenChange,
  onSpawn,
}: CodingSessionSpawnDialogProps): React.ReactElement {
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
      onSpawn(args)
    },
    [
      canSubmit,
      mode,
      targetAgent,
      cwd,
      nativeSessionId,
      sourceAgent,
      sourceSessionId,
      onSpawn,
    ]
  )

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="480px">
        <Dialog.Title>New coder</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="4">
          Start a fresh Claude Code / Codex session, attach to an existing local
          session, or import a session (optionally across agents).
        </Dialog.Description>
        <ModeTabs mode={mode} onChange={setMode} />
        <form onSubmit={handleSubmit}>
          <Flex direction="column" gap="3" mt="3">
            <Field label="Target agent">
              <AgentSelect value={targetAgent} onChange={setTargetAgent} />
            </Field>
            {mode === `attach` && (
              <Field
                label="Native session id"
                required
                description="UUID of an existing local Claude/Codex session (e.g. as listed in ~/.claude/projects/... or ~/.codex/sessions/...)."
              >
                <input
                  type="text"
                  value={nativeSessionId}
                  onChange={(e) => setNativeSessionId(e.target.value)}
                  placeholder="e.g. 3f2a…"
                  autoFocus
                  style={inputStyle}
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
                  <input
                    type="text"
                    value={sourceSessionId}
                    onChange={(e) => setSourceSessionId(e.target.value)}
                    placeholder="e.g. 3f2a…"
                    autoFocus
                    style={inputStyle}
                  />
                </Field>
              </>
            )}
            <Field
              label="Working directory"
              description="Path the CLI runs in. Leave blank to use the server's default cwd (or, for imports, the source session's cwd)."
            >
              <input
                type="text"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder="optional"
                style={inputStyle}
              />
            </Field>
          </Flex>
          <Flex gap="3" mt="4" justify="end">
            <Dialog.Close>
              <Button variant="soft" color="gray" type="button">
                Cancel
              </Button>
            </Dialog.Close>
            <Button type="submit" disabled={!canSubmit}>
              {mode === `create`
                ? `Create`
                : mode === `attach`
                  ? `Attach`
                  : `Import`}
            </Button>
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  )
}

function ModeTabs({
  mode,
  onChange,
}: {
  mode: Mode
  onChange: (m: Mode) => void
}): React.ReactElement {
  return (
    <Flex
      gap="0"
      style={{
        borderBottom: `1px solid var(--gray-a4)`,
      }}
    >
      {(
        [
          [`create`, `Create`],
          [`attach`, `Attach`],
          [`import`, `Import`],
        ] as Array<[Mode, string]>
      ).map(([m, label]) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          style={{
            all: `unset`,
            padding: `8px 16px`,
            cursor: `pointer`,
            fontSize: `var(--font-size-2)`,
            fontWeight: m === mode ? 600 : 400,
            borderBottom:
              m === mode
                ? `2px solid var(--accent-9)`
                : `2px solid transparent`,
            marginBottom: -1,
            color: m === mode ? `var(--gray-12)` : `var(--gray-10)`,
          }}
        >
          {label}
        </button>
      ))}
    </Flex>
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
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as AgentType)}
      style={inputStyle}
    >
      <option value="claude">Claude Code</option>
      <option value="codex">Codex</option>
    </select>
  )
}

function Field({
  label,
  required,
  description,
  children,
}: {
  label: string
  required?: boolean
  description?: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <Flex direction="column" gap="1">
      <Text size="2" weight="medium">
        {label}
        {required && (
          <span style={{ color: `var(--red-9)`, marginLeft: 2 }}>*</span>
        )}
      </Text>
      {children}
      {description && (
        <Text size="1" color="gray">
          {description}
        </Text>
      )}
    </Flex>
  )
}

const inputStyle: React.CSSProperties = {
  width: `100%`,
  padding: `6px 10px`,
  borderRadius: `var(--radius-2)`,
  border: `1px solid var(--gray-a4)`,
  background: `var(--gray-a2)`,
  fontSize: `var(--font-size-2)`,
  fontFamily: `var(--default-font-family)`,
  color: `var(--gray-12)`,
  outline: `none`,
}
