import { Row } from 'electric-sql/dist/util/types'

export type Todo = {
  id: string
  listid: string
  text: string
  completed: boolean
}

export const createTodo = (
  id: string,
  listid: string,
  text: string,
  completed = false
): Todo => {
  return { id, listid, text, completed }
}

export const resultsToTodos = (todos: Row[]) => {
  const {
    all,
    active,
    completed,
  }: { all: Todo[]; active: Todo[]; completed: Todo[] } = {
    all: [],
    active: [],
    completed: [],
  }

  todos.map((t: Row) => {
    const todo = createTodo(
      t.id as string,
      t.listid as string,
      t.text as string,
      Boolean(t.completed)
    )
    all.push(todo)
    if (t.completed) {
      completed.push(todo)
    } else {
      active.push(todo)
    }
  })

  return { all, active, completed }
}
