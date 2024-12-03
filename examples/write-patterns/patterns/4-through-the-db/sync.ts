import { type Operation } from '@electric-sql/client'
import { type PGliteWithLive } from '@electric-sql/pglite/live'

import api from '../../shared/app/client'

type TransactionId = string

type Change = {
  operation: Operation
  value: {
    id: string
    title?: string
    completed?: boolean
    created_at?: Date
  }
  transaction_id: TransactionId
}

type SendResult =
  'accepted' |
  'rejected' |
  'retry'

/*
 * Minimal, naive synchronization utility, just to illustrate the pattern of
 * `listen` to `changes` and `POST` them to the api server.
 */
export default class LocalChangeSynchronizer {
  #db: PGliteWithLive
  #position: TransactionId

  #status: 'idle' | 'processing' = 'idle'
  #hasChangedWhileProcessing: boolean = false

  #unsubscribe?: () => Promise<void>
  #shouldContinue: boolean = true

  constructor(db: PGliteWithLive, position = '0') {
    console.log('new LocalChangeSynchronizer', db)

    this.#db = db
    this.#position = position
  }

  /*
   * Start by listening for notifications.
   */
  async start(): Promise<void> {
    console.log('start')

    this.#unsubscribe = await this.#db.listen('p4_changes', this.handle.bind(this))

    this.process()
  }

  /*
   * On notify, either kick off processing or note down that there were changes
   * so we can process them straightaway on the next loop.
   */
  async handle(): Promise<void> {
    console.log('handle')

    if (this.#status === 'processing') {
      this.#hasChangedWhileProcessing = true

      return
    }

    this.process()
  }

  // Process the changes by fetching them and posting them to the server.
  // If the changes are accepted then proceed, otherwise rollback or retry.
  async process(): Promise<void> {
    console.log('process', this.#position)

    this.#status === 'processing'
    this.#hasChangedWhileProcessing = false

    const { changes, position } = await this.query()

    if (changes.length) {
      const result: SendResult = await this.send(changes)

      switch (result) {
        case 'accepted':
          await this.proceed(position)

          break;

        case 'rejected':
          await this.rollback()

          break;

        case 'retry':
          this.#hasChangedWhileProcessing = true

          break;
      }
    }

    if (this.#hasChangedWhileProcessing && this.#shouldContinue) {
      return await this.process()
    }

    this.#status === 'idle'
  }

  /*
   * Fetch the current batch of changes
   */
  async query(): Promise<{ changes: Change[], position: TransactionId}> {
    console.log('query')

    const { rows } = await this.#db.sql<Change>`
      SELECT * from p4_changes
        WHERE transaction_id > ${this.#position}
        ORDER BY
          transaction_id asc,
          id asc
    `

    console.log('rows', rows)

    const position = rows.length
      ? rows.at(-1)!.transaction_id
      : this.#position

    return {
      changes: rows,
      position
    }
  }

  /*
   * Send the current batch of changes to the server, grouped by transaction.
   */
  async send(changes: Change[]): Promise<SendResult> {
    console.log('send', changes)

    const path = '/changes'

    const groups = Object.groupBy(changes, x => x.transaction_id)
    const sorted = Object.entries(groups).sort((a,b) => b[0].localeCompare(a[0]))
    const transactions = sorted.map(([transaction_id, changes]) => {
      return {
        id: transaction_id,
        changes: changes
      }
    })

    const response = await api.request(path, 'POST', transactions)

    if (response === undefined) {
      return 'retry'
    }

    if (response instanceof Response) {
      return response.status < 500 ? 'rejected' : 'retry'
    }

    return 'accepted'
  }

  /*
   * Proceed by clearing the processed changes and moving the position forward.
   */
  async proceed(position: TransactionId): Promise<void> {
    console.log('proceed', position)

    await this.#db.sql`
      DELETE from p4_changes
        WHERE id <= ${position}
    `

    this.#position = position
  }

  /*
   * Rollback with an extremely naive strategy: if any write is rejected, simply
   * wipe the entire local state.
   */
  async rollback(): Promise<void> {
    console.log('rollback')

    await this.#db.transaction(async (tx) => {
      await tx.sql`DELETE from p4_changes`
      await tx.sql`DELETE from p4_todos_local`
    })
  }

  /*
   * Stop synchronizing
   */
  async stop(): Promise<void> {
    this.#shouldContinue = false

    if (this.#unsubscribe !== undefined) {
      await this.#unsubscribe()
    }
  }
}
