import { expect, test } from "@playwright/test"

const BASE_URL = process.env.BASE_URL

test("sync items between tabs", async ({ browser }) => {
  expect(BASE_URL).toBeDefined()

  // Launch a new browser context with two tabs
  const context = await browser.newContext()
  const page1 = await context.newPage()
  const page2 = await context.newPage()

  // Open the same webpage in both tabs
  await page1.goto(BASE_URL!)
  await page2.goto(BASE_URL!)

  // Give some time for initial sync
  await page1.waitForTimeout(1000)
  await page2.waitForTimeout(1000)

  // Get initial count of items
  const initialItemsPage1 = await page1.$$(".item")
  const initialItemsPage2 = await page2.$$(".item")
  const initialCount = initialItemsPage1.length
  expect(initialItemsPage2.length).toBe(initialCount)

  // Click Add button in first tab
  await page1.click("button[value=\"add\"]")

  // Give some time for the new entry to be synced
  await page1.waitForTimeout(1000)
  await page2.waitForTimeout(1000)

  // Verify both tabs have one more entry
  const page1Items = await page1.$$(".item")
  const page2Items = await page2.$$(".item")
  expect(page1Items.length).toBe(initialCount + 1)
  expect(page2Items.length).toBe(initialCount + 1)

  // Get the UUID of the new entry from both tabs
  const newItemPage1 = await page1Items[initialCount].textContent()
  const newItemPage2 = await page2Items[initialCount].textContent()
  expect(newItemPage1).toBe(newItemPage2)

  // Click Clear button in first tab
  await page1.click("button[value=\"clear\"]")

  // Wait for items to be cleared in first tab
  await page1.waitForSelector(".item", { state: "hidden" })

  // Wait for synchronization and check second tab
  await page2.waitForSelector(".item", { state: "hidden" })

  // Verify both tabs have no entries
  const page1ItemsAfterClear = await page1.$$(".item")
  const page2ItemsAfterClear = await page2.$$(".item")
  expect(page1ItemsAfterClear.length).toBe(0)
  expect(page2ItemsAfterClear.length).toBe(0)

  // Add another entry
  await page1.click("button[value=\"add\"]")

  // Wait for the new entry to appear in first tab
  await page1.waitForSelector(".item")

  // Wait for synchronization and check second tab
  await page2.waitForSelector(".item")

  // Verify both tabs have one entry again
  const page1ItemsFinal = await page1.$$(".item")
  const page2ItemsFinal = await page2.$$(".item")
  expect(page1ItemsFinal.length).toBe(1)
  expect(page2ItemsFinal.length).toBe(1)

  // Verify the UUIDs match for the final entry
  const finalItemPage1 = await page1ItemsFinal[0].textContent()
  const finalItemPage2 = await page2ItemsFinal[0].textContent()
  expect(finalItemPage1).toBe(finalItemPage2)
})
