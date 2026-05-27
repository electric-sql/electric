import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  __resetPersistentRegistryForTests,
  dockerSandbox,
  sweepOrphanedDockerSandboxes,
} from '../src/sandbox/docker'
import { loadDockerode } from '../src/sandbox/docker/loader'
import { SandboxError } from '../src/sandbox/types'
import { dockerAvailable, TEST_IMAGE, TEST_LABEL } from './helpers/docker-probe'

/**
 * dockerSandbox integration tests. The whole describe block is gated on
 * `dockerAvailable` — if the daemon is unreachable the suite skips
 * silently (CI prints one warning at module load).
 */

if (!dockerAvailable) {
  console.warn(
    `[sandbox-docker] Docker daemon unreachable — skipping docker sandbox tests`
  )
}

const d = dockerAvailable ? describe : describe.skip

async function sweepTestContainers(): Promise<void> {
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
}

d(`dockerSandbox`, () => {
  beforeAll(async () => {
    // Best-effort cleanup of leftover containers from previous runs.
    await sweepTestContainers()
  }, 30_000)

  afterAll(async () => {
    await sweepTestContainers()
  }, 30_000)

  afterEach(async () => {
    // Every container now flows through the registry + debounced teardown;
    // clear the in-process bookkeeping (and its timers) between tests.
    __resetPersistentRegistryForTests()
    await sweepTestContainers()
  }, 30_000)

  it(`exec roundtrip with stdout / exitCode`, async () => {
    const sandbox = await dockerSandbox({
      image: TEST_IMAGE,
      labels: { [TEST_LABEL]: `1` },
    })
    try {
      const r = await sandbox.exec({ command: `echo hello-from-sandbox` })
      expect(r.exitCode).toBe(0)
      expect(r.stdout.toString().trim()).toBe(`hello-from-sandbox`)
      expect(r.aborted).toBe(false)
      expect(r.timedOut).toBe(false)
    } finally {
      await sandbox.dispose()
    }
  }, 60_000)

  it(`exec env propagation`, async () => {
    const sandbox = await dockerSandbox({
      image: TEST_IMAGE,
      labels: { [TEST_LABEL]: `1` },
    })
    try {
      const r = await sandbox.exec({
        command: `echo $MY_VAR`,
        env: { MY_VAR: `propagated` },
      })
      expect(r.stdout.toString().trim()).toBe(`propagated`)
    } finally {
      await sandbox.dispose()
    }
  }, 60_000)

  it(`writeFile + readFile roundtrip via tar archives`, async () => {
    const sandbox = await dockerSandbox({
      image: TEST_IMAGE,
      labels: { [TEST_LABEL]: `1` },
    })
    try {
      await sandbox.writeFile(`/work/hello.txt`, `hi from host`)
      const buf = await sandbox.readFile(`/work/hello.txt`)
      expect(buf.toString(`utf-8`)).toBe(`hi from host`)
    } finally {
      await sandbox.dispose()
    }
  }, 60_000)

  it(`exists/stat/readdir/remove via in-container shell`, async () => {
    const sandbox = await dockerSandbox({
      image: TEST_IMAGE,
      labels: { [TEST_LABEL]: `1` },
    })
    try {
      expect(await sandbox.exists(`/work/never-existed.txt`)).toBe(false)
      await sandbox.writeFile(`/work/probe.txt`, `12345`)
      expect(await sandbox.exists(`/work/probe.txt`)).toBe(true)
      const s = await sandbox.stat(`/work/probe.txt`)
      expect(s.type).toBe(`file`)
      expect(s.size).toBe(5)
      await sandbox.mkdir(`/work/sub`)
      const entries = await sandbox.readdir(`/work`)
      const names = entries.map((e) => e.name).sort()
      expect(names).toContain(`probe.txt`)
      expect(names).toContain(`sub`)
      const sub = entries.find((e) => e.name === `sub`)
      expect(sub?.type).toBe(`directory`)
      await sandbox.remove(`/work/probe.txt`)
      expect(await sandbox.exists(`/work/probe.txt`)).toBe(false)
    } finally {
      await sandbox.dispose()
    }
  }, 60_000)

  it(`writeFile rejects paths outside the working directory`, async () => {
    const sandbox = await dockerSandbox({
      image: TEST_IMAGE,
      labels: { [TEST_LABEL]: `1` },
    })
    try {
      await expect(
        sandbox.writeFile(`/etc/passwd`, `nope`)
      ).rejects.toBeInstanceOf(SandboxError)
    } finally {
      await sandbox.dispose()
    }
  }, 60_000)

  it(`read-side methods enforce the working directory boundary`, async () => {
    const sandbox = await dockerSandbox({
      image: TEST_IMAGE,
      labels: { [TEST_LABEL]: `1` },
    })
    try {
      // readFile, readdir, stat all throw for paths outside /work; exists
      // returns false (safe-probe semantics, matching native + unrestricted).
      await expect(sandbox.readFile(`/etc/passwd`)).rejects.toMatchObject({
        kind: `policy`,
      })
      await expect(sandbox.readdir(`/etc`)).rejects.toMatchObject({
        kind: `policy`,
      })
      await expect(sandbox.stat(`/etc/passwd`)).rejects.toMatchObject({
        kind: `policy`,
      })
      expect(await sandbox.exists(`/etc/passwd`)).toBe(false)
    } finally {
      await sandbox.dispose()
    }
  }, 60_000)

  it(`hardened defaults: cap-drop, no-new-privileges, no docker socket access`, async () => {
    const sandbox = await dockerSandbox({
      image: TEST_IMAGE,
      labels: { [TEST_LABEL]: `1` },
    })
    try {
      // /var/run/docker.sock isn't mounted — a sandboxed agent that gets
      // the socket can trivially escape by launching a new container with
      // host bind-mounts.
      const sockAttempt = await sandbox.exec({
        command: `test -S /var/run/docker.sock && echo SOCK_PRESENT || echo SOCK_ABSENT`,
      })
      expect(sockAttempt.stdout.toString().trim()).toBe(`SOCK_ABSENT`)

      // CapAdd is empty, CapDrop=ALL → privileged ops fail. `mount`
      // requires CAP_SYS_ADMIN. (Note: Docker Desktop / OrbStack apply
      // their own default seccomp/apparmor on top; the relevant signal
      // here is exit != 0.)
      const mountAttempt = await sandbox.exec({
        command: `mount -t tmpfs none /mnt 2>&1; echo "exit=$?"`,
      })
      expect(mountAttempt.stdout.toString()).toMatch(/exit=([1-9]\d*)/)

      // chroot is another CAP_SYS_CHROOT canary.
      const chrootAttempt = await sandbox.exec({
        command: `chroot /tmp /bin/echo nope 2>&1; echo "exit=$?"`,
      })
      expect(chrootAttempt.stdout.toString()).toMatch(/exit=([1-9]\d*)/)

      // no-new-privileges blocks setuid escalations. `su` typically fails
      // with "Authentication failure" or similar non-zero exit under this
      // flag.
      const suAttempt = await sandbox.exec({
        command: `su root -c true 2>&1; echo "exit=$?"`,
      })
      expect(suAttempt.stdout.toString()).toMatch(/exit=([1-9]\d*)/)
    } finally {
      await sandbox.dispose()
    }
  }, 60_000)

  it(`refuses to mount the host Docker socket via extraMounts`, async () => {
    await expect(
      dockerSandbox({
        image: TEST_IMAGE,
        labels: { [TEST_LABEL]: `1` },
        extraMounts: [
          {
            hostPath: `/var/run/docker.sock`,
            containerPath: `/var/run/docker.sock`,
            readOnly: true,
          },
        ],
      })
    ).rejects.toBeInstanceOf(SandboxError)
  }, 20_000)

  it(`refuses a symlink that resolves to the Docker socket`, async () => {
    // The literal hostPath doesn't contain "docker.sock", but it symlinks to a
    // file that does — the regex-only check would let it through. realpath must
    // resolve it first. Uses a self-controlled target named docker.sock so the
    // test doesn't depend on the host's real socket path.
    const dir = await mkdtemp(join(tmpdir(), `dockersock-`))
    const target = join(dir, `docker.sock`)
    const link = join(dir, `innocent`)
    await writeFile(target, ``)
    await symlink(target, link)
    try {
      await expect(
        dockerSandbox({
          image: TEST_IMAGE,
          labels: { [TEST_LABEL]: `1` },
          extraMounts: [
            {
              hostPath: link,
              containerPath: `/var/run/docker.sock`,
              readOnly: true,
            },
          ],
        })
      ).rejects.toMatchObject({ kind: `policy` })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 20_000)

  it(`an ephemeral container lingers for the idle grace, then is removed`, async () => {
    // Dispose no longer vanishes the container synchronously: it lingers for
    // the idle grace (so an in-window collaborator can reattach) and is then
    // REMOVED by the debounced teardown (ephemeral ⇒ wiped).
    const sandbox = await dockerSandbox({
      image: TEST_IMAGE,
      labels: { [TEST_LABEL]: `1` },
      sandboxKey: `ephemeral-${Date.now()}`,
      sharedIdleGraceMs: 1_000,
    })
    const Docker = await loadDockerode()
    const docker = new Docker()
    const list = () =>
      docker.listContainers({
        all: true,
        filters: { label: [`${TEST_LABEL}=1`] },
      })
    expect((await list()).length).toBeGreaterThanOrEqual(1)
    await sandbox.dispose()
    // Still present immediately after dispose — it's only refcounted down.
    expect((await list()).length).toBe(1)
    // After the grace the ephemeral teardown removes it.
    const start = Date.now()
    while ((await list()).length > 0) {
      if (Date.now() - start > 5_000) {
        throw new Error(`ephemeral container not removed after idle grace`)
      }
      await new Promise((r) => setTimeout(r, 50))
    }
  }, 60_000)

  it(`exec timeout kills the process and reports timedOut`, async () => {
    const sandbox = await dockerSandbox({
      image: TEST_IMAGE,
      labels: { [TEST_LABEL]: `1` },
    })
    try {
      const r = await sandbox.exec({
        command: `sleep 30`,
        timeoutMs: 800,
      })
      expect(r.timedOut).toBe(true)
      expect(r.exitCode === null || r.exitCode !== 0).toBe(true)
      // The container itself must still be alive — timeout kills the exec
      // PID, not the whole container.
      const probe = await sandbox.exec({ command: `echo still-alive` })
      expect(probe.stdout.toString().trim()).toBe(`still-alive`)
    } finally {
      await sandbox.dispose()
    }
  }, 30_000)

  it(`exec honors AbortSignal`, async () => {
    const sandbox = await dockerSandbox({
      image: TEST_IMAGE,
      labels: { [TEST_LABEL]: `1` },
    })
    try {
      const ac = new AbortController()
      const p = sandbox.exec({
        command: `sleep 30`,
        timeoutMs: 5000,
        signal: ac.signal,
      })
      setTimeout(() => ac.abort(), 100)
      const r = await p
      expect(r.aborted).toBe(true)
      expect(r.timedOut).toBe(false)
    } finally {
      await sandbox.dispose()
    }
  }, 30_000)

  it(`exec timeout kills only its own process tree, not co-tenant processes`, async () => {
    // Models a shared container: one exec leaves a background process running
    // (a stand-in for a sibling lease's work or a dev server), then a *second*
    // exec times out. The scoped kill must not touch the first process.
    const sandbox = await dockerSandbox({
      image: TEST_IMAGE,
      labels: { [TEST_LABEL]: `1` },
    })
    try {
      // Background a long sleep that outlives the exec that launched it; it is
      // reparented to PID 1 but keeps that first exec's marker in its environ.
      const launch = await sandbox.exec({ command: `sleep 300 & echo $!` })
      const bgPid = launch.stdout.toString().trim()
      expect(bgPid).toMatch(/^\d+$/)

      const timed = await sandbox.exec({ command: `sleep 30`, timeoutMs: 800 })
      expect(timed.timedOut).toBe(true)

      // The earlier background process — a different exec marker — survives.
      const check = await sandbox.exec({
        command: `kill -0 ${bgPid} && echo ALIVE || echo DEAD`,
      })
      expect(check.stdout.toString().trim()).toBe(`ALIVE`)
    } finally {
      await sandbox.dispose()
    }
  }, 30_000)

  it(`names a container from its key and labels the spawner for observability`, async () => {
    // The runtime resolves the key to (here) the entity URL, so the name is
    // legible in `docker ps`; the entity identity also rides on labels.
    const sandbox = await dockerSandbox({
      image: TEST_IMAGE,
      labels: { [TEST_LABEL]: `1` },
      sandboxKey: `/worker/job-42/main`,
      entityType: `worker`,
      entityUrl: `/worker/job-42/main`,
    })
    try {
      const Docker = await loadDockerode()
      const docker = new Docker()
      const list = await docker.listContainers({
        all: true,
        filters: { label: [`${TEST_LABEL}=1`] },
      })
      const mine = list.find((c) =>
        (c.Names ?? []).some((n) => n.includes(`${`electric-sbx`}-`))
      )
      expect(mine).toBeDefined()
      const name = (mine!.Names ?? [])[0] ?? ``
      // The entity type + id are legible in `docker ps`.
      expect(name).toContain(`worker`)
      expect(name).toContain(`job-42`)
      const labels = (mine as unknown as { Labels: Record<string, string> })
        .Labels
      expect(labels[`com.electric.sandbox.entity-type`]).toBe(`worker`)
      expect(labels[`com.electric.sandbox.entity`]).toBe(`/worker/job-42/main`)
    } finally {
      await sandbox.dispose()
    }
  }, 60_000)

  it(`fetch runs inside the container and returns the page (allow-all)`, async () => {
    // Proves the request executes *in the container* (via the in-sandbox
    // HTTP client over exec) and a Response is synthesized from its output.
    const sandbox = await dockerSandbox({
      image: TEST_IMAGE,
      labels: { [TEST_LABEL]: `1` },
      initialNetworkPolicy: { mode: `allow-all` },
    })
    try {
      const res = await sandbox.fetch(`https://example.com/`)
      expect(res.status).toBe(200)
      const body = await res.text()
      expect(body).toContain(`Example Domain`)
    } finally {
      await sandbox.dispose()
    }
  }, 60_000)

  it(`deny-all container refuses fetch (NetworkMode=none, no proxy)`, async () => {
    // deny-all means the container is created with no network interface, so
    // there is no proxy and fetch is rejected up front.
    const sandbox = await dockerSandbox({
      image: TEST_IMAGE,
      labels: { [TEST_LABEL]: `1` },
      initialNetworkPolicy: { mode: `deny-all` },
    })
    try {
      await expect(sandbox.fetch(`https://example.com/`)).rejects.toMatchObject(
        { kind: `policy` }
      )
    } finally {
      await sandbox.dispose()
    }
  }, 30_000)
})

d(`dockerSandbox keyed lifecycle`, () => {
  // Unique keys per run so reattach targets a clean deterministic name.
  const KEY = `electric-test-${Date.now()}`

  beforeAll(async () => {
    await sweepTestContainers()
  }, 30_000)

  afterEach(async () => {
    __resetPersistentRegistryForTests()
    await sweepTestContainers()
  }, 30_000)

  afterAll(async () => {
    __resetPersistentRegistryForTests()
    await sweepTestContainers()
  }, 30_000)

  const make = (
    sandboxKey: string,
    sharedIdleGraceMs?: number,
    persistent = true
  ) =>
    dockerSandbox({
      image: TEST_IMAGE,
      labels: { [TEST_LABEL]: `1` },
      persistent,
      sandboxKey,
      sharedIdleGraceMs,
    })

  // Inspect a shared container by its key label (set on every persistent
  // container as `com.electric.sandbox.key=<sandboxKey>`), avoiding any coupling
  // to the deterministic-name hash.
  const keyState = async (
    sandboxKey: string
  ): Promise<`absent` | `running` | `stopped`> => {
    const Docker = await loadDockerode()
    const docker = new Docker()
    const list = await docker.listContainers({
      all: true,
      filters: { label: [`com.electric.sandbox.key=${sandboxKey}`] },
    })
    if (list.length === 0) return `absent`
    const info = await docker.getContainer(list[0].Id).inspect()
    return info.State.Running ? `running` : `stopped`
  }

  const waitForKeyState = async (
    sandboxKey: string,
    want: `absent` | `running` | `stopped`,
    timeoutMs: number
  ): Promise<void> => {
    const start = Date.now()
    for (;;) {
      if ((await keyState(sandboxKey)) === want) return
      if (Date.now() - start > timeoutMs) {
        throw new Error(`timed out waiting for ${sandboxKey} to be ${want}`)
      }
      await new Promise((r) => setTimeout(r, 50))
    }
  }

  it(`reattaches to the same container and preserves the filesystem`, async () => {
    const first = await make(`${KEY}-persist`)
    await first.writeFile(`/work/shared.txt`, `hello-from-first`)
    // dispose drops the last ref but leaves the container running.
    await first.dispose()

    const second = await make(`${KEY}-persist`)
    try {
      const back = await second.readFile(`/work/shared.txt`)
      expect(back.toString()).toBe(`hello-from-first`)
    } finally {
      await second.dispose()
    }
  }, 90_000)

  it(`names a shared container from the key (collaborator-stable) and labels the spawner`, async () => {
    const key = `${KEY}-named`
    const sandbox = await dockerSandbox({
      image: TEST_IMAGE,
      labels: { [TEST_LABEL]: `1` },
      persistent: true,
      sandboxKey: key,
      entityType: `horton`,
      entityUrl: `/horton/abc123/main`,
    })
    try {
      const Docker = await loadDockerode()
      const docker = new Docker()
      const list = await docker.listContainers({
        all: true,
        filters: { label: [`com.electric.sandbox.key=${key}`] },
      })
      expect(list).toHaveLength(1)
      const name = (list[0].Names ?? [])[0] ?? ``
      // Derived from the shared key (not the entity) so every collaborator
      // converges on it; readable slug + a 12-hex disambiguator.
      expect(name).toMatch(/electric-sbx-.+-[0-9a-f]{12}$/)
      const labels = (list[0] as unknown as { Labels: Record<string, string> })
        .Labels
      // Per-entity identity lives in labels, since the shared name can't.
      expect(labels[`com.electric.sandbox.entity-type`]).toBe(`horton`)
      expect(labels[`com.electric.sandbox.entity`]).toBe(`/horton/abc123/main`)
    } finally {
      await sandbox.dispose()
    }
  }, 90_000)

  it(`shares one live container across concurrent leases (refcount)`, async () => {
    // Two concurrent factory calls for the same key resolve to one container.
    const [a, b] = await Promise.all([
      make(`${KEY}-concurrent`),
      make(`${KEY}-concurrent`),
    ])
    try {
      await a.exec({ command: `echo from-a > /work/a.txt` })
      // b sees a's write — same filesystem.
      const seen = await b.readFile(`/work/a.txt`)
      expect(seen.toString().trim()).toBe(`from-a`)

      // Disposing one lease must NOT tear the container down — the sibling
      // is still using it.
      await a.dispose()
      const stillThere = await b.exec({ command: `cat /work/a.txt` })
      expect(stillThere.exitCode).toBe(0)
      expect(stillThere.stdout.toString().trim()).toBe(`from-a`)
    } finally {
      await b.dispose()
    }
  }, 90_000)

  it(`stops a shared container after the idle grace; reattach restarts it with the fs intact`, async () => {
    const grace = 1_000
    const key = `${KEY}-idle`
    const sandbox = await make(key, grace)
    await sandbox.writeFile(`/work/keep.txt`, `survives-stop`)
    await sandbox.dispose() // refs → 0, schedules a debounced stop

    // Within the grace it's still running; after it, stopped (not removed).
    expect(await keyState(key)).toBe(`running`)
    await waitForKeyState(key, `stopped`, 5_000)

    // Reattach restarts the stopped container; the filesystem survived.
    const again = await make(key, grace)
    try {
      expect(await keyState(key)).toBe(`running`)
      expect((await again.readFile(`/work/keep.txt`)).toString()).toBe(
        `survives-stop`
      )
    } finally {
      await again.dispose()
    }
  }, 90_000)

  it(`REMOVES an ephemeral container after the idle grace (wiped, not stopped)`, async () => {
    // Same keyed path as persistent, but persistent:false ⇒ the debounced
    // teardown REMOVES the container instead of stopping it.
    const grace = 1_000
    const key = `${KEY}-ephemeral`
    const sandbox = await make(key, grace, /* persistent */ false)
    await sandbox.writeFile(`/work/gone.txt`, `will-be-wiped`)
    await sandbox.dispose() // refs → 0, schedules a debounced remove

    // Within the grace it's still running (reattachable for in-window sharing).
    expect(await keyState(key)).toBe(`running`)
    // After the grace it's gone entirely — not merely stopped.
    await waitForKeyState(key, `absent`, 5_000)
  }, 90_000)

  it(`per-wake keys get distinct containers (full isolation via the key alone)`, async () => {
    // Two wakes of one entity under scope:'wake' resolve to entityUrl#wakeId —
    // distinct keys ⇒ distinct containers, no shared filesystem. No separate
    // "ephemeral path": isolation is purely the per-wake key.
    const entityUrl = `${KEY}-entity`
    const w1 = await make(`${entityUrl}#wake-1`, undefined, false)
    const w2 = await make(`${entityUrl}#wake-2`, undefined, false)
    try {
      await w1.exec({ command: `echo only-in-w1 > /work/marker.txt` })
      // w2 is a different container, so it cannot see w1's write.
      expect(await w2.exists(`/work/marker.txt`)).toBe(false)
      expect(await keyState(`${entityUrl}#wake-1`)).toBe(`running`)
      expect(await keyState(`${entityUrl}#wake-2`)).toBe(`running`)
    } finally {
      await w1.dispose()
      await w2.dispose()
    }
  }, 90_000)

  // --- ownership: owner creates + governs teardown; attacher only attaches ---

  const makeOwned = (sandboxKey: string, sharedIdleGraceMs?: number) =>
    dockerSandbox({
      image: TEST_IMAGE,
      labels: { [TEST_LABEL]: `1` },
      sandboxKey,
      persistent: true,
      sharedIdleGraceMs,
    })

  const makeAttacher = (sandboxKey: string) =>
    dockerSandbox({
      image: TEST_IMAGE,
      labels: { [TEST_LABEL]: `1` },
      sandboxKey,
      owner: false,
    })

  it(`an attacher shares the owner's container + filesystem (never creates)`, async () => {
    const key = `${KEY}-attach`
    const owner = await makeOwned(key)
    try {
      await owner.writeFile(`/work/shared.txt`, `from-owner`)
      const attacher = await makeAttacher(key)
      try {
        expect((await attacher.readFile(`/work/shared.txt`)).toString()).toBe(
          `from-owner`
        )
      } finally {
        await attacher.dispose()
      }
    } finally {
      await owner.dispose()
    }
  }, 90_000)

  it(`an attacher rejects with 'unavailable' when no owner sandbox is live`, async () => {
    // No owner ever created this key → the attacher must NOT conjure a fresh,
    // empty container; it fails closed.
    await expect(makeAttacher(`${KEY}-no-owner`)).rejects.toMatchObject({
      kind: `unavailable`,
    })
    expect(await keyState(`${KEY}-no-owner`)).toBe(`absent`)
  }, 60_000)

  it(`owner reclaim wipes a persistent container immediately (overrides stop)`, async () => {
    const key = `${KEY}-reclaim`
    // Persistent + long grace: a normal idle dispose would STOP and keep it
    // warm. A terminal reclaim removes it now regardless.
    const owner = await makeOwned(key, 60_000)
    await owner.writeFile(`/work/gone.txt`, `bye`)
    await owner.dispose({ reclaim: true })
    await waitForKeyState(key, `absent`, 5_000)
  }, 90_000)

  it(`an attacher dispose (even with reclaim) never tears down the owner's container`, async () => {
    const key = `${KEY}-attach-safe`
    const owner = await makeOwned(key, 60_000)
    const attacher = await makeAttacher(key)
    try {
      // An attacher can't reclaim the owner's sandbox — the flag is ignored.
      await attacher.dispose({ reclaim: true })
      expect(await keyState(key)).toBe(`running`)
      const probe = await owner.exec({ command: `echo alive` })
      expect(probe.stdout.toString().trim()).toBe(`alive`)
    } finally {
      await owner.dispose()
    }
  }, 90_000)

  it(`a re-acquire within the grace cancels the idle-stop (stays warm)`, async () => {
    const grace = 1_000
    const key = `${KEY}-warm`
    const first = await make(key, grace)
    await first.dispose() // schedules a stop `grace` ms out

    // Re-acquire well within the grace — this must cancel the pending stop.
    await new Promise((r) => setTimeout(r, grace / 4))
    const second = await make(key, grace)
    try {
      // Wait past the *original* grace: the container must still be running.
      await new Promise((r) => setTimeout(r, grace + 300))
      expect(await keyState(key)).toBe(`running`)
      const r = await second.exec({ command: `echo warm` })
      expect(r.stdout.toString().trim()).toBe(`warm`)
    } finally {
      await second.dispose()
    }
  }, 90_000)

  it(`keeps the container alive until the LAST concurrent lease disposes`, async () => {
    const grace = 800
    const key = `${KEY}-refcount-idle`
    const [a, b] = await Promise.all([make(key, grace), make(key, grace)])
    // Dropping one of two leases must NOT schedule a stop.
    await a.dispose()
    await new Promise((r) => setTimeout(r, grace + 300))
    expect(await keyState(key)).toBe(`running`)
    // Dropping the last lease stops it after the grace.
    await b.dispose()
    await waitForKeyState(key, `stopped`, 5_000)
  }, 90_000)

  // Stop a container out-of-band (by key label) to simulate a process that
  // left a non-running leftover behind.
  const stopByKey = async (sandboxKey: string): Promise<void> => {
    const Docker = await loadDockerode()
    const docker = new Docker()
    const list = await docker.listContainers({
      all: true,
      filters: { label: [`com.electric.sandbox.key=${sandboxKey}`] },
    })
    await docker.getContainer(list[0].Id).stop({ t: 0 })
  }

  it(`sweepOrphanedDockerSandboxes removes an exited *ephemeral* orphan`, async () => {
    const key = `${KEY}-orphan-exited`
    await make(key, 60_000, /* persistent */ false)
    await stopByKey(key) // a crashed process leaves an exited ephemeral leftover
    __resetPersistentRegistryForTests()
    expect(await keyState(key)).toBe(`stopped`)

    const removed = await sweepOrphanedDockerSandboxes()
    expect(removed.length).toBeGreaterThanOrEqual(1)
    expect(await keyState(key)).toBe(`absent`)
  }, 90_000)

  it(`sweepOrphanedDockerSandboxes leaves a *running* container untouched`, async () => {
    // A running container may belong to a live sibling process sharing this
    // daemon — force-removing it would wipe a peer's in-use sandbox.
    const key = `${KEY}-orphan-running`
    await make(key, 60_000, /* persistent */ false)
    __resetPersistentRegistryForTests()
    expect(await keyState(key)).toBe(`running`)

    await sweepOrphanedDockerSandboxes()
    expect(await keyState(key)).toBe(`running`)
  }, 90_000)

  it(`sweepOrphanedDockerSandboxes preserves a *persistent* container for reattach`, async () => {
    // persistent: true exists so a restarted process can reattach by key, so a
    // boot sweep must not wipe it even when it's stopped.
    const key = `${KEY}-orphan-persist`
    await make(key, 60_000, /* persistent */ true)
    await stopByKey(key)
    __resetPersistentRegistryForTests()
    expect(await keyState(key)).toBe(`stopped`)

    await sweepOrphanedDockerSandboxes()
    expect(await keyState(key)).toBe(`stopped`)
  }, 90_000)
})
