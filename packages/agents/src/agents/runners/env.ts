/**
 * Build a subprocess `env` derived from `process.env` minus a single
 * variable. Used by the SDK runners to hide a parent-process API key
 * (e.g. `ANTHROPIC_API_KEY`) from the spawned `claude` / `codex`
 * subprocess so the binary falls back to user-configured credentials
 * (`claude login` OAuth, `~/.codex/auth.json`, etc.) instead of using
 * the API key.
 *
 * Both SDKs replace the subprocess env with this object when provided
 * — they don't merge — so we have to spread `process.env` first to
 * preserve `HOME`, `PATH`, and everything else the binary needs.
 */
export function subprocessEnvWithoutKey(
  keyName: string
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (k === keyName) continue
    if (typeof v === `string`) out[k] = v
  }
  return out
}
