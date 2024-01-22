import { Command } from 'commander'
import net from 'net'
import { WebSocket, createWebSocketStream } from 'ws'
import { addOptionGroupToCommand, getConfig } from '../config'
import { parsePort } from '../utils'

export function makeProxyTunnelCommand() {
  const command = new Command('proxy-tunnel')
  command.description(
    'Open a tunnel to the Electric Postgres Proxy and binds it to a local port'
  )

  addOptionGroupToCommand(command, 'tunnel')

  command
    .option('--local-port <port>', 'Local port to bind the tunnel to', '65432')
    .action(async (opts) => {
      const config = getConfig(opts)
      const localPort = parsePort(opts.localPort)

      try {
        const serviceUrl = mapHttpToWebSocketInUrl(config.SERVICE)
        proxyTunnel({ serviceUrl, localPort })
      } catch (error) {
        console.error(error)
        process.exit(1)
      }
    })

  return command
}

export interface ProxyTunnelOptions {
  serviceUrl: string
  localPort: number
}

export function proxyTunnel({ serviceUrl, localPort }: ProxyTunnelOptions) {
  const server = net.createServer((clientSocket) => {
    log('New connection!')

    const websocketUrl = `${serviceUrl}/proxy`
    const websocket = new WebSocket(websocketUrl, [], {
      perMessageDeflate: false,
      skipUTF8Validation: true,
    })
    const wsStream = createWebSocketStream(websocket)
    wsStream.on('error', (error) => {
      log('WebSocket error:', error)
    })
    log('Created WebSocket stream')

    clientSocket.on('end', () => {
      websocket.close()
      log('Client disconnected')
    })

    clientSocket.pipe(wsStream).pipe(clientSocket)
  })

  server.listen(localPort, () => {
    console.log(
      `ElectricSQL Postgres Proxy Tunnel listening on port ${localPort}`
    )
    console.log(`Connected to ElectricSQL Service at ${serviceUrl}`)
    console.log('Connect to the database using:')
    console.log(`  psql -h localhost -p ${localPort} -U <username> <database>`)
    console.log('Or with the connection string:')
    console.log(
      `  psql "postgres://<username>:<password>@localhost:${localPort}/<database>"`
    )
    console.log('Press Ctrl+C to exit')
    console.log('--')
  })
}

function log(...args: any[]) {
  const timestamp = new Date().toISOString()
  console.log(timestamp, ...args)
}

function mapHttpToWebSocketInUrl(urlString: string) {
  const url = new URL(urlString)
  switch (url.protocol) {
    case 'https:': {
      url.protocol = 'wss:'
      break
    }
    case 'http:': {
      url.protocol = 'ws:'
      break
    }
    case 'wss:':
    case 'ws:':
      break
    default:
      throw `Invalid URL scheme ${url.protocol} in ELECTRIC_SERVICE`
  }
  return url.toString()
}
