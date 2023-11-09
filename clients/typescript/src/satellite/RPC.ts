import {
  Root,
  SatErrorResp,
  SatRpcRequest,
  SatRpcResponse,
} from '../_generated/protocol/satellite.js'
import { SatelliteError, SatelliteErrorCode } from '../util/types.js'
import { emptyPromise } from '../util/common.js'
import Log, { Logger } from 'loglevel'
import {
  ClientRpcResponse,
  encodeRpcResponse,
  msgToString,
} from '../util/index.js'
import { isDebuggingNode } from '../util/debug/index.js'

type RequestId = `${string}/${number}`
type SenderFn = (msg: SatRpcRequest | SatRpcResponse) => void

/**
 * Wrapper class that exposes a `request` method for generated RPC services to use.
 *
 * Any `SatRpcResponse` messages should be forwarded to this class to be correctly marked
 * as fulfilled.
 */
export class RPC {
  /** Monotonically increasing request id */
  private nextRequestId = 1
  /** Known pending requests and the promise resolvers for them */
  private pendingRequests = new Map<
    RequestId,
    {
      resolve: (value: Uint8Array) => void
      reject: (reason?: any) => void
      timer: any
    }
  >()
  /** Set of request identifiers that had timed out, for better errors */
  private timedOutCalls = new Set<RequestId>()

  constructor(
    private sender: SenderFn,
    private defaultTimeout: number,
    private log: Log.Logger
  ) {}

  /**
   * Perform given RPC method using given message as data.
   *
   * This fulfills unexported generated interface `RPC` in `_generated/protocol/satellite.ts`.
   * The generated service instance expects to pass in an already-encoded message because RPC
   * is assumed to be part of the transport and not the protocol. Service instance also expects
   * to receive a still-encoded response.
   *
   * The details of the RPC contract are available in `.proto` file for the Satellite protocol,
   * but the gist is that there are two special messages in the Satellite protocol: `SatRpcRequest`
   * and `SatRpcResponse` that facilitate the call.
   */
  public request(
    _service: string,
    method: string,
    message: Uint8Array
  ): Promise<Uint8Array> {
    const requestId = this.nextRequestId++

    const request = SatRpcRequest.create({
      method,
      requestId,
      message,
    })

    // This line may throw, which is why setting global state is done right after
    this.sender(request)

    const { promise, resolve, reject } = emptyPromise<Uint8Array>()
    let timer: any = 0

    // Don't time requests out if debugger is attached to Node instance
    if (!isDebuggingNode) {
      timer = setTimeout(
        () => this.timedOut(`${method}/${requestId}`),
        this.defaultTimeout
      )
    }
    this.pendingRequests.set(`${method}/${requestId}`, {
      reject,
      resolve,
      timer,
    })

    return promise
  }

  /**
   * Handle RPC response, dispatching it to the appropriate listener if relevant
   */
  public handleResponse(rpc: SatRpcResponse) {
    const callIdentifier: RequestId = `${rpc.method}/${rpc.requestId}`
    const pending = this.pendingRequests.get(callIdentifier)
    if (pending) {
      if (rpc.message) {
        pending.resolve(rpc.message)
      } else {
        this.log.warn(
          `RPC call ${callIdentifier} failed with ${msgToString(rpc.error!)}`
        )
        pending.reject(rpc.error)
      }
      this.clearAndDelete(callIdentifier)
    } else if (this.timedOutCalls.has(callIdentifier)) {
      this.timedOutCalls.delete(callIdentifier)
      this.log.warn(`Got an RPC response for ${callIdentifier} after timeout`)
    } else {
      this.log.warn(`Got an unexpected RPC response for ${callIdentifier}`)
    }
  }

  private clearAndDelete(callIdentifier: RequestId) {
    const pending = this.pendingRequests.get(callIdentifier)

    if (pending) {
      clearTimeout(pending.timer)
      this.pendingRequests.delete(callIdentifier)
    }
  }

  private timedOut(callIdentifier: RequestId) {
    const pending = this.pendingRequests.get(callIdentifier)

    if (pending) {
      this.log.error(
        `Timed out after ${this.defaultTimeout}ms while waiting for RPC response to ${callIdentifier}`
      )
      this.timedOutCalls.add(callIdentifier)
      pending.reject(
        new SatelliteError(SatelliteErrorCode.TIMEOUT, callIdentifier)
      )
      this.clearAndDelete(callIdentifier)
    }
  }
}

/**
 * Build an RPC responder to reply to server-sent RPC requests.
 *
 * The responder function itself just correctly wraps the result or error in
 * a SatRpcResponse object, and then sends it.
 *
 * @param send function to send the response to the server
 * @returns function that builds and sends the RPC response
 */
export const rpcRespond =
  (send: SenderFn) =>
  (req: SatRpcRequest, respOrError: ClientRpcResponse | SatErrorResp) => {
    const error =
      respOrError.$type === 'Electric.Satellite.SatErrorResp'
        ? respOrError
        : undefined
    const message =
      respOrError.$type !== 'Electric.Satellite.SatErrorResp'
        ? encodeRpcResponse(respOrError)
        : undefined

    send(
      SatRpcResponse.create({
        requestId: req.requestId,
        method: req.method,
        message,
        error,
      })
    )
  }

/**
 * Wrap an RPC service instance to log decoded RPC request & response
 *
 * `proto-ts`-generated server instance passes to and expects to receive from
 * the RPC client an already encoded request/response object. To centrally log the decoded
 * version of the object, we wrap the service with a proxy, logging the yet-decoded request
 * before the function call and already-decoded response from the function return.
 *
 * @param service Service instance to wrap
 * @returns A proxy around the service instance
 */
export function withRpcRequestLogging(service: Root, logger: Logger): Root {
  return new Proxy(service, {
    get(target, p, _receiver) {
      if (typeof target[p as keyof Root] === 'function') {
        return new Proxy(target[p as keyof Root], {
          apply(target, thisArg, argArray) {
            if (logger.getLevel() <= 1)
              logger.debug(`[rpc] send: ${msgToString(argArray[0])}`)
            // All methods on the `RootClientImpl` service return promises that contain the response, so we can do this if we return the value
            return Reflect.apply(target, thisArg, argArray).then(
              (x: Awaited<ReturnType<Root[keyof Root]>>) => {
                if (logger.getLevel() <= 1)
                  logger.debug(`[rpc] recv: ${msgToString(x)}`)
                return x
              }
            )
          },
        })
      } else {
        return Reflect.get(target, p)
      }
    },
  })
}
