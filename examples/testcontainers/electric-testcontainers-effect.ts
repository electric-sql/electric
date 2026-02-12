/**
 * Effect-based testcontainers setup for Electric SQL — fixed version.
 *
 * This is a corrected version of the setup from:
 * https://gist.github.com/harrysolovay/41fe54dddfe76850eee8a3ecd5ce9a86
 *
 * Problems in the original and how they're fixed:
 *
 * 1. Bind mounts + .withReuse() caused "works first run, breaks after" because
 *    the PostgreSQL data directory persisted stale state (postmaster.pid, WAL
 *    files) between runs. FIX: Use tmpfs and don't use .withReuse().
 *
 * 2. Fixed host port (49154) + exposeHostPorts() is fragile — if the port is
 *    still held from a previous run, startup fails. FIX: Use a Docker network
 *    so Electric connects to PostgreSQL directly, no host port forwarding.
 *
 * 3. No Docker network meant relying on host.testcontainers.internal, which
 *    adds unnecessary indirection. FIX: Shared network with network aliases.
 *
 * 4. Missing max_replication_slots config — replication slots from previous
 *    runs can accumulate and exhaust the default limit.
 */

import { Context, Effect, Layer, Redacted } from "effect"
import { PostgreSqlContainer } from "@testcontainers/postgresql"
import {
  GenericContainer,
  Network,
  Wait,
  type StartedTestContainer,
  type StartedNetwork,
} from "testcontainers"

// ---------------------------------------------------------------------------
// Service tags
// ---------------------------------------------------------------------------

export class DatabaseUrl extends Context.Tag("DatabaseUrl")<
  DatabaseUrl,
  Redacted.Redacted<string>
>() {}

export class ElectricUrl extends Context.Tag("ElectricUrl")<
  ElectricUrl,
  Redacted.Redacted<string>
>() {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Acquire a container/network and release it on scope finalization. */
const acquire = <A extends StartedTestContainer | StartedNetwork>(
  make: () => Promise<A>
) =>
  Effect.acquireRelease(Effect.tryPromise(make), (resource) =>
    Effect.promise(() => resource.stop())
  )

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

export const TestContainersLive = Effect.gen(function* () {
  // 1. Shared Docker network — containers talk directly, no host forwarding
  const network = yield* acquire(() => new Network().start())

  // 2. PostgreSQL with logical replication
  const pgNetworkAlias = "postgres"
  const pgUser = "postgres"
  const pgPassword = "password"
  const pgDatabase = "electric"

  const pgContainer = yield* acquire(() =>
    new PostgreSqlContainer("postgres:16-alpine")
      .withDatabase(pgDatabase)
      .withUsername(pgUser)
      .withPassword(pgPassword)
      .withNetwork(network)
      .withNetworkAliases(pgNetworkAlias)
      .withCommand([
        "postgres",
        "-c", "wal_level=logical",
        "-c", "max_replication_slots=10",
      ])
      // tmpfs avoids stale data between runs — the #1 cause of breakage
      .withTmpFs({ "/var/lib/postgresql/data": "rw" })
      .withExposedPorts(5432)
      .start()
  )

  // 3. Internal URL for container-to-container communication
  const internalDatabaseUrl =
    `postgresql://${pgUser}:${pgPassword}@${pgNetworkAlias}:5432/${pgDatabase}?sslmode=disable`

  // 4. Electric
  const electricContainer = yield* acquire(() =>
    new GenericContainer("electricsql/electric:latest")
      .withNetwork(network)
      .withExposedPorts(3000)
      .withEnvironment({
        DATABASE_URL: internalDatabaseUrl,
        ELECTRIC_INSECURE: "true",
        ELECTRIC_ENABLE_INTEGRATION_TESTING: "true",
        ELECTRIC_SHAPE_CHUNK_BYTES_THRESHOLD: "10000",
      })
      .withWaitStrategy(
        Wait.forHttp("/v1/health", 3000).forStatusCode(200)
      )
      .withStartupTimeout(30_000)
      .start()
  )

  // 5. Host-accessible URLs
  const databaseUrl = pgContainer.getConnectionUri()
  const electricPort = electricContainer.getMappedPort(3000)

  return Layer.mergeAll(
    Layer.succeed(DatabaseUrl, Redacted.make(databaseUrl)),
    Layer.succeed(
      ElectricUrl,
      Redacted.make(`http://localhost:${electricPort}`)
    )
  )
}).pipe(Layer.unwrapScoped)
