import { TodoList } from './model'
import { Electric } from '../../generated/models'

export class TodoListRepository {
  constructor(private db: Electric['db']) {}

  async getById(listid: string): Promise<TodoList | null> {
    return await this.db.todolist.findUnique({
      where: {
        id: listid
      }
    })
  }

  async save(todoList: TodoList): Promise<void> {
    const filterAndEdit: Omit<TodoList, "id"> = {
      filter: todoList.filter ? todoList.filter : 'all',
      editing: todoList.editing ? todoList.editing : ''
    }

    await this.db.todolist.upsert({
      create: {
        id: todoList.id,
        ...filterAndEdit
      },
      update: filterAndEdit,
      where: {
        id: todoList.id
      }
    })
  }

  async update(todoList: TodoList): Promise<void> {
    await this.db.todolist.update({
      data: {
        editing: todoList.editing,
        filter: todoList.filter
      },
      where: {
        id: todoList.id
      }
    })
  }
}
