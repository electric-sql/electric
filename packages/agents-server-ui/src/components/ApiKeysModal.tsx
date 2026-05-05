import { useCallback, useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import {
  loadApiKeysStatus,
  saveApiKeys as persistApiKeys,
  type ApiKeysStatus,
} from '../lib/server-connection'
import { Button, Dialog, Field, Input, Stack, Text } from '../ui'
import styles from './ApiKeysModal.module.css'

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
 *    prompt reappears on next launch (intentional until a settings
 *    UI exists for editing keys later).
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
        // Skipping is allowed (we re-prompt next launch); use the
        // controlled `open` state so the close-on-Escape /
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
          onSave={async ({ anthropic, openai, brave }) => {
            await persistApiKeys({
              anthropic: anthropic.trim() || null,
              openai: openai.trim() || null,
              brave: brave.trim() || null,
            })
            setOpen(false)
            // Refresh local status so subsequent sessions in this
            // window won't re-prompt even though the dialog is
            // already closed.
            const next = await loadApiKeysStatus()
            if (next) setStatus(next)
          }}
          onSkip={() => setOpen(false)}
        />
      </Dialog.Content>
    </Dialog.Root>
  )
}

type FormValues = { anthropic: string; openai: string; brave: string }

function ApiKeysForm({
  initial,
  showSuggestionHint,
  onSave,
  onSkip,
}: {
  initial: FormValues
  showSuggestionHint: boolean
  onSave: (keys: FormValues) => Promise<void>
  onSkip: () => void
}): React.ReactElement {
  const [anthropic, setAnthropic] = useState(initial.anthropic)
  const [openai, setOpenai] = useState(initial.openai)
  const [brave, setBrave] = useState(initial.brave)
  const [saving, setSaving] = useState(false)
  // Save is enabled as long as the user has typed something — Brave
  // alone is allowed (e.g. they already have an LLM key in `.env`
  // and just want to add web-search support), but typing nothing
  // would be a no-op so we keep the button disabled.
  const canSave =
    anthropic.trim().length > 0 ||
    openai.trim().length > 0 ||
    brave.trim().length > 0

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!canSave || saving) return
      setSaving(true)
      try {
        await onSave({ anthropic, openai, brave })
      } finally {
        setSaving(false)
      }
    },
    [anthropic, openai, brave, canSave, saving, onSave]
  )

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      {showSuggestionHint && (
        <div className={styles.hint}>
          <Sparkles size={14} />
          <Text size={1} tone="muted">
            Pre-filled from your environment. Click save to persist them.
          </Text>
        </div>
      )}
      <Stack direction="column" gap={3}>
        <Field
          label="Anthropic API key"
          description="Used for Claude models. Looks like sk-ant-…"
        >
          <Input
            type="password"
            placeholder="sk-ant-…"
            value={anthropic}
            onChange={(e) => setAnthropic(e.target.value)}
            size={2}
            autoFocus
          />
        </Field>
        <Field
          label="OpenAI API key"
          description="Used for GPT models. Looks like sk-…"
        >
          <Input
            type="password"
            placeholder="sk-…"
            value={openai}
            onChange={(e) => setOpenai(e.target.value)}
            size={2}
          />
        </Field>
        <Field
          label="Brave Search API key (optional)"
          description="Powers the web-search tool. Without it, search falls back to Anthropic's built-in search."
        >
          <Input
            type="password"
            placeholder="BSA…"
            value={brave}
            onChange={(e) => setBrave(e.target.value)}
            size={2}
          />
        </Field>
      </Stack>
      <Stack gap={2} justify="end" className={styles.actions}>
        <Button
          type="button"
          variant="soft"
          tone="neutral"
          onClick={onSkip}
          disabled={saving}
        >
          Skip for now
        </Button>
        <Button type="submit" disabled={!canSave || saving}>
          {saving ? `Saving…` : `Save`}
        </Button>
      </Stack>
    </form>
  )
}
