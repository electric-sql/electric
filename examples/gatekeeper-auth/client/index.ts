import { Shape, ShapeStream } from '@electric-sql/client'

const API_URL = process.env.API_URL || "http://localhost:4000"

interface Definition {
  table: string,
  where?: string,
  columns?: string
}

async function fetchShapeOptions(definition: Definition, offset: string) {
  const { table, ...params} = definition

  const qs = new URLSearchParams({offset, ...params}).toString()
  const url = `${API_URL}/gatekeeper/${table}?${qs}`

  const resp = await fetch(url, {method: "POST"})
  return await resp.json()
}

async function sync(definition: Definition, offset: string = '-1') {
  console.log('sync: ', offset)

  const options = await fetchShapeOptions(definition, offset)
  const stream = new ShapeStream(options)
  const shape = new Shape(stream)

  let lastOffset = offset

  stream.subscribe(
    (messages) => {
      messages.forEach((message) => {
        if ('offset' in message) {
          lastOffset = message.offset!
        }
      })
    },
    async (error) => {
      if ('status' in error) {
        console.warn('fetch error: ', error.status)
      }

      shape.unsubscribeAll()

      await sync(definition, lastOffset)
    }
  )

  shape.subscribe(async ({ rows }) => {
    console.log('num rows: ', rows ? rows.length : 0)
  })
}

await sync({table: 'items'})
