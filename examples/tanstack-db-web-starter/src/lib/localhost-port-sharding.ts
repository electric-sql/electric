/**
 * Localhost port sharding utilities.
 * 
 * Distributes requests across multiple localhost ports in a round-robin fashion
 * to work around HTTP/1's 6 concurrent connection limit per domain.
 *
 * Only used / useful in local development.
 */

// Client-side utilities

const shardPorts = typeof __ELECTRIC_SHARD_PORTS__ !== 'undefined'
  ? __ELECTRIC_SHARD_PORTS__
  : []

let nextShardIndex = 0

/**
 * Creates a fetch client that applies port sharding and includes credentials.
 * Each call to this function assigns the next available shard port in round-robin fashion.
 * All requests made by the returned fetch client will use the same shard port.
 * 
 * @returns A fetch-compatible function pinned to a specific shard port
 */
export function shardedFetchClient() {
  const shardPort = shardPorts.length > 0 
    ? shardPorts[nextShardIndex++ % shardPorts.length]
    : null
  
  return (input: RequestInfo | URL, init?: RequestInit) => {
    let url = input.toString()
    
    if (shardPort !== null) {
      const urlObj = new URL(url)
      urlObj.port = String(shardPort)
      url = urlObj.toString()
    }
    
    return fetch(url, {
      ...init,
      credentials: 'include'
    })
  }
}

// Vite plugin utilities (server-side only)

// @ts-ignore - http module only available server-side
import http from "http"

if (typeof global !== 'undefined' && !global.__viteMultiPortServers) {
  global.__viteMultiPortServers = new Map()
}

/**
 * Creates a Vite configuration for port sharding in development.
 * 
 * Port sharding works around HTTP/1.1's 6 concurrent connection limit per domain
 * by serving requests across multiple localhost ports. This prevents request queuing
 * that would otherwise block Electric shapes during local development.
 * 
 * @param mainPort - The main Vite dev server port (e.g., 5173)
 * @param numShards - Number of additional shard ports to create
 * @param mode - Vite build mode ('production', 'development', etc.)
 * @returns Configuration object with mainPort, portPlugins, and definePorts
 * 
 * @example
 * const { mainPort, portPlugins, definePorts } = shardLocalPorts(5173, 25, mode)
 * // Creates ports: 51730, 51731, ..., 51754 (5173 * 10 + 0..24)
 */
export default function shardLocalPorts(mainPort, numShards, mode) {
  const shardPorts = mode !== 'production' 
    ? Array.from({ length: numShards }, (_, i) => mainPort * 10 + i)
    : []
  
  const allowedOrigin = `http://localhost:${mainPort}`
  
  const portPlugins = shardPorts.length > 0 ? [createShardPlugin(shardPorts, allowedOrigin)] : []

  const definePorts = mode !== 'production' 
    ? { '__ELECTRIC_SHARD_PORTS__': JSON.stringify(shardPorts) }
    : { '__ELECTRIC_SHARD_PORTS__': 'undefined' }

  return {
    mainPort,
    portPlugins,
    definePorts,
  }
}

/**
 * Creates the Vite plugin that spawns additional HTTP servers on shard ports.
 */
function createShardPlugin(shardPorts, allowedOrigin) {
  return {
    name: "vite-shard-local-ports",
    configureServer(server) {
      return () => {
        cleanupExistingServers()
        startShardServers(shardPorts, allowedOrigin, server)
        setupCleanupOnServerClose(server)
      }
    },
  }
}

/**
 * Closes any servers from previous HMR reloads to free up ports.
 */
function cleanupExistingServers() {
  if (typeof global === 'undefined') return
  
  for (const [port, srv] of global.__viteMultiPortServers.entries()) {
    try {
      if (srv && srv.listening) {
        srv.close()
      }
    } catch (e) {
    }
  }
  global.__viteMultiPortServers.clear()
}

/**
 * Starts HTTP servers on each shard port, using Vite's middleware stack.
 * Small delay allows ports to be released from cleanup.
 */
function startShardServers(shardPorts, allowedOrigin, server) {
  if (typeof global === 'undefined') return
  
  setTimeout(() => {
    shardPorts.forEach((port) => {
      const shardServer = createShardServer(allowedOrigin, server)
      
      shardServer.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
          console.error(`❌ Port ${port} is already in use`)
          process.exit(1)
        } else {
          throw err
        }
      })

      shardServer.listen(port, () => {})
      global.__viteMultiPortServers.set(port, shardServer)
    })
  }, 100)
}

/**
 * Creates an HTTP server that proxies to Vite's middleware with CORS overrides.
 * 
 * The server intercepts CORS headers to replace Vite's default wildcard ('*')
 * with a specific origin, which is required when credentials are included in requests.
 */
function createShardServer(allowedOrigin, server) {
  return http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      handlePreflightRequest(res, allowedOrigin)
      return
    }
    
    overrideCorsHeaders(res, allowedOrigin)
    server.middlewares(req, res)
  })
}

/**
 * Handles CORS preflight (OPTIONS) requests.
 */
function handlePreflightRequest(res, allowedOrigin) {
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.writeHead(204)
  res.end()
}

/**
 * Overrides the response's setHeader method to intercept CORS headers.
 * 
 * Vite's default middleware sets 'Access-Control-Allow-Origin: *', which
 * conflicts with credentialed requests. This intercepts that header and
 * replaces it with the specific allowed origin.
 */
function overrideCorsHeaders(res, allowedOrigin) {
  const originalSetHeader = res.setHeader.bind(res)
  
  res.setHeader = function(name, value) {
    if (name.toLowerCase() === 'access-control-allow-origin') {
      return originalSetHeader('Access-Control-Allow-Origin', allowedOrigin)
    }
    return originalSetHeader(name, value)
  }
  
  originalSetHeader('Access-Control-Allow-Credentials', 'true')
}

/**
 * Registers cleanup handler to close shard servers when main Vite server closes.
 */
function setupCleanupOnServerClose(server) {
  if (typeof global === 'undefined') return
  
  server.httpServer?.once("close", () => {
    global.__viteMultiPortServers.forEach((s) => {
      try {
        if (s.listening) {
          s.close()
        }
      } catch (e) {
      }
    })
    global.__viteMultiPortServers.clear()
  })
}
