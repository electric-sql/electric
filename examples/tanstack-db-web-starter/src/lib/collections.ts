import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import {
  selectTodoSchema,
  selectProjectSchema,
  selectUsersSchema,
} from "@/db/schema"
import { trpc } from "@/lib/trpc-client"

export const usersCollection = createCollection(
  electricCollectionOptions({
    id: "users",
    shapeOptions: {
      url: new URL(
        `/api/users`,
        typeof window !== `undefined`
          ? window.location.origin
          : `http://localhost:5173`
      ).toString(),
      parser: {
        timestamptz: (date: string) => {
          return new Date(date)
        },
      },
    },
    schema: selectUsersSchema,
    getKey: (item) => item.id,
  })
)
export const projectCollection = createCollection(
  electricCollectionOptions({
    id: "projects",
    shapeOptions: {
      url: new URL(
        `/api/projects`,
        typeof window !== `undefined`
          ? window.location.origin
          : `http://localhost:5173`
      ).toString(),
      parser: {
        timestamptz: (date: string) => {
          return new Date(date)
        },
      },
    },
    schema: selectProjectSchema,
    getKey: (item) => item.id,
    onInsert: async ({ transaction }) => {
      const { modified: newProject } = transaction.mutations[0]
      const result = await trpc.projects.create.mutate({
        name: newProject.name,
        description: newProject.description,
        owner_id: newProject.owner_id,
        shared_user_ids: newProject.shared_user_ids,
      })

      return { txid: result.txid }
    },
    onUpdate: async ({ transaction }) => {
      const { modified: updatedProject } = transaction.mutations[0]
      const result = await trpc.projects.update.mutate({
        id: updatedProject.id,
        data: {
          name: updatedProject.name,
          description: updatedProject.description,
          shared_user_ids: updatedProject.shared_user_ids,
        },
      })

      return { txid: result.txid }
    },
    onDelete: async ({ transaction }) => {
      const { original: deletedProject } = transaction.mutations[0]
      const result = await trpc.projects.delete.mutate({
        id: deletedProject.id,
      })

      return { txid: result.txid }
    },
  })
)

export const todoCollection = createCollection(
  electricCollectionOptions({
    id: "todos",
    shapeOptions: {
      url: new URL(
        `/api/todos`,
        typeof window !== `undefined`
          ? window.location.origin
          : `http://localhost:5173`
      ).toString(),
      parser: {
        // Parse timestamp columns into JavaScript Date objects
        timestamptz: (date: string) => {
          return new Date(date)
        },
      },
    },
    schema: selectTodoSchema,
    getKey: (item) => item.id,
    onInsert: async ({ transaction }) => {
      const { modified: newTodo } = transaction.mutations[0]
      const result = await trpc.todos.create.mutate({
        user_id: newTodo.user_id,
        text: newTodo.text,
        completed: newTodo.completed,
        project_id: newTodo.project_id,
        user_ids: newTodo.user_ids,
      })

      return { txid: result.txid }
    },
    onUpdate: async ({ transaction }) => {
      const { modified: updatedTodo } = transaction.mutations[0]
      const result = await trpc.todos.update.mutate({
        id: updatedTodo.id,
        data: {
          text: updatedTodo.text,
          completed: updatedTodo.completed,
        },
      })

      return { txid: result.txid }
    },
    onDelete: async ({ transaction }) => {
      const { original: deletedTodo } = transaction.mutations[0]
      const result = await trpc.todos.delete.mutate({
        id: deletedTodo.id,
      })

      return { txid: result.txid }
    },
  })
)
