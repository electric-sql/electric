import { argv } from 'process'
import { SideCar } from './sidecar.js'
import { authToken } from './util/auth.js'
import { Server } from './ipc/server.js'
import { SocketServerIPC } from './ipc/socket.js'

const main = async (ipc: Server) => {
  const args = argv.slice(2)

  if (args.length === 0) {
    console.log('Missing arguments.\nUsage: sidecar <db file> [<electric address>]')
    process.exit(1)
  }

  const [dbFile, ...rest] = args
  const ELECTRIC_URL = rest[0] ?? 'http://localhost:5133'
  const sidecar = new SideCar(dbFile, ELECTRIC_URL, authToken(), ipc)

  console.log("Starting sidecar...")
  await sidecar.start()
  console.log("⚡ Sidecar started! ")

  const keypress = async () => {
    process.stdin.setRawMode(true)
    return new Promise<void>(resolve => process.stdin.once('data', () => {
      process.stdin.setRawMode(false)
      resolve()
    }))
  }

  console.log("Press any key to stop the sidecar")

  await keypress()

  console.log("Stopping sidecar...")
  await sidecar.stop()
  console.log("⚡ Sidecar stopped. Bye!")

  process.exit(0)
}

main(new SocketServerIPC())