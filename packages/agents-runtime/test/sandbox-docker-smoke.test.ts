import { describe, expect, it } from 'vitest'
import { dockerSandbox } from '../src/sandbox/docker'
import { dockerAvailable, TEST_IMAGE } from './helpers/docker-probe'
import { installDockerSandboxTestCleanup } from './helpers/docker-sandbox-cleanup'

const d = dockerAvailable ? describe : describe.skip

d(`ad-hoc docker sandbox smoke`, () => {
  installDockerSandboxTestCleanup()

  it(`exec basic, inspect caps, inspect /etc/passwd vs host, attempt mount`, async () => {
    const sandbox = await dockerSandbox({
      image: TEST_IMAGE,
      labels: { 'electric-test-sandbox': `1` },
    })
    try {
      const uname = await sandbox.exec({ command: `uname -a` })
      console.log(`  [uname -a] ${uname.stdout.toString().trim()}`)
      expect(uname.stdout.toString()).toContain(`Linux`)

      const caps = await sandbox.exec({
        command: `cat /proc/self/status | grep -E '^Cap(Eff|Bnd|Prm)'`,
      })
      console.log(
        `  [caps]\n${caps.stdout
          .toString()
          .trim()
          .split(`\n`)
          .map((l) => `    ${l}`)
          .join(`\n`)}`
      )
      // CapEff should be all zeros given CapDrop=ALL
      expect(caps.stdout.toString()).toMatch(/CapEff:\s+0000000000000000/)

      const id = await sandbox.exec({ command: `id` })
      console.log(`  [id] ${id.stdout.toString().trim()}`)

      const containerPasswd = await sandbox.exec({
        command: `wc -l < /etc/passwd`,
      })
      const lines = parseInt(containerPasswd.stdout.toString().trim(), 10)
      console.log(`  [container /etc/passwd lines] ${lines}`)
      expect(lines).toBeGreaterThan(0)
      expect(lines).toBeLessThan(50)

      const lsUsers = await sandbox.exec({
        command: `ls /Users; echo "exit=$?"`,
      })
      console.log(
        `  [ls /Users] ${lsUsers.stdout.toString().trim().split(`\n`).join(` | `)}`
      )
      // Inside the container, /Users does not exist — host fs is not mounted.
      expect(lsUsers.stdout.toString()).toMatch(/exit=[1-9]/)

      const mountTry = await sandbox.exec({
        command: `mount -t tmpfs none /mnt 2>&1; echo "exit=$?"`,
      })
      console.log(`  [mount attempt] ${mountTry.stdout.toString().trim()}`)
      expect(mountTry.stdout.toString()).toMatch(/exit=[1-9]/)
    } finally {
      await sandbox.dispose()
    }
  }, 60_000)
})
