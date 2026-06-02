import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '../worker/trpc-router'

export function createLivingWikiTrpcClient(baseUrl = ``) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${baseUrl}/trpc`,
      }),
    ],
  })
}
