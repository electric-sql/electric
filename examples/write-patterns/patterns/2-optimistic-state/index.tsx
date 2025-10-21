import React, { useOptimistic, useTransition } from "react"
import { v4 as uuidv4 } from "uuid"
import { matchBy, matchStream } from "@electric-sql/experimental"
import { useShape } from "@electric-sql/react"

import api from "../../shared/app/client"
import { TODOS_URL } from "../../shared/app/config"

type Todo = {
  id: string
  title: string
  completed: boolean
  created_at: Date
}
type PartialTodo = Partial<Todo> & {
  id: string
}

type Write = {
  operation: "insert" | "update" | "delete"
  value: PartialTodo
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
    url: TODOS_URL,
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
    (synced: Todo[], { operation, value }: Write) => {
      switch (operation) {
        case "insert":
          return synced.some((todo) => todo.id === value.id)
            ? synced
            : [...synced, value as Todo]

        case "update":
          return synced.map((todo) =>
            todo.id === value.id ? { ...todo, ...value } : todo
          )

        case "delete":
          return synced.filter((todo) => todo.id !== value.id)
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
    const title = formData.get("todo") as string

    const path = "/todos"
    const data = {
      id: uuidv4(),
      title: title,
      created_at: new Date(),
      completed: false,
    }

    startTransition(async () => {
      addOptimisticState({ operation: "insert", value: data })

      const fetchPromise = api.request(path, "POST", data)
      const syncPromise = matchStream(
        stream,
        ["insert"],
        matchBy("id", data.id)
      )

      await Promise.all([fetchPromise, syncPromise])
    })

    form.reset()
  }

  async function updateTodo(todo: Todo) {
    const { id, completed } = todo

    const path = `/todos/${id}`
    const data = {
      id,
      completed: !completed,
    }

    startTransition(async () => {
      addOptimisticState({ operation: "update", value: data })

      const fetchPromise = api.request(path, "PUT", data)
      const syncPromise = matchStream(stream, ["update"], matchBy("id", id))

      await Promise.all([fetchPromise, syncPromise])
    })
  }

  async function deleteTodo(event: React.MouseEvent, todo: Todo) {
    event.preventDefault()

    const { id } = todo

    const path = `/todos/${id}`

    startTransition(async () => {
      addOptimisticState({ operation: "delete", value: { id } })

      const fetchPromise = api.request(path, "DELETE")
      const syncPromise = matchStream(stream, ["delete"], matchBy("id", id))

      await Promise.all([fetchPromise, syncPromise])
    })
  }

  if (isLoading) {
    return <div className="loading">Loading &hellip;</div>
  }

  // The template below the heading is identical to the other patterns.

  // prettier-ignore
  return (
    <div id="optimistic-state" className="example">
      <h3>
        <span className="title">
          2. Optimistic state
        </span>
        <span className={isPending ? "pending" : "pending hidden"} />
      </h3>
      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>
            <label>
              <input type="checkbox" checked={todo.completed}
                  onChange={() => updateTodo(todo)}
              />
              <span className={`title ${ todo.completed ? "completed" : "" }`}>
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
