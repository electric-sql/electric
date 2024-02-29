import { ConnectionOptions } from '.'
import { GenericWebSocket } from './genericSocket'

export class WebSocketWeb extends GenericWebSocket {
  protected socket?: WebSocket

  constructor(private protocolVsn: string) {
    super()
  }

  makeSocket(opts: ConnectionOptions): WebSocket {
    const ws = new WebSocket(opts.url, [this.protocolVsn])
    ws.binaryType = 'arraybuffer'
    return ws
  }
}
