import { FetchError, Shape, ShapeStream } from "@electric-sql/client"

const API_URL = process.env.API_URL || "http://localhost:4000"

/*
 * Makes a request to the gatekeeper endpoint to fetch a config object
 * in the format expected by the ShapeStreamOptions including the
 * proxy `url` to connect to and auth `headers`.
 */
async function fetchConfig() {
  const url = `${API_URL}/gatekeeper/items`

  const resp = await fetch(url, { method: "POST" })
  return await resp.json()
}

// Stream the shape through the proxy, using the url and auth headers
// provided by the gatekeeper.
const config = await fetchConfig()
const stream = new ShapeStream({
  ...config,
  onError: async (error) => {
    if (error instanceof FetchError) {
      const status = error.status
      console.log("handling fetch error: ", status)

      // If the auth token is invalid or expires, hit the gatekeeper
      // again to update the auth headers and thus keep streaming
      // without interruption.
      if (status === 401 || status === 403) {
        return await fetchConfig()
      }
    }

    throw error
  },
})

// Materialize the stream into a `Shape` and subscibe to data changes
// so we can see the client working.
const shape = new Shape(stream)
shape.subscribe(({ rows }) => {
  console.log("num rows: ", rows ? rows.length : 0)
})
