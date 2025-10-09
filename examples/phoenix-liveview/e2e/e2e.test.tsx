import { expect, test } from "@playwright/test"

const BASE_URL = process.env.BASE_URL

test(`sync todo items between browsers`, async ({ browser }) => {
  expect(BASE_URL).toBeDefined()

  // Launch two separate browser contexts to simulate different browsers
  const context = await browser.newContext()
  const page1 = await context.newPage()
  const page2 = await context.newPage()

  // Open the same webpage in both browsers
  await page1.goto(BASE_URL!)
  await page2.goto(BASE_URL!)

  // Give some time for initial sync
  await page1.waitForTimeout(1000)
  await page2.waitForTimeout(1000)

  // Get initial count of todo items
  const initialItemsPage1 = await page1.$$(`.todo-item`)
  const initialItemsPage2 = await page2.$$(`.todo-item`)
  const initialCount = initialItemsPage1.length
  expect(initialItemsPage2.length).toBe(initialCount)

  // Add a new todo item in first browser with timestamp
  const timestamp1 = Date.now()
  const todoItem1 = `New todo item ${timestamp1}`
  await page1.fill(`#todo_text`, todoItem1)
  await page1.press(`#todo_text`, `Enter`)

  // Give some time for the new entry to be synced
  await page1.waitForTimeout(1000)
  await page2.waitForTimeout(1000)

  // Verify both browsers have one more entry
  const page1Items = await page1.$$(`.todo-item`)
  const page2Items = await page2.$$(`.todo-item`)
  expect(page1Items.length).toBe(initialCount + 1)
  expect(page2Items.length).toBe(initialCount + 1)

  // Get all todo items text content
  const page1Texts = await Promise.all(
    page1Items.map((item) => item.textContent())
  )
  const page2Texts = await Promise.all(
    page2Items.map((item) => item.textContent())
  )

  // Verify the new todo item appears in both browsers
  expect(page1Texts.some((text) => text?.includes(timestamp1.toString()))).toBe(
    true
  )
  expect(page2Texts.some((text) => text?.includes(timestamp1.toString()))).toBe(
    true
  )

  // Add another todo item in second browser with timestamp
  const timestamp2 = Date.now()
  const todoItem2 = `Another todo item ${timestamp2}`
  await page2.fill(`#todo_text`, todoItem2)
  await page2.press(`#todo_text`, `Enter`)

  // Wait for synchronization
  await page1.waitForTimeout(1000)
  await page2.waitForTimeout(1000)

  // Verify both browsers have two more entries
  const finalPage1Items = await page1.$$(`.todo-item`)
  const finalPage2Items = await page2.$$(`.todo-item`)
  expect(finalPage1Items.length).toBe(initialCount + 2)
  expect(finalPage2Items.length).toBe(initialCount + 2)

  // Get all todo items text content
  const allItemsPage1 = await Promise.all(
    finalPage1Items.map((item) => item.textContent())
  )
  const allItemsPage2 = await Promise.all(
    finalPage2Items.map((item) => item.textContent())
  )

  // Verify both timestamps are present in both browsers
  expect(
    allItemsPage1.some((text) => text?.includes(timestamp1.toString()))
  ).toBe(true)
  expect(
    allItemsPage1.some((text) => text?.includes(timestamp2.toString()))
  ).toBe(true)
  expect(
    allItemsPage2.some((text) => text?.includes(timestamp1.toString()))
  ).toBe(true)
  expect(
    allItemsPage2.some((text) => text?.includes(timestamp2.toString()))
  ).toBe(true)
})
