import { router, authedProcedure, generateTxId } from "@/lib/trpc"
import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { eq, and } from "drizzle-orm"
import {
  projectsTable,
  createProjectSchema,
  updateProjectSchema,
} from "@/db/schema"

export const projectsRouter = router({
  create: authedProcedure
    .input(createProjectSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.owner_id !== ctx.session.user.id) {
        throw new TRPCError({
          code: `FORBIDDEN`,
          message: `You can only create projects you own`,
        })
      }

      const result = await ctx.db.transaction(async (tx) => {
        const txid = await generateTxId(tx)
        const [newItem] = await tx
          .insert(projectsTable)
          .values(input)
          .returning()
        return { item: newItem, txid }
      })

      return result
    }),

  update: authedProcedure
    .input(
      z.object({
        id: z.number(),
        data: updateProjectSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db.transaction(async (tx) => {
        const txid = await generateTxId(tx)
        const [updatedItem] = await tx
          .update(projectsTable)
          .set(input.data)
          .where(
            and(
              eq(projectsTable.id, input.id),
              eq(projectsTable.owner_id, ctx.session.user.id)
            )
          )
          .returning()

        if (!updatedItem) {
          throw new TRPCError({
            code: `NOT_FOUND`,
            message: `Project not found or you do not have permission to update it`,
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
          .delete(projectsTable)
          .where(
            and(
              eq(projectsTable.id, input.id),
              eq(projectsTable.owner_id, ctx.session.user.id)
            )
          )
          .returning()

        if (!deletedItem) {
          throw new TRPCError({
            code: `NOT_FOUND`,
            message: `Project not found or you do not have permission to delete it`,
          })
        }

        return { item: deletedItem, txid }
      })

      return result
    }),
})
