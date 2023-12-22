import Database from 'better-sqlite3'
import { electrify } from 'electric-sql/node'
import { ShapeManager } from 'electric-sql/client/model'
import { DbSchema, ElectricClient } from 'electric-sql/client/model'
import { Server } from './ipc/server.js'
import { HydratedConfig, Shape } from './util/config.js'

export class SideCar {
  private electric?: ElectricClient<any>
  private shapeManager?: ShapeManager
  
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

    const shapeManager = new ShapeManager(this.electric.satellite)
    this.shapeManager = shapeManager

    // Sync shapes
    await this.syncShapes()

    // Start IPC
    await this.ipc.start()

    // Perform snapshot on potential data change
    await this.ipc.onPotentialDataChange(
      this.performSnapshot.bind(this)
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

  async performSnapshot(): Promise<void> {
    await this.electric?.satellite.mutexSnapshot()
  }

  async syncShapes(): Promise<void> {
    if (!this.shapeManager) {
      throw new Error("Shape manager not initialized")
    }

    const { sync: tables } = this.config
    const joinedNames = tables.join(', ')
    console.log(`Syncing tables ${joinedNames}...`)
    const { synced } = await this.shapeManager.sync({ tables })
    await synced
    console.log(`Synced tables ${joinedNames}`)
  }
}