import { useState } from 'react'
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
import { Badge, Button, Dialog, Menu, Stack, Text } from '../ui'
import type { BadgeTone } from '../ui'
import styles from './EntityHeader.module.css'
import type { ElectricEntity } from '../lib/ElectricAgentsProvider'

const STATUS_TONE: Record<string, BadgeTone> = {
  active: `info`,
  running: `info`,
  idle: `success`,
  spawning: `warning`,
  stopped: `neutral`,
}

export function EntityHeader({
  entity,
  pinned,
  onTogglePin,
  onFork,
  onKill,
  killError,
  forkError,
  forking,
  stateExplorerOpen,
  onToggleStateExplorer,
}: {
  entity: ElectricEntity
  pinned: boolean
  onTogglePin: () => void
  onFork?: () => void
  onKill: () => void
  killError?: string | null
  forkError?: string | null
  forking?: boolean
  stateExplorerOpen?: boolean
  onToggleStateExplorer?: () => void
}): React.ReactElement {
  const [showInspect, setShowInspect] = useState(false)
  const [showKillConfirm, setShowKillConfirm] = useState(false)
  const instanceName = getEntityInstanceName(entity.url)

  return (
    <Stack p={3} align="center" gap={3} className={styles.header}>
      <Stack direction="column" gap={2}>
        <Text size={4} weight="bold" className={styles.title}>
          {instanceName}
        </Text>
        <Text size={1} tone="muted" className={styles.urlText}>
          {decodeURIComponent(entity.url)}
        </Text>
        {killError && (
          <Text size={1} tone="danger">
            {killError}
          </Text>
        )}
        {forkError && (
          <Text size={1} tone="danger">
            {forkError}
          </Text>
        )}
      </Stack>

      <Stack align="center" gap={2} className={styles.toolbar}>
        <Badge tone={STATUS_TONE[entity.status] ?? `neutral`} variant="soft">
          {entity.status}
        </Badge>

        {onFork && (
          <Button
            variant="soft"
            tone="neutral"
            size={1}
            onClick={onFork}
            disabled={forking || entity.status === `stopped`}
            title={
              entity.status === `idle`
                ? `Fork subtree`
                : `Fork subtree once idle`
            }
          >
            <GitFork size={14} />
            <Text size={1}>{forking ? `Forking` : `Fork`}</Text>
          </Button>
        )}

        {onToggleStateExplorer && (
          <Button
            variant="ghost"
            tone="neutral"
            size={1}
            onClick={onToggleStateExplorer}
            title="Toggle state explorer"
            className={stateExplorerOpen ? styles.activeBg : undefined}
          >
            <Database size={14} />
          </Button>
        )}

        <Button variant="ghost" tone="neutral" size={1} onClick={onTogglePin}>
          {pinned ? <PinOff size={14} /> : <Pin size={14} />}
        </Button>

        <Menu.Root>
          <Menu.Trigger
            render={
              <Button variant="ghost" tone="neutral" size={1}>
                <MoreHorizontal size={16} />
              </Button>
            }
          />
          <Menu.Content side="bottom" align="end">
            <Menu.Item onSelect={() => setShowInspect(true)}>
              <Eye size={14} />
              <Text size={2}>Inspect</Text>
            </Menu.Item>
            {onToggleStateExplorer && (
              <Menu.Item onSelect={onToggleStateExplorer}>
                <Database size={14} />
                <Text size={2}>
                  {stateExplorerOpen ? `Hide State Explorer` : `State Explorer`}
                </Text>
              </Menu.Item>
            )}
            <Menu.Item
              onSelect={() => navigator.clipboard.writeText(entity.url)}
            >
              <Copy size={14} />
              <Text size={2}>Copy URL</Text>
            </Menu.Item>
            {entity.status !== `stopped` && (
              <>
                <Menu.Separator />
                <Menu.Item
                  tone="danger"
                  onSelect={() => setShowKillConfirm(true)}
                >
                  <Trash2 size={14} />
                  <Text size={2}>Kill</Text>
                </Menu.Item>
              </>
            )}
          </Menu.Content>
        </Menu.Root>
      </Stack>

      <Dialog.Root open={showInspect} onOpenChange={setShowInspect}>
        <Dialog.Content maxWidth={600}>
          <Dialog.Title>Entity Details</Dialog.Title>
          <pre className={styles.inspectPre}>
            {JSON.stringify(entity, null, 2)}
          </pre>
          <Stack justify="end" style={{ marginTop: 12 }}>
            <Dialog.Close
              render={
                <Button variant="soft" tone="neutral">
                  Close
                </Button>
              }
            />
          </Stack>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root open={showKillConfirm} onOpenChange={setShowKillConfirm}>
        <Dialog.Content maxWidth={400}>
          <Dialog.Title>Kill Entity</Dialog.Title>
          <Text size={2} tone="muted">
            Are you sure you want to kill {instanceName}? The entity will stop
            processing and its stream will become read-only.
          </Text>
          <Stack justify="end" gap={2} style={{ marginTop: 16 }}>
            <Dialog.Close
              render={
                <Button variant="soft" tone="neutral">
                  Cancel
                </Button>
              }
            />
            <Button
              tone="danger"
              onClick={() => {
                onKill()
                setShowKillConfirm(false)
              }}
            >
              Kill
            </Button>
          </Stack>
        </Dialog.Content>
      </Dialog.Root>
    </Stack>
  )
}
