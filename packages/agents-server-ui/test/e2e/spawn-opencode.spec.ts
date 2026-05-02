import { test, expect } from '@playwright/test'
import { rm } from 'node:fs/promises'
import {
  deleteEntity,
  makeTmpWorkspace,
  openSpawnDialog,
  spawnAndWake,
  uniqueAgentName,
} from './helpers'

test.describe(`Spawn opencode kind`, () => {
  test(`spawn dialog kind=opencode reveals model selector and submits with model`, async ({
    page,
  }) => {
    let observedBody: any = null
    let observedUrl = ``

    // Intercept the PUT for the new opencode agent so the test does not
    // depend on docker / opencode-cli actually starting. We only need to
    // verify the dialog routes the kind+model selection through to the
    // PUT body.
    await page.route(`**/coding-agent/**`, async (route) => {
      const req = route.request()
      if (req.method() === `PUT`) {
        observedUrl = req.url()
        observedBody = req.postDataJSON()
        await route.fulfill({
          status: 200,
          contentType: `application/json`,
          body: JSON.stringify({
            url: `/coding-agent/intercepted-opencode`,
            name: `intercepted-opencode`,
            type: `coding-agent`,
          }),
        })
        return
      }
      await route.continue()
    })

    await openSpawnDialog(page)

    // Model selector hidden until kind=opencode.
    await expect(page.getByTestId(`opencode-model-select`)).toBeHidden()

    // Pick opencode kind.
    await page.getByTestId(`kind-opencode`).click()

    // Model selector should appear, with the openai default selected.
    const modelSelect = page.getByTestId(`opencode-model-select`)
    await expect(modelSelect).toBeVisible({ timeout: 5_000 })
    await expect(modelSelect).toHaveValue(`openai/gpt-5.4-mini-fast`)

    // Switch to a non-default model to confirm the value flows through.
    await modelSelect.selectOption(`anthropic/claude-haiku-4-5`)

    // Submit. (Default workspace = volume, no host path required.)
    await page.getByRole(`button`, { name: `Spawn`, exact: true }).click()

    await expect.poll(() => observedBody).not.toBeNull()
    expect(observedUrl).toMatch(/\/coding-agent\/[^/]+$/)
    expect(observedBody).toMatchObject({
      args: {
        kind: `opencode`,
        model: `anthropic/claude-haiku-4-5`,
      },
    })
  })

  test(`opencode agent appears in sidebar with data-kind="opencode"`, async ({
    page,
    request,
  }) => {
    const { path: tmp } = await makeTmpWorkspace()
    const name = uniqueAgentName(`pw-opencode-side-`)
    try {
      // Spawn via API so the test does not depend on the spawn dialog
      // running a real docker turn. Bind-mount workspace avoids volume
      // creation overhead.
      await spawnAndWake(request, name, {
        kind: `opencode`,
        target: `sandbox`,
        workspaceType: `bindMount`,
        workspaceHostPath: tmp,
        model: `openai/gpt-5.4-mini-fast`,
      })
      await page.goto(`/`)
      await expect(
        page
          .getByTestId(`sidebar`)
          .locator(
            `[data-kind="opencode"][data-entity-url="/coding-agent/${name}"]`
          )
      ).toBeVisible({ timeout: 10_000 })
    } finally {
      await deleteEntity(request, name)
      await rm(tmp, { recursive: true, force: true })
    }
  })

  test(`Convert/Fork dropdowns on a claude agent show opencode disabled with tooltip`, async ({
    page,
    request,
  }) => {
    const { path: tmp } = await makeTmpWorkspace()
    const name = uniqueAgentName(`pw-opencode-gate-`)
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

      // Convert kind dropdown — opencode item is present, disabled, and
      // the tooltip text is the deferral notice.
      await page.getByTestId(`convert-kind-button`).click()
      const convertOpen = page.getByTestId(`convert-to-opencode`)
      await expect(convertOpen).toBeVisible()
      await expect(convertOpen).toBeDisabled()
      await expect(convertOpen).toHaveAttribute(
        `title`,
        /Cross-kind support for opencode is deferred/
      )
      // Close the menu.
      await page.keyboard.press(`Escape`)

      // Fork dropdown — same gating.
      await page.getByTestId(`fork-button`).click()
      const forkOpen = page.getByTestId(`fork-to-opencode`)
      await expect(forkOpen).toBeVisible()
      await expect(forkOpen).toBeDisabled()
      await expect(forkOpen).toHaveAttribute(
        `title`,
        /Cross-kind support for opencode is deferred/
      )
    } finally {
      await deleteEntity(request, name)
      await rm(tmp, { recursive: true, force: true })
    }
  })
})
