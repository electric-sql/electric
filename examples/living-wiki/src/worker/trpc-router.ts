import { initTRPC, TRPCError } from '@trpc/server'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import {
  createSpaceInputSchema,
  getSpaceInputSchema,
  joinSpaceInputSchema,
  type WikiSpaceSnapshot,
} from '../shared/space'
import type { WorkerEnv } from './env'
import { healthResponse } from './routes'
import { getWikiSpaceStore, WikiSpaceNotFoundError } from './wiki-space-store'

export type TrpcContext = {
  env: WorkerEnv
}

const t = initTRPC.context<TrpcContext>().create()

const handleSpaceStoreError = (error: unknown): never => {
  if (error instanceof WikiSpaceNotFoundError) {
    throw new TRPCError({ code: `NOT_FOUND`, message: error.message })
  }

  throw error
}

export const appRouter = t.router({
  health: t.procedure.query(({ ctx }) => healthResponse(ctx.env)),
  space: t.router({
    create: t.procedure
      .input(createSpaceInputSchema)
      .mutation(async ({ ctx, input }): Promise<WikiSpaceSnapshot> => {
        try {
          return await getWikiSpaceStore(ctx.env).createSpace(input)
        } catch (error) {
          return handleSpaceStoreError(error)
        }
      }),
    join: t.procedure
      .input(joinSpaceInputSchema)
      .mutation(async ({ ctx, input }): Promise<WikiSpaceSnapshot> => {
        try {
          return await getWikiSpaceStore(ctx.env).joinSpace(input)
        } catch (error) {
          return handleSpaceStoreError(error)
        }
      }),
    get: t.procedure
      .input(getSpaceInputSchema)
      .query(async ({ ctx, input }): Promise<WikiSpaceSnapshot> => {
        try {
          return await getWikiSpaceStore(ctx.env).getSpace(input)
        } catch (error) {
          return handleSpaceStoreError(error)
        }
      }),
  }),
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
