import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import {
  Button,
  Dialog,
  Field,
  Icon,
  IconButton,
  Input,
  Stack,
  Text,
  Textarea,
} from '../../../ui'
import inputStyles from '../../../ui/Input.module.css'
import type { McpServerConfigInput } from '../../../hooks/useMcpServersIpc'

const NAME_REGEX = /^[a-zA-Z0-9_-]{1,128}$/

type Transport = `http` | `stdio`
type AuthMode = `none` | `apiKey` | `clientCredentials` | `authorizationCode`

interface FormState {
  name: string
  transport: Transport
  url: string
  authMode: AuthMode
  apiKey: { key: string; headerName: string; valuePrefix: string }
  clientCredentials: {
    tokenUrl: string
    clientId: string
    clientSecret: string
    scopes: string
  }
  authorizationCode: { scopes: string }
  command: string
  args: string
  env: string
  timeoutMs: string
}

function emptyForm(): FormState {
  return {
    name: ``,
    transport: `http`,
    url: ``,
    authMode: `none`,
    apiKey: { key: ``, headerName: ``, valuePrefix: `` },
    clientCredentials: {
      tokenUrl: ``,
      clientId: ``,
      clientSecret: ``,
      scopes: ``,
    },
    authorizationCode: { scopes: `` },
    command: ``,
    args: ``,
    env: ``,
    timeoutMs: ``,
  }
}

function formFromConfig(cfg: McpServerConfigInput): FormState {
  const base = emptyForm()
  base.name = cfg.name
  base.transport = cfg.transport
  if (cfg.transport === `http`) {
    base.url = typeof cfg.url === `string` ? cfg.url : ``
    const auth = cfg.auth as Record<string, unknown> | undefined
    const mode = auth?.mode as AuthMode | undefined
    if (mode === `apiKey`) {
      base.authMode = `apiKey`
      base.apiKey.key = (auth?.key as string) ?? ``
      base.apiKey.headerName = (auth?.headerName as string) ?? ``
      base.apiKey.valuePrefix = (auth?.valuePrefix as string) ?? ``
    } else if (mode === `clientCredentials`) {
      base.authMode = `clientCredentials`
      base.clientCredentials.tokenUrl = (auth?.tokenUrl as string) ?? ``
      base.clientCredentials.clientId = (auth?.clientId as string) ?? ``
      base.clientCredentials.clientSecret = (auth?.clientSecret as string) ?? ``
      base.clientCredentials.scopes = Array.isArray(auth?.scopes)
        ? (auth?.scopes as string[]).join(`, `)
        : ``
    } else if (mode === `authorizationCode`) {
      base.authMode = `authorizationCode`
      base.authorizationCode.scopes = Array.isArray(auth?.scopes)
        ? (auth?.scopes as string[]).join(`, `)
        : ``
    } else {
      base.authMode = `none`
    }
  } else if (cfg.transport === `stdio`) {
    base.command = (cfg.command as string) ?? ``
    const args = cfg.args
    base.args = Array.isArray(args) ? (args as string[]).join(`\n`) : ``
    const env = cfg.env as Record<string, string> | undefined
    base.env = env
      ? Object.entries(env)
          .map(([k, v]) => `${k}=${v}`)
          .join(`\n`)
      : ``
  }
  base.timeoutMs =
    typeof cfg.timeoutMs === `number` ? String(cfg.timeoutMs) : ``
  return base
}

function splitLines(input: string): string[] {
  return input
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

function splitCsv(input: string): string[] {
  return input
    .split(`,`)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function parseEnv(input: string): Record<string, string> | undefined {
  const lines = splitLines(input)
  if (lines.length === 0) return undefined
  const env: Record<string, string> = {}
  for (const line of lines) {
    const eq = line.indexOf(`=`)
    if (eq <= 0) continue
    env[line.slice(0, eq).trim()] = line.slice(eq + 1)
  }
  return Object.keys(env).length > 0 ? env : undefined
}

function buildConfig(state: FormState): {
  cfg?: McpServerConfigInput
  error?: string
} {
  const name = state.name.trim()
  if (!NAME_REGEX.test(name)) {
    return { error: `Name must match ${NAME_REGEX.source}` }
  }
  const timeoutMs = state.timeoutMs.trim()
    ? Number(state.timeoutMs.trim())
    : undefined
  if (
    timeoutMs !== undefined &&
    (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
  ) {
    return { error: `Timeout must be a positive number` }
  }
  if (state.transport === `http`) {
    const url = state.url.trim()
    if (!/^https?:\/\//.test(url)) {
      return { error: `URL must start with http:// or https://` }
    }
    let auth: Record<string, unknown>
    if (state.authMode === `none`) {
      auth = { mode: `none` }
    } else if (state.authMode === `apiKey`) {
      if (!state.apiKey.key.trim()) return { error: `API key is required` }
      auth = { mode: `apiKey`, key: state.apiKey.key }
      if (state.apiKey.headerName.trim()) {
        auth.headerName = state.apiKey.headerName.trim()
      }
      if (state.apiKey.valuePrefix) auth.valuePrefix = state.apiKey.valuePrefix
    } else if (state.authMode === `clientCredentials`) {
      if (
        !state.clientCredentials.tokenUrl.trim() ||
        !state.clientCredentials.clientId.trim() ||
        !state.clientCredentials.clientSecret.trim()
      ) {
        return {
          error: `Token URL, client id, and client secret are required for clientCredentials`,
        }
      }
      auth = {
        mode: `clientCredentials`,
        tokenUrl: state.clientCredentials.tokenUrl.trim(),
        clientId: state.clientCredentials.clientId.trim(),
        clientSecret: state.clientCredentials.clientSecret,
      }
      const scopes = splitCsv(state.clientCredentials.scopes)
      if (scopes.length > 0) auth.scopes = scopes
    } else {
      auth = { mode: `authorizationCode` }
      const scopes = splitCsv(state.authorizationCode.scopes)
      if (scopes.length > 0) auth.scopes = scopes
    }
    const cfg: McpServerConfigInput = {
      name,
      transport: `http`,
      url,
      auth,
    }
    if (timeoutMs !== undefined) cfg.timeoutMs = timeoutMs
    return { cfg }
  }
  const command = state.command.trim()
  if (!command) return { error: `Command is required` }
  const cfg: McpServerConfigInput = {
    name,
    transport: `stdio`,
    command,
  }
  const args = splitLines(state.args)
  if (args.length > 0) cfg.args = args
  const env = parseEnv(state.env)
  if (env) cfg.env = env
  if (timeoutMs !== undefined) cfg.timeoutMs = timeoutMs
  return { cfg }
}

/**
 * Add/Edit MCP server form. Used for both adding new entries and
 * editing existing ones — in edit mode the name and transport are
 * read-only because they're the keying fields (and changing transport
 * would discard most of the form anyway).
 */
export function McpServerFormDialog({
  open,
  onOpenChange,
  initial,
  onSubmit,
  existingNames,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial?: McpServerConfigInput
  onSubmit: (cfg: McpServerConfigInput) => Promise<void>
  /** Names already in settings.json — used to detect "you'd be overwriting" on Add. */
  existingNames: ReadonlyArray<string>
}): React.ReactElement {
  const isEdit = !!initial
  const [state, setState] = useState<FormState>(() =>
    initial ? formFromConfig(initial) : emptyForm()
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset state whenever the dialog opens or the initial config changes.
  useEffect(() => {
    if (!open) return
    setState(initial ? formFromConfig(initial) : emptyForm())
    setError(null)
    setSubmitting(false)
  }, [open, initial])

  const collidesOnAdd = useMemo(() => {
    if (isEdit) return false
    const trimmed = state.name.trim()
    return !!trimmed && existingNames.includes(trimmed)
  }, [isEdit, state.name, existingNames])

  const handleSubmit = async (): Promise<void> => {
    const { cfg, error: validationError } = buildConfig(state)
    if (validationError || !cfg) {
      setError(validationError ?? `Invalid configuration`)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(cfg)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content
        maxWidth={560}
        style={{ maxHeight: `90vh`, overflow: `auto` }}
      >
        <div
          style={{
            display: `flex`,
            alignItems: `flex-start`,
            justifyContent: `space-between`,
            marginBottom: 12,
          }}
        >
          <div>
            <Dialog.Title>
              {isEdit ? `Edit MCP server` : `Add MCP server`}
            </Dialog.Title>
            <Dialog.Description>
              {isEdit
                ? `Update the configuration. Name and transport are immutable — remove and re-add to change them.`
                : `Add a server to your desktop settings. Use stdio for a locally-spawned process or http for a remote MCP endpoint.`}
            </Dialog.Description>
          </div>
          <Dialog.Close
            render={
              <IconButton
                type="button"
                size={1}
                variant="ghost"
                tone="neutral"
                round
                aria-label="Close dialog"
              >
                <Icon icon={X} size={2} />
              </IconButton>
            }
          />
        </div>

        <Stack direction="column" gap={3}>
          <Field
            label="Name"
            required
            description={
              collidesOnAdd
                ? `A server with this name already exists — saving will overwrite it.`
                : `Allowed: letters, digits, _ and -. Used as the tool prefix mcp__<name>__.`
            }
          >
            <Input
              value={state.name}
              disabled={isEdit}
              onChange={(e) =>
                setState((s) => ({ ...s, name: e.target.value }))
              }
              placeholder="my-mcp-server"
            />
          </Field>

          <Field label="Transport" required>
            <select
              className={`${inputStyles.input} ${inputStyles.size2}`}
              value={state.transport}
              disabled={isEdit}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  transport: e.target.value as Transport,
                }))
              }
            >
              <option value="http">HTTP (remote)</option>
              <option value="stdio">stdio (local process)</option>
            </select>
          </Field>

          {state.transport === `http` ? (
            <>
              <Field label="URL" required>
                <Input
                  value={state.url}
                  onChange={(e) =>
                    setState((s) => ({ ...s, url: e.target.value }))
                  }
                  placeholder="https://example.com/mcp"
                />
              </Field>
              <Field label="Auth mode">
                <select
                  className={`${inputStyles.input} ${inputStyles.size2}`}
                  value={state.authMode}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      authMode: e.target.value as AuthMode,
                    }))
                  }
                >
                  <option value="none">None</option>
                  <option value="apiKey">API key</option>
                  <option value="clientCredentials">Client credentials</option>
                  <option value="authorizationCode">
                    Authorization code (OAuth)
                  </option>
                </select>
              </Field>

              {state.authMode === `apiKey` && (
                <>
                  <Field
                    label="API key"
                    required
                    description="Stored plaintext in settings.json."
                  >
                    <Input
                      type="password"
                      value={state.apiKey.key}
                      onChange={(e) =>
                        setState((s) => ({
                          ...s,
                          apiKey: { ...s.apiKey, key: e.target.value },
                        }))
                      }
                    />
                  </Field>
                  <Field
                    label="Header name"
                    description="Default: Authorization."
                  >
                    <Input
                      value={state.apiKey.headerName}
                      onChange={(e) =>
                        setState((s) => ({
                          ...s,
                          apiKey: {
                            ...s.apiKey,
                            headerName: e.target.value,
                          },
                        }))
                      }
                      placeholder="Authorization"
                    />
                  </Field>
                  <Field
                    label="Value prefix"
                    description={`Optional, e.g. "Bearer ".`}
                  >
                    <Input
                      value={state.apiKey.valuePrefix}
                      onChange={(e) =>
                        setState((s) => ({
                          ...s,
                          apiKey: {
                            ...s.apiKey,
                            valuePrefix: e.target.value,
                          },
                        }))
                      }
                      placeholder="Bearer "
                    />
                  </Field>
                </>
              )}

              {state.authMode === `clientCredentials` && (
                <>
                  <Field label="Token URL" required>
                    <Input
                      value={state.clientCredentials.tokenUrl}
                      onChange={(e) =>
                        setState((s) => ({
                          ...s,
                          clientCredentials: {
                            ...s.clientCredentials,
                            tokenUrl: e.target.value,
                          },
                        }))
                      }
                      placeholder="https://auth.example.com/oauth/token"
                    />
                  </Field>
                  <Field label="Client ID" required>
                    <Input
                      value={state.clientCredentials.clientId}
                      onChange={(e) =>
                        setState((s) => ({
                          ...s,
                          clientCredentials: {
                            ...s.clientCredentials,
                            clientId: e.target.value,
                          },
                        }))
                      }
                    />
                  </Field>
                  <Field
                    label="Client secret"
                    required
                    description="Stored plaintext in settings.json."
                  >
                    <Input
                      type="password"
                      value={state.clientCredentials.clientSecret}
                      onChange={(e) =>
                        setState((s) => ({
                          ...s,
                          clientCredentials: {
                            ...s.clientCredentials,
                            clientSecret: e.target.value,
                          },
                        }))
                      }
                    />
                  </Field>
                  <Field
                    label="Scopes"
                    description="Comma-separated, optional."
                  >
                    <Input
                      value={state.clientCredentials.scopes}
                      onChange={(e) =>
                        setState((s) => ({
                          ...s,
                          clientCredentials: {
                            ...s.clientCredentials,
                            scopes: e.target.value,
                          },
                        }))
                      }
                      placeholder="mcp:read, mcp:write"
                    />
                  </Field>
                </>
              )}

              {state.authMode === `authorizationCode` && (
                <Field
                  label="Scopes"
                  description="Comma-separated, optional. You'll authorize via your browser after saving."
                >
                  <Input
                    value={state.authorizationCode.scopes}
                    onChange={(e) =>
                      setState((s) => ({
                        ...s,
                        authorizationCode: {
                          ...s.authorizationCode,
                          scopes: e.target.value,
                        },
                      }))
                    }
                    placeholder="mcp:read"
                  />
                </Field>
              )}
            </>
          ) : (
            <>
              <Field label="Command" required>
                <Input
                  value={state.command}
                  onChange={(e) =>
                    setState((s) => ({ ...s, command: e.target.value }))
                  }
                  placeholder="npx"
                />
              </Field>
              <Field label="Arguments" description="One per line.">
                <Textarea
                  rows={4}
                  mono
                  value={state.args}
                  onChange={(e) =>
                    setState((s) => ({ ...s, args: e.target.value }))
                  }
                  placeholder={`-y\n@modelcontextprotocol/server-git\n--repository\n\${workspaceRoot}`}
                />
              </Field>
              <Field
                label="Environment"
                description="One KEY=VALUE per line. Stored plaintext in settings.json."
              >
                <Textarea
                  rows={3}
                  mono
                  value={state.env}
                  onChange={(e) =>
                    setState((s) => ({ ...s, env: e.target.value }))
                  }
                  placeholder="MY_VAR=value"
                />
              </Field>
            </>
          )}

          <Field
            label="Timeout (ms)"
            description="Per-call timeout. Default 30000."
          >
            <Input
              type="number"
              inputMode="numeric"
              value={state.timeoutMs}
              onChange={(e) =>
                setState((s) => ({ ...s, timeoutMs: e.target.value }))
              }
              placeholder="30000"
            />
          </Field>

          {error && (
            <Text size={1} tone="danger">
              {error}
            </Text>
          )}

          <Stack direction="row" gap={2} justify="end">
            <Dialog.Close
              render={
                <Button variant="soft" tone="neutral" disabled={submitting}>
                  Cancel
                </Button>
              }
            />
            <Button onClick={() => void handleSubmit()} disabled={submitting}>
              {isEdit ? `Save changes` : `Add server`}
            </Button>
          </Stack>
        </Stack>
      </Dialog.Content>
    </Dialog.Root>
  )
}
