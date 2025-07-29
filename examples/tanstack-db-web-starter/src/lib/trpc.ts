import { initTRPC, TRPCError } from "@trpc/server"
import { auth } from "@/lib/auth"
import { db } from "@/db/connection"

export type Context = {
  session: Awaited<ReturnType<typeof auth.api.getSession>>
  db: typeof db
}

const t = initTRPC.context<Context>().create()

export const router = t.router
export const procedure = t.procedure
export const middleware = t.middleware

export const isAuthed = middleware(async ({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" })
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  })
})

export const authedProcedure = procedure.use(isAuthed)
