import Database from 'better-sqlite3'
import { electrify } from 'electric-sql/node'
import { DbSchema, ElectricClient } from 'electric-sql/client/model'
import { Server } from './ipc/server.js'
import { HydratedConfig } from './util/config.js'

export class SideCar {
  private electric?: ElectricClient<any>
  
  constructor(private config: HydratedConfig, private ipc: Server) {}

  async start(): Promise<void> {
    const config = {
      auth: {
        token: this.config.auth.token,
      },
      url: this.config.service,
    }
  
    const conn = new Database(this.config.databaseFile)
    const schema = new DbSchema({}, []) // empty DB schema, we won't use the client anyway
    this.electric = await electrify(conn, schema, config)

    // Sync shapes
    await this.syncShapes()

    // Start IPC
    await this.ipc.start()

    // Perform snapshot on potential data change
    await this.ipc.onPotentialDataChange(
      this.potentiallyChanged.bind(this)
    )

    // Notify clients of actual data changes
    this.electric.notifier.subscribeToDataChanges(
      this.ipc.notifyDataChanged.bind(this.ipc)
    )
  }

  async stop(): Promise<void> {
    await Promise.all(
      [
        this.electric?.close(),
        this.ipc.stop(),
      ]
    )
  }

  private async potentiallyChanged(): Promise<void> {
    await this.electric?.notifier.potentiallyChanged()
  }

  private async syncShapes(): Promise<void> {
    // Convert the shape to the format expected by the Satellite process
    const { sync: tables } = this.config
    const shapeDef = {
      selects: tables.map((tbl) => ({ tablename: tbl })),
    }
    
    const joinedNames = tables.join(', ')
    console.log(`Syncing tables ${joinedNames}...`)

    const { synced } = await this.electric!.satellite.subscribe([shapeDef])
    await synced
    
    console.log(`Synced tables ${joinedNames}`)
  }
}