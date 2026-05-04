import { test, expect } from '@playwright/test'
import { rm } from 'node:fs/promises'
import {
  deleteEntity,
  makeTmpWorkspace,
  openSpawnDialog,
  uniqueAgentName,
} from './helpers'

// Layer 4 spawn-dialog smoke spec generated from the 2026-05-03 bug hunt
// (docs/superpowers/specs/2026-05-03-bug-hunt-report.md). Each test drives
// the spawn dialog with a different (kind × target × workspaceType) combo,
// captures the PUT body, and cleans up the entity afterwards.
//
// Stubs the PUT so the suite doesn't depend on docker being up. The
// docker-backed spawn is exercised by the SLOW=1 e2e suite separately.
//
// Per-iteration cleanup: deleteEntity always runs in `finally` even when
// the test fails. UI-spawned docker volumes are left to the
// LocalDockerProvider's MVP-deferred semantics (see report O-1); a
// follow-up `cleanup:volumes` script would close the loop.
test.describe(`Spawn dialog combos (claude/codex/opencode × sandbox/host × volume/bindMount)`, () => {
  test(`claude / sandbox / volume — submits with defaults`, async ({
    page,
  }) => {
    let body: any = null
    await page.route(`**/coding-agent/**`, async (route) => {
      const req = route.request()
      if (req.method() === `PUT`) {
        body = req.postDataJSON()
        await route.fulfill({
          status: 200,
          contentType: `application/json`,
          body: JSON.stringify({
            url: `/coding-agent/x`,
            name: `x`,
            type: `coding-agent`,
          }),
        })
        return
      }
      await route.continue()
    })

    await openSpawnDialog(page)
    await page.getByRole(`button`, { name: `Spawn`, exact: true }).click()
    await expect.poll(() => body).not.toBeNull()
    expect(body).toMatchObject({
      args: { kind: `claude`, target: `sandbox`, workspaceType: `volume` },
    })
  })

  test(`codex / sandbox / volume`, async ({ page }) => {
    let body: any = null
    await page.route(`**/coding-agent/**`, async (route) => {
      if (route.request().method() === `PUT`) {
        body = route.request().postDataJSON()
        await route.fulfill({
          status: 200,
          contentType: `application/json`,
          body: `{}`,
        })
        return
      }
      await route.continue()
    })
    await openSpawnDialog(page)
    await page.getByRole(`button`, { name: `Codex`, exact: true }).click()
    await page.getByRole(`button`, { name: `Spawn`, exact: true }).click()
    await expect.poll(() => body).not.toBeNull()
    expect(body).toMatchObject({
      args: { kind: `codex`, target: `sandbox`, workspaceType: `volume` },
    })
  })

  test(`opencode / sandbox / volume — model selector visible only after kind=opencode`, async ({
    page,
  }) => {
    let body: any = null
    await page.route(`**/coding-agent/**`, async (route) => {
      if (route.request().method() === `PUT`) {
        body = route.request().postDataJSON()
        await route.fulfill({
          status: 200,
          contentType: `application/json`,
          body: `{}`,
        })
        return
      }
      await route.continue()
    })
    await openSpawnDialog(page)
    await expect(page.getByTestId(`opencode-model-select`)).toBeHidden()
    await page.getByTestId(`kind-opencode`).click()
    const select = page.getByTestId(`opencode-model-select`)
    await expect(select).toBeVisible()
    await expect(select).toHaveValue(`openai/gpt-5.4-mini-fast`)
    await page.getByRole(`button`, { name: `Spawn`, exact: true }).click()
    await expect.poll(() => body).not.toBeNull()
    expect(body).toMatchObject({
      args: {
        kind: `opencode`,
        target: `sandbox`,
        workspaceType: `volume`,
        model: `openai/gpt-5.4-mini-fast`,
      },
    })
  })

  test(`claude / host / bindMount — host requires bindMount + a host path`, async ({
    page,
  }) => {
    const { path: tmp } = await makeTmpWorkspace()
    let body: any = null
    try {
      await page.route(`**/coding-agent/**`, async (route) => {
        if (route.request().method() === `PUT`) {
          body = route.request().postDataJSON()
          await route.fulfill({
            status: 200,
            contentType: `application/json`,
            body: `{}`,
          })
          return
        }
        await route.continue()
      })
      await openSpawnDialog(page)
      await page.getByRole(`button`, { name: `Host`, exact: true }).click()
      // Workspace auto-switched to bindMount; supply a host path.
      // The label is a sibling Text node (not <label for>), so match by
      // placeholder instead.
      await page
        .getByPlaceholder(`/Users/me/my-project`, { exact: false })
        .fill(tmp)
      await page.getByRole(`button`, { name: `Spawn`, exact: true }).click()
      await expect.poll(() => body).not.toBeNull()
      expect(body).toMatchObject({
        args: {
          kind: `claude`,
          target: `host`,
          workspaceType: `bindMount`,
          workspaceHostPath: tmp,
        },
      })
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })
})

test.describe(`destroyed-entity buttons gate (O-2 fix)`, () => {
  test(`Pin/Release/Stop/Convert all disabled when status=destroyed`, async ({
    page,
    request,
  }) => {
    const name = uniqueAgentName(`pw-destroyed-`)
    try {
      await request.put(`http://localhost:4437/coding-agent/${name}`, {
        data: {
          args: { kind: `claude`, target: `sandbox`, workspaceType: `volume` },
        },
      })
      // Trigger destroy via the inbox.
      await request.post(`http://localhost:4437/coding-agent/${name}/send`, {
        data: { from: `pw-test`, type: `destroy`, payload: {} },
      })
      // Poll for status=destroyed.
      await expect
        .poll(
          async () => {
            const r = await request.get(
              `http://localhost:4437/coding-agent/${name}/main?offset=-1`
            )
            const data = (await r.json()) as Array<any>
            const meta = data
              .filter((e) => e.type === `coding-agent.sessionMeta`)
              .map((e) => e.value)
              .at(-1) as any
            return meta?.status
          },
          { timeout: 15_000 }
        )
        .toBe(`destroyed`)

      await page.goto(`/#/entity/coding-agent/${name}`)
      await expect(page.getByTestId(`entity-header`)).toBeVisible()

      await expect(
        page.getByRole(`button`, { name: `Pin`, exact: true })
      ).toBeDisabled()
      await expect(
        page.getByRole(`button`, { name: `Release`, exact: true })
      ).toBeDisabled()
      await expect(
        page.getByRole(`button`, { name: `Stop`, exact: true })
      ).toBeDisabled()
      await expect(page.getByTestId(`convert-target-button`)).toBeDisabled()
      await expect(page.getByTestId(`convert-kind-button`)).toBeDisabled()
    } finally {
      await deleteEntity(request, name)
    }
  })
})

test.describe(`convert-target gate`, () => {
  test(`server rejects sandbox+volume → host with 'requires bindMount'`, async ({
    request,
  }) => {
    // This is a server-level gate (handler/processConvertTarget). The UI
    // dropdown also disables the option, but the server must remain the
    // source of truth — verified during bug hunt iteration #6.
    const name = uniqueAgentName(`pw-convert-target-`)
    try {
      const put = await request.put(
        `http://localhost:4437/coding-agent/${name}`,
        {
          data: {
            args: {
              kind: `claude`,
              target: `sandbox`,
              workspaceType: `volume`,
            },
          },
        }
      )
      expect(put.ok()).toBe(true)
      // Trigger the convert-target via the inbox.
      const send = await request.post(
        `http://localhost:4437/coding-agent/${name}/send`,
        {
          data: {
            from: `pw-test`,
            type: `convert-target`,
            payload: { to: `host` },
          },
        }
      )
      expect(send.ok()).toBe(true)
      // Poll the entity until lastError carries the rejection.
      await expect
        .poll(
          async () => {
            const r = await request.get(
              `http://localhost:4437/coding-agent/${name}/main?offset=-1`
            )
            const data = (await r.json()) as Array<any>
            const meta = data
              .filter((e) => e.type === `coding-agent.sessionMeta`)
              .map((e) => e.value)
              .at(-1) as any
            return meta?.lastError ?? ``
          },
          { timeout: 15_000 }
        )
        .toMatch(/requires a bindMount workspace/)
    } finally {
      await deleteEntity(request, name)
    }
  })
})
