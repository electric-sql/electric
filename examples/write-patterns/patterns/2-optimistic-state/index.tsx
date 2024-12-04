import React, { useOptimistic, useTransition } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { matchBy, matchStream } from '@electric-sql/client'
import { useShape } from '@electric-sql/react'
import api from '../../shared/app/client'

const ELECTRIC_URL = import.meta.env.ELECTRIC_URL || 'http://localhost:3000'

type Todo = {
  id: string
  title: string
  completed: boolean
  created_at: Date
}

type OptimisticState = {
  operation: 'insert' | 'update' | 'delete'
  value: Todo
}

export default function OptimisticState() {
  const [isPending, startTransition] = useTransition()

  // Use Electric's `useShape` hook to sync data from Postgres
  // into a React state variable.
  //
  // Note that we also unpack the `stream` from the useShape
  // return value, so that we can monitor it below to detect
  // local writes syncing back from the server.
  const { isLoading, data, stream } = useShape<Todo>({
    url: `${ELECTRIC_URL}/v1/shape`,
    params: {
      table: 'todos',
    },
    parser: {
      timestamptz: (value: string) => new Date(value),
    },
  })

  const sorted = data ? data.sort((a, b) => +a.created_at - +b.created_at) : []

  // Use React's built in `useOptimistic` hook. This provides
  // a mechanism to apply local optimistic state whilst writes
  // are being sent-to and syncing-back-from the server.
  const [todos, addOptimisticState] = useOptimistic(
    sorted,
    (syncedTodos: Todo[], { operation, value }: OptimisticState) => {
      switch (operation) {
        case 'insert':
          return syncedTodos.some((todo) => todo.id === value.id)
            ? syncedTodos
            : [...syncedTodos, value]

        case 'update':
          return syncedTodos.map((todo) =>
            todo.id === value.id ? value : todo
          )

        case 'delete':
          return syncedTodos.filter((todo) => todo.id !== value.id)
      }
    }
  )

  // These are the same event handler functions from the online
  // example, extended with `startTransition` -> `addOptimisticState`
  // to apply local optimistic state.
  //
  // Note that the local state is applied:
  //
  // 1. whilst the HTTP request is being made to the API server; and
  // 2. until the write syncs back through the Electric shape stream
  //
  // This is slightly different from most optimistic state examples
  // because we wait for the sync as well as the api request.

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

    startTransition(async () => {
      addOptimisticState({
        operation: 'insert',
        value: {
          ...data,
          completed: false,
        },
      })

      const fetchPromise = api.request(path, 'POST', data)
      const syncPromise = matchStream(
        stream,
        ['insert'],
        matchBy('id', data.id)
      )

      await Promise.all([fetchPromise, syncPromise])
    })

    form.reset()
  }

  async function updateTodo(todo: Todo) {
    const { id, completed } = todo

    const path = `/todos/${id}`
    const data = {
      completed: !completed,
    }

    startTransition(async () => {
      addOptimisticState({
        operation: 'update',
        value: {
          ...todo,
          completed: !completed,
        },
      })

      const fetchPromise = api.request(path, 'PUT', data)
      const syncPromise = matchStream(stream, ['update'], matchBy('id', id))

      await Promise.all([fetchPromise, syncPromise])
    })
  }

  async function deleteTodo(event: React.MouseEvent, todo: Todo) {
    event.preventDefault()

    const { id } = todo

    const path = `/todos/${id}`

    startTransition(async () => {
      addOptimisticState({
        operation: 'delete',
        value: {
          ...todo,
        },
      })

      const fetchPromise = api.request(path, 'DELETE')
      const syncPromise = matchStream(stream, ['delete'], matchBy('id', id))

      await Promise.all([fetchPromise, syncPromise])
    })
  }

  if (isLoading) {
    return <div className="loading">Loading &hellip;</div>
  }

  // The template below the heading is identical to the online example.

  // prettier-ignore
  return (
    <div id="optimistic-state" className="example">
      <h3>
        <span className="title">
          2. Optimistic state
        </span>
        <span className={isPending ? 'pending' : 'pending hidden'} />
      </h3>
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
