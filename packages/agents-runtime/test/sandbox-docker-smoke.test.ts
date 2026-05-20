import { describe, expect, it } from 'vitest'
import { dockerSandbox } from '../src/sandbox/docker'
import { dockerAvailable, TEST_IMAGE } from './helpers/docker-probe'

const d = dockerAvailable ? describe : describe.skip

d(`ad-hoc docker sandbox smoke — network proxy`, () => {
  it(`proxy decides allow vs deny per host (raw CONNECT)`, async () => {
    // We test the proxy itself by issuing CONNECT requests to it. We
    // don't rely on programs *inside* the container to honor
    // HTTPS_PROXY — that's known-incomplete and documented in v2 notes.
    //
    // The proxy starts on the host. From the container, connecting to
    // host.docker.internal:<port> goes to it. From the host (here in
    // the test) we can hit the same proxy via 127.0.0.1:<port>. We
    // probe both decisions via a minimal CONNECT sent over net.connect.
    const sandbox = await dockerSandbox({
      image: TEST_IMAGE,
      labels: { 'electric-test-sandbox': `1` },
      initialNetworkPolicy: { mode: `allowlist`, allow: [`example.com`] },
    })
    try {
      // Use a host-process CONNECT against the proxy port. We figure out
      // the proxy URL by inspecting HTTP(S)_PROXY env baked into the
      // container — it points at host.docker.internal:<port>.
      const proxyEnv = await sandbox.exec({
        command: `printenv HTTPS_PROXY || printenv HTTP_PROXY`,
      })
      const proxyUrl = proxyEnv.stdout.toString().trim()
      console.log(`  [proxy from container env] ${proxyUrl}`)
      const port = new URL(proxyUrl).port
      const { connect } = await import(`node:net`)

      const probeConnect = (host: string): Promise<number> =>
        new Promise((resolve, reject) => {
          const sock = connect(Number(port), `127.0.0.1`, () => {
            sock.write(
              `CONNECT ${host}:443 HTTP/1.1\r\nHost: ${host}:443\r\n\r\n`
            )
          })
          let buf = ``
          sock.on(`data`, (chunk: Buffer) => {
            buf += chunk.toString(`utf-8`)
            const m = buf.match(/^HTTP\/1\.1 (\d+)/)
            if (m) {
              const status = Number(m[1])
              sock.destroy()
              resolve(status)
            }
          })
          sock.on(`error`, reject)
          setTimeout(() => {
            sock.destroy()
            reject(new Error(`proxy probe timeout`))
          }, 5000)
        })

      const allowed = await probeConnect(`example.com`)
      console.log(`  [CONNECT example.com] HTTP ${allowed}`)
      // Allowed: proxy completes the CONNECT → 200 Connection Established.
      expect(allowed).toBe(200)

      const denied = await probeConnect(`anthropic.com`)
      console.log(`  [CONNECT anthropic.com] HTTP ${denied}`)
      // Denied: proxy rejects with 403 Forbidden.
      expect(denied).toBe(403)
    } finally {
      await sandbox.dispose()
    }
  }, 30_000)
})

d(`ad-hoc docker sandbox smoke`, () => {
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
