import { describe, it, expect } from 'vitest'
import type { ElectricCredentials } from '../src/electric-api.js'

// Simple test for basic functionality
describe(`template-setup (unit)`, () => {
  const mockCredentials: ElectricCredentials = {
    source_id: `test-source-id`,
    secret: `test-secret`,
    DATABASE_URL: `postgresql://test:test@localhost:5432/test`,
  }

  it(`should export setupTemplate function`, async () => {
    const { setupTemplate } = await import(`../src/template-setup.js`)
    expect(typeof setupTemplate).toBe(`function`)
  })

  it(`should validate credentials structure`, () => {
    expect(mockCredentials).toHaveProperty(`source_id`)
    expect(mockCredentials).toHaveProperty(`secret`)
    expect(mockCredentials).toHaveProperty(`DATABASE_URL`)
    expect(mockCredentials.source_id).toBe(`test-source-id`)
    expect(mockCredentials.secret).toBe(`test-secret`)
    expect(mockCredentials.DATABASE_URL).toContain(`postgresql://`)
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
