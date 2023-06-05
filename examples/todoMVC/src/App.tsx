import React, { memo, useCallback, useEffect, useState } from 'react'
import './style.css'

import { createTodo, resultsToTodos, Todo } from './model/todo/model'
import { electrify, ElectricDatabase } from 'electric-sql/wa-sqlite'
import { ElectricClient } from 'electric-sql/client/model'
import {
  useConnectivityState,
  makeElectricContext,
  useLiveQuery
} from 'electric-sql/react'
import { TodoRepository } from './model/todo/repository'
import { TodoListRepository } from './model/todolist/repository'
import { v4 as uuid } from 'uuid'
import {
  createTodoList,
  resultsToTodoList,
  TodoList,
} from './model/todolist/model'
import config from '../.electric/@config'
import {dbSchema, Electric, todo} from './generated/models'

type Repositories = {
  todoRepo: TodoRepository
  todoListRepo: TodoListRepository
}

type createTodo = (text: string, completed?: boolean) => Promise<void>

function Header({ createTodo }: { createTodo: createTodo }) {
  const [newText, setNewText] = useState<string>('')

  return (
    <header className="header">
      <h1>todos</h1>
      <input
        type="text"
        className="new-todo"
        placeholder="What needs to be done?"
        autoFocus
        value={newText}
        onChange={(e) => setNewText(e.target.value)}
        onKeyUp={(e) => {
          const target = e.target as HTMLInputElement
          if (e.key === 'Enter' && target.value.trim() !== '') {
            createTodo(target.value)
            setNewText('')
          }
        }}
      />
    </header>
  )
}

const TodoView = memo(function Todo({
  todo,
  editing,
  startEditing,
  saveTodo,
  toggleTodo,
  deleteTodo,
}: {
  key?: string
  todo: Todo
  editing: boolean
  startEditing: (t: Todo) => void
  saveTodo: (todo: Todo, text: string) => void
  toggleTodo: (todo: Todo) => void
  deleteTodo: (todo: Todo) => void
}) {
  let body

  const [text, setText] = useState(todo.text)

  if (editing) {
    body = (
      <input
        type="text"
        className="edit"
        autoFocus
        value={text}
        onBlur={() => saveTodo(todo, text)}
        onKeyUp={(e) => e.key === 'Enter' && saveTodo(todo, text)}
        onChange={(e) => setText(e.target.value)}
      />
    )
  } else {
    body = (
      <div className="view">
        <input
          type="checkbox"
          className="toggle"
          checked={todo.completed}
          onChange={() => toggleTodo(todo)}
        />
        <label onDoubleClick={() => startEditing(todo)}>{todo.text}</label>
        <button className="destroy" onClick={() => deleteTodo(todo)} />
      </div>
    )
  }
  return (
    <li
      className={
        (todo.completed ? 'completed ' : '') + (editing ? 'editing' : '')
      }
    >
      {body}
    </li>
  )
})

function Footer({
  remaining,
  todos,
  todoList,
  clearCompleted,
  updateTodoList,
}: {
  remaining: number
  todos: Todo[]
  todoList: TodoList
  clearCompleted: () => void
  updateTodoList: (list: TodoList) => Promise<void>
}) {
  let clearCompletedButton
  if (remaining !== todos.length) {
    clearCompletedButton = (
      <button className="clear-completed" onClick={clearCompleted}>
        Clear completed
      </button>
    )
  }

  return (
    <footer className="footer">
      <span className="todo-count">
        <strong> {remaining} </strong>
        {remaining === 1 ? 'item' : 'items'} left
      </span>
      <ul className="filters">
        <li>
          <a
            className={todoList.filter === 'all' ? 'selected' : ''}
            onClick={() => updateTodoList({ ...todoList, filter: 'all' })}
          >
            All
          </a>
        </li>
        <li>
          <a
            className={todoList.filter === 'active' ? 'selected' : ''}
            onClick={() => updateTodoList({ ...todoList, filter: 'active' })}
          >
            Active
          </a>
        </li>
        <li>
          <a
            className={todoList.filter === 'completed' ? 'selected' : ''}
            onClick={() => updateTodoList({ ...todoList, filter: 'completed' })}
          >
            Completed
          </a>
        </li>
      </ul>
      {clearCompletedButton}
    </footer>
  )
}

function TodoMVC({
  listid,
  clientId,
  repositories: { todoListRepo, todoRepo },
}: {
  listid: string
  clientId: string
  repositories: Repositories
}) {
  const { db } = useElectric()!
  const { connectivityState, toggleConnectivityState } = useConnectivityState()

  const startEditing = useCallback(
    (todo: Todo) => todoListRepo.update({ id: listid, editing: todo.id }),
    [listid]
  )

  const createTodoForList = useCallback(
    (repo: TodoRepository): createTodo => {
      return (text, completed) => {
        const todo = createTodo(uuid(), listid, text, completed)
        return repo.save(todo)
      }
    },
    [listid]
  )

  const saveTodo = useCallback(
    (todo: Todo, text: string) => {
      todoRepo.updateTodoAndList({ ...todo, text })
    },
    [listid]
  )

  const deleteTodo = (todo: Todo) => todoRepo.delete(todo)

  const toggleTodo = (todo: Todo) =>
    todoRepo.update({ ...todo, completed: !todo.completed })

  const clearCompleted = () => todoRepo.deleteAll({ listid, completed: true })

  const toggleAll = () =>
    todoRepo.updateAll({ listid, completed: remaining != 0 })

  const updateTodoList = (list: TodoList): Promise<void> =>
    todoListRepo.update(list)

  const todoListQuery = useLiveQuery<TodoList | null>(
    db.todolist.liveUnique({
      where: {
        id: listid
      }
    })
  )

  const todosQuery = useLiveQuery<todo[]>(
    db.todo.liveMany({
      where: {
        listid: listid
      }
    })
  )

  if (!todoListQuery.results || !todosQuery.results) {
    return null
  }

  const todoList = resultsToTodoList(todoListQuery.results)
  const { all, active, completed } = resultsToTodos(todosQuery.results)

  const remaining = active.length
  const todos =
    todoList.filter === 'active'
      ? active
      : todoList.filter === 'completed'
      ? completed
      : all

  let toggleAllCheck
  if (all.length) {
    toggleAllCheck = (
      <>
        <input
          id="toggle-all"
          type="checkbox"
          className="toggle-all"
          checked={remaining === 0}
          onChange={toggleAll}
        />
        <label htmlFor="toggle-all">Mark all as complete</label>
      </>
    )
  }

  return (
    <div>
      <div className="todoapp" id="container">
        <Header createTodo={createTodoForList(todoRepo)} />
        <section
          className="main"
          style={all.length > 0 ? {} : { display: 'none' }}
        >
          {toggleAllCheck}
          <ul className="todo-list">
            {todos.map((t: Todo) => (
              <TodoView
                key={t.id}
                todo={t}
                editing={todoList.editing === t.id}
                startEditing={startEditing}
                saveTodo={saveTodo}
                deleteTodo={deleteTodo}
                toggleTodo={toggleTodo}
              />
            ))}
          </ul>
          <Footer
            remaining={remaining}
            todos={todos}
            todoList={todoList}
            clearCompleted={clearCompleted}
            updateTodoList={updateTodoList}
          />
        </section>
      </div>
      <div className="debug">
        <button className="button" onClick={toggleConnectivityState}>
          {buttonText(connectivityState)}
        </button>
      </div>
    </div>
  )
}

const { useElectric, ElectricProvider } = makeElectricContext<Electric>()

function ElectrifiedTodoMVC() {
  const [clientId, setClientId] = useState<string>('FAKE-CLIENT-ID')
  const [db, setDb] = useState<Electric>()
  const [repositories, setRepositories] = useState<Repositories>()
  const [todoList, setTodoList] = useState<TodoList>()

  useEffect(() => {
    const init = async () => {
      // create a wa-sqlite DB
      const wasql = await ElectricDatabase.init('todoMVC.db', '')
      // electrify it
      const electrified = await electrify(wasql, dbSchema, config)

      const todoRepo = new TodoRepository(electrified.db)
      const todoListRepo = new TodoListRepository(electrified.db)

      setDb(electrified)
      setRepositories({ todoRepo, todoListRepo })

      let todoList = await todoListRepo.getById(clientId)
      if (!todoList) {
        todoList = createTodoList(clientId, 'all')
        todoListRepo.save(todoList)
      }
      setTodoList(todoList)
    }

    init()
  }, [])

  if (
    db === undefined ||
    repositories === undefined ||
    todoList === undefined ||
    clientId === undefined
  ) {
    return null
  }

  return (
    <ElectricProvider db={db}>
      <TodoMVC
        clientId={clientId}
        listid={todoList.id}
        repositories={repositories}
      />
    </ElectricProvider>
  )
}

export default function App() {
  return <ElectrifiedTodoMVC />
}

const buttonText = (connectivityState: string) => {
  switch (connectivityState) {
    case 'available':
      return 'connecting'
    case 'error':
      return 'retry connecting'
    case 'connected':
      return 'disconnect'
    default:
      return 'connect'
  }
}
