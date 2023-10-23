import React, { useEffect, useRef, useState } from 'react'

import { useLiveQuery } from 'electric-sql/react'
import { uuid } from 'electric-sql/util'

import api from '../../api'
import { App, CloudApp, LatencyWidget } from '../../components'
import { useElectric } from '../../electric'
import { useDemoContext } from '../../session'
import { timeResolution } from '../../util'

const newItem = (demo) => {
  return {
    id: uuid(),
    inserted_at: `${Date.now()}`,
    demo_id: demo.id,
    demo_name: demo.name,
    electric_user_id: demo.electric_user_id
  }
}

// The local-first component talks directly to the embedded SQLite database
// and naturally stays in sync.
const LocalFirst = () => {
  const { db } = useElectric()
  const { demo } = useDemoContext()

  const { results } = useLiveQuery(
    db.items.liveMany({
      where: {
        demo_name: demo.name,
        electric_user_id: demo.electric_user_id
      },
      orderBy: {
        inserted_at: 'asc'
      },
      take: 24
    })
  )

  // This next block is just to time the initial fetch latency.
  const [ t1, _ ] = useState(Date.now())
  const [ fetchLatency, setFetchLatency ] = useState(-1)
  useEffect(() => {
    if (results === undefined || fetchLatency > 0) {
      return
    }

    setFetchLatency(Date.now() - t1)
  }, [results])

  const add = async () => {
    await db.items.create({
      data: newItem(demo)
    })
  }

  const clear = async () => {
    await db.items.deleteMany({
      where: {
        demo_name: demo.name,
        electric_user_id: demo.electric_user_id
      }
    })
  }

  if (results === undefined || fetchLatency < 0) {
    return null
  }

  return (
    <LatencyWidget
        add={add}
        clear={clear}
        items={results}
        initialLatency={fetchLatency}
        itemColor="electric-green"
        title="Local-first"
    />
  )
}

// The client-first component talks to the backend using an API client and
// manually updates the local state (iff the request is successful).
const CloudFirst = () => {
  const { demo } = useDemoContext()
  const [ results, setResults ] = useState()
  const [ fetchLatency, setFetchLatency ] = useState(-1)
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const loadItems = async () => {
      const { elapsed, result } = await timeResolution(
        api.getItems({demo_id: demo.id})
      )

      if (!mountedRef.current) {
        return
      }

      const items = result !== undefined ? result : []

      setFetchLatency(elapsed)
      setResults(items)
    }

    loadItems()
  }, [])

  const add = async () => {
    const item = newItem(demo)
    const savedItem = await api.postItem({
      data: item
    })

    if (!mountedRef.current) {
      return
    }

    if (savedItem === undefined) {
      return
    }

    setResults([...results, savedItem])
  }

  const clear = async () => {
    const ok = await api.deleteItem({
      data: {
        demo_id: demo.id
      }
    })

    if (!mountedRef.current || !ok) {
      return
    }

    setResults([])
  }

  if (results === undefined) {
    return null
  }

  return (
    <LatencyWidget
        add={add}
        clear={clear}
        items={results.slice(0, 24)}
        title="Cloud-first"
        initialLatency={fetchLatency}
        itemColor="script-red"
        disableWhenInProgress={true}
    />
  )
}

const Demo = () => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
      <div className="px-3 md:px-4">
        <App dbName="user1" demoName="local-first" bootstrapItems={4}>
          <LocalFirst />
        </App>
      </div>
      <div className="px-3 md:px-4">
        <CloudApp demoName="cloud-first" bootstrapItems={4}>
          <CloudFirst />
        </CloudApp>
      </div>
    </div>
  )
}

export default Demo
