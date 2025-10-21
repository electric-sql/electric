import React, { useTransition } from "react"
import { v4 as uuidv4 } from "uuid"
import { subscribe, useSnapshot } from "valtio"
import { proxyMap } from "valtio/utils"

import { type Operation, ShapeStream } from "@electric-sql/client"
import { matchBy, matchStream } from "@electric-sql/experimental"
import { useShape } from "@electric-sql/react"

import api from "../../shared/app/client"
import { TODOS_URL } from "../../shared/app/config"

const KEY = "electric-sql/examples/write-patterns/shared-persistent"

type Todo = {
  id: string
  title: string
  completed: boolean
  created_at: Date
}
type PartialTodo = Partial<Todo> & {
  id: string
}

type LocalWrite = {
  id: string
  operation: Operation
  value: PartialTodo
}

// Define a shared, persistent, reactive store for local optimistic state.
const optimisticState = proxyMap<string, LocalWrite>(
  JSON.parse(localStorage.getItem(KEY) || "[]")
)
subscribe(optimisticState, () => {
  localStorage.setItem(KEY, JSON.stringify([...optimisticState]))
})

/*
 * Add a local write to the optimistic state
 */
function addLocalWrite(operation: Operation, value: PartialTodo): LocalWrite {
  const id = uuidv4()

  const write: LocalWrite = {
    id,
    operation,
    value,
  }

  optimisticState.set(id, write)

  return write
}

/*
 * Subscribe to the shape `stream` until the local write syncs back through it.
 * At which point, delete the local write from the optimistic state.
 */
async function matchWrite(
  stream: ShapeStream<Todo>,
  write: LocalWrite
): Promise<void> {
  const { operation, value } = write

  const matchFn =
    operation === "delete"
      ? matchBy("id", value.id)
      : matchBy("write_id", write.id)

  try {
    await matchStream(stream, [operation], matchFn)
  } catch (_err) {
    return
  }

  optimisticState.delete(write.id)
}

/*
 * Make an HTTP request to send the write to the API server.
 * If the request fails, delete the local write from the optimistic state.
 * If it succeeds, return the `txid` of the write from the response data.
 */
async function sendRequest(
  path: string,
  method: string,
  { id, value }: LocalWrite
): Promise<void> {
  const data = {
    ...value,
    write_id: id,
  }

  let response: Response | undefined
  try {
    response = await api.request(path, method, data)
  } catch (_err) {
    // ignore
  }

  if (response === undefined || !response.ok) {
    optimisticState.delete(id)
  }
}

export default function SharedPersistent() {
  const [isPending, startTransition] = useTransition()

  // Use Electric's `useShape` hook to sync data from Postgres.
  const { isLoading, data, stream } = useShape<Todo>({
    url: TODOS_URL,
    parser: {
      timestamptz: (value: string) => new Date(value),
    },
  })

  const sorted = data ? data.sort((a, b) => +a.created_at - +b.created_at) : []

  // Get the local optimistic state.
  const localWrites = useSnapshot<Map<string, LocalWrite>>(optimisticState)

  const computeOptimisticState = (
    synced: Todo[],
    writes: LocalWrite[]
  ): Todo[] => {
    return writes.reduce(
      (synced: Todo[], { operation, value }: LocalWrite): Todo[] => {
        switch (operation) {
          case "insert":
            return [...synced, value as Todo]
          case "update":
            return synced.map((todo) =>
              todo.id === value.id ? { ...todo, ...value } : todo
            )
          case "delete":
            return synced.filter((todo) => todo.id !== value.id)
          default:
            return synced
        }
      },
      synced
    )
  }

  const todos = computeOptimisticState(sorted, [...localWrites.values()])

  // These are the same event handler functions from the previous optimistic
  // state pattern, adapted to add the state to the shared, persistent store.

  async function createTodo(event: React.FormEvent) {
    event.preventDefault()

    const form = event.target as HTMLFormElement
    const formData = new FormData(form)
    const title = formData.get("todo") as string

    const path = "/todos"
    const data = {
      id: uuidv4(),
      title: title,
      completed: false,
      created_at: new Date(),
    }

    startTransition(async () => {
      const write = addLocalWrite("insert", data)
      const fetchPromise = sendRequest(path, "POST", write)
      const syncPromise = matchWrite(stream, write)

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
      const write = addLocalWrite("update", data)
      const fetchPromise = sendRequest(path, "PUT", write)
      const syncPromise = matchWrite(stream, write)

      await Promise.all([fetchPromise, syncPromise])
    })
  }

  async function deleteTodo(event: React.MouseEvent, todo: Todo) {
    event.preventDefault()

    const { id } = todo

    const path = `/todos/${id}`
    const data = {
      id,
    }

    startTransition(async () => {
      const write = addLocalWrite("delete", data)
      const fetchPromise = sendRequest(path, "DELETE", write)
      const syncPromise = matchWrite(stream, write)

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
          3. Shared persistent
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
