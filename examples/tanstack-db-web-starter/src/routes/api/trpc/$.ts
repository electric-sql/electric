import { createServerFileRoute } from "@tanstack/react-start/server"
import { fetchRequestHandler } from "@trpc/server/adapters/fetch"
import { router } from "@/lib/trpc"
import { projectsRouter } from "@/lib/trpc/projects"
import { todosRouter } from "@/lib/trpc/todos"
import { usersRouter } from "@/lib/trpc/users"
import { db } from "@/db/connection"
import { auth } from "@/lib/auth"

export const appRouter = router({
  projects: projectsRouter,
  todos: todosRouter,
  users: usersRouter,
})

export type AppRouter = typeof appRouter

const serve = ({ request }: { request: Request }) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: appRouter,
    createContext: async () => ({
      db,
      session: await auth.api.getSession({ headers: request.headers }),
    }),
  })
}

export const ServerRoute = createServerFileRoute("/api/trpc/$").methods({
  GET: serve,
  POST: serve,
})
