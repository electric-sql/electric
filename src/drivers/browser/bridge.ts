import { randomValue } from '../../util/random'
import { AnyFunction, DbName, StatementId } from '../../util/types'
import { ElectrifyOptions } from '../../electric/index'
import { ElectricDatabase } from './database'

declare global {
  interface Worker {
    user_defined_functions?: {
      [key: string]: (...args: any[]) => any
    }
  }
}

export interface ServerMethod {
  target: 'server'
  name: 'init' | 'open' | '_get_test_data'
}

export interface DbMethod {
  target: 'db'
  dbName: DbName
  name: string
}

export interface StatementMethod {
  target: 'statement'
  dbName: DbName
  statementId: StatementId,
  name: string
}

type RequestMethod = ServerMethod | DbMethod | StatementMethod

export interface Request {
  args: any[]
  method: RequestMethod,
  requestId: string
}

export class RequestError extends Error {
  code: number

  constructor(code: number, message: string) {
    super(message);
    this.code = code
    this.name = "RequestError"
  }
}

export interface Response {
  status: 'error' | 'success'
  result?: any
  requestId: string
}

// Used by the main thread to send requests to the the worker.
export class WorkerClient {
  worker: Worker

  addListener: AnyFunction
  removeListener: AnyFunction
  postMessage: AnyFunction

  constructor(worker: Worker) {
    this.worker = worker

    this.addListener = worker.addEventListener.bind(worker)
    this.removeListener = worker.removeEventListener.bind(worker)
    this.postMessage = worker.postMessage.bind(worker)
  }

  request(method: RequestMethod, ...args: any[]): Promise<any> {
    const requestId = randomValue()
    const data = {
      args: args,
      method: method,
      requestId: requestId
    }

    const addListener = this.addListener
    const removeListener = this.removeListener
    const postMessage = this.postMessage

    return new Promise((resolve: AnyFunction, reject: AnyFunction) => {
      const handleResponse = (event: MessageEvent): any => {
        const resp: Response = event.data

        if (resp.requestId !== requestId) {
          return
        }

        removeListener('message', handleResponse)

        const { result, status } = resp
        status === 'error' ? reject(result) : resolve(result)
      }

      addListener('message', handleResponse)
      postMessage(data)
    })
  }
}

// Run in the worker thread to handle requests from the main thread.
// Routes messages according to the method interfaces above.
//
// - ServerMethod => this.init / this.open
// - DbMethod => this._dbs[dbName].method
// - StatementMethod => this._dbs[dbName]._getStatement(id).method
//
// It's abstract because we extend with concrete implementations
// for the open and init methods and an implementatin specific
// start method.
export abstract class BaseWorkerServer {
  SQL?: any

  worker: Worker
  opts: ElectrifyOptions

  _dbs: {
    [key: DbName]: ElectricDatabase
  }

  constructor(worker: Worker, opts: ElectrifyOptions) {
    this.worker = worker
    this.opts = opts
    this._dbs = {}

    this.worker.addEventListener('message', this.handleCall.bind(this))
  }

  async handleCall(event: MessageEvent) {
    const data = event.data as Request
    const { requestId, method, args } = data

    try {
      const boundTargetFn = this._getTargetFunction(method)
      if (boundTargetFn === undefined) {
        throw new RequestError(405, `Method not found: \`${method}\`.`)
      }

      const result = await boundTargetFn(...args)

      this._dispatchResult(requestId, result)
    }
    catch (err) {
      this._dispatchError(requestId, err)
    }
  }

  _dispatchError(requestId: string, error: any) {
    const resp: Response = {
      status: 'error',
      result: error,
      requestId: requestId
    }

    this.worker.postMessage(resp)
  }

  _dispatchResult(requestId: string, result: any) {
    const resp: Response = {
      status: 'success',
      result: result,
      requestId: requestId
    }

    this.worker.postMessage(resp)
  }

  _getBound(target: any, methodName: string): AnyFunction | undefined {
    if (target === undefined) {
      return
    }

    const fn = Reflect.get(target, methodName)

    if (typeof fn !== 'function') {
      return
    }

    return fn.bind(target)
  }

  _getDb(dbName: DbName): ElectricDatabase | undefined {
    return this._dbs[dbName]
  }

  _getTargetFunction(method: RequestMethod): AnyFunction | void {
    if (method.target === 'server') {
      return this._getBound(this, method.name)
    }

    const db = this._getDb(method.dbName)
    if (db === undefined) {
      throw new RequestError(500, 'Database not open')
    }

    if (method.target === 'db') {
      return this._getBound(db, method.name)
    }

    if (method.target === 'statement') {
      const statement = db._getStatement(method.statementId)

      return this._getBound(statement, method.name)
    }
  }

  static start(_worker: Worker, _opts: ElectrifyOptions = {}): void {
    throw new Error('Sub-classes must implement `WorkerServer.start`')
  }
}
