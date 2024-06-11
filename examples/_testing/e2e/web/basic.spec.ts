import { test, expect } from '@playwright/test'

const PAGE_LOAD_TIME_MS = 2000
const INTERACITON_TIME_MS = 300

test.describe('basic example', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('has title and buttons', async ({ page }) => {
    await expect(page).toHaveTitle(/Web Example/)
    await expect(page.getByRole('button', { name: 'Add' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Clear' })).toBeVisible()

    // clear items for good measure
    await page.getByRole('button', { name: 'Clear' }).click()
  })

  test('can add items', async ({ page }) => {
    const addButton = page.getByRole('button', { name: 'Add' })
    const items = page.getByRole('code')

    // no items initially
    await expect(await items.count()).toBe(0)

    // possible to add an item
    await addButton.click()
    await page.waitForTimeout(INTERACITON_TIME_MS)
    await expect(await items.count()).toBe(1)

    // item should contain UUID (not be empty)
    await expect(items.first()).toContainText(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )

    // possible to add more
    await addButton.click()
    await page.waitForTimeout(INTERACITON_TIME_MS)
    await addButton.click()
    await page.waitForTimeout(INTERACITON_TIME_MS)
    await expect(await items.count()).toBe(3)

    // added items persist reload
    await page.reload()
    await page.waitForTimeout(PAGE_LOAD_TIME_MS)
    await expect(page.getByRole('button', { name: 'Clear' })).toBeVisible()
    await expect(await items.count()).toBe(3)
  })

  test('can clear items', async ({ page }) => {
    const clearButton = page.getByRole('button', { name: 'Clear' })
    const items = page.getByRole('code')

    // should have some items
    await page.waitForSelector('code')
    await expect(await items.count()).toBeGreaterThan(0)

    // should be able to clear them
    await clearButton.click()
    await page.waitForTimeout(INTERACITON_TIME_MS)
    await expect(await items.count()).toBe(0)

    // cleared items persist reload
    await page.reload()
    await page.waitForTimeout(INTERACITON_TIME_MS)
    await expect(await items.count()).toBe(0)
  })
})
