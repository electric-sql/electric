import React, { createContext, useContext } from 'react'

import { genUUID, sleepAsync } from 'electric-sql/util'

import api from './api'
import cache from './cache'
import { DB, Demo } from './electric'

const key = 'electric.intro.session:session_id'
export const ttl = 1_000 * 60 * 60 // one hour

export type DemoContextData = {
  demo: Demo,
  sessionId: string
}

export const DemoContext = createContext<DemoContextData>(null)

export const useDemoContext = () => {
  return useContext(DemoContext)
}

export const getOrCreateSessionId = (defaultSessionId: string) => {
  let sessionId

  const urlParams = new URLSearchParams(window.location.search)
  if (urlParams.has('sessionId')) {
    sessionId = urlParams.get('sessionId')

    cache.set(key, sessionId, ttl)
  }
  else {
    sessionId = cache.get(key)

    if (sessionId === null) {
      sessionId = defaultSessionId

      cache.set(key, sessionId, ttl)
    }
  }

  return sessionId
}

export const getCachedSessionId = () => {
  const sessionId = cache.get(key)

  if (sessionId === null) {
    throw 'Session ID not in cache. Is it set or do you have a race condition?'
  }

  return sessionId
}

export const ensureSessionId = () => {
  getOrCreateSessionId(genUUID())

  return
}

export const timeTilSessionExpiry = () => {
  const value = cache.getRaw(key)

  if (value === null) {
    return -1
  }

  const now = Date.now()
  return value.expiry - now
}

export const getOrCreateDemo = async (db: DB, sessionId: string, name: string, bootstrapItems?: number) => {
  let demo: Demo

  const ts = `${Date.now()}`

  demo = await db.demos.findFirst({
    where: {
      name: name,
      electric_user_id: sessionId
    },
    orderBy: {
      id: 'asc'
    }
  })

  if (demo !== null) {
    demo = await db.demos.update({
      where: {
        id: demo.id
      },
      data: {
        updated_at: ts
      }
    })
  }
  else {
    demo = await db.demos.create({
      data: {
        id: genUUID(),
        name: name,
        inserted_at: ts,
        updated_at: ts,
        electric_user_id: sessionId
      }
    })

    if (bootstrapItems) {
      const items = []
      const t1 = Date.now()

      for (let i = 0; i < bootstrapItems; i++) {
        items.push({
          id: genUUID(),
          inserted_at: `${t1 + i}`,
          demo_id: demo.id,
          demo_name: demo.name,
          electric_user_id: sessionId
        })
      }

      await db.items.createMany({
        data: items
      })
    }
  }

  return demo
}

// Used by the active-active intro page to fetch the same demo
// as the embedded example is using. It's a bit of a hack but it
// simplifies the psql insert items example ¯\_(ツ)_/¯
export const getExistingDemo = async (db, sessionId, demoName) => {
  let demo: Demo

  let retries = 0
  const maxRetries = 10

  while (true) {
    retries += 1

    if (retries > maxRetries) {
      break
    }

    await sleepAsync(20 * retries)

    demo = await db.demos.findFirst({
      where: {
        name: demoName,
        electric_user_id: sessionId
      },
      orderBy: {
        id: 'asc'
      }
    })

    if (demo !== null) {
      break
    }
  }

  return demo
}

export const boostrapSlider = async (db: DB, demo: Demo) => {
  const existingSlider = await db.sliders.findFirst({
    where: {
      demo_name: demo.name,
      electric_user_id: demo.electric_user_id
    },
    orderBy: {
      id: 'asc'
    }
  })

  if (existingSlider !== null) {
    return existingSlider
  }

  const newSlider = await db.sliders.create({
    data: {
      id: genUUID(),
      demo_id: demo.id,
      demo_name: demo.name,
      electric_user_id: demo.electric_user_id,
      value: 50
    }
  })

  return newSlider
}

export const boostrapPlayers = async (db: DB, demo: Demo, colors: string[]) => {
  const existingPlayers = await db.players.findMany({
    where: {
      demo_name: demo.name,
      electric_user_id: demo.electric_user_id
    },
    orderBy: {
      inserted_at: 'asc'
    }
  })

  if (existingPlayers.length) {
    return existingPlayers
  }

  const t1 = Date.now()
  const newItems = colors.map((color, index) => ({
    id: genUUID(),
    color: color,
    inserted_at: `${t1 + index}`,
    updated_at: `${t1 + index}`,
    demo_id: demo.id,
    demo_name: demo.name,
    electric_user_id: demo.electric_user_id
  }))

  const newPlayers = await db.players.createMany({
    data: newItems
  })

  return newPlayers
}

export const boostrapTournament = async (db: DB, demo: Demo, name: string) => {
  const existing = await db.tournaments.findMany({
    where: {
      demo_name: demo.name,
      electric_user_id: demo.electric_user_id
    }
  })

  if (existing.length) {
    const userPrefix = name.split(':')[0]
    const matchingUser = existing.filter((x) => x.name.startsWith(userPrefix))
    return matchingUser.length
  }

  const ts = `${Date.now()}`
  await db.tournaments.create({
    data: {
      id: genUUID(),
      name: name,
      inserted_at: ts,
      updated_at: ts,
      demo_id: demo.id,
      demo_name: demo.name,
      electric_user_id: demo.electric_user_id
    }
  })

  return 1
}
