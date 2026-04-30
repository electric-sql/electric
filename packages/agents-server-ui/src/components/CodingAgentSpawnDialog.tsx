// packages/agents-server-ui/src/components/CodingAgentSpawnDialog.tsx
import { useCallback, useMemo, useState } from 'react'
import { Button, Dialog, Flex, Text } from '@radix-ui/themes'

type WorkspaceMode = `volume` | `bindMount`

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
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(`volume`)
  const [workspaceName, setWorkspaceName] = useState(``)
  const [hostPath, setHostPath] = useState(``)
  const [initialPrompt, setInitialPrompt] = useState(``)

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
      }
      if (workspaceMode === `volume` && workspaceName.trim()) {
        args.workspaceName = workspaceName.trim()
      }
      if (workspaceMode === `bindMount`) {
        args.workspaceHostPath = hostPath.trim()
      }
      onSpawn(
        args,
        initialPrompt.trim() ? { text: initialPrompt.trim() } : undefined
      )
    },
    [canSubmit, workspaceMode, workspaceName, hostPath, initialPrompt, onSpawn]
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
                Workspace type
              </Text>
              <Flex gap="2">
                <Button
                  type="button"
                  variant={workspaceMode === `volume` ? `solid` : `soft`}
                  color="gray"
                  size="2"
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
