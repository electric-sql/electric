import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { TableSchema, DbSchema, Relation, ElectricClient, HKT } from 'electric-sql/client/model';

/////////////////////////////////////////
// HELPER FUNCTIONS
/////////////////////////////////////////


/////////////////////////////////////////
// ENUMS
/////////////////////////////////////////

export const ItemsScalarFieldEnumSchema = z.enum(['value']);

export const QueryModeSchema = z.enum(['default','insensitive']);

export const SortOrderSchema = z.enum(['asc','desc']);

export const TransactionIsolationLevelSchema = z.enum(['ReadUncommitted','ReadCommitted','RepeatableRead','Serializable']);
/////////////////////////////////////////
// MODELS
/////////////////////////////////////////

/////////////////////////////////////////
// ITEMS SCHEMA
/////////////////////////////////////////

export const itemsSchema = z.object({
  value: z.string(),
})

export type items = z.infer<typeof itemsSchema>

/////////////////////////////////////////
// SELECT & INCLUDE
/////////////////////////////////////////

// ITEMS
//------------------------------------------------------

export const itemsSelectSchema: z.ZodType<Prisma.itemsSelect> = z.object({
  value: z.boolean().optional(),
}).strict()


/////////////////////////////////////////
// INPUT TYPES
/////////////////////////////////////////

export const itemsWhereInputSchema: z.ZodType<Prisma.itemsWhereInput> = z.object({
  AND: z.union([ z.lazy(() => itemsWhereInputSchema),z.lazy(() => itemsWhereInputSchema).array() ]).optional(),
  OR: z.lazy(() => itemsWhereInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => itemsWhereInputSchema),z.lazy(() => itemsWhereInputSchema).array() ]).optional(),
  value: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
}).strict();

export const itemsOrderByWithRelationInputSchema: z.ZodType<Prisma.itemsOrderByWithRelationInput> = z.object({
  value: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const itemsWhereUniqueInputSchema: z.ZodType<Prisma.itemsWhereUniqueInput> = z.object({
  value: z.string().optional()
}).strict();

export const itemsOrderByWithAggregationInputSchema: z.ZodType<Prisma.itemsOrderByWithAggregationInput> = z.object({
  value: z.lazy(() => SortOrderSchema).optional(),
  _count: z.lazy(() => itemsCountOrderByAggregateInputSchema).optional(),
  _max: z.lazy(() => itemsMaxOrderByAggregateInputSchema).optional(),
  _min: z.lazy(() => itemsMinOrderByAggregateInputSchema).optional()
}).strict();

export const itemsScalarWhereWithAggregatesInputSchema: z.ZodType<Prisma.itemsScalarWhereWithAggregatesInput> = z.object({
  AND: z.union([ z.lazy(() => itemsScalarWhereWithAggregatesInputSchema),z.lazy(() => itemsScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  OR: z.lazy(() => itemsScalarWhereWithAggregatesInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => itemsScalarWhereWithAggregatesInputSchema),z.lazy(() => itemsScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  value: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
}).strict();

export const itemsCreateInputSchema: z.ZodType<Prisma.itemsCreateInput> = z.object({
  value: z.string()
}).strict();

export const itemsUncheckedCreateInputSchema: z.ZodType<Prisma.itemsUncheckedCreateInput> = z.object({
  value: z.string()
}).strict();

export const itemsUpdateInputSchema: z.ZodType<Prisma.itemsUpdateInput> = z.object({
  value: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const itemsUncheckedUpdateInputSchema: z.ZodType<Prisma.itemsUncheckedUpdateInput> = z.object({
  value: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const itemsCreateManyInputSchema: z.ZodType<Prisma.itemsCreateManyInput> = z.object({
  value: z.string()
}).strict();

export const itemsUpdateManyMutationInputSchema: z.ZodType<Prisma.itemsUpdateManyMutationInput> = z.object({
  value: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const itemsUncheckedUpdateManyInputSchema: z.ZodType<Prisma.itemsUncheckedUpdateManyInput> = z.object({
  value: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const StringFilterSchema: z.ZodType<Prisma.StringFilter> = z.object({
  equals: z.string().optional(),
  in: z.string().array().optional(),
  notIn: z.string().array().optional(),
  lt: z.string().optional(),
  lte: z.string().optional(),
  gt: z.string().optional(),
  gte: z.string().optional(),
  contains: z.string().optional(),
  startsWith: z.string().optional(),
  endsWith: z.string().optional(),
  mode: z.lazy(() => QueryModeSchema).optional(),
  not: z.union([ z.string(),z.lazy(() => NestedStringFilterSchema) ]).optional(),
}).strict();

export const itemsCountOrderByAggregateInputSchema: z.ZodType<Prisma.itemsCountOrderByAggregateInput> = z.object({
  value: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const itemsMaxOrderByAggregateInputSchema: z.ZodType<Prisma.itemsMaxOrderByAggregateInput> = z.object({
  value: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const itemsMinOrderByAggregateInputSchema: z.ZodType<Prisma.itemsMinOrderByAggregateInput> = z.object({
  value: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const StringWithAggregatesFilterSchema: z.ZodType<Prisma.StringWithAggregatesFilter> = z.object({
  equals: z.string().optional(),
  in: z.string().array().optional(),
  notIn: z.string().array().optional(),
  lt: z.string().optional(),
  lte: z.string().optional(),
  gt: z.string().optional(),
  gte: z.string().optional(),
  contains: z.string().optional(),
  startsWith: z.string().optional(),
  endsWith: z.string().optional(),
  mode: z.lazy(() => QueryModeSchema).optional(),
  not: z.union([ z.string(),z.lazy(() => NestedStringWithAggregatesFilterSchema) ]).optional(),
  _count: z.lazy(() => NestedIntFilterSchema).optional(),
  _min: z.lazy(() => NestedStringFilterSchema).optional(),
  _max: z.lazy(() => NestedStringFilterSchema).optional()
}).strict();

export const StringFieldUpdateOperationsInputSchema: z.ZodType<Prisma.StringFieldUpdateOperationsInput> = z.object({
  set: z.string().optional()
}).strict();

export const NestedStringFilterSchema: z.ZodType<Prisma.NestedStringFilter> = z.object({
  equals: z.string().optional(),
  in: z.string().array().optional(),
  notIn: z.string().array().optional(),
  lt: z.string().optional(),
  lte: z.string().optional(),
  gt: z.string().optional(),
  gte: z.string().optional(),
  contains: z.string().optional(),
  startsWith: z.string().optional(),
  endsWith: z.string().optional(),
  not: z.union([ z.string(),z.lazy(() => NestedStringFilterSchema) ]).optional(),
}).strict();

export const NestedStringWithAggregatesFilterSchema: z.ZodType<Prisma.NestedStringWithAggregatesFilter> = z.object({
  equals: z.string().optional(),
  in: z.string().array().optional(),
  notIn: z.string().array().optional(),
  lt: z.string().optional(),
  lte: z.string().optional(),
  gt: z.string().optional(),
  gte: z.string().optional(),
  contains: z.string().optional(),
  startsWith: z.string().optional(),
  endsWith: z.string().optional(),
  not: z.union([ z.string(),z.lazy(() => NestedStringWithAggregatesFilterSchema) ]).optional(),
  _count: z.lazy(() => NestedIntFilterSchema).optional(),
  _min: z.lazy(() => NestedStringFilterSchema).optional(),
  _max: z.lazy(() => NestedStringFilterSchema).optional()
}).strict();

export const NestedIntFilterSchema: z.ZodType<Prisma.NestedIntFilter> = z.object({
  equals: z.number().optional(),
  in: z.number().array().optional(),
  notIn: z.number().array().optional(),
  lt: z.number().optional(),
  lte: z.number().optional(),
  gt: z.number().optional(),
  gte: z.number().optional(),
  not: z.union([ z.number(),z.lazy(() => NestedIntFilterSchema) ]).optional(),
}).strict();

/////////////////////////////////////////
// ARGS
/////////////////////////////////////////

export const itemsFindFirstArgsSchema: z.ZodType<Prisma.itemsFindFirstArgs> = z.object({
  select: itemsSelectSchema.optional(),
  where: itemsWhereInputSchema.optional(),
  orderBy: z.union([ itemsOrderByWithRelationInputSchema.array(),itemsOrderByWithRelationInputSchema ]).optional(),
  cursor: itemsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: ItemsScalarFieldEnumSchema.array().optional(),
}).strict()

export const itemsFindFirstOrThrowArgsSchema: z.ZodType<Prisma.itemsFindFirstOrThrowArgs> = z.object({
  select: itemsSelectSchema.optional(),
  where: itemsWhereInputSchema.optional(),
  orderBy: z.union([ itemsOrderByWithRelationInputSchema.array(),itemsOrderByWithRelationInputSchema ]).optional(),
  cursor: itemsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: ItemsScalarFieldEnumSchema.array().optional(),
}).strict()

export const itemsFindManyArgsSchema: z.ZodType<Prisma.itemsFindManyArgs> = z.object({
  select: itemsSelectSchema.optional(),
  where: itemsWhereInputSchema.optional(),
  orderBy: z.union([ itemsOrderByWithRelationInputSchema.array(),itemsOrderByWithRelationInputSchema ]).optional(),
  cursor: itemsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: ItemsScalarFieldEnumSchema.array().optional(),
}).strict()

export const itemsAggregateArgsSchema: z.ZodType<Prisma.itemsAggregateArgs> = z.object({
  where: itemsWhereInputSchema.optional(),
  orderBy: z.union([ itemsOrderByWithRelationInputSchema.array(),itemsOrderByWithRelationInputSchema ]).optional(),
  cursor: itemsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict()

export const itemsGroupByArgsSchema: z.ZodType<Prisma.itemsGroupByArgs> = z.object({
  where: itemsWhereInputSchema.optional(),
  orderBy: z.union([ itemsOrderByWithAggregationInputSchema.array(),itemsOrderByWithAggregationInputSchema ]).optional(),
  by: ItemsScalarFieldEnumSchema.array(),
  having: itemsScalarWhereWithAggregatesInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict()

export const itemsFindUniqueArgsSchema: z.ZodType<Prisma.itemsFindUniqueArgs> = z.object({
  select: itemsSelectSchema.optional(),
  where: itemsWhereUniqueInputSchema,
}).strict()

export const itemsFindUniqueOrThrowArgsSchema: z.ZodType<Prisma.itemsFindUniqueOrThrowArgs> = z.object({
  select: itemsSelectSchema.optional(),
  where: itemsWhereUniqueInputSchema,
}).strict()

export const itemsCreateArgsSchema: z.ZodType<Prisma.itemsCreateArgs> = z.object({
  select: itemsSelectSchema.optional(),
  data: z.union([ itemsCreateInputSchema,itemsUncheckedCreateInputSchema ]),
}).strict()

export const itemsUpsertArgsSchema: z.ZodType<Prisma.itemsUpsertArgs> = z.object({
  select: itemsSelectSchema.optional(),
  where: itemsWhereUniqueInputSchema,
  create: z.union([ itemsCreateInputSchema,itemsUncheckedCreateInputSchema ]),
  update: z.union([ itemsUpdateInputSchema,itemsUncheckedUpdateInputSchema ]),
}).strict()

export const itemsCreateManyArgsSchema: z.ZodType<Prisma.itemsCreateManyArgs> = z.object({
  data: itemsCreateManyInputSchema.array(),
  skipDuplicates: z.boolean().optional(),
}).strict()

export const itemsDeleteArgsSchema: z.ZodType<Prisma.itemsDeleteArgs> = z.object({
  select: itemsSelectSchema.optional(),
  where: itemsWhereUniqueInputSchema,
}).strict()

export const itemsUpdateArgsSchema: z.ZodType<Prisma.itemsUpdateArgs> = z.object({
  select: itemsSelectSchema.optional(),
  data: z.union([ itemsUpdateInputSchema,itemsUncheckedUpdateInputSchema ]),
  where: itemsWhereUniqueInputSchema,
}).strict()

export const itemsUpdateManyArgsSchema: z.ZodType<Prisma.itemsUpdateManyArgs> = z.object({
  data: z.union([ itemsUpdateManyMutationInputSchema,itemsUncheckedUpdateManyInputSchema ]),
  where: itemsWhereInputSchema.optional(),
}).strict()

export const itemsDeleteManyArgsSchema: z.ZodType<Prisma.itemsDeleteManyArgs> = z.object({
  where: itemsWhereInputSchema.optional(),
}).strict()

interface itemsGetPayload extends HKT {
  readonly _A?: boolean | null | undefined | Prisma.itemsArgs
  readonly type: Prisma.itemsGetPayload<this['_A']>
}

export const tableSchemas = {
  items: {
    fields: ["value"],
    relations: [
    ],
    modelSchema: (itemsCreateInputSchema as any)
      .partial()
      .or((itemsUncheckedCreateInputSchema as any).partial()),
    createSchema: itemsCreateArgsSchema,
    createManySchema: itemsCreateManyArgsSchema,
    findUniqueSchema: itemsFindUniqueArgsSchema,
    findSchema: itemsFindFirstArgsSchema,
    updateSchema: itemsUpdateArgsSchema,
    updateManySchema: itemsUpdateManyArgsSchema,
    upsertSchema: itemsUpsertArgsSchema,
    deleteSchema: itemsDeleteArgsSchema,
    deleteManySchema: itemsDeleteManyArgsSchema
  } as TableSchema<
    z.infer<typeof itemsCreateInputSchema>,
    Prisma.itemsCreateArgs['data'],
    Prisma.itemsUpdateArgs['data'],
    Prisma.itemsFindFirstArgs['select'],
    Prisma.itemsFindFirstArgs['where'],
    Prisma.itemsFindUniqueArgs['where'],
    never,
    Prisma.itemsFindFirstArgs['orderBy'],
    Prisma.ItemsScalarFieldEnum,
    itemsGetPayload
  >,
}

export const dbSchema = new DbSchema(tableSchemas)
export type Electric = ElectricClient<typeof dbSchema>
import migrations from './migrations'
export const config = {
  migrations: migrations
}