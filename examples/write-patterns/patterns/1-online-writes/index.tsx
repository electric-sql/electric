import React from 'react'
import { useShape } from '@electric-sql/react'

import * as client from '../../shared/app/client'

const ELECTRIC_URL = import.meta.env.ELECTRIC_URL || 'http://localhost:3000'

type ToDo = {
  id: string
  title: string
  completed: boolean
  created_at: number
}

export default function OnlineWrites() {
  const { isLoading, data } = useShape<ToDo>({
    url: `${ELECTRIC_URL}/v1/shape`,
    table: 'todos',
  })

  if (isLoading) {
    return (
      <div className="loading">Loading &hellip;</div>
    )
  }

  const todos = data
    ? data.sort((a, b) => a.created_at - b.created_at)
    : []

  async function handleChange(id: string, completed: boolean) {
    await client.updateTodo(id, {completed: !completed})
  }

  async function handleDelete(event: React.MouseEvent, id: string) {
    event.preventDefault()

    await client.deleteTodo(id)
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()

    const form = event.target as HTMLFormElement
    const formData = new FormData(form)
    const title = formData.get('todo') as string

    await client.createTodo(title)

    form.reset()
  }

  return (
    <div id="online-writes" className="example">
      <h3>Online writes</h3>
      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>
            <label>
              <input type="checkbox" checked={todo.completed}
                  onChange={() => handleChange(todo.id, todo.completed)}
              />
              <span className={`title ${todo.completed ? 'completed' : ''}`}>
                { todo.title }
              </span>
            </label>
            <a href="#delete" className="close"
                onClick={(event) => handleDelete(event, todo.id)}>
              &#x2715;</a>
          </li>
        ))}
        {todos.length === 0 && (
          <li><span className="all-done">All done 🎉</span></li>
        )}
      </ul>
      <form onSubmit={(event) => handleSubmit(event)}>
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
