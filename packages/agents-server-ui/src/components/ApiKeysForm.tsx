import { useCallback, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button, Field, Input, Stack, Text } from '../ui'
import styles from './ApiKeysForm.module.css'

export type ApiKeysFormValues = {
  anthropic: string
  openai: string
  brave: string
}

interface ApiKeysFormProps {
  initial: ApiKeysFormValues
  /** When true, render the "pre-filled from your environment" callout. */
  showSuggestionHint?: boolean
  /** Submit handler — should persist + return when the round-trip is done. */
  onSave: (keys: ApiKeysFormValues) => Promise<void>
  /**
   * Optional secondary action label/handler. The first-launch modal
   * uses "Skip for now"; the settings page omits it entirely so the
   * user just clicks Save to persist (or navigates away to discard).
   */
  onSecondary?: () => void
  secondaryLabel?: string
  /** Override the primary button label. Defaults to "Save". */
  saveLabel?: string
  /** Override the in-flight primary button label. Defaults to "Saving…". */
  savingLabel?: string
  /** Auto-focus the Anthropic field on mount. Defaults to `false`. */
  autoFocus?: boolean
}

/**
 * Shared API-keys form for the local Horton runtime. Used by:
 *
 *  - `ApiKeysModal` — the first-launch dialog that fires when no
 *    keys are saved yet.
 *  - `GeneralPage` (Settings → General) — the always-on editor for
 *    revising keys after initial setup.
 *
 * Save is enabled as soon as any field has content. The Brave field
 * is optional in both contexts — typing only Brave is allowed (e.g.
 * the user already has an LLM key in `.env` and just wants to add
 * web-search support). Empty submit is disabled because it would
 * be a no-op.
 */
export function ApiKeysForm({
  initial,
  showSuggestionHint = false,
  onSave,
  onSecondary,
  secondaryLabel,
  saveLabel = `Save`,
  savingLabel = `Saving…`,
  autoFocus = false,
}: ApiKeysFormProps): React.ReactElement {
  const [anthropic, setAnthropic] = useState(initial.anthropic)
  const [openai, setOpenai] = useState(initial.openai)
  const [brave, setBrave] = useState(initial.brave)
  const [saving, setSaving] = useState(false)
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
            autoFocus={autoFocus}
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
        {onSecondary && secondaryLabel && (
          <Button
            type="button"
            variant="soft"
            tone="neutral"
            onClick={onSecondary}
            disabled={saving}
          >
            {secondaryLabel}
          </Button>
        )}
        <Button type="submit" disabled={!canSave || saving}>
          {saving ? savingLabel : saveLabel}
        </Button>
      </Stack>
    </form>
  )
}
