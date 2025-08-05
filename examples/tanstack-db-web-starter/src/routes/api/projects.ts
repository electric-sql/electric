import { createServerFileRoute } from "@tanstack/react-start/server"
import { auth } from "@/lib/auth"

const serve = async ({ request }: { request: Request }) => {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    })
  }

  const url = new URL(request.url)
  const originUrl = new URL("http://localhost:3000/v1/shape")

  url.searchParams.forEach((value, key) => {
    // Pass through the Electric protocol query parameters.
    if (["live", "handle", "offset", "cursor"].includes(key)) {
      originUrl.searchParams.set(key, value)
    }
  })

  originUrl.searchParams.set("table", "projects")
  const filter = `owner_id = '${session.user.id}' OR '${session.user.id}' = ANY(shared_user_ids)`
  originUrl.searchParams.set("where", filter)

  const response = await fetch(originUrl)
  const headers = new Headers(response.headers)
  headers.delete("content-encoding")
  headers.delete("content-length")

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export const ServerRoute = createServerFileRoute("/api/projects").methods({
  GET: serve,
})
