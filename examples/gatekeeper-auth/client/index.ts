import { Shape, ShapeStream } from '@electric-sql/client'

const API_URL = process.env.API_URL || "http://localhost:4000"

interface Definition {
  table: string,
  where?: string,
  columns?: string
}

/*
 * Fetch the shape options and start syncing. When new data is recieved,
 * log the number of rows. When an auth token expires, reconnect.
 */
async function sync(definition: Definition, handle?: string, offset: string = '-1') {
  console.log('sync: ', offset)

  const options = await fetchShapeOptions(definition)
  const stream = new ShapeStream({...options, handle: handle, offset: offset})
  const shape = new Shape(stream)

  shape.subscribe(async ({ rows }) => {
    if (shape.error && 'status' in shape.error) {
      const status = shape.error.status
      console.warn('fetch error: ', status)

      if (status === 401 || status === 403) {
        shape.unsubscribeAll()

        return await sync(definition, shape.handle, shape.lastOffset)
      }
    }
    else {
      console.log('num rows: ', rows ? rows.length : 0)
    }
  })
}

/*
 * Make a request to the gatekeeper endpoint to get the proxy url and
 * auth headers to connect to/with.
 */
async function fetchShapeOptions(definition: Definition) {
  const { table, ...params} = definition

  const qs = new URLSearchParams(params).toString()
  const url = `${API_URL}/gatekeeper/${table}${qs ? '?' : ''}${qs}`

  const resp = await fetch(url, {method: "POST"})
  return await resp.json()
}

// Start syncing.
await sync({table: 'items'})
