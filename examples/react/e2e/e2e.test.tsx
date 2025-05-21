import { expect, test } from "@playwright/test"

const BASE_URL = process.env.BASE_URL

test(`check Electric logo is displayed`, async ({ page }) => {
  expect(BASE_URL).toBeDefined()

  // Navigate to the page
  await page.goto(BASE_URL!)

  // Wait for the logo to be visible
  const logo = await page.waitForSelector(`img[alt="logo"]`)
  expect(logo).toBeTruthy()

  // Check that the logo is visible
  const isVisible = await logo.isVisible()
  expect(isVisible).toBe(true)
})

test(`check initial shape request succeeds`, async ({ page }) => {
  expect(BASE_URL).toBeDefined()

  // Array to store console errors
  const consoleErrors: string[] = []

  // Listen for console errors
  page.on(`console`, (msg) => {
    if (msg.type() === `error`) {
      consoleErrors.push(msg.text())
    }
  })

  // Listen for the initial shape request
  const shapeRequestPromise = page.waitForRequest(
    (request) =>
      request.url().includes(`/v1/shape`) && request.url().includes(`offset=-1`)
  )

  const liveRequest = page.waitForRequest(
    (request) =>
      request.url().includes(`/v1/shape`) && request.url().includes(`live=true`)
  )

  // Navigate to the page
  await page.goto(BASE_URL!)

  // Wait for the initial shape request
  const shapeRequest = await shapeRequestPromise

  // Verify the request was successful
  const response = await shapeRequest.response()
  expect(response?.status()).toBe(200)

  // Eventually we will have finished the initial sync and make a live request
  await liveRequest

  // Check that no errors were logged
  expect(consoleErrors).toHaveLength(0)
})
