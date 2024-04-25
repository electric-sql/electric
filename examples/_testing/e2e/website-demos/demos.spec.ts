import { test, expect } from '@playwright/test'
import type { Page, Locator } from '@playwright/test'

const INITIAL_SYNC_TIME_MS = 4000
const EXPECTED_SQLITE_TIME_MS = 1000
const EXPECTED_SYNC_TIME_MS = 3000
const CONNECTIVITY_TIME_MS = 200

function expectSqlite(cb: () => number | Promise<number>) {
  return expect.poll(cb, { timeout: EXPECTED_SQLITE_TIME_MS })
}

function expectSync(cb: () => number | Promise<number>) {
  return expect.poll(cb, { timeout: EXPECTED_SYNC_TIME_MS })
}

async function prepareDemo(page: Page, demo: Locator) {
  await expect(demo).toBeAttached({ timeout: 3000 })
  // wait for initial sync to occur
  await page.waitForTimeout(INITIAL_SYNC_TIME_MS)
  await demo.scrollIntoViewIfNeeded()
}

test.describe('website demos', () => {
  test.beforeEach(async ({ page }) => {
    page.goto('/')
  })

  test('local-first instant demo', async ({ page }) => {
    const demo = page.getByTestId('local-first-instant-demo')
    await prepareDemo(page, demo)

    const demoLocal = demo.getByTestId('local-first')
    const localItems = demoLocal.getByTestId('item')
    const localLatencyTxt = demoLocal.getByText('Latency')
    const localAddBtn = demoLocal.getByText('Add')
    const localClearBtn = demoLocal.getByText('Clear')

    // check local operations work
    const initLocalItems = await localItems.count()
    await localAddBtn.click()
    await expectSqlite(() => localItems.count()).toBe(initLocalItems + 1)

    // keep track of latency
    const localLatencyText = await localLatencyTxt.textContent()
    await expect(localLatencyText).toMatch(/Latency: \d+ms/)
    const localLatency = Number(localLatencyText?.match(/\d+/)![0])

    await localClearBtn.click()
    await expectSqlite(() => localItems.count()).toBe(0)

    // should have a latency smaller than 150ms
    await expect(localLatency).toBeLessThan(150)
  })

  test('multi-user realtime demo', async ({ page }) => {
    const demo = page.getByTestId('multiuser-realtime-demo')
    await prepareDemo(page, demo)

    const user1Items = demo.getByTestId('user1').getByTestId('item')
    const user1AddBtn = demo.getByTestId('user1').getByText('Add')
    const user1ClearBtn = demo.getByTestId('user1').getByText('Clear')

    const user2Items = demo.getByTestId('user2').getByTestId('item')
    const user2AddBtn = demo.getByTestId('user2').getByText('Add')

    // user 1 and 2 should match in number of items
    const initNumItems = await user1Items.count()
    await expect(await user2Items.count()).toBe(initNumItems)

    // user 1 adds an item, should see response _almost_ immediately
    // and should eventually sync to user 2
    await user1AddBtn.click()
    await expectSqlite(() => user1Items.count()).toBe(initNumItems + 1)
    await expectSync(() => user2Items.count()).toBe(initNumItems + 1)

    // should work in reverse as well
    await user2AddBtn.click()
    await expectSqlite(() => user2Items.count()).toBe(initNumItems + 2)
    await expectSync(() => user1Items.count()).toBe(initNumItems + 2)

    // clearing should also sync across users
    await user1ClearBtn.click()
    await expectSqlite(() => user1Items.count()).toBe(0)
    await expectSync(() => user1Items.count()).toBe(0)
  })

  test('offline connectivity demo', async ({ page }) => {
    const demo = page.getByTestId('offline-connectivity-demo')
    await prepareDemo(page, demo)

    const user1Items = demo.getByTestId('user1').getByTestId('item')
    const user1ConnectivityToggle = demo
      .getByTestId('user1')
      .getByTestId('connectivity-toggle')
    const user1AddBtn = demo.getByTestId('user1').getByText('Add')

    const user2Items = demo.getByTestId('user2').getByTestId('item')
    const user2ConnectivityToggle = demo
      .getByTestId('user2')
      .getByTestId('connectivity-toggle')
    const user2ClearBtn = demo.getByTestId('user2').getByText('Clear')

    // user 1 and 2 should match in number of items
    const initNumItems = await user1Items.count()
    await expect(await user2Items.count()).toBe(initNumItems)

    // go offline for user 1
    await user1ConnectivityToggle.click()
    await expect(
      demo.getByTestId('user1').getByText('Disconnected')
    ).toBeVisible()
    await page.waitForTimeout(CONNECTIVITY_TIME_MS)

    // user 1 adds items, should see changes _almost_ immediately
    // but user 2 should not see them as user 1 is offline
    await user1AddBtn.click()
    await expectSqlite(() => user1Items.count()).toBe(initNumItems + 1)
    await user1AddBtn.click()
    await expectSqlite(() => user1Items.count()).toBe(initNumItems + 2)
    await page.waitForTimeout(EXPECTED_SYNC_TIME_MS)
    await expect(await user2Items.count()).toBe(initNumItems)

    // go online for user 1
    await user1ConnectivityToggle.click()
    await expect(demo.getByTestId('user1').getByText('Connected')).toBeVisible()

    // should eventually see change reflected on user 2
    await expectSync(async () => await user2Items.count()).toBe(
      initNumItems + 2
    )

    await user2ConnectivityToggle.click()
    await expect(
      demo.getByTestId('user2').getByText('Disconnected')
    ).toBeVisible()
    await page.waitForTimeout(CONNECTIVITY_TIME_MS)
    await user2ClearBtn.click()

    // should work in reverse as well - clear offline user 2
    await user2ClearBtn.click()
    await expectSqlite(() => user2Items.count()).toBe(0)
    await page.waitForTimeout(EXPECTED_SYNC_TIME_MS)
    await expect(await user1Items.count()).toBe(initNumItems + 2)

    // connect user 2 back again
    await user2ConnectivityToggle.click()
    await expect(demo.getByTestId('user2').getByText('Connected')).toBeVisible()

    // user 1 items should eventually be cleared
    await expectSync(() => user1Items.count()).toBe(0)
  })

  test('offline integrity demo', async ({ page }) => {
    const demo = page.getByTestId('offline-integrity-demo')
    await prepareDemo(page, demo)

    const user1Player = demo.getByTestId('user1').getByTestId('player').first()
    const user1Tournaments = demo.getByTestId('user1').getByTestId('tournament')
    const user1ConnectivityToggle = demo
      .getByTestId('user1')
      .getByTestId('connectivity-toggle')

    const user2Tournaments = demo.getByTestId('user2').getByTestId('tournament')
    const user2ConnectivityToggle = demo
      .getByTestId('user2')
      .getByTestId('connectivity-toggle')

    // go offline for both users
    await user1ConnectivityToggle.click()
    await expect(
      demo.getByTestId('user1').getByText('Disconnected')
    ).toBeVisible()
    await user2ConnectivityToggle.click()
    await expect(
      demo.getByTestId('user2').getByText('Disconnected')
    ).toBeVisible()
    await page.waitForTimeout(CONNECTIVITY_TIME_MS)

    // drag a player into the tournement for user 1
    await user1Player.dragTo(await user1Tournaments.first())

    // delete all tournamnets for user 2
    const numTournaments = await user2Tournaments.count()
    for (let i = 0; i < numTournaments; i++) {
      await user2Tournaments.first().locator('svg').click()
      await page.waitForTimeout(EXPECTED_SQLITE_TIME_MS)
    }

    await expect(await user2Tournaments.count()).toBe(0)

    // go online for both users
    await user1ConnectivityToggle.click()
    await expect(demo.getByTestId('user1').getByText('Connected')).toBeVisible()
    await user2ConnectivityToggle.click()
    await expect(demo.getByTestId('user2').getByText('Connected')).toBeVisible()

    // both users should have 1 tournament
    await expectSync(() => user1Tournaments.count()).toBe(1)
    await expectSync(() => user2Tournaments.count()).toBe(1)
  })
})
