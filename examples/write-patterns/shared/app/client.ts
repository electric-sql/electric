const API_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3001"

type RequestOptions = {
  method: string
  headers: HeadersInit
  body?: string
  signal?: AbortSignal
}

// Keeps trying for 3 minutes, with the delay
// increasing slowly from 1 to 20 seconds.
const maxRetries = 32
const backoffMultiplier = 1.1
const initialDelayMs = 1_000

async function retryFetch(
  url: string,
  options: RequestOptions,
  retryCount: number
): Promise<Response | undefined> {
  if (retryCount > maxRetries) {
    return
  }

  const delay = retryCount * backoffMultiplier * initialDelayMs

  return await new Promise((resolve) => {
    setTimeout(async () => {
      resolve(await resilientFetch(url, options, retryCount))
    }, delay)
  })
}

async function resilientFetch(
  url: string,
  options: RequestOptions,
  retryCount: number
): Promise<Response | undefined> {
  try {
    // Could also check the status and retry before returning if you want to be
    // resilient to 4xx and 5xx responses as well as network errors
    return await fetch(url, options)
  } catch (_err) {
    return await retryFetch(url, options, retryCount + 1)
  }
}

async function request(
  path: string,
  method: string,
  data?: object,
  signal?: AbortSignal
): Promise<Response | undefined> {
  const url = `${API_URL}${path}`

  const options: RequestOptions = {
    method: method,
    headers: {
      "Content-Type": "application/json",
    },
  }

  if (data !== undefined) {
    options.body = JSON.stringify(data)
  }

  if (signal !== undefined) {
    options.signal = signal
  }

  return await resilientFetch(url, options, 0)
}

export default { request }
