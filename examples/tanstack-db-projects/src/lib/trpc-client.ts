import { createTRPCProxyClient, httpBatchLink } from "@trpc/client"
import type { AppRouter } from "@/routes/api/trpc/$"

export const trpc = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      async headers() {
        return {
          cookie: typeof document !== "undefined" ? document.cookie : "",
        }
      },
    }),
  ],
})
