import { v4 as uuidv4 } from 'uuid'

const API_URL = import.meta.env.API_URL || 'http://localhost:3001'

async function request(url, method, data) {
  const options = {
    method: method,
    headers: {
      'Content-Type': `application/json`
    }
  }

  if (data) {
    options.body = JSON.stringify(data)
  }

  return await fetch(url, options)
}

export async function createTodo(title) {
  const url = `${API_URL}/todos`
  const data = {
    id: uuidv4(),
    title: title
  }

  return await request(url, 'POST', data)
}

export async function updateTodo(id, data) {
  const url = `${API_URL}/todos/${id}`

  return await request(url, 'PUT', data)
}

export async function deleteTodo(id) {
  const url = `${API_URL}/todos/${id}`

  return await request(url, 'DELETE')
}
