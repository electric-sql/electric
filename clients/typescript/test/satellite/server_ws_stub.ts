import * as http from 'http'
import { WebSocketServer } from 'ws'
import { getSizeBuf, getTypeFromString, SatPbMsg } from '../../src/util/proto'
import {
  SatAuthResp,
  SatInStartReplicationReq,
  SatInStartReplicationResp,
  SatInStopReplicationResp,
  SatOpLog,
  SatPingReq,
  SatPingResp,
  SatRelation,
} from '../../src/_generated/protocol/satellite'

const PORT = 30002
const IP = '127.0.0.1'

type fakeResponse = SatPbMsg | ((data?: Buffer) => void)

export class SatelliteWSServerStub {
  private httpServer: http.Server
  private server: WebSocketServer
  private queue: fakeResponse[][]

  constructor() {
    this.queue = []
    this.httpServer = http.createServer((_request, response) => {
      response.writeHead(404)
      response.end()
    })

    this.server = new WebSocketServer({
      server: this.httpServer,
    })

    this.server.on('connection', (socket) => {
      socket.on('message', (data: Buffer) => {
        const next = this.queue.shift()
        if (next == undefined) {
          // do nothing
        } else {
          for (const msgOrFun of next) {
            if (typeof msgOrFun == 'function') {
              msgOrFun(data)
              return
            }

            const msg = msgOrFun

            const msgType = getTypeFromString(msg.$type)

            if (msgType == getTypeFromString(SatInStartReplicationResp.$type)) {
              // do nothing
            }

            if (msgType == getTypeFromString(SatAuthResp.$type)) {
              socket.send(
                Buffer.concat([
                  getSizeBuf(msg),
                  SatAuthResp.encode(msg as SatAuthResp).finish(),
                ])
              )
            }

            if (msgType == getTypeFromString(SatInStartReplicationResp.$type)) {
              socket.send(
                Buffer.concat([
                  getSizeBuf(msg),
                  SatInStartReplicationResp.encode(
                    msg as SatInStartReplicationResp
                  ).finish(),
                ])
              )
              const req = SatInStartReplicationReq.fromPartial({})
              socket.send(
                Buffer.concat([
                  getSizeBuf(req),
                  SatInStartReplicationReq.encode(
                    req as SatInStartReplicationReq
                  ).finish(),
                ])
              )
            }

            if (msgType == getTypeFromString(SatInStopReplicationResp.$type)) {
              socket.send(
                Buffer.concat([
                  getSizeBuf(msg),
                  SatInStopReplicationResp.encode(
                    msg as SatInStopReplicationResp
                  ).finish(),
                ])
              )
            }

            if (msgType == getTypeFromString(SatRelation.$type)) {
              socket.send(
                Buffer.concat([
                  getSizeBuf(msg),
                  SatRelation.encode(msg as SatRelation).finish(),
                ])
              )
            }

            if (msgType == getTypeFromString(SatOpLog.$type)) {
              socket.send(
                Buffer.concat([
                  getSizeBuf(msg),
                  SatOpLog.encode(msg as SatOpLog).finish(),
                ])
              )
            }

            if (msgType == getTypeFromString(SatPingReq.$type)) {
              socket.send(
                Buffer.concat([
                  getSizeBuf(msg),
                  SatPingReq.encode(msg as SatPingReq).finish(),
                ])
              )
            }

            if (msgType == getTypeFromString(SatPingResp.$type)) {
              socket.send(
                Buffer.concat([
                  getSizeBuf(msg),
                  SatPingResp.encode(msg as SatPingResp).finish(),
                ])
              )
            }
          }
        }
      })

      // socket.on('close', function (_reasonCode, _description) { });

      socket.on('error', (error) => console.error(error))
    })
  }

  start() {
    this.httpServer.listen(PORT, IP)
  }

  close() {
    this.server.close()
    this.httpServer.close()
  }

  nextResponses(messages: (SatPbMsg | ((data?: Buffer) => void))[]) {
    this.queue.push(messages)
  }
}
