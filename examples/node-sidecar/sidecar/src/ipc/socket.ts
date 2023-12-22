import * as net from 'net'
import { Server } from './server'

/**
 * This class implements Inter-Process Communication (IPC) between the sidecar and the client applications.
 * To this end, it starts a TCP server and listens for messages from the client applications.
 * It also sends messages to the client applications to notify them about data changes.
 * 
 * This TCP server implements the following protocol:
 *   Supported incoming messages:
 *     "potential data change" - the server invokes the `onPotentialDataChangeCb` when this message is received.
 *                               That callback is registered by the sidecar to perform a snapshot of the oplog on potential changes.
 *   Messages sent to IPC clients:
 *     "data changed" - the server sends this message to all clients when the `notifyDataChanged` method is called.
 *                      That method is called by the sidecar when it receives a "data changed" message from Electric.
 *                      Note that it does not yet contain more information about which data changed.
 */
export class SocketServerIPC implements Server {
  private sockets: net.Socket[] = []
  private server: net.Server | undefined
  private onPotentialDataChangeCb: (() => void | Promise<void>) | undefined

  constructor(private port: number) {}

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
    }).listen(this.port)
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