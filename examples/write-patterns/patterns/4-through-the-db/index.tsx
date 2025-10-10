import React, { useEffect, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'

import {
  PGliteProvider,
  useLiveQuery,
  usePGlite,
} from '@electric-sql/pglite-react'
import { type PGliteWithLive } from '@electric-sql/pglite/live'

import loadPGlite from './db'
import ChangeLogSynchronizer from './sync'

type Todo = {
  id: string
  title: string
  completed: boolean
  created_at: Date
}

/*
 * Setup the local PGlite database, with automatic change detection and syncing.
 *
 * See `./local-schema.sql` for the local database schema, including view
 * and trigger machinery.
 *
 * See `./sync.ts` for the write-path sync utility, which listens to changes
 * using pg_notify, as per https://pglite.dev/docs/api#listen
 */
export default function Wrapper() {
  const [db, setDb] = useState<PGliteWithLive>()

  useEffect(() => {
    let isMounted = true
    let writePathSync: ChangeLogSynchronizer

    async function init() {
      const pglite = await loadPGlite()

      if (!isMounted) {
        return
      }

      writePathSync = new ChangeLogSynchronizer(pglite)
      writePathSync.start()

      setDb(pglite)
    }

    init()

    return () => {
      isMounted = false

      if (writePathSync !== undefined) {
        writePathSync.stop()
      }
    }
  }, [])

  if (db === undefined) {
    return <div className="loading">Loading &hellip;</div>
  }

  return (
    <PGliteProvider db={db}>
      <ThroughTheDB />
    </PGliteProvider>
  )
}

function ThroughTheDB() {
  const db = usePGlite()
  const results = useLiveQuery<Todo>('SELECT * FROM todos ORDER BY created_at')

  async function createTodo(event: React.FormEvent) {
    event.preventDefault()

    const form = event.target as HTMLFormElement
    const formData = new FormData(form)
    const title = formData.get('todo') as string

    await db.sql`
      INSERT INTO todos (
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
      UPDATE todos
        SET completed = ${!completed}
        WHERE id = ${id}
    `
  }

  async function deleteTodo(event: React.MouseEvent, todo: Todo) {
    event.preventDefault()

    await db.sql`
      DELETE FROM todos
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
