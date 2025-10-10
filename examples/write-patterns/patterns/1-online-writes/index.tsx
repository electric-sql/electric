import React from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useShape } from '@electric-sql/react'

import api from '../../shared/app/client'
import { TODOS_URL } from '../../shared/app/config'

type Todo = {
  id: string
  title: string
  completed: boolean
  created_at: Date
}

export default function OnlineWrites() {
  // Use Electric's `useShape` hook to sync data from Postgres
  // into a React state variable.
  const { isLoading, data } = useShape<Todo>({
    url: TODOS_URL,
    parser: {
      timestamptz: (value: string) => new Date(value),
    },
  })

  const todos = data ? data.sort((a, b) => +a.created_at - +b.created_at) : []

  // Handle user input events by making requests to the backend
  // API to create, update and delete todos.

  async function createTodo(event: React.FormEvent) {
    event.preventDefault()

    const form = event.target as HTMLFormElement
    const formData = new FormData(form)
    const title = formData.get('todo') as string

    const path = '/todos'
    const data = {
      id: uuidv4(),
      title: title,
      created_at: new Date(),
    }

    await api.request(path, 'POST', data)

    form.reset()
  }

  async function updateTodo(todo: Todo) {
    const path = `/todos/${todo.id}`

    const data = {
      completed: !todo.completed,
    }

    await api.request(path, 'PUT', data)
  }

  async function deleteTodo(event: React.MouseEvent, todo: Todo) {
    event.preventDefault()

    const path = `/todos/${todo.id}`

    await api.request(path, 'DELETE')
  }

  if (isLoading) {
    return <div className="loading">Loading &hellip;</div>
  }

  // prettier-ignore
  return (
    <div id="online-writes" className="example">
      <h3>1. Online writes</h3>
      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>
            <label>
              <input type="checkbox" checked={todo.completed}
                  onChange={() => updateTodo(todo)}
              />
              <span className={`title ${ todo.completed ? 'completed' : '' }`}>
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
      <form onSubmit={createTodo}>
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
