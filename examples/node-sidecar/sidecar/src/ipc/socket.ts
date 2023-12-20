import * as net from 'net'
import { Server } from './server'

// TODO: make this configurable
const SERVER_PORT = 8123

/**
 * This class implements Inter-Process Communication (IPC) between the sidecar and the client applications.
 * To this end, it starts a WebSocket server and listens for messages from the client applications.
 * It also sends messages to the client applications to notify them about data changes.
 */
export class SocketServerIPC implements Server {
  private sockets: net.Socket[] = []
  private server: net.Server | undefined
  private onPotentialDataChangeCb: (() => void | Promise<void>) | undefined

  async start(): Promise<void> {
    this.server = net.createServer((socket) => {
      this.sockets.push(socket)
      socket.on('data', (data) => {
        const msg = data.toString()
        if (msg === 'potential data change') {
          this.onPotentialDataChangeCb?.()
        }
      })
      socket.on('close', () => { 
        this.sockets = this.sockets.filter((s) => s !== socket)
      })
    }).listen(SERVER_PORT)
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      // stop accepting new connections
      this.server?.close((err) => {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
      
      // close all existing sockets
      this.sockets.forEach((socket) => {
        socket.destroy()
      })

      this.sockets = []
      this.server = undefined
    })
  }

  onPotentialDataChange(cb: () => void | Promise<void>): void {
    this.onPotentialDataChangeCb = cb
  }

  async notifyDataChanged(): Promise<void> {
    // Notify all clients.
    // Every write returns a promise.
    // We wait for all promises to resolve.
    await Promise.all(
      this.sockets.map((socket) => {
        return new Promise<void>((resolve, reject) => {
          socket.write('data changed', (err) => {
            if (err) {
              reject(err)
            } else {
              resolve()
            }
          })
        })
      })
    )
  }
}