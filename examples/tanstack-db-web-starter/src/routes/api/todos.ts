import { createServerFileRoute } from "@tanstack/react-start/server"
import { auth } from "@/lib/auth"
import { prepareElectricUrl, proxyElectricRequest } from "@/lib/electric-proxy"

const serve = async ({ request }: { request: Request }) => {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    })
  }

  const originUrl = prepareElectricUrl(request.url)
  originUrl.searchParams.set("table", "todos")
  const filter = `'${session.user.id}' = ANY(user_ids)`
  originUrl.searchParams.set("where", filter)

  return proxyElectricRequest(originUrl)
}

export const ServerRoute = createServerFileRoute("/api/todos").methods({
  GET: serve,
})
