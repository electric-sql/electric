import { createServerFileRoute } from "@tanstack/react-start/server"
import { auth } from "@/lib/auth"

const serve = ({ request }: { request: Request }) => {
  return auth.handler(request)
}

export const ServerRoute = createServerFileRoute("/api/auth").methods({
  GET: serve,
  POST: serve,
  PUT: serve,
  DELETE: serve,
  PATCH: serve,
  OPTIONS: serve,
  HEAD: serve,
})
