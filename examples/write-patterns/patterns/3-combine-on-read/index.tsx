import React, { useState } from 'react'
import { v4 as uuidv4 } from 'uuid'

import {
  PGliteProvider,
  useLiveQuery,
  usePGlite,
} from '@electric-sql/pglite-react'

import api from '../../shared/app/client'
import pglite from '../../shared/app/db'

import localSchemaMigrations from './local-schema.sql?raw'

const ELECTRIC_URL = import.meta.env.ELECTRIC_URL || 'http://localhost:3000'

type Todo = {
  id: string
  title: string
  completed: boolean
  created_at: Date
}

await pglite.exec(localSchemaMigrations)

// This starts the read path sync using Electric.
await pglite.electric.syncShapeToTable({
  shape: {
    url: `${ELECTRIC_URL}/v1/shape`,
    table: 'todos',
  },
  shapeKey: 'todos',
  table: 'todos_synced',
  primaryKey: ['id'],
})

export default function Wrapper() {
  return (
    <PGliteProvider db={pglite}>
      <CombineOnRead />
    </PGliteProvider>
  )
}

function CombineOnRead() {
  const db = usePGlite()
  const results = useLiveQuery<Todo>('SELECT * FROM todos ORDER BY created_at')

  // Allows us to track when writes are being made to the server.
  const [pendingState, setPendingState] = useState<number[]>([])
  const isPending = pendingState.length === 0 ? false : true

  // These are the same event handler functions from the online and
  // optimistic state examples, revised to write local optimistic
  // state to the database.

  async function createTodo(event: React.FormEvent) {
    event.preventDefault()

    const form = event.target as HTMLFormElement
    const formData = new FormData(form)
    const title = formData.get('todo') as string

    form.reset()

    const key = Math.random()
    setPendingState((keys) => [...keys, key])

    const id = uuidv4()
    const created_at = new Date()

    const localWritePromise = db.sql`
      INSERT INTO todos_local (
        id,
        title,
        completed,
        created_at
      )
      VALUES (
        ${id},
        ${title},
        ${false},
        ${created_at}
      )
    `

    const path = '/todos'
    const data = {
      id: id,
      title: title,
      created_at: created_at,
    }
    const fetchPromise = api.request(path, 'POST', data)

    await Promise.all([localWritePromise, fetchPromise])

    setPendingState((keys) => keys.filter((k) => k !== key))
  }

  async function updateTodo(todo: Todo) {
    const { id, completed } = todo

    const key = Math.random()
    setPendingState((keys) => [...keys, key])

    const localWritePromise = db.sql`
      INSERT INTO todos_local (
        id,
        completed
      )
      VALUES (
        ${id},
        ${!completed}
      )
      ON CONFLICT (id)
      DO UPDATE
        SET completed = ${!completed}
    `

    const path = `/todos/${id}`
    const data = {
      completed: !completed,
    }
    const fetchPromise = api.request(path, 'PUT', data)

    await Promise.all([localWritePromise, fetchPromise])

    setPendingState((keys) => keys.filter((k) => k !== key))
  }

  async function deleteTodo(event: React.MouseEvent, todo: Todo) {
    event.preventDefault()

    const { id } = todo

    const key = Math.random()
    setPendingState((keys) => [...keys, key])

    const localWritePromise = db.sql`
      INSERT INTO todos_local (
        id,
        deleted
      )
      VALUES (
        ${id},
        ${true}
      )
      ON CONFLICT (id)
      DO UPDATE
        SET deleted = ${true}
    `

    const path = `/todos/${id}`
    const fetchPromise = api.request(path, 'DELETE')

    await Promise.all([localWritePromise, fetchPromise])

    setPendingState((keys) => keys.filter((k) => k !== key))
  }

  if (results === undefined) {
    return <div className="loading">Loading &hellip;</div>
  }

  const todos = results.rows

  // The template below the heading is identical to the other patterns.

  // prettier-ignore
  return (
    <div id="optimistic-state" className="example">
      <h3>
        <span className="title">
          3. Combine on read
        </span>
        <span className={isPending ? 'pending' : 'pending hidden'} />
      </h3>
      <ul>
        {todos.map((todo: Todo) => (
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
