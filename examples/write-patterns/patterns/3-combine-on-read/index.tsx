import React, { useState } from 'react'
import { v4 as uuidv4 } from 'uuid'

import { PGlite } from '@electric-sql/pglite'
import { PGliteWithLive, live } from '@electric-sql/pglite/live'
import {
  PGliteProvider,
  useLiveQuery,
  usePGlite,
} from '@electric-sql/pglite-react'
import { electricSync } from '@electric-sql/pglite-sync'

import api from '../../shared/app/client'
import localSchemaMigrations from './local-schema.sql?raw'

const ELECTRIC_URL = import.meta.env.ELECTRIC_URL || 'http://localhost:3000'

type Todo = {
  id: string
  title: string
  completed: boolean
  created_at: Date
}

const pglite: PGliteWithLive = await PGlite.create({
  extensions: {
    electric: electricSync(),
    live,
  },
})
await pglite.exec(localSchemaMigrations)

await pglite.electric.syncShapeToTable({
  shape: {
    url: `${ELECTRIC_URL}/v1/shape`,
    table: 'todos',
  },
  table: 'todos_synced',
  primaryKey: ['id'],
})

/*
 * Wrap the `<CombineOnRead />` component with a `PGliteProvider` that provides
 * access to a PGlite database, with local schema migrations applied.
 */
export default function Wrapper() {
  return (
    <PGliteProvider db={pglite}>
      <CombineOnRead />
    </PGliteProvider>
  )
}

function CombineOnRead() {
  const db = usePGlite()

  const [pendingState, setPendingState] = useState<number[]>([])
  const isPending = pendingState.length === 0 ? false : true

  const results = useLiveQuery<Todo>('SELECT * FROM todos ORDER BY created_at')

  if (results === undefined) {
    return <div className="loading">Loading &hellip;</div>
  }

  const todos = results.rows

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
      INSERT INTO todos (
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
      UPDATE todos
      SET completed = ${!completed}
      WHERE id = ${id}
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

    const localWritePromise = db.sql`DELETE FROM todos WHERE id = ${id}`

    const path = `/todos/${id}`
    const fetchPromise = api.request(path, 'DELETE')

    await Promise.all([localWritePromise, fetchPromise])

    setPendingState((keys) => keys.filter((k) => k !== key))
  }

  // The template below the heading is identical to the online example.

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
                { todo.title }: { todo.created_at.toISOString() }
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
