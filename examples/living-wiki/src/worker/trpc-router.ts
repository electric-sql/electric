import { initTRPC } from '@trpc/server'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { healthResponse } from './routes'
import type { WorkerEnv } from './env'

export type TrpcContext = {
  env: WorkerEnv
}

const t = initTRPC.context<TrpcContext>().create()

export const appRouter = t.router({
  health: t.procedure.query(({ ctx }) => healthResponse(ctx.env)),
})

export type AppRouter = typeof appRouter

export function handleTrpcRequest(
  request: Request,
  env: WorkerEnv
): Promise<Response> {
  return fetchRequestHandler({
    endpoint: `/trpc`,
    req: request,
    router: appRouter,
    createContext: () => ({ env }),
  })
}
