import React from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useShape } from '@electric-sql/react'
import api from '../../shared/app/client'

type ToDo = {
  id: string
  title: string
  completed: boolean
  created_at: number
}

async function createTodo(event: React.FormEvent) {
  event.preventDefault()

  const form = event.target as HTMLFormElement
  const formData = new FormData(form)
  const title = formData.get('todo') as string

  const path = '/todos'
  const data = {
    id: uuidv4(),
    title: title
  }

  await api.request(path, 'POST', data)

  form.reset()
}

async function updateTodo(todo: ToDo) {
  const path = `/todos/${todo.id}`

  const data = {
    completed: !todo.completed
  }

  await api.request(path, 'PUT', data)
}

async function deleteTodo(event: React.MouseEvent, todo: ToDo) {
  event.preventDefault()

  const path = `/todos/${todo.id}`

  await api.request(path, 'DELETE')
}

const ELECTRIC_URL = import.meta.env.ELECTRIC_URL || 'http://localhost:3000'

export default function OnlineWrites() {
  const { isLoading, data } = useShape<ToDo>({
    url: `${ELECTRIC_URL}/v1/shape`,
    table: 'todos',
  })

  if (isLoading) {
    return <div className="loading">Loading &hellip;</div>
  }

  const todos = data ? data.sort((a, b) => a.created_at - b.created_at) : []

  // prettier-ignore
  return (
    <div id="online-writes" className="example">
      <h3>Online writes</h3>
      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>
            <label>
              <input type="checkbox" checked={todo.completed}
                  onChange={() => updateTodo(todo)}
              />
              <span className={`title ${todo.completed ? 'completed' : ''}`}>
                { todo.title }
              </span>
            </label>
            <a href="#delete" className="close"
                onClick={(event) => deleteTodo(event, todo)}>
              &#x2715;</a>
          </li>
        ))}
        {todos.length === 0 && (
          <li>All done 🎉</li>
        )}
      </ul>
      <form onSubmit={(event) => createTodo(event)}>
        <input type="text" name="todo"
            placeholder="Type here &hellip;"
            required
        />
        <button type="submit">
          Add
        </button>
      </form>
    </div>
  )
}
