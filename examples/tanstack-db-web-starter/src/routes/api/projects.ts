import { createFileRoute } from "@tanstack/react-router"
import { auth } from "@/lib/auth"
import { prepareElectricUrl, proxyElectricRequest } from "@/lib/electric-proxy"

const serve = async ({ request }: { request: Request }) => {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) {
    return new Response(JSON.stringify({ error: `Unauthorized` }), {
      status: 401,
      headers: { "content-type": `application/json` },
    })
  }

  const originUrl = prepareElectricUrl(request.url)
  originUrl.searchParams.set(`table`, `projects`)
  const filter = `owner_id = '${session.user.id}' OR '${session.user.id}' = ANY(shared_user_ids)`
  originUrl.searchParams.set(`where`, filter)

  return proxyElectricRequest(originUrl)
}

export const Route = createFileRoute(`/api/projects`)({
  server: {
    handlers: {
      GET: serve,
    },
  },
})
