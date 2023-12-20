import path from 'path'
import * as fs from 'fs/promises'
import Database from 'better-sqlite3'
import { electrify } from 'electric-sql/node'
import { ShapeManager } from 'electric-sql/client/model'
import { DbSchema, ElectricClient } from 'electric-sql/client/model'
import { fetchMigrations, loadMigrationsMetaData } from 'electric-sql/cli/migrations'
import { Server } from './ipc/server.js'

const POLLING_INTERVAL = 1000 // ms

export class SideCar {
  private electric: ElectricClient<any> | undefined
  private shapeManager: ShapeManager | undefined
  private endpoint: string
  private electrifiedTables: Set<string> = new Set()
  
  constructor(private dbFile: string, private ELECTRIC_URL: string, private authToken: string, private ipc: Server) {
    this.endpoint = ELECTRIC_URL + '/api/migrations?dialect=sqlite'
  }

  async start(): Promise<void> {
    const config = {
      auth: {
        token: this.authToken,
      },
      url: this.ELECTRIC_URL,
    }
  
    const conn = new Database(this.dbFile)
    const schema = new DbSchema({}, []) // empty DB schema, we won't use the client anyway
    this.electric = await electrify(conn, schema, config)

    const shapeManager = new ShapeManager(this.electric.satellite)
    this.shapeManager = shapeManager

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

    // Poll for new migrations
    this.pollMigrations()
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
    // @ts-ignore - this is a private method that should be exposed by Satellite
    await this.electric?.satellite.mutexSnapshot()
  }

  /**
   * Polls Electric's migration endpoint for new migrations.
   * If there are new electrified tables we will sync them.
   */
  async pollMigrations(): Promise<void> {
    // Create a unique temporary folder in which to save the migrations
    const tmpFolder = await fs.mkdtemp('.electric_migrations_tmp_')

    try {
      const migrationsPath = path.join(tmpFolder, 'migrations')
      await fs.mkdir(migrationsPath)
      const migrationsFolder = path.resolve(migrationsPath)

      const newMigrations = await fetchMigrations(this.endpoint, migrationsFolder, tmpFolder)
      if (newMigrations) {
        // there are new migrations
        // check for new electrified tables
        const migrations = await loadMigrationsMetaData(migrationsFolder)
        const newTables: Array<string> = []
        migrations.forEach(
          m => m.ops.forEach(
            op => {
              const tableName = op.table?.name
              if (tableName && !this.electrifiedTables.has(tableName)) {
                // we have a new electrified table
                this.electrifiedTables.add(tableName)
                newTables.push(tableName)
              }
            }
          )
        )

        // sync the new tables
        if (newTables.length > 0) {
          if (!this.shapeManager) throw new Error('ShapeManager is not initialized')
          const joinedNames = newTables.join(', ')
          console.log(`Syncing tables ${joinedNames}...`)
          const { synced } = await this.shapeManager?.sync({ tables: newTables })
          await synced
          console.log(`Synced tables ${joinedNames}`)
        }
      }
    } finally {
      // Delete our temporary directory
      await fs.rm(tmpFolder, { recursive: true })
      // We use `setTimeout` instead of `setInterval`
      // because `setInterval` does not wait for this
      // async function to finish.
      setTimeout(this.pollMigrations.bind(this), POLLING_INTERVAL)
    }
  }
}