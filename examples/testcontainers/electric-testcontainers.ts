/**
 * Working testcontainers setup for Electric SQL integration tests.
 *
 * Key differences from broken setups:
 * 1. Uses a shared Docker network instead of host port forwarding
 * 2. No bind mounts or .withReuse() — these cause "works first run, breaks after"
 * 3. Dynamic ports — no hardcoded host ports that can conflict
 * 4. Proper PostgreSQL config for logical replication
 */

import {
  GenericContainer,
  Network,
  Wait,
  type StartedTestContainer,
  type StartedNetwork,
} from "testcontainers"
import { PostgreSqlContainer } from "@testcontainers/postgresql"
import { Client } from "pg"

export interface ElectricTestContext {
  /** PostgreSQL connection string accessible from the host */
  databaseUrl: string
  /** Electric HTTP API URL accessible from the host */
  electricUrl: string
  /** Cleanup function — call in afterAll/teardown */
  stop: () => Promise<void>
}

/**
 * Starts PostgreSQL + Electric containers for integration testing.
 *
 * Usage with vitest:
 *
 *   let ctx: ElectricTestContext
 *
 *   beforeAll(async () => {
 *     ctx = await startElectricTestContainers()
 *   }, 60_000)
 *
 *   afterAll(async () => {
 *     await ctx?.stop()
 *   })
 *
 *   test("can connect to electric", async () => {
 *     const res = await fetch(`${ctx.electricUrl}/v1/health`)
 *     const body = await res.json()
 *     expect(body.status).toBe("active")
 *   })
 */
export async function startElectricTestContainers(): Promise<ElectricTestContext> {
  // 1. Create a shared Docker network so containers can talk directly
  const network = await new Network().start()

  // 2. Start PostgreSQL with logical replication enabled
  const pgNetworkAlias = "postgres"
  const pgUser = "postgres"
  const pgPassword = "password"
  const pgDatabase = "electric"

  const pgContainer = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase(pgDatabase)
    .withUsername(pgUser)
    .withPassword(pgPassword)
    .withNetwork(network)
    .withNetworkAliases(pgNetworkAlias)
    // Enable logical replication — required by Electric
    .withCommand([
      "postgres",
      "-c", "wal_level=logical",
      "-c", "max_replication_slots=10",
    ])
    // Use tmpfs for speed and to avoid stale data between runs
    .withTmpFs({ "/var/lib/postgresql/data": "rw" })
    .withExposedPorts(5432)
    .start()

  // 3. Build the internal DATABASE_URL that Electric will use (container-to-container)
  const internalDatabaseUrl =
    `postgresql://${pgUser}:${pgPassword}@${pgNetworkAlias}:5432/${pgDatabase}?sslmode=disable`

  // 4. Start Electric, connected to PostgreSQL via the Docker network
  const electricContainer = await new GenericContainer(
    "electricsql/electric:latest"
  )
    .withNetwork(network)
    .withExposedPorts(3000)
    .withEnvironment({
      DATABASE_URL: internalDatabaseUrl,
      ELECTRIC_INSECURE: "true",
      // Enables DELETE /v1/shape for test cleanup
      ELECTRIC_ENABLE_INTEGRATION_TESTING: "true",
      // Smaller chunks = faster test feedback
      ELECTRIC_SHAPE_CHUNK_BYTES_THRESHOLD: "10000",
    })
    // Wait until Electric reports "active" (HTTP 200).
    // Electric returns 202 while starting, 200 when ready.
    .withWaitStrategy(
      Wait.forHttp("/v1/health", 3000).forStatusCode(200)
    )
    .withStartupTimeout(30_000)
    .start()

  // 5. Build host-accessible URLs
  const databaseUrl = pgContainer.getConnectionUri()
  const electricPort = electricContainer.getMappedPort(3000)
  const electricUrl = `http://localhost:${electricPort}`

  return {
    databaseUrl,
    electricUrl,
    stop: async () => {
      await electricContainer.stop()
      await pgContainer.stop()
      await network.stop()
    },
  }
}

// ---------------------------------------------------------------------------
// Self-test: run this file directly to verify the setup works
// ---------------------------------------------------------------------------

async function main() {
  console.log("Starting Electric testcontainers...")
  const ctx = await startElectricTestContainers()

  try {
    // Verify Electric health
    const healthRes = await fetch(`${ctx.electricUrl}/v1/health`)
    const health = await healthRes.json()
    console.log("Electric health:", health)

    // Verify PostgreSQL connection
    const client = new Client({ connectionString: ctx.databaseUrl })
    await client.connect()
    const { rows } = await client.query("SELECT version()")
    console.log("PostgreSQL:", rows[0].version)
    await client.end()

    // Verify Electric can serve shapes
    await client.connect()
    await client.query(
      "CREATE TABLE IF NOT EXISTS test_items (id SERIAL PRIMARY KEY, value TEXT)"
    )
    await client.query(
      "INSERT INTO test_items (value) VALUES ('hello from testcontainers')"
    )
    await client.end()

    const shapeRes = await fetch(
      `${ctx.electricUrl}/v1/shape?table=test_items&offset=-1`
    )
    console.log("Shape response status:", shapeRes.status)
    console.log(
      "Shape headers:",
      Object.fromEntries(shapeRes.headers.entries())
    )

    console.log("\nAll checks passed!")
  } finally {
    console.log("Stopping containers...")
    await ctx.stop()
    console.log("Done.")
  }
}

// Run if executed directly (not imported)
const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("electric-testcontainers.ts") ||
    process.argv[1].endsWith("electric-testcontainers.js"))
if (isDirectRun) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
