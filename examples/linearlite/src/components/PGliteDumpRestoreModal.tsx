import { PGlite } from '@electric-sql/pglite'
import Modal from './Modal'
import { usePGlite } from '@electric-sql/pglite-react'
import { pgDump } from '@electric-sql/pglite-tools/pg_dump'
import { useState, useRef, useEffect, useCallback } from 'react'
import { v4 as uuidv4 } from 'uuid'

interface Props {
  isOpen: boolean
  onDismiss?: () => void
}

export default function PGliteDumpRestoreModal({ isOpen, onDismiss }: Props) {
  const pg = usePGlite()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dump, setDump] = useState<any>()
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [status, setStatus] = useState<string>('')
  const [restoreStatus, setRestoreStatus] = useState<string>('not_started')

  const doDump = async () => {
    setStatus('Dumping database...');
    try {
      const dumpDir = await pg.dumpDataDir('none');
      const _pg = await PGlite.create({loadDataDir: dumpDir, debug: 5});
      const dumpResult = await pgDump({pg: _pg});
      setDump(dumpResult);
      setStatus('Dump completed successfully');
    } catch (error) {
      console.error('Error creating dump:', error);
      setStatus('Failed to create dump');
    }
  }

  const downloadDump = () => {
    try {
      const url = URL.createObjectURL(dump);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'database-dump.sql';
      a.click();
      URL.revokeObjectURL(url);
      setStatus('Download started');
    } catch (error) {
      console.error('Error downloading dump:', error);
      setStatus('Failed to download dump');
    }
  }
  
  // Handle file selection
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      const file = event.target.files[0];
      setSelectedFile(file);
    }
  };
  
  const restore = async () => {
    if (selectedFile) {
      setRestoreStatus('running')
      
      const dataDirName = `linearlite2_${uuidv4()}`

      const dbDeletePromise = new Promise<void>((resolve, reject) => {

        const request = indexedDB.deleteDatabase(`/pglite/${dataDirName}`);
        
        request.onerror = function(event) {
          console.log("Error deleting database.");
          // hope for the best
          resolve()
        };
        
        request.onsuccess = function(event) {
          console.log("Database deleted successfully.");
          resolve()
        };
      })

      await dbDeletePromise

      const restoredPg = await PGlite.create({
        dataDir: `idb://${dataDirName}`,
      })
      const dumpText = await selectedFile.text()
      const execResult = await restoredPg.exec(dumpText)
      await restoredPg.exec('SET SEARCH_PATH = public;')
      setTimeout(() => {
        window.location.href = `/?noSync=true&dataDirName=${dataDirName}`;
      }, 100);
    }
  }

  return (
    <Modal
      title="PGlite Dump and Restore"
      isOpen={isOpen}
      onDismiss={onDismiss}
      size="large"
    >
      <div className="flex flex-col w-full h-100 p-4">
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-2">Database Dump</h3>
          <button 
            onClick={doDump}
            className="mb-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Generate Dump
          </button>
          
          {dump && (
            <button 
              onClick={downloadDump}
              className="ml-2 px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
            >
              Download Dump
            </button>
          )}
          {status && (
            <div className="text-sm text-gray-700 mb-2">{status}</div>
          )}
        </div>

        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-2">Upload SQL File</h3>
          <input 
            type="file" 
            id="file" 
            name="file" 
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".sql"
            className="mb-2"
          />
         
          { selectedFile &&
              <button onClick={restore}
              disabled={restoreStatus != 'not_started'}
              className="ml-2 px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
              >
                Restore dump & reload with no sync
              </button>
          }
        </div>
      </div>
    </Modal>
  )
}
