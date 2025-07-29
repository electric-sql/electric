import { router, authedProcedure } from "@/lib/trpc"
import { z } from "zod"
import { TRPCError } from "@trpc/server"

export const usersRouter = router({
  create: authedProcedure.input(z.any()).mutation(async () => {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Can't create new users through API",
    })
  }),

  update: authedProcedure
    .input(z.object({ id: z.string(), data: z.any() }))
    .mutation(async () => {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Can't edit users through API",
      })
    }),

  delete: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async () => {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Can't delete users through API",
      })
    }),
})
