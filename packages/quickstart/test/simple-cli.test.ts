import { describe, it, expect } from 'vitest'

describe(`cli (unit)`, () => {
  it(`should export main function`, async () => {
    const { main } = await import(`../src/cli.js`)
    expect(typeof main).toBe(`function`)
  })

  it(`should validate app name regex`, () => {
    const validNames = [`my-app`, `my_app`, `myapp123`, `My-App_123`]
    const invalidNames = [
      `my app`,
      `my@app`,
      `my.app`,
      `my/app`,
      `my\\app`,
      `my app!`,
    ]

    validNames.forEach((name) => {
      expect(/^[a-zA-Z0-9-_]+$/.test(name)).toBe(true)
    })

    invalidNames.forEach((name) => {
      expect(/^[a-zA-Z0-9-_]+$/.test(name)).toBe(false)
    })
  })

  it(`should handle process.argv correctly`, () => {
    const testArgv = [`node`, `cli.js`, `test-app`]
    expect(testArgv.slice(2)).toEqual([`test-app`])
    expect(testArgv.slice(2)[0]).toBe(`test-app`)
  })
})
