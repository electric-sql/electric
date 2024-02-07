import { useEffect, useState } from 'react'

import { LIB_VERSION } from 'electric-sql/version'
import { makeElectricContext, useLiveQuery } from 'electric-sql/react'
import { genUUID, uniqueTabId } from 'electric-sql/util'
import { ElectricDatabase, electrify } from 'electric-sql/wa-sqlite'

import { authToken } from './auth'
import { Electric, Issue, schema } from './generated/client'

import './Example.css'

const { ElectricProvider, useElectric } = makeElectricContext<Electric>()

export const Example = () => {
  const [electric, setElectric] = useState<Electric>()

  useEffect(() => {
    let isMounted = true

    const init = async () => {
      const config = {
        auth: {
          token: authToken()
        },
        debug: import.meta.env.DEV,
        url: import.meta.env.ELECTRIC_SERVICE
      }

      const { tabId } = uniqueTabId()
      const scopedDbName = `basic-${LIB_VERSION}-${tabId}.db`

      const conn = await ElectricDatabase.init(scopedDbName)
      const electric = await electrify(conn, schema, config)

      if (!isMounted) {
        return
      }

      setElectric(electric)
    }

    init()

    return () => {
      isMounted = false
    }
  }, [])

  if (electric === undefined) {
    return null
  }

  return (
    <ElectricProvider db={electric}>
      <ExampleComponent />
    </ElectricProvider>
  )
}

const ExampleComponent = () => {
  const { db } = useElectric()!
  window.db = db
  const { results } = useLiveQuery(
    db.issue.liveMany()
  )

  useEffect(() => {
    const syncIssues = async () => {
      // Resolves when the shape subscription has been established.
      const shape = await db.issue.sync()

      // Resolves when the data has been synced into the local database.
      await shape.synced
    }

    syncIssues()
  }, [])

  const addIssue = async () => {
    await db.issue.create({
      data: {
        id: genUUID(),
        title: "foo title",
        description: "...",
        priority: "1",
        status: "(no status)",
        modified: "" + new Date(),
        created: "" + new Date(),
        kanbanorder: "4",
        username: genUUID(),
      }
    })
  }

  const clearIssues = async () => {
    await db.issue.deleteMany()
  }

  const issues: Issue[] = results ?? []

  return (
    <div>
      <div className="controls">
        <button className="button" onClick={addIssue}>
          Add
        </button>
        <button className="button" onClick={clearIssues}>
          Clear
        </button>
      </div>
      {issues.map((issue: Issue, index: number) => (
        <p key={index} className="item">
          <code>{issue.username}</code>
        </p>
      ))}
    </div>
  )
}
