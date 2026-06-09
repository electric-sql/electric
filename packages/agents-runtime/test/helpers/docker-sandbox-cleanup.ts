import { afterAll, afterEach, beforeAll } from 'vitest'
import { __resetPersistentRegistryForTests } from '../../src/sandbox/docker'
import { loadDockerode } from '../../src/sandbox/docker/loader'
import { dockerAvailable, TEST_LABEL } from './docker-probe'

/**
 * Force-remove every container this suite created, identified by the test-only
 * label `${TEST_LABEL}=1`. This is the authoritative reaper: it asks the daemon
 * by label, so it catches containers the in-process registry no longer tracks —
 * ref-leaked by a thrown test, cleared by `__resetPersistentRegistryForTests`,
 * or created out-of-band — which `shutdownAllDockerSandboxes()` would miss.
 *
 * It NEVER filters on the production label `com.electric.sandbox`, so a
 * developer's real local sandboxes are untouched. Self-gating and fully
 * swallowed so a missing or slow daemon can't redden a run.
 */
export async function sweepTestContainers(): Promise<void> {
  if (!dockerAvailable) return
  try {
    const Docker = await loadDockerode()
    const docker = new Docker()
    const containers = await docker.listContainers({
      all: true,
      filters: { label: [`${TEST_LABEL}=1`] },
    })
    await Promise.all(
      containers.map((c) =>
        docker
          .getContainer(c.Id)
          .remove({ force: true, v: true })
          .catch(() => {})
      )
    )
  } catch {
    /* daemon gone / unreachable — cleanup is best-effort */
  }
}

/**
 * Install container cleanup for a `describe` block that spins up real
 * containers. Call it as the first line of the block.
 *
 *  - beforeAll: clear leftovers a previously killed run couldn't (its afterAll
 *    never ran).
 *  - afterEach: reset the in-process registry (and its debounced teardown
 *    timers), then sweep — this bounds leakage to a single container if the run
 *    is interrupted, and stops containers piling up across a long suite, since
 *    `dispose()` only *schedules* a removal ~2 minutes out (an unref'd timer
 *    that dies with the process), so without this every test's container lingers.
 *  - afterAll: a final sweep so the file leaves nothing behind.
 */
export function installDockerSandboxTestCleanup(): void {
  beforeAll(() => sweepTestContainers(), 30_000)
  afterEach(async () => {
    __resetPersistentRegistryForTests()
    await sweepTestContainers()
  }, 30_000)
  afterAll(async () => {
    __resetPersistentRegistryForTests()
    await sweepTestContainers()
  }, 30_000)
}
