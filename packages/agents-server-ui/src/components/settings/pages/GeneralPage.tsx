import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Brain,
  KeyRound,
  Palette,
  Plug,
  Server,
  Trash2,
  UserCircle,
} from 'lucide-react'
import { Button, ConfirmDialog, Icon, Text } from '../../../ui'
import { clearAllLocalData } from '../../../lib/server-connection'
import {
  SettingsPanel,
  SettingsRow,
  SettingsScreen,
  SettingsSection,
} from '../SettingsScreen'
import type { SettingsCategoryId } from '../SettingsSidebar'

/**
 * Settings → General. Currently surfaces the provider API keys for
 * the bundled local Horton runtime; future general preferences land
 * here too.
 *
 * On the desktop build the form persists keys via `desktop:save-api-keys`,
 * which writes `settings.json`, mirrors the values into `process.env`,
 * and restarts the runtime so Horton picks up the new keys on its
 * next start. On the web build the IPC bridge is absent and we render
 * an explanatory message instead.
 */
export function GeneralPage(): React.ReactElement {
  const navigate = useNavigate()
  const isDesktop = typeof window !== `undefined` && Boolean(window.electronAPI)
  const [isClearing, setIsClearing] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleClearAllLocalData = async (): Promise<void> => {
    setError(null)
    setIsClearing(true)
    try {
      await clearAllLocalData()
    } catch (err) {
      setIsClearing(false)
      setShowResetConfirm(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      <SettingsScreen title="General">
        <SettingsSection title="Setup">
          {isDesktop && (
            <SettingsLinkRow
              icon={UserCircle}
              label="Account"
              description="Sign in to Electric Cloud and manage workspace access."
              category="account"
              onNavigate={(category) =>
                navigate({ to: `/settings/$category`, params: { category } })
              }
            />
          )}
          <SettingsLinkRow
            icon={Server}
            label="Servers"
            description="Connect to local, self-hosted, and Electric Cloud agents servers."
            category="servers"
            onNavigate={(category) =>
              navigate({ to: `/settings/$category`, params: { category } })
            }
          />
          <SettingsLinkRow
            icon={KeyRound}
            label="Credentials"
            description="Configure model providers for local agents."
            category="credentials"
            onNavigate={(category) =>
              navigate({ to: `/settings/$category`, params: { category } })
            }
          />
          {isDesktop && (
            <SettingsLinkRow
              icon={Brain}
              label="Local Runtime"
              description="Inspect and control the bundled local runtime."
              category="local-runtime"
              onNavigate={(category) =>
                navigate({ to: `/settings/$category`, params: { category } })
              }
            />
          )}
          {isDesktop && (
            <SettingsLinkRow
              icon={Plug}
              label="MCP Servers"
              description="Manage tools available to local agents."
              category="mcp-servers"
              onNavigate={(category) =>
                navigate({ to: `/settings/$category`, params: { category } })
              }
            />
          )}
        </SettingsSection>
        <SettingsSection title="Preferences">
          <SettingsLinkRow
            icon={Palette}
            label="Appearance"
            description="Choose theme and visual preferences."
            category="appearance"
            onNavigate={(category) =>
              navigate({ to: `/settings/$category`, params: { category } })
            }
          />
        </SettingsSection>
        <SettingsSection
          title="Reset"
          description="Reset this desktop app back to first-run setup."
        >
          <SettingsRow
            label="Clear all local data"
            description={
              isDesktop
                ? `Deletes saved settings, API keys, server connections, and sign-in state. The app will restart into onboarding.`
                : `Only available in the desktop app.`
            }
            control={
              <Button
                variant="soft"
                tone="danger"
                size={2}
                disabled={!isDesktop || isClearing}
                onClick={() => setShowResetConfirm(true)}
              >
                <Icon icon={Trash2} size={2} />
                {isClearing ? `Restarting…` : `Clear all local data`}
              </Button>
            }
          />
          {error && (
            <SettingsPanel>
              <Text size={2} tone="danger">
                {error}
              </Text>
            </SettingsPanel>
          )}
        </SettingsSection>
      </SettingsScreen>

      <ConfirmDialog
        open={showResetConfirm}
        onOpenChange={(open) => {
          if (!isClearing) setShowResetConfirm(open)
        }}
        title="Clear all local data?"
        description="This deletes saved settings, API keys, server connections, and sign-in state. Electric Agents will restart and return to the onboarding flow."
        confirmLabel="Clear data and restart"
        loadingLabel="Restarting..."
        confirmTone="danger"
        confirmIcon={Trash2}
        loading={isClearing}
        error={error}
        onConfirm={() => {
          void handleClearAllLocalData()
        }}
      />
    </>
  )
}

function SettingsLinkRow({
  icon,
  label,
  description,
  category,
  onNavigate,
}: {
  icon: typeof Server
  label: string
  description: string
  category: SettingsCategoryId
  onNavigate: (category: SettingsCategoryId) => void
}): React.ReactElement {
  return (
    <SettingsRow
      label={
        <span style={{ display: `inline-flex`, alignItems: `center`, gap: 8 }}>
          <Icon icon={icon} size={2} />
          {label}
        </span>
      }
      description={description}
      control={
        <Button
          variant="soft"
          tone="neutral"
          onClick={() => onNavigate(category)}
        >
          Open
        </Button>
      }
    />
  )
}
