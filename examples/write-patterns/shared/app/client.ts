const API_URL = import.meta.env.API_URL || 'http://localhost:3001'

type RequestOptions = {
  method: string
  headers: HeadersInit
  body?: string
}

async function request(path: string, method: string, data?: object) {
  const url = `${API_URL}${path}`

  const options: RequestOptions = {
    method: method,
    headers: {
      'Content-Type': 'application/json',
    },
  }

  if (data) {
    options.body = JSON.stringify(data)
  }

  return await fetch(url, options)
}

export default { request }