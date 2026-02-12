/**
 * Example vitest integration test using testcontainers with Electric.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Client } from "pg"
import {
  startElectricTestContainers,
  type ElectricTestContext,
} from "./electric-testcontainers.js"

describe("Electric with testcontainers", () => {
  let ctx: ElectricTestContext

  beforeAll(async () => {
    ctx = await startElectricTestContainers()
  }, 60_000) // containers can take a while to pull + start

  afterAll(async () => {
    await ctx?.stop()
  })

  it("Electric is healthy", async () => {
    const res = await fetch(`${ctx.electricUrl}/v1/health`)
    const body = await res.json()
    expect(body.status).toBe("active")
  })

  it("can create a table and read a shape", async () => {
    const client = new Client({ connectionString: ctx.databaseUrl })
    await client.connect()

    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS test_items (
          id SERIAL PRIMARY KEY,
          value TEXT NOT NULL
        )
      `)
      await client.query(
        `INSERT INTO test_items (value) VALUES ($1)`,
        ["hello from testcontainers"]
      )

      // Request a shape from Electric
      const res = await fetch(
        `${ctx.electricUrl}/v1/shape?table=test_items&offset=-1`
      )
      expect(res.status).toBe(200)
    } finally {
      await client.end()
    }
  })
})
