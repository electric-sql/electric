import { test, expect } from '@playwright/test'
import { rm } from 'node:fs/promises'
import {
  deleteEntity,
  makeTmpWorkspace,
  spawnAndWake,
  uniqueAgentName,
} from './helpers'

test.describe(`Header Fork → kind picker`, () => {
  test(`Fork dropdown on coding-agent shows both kinds`, async ({
    page,
    request,
  }) => {
    const { path: tmp } = await makeTmpWorkspace()
    const name = uniqueAgentName(`pw-fork-menu-list-`)
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
      const forkBtn = page.getByTestId(`fork-button`)
      await expect(forkBtn).toBeVisible({ timeout: 10_000 })
      await forkBtn.click()
      // Both kinds visible; same-kind no longer specially annotated since
      // both directions go through the same fromAgentId-based fork path.
      await expect(
        page.getByRole(`menuitem`, { name: /Fork to claude/i })
      ).toBeVisible()
      await expect(
        page.getByRole(`menuitem`, { name: /Fork to codex/i })
      ).toBeVisible()
    } finally {
      await deleteEntity(request, name)
      await rm(tmp, { recursive: true, force: true })
    }
  })

  test(`Picking same kind fires PUT /coding-agent/<new> with fromAgentId (unified fork path)`, async ({
    page,
    request,
  }) => {
    const { path: tmp } = await makeTmpWorkspace()
    const name = uniqueAgentName(`pw-fork-menu-same-`)
    const sourceUrl = `/coding-agent/${name}`
    let observedPutUrl = ``
    let observedPutBody: any = null
    let forkCalled = false
    try {
      await spawnAndWake(request, name, {
        kind: `claude`,
        target: `sandbox`,
        workspaceType: `bindMount`,
        workspaceHostPath: tmp,
      })
      // Same-kind should NOT call the runtime's POST /fork — it spawns
      // a new top-level coding-agent with fromAgentId so the new claude
      // session inherits the source's denormalized claude transcript.
      await page.route(`**/coding-agent/**`, async (route) => {
        const req = route.request()
        if (req.method() === `POST` && req.url().endsWith(`/fork`)) {
          forkCalled = true
          await route.continue()
          return
        }
        if (
          req.method() === `PUT` &&
          !req.url().endsWith(`/coding-agent/${name}`)
        ) {
          observedPutUrl = req.url()
          observedPutBody = req.postDataJSON()
          await route.fulfill({
            status: 200,
            contentType: `application/json`,
            body: JSON.stringify({
              url: `/coding-agent/forked-same`,
              name: `forked-same`,
              type: `coding-agent`,
              txid: 1,
            }),
          })
          return
        }
        await route.continue()
      })

      await page.goto(`/#/entity/coding-agent/${name}`)
      await expect(page.getByTestId(`entity-header`)).toBeVisible({
        timeout: 10_000,
      })
      await page.getByTestId(`fork-button`).click()
      await page.getByTestId(`fork-to-claude`).click()

      await expect.poll(() => observedPutBody).not.toBeNull()
      expect(observedPutUrl).toMatch(/\/coding-agent\/[^/]+$/)
      expect(observedPutBody).toMatchObject({
        args: {
          kind: `claude`,
          fromAgentId: sourceUrl,
        },
      })
      expect(forkCalled).toBe(false)
    } finally {
      await deleteEntity(request, name)
      await rm(tmp, { recursive: true, force: true })
    }
  })

  test(`Picking other kind fires PUT /coding-agent/<new> with fromAgentId`, async ({
    page,
    request,
  }) => {
    const { path: tmp } = await makeTmpWorkspace()
    const name = uniqueAgentName(`pw-fork-menu-other-`)
    const sourceUrl = `/coding-agent/${name}`
    let observedPutUrl = ``
    let observedPutBody: any = null
    let forkCalled = false
    try {
      await spawnAndWake(request, name, {
        kind: `claude`,
        target: `sandbox`,
        workspaceType: `bindMount`,
        workspaceHostPath: tmp,
      })
      // Single handler: record any POST /fork (should NOT fire when kind
      // differs) and intercept the spawn PUT for the new agent.
      await page.route(`**/coding-agent/**`, async (route) => {
        const req = route.request()
        if (req.method() === `POST` && req.url().endsWith(`/fork`)) {
          forkCalled = true
          await route.continue()
          return
        }
        if (
          req.method() === `PUT` &&
          !req.url().endsWith(`/coding-agent/${name}`)
        ) {
          observedPutUrl = req.url()
          observedPutBody = req.postDataJSON()
          await route.fulfill({
            status: 200,
            contentType: `application/json`,
            body: JSON.stringify({
              url: `/coding-agent/forked-other`,
              name: `forked-other`,
              type: `coding-agent`,
              txid: 1,
            }),
          })
          return
        }
        await route.continue()
      })

      await page.goto(`/#/entity/coding-agent/${name}`)
      await expect(page.getByTestId(`entity-header`)).toBeVisible({
        timeout: 10_000,
      })
      await page.getByTestId(`fork-button`).click()
      await page.getByTestId(`fork-to-codex`).click()

      await expect.poll(() => observedPutBody).not.toBeNull()
      expect(observedPutUrl).toMatch(/\/coding-agent\/[^/]+$/)
      expect(observedPutBody).toMatchObject({
        args: {
          kind: `codex`,
          fromAgentId: sourceUrl,
        },
      })
      // No explicit fromWorkspaceMode → runtime applies default policy.
      expect(observedPutBody?.args?.fromWorkspaceMode).toBeUndefined()
      expect(forkCalled).toBe(false)
    } finally {
      await deleteEntity(request, name)
      await rm(tmp, { recursive: true, force: true })
    }
  })
})
