import { expect, test } from "@playwright/test"

const BASE_URL = process.env.BASE_URL

test(`sync input between tabs`, async ({ browser }) => {
  expect(BASE_URL).toBeDefined()

  // Launch a new browser context with two tabs
  const context = await browser.newContext()
  const page1 = await context.newPage()
  const page2 = await context.newPage()

  // Open the same webpage in both tabs
  await page1.goto(BASE_URL!)
  await page2.goto(BASE_URL!)

  // Locate the input field
  const inputSelector = `div[role="textbox"]`

  // Type text into the first tab
  const textInput = `Hello from ${Math.random().toString(36).slice(2)}!`
  await page1.fill(inputSelector, `${textInput}\n`)

  // Wait for synchronization
  await page2.waitForTimeout(1000)

  // Assert that the second tab receives the same text
  const text = await page2.textContent(inputSelector)
  expect(text).toContain(textInput)
})
