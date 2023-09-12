import * as http from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { getBufWithMsgTag, GetName, SatPbMsg } from '../../src/util/proto'
import {
  messageTypeRegistry,
  UnknownMessage,
} from '../../src/_generated/typeRegistry'
import {
  Root,
  SatErrorResp,
  SatInStartReplicationReq,
  SatRpcRequest,
  SatRpcResponse,
} from '../../src/_generated/protocol/satellite'
import { toMessage } from '../../src/satellite/client'
import { ExecutionContext } from 'ava'
import { sleepAsync } from '../../src/util'

const PORT = 30002
const IP = '127.0.0.1'

type NonRpcMessage = Exclude<SatPbMsg, SatRpcRequest>

type RpcResponseBody = Awaited<ReturnType<Root[keyof Root]>> | SatErrorResp
type RegularResponse<T extends NonRpcMessage> =
  | SatPbMsg[]
  | ((msg: T) => SatPbMsg[] | void)
export type RpcResponse<K extends keyof Root> = [
  Awaited<ReturnType<Root[K]>> | SatErrorResp,
  ...SatPbMsg[]
]
type RpcResponseOrMatch<K extends keyof Root> =
  | RpcResponse<K>
  | ((msg: Uint8Array) => RpcResponse<K> | Promise<RpcResponse<K>>)

type RegularExpectation<T extends NonRpcMessage> = [
  T['$type'],
  RegularResponse<any>
]

export class SatelliteWSServerStub {
  private httpServer: http.Server
  private server: WebSocketServer
  private nonRpcExpectations: RegularExpectation<NonRpcMessage>[] = []
  private rpcResponses = new Map<
    keyof Root | `${keyof Root}/${number}`,
    RpcResponseOrMatch<keyof Root>[]
  >()
  private socket!: WebSocket

  constructor(private t: ExecutionContext) {
    this.httpServer = http.createServer((_request, response) => {
      response.writeHead(404)
      response.end()
    })
    this.server = new WebSocketServer({
      server: this.httpServer,
    })
    this.server.on('connection', (socket) => {
      socket.on('message', this.handleMessage.bind(this))
      socket.on('error', (err) => console.error(err))
      this.socket = socket
    })
  }

  private async handleMessage(data: Buffer) {
    const request = toMessage(data)

    if (request.$type === 'Electric.Satellite.SatRpcRequest') {
      // Get expected RPC response, prioritizing known request IDs
      const expected =
        this.rpcResponses
          .get(`${request.method as keyof Root}/${request.requestId}`)
          ?.shift() ??
        this.rpcResponses.get(request.method as keyof Root)?.shift()

      if (expected === undefined) return

      const [rpcBody, ...messages] =
        typeof expected === 'function'
          ? await expected(request.message)
          : expected

      // Special-case StartReplication to also start it the other way
      if (rpcBody.$type === 'Electric.Satellite.SatInStartReplicationResp') {
        const message = SatInStartReplicationReq.create()

        const request = SatRpcRequest.create({
          method: 'startReplication',
          requestId: 1,
          message: encode(message),
        })

        messages.unshift(request)
      }

      this.socket.send(writeMsg(wrapRpcResponse(request, rpcBody)))

      await sleepAsync(50)

      for (const message of messages) {
        this.socket.send(writeMsg(message))
      }
    } else {
      // Regular message handlers
      // const expected = this.regularResponses.get(getShortName(request))?.shift()

      const expected = this.nonRpcExpectations.shift()
      if (expected === undefined) return

      const [msgType, responses] = expected

      if (!this.t.is(request.$type, msgType)) {
        throw new Error(
          `Expected request type ${msgType} but got ${request.$type}`
        )
      }

      const messageQueue =
        typeof responses === 'function' ? responses(request) ?? [] : responses

      for (const message of messageQueue) {
        this.socket.send(writeMsg(message))
      }
    }
  }
  start() {
    this.httpServer.listen(PORT, IP)
  }

  close() {
    this.server.close()
    this.httpServer.close()
  }

  /** Expect next non-RPC message received by the server to match `type`, and either send `responses` arg directly or execute as a function */
  nextMsgExpect<
    K extends GetName<NonRpcMessage>,
    T extends NonRpcMessage & { $type: `Electric.Satellite.${K}` }
  >(type: K, responses: RegularResponse<T>) {
    this.nonRpcExpectations.push([`Electric.Satellite.${type}`, responses])
  }

  /**
   * Set next response to a given RPC method, optionally with `/n` suffix to match on request ID.
   *
   * - If `responses` is an array, then it's sent directly, with first element being an RPC response
   * and the rest being regular messages sent immediately as a follow-up.
   * - If `responses` is a function, then it's called with the decoded body of RPC request, and it's
   * return value is expected to be an array with same semantics as in the previous point.
   */
  nextRpcResponse<K extends keyof Root>(
    method: K | `${K}/${number}`,
    responses: RpcResponseOrMatch<K>
  ) {
    const queue = this.rpcResponses.get(method)
    if (queue) queue.push(responses)
    else this.rpcResponses.set(method, [responses])
  }
}

const encode = (msg: UnknownMessage) =>
  messageTypeRegistry.get(msg.$type)!.encode(msg).finish()

const writeMsg = (msg: SatPbMsg) =>
  Buffer.concat([getBufWithMsgTag(msg), encode(msg)])

function wrapRpcResponse(
  request: SatRpcRequest,
  body: RpcResponseBody
): SatRpcResponse {
  return SatRpcResponse.create({
    method: request.method,
    requestId: request.requestId,
    message:
      body.$type !== 'Electric.Satellite.SatErrorResp'
        ? encode(body)
        : undefined,
    error: body.$type === 'Electric.Satellite.SatErrorResp' ? body : undefined,
  })
}
