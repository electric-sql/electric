import * as net from 'net'
import { Client } from "./client.js"

const SERVER_PORT = 8123

/*
 * This class implements Inter-Process Communication (IPC) between this client application and the sidecar.
 * To this end, it connects to the sidecar via a TCP socket.
 */
export class SocketIPC implements Client {
  private socket: net.Socket | undefined
  private onDataChangeCb: (() => void | Promise<void>) | undefined

  /**
   * Opens a TCP socket to the sidecar.
   */
  async start(): Promise<void> {
    this.socket = net.createConnection(SERVER_PORT, 'localhost', () => {
      this.socket?.on('data', (data) => {
        const msg = data.toString()
        if (msg === 'data changed') {
          this.onDataChangeCb?.()
        }
      })
    })
  }

  /**
   * Closes the TCP socket to the sidecar.
   */
  async stop(): Promise<void> {
    this.socket?.destroy()
  }

  /**
   * Registers a callback to be called on data changes.
   * @param cb The callback to call when a data change message is received.
   */
  onDataChange(cb: () => void | Promise<void>): void {
    this.onDataChangeCb = cb
  }

  /**
   * Notifies the sidecar of potential data changes.
   */
  async notifyPotentialDataChange(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.socket?.write('potential data change', (err) => {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
    })
  }
}