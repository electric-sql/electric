// packages/agents-server-ui/src/components/CodingAgentSpawnDialog.tsx
import { useCallback, useMemo, useState } from 'react'
import { Button, Dialog, Flex, Text } from '@radix-ui/themes'

type WorkspaceMode = `volume` | `bindMount`
type Target = `sandbox` | `host` | `sprites`
type Kind = `claude` | `codex` | `opencode`
type ForkWorkspaceMode = `` | `share` | `clone` | `fresh`

// Curated opencode model list. Default ordering puts the openai entry first
// because the local dev environment is authed against OpenAI; anthropic
// entries remain available for environments that have ANTHROPIC_API_KEY.
const OPENCODE_MODELS = [
  `openai/gpt-5.4-mini-fast`,
  `openai/gpt-5.5`,
  `openai/gpt-5.5-fast`,
  `anthropic/claude-haiku-4-5`,
  `anthropic/claude-sonnet-4-6`,
] as const

export interface ForkSourceOption {
  url: string
  kind: Kind
}

interface CodingAgentSpawnDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSpawn: (
    args: Record<string, unknown>,
    initialMessage?: { text: string }
  ) => void
  availableCodingAgents?: ReadonlyArray<ForkSourceOption>
}

export function CodingAgentSpawnDialog({
  open,
  onOpenChange,
  onSpawn,
  availableCodingAgents = [],
}: CodingAgentSpawnDialogProps): React.ReactElement {
  const [kind, setKind] = useState<Kind>(`claude`)
  const [opencodeModel, setOpencodeModel] = useState<string>(OPENCODE_MODELS[0])
  const [target, setTarget] = useState<Target>(`sandbox`)
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(`volume`)
  const [workspaceName, setWorkspaceName] = useState(``)
  const [hostPath, setHostPath] = useState(``)
  const [importSessionId, setImportSessionId] = useState(``)
  const [initialPrompt, setInitialPrompt] = useState(``)
  const [idleTimeoutSec, setIdleTimeoutSec] = useState(``)
  const [keepWarm, setKeepWarm] = useState(false)
  const [forkEnabled, setForkEnabled] = useState(false)
  const [forkSourceUrl, setForkSourceUrl] = useState(``)
  const [forkWorkspaceMode, setForkWorkspaceMode] =
    useState<ForkWorkspaceMode>(``)

  const canSubmit = useMemo(() => {
    if (workspaceMode === `bindMount` && hostPath.trim().length === 0) {
      return false
    }
    // target ⇄ workspace invariants. The button-click handlers force
    // the right workspace when toggling target, but a future refactor
    // (or strict-mode double-render) could submit a stale combo. Lock
    // the invariant explicitly so the submit button stays disabled.
    if (target === `host` && workspaceMode !== `bindMount`) {
      return false
    }
    if (target === `sprites` && workspaceMode !== `volume`) {
      return false
    }
    if (forkEnabled && !forkSourceUrl) {
      return false
    }
    if (kind === `opencode` && !opencodeModel) {
      return false
    }
    return true
  }, [
    workspaceMode,
    hostPath,
    target,
    forkEnabled,
    forkSourceUrl,
    kind,
    opencodeModel,
  ])

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (!canSubmit) return
      const args: Record<string, unknown> = {
        kind,
        workspaceType: workspaceMode,
        target,
        ...(kind === `opencode` ? { model: opencodeModel } : {}),
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
      if (forkEnabled && forkSourceUrl) {
        args.fromAgentId = forkSourceUrl
        if (forkWorkspaceMode) {
          args.fromWorkspaceMode = forkWorkspaceMode
        }
      }
      onSpawn(
        args,
        initialPrompt.trim() ? { text: initialPrompt.trim() } : undefined
      )
    },
    [
      canSubmit,
      kind,
      opencodeModel,
      target,
      workspaceMode,
      workspaceName,
      hostPath,
      importSessionId,
      initialPrompt,
      idleTimeoutSec,
      keepWarm,
      forkEnabled,
      forkSourceUrl,
      forkWorkspaceMode,
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
          Spawn a Claude Code or Codex CLI session inside a Docker sandbox or
          directly on the host with a persistent workspace.
        </Dialog.Description>

        <form onSubmit={handleSubmit}>
          <Flex direction="column" gap="3">
            <Flex direction="column" gap="1">
              <Text size="2" weight="medium">
                Agent
              </Text>
              <Flex gap="2">
                <Button
                  type="button"
                  variant={kind === `claude` ? `solid` : `soft`}
                  color="gray"
                  size="2"
                  onClick={() => setKind(`claude`)}
                >
                  Claude
                </Button>
                <Button
                  type="button"
                  variant={kind === `codex` ? `solid` : `soft`}
                  color="gray"
                  size="2"
                  onClick={() => setKind(`codex`)}
                >
                  Codex
                </Button>
                <Button
                  type="button"
                  variant={kind === `opencode` ? `solid` : `soft`}
                  color="gray"
                  size="2"
                  onClick={() => setKind(`opencode`)}
                  data-testid="kind-opencode"
                >
                  opencode
                </Button>
              </Flex>
            </Flex>

            {kind === `opencode` && (
              <Flex direction="column" gap="1">
                <Text size="2" weight="medium">
                  Model{` `}
                  <Text size="1" color="red">
                    *
                  </Text>
                </Text>
                <select
                  style={inputStyle}
                  value={opencodeModel}
                  onChange={(e) => setOpencodeModel(e.target.value)}
                  required
                  data-testid="opencode-model-select"
                >
                  {OPENCODE_MODELS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </Flex>
            )}

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
                <Button
                  type="button"
                  variant={target === `sprites` ? `solid` : `soft`}
                  color="gray"
                  size="2"
                  data-testid="target-sprites"
                  onClick={() => {
                    setTarget(`sprites`)
                    setImportSessionId(``)
                    if (workspaceMode === `bindMount`) {
                      setWorkspaceMode(`volume`)
                    }
                  }}
                >
                  Sprites
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
                  disabled={target === `sprites`}
                  title={
                    target === `sprites`
                      ? `Sprites do not support bind-mount workspaces`
                      : undefined
                  }
                  data-testid="workspace-bindmount"
                  onClick={() => setWorkspaceMode(`bindMount`)}
                >
                  Bind mount{target === `sprites` ? ` (n/a)` : ``}
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
                    (optional — resume an existing local{` `}
                    {kind === `codex` ? `Codex` : `Claude`} session)
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

            <Flex direction="column" gap="2">
              <Flex align="center" gap="2">
                <input
                  id="coding-agent-fork-toggle"
                  type="checkbox"
                  checked={forkEnabled}
                  onChange={(e) => {
                    setForkEnabled(e.target.checked)
                    if (!e.target.checked) {
                      setForkSourceUrl(``)
                      setForkWorkspaceMode(``)
                    }
                  }}
                  data-testid="fork-toggle"
                />
                <label
                  htmlFor="coding-agent-fork-toggle"
                  style={{
                    fontSize: `var(--font-size-2)`,
                    fontWeight: 500,
                    cursor: `pointer`,
                  }}
                >
                  Fork from existing agent{` `}
                  <Text size="1" color="gray">
                    (inherit transcript from another coding-agent)
                  </Text>
                </label>
              </Flex>

              {forkEnabled && (
                <>
                  <Flex direction="column" gap="1">
                    <Text size="2" weight="medium">
                      Source agent{` `}
                      <Text size="1" color="red">
                        *
                      </Text>
                    </Text>
                    <select
                      style={inputStyle}
                      value={forkSourceUrl}
                      onChange={(e) => setForkSourceUrl(e.target.value)}
                      required
                      data-testid="fork-source-select"
                    >
                      <option value="">— pick a coding agent —</option>
                      {availableCodingAgents.map((a) => (
                        <option key={a.url} value={a.url}>
                          {a.url} ({a.kind})
                        </option>
                      ))}
                    </select>
                    {availableCodingAgents.length === 0 && (
                      <Text size="1" color="gray">
                        No coding agents available to fork from.
                      </Text>
                    )}
                    {forkEnabled && !forkSourceUrl && (
                      <Text size="1" color="red" role="alert">
                        Pick a source agent to fork from.
                      </Text>
                    )}
                  </Flex>

                  <Flex direction="column" gap="1">
                    <Text size="2" weight="medium">
                      Workspace mode{` `}
                      <Text size="1" color="gray">
                        (optional — provider default when blank)
                      </Text>
                    </Text>
                    <select
                      style={inputStyle}
                      value={forkWorkspaceMode}
                      onChange={(e) =>
                        setForkWorkspaceMode(
                          e.target.value as ForkWorkspaceMode
                        )
                      }
                      data-testid="fork-workspace-mode-select"
                    >
                      <option value="">(default)</option>
                      <option value="share">share</option>
                      <option value="clone">clone</option>
                      <option value="fresh">fresh</option>
                    </select>
                  </Flex>
                </>
              )}
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
