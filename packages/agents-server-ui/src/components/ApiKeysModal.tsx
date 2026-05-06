import { useEffect, useState } from 'react'
import {
  loadApiKeysStatus,
  saveApiKeys as persistApiKeys,
  type ApiKeysStatus,
} from '../lib/server-connection'
import { Dialog } from '../ui'
import { ApiKeysForm } from './ApiKeysForm'

/**
 * First-launch dialog that captures provider API keys for the
 * bundled local Horton runtime in the Electron desktop app.
 *
 * Behavior:
 *  - Web build: noop (returns `null`, never queries IPC).
 *  - Desktop build: on mount, asks main for `ApiKeysStatus`. If no
 *    keys are saved yet, opens a modal with the two provider inputs
 *    pre-filled from `process.env.ANTHROPIC_API_KEY` /
 *    `OPENAI_API_KEY` (captured by main at launch — see
 *    `ENV_API_KEYS_SNAPSHOT` in `packages/agents-desktop/src/main.ts`).
 *  - Save persists via `desktop:save-api-keys`, which writes
 *    `settings.json`, mirrors the values into `process.env`, and
 *    restarts the runtime so Horton picks them up on its next start.
 *  - Skip just closes the dialog — nothing is persisted, so the
 *    prompt reappears on next launch (the user can also revisit
 *    Settings → General to set keys at any time).
 *
 * The form itself lives in `ApiKeysForm` so the same component is
 * reused by Settings → General with a different secondary action.
 */
export function ApiKeysModal(): React.ReactElement | null {
  const isDesktop = typeof window !== `undefined` && Boolean(window.electronAPI)
  const [status, setStatus] = useState<ApiKeysStatus | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!isDesktop) return
    let cancelled = false
    void loadApiKeysStatus().then((result) => {
      if (cancelled || !result) return
      setStatus(result)
      if (!result.hasAnyKey) setOpen(true)
    })
    return () => {
      cancelled = true
    }
  }, [isDesktop])

  if (!status) return null

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        // Skipping is allowed (Settings → General can fix keys later);
        // use the controlled `open` state so close-on-Escape /
        // backdrop-click paths feed back into our own setter rather
        // than orphaning the dialog.
        setOpen(next)
      }}
    >
      <Dialog.Content maxWidth={520}>
        <Dialog.Title>Set up your API keys</Dialog.Title>
        <Dialog.Description>
          Electric Agents bundles a local runtime that calls the LLM provider of
          your choice. Provide an Anthropic and/or OpenAI API key — they're
          stored on this machine only and used by the local Horton runtime.
          Brave Search is optional and powers the web-search tool.
        </Dialog.Description>
        <ApiKeysForm
          initial={{
            anthropic:
              status.suggested.anthropic ?? status.saved.anthropic ?? ``,
            openai: status.suggested.openai ?? status.saved.openai ?? ``,
            brave: status.suggested.brave ?? status.saved.brave ?? ``,
          }}
          showSuggestionHint={Boolean(
            status.suggested.anthropic ||
              status.suggested.openai ||
              status.suggested.brave
          )}
          autoFocus
          onSave={async ({ anthropic, openai, brave }) => {
            await persistApiKeys({
              anthropic: anthropic.trim() || null,
              openai: openai.trim() || null,
              brave: brave.trim() || null,
            })
            setOpen(false)
            const next = await loadApiKeysStatus()
            if (next) setStatus(next)
          }}
          onSecondary={() => setOpen(false)}
          secondaryLabel="Skip for now"
        />
      </Dialog.Content>
    </Dialog.Root>
  )
}
