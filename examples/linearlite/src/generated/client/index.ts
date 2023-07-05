import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { TableSchema, DbSchema, Relation, ElectricClient, HKT } from 'electric-sql/client/model';
import migrations from './migrations';

/////////////////////////////////////////
// HELPER FUNCTIONS
/////////////////////////////////////////


/////////////////////////////////////////
// ENUMS
/////////////////////////////////////////

export const IssueScalarFieldEnumSchema = z.enum(['id','name','priority','title','description','status']);

export const QueryModeSchema = z.enum(['default','insensitive']);

export const SortOrderSchema = z.enum(['asc','desc']);

export const TransactionIsolationLevelSchema = z.enum(['ReadUncommitted','ReadCommitted','RepeatableRead','Serializable']);
/////////////////////////////////////////
// MODELS
/////////////////////////////////////////

/////////////////////////////////////////
// ISSUE SCHEMA
/////////////////////////////////////////

export const issueSchema = z.object({
  id: z.string(),
  name: z.string(),
  priority: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.string(),
})

export type issue = z.infer<typeof issueSchema>

/////////////////////////////////////////
// SELECT & INCLUDE
/////////////////////////////////////////

// ISSUE
//------------------------------------------------------

export const issueSelectSchema: z.ZodType<Prisma.issueSelect> = z.object({
  id: z.boolean().optional(),
  name: z.boolean().optional(),
  priority: z.boolean().optional(),
  title: z.boolean().optional(),
  description: z.boolean().optional(),
  status: z.boolean().optional(),
}).strict()


/////////////////////////////////////////
// INPUT TYPES
/////////////////////////////////////////

export const issueWhereInputSchema: z.ZodType<Prisma.issueWhereInput> = z.object({
  AND: z.union([ z.lazy(() => issueWhereInputSchema),z.lazy(() => issueWhereInputSchema).array() ]).optional(),
  OR: z.lazy(() => issueWhereInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => issueWhereInputSchema),z.lazy(() => issueWhereInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  name: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  priority: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  title: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  description: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  status: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
}).strict();

export const issueOrderByWithRelationInputSchema: z.ZodType<Prisma.issueOrderByWithRelationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  name: z.lazy(() => SortOrderSchema).optional(),
  priority: z.lazy(() => SortOrderSchema).optional(),
  title: z.lazy(() => SortOrderSchema).optional(),
  description: z.lazy(() => SortOrderSchema).optional(),
  status: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const issueWhereUniqueInputSchema: z.ZodType<Prisma.issueWhereUniqueInput> = z.object({
  id: z.string().optional()
}).strict();

export const issueOrderByWithAggregationInputSchema: z.ZodType<Prisma.issueOrderByWithAggregationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  name: z.lazy(() => SortOrderSchema).optional(),
  priority: z.lazy(() => SortOrderSchema).optional(),
  title: z.lazy(() => SortOrderSchema).optional(),
  description: z.lazy(() => SortOrderSchema).optional(),
  status: z.lazy(() => SortOrderSchema).optional(),
  _count: z.lazy(() => issueCountOrderByAggregateInputSchema).optional(),
  _max: z.lazy(() => issueMaxOrderByAggregateInputSchema).optional(),
  _min: z.lazy(() => issueMinOrderByAggregateInputSchema).optional()
}).strict();

export const issueScalarWhereWithAggregatesInputSchema: z.ZodType<Prisma.issueScalarWhereWithAggregatesInput> = z.object({
  AND: z.union([ z.lazy(() => issueScalarWhereWithAggregatesInputSchema),z.lazy(() => issueScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  OR: z.lazy(() => issueScalarWhereWithAggregatesInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => issueScalarWhereWithAggregatesInputSchema),z.lazy(() => issueScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  name: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  priority: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  title: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  description: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  status: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
}).strict();

export const issueCreateInputSchema: z.ZodType<Prisma.issueCreateInput> = z.object({
  id: z.string(),
  name: z.string(),
  priority: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.string()
}).strict();

export const issueUncheckedCreateInputSchema: z.ZodType<Prisma.issueUncheckedCreateInput> = z.object({
  id: z.string(),
  name: z.string(),
  priority: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.string()
}).strict();

export const issueUpdateInputSchema: z.ZodType<Prisma.issueUpdateInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  name: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  priority: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  title: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  description: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  status: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const issueUncheckedUpdateInputSchema: z.ZodType<Prisma.issueUncheckedUpdateInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  name: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  priority: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  title: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  description: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  status: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const issueCreateManyInputSchema: z.ZodType<Prisma.issueCreateManyInput> = z.object({
  id: z.string(),
  name: z.string(),
  priority: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.string()
}).strict();

export const issueUpdateManyMutationInputSchema: z.ZodType<Prisma.issueUpdateManyMutationInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  name: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  priority: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  title: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  description: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  status: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const issueUncheckedUpdateManyInputSchema: z.ZodType<Prisma.issueUncheckedUpdateManyInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  name: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  priority: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  title: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  description: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  status: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
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

export const issueCountOrderByAggregateInputSchema: z.ZodType<Prisma.issueCountOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  name: z.lazy(() => SortOrderSchema).optional(),
  priority: z.lazy(() => SortOrderSchema).optional(),
  title: z.lazy(() => SortOrderSchema).optional(),
  description: z.lazy(() => SortOrderSchema).optional(),
  status: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const issueMaxOrderByAggregateInputSchema: z.ZodType<Prisma.issueMaxOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  name: z.lazy(() => SortOrderSchema).optional(),
  priority: z.lazy(() => SortOrderSchema).optional(),
  title: z.lazy(() => SortOrderSchema).optional(),
  description: z.lazy(() => SortOrderSchema).optional(),
  status: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const issueMinOrderByAggregateInputSchema: z.ZodType<Prisma.issueMinOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  name: z.lazy(() => SortOrderSchema).optional(),
  priority: z.lazy(() => SortOrderSchema).optional(),
  title: z.lazy(() => SortOrderSchema).optional(),
  description: z.lazy(() => SortOrderSchema).optional(),
  status: z.lazy(() => SortOrderSchema).optional()
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

export const issueFindFirstArgsSchema: z.ZodType<Prisma.issueFindFirstArgs> = z.object({
  select: issueSelectSchema.optional(),
  where: issueWhereInputSchema.optional(),
  orderBy: z.union([ issueOrderByWithRelationInputSchema.array(),issueOrderByWithRelationInputSchema ]).optional(),
  cursor: issueWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: IssueScalarFieldEnumSchema.array().optional(),
}).strict()

export const issueFindFirstOrThrowArgsSchema: z.ZodType<Prisma.issueFindFirstOrThrowArgs> = z.object({
  select: issueSelectSchema.optional(),
  where: issueWhereInputSchema.optional(),
  orderBy: z.union([ issueOrderByWithRelationInputSchema.array(),issueOrderByWithRelationInputSchema ]).optional(),
  cursor: issueWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: IssueScalarFieldEnumSchema.array().optional(),
}).strict()

export const issueFindManyArgsSchema: z.ZodType<Prisma.issueFindManyArgs> = z.object({
  select: issueSelectSchema.optional(),
  where: issueWhereInputSchema.optional(),
  orderBy: z.union([ issueOrderByWithRelationInputSchema.array(),issueOrderByWithRelationInputSchema ]).optional(),
  cursor: issueWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: IssueScalarFieldEnumSchema.array().optional(),
}).strict()

export const issueAggregateArgsSchema: z.ZodType<Prisma.issueAggregateArgs> = z.object({
  where: issueWhereInputSchema.optional(),
  orderBy: z.union([ issueOrderByWithRelationInputSchema.array(),issueOrderByWithRelationInputSchema ]).optional(),
  cursor: issueWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict()

export const issueGroupByArgsSchema: z.ZodType<Prisma.issueGroupByArgs> = z.object({
  where: issueWhereInputSchema.optional(),
  orderBy: z.union([ issueOrderByWithAggregationInputSchema.array(),issueOrderByWithAggregationInputSchema ]).optional(),
  by: IssueScalarFieldEnumSchema.array(),
  having: issueScalarWhereWithAggregatesInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict()

export const issueFindUniqueArgsSchema: z.ZodType<Prisma.issueFindUniqueArgs> = z.object({
  select: issueSelectSchema.optional(),
  where: issueWhereUniqueInputSchema,
}).strict()

export const issueFindUniqueOrThrowArgsSchema: z.ZodType<Prisma.issueFindUniqueOrThrowArgs> = z.object({
  select: issueSelectSchema.optional(),
  where: issueWhereUniqueInputSchema,
}).strict()

export const issueCreateArgsSchema: z.ZodType<Prisma.issueCreateArgs> = z.object({
  select: issueSelectSchema.optional(),
  data: z.union([ issueCreateInputSchema,issueUncheckedCreateInputSchema ]),
}).strict()

export const issueUpsertArgsSchema: z.ZodType<Prisma.issueUpsertArgs> = z.object({
  select: issueSelectSchema.optional(),
  where: issueWhereUniqueInputSchema,
  create: z.union([ issueCreateInputSchema,issueUncheckedCreateInputSchema ]),
  update: z.union([ issueUpdateInputSchema,issueUncheckedUpdateInputSchema ]),
}).strict()

export const issueCreateManyArgsSchema: z.ZodType<Prisma.issueCreateManyArgs> = z.object({
  data: z.union([ issueCreateManyInputSchema,issueCreateManyInputSchema.array() ]),
  skipDuplicates: z.boolean().optional(),
}).strict()

export const issueDeleteArgsSchema: z.ZodType<Prisma.issueDeleteArgs> = z.object({
  select: issueSelectSchema.optional(),
  where: issueWhereUniqueInputSchema,
}).strict()

export const issueUpdateArgsSchema: z.ZodType<Prisma.issueUpdateArgs> = z.object({
  select: issueSelectSchema.optional(),
  data: z.union([ issueUpdateInputSchema,issueUncheckedUpdateInputSchema ]),
  where: issueWhereUniqueInputSchema,
}).strict()

export const issueUpdateManyArgsSchema: z.ZodType<Prisma.issueUpdateManyArgs> = z.object({
  data: z.union([ issueUpdateManyMutationInputSchema,issueUncheckedUpdateManyInputSchema ]),
  where: issueWhereInputSchema.optional(),
}).strict()

export const issueDeleteManyArgsSchema: z.ZodType<Prisma.issueDeleteManyArgs> = z.object({
  where: issueWhereInputSchema.optional(),
}).strict()

interface issueGetPayload extends HKT {
  readonly _A?: boolean | null | undefined | Prisma.issueArgs
  readonly type: Prisma.issueGetPayload<this['_A']>
}

export const tableSchemas = {
  issue: {
    fields: ["id","name","priority","title","description","status"],
    relations: [
    ],
    modelSchema: (issueCreateInputSchema as any)
      .partial()
      .or((issueUncheckedCreateInputSchema as any).partial()),
    createSchema: issueCreateArgsSchema,
    createManySchema: issueCreateManyArgsSchema,
    findUniqueSchema: issueFindUniqueArgsSchema,
    findSchema: issueFindFirstArgsSchema,
    updateSchema: issueUpdateArgsSchema,
    updateManySchema: issueUpdateManyArgsSchema,
    upsertSchema: issueUpsertArgsSchema,
    deleteSchema: issueDeleteArgsSchema,
    deleteManySchema: issueDeleteManyArgsSchema
  } as TableSchema<
    z.infer<typeof issueCreateInputSchema>,
    Prisma.issueCreateArgs['data'],
    Prisma.issueUpdateArgs['data'],
    Prisma.issueFindFirstArgs['select'],
    Prisma.issueFindFirstArgs['where'],
    Prisma.issueFindUniqueArgs['where'],
    never,
    Prisma.issueFindFirstArgs['orderBy'],
    Prisma.IssueScalarFieldEnum,
    issueGetPayload
  >,
}

export const dbSchema = new DbSchema(tableSchemas, migrations)
export type Electric = ElectricClient<typeof dbSchema>
