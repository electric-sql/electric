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

export const ItemsScalarFieldEnumSchema = z.enum(['id','content','content_text_null','content_text_null_default','intvalue_null','intvalue_null_default']);

export const OtherItemsScalarFieldEnumSchema = z.enum(['id','content','item_id']);

export const QueryModeSchema = z.enum(['default','insensitive']);

export const SortOrderSchema = z.enum(['asc','desc']);

export const TransactionIsolationLevelSchema = z.enum(['ReadUncommitted','ReadCommitted','RepeatableRead','Serializable']);
/////////////////////////////////////////
// MODELS
/////////////////////////////////////////

/////////////////////////////////////////
// ITEMS SCHEMA
/////////////////////////////////////////

export const ItemsSchema = z.object({
  id: z.string(),
  content: z.string(),
  content_text_null: z.string().nullable(),
  content_text_null_default: z.string().nullable(),
  intvalue_null: z.number().int().nullable(),
  intvalue_null_default: z.number().int().nullable(),
})

export type Items = z.infer<typeof ItemsSchema>

/////////////////////////////////////////
// OTHER ITEMS SCHEMA
/////////////////////////////////////////

export const OtherItemsSchema = z.object({
  id: z.string(),
  content: z.string(),
  item_id: z.string().nullable(),
})

export type OtherItems = z.infer<typeof OtherItemsSchema>

/////////////////////////////////////////
// SELECT & INCLUDE
/////////////////////////////////////////

// ITEMS
//------------------------------------------------------

export const ItemsIncludeSchema: z.ZodType<Prisma.ItemsInclude> = z.object({
  other_items: z.union([z.boolean(),z.lazy(() => OtherItemsFindManyArgsSchema)]).optional(),
  _count: z.union([z.boolean(),z.lazy(() => ItemsCountOutputTypeArgsSchema)]).optional(),
}).strict()

export const ItemsArgsSchema: z.ZodType<Prisma.ItemsArgs> = z.object({
  select: z.lazy(() => ItemsSelectSchema).optional(),
  include: z.lazy(() => ItemsIncludeSchema).optional(),
}).strict();

export const ItemsCountOutputTypeArgsSchema: z.ZodType<Prisma.ItemsCountOutputTypeArgs> = z.object({
  select: z.lazy(() => ItemsCountOutputTypeSelectSchema).nullish(),
}).strict();

export const ItemsCountOutputTypeSelectSchema: z.ZodType<Prisma.ItemsCountOutputTypeSelect> = z.object({
  other_items: z.boolean().optional(),
}).strict();

export const ItemsSelectSchema: z.ZodType<Prisma.ItemsSelect> = z.object({
  id: z.boolean().optional(),
  content: z.boolean().optional(),
  content_text_null: z.boolean().optional(),
  content_text_null_default: z.boolean().optional(),
  intvalue_null: z.boolean().optional(),
  intvalue_null_default: z.boolean().optional(),
  other_items: z.union([z.boolean(),z.lazy(() => OtherItemsFindManyArgsSchema)]).optional(),
  _count: z.union([z.boolean(),z.lazy(() => ItemsCountOutputTypeArgsSchema)]).optional(),
}).strict()

// OTHER ITEMS
//------------------------------------------------------

export const OtherItemsIncludeSchema: z.ZodType<Prisma.OtherItemsInclude> = z.object({
  items: z.union([z.boolean(),z.lazy(() => ItemsArgsSchema)]).optional(),
}).strict()

export const OtherItemsArgsSchema: z.ZodType<Prisma.OtherItemsArgs> = z.object({
  select: z.lazy(() => OtherItemsSelectSchema).optional(),
  include: z.lazy(() => OtherItemsIncludeSchema).optional(),
}).strict();

export const OtherItemsSelectSchema: z.ZodType<Prisma.OtherItemsSelect> = z.object({
  id: z.boolean().optional(),
  content: z.boolean().optional(),
  item_id: z.boolean().optional(),
  items: z.union([z.boolean(),z.lazy(() => ItemsArgsSchema)]).optional(),
}).strict()


/////////////////////////////////////////
// INPUT TYPES
/////////////////////////////////////////

export const ItemsWhereInputSchema: z.ZodType<Prisma.ItemsWhereInput> = z.object({
  AND: z.union([ z.lazy(() => ItemsWhereInputSchema),z.lazy(() => ItemsWhereInputSchema).array() ]).optional(),
  OR: z.lazy(() => ItemsWhereInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => ItemsWhereInputSchema),z.lazy(() => ItemsWhereInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  content: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  content_text_null: z.union([ z.lazy(() => StringNullableFilterSchema),z.string() ]).optional().nullable(),
  content_text_null_default: z.union([ z.lazy(() => StringNullableFilterSchema),z.string() ]).optional().nullable(),
  intvalue_null: z.union([ z.lazy(() => IntNullableFilterSchema),z.number() ]).optional().nullable(),
  intvalue_null_default: z.union([ z.lazy(() => IntNullableFilterSchema),z.number() ]).optional().nullable(),
  other_items: z.lazy(() => OtherItemsListRelationFilterSchema).optional()
}).strict();

export const ItemsOrderByWithRelationInputSchema: z.ZodType<Prisma.ItemsOrderByWithRelationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  content: z.lazy(() => SortOrderSchema).optional(),
  content_text_null: z.lazy(() => SortOrderSchema).optional(),
  content_text_null_default: z.lazy(() => SortOrderSchema).optional(),
  intvalue_null: z.lazy(() => SortOrderSchema).optional(),
  intvalue_null_default: z.lazy(() => SortOrderSchema).optional(),
  other_items: z.lazy(() => OtherItemsOrderByRelationAggregateInputSchema).optional()
}).strict();

export const ItemsWhereUniqueInputSchema: z.ZodType<Prisma.ItemsWhereUniqueInput> = z.object({
  id: z.string().optional()
}).strict();

export const ItemsOrderByWithAggregationInputSchema: z.ZodType<Prisma.ItemsOrderByWithAggregationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  content: z.lazy(() => SortOrderSchema).optional(),
  content_text_null: z.lazy(() => SortOrderSchema).optional(),
  content_text_null_default: z.lazy(() => SortOrderSchema).optional(),
  intvalue_null: z.lazy(() => SortOrderSchema).optional(),
  intvalue_null_default: z.lazy(() => SortOrderSchema).optional(),
  _count: z.lazy(() => ItemsCountOrderByAggregateInputSchema).optional(),
  _avg: z.lazy(() => ItemsAvgOrderByAggregateInputSchema).optional(),
  _max: z.lazy(() => ItemsMaxOrderByAggregateInputSchema).optional(),
  _min: z.lazy(() => ItemsMinOrderByAggregateInputSchema).optional(),
  _sum: z.lazy(() => ItemsSumOrderByAggregateInputSchema).optional()
}).strict();

export const ItemsScalarWhereWithAggregatesInputSchema: z.ZodType<Prisma.ItemsScalarWhereWithAggregatesInput> = z.object({
  AND: z.union([ z.lazy(() => ItemsScalarWhereWithAggregatesInputSchema),z.lazy(() => ItemsScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  OR: z.lazy(() => ItemsScalarWhereWithAggregatesInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => ItemsScalarWhereWithAggregatesInputSchema),z.lazy(() => ItemsScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  content: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  content_text_null: z.union([ z.lazy(() => StringNullableWithAggregatesFilterSchema),z.string() ]).optional().nullable(),
  content_text_null_default: z.union([ z.lazy(() => StringNullableWithAggregatesFilterSchema),z.string() ]).optional().nullable(),
  intvalue_null: z.union([ z.lazy(() => IntNullableWithAggregatesFilterSchema),z.number() ]).optional().nullable(),
  intvalue_null_default: z.union([ z.lazy(() => IntNullableWithAggregatesFilterSchema),z.number() ]).optional().nullable(),
}).strict();

export const OtherItemsWhereInputSchema: z.ZodType<Prisma.OtherItemsWhereInput> = z.object({
  AND: z.union([ z.lazy(() => OtherItemsWhereInputSchema),z.lazy(() => OtherItemsWhereInputSchema).array() ]).optional(),
  OR: z.lazy(() => OtherItemsWhereInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => OtherItemsWhereInputSchema),z.lazy(() => OtherItemsWhereInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  content: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  item_id: z.union([ z.lazy(() => StringNullableFilterSchema),z.string() ]).optional().nullable(),
  items: z.union([ z.lazy(() => ItemsRelationFilterSchema),z.lazy(() => ItemsWhereInputSchema) ]).optional().nullable(),
}).strict();

export const OtherItemsOrderByWithRelationInputSchema: z.ZodType<Prisma.OtherItemsOrderByWithRelationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  content: z.lazy(() => SortOrderSchema).optional(),
  item_id: z.lazy(() => SortOrderSchema).optional(),
  items: z.lazy(() => ItemsOrderByWithRelationInputSchema).optional()
}).strict();

export const OtherItemsWhereUniqueInputSchema: z.ZodType<Prisma.OtherItemsWhereUniqueInput> = z.object({
  id: z.string().optional()
}).strict();

export const OtherItemsOrderByWithAggregationInputSchema: z.ZodType<Prisma.OtherItemsOrderByWithAggregationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  content: z.lazy(() => SortOrderSchema).optional(),
  item_id: z.lazy(() => SortOrderSchema).optional(),
  _count: z.lazy(() => OtherItemsCountOrderByAggregateInputSchema).optional(),
  _max: z.lazy(() => OtherItemsMaxOrderByAggregateInputSchema).optional(),
  _min: z.lazy(() => OtherItemsMinOrderByAggregateInputSchema).optional()
}).strict();

export const OtherItemsScalarWhereWithAggregatesInputSchema: z.ZodType<Prisma.OtherItemsScalarWhereWithAggregatesInput> = z.object({
  AND: z.union([ z.lazy(() => OtherItemsScalarWhereWithAggregatesInputSchema),z.lazy(() => OtherItemsScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  OR: z.lazy(() => OtherItemsScalarWhereWithAggregatesInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => OtherItemsScalarWhereWithAggregatesInputSchema),z.lazy(() => OtherItemsScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  content: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  item_id: z.union([ z.lazy(() => StringNullableWithAggregatesFilterSchema),z.string() ]).optional().nullable(),
}).strict();

export const ItemsCreateInputSchema: z.ZodType<Prisma.ItemsCreateInput> = z.object({
  id: z.string(),
  content: z.string(),
  content_text_null: z.string().optional().nullable(),
  content_text_null_default: z.string().optional().nullable(),
  intvalue_null: z.number().int().optional().nullable(),
  intvalue_null_default: z.number().int().optional().nullable(),
  other_items: z.lazy(() => OtherItemsCreateNestedManyWithoutItemsInputSchema).optional()
}).strict();

export const ItemsUncheckedCreateInputSchema: z.ZodType<Prisma.ItemsUncheckedCreateInput> = z.object({
  id: z.string(),
  content: z.string(),
  content_text_null: z.string().optional().nullable(),
  content_text_null_default: z.string().optional().nullable(),
  intvalue_null: z.number().int().optional().nullable(),
  intvalue_null_default: z.number().int().optional().nullable(),
  other_items: z.lazy(() => OtherItemsUncheckedCreateNestedManyWithoutItemsInputSchema).optional()
}).strict();

export const ItemsUpdateInputSchema: z.ZodType<Prisma.ItemsUpdateInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  content: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  content_text_null: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  content_text_null_default: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  intvalue_null: z.union([ z.number().int(),z.lazy(() => NullableIntFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  intvalue_null_default: z.union([ z.number().int(),z.lazy(() => NullableIntFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  other_items: z.lazy(() => OtherItemsUpdateManyWithoutItemsNestedInputSchema).optional()
}).strict();

export const ItemsUncheckedUpdateInputSchema: z.ZodType<Prisma.ItemsUncheckedUpdateInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  content: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  content_text_null: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  content_text_null_default: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  intvalue_null: z.union([ z.number().int(),z.lazy(() => NullableIntFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  intvalue_null_default: z.union([ z.number().int(),z.lazy(() => NullableIntFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  other_items: z.lazy(() => OtherItemsUncheckedUpdateManyWithoutItemsNestedInputSchema).optional()
}).strict();

export const ItemsCreateManyInputSchema: z.ZodType<Prisma.ItemsCreateManyInput> = z.object({
  id: z.string(),
  content: z.string(),
  content_text_null: z.string().optional().nullable(),
  content_text_null_default: z.string().optional().nullable(),
  intvalue_null: z.number().int().optional().nullable(),
  intvalue_null_default: z.number().int().optional().nullable()
}).strict();

export const ItemsUpdateManyMutationInputSchema: z.ZodType<Prisma.ItemsUpdateManyMutationInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  content: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  content_text_null: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  content_text_null_default: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  intvalue_null: z.union([ z.number().int(),z.lazy(() => NullableIntFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  intvalue_null_default: z.union([ z.number().int(),z.lazy(() => NullableIntFieldUpdateOperationsInputSchema) ]).optional().nullable(),
}).strict();

export const ItemsUncheckedUpdateManyInputSchema: z.ZodType<Prisma.ItemsUncheckedUpdateManyInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  content: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  content_text_null: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  content_text_null_default: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  intvalue_null: z.union([ z.number().int(),z.lazy(() => NullableIntFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  intvalue_null_default: z.union([ z.number().int(),z.lazy(() => NullableIntFieldUpdateOperationsInputSchema) ]).optional().nullable(),
}).strict();

export const OtherItemsCreateInputSchema: z.ZodType<Prisma.OtherItemsCreateInput> = z.object({
  id: z.string(),
  content: z.string(),
  items: z.lazy(() => ItemsCreateNestedOneWithoutOther_itemsInputSchema).optional()
}).strict();

export const OtherItemsUncheckedCreateInputSchema: z.ZodType<Prisma.OtherItemsUncheckedCreateInput> = z.object({
  id: z.string(),
  content: z.string(),
  item_id: z.string().optional().nullable()
}).strict();

export const OtherItemsUpdateInputSchema: z.ZodType<Prisma.OtherItemsUpdateInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  content: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  items: z.lazy(() => ItemsUpdateOneWithoutOther_itemsNestedInputSchema).optional()
}).strict();

export const OtherItemsUncheckedUpdateInputSchema: z.ZodType<Prisma.OtherItemsUncheckedUpdateInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  content: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  item_id: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
}).strict();

export const OtherItemsCreateManyInputSchema: z.ZodType<Prisma.OtherItemsCreateManyInput> = z.object({
  id: z.string(),
  content: z.string(),
  item_id: z.string().optional().nullable()
}).strict();

export const OtherItemsUpdateManyMutationInputSchema: z.ZodType<Prisma.OtherItemsUpdateManyMutationInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  content: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const OtherItemsUncheckedUpdateManyInputSchema: z.ZodType<Prisma.OtherItemsUncheckedUpdateManyInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  content: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  item_id: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
}).strict();

export const StringFilterSchema: z.ZodType<Prisma.StringFilter> = z.object({
  equals: z.string().optional(),
  in: z.union([ z.string().array(),z.string() ]).optional(),
  notIn: z.union([ z.string().array(),z.string() ]).optional(),
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

export const StringNullableFilterSchema: z.ZodType<Prisma.StringNullableFilter> = z.object({
  equals: z.string().optional().nullable(),
  in: z.union([ z.string().array(),z.string() ]).optional().nullable(),
  notIn: z.union([ z.string().array(),z.string() ]).optional().nullable(),
  lt: z.string().optional(),
  lte: z.string().optional(),
  gt: z.string().optional(),
  gte: z.string().optional(),
  contains: z.string().optional(),
  startsWith: z.string().optional(),
  endsWith: z.string().optional(),
  mode: z.lazy(() => QueryModeSchema).optional(),
  not: z.union([ z.string(),z.lazy(() => NestedStringNullableFilterSchema) ]).optional().nullable(),
}).strict();

export const IntNullableFilterSchema: z.ZodType<Prisma.IntNullableFilter> = z.object({
  equals: z.number().optional().nullable(),
  in: z.union([ z.number().array(),z.number() ]).optional().nullable(),
  notIn: z.union([ z.number().array(),z.number() ]).optional().nullable(),
  lt: z.number().optional(),
  lte: z.number().optional(),
  gt: z.number().optional(),
  gte: z.number().optional(),
  not: z.union([ z.number(),z.lazy(() => NestedIntNullableFilterSchema) ]).optional().nullable(),
}).strict();

export const OtherItemsListRelationFilterSchema: z.ZodType<Prisma.OtherItemsListRelationFilter> = z.object({
  every: z.lazy(() => OtherItemsWhereInputSchema).optional(),
  some: z.lazy(() => OtherItemsWhereInputSchema).optional(),
  none: z.lazy(() => OtherItemsWhereInputSchema).optional()
}).strict();

export const OtherItemsOrderByRelationAggregateInputSchema: z.ZodType<Prisma.OtherItemsOrderByRelationAggregateInput> = z.object({
  _count: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const ItemsCountOrderByAggregateInputSchema: z.ZodType<Prisma.ItemsCountOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  content: z.lazy(() => SortOrderSchema).optional(),
  content_text_null: z.lazy(() => SortOrderSchema).optional(),
  content_text_null_default: z.lazy(() => SortOrderSchema).optional(),
  intvalue_null: z.lazy(() => SortOrderSchema).optional(),
  intvalue_null_default: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const ItemsAvgOrderByAggregateInputSchema: z.ZodType<Prisma.ItemsAvgOrderByAggregateInput> = z.object({
  intvalue_null: z.lazy(() => SortOrderSchema).optional(),
  intvalue_null_default: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const ItemsMaxOrderByAggregateInputSchema: z.ZodType<Prisma.ItemsMaxOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  content: z.lazy(() => SortOrderSchema).optional(),
  content_text_null: z.lazy(() => SortOrderSchema).optional(),
  content_text_null_default: z.lazy(() => SortOrderSchema).optional(),
  intvalue_null: z.lazy(() => SortOrderSchema).optional(),
  intvalue_null_default: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const ItemsMinOrderByAggregateInputSchema: z.ZodType<Prisma.ItemsMinOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  content: z.lazy(() => SortOrderSchema).optional(),
  content_text_null: z.lazy(() => SortOrderSchema).optional(),
  content_text_null_default: z.lazy(() => SortOrderSchema).optional(),
  intvalue_null: z.lazy(() => SortOrderSchema).optional(),
  intvalue_null_default: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const ItemsSumOrderByAggregateInputSchema: z.ZodType<Prisma.ItemsSumOrderByAggregateInput> = z.object({
  intvalue_null: z.lazy(() => SortOrderSchema).optional(),
  intvalue_null_default: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const StringWithAggregatesFilterSchema: z.ZodType<Prisma.StringWithAggregatesFilter> = z.object({
  equals: z.string().optional(),
  in: z.union([ z.string().array(),z.string() ]).optional(),
  notIn: z.union([ z.string().array(),z.string() ]).optional(),
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

export const StringNullableWithAggregatesFilterSchema: z.ZodType<Prisma.StringNullableWithAggregatesFilter> = z.object({
  equals: z.string().optional().nullable(),
  in: z.union([ z.string().array(),z.string() ]).optional().nullable(),
  notIn: z.union([ z.string().array(),z.string() ]).optional().nullable(),
  lt: z.string().optional(),
  lte: z.string().optional(),
  gt: z.string().optional(),
  gte: z.string().optional(),
  contains: z.string().optional(),
  startsWith: z.string().optional(),
  endsWith: z.string().optional(),
  mode: z.lazy(() => QueryModeSchema).optional(),
  not: z.union([ z.string(),z.lazy(() => NestedStringNullableWithAggregatesFilterSchema) ]).optional().nullable(),
  _count: z.lazy(() => NestedIntNullableFilterSchema).optional(),
  _min: z.lazy(() => NestedStringNullableFilterSchema).optional(),
  _max: z.lazy(() => NestedStringNullableFilterSchema).optional()
}).strict();

export const IntNullableWithAggregatesFilterSchema: z.ZodType<Prisma.IntNullableWithAggregatesFilter> = z.object({
  equals: z.number().optional().nullable(),
  in: z.union([ z.number().array(),z.number() ]).optional().nullable(),
  notIn: z.union([ z.number().array(),z.number() ]).optional().nullable(),
  lt: z.number().optional(),
  lte: z.number().optional(),
  gt: z.number().optional(),
  gte: z.number().optional(),
  not: z.union([ z.number(),z.lazy(() => NestedIntNullableWithAggregatesFilterSchema) ]).optional().nullable(),
  _count: z.lazy(() => NestedIntNullableFilterSchema).optional(),
  _avg: z.lazy(() => NestedFloatNullableFilterSchema).optional(),
  _sum: z.lazy(() => NestedIntNullableFilterSchema).optional(),
  _min: z.lazy(() => NestedIntNullableFilterSchema).optional(),
  _max: z.lazy(() => NestedIntNullableFilterSchema).optional()
}).strict();

export const ItemsRelationFilterSchema: z.ZodType<Prisma.ItemsRelationFilter> = z.object({
  is: z.lazy(() => ItemsWhereInputSchema).optional().nullable(),
  isNot: z.lazy(() => ItemsWhereInputSchema).optional().nullable()
}).strict();

export const OtherItemsCountOrderByAggregateInputSchema: z.ZodType<Prisma.OtherItemsCountOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  content: z.lazy(() => SortOrderSchema).optional(),
  item_id: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const OtherItemsMaxOrderByAggregateInputSchema: z.ZodType<Prisma.OtherItemsMaxOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  content: z.lazy(() => SortOrderSchema).optional(),
  item_id: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const OtherItemsMinOrderByAggregateInputSchema: z.ZodType<Prisma.OtherItemsMinOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  content: z.lazy(() => SortOrderSchema).optional(),
  item_id: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const OtherItemsCreateNestedManyWithoutItemsInputSchema: z.ZodType<Prisma.OtherItemsCreateNestedManyWithoutItemsInput> = z.object({
  create: z.union([ z.lazy(() => OtherItemsCreateWithoutItemsInputSchema),z.lazy(() => OtherItemsCreateWithoutItemsInputSchema).array(),z.lazy(() => OtherItemsUncheckedCreateWithoutItemsInputSchema),z.lazy(() => OtherItemsUncheckedCreateWithoutItemsInputSchema).array() ]).optional(),
  connectOrCreate: z.union([ z.lazy(() => OtherItemsCreateOrConnectWithoutItemsInputSchema),z.lazy(() => OtherItemsCreateOrConnectWithoutItemsInputSchema).array() ]).optional(),
  createMany: z.lazy(() => OtherItemsCreateManyItemsInputEnvelopeSchema).optional(),
  connect: z.union([ z.lazy(() => OtherItemsWhereUniqueInputSchema),z.lazy(() => OtherItemsWhereUniqueInputSchema).array() ]).optional(),
}).strict();

export const OtherItemsUncheckedCreateNestedManyWithoutItemsInputSchema: z.ZodType<Prisma.OtherItemsUncheckedCreateNestedManyWithoutItemsInput> = z.object({
  create: z.union([ z.lazy(() => OtherItemsCreateWithoutItemsInputSchema),z.lazy(() => OtherItemsCreateWithoutItemsInputSchema).array(),z.lazy(() => OtherItemsUncheckedCreateWithoutItemsInputSchema),z.lazy(() => OtherItemsUncheckedCreateWithoutItemsInputSchema).array() ]).optional(),
  connectOrCreate: z.union([ z.lazy(() => OtherItemsCreateOrConnectWithoutItemsInputSchema),z.lazy(() => OtherItemsCreateOrConnectWithoutItemsInputSchema).array() ]).optional(),
  createMany: z.lazy(() => OtherItemsCreateManyItemsInputEnvelopeSchema).optional(),
  connect: z.union([ z.lazy(() => OtherItemsWhereUniqueInputSchema),z.lazy(() => OtherItemsWhereUniqueInputSchema).array() ]).optional(),
}).strict();

export const StringFieldUpdateOperationsInputSchema: z.ZodType<Prisma.StringFieldUpdateOperationsInput> = z.object({
  set: z.string().optional()
}).strict();

export const NullableStringFieldUpdateOperationsInputSchema: z.ZodType<Prisma.NullableStringFieldUpdateOperationsInput> = z.object({
  set: z.string().optional().nullable()
}).strict();

export const NullableIntFieldUpdateOperationsInputSchema: z.ZodType<Prisma.NullableIntFieldUpdateOperationsInput> = z.object({
  set: z.number().optional().nullable(),
  increment: z.number().optional(),
  decrement: z.number().optional(),
  multiply: z.number().optional(),
  divide: z.number().optional()
}).strict();

export const OtherItemsUpdateManyWithoutItemsNestedInputSchema: z.ZodType<Prisma.OtherItemsUpdateManyWithoutItemsNestedInput> = z.object({
  create: z.union([ z.lazy(() => OtherItemsCreateWithoutItemsInputSchema),z.lazy(() => OtherItemsCreateWithoutItemsInputSchema).array(),z.lazy(() => OtherItemsUncheckedCreateWithoutItemsInputSchema),z.lazy(() => OtherItemsUncheckedCreateWithoutItemsInputSchema).array() ]).optional(),
  connectOrCreate: z.union([ z.lazy(() => OtherItemsCreateOrConnectWithoutItemsInputSchema),z.lazy(() => OtherItemsCreateOrConnectWithoutItemsInputSchema).array() ]).optional(),
  upsert: z.union([ z.lazy(() => OtherItemsUpsertWithWhereUniqueWithoutItemsInputSchema),z.lazy(() => OtherItemsUpsertWithWhereUniqueWithoutItemsInputSchema).array() ]).optional(),
  createMany: z.lazy(() => OtherItemsCreateManyItemsInputEnvelopeSchema).optional(),
  set: z.union([ z.lazy(() => OtherItemsWhereUniqueInputSchema),z.lazy(() => OtherItemsWhereUniqueInputSchema).array() ]).optional(),
  disconnect: z.union([ z.lazy(() => OtherItemsWhereUniqueInputSchema),z.lazy(() => OtherItemsWhereUniqueInputSchema).array() ]).optional(),
  delete: z.union([ z.lazy(() => OtherItemsWhereUniqueInputSchema),z.lazy(() => OtherItemsWhereUniqueInputSchema).array() ]).optional(),
  connect: z.union([ z.lazy(() => OtherItemsWhereUniqueInputSchema),z.lazy(() => OtherItemsWhereUniqueInputSchema).array() ]).optional(),
  update: z.union([ z.lazy(() => OtherItemsUpdateWithWhereUniqueWithoutItemsInputSchema),z.lazy(() => OtherItemsUpdateWithWhereUniqueWithoutItemsInputSchema).array() ]).optional(),
  updateMany: z.union([ z.lazy(() => OtherItemsUpdateManyWithWhereWithoutItemsInputSchema),z.lazy(() => OtherItemsUpdateManyWithWhereWithoutItemsInputSchema).array() ]).optional(),
  deleteMany: z.union([ z.lazy(() => OtherItemsScalarWhereInputSchema),z.lazy(() => OtherItemsScalarWhereInputSchema).array() ]).optional(),
}).strict();

export const OtherItemsUncheckedUpdateManyWithoutItemsNestedInputSchema: z.ZodType<Prisma.OtherItemsUncheckedUpdateManyWithoutItemsNestedInput> = z.object({
  create: z.union([ z.lazy(() => OtherItemsCreateWithoutItemsInputSchema),z.lazy(() => OtherItemsCreateWithoutItemsInputSchema).array(),z.lazy(() => OtherItemsUncheckedCreateWithoutItemsInputSchema),z.lazy(() => OtherItemsUncheckedCreateWithoutItemsInputSchema).array() ]).optional(),
  connectOrCreate: z.union([ z.lazy(() => OtherItemsCreateOrConnectWithoutItemsInputSchema),z.lazy(() => OtherItemsCreateOrConnectWithoutItemsInputSchema).array() ]).optional(),
  upsert: z.union([ z.lazy(() => OtherItemsUpsertWithWhereUniqueWithoutItemsInputSchema),z.lazy(() => OtherItemsUpsertWithWhereUniqueWithoutItemsInputSchema).array() ]).optional(),
  createMany: z.lazy(() => OtherItemsCreateManyItemsInputEnvelopeSchema).optional(),
  set: z.union([ z.lazy(() => OtherItemsWhereUniqueInputSchema),z.lazy(() => OtherItemsWhereUniqueInputSchema).array() ]).optional(),
  disconnect: z.union([ z.lazy(() => OtherItemsWhereUniqueInputSchema),z.lazy(() => OtherItemsWhereUniqueInputSchema).array() ]).optional(),
  delete: z.union([ z.lazy(() => OtherItemsWhereUniqueInputSchema),z.lazy(() => OtherItemsWhereUniqueInputSchema).array() ]).optional(),
  connect: z.union([ z.lazy(() => OtherItemsWhereUniqueInputSchema),z.lazy(() => OtherItemsWhereUniqueInputSchema).array() ]).optional(),
  update: z.union([ z.lazy(() => OtherItemsUpdateWithWhereUniqueWithoutItemsInputSchema),z.lazy(() => OtherItemsUpdateWithWhereUniqueWithoutItemsInputSchema).array() ]).optional(),
  updateMany: z.union([ z.lazy(() => OtherItemsUpdateManyWithWhereWithoutItemsInputSchema),z.lazy(() => OtherItemsUpdateManyWithWhereWithoutItemsInputSchema).array() ]).optional(),
  deleteMany: z.union([ z.lazy(() => OtherItemsScalarWhereInputSchema),z.lazy(() => OtherItemsScalarWhereInputSchema).array() ]).optional(),
}).strict();

export const ItemsCreateNestedOneWithoutOther_itemsInputSchema: z.ZodType<Prisma.ItemsCreateNestedOneWithoutOther_itemsInput> = z.object({
  create: z.union([ z.lazy(() => ItemsCreateWithoutOther_itemsInputSchema),z.lazy(() => ItemsUncheckedCreateWithoutOther_itemsInputSchema) ]).optional(),
  connectOrCreate: z.lazy(() => ItemsCreateOrConnectWithoutOther_itemsInputSchema).optional(),
  connect: z.lazy(() => ItemsWhereUniqueInputSchema).optional()
}).strict();

export const ItemsUpdateOneWithoutOther_itemsNestedInputSchema: z.ZodType<Prisma.ItemsUpdateOneWithoutOther_itemsNestedInput> = z.object({
  create: z.union([ z.lazy(() => ItemsCreateWithoutOther_itemsInputSchema),z.lazy(() => ItemsUncheckedCreateWithoutOther_itemsInputSchema) ]).optional(),
  connectOrCreate: z.lazy(() => ItemsCreateOrConnectWithoutOther_itemsInputSchema).optional(),
  upsert: z.lazy(() => ItemsUpsertWithoutOther_itemsInputSchema).optional(),
  disconnect: z.boolean().optional(),
  delete: z.boolean().optional(),
  connect: z.lazy(() => ItemsWhereUniqueInputSchema).optional(),
  update: z.union([ z.lazy(() => ItemsUpdateWithoutOther_itemsInputSchema),z.lazy(() => ItemsUncheckedUpdateWithoutOther_itemsInputSchema) ]).optional(),
}).strict();

export const NestedStringFilterSchema: z.ZodType<Prisma.NestedStringFilter> = z.object({
  equals: z.string().optional(),
  in: z.union([ z.string().array(),z.string() ]).optional(),
  notIn: z.union([ z.string().array(),z.string() ]).optional(),
  lt: z.string().optional(),
  lte: z.string().optional(),
  gt: z.string().optional(),
  gte: z.string().optional(),
  contains: z.string().optional(),
  startsWith: z.string().optional(),
  endsWith: z.string().optional(),
  not: z.union([ z.string(),z.lazy(() => NestedStringFilterSchema) ]).optional(),
}).strict();

export const NestedStringNullableFilterSchema: z.ZodType<Prisma.NestedStringNullableFilter> = z.object({
  equals: z.string().optional().nullable(),
  in: z.union([ z.string().array(),z.string() ]).optional().nullable(),
  notIn: z.union([ z.string().array(),z.string() ]).optional().nullable(),
  lt: z.string().optional(),
  lte: z.string().optional(),
  gt: z.string().optional(),
  gte: z.string().optional(),
  contains: z.string().optional(),
  startsWith: z.string().optional(),
  endsWith: z.string().optional(),
  not: z.union([ z.string(),z.lazy(() => NestedStringNullableFilterSchema) ]).optional().nullable(),
}).strict();

export const NestedIntNullableFilterSchema: z.ZodType<Prisma.NestedIntNullableFilter> = z.object({
  equals: z.number().optional().nullable(),
  in: z.union([ z.number().array(),z.number() ]).optional().nullable(),
  notIn: z.union([ z.number().array(),z.number() ]).optional().nullable(),
  lt: z.number().optional(),
  lte: z.number().optional(),
  gt: z.number().optional(),
  gte: z.number().optional(),
  not: z.union([ z.number(),z.lazy(() => NestedIntNullableFilterSchema) ]).optional().nullable(),
}).strict();

export const NestedStringWithAggregatesFilterSchema: z.ZodType<Prisma.NestedStringWithAggregatesFilter> = z.object({
  equals: z.string().optional(),
  in: z.union([ z.string().array(),z.string() ]).optional(),
  notIn: z.union([ z.string().array(),z.string() ]).optional(),
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
  in: z.union([ z.number().array(),z.number() ]).optional(),
  notIn: z.union([ z.number().array(),z.number() ]).optional(),
  lt: z.number().optional(),
  lte: z.number().optional(),
  gt: z.number().optional(),
  gte: z.number().optional(),
  not: z.union([ z.number(),z.lazy(() => NestedIntFilterSchema) ]).optional(),
}).strict();

export const NestedStringNullableWithAggregatesFilterSchema: z.ZodType<Prisma.NestedStringNullableWithAggregatesFilter> = z.object({
  equals: z.string().optional().nullable(),
  in: z.union([ z.string().array(),z.string() ]).optional().nullable(),
  notIn: z.union([ z.string().array(),z.string() ]).optional().nullable(),
  lt: z.string().optional(),
  lte: z.string().optional(),
  gt: z.string().optional(),
  gte: z.string().optional(),
  contains: z.string().optional(),
  startsWith: z.string().optional(),
  endsWith: z.string().optional(),
  not: z.union([ z.string(),z.lazy(() => NestedStringNullableWithAggregatesFilterSchema) ]).optional().nullable(),
  _count: z.lazy(() => NestedIntNullableFilterSchema).optional(),
  _min: z.lazy(() => NestedStringNullableFilterSchema).optional(),
  _max: z.lazy(() => NestedStringNullableFilterSchema).optional()
}).strict();

export const NestedIntNullableWithAggregatesFilterSchema: z.ZodType<Prisma.NestedIntNullableWithAggregatesFilter> = z.object({
  equals: z.number().optional().nullable(),
  in: z.union([ z.number().array(),z.number() ]).optional().nullable(),
  notIn: z.union([ z.number().array(),z.number() ]).optional().nullable(),
  lt: z.number().optional(),
  lte: z.number().optional(),
  gt: z.number().optional(),
  gte: z.number().optional(),
  not: z.union([ z.number(),z.lazy(() => NestedIntNullableWithAggregatesFilterSchema) ]).optional().nullable(),
  _count: z.lazy(() => NestedIntNullableFilterSchema).optional(),
  _avg: z.lazy(() => NestedFloatNullableFilterSchema).optional(),
  _sum: z.lazy(() => NestedIntNullableFilterSchema).optional(),
  _min: z.lazy(() => NestedIntNullableFilterSchema).optional(),
  _max: z.lazy(() => NestedIntNullableFilterSchema).optional()
}).strict();

export const NestedFloatNullableFilterSchema: z.ZodType<Prisma.NestedFloatNullableFilter> = z.object({
  equals: z.number().optional().nullable(),
  in: z.union([ z.number().array(),z.number() ]).optional().nullable(),
  notIn: z.union([ z.number().array(),z.number() ]).optional().nullable(),
  lt: z.number().optional(),
  lte: z.number().optional(),
  gt: z.number().optional(),
  gte: z.number().optional(),
  not: z.union([ z.number(),z.lazy(() => NestedFloatNullableFilterSchema) ]).optional().nullable(),
}).strict();

export const OtherItemsCreateWithoutItemsInputSchema: z.ZodType<Prisma.OtherItemsCreateWithoutItemsInput> = z.object({
  id: z.string(),
  content: z.string()
}).strict();

export const OtherItemsUncheckedCreateWithoutItemsInputSchema: z.ZodType<Prisma.OtherItemsUncheckedCreateWithoutItemsInput> = z.object({
  id: z.string(),
  content: z.string()
}).strict();

export const OtherItemsCreateOrConnectWithoutItemsInputSchema: z.ZodType<Prisma.OtherItemsCreateOrConnectWithoutItemsInput> = z.object({
  where: z.lazy(() => OtherItemsWhereUniqueInputSchema),
  create: z.union([ z.lazy(() => OtherItemsCreateWithoutItemsInputSchema),z.lazy(() => OtherItemsUncheckedCreateWithoutItemsInputSchema) ]),
}).strict();

export const OtherItemsCreateManyItemsInputEnvelopeSchema: z.ZodType<Prisma.OtherItemsCreateManyItemsInputEnvelope> = z.object({
  data: z.union([ z.lazy(() => OtherItemsCreateManyItemsInputSchema),z.lazy(() => OtherItemsCreateManyItemsInputSchema).array() ]),
  skipDuplicates: z.boolean().optional()
}).strict();

export const OtherItemsUpsertWithWhereUniqueWithoutItemsInputSchema: z.ZodType<Prisma.OtherItemsUpsertWithWhereUniqueWithoutItemsInput> = z.object({
  where: z.lazy(() => OtherItemsWhereUniqueInputSchema),
  update: z.union([ z.lazy(() => OtherItemsUpdateWithoutItemsInputSchema),z.lazy(() => OtherItemsUncheckedUpdateWithoutItemsInputSchema) ]),
  create: z.union([ z.lazy(() => OtherItemsCreateWithoutItemsInputSchema),z.lazy(() => OtherItemsUncheckedCreateWithoutItemsInputSchema) ]),
}).strict();

export const OtherItemsUpdateWithWhereUniqueWithoutItemsInputSchema: z.ZodType<Prisma.OtherItemsUpdateWithWhereUniqueWithoutItemsInput> = z.object({
  where: z.lazy(() => OtherItemsWhereUniqueInputSchema),
  data: z.union([ z.lazy(() => OtherItemsUpdateWithoutItemsInputSchema),z.lazy(() => OtherItemsUncheckedUpdateWithoutItemsInputSchema) ]),
}).strict();

export const OtherItemsUpdateManyWithWhereWithoutItemsInputSchema: z.ZodType<Prisma.OtherItemsUpdateManyWithWhereWithoutItemsInput> = z.object({
  where: z.lazy(() => OtherItemsScalarWhereInputSchema),
  data: z.union([ z.lazy(() => OtherItemsUpdateManyMutationInputSchema),z.lazy(() => OtherItemsUncheckedUpdateManyWithoutOther_itemsInputSchema) ]),
}).strict();

export const OtherItemsScalarWhereInputSchema: z.ZodType<Prisma.OtherItemsScalarWhereInput> = z.object({
  AND: z.union([ z.lazy(() => OtherItemsScalarWhereInputSchema),z.lazy(() => OtherItemsScalarWhereInputSchema).array() ]).optional(),
  OR: z.lazy(() => OtherItemsScalarWhereInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => OtherItemsScalarWhereInputSchema),z.lazy(() => OtherItemsScalarWhereInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  content: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  item_id: z.union([ z.lazy(() => StringNullableFilterSchema),z.string() ]).optional().nullable(),
}).strict();

export const ItemsCreateWithoutOther_itemsInputSchema: z.ZodType<Prisma.ItemsCreateWithoutOther_itemsInput> = z.object({
  id: z.string(),
  content: z.string(),
  content_text_null: z.string().optional().nullable(),
  content_text_null_default: z.string().optional().nullable(),
  intvalue_null: z.number().optional().nullable(),
  intvalue_null_default: z.number().optional().nullable()
}).strict();

export const ItemsUncheckedCreateWithoutOther_itemsInputSchema: z.ZodType<Prisma.ItemsUncheckedCreateWithoutOther_itemsInput> = z.object({
  id: z.string(),
  content: z.string(),
  content_text_null: z.string().optional().nullable(),
  content_text_null_default: z.string().optional().nullable(),
  intvalue_null: z.number().optional().nullable(),
  intvalue_null_default: z.number().optional().nullable()
}).strict();

export const ItemsCreateOrConnectWithoutOther_itemsInputSchema: z.ZodType<Prisma.ItemsCreateOrConnectWithoutOther_itemsInput> = z.object({
  where: z.lazy(() => ItemsWhereUniqueInputSchema),
  create: z.union([ z.lazy(() => ItemsCreateWithoutOther_itemsInputSchema),z.lazy(() => ItemsUncheckedCreateWithoutOther_itemsInputSchema) ]),
}).strict();

export const ItemsUpsertWithoutOther_itemsInputSchema: z.ZodType<Prisma.ItemsUpsertWithoutOther_itemsInput> = z.object({
  update: z.union([ z.lazy(() => ItemsUpdateWithoutOther_itemsInputSchema),z.lazy(() => ItemsUncheckedUpdateWithoutOther_itemsInputSchema) ]),
  create: z.union([ z.lazy(() => ItemsCreateWithoutOther_itemsInputSchema),z.lazy(() => ItemsUncheckedCreateWithoutOther_itemsInputSchema) ]),
}).strict();

export const ItemsUpdateWithoutOther_itemsInputSchema: z.ZodType<Prisma.ItemsUpdateWithoutOther_itemsInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  content: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  content_text_null: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  content_text_null_default: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  intvalue_null: z.union([ z.number(),z.lazy(() => NullableIntFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  intvalue_null_default: z.union([ z.number(),z.lazy(() => NullableIntFieldUpdateOperationsInputSchema) ]).optional().nullable(),
}).strict();

export const ItemsUncheckedUpdateWithoutOther_itemsInputSchema: z.ZodType<Prisma.ItemsUncheckedUpdateWithoutOther_itemsInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  content: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  content_text_null: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  content_text_null_default: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  intvalue_null: z.union([ z.number(),z.lazy(() => NullableIntFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  intvalue_null_default: z.union([ z.number(),z.lazy(() => NullableIntFieldUpdateOperationsInputSchema) ]).optional().nullable(),
}).strict();

export const OtherItemsCreateManyItemsInputSchema: z.ZodType<Prisma.OtherItemsCreateManyItemsInput> = z.object({
  id: z.string(),
  content: z.string()
}).strict();

export const OtherItemsUpdateWithoutItemsInputSchema: z.ZodType<Prisma.OtherItemsUpdateWithoutItemsInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  content: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const OtherItemsUncheckedUpdateWithoutItemsInputSchema: z.ZodType<Prisma.OtherItemsUncheckedUpdateWithoutItemsInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  content: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const OtherItemsUncheckedUpdateManyWithoutOther_itemsInputSchema: z.ZodType<Prisma.OtherItemsUncheckedUpdateManyWithoutOther_itemsInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  content: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

/////////////////////////////////////////
// ARGS
/////////////////////////////////////////

export const ItemsFindFirstArgsSchema: z.ZodType<Prisma.ItemsFindFirstArgs> = z.object({
  select: ItemsSelectSchema.optional(),
  include: ItemsIncludeSchema.optional(),
  where: ItemsWhereInputSchema.optional(),
  orderBy: z.union([ ItemsOrderByWithRelationInputSchema.array(),ItemsOrderByWithRelationInputSchema ]).optional(),
  cursor: ItemsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: ItemsScalarFieldEnumSchema.array().optional(),
}).strict()

export const ItemsFindFirstOrThrowArgsSchema: z.ZodType<Prisma.ItemsFindFirstOrThrowArgs> = z.object({
  select: ItemsSelectSchema.optional(),
  include: ItemsIncludeSchema.optional(),
  where: ItemsWhereInputSchema.optional(),
  orderBy: z.union([ ItemsOrderByWithRelationInputSchema.array(),ItemsOrderByWithRelationInputSchema ]).optional(),
  cursor: ItemsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: ItemsScalarFieldEnumSchema.array().optional(),
}).strict()

export const ItemsFindManyArgsSchema: z.ZodType<Prisma.ItemsFindManyArgs> = z.object({
  select: ItemsSelectSchema.optional(),
  include: ItemsIncludeSchema.optional(),
  where: ItemsWhereInputSchema.optional(),
  orderBy: z.union([ ItemsOrderByWithRelationInputSchema.array(),ItemsOrderByWithRelationInputSchema ]).optional(),
  cursor: ItemsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: ItemsScalarFieldEnumSchema.array().optional(),
}).strict()

export const ItemsAggregateArgsSchema: z.ZodType<Prisma.ItemsAggregateArgs> = z.object({
  where: ItemsWhereInputSchema.optional(),
  orderBy: z.union([ ItemsOrderByWithRelationInputSchema.array(),ItemsOrderByWithRelationInputSchema ]).optional(),
  cursor: ItemsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict()

export const ItemsGroupByArgsSchema: z.ZodType<Prisma.ItemsGroupByArgs> = z.object({
  where: ItemsWhereInputSchema.optional(),
  orderBy: z.union([ ItemsOrderByWithAggregationInputSchema.array(),ItemsOrderByWithAggregationInputSchema ]).optional(),
  by: ItemsScalarFieldEnumSchema.array(),
  having: ItemsScalarWhereWithAggregatesInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict()

export const ItemsFindUniqueArgsSchema: z.ZodType<Prisma.ItemsFindUniqueArgs> = z.object({
  select: ItemsSelectSchema.optional(),
  include: ItemsIncludeSchema.optional(),
  where: ItemsWhereUniqueInputSchema,
}).strict()

export const ItemsFindUniqueOrThrowArgsSchema: z.ZodType<Prisma.ItemsFindUniqueOrThrowArgs> = z.object({
  select: ItemsSelectSchema.optional(),
  include: ItemsIncludeSchema.optional(),
  where: ItemsWhereUniqueInputSchema,
}).strict()

export const OtherItemsFindFirstArgsSchema: z.ZodType<Prisma.OtherItemsFindFirstArgs> = z.object({
  select: OtherItemsSelectSchema.optional(),
  include: OtherItemsIncludeSchema.optional(),
  where: OtherItemsWhereInputSchema.optional(),
  orderBy: z.union([ OtherItemsOrderByWithRelationInputSchema.array(),OtherItemsOrderByWithRelationInputSchema ]).optional(),
  cursor: OtherItemsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: OtherItemsScalarFieldEnumSchema.array().optional(),
}).strict()

export const OtherItemsFindFirstOrThrowArgsSchema: z.ZodType<Prisma.OtherItemsFindFirstOrThrowArgs> = z.object({
  select: OtherItemsSelectSchema.optional(),
  include: OtherItemsIncludeSchema.optional(),
  where: OtherItemsWhereInputSchema.optional(),
  orderBy: z.union([ OtherItemsOrderByWithRelationInputSchema.array(),OtherItemsOrderByWithRelationInputSchema ]).optional(),
  cursor: OtherItemsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: OtherItemsScalarFieldEnumSchema.array().optional(),
}).strict()

export const OtherItemsFindManyArgsSchema: z.ZodType<Prisma.OtherItemsFindManyArgs> = z.object({
  select: OtherItemsSelectSchema.optional(),
  include: OtherItemsIncludeSchema.optional(),
  where: OtherItemsWhereInputSchema.optional(),
  orderBy: z.union([ OtherItemsOrderByWithRelationInputSchema.array(),OtherItemsOrderByWithRelationInputSchema ]).optional(),
  cursor: OtherItemsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: OtherItemsScalarFieldEnumSchema.array().optional(),
}).strict()

export const OtherItemsAggregateArgsSchema: z.ZodType<Prisma.OtherItemsAggregateArgs> = z.object({
  where: OtherItemsWhereInputSchema.optional(),
  orderBy: z.union([ OtherItemsOrderByWithRelationInputSchema.array(),OtherItemsOrderByWithRelationInputSchema ]).optional(),
  cursor: OtherItemsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict()

export const OtherItemsGroupByArgsSchema: z.ZodType<Prisma.OtherItemsGroupByArgs> = z.object({
  where: OtherItemsWhereInputSchema.optional(),
  orderBy: z.union([ OtherItemsOrderByWithAggregationInputSchema.array(),OtherItemsOrderByWithAggregationInputSchema ]).optional(),
  by: OtherItemsScalarFieldEnumSchema.array(),
  having: OtherItemsScalarWhereWithAggregatesInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict()

export const OtherItemsFindUniqueArgsSchema: z.ZodType<Prisma.OtherItemsFindUniqueArgs> = z.object({
  select: OtherItemsSelectSchema.optional(),
  include: OtherItemsIncludeSchema.optional(),
  where: OtherItemsWhereUniqueInputSchema,
}).strict()

export const OtherItemsFindUniqueOrThrowArgsSchema: z.ZodType<Prisma.OtherItemsFindUniqueOrThrowArgs> = z.object({
  select: OtherItemsSelectSchema.optional(),
  include: OtherItemsIncludeSchema.optional(),
  where: OtherItemsWhereUniqueInputSchema,
}).strict()

export const ItemsCreateArgsSchema: z.ZodType<Prisma.ItemsCreateArgs> = z.object({
  select: ItemsSelectSchema.optional(),
  include: ItemsIncludeSchema.optional(),
  data: z.union([ ItemsCreateInputSchema,ItemsUncheckedCreateInputSchema ]),
}).strict()

export const ItemsUpsertArgsSchema: z.ZodType<Prisma.ItemsUpsertArgs> = z.object({
  select: ItemsSelectSchema.optional(),
  include: ItemsIncludeSchema.optional(),
  where: ItemsWhereUniqueInputSchema,
  create: z.union([ ItemsCreateInputSchema,ItemsUncheckedCreateInputSchema ]),
  update: z.union([ ItemsUpdateInputSchema,ItemsUncheckedUpdateInputSchema ]),
}).strict()

export const ItemsCreateManyArgsSchema: z.ZodType<Prisma.ItemsCreateManyArgs> = z.object({
  data: z.union([ ItemsCreateManyInputSchema,ItemsCreateManyInputSchema.array() ]),
  skipDuplicates: z.boolean().optional(),
}).strict()

export const ItemsDeleteArgsSchema: z.ZodType<Prisma.ItemsDeleteArgs> = z.object({
  select: ItemsSelectSchema.optional(),
  include: ItemsIncludeSchema.optional(),
  where: ItemsWhereUniqueInputSchema,
}).strict()

export const ItemsUpdateArgsSchema: z.ZodType<Prisma.ItemsUpdateArgs> = z.object({
  select: ItemsSelectSchema.optional(),
  include: ItemsIncludeSchema.optional(),
  data: z.union([ ItemsUpdateInputSchema,ItemsUncheckedUpdateInputSchema ]),
  where: ItemsWhereUniqueInputSchema,
}).strict()

export const ItemsUpdateManyArgsSchema: z.ZodType<Prisma.ItemsUpdateManyArgs> = z.object({
  data: z.union([ ItemsUpdateManyMutationInputSchema,ItemsUncheckedUpdateManyInputSchema ]),
  where: ItemsWhereInputSchema.optional(),
}).strict()

export const ItemsDeleteManyArgsSchema: z.ZodType<Prisma.ItemsDeleteManyArgs> = z.object({
  where: ItemsWhereInputSchema.optional(),
}).strict()

export const OtherItemsCreateArgsSchema: z.ZodType<Prisma.OtherItemsCreateArgs> = z.object({
  select: OtherItemsSelectSchema.optional(),
  include: OtherItemsIncludeSchema.optional(),
  data: z.union([ OtherItemsCreateInputSchema,OtherItemsUncheckedCreateInputSchema ]),
}).strict()

export const OtherItemsUpsertArgsSchema: z.ZodType<Prisma.OtherItemsUpsertArgs> = z.object({
  select: OtherItemsSelectSchema.optional(),
  include: OtherItemsIncludeSchema.optional(),
  where: OtherItemsWhereUniqueInputSchema,
  create: z.union([ OtherItemsCreateInputSchema,OtherItemsUncheckedCreateInputSchema ]),
  update: z.union([ OtherItemsUpdateInputSchema,OtherItemsUncheckedUpdateInputSchema ]),
}).strict()

export const OtherItemsCreateManyArgsSchema: z.ZodType<Prisma.OtherItemsCreateManyArgs> = z.object({
  data: z.union([ OtherItemsCreateManyInputSchema,OtherItemsCreateManyInputSchema.array() ]),
  skipDuplicates: z.boolean().optional(),
}).strict()

export const OtherItemsDeleteArgsSchema: z.ZodType<Prisma.OtherItemsDeleteArgs> = z.object({
  select: OtherItemsSelectSchema.optional(),
  include: OtherItemsIncludeSchema.optional(),
  where: OtherItemsWhereUniqueInputSchema,
}).strict()

export const OtherItemsUpdateArgsSchema: z.ZodType<Prisma.OtherItemsUpdateArgs> = z.object({
  select: OtherItemsSelectSchema.optional(),
  include: OtherItemsIncludeSchema.optional(),
  data: z.union([ OtherItemsUpdateInputSchema,OtherItemsUncheckedUpdateInputSchema ]),
  where: OtherItemsWhereUniqueInputSchema,
}).strict()

export const OtherItemsUpdateManyArgsSchema: z.ZodType<Prisma.OtherItemsUpdateManyArgs> = z.object({
  data: z.union([ OtherItemsUpdateManyMutationInputSchema,OtherItemsUncheckedUpdateManyInputSchema ]),
  where: OtherItemsWhereInputSchema.optional(),
}).strict()

export const OtherItemsDeleteManyArgsSchema: z.ZodType<Prisma.OtherItemsDeleteManyArgs> = z.object({
  where: OtherItemsWhereInputSchema.optional(),
}).strict()

interface ItemsGetPayload extends HKT {
  readonly _A?: boolean | null | undefined | Prisma.ItemsArgs
  readonly type: Prisma.ItemsGetPayload<this['_A']>
}

interface OtherItemsGetPayload extends HKT {
  readonly _A?: boolean | null | undefined | Prisma.OtherItemsArgs
  readonly type: Prisma.OtherItemsGetPayload<this['_A']>
}

export const tableSchemas = {
  items: {
    fields: new Map([
      ["id", "TEXT"],
      ["content", "TEXT"],
      ["content_text_null", "TEXT"],
      ["content_text_null_default", "TEXT"],
      ["intvalue_null", "INT4"],
      ["intvalue_null_default", "INT4"],
    ]
    ),
    relations: [
      new Relation("other_items", "", "", "other_items", "ItemsToOtherItems", "many"),
    ],
    modelSchema: (ItemsCreateInputSchema as any)
      .partial()
      .or((ItemsUncheckedCreateInputSchema as any).partial()),
    createSchema: ItemsCreateArgsSchema,
    createManySchema: ItemsCreateManyArgsSchema,
    findUniqueSchema: ItemsFindUniqueArgsSchema,
    findSchema: ItemsFindFirstArgsSchema,
    updateSchema: ItemsUpdateArgsSchema,
    updateManySchema: ItemsUpdateManyArgsSchema,
    upsertSchema: ItemsUpsertArgsSchema,
    deleteSchema: ItemsDeleteArgsSchema,
    deleteManySchema: ItemsDeleteManyArgsSchema
  } as TableSchema<
    z.infer<typeof ItemsCreateInputSchema>,
    Prisma.ItemsCreateArgs['data'],
    Prisma.ItemsUpdateArgs['data'],
    Prisma.ItemsFindFirstArgs['select'],
    Prisma.ItemsFindFirstArgs['where'],
    Prisma.ItemsFindUniqueArgs['where'],
    Omit<Prisma.ItemsInclude, '_count'>,
    Prisma.ItemsFindFirstArgs['orderBy'],
    Prisma.ItemsScalarFieldEnum,
    ItemsGetPayload
  >,
  other_items: {
    fields: new Map([
      ["id", "TEXT"],
      ["content", "TEXT"],
      ["item_id", "TEXT"],
    ]),
    relations: [
      new Relation("items", "item_id", "id", "items", "ItemsToOtherItems", "one"),
    ],
    modelSchema: (OtherItemsCreateInputSchema as any)
      .partial()
      .or((OtherItemsUncheckedCreateInputSchema as any).partial()),
    createSchema: OtherItemsCreateArgsSchema,
    createManySchema: OtherItemsCreateManyArgsSchema,
    findUniqueSchema: OtherItemsFindUniqueArgsSchema,
    findSchema: OtherItemsFindFirstArgsSchema,
    updateSchema: OtherItemsUpdateArgsSchema,
    updateManySchema: OtherItemsUpdateManyArgsSchema,
    upsertSchema: OtherItemsUpsertArgsSchema,
    deleteSchema: OtherItemsDeleteArgsSchema,
    deleteManySchema: OtherItemsDeleteManyArgsSchema
  } as TableSchema<
    z.infer<typeof OtherItemsCreateInputSchema>,
    Prisma.OtherItemsCreateArgs['data'],
    Prisma.OtherItemsUpdateArgs['data'],
    Prisma.OtherItemsFindFirstArgs['select'],
    Prisma.OtherItemsFindFirstArgs['where'],
    Prisma.OtherItemsFindUniqueArgs['where'],
    Omit<Prisma.OtherItemsInclude, '_count'>,
    Prisma.OtherItemsFindFirstArgs['orderBy'],
    Prisma.OtherItemsScalarFieldEnum,
    OtherItemsGetPayload
  >,
}

export const schema = new DbSchema(tableSchemas, migrations)
export type Electric = ElectricClient<typeof schema>
