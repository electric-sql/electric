import { router, authedProcedure, generateTxId } from "@/lib/trpc"
import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { eq, and, arrayContains } from "drizzle-orm"
import { todosTable, createTodoSchema, updateTodoSchema } from "@/db/schema"

export const todosRouter = router({
  create: authedProcedure
    .input(createTodoSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db.transaction(async (tx) => {
        const txid = await generateTxId(tx)
        const [newItem] = await tx.insert(todosTable).values(input).returning()
        return { item: newItem, txid }
      })

      return result
    }),

  update: authedProcedure
    .input(
      z.object({
        id: z.number(),
        data: updateTodoSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db.transaction(async (tx) => {
        const txid = await generateTxId(tx)
        const [updatedItem] = await tx
          .update(todosTable)
          .set(input.data)
          .where(
            and(
              eq(todosTable.id, input.id),
              arrayContains(todosTable.user_ids, [ctx.session.user.id])
            )
          )
          .returning()

        if (!updatedItem) {
          throw new TRPCError({
            code: `NOT_FOUND`,
            message: `Todo not found or you do not have permission to update it`,
          })
        }

        return { item: updatedItem, txid }
      })

      return result
    }),

  delete: authedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db.transaction(async (tx) => {
        const txid = await generateTxId(tx)
        const [deletedItem] = await tx
          .delete(todosTable)
          .where(
            and(
              eq(todosTable.id, input.id),
              arrayContains(todosTable.user_ids, [ctx.session.user.id])
            )
          )
          .returning()

        if (!deletedItem) {
          throw new TRPCError({
            code: `NOT_FOUND`,
            message: `Todo not found or you do not have permission to delete it`,
          })
        }

        return { item: deletedItem, txid }
      })

      return result
    }),
})
