import { v4 as uuidv4 } from 'uuid'

const API_URL = import.meta.env.API_URL || 'http://localhost:3001'

type RequestOptions = {
  method: string
  headers: HeadersInit
  body?: string
}

async function request(url: string, method: string, data?: object) {
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

export async function createTodo(title: string) {
  const url = `${API_URL}/todos`
  const data = {
    id: uuidv4(),
    title: title,
  }

  return await request(url, 'POST', data)
}

export async function updateTodo(id: string, data: object) {
  const url = `${API_URL}/todos/${id}`

  return await request(url, 'PUT', data)
}

export async function deleteTodo(id: string) {
  const url = `${API_URL}/todos/${id}`

  return await request(url, 'DELETE')
}
