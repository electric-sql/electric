// packages/agents-server-ui/src/components/CodingAgentSpawnDialog.tsx
import { useCallback, useMemo, useState } from 'react'
import { Button, Dialog, Flex, Text } from '@radix-ui/themes'

type WorkspaceMode = `volume` | `bindMount`
type Target = `sandbox` | `host`

interface CodingAgentSpawnDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSpawn: (
    args: Record<string, unknown>,
    initialMessage?: { text: string }
  ) => void
}

export function CodingAgentSpawnDialog({
  open,
  onOpenChange,
  onSpawn,
}: CodingAgentSpawnDialogProps): React.ReactElement {
  const [target, setTarget] = useState<Target>(`sandbox`)
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(`volume`)
  const [workspaceName, setWorkspaceName] = useState(``)
  const [hostPath, setHostPath] = useState(``)
  const [importSessionId, setImportSessionId] = useState(``)
  const [initialPrompt, setInitialPrompt] = useState(``)
  const [idleTimeoutSec, setIdleTimeoutSec] = useState(``)
  const [keepWarm, setKeepWarm] = useState(false)

  const canSubmit = useMemo(() => {
    if (workspaceMode === `bindMount`) return hostPath.trim().length > 0
    return true
  }, [workspaceMode, hostPath])

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (!canSubmit) return
      const args: Record<string, unknown> = {
        kind: `claude`,
        workspaceType: workspaceMode,
        target,
      }
      if (workspaceMode === `volume` && workspaceName.trim()) {
        args.workspaceName = workspaceName.trim()
      }
      if (workspaceMode === `bindMount`) {
        args.workspaceHostPath = hostPath.trim()
      }
      if (target === `host` && importSessionId.trim()) {
        args.importNativeSessionId = importSessionId.trim()
      }
      const parsedTimeoutSec = Number.parseInt(idleTimeoutSec.trim(), 10)
      if (Number.isFinite(parsedTimeoutSec) && parsedTimeoutSec > 0) {
        args.idleTimeoutMs = parsedTimeoutSec * 1000
      }
      if (keepWarm) {
        args.keepWarm = true
      }
      onSpawn(
        args,
        initialPrompt.trim() ? { text: initialPrompt.trim() } : undefined
      )
    },
    [
      canSubmit,
      target,
      workspaceMode,
      workspaceName,
      hostPath,
      importSessionId,
      initialPrompt,
      idleTimeoutSec,
      keepWarm,
      onSpawn,
    ]
  )

  const inputStyle: React.CSSProperties = {
    width: `100%`,
    padding: `6px 8px`,
    borderRadius: `var(--radius-2)`,
    border: `1px solid var(--gray-a7)`,
    background: `var(--gray-a2)`,
    fontSize: `var(--font-size-2)`,
    fontFamily: `var(--default-font-family)`,
    color: `var(--gray-12)`,
    boxSizing: `border-box`,
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="480px">
        <Dialog.Title>New coding agent</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="4">
          Spawn a Claude Code CLI session inside a Docker sandbox with a
          persistent workspace.
        </Dialog.Description>

        <form onSubmit={handleSubmit}>
          <Flex direction="column" gap="3">
            <Flex direction="column" gap="1">
              <Text size="2" weight="medium">
                Target
              </Text>
              <Flex gap="2">
                <Button
                  type="button"
                  variant={target === `sandbox` ? `solid` : `soft`}
                  color="gray"
                  size="2"
                  onClick={() => {
                    setTarget(`sandbox`)
                    setImportSessionId(``)
                  }}
                >
                  Sandbox
                </Button>
                <Button
                  type="button"
                  variant={target === `host` ? `solid` : `soft`}
                  color="gray"
                  size="2"
                  onClick={() => {
                    setTarget(`host`)
                    if (workspaceMode === `volume`) {
                      setWorkspaceMode(`bindMount`)
                    }
                  }}
                >
                  Host
                </Button>
              </Flex>
            </Flex>

            <Flex direction="column" gap="1">
              <Text size="2" weight="medium">
                Workspace type
              </Text>
              <Flex gap="2">
                <Button
                  type="button"
                  variant={workspaceMode === `volume` ? `solid` : `soft`}
                  color="gray"
                  size="2"
                  disabled={target === `host`}
                  onClick={() => setWorkspaceMode(`volume`)}
                >
                  Volume
                </Button>
                <Button
                  type="button"
                  variant={workspaceMode === `bindMount` ? `solid` : `soft`}
                  color="gray"
                  size="2"
                  onClick={() => setWorkspaceMode(`bindMount`)}
                >
                  Bind mount
                </Button>
              </Flex>
            </Flex>

            {workspaceMode === `volume` && (
              <Flex direction="column" gap="1">
                <Text size="2" weight="medium">
                  Volume name{` `}
                  <Text size="1" color="gray">
                    (optional — leave blank to auto-generate)
                  </Text>
                </Text>
                <input
                  style={inputStyle}
                  type="text"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  placeholder="my-project"
                />
              </Flex>
            )}

            {workspaceMode === `bindMount` && (
              <Flex direction="column" gap="1">
                <Text size="2" weight="medium">
                  Host path{` `}
                  <Text size="1" color="red">
                    *
                  </Text>
                </Text>
                <input
                  style={inputStyle}
                  type="text"
                  required
                  value={hostPath}
                  onChange={(e) => setHostPath(e.target.value)}
                  placeholder="/Users/me/my-project"
                />
              </Flex>
            )}

            {target === `host` && (
              <Flex direction="column" gap="1">
                <Text size="2" weight="medium">
                  Import session ID{` `}
                  <Text size="1" color="gray">
                    (optional — resume an existing local Claude session)
                  </Text>
                </Text>
                <input
                  style={inputStyle}
                  type="text"
                  value={importSessionId}
                  onChange={(e) => setImportSessionId(e.target.value)}
                  placeholder=""
                />
              </Flex>
            )}

            <Flex direction="column" gap="1">
              <Text size="2" weight="medium">
                Initial prompt{` `}
                <Text size="1" color="gray">
                  (optional)
                </Text>
              </Text>
              <textarea
                style={{
                  ...inputStyle,
                  minHeight: 80,
                  resize: `vertical`,
                }}
                value={initialPrompt}
                onChange={(e) => setInitialPrompt(e.target.value)}
                placeholder="What should the agent work on first?"
              />
            </Flex>

            <Flex direction="column" gap="1">
              <Text size="2" weight="medium">
                Idle timeout (seconds){` `}
                <Text size="1" color="gray">
                  (optional — default 300)
                </Text>
              </Text>
              <input
                style={inputStyle}
                type="number"
                inputMode="numeric"
                min={1}
                value={idleTimeoutSec}
                onChange={(e) => setIdleTimeoutSec(e.target.value)}
                placeholder="300"
              />
            </Flex>

            <Flex align="center" gap="2">
              <input
                id="coding-agent-keepwarm"
                type="checkbox"
                checked={keepWarm}
                onChange={(e) => setKeepWarm(e.target.checked)}
              />
              <label
                htmlFor="coding-agent-keepwarm"
                style={{
                  fontSize: `var(--font-size-2)`,
                  fontWeight: 500,
                  cursor: `pointer`,
                }}
              >
                Keep warm{` `}
                <Text size="1" color="gray">
                  (disable idle timer)
                </Text>
              </label>
            </Flex>

            <Flex justify="end" gap="2" mt="2">
              <Dialog.Close>
                <Button type="button" variant="soft" color="gray">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button type="submit" disabled={!canSubmit}>
                Spawn
              </Button>
            </Flex>
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  )
}
