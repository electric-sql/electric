import { useState } from 'react'
import {
  Badge,
  Button,
  Dialog,
  DropdownMenu,
  Flex,
  Text,
} from '@radix-ui/themes'
import {
  Copy,
  Database,
  Eye,
  GitFork,
  MoreHorizontal,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-react'
import { getEntityInstanceName } from '../lib/types'
import type { ElectricEntity } from '../lib/ElectricAgentsProvider'

const STATUS_COLOR: Record<
  string,
  `blue` | `green` | `amber` | `gray` | `red`
> = {
  active: `blue`,
  running: `blue`,
  idle: `green`,
  spawning: `amber`,
  stopped: `gray`,
  cold: `gray`,
  starting: `amber`,
  stopping: `amber`,
  error: `red`,
  destroyed: `gray`,
}

export type CodingAgentWorkspaceSpec =
  | { type: `volume`; name?: string }
  | { type: `bindMount`; hostPath: string }

export function EntityHeader({
  entity,
  pinned,
  onTogglePin,
  onFork,
  onForkToKind,
  onKill,
  killError,
  forkError,
  forking,
  stateExplorerOpen,
  onToggleStateExplorer,
  baseUrl,
  codingAgentTarget,
  codingAgentWorkspaceSpec,
  codingAgentStatus,
  codingAgentLastError,
  codingAgentKind,
}: {
  entity: ElectricEntity
  pinned: boolean
  onTogglePin: () => void
  onFork?: () => void
  onForkToKind?: (kind: `claude` | `codex` | `opencode`) => void
  onKill: () => void
  killError?: string | null
  forkError?: string | null
  forking?: boolean
  stateExplorerOpen?: boolean
  onToggleStateExplorer?: () => void
  baseUrl?: string
  codingAgentTarget?: `sandbox` | `host` | `sprites`
  codingAgentWorkspaceSpec?: CodingAgentWorkspaceSpec
  codingAgentStatus?: string
  codingAgentLastError?: string
  codingAgentKind?: `claude` | `codex` | `opencode`
}): React.ReactElement {
  // For coding-agents, prefer the coding-agent-specific status (cold /
  // starting / idle / running / stopping / error / destroyed) over the
  // entity-server's coarse status (idle / busy / ...). The coding-agent
  // status carries error states the entity-server status hides.
  const displayStatus = codingAgentStatus ?? entity.status
  const [showInspect, setShowInspect] = useState(false)
  const [showKillConfirm, setShowKillConfirm] = useState(false)
  const instanceName = getEntityInstanceName(entity.url)

  return (
    <Flex
      data-testid="entity-header"
      p="3"
      align="center"
      gap="3"
      style={{ borderBottom: `1px solid var(--gray-a5)` }}
    >
      <Flex direction="column" gap="2">
        <Text
          size="4"
          weight="bold"
          style={{ fontFamily: `var(--heading-font)` }}
        >
          {instanceName}
        </Text>
        <Text size="1" color="gray" style={{ opacity: 0.6 }}>
          {decodeURIComponent(entity.url)}
        </Text>
        {killError && (
          <Text size="1" color="red">
            {killError}
          </Text>
        )}
        {forkError && (
          <Text size="1" color="red">
            {forkError}
          </Text>
        )}
        {codingAgentStatus === `error` && codingAgentLastError && (
          <Text size="1" color="red">
            {codingAgentLastError}
          </Text>
        )}
      </Flex>

      <Flex ml="auto" align="center" gap="2">
        <Badge
          color={STATUS_COLOR[displayStatus] ?? `gray`}
          variant="soft"
          title={
            codingAgentLastError ? `Error: ${codingAgentLastError}` : undefined
          }
        >
          {displayStatus}
        </Badge>

        {onForkToKind && entity.type === `coding-agent` ? (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <Button
                variant="soft"
                size="1"
                disabled={forking || entity.status === `stopped`}
                title={
                  entity.status === `idle`
                    ? `Fork to a new agent`
                    : `Fork once idle`
                }
                data-testid="fork-button"
              >
                <GitFork size={14} />
                <Text size="1">{forking ? `Forking` : `Fork`}</Text>
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              {([`claude`, `codex`, `opencode`] as const).map((k) => {
                const involvesOpencode =
                  k === `opencode` || codingAgentKind === `opencode`
                return (
                  <DropdownMenu.Item
                    key={k}
                    data-testid={`fork-to-${k}`}
                    disabled={involvesOpencode}
                    onSelect={() => {
                      if (involvesOpencode) return
                      onForkToKind(k)
                    }}
                    title={
                      involvesOpencode
                        ? `Cross-kind support for opencode is deferred — see follow-up slice.`
                        : undefined
                    }
                  >
                    <Flex align="center" gap="2">
                      <GitFork size={14} />
                      <Text size="2">
                        Fork to {k}
                        {involvesOpencode ? ` (deferred)` : ``}
                      </Text>
                    </Flex>
                  </DropdownMenu.Item>
                )
              })}
              {codingAgentTarget !== `sprites` && (
                <DropdownMenu.Item
                  disabled
                  data-testid="fork-cross-provider-disabled"
                  title="Cross-provider fork not supported. Spawn a fresh agent on Sprites instead."
                >
                  <Flex align="center" gap="2">
                    <GitFork size={14} />
                    <Text size="2">
                      Fork to Sprites (cross-provider not supported)
                    </Text>
                  </Flex>
                </DropdownMenu.Item>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        ) : (
          onFork && (
            <Button
              variant="soft"
              size="1"
              onClick={onFork}
              disabled={forking || entity.status === `stopped`}
              title={
                entity.status === `idle`
                  ? `Fork subtree`
                  : `Fork subtree once idle`
              }
            >
              <GitFork size={14} />
              <Text size="1">{forking ? `Forking` : `Fork`}</Text>
            </Button>
          )
        )}

        {onToggleStateExplorer && (
          <Button
            variant="ghost"
            size="1"
            onClick={onToggleStateExplorer}
            title="Toggle state explorer"
            style={
              stateExplorerOpen ? { background: `var(--accent-a4)` } : undefined
            }
          >
            <Database size={14} />
          </Button>
        )}

        <Button variant="ghost" size="1" onClick={onTogglePin}>
          {pinned ? <PinOff size={14} /> : <Pin size={14} />}
        </Button>

        {entity.type === `coding-agent` && baseUrl && (
          <>
            <Button
              variant="soft"
              size="1"
              onClick={() => {
                void fetch(`${baseUrl}${entity.url}/send`, {
                  method: `POST`,
                  headers: { 'content-type': `application/json` },
                  body: JSON.stringify({
                    from: `user`,
                    type: `pin`,
                    payload: {},
                  }),
                })
              }}
              title="Pin — keep sandbox alive past idle timeout"
            >
              Pin
            </Button>
            <Button
              variant="soft"
              size="1"
              onClick={() => {
                void fetch(`${baseUrl}${entity.url}/send`, {
                  method: `POST`,
                  headers: { 'content-type': `application/json` },
                  body: JSON.stringify({
                    from: `user`,
                    type: `release`,
                    payload: {},
                  }),
                })
              }}
              title="Release — allow idle hibernation"
            >
              Release
            </Button>
            <Button
              variant="soft"
              size="1"
              color="orange"
              onClick={() => {
                void fetch(`${baseUrl}${entity.url}/send`, {
                  method: `POST`,
                  headers: { 'content-type': `application/json` },
                  body: JSON.stringify({
                    from: `user`,
                    type: `stop`,
                    payload: {},
                  }),
                })
              }}
              title="Stop — hibernate the sandbox now"
            >
              Stop
            </Button>
            {codingAgentTarget &&
              (() => {
                const allTargets: ReadonlyArray<
                  `sandbox` | `host` | `sprites`
                > = [`sandbox`, `host`, `sprites`]
                const others = allTargets.filter((t) => t !== codingAgentTarget)
                const inFlight =
                  codingAgentStatus === `running` ||
                  codingAgentStatus === `starting` ||
                  codingAgentStatus === `stopping`
                return (
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger>
                      <Button
                        variant="soft"
                        size="1"
                        color="amber"
                        disabled={inFlight}
                        title={
                          inFlight
                            ? `Cannot convert while ${codingAgentStatus}`
                            : `Convert this agent to a different target`
                        }
                        data-testid="convert-target-button"
                      >
                        Convert target
                      </Button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content>
                      {others.map((t) => {
                        const sourceIsSprites = codingAgentTarget === `sprites`
                        const targetIsSprites = t === `sprites`
                        const crossProvider =
                          sourceIsSprites !== targetIsSprites
                        const requiresBindMount =
                          t === `host` &&
                          codingAgentWorkspaceSpec?.type === `volume`
                        const disabled = crossProvider || requiresBindMount
                        const label =
                          t === `sandbox`
                            ? `Sandbox`
                            : t === `host`
                              ? `Host`
                              : `Sprites`
                        const title = crossProvider
                          ? `Cross-provider conversion is not supported. Spawn a fresh agent on ${label} instead.`
                          : requiresBindMount
                            ? `Convert to host requires a bindMount workspace`
                            : `Convert this agent to ${label}`
                        return (
                          <DropdownMenu.Item
                            key={t}
                            data-testid={`convert-to-${t}`}
                            disabled={disabled}
                            onSelect={() => {
                              if (disabled) return
                              void fetch(`${baseUrl}${entity.url}/send`, {
                                method: `POST`,
                                headers: {
                                  'content-type': `application/json`,
                                },
                                body: JSON.stringify({
                                  from: `user`,
                                  type: `convert-target`,
                                  payload: { to: t },
                                }),
                              })
                            }}
                            title={title}
                          >
                            Convert → {label}
                            {crossProvider
                              ? ` (cross-provider not supported)`
                              : requiresBindMount
                                ? ` (needs bindMount)`
                                : ``}
                          </DropdownMenu.Item>
                        )
                      })}
                    </DropdownMenu.Content>
                  </DropdownMenu.Root>
                )
              })()}
            {codingAgentKind &&
              (() => {
                const allKinds: ReadonlyArray<`claude` | `codex` | `opencode`> =
                  [`claude`, `codex`, `opencode`]
                const others = allKinds.filter((k) => k !== codingAgentKind)
                const inFlight =
                  codingAgentStatus === `running` ||
                  codingAgentStatus === `starting` ||
                  codingAgentStatus === `stopping`
                return (
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger>
                      <Button
                        variant="soft"
                        size="1"
                        color="amber"
                        disabled={inFlight}
                        title={
                          inFlight
                            ? `Cannot convert while ${codingAgentStatus}`
                            : `Convert this agent to a different kind`
                        }
                        data-testid="convert-kind-button"
                      >
                        Convert kind
                      </Button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content>
                      {others.map((k) => {
                        const involvesOpencode =
                          k === `opencode` || codingAgentKind === `opencode`
                        return (
                          <DropdownMenu.Item
                            key={k}
                            data-testid={`convert-to-${k}`}
                            disabled={involvesOpencode}
                            onSelect={() => {
                              if (involvesOpencode) return
                              void fetch(`${baseUrl}${entity.url}/send`, {
                                method: `POST`,
                                headers: {
                                  'content-type': `application/json`,
                                },
                                body: JSON.stringify({
                                  from: `user`,
                                  type: `convert-kind`,
                                  payload: { kind: k },
                                }),
                              })
                            }}
                            title={
                              involvesOpencode
                                ? `Cross-kind support for opencode is deferred — see follow-up slice.`
                                : `Convert this agent to ${k}`
                            }
                          >
                            Convert to {k}
                            {involvesOpencode ? ` (deferred)` : ``}
                          </DropdownMenu.Item>
                        )
                      })}
                    </DropdownMenu.Content>
                  </DropdownMenu.Root>
                )
              })()}
          </>
        )}

        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            <Button variant="ghost" size="1">
              <MoreHorizontal size={16} />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content>
            <DropdownMenu.Item onSelect={() => setShowInspect(true)}>
              <Flex align="center" gap="2">
                <Eye size={14} />
                <Text size="2">Inspect</Text>
              </Flex>
            </DropdownMenu.Item>
            {onToggleStateExplorer && (
              <DropdownMenu.Item onSelect={onToggleStateExplorer}>
                <Flex align="center" gap="2">
                  <Database size={14} />
                  <Text size="2">
                    {stateExplorerOpen
                      ? `Hide State Explorer`
                      : `State Explorer`}
                  </Text>
                </Flex>
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Item
              onSelect={() => navigator.clipboard.writeText(entity.url)}
            >
              <Flex align="center" gap="2">
                <Copy size={14} />
                <Text size="2">Copy URL</Text>
              </Flex>
            </DropdownMenu.Item>
            {entity.status !== `stopped` && (
              <>
                <DropdownMenu.Separator />
                <DropdownMenu.Item
                  color="red"
                  onSelect={() => setShowKillConfirm(true)}
                >
                  <Flex align="center" gap="2">
                    <Trash2 size={14} />
                    <Text size="2">Kill</Text>
                  </Flex>
                </DropdownMenu.Item>
              </>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </Flex>

      <Dialog.Root open={showInspect} onOpenChange={setShowInspect}>
        <Dialog.Content maxWidth="600px">
          <Dialog.Title>Entity Details</Dialog.Title>
          <pre
            style={{
              background: `var(--gray-a3)`,
              padding: 16,
              borderRadius: 8,
              overflow: `auto`,
              fontSize: 12,
              maxHeight: 400,
            }}
          >
            {JSON.stringify(entity, null, 2)}
          </pre>
          <Flex justify="end" mt="3">
            <Dialog.Close>
              <Button variant="soft" color="gray">
                Close
              </Button>
            </Dialog.Close>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root open={showKillConfirm} onOpenChange={setShowKillConfirm}>
        <Dialog.Content maxWidth="400px">
          <Dialog.Title>Kill Entity</Dialog.Title>
          <Text size="2" color="gray">
            Are you sure you want to kill {instanceName}? The entity will stop
            processing and its stream will become read-only.
          </Text>
          <Flex justify="end" gap="2" mt="4">
            <Dialog.Close>
              <Button variant="soft" color="gray">
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              color="red"
              onClick={() => {
                onKill()
                setShowKillConfirm(false)
              }}
            >
              Kill
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </Flex>
  )
}
