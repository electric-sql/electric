import { useEffect, useRef, useState } from 'react'

const NAME_STORAGE_KEY = `coding-session-viewer-user-name`

interface Props {
  baseUrl: string
  entityUrl: string
  /** Disabled when the session is stopped / errored — no agent to receive prompts. */
  disabled?: boolean
}

type SubmitState =
  | { kind: `idle` }
  | { kind: `sending` }
  | { kind: `sent` }
  | { kind: `error`; message: string }

export function PromptInput({
  baseUrl,
  entityUrl,
  disabled,
}: Props): React.ReactElement {
  const [text, setText] = useState(``)
  const [name, setName] = useState(() => {
    if (typeof window === `undefined`) return ``
    return window.localStorage.getItem(NAME_STORAGE_KEY) ?? ``
  })
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: `idle` })
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (submitState.kind !== `sent`) return
    const id = setTimeout(() => setSubmitState({ kind: `idle` }), 2000)
    return () => clearTimeout(id)
  }, [submitState])

  const persistName = (next: string): void => {
    setName(next)
    if (typeof window !== `undefined`) {
      if (next.trim()) {
        window.localStorage.setItem(NAME_STORAGE_KEY, next.trim())
      } else {
        window.localStorage.removeItem(NAME_STORAGE_KEY)
      }
    }
  }

  const submit = async (): Promise<void> => {
    const trimmed = text.trim()
    if (!trimmed || disabled) return
    setSubmitState({ kind: `sending` })

    // Matches the agents-server /send endpoint contract. The coding-session
    // handler drains the inbox row-by-row and treats `payload.text` as the
    // prompt. `from` is surfaced in the timeline metadata.
    const body = {
      from: name.trim() || `viewer`,
      payload: { text: trimmed },
    }

    try {
      const res = await fetch(`${baseUrl}${entityUrl}/send`, {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => ``)
        throw new Error(`HTTP ${res.status}${errText ? `: ${errText}` : ``}`)
      }
      setText(``)
      setSubmitState({ kind: `sent` })
      textareaRef.current?.focus()
    } catch (error) {
      setSubmitState({
        kind: `error`,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === `Enter` && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  const canSubmit =
    !disabled && text.trim().length > 0 && submitState.kind !== `sending`

  return (
    <div className="prompt-input">
      <div className="prompt-input-name-row">
        <label className="prompt-input-name-label">
          Your name (shown in the timeline):
          <input
            type="text"
            value={name}
            onChange={(e) => persistName(e.target.value)}
            placeholder="viewer"
            className="prompt-input-name"
            maxLength={40}
            disabled={disabled}
          />
        </label>
        {submitState.kind === `sending` && (
          <span className="prompt-input-status sending">Sending…</span>
        )}
        {submitState.kind === `sent` && (
          <span className="prompt-input-status sent">Sent ✓</span>
        )}
        {submitState.kind === `error` && (
          <span
            className="prompt-input-status error"
            title={submitState.message}
          >
            Failed — {submitState.message}
          </span>
        )}
      </div>
      <form
        className="prompt-input-form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <textarea
          ref={textareaRef}
          className="prompt-input-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            disabled
              ? `Session is not accepting prompts right now.`
              : `Type a prompt. Enter to send; Shift+Enter for a new line.`
          }
          rows={2}
          disabled={disabled}
          aria-label="Prompt for coding session"
        />
        <button
          type="submit"
          className="btn primary prompt-input-submit"
          disabled={!canSubmit}
        >
          Send
        </button>
      </form>
    </div>
  )
}
