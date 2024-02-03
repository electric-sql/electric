import { argv } from 'process'
import { SideCar } from './sidecar.js'
import { SocketServerIPC } from './ipc/socket.js'
import { parseConfigFile, hydrateConfig } from './util/config.js'

const args = argv.slice(2)

if (args.length !== 1) {
  console.log('Invalid arguments.\nUsage: sidecar <config file>')
  process.exit(1)
}

const [configFile] = args
const cfg = await parseConfigFile(configFile)
const config = hydrateConfig(cfg)

const ipcPort = config.ipc.port
const ipcServer = new SocketServerIPC(ipcPort)
const sidecar = new SideCar(config, ipcServer)

console.log("Starting sidecar...")
await sidecar.start()
console.log("⚡ Sidecar started! ")

/*
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
*/

// Start reading from stdin so we don't exit.
process.stdin.resume()