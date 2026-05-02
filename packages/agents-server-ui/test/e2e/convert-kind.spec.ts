import { test, expect } from '@playwright/test'
import { rm } from 'node:fs/promises'
import {
  deleteEntity,
  makeTmpWorkspace,
  spawnAndWake,
  uniqueAgentName,
} from './helpers'

test.describe(`Convert kind via header dropdown`, () => {
  test(`Convert kind dropdown lists the other kind only`, async ({
    page,
    request,
  }) => {
    const { path: tmp } = await makeTmpWorkspace()
    const name = uniqueAgentName(`pw-convk-list-`)
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
      const convertKindBtn = page.getByTestId(`convert-kind-button`)
      await expect(convertKindBtn).toBeVisible({ timeout: 10_000 })
      await convertKindBtn.click()
      await expect(
        page.getByRole(`menuitem`, { name: /Convert to codex/i })
      ).toBeVisible()
      await expect(
        page.getByRole(`menuitem`, { name: /Convert to claude/i })
      ).toHaveCount(0)
    } finally {
      await deleteEntity(request, name)
      await rm(tmp, { recursive: true, force: true })
    }
  })

  test(`claude → codex round-trip and timeline shows kind.converted`, async ({
    page,
    request,
  }) => {
    const { path: tmp } = await makeTmpWorkspace()
    const name = uniqueAgentName(`pw-convk-`)
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
      await page.getByTestId(`convert-kind-button`).click()
      await page.getByRole(`menuitem`, { name: /Convert to codex/i }).click()

      // Lifecycle row appears via data-event attribute.
      await expect(page.locator(`[data-event="kind.converted"]`)).toBeVisible({
        timeout: 10_000,
      })

      // After conversion, the dropdown should list the reverse direction.
      await page.getByTestId(`convert-kind-button`).click()
      await expect(
        page.getByRole(`menuitem`, { name: /Convert to claude/i })
      ).toBeVisible()
    } finally {
      await deleteEntity(request, name)
      await rm(tmp, { recursive: true, force: true })
    }
  })
})
