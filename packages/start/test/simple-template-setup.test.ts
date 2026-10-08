import { describe, it, expect } from 'vitest'

// Simple test for basic functionality
describe(`template-setup (unit)`, () => {
  it(`should export setupTemplate function`, async () => {
    const { setupTemplate } = await import(`../src/template-setup.js`)
    expect(typeof setupTemplate).toBe(`function`)
  })

  it(`should point at the local Docker services from the starter's docker-compose.yaml`, async () => {
    const { LOCAL_DATABASE_URL, LOCAL_ELECTRIC_URL } = await import(
      `../src/template-setup.js`
    )
    expect(LOCAL_DATABASE_URL).toBe(
      `postgresql://postgres:password@localhost:54321/electric`
    )
    expect(LOCAL_ELECTRIC_URL).toBe(`http://localhost:30000`)
  })

  it(`should validate app name format`, () => {
    const validNames = [`my-app`, `my_app`, `myapp123`, `My-App_123`]
    const invalidNames = [`my app`, `my@app`, `my.app`, `my/app`]

    validNames.forEach((name) => {
      expect(/^[a-zA-Z0-9-_]+$/.test(name)).toBe(true)
    })

    invalidNames.forEach((name) => {
      expect(/^[a-zA-Z0-9-_]+$/.test(name)).toBe(false)
    })
  })
})
