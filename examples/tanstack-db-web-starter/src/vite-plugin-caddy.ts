import { spawn, spawnSync, type ChildProcess } from "child_process"
import { writeFileSync } from "fs"
import type { Plugin } from "vite"

interface CaddyPluginOptions {
  host?: string
  httpsPort?: number
  encoding?: boolean
  autoStart?: boolean
  configPath?: string
}

export function caddyPlugin(options: CaddyPluginOptions = {}): Plugin {
  const {
    host = `localhost`,
    httpsPort = 5173,
    encoding = true,
    autoStart = true,
    configPath = `Caddyfile`,
  } = options

  let caddyProcess: ChildProcess | null = null
  let vitePort: number | undefined
  let caddyStarted = false

  const generateCaddyfile = (vitePort: number) => {
    const config = `localhost:${httpsPort} {
  reverse_proxy ${host}:${vitePort}${
    encoding
      ? `
  encode {
    gzip
  }`
      : ``
  }
}
`
    return config
  }

  const startCaddy = (configPath: string) => {
    if (caddyProcess) {
      return
    }

    caddyProcess = spawn(`caddy`, [`run`, `--config`, configPath], {
      // stdio: "inherit",
      // shell: true,
    })

    caddyProcess.on(`error`, (error) => {
      console.error(`Failed to start Caddy:`, error.message)
    })

    caddyProcess.on(`exit`, (code) => {
      if (code !== 0 && code !== null) {
        console.error(`Caddy exited with code ${code}`)
      }
      caddyProcess = null
    })

    // Handle process cleanup
    const cleanup = () => {
      if (caddyProcess && !caddyProcess.killed) {
        caddyProcess.kill(`SIGTERM`)
        // Force kill if it doesn't terminate gracefully
        setTimeout(() => {
          if (caddyProcess && !caddyProcess.killed) {
            caddyProcess.kill(`SIGKILL`)
            process.exit()
          } else {
            process.exit()
          }
        }, 1000)
      }
    }

    process.on(`SIGINT`, cleanup)
    process.on(`SIGTERM`, cleanup)
    process.on(`exit`, cleanup)
  }

  const stopCaddy = () => {
    if (caddyProcess && !caddyProcess.killed) {
      caddyProcess.kill(`SIGTERM`)
      // Force kill if it doesn't terminate gracefully
      setTimeout(() => {
        if (caddyProcess && !caddyProcess.killed) {
          caddyProcess.kill(`SIGKILL`)
        }
      }, 3000)
      caddyProcess = null
    }
  }

  const startCaddyIfReady = () => {
    if (autoStart && vitePort && !caddyStarted) {
      caddyStarted = true

      // Check if `caddy` binary is available before starting (sync)
      try {
        const check = spawnSync(`caddy`, [`--version`], { stdio: `ignore` })
        if (check.error || check.status !== 0) {
          throw new Error(
            `\`caddy\` binary not found or is not working. Please ensure Caddy is installed and available in your PATH.`
          )
        }
      } catch (_err) {
        console.error(
          `\`caddy\` binary not found or is not working. Please ensure Caddy is installed and available in your PATH.`,
          `\nCaddy is required to be able to serve local development with HTTP2 support.`,
          `\n  - Install Caddy: https://caddyserver.com/docs/install`,
          `\n  - If you have \`asdf\`, run \`asdf install\``
        )
        process.exit(1)
      }
      // Generate Caddyfile
      const caddyConfig = generateCaddyfile(vitePort)
      writeFileSync(configPath, caddyConfig)

      // Start Caddy
      startCaddy(configPath)
    }
  }

  return {
    name: `vite-plugin-caddy`,
    configureServer(server) {
      // Override Vite's printUrls function
      server.printUrls = function () {
        console.log()
        console.log(`  ➜  Local:   https://localhost:${httpsPort}/`)
        console.log()
        console.log(
          `  Note: running through Caddy. You might be prompted for password to install HTTPS certificates for local development.`
        )
      }

      server.middlewares.use((_req, _res, next) => {
        if (!vitePort && server.config.server.port) {
          vitePort = server.config.server.port
          startCaddyIfReady()
        }
        next()
      })

      const originalListen = server.listen
      server.listen = function (port?: number, isRestart?: boolean) {
        if (port) {
          vitePort = port
        }

        const result = originalListen.call(this, port, isRestart)

        // Try to start Caddy after server is listening
        if (result && typeof result.then === `function`) {
          result.then(() => {
            // Check if we now have a port from the server
            if (!vitePort && server.config.server.port) {
              vitePort = server.config.server.port
            }
            startCaddyIfReady()
          })
        } else {
          startCaddyIfReady()
        }

        return result
      }
    },
    buildEnd() {
      stopCaddy()
    },
  }
}
