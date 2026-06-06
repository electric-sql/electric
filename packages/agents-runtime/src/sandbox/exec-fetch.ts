import { SandboxError } from './types'
import type { SandboxExecOpts, SandboxExecResult } from './types'

type ExecFn = (opts: SandboxExecOpts) => Promise<SandboxExecResult>

const DEFAULT_TIMEOUT_MS = 10_000
/** Cap the in-sandbox response body so a huge page can't blow up exec stdout. */
const DEFAULT_MAX_BODY_BYTES = 5_000_000
const DEFAULT_USER_AGENT = `Mozilla/5.0 (compatible; DurableStreamsAgent/1.0)`
const DEFAULT_ACCEPT = `text/html,application/xhtml+xml,text/plain,*/*`

/**
 * The POSIX `sh` program that performs the request *inside* the sandbox. It
 * auto-detects an HTTP client (curl → node → wget) and emits, on stdout:
 *
 *   line 1: `<http_status>\t<content_type>`  (content_type may be empty)
 *   rest:   base64 of the response body      (line-wrapping is tolerated)
 *
 * All request inputs arrive via environment variables (FETCH_URL, FETCH_UA,
 * FETCH_ACCEPT, FETCH_TIMEOUT, FETCH_MAXBYTES) so nothing is interpolated into
 * the command string — there is no shell-injection surface from the URL or
 * headers. A missing client prints the sentinel `NOCLIENT`; a failed request
 * prints status `000`.
 *
 * Only User-Agent + Accept headers and `redirect: follow` are forwarded —
 * that is the full surface `fetch_url` uses. Request bodies and other methods
 * are out of scope (documented limitation).
 */
const FETCH_SCRIPT = `
if command -v curl >/dev/null 2>&1; then
  f="$(mktemp 2>/dev/null || echo /tmp/efetch.$$)"
  if meta="$(curl -sS -L --max-time "$FETCH_TIMEOUT" --max-filesize "$FETCH_MAXBYTES" -A "$FETCH_UA" -H "Accept: $FETCH_ACCEPT" -o "$f" -w '%{http_code}\\t%{content_type}' "$FETCH_URL")"; then
    printf '%s\\n' "$meta"
    base64 "$f" 2>/dev/null
  else
    printf '000\\t\\n'
  fi
  rm -f "$f"
elif command -v node >/dev/null 2>&1; then
  node -e 'const u=process.env.FETCH_URL;const to=(Number(process.env.FETCH_TIMEOUT)||10)*1000;const mb=Number(process.env.FETCH_MAXBYTES)||5000000;const c=new AbortController();const t=setTimeout(function(){c.abort();},to);fetch(u,{redirect:"follow",signal:c.signal,headers:{"User-Agent":process.env.FETCH_UA,"Accept":process.env.FETCH_ACCEPT}}).then(function(r){return r.arrayBuffer().then(function(a){clearTimeout(t);var b=Buffer.from(a);if(b.length>mb)b=b.subarray(0,mb);process.stdout.write(String(r.status)+"\\t"+(r.headers.get("content-type")||"")+"\\n");process.stdout.write(b.toString("base64"));});}).catch(function(){clearTimeout(t);process.stdout.write("000\\t\\n");});'
elif command -v wget >/dev/null 2>&1; then
  f="$(mktemp 2>/dev/null || echo /tmp/efetch.$$)"
  if wget -q -T "$FETCH_TIMEOUT" -U "$FETCH_UA" --header "Accept: $FETCH_ACCEPT" -O "$f" "$FETCH_URL"; then
    printf '200\\t\\n'
  else
    printf '000\\t\\n'
  fi
  base64 "$f" 2>/dev/null
  rm -f "$f"
else
  printf 'NOCLIENT\\n'
fi
`

/**
 * Perform an HTTP request from *inside* a sandbox by running an in-sandbox
 * HTTP client over `exec`, and return a synthesized `Response`. This is how
 * isolated providers (docker, e2b) implement `Sandbox.fetch()` so that the
 * request egresses through the sandbox's network — and is therefore governed
 * by the sandbox's network policy — rather than from the host process.
 */
export async function fetchInSandbox(
  exec: ExecFn,
  input: string | URL,
  init?: RequestInit,
  opts: { timeoutMs?: number; maxBodyBytes?: number } = {}
): Promise<Response> {
  const url = typeof input === `string` ? input : input.toString()
  const headers = new Headers(init?.headers)
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBodyBytes = opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES

  const result = await exec({
    command: FETCH_SCRIPT,
    env: {
      FETCH_URL: url,
      FETCH_UA: headers.get(`user-agent`) ?? DEFAULT_USER_AGENT,
      FETCH_ACCEPT: headers.get(`accept`) ?? DEFAULT_ACCEPT,
      FETCH_TIMEOUT: String(Math.ceil(timeoutMs / 1000)),
      FETCH_MAXBYTES: String(maxBodyBytes),
    },
    // Let the in-sandbox client's own timeout fire first; this is the
    // backstop if the client wedges. Forward the caller's abort signal so a
    // host-side cancellation tears the exec down too.
    timeoutMs: timeoutMs + 5_000,
    signal: init?.signal ?? undefined,
    // base64 inflates the body ~4/3; leave headroom for that + the meta line.
    maxOutputBytes: Math.ceil(maxBodyBytes * (4 / 3)) + 4_096,
  })

  const stdout = result.stdout.toString(`utf8`)
  const nlIdx = stdout.indexOf(`\n`)
  const metaLine = (nlIdx === -1 ? stdout : stdout.slice(0, nlIdx)).replace(
    /\r$/,
    ``
  )

  if (metaLine === `NOCLIENT`) {
    throw new SandboxError(
      `runtime`,
      `fetchInSandbox: no HTTP client (curl/node/wget) found in the sandbox image — cannot fetch "${url}"`
    )
  }

  const tab = metaLine.indexOf(`\t`)
  const statusStr = tab === -1 ? metaLine : metaLine.slice(0, tab)
  const contentType = tab === -1 ? `` : metaLine.slice(tab + 1).trim()
  const status = Number(statusStr)

  if (!Number.isFinite(status) || status === 0) {
    // `000` (or unparseable): no HTTP response was received. From inside the
    // sandbox a policy-blocked host is indistinguishable from an unreachable
    // one, so this surfaces as a runtime failure mentioning both.
    throw new SandboxError(
      `runtime`,
      `fetchInSandbox: request to "${url}" produced no response — the host is unreachable or blocked by the sandbox's network policy`
    )
  }
  if (status < 200 || status > 599) {
    throw new SandboxError(
      `runtime`,
      `fetchInSandbox: in-sandbox client returned an invalid HTTP status (${statusStr}) for "${url}"`
    )
  }

  const b64 = (nlIdx === -1 ? `` : stdout.slice(nlIdx + 1)).replace(/\s+/g, ``)
  const body = Buffer.from(b64, `base64`)

  return new Response(body, {
    status,
    headers: contentType ? { 'content-type': contentType } : undefined,
  })
}
