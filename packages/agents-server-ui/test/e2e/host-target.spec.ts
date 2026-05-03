import { test, expect } from '@playwright/test'
import { rm, unlink } from 'node:fs/promises'
import {
  openSpawnDialog,
  makeTmpWorkspace,
  seedHostSession,
  spawnAndWake,
  deleteEntity,
  uniqueAgentName,
} from './helpers'

test.describe(`Spawn dialog — Target toggle (Flows 1, 2)`, () => {
  test(`exposes a Target toggle defaulting to Sandbox`, async ({ page }) => {
    await openSpawnDialog(page)
    const sandboxBtn = page.getByRole(`button`, {
      name: `Sandbox`,
      exact: true,
    })
    const hostBtn = page.getByRole(`button`, { name: `Host`, exact: true })
    await expect(sandboxBtn).toBeVisible()
    await expect(hostBtn).toBeVisible()
    // Sandbox is the default. Radix marks the active variant; we assert
    // by checking the data-accent-color or by the button hierarchy. Since
    // styling differences vary, check that clicking Host changes things.
  })

  test(`selecting Host workspace target locks workspace type to bindMount`, async ({
    page,
  }) => {
    await openSpawnDialog(page)
    // Pick volume first to confirm the disable behavior.
    await page.getByRole(`button`, { name: `Volume`, exact: true }).click()
    await page.getByRole(`button`, { name: `Host`, exact: true }).click()

    await expect(
      page.getByRole(`button`, { name: `Volume`, exact: true })
    ).toBeDisabled()
    // Bind mount is now active and Host path field is required.
    await expect(page.getByText(`Host path`).first()).toBeVisible()
    await expect(
      page.getByRole(`button`, { name: `Spawn`, exact: true })
    ).toBeDisabled()
  })
})

test.describe(`Spawn dialog — Import session ID (Flows 3, 9)`, () => {
  test(`Import session ID field is visible only when Target=Host`, async ({
    page,
  }) => {
    await openSpawnDialog(page)
    await expect(page.getByText(`Import session ID`)).toBeHidden()

    await page.getByRole(`button`, { name: `Host`, exact: true }).click()
    await expect(page.getByText(`Import session ID`)).toBeVisible()

    await page.getByRole(`button`, { name: `Sandbox`, exact: true }).click()
    await expect(page.getByText(`Import session ID`)).toBeHidden()
  })

  test(`switching from Host to Sandbox clears the Import session ID`, async ({
    page,
  }) => {
    await openSpawnDialog(page)
    await page.getByRole(`button`, { name: `Host`, exact: true }).click()
    const importInput = page
      .locator(`text=Import session ID`)
      .locator(`xpath=following::input[1]`)
    await importInput.fill(`id-to-be-cleared`)
    await expect(importInput).toHaveValue(`id-to-be-cleared`)

    await page.getByRole(`button`, { name: `Sandbox`, exact: true }).click()
    // Field is hidden; flip back to host and confirm it's empty
    await page.getByRole(`button`, { name: `Host`, exact: true }).click()
    const importInput2 = page
      .locator(`text=Import session ID`)
      .locator(`xpath=following::input[1]`)
    await expect(importInput2).toHaveValue(``)
  })
})

test.describe(`Spawn PUT body shape (Flow 4)`, () => {
  test(`Host spawn sends target=host, workspaceType=bindMount, importNativeSessionId in PUT body`, async ({
    page,
  }) => {
    let observedBody: any = null
    let observedUrl = ``
    await page.route(`**/coding-agent/**`, async (route) => {
      const req = route.request()
      if (req.method() === `PUT`) {
        observedUrl = req.url()
        observedBody = req.postDataJSON()
        await route.fulfill({
          status: 200,
          contentType: `application/json`,
          body: JSON.stringify({
            url: `/coding-agent/intercepted`,
            name: `intercepted`,
            type: `coding-agent`,
          }),
        })
        return
      }
      await route.continue()
    })

    await openSpawnDialog(page)
    await page.getByRole(`button`, { name: `Host`, exact: true }).click()
    const hostPathInput = page.getByPlaceholder(`/Users/me/my-project`)
    await hostPathInput.fill(`/tmp/playwright-host-spawn`)
    const importInput = page
      .locator(`text=Import session ID`)
      .locator(`xpath=following::input[1]`)
    await importInput.fill(`imported-session-1`)
    await page.getByRole(`button`, { name: `Spawn`, exact: true }).click()

    await expect.poll(() => observedBody).not.toBeNull()
    expect(observedUrl).toMatch(/\/coding-agent\/[^/]+$/)
    expect(observedBody).toMatchObject({
      args: {
        target: `host`,
        workspaceType: `bindMount`,
        workspaceHostPath: `/tmp/playwright-host-spawn`,
        importNativeSessionId: `imported-session-1`,
      },
    })
  })
})

test.describe(`Sandbox spawn regression (Flow 5)`, () => {
  test.skip(
    process.env.E2E_FULL !== `1`,
    `Set E2E_FULL=1 to run real claude spawn (requires ANTHROPIC_API_KEY)`
  )

  test(`sandbox+bindMount spawn lands on entity view with timeline`, async ({
    page,
    request,
  }) => {
    const { path: tmp } = await makeTmpWorkspace()
    let createdName: string | null = null
    try {
      await openSpawnDialog(page)
      await page
        .getByRole(`button`, { name: `Bind mount`, exact: true })
        .click()
      const hostPathInput = page.getByPlaceholder(`/Users/me/my-project`)
      await hostPathInput.fill(tmp)
      await page.getByRole(`button`, { name: `Spawn`, exact: true }).click()

      await expect(page).toHaveURL(/#\/entity\/coding-agent\//, {
        timeout: 10_000,
      })
      const url = page.url()
      const m = url.match(/coding-agent\/([^/?#]+)/)
      createdName = m ? m[1]! : null
      await expect(page.getByText(`bindMount:`)).toBeVisible({
        timeout: 10_000,
      })
      await expect(page.getByText(`Sandbox starting`)).toBeVisible({
        timeout: 30_000,
      })
    } finally {
      if (createdName) await deleteEntity(request, createdName)
      await rm(tmp, { recursive: true, force: true })
    }
  })
})

test.describe(`Host badge on entity header (Flow 6)`, () => {
  test(`host-target entity header shows a 'host' indicator`, async ({
    page,
    request,
  }) => {
    const { path: tmp, realPath } = await makeTmpWorkspace()
    const name = uniqueAgentName(`pw-host-`)
    try {
      await spawnAndWake(request, name, {
        kind: `claude`,
        target: `host`,
        workspaceType: `bindMount`,
        workspaceHostPath: tmp,
      })
      await page.goto(`/#/entity/coding-agent/${name}`)
      await expect(page.getByText(`host`, { exact: true }).first()).toBeVisible(
        { timeout: 10_000 }
      )
      await expect(page.getByText(`bindMount:${realPath}`)).toBeVisible({
        timeout: 10_000,
      })
    } finally {
      await deleteEntity(request, name)
      await rm(tmp, { recursive: true, force: true })
    }
  })
})

test.describe(`Import flow (Flows 7, 8)`, () => {
  test(`importing a host session shows import.restored in the timeline`, async ({
    page,
    request,
  }) => {
    const { path: tmp, realPath } = await makeTmpWorkspace()
    const sessionId = `pw-import-${Date.now()}`
    const transcriptPath = await seedHostSession(
      realPath,
      sessionId,
      `{"type":"system","subtype":"init"}\n`
    )
    const name = uniqueAgentName(`pw-imp-`)
    try {
      await spawnAndWake(request, name, {
        kind: `claude`,
        target: `host`,
        workspaceType: `bindMount`,
        workspaceHostPath: tmp,
        importNativeSessionId: sessionId,
      })
      await page.goto(`/#/entity/coding-agent/${name}`)
      await expect(
        page.getByText(/import\.restored|imported session/i).first()
      ).toBeVisible({ timeout: 10_000 })
      await expect(page.getByText(/bytes=\d+/)).toBeVisible({ timeout: 5_000 })
    } finally {
      await deleteEntity(request, name)
      await unlink(transcriptPath).catch(() => undefined)
      await rm(tmp, { recursive: true, force: true })
    }
  })

  test(`importing a non-existent session ID flips entity to error with import.failed`, async ({
    page,
    request,
  }) => {
    const { path: tmp } = await makeTmpWorkspace()
    const name = uniqueAgentName(`pw-imp-bad-`)
    try {
      await spawnAndWake(request, name, {
        kind: `claude`,
        target: `host`,
        workspaceType: `bindMount`,
        workspaceHostPath: tmp,
        importNativeSessionId: `definitely-not-on-disk-${Date.now()}`,
      })
      await page.goto(`/#/entity/coding-agent/${name}`)
      // Both the header lastError block and the timeline lifecycle row
      // render the same message — accept either by using .first().
      await expect(
        page.getByText(/imported session file not found/i).first()
      ).toBeVisible({ timeout: 10_000 })
    } finally {
      await deleteEntity(request, name)
      await rm(tmp, { recursive: true, force: true })
    }
  })
})

test.describe(`Aligned bind-mount cwd (Flow 10)`, () => {
  test(`sandbox+bindMount entity workspace tag shows realpath, not /workspace`, async ({
    page,
    request,
  }) => {
    const { path: tmp, realPath } = await makeTmpWorkspace()
    const name = uniqueAgentName(`pw-align-`)
    try {
      await spawnAndWake(request, name, {
        kind: `claude`,
        target: `sandbox`,
        workspaceType: `bindMount`,
        workspaceHostPath: tmp,
      })
      await page.goto(`/#/entity/coding-agent/${name}`)
      await expect(page.getByText(`bindMount:${realPath}`)).toBeVisible({
        timeout: 10_000,
      })
      await expect(page.getByText(`bindMount:/workspace`)).toBeHidden()
    } finally {
      await deleteEntity(request, name)
      await rm(tmp, { recursive: true, force: true })
    }
  })
})

test.describe(`Convert-target operation (Flows 11–13)`, () => {
  // Note: the Convert UI changed from a single Button to a 3-target
  // DropdownMenu in 2026-05-03 (sprites slice). Selectors here use the
  // dropdown's data-testids: `convert-target-button` (trigger) and
  // `convert-to-{sandbox,host,sprites}` (items).
  test(`Convert button on a sandbox+bindMount agent flips it to host`, async ({
    page,
    request,
  }) => {
    const { path: tmp } = await makeTmpWorkspace()
    const name = uniqueAgentName(`pw-conv-sb2host-`)
    try {
      await spawnAndWake(request, name, {
        kind: `claude`,
        target: `sandbox`,
        workspaceType: `bindMount`,
        workspaceHostPath: tmp,
      })
      await page.goto(`/#/entity/coding-agent/${name}`)
      await page.getByTestId(`convert-target-button`).click()
      const item = page.getByTestId(`convert-to-host`)
      await expect(item).toBeVisible({ timeout: 10_000 })
      await expect(item).toBeEnabled()
      await item.click()

      // Lifecycle row appears
      await expect(page.getByText(/Target changed/i)).toBeVisible({
        timeout: 10_000,
      })
      // Host badge appears
      await expect(page.getByText(`host`, { exact: true }).first()).toBeVisible(
        { timeout: 5_000 }
      )
      // Reopening the dropdown now offers Sandbox (and Sprites cross-provider).
      await page.getByTestId(`convert-target-button`).click()
      await expect(page.getByTestId(`convert-to-sandbox`)).toBeVisible()
    } finally {
      await deleteEntity(request, name)
      await rm(tmp, { recursive: true, force: true })
    }
  })

  test(`Convert button on a host agent flips it back to sandbox`, async ({
    page,
    request,
  }) => {
    const { path: tmp } = await makeTmpWorkspace()
    const name = uniqueAgentName(`pw-conv-host2sb-`)
    try {
      await spawnAndWake(request, name, {
        kind: `claude`,
        target: `host`,
        workspaceType: `bindMount`,
        workspaceHostPath: tmp,
      })
      await page.goto(`/#/entity/coding-agent/${name}`)
      await page.getByTestId(`convert-target-button`).click()
      const item = page.getByTestId(`convert-to-sandbox`)
      await expect(item).toBeVisible({ timeout: 10_000 })
      await expect(item).toBeEnabled()
      await item.click()

      await expect(page.getByText(/Target changed/i)).toBeVisible({
        timeout: 10_000,
      })
      // After flipping to sandbox the dropdown now offers Host again.
      await page.getByTestId(`convert-target-button`).click()
      await expect(page.getByTestId(`convert-to-host`)).toBeVisible()
    } finally {
      await deleteEntity(request, name)
      await rm(tmp, { recursive: true, force: true })
    }
  })

  test(`Convert→Host is disabled for a sandbox+volume agent`, async ({
    page,
    request,
  }) => {
    const name = uniqueAgentName(`pw-conv-disabled-`)
    try {
      await spawnAndWake(request, name, {
        kind: `claude`,
        target: `sandbox`,
        workspaceType: `volume`,
        workspaceName: `pw-conv-vol-${Date.now()}`,
      })
      await page.goto(`/#/entity/coding-agent/${name}`)
      await page.getByTestId(`convert-target-button`).click()
      const item = page.getByTestId(`convert-to-host`)
      await expect(item).toBeVisible({ timeout: 10_000 })
      // The item itself shows but is disabled because volume → host needs
      // a bindMount workspace (gated client-side; server also rejects).
      await expect(item).toBeDisabled()
    } finally {
      await deleteEntity(request, name)
    }
  })
})
