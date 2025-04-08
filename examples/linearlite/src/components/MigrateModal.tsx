import { PGlite } from '@electric-sql/pglite'
import Modal from './Modal'
import { usePGlite } from '@electric-sql/pglite-react'
import { pgDump } from '@electric-sql/pglite-tools/pg_dump'
import { useState, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'

import { PGlite as PGlite03 } from "pglite-03"

interface Props {
  isOpen: boolean
  onDismiss?: () => void
}

export default function PGliteMigrateModal({ isOpen, onDismiss }: Props) {
  const pg = usePGlite()

  const [postgresqlVersion, setPGVersion] = useState<string | undefined>(undefined)
  const [migrationInProgress, setMigrationInProgress] = useState<boolean>(false)

  useEffect(() => {
      pg.query<{ version: string}> ('SELECT version();').then((result) => {
        const version = result.rows[0].version
        if (version.includes('PostgreSQL 17.4')) {
          setPGVersion('17.4')
        } else if (version.includes('PostgreSQL 16.4')) {
          setPGVersion('16.4')
        }
      }) 
  })


  const migrate = async () => {
    setMigrationInProgress(true)
    const dataDirName = `linearlite2_pglite_next_${uuidv4()}`

    const dbDeletePromise = new Promise<void>((resolve, reject) => {

      const request = indexedDB.deleteDatabase(`/pglite/${dataDirName}`);
      
      request.onerror = function(event) {
        console.log("Error deleting database.");
        resolve()
      };
      
      request.onsuccess = function(event) {
        console.log("Database deleted successfully.");
        resolve()
      };
    })

    await dbDeletePromise

    const currentVersion = await pg.query<{ version: string}> ('SELECT version();')

    console.log(currentVersion.rows[0].version)

    const dumpDir = await pg.dumpDataDir('none');
    const pgCurr = await PGlite.create({loadDataDir: dumpDir});
    const dumpResult = await pgDump({pg: pgCurr});

    const pgNext = await PGlite03.create({
      dataDir: `idb://${dataDirName}`,
    })

    pgNext.exec(await dumpResult.text())
    await pgNext.exec('SET SEARCH_PATH = public;')

    const nextVersion = await pg.query<{ version: string}> ('SELECT version();')
    console.log(nextVersion.rows[0].version)

    setTimeout(() => {
      setMigrationInProgress(false)
      window.location.href = `/?noSync=true&dataDirName=${dataDirName}&usePGnext=true`;
    }, 100);
  }

  return (
    <Modal
      title="PGlite migrate"
      isOpen={isOpen}
      onDismiss={onDismiss}
      size="large"
    >
      <div className="flex flex-col w-full h-100 p-4">
        <h3 className="text-lg font-semibold mb-2">This is demo of migrating a PGlite database via pg_dump.</h3>
        <div className="mb-6">
            {
                postgresqlVersion === '17.4' && 
                <>
                    <p>You are already at the latest version.</p>
                </>
            }
            {
                postgresqlVersion === '16.4' && 
                <>
                    <h3 className="text-lg mb-2">Migrate from PGlite 0.2.7 to PGlite 0.3.0</h3>
                    <button onClick={migrate}
                    disabled={migrationInProgress}
                    className="ml-2 px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
                    >
                        Migrate & reload with no sync
                    </button>
                </>
              }
        </div>
      </div>
    </Modal>
  )
}
