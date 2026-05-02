import { test, expect } from '@playwright/test'
import { rm } from 'node:fs/promises'
import {
  deleteEntity,
  makeTmpWorkspace,
  openSpawnDialog,
  spawnAndWake,
  uniqueAgentName,
} from './helpers'

test.describe(`Spawn sprites target`, () => {
  test(`spawn dialog target=sprites disables bind-mount and submits with target=sprites + workspaceType=volume`, async ({
    page,
  }) => {
    let observedBody: any = null

    // Intercept the PUT so the test does not depend on a real sprite
    // boot. We only verify the dialog routes target=sprites + workspace
    // gating through to the PUT body.
    await page.route(`**/coding-agent/**`, async (route) => {
      const req = route.request()
      if (req.method() === `PUT`) {
        observedBody = req.postDataJSON()
        await route.fulfill({
          status: 200,
          contentType: `application/json`,
          body: JSON.stringify({
            url: `/coding-agent/intercepted-sprites`,
            name: `intercepted-sprites`,
            type: `coding-agent`,
          }),
        })
        return
      }
      await route.continue()
    })

    await openSpawnDialog(page)

    // Pick sprites target.
    await page.getByTestId(`target-sprites`).click()

    // Bind-mount option must be disabled.
    await expect(page.getByTestId(`workspace-bindmount`)).toBeDisabled()

    // Submit. (Default kind=claude, default workspace=volume after sprites.)
    await page.getByRole(`button`, { name: `Spawn`, exact: true }).click()

    await expect.poll(() => observedBody).not.toBeNull()
    expect(observedBody).toMatchObject({
      args: {
        kind: `claude`,
        target: `sprites`,
        workspaceType: `volume`,
      },
    })
    expect(observedBody.args).not.toHaveProperty(`workspaceHostPath`)
  })

  test(`Convert/Fork dropdowns on a sandbox agent show sprites disabled with tooltip`, async ({
    page,
    request,
  }) => {
    const { path: tmp } = await makeTmpWorkspace()
    const name = uniqueAgentName(`pw-sprites-gate-`)
    try {
      await spawnAndWake(request, name, {
        kind: `claude`,
        target: `sandbox`,
        workspaceType: `bindMount`,
        workspaceHostPath: tmp,
      })
      await page.goto(`/#/entity/coding-agent/${name}`)
      await expect(page.getByTestId(`entity-header`)).toBeVisible({
        timeout: 10_000,
      })

      // Convert-target dropdown — sprites is present, disabled, with the
      // cross-provider tooltip.
      await page.getByTestId(`convert-target-button`).click()
      const convertSprites = page.getByTestId(`convert-to-sprites`)
      await expect(convertSprites).toBeVisible()
      await expect(convertSprites).toBeDisabled()
      await expect(convertSprites).toHaveAttribute(
        `title`,
        /Cross-provider conversion is not supported/
      )
      await page.keyboard.press(`Escape`)

      // Fork dropdown — disabled cross-provider item visible with tooltip.
      await page.getByTestId(`fork-button`).click()
      const forkSprites = page.getByTestId(`fork-cross-provider-disabled`)
      await expect(forkSprites).toBeVisible()
      await expect(forkSprites).toBeDisabled()
      await expect(forkSprites).toHaveAttribute(
        `title`,
        /Cross-provider fork not supported/
      )
    } finally {
      await deleteEntity(request, name)
      await rm(tmp, { recursive: true, force: true })
    }
  })
})
