import net from 'net'
import { WebSocket, createWebSocketStream } from 'ws'

export interface TunnelOptions {
  serviceUrl: string
  localPort: number
}

export const defaultOptions: TunnelOptions = {
  serviceUrl: 'ws://localhost:5133',
  localPort: 65432,
}

export function tunnel({ serviceUrl, localPort }: TunnelOptions) {
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
