import { ConnectionOptions } from './index'
import { WebSocket } from 'ws'
import { GenericWebSocket } from './genericSocket'

export class WebSocketNode extends GenericWebSocket<true> {
  protected socket?: WebSocket

  constructor(private protocolVsn: string) {
    super()
  }

  makeSocket(opts: ConnectionOptions): WebSocket {
    const ws = new WebSocket(opts.url, [this.protocolVsn])
    ws.binaryType = 'nodebuffer'
    return ws
  }
}
