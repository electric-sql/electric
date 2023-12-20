import { argv } from 'process'
import * as readline from 'readline'
import Database from 'better-sqlite3'
import { genUUID } from 'electric-sql/util'
import { Client } from './ipc/client.js'
import { SocketIPC } from './ipc/socket.js'

export const main = async (ipc: Client) => {
  const args = argv.slice(2)

  if (args.length !== 1) {
    console.log('Wrong number of arguments.\nUsage: node index.js <db file>')
    process.exit(1)
  }

  const [dbFile] = args
  const db = new Database(dbFile)
  let items: Array<string> = []

  const arrayEquals = (a: Array<unknown>, b: Array<unknown>) => {
    return a.length === b.length &&
      a.every((element, index) => element === b[index])
  }

  let loggedMissingTable = false
  let replLaunched = false

  // Start the IPC client and re-read the items table when a data changed message is received
  await ipc.start()
  ipc.onDataChange(readTable)

  // Initial read of the items table
  readTable()

  async function readTable() {
    try {
      const newItems = ((await db.prepare('SELECT value FROM items').all()) as Array<{ value: string }>).map(item => item.value)
      if (!arrayEquals(items, newItems)) {
        items = newItems
        console.log('\n⚡ Items:\n' + items.map(item => '    ' + item).join('\n'))
        repl()
        replLaunched = true
      }
      else if (!replLaunched) {
        repl()
        replLaunched = true
      }
    } catch (_e: any) {
      // query may fail if the DB does not yet contain the `items` table
      // i.e. if the DB has not yet been migrated
      if (!loggedMissingTable) {
        // log this message once
        console.log("(info) items table does not exist yet")
        loggedMissingTable = true
      }
    }
  }

  async function addItem(): Promise<void> {
    const value = genUUID()
    await db.prepare('INSERT INTO items (value) VALUES (?)').run(value)
    // Notify the sidecar that the data potentially changed
    await ipc.notifyPotentialDataChange()
  }

  async function clearItems(): Promise<void> {
    await db.prepare('DELETE FROM items').run()
    // Notify the sidecar that the data potentially changed
    await ipc.notifyPotentialDataChange()
  }

  // Read user input to add/clear items
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const repl = async () => {
    rl.question('⚡ add, clear, or quit? ', async (answer) => {
      const input = answer.toLowerCase()
      switch (input) {
        case 'add':
          await addItem()
          break
        case 'clear':
          await clearItems()
          break
        case 'quit':
          rl.close()
          await ipc.stop()
          console.log('⚡ Bye!')
          process.exit(0)
        default:
          console.log('Unknown command: ' + input)
          repl()
      }
    })
  }
}

main(new SocketIPC())