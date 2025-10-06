import { createFileRoute } from "@tanstack/react-router"
import { auth } from "@/lib/auth"
import { prepareElectricUrl, proxyElectricRequest } from "@/lib/electric-proxy"
import { QueryBuilder } from "drizzle-orm/pg-core"
import { or, eq, sql } from "drizzle-orm"
import { projectsTable } from "@/db/schema"

const serve = async ({ request }: { request: Request }) => {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    })
  }

  const originUrl = prepareElectricUrl(request.url)
  originUrl.searchParams.set("table", "projects")

  // Generate type-safe WHERE clause using ANY operator for array membership
  // Note: We use column.name to get unqualified column names since Electric expects
  // WHERE clauses without table prefixes (just column names)
  const whereExpr = sql`${sql.identifier(projectsTable.owner_id.name)} = ${session.user.id} OR ${session.user.id} = ANY(${sql.identifier(projectsTable.shared_user_ids.name)})`

  const qb = new QueryBuilder()
  const { sql: query, params } = qb
    .select()
    .from(projectsTable)
    .where(whereExpr)
    .toSQL()

  const fragment = query.replace(/^SELECT .* FROM .* WHERE\s+/i, "")
  originUrl.searchParams.set("where", fragment)

  // Add params as individual query parameters: params[1]=value, params[2]=value, etc.
  params.forEach((value, index) => {
    originUrl.searchParams.set(`params[${index + 1}]`, String(value))
  })

  return proxyElectricRequest(originUrl)
}

export const Route = createFileRoute("/api/projects")({
  server: {
    handlers: {
      GET: serve,
    },
  },
})
