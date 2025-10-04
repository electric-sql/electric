import http from "http"

// Global registry that survives across config reloads
if (!global.__viteMultiPortServers) {
  global.__viteMultiPortServers = new Map()
}

function multiPortPlugin(ports) {
  return {
    name: "vite-multi-port",
    configureServer(server) {
      return () => {
        // First, close all existing servers from previous runs
        for (const [port, srv] of global.__viteMultiPortServers.entries()) {
          try {
            if (srv && srv.listening) {
              srv.close()
            }
          } catch (e) {
            // Ignore errors from already closed servers
          }
        }
        global.__viteMultiPortServers.clear()

        // Wait a bit for ports to be released
        setTimeout(() => {
          ports.forEach((port) => {
            const additionalServer = http.createServer(server.middlewares)

            additionalServer.on("error", (err) => {
              if (err.code === "EADDRINUSE") {
                console.error(`❌ Port ${port} is already in use`)
                process.exit(1)
              } else {
                // Propagate other errors
                throw err
              }
            })

            additionalServer.listen(port, () => {})

            global.__viteMultiPortServers.set(port, additionalServer)
          })
        }, 100)

        // Cleanup on server close
        server.httpServer?.once("close", () => {
          global.__viteMultiPortServers.forEach((s) => {
            try {
              if (s.listening) {
                s.close()
              }
            } catch (e) {
              // Ignore
            }
          })
          global.__viteMultiPortServers.clear()
        })
      }
    },
  }
}

export default multiPortPlugin
