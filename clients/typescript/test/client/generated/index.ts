import { z } from 'zod'
import type { Prisma } from '../generated/client'
import {
  TableSchema,
  DbSchema,
  Relation,
  ElectricClient,
  HKT,
} from '../../../src/client/model'

/////////////////////////////////////////
// HELPER FUNCTIONS
/////////////////////////////////////////


/////////////////////////////////////////
// ENUMS
/////////////////////////////////////////

export const DataTypesScalarFieldEnumSchema = z.enum(['id','date','time','timetz','timestamp','timestamptz','relatedId']);

export const DummyScalarFieldEnumSchema = z.enum(['id','timestamp']);

export const ItemsScalarFieldEnumSchema = z.enum(['value','nbr']);

export const PostScalarFieldEnumSchema = z.enum(['id','title','contents','nbr','authorId']);

export const ProfileScalarFieldEnumSchema = z.enum(['id','bio','userId']);

export const QueryModeSchema = z.enum(['default','insensitive']);

export const SortOrderSchema = z.enum(['asc','desc']);

export const TransactionIsolationLevelSchema = z.enum(['ReadUncommitted','ReadCommitted','RepeatableRead','Serializable']);

export const UserScalarFieldEnumSchema = z.enum(['id','name']);
/////////////////////////////////////////
// MODELS
/////////////////////////////////////////

/////////////////////////////////////////
// ITEMS SCHEMA
/////////////////////////////////////////

export const ItemsSchema = z.object({
  value: z.string(),
  nbr: z.number().int().nullish(),
})

export type Items = z.infer<typeof ItemsSchema>

/////////////////////////////////////////
// USER SCHEMA
/////////////////////////////////////////

export const UserSchema = z.object({
  id: z.number().int(),
  name: z.string().nullish(),
})

export type User = z.infer<typeof UserSchema>

/////////////////////////////////////////
// POST SCHEMA
/////////////////////////////////////////

export const PostSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  contents: z.string(),
  nbr: z.number().int().nullish(),
  authorId: z.number().int(),
})

export type Post = z.infer<typeof PostSchema>

/////////////////////////////////////////
// PROFILE SCHEMA
/////////////////////////////////////////

export const ProfileSchema = z.object({
  id: z.number().int(),
  bio: z.string(),
  userId: z.number().int(),
})

export type Profile = z.infer<typeof ProfileSchema>

/////////////////////////////////////////
// DATA TYPES SCHEMA
/////////////////////////////////////////

export const DataTypesSchema = z.object({
  id: z.number().int(),
  date: z.coerce.date().nullish(),
  time: z.coerce.date().nullish(),
  timetz: z.coerce.date().nullish(),
  timestamp: z.coerce.date().nullish(),
  timestamptz: z.coerce.date().nullish(),
  relatedId: z.number().int().nullish(),
})

export type DataTypes = z.infer<typeof DataTypesSchema>

/////////////////////////////////////////
// DUMMY SCHEMA
/////////////////////////////////////////

export const DummySchema = z.object({
  id: z.number().int(),
  timestamp: z.coerce.date().nullish(),
})

export type Dummy = z.infer<typeof DummySchema>

/////////////////////////////////////////
// SELECT & INCLUDE
/////////////////////////////////////////

// ITEMS
//------------------------------------------------------

export const ItemsSelectSchema: z.ZodType<Prisma.ItemsSelect> = z.object({
  value: z.boolean().optional(),
  nbr: z.boolean().optional(),
}).strict()

// USER
//------------------------------------------------------

export const UserIncludeSchema: z.ZodType<Prisma.UserInclude> = z.object({
  posts: z.union([z.boolean(),z.lazy(() => PostFindManyArgsSchema)]).optional(),
  profile: z.union([z.boolean(),z.lazy(() => ProfileArgsSchema)]).optional(),
  _count: z.union([z.boolean(),z.lazy(() => UserCountOutputTypeArgsSchema)]).optional(),
}).strict()

export const UserArgsSchema: z.ZodType<Prisma.UserArgs> = z.object({
  select: z.lazy(() => UserSelectSchema).optional(),
  include: z.lazy(() => UserIncludeSchema).optional(),
}).strict();

export const UserCountOutputTypeArgsSchema: z.ZodType<Prisma.UserCountOutputTypeArgs> = z.object({
  select: z.lazy(() => UserCountOutputTypeSelectSchema).nullish(),
}).strict();

export const UserCountOutputTypeSelectSchema: z.ZodType<Prisma.UserCountOutputTypeSelect> = z.object({
  posts: z.boolean().optional(),
}).strict();

export const UserSelectSchema: z.ZodType<Prisma.UserSelect> = z.object({
  id: z.boolean().optional(),
  name: z.boolean().optional(),
  posts: z.union([z.boolean(),z.lazy(() => PostFindManyArgsSchema)]).optional(),
  profile: z.union([z.boolean(),z.lazy(() => ProfileArgsSchema)]).optional(),
  _count: z.union([z.boolean(),z.lazy(() => UserCountOutputTypeArgsSchema)]).optional(),
}).strict()

// POST
//------------------------------------------------------

export const PostIncludeSchema: z.ZodType<Prisma.PostInclude> = z.object({
  author: z.union([z.boolean(),z.lazy(() => UserArgsSchema)]).optional(),
}).strict()

export const PostArgsSchema: z.ZodType<Prisma.PostArgs> = z.object({
  select: z.lazy(() => PostSelectSchema).optional(),
  include: z.lazy(() => PostIncludeSchema).optional(),
}).strict();

export const PostSelectSchema: z.ZodType<Prisma.PostSelect> = z.object({
  id: z.boolean().optional(),
  title: z.boolean().optional(),
  contents: z.boolean().optional(),
  nbr: z.boolean().optional(),
  authorId: z.boolean().optional(),
  author: z.union([z.boolean(),z.lazy(() => UserArgsSchema)]).optional(),
}).strict()

// PROFILE
//------------------------------------------------------

export const ProfileIncludeSchema: z.ZodType<Prisma.ProfileInclude> = z.object({
  user: z.union([z.boolean(),z.lazy(() => UserArgsSchema)]).optional(),
}).strict()

export const ProfileArgsSchema: z.ZodType<Prisma.ProfileArgs> = z.object({
  select: z.lazy(() => ProfileSelectSchema).optional(),
  include: z.lazy(() => ProfileIncludeSchema).optional(),
}).strict();

export const ProfileSelectSchema: z.ZodType<Prisma.ProfileSelect> = z.object({
  id: z.boolean().optional(),
  bio: z.boolean().optional(),
  userId: z.boolean().optional(),
  user: z.union([z.boolean(),z.lazy(() => UserArgsSchema)]).optional(),
}).strict()

// DATA TYPES
//------------------------------------------------------

export const DataTypesIncludeSchema: z.ZodType<Prisma.DataTypesInclude> = z.object({
  related: z.union([z.boolean(),z.lazy(() => DummyArgsSchema)]).optional(),
}).strict()

export const DataTypesArgsSchema: z.ZodType<Prisma.DataTypesArgs> = z.object({
  select: z.lazy(() => DataTypesSelectSchema).optional(),
  include: z.lazy(() => DataTypesIncludeSchema).optional(),
}).strict();

export const DataTypesSelectSchema: z.ZodType<Prisma.DataTypesSelect> = z.object({
  id: z.boolean().optional(),
  date: z.boolean().optional(),
  time: z.boolean().optional(),
  timetz: z.boolean().optional(),
  timestamp: z.boolean().optional(),
  timestamptz: z.boolean().optional(),
  relatedId: z.boolean().optional(),
  related: z.union([z.boolean(),z.lazy(() => DummyArgsSchema)]).optional(),
}).strict()

// DUMMY
//------------------------------------------------------

export const DummyIncludeSchema: z.ZodType<Prisma.DummyInclude> = z.object({
  datatype: z.union([z.boolean(),z.lazy(() => DataTypesFindManyArgsSchema)]).optional(),
  _count: z.union([z.boolean(),z.lazy(() => DummyCountOutputTypeArgsSchema)]).optional(),
}).strict()

export const DummyArgsSchema: z.ZodType<Prisma.DummyArgs> = z.object({
  select: z.lazy(() => DummySelectSchema).optional(),
  include: z.lazy(() => DummyIncludeSchema).optional(),
}).strict();

export const DummyCountOutputTypeArgsSchema: z.ZodType<Prisma.DummyCountOutputTypeArgs> = z.object({
  select: z.lazy(() => DummyCountOutputTypeSelectSchema).nullish(),
}).strict();

export const DummyCountOutputTypeSelectSchema: z.ZodType<Prisma.DummyCountOutputTypeSelect> = z.object({
  datatype: z.boolean().optional(),
}).strict();

export const DummySelectSchema: z.ZodType<Prisma.DummySelect> = z.object({
  id: z.boolean().optional(),
  timestamp: z.boolean().optional(),
  datatype: z.union([z.boolean(),z.lazy(() => DataTypesFindManyArgsSchema)]).optional(),
  _count: z.union([z.boolean(),z.lazy(() => DummyCountOutputTypeArgsSchema)]).optional(),
}).strict()


/////////////////////////////////////////
// INPUT TYPES
/////////////////////////////////////////

export const ItemsWhereInputSchema: z.ZodType<Prisma.ItemsWhereInput> = z.object({
  AND: z.union([ z.lazy(() => ItemsWhereInputSchema),z.lazy(() => ItemsWhereInputSchema).array() ]).optional(),
  OR: z.lazy(() => ItemsWhereInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => ItemsWhereInputSchema),z.lazy(() => ItemsWhereInputSchema).array() ]).optional(),
  value: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  nbr: z.union([ z.lazy(() => IntNullableFilterSchema),z.number() ]).optional().nullable(),
}).strict();

export const ItemsOrderByWithRelationInputSchema: z.ZodType<Prisma.ItemsOrderByWithRelationInput> = z.object({
  value: z.lazy(() => SortOrderSchema).optional(),
  nbr: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const ItemsWhereUniqueInputSchema: z.ZodType<Prisma.ItemsWhereUniqueInput> = z.object({
  value: z.string().optional()
}).strict();

export const ItemsOrderByWithAggregationInputSchema: z.ZodType<Prisma.ItemsOrderByWithAggregationInput> = z.object({
  value: z.lazy(() => SortOrderSchema).optional(),
  nbr: z.lazy(() => SortOrderSchema).optional(),
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
  value: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  nbr: z.union([ z.lazy(() => IntNullableWithAggregatesFilterSchema),z.number() ]).optional().nullable(),
}).strict();

export const UserWhereInputSchema: z.ZodType<Prisma.UserWhereInput> = z.object({
  AND: z.union([ z.lazy(() => UserWhereInputSchema),z.lazy(() => UserWhereInputSchema).array() ]).optional(),
  OR: z.lazy(() => UserWhereInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => UserWhereInputSchema),z.lazy(() => UserWhereInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => IntFilterSchema),z.number() ]).optional(),
  name: z.union([ z.lazy(() => StringNullableFilterSchema),z.string() ]).optional().nullable(),
  posts: z.lazy(() => PostListRelationFilterSchema).optional(),
  profile: z.union([ z.lazy(() => ProfileRelationFilterSchema),z.lazy(() => ProfileWhereInputSchema) ]).optional().nullable(),
}).strict();

export const UserOrderByWithRelationInputSchema: z.ZodType<Prisma.UserOrderByWithRelationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  name: z.lazy(() => SortOrderSchema).optional(),
  posts: z.lazy(() => PostOrderByRelationAggregateInputSchema).optional(),
  profile: z.lazy(() => ProfileOrderByWithRelationInputSchema).optional()
}).strict();

export const UserWhereUniqueInputSchema: z.ZodType<Prisma.UserWhereUniqueInput> = z.object({
  id: z.number().int().optional()
}).strict();

export const UserOrderByWithAggregationInputSchema: z.ZodType<Prisma.UserOrderByWithAggregationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  name: z.lazy(() => SortOrderSchema).optional(),
  _count: z.lazy(() => UserCountOrderByAggregateInputSchema).optional(),
  _avg: z.lazy(() => UserAvgOrderByAggregateInputSchema).optional(),
  _max: z.lazy(() => UserMaxOrderByAggregateInputSchema).optional(),
  _min: z.lazy(() => UserMinOrderByAggregateInputSchema).optional(),
  _sum: z.lazy(() => UserSumOrderByAggregateInputSchema).optional()
}).strict();

export const UserScalarWhereWithAggregatesInputSchema: z.ZodType<Prisma.UserScalarWhereWithAggregatesInput> = z.object({
  AND: z.union([ z.lazy(() => UserScalarWhereWithAggregatesInputSchema),z.lazy(() => UserScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  OR: z.lazy(() => UserScalarWhereWithAggregatesInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => UserScalarWhereWithAggregatesInputSchema),z.lazy(() => UserScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => IntWithAggregatesFilterSchema),z.number() ]).optional(),
  name: z.union([ z.lazy(() => StringNullableWithAggregatesFilterSchema),z.string() ]).optional().nullable(),
}).strict();

export const PostWhereInputSchema: z.ZodType<Prisma.PostWhereInput> = z.object({
  AND: z.union([ z.lazy(() => PostWhereInputSchema),z.lazy(() => PostWhereInputSchema).array() ]).optional(),
  OR: z.lazy(() => PostWhereInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => PostWhereInputSchema),z.lazy(() => PostWhereInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => IntFilterSchema),z.number() ]).optional(),
  title: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  contents: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  nbr: z.union([ z.lazy(() => IntNullableFilterSchema),z.number() ]).optional().nullable(),
  authorId: z.union([ z.lazy(() => IntFilterSchema),z.number() ]).optional(),
  author: z.union([ z.lazy(() => UserRelationFilterSchema),z.lazy(() => UserWhereInputSchema) ]).optional().nullable(),
}).strict();

export const PostOrderByWithRelationInputSchema: z.ZodType<Prisma.PostOrderByWithRelationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  title: z.lazy(() => SortOrderSchema).optional(),
  contents: z.lazy(() => SortOrderSchema).optional(),
  nbr: z.lazy(() => SortOrderSchema).optional(),
  authorId: z.lazy(() => SortOrderSchema).optional(),
  author: z.lazy(() => UserOrderByWithRelationInputSchema).optional()
}).strict();

export const PostWhereUniqueInputSchema: z.ZodType<Prisma.PostWhereUniqueInput> = z.object({
  id: z.number().int().optional(),
  title: z.string().optional()
}).strict();

export const PostOrderByWithAggregationInputSchema: z.ZodType<Prisma.PostOrderByWithAggregationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  title: z.lazy(() => SortOrderSchema).optional(),
  contents: z.lazy(() => SortOrderSchema).optional(),
  nbr: z.lazy(() => SortOrderSchema).optional(),
  authorId: z.lazy(() => SortOrderSchema).optional(),
  _count: z.lazy(() => PostCountOrderByAggregateInputSchema).optional(),
  _avg: z.lazy(() => PostAvgOrderByAggregateInputSchema).optional(),
  _max: z.lazy(() => PostMaxOrderByAggregateInputSchema).optional(),
  _min: z.lazy(() => PostMinOrderByAggregateInputSchema).optional(),
  _sum: z.lazy(() => PostSumOrderByAggregateInputSchema).optional()
}).strict();

export const PostScalarWhereWithAggregatesInputSchema: z.ZodType<Prisma.PostScalarWhereWithAggregatesInput> = z.object({
  AND: z.union([ z.lazy(() => PostScalarWhereWithAggregatesInputSchema),z.lazy(() => PostScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  OR: z.lazy(() => PostScalarWhereWithAggregatesInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => PostScalarWhereWithAggregatesInputSchema),z.lazy(() => PostScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => IntWithAggregatesFilterSchema),z.number() ]).optional(),
  title: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  contents: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  nbr: z.union([ z.lazy(() => IntNullableWithAggregatesFilterSchema),z.number() ]).optional().nullable(),
  authorId: z.union([ z.lazy(() => IntWithAggregatesFilterSchema),z.number() ]).optional(),
}).strict();

export const ProfileWhereInputSchema: z.ZodType<Prisma.ProfileWhereInput> = z.object({
  AND: z.union([ z.lazy(() => ProfileWhereInputSchema),z.lazy(() => ProfileWhereInputSchema).array() ]).optional(),
  OR: z.lazy(() => ProfileWhereInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => ProfileWhereInputSchema),z.lazy(() => ProfileWhereInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => IntFilterSchema),z.number() ]).optional(),
  bio: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  userId: z.union([ z.lazy(() => IntFilterSchema),z.number() ]).optional(),
  user: z.union([ z.lazy(() => UserRelationFilterSchema),z.lazy(() => UserWhereInputSchema) ]).optional().nullable(),
}).strict();

export const ProfileOrderByWithRelationInputSchema: z.ZodType<Prisma.ProfileOrderByWithRelationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  bio: z.lazy(() => SortOrderSchema).optional(),
  userId: z.lazy(() => SortOrderSchema).optional(),
  user: z.lazy(() => UserOrderByWithRelationInputSchema).optional()
}).strict();

export const ProfileWhereUniqueInputSchema: z.ZodType<Prisma.ProfileWhereUniqueInput> = z.object({
  id: z.number().int().optional(),
  userId: z.number().int().optional()
}).strict();

export const ProfileOrderByWithAggregationInputSchema: z.ZodType<Prisma.ProfileOrderByWithAggregationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  bio: z.lazy(() => SortOrderSchema).optional(),
  userId: z.lazy(() => SortOrderSchema).optional(),
  _count: z.lazy(() => ProfileCountOrderByAggregateInputSchema).optional(),
  _avg: z.lazy(() => ProfileAvgOrderByAggregateInputSchema).optional(),
  _max: z.lazy(() => ProfileMaxOrderByAggregateInputSchema).optional(),
  _min: z.lazy(() => ProfileMinOrderByAggregateInputSchema).optional(),
  _sum: z.lazy(() => ProfileSumOrderByAggregateInputSchema).optional()
}).strict();

export const ProfileScalarWhereWithAggregatesInputSchema: z.ZodType<Prisma.ProfileScalarWhereWithAggregatesInput> = z.object({
  AND: z.union([ z.lazy(() => ProfileScalarWhereWithAggregatesInputSchema),z.lazy(() => ProfileScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  OR: z.lazy(() => ProfileScalarWhereWithAggregatesInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => ProfileScalarWhereWithAggregatesInputSchema),z.lazy(() => ProfileScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => IntWithAggregatesFilterSchema),z.number() ]).optional(),
  bio: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  userId: z.union([ z.lazy(() => IntWithAggregatesFilterSchema),z.number() ]).optional(),
}).strict();

export const DataTypesWhereInputSchema: z.ZodType<Prisma.DataTypesWhereInput> = z.object({
  AND: z.union([ z.lazy(() => DataTypesWhereInputSchema),z.lazy(() => DataTypesWhereInputSchema).array() ]).optional(),
  OR: z.lazy(() => DataTypesWhereInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => DataTypesWhereInputSchema),z.lazy(() => DataTypesWhereInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => IntFilterSchema),z.number() ]).optional(),
  date: z.union([ z.lazy(() => DateTimeNullableFilterSchema),z.coerce.date() ]).optional().nullable(),
  time: z.union([ z.lazy(() => DateTimeNullableFilterSchema),z.coerce.date() ]).optional().nullable(),
  timetz: z.union([ z.lazy(() => DateTimeNullableFilterSchema),z.coerce.date() ]).optional().nullable(),
  timestamp: z.union([ z.lazy(() => DateTimeNullableFilterSchema),z.coerce.date() ]).optional().nullable(),
  timestamptz: z.union([ z.lazy(() => DateTimeNullableFilterSchema),z.coerce.date() ]).optional().nullable(),
  relatedId: z.union([ z.lazy(() => IntNullableFilterSchema),z.number() ]).optional().nullable(),
  related: z.union([ z.lazy(() => DummyRelationFilterSchema),z.lazy(() => DummyWhereInputSchema) ]).optional().nullable(),
}).strict();

export const DataTypesOrderByWithRelationInputSchema: z.ZodType<Prisma.DataTypesOrderByWithRelationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  date: z.lazy(() => SortOrderSchema).optional(),
  time: z.lazy(() => SortOrderSchema).optional(),
  timetz: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  timestamptz: z.lazy(() => SortOrderSchema).optional(),
  relatedId: z.lazy(() => SortOrderSchema).optional(),
  related: z.lazy(() => DummyOrderByWithRelationInputSchema).optional()
}).strict();

export const DataTypesWhereUniqueInputSchema: z.ZodType<Prisma.DataTypesWhereUniqueInput> = z.object({
  id: z.number().int().optional()
}).strict();

export const DataTypesOrderByWithAggregationInputSchema: z.ZodType<Prisma.DataTypesOrderByWithAggregationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  date: z.lazy(() => SortOrderSchema).optional(),
  time: z.lazy(() => SortOrderSchema).optional(),
  timetz: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  timestamptz: z.lazy(() => SortOrderSchema).optional(),
  relatedId: z.lazy(() => SortOrderSchema).optional(),
  _count: z.lazy(() => DataTypesCountOrderByAggregateInputSchema).optional(),
  _avg: z.lazy(() => DataTypesAvgOrderByAggregateInputSchema).optional(),
  _max: z.lazy(() => DataTypesMaxOrderByAggregateInputSchema).optional(),
  _min: z.lazy(() => DataTypesMinOrderByAggregateInputSchema).optional(),
  _sum: z.lazy(() => DataTypesSumOrderByAggregateInputSchema).optional()
}).strict();

export const DataTypesScalarWhereWithAggregatesInputSchema: z.ZodType<Prisma.DataTypesScalarWhereWithAggregatesInput> = z.object({
  AND: z.union([ z.lazy(() => DataTypesScalarWhereWithAggregatesInputSchema),z.lazy(() => DataTypesScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  OR: z.lazy(() => DataTypesScalarWhereWithAggregatesInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => DataTypesScalarWhereWithAggregatesInputSchema),z.lazy(() => DataTypesScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => IntWithAggregatesFilterSchema),z.number() ]).optional(),
  date: z.union([ z.lazy(() => DateTimeNullableWithAggregatesFilterSchema),z.coerce.date() ]).optional().nullable(),
  time: z.union([ z.lazy(() => DateTimeNullableWithAggregatesFilterSchema),z.coerce.date() ]).optional().nullable(),
  timetz: z.union([ z.lazy(() => DateTimeNullableWithAggregatesFilterSchema),z.coerce.date() ]).optional().nullable(),
  timestamp: z.union([ z.lazy(() => DateTimeNullableWithAggregatesFilterSchema),z.coerce.date() ]).optional().nullable(),
  timestamptz: z.union([ z.lazy(() => DateTimeNullableWithAggregatesFilterSchema),z.coerce.date() ]).optional().nullable(),
  relatedId: z.union([ z.lazy(() => IntNullableWithAggregatesFilterSchema),z.number() ]).optional().nullable(),
}).strict();

export const DummyWhereInputSchema: z.ZodType<Prisma.DummyWhereInput> = z.object({
  AND: z.union([ z.lazy(() => DummyWhereInputSchema),z.lazy(() => DummyWhereInputSchema).array() ]).optional(),
  OR: z.lazy(() => DummyWhereInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => DummyWhereInputSchema),z.lazy(() => DummyWhereInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => IntFilterSchema),z.number() ]).optional(),
  timestamp: z.union([ z.lazy(() => DateTimeNullableFilterSchema),z.coerce.date() ]).optional().nullable(),
  datatype: z.lazy(() => DataTypesListRelationFilterSchema).optional()
}).strict();

export const DummyOrderByWithRelationInputSchema: z.ZodType<Prisma.DummyOrderByWithRelationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  datatype: z.lazy(() => DataTypesOrderByRelationAggregateInputSchema).optional()
}).strict();

export const DummyWhereUniqueInputSchema: z.ZodType<Prisma.DummyWhereUniqueInput> = z.object({
  id: z.number().int().optional()
}).strict();

export const DummyOrderByWithAggregationInputSchema: z.ZodType<Prisma.DummyOrderByWithAggregationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  _count: z.lazy(() => DummyCountOrderByAggregateInputSchema).optional(),
  _avg: z.lazy(() => DummyAvgOrderByAggregateInputSchema).optional(),
  _max: z.lazy(() => DummyMaxOrderByAggregateInputSchema).optional(),
  _min: z.lazy(() => DummyMinOrderByAggregateInputSchema).optional(),
  _sum: z.lazy(() => DummySumOrderByAggregateInputSchema).optional()
}).strict();

export const DummyScalarWhereWithAggregatesInputSchema: z.ZodType<Prisma.DummyScalarWhereWithAggregatesInput> = z.object({
  AND: z.union([ z.lazy(() => DummyScalarWhereWithAggregatesInputSchema),z.lazy(() => DummyScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  OR: z.lazy(() => DummyScalarWhereWithAggregatesInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => DummyScalarWhereWithAggregatesInputSchema),z.lazy(() => DummyScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => IntWithAggregatesFilterSchema),z.number() ]).optional(),
  timestamp: z.union([ z.lazy(() => DateTimeNullableWithAggregatesFilterSchema),z.coerce.date() ]).optional().nullable(),
}).strict();

export const ItemsCreateInputSchema: z.ZodType<Prisma.ItemsCreateInput> = z.object({
  value: z.string(),
  nbr: z.number().int().optional().nullable()
}).strict();

export const ItemsUncheckedCreateInputSchema: z.ZodType<Prisma.ItemsUncheckedCreateInput> = z.object({
  value: z.string(),
  nbr: z.number().int().optional().nullable()
}).strict();

export const ItemsUpdateInputSchema: z.ZodType<Prisma.ItemsUpdateInput> = z.object({
  value: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  nbr: z.union([ z.number().int(),z.lazy(() => NullableIntFieldUpdateOperationsInputSchema) ]).optional().nullable(),
}).strict();

export const ItemsUncheckedUpdateInputSchema: z.ZodType<Prisma.ItemsUncheckedUpdateInput> = z.object({
  value: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  nbr: z.union([ z.number().int(),z.lazy(() => NullableIntFieldUpdateOperationsInputSchema) ]).optional().nullable(),
}).strict();

export const ItemsCreateManyInputSchema: z.ZodType<Prisma.ItemsCreateManyInput> = z.object({
  value: z.string(),
  nbr: z.number().int().optional().nullable()
}).strict();

export const ItemsUpdateManyMutationInputSchema: z.ZodType<Prisma.ItemsUpdateManyMutationInput> = z.object({
  value: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  nbr: z.union([ z.number().int(),z.lazy(() => NullableIntFieldUpdateOperationsInputSchema) ]).optional().nullable(),
}).strict();

export const ItemsUncheckedUpdateManyInputSchema: z.ZodType<Prisma.ItemsUncheckedUpdateManyInput> = z.object({
  value: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  nbr: z.union([ z.number().int(),z.lazy(() => NullableIntFieldUpdateOperationsInputSchema) ]).optional().nullable(),
}).strict();

export const UserCreateInputSchema: z.ZodType<Prisma.UserCreateInput> = z.object({
  id: z.number().int(),
  name: z.string().optional().nullable(),
  posts: z.lazy(() => PostCreateNestedManyWithoutAuthorInputSchema).optional(),
  profile: z.lazy(() => ProfileCreateNestedOneWithoutUserInputSchema).optional()
}).strict();

export const UserUncheckedCreateInputSchema: z.ZodType<Prisma.UserUncheckedCreateInput> = z.object({
  id: z.number().int(),
  name: z.string().optional().nullable(),
  posts: z.lazy(() => PostUncheckedCreateNestedManyWithoutAuthorInputSchema).optional(),
  profile: z.lazy(() => ProfileUncheckedCreateNestedOneWithoutUserInputSchema).optional()
}).strict();

export const UserUpdateInputSchema: z.ZodType<Prisma.UserUpdateInput> = z.object({
  id: z.union([ z.number().int(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  name: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  posts: z.lazy(() => PostUpdateManyWithoutAuthorNestedInputSchema).optional(),
  profile: z.lazy(() => ProfileUpdateOneWithoutUserNestedInputSchema).optional()
}).strict();

export const UserUncheckedUpdateInputSchema: z.ZodType<Prisma.UserUncheckedUpdateInput> = z.object({
  id: z.union([ z.number().int(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  name: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  posts: z.lazy(() => PostUncheckedUpdateManyWithoutAuthorNestedInputSchema).optional(),
  profile: z.lazy(() => ProfileUncheckedUpdateOneWithoutUserNestedInputSchema).optional()
}).strict();

export const UserCreateManyInputSchema: z.ZodType<Prisma.UserCreateManyInput> = z.object({
  id: z.number().int(),
  name: z.string().optional().nullable()
}).strict();

export const UserUpdateManyMutationInputSchema: z.ZodType<Prisma.UserUpdateManyMutationInput> = z.object({
  id: z.union([ z.number().int(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  name: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
}).strict();

export const UserUncheckedUpdateManyInputSchema: z.ZodType<Prisma.UserUncheckedUpdateManyInput> = z.object({
  id: z.union([ z.number().int(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  name: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
}).strict();

export const PostCreateInputSchema: z.ZodType<Prisma.PostCreateInput> = z.object({
  id: z.number().int(),
  title: z.string(),
  contents: z.string(),
  nbr: z.number().int().optional().nullable(),
  author: z.lazy(() => UserCreateNestedOneWithoutPostsInputSchema).optional()
}).strict();

export const PostUncheckedCreateInputSchema: z.ZodType<Prisma.PostUncheckedCreateInput> = z.object({
  id: z.number().int(),
  title: z.string(),
  contents: z.string(),
  nbr: z.number().int().optional().nullable(),
  authorId: z.number().int()
}).strict();

export const PostUpdateInputSchema: z.ZodType<Prisma.PostUpdateInput> = z.object({
  id: z.union([ z.number().int(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  title: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  contents: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  nbr: z.union([ z.number().int(),z.lazy(() => NullableIntFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  author: z.lazy(() => UserUpdateOneWithoutPostsNestedInputSchema).optional()
}).strict();

export const PostUncheckedUpdateInputSchema: z.ZodType<Prisma.PostUncheckedUpdateInput> = z.object({
  id: z.union([ z.number().int(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  title: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  contents: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  nbr: z.union([ z.number().int(),z.lazy(() => NullableIntFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  authorId: z.union([ z.number().int(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const PostCreateManyInputSchema: z.ZodType<Prisma.PostCreateManyInput> = z.object({
  id: z.number().int(),
  title: z.string(),
  contents: z.string(),
  nbr: z.number().int().optional().nullable(),
  authorId: z.number().int()
}).strict();

export const PostUpdateManyMutationInputSchema: z.ZodType<Prisma.PostUpdateManyMutationInput> = z.object({
  id: z.union([ z.number().int(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  title: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  contents: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  nbr: z.union([ z.number().int(),z.lazy(() => NullableIntFieldUpdateOperationsInputSchema) ]).optional().nullable(),
}).strict();

export const PostUncheckedUpdateManyInputSchema: z.ZodType<Prisma.PostUncheckedUpdateManyInput> = z.object({
  id: z.union([ z.number().int(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  title: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  contents: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  nbr: z.union([ z.number().int(),z.lazy(() => NullableIntFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  authorId: z.union([ z.number().int(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const ProfileCreateInputSchema: z.ZodType<Prisma.ProfileCreateInput> = z.object({
  id: z.number().int(),
  bio: z.string(),
  user: z.lazy(() => UserCreateNestedOneWithoutProfileInputSchema).optional()
}).strict();

export const ProfileUncheckedCreateInputSchema: z.ZodType<Prisma.ProfileUncheckedCreateInput> = z.object({
  id: z.number().int(),
  bio: z.string(),
  userId: z.number().int()
}).strict();

export const ProfileUpdateInputSchema: z.ZodType<Prisma.ProfileUpdateInput> = z.object({
  id: z.union([ z.number().int(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  bio: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  user: z.lazy(() => UserUpdateOneWithoutProfileNestedInputSchema).optional()
}).strict();

export const ProfileUncheckedUpdateInputSchema: z.ZodType<Prisma.ProfileUncheckedUpdateInput> = z.object({
  id: z.union([ z.number().int(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  bio: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  userId: z.union([ z.number().int(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const ProfileCreateManyInputSchema: z.ZodType<Prisma.ProfileCreateManyInput> = z.object({
  id: z.number().int(),
  bio: z.string(),
  userId: z.number().int()
}).strict();

export const ProfileUpdateManyMutationInputSchema: z.ZodType<Prisma.ProfileUpdateManyMutationInput> = z.object({
  id: z.union([ z.number().int(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  bio: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const ProfileUncheckedUpdateManyInputSchema: z.ZodType<Prisma.ProfileUncheckedUpdateManyInput> = z.object({
  id: z.union([ z.number().int(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  bio: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  userId: z.union([ z.number().int(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const DataTypesCreateInputSchema: z.ZodType<Prisma.DataTypesCreateInput> = z.object({
  id: z.number().int(),
  date: z.coerce.date().optional().nullable(),
  time: z.coerce.date().optional().nullable(),
  timetz: z.coerce.date().optional().nullable(),
  timestamp: z.coerce.date().optional().nullable(),
  timestamptz: z.coerce.date().optional().nullable(),
  related: z.lazy(() => DummyCreateNestedOneWithoutDatatypeInputSchema).optional()
}).strict();

export const DataTypesUncheckedCreateInputSchema: z.ZodType<Prisma.DataTypesUncheckedCreateInput> = z.object({
  id: z.number().int(),
  date: z.coerce.date().optional().nullable(),
  time: z.coerce.date().optional().nullable(),
  timetz: z.coerce.date().optional().nullable(),
  timestamp: z.coerce.date().optional().nullable(),
  timestamptz: z.coerce.date().optional().nullable(),
  relatedId: z.number().int().optional().nullable()
}).strict();

export const DataTypesUpdateInputSchema: z.ZodType<Prisma.DataTypesUpdateInput> = z.object({
  id: z.union([ z.number().int(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  date: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  time: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  timetz: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  timestamptz: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  related: z.lazy(() => DummyUpdateOneWithoutDatatypeNestedInputSchema).optional()
}).strict();

export const DataTypesUncheckedUpdateInputSchema: z.ZodType<Prisma.DataTypesUncheckedUpdateInput> = z.object({
  id: z.union([ z.number().int(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  date: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  time: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  timetz: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  timestamptz: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  relatedId: z.union([ z.number().int(),z.lazy(() => NullableIntFieldUpdateOperationsInputSchema) ]).optional().nullable(),
}).strict();

export const DataTypesCreateManyInputSchema: z.ZodType<Prisma.DataTypesCreateManyInput> = z.object({
  id: z.number().int(),
  date: z.coerce.date().optional().nullable(),
  time: z.coerce.date().optional().nullable(),
  timetz: z.coerce.date().optional().nullable(),
  timestamp: z.coerce.date().optional().nullable(),
  timestamptz: z.coerce.date().optional().nullable(),
  relatedId: z.number().int().optional().nullable()
}).strict();

export const DataTypesUpdateManyMutationInputSchema: z.ZodType<Prisma.DataTypesUpdateManyMutationInput> = z.object({
  id: z.union([ z.number().int(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  date: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  time: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  timetz: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  timestamptz: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
}).strict();

export const DataTypesUncheckedUpdateManyInputSchema: z.ZodType<Prisma.DataTypesUncheckedUpdateManyInput> = z.object({
  id: z.union([ z.number().int(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  date: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  time: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  timetz: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  timestamptz: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  relatedId: z.union([ z.number().int(),z.lazy(() => NullableIntFieldUpdateOperationsInputSchema) ]).optional().nullable(),
}).strict();

export const DummyCreateInputSchema: z.ZodType<Prisma.DummyCreateInput> = z.object({
  id: z.number().int(),
  timestamp: z.coerce.date().optional().nullable(),
  datatype: z.lazy(() => DataTypesCreateNestedManyWithoutRelatedInputSchema).optional()
}).strict();

export const DummyUncheckedCreateInputSchema: z.ZodType<Prisma.DummyUncheckedCreateInput> = z.object({
  id: z.number().int(),
  timestamp: z.coerce.date().optional().nullable(),
  datatype: z.lazy(() => DataTypesUncheckedCreateNestedManyWithoutRelatedInputSchema).optional()
}).strict();

export const DummyUpdateInputSchema: z.ZodType<Prisma.DummyUpdateInput> = z.object({
  id: z.union([ z.number().int(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  datatype: z.lazy(() => DataTypesUpdateManyWithoutRelatedNestedInputSchema).optional()
}).strict();

export const DummyUncheckedUpdateInputSchema: z.ZodType<Prisma.DummyUncheckedUpdateInput> = z.object({
  id: z.union([ z.number().int(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  datatype: z.lazy(() => DataTypesUncheckedUpdateManyWithoutRelatedNestedInputSchema).optional()
}).strict();

export const DummyCreateManyInputSchema: z.ZodType<Prisma.DummyCreateManyInput> = z.object({
  id: z.number().int(),
  timestamp: z.coerce.date().optional().nullable()
}).strict();

export const DummyUpdateManyMutationInputSchema: z.ZodType<Prisma.DummyUpdateManyMutationInput> = z.object({
  id: z.union([ z.number().int(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
}).strict();

export const DummyUncheckedUpdateManyInputSchema: z.ZodType<Prisma.DummyUncheckedUpdateManyInput> = z.object({
  id: z.union([ z.number().int(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
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

export const ItemsCountOrderByAggregateInputSchema: z.ZodType<Prisma.ItemsCountOrderByAggregateInput> = z.object({
  value: z.lazy(() => SortOrderSchema).optional(),
  nbr: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const ItemsAvgOrderByAggregateInputSchema: z.ZodType<Prisma.ItemsAvgOrderByAggregateInput> = z.object({
  nbr: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const ItemsMaxOrderByAggregateInputSchema: z.ZodType<Prisma.ItemsMaxOrderByAggregateInput> = z.object({
  value: z.lazy(() => SortOrderSchema).optional(),
  nbr: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const ItemsMinOrderByAggregateInputSchema: z.ZodType<Prisma.ItemsMinOrderByAggregateInput> = z.object({
  value: z.lazy(() => SortOrderSchema).optional(),
  nbr: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const ItemsSumOrderByAggregateInputSchema: z.ZodType<Prisma.ItemsSumOrderByAggregateInput> = z.object({
  nbr: z.lazy(() => SortOrderSchema).optional()
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

export const IntFilterSchema: z.ZodType<Prisma.IntFilter> = z.object({
  equals: z.number().optional(),
  in: z.union([ z.number().array(),z.number() ]).optional(),
  notIn: z.union([ z.number().array(),z.number() ]).optional(),
  lt: z.number().optional(),
  lte: z.number().optional(),
  gt: z.number().optional(),
  gte: z.number().optional(),
  not: z.union([ z.number(),z.lazy(() => NestedIntFilterSchema) ]).optional(),
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

export const PostListRelationFilterSchema: z.ZodType<Prisma.PostListRelationFilter> = z.object({
  every: z.lazy(() => PostWhereInputSchema).optional(),
  some: z.lazy(() => PostWhereInputSchema).optional(),
  none: z.lazy(() => PostWhereInputSchema).optional()
}).strict();

export const ProfileRelationFilterSchema: z.ZodType<Prisma.ProfileRelationFilter> = z.object({
  is: z.lazy(() => ProfileWhereInputSchema).optional().nullable(),
  isNot: z.lazy(() => ProfileWhereInputSchema).optional().nullable()
}).strict();

export const PostOrderByRelationAggregateInputSchema: z.ZodType<Prisma.PostOrderByRelationAggregateInput> = z.object({
  _count: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const UserCountOrderByAggregateInputSchema: z.ZodType<Prisma.UserCountOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  name: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const UserAvgOrderByAggregateInputSchema: z.ZodType<Prisma.UserAvgOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const UserMaxOrderByAggregateInputSchema: z.ZodType<Prisma.UserMaxOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  name: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const UserMinOrderByAggregateInputSchema: z.ZodType<Prisma.UserMinOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  name: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const UserSumOrderByAggregateInputSchema: z.ZodType<Prisma.UserSumOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const IntWithAggregatesFilterSchema: z.ZodType<Prisma.IntWithAggregatesFilter> = z.object({
  equals: z.number().optional(),
  in: z.union([ z.number().array(),z.number() ]).optional(),
  notIn: z.union([ z.number().array(),z.number() ]).optional(),
  lt: z.number().optional(),
  lte: z.number().optional(),
  gt: z.number().optional(),
  gte: z.number().optional(),
  not: z.union([ z.number(),z.lazy(() => NestedIntWithAggregatesFilterSchema) ]).optional(),
  _count: z.lazy(() => NestedIntFilterSchema).optional(),
  _avg: z.lazy(() => NestedFloatFilterSchema).optional(),
  _sum: z.lazy(() => NestedIntFilterSchema).optional(),
  _min: z.lazy(() => NestedIntFilterSchema).optional(),
  _max: z.lazy(() => NestedIntFilterSchema).optional()
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

export const UserRelationFilterSchema: z.ZodType<Prisma.UserRelationFilter> = z.object({
  is: z.lazy(() => UserWhereInputSchema).optional().nullable(),
  isNot: z.lazy(() => UserWhereInputSchema).optional().nullable()
}).strict();

export const PostCountOrderByAggregateInputSchema: z.ZodType<Prisma.PostCountOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  title: z.lazy(() => SortOrderSchema).optional(),
  contents: z.lazy(() => SortOrderSchema).optional(),
  nbr: z.lazy(() => SortOrderSchema).optional(),
  authorId: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const PostAvgOrderByAggregateInputSchema: z.ZodType<Prisma.PostAvgOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  nbr: z.lazy(() => SortOrderSchema).optional(),
  authorId: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const PostMaxOrderByAggregateInputSchema: z.ZodType<Prisma.PostMaxOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  title: z.lazy(() => SortOrderSchema).optional(),
  contents: z.lazy(() => SortOrderSchema).optional(),
  nbr: z.lazy(() => SortOrderSchema).optional(),
  authorId: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const PostMinOrderByAggregateInputSchema: z.ZodType<Prisma.PostMinOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  title: z.lazy(() => SortOrderSchema).optional(),
  contents: z.lazy(() => SortOrderSchema).optional(),
  nbr: z.lazy(() => SortOrderSchema).optional(),
  authorId: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const PostSumOrderByAggregateInputSchema: z.ZodType<Prisma.PostSumOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  nbr: z.lazy(() => SortOrderSchema).optional(),
  authorId: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const ProfileCountOrderByAggregateInputSchema: z.ZodType<Prisma.ProfileCountOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  bio: z.lazy(() => SortOrderSchema).optional(),
  userId: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const ProfileAvgOrderByAggregateInputSchema: z.ZodType<Prisma.ProfileAvgOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  userId: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const ProfileMaxOrderByAggregateInputSchema: z.ZodType<Prisma.ProfileMaxOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  bio: z.lazy(() => SortOrderSchema).optional(),
  userId: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const ProfileMinOrderByAggregateInputSchema: z.ZodType<Prisma.ProfileMinOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  bio: z.lazy(() => SortOrderSchema).optional(),
  userId: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const ProfileSumOrderByAggregateInputSchema: z.ZodType<Prisma.ProfileSumOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  userId: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const DateTimeNullableFilterSchema: z.ZodType<Prisma.DateTimeNullableFilter> = z.object({
  equals: z.coerce.date().optional().nullable(),
  in: z.union([ z.coerce.date().array(),z.coerce.date() ]).optional().nullable(),
  notIn: z.union([ z.coerce.date().array(),z.coerce.date() ]).optional().nullable(),
  lt: z.coerce.date().optional(),
  lte: z.coerce.date().optional(),
  gt: z.coerce.date().optional(),
  gte: z.coerce.date().optional(),
  not: z.union([ z.coerce.date(),z.lazy(() => NestedDateTimeNullableFilterSchema) ]).optional().nullable(),
}).strict();

export const DummyRelationFilterSchema: z.ZodType<Prisma.DummyRelationFilter> = z.object({
  is: z.lazy(() => DummyWhereInputSchema).optional().nullable(),
  isNot: z.lazy(() => DummyWhereInputSchema).optional().nullable()
}).strict();

export const DataTypesCountOrderByAggregateInputSchema: z.ZodType<Prisma.DataTypesCountOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  date: z.lazy(() => SortOrderSchema).optional(),
  time: z.lazy(() => SortOrderSchema).optional(),
  timetz: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  timestamptz: z.lazy(() => SortOrderSchema).optional(),
  relatedId: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const DataTypesAvgOrderByAggregateInputSchema: z.ZodType<Prisma.DataTypesAvgOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  relatedId: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const DataTypesMaxOrderByAggregateInputSchema: z.ZodType<Prisma.DataTypesMaxOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  date: z.lazy(() => SortOrderSchema).optional(),
  time: z.lazy(() => SortOrderSchema).optional(),
  timetz: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  timestamptz: z.lazy(() => SortOrderSchema).optional(),
  relatedId: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const DataTypesMinOrderByAggregateInputSchema: z.ZodType<Prisma.DataTypesMinOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  date: z.lazy(() => SortOrderSchema).optional(),
  time: z.lazy(() => SortOrderSchema).optional(),
  timetz: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  timestamptz: z.lazy(() => SortOrderSchema).optional(),
  relatedId: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const DataTypesSumOrderByAggregateInputSchema: z.ZodType<Prisma.DataTypesSumOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  relatedId: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const DateTimeNullableWithAggregatesFilterSchema: z.ZodType<Prisma.DateTimeNullableWithAggregatesFilter> = z.object({
  equals: z.coerce.date().optional().nullable(),
  in: z.union([ z.coerce.date().array(),z.coerce.date() ]).optional().nullable(),
  notIn: z.union([ z.coerce.date().array(),z.coerce.date() ]).optional().nullable(),
  lt: z.coerce.date().optional(),
  lte: z.coerce.date().optional(),
  gt: z.coerce.date().optional(),
  gte: z.coerce.date().optional(),
  not: z.union([ z.coerce.date(),z.lazy(() => NestedDateTimeNullableWithAggregatesFilterSchema) ]).optional().nullable(),
  _count: z.lazy(() => NestedIntNullableFilterSchema).optional(),
  _min: z.lazy(() => NestedDateTimeNullableFilterSchema).optional(),
  _max: z.lazy(() => NestedDateTimeNullableFilterSchema).optional()
}).strict();

export const DataTypesListRelationFilterSchema: z.ZodType<Prisma.DataTypesListRelationFilter> = z.object({
  every: z.lazy(() => DataTypesWhereInputSchema).optional(),
  some: z.lazy(() => DataTypesWhereInputSchema).optional(),
  none: z.lazy(() => DataTypesWhereInputSchema).optional()
}).strict();

export const DataTypesOrderByRelationAggregateInputSchema: z.ZodType<Prisma.DataTypesOrderByRelationAggregateInput> = z.object({
  _count: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const DummyCountOrderByAggregateInputSchema: z.ZodType<Prisma.DummyCountOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const DummyAvgOrderByAggregateInputSchema: z.ZodType<Prisma.DummyAvgOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const DummyMaxOrderByAggregateInputSchema: z.ZodType<Prisma.DummyMaxOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const DummyMinOrderByAggregateInputSchema: z.ZodType<Prisma.DummyMinOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const DummySumOrderByAggregateInputSchema: z.ZodType<Prisma.DummySumOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const StringFieldUpdateOperationsInputSchema: z.ZodType<Prisma.StringFieldUpdateOperationsInput> = z.object({
  set: z.string().optional()
}).strict();

export const NullableIntFieldUpdateOperationsInputSchema: z.ZodType<Prisma.NullableIntFieldUpdateOperationsInput> = z.object({
  set: z.number().optional().nullable(),
  increment: z.number().optional(),
  decrement: z.number().optional(),
  multiply: z.number().optional(),
  divide: z.number().optional()
}).strict();

export const PostCreateNestedManyWithoutAuthorInputSchema: z.ZodType<Prisma.PostCreateNestedManyWithoutAuthorInput> = z.object({
  create: z.union([ z.lazy(() => PostCreateWithoutAuthorInputSchema),z.lazy(() => PostCreateWithoutAuthorInputSchema).array(),z.lazy(() => PostUncheckedCreateWithoutAuthorInputSchema),z.lazy(() => PostUncheckedCreateWithoutAuthorInputSchema).array() ]).optional(),
  connectOrCreate: z.union([ z.lazy(() => PostCreateOrConnectWithoutAuthorInputSchema),z.lazy(() => PostCreateOrConnectWithoutAuthorInputSchema).array() ]).optional(),
  createMany: z.lazy(() => PostCreateManyAuthorInputEnvelopeSchema).optional(),
  connect: z.union([ z.lazy(() => PostWhereUniqueInputSchema),z.lazy(() => PostWhereUniqueInputSchema).array() ]).optional(),
}).strict();

export const ProfileCreateNestedOneWithoutUserInputSchema: z.ZodType<Prisma.ProfileCreateNestedOneWithoutUserInput> = z.object({
  create: z.union([ z.lazy(() => ProfileCreateWithoutUserInputSchema),z.lazy(() => ProfileUncheckedCreateWithoutUserInputSchema) ]).optional(),
  connectOrCreate: z.lazy(() => ProfileCreateOrConnectWithoutUserInputSchema).optional(),
  connect: z.lazy(() => ProfileWhereUniqueInputSchema).optional()
}).strict();

export const PostUncheckedCreateNestedManyWithoutAuthorInputSchema: z.ZodType<Prisma.PostUncheckedCreateNestedManyWithoutAuthorInput> = z.object({
  create: z.union([ z.lazy(() => PostCreateWithoutAuthorInputSchema),z.lazy(() => PostCreateWithoutAuthorInputSchema).array(),z.lazy(() => PostUncheckedCreateWithoutAuthorInputSchema),z.lazy(() => PostUncheckedCreateWithoutAuthorInputSchema).array() ]).optional(),
  connectOrCreate: z.union([ z.lazy(() => PostCreateOrConnectWithoutAuthorInputSchema),z.lazy(() => PostCreateOrConnectWithoutAuthorInputSchema).array() ]).optional(),
  createMany: z.lazy(() => PostCreateManyAuthorInputEnvelopeSchema).optional(),
  connect: z.union([ z.lazy(() => PostWhereUniqueInputSchema),z.lazy(() => PostWhereUniqueInputSchema).array() ]).optional(),
}).strict();

export const ProfileUncheckedCreateNestedOneWithoutUserInputSchema: z.ZodType<Prisma.ProfileUncheckedCreateNestedOneWithoutUserInput> = z.object({
  create: z.union([ z.lazy(() => ProfileCreateWithoutUserInputSchema),z.lazy(() => ProfileUncheckedCreateWithoutUserInputSchema) ]).optional(),
  connectOrCreate: z.lazy(() => ProfileCreateOrConnectWithoutUserInputSchema).optional(),
  connect: z.lazy(() => ProfileWhereUniqueInputSchema).optional()
}).strict();

export const IntFieldUpdateOperationsInputSchema: z.ZodType<Prisma.IntFieldUpdateOperationsInput> = z.object({
  set: z.number().optional(),
  increment: z.number().optional(),
  decrement: z.number().optional(),
  multiply: z.number().optional(),
  divide: z.number().optional()
}).strict();

export const NullableStringFieldUpdateOperationsInputSchema: z.ZodType<Prisma.NullableStringFieldUpdateOperationsInput> = z.object({
  set: z.string().optional().nullable()
}).strict();

export const PostUpdateManyWithoutAuthorNestedInputSchema: z.ZodType<Prisma.PostUpdateManyWithoutAuthorNestedInput> = z.object({
  create: z.union([ z.lazy(() => PostCreateWithoutAuthorInputSchema),z.lazy(() => PostCreateWithoutAuthorInputSchema).array(),z.lazy(() => PostUncheckedCreateWithoutAuthorInputSchema),z.lazy(() => PostUncheckedCreateWithoutAuthorInputSchema).array() ]).optional(),
  connectOrCreate: z.union([ z.lazy(() => PostCreateOrConnectWithoutAuthorInputSchema),z.lazy(() => PostCreateOrConnectWithoutAuthorInputSchema).array() ]).optional(),
  upsert: z.union([ z.lazy(() => PostUpsertWithWhereUniqueWithoutAuthorInputSchema),z.lazy(() => PostUpsertWithWhereUniqueWithoutAuthorInputSchema).array() ]).optional(),
  createMany: z.lazy(() => PostCreateManyAuthorInputEnvelopeSchema).optional(),
  set: z.union([ z.lazy(() => PostWhereUniqueInputSchema),z.lazy(() => PostWhereUniqueInputSchema).array() ]).optional(),
  disconnect: z.union([ z.lazy(() => PostWhereUniqueInputSchema),z.lazy(() => PostWhereUniqueInputSchema).array() ]).optional(),
  delete: z.union([ z.lazy(() => PostWhereUniqueInputSchema),z.lazy(() => PostWhereUniqueInputSchema).array() ]).optional(),
  connect: z.union([ z.lazy(() => PostWhereUniqueInputSchema),z.lazy(() => PostWhereUniqueInputSchema).array() ]).optional(),
  update: z.union([ z.lazy(() => PostUpdateWithWhereUniqueWithoutAuthorInputSchema),z.lazy(() => PostUpdateWithWhereUniqueWithoutAuthorInputSchema).array() ]).optional(),
  updateMany: z.union([ z.lazy(() => PostUpdateManyWithWhereWithoutAuthorInputSchema),z.lazy(() => PostUpdateManyWithWhereWithoutAuthorInputSchema).array() ]).optional(),
  deleteMany: z.union([ z.lazy(() => PostScalarWhereInputSchema),z.lazy(() => PostScalarWhereInputSchema).array() ]).optional(),
}).strict();

export const ProfileUpdateOneWithoutUserNestedInputSchema: z.ZodType<Prisma.ProfileUpdateOneWithoutUserNestedInput> = z.object({
  create: z.union([ z.lazy(() => ProfileCreateWithoutUserInputSchema),z.lazy(() => ProfileUncheckedCreateWithoutUserInputSchema) ]).optional(),
  connectOrCreate: z.lazy(() => ProfileCreateOrConnectWithoutUserInputSchema).optional(),
  upsert: z.lazy(() => ProfileUpsertWithoutUserInputSchema).optional(),
  disconnect: z.boolean().optional(),
  delete: z.boolean().optional(),
  connect: z.lazy(() => ProfileWhereUniqueInputSchema).optional(),
  update: z.union([ z.lazy(() => ProfileUpdateWithoutUserInputSchema),z.lazy(() => ProfileUncheckedUpdateWithoutUserInputSchema) ]).optional(),
}).strict();

export const PostUncheckedUpdateManyWithoutAuthorNestedInputSchema: z.ZodType<Prisma.PostUncheckedUpdateManyWithoutAuthorNestedInput> = z.object({
  create: z.union([ z.lazy(() => PostCreateWithoutAuthorInputSchema),z.lazy(() => PostCreateWithoutAuthorInputSchema).array(),z.lazy(() => PostUncheckedCreateWithoutAuthorInputSchema),z.lazy(() => PostUncheckedCreateWithoutAuthorInputSchema).array() ]).optional(),
  connectOrCreate: z.union([ z.lazy(() => PostCreateOrConnectWithoutAuthorInputSchema),z.lazy(() => PostCreateOrConnectWithoutAuthorInputSchema).array() ]).optional(),
  upsert: z.union([ z.lazy(() => PostUpsertWithWhereUniqueWithoutAuthorInputSchema),z.lazy(() => PostUpsertWithWhereUniqueWithoutAuthorInputSchema).array() ]).optional(),
  createMany: z.lazy(() => PostCreateManyAuthorInputEnvelopeSchema).optional(),
  set: z.union([ z.lazy(() => PostWhereUniqueInputSchema),z.lazy(() => PostWhereUniqueInputSchema).array() ]).optional(),
  disconnect: z.union([ z.lazy(() => PostWhereUniqueInputSchema),z.lazy(() => PostWhereUniqueInputSchema).array() ]).optional(),
  delete: z.union([ z.lazy(() => PostWhereUniqueInputSchema),z.lazy(() => PostWhereUniqueInputSchema).array() ]).optional(),
  connect: z.union([ z.lazy(() => PostWhereUniqueInputSchema),z.lazy(() => PostWhereUniqueInputSchema).array() ]).optional(),
  update: z.union([ z.lazy(() => PostUpdateWithWhereUniqueWithoutAuthorInputSchema),z.lazy(() => PostUpdateWithWhereUniqueWithoutAuthorInputSchema).array() ]).optional(),
  updateMany: z.union([ z.lazy(() => PostUpdateManyWithWhereWithoutAuthorInputSchema),z.lazy(() => PostUpdateManyWithWhereWithoutAuthorInputSchema).array() ]).optional(),
  deleteMany: z.union([ z.lazy(() => PostScalarWhereInputSchema),z.lazy(() => PostScalarWhereInputSchema).array() ]).optional(),
}).strict();

export const ProfileUncheckedUpdateOneWithoutUserNestedInputSchema: z.ZodType<Prisma.ProfileUncheckedUpdateOneWithoutUserNestedInput> = z.object({
  create: z.union([ z.lazy(() => ProfileCreateWithoutUserInputSchema),z.lazy(() => ProfileUncheckedCreateWithoutUserInputSchema) ]).optional(),
  connectOrCreate: z.lazy(() => ProfileCreateOrConnectWithoutUserInputSchema).optional(),
  upsert: z.lazy(() => ProfileUpsertWithoutUserInputSchema).optional(),
  disconnect: z.boolean().optional(),
  delete: z.boolean().optional(),
  connect: z.lazy(() => ProfileWhereUniqueInputSchema).optional(),
  update: z.union([ z.lazy(() => ProfileUpdateWithoutUserInputSchema),z.lazy(() => ProfileUncheckedUpdateWithoutUserInputSchema) ]).optional(),
}).strict();

export const UserCreateNestedOneWithoutPostsInputSchema: z.ZodType<Prisma.UserCreateNestedOneWithoutPostsInput> = z.object({
  create: z.union([ z.lazy(() => UserCreateWithoutPostsInputSchema),z.lazy(() => UserUncheckedCreateWithoutPostsInputSchema) ]).optional(),
  connectOrCreate: z.lazy(() => UserCreateOrConnectWithoutPostsInputSchema).optional(),
  connect: z.lazy(() => UserWhereUniqueInputSchema).optional()
}).strict();

export const UserUpdateOneWithoutPostsNestedInputSchema: z.ZodType<Prisma.UserUpdateOneWithoutPostsNestedInput> = z.object({
  create: z.union([ z.lazy(() => UserCreateWithoutPostsInputSchema),z.lazy(() => UserUncheckedCreateWithoutPostsInputSchema) ]).optional(),
  connectOrCreate: z.lazy(() => UserCreateOrConnectWithoutPostsInputSchema).optional(),
  upsert: z.lazy(() => UserUpsertWithoutPostsInputSchema).optional(),
  disconnect: z.boolean().optional(),
  delete: z.boolean().optional(),
  connect: z.lazy(() => UserWhereUniqueInputSchema).optional(),
  update: z.union([ z.lazy(() => UserUpdateWithoutPostsInputSchema),z.lazy(() => UserUncheckedUpdateWithoutPostsInputSchema) ]).optional(),
}).strict();

export const UserCreateNestedOneWithoutProfileInputSchema: z.ZodType<Prisma.UserCreateNestedOneWithoutProfileInput> = z.object({
  create: z.union([ z.lazy(() => UserCreateWithoutProfileInputSchema),z.lazy(() => UserUncheckedCreateWithoutProfileInputSchema) ]).optional(),
  connectOrCreate: z.lazy(() => UserCreateOrConnectWithoutProfileInputSchema).optional(),
  connect: z.lazy(() => UserWhereUniqueInputSchema).optional()
}).strict();

export const UserUpdateOneWithoutProfileNestedInputSchema: z.ZodType<Prisma.UserUpdateOneWithoutProfileNestedInput> = z.object({
  create: z.union([ z.lazy(() => UserCreateWithoutProfileInputSchema),z.lazy(() => UserUncheckedCreateWithoutProfileInputSchema) ]).optional(),
  connectOrCreate: z.lazy(() => UserCreateOrConnectWithoutProfileInputSchema).optional(),
  upsert: z.lazy(() => UserUpsertWithoutProfileInputSchema).optional(),
  disconnect: z.boolean().optional(),
  delete: z.boolean().optional(),
  connect: z.lazy(() => UserWhereUniqueInputSchema).optional(),
  update: z.union([ z.lazy(() => UserUpdateWithoutProfileInputSchema),z.lazy(() => UserUncheckedUpdateWithoutProfileInputSchema) ]).optional(),
}).strict();

export const DummyCreateNestedOneWithoutDatatypeInputSchema: z.ZodType<Prisma.DummyCreateNestedOneWithoutDatatypeInput> = z.object({
  create: z.union([ z.lazy(() => DummyCreateWithoutDatatypeInputSchema),z.lazy(() => DummyUncheckedCreateWithoutDatatypeInputSchema) ]).optional(),
  connectOrCreate: z.lazy(() => DummyCreateOrConnectWithoutDatatypeInputSchema).optional(),
  connect: z.lazy(() => DummyWhereUniqueInputSchema).optional()
}).strict();

export const NullableDateTimeFieldUpdateOperationsInputSchema: z.ZodType<Prisma.NullableDateTimeFieldUpdateOperationsInput> = z.object({
  set: z.coerce.date().optional().nullable()
}).strict();

export const DummyUpdateOneWithoutDatatypeNestedInputSchema: z.ZodType<Prisma.DummyUpdateOneWithoutDatatypeNestedInput> = z.object({
  create: z.union([ z.lazy(() => DummyCreateWithoutDatatypeInputSchema),z.lazy(() => DummyUncheckedCreateWithoutDatatypeInputSchema) ]).optional(),
  connectOrCreate: z.lazy(() => DummyCreateOrConnectWithoutDatatypeInputSchema).optional(),
  upsert: z.lazy(() => DummyUpsertWithoutDatatypeInputSchema).optional(),
  disconnect: z.boolean().optional(),
  delete: z.boolean().optional(),
  connect: z.lazy(() => DummyWhereUniqueInputSchema).optional(),
  update: z.union([ z.lazy(() => DummyUpdateWithoutDatatypeInputSchema),z.lazy(() => DummyUncheckedUpdateWithoutDatatypeInputSchema) ]).optional(),
}).strict();

export const DataTypesCreateNestedManyWithoutRelatedInputSchema: z.ZodType<Prisma.DataTypesCreateNestedManyWithoutRelatedInput> = z.object({
  create: z.union([ z.lazy(() => DataTypesCreateWithoutRelatedInputSchema),z.lazy(() => DataTypesCreateWithoutRelatedInputSchema).array(),z.lazy(() => DataTypesUncheckedCreateWithoutRelatedInputSchema),z.lazy(() => DataTypesUncheckedCreateWithoutRelatedInputSchema).array() ]).optional(),
  connectOrCreate: z.union([ z.lazy(() => DataTypesCreateOrConnectWithoutRelatedInputSchema),z.lazy(() => DataTypesCreateOrConnectWithoutRelatedInputSchema).array() ]).optional(),
  createMany: z.lazy(() => DataTypesCreateManyRelatedInputEnvelopeSchema).optional(),
  connect: z.union([ z.lazy(() => DataTypesWhereUniqueInputSchema),z.lazy(() => DataTypesWhereUniqueInputSchema).array() ]).optional(),
}).strict();

export const DataTypesUncheckedCreateNestedManyWithoutRelatedInputSchema: z.ZodType<Prisma.DataTypesUncheckedCreateNestedManyWithoutRelatedInput> = z.object({
  create: z.union([ z.lazy(() => DataTypesCreateWithoutRelatedInputSchema),z.lazy(() => DataTypesCreateWithoutRelatedInputSchema).array(),z.lazy(() => DataTypesUncheckedCreateWithoutRelatedInputSchema),z.lazy(() => DataTypesUncheckedCreateWithoutRelatedInputSchema).array() ]).optional(),
  connectOrCreate: z.union([ z.lazy(() => DataTypesCreateOrConnectWithoutRelatedInputSchema),z.lazy(() => DataTypesCreateOrConnectWithoutRelatedInputSchema).array() ]).optional(),
  createMany: z.lazy(() => DataTypesCreateManyRelatedInputEnvelopeSchema).optional(),
  connect: z.union([ z.lazy(() => DataTypesWhereUniqueInputSchema),z.lazy(() => DataTypesWhereUniqueInputSchema).array() ]).optional(),
}).strict();

export const DataTypesUpdateManyWithoutRelatedNestedInputSchema: z.ZodType<Prisma.DataTypesUpdateManyWithoutRelatedNestedInput> = z.object({
  create: z.union([ z.lazy(() => DataTypesCreateWithoutRelatedInputSchema),z.lazy(() => DataTypesCreateWithoutRelatedInputSchema).array(),z.lazy(() => DataTypesUncheckedCreateWithoutRelatedInputSchema),z.lazy(() => DataTypesUncheckedCreateWithoutRelatedInputSchema).array() ]).optional(),
  connectOrCreate: z.union([ z.lazy(() => DataTypesCreateOrConnectWithoutRelatedInputSchema),z.lazy(() => DataTypesCreateOrConnectWithoutRelatedInputSchema).array() ]).optional(),
  upsert: z.union([ z.lazy(() => DataTypesUpsertWithWhereUniqueWithoutRelatedInputSchema),z.lazy(() => DataTypesUpsertWithWhereUniqueWithoutRelatedInputSchema).array() ]).optional(),
  createMany: z.lazy(() => DataTypesCreateManyRelatedInputEnvelopeSchema).optional(),
  set: z.union([ z.lazy(() => DataTypesWhereUniqueInputSchema),z.lazy(() => DataTypesWhereUniqueInputSchema).array() ]).optional(),
  disconnect: z.union([ z.lazy(() => DataTypesWhereUniqueInputSchema),z.lazy(() => DataTypesWhereUniqueInputSchema).array() ]).optional(),
  delete: z.union([ z.lazy(() => DataTypesWhereUniqueInputSchema),z.lazy(() => DataTypesWhereUniqueInputSchema).array() ]).optional(),
  connect: z.union([ z.lazy(() => DataTypesWhereUniqueInputSchema),z.lazy(() => DataTypesWhereUniqueInputSchema).array() ]).optional(),
  update: z.union([ z.lazy(() => DataTypesUpdateWithWhereUniqueWithoutRelatedInputSchema),z.lazy(() => DataTypesUpdateWithWhereUniqueWithoutRelatedInputSchema).array() ]).optional(),
  updateMany: z.union([ z.lazy(() => DataTypesUpdateManyWithWhereWithoutRelatedInputSchema),z.lazy(() => DataTypesUpdateManyWithWhereWithoutRelatedInputSchema).array() ]).optional(),
  deleteMany: z.union([ z.lazy(() => DataTypesScalarWhereInputSchema),z.lazy(() => DataTypesScalarWhereInputSchema).array() ]).optional(),
}).strict();

export const DataTypesUncheckedUpdateManyWithoutRelatedNestedInputSchema: z.ZodType<Prisma.DataTypesUncheckedUpdateManyWithoutRelatedNestedInput> = z.object({
  create: z.union([ z.lazy(() => DataTypesCreateWithoutRelatedInputSchema),z.lazy(() => DataTypesCreateWithoutRelatedInputSchema).array(),z.lazy(() => DataTypesUncheckedCreateWithoutRelatedInputSchema),z.lazy(() => DataTypesUncheckedCreateWithoutRelatedInputSchema).array() ]).optional(),
  connectOrCreate: z.union([ z.lazy(() => DataTypesCreateOrConnectWithoutRelatedInputSchema),z.lazy(() => DataTypesCreateOrConnectWithoutRelatedInputSchema).array() ]).optional(),
  upsert: z.union([ z.lazy(() => DataTypesUpsertWithWhereUniqueWithoutRelatedInputSchema),z.lazy(() => DataTypesUpsertWithWhereUniqueWithoutRelatedInputSchema).array() ]).optional(),
  createMany: z.lazy(() => DataTypesCreateManyRelatedInputEnvelopeSchema).optional(),
  set: z.union([ z.lazy(() => DataTypesWhereUniqueInputSchema),z.lazy(() => DataTypesWhereUniqueInputSchema).array() ]).optional(),
  disconnect: z.union([ z.lazy(() => DataTypesWhereUniqueInputSchema),z.lazy(() => DataTypesWhereUniqueInputSchema).array() ]).optional(),
  delete: z.union([ z.lazy(() => DataTypesWhereUniqueInputSchema),z.lazy(() => DataTypesWhereUniqueInputSchema).array() ]).optional(),
  connect: z.union([ z.lazy(() => DataTypesWhereUniqueInputSchema),z.lazy(() => DataTypesWhereUniqueInputSchema).array() ]).optional(),
  update: z.union([ z.lazy(() => DataTypesUpdateWithWhereUniqueWithoutRelatedInputSchema),z.lazy(() => DataTypesUpdateWithWhereUniqueWithoutRelatedInputSchema).array() ]).optional(),
  updateMany: z.union([ z.lazy(() => DataTypesUpdateManyWithWhereWithoutRelatedInputSchema),z.lazy(() => DataTypesUpdateManyWithWhereWithoutRelatedInputSchema).array() ]).optional(),
  deleteMany: z.union([ z.lazy(() => DataTypesScalarWhereInputSchema),z.lazy(() => DataTypesScalarWhereInputSchema).array() ]).optional(),
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

export const NestedIntWithAggregatesFilterSchema: z.ZodType<Prisma.NestedIntWithAggregatesFilter> = z.object({
  equals: z.number().optional(),
  in: z.union([ z.number().array(),z.number() ]).optional(),
  notIn: z.union([ z.number().array(),z.number() ]).optional(),
  lt: z.number().optional(),
  lte: z.number().optional(),
  gt: z.number().optional(),
  gte: z.number().optional(),
  not: z.union([ z.number(),z.lazy(() => NestedIntWithAggregatesFilterSchema) ]).optional(),
  _count: z.lazy(() => NestedIntFilterSchema).optional(),
  _avg: z.lazy(() => NestedFloatFilterSchema).optional(),
  _sum: z.lazy(() => NestedIntFilterSchema).optional(),
  _min: z.lazy(() => NestedIntFilterSchema).optional(),
  _max: z.lazy(() => NestedIntFilterSchema).optional()
}).strict();

export const NestedFloatFilterSchema: z.ZodType<Prisma.NestedFloatFilter> = z.object({
  equals: z.number().optional(),
  in: z.union([ z.number().array(),z.number() ]).optional(),
  notIn: z.union([ z.number().array(),z.number() ]).optional(),
  lt: z.number().optional(),
  lte: z.number().optional(),
  gt: z.number().optional(),
  gte: z.number().optional(),
  not: z.union([ z.number(),z.lazy(() => NestedFloatFilterSchema) ]).optional(),
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

export const NestedDateTimeNullableFilterSchema: z.ZodType<Prisma.NestedDateTimeNullableFilter> = z.object({
  equals: z.coerce.date().optional().nullable(),
  in: z.union([ z.coerce.date().array(),z.coerce.date() ]).optional().nullable(),
  notIn: z.union([ z.coerce.date().array(),z.coerce.date() ]).optional().nullable(),
  lt: z.coerce.date().optional(),
  lte: z.coerce.date().optional(),
  gt: z.coerce.date().optional(),
  gte: z.coerce.date().optional(),
  not: z.union([ z.coerce.date(),z.lazy(() => NestedDateTimeNullableFilterSchema) ]).optional().nullable(),
}).strict();

export const NestedDateTimeNullableWithAggregatesFilterSchema: z.ZodType<Prisma.NestedDateTimeNullableWithAggregatesFilter> = z.object({
  equals: z.coerce.date().optional().nullable(),
  in: z.union([ z.coerce.date().array(),z.coerce.date() ]).optional().nullable(),
  notIn: z.union([ z.coerce.date().array(),z.coerce.date() ]).optional().nullable(),
  lt: z.coerce.date().optional(),
  lte: z.coerce.date().optional(),
  gt: z.coerce.date().optional(),
  gte: z.coerce.date().optional(),
  not: z.union([ z.coerce.date(),z.lazy(() => NestedDateTimeNullableWithAggregatesFilterSchema) ]).optional().nullable(),
  _count: z.lazy(() => NestedIntNullableFilterSchema).optional(),
  _min: z.lazy(() => NestedDateTimeNullableFilterSchema).optional(),
  _max: z.lazy(() => NestedDateTimeNullableFilterSchema).optional()
}).strict();

export const PostCreateWithoutAuthorInputSchema: z.ZodType<Prisma.PostCreateWithoutAuthorInput> = z.object({
  id: z.number(),
  title: z.string(),
  contents: z.string(),
  nbr: z.number().optional().nullable()
}).strict();

export const PostUncheckedCreateWithoutAuthorInputSchema: z.ZodType<Prisma.PostUncheckedCreateWithoutAuthorInput> = z.object({
  id: z.number(),
  title: z.string(),
  contents: z.string(),
  nbr: z.number().optional().nullable()
}).strict();

export const PostCreateOrConnectWithoutAuthorInputSchema: z.ZodType<Prisma.PostCreateOrConnectWithoutAuthorInput> = z.object({
  where: z.lazy(() => PostWhereUniqueInputSchema),
  create: z.union([ z.lazy(() => PostCreateWithoutAuthorInputSchema),z.lazy(() => PostUncheckedCreateWithoutAuthorInputSchema) ]),
}).strict();

export const PostCreateManyAuthorInputEnvelopeSchema: z.ZodType<Prisma.PostCreateManyAuthorInputEnvelope> = z.object({
  data: z.union([ z.lazy(() => PostCreateManyAuthorInputSchema),z.lazy(() => PostCreateManyAuthorInputSchema).array() ]),
  skipDuplicates: z.boolean().optional()
}).strict();

export const ProfileCreateWithoutUserInputSchema: z.ZodType<Prisma.ProfileCreateWithoutUserInput> = z.object({
  id: z.number(),
  bio: z.string()
}).strict();

export const ProfileUncheckedCreateWithoutUserInputSchema: z.ZodType<Prisma.ProfileUncheckedCreateWithoutUserInput> = z.object({
  id: z.number(),
  bio: z.string()
}).strict();

export const ProfileCreateOrConnectWithoutUserInputSchema: z.ZodType<Prisma.ProfileCreateOrConnectWithoutUserInput> = z.object({
  where: z.lazy(() => ProfileWhereUniqueInputSchema),
  create: z.union([ z.lazy(() => ProfileCreateWithoutUserInputSchema),z.lazy(() => ProfileUncheckedCreateWithoutUserInputSchema) ]),
}).strict();

export const PostUpsertWithWhereUniqueWithoutAuthorInputSchema: z.ZodType<Prisma.PostUpsertWithWhereUniqueWithoutAuthorInput> = z.object({
  where: z.lazy(() => PostWhereUniqueInputSchema),
  update: z.union([ z.lazy(() => PostUpdateWithoutAuthorInputSchema),z.lazy(() => PostUncheckedUpdateWithoutAuthorInputSchema) ]),
  create: z.union([ z.lazy(() => PostCreateWithoutAuthorInputSchema),z.lazy(() => PostUncheckedCreateWithoutAuthorInputSchema) ]),
}).strict();

export const PostUpdateWithWhereUniqueWithoutAuthorInputSchema: z.ZodType<Prisma.PostUpdateWithWhereUniqueWithoutAuthorInput> = z.object({
  where: z.lazy(() => PostWhereUniqueInputSchema),
  data: z.union([ z.lazy(() => PostUpdateWithoutAuthorInputSchema),z.lazy(() => PostUncheckedUpdateWithoutAuthorInputSchema) ]),
}).strict();

export const PostUpdateManyWithWhereWithoutAuthorInputSchema: z.ZodType<Prisma.PostUpdateManyWithWhereWithoutAuthorInput> = z.object({
  where: z.lazy(() => PostScalarWhereInputSchema),
  data: z.union([ z.lazy(() => PostUpdateManyMutationInputSchema),z.lazy(() => PostUncheckedUpdateManyWithoutPostsInputSchema) ]),
}).strict();

export const PostScalarWhereInputSchema: z.ZodType<Prisma.PostScalarWhereInput> = z.object({
  AND: z.union([ z.lazy(() => PostScalarWhereInputSchema),z.lazy(() => PostScalarWhereInputSchema).array() ]).optional(),
  OR: z.lazy(() => PostScalarWhereInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => PostScalarWhereInputSchema),z.lazy(() => PostScalarWhereInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => IntFilterSchema),z.number() ]).optional(),
  title: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  contents: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  nbr: z.union([ z.lazy(() => IntNullableFilterSchema),z.number() ]).optional().nullable(),
  authorId: z.union([ z.lazy(() => IntFilterSchema),z.number() ]).optional(),
}).strict();

export const ProfileUpsertWithoutUserInputSchema: z.ZodType<Prisma.ProfileUpsertWithoutUserInput> = z.object({
  update: z.union([ z.lazy(() => ProfileUpdateWithoutUserInputSchema),z.lazy(() => ProfileUncheckedUpdateWithoutUserInputSchema) ]),
  create: z.union([ z.lazy(() => ProfileCreateWithoutUserInputSchema),z.lazy(() => ProfileUncheckedCreateWithoutUserInputSchema) ]),
}).strict();

export const ProfileUpdateWithoutUserInputSchema: z.ZodType<Prisma.ProfileUpdateWithoutUserInput> = z.object({
  id: z.union([ z.number(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  bio: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const ProfileUncheckedUpdateWithoutUserInputSchema: z.ZodType<Prisma.ProfileUncheckedUpdateWithoutUserInput> = z.object({
  id: z.union([ z.number(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  bio: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const UserCreateWithoutPostsInputSchema: z.ZodType<Prisma.UserCreateWithoutPostsInput> = z.object({
  id: z.number(),
  name: z.string().optional().nullable(),
  profile: z.lazy(() => ProfileCreateNestedOneWithoutUserInputSchema).optional()
}).strict();

export const UserUncheckedCreateWithoutPostsInputSchema: z.ZodType<Prisma.UserUncheckedCreateWithoutPostsInput> = z.object({
  id: z.number(),
  name: z.string().optional().nullable(),
  profile: z.lazy(() => ProfileUncheckedCreateNestedOneWithoutUserInputSchema).optional()
}).strict();

export const UserCreateOrConnectWithoutPostsInputSchema: z.ZodType<Prisma.UserCreateOrConnectWithoutPostsInput> = z.object({
  where: z.lazy(() => UserWhereUniqueInputSchema),
  create: z.union([ z.lazy(() => UserCreateWithoutPostsInputSchema),z.lazy(() => UserUncheckedCreateWithoutPostsInputSchema) ]),
}).strict();

export const UserUpsertWithoutPostsInputSchema: z.ZodType<Prisma.UserUpsertWithoutPostsInput> = z.object({
  update: z.union([ z.lazy(() => UserUpdateWithoutPostsInputSchema),z.lazy(() => UserUncheckedUpdateWithoutPostsInputSchema) ]),
  create: z.union([ z.lazy(() => UserCreateWithoutPostsInputSchema),z.lazy(() => UserUncheckedCreateWithoutPostsInputSchema) ]),
}).strict();

export const UserUpdateWithoutPostsInputSchema: z.ZodType<Prisma.UserUpdateWithoutPostsInput> = z.object({
  id: z.union([ z.number(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  name: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  profile: z.lazy(() => ProfileUpdateOneWithoutUserNestedInputSchema).optional()
}).strict();

export const UserUncheckedUpdateWithoutPostsInputSchema: z.ZodType<Prisma.UserUncheckedUpdateWithoutPostsInput> = z.object({
  id: z.union([ z.number(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  name: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  profile: z.lazy(() => ProfileUncheckedUpdateOneWithoutUserNestedInputSchema).optional()
}).strict();

export const UserCreateWithoutProfileInputSchema: z.ZodType<Prisma.UserCreateWithoutProfileInput> = z.object({
  id: z.number(),
  name: z.string().optional().nullable(),
  posts: z.lazy(() => PostCreateNestedManyWithoutAuthorInputSchema).optional()
}).strict();

export const UserUncheckedCreateWithoutProfileInputSchema: z.ZodType<Prisma.UserUncheckedCreateWithoutProfileInput> = z.object({
  id: z.number(),
  name: z.string().optional().nullable(),
  posts: z.lazy(() => PostUncheckedCreateNestedManyWithoutAuthorInputSchema).optional()
}).strict();

export const UserCreateOrConnectWithoutProfileInputSchema: z.ZodType<Prisma.UserCreateOrConnectWithoutProfileInput> = z.object({
  where: z.lazy(() => UserWhereUniqueInputSchema),
  create: z.union([ z.lazy(() => UserCreateWithoutProfileInputSchema),z.lazy(() => UserUncheckedCreateWithoutProfileInputSchema) ]),
}).strict();

export const UserUpsertWithoutProfileInputSchema: z.ZodType<Prisma.UserUpsertWithoutProfileInput> = z.object({
  update: z.union([ z.lazy(() => UserUpdateWithoutProfileInputSchema),z.lazy(() => UserUncheckedUpdateWithoutProfileInputSchema) ]),
  create: z.union([ z.lazy(() => UserCreateWithoutProfileInputSchema),z.lazy(() => UserUncheckedCreateWithoutProfileInputSchema) ]),
}).strict();

export const UserUpdateWithoutProfileInputSchema: z.ZodType<Prisma.UserUpdateWithoutProfileInput> = z.object({
  id: z.union([ z.number(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  name: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  posts: z.lazy(() => PostUpdateManyWithoutAuthorNestedInputSchema).optional()
}).strict();

export const UserUncheckedUpdateWithoutProfileInputSchema: z.ZodType<Prisma.UserUncheckedUpdateWithoutProfileInput> = z.object({
  id: z.union([ z.number(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  name: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  posts: z.lazy(() => PostUncheckedUpdateManyWithoutAuthorNestedInputSchema).optional()
}).strict();

export const DummyCreateWithoutDatatypeInputSchema: z.ZodType<Prisma.DummyCreateWithoutDatatypeInput> = z.object({
  id: z.number(),
  timestamp: z.coerce.date().optional().nullable()
}).strict();

export const DummyUncheckedCreateWithoutDatatypeInputSchema: z.ZodType<Prisma.DummyUncheckedCreateWithoutDatatypeInput> = z.object({
  id: z.number(),
  timestamp: z.coerce.date().optional().nullable()
}).strict();

export const DummyCreateOrConnectWithoutDatatypeInputSchema: z.ZodType<Prisma.DummyCreateOrConnectWithoutDatatypeInput> = z.object({
  where: z.lazy(() => DummyWhereUniqueInputSchema),
  create: z.union([ z.lazy(() => DummyCreateWithoutDatatypeInputSchema),z.lazy(() => DummyUncheckedCreateWithoutDatatypeInputSchema) ]),
}).strict();

export const DummyUpsertWithoutDatatypeInputSchema: z.ZodType<Prisma.DummyUpsertWithoutDatatypeInput> = z.object({
  update: z.union([ z.lazy(() => DummyUpdateWithoutDatatypeInputSchema),z.lazy(() => DummyUncheckedUpdateWithoutDatatypeInputSchema) ]),
  create: z.union([ z.lazy(() => DummyCreateWithoutDatatypeInputSchema),z.lazy(() => DummyUncheckedCreateWithoutDatatypeInputSchema) ]),
}).strict();

export const DummyUpdateWithoutDatatypeInputSchema: z.ZodType<Prisma.DummyUpdateWithoutDatatypeInput> = z.object({
  id: z.union([ z.number(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
}).strict();

export const DummyUncheckedUpdateWithoutDatatypeInputSchema: z.ZodType<Prisma.DummyUncheckedUpdateWithoutDatatypeInput> = z.object({
  id: z.union([ z.number(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
}).strict();

export const DataTypesCreateWithoutRelatedInputSchema: z.ZodType<Prisma.DataTypesCreateWithoutRelatedInput> = z.object({
  id: z.number(),
  date: z.coerce.date().optional().nullable(),
  time: z.coerce.date().optional().nullable(),
  timetz: z.coerce.date().optional().nullable(),
  timestamp: z.coerce.date().optional().nullable(),
  timestamptz: z.coerce.date().optional().nullable()
}).strict();

export const DataTypesUncheckedCreateWithoutRelatedInputSchema: z.ZodType<Prisma.DataTypesUncheckedCreateWithoutRelatedInput> = z.object({
  id: z.number(),
  date: z.coerce.date().optional().nullable(),
  time: z.coerce.date().optional().nullable(),
  timetz: z.coerce.date().optional().nullable(),
  timestamp: z.coerce.date().optional().nullable(),
  timestamptz: z.coerce.date().optional().nullable()
}).strict();

export const DataTypesCreateOrConnectWithoutRelatedInputSchema: z.ZodType<Prisma.DataTypesCreateOrConnectWithoutRelatedInput> = z.object({
  where: z.lazy(() => DataTypesWhereUniqueInputSchema),
  create: z.union([ z.lazy(() => DataTypesCreateWithoutRelatedInputSchema),z.lazy(() => DataTypesUncheckedCreateWithoutRelatedInputSchema) ]),
}).strict();

export const DataTypesCreateManyRelatedInputEnvelopeSchema: z.ZodType<Prisma.DataTypesCreateManyRelatedInputEnvelope> = z.object({
  data: z.union([ z.lazy(() => DataTypesCreateManyRelatedInputSchema),z.lazy(() => DataTypesCreateManyRelatedInputSchema).array() ]),
  skipDuplicates: z.boolean().optional()
}).strict();

export const DataTypesUpsertWithWhereUniqueWithoutRelatedInputSchema: z.ZodType<Prisma.DataTypesUpsertWithWhereUniqueWithoutRelatedInput> = z.object({
  where: z.lazy(() => DataTypesWhereUniqueInputSchema),
  update: z.union([ z.lazy(() => DataTypesUpdateWithoutRelatedInputSchema),z.lazy(() => DataTypesUncheckedUpdateWithoutRelatedInputSchema) ]),
  create: z.union([ z.lazy(() => DataTypesCreateWithoutRelatedInputSchema),z.lazy(() => DataTypesUncheckedCreateWithoutRelatedInputSchema) ]),
}).strict();

export const DataTypesUpdateWithWhereUniqueWithoutRelatedInputSchema: z.ZodType<Prisma.DataTypesUpdateWithWhereUniqueWithoutRelatedInput> = z.object({
  where: z.lazy(() => DataTypesWhereUniqueInputSchema),
  data: z.union([ z.lazy(() => DataTypesUpdateWithoutRelatedInputSchema),z.lazy(() => DataTypesUncheckedUpdateWithoutRelatedInputSchema) ]),
}).strict();

export const DataTypesUpdateManyWithWhereWithoutRelatedInputSchema: z.ZodType<Prisma.DataTypesUpdateManyWithWhereWithoutRelatedInput> = z.object({
  where: z.lazy(() => DataTypesScalarWhereInputSchema),
  data: z.union([ z.lazy(() => DataTypesUpdateManyMutationInputSchema),z.lazy(() => DataTypesUncheckedUpdateManyWithoutDatatypeInputSchema) ]),
}).strict();

export const DataTypesScalarWhereInputSchema: z.ZodType<Prisma.DataTypesScalarWhereInput> = z.object({
  AND: z.union([ z.lazy(() => DataTypesScalarWhereInputSchema),z.lazy(() => DataTypesScalarWhereInputSchema).array() ]).optional(),
  OR: z.lazy(() => DataTypesScalarWhereInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => DataTypesScalarWhereInputSchema),z.lazy(() => DataTypesScalarWhereInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => IntFilterSchema),z.number() ]).optional(),
  date: z.union([ z.lazy(() => DateTimeNullableFilterSchema),z.coerce.date() ]).optional().nullable(),
  time: z.union([ z.lazy(() => DateTimeNullableFilterSchema),z.coerce.date() ]).optional().nullable(),
  timetz: z.union([ z.lazy(() => DateTimeNullableFilterSchema),z.coerce.date() ]).optional().nullable(),
  timestamp: z.union([ z.lazy(() => DateTimeNullableFilterSchema),z.coerce.date() ]).optional().nullable(),
  timestamptz: z.union([ z.lazy(() => DateTimeNullableFilterSchema),z.coerce.date() ]).optional().nullable(),
  relatedId: z.union([ z.lazy(() => IntNullableFilterSchema),z.number() ]).optional().nullable(),
}).strict();

export const PostCreateManyAuthorInputSchema: z.ZodType<Prisma.PostCreateManyAuthorInput> = z.object({
  id: z.number().int(),
  title: z.string(),
  contents: z.string(),
  nbr: z.number().int().optional().nullable()
}).strict();

export const PostUpdateWithoutAuthorInputSchema: z.ZodType<Prisma.PostUpdateWithoutAuthorInput> = z.object({
  id: z.union([ z.number(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  title: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  contents: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  nbr: z.union([ z.number(),z.lazy(() => NullableIntFieldUpdateOperationsInputSchema) ]).optional().nullable(),
}).strict();

export const PostUncheckedUpdateWithoutAuthorInputSchema: z.ZodType<Prisma.PostUncheckedUpdateWithoutAuthorInput> = z.object({
  id: z.union([ z.number(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  title: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  contents: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  nbr: z.union([ z.number(),z.lazy(() => NullableIntFieldUpdateOperationsInputSchema) ]).optional().nullable(),
}).strict();

export const PostUncheckedUpdateManyWithoutPostsInputSchema: z.ZodType<Prisma.PostUncheckedUpdateManyWithoutPostsInput> = z.object({
  id: z.union([ z.number().int(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  title: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  contents: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  nbr: z.union([ z.number().int(),z.lazy(() => NullableIntFieldUpdateOperationsInputSchema) ]).optional().nullable(),
}).strict();

export const DataTypesCreateManyRelatedInputSchema: z.ZodType<Prisma.DataTypesCreateManyRelatedInput> = z.object({
  id: z.number().int(),
  date: z.coerce.date().optional().nullable(),
  time: z.coerce.date().optional().nullable(),
  timetz: z.coerce.date().optional().nullable(),
  timestamp: z.coerce.date().optional().nullable(),
  timestamptz: z.coerce.date().optional().nullable()
}).strict();

export const DataTypesUpdateWithoutRelatedInputSchema: z.ZodType<Prisma.DataTypesUpdateWithoutRelatedInput> = z.object({
  id: z.union([ z.number(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  date: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  time: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  timetz: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  timestamptz: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
}).strict();

export const DataTypesUncheckedUpdateWithoutRelatedInputSchema: z.ZodType<Prisma.DataTypesUncheckedUpdateWithoutRelatedInput> = z.object({
  id: z.union([ z.number(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  date: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  time: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  timetz: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  timestamptz: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
}).strict();

export const DataTypesUncheckedUpdateManyWithoutDatatypeInputSchema: z.ZodType<Prisma.DataTypesUncheckedUpdateManyWithoutDatatypeInput> = z.object({
  id: z.union([ z.number().int(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  date: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  time: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  timetz: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  timestamptz: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
}).strict();

/////////////////////////////////////////
// ARGS
/////////////////////////////////////////

export const ItemsFindFirstArgsSchema: z.ZodType<Prisma.ItemsFindFirstArgs> = z.object({
  select: ItemsSelectSchema.optional(),
  where: ItemsWhereInputSchema.optional(),
  orderBy: z.union([ ItemsOrderByWithRelationInputSchema.array(),ItemsOrderByWithRelationInputSchema ]).optional(),
  cursor: ItemsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: ItemsScalarFieldEnumSchema.array().optional(),
}).strict()

export const ItemsFindFirstOrThrowArgsSchema: z.ZodType<Prisma.ItemsFindFirstOrThrowArgs> = z.object({
  select: ItemsSelectSchema.optional(),
  where: ItemsWhereInputSchema.optional(),
  orderBy: z.union([ ItemsOrderByWithRelationInputSchema.array(),ItemsOrderByWithRelationInputSchema ]).optional(),
  cursor: ItemsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: ItemsScalarFieldEnumSchema.array().optional(),
}).strict()

export const ItemsFindManyArgsSchema: z.ZodType<Prisma.ItemsFindManyArgs> = z.object({
  select: ItemsSelectSchema.optional(),
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
  where: ItemsWhereUniqueInputSchema,
}).strict()

export const ItemsFindUniqueOrThrowArgsSchema: z.ZodType<Prisma.ItemsFindUniqueOrThrowArgs> = z.object({
  select: ItemsSelectSchema.optional(),
  where: ItemsWhereUniqueInputSchema,
}).strict()

export const UserFindFirstArgsSchema: z.ZodType<Prisma.UserFindFirstArgs> = z.object({
  select: UserSelectSchema.optional(),
  include: UserIncludeSchema.optional(),
  where: UserWhereInputSchema.optional(),
  orderBy: z.union([ UserOrderByWithRelationInputSchema.array(),UserOrderByWithRelationInputSchema ]).optional(),
  cursor: UserWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: UserScalarFieldEnumSchema.array().optional(),
}).strict()

export const UserFindFirstOrThrowArgsSchema: z.ZodType<Prisma.UserFindFirstOrThrowArgs> = z.object({
  select: UserSelectSchema.optional(),
  include: UserIncludeSchema.optional(),
  where: UserWhereInputSchema.optional(),
  orderBy: z.union([ UserOrderByWithRelationInputSchema.array(),UserOrderByWithRelationInputSchema ]).optional(),
  cursor: UserWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: UserScalarFieldEnumSchema.array().optional(),
}).strict()

export const UserFindManyArgsSchema: z.ZodType<Prisma.UserFindManyArgs> = z.object({
  select: UserSelectSchema.optional(),
  include: UserIncludeSchema.optional(),
  where: UserWhereInputSchema.optional(),
  orderBy: z.union([ UserOrderByWithRelationInputSchema.array(),UserOrderByWithRelationInputSchema ]).optional(),
  cursor: UserWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: UserScalarFieldEnumSchema.array().optional(),
}).strict()

export const UserAggregateArgsSchema: z.ZodType<Prisma.UserAggregateArgs> = z.object({
  where: UserWhereInputSchema.optional(),
  orderBy: z.union([ UserOrderByWithRelationInputSchema.array(),UserOrderByWithRelationInputSchema ]).optional(),
  cursor: UserWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict()

export const UserGroupByArgsSchema: z.ZodType<Prisma.UserGroupByArgs> = z.object({
  where: UserWhereInputSchema.optional(),
  orderBy: z.union([ UserOrderByWithAggregationInputSchema.array(),UserOrderByWithAggregationInputSchema ]).optional(),
  by: UserScalarFieldEnumSchema.array(),
  having: UserScalarWhereWithAggregatesInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict()

export const UserFindUniqueArgsSchema: z.ZodType<Prisma.UserFindUniqueArgs> = z.object({
  select: UserSelectSchema.optional(),
  include: UserIncludeSchema.optional(),
  where: UserWhereUniqueInputSchema,
}).strict()

export const UserFindUniqueOrThrowArgsSchema: z.ZodType<Prisma.UserFindUniqueOrThrowArgs> = z.object({
  select: UserSelectSchema.optional(),
  include: UserIncludeSchema.optional(),
  where: UserWhereUniqueInputSchema,
}).strict()

export const PostFindFirstArgsSchema: z.ZodType<Prisma.PostFindFirstArgs> = z.object({
  select: PostSelectSchema.optional(),
  include: PostIncludeSchema.optional(),
  where: PostWhereInputSchema.optional(),
  orderBy: z.union([ PostOrderByWithRelationInputSchema.array(),PostOrderByWithRelationInputSchema ]).optional(),
  cursor: PostWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: PostScalarFieldEnumSchema.array().optional(),
}).strict()

export const PostFindFirstOrThrowArgsSchema: z.ZodType<Prisma.PostFindFirstOrThrowArgs> = z.object({
  select: PostSelectSchema.optional(),
  include: PostIncludeSchema.optional(),
  where: PostWhereInputSchema.optional(),
  orderBy: z.union([ PostOrderByWithRelationInputSchema.array(),PostOrderByWithRelationInputSchema ]).optional(),
  cursor: PostWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: PostScalarFieldEnumSchema.array().optional(),
}).strict()

export const PostFindManyArgsSchema: z.ZodType<Prisma.PostFindManyArgs> = z.object({
  select: PostSelectSchema.optional(),
  include: PostIncludeSchema.optional(),
  where: PostWhereInputSchema.optional(),
  orderBy: z.union([ PostOrderByWithRelationInputSchema.array(),PostOrderByWithRelationInputSchema ]).optional(),
  cursor: PostWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: PostScalarFieldEnumSchema.array().optional(),
}).strict()

export const PostAggregateArgsSchema: z.ZodType<Prisma.PostAggregateArgs> = z.object({
  where: PostWhereInputSchema.optional(),
  orderBy: z.union([ PostOrderByWithRelationInputSchema.array(),PostOrderByWithRelationInputSchema ]).optional(),
  cursor: PostWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict()

export const PostGroupByArgsSchema: z.ZodType<Prisma.PostGroupByArgs> = z.object({
  where: PostWhereInputSchema.optional(),
  orderBy: z.union([ PostOrderByWithAggregationInputSchema.array(),PostOrderByWithAggregationInputSchema ]).optional(),
  by: PostScalarFieldEnumSchema.array(),
  having: PostScalarWhereWithAggregatesInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict()

export const PostFindUniqueArgsSchema: z.ZodType<Prisma.PostFindUniqueArgs> = z.object({
  select: PostSelectSchema.optional(),
  include: PostIncludeSchema.optional(),
  where: PostWhereUniqueInputSchema,
}).strict()

export const PostFindUniqueOrThrowArgsSchema: z.ZodType<Prisma.PostFindUniqueOrThrowArgs> = z.object({
  select: PostSelectSchema.optional(),
  include: PostIncludeSchema.optional(),
  where: PostWhereUniqueInputSchema,
}).strict()

export const ProfileFindFirstArgsSchema: z.ZodType<Prisma.ProfileFindFirstArgs> = z.object({
  select: ProfileSelectSchema.optional(),
  include: ProfileIncludeSchema.optional(),
  where: ProfileWhereInputSchema.optional(),
  orderBy: z.union([ ProfileOrderByWithRelationInputSchema.array(),ProfileOrderByWithRelationInputSchema ]).optional(),
  cursor: ProfileWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: ProfileScalarFieldEnumSchema.array().optional(),
}).strict()

export const ProfileFindFirstOrThrowArgsSchema: z.ZodType<Prisma.ProfileFindFirstOrThrowArgs> = z.object({
  select: ProfileSelectSchema.optional(),
  include: ProfileIncludeSchema.optional(),
  where: ProfileWhereInputSchema.optional(),
  orderBy: z.union([ ProfileOrderByWithRelationInputSchema.array(),ProfileOrderByWithRelationInputSchema ]).optional(),
  cursor: ProfileWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: ProfileScalarFieldEnumSchema.array().optional(),
}).strict()

export const ProfileFindManyArgsSchema: z.ZodType<Prisma.ProfileFindManyArgs> = z.object({
  select: ProfileSelectSchema.optional(),
  include: ProfileIncludeSchema.optional(),
  where: ProfileWhereInputSchema.optional(),
  orderBy: z.union([ ProfileOrderByWithRelationInputSchema.array(),ProfileOrderByWithRelationInputSchema ]).optional(),
  cursor: ProfileWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: ProfileScalarFieldEnumSchema.array().optional(),
}).strict()

export const ProfileAggregateArgsSchema: z.ZodType<Prisma.ProfileAggregateArgs> = z.object({
  where: ProfileWhereInputSchema.optional(),
  orderBy: z.union([ ProfileOrderByWithRelationInputSchema.array(),ProfileOrderByWithRelationInputSchema ]).optional(),
  cursor: ProfileWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict()

export const ProfileGroupByArgsSchema: z.ZodType<Prisma.ProfileGroupByArgs> = z.object({
  where: ProfileWhereInputSchema.optional(),
  orderBy: z.union([ ProfileOrderByWithAggregationInputSchema.array(),ProfileOrderByWithAggregationInputSchema ]).optional(),
  by: ProfileScalarFieldEnumSchema.array(),
  having: ProfileScalarWhereWithAggregatesInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict()

export const ProfileFindUniqueArgsSchema: z.ZodType<Prisma.ProfileFindUniqueArgs> = z.object({
  select: ProfileSelectSchema.optional(),
  include: ProfileIncludeSchema.optional(),
  where: ProfileWhereUniqueInputSchema,
}).strict()

export const ProfileFindUniqueOrThrowArgsSchema: z.ZodType<Prisma.ProfileFindUniqueOrThrowArgs> = z.object({
  select: ProfileSelectSchema.optional(),
  include: ProfileIncludeSchema.optional(),
  where: ProfileWhereUniqueInputSchema,
}).strict()

export const DataTypesFindFirstArgsSchema: z.ZodType<Prisma.DataTypesFindFirstArgs> = z.object({
  select: DataTypesSelectSchema.optional(),
  include: DataTypesIncludeSchema.optional(),
  where: DataTypesWhereInputSchema.optional(),
  orderBy: z.union([ DataTypesOrderByWithRelationInputSchema.array(),DataTypesOrderByWithRelationInputSchema ]).optional(),
  cursor: DataTypesWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: DataTypesScalarFieldEnumSchema.array().optional(),
}).strict()

export const DataTypesFindFirstOrThrowArgsSchema: z.ZodType<Prisma.DataTypesFindFirstOrThrowArgs> = z.object({
  select: DataTypesSelectSchema.optional(),
  include: DataTypesIncludeSchema.optional(),
  where: DataTypesWhereInputSchema.optional(),
  orderBy: z.union([ DataTypesOrderByWithRelationInputSchema.array(),DataTypesOrderByWithRelationInputSchema ]).optional(),
  cursor: DataTypesWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: DataTypesScalarFieldEnumSchema.array().optional(),
}).strict()

export const DataTypesFindManyArgsSchema: z.ZodType<Prisma.DataTypesFindManyArgs> = z.object({
  select: DataTypesSelectSchema.optional(),
  include: DataTypesIncludeSchema.optional(),
  where: DataTypesWhereInputSchema.optional(),
  orderBy: z.union([ DataTypesOrderByWithRelationInputSchema.array(),DataTypesOrderByWithRelationInputSchema ]).optional(),
  cursor: DataTypesWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: DataTypesScalarFieldEnumSchema.array().optional(),
}).strict()

export const DataTypesAggregateArgsSchema: z.ZodType<Prisma.DataTypesAggregateArgs> = z.object({
  where: DataTypesWhereInputSchema.optional(),
  orderBy: z.union([ DataTypesOrderByWithRelationInputSchema.array(),DataTypesOrderByWithRelationInputSchema ]).optional(),
  cursor: DataTypesWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict()

export const DataTypesGroupByArgsSchema: z.ZodType<Prisma.DataTypesGroupByArgs> = z.object({
  where: DataTypesWhereInputSchema.optional(),
  orderBy: z.union([ DataTypesOrderByWithAggregationInputSchema.array(),DataTypesOrderByWithAggregationInputSchema ]).optional(),
  by: DataTypesScalarFieldEnumSchema.array(),
  having: DataTypesScalarWhereWithAggregatesInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict()

export const DataTypesFindUniqueArgsSchema: z.ZodType<Prisma.DataTypesFindUniqueArgs> = z.object({
  select: DataTypesSelectSchema.optional(),
  include: DataTypesIncludeSchema.optional(),
  where: DataTypesWhereUniqueInputSchema,
}).strict()

export const DataTypesFindUniqueOrThrowArgsSchema: z.ZodType<Prisma.DataTypesFindUniqueOrThrowArgs> = z.object({
  select: DataTypesSelectSchema.optional(),
  include: DataTypesIncludeSchema.optional(),
  where: DataTypesWhereUniqueInputSchema,
}).strict()

export const DummyFindFirstArgsSchema: z.ZodType<Prisma.DummyFindFirstArgs> = z.object({
  select: DummySelectSchema.optional(),
  include: DummyIncludeSchema.optional(),
  where: DummyWhereInputSchema.optional(),
  orderBy: z.union([ DummyOrderByWithRelationInputSchema.array(),DummyOrderByWithRelationInputSchema ]).optional(),
  cursor: DummyWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: DummyScalarFieldEnumSchema.array().optional(),
}).strict()

export const DummyFindFirstOrThrowArgsSchema: z.ZodType<Prisma.DummyFindFirstOrThrowArgs> = z.object({
  select: DummySelectSchema.optional(),
  include: DummyIncludeSchema.optional(),
  where: DummyWhereInputSchema.optional(),
  orderBy: z.union([ DummyOrderByWithRelationInputSchema.array(),DummyOrderByWithRelationInputSchema ]).optional(),
  cursor: DummyWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: DummyScalarFieldEnumSchema.array().optional(),
}).strict()

export const DummyFindManyArgsSchema: z.ZodType<Prisma.DummyFindManyArgs> = z.object({
  select: DummySelectSchema.optional(),
  include: DummyIncludeSchema.optional(),
  where: DummyWhereInputSchema.optional(),
  orderBy: z.union([ DummyOrderByWithRelationInputSchema.array(),DummyOrderByWithRelationInputSchema ]).optional(),
  cursor: DummyWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: DummyScalarFieldEnumSchema.array().optional(),
}).strict()

export const DummyAggregateArgsSchema: z.ZodType<Prisma.DummyAggregateArgs> = z.object({
  where: DummyWhereInputSchema.optional(),
  orderBy: z.union([ DummyOrderByWithRelationInputSchema.array(),DummyOrderByWithRelationInputSchema ]).optional(),
  cursor: DummyWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict()

export const DummyGroupByArgsSchema: z.ZodType<Prisma.DummyGroupByArgs> = z.object({
  where: DummyWhereInputSchema.optional(),
  orderBy: z.union([ DummyOrderByWithAggregationInputSchema.array(),DummyOrderByWithAggregationInputSchema ]).optional(),
  by: DummyScalarFieldEnumSchema.array(),
  having: DummyScalarWhereWithAggregatesInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict()

export const DummyFindUniqueArgsSchema: z.ZodType<Prisma.DummyFindUniqueArgs> = z.object({
  select: DummySelectSchema.optional(),
  include: DummyIncludeSchema.optional(),
  where: DummyWhereUniqueInputSchema,
}).strict()

export const DummyFindUniqueOrThrowArgsSchema: z.ZodType<Prisma.DummyFindUniqueOrThrowArgs> = z.object({
  select: DummySelectSchema.optional(),
  include: DummyIncludeSchema.optional(),
  where: DummyWhereUniqueInputSchema,
}).strict()

export const ItemsCreateArgsSchema: z.ZodType<Prisma.ItemsCreateArgs> = z.object({
  select: ItemsSelectSchema.optional(),
  data: z.union([ ItemsCreateInputSchema,ItemsUncheckedCreateInputSchema ]),
}).strict()

export const ItemsUpsertArgsSchema: z.ZodType<Prisma.ItemsUpsertArgs> = z.object({
  select: ItemsSelectSchema.optional(),
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
  where: ItemsWhereUniqueInputSchema,
}).strict()

export const ItemsUpdateArgsSchema: z.ZodType<Prisma.ItemsUpdateArgs> = z.object({
  select: ItemsSelectSchema.optional(),
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

export const UserCreateArgsSchema: z.ZodType<Prisma.UserCreateArgs> = z.object({
  select: UserSelectSchema.optional(),
  include: UserIncludeSchema.optional(),
  data: z.union([ UserCreateInputSchema,UserUncheckedCreateInputSchema ]),
}).strict()

export const UserUpsertArgsSchema: z.ZodType<Prisma.UserUpsertArgs> = z.object({
  select: UserSelectSchema.optional(),
  include: UserIncludeSchema.optional(),
  where: UserWhereUniqueInputSchema,
  create: z.union([ UserCreateInputSchema,UserUncheckedCreateInputSchema ]),
  update: z.union([ UserUpdateInputSchema,UserUncheckedUpdateInputSchema ]),
}).strict()

export const UserCreateManyArgsSchema: z.ZodType<Prisma.UserCreateManyArgs> = z.object({
  data: z.union([ UserCreateManyInputSchema,UserCreateManyInputSchema.array() ]),
  skipDuplicates: z.boolean().optional(),
}).strict()

export const UserDeleteArgsSchema: z.ZodType<Prisma.UserDeleteArgs> = z.object({
  select: UserSelectSchema.optional(),
  include: UserIncludeSchema.optional(),
  where: UserWhereUniqueInputSchema,
}).strict()

export const UserUpdateArgsSchema: z.ZodType<Prisma.UserUpdateArgs> = z.object({
  select: UserSelectSchema.optional(),
  include: UserIncludeSchema.optional(),
  data: z.union([ UserUpdateInputSchema,UserUncheckedUpdateInputSchema ]),
  where: UserWhereUniqueInputSchema,
}).strict()

export const UserUpdateManyArgsSchema: z.ZodType<Prisma.UserUpdateManyArgs> = z.object({
  data: z.union([ UserUpdateManyMutationInputSchema,UserUncheckedUpdateManyInputSchema ]),
  where: UserWhereInputSchema.optional(),
}).strict()

export const UserDeleteManyArgsSchema: z.ZodType<Prisma.UserDeleteManyArgs> = z.object({
  where: UserWhereInputSchema.optional(),
}).strict()

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
export const PostCreateArgsSchema: z.ZodType<Prisma.PostCreateArgs> = z.object({
  select: PostSelectSchema.optional(),
  include: PostIncludeSchema.optional(),
  data: z.union([ PostCreateInputSchema,PostUncheckedCreateInputSchema ]),
}).strict()

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
export const PostUpsertArgsSchema: z.ZodType<Prisma.PostUpsertArgs> = z.object({
  select: PostSelectSchema.optional(),
  include: PostIncludeSchema.optional(),
  where: PostWhereUniqueInputSchema,
  create: z.union([ PostCreateInputSchema,PostUncheckedCreateInputSchema ]),
  update: z.union([ PostUpdateInputSchema,PostUncheckedUpdateInputSchema ]),
}).strict()

export const PostCreateManyArgsSchema: z.ZodType<Prisma.PostCreateManyArgs> = z.object({
  data: z.union([ PostCreateManyInputSchema,PostCreateManyInputSchema.array() ]),
  skipDuplicates: z.boolean().optional(),
}).strict()

export const PostDeleteArgsSchema: z.ZodType<Prisma.PostDeleteArgs> = z.object({
  select: PostSelectSchema.optional(),
  include: PostIncludeSchema.optional(),
  where: PostWhereUniqueInputSchema,
}).strict()

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
export const PostUpdateArgsSchema: z.ZodType<Prisma.PostUpdateArgs> = z.object({
  select: PostSelectSchema.optional(),
  include: PostIncludeSchema.optional(),
  data: z.union([ PostUpdateInputSchema,PostUncheckedUpdateInputSchema ]),
  where: PostWhereUniqueInputSchema,
}).strict()

export const PostUpdateManyArgsSchema: z.ZodType<Prisma.PostUpdateManyArgs> = z.object({
  data: z.union([ PostUpdateManyMutationInputSchema,PostUncheckedUpdateManyInputSchema ]),
  where: PostWhereInputSchema.optional(),
}).strict()

export const PostDeleteManyArgsSchema: z.ZodType<Prisma.PostDeleteManyArgs> = z.object({
  where: PostWhereInputSchema.optional(),
}).strict()

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
export const ProfileCreateArgsSchema: z.ZodType<Prisma.ProfileCreateArgs> = z.object({
  select: ProfileSelectSchema.optional(),
  include: ProfileIncludeSchema.optional(),
  data: z.union([ ProfileCreateInputSchema,ProfileUncheckedCreateInputSchema ]),
}).strict()

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
export const ProfileUpsertArgsSchema: z.ZodType<Prisma.ProfileUpsertArgs> = z.object({
  select: ProfileSelectSchema.optional(),
  include: ProfileIncludeSchema.optional(),
  where: ProfileWhereUniqueInputSchema,
  create: z.union([ ProfileCreateInputSchema,ProfileUncheckedCreateInputSchema ]),
  update: z.union([ ProfileUpdateInputSchema,ProfileUncheckedUpdateInputSchema ]),
}).strict()

export const ProfileCreateManyArgsSchema: z.ZodType<Prisma.ProfileCreateManyArgs> = z.object({
  data: z.union([ ProfileCreateManyInputSchema,ProfileCreateManyInputSchema.array() ]),
  skipDuplicates: z.boolean().optional(),
}).strict()

export const ProfileDeleteArgsSchema: z.ZodType<Prisma.ProfileDeleteArgs> = z.object({
  select: ProfileSelectSchema.optional(),
  include: ProfileIncludeSchema.optional(),
  where: ProfileWhereUniqueInputSchema,
}).strict()

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
export const ProfileUpdateArgsSchema: z.ZodType<Prisma.ProfileUpdateArgs> = z.object({
  select: ProfileSelectSchema.optional(),
  include: ProfileIncludeSchema.optional(),
  data: z.union([ ProfileUpdateInputSchema,ProfileUncheckedUpdateInputSchema ]),
  where: ProfileWhereUniqueInputSchema,
}).strict()

export const ProfileUpdateManyArgsSchema: z.ZodType<Prisma.ProfileUpdateManyArgs> = z.object({
  data: z.union([ ProfileUpdateManyMutationInputSchema,ProfileUncheckedUpdateManyInputSchema ]),
  where: ProfileWhereInputSchema.optional(),
}).strict()

export const ProfileDeleteManyArgsSchema: z.ZodType<Prisma.ProfileDeleteManyArgs> = z.object({
  where: ProfileWhereInputSchema.optional(),
}).strict()

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
export const DataTypesCreateArgsSchema: z.ZodType<Prisma.DataTypesCreateArgs> = z.object({
  select: DataTypesSelectSchema.optional(),
  include: DataTypesIncludeSchema.optional(),
  data: z.union([ DataTypesCreateInputSchema,DataTypesUncheckedCreateInputSchema ]),
}).strict()

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
export const DataTypesUpsertArgsSchema: z.ZodType<Prisma.DataTypesUpsertArgs> = z.object({
  select: DataTypesSelectSchema.optional(),
  include: DataTypesIncludeSchema.optional(),
  where: DataTypesWhereUniqueInputSchema,
  create: z.union([ DataTypesCreateInputSchema,DataTypesUncheckedCreateInputSchema ]),
  update: z.union([ DataTypesUpdateInputSchema,DataTypesUncheckedUpdateInputSchema ]),
}).strict()

export const DataTypesCreateManyArgsSchema: z.ZodType<Prisma.DataTypesCreateManyArgs> = z.object({
  data: z.union([ DataTypesCreateManyInputSchema,DataTypesCreateManyInputSchema.array() ]),
  skipDuplicates: z.boolean().optional(),
}).strict()

export const DataTypesDeleteArgsSchema: z.ZodType<Prisma.DataTypesDeleteArgs> = z.object({
  select: DataTypesSelectSchema.optional(),
  include: DataTypesIncludeSchema.optional(),
  where: DataTypesWhereUniqueInputSchema,
}).strict()

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
export const DataTypesUpdateArgsSchema: z.ZodType<Prisma.DataTypesUpdateArgs> = z.object({
  select: DataTypesSelectSchema.optional(),
  include: DataTypesIncludeSchema.optional(),
  data: z.union([ DataTypesUpdateInputSchema,DataTypesUncheckedUpdateInputSchema ]),
  where: DataTypesWhereUniqueInputSchema,
}).strict()

export const DataTypesUpdateManyArgsSchema: z.ZodType<Prisma.DataTypesUpdateManyArgs> = z.object({
  data: z.union([ DataTypesUpdateManyMutationInputSchema,DataTypesUncheckedUpdateManyInputSchema ]),
  where: DataTypesWhereInputSchema.optional(),
}).strict()

export const DataTypesDeleteManyArgsSchema: z.ZodType<Prisma.DataTypesDeleteManyArgs> = z.object({
  where: DataTypesWhereInputSchema.optional(),
}).strict()

export const DummyCreateArgsSchema: z.ZodType<Prisma.DummyCreateArgs> = z.object({
  select: DummySelectSchema.optional(),
  include: DummyIncludeSchema.optional(),
  data: z.union([ DummyCreateInputSchema,DummyUncheckedCreateInputSchema ]),
}).strict()

export const DummyUpsertArgsSchema: z.ZodType<Prisma.DummyUpsertArgs> = z.object({
  select: DummySelectSchema.optional(),
  include: DummyIncludeSchema.optional(),
  where: DummyWhereUniqueInputSchema,
  create: z.union([ DummyCreateInputSchema,DummyUncheckedCreateInputSchema ]),
  update: z.union([ DummyUpdateInputSchema,DummyUncheckedUpdateInputSchema ]),
}).strict()

export const DummyCreateManyArgsSchema: z.ZodType<Prisma.DummyCreateManyArgs> = z.object({
  data: z.union([ DummyCreateManyInputSchema,DummyCreateManyInputSchema.array() ]),
  skipDuplicates: z.boolean().optional(),
}).strict()

export const DummyDeleteArgsSchema: z.ZodType<Prisma.DummyDeleteArgs> = z.object({
  select: DummySelectSchema.optional(),
  include: DummyIncludeSchema.optional(),
  where: DummyWhereUniqueInputSchema,
}).strict()

export const DummyUpdateArgsSchema: z.ZodType<Prisma.DummyUpdateArgs> = z.object({
  select: DummySelectSchema.optional(),
  include: DummyIncludeSchema.optional(),
  data: z.union([ DummyUpdateInputSchema,DummyUncheckedUpdateInputSchema ]),
  where: DummyWhereUniqueInputSchema,
}).strict()

export const DummyUpdateManyArgsSchema: z.ZodType<Prisma.DummyUpdateManyArgs> = z.object({
  data: z.union([ DummyUpdateManyMutationInputSchema,DummyUncheckedUpdateManyInputSchema ]),
  where: DummyWhereInputSchema.optional(),
}).strict()

export const DummyDeleteManyArgsSchema: z.ZodType<Prisma.DummyDeleteManyArgs> = z.object({
  where: DummyWhereInputSchema.optional(),
}).strict()

interface ItemsGetPayload extends HKT {
  readonly _A?: boolean | null | undefined | Prisma.ItemsArgs
  readonly type: Prisma.ItemsGetPayload<this['_A']>
}

interface UserGetPayload extends HKT {
  readonly _A?: boolean | null | undefined | Prisma.UserArgs
  readonly type: Prisma.UserGetPayload<this['_A']>
}

interface PostGetPayload extends HKT {
  readonly _A?: boolean | null | undefined | Prisma.PostArgs
  readonly type: Prisma.PostGetPayload<this['_A']>
}

interface ProfileGetPayload extends HKT {
  readonly _A?: boolean | null | undefined | Prisma.ProfileArgs
  readonly type: Prisma.ProfileGetPayload<this['_A']>
}

interface DataTypesGetPayload extends HKT {
  readonly _A?: boolean | null | undefined | Prisma.DataTypesArgs
  readonly type: Prisma.DataTypesGetPayload<this['_A']>
}

interface DummyGetPayload extends HKT {
  readonly _A?: boolean | null | undefined | Prisma.DummyArgs
  readonly type: Prisma.DummyGetPayload<this['_A']>
}

export const tableSchemas = {
  Items: {
    fields: new Map([['value', 'TEXT'], ['nbr', 'INT4']]),
    relations: [
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
    never,
    Prisma.ItemsFindFirstArgs['orderBy'],
    Prisma.ItemsScalarFieldEnum,
    ItemsGetPayload
  >,
  User: {
    fields: new Map([['id', 'TEXT'], ['name', 'TEXT']]),
    relations: [
      new Relation("posts", "", "", "Post", "PostToUser", "many"),
      new Relation("profile", "", "", "Profile", "ProfileToUser", "one"),
    ],
    modelSchema: (UserCreateInputSchema as any)
      .partial()
      .or((UserUncheckedCreateInputSchema as any).partial()),
    createSchema: UserCreateArgsSchema,
    createManySchema: UserCreateManyArgsSchema,
    findUniqueSchema: UserFindUniqueArgsSchema,
    findSchema: UserFindFirstArgsSchema,
    updateSchema: UserUpdateArgsSchema,
    updateManySchema: UserUpdateManyArgsSchema,
    upsertSchema: UserUpsertArgsSchema,
    deleteSchema: UserDeleteArgsSchema,
    deleteManySchema: UserDeleteManyArgsSchema
  } as TableSchema<
    z.infer<typeof UserCreateInputSchema>,
    Prisma.UserCreateArgs['data'],
    Prisma.UserUpdateArgs['data'],
    Prisma.UserFindFirstArgs['select'],
    Prisma.UserFindFirstArgs['where'],
    Prisma.UserFindUniqueArgs['where'],
    Omit<Prisma.UserInclude, '_count'>,
    Prisma.UserFindFirstArgs['orderBy'],
    Prisma.UserScalarFieldEnum,
    UserGetPayload
  >,
  Post: {
    fields: new Map([
      ['id', 'TEXT'],
      ['title', 'TEXT'],
      ['contents', 'TEXT'],
      ['nbr', 'INT4'],
      ['authorId', 'TEXT']
    ]),
    relations: [
      new Relation("author", "authorId", "id", "User", "PostToUser", "one"),
    ],
    modelSchema: (PostCreateInputSchema as any)
      .partial()
      .or((PostUncheckedCreateInputSchema as any).partial()),
    createSchema: PostCreateArgsSchema,
    createManySchema: PostCreateManyArgsSchema,
    findUniqueSchema: PostFindUniqueArgsSchema,
    findSchema: PostFindFirstArgsSchema,
    updateSchema: PostUpdateArgsSchema,
    updateManySchema: PostUpdateManyArgsSchema,
    upsertSchema: PostUpsertArgsSchema,
    deleteSchema: PostDeleteArgsSchema,
    deleteManySchema: PostDeleteManyArgsSchema
  } as TableSchema<
    z.infer<typeof PostCreateInputSchema>,
    Prisma.PostCreateArgs['data'],
    Prisma.PostUpdateArgs['data'],
    Prisma.PostFindFirstArgs['select'],
    Prisma.PostFindFirstArgs['where'],
    Prisma.PostFindUniqueArgs['where'],
    Omit<Prisma.PostInclude, '_count'>,
    Prisma.PostFindFirstArgs['orderBy'],
    Prisma.PostScalarFieldEnum,
    PostGetPayload
  >,
  Profile: {
    fields: new Map([
      ['id', 'TEXT'],
      ['bio', 'TEXT'],
      ['userId', 'TEXT']
    ]),
    relations: [
      new Relation("user", "userId", "id", "User", "ProfileToUser", "one"),
    ],
    modelSchema: (ProfileCreateInputSchema as any)
      .partial()
      .or((ProfileUncheckedCreateInputSchema as any).partial()),
    createSchema: ProfileCreateArgsSchema,
    createManySchema: ProfileCreateManyArgsSchema,
    findUniqueSchema: ProfileFindUniqueArgsSchema,
    findSchema: ProfileFindFirstArgsSchema,
    updateSchema: ProfileUpdateArgsSchema,
    updateManySchema: ProfileUpdateManyArgsSchema,
    upsertSchema: ProfileUpsertArgsSchema,
    deleteSchema: ProfileDeleteArgsSchema,
    deleteManySchema: ProfileDeleteManyArgsSchema
  } as TableSchema<
    z.infer<typeof ProfileCreateInputSchema>,
    Prisma.ProfileCreateArgs['data'],
    Prisma.ProfileUpdateArgs['data'],
    Prisma.ProfileFindFirstArgs['select'],
    Prisma.ProfileFindFirstArgs['where'],
    Prisma.ProfileFindUniqueArgs['where'],
    Omit<Prisma.ProfileInclude, '_count'>,
    Prisma.ProfileFindFirstArgs['orderBy'],
    Prisma.ProfileScalarFieldEnum,
    ProfileGetPayload
  >,
  DataTypes: {
    fields: new Map([
      ['id', 'TEXT'],
      ['date', 'DATE'],
      ['time', 'TIME'],
      ['timetz', 'TIMETZ'],
      ['timestamp', 'TIMESTAMP'],
      ['timestamptz', 'TIMESTAMPTZ'],
      ['relatedId', 'INT4']
    ]),
    relations: [
      new Relation("related", "relatedId", "id", "Dummy", "DataTypesToDummy", "one"),
    ],
    modelSchema: (DataTypesCreateInputSchema as any)
      .partial()
      .or((DataTypesUncheckedCreateInputSchema as any).partial()),
    createSchema: DataTypesCreateArgsSchema,
    createManySchema: DataTypesCreateManyArgsSchema,
    findUniqueSchema: DataTypesFindUniqueArgsSchema,
    findSchema: DataTypesFindFirstArgsSchema,
    updateSchema: DataTypesUpdateArgsSchema,
    updateManySchema: DataTypesUpdateManyArgsSchema,
    upsertSchema: DataTypesUpsertArgsSchema,
    deleteSchema: DataTypesDeleteArgsSchema,
    deleteManySchema: DataTypesDeleteManyArgsSchema
  } as TableSchema<
    z.infer<typeof DataTypesCreateInputSchema>,
    Prisma.DataTypesCreateArgs['data'],
    Prisma.DataTypesUpdateArgs['data'],
    Prisma.DataTypesFindFirstArgs['select'],
    Prisma.DataTypesFindFirstArgs['where'],
    Prisma.DataTypesFindUniqueArgs['where'],
    Omit<Prisma.DataTypesInclude, '_count'>,
    Prisma.DataTypesFindFirstArgs['orderBy'],
    Prisma.DataTypesScalarFieldEnum,
    DataTypesGetPayload
  >,
  Dummy: {
    fields: new Map([["id", "INT4"], ["timestamp", "TIMESTAMP"]]),
    relations: [
      new Relation("datatype", "", "", "DataTypes", "DataTypesToDummy", "many"),
    ],
    modelSchema: (DummyCreateInputSchema as any)
    .partial()
    .or((DummyUncheckedCreateInputSchema as any).partial()),
    createSchema: DummyCreateArgsSchema,
    createManySchema: DummyCreateManyArgsSchema,
    findUniqueSchema: DummyFindUniqueArgsSchema,
    findSchema: DummyFindFirstArgsSchema,
    updateSchema: DummyUpdateArgsSchema,
    updateManySchema: DummyUpdateManyArgsSchema,
    upsertSchema: DummyUpsertArgsSchema,
    deleteSchema: DummyDeleteArgsSchema,
    deleteManySchema: DummyDeleteManyArgsSchema
  } as TableSchema<
  z.infer<typeof DummyCreateInputSchema>,
  Prisma.DummyCreateArgs['data'],
  Prisma.DummyUpdateArgs['data'],
  Prisma.DummyFindFirstArgs['select'],
  Prisma.DummyFindFirstArgs['where'],
  Prisma.DummyFindUniqueArgs['where'],
  Omit<Prisma.DummyInclude, '_count'>,
  Prisma.DummyFindFirstArgs['orderBy'],
  Prisma.DummyScalarFieldEnum,
  DummyGetPayload
  >,
}

export const schema = new DbSchema(tableSchemas, [])
export type Electric = ElectricClient<typeof schema>
