# Coding-agents host target — Playwright UI test plan

> **For agentic workers:** Companion test plan to the host-target implementation plan. Run after the implementation lands. Drop or merge `pending` flows that don't apply once the UI ships.

**Goal:** End-to-end UI verification of the `target: 'sandbox' | 'host'` and `importNativeSessionId` additions in the agents-server-ui spawn dialog and entity view.

**Scope:** UI flows the user actually clicks through. Backend correctness is covered by Vitest in `packages/coding-agents/test/`. Playwright complements that with form validation, dialog state transitions, network-request shapes, and timeline rendering.

**Spec:** `docs/superpowers/specs/2026-05-01-coding-agents-host-target-design.md`
**Impl plan:** `docs/superpowers/plans/2026-05-01-coding-agents-host-target.md`

---

## What's already in the UI today (baseline observed live)

Established via Playwright drive of `http://localhost:4437/__agent_ui/`:

- Sidebar `New session` button (disabled until `entityTypes` loads, then enabled).
- Click → popover lists `coding-agent` and `horton`.
- `coding-agent` opens a custom `CodingAgentSpawnDialog` (not the generic `SpawnArgsDialog` used by other entity types).
- Spawn dialog fields: workspace type (Volume / Bind mount toggle), volume name OR host path, initial prompt, idle timeout, keep-warm.
- `Spawn` is `disabled` when bind mount is selected and host path is empty.
- After `Spawn`, the URL routes to `#/entity/coding-agent/<name>` and the sidebar gets a list entry; the entity view shows a header (ID, URL, status badge, Fork/Pin/Release/Stop/explorer buttons), workspace tags (`claude`, `bindMount:<path>`, `N run`), a timeline of lifecycle rows (`Sandbox starting`, `Sandbox started`, `Session started (<sid>…)`), assistant messages, and a `Send a message…` input.

The slice adds **two** new things to this surface:

1. A `target` toggle (Sandbox / Host) on the spawn dialog.
2. A conditional "Import session ID" field on the spawn dialog (visible only when `target = host`).

Plus a small change to the entity-view header: when `meta.target = 'host'`, surface a "host" badge alongside the existing `claude` / `bindMount:…` tags. Optional, but helps the user know which mode an existing agent is in.

---

## Setup

### Test runner location

Playwright isn't yet wired into the repo. The natural home is `packages/agents-server-ui/test/e2e/` with `playwright.config.ts` next to `vite.config.ts`. The runner targets `http://localhost:4437/__agent_ui/` against the dev stack started by `node packages/electric-ax/bin/dev.mjs up`.

### Prerequisites for CI

- `ANTHROPIC_API_KEY` is **not** required for Playwright runs. All tests below either intercept the spawn PUT, stub claude via filesystem fixtures, or assert UI/state without invoking claude.
- Docker daemon running (postgres + electric come up via `dev.mjs`).
- A clean entity-collection per test run. Recommended: each test generates a unique entity name (e.g., `playwright-${Date.now()}-${rand}`) so tests don't collide; afterwards, the test issues a `DELETE /coding-agent/<name>` to clean up.

### Suggested config sketch

```ts
// packages/agents-server-ui/playwright.config.ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false, // entities are global; serialize for now
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4437/__agent_ui/',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }],
})
```

### Helpers we'll need

- `openSpawnDialog(page)` — click `New session`, click `coding-agent` row.
- `fillSpawn(page, { target, workspaceType, hostPath, ... })` — drive the form.
- `expectEntity(page, name)` — wait for sidebar list-item with that name.
- `cleanupEntity(name)` — `DELETE http://localhost:4437/coding-agent/${name}` after each test.
- `seedHostSession(workspacePath, sessionId, content)` — write a JSONL fixture into `~/.claude/projects/<sanitised>/<id>.jsonl` for import-flow tests; remove in `afterEach`.

---

## Flows

### Flow 1 — Spawn dialog: `target` toggle present and functional

**Why:** Quick smoke that the new toggle rendered.

```ts
test('spawn dialog exposes a Target toggle defaulting to Sandbox', async ({
  page,
}) => {
  await page.goto('/')
  await openSpawnDialog(page)

  // New buttons
  await expect(page.getByRole('button', { name: 'Sandbox' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Host' })).toBeVisible()

  // Default: Sandbox active
  await expect(page.getByRole('button', { name: 'Sandbox' })).toHaveAttribute(
    'data-state',
    'active'
  )
})
```

### Flow 2 — Selecting `Host` forces bind-mount

**Why:** The constraint is documented in the spec (D1: host requires bindMount). The UI should prevent the bad combination at form time, not punt to backend error.

```ts
test('selecting Host workspace target locks workspace type to bindMount', async ({
  page,
}) => {
  await page.goto('/')
  await openSpawnDialog(page)

  await page.getByRole('button', { name: 'Volume' }).click() // pick a volume first
  await page.getByRole('button', { name: 'Host' }).click() // switch to host

  // Volume should now be disabled or visibly excluded
  await expect(page.getByRole('button', { name: 'Volume' })).toBeDisabled()
  // Bind mount becomes the active selection
  await expect(
    page.getByRole('button', { name: 'Bind mount' })
  ).toHaveAttribute('data-state', 'active')

  // Host path field is required (Spawn disabled until filled)
  await expect(page.getByRole('button', { name: 'Spawn' })).toBeDisabled()
})
```

### Flow 3 — `Import session ID` field appears only for Host target

```ts
test('Import session ID field is visible only when Target=Host', async ({
  page,
}) => {
  await page.goto('/')
  await openSpawnDialog(page)

  await expect(page.getByLabel(/import session id/i)).not.toBeVisible()

  await page.getByRole('button', { name: 'Host' }).click()
  await expect(page.getByLabel(/import session id/i)).toBeVisible()

  await page.getByRole('button', { name: 'Sandbox' }).click()
  await expect(page.getByLabel(/import session id/i)).not.toBeVisible()
})
```

### Flow 4 — Spawn PUT body shape: `target` and `importNativeSessionId`

**Why:** Network-level contract test. Doesn't need backend to actually create the agent — we intercept and inspect.

```ts
test('Host spawn sends target=host, workspaceType=bindMount, importNativeSessionId in PUT body', async ({
  page,
}) => {
  await page.goto('/')

  let observedBody: any
  await page.route('**/coding-agent/**', async (route) => {
    if (route.request().method() === 'PUT') {
      observedBody = route.request().postDataJSON()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          url: '/coding-agent/test-host',
          name: 'test-host',
          type: 'coding-agent',
        }),
      })
      return
    }
    await route.continue()
  })

  await openSpawnDialog(page)
  await page.getByRole('button', { name: 'Host' }).click()
  await page.getByLabel('Host path').fill('/tmp/playwright-host-spawn')
  await page.getByLabel(/import session id/i).fill('imported-session-1')
  await page.getByRole('button', { name: 'Spawn' }).click()

  await expect.poll(() => observedBody).toBeTruthy()
  expect(observedBody).toMatchObject({
    target: 'host',
    workspaceType: 'bindMount',
    workspaceHostPath: '/tmp/playwright-host-spawn',
    importNativeSessionId: 'imported-session-1',
  })
})
```

### Flow 5 — Successful sandbox spawn (regression for the existing flow)

```ts
test('sandbox+bindMount spawn lands on entity view with timeline', async ({
  page,
}) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'pw-sb-'))
  await page.goto('/')
  await openSpawnDialog(page)
  await page.getByRole('button', { name: 'Bind mount' }).click()
  await page.getByLabel('Host path').fill(tmp)
  await page.getByLabel(/initial prompt/i).fill('say hi')
  await page.getByRole('button', { name: 'Spawn' }).click()

  await expect(page).toHaveURL(/#\/entity\/coding-agent\//)
  await expect(page.getByText(`bindMount:${tmp}`)).toBeVisible({
    timeout: 10_000,
  })
  await expect(page.getByText('Sandbox starting')).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText('Sandbox started')).toBeVisible({
    timeout: 60_000,
  })
})
```

(This is the only test in this file that needs `ANTHROPIC_API_KEY` — for the `say hi` turn to actually complete. It's gated behind a `process.env.E2E_FULL=1` check; the rest of the suite runs without it.)

### Flow 6 — Host spawn renders a `host` badge on the entity header

**Why:** UX safety: the user must be able to tell at a glance whether an agent is running with no isolation.

```ts
test('host-target entity header shows a "host" indicator', async ({
  page,
  request,
}) => {
  // Pre-seed the entity via API to avoid clicking through the dialog (covered elsewhere).
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'pw-host-'))
  const name = `pw-host-${Date.now()}`
  await request.put(`http://localhost:4437/coding-agent/${name}`, {
    data: {
      kind: 'claude',
      target: 'host',
      workspaceType: 'bindMount',
      workspaceHostPath: tmp,
    },
  })

  await page.goto(`/#/entity/coding-agent/${name}`)
  await expect(page.getByText(/host/i, { exact: false }).first()).toBeVisible()
  await expect(page.getByText(`bindMount:${tmp}`)).toBeVisible()
})
```

### Flow 7 — Import flow: success case

**Why:** Verifies the whole import-on-first-wake path renders correctly in the timeline.

```ts
test('importing a host session shows import.restored in the timeline', async ({
  page,
  request,
}) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'pw-imp-'))
  const real = await fs.realpath(tmp)
  const sanitised = real.replace(/\//g, '-')
  const sessionId = `pw-import-${Date.now()}`
  const projectDir = path.join(os.homedir(), '.claude', 'projects', sanitised)
  await fs.mkdir(projectDir, { recursive: true })
  const transcriptPath = path.join(projectDir, `${sessionId}.jsonl`)
  await fs.writeFile(transcriptPath, '{"type":"system","subtype":"init"}\n')

  try {
    const name = `pw-imp-${Date.now()}`
    await request.put(`http://localhost:4437/coding-agent/${name}`, {
      data: {
        kind: 'claude',
        target: 'host',
        workspaceType: 'bindMount',
        workspaceHostPath: tmp,
        importNativeSessionId: sessionId,
      },
    })

    await page.goto(`/#/entity/coding-agent/${name}`)
    await expect(
      page.getByText(/import\.restored|imported session/i)
    ).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/bytes=\d+/)).toBeVisible()
  } finally {
    await fs.unlink(transcriptPath).catch(() => {})
  }
})
```

### Flow 8 — Import flow: missing JSONL → error state

```ts
test('importing a non-existent session ID flips entity to error with import.failed', async ({
  page,
  request,
}) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'pw-imp-bad-'))
  const name = `pw-imp-bad-${Date.now()}`

  await request.put(`http://localhost:4437/coding-agent/${name}`, {
    data: {
      kind: 'claude',
      target: 'host',
      workspaceType: 'bindMount',
      workspaceHostPath: tmp,
      importNativeSessionId: 'definitely-not-on-disk',
    },
  })

  await page.goto(`/#/entity/coding-agent/${name}`)
  await expect(page.getByText(/error/i)).toBeVisible({ timeout: 10_000 })
  await expect(
    page.getByText(/import\.failed|imported session file not found/i)
  ).toBeVisible()
})
```

### Flow 9 — Validation: Sandbox + Import is a no-op (UI prevents)

**Why:** D5 says importNativeSessionId requires target=host. UI should hide the field for sandbox; if a user manages to keep it filled and then switch back to sandbox, the value should be cleared (or ignored at submit).

```ts
test('switching from Host to Sandbox clears the Import session ID', async ({
  page,
}) => {
  await page.goto('/')
  await openSpawnDialog(page)
  await page.getByRole('button', { name: 'Host' }).click()
  await page.getByLabel(/import session id/i).fill('id-to-be-cleared')
  await page.getByRole('button', { name: 'Sandbox' }).click()
  await page.getByRole('button', { name: 'Host' }).click()
  await expect(page.getByLabel(/import session id/i)).toHaveValue('')
})
```

### Flow 10 — Cross-target safety regression

**Why:** Aligned bind-mount cwd should mean a sandbox-spawned agent uses the realpath as its workspace tag (not `/workspace`).

```ts
test('sandbox+bindMount entity workspace tag shows realpath, not /workspace', async ({
  page,
  request,
}) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'pw-align-'))
  const real = await fs.realpath(tmp)
  const name = `pw-align-${Date.now()}`
  await request.put(`http://localhost:4437/coding-agent/${name}`, {
    data: {
      kind: 'claude',
      target: 'sandbox',
      workspaceType: 'bindMount',
      workspaceHostPath: tmp,
    },
  })
  await page.goto(`/#/entity/coding-agent/${name}`)
  await expect(page.getByText(`bindMount:${real}`)).toBeVisible()
  await expect(page.getByText('bindMount:/workspace')).not.toBeVisible()
})
```

---

## What's deliberately out of scope

- **Real claude turns.** Flow 5 is the only test that runs an actual turn, gated by `E2E_FULL=1`. We're not testing claude's behavior here; we're testing the UI surface.
- **Visual regression.** Snapshot diffs of the dialog are noisy. Skip.
- **Multi-tab / multi-session collaboration.** Out of scope for this slice.
- **Mobile viewports.** The UI isn't designed for mobile yet.

---

## Suggested first-cut tasks (if turning this plan into a sub-plan)

1. Wire Playwright into `packages/agents-server-ui` (config, dependency, npm script).
2. Add helpers (`openSpawnDialog`, `cleanupEntity`, etc.).
3. Implement Flows 1–4 (UI-only; no backend dependency beyond what dev script provides).
4. Implement Flows 5, 6, 7, 8, 10 (server PUT calls; dev script must be running).
5. Wire into CI behind a `pnpm test:e2e` script with the dev script as a prereq step.

These tasks should land **after** the host-target implementation plan completes, so the new dialog fields and entity-view badge are present when the tests run.
