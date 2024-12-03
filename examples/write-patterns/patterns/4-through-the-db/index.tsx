import React from 'react'
import { v4 as uuidv4 } from 'uuid'

import {
  PGliteProvider,
  useLiveQuery,
  usePGlite,
} from '@electric-sql/pglite-react'

import pglite from '../../shared/app/db'

import SyncChanges from './sync'
import localSchemaMigrations from './local-schema.sql?raw'

const ELECTRIC_URL = import.meta.env.ELECTRIC_URL || 'http://localhost:3000'

type Todo = {
  id: string
  title: string
  completed: boolean
  created_at: Date
}

// Note that the resources defined in the schema for this pattern
// are all suffixed with `p4_`.
await pglite.exec(localSchemaMigrations)

// This starts the read path sync using Electric.
await pglite.electric.syncShapeToTable({
  shape: {
    url: `${ELECTRIC_URL}/v1/shape`,
    table: 'todos',
  },
  shapeKey: 'p4_todos',
  table: 'p4_todos_synced',
  primaryKey: ['id'],
})

// This starts the write path sync of changes captured in the triggers from
// writes to the local DB.
const syncChanges = new SyncChanges(pglite)
syncChanges.start()

export default function Wrapper() {
  return (
    <PGliteProvider db={pglite}>
      <ThroughTheDB />
    </PGliteProvider>
  )
}

function ThroughTheDB() {
  const db = usePGlite()
  const results = useLiveQuery<Todo>(
    'SELECT * FROM p4_todos ORDER BY created_at'
  )

  async function createTodo(event: React.FormEvent) {
    event.preventDefault()

    const form = event.target as HTMLFormElement
    const formData = new FormData(form)
    const title = formData.get('todo') as string

    await db.sql`
      INSERT INTO p4_todos (
        id,
        title,
        completed,
        created_at
      )
      VALUES (
        ${uuidv4()},
        ${title},
        ${false},
        ${new Date()}
      )
    `

    form.reset()
  }

  async function updateTodo(todo: Todo) {
    const { id, completed } = todo

    await db.sql`
      UPDATE p4_todos
        SET completed = ${!completed}
        WHERE id = ${id}
    `
  }

  async function deleteTodo(event: React.MouseEvent, todo: Todo) {
    event.preventDefault()

    await db.sql`
      DELETE FROM p4_todos
        WHERE id = ${todo.id}
    `
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
          4. Through the DB
        </span>
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
