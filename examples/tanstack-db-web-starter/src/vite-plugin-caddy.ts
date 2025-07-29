import { spawn, type ChildProcess } from "child_process"
import { writeFileSync } from "fs"
import { readFileSync } from "fs"
import { networkInterfaces } from "os"
import type { Plugin } from "vite"

interface CaddyPluginOptions {
  host?: string
  encoding?: boolean
  autoStart?: boolean
  configPath?: string
}

export function caddyPlugin(options: CaddyPluginOptions = {}): Plugin {
  const {
    host = "localhost",
    encoding = true,
    autoStart = true,
    configPath = "Caddyfile",
  } = options

  let caddyProcess: ChildProcess | null = null
  let vitePort: number | undefined
  let caddyStarted = false

  const generateCaddyfile = (projectName: string, vitePort: number) => {
    // Get network IP for network access
    const nets = networkInterfaces()
    let networkIP = "192.168.1.1" // fallback

    for (const name of Object.keys(nets)) {
      const netInterfaces = nets[name]
      if (netInterfaces) {
        for (const net of netInterfaces) {
          if (net.family === "IPv4" && !net.internal) {
            networkIP = net.address
            break
          }
        }
      }
    }

    const config = `${projectName}.localhost {
  reverse_proxy ${host}:${vitePort}${
    encoding
      ? `
  encode {
    gzip
  }`
      : ""
  }
}

# Network access
${networkIP} {
  reverse_proxy ${host}:${vitePort}${
    encoding
      ? `
  encode {
    gzip
  }`
      : ""
  }
}
`
    return config
  }

  const startCaddy = (configPath: string) => {
    if (caddyProcess) {
      return
    }

    caddyProcess = spawn("caddy", ["run", "--config", configPath], {
      // stdio: "inherit",
      // shell: true,
    })

    caddyProcess.on("error", (error) => {
      console.error("Failed to start Caddy:", error.message)
    })

    caddyProcess.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        console.error(`Caddy exited with code ${code}`)
      }
      caddyProcess = null
    })

    // Handle process cleanup
    const cleanup = () => {
      if (caddyProcess && !caddyProcess.killed) {
        caddyProcess.kill("SIGTERM")
        // Force kill if it doesn't terminate gracefully
        setTimeout(() => {
          if (caddyProcess && !caddyProcess.killed) {
            caddyProcess.kill("SIGKILL")
            process.exit()
          } else {
            process.exit()
          }
        }, 1000)
      }
    }

    process.on("SIGINT", cleanup)
    process.on("SIGTERM", cleanup)
    process.on("exit", cleanup)
  }

  const stopCaddy = () => {
    if (caddyProcess && !caddyProcess.killed) {
      caddyProcess.kill("SIGTERM")
      // Force kill if it doesn't terminate gracefully
      setTimeout(() => {
        if (caddyProcess && !caddyProcess.killed) {
          caddyProcess.kill("SIGKILL")
        }
      }, 3000)
      caddyProcess = null
    }
  }

  const startCaddyIfReady = (projectName: string) => {
    if (autoStart && vitePort && !caddyStarted) {
      caddyStarted = true
      // Generate Caddyfile
      const caddyConfig = generateCaddyfile(projectName, vitePort)
      writeFileSync(configPath, caddyConfig)
      // Start Caddy
      startCaddy(configPath)
    }
  }

  return {
    name: "vite-plugin-caddy",
    configureServer(server) {
      let projectName = "app"

      // Get project name from package.json
      try {
        const packageJsonContent = readFileSync(
          process.cwd() + "/package.json",
          "utf8"
        )
        const packageJson = JSON.parse(packageJsonContent)
        projectName = packageJson.name || "app"
      } catch (_error) {
        console.warn(
          'Could not read package.json for project name, using "app"'
        )
      }

      // Override Vite's printUrls function
      server.printUrls = function () {
        // Get network IP
        const nets = networkInterfaces()
        let networkIP = "192.168.1.1" // fallback

        for (const name of Object.keys(nets)) {
          const netInterfaces = nets[name]
          if (netInterfaces) {
            for (const net of netInterfaces) {
              if (net.family === "IPv4" && !net.internal) {
                networkIP = net.address
                break
              }
            }
          }
        }

        console.log()
        console.log(`  ➜  Local:   https://${projectName}.localhost/`)
        console.log(`  ➜  Network: https://${networkIP}/`)
        console.log(`  ➜  press h + enter to show help`)
        console.log()
      }

      server.middlewares.use((_req, _res, next) => {
        if (!vitePort && server.config.server.port) {
          vitePort = server.config.server.port
          startCaddyIfReady(projectName)
        }
        next()
      })

      const originalListen = server.listen
      server.listen = function (port?: number, ...args: unknown[]) {
        if (port) {
          vitePort = port
        }

        const result = originalListen.call(this, port, ...args)

        // Try to start Caddy after server is listening
        if (result && typeof result.then === "function") {
          result.then(() => {
            // Check if we now have a port from the server
            if (!vitePort && server.config.server.port) {
              vitePort = server.config.server.port
            }
            startCaddyIfReady(projectName)
          })
        } else {
          startCaddyIfReady(projectName)
        }

        return result
      }
    },
    buildEnd() {
      stopCaddy()
    },
  }
}
