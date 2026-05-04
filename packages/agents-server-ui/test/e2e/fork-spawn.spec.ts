import { test, expect } from '@playwright/test'
import { rm } from 'node:fs/promises'
import {
  deleteEntity,
  makeTmpWorkspace,
  openSpawnDialog,
  spawnAndWake,
  uniqueAgentName,
} from './helpers'

test.describe(`Fork via spawn dialog`, () => {
  test(`Fork toggle reveals source picker; submit blocks until source is picked`, async ({
    page,
  }) => {
    await openSpawnDialog(page)
    // Source-agent select is hidden until the toggle is checked.
    await expect(page.getByTestId(`fork-source-select`)).toBeHidden()

    await page.getByTestId(`fork-toggle`).check()
    await expect(page.getByTestId(`fork-source-select`)).toBeVisible()
    // Submit is blocked because no source is picked.
    await expect(
      page.getByRole(`button`, { name: `Spawn`, exact: true })
    ).toBeDisabled()

    // Untoggling clears the requirement.
    await page.getByTestId(`fork-toggle`).uncheck()
    await expect(page.getByTestId(`fork-source-select`)).toBeHidden()
  })

  test(`Forking from an existing agent fires fromAgentId in the PUT body`, async ({
    page,
    request,
  }) => {
    const { path: tmp } = await makeTmpWorkspace()
    const sourceName = uniqueAgentName(`pw-fork-src-`)
    const sourceUrl = `/coding-agent/${sourceName}`
    let observedBody: any = null
    let observedUrl = ``
    try {
      await spawnAndWake(request, sourceName, {
        kind: `claude`,
        target: `sandbox`,
        workspaceType: `bindMount`,
        workspaceHostPath: tmp,
      })
      // Intercept the PUT for the new fork agent.
      await page.route(`**/coding-agent/**`, async (route) => {
        const req = route.request()
        if (
          req.method() === `PUT` &&
          !req.url().endsWith(`/coding-agent/${sourceName}`)
        ) {
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
      await page.getByTestId(`fork-toggle`).check()
      await page
        .getByTestId(`fork-source-select`)
        .selectOption({ value: sourceUrl })
      await page.getByTestId(`fork-workspace-mode-select`).selectOption(`share`)
      await page.getByRole(`button`, { name: `Spawn`, exact: true }).click()

      await expect.poll(() => observedBody).not.toBeNull()
      expect(observedUrl).toMatch(/\/coding-agent\/[^/]+$/)
      expect(observedBody).toMatchObject({
        args: {
          kind: `claude`,
          fromAgentId: sourceUrl,
          fromWorkspaceMode: `share`,
        },
      })
    } finally {
      await deleteEntity(request, sourceName)
      await rm(tmp, { recursive: true, force: true })
    }
  })

  test(`Fork lands on entity view with kind.forked lifecycle row`, async ({
    page,
    request,
  }) => {
    const { path: srcTmp } = await makeTmpWorkspace()
    const { path: forkTmp } = await makeTmpWorkspace()
    const sourceName = uniqueAgentName(`pw-fork-live-src-`)
    const forkName = uniqueAgentName(`pw-fork-live-`)
    try {
      await spawnAndWake(request, sourceName, {
        kind: `claude`,
        target: `sandbox`,
        workspaceType: `bindMount`,
        workspaceHostPath: srcTmp,
      })
      // Spawn the fork directly via the API, then verify the timeline row.
      await spawnAndWake(request, forkName, {
        kind: `codex`,
        target: `sandbox`,
        workspaceType: `bindMount`,
        workspaceHostPath: forkTmp,
        fromAgentId: `/coding-agent/${sourceName}`,
        fromWorkspaceMode: `share`,
      })
      await page.goto(`/#/entity/coding-agent/${forkName}`)
      await expect(page.getByTestId(`entity-header`)).toBeVisible({
        timeout: 10_000,
      })
      await expect(page.locator(`[data-event="kind.forked"]`)).toBeVisible({
        timeout: 10_000,
      })

      // Sidebar should expose data-kind on the new coding-agent entry.
      await expect(
        page
          .getByTestId(`sidebar`)
          .locator(
            `[data-kind="codex"][data-entity-url="/coding-agent/${forkName}"]`
          )
      ).toBeVisible({ timeout: 10_000 })
    } finally {
      await deleteEntity(request, sourceName)
      await deleteEntity(request, forkName)
      await rm(srcTmp, { recursive: true, force: true })
      await rm(forkTmp, { recursive: true, force: true })
    }
  })
})
