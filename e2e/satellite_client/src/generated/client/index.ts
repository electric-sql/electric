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

export const BoolsScalarFieldEnumSchema = z.enum(['id','b']);

export const DatetimesScalarFieldEnumSchema = z.enum(['id','d','t']);

export const ItemsScalarFieldEnumSchema = z.enum(['id','content','content_text_null','content_text_null_default','intvalue_null','intvalue_null_default']);

export const OtherItemsScalarFieldEnumSchema = z.enum(['id','content','item_id']);

export const QueryModeSchema = z.enum(['default','insensitive']);

export const SortOrderSchema = z.enum(['asc','desc']);

export const TimestampsScalarFieldEnumSchema = z.enum(['id','created_at','updated_at']);

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
  content_text_null: z.string().nullish(),
  content_text_null_default: z.string().nullish(),
  intvalue_null: z.number().int().nullish(),
  intvalue_null_default: z.number().int().nullish(),
})

export type Items = z.infer<typeof ItemsSchema>

/////////////////////////////////////////
// OTHER ITEMS SCHEMA
/////////////////////////////////////////

export const OtherItemsSchema = z.object({
  id: z.string(),
  content: z.string(),
  item_id: z.string().nullish(),
})

export type OtherItems = z.infer<typeof OtherItemsSchema>

/////////////////////////////////////////
// TIMESTAMPS SCHEMA
/////////////////////////////////////////

export const TimestampsSchema = z.object({
  id: z.string(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
})

export type Timestamps = z.infer<typeof TimestampsSchema>

/////////////////////////////////////////
// DATETIMES SCHEMA
/////////////////////////////////////////

export const DatetimesSchema = z.object({
  id: z.string(),
  d: z.coerce.date(),
  t: z.coerce.date(),
})

export type Datetimes = z.infer<typeof DatetimesSchema>

/////////////////////////////////////////
// BOOLS SCHEMA
/////////////////////////////////////////

export const BoolsSchema = z.object({
  id: z.string(),
  b: z.boolean().nullish(),
})

export type Bools = z.infer<typeof BoolsSchema>

/////////////////////////////////////////
// SELECT & INCLUDE
/////////////////////////////////////////

// ITEMS
//------------------------------------------------------

export const ItemsIncludeSchema: z.ZodType<Prisma.ItemsInclude> = z.object({
  other_items: z.union([z.boolean(),z.lazy(() => OtherItemsArgsSchema)]).optional(),
}).strict()

export const ItemsArgsSchema: z.ZodType<Prisma.ItemsArgs> = z.object({
  select: z.lazy(() => ItemsSelectSchema).optional(),
  include: z.lazy(() => ItemsIncludeSchema).optional(),
}).strict();

export const ItemsSelectSchema: z.ZodType<Prisma.ItemsSelect> = z.object({
  id: z.boolean().optional(),
  content: z.boolean().optional(),
  content_text_null: z.boolean().optional(),
  content_text_null_default: z.boolean().optional(),
  intvalue_null: z.boolean().optional(),
  intvalue_null_default: z.boolean().optional(),
  other_items: z.union([z.boolean(),z.lazy(() => OtherItemsArgsSchema)]).optional(),
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

// TIMESTAMPS
//------------------------------------------------------

export const TimestampsSelectSchema: z.ZodType<Prisma.TimestampsSelect> = z.object({
  id: z.boolean().optional(),
  created_at: z.boolean().optional(),
  updated_at: z.boolean().optional(),
}).strict()

// DATETIMES
//------------------------------------------------------

export const DatetimesSelectSchema: z.ZodType<Prisma.DatetimesSelect> = z.object({
  id: z.boolean().optional(),
  d: z.boolean().optional(),
  t: z.boolean().optional(),
}).strict()

// BOOLS
//------------------------------------------------------

export const BoolsSelectSchema: z.ZodType<Prisma.BoolsSelect> = z.object({
  id: z.boolean().optional(),
  b: z.boolean().optional(),
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
  other_items: z.union([ z.lazy(() => OtherItemsRelationFilterSchema),z.lazy(() => OtherItemsWhereInputSchema) ]).optional().nullable(),
}).strict();

export const ItemsOrderByWithRelationInputSchema: z.ZodType<Prisma.ItemsOrderByWithRelationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  content: z.lazy(() => SortOrderSchema).optional(),
  content_text_null: z.lazy(() => SortOrderSchema).optional(),
  content_text_null_default: z.lazy(() => SortOrderSchema).optional(),
  intvalue_null: z.lazy(() => SortOrderSchema).optional(),
  intvalue_null_default: z.lazy(() => SortOrderSchema).optional(),
  other_items: z.lazy(() => OtherItemsOrderByWithRelationInputSchema).optional()
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
  id: z.string().optional(),
  item_id: z.string().optional()
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

export const TimestampsWhereInputSchema: z.ZodType<Prisma.TimestampsWhereInput> = z.object({
  AND: z.union([ z.lazy(() => TimestampsWhereInputSchema),z.lazy(() => TimestampsWhereInputSchema).array() ]).optional(),
  OR: z.lazy(() => TimestampsWhereInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => TimestampsWhereInputSchema),z.lazy(() => TimestampsWhereInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  created_at: z.union([ z.lazy(() => DateTimeFilterSchema),z.coerce.date() ]).optional(),
  updated_at: z.union([ z.lazy(() => DateTimeFilterSchema),z.coerce.date() ]).optional(),
}).strict();

export const TimestampsOrderByWithRelationInputSchema: z.ZodType<Prisma.TimestampsOrderByWithRelationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  created_at: z.lazy(() => SortOrderSchema).optional(),
  updated_at: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const TimestampsWhereUniqueInputSchema: z.ZodType<Prisma.TimestampsWhereUniqueInput> = z.object({
  id: z.string().optional()
}).strict();

export const TimestampsOrderByWithAggregationInputSchema: z.ZodType<Prisma.TimestampsOrderByWithAggregationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  created_at: z.lazy(() => SortOrderSchema).optional(),
  updated_at: z.lazy(() => SortOrderSchema).optional(),
  _count: z.lazy(() => TimestampsCountOrderByAggregateInputSchema).optional(),
  _max: z.lazy(() => TimestampsMaxOrderByAggregateInputSchema).optional(),
  _min: z.lazy(() => TimestampsMinOrderByAggregateInputSchema).optional()
}).strict();

export const TimestampsScalarWhereWithAggregatesInputSchema: z.ZodType<Prisma.TimestampsScalarWhereWithAggregatesInput> = z.object({
  AND: z.union([ z.lazy(() => TimestampsScalarWhereWithAggregatesInputSchema),z.lazy(() => TimestampsScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  OR: z.lazy(() => TimestampsScalarWhereWithAggregatesInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => TimestampsScalarWhereWithAggregatesInputSchema),z.lazy(() => TimestampsScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  created_at: z.union([ z.lazy(() => DateTimeWithAggregatesFilterSchema),z.coerce.date() ]).optional(),
  updated_at: z.union([ z.lazy(() => DateTimeWithAggregatesFilterSchema),z.coerce.date() ]).optional(),
}).strict();

export const DatetimesWhereInputSchema: z.ZodType<Prisma.DatetimesWhereInput> = z.object({
  AND: z.union([ z.lazy(() => DatetimesWhereInputSchema),z.lazy(() => DatetimesWhereInputSchema).array() ]).optional(),
  OR: z.lazy(() => DatetimesWhereInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => DatetimesWhereInputSchema),z.lazy(() => DatetimesWhereInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  d: z.union([ z.lazy(() => DateTimeFilterSchema),z.coerce.date() ]).optional(),
  t: z.union([ z.lazy(() => DateTimeFilterSchema),z.coerce.date() ]).optional(),
}).strict();

export const DatetimesOrderByWithRelationInputSchema: z.ZodType<Prisma.DatetimesOrderByWithRelationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  d: z.lazy(() => SortOrderSchema).optional(),
  t: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const DatetimesWhereUniqueInputSchema: z.ZodType<Prisma.DatetimesWhereUniqueInput> = z.object({
  id: z.string().optional()
}).strict();

export const DatetimesOrderByWithAggregationInputSchema: z.ZodType<Prisma.DatetimesOrderByWithAggregationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  d: z.lazy(() => SortOrderSchema).optional(),
  t: z.lazy(() => SortOrderSchema).optional(),
  _count: z.lazy(() => DatetimesCountOrderByAggregateInputSchema).optional(),
  _max: z.lazy(() => DatetimesMaxOrderByAggregateInputSchema).optional(),
  _min: z.lazy(() => DatetimesMinOrderByAggregateInputSchema).optional()
}).strict();

export const DatetimesScalarWhereWithAggregatesInputSchema: z.ZodType<Prisma.DatetimesScalarWhereWithAggregatesInput> = z.object({
  AND: z.union([ z.lazy(() => DatetimesScalarWhereWithAggregatesInputSchema),z.lazy(() => DatetimesScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  OR: z.lazy(() => DatetimesScalarWhereWithAggregatesInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => DatetimesScalarWhereWithAggregatesInputSchema),z.lazy(() => DatetimesScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  d: z.union([ z.lazy(() => DateTimeWithAggregatesFilterSchema),z.coerce.date() ]).optional(),
  t: z.union([ z.lazy(() => DateTimeWithAggregatesFilterSchema),z.coerce.date() ]).optional(),
}).strict();

export const BoolsWhereInputSchema: z.ZodType<Prisma.BoolsWhereInput> = z.object({
  AND: z.union([ z.lazy(() => BoolsWhereInputSchema),z.lazy(() => BoolsWhereInputSchema).array() ]).optional(),
  OR: z.lazy(() => BoolsWhereInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => BoolsWhereInputSchema),z.lazy(() => BoolsWhereInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  b: z.union([ z.lazy(() => BoolNullableFilterSchema),z.boolean() ]).optional().nullable(),
}).strict();

export const BoolsOrderByWithRelationInputSchema: z.ZodType<Prisma.BoolsOrderByWithRelationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  b: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const BoolsWhereUniqueInputSchema: z.ZodType<Prisma.BoolsWhereUniqueInput> = z.object({
  id: z.string().optional()
}).strict();

export const BoolsOrderByWithAggregationInputSchema: z.ZodType<Prisma.BoolsOrderByWithAggregationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  b: z.lazy(() => SortOrderSchema).optional(),
  _count: z.lazy(() => BoolsCountOrderByAggregateInputSchema).optional(),
  _max: z.lazy(() => BoolsMaxOrderByAggregateInputSchema).optional(),
  _min: z.lazy(() => BoolsMinOrderByAggregateInputSchema).optional()
}).strict();

export const BoolsScalarWhereWithAggregatesInputSchema: z.ZodType<Prisma.BoolsScalarWhereWithAggregatesInput> = z.object({
  AND: z.union([ z.lazy(() => BoolsScalarWhereWithAggregatesInputSchema),z.lazy(() => BoolsScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  OR: z.lazy(() => BoolsScalarWhereWithAggregatesInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => BoolsScalarWhereWithAggregatesInputSchema),z.lazy(() => BoolsScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  b: z.union([ z.lazy(() => BoolNullableWithAggregatesFilterSchema),z.boolean() ]).optional().nullable(),
}).strict();

export const ItemsCreateInputSchema: z.ZodType<Prisma.ItemsCreateInput> = z.object({
  id: z.string(),
  content: z.string(),
  content_text_null: z.string().optional().nullable(),
  content_text_null_default: z.string().optional().nullable(),
  intvalue_null: z.number().int().optional().nullable(),
  intvalue_null_default: z.number().int().optional().nullable(),
  other_items: z.lazy(() => OtherItemsCreateNestedOneWithoutItemsInputSchema).optional()
}).strict();

export const ItemsUncheckedCreateInputSchema: z.ZodType<Prisma.ItemsUncheckedCreateInput> = z.object({
  id: z.string(),
  content: z.string(),
  content_text_null: z.string().optional().nullable(),
  content_text_null_default: z.string().optional().nullable(),
  intvalue_null: z.number().int().optional().nullable(),
  intvalue_null_default: z.number().int().optional().nullable(),
  other_items: z.lazy(() => OtherItemsUncheckedCreateNestedOneWithoutItemsInputSchema).optional()
}).strict();

export const ItemsUpdateInputSchema: z.ZodType<Prisma.ItemsUpdateInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  content: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  content_text_null: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  content_text_null_default: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  intvalue_null: z.union([ z.number().int(),z.lazy(() => NullableIntFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  intvalue_null_default: z.union([ z.number().int(),z.lazy(() => NullableIntFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  other_items: z.lazy(() => OtherItemsUpdateOneWithoutItemsNestedInputSchema).optional()
}).strict();

export const ItemsUncheckedUpdateInputSchema: z.ZodType<Prisma.ItemsUncheckedUpdateInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  content: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  content_text_null: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  content_text_null_default: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  intvalue_null: z.union([ z.number().int(),z.lazy(() => NullableIntFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  intvalue_null_default: z.union([ z.number().int(),z.lazy(() => NullableIntFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  other_items: z.lazy(() => OtherItemsUncheckedUpdateOneWithoutItemsNestedInputSchema).optional()
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

export const TimestampsCreateInputSchema: z.ZodType<Prisma.TimestampsCreateInput> = z.object({
  id: z.string(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date()
}).strict();

export const TimestampsUncheckedCreateInputSchema: z.ZodType<Prisma.TimestampsUncheckedCreateInput> = z.object({
  id: z.string(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date()
}).strict();

export const TimestampsUpdateInputSchema: z.ZodType<Prisma.TimestampsUpdateInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  created_at: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  updated_at: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const TimestampsUncheckedUpdateInputSchema: z.ZodType<Prisma.TimestampsUncheckedUpdateInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  created_at: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  updated_at: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const TimestampsCreateManyInputSchema: z.ZodType<Prisma.TimestampsCreateManyInput> = z.object({
  id: z.string(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date()
}).strict();

export const TimestampsUpdateManyMutationInputSchema: z.ZodType<Prisma.TimestampsUpdateManyMutationInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  created_at: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  updated_at: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const TimestampsUncheckedUpdateManyInputSchema: z.ZodType<Prisma.TimestampsUncheckedUpdateManyInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  created_at: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  updated_at: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const DatetimesCreateInputSchema: z.ZodType<Prisma.DatetimesCreateInput> = z.object({
  id: z.string(),
  d: z.coerce.date(),
  t: z.coerce.date()
}).strict();

export const DatetimesUncheckedCreateInputSchema: z.ZodType<Prisma.DatetimesUncheckedCreateInput> = z.object({
  id: z.string(),
  d: z.coerce.date(),
  t: z.coerce.date()
}).strict();

export const DatetimesUpdateInputSchema: z.ZodType<Prisma.DatetimesUpdateInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  d: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  t: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const DatetimesUncheckedUpdateInputSchema: z.ZodType<Prisma.DatetimesUncheckedUpdateInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  d: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  t: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const DatetimesCreateManyInputSchema: z.ZodType<Prisma.DatetimesCreateManyInput> = z.object({
  id: z.string(),
  d: z.coerce.date(),
  t: z.coerce.date()
}).strict();

export const DatetimesUpdateManyMutationInputSchema: z.ZodType<Prisma.DatetimesUpdateManyMutationInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  d: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  t: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const DatetimesUncheckedUpdateManyInputSchema: z.ZodType<Prisma.DatetimesUncheckedUpdateManyInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  d: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  t: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const BoolsCreateInputSchema: z.ZodType<Prisma.BoolsCreateInput> = z.object({
  id: z.string(),
  b: z.boolean().optional().nullable()
}).strict();

export const BoolsUncheckedCreateInputSchema: z.ZodType<Prisma.BoolsUncheckedCreateInput> = z.object({
  id: z.string(),
  b: z.boolean().optional().nullable()
}).strict();

export const BoolsUpdateInputSchema: z.ZodType<Prisma.BoolsUpdateInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  b: z.union([ z.boolean(),z.lazy(() => NullableBoolFieldUpdateOperationsInputSchema) ]).optional().nullable(),
}).strict();

export const BoolsUncheckedUpdateInputSchema: z.ZodType<Prisma.BoolsUncheckedUpdateInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  b: z.union([ z.boolean(),z.lazy(() => NullableBoolFieldUpdateOperationsInputSchema) ]).optional().nullable(),
}).strict();

export const BoolsCreateManyInputSchema: z.ZodType<Prisma.BoolsCreateManyInput> = z.object({
  id: z.string(),
  b: z.boolean().optional().nullable()
}).strict();

export const BoolsUpdateManyMutationInputSchema: z.ZodType<Prisma.BoolsUpdateManyMutationInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  b: z.union([ z.boolean(),z.lazy(() => NullableBoolFieldUpdateOperationsInputSchema) ]).optional().nullable(),
}).strict();

export const BoolsUncheckedUpdateManyInputSchema: z.ZodType<Prisma.BoolsUncheckedUpdateManyInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  b: z.union([ z.boolean(),z.lazy(() => NullableBoolFieldUpdateOperationsInputSchema) ]).optional().nullable(),
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

export const OtherItemsRelationFilterSchema: z.ZodType<Prisma.OtherItemsRelationFilter> = z.object({
  is: z.lazy(() => OtherItemsWhereInputSchema).optional().nullable(),
  isNot: z.lazy(() => OtherItemsWhereInputSchema).optional().nullable()
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

export const DateTimeFilterSchema: z.ZodType<Prisma.DateTimeFilter> = z.object({
  equals: z.coerce.date().optional(),
  in: z.union([ z.coerce.date().array(),z.coerce.date() ]).optional(),
  notIn: z.union([ z.coerce.date().array(),z.coerce.date() ]).optional(),
  lt: z.coerce.date().optional(),
  lte: z.coerce.date().optional(),
  gt: z.coerce.date().optional(),
  gte: z.coerce.date().optional(),
  not: z.union([ z.coerce.date(),z.lazy(() => NestedDateTimeFilterSchema) ]).optional(),
}).strict();

export const TimestampsCountOrderByAggregateInputSchema: z.ZodType<Prisma.TimestampsCountOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  created_at: z.lazy(() => SortOrderSchema).optional(),
  updated_at: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const TimestampsMaxOrderByAggregateInputSchema: z.ZodType<Prisma.TimestampsMaxOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  created_at: z.lazy(() => SortOrderSchema).optional(),
  updated_at: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const TimestampsMinOrderByAggregateInputSchema: z.ZodType<Prisma.TimestampsMinOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  created_at: z.lazy(() => SortOrderSchema).optional(),
  updated_at: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const DateTimeWithAggregatesFilterSchema: z.ZodType<Prisma.DateTimeWithAggregatesFilter> = z.object({
  equals: z.coerce.date().optional(),
  in: z.union([ z.coerce.date().array(),z.coerce.date() ]).optional(),
  notIn: z.union([ z.coerce.date().array(),z.coerce.date() ]).optional(),
  lt: z.coerce.date().optional(),
  lte: z.coerce.date().optional(),
  gt: z.coerce.date().optional(),
  gte: z.coerce.date().optional(),
  not: z.union([ z.coerce.date(),z.lazy(() => NestedDateTimeWithAggregatesFilterSchema) ]).optional(),
  _count: z.lazy(() => NestedIntFilterSchema).optional(),
  _min: z.lazy(() => NestedDateTimeFilterSchema).optional(),
  _max: z.lazy(() => NestedDateTimeFilterSchema).optional()
}).strict();

export const DatetimesCountOrderByAggregateInputSchema: z.ZodType<Prisma.DatetimesCountOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  d: z.lazy(() => SortOrderSchema).optional(),
  t: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const DatetimesMaxOrderByAggregateInputSchema: z.ZodType<Prisma.DatetimesMaxOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  d: z.lazy(() => SortOrderSchema).optional(),
  t: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const DatetimesMinOrderByAggregateInputSchema: z.ZodType<Prisma.DatetimesMinOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  d: z.lazy(() => SortOrderSchema).optional(),
  t: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const BoolNullableFilterSchema: z.ZodType<Prisma.BoolNullableFilter> = z.object({
  equals: z.boolean().optional().nullable(),
  not: z.union([ z.boolean(),z.lazy(() => NestedBoolNullableFilterSchema) ]).optional().nullable(),
}).strict();

export const BoolsCountOrderByAggregateInputSchema: z.ZodType<Prisma.BoolsCountOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  b: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const BoolsMaxOrderByAggregateInputSchema: z.ZodType<Prisma.BoolsMaxOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  b: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const BoolsMinOrderByAggregateInputSchema: z.ZodType<Prisma.BoolsMinOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  b: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const BoolNullableWithAggregatesFilterSchema: z.ZodType<Prisma.BoolNullableWithAggregatesFilter> = z.object({
  equals: z.boolean().optional().nullable(),
  not: z.union([ z.boolean(),z.lazy(() => NestedBoolNullableWithAggregatesFilterSchema) ]).optional().nullable(),
  _count: z.lazy(() => NestedIntNullableFilterSchema).optional(),
  _min: z.lazy(() => NestedBoolNullableFilterSchema).optional(),
  _max: z.lazy(() => NestedBoolNullableFilterSchema).optional()
}).strict();

export const OtherItemsCreateNestedOneWithoutItemsInputSchema: z.ZodType<Prisma.OtherItemsCreateNestedOneWithoutItemsInput> = z.object({
  create: z.union([ z.lazy(() => OtherItemsCreateWithoutItemsInputSchema),z.lazy(() => OtherItemsUncheckedCreateWithoutItemsInputSchema) ]).optional(),
  connectOrCreate: z.lazy(() => OtherItemsCreateOrConnectWithoutItemsInputSchema).optional(),
  connect: z.lazy(() => OtherItemsWhereUniqueInputSchema).optional()
}).strict();

export const OtherItemsUncheckedCreateNestedOneWithoutItemsInputSchema: z.ZodType<Prisma.OtherItemsUncheckedCreateNestedOneWithoutItemsInput> = z.object({
  create: z.union([ z.lazy(() => OtherItemsCreateWithoutItemsInputSchema),z.lazy(() => OtherItemsUncheckedCreateWithoutItemsInputSchema) ]).optional(),
  connectOrCreate: z.lazy(() => OtherItemsCreateOrConnectWithoutItemsInputSchema).optional(),
  connect: z.lazy(() => OtherItemsWhereUniqueInputSchema).optional()
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

export const OtherItemsUpdateOneWithoutItemsNestedInputSchema: z.ZodType<Prisma.OtherItemsUpdateOneWithoutItemsNestedInput> = z.object({
  create: z.union([ z.lazy(() => OtherItemsCreateWithoutItemsInputSchema),z.lazy(() => OtherItemsUncheckedCreateWithoutItemsInputSchema) ]).optional(),
  connectOrCreate: z.lazy(() => OtherItemsCreateOrConnectWithoutItemsInputSchema).optional(),
  upsert: z.lazy(() => OtherItemsUpsertWithoutItemsInputSchema).optional(),
  disconnect: z.boolean().optional(),
  delete: z.boolean().optional(),
  connect: z.lazy(() => OtherItemsWhereUniqueInputSchema).optional(),
  update: z.union([ z.lazy(() => OtherItemsUpdateWithoutItemsInputSchema),z.lazy(() => OtherItemsUncheckedUpdateWithoutItemsInputSchema) ]).optional(),
}).strict();

export const OtherItemsUncheckedUpdateOneWithoutItemsNestedInputSchema: z.ZodType<Prisma.OtherItemsUncheckedUpdateOneWithoutItemsNestedInput> = z.object({
  create: z.union([ z.lazy(() => OtherItemsCreateWithoutItemsInputSchema),z.lazy(() => OtherItemsUncheckedCreateWithoutItemsInputSchema) ]).optional(),
  connectOrCreate: z.lazy(() => OtherItemsCreateOrConnectWithoutItemsInputSchema).optional(),
  upsert: z.lazy(() => OtherItemsUpsertWithoutItemsInputSchema).optional(),
  disconnect: z.boolean().optional(),
  delete: z.boolean().optional(),
  connect: z.lazy(() => OtherItemsWhereUniqueInputSchema).optional(),
  update: z.union([ z.lazy(() => OtherItemsUpdateWithoutItemsInputSchema),z.lazy(() => OtherItemsUncheckedUpdateWithoutItemsInputSchema) ]).optional(),
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

export const DateTimeFieldUpdateOperationsInputSchema: z.ZodType<Prisma.DateTimeFieldUpdateOperationsInput> = z.object({
  set: z.coerce.date().optional()
}).strict();

export const NullableBoolFieldUpdateOperationsInputSchema: z.ZodType<Prisma.NullableBoolFieldUpdateOperationsInput> = z.object({
  set: z.boolean().optional().nullable()
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

export const NestedDateTimeFilterSchema: z.ZodType<Prisma.NestedDateTimeFilter> = z.object({
  equals: z.coerce.date().optional(),
  in: z.union([ z.coerce.date().array(),z.coerce.date() ]).optional(),
  notIn: z.union([ z.coerce.date().array(),z.coerce.date() ]).optional(),
  lt: z.coerce.date().optional(),
  lte: z.coerce.date().optional(),
  gt: z.coerce.date().optional(),
  gte: z.coerce.date().optional(),
  not: z.union([ z.coerce.date(),z.lazy(() => NestedDateTimeFilterSchema) ]).optional(),
}).strict();

export const NestedDateTimeWithAggregatesFilterSchema: z.ZodType<Prisma.NestedDateTimeWithAggregatesFilter> = z.object({
  equals: z.coerce.date().optional(),
  in: z.union([ z.coerce.date().array(),z.coerce.date() ]).optional(),
  notIn: z.union([ z.coerce.date().array(),z.coerce.date() ]).optional(),
  lt: z.coerce.date().optional(),
  lte: z.coerce.date().optional(),
  gt: z.coerce.date().optional(),
  gte: z.coerce.date().optional(),
  not: z.union([ z.coerce.date(),z.lazy(() => NestedDateTimeWithAggregatesFilterSchema) ]).optional(),
  _count: z.lazy(() => NestedIntFilterSchema).optional(),
  _min: z.lazy(() => NestedDateTimeFilterSchema).optional(),
  _max: z.lazy(() => NestedDateTimeFilterSchema).optional()
}).strict();

export const NestedBoolNullableFilterSchema: z.ZodType<Prisma.NestedBoolNullableFilter> = z.object({
  equals: z.boolean().optional().nullable(),
  not: z.union([ z.boolean(),z.lazy(() => NestedBoolNullableFilterSchema) ]).optional().nullable(),
}).strict();

export const NestedBoolNullableWithAggregatesFilterSchema: z.ZodType<Prisma.NestedBoolNullableWithAggregatesFilter> = z.object({
  equals: z.boolean().optional().nullable(),
  not: z.union([ z.boolean(),z.lazy(() => NestedBoolNullableWithAggregatesFilterSchema) ]).optional().nullable(),
  _count: z.lazy(() => NestedIntNullableFilterSchema).optional(),
  _min: z.lazy(() => NestedBoolNullableFilterSchema).optional(),
  _max: z.lazy(() => NestedBoolNullableFilterSchema).optional()
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

export const OtherItemsUpsertWithoutItemsInputSchema: z.ZodType<Prisma.OtherItemsUpsertWithoutItemsInput> = z.object({
  update: z.union([ z.lazy(() => OtherItemsUpdateWithoutItemsInputSchema),z.lazy(() => OtherItemsUncheckedUpdateWithoutItemsInputSchema) ]),
  create: z.union([ z.lazy(() => OtherItemsCreateWithoutItemsInputSchema),z.lazy(() => OtherItemsUncheckedCreateWithoutItemsInputSchema) ]),
}).strict();

export const OtherItemsUpdateWithoutItemsInputSchema: z.ZodType<Prisma.OtherItemsUpdateWithoutItemsInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  content: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const OtherItemsUncheckedUpdateWithoutItemsInputSchema: z.ZodType<Prisma.OtherItemsUncheckedUpdateWithoutItemsInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  content: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
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

export const TimestampsFindFirstArgsSchema: z.ZodType<Prisma.TimestampsFindFirstArgs> = z.object({
  select: TimestampsSelectSchema.optional(),
  where: TimestampsWhereInputSchema.optional(),
  orderBy: z.union([ TimestampsOrderByWithRelationInputSchema.array(),TimestampsOrderByWithRelationInputSchema ]).optional(),
  cursor: TimestampsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: TimestampsScalarFieldEnumSchema.array().optional(),
}).strict()

export const TimestampsFindFirstOrThrowArgsSchema: z.ZodType<Prisma.TimestampsFindFirstOrThrowArgs> = z.object({
  select: TimestampsSelectSchema.optional(),
  where: TimestampsWhereInputSchema.optional(),
  orderBy: z.union([ TimestampsOrderByWithRelationInputSchema.array(),TimestampsOrderByWithRelationInputSchema ]).optional(),
  cursor: TimestampsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: TimestampsScalarFieldEnumSchema.array().optional(),
}).strict()

export const TimestampsFindManyArgsSchema: z.ZodType<Prisma.TimestampsFindManyArgs> = z.object({
  select: TimestampsSelectSchema.optional(),
  where: TimestampsWhereInputSchema.optional(),
  orderBy: z.union([ TimestampsOrderByWithRelationInputSchema.array(),TimestampsOrderByWithRelationInputSchema ]).optional(),
  cursor: TimestampsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: TimestampsScalarFieldEnumSchema.array().optional(),
}).strict()

export const TimestampsAggregateArgsSchema: z.ZodType<Prisma.TimestampsAggregateArgs> = z.object({
  where: TimestampsWhereInputSchema.optional(),
  orderBy: z.union([ TimestampsOrderByWithRelationInputSchema.array(),TimestampsOrderByWithRelationInputSchema ]).optional(),
  cursor: TimestampsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict()

export const TimestampsGroupByArgsSchema: z.ZodType<Prisma.TimestampsGroupByArgs> = z.object({
  where: TimestampsWhereInputSchema.optional(),
  orderBy: z.union([ TimestampsOrderByWithAggregationInputSchema.array(),TimestampsOrderByWithAggregationInputSchema ]).optional(),
  by: TimestampsScalarFieldEnumSchema.array(),
  having: TimestampsScalarWhereWithAggregatesInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict()

export const TimestampsFindUniqueArgsSchema: z.ZodType<Prisma.TimestampsFindUniqueArgs> = z.object({
  select: TimestampsSelectSchema.optional(),
  where: TimestampsWhereUniqueInputSchema,
}).strict()

export const TimestampsFindUniqueOrThrowArgsSchema: z.ZodType<Prisma.TimestampsFindUniqueOrThrowArgs> = z.object({
  select: TimestampsSelectSchema.optional(),
  where: TimestampsWhereUniqueInputSchema,
}).strict()

export const DatetimesFindFirstArgsSchema: z.ZodType<Prisma.DatetimesFindFirstArgs> = z.object({
  select: DatetimesSelectSchema.optional(),
  where: DatetimesWhereInputSchema.optional(),
  orderBy: z.union([ DatetimesOrderByWithRelationInputSchema.array(),DatetimesOrderByWithRelationInputSchema ]).optional(),
  cursor: DatetimesWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: DatetimesScalarFieldEnumSchema.array().optional(),
}).strict()

export const DatetimesFindFirstOrThrowArgsSchema: z.ZodType<Prisma.DatetimesFindFirstOrThrowArgs> = z.object({
  select: DatetimesSelectSchema.optional(),
  where: DatetimesWhereInputSchema.optional(),
  orderBy: z.union([ DatetimesOrderByWithRelationInputSchema.array(),DatetimesOrderByWithRelationInputSchema ]).optional(),
  cursor: DatetimesWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: DatetimesScalarFieldEnumSchema.array().optional(),
}).strict()

export const DatetimesFindManyArgsSchema: z.ZodType<Prisma.DatetimesFindManyArgs> = z.object({
  select: DatetimesSelectSchema.optional(),
  where: DatetimesWhereInputSchema.optional(),
  orderBy: z.union([ DatetimesOrderByWithRelationInputSchema.array(),DatetimesOrderByWithRelationInputSchema ]).optional(),
  cursor: DatetimesWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: DatetimesScalarFieldEnumSchema.array().optional(),
}).strict()

export const DatetimesAggregateArgsSchema: z.ZodType<Prisma.DatetimesAggregateArgs> = z.object({
  where: DatetimesWhereInputSchema.optional(),
  orderBy: z.union([ DatetimesOrderByWithRelationInputSchema.array(),DatetimesOrderByWithRelationInputSchema ]).optional(),
  cursor: DatetimesWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict()

export const DatetimesGroupByArgsSchema: z.ZodType<Prisma.DatetimesGroupByArgs> = z.object({
  where: DatetimesWhereInputSchema.optional(),
  orderBy: z.union([ DatetimesOrderByWithAggregationInputSchema.array(),DatetimesOrderByWithAggregationInputSchema ]).optional(),
  by: DatetimesScalarFieldEnumSchema.array(),
  having: DatetimesScalarWhereWithAggregatesInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict()

export const DatetimesFindUniqueArgsSchema: z.ZodType<Prisma.DatetimesFindUniqueArgs> = z.object({
  select: DatetimesSelectSchema.optional(),
  where: DatetimesWhereUniqueInputSchema,
}).strict()

export const DatetimesFindUniqueOrThrowArgsSchema: z.ZodType<Prisma.DatetimesFindUniqueOrThrowArgs> = z.object({
  select: DatetimesSelectSchema.optional(),
  where: DatetimesWhereUniqueInputSchema,
}).strict()

export const BoolsFindFirstArgsSchema: z.ZodType<Prisma.BoolsFindFirstArgs> = z.object({
  select: BoolsSelectSchema.optional(),
  where: BoolsWhereInputSchema.optional(),
  orderBy: z.union([ BoolsOrderByWithRelationInputSchema.array(),BoolsOrderByWithRelationInputSchema ]).optional(),
  cursor: BoolsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: BoolsScalarFieldEnumSchema.array().optional(),
}).strict()

export const BoolsFindFirstOrThrowArgsSchema: z.ZodType<Prisma.BoolsFindFirstOrThrowArgs> = z.object({
  select: BoolsSelectSchema.optional(),
  where: BoolsWhereInputSchema.optional(),
  orderBy: z.union([ BoolsOrderByWithRelationInputSchema.array(),BoolsOrderByWithRelationInputSchema ]).optional(),
  cursor: BoolsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: BoolsScalarFieldEnumSchema.array().optional(),
}).strict()

export const BoolsFindManyArgsSchema: z.ZodType<Prisma.BoolsFindManyArgs> = z.object({
  select: BoolsSelectSchema.optional(),
  where: BoolsWhereInputSchema.optional(),
  orderBy: z.union([ BoolsOrderByWithRelationInputSchema.array(),BoolsOrderByWithRelationInputSchema ]).optional(),
  cursor: BoolsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: BoolsScalarFieldEnumSchema.array().optional(),
}).strict()

export const BoolsAggregateArgsSchema: z.ZodType<Prisma.BoolsAggregateArgs> = z.object({
  where: BoolsWhereInputSchema.optional(),
  orderBy: z.union([ BoolsOrderByWithRelationInputSchema.array(),BoolsOrderByWithRelationInputSchema ]).optional(),
  cursor: BoolsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict()

export const BoolsGroupByArgsSchema: z.ZodType<Prisma.BoolsGroupByArgs> = z.object({
  where: BoolsWhereInputSchema.optional(),
  orderBy: z.union([ BoolsOrderByWithAggregationInputSchema.array(),BoolsOrderByWithAggregationInputSchema ]).optional(),
  by: BoolsScalarFieldEnumSchema.array(),
  having: BoolsScalarWhereWithAggregatesInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict()

export const BoolsFindUniqueArgsSchema: z.ZodType<Prisma.BoolsFindUniqueArgs> = z.object({
  select: BoolsSelectSchema.optional(),
  where: BoolsWhereUniqueInputSchema,
}).strict()

export const BoolsFindUniqueOrThrowArgsSchema: z.ZodType<Prisma.BoolsFindUniqueOrThrowArgs> = z.object({
  select: BoolsSelectSchema.optional(),
  where: BoolsWhereUniqueInputSchema,
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

export const TimestampsCreateArgsSchema: z.ZodType<Prisma.TimestampsCreateArgs> = z.object({
  select: TimestampsSelectSchema.optional(),
  data: z.union([ TimestampsCreateInputSchema,TimestampsUncheckedCreateInputSchema ]),
}).strict()

export const TimestampsUpsertArgsSchema: z.ZodType<Prisma.TimestampsUpsertArgs> = z.object({
  select: TimestampsSelectSchema.optional(),
  where: TimestampsWhereUniqueInputSchema,
  create: z.union([ TimestampsCreateInputSchema,TimestampsUncheckedCreateInputSchema ]),
  update: z.union([ TimestampsUpdateInputSchema,TimestampsUncheckedUpdateInputSchema ]),
}).strict()

export const TimestampsCreateManyArgsSchema: z.ZodType<Prisma.TimestampsCreateManyArgs> = z.object({
  data: z.union([ TimestampsCreateManyInputSchema,TimestampsCreateManyInputSchema.array() ]),
  skipDuplicates: z.boolean().optional(),
}).strict()

export const TimestampsDeleteArgsSchema: z.ZodType<Prisma.TimestampsDeleteArgs> = z.object({
  select: TimestampsSelectSchema.optional(),
  where: TimestampsWhereUniqueInputSchema,
}).strict()

export const TimestampsUpdateArgsSchema: z.ZodType<Prisma.TimestampsUpdateArgs> = z.object({
  select: TimestampsSelectSchema.optional(),
  data: z.union([ TimestampsUpdateInputSchema,TimestampsUncheckedUpdateInputSchema ]),
  where: TimestampsWhereUniqueInputSchema,
}).strict()

export const TimestampsUpdateManyArgsSchema: z.ZodType<Prisma.TimestampsUpdateManyArgs> = z.object({
  data: z.union([ TimestampsUpdateManyMutationInputSchema,TimestampsUncheckedUpdateManyInputSchema ]),
  where: TimestampsWhereInputSchema.optional(),
}).strict()

export const TimestampsDeleteManyArgsSchema: z.ZodType<Prisma.TimestampsDeleteManyArgs> = z.object({
  where: TimestampsWhereInputSchema.optional(),
}).strict()

export const DatetimesCreateArgsSchema: z.ZodType<Prisma.DatetimesCreateArgs> = z.object({
  select: DatetimesSelectSchema.optional(),
  data: z.union([ DatetimesCreateInputSchema,DatetimesUncheckedCreateInputSchema ]),
}).strict()

export const DatetimesUpsertArgsSchema: z.ZodType<Prisma.DatetimesUpsertArgs> = z.object({
  select: DatetimesSelectSchema.optional(),
  where: DatetimesWhereUniqueInputSchema,
  create: z.union([ DatetimesCreateInputSchema,DatetimesUncheckedCreateInputSchema ]),
  update: z.union([ DatetimesUpdateInputSchema,DatetimesUncheckedUpdateInputSchema ]),
}).strict()

export const DatetimesCreateManyArgsSchema: z.ZodType<Prisma.DatetimesCreateManyArgs> = z.object({
  data: z.union([ DatetimesCreateManyInputSchema,DatetimesCreateManyInputSchema.array() ]),
  skipDuplicates: z.boolean().optional(),
}).strict()

export const DatetimesDeleteArgsSchema: z.ZodType<Prisma.DatetimesDeleteArgs> = z.object({
  select: DatetimesSelectSchema.optional(),
  where: DatetimesWhereUniqueInputSchema,
}).strict()

export const DatetimesUpdateArgsSchema: z.ZodType<Prisma.DatetimesUpdateArgs> = z.object({
  select: DatetimesSelectSchema.optional(),
  data: z.union([ DatetimesUpdateInputSchema,DatetimesUncheckedUpdateInputSchema ]),
  where: DatetimesWhereUniqueInputSchema,
}).strict()

export const DatetimesUpdateManyArgsSchema: z.ZodType<Prisma.DatetimesUpdateManyArgs> = z.object({
  data: z.union([ DatetimesUpdateManyMutationInputSchema,DatetimesUncheckedUpdateManyInputSchema ]),
  where: DatetimesWhereInputSchema.optional(),
}).strict()

export const DatetimesDeleteManyArgsSchema: z.ZodType<Prisma.DatetimesDeleteManyArgs> = z.object({
  where: DatetimesWhereInputSchema.optional(),
}).strict()

export const BoolsCreateArgsSchema: z.ZodType<Prisma.BoolsCreateArgs> = z.object({
  select: BoolsSelectSchema.optional(),
  data: z.union([ BoolsCreateInputSchema,BoolsUncheckedCreateInputSchema ]),
}).strict()

export const BoolsUpsertArgsSchema: z.ZodType<Prisma.BoolsUpsertArgs> = z.object({
  select: BoolsSelectSchema.optional(),
  where: BoolsWhereUniqueInputSchema,
  create: z.union([ BoolsCreateInputSchema,BoolsUncheckedCreateInputSchema ]),
  update: z.union([ BoolsUpdateInputSchema,BoolsUncheckedUpdateInputSchema ]),
}).strict()

export const BoolsCreateManyArgsSchema: z.ZodType<Prisma.BoolsCreateManyArgs> = z.object({
  data: z.union([ BoolsCreateManyInputSchema,BoolsCreateManyInputSchema.array() ]),
  skipDuplicates: z.boolean().optional(),
}).strict()

export const BoolsDeleteArgsSchema: z.ZodType<Prisma.BoolsDeleteArgs> = z.object({
  select: BoolsSelectSchema.optional(),
  where: BoolsWhereUniqueInputSchema,
}).strict()

export const BoolsUpdateArgsSchema: z.ZodType<Prisma.BoolsUpdateArgs> = z.object({
  select: BoolsSelectSchema.optional(),
  data: z.union([ BoolsUpdateInputSchema,BoolsUncheckedUpdateInputSchema ]),
  where: BoolsWhereUniqueInputSchema,
}).strict()

export const BoolsUpdateManyArgsSchema: z.ZodType<Prisma.BoolsUpdateManyArgs> = z.object({
  data: z.union([ BoolsUpdateManyMutationInputSchema,BoolsUncheckedUpdateManyInputSchema ]),
  where: BoolsWhereInputSchema.optional(),
}).strict()

export const BoolsDeleteManyArgsSchema: z.ZodType<Prisma.BoolsDeleteManyArgs> = z.object({
  where: BoolsWhereInputSchema.optional(),
}).strict()

interface ItemsGetPayload extends HKT {
  readonly _A?: boolean | null | undefined | Prisma.ItemsArgs
  readonly type: Prisma.ItemsGetPayload<this['_A']>
}

interface OtherItemsGetPayload extends HKT {
  readonly _A?: boolean | null | undefined | Prisma.OtherItemsArgs
  readonly type: Prisma.OtherItemsGetPayload<this['_A']>
}

interface TimestampsGetPayload extends HKT {
  readonly _A?: boolean | null | undefined | Prisma.TimestampsArgs
  readonly type: Prisma.TimestampsGetPayload<this['_A']>
}

interface DatetimesGetPayload extends HKT {
  readonly _A?: boolean | null | undefined | Prisma.DatetimesArgs
  readonly type: Prisma.DatetimesGetPayload<this['_A']>
}

interface BoolsGetPayload extends HKT {
  readonly _A?: boolean | null | undefined | Prisma.BoolsArgs
  readonly type: Prisma.BoolsGetPayload<this['_A']>
}

export const tableSchemas = {
  items: {
    fields: new Map([
      [
        "id",
        "TEXT"
      ],
      [
        "content",
        "TEXT"
      ],
      [
        "content_text_null",
        "TEXT"
      ],
      [
        "content_text_null_default",
        "TEXT"
      ],
      [
        "intvalue_null",
        "INT4"
      ],
      [
        "intvalue_null_default",
        "INT4"
      ]
    ]),
    relations: [
      new Relation("other_items", "", "", "other_items", "ItemsToOtherItems", "one"),
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
      [
        "id",
        "TEXT"
      ],
      [
        "content",
        "TEXT"
      ],
      [
        "item_id",
        "TEXT"
      ]
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
  timestamps: {
    fields: new Map([
      [
        "id",
        "TEXT"
      ],
      [
        "created_at",
        "TIMESTAMP"
      ],
      [
        "updated_at",
        "TIMESTAMPTZ"
      ]
    ]),
    relations: [
    ],
    modelSchema: (TimestampsCreateInputSchema as any)
      .partial()
      .or((TimestampsUncheckedCreateInputSchema as any).partial()),
    createSchema: TimestampsCreateArgsSchema,
    createManySchema: TimestampsCreateManyArgsSchema,
    findUniqueSchema: TimestampsFindUniqueArgsSchema,
    findSchema: TimestampsFindFirstArgsSchema,
    updateSchema: TimestampsUpdateArgsSchema,
    updateManySchema: TimestampsUpdateManyArgsSchema,
    upsertSchema: TimestampsUpsertArgsSchema,
    deleteSchema: TimestampsDeleteArgsSchema,
    deleteManySchema: TimestampsDeleteManyArgsSchema
  } as TableSchema<
    z.infer<typeof TimestampsCreateInputSchema>,
    Prisma.TimestampsCreateArgs['data'],
    Prisma.TimestampsUpdateArgs['data'],
    Prisma.TimestampsFindFirstArgs['select'],
    Prisma.TimestampsFindFirstArgs['where'],
    Prisma.TimestampsFindUniqueArgs['where'],
    never,
    Prisma.TimestampsFindFirstArgs['orderBy'],
    Prisma.TimestampsScalarFieldEnum,
    TimestampsGetPayload
  >,
  datetimes: {
    fields: new Map([
      [
        "id",
        "TEXT"
      ],
      [
        "d",
        "DATE"
      ],
      [
        "t",
        "TIME"
      ]
    ]),
    relations: [
    ],
    modelSchema: (DatetimesCreateInputSchema as any)
      .partial()
      .or((DatetimesUncheckedCreateInputSchema as any).partial()),
    createSchema: DatetimesCreateArgsSchema,
    createManySchema: DatetimesCreateManyArgsSchema,
    findUniqueSchema: DatetimesFindUniqueArgsSchema,
    findSchema: DatetimesFindFirstArgsSchema,
    updateSchema: DatetimesUpdateArgsSchema,
    updateManySchema: DatetimesUpdateManyArgsSchema,
    upsertSchema: DatetimesUpsertArgsSchema,
    deleteSchema: DatetimesDeleteArgsSchema,
    deleteManySchema: DatetimesDeleteManyArgsSchema
  } as TableSchema<
    z.infer<typeof DatetimesCreateInputSchema>,
    Prisma.DatetimesCreateArgs['data'],
    Prisma.DatetimesUpdateArgs['data'],
    Prisma.DatetimesFindFirstArgs['select'],
    Prisma.DatetimesFindFirstArgs['where'],
    Prisma.DatetimesFindUniqueArgs['where'],
    never,
    Prisma.DatetimesFindFirstArgs['orderBy'],
    Prisma.DatetimesScalarFieldEnum,
    DatetimesGetPayload
  >,
  bools: {
    fields: new Map([
      [
        "id",
        "TEXT"
      ],
      [
        "b",
        "BOOL"
      ]
    ]),
    relations: [
    ],
    modelSchema: (BoolsCreateInputSchema as any)
      .partial()
      .or((BoolsUncheckedCreateInputSchema as any).partial()),
    createSchema: BoolsCreateArgsSchema,
    createManySchema: BoolsCreateManyArgsSchema,
    findUniqueSchema: BoolsFindUniqueArgsSchema,
    findSchema: BoolsFindFirstArgsSchema,
    updateSchema: BoolsUpdateArgsSchema,
    updateManySchema: BoolsUpdateManyArgsSchema,
    upsertSchema: BoolsUpsertArgsSchema,
    deleteSchema: BoolsDeleteArgsSchema,
    deleteManySchema: BoolsDeleteManyArgsSchema
  } as TableSchema<
    z.infer<typeof BoolsCreateInputSchema>,
    Prisma.BoolsCreateArgs['data'],
    Prisma.BoolsUpdateArgs['data'],
    Prisma.BoolsFindFirstArgs['select'],
    Prisma.BoolsFindFirstArgs['where'],
    Prisma.BoolsFindUniqueArgs['where'],
    never,
    Prisma.BoolsFindFirstArgs['orderBy'],
    Prisma.BoolsScalarFieldEnum,
    BoolsGetPayload
  >,
}

export const schema = new DbSchema(tableSchemas, migrations)
export type Electric = ElectricClient<typeof schema>
