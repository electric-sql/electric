import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import {
  TableDescription,
  DBDescription,
  Relation,
} from '../../../src/client/model'

/////////////////////////////////////////
// HELPER FUNCTIONS
/////////////////////////////////////////

/////////////////////////////////////////
// ENUMS
/////////////////////////////////////////

export const ItemsScalarFieldEnumSchema = z.enum(['value', 'nbr'])

export const PostScalarFieldEnumSchema = z.enum([
  'id',
  'title',
  'contents',
  'nbr',
  'authorId',
])

export const QueryModeSchema = z.enum(['default', 'insensitive'])

export const SortOrderSchema = z.enum(['asc', 'desc'])

export const TransactionIsolationLevelSchema = z.enum([
  'ReadUncommitted',
  'ReadCommitted',
  'RepeatableRead',
  'Serializable',
])

export const UserScalarFieldEnumSchema = z.enum(['id', 'name'])
/////////////////////////////////////////
// MODELS
/////////////////////////////////////////

/////////////////////////////////////////
// ITEMS SCHEMA
/////////////////////////////////////////

export const itemsSchema = z.object({
  value: z.string(),
  nbr: z.number().int().nullish(),
})

export type items = z.infer<typeof itemsSchema>

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
// SELECT & INCLUDE
/////////////////////////////////////////

// ITEMS
//------------------------------------------------------

export const itemsSelectSchema: z.ZodType<Prisma.itemsSelect> = z
  .object({
    value: z.boolean().optional(),
    nbr: z.boolean().optional(),
  })
  .strict()

// USER
//------------------------------------------------------

export const UserIncludeSchema: z.ZodType<Prisma.UserInclude> = z
  .object({
    posts: z
      .union([z.boolean(), z.lazy(() => PostFindManyArgsSchema)])
      .optional(),
    _count: z
      .union([z.boolean(), z.lazy(() => UserCountOutputTypeArgsSchema)])
      .optional(),
  })
  .strict()

export const UserArgsSchema: z.ZodType<Prisma.UserArgs> = z
  .object({
    select: z.lazy(() => UserSelectSchema).optional(),
    include: z.lazy(() => UserIncludeSchema).optional(),
  })
  .strict()

export const UserCountOutputTypeArgsSchema: z.ZodType<Prisma.UserCountOutputTypeArgs> =
  z
    .object({
      select: z.lazy(() => UserCountOutputTypeSelectSchema).nullish(),
    })
    .strict()

export const UserCountOutputTypeSelectSchema: z.ZodType<Prisma.UserCountOutputTypeSelect> =
  z
    .object({
      posts: z.boolean().optional(),
    })
    .strict()

export const UserSelectSchema: z.ZodType<Prisma.UserSelect> = z
  .object({
    id: z.boolean().optional(),
    name: z.boolean().optional(),
    posts: z
      .union([z.boolean(), z.lazy(() => PostFindManyArgsSchema)])
      .optional(),
    _count: z
      .union([z.boolean(), z.lazy(() => UserCountOutputTypeArgsSchema)])
      .optional(),
  })
  .strict()

// POST
//------------------------------------------------------

export const PostIncludeSchema: z.ZodType<Prisma.PostInclude> = z
  .object({
    author: z.union([z.boolean(), z.lazy(() => UserArgsSchema)]).optional(),
  })
  .strict()

export const PostArgsSchema: z.ZodType<Prisma.PostArgs> = z
  .object({
    select: z.lazy(() => PostSelectSchema).optional(),
    include: z.lazy(() => PostIncludeSchema).optional(),
  })
  .strict()

export const PostSelectSchema: z.ZodType<Prisma.PostSelect> = z
  .object({
    id: z.boolean().optional(),
    title: z.boolean().optional(),
    contents: z.boolean().optional(),
    nbr: z.boolean().optional(),
    authorId: z.boolean().optional(),
    author: z.union([z.boolean(), z.lazy(() => UserArgsSchema)]).optional(),
  })
  .strict()

/////////////////////////////////////////
// INPUT TYPES
/////////////////////////////////////////

export const itemsWhereInputSchema: z.ZodType<Prisma.itemsWhereInput> = z
  .object({
    AND: z
      .union([
        z.lazy(() => itemsWhereInputSchema),
        z.lazy(() => itemsWhereInputSchema).array(),
      ])
      .optional(),
    OR: z
      .lazy(() => itemsWhereInputSchema)
      .array()
      .optional(),
    NOT: z
      .union([
        z.lazy(() => itemsWhereInputSchema),
        z.lazy(() => itemsWhereInputSchema).array(),
      ])
      .optional(),
    value: z.union([z.lazy(() => StringFilterSchema), z.string()]).optional(),
    nbr: z
      .union([z.lazy(() => IntNullableFilterSchema), z.number()])
      .optional()
      .nullable(),
  })
  .strict()

export const itemsOrderByWithRelationInputSchema: z.ZodType<Prisma.itemsOrderByWithRelationInput> =
  z
    .object({
      value: z.lazy(() => SortOrderSchema).optional(),
      nbr: z.lazy(() => SortOrderSchema).optional(),
    })
    .strict()

export const itemsWhereUniqueInputSchema: z.ZodType<Prisma.itemsWhereUniqueInput> =
  z
    .object({
      value: z.string().optional(),
    })
    .strict()

export const itemsOrderByWithAggregationInputSchema: z.ZodType<Prisma.itemsOrderByWithAggregationInput> =
  z
    .object({
      value: z.lazy(() => SortOrderSchema).optional(),
      nbr: z.lazy(() => SortOrderSchema).optional(),
      _count: z.lazy(() => itemsCountOrderByAggregateInputSchema).optional(),
      _avg: z.lazy(() => itemsAvgOrderByAggregateInputSchema).optional(),
      _max: z.lazy(() => itemsMaxOrderByAggregateInputSchema).optional(),
      _min: z.lazy(() => itemsMinOrderByAggregateInputSchema).optional(),
      _sum: z.lazy(() => itemsSumOrderByAggregateInputSchema).optional(),
    })
    .strict()

export const itemsScalarWhereWithAggregatesInputSchema: z.ZodType<Prisma.itemsScalarWhereWithAggregatesInput> =
  z
    .object({
      AND: z
        .union([
          z.lazy(() => itemsScalarWhereWithAggregatesInputSchema),
          z.lazy(() => itemsScalarWhereWithAggregatesInputSchema).array(),
        ])
        .optional(),
      OR: z
        .lazy(() => itemsScalarWhereWithAggregatesInputSchema)
        .array()
        .optional(),
      NOT: z
        .union([
          z.lazy(() => itemsScalarWhereWithAggregatesInputSchema),
          z.lazy(() => itemsScalarWhereWithAggregatesInputSchema).array(),
        ])
        .optional(),
      value: z
        .union([z.lazy(() => StringWithAggregatesFilterSchema), z.string()])
        .optional(),
      nbr: z
        .union([
          z.lazy(() => IntNullableWithAggregatesFilterSchema),
          z.number(),
        ])
        .optional()
        .nullable(),
    })
    .strict()

export const UserWhereInputSchema: z.ZodType<Prisma.UserWhereInput> = z
  .object({
    AND: z
      .union([
        z.lazy(() => UserWhereInputSchema),
        z.lazy(() => UserWhereInputSchema).array(),
      ])
      .optional(),
    OR: z
      .lazy(() => UserWhereInputSchema)
      .array()
      .optional(),
    NOT: z
      .union([
        z.lazy(() => UserWhereInputSchema),
        z.lazy(() => UserWhereInputSchema).array(),
      ])
      .optional(),
    id: z.union([z.lazy(() => IntFilterSchema), z.number()]).optional(),
    name: z
      .union([z.lazy(() => StringNullableFilterSchema), z.string()])
      .optional()
      .nullable(),
    posts: z.lazy(() => PostListRelationFilterSchema).optional(),
  })
  .strict()

export const UserOrderByWithRelationInputSchema: z.ZodType<Prisma.UserOrderByWithRelationInput> =
  z
    .object({
      id: z.lazy(() => SortOrderSchema).optional(),
      name: z.lazy(() => SortOrderSchema).optional(),
      posts: z.lazy(() => PostOrderByRelationAggregateInputSchema).optional(),
    })
    .strict()

export const UserWhereUniqueInputSchema: z.ZodType<Prisma.UserWhereUniqueInput> =
  z
    .object({
      id: z.number().int().optional(),
    })
    .strict()

export const UserOrderByWithAggregationInputSchema: z.ZodType<Prisma.UserOrderByWithAggregationInput> =
  z
    .object({
      id: z.lazy(() => SortOrderSchema).optional(),
      name: z.lazy(() => SortOrderSchema).optional(),
      _count: z.lazy(() => UserCountOrderByAggregateInputSchema).optional(),
      _avg: z.lazy(() => UserAvgOrderByAggregateInputSchema).optional(),
      _max: z.lazy(() => UserMaxOrderByAggregateInputSchema).optional(),
      _min: z.lazy(() => UserMinOrderByAggregateInputSchema).optional(),
      _sum: z.lazy(() => UserSumOrderByAggregateInputSchema).optional(),
    })
    .strict()

export const UserScalarWhereWithAggregatesInputSchema: z.ZodType<Prisma.UserScalarWhereWithAggregatesInput> =
  z
    .object({
      AND: z
        .union([
          z.lazy(() => UserScalarWhereWithAggregatesInputSchema),
          z.lazy(() => UserScalarWhereWithAggregatesInputSchema).array(),
        ])
        .optional(),
      OR: z
        .lazy(() => UserScalarWhereWithAggregatesInputSchema)
        .array()
        .optional(),
      NOT: z
        .union([
          z.lazy(() => UserScalarWhereWithAggregatesInputSchema),
          z.lazy(() => UserScalarWhereWithAggregatesInputSchema).array(),
        ])
        .optional(),
      id: z
        .union([z.lazy(() => IntWithAggregatesFilterSchema), z.number()])
        .optional(),
      name: z
        .union([
          z.lazy(() => StringNullableWithAggregatesFilterSchema),
          z.string(),
        ])
        .optional()
        .nullable(),
    })
    .strict()

export const PostWhereInputSchema: z.ZodType<Prisma.PostWhereInput> = z
  .object({
    AND: z
      .union([
        z.lazy(() => PostWhereInputSchema),
        z.lazy(() => PostWhereInputSchema).array(),
      ])
      .optional(),
    OR: z
      .lazy(() => PostWhereInputSchema)
      .array()
      .optional(),
    NOT: z
      .union([
        z.lazy(() => PostWhereInputSchema),
        z.lazy(() => PostWhereInputSchema).array(),
      ])
      .optional(),
    id: z.union([z.lazy(() => IntFilterSchema), z.number()]).optional(),
    title: z.union([z.lazy(() => StringFilterSchema), z.string()]).optional(),
    contents: z
      .union([z.lazy(() => StringFilterSchema), z.string()])
      .optional(),
    nbr: z
      .union([z.lazy(() => IntNullableFilterSchema), z.number()])
      .optional()
      .nullable(),
    authorId: z.union([z.lazy(() => IntFilterSchema), z.number()]).optional(),
    author: z
      .union([
        z.lazy(() => UserRelationFilterSchema),
        z.lazy(() => UserWhereInputSchema),
      ])
      .optional()
      .nullable(),
  })
  .strict()

export const PostOrderByWithRelationInputSchema: z.ZodType<Prisma.PostOrderByWithRelationInput> =
  z
    .object({
      id: z.lazy(() => SortOrderSchema).optional(),
      title: z.lazy(() => SortOrderSchema).optional(),
      contents: z.lazy(() => SortOrderSchema).optional(),
      nbr: z.lazy(() => SortOrderSchema).optional(),
      authorId: z.lazy(() => SortOrderSchema).optional(),
      author: z.lazy(() => UserOrderByWithRelationInputSchema).optional(),
    })
    .strict()

export const PostWhereUniqueInputSchema: z.ZodType<Prisma.PostWhereUniqueInput> =
  z
    .object({
      id: z.number().int().optional(),
      title: z.string().optional(),
    })
    .strict()

export const PostOrderByWithAggregationInputSchema: z.ZodType<Prisma.PostOrderByWithAggregationInput> =
  z
    .object({
      id: z.lazy(() => SortOrderSchema).optional(),
      title: z.lazy(() => SortOrderSchema).optional(),
      contents: z.lazy(() => SortOrderSchema).optional(),
      nbr: z.lazy(() => SortOrderSchema).optional(),
      authorId: z.lazy(() => SortOrderSchema).optional(),
      _count: z.lazy(() => PostCountOrderByAggregateInputSchema).optional(),
      _avg: z.lazy(() => PostAvgOrderByAggregateInputSchema).optional(),
      _max: z.lazy(() => PostMaxOrderByAggregateInputSchema).optional(),
      _min: z.lazy(() => PostMinOrderByAggregateInputSchema).optional(),
      _sum: z.lazy(() => PostSumOrderByAggregateInputSchema).optional(),
    })
    .strict()

export const PostScalarWhereWithAggregatesInputSchema: z.ZodType<Prisma.PostScalarWhereWithAggregatesInput> =
  z
    .object({
      AND: z
        .union([
          z.lazy(() => PostScalarWhereWithAggregatesInputSchema),
          z.lazy(() => PostScalarWhereWithAggregatesInputSchema).array(),
        ])
        .optional(),
      OR: z
        .lazy(() => PostScalarWhereWithAggregatesInputSchema)
        .array()
        .optional(),
      NOT: z
        .union([
          z.lazy(() => PostScalarWhereWithAggregatesInputSchema),
          z.lazy(() => PostScalarWhereWithAggregatesInputSchema).array(),
        ])
        .optional(),
      id: z
        .union([z.lazy(() => IntWithAggregatesFilterSchema), z.number()])
        .optional(),
      title: z
        .union([z.lazy(() => StringWithAggregatesFilterSchema), z.string()])
        .optional(),
      contents: z
        .union([z.lazy(() => StringWithAggregatesFilterSchema), z.string()])
        .optional(),
      nbr: z
        .union([
          z.lazy(() => IntNullableWithAggregatesFilterSchema),
          z.number(),
        ])
        .optional()
        .nullable(),
      authorId: z
        .union([z.lazy(() => IntWithAggregatesFilterSchema), z.number()])
        .optional(),
    })
    .strict()

export const itemsCreateInputSchema: z.ZodType<Prisma.itemsCreateInput> = z
  .object({
    value: z.string(),
    nbr: z.number().int().optional().nullable(),
  })
  .strict()

export const itemsUncheckedCreateInputSchema: z.ZodType<Prisma.itemsUncheckedCreateInput> =
  z
    .object({
      value: z.string(),
      nbr: z.number().int().optional().nullable(),
    })
    .strict()

export const itemsUpdateInputSchema: z.ZodType<Prisma.itemsUpdateInput> = z
  .object({
    value: z
      .union([z.string(), z.lazy(() => StringFieldUpdateOperationsInputSchema)])
      .optional(),
    nbr: z
      .union([
        z.number().int(),
        z.lazy(() => NullableIntFieldUpdateOperationsInputSchema),
      ])
      .optional()
      .nullable(),
  })
  .strict()

export const itemsUncheckedUpdateInputSchema: z.ZodType<Prisma.itemsUncheckedUpdateInput> =
  z
    .object({
      value: z
        .union([
          z.string(),
          z.lazy(() => StringFieldUpdateOperationsInputSchema),
        ])
        .optional(),
      nbr: z
        .union([
          z.number().int(),
          z.lazy(() => NullableIntFieldUpdateOperationsInputSchema),
        ])
        .optional()
        .nullable(),
    })
    .strict()

export const itemsCreateManyInputSchema: z.ZodType<Prisma.itemsCreateManyInput> =
  z
    .object({
      value: z.string(),
      nbr: z.number().int().optional().nullable(),
    })
    .strict()

export const itemsUpdateManyMutationInputSchema: z.ZodType<Prisma.itemsUpdateManyMutationInput> =
  z
    .object({
      value: z
        .union([
          z.string(),
          z.lazy(() => StringFieldUpdateOperationsInputSchema),
        ])
        .optional(),
      nbr: z
        .union([
          z.number().int(),
          z.lazy(() => NullableIntFieldUpdateOperationsInputSchema),
        ])
        .optional()
        .nullable(),
    })
    .strict()

export const itemsUncheckedUpdateManyInputSchema: z.ZodType<Prisma.itemsUncheckedUpdateManyInput> =
  z
    .object({
      value: z
        .union([
          z.string(),
          z.lazy(() => StringFieldUpdateOperationsInputSchema),
        ])
        .optional(),
      nbr: z
        .union([
          z.number().int(),
          z.lazy(() => NullableIntFieldUpdateOperationsInputSchema),
        ])
        .optional()
        .nullable(),
    })
    .strict()

export const UserCreateInputSchema: z.ZodType<Prisma.UserCreateInput> = z
  .object({
    id: z.number().int(),
    name: z.string().optional().nullable(),
    posts: z
      .lazy(() => PostCreateNestedManyWithoutAuthorInputSchema)
      .optional(),
  })
  .strict()

export const UserUncheckedCreateInputSchema: z.ZodType<Prisma.UserUncheckedCreateInput> =
  z
    .object({
      id: z.number().int(),
      name: z.string().optional().nullable(),
      posts: z
        .lazy(() => PostUncheckedCreateNestedManyWithoutAuthorInputSchema)
        .optional(),
    })
    .strict()

export const UserUpdateInputSchema: z.ZodType<Prisma.UserUpdateInput> = z
  .object({
    id: z
      .union([
        z.number().int(),
        z.lazy(() => IntFieldUpdateOperationsInputSchema),
      ])
      .optional(),
    name: z
      .union([
        z.string(),
        z.lazy(() => NullableStringFieldUpdateOperationsInputSchema),
      ])
      .optional()
      .nullable(),
    posts: z
      .lazy(() => PostUpdateManyWithoutAuthorNestedInputSchema)
      .optional(),
  })
  .strict()

export const UserUncheckedUpdateInputSchema: z.ZodType<Prisma.UserUncheckedUpdateInput> =
  z
    .object({
      id: z
        .union([
          z.number().int(),
          z.lazy(() => IntFieldUpdateOperationsInputSchema),
        ])
        .optional(),
      name: z
        .union([
          z.string(),
          z.lazy(() => NullableStringFieldUpdateOperationsInputSchema),
        ])
        .optional()
        .nullable(),
      posts: z
        .lazy(() => PostUncheckedUpdateManyWithoutAuthorNestedInputSchema)
        .optional(),
    })
    .strict()

export const UserCreateManyInputSchema: z.ZodType<Prisma.UserCreateManyInput> =
  z
    .object({
      id: z.number().int(),
      name: z.string().optional().nullable(),
    })
    .strict()

export const UserUpdateManyMutationInputSchema: z.ZodType<Prisma.UserUpdateManyMutationInput> =
  z
    .object({
      id: z
        .union([
          z.number().int(),
          z.lazy(() => IntFieldUpdateOperationsInputSchema),
        ])
        .optional(),
      name: z
        .union([
          z.string(),
          z.lazy(() => NullableStringFieldUpdateOperationsInputSchema),
        ])
        .optional()
        .nullable(),
    })
    .strict()

export const UserUncheckedUpdateManyInputSchema: z.ZodType<Prisma.UserUncheckedUpdateManyInput> =
  z
    .object({
      id: z
        .union([
          z.number().int(),
          z.lazy(() => IntFieldUpdateOperationsInputSchema),
        ])
        .optional(),
      name: z
        .union([
          z.string(),
          z.lazy(() => NullableStringFieldUpdateOperationsInputSchema),
        ])
        .optional()
        .nullable(),
    })
    .strict()

export const PostCreateInputSchema: z.ZodType<Prisma.PostCreateInput> = z
  .object({
    id: z.number().int(),
    title: z.string(),
    contents: z.string(),
    nbr: z.number().int().optional().nullable(),
    author: z.lazy(() => UserCreateNestedOneWithoutPostsInputSchema).optional(),
  })
  .strict()

export const PostUncheckedCreateInputSchema: z.ZodType<Prisma.PostUncheckedCreateInput> =
  z
    .object({
      id: z.number().int(),
      title: z.string(),
      contents: z.string(),
      nbr: z.number().int().optional().nullable(),
      authorId: z.number().int(),
    })
    .strict()

export const PostUpdateInputSchema: z.ZodType<Prisma.PostUpdateInput> = z
  .object({
    id: z
      .union([
        z.number().int(),
        z.lazy(() => IntFieldUpdateOperationsInputSchema),
      ])
      .optional(),
    title: z
      .union([z.string(), z.lazy(() => StringFieldUpdateOperationsInputSchema)])
      .optional(),
    contents: z
      .union([z.string(), z.lazy(() => StringFieldUpdateOperationsInputSchema)])
      .optional(),
    nbr: z
      .union([
        z.number().int(),
        z.lazy(() => NullableIntFieldUpdateOperationsInputSchema),
      ])
      .optional()
      .nullable(),
    author: z.lazy(() => UserUpdateOneWithoutPostsNestedInputSchema).optional(),
  })
  .strict()

export const PostUncheckedUpdateInputSchema: z.ZodType<Prisma.PostUncheckedUpdateInput> =
  z
    .object({
      id: z
        .union([
          z.number().int(),
          z.lazy(() => IntFieldUpdateOperationsInputSchema),
        ])
        .optional(),
      title: z
        .union([
          z.string(),
          z.lazy(() => StringFieldUpdateOperationsInputSchema),
        ])
        .optional(),
      contents: z
        .union([
          z.string(),
          z.lazy(() => StringFieldUpdateOperationsInputSchema),
        ])
        .optional(),
      nbr: z
        .union([
          z.number().int(),
          z.lazy(() => NullableIntFieldUpdateOperationsInputSchema),
        ])
        .optional()
        .nullable(),
      authorId: z
        .union([
          z.number().int(),
          z.lazy(() => IntFieldUpdateOperationsInputSchema),
        ])
        .optional(),
    })
    .strict()

export const PostCreateManyInputSchema: z.ZodType<Prisma.PostCreateManyInput> =
  z
    .object({
      id: z.number().int(),
      title: z.string(),
      contents: z.string(),
      nbr: z.number().int().optional().nullable(),
      authorId: z.number().int(),
    })
    .strict()

export const PostUpdateManyMutationInputSchema: z.ZodType<Prisma.PostUpdateManyMutationInput> =
  z
    .object({
      id: z
        .union([
          z.number().int(),
          z.lazy(() => IntFieldUpdateOperationsInputSchema),
        ])
        .optional(),
      title: z
        .union([
          z.string(),
          z.lazy(() => StringFieldUpdateOperationsInputSchema),
        ])
        .optional(),
      contents: z
        .union([
          z.string(),
          z.lazy(() => StringFieldUpdateOperationsInputSchema),
        ])
        .optional(),
      nbr: z
        .union([
          z.number().int(),
          z.lazy(() => NullableIntFieldUpdateOperationsInputSchema),
        ])
        .optional()
        .nullable(),
    })
    .strict()

export const PostUncheckedUpdateManyInputSchema: z.ZodType<Prisma.PostUncheckedUpdateManyInput> =
  z
    .object({
      id: z
        .union([
          z.number().int(),
          z.lazy(() => IntFieldUpdateOperationsInputSchema),
        ])
        .optional(),
      title: z
        .union([
          z.string(),
          z.lazy(() => StringFieldUpdateOperationsInputSchema),
        ])
        .optional(),
      contents: z
        .union([
          z.string(),
          z.lazy(() => StringFieldUpdateOperationsInputSchema),
        ])
        .optional(),
      nbr: z
        .union([
          z.number().int(),
          z.lazy(() => NullableIntFieldUpdateOperationsInputSchema),
        ])
        .optional()
        .nullable(),
      authorId: z
        .union([
          z.number().int(),
          z.lazy(() => IntFieldUpdateOperationsInputSchema),
        ])
        .optional(),
    })
    .strict()

export const StringFilterSchema: z.ZodType<Prisma.StringFilter> = z
  .object({
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
    not: z
      .union([z.string(), z.lazy(() => NestedStringFilterSchema)])
      .optional(),
  })
  .strict()

export const IntNullableFilterSchema: z.ZodType<Prisma.IntNullableFilter> = z
  .object({
    equals: z.number().optional().nullable(),
    in: z.number().array().optional().nullable(),
    notIn: z.number().array().optional().nullable(),
    lt: z.number().optional(),
    lte: z.number().optional(),
    gt: z.number().optional(),
    gte: z.number().optional(),
    not: z
      .union([z.number(), z.lazy(() => NestedIntNullableFilterSchema)])
      .optional()
      .nullable(),
  })
  .strict()

export const itemsCountOrderByAggregateInputSchema: z.ZodType<Prisma.itemsCountOrderByAggregateInput> =
  z
    .object({
      value: z.lazy(() => SortOrderSchema).optional(),
      nbr: z.lazy(() => SortOrderSchema).optional(),
    })
    .strict()

export const itemsAvgOrderByAggregateInputSchema: z.ZodType<Prisma.itemsAvgOrderByAggregateInput> =
  z
    .object({
      nbr: z.lazy(() => SortOrderSchema).optional(),
    })
    .strict()

export const itemsMaxOrderByAggregateInputSchema: z.ZodType<Prisma.itemsMaxOrderByAggregateInput> =
  z
    .object({
      value: z.lazy(() => SortOrderSchema).optional(),
      nbr: z.lazy(() => SortOrderSchema).optional(),
    })
    .strict()

export const itemsMinOrderByAggregateInputSchema: z.ZodType<Prisma.itemsMinOrderByAggregateInput> =
  z
    .object({
      value: z.lazy(() => SortOrderSchema).optional(),
      nbr: z.lazy(() => SortOrderSchema).optional(),
    })
    .strict()

export const itemsSumOrderByAggregateInputSchema: z.ZodType<Prisma.itemsSumOrderByAggregateInput> =
  z
    .object({
      nbr: z.lazy(() => SortOrderSchema).optional(),
    })
    .strict()

export const StringWithAggregatesFilterSchema: z.ZodType<Prisma.StringWithAggregatesFilter> =
  z
    .object({
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
      not: z
        .union([
          z.string(),
          z.lazy(() => NestedStringWithAggregatesFilterSchema),
        ])
        .optional(),
      _count: z.lazy(() => NestedIntFilterSchema).optional(),
      _min: z.lazy(() => NestedStringFilterSchema).optional(),
      _max: z.lazy(() => NestedStringFilterSchema).optional(),
    })
    .strict()

export const IntNullableWithAggregatesFilterSchema: z.ZodType<Prisma.IntNullableWithAggregatesFilter> =
  z
    .object({
      equals: z.number().optional().nullable(),
      in: z.number().array().optional().nullable(),
      notIn: z.number().array().optional().nullable(),
      lt: z.number().optional(),
      lte: z.number().optional(),
      gt: z.number().optional(),
      gte: z.number().optional(),
      not: z
        .union([
          z.number(),
          z.lazy(() => NestedIntNullableWithAggregatesFilterSchema),
        ])
        .optional()
        .nullable(),
      _count: z.lazy(() => NestedIntNullableFilterSchema).optional(),
      _avg: z.lazy(() => NestedFloatNullableFilterSchema).optional(),
      _sum: z.lazy(() => NestedIntNullableFilterSchema).optional(),
      _min: z.lazy(() => NestedIntNullableFilterSchema).optional(),
      _max: z.lazy(() => NestedIntNullableFilterSchema).optional(),
    })
    .strict()

export const IntFilterSchema: z.ZodType<Prisma.IntFilter> = z
  .object({
    equals: z.number().optional(),
    in: z.number().array().optional(),
    notIn: z.number().array().optional(),
    lt: z.number().optional(),
    lte: z.number().optional(),
    gt: z.number().optional(),
    gte: z.number().optional(),
    not: z.union([z.number(), z.lazy(() => NestedIntFilterSchema)]).optional(),
  })
  .strict()

export const StringNullableFilterSchema: z.ZodType<Prisma.StringNullableFilter> =
  z
    .object({
      equals: z.string().optional().nullable(),
      in: z.string().array().optional().nullable(),
      notIn: z.string().array().optional().nullable(),
      lt: z.string().optional(),
      lte: z.string().optional(),
      gt: z.string().optional(),
      gte: z.string().optional(),
      contains: z.string().optional(),
      startsWith: z.string().optional(),
      endsWith: z.string().optional(),
      mode: z.lazy(() => QueryModeSchema).optional(),
      not: z
        .union([z.string(), z.lazy(() => NestedStringNullableFilterSchema)])
        .optional()
        .nullable(),
    })
    .strict()

export const PostListRelationFilterSchema: z.ZodType<Prisma.PostListRelationFilter> =
  z
    .object({
      every: z.lazy(() => PostWhereInputSchema).optional(),
      some: z.lazy(() => PostWhereInputSchema).optional(),
      none: z.lazy(() => PostWhereInputSchema).optional(),
    })
    .strict()

export const PostOrderByRelationAggregateInputSchema: z.ZodType<Prisma.PostOrderByRelationAggregateInput> =
  z
    .object({
      _count: z.lazy(() => SortOrderSchema).optional(),
    })
    .strict()

export const UserCountOrderByAggregateInputSchema: z.ZodType<Prisma.UserCountOrderByAggregateInput> =
  z
    .object({
      id: z.lazy(() => SortOrderSchema).optional(),
      name: z.lazy(() => SortOrderSchema).optional(),
    })
    .strict()

export const UserAvgOrderByAggregateInputSchema: z.ZodType<Prisma.UserAvgOrderByAggregateInput> =
  z
    .object({
      id: z.lazy(() => SortOrderSchema).optional(),
    })
    .strict()

export const UserMaxOrderByAggregateInputSchema: z.ZodType<Prisma.UserMaxOrderByAggregateInput> =
  z
    .object({
      id: z.lazy(() => SortOrderSchema).optional(),
      name: z.lazy(() => SortOrderSchema).optional(),
    })
    .strict()

export const UserMinOrderByAggregateInputSchema: z.ZodType<Prisma.UserMinOrderByAggregateInput> =
  z
    .object({
      id: z.lazy(() => SortOrderSchema).optional(),
      name: z.lazy(() => SortOrderSchema).optional(),
    })
    .strict()

export const UserSumOrderByAggregateInputSchema: z.ZodType<Prisma.UserSumOrderByAggregateInput> =
  z
    .object({
      id: z.lazy(() => SortOrderSchema).optional(),
    })
    .strict()

export const IntWithAggregatesFilterSchema: z.ZodType<Prisma.IntWithAggregatesFilter> =
  z
    .object({
      equals: z.number().optional(),
      in: z.number().array().optional(),
      notIn: z.number().array().optional(),
      lt: z.number().optional(),
      lte: z.number().optional(),
      gt: z.number().optional(),
      gte: z.number().optional(),
      not: z
        .union([z.number(), z.lazy(() => NestedIntWithAggregatesFilterSchema)])
        .optional(),
      _count: z.lazy(() => NestedIntFilterSchema).optional(),
      _avg: z.lazy(() => NestedFloatFilterSchema).optional(),
      _sum: z.lazy(() => NestedIntFilterSchema).optional(),
      _min: z.lazy(() => NestedIntFilterSchema).optional(),
      _max: z.lazy(() => NestedIntFilterSchema).optional(),
    })
    .strict()

export const StringNullableWithAggregatesFilterSchema: z.ZodType<Prisma.StringNullableWithAggregatesFilter> =
  z
    .object({
      equals: z.string().optional().nullable(),
      in: z.string().array().optional().nullable(),
      notIn: z.string().array().optional().nullable(),
      lt: z.string().optional(),
      lte: z.string().optional(),
      gt: z.string().optional(),
      gte: z.string().optional(),
      contains: z.string().optional(),
      startsWith: z.string().optional(),
      endsWith: z.string().optional(),
      mode: z.lazy(() => QueryModeSchema).optional(),
      not: z
        .union([
          z.string(),
          z.lazy(() => NestedStringNullableWithAggregatesFilterSchema),
        ])
        .optional()
        .nullable(),
      _count: z.lazy(() => NestedIntNullableFilterSchema).optional(),
      _min: z.lazy(() => NestedStringNullableFilterSchema).optional(),
      _max: z.lazy(() => NestedStringNullableFilterSchema).optional(),
    })
    .strict()

export const UserRelationFilterSchema: z.ZodType<Prisma.UserRelationFilter> = z
  .object({
    is: z
      .lazy(() => UserWhereInputSchema)
      .optional()
      .nullable(),
    isNot: z
      .lazy(() => UserWhereInputSchema)
      .optional()
      .nullable(),
  })
  .strict()

export const PostCountOrderByAggregateInputSchema: z.ZodType<Prisma.PostCountOrderByAggregateInput> =
  z
    .object({
      id: z.lazy(() => SortOrderSchema).optional(),
      title: z.lazy(() => SortOrderSchema).optional(),
      contents: z.lazy(() => SortOrderSchema).optional(),
      nbr: z.lazy(() => SortOrderSchema).optional(),
      authorId: z.lazy(() => SortOrderSchema).optional(),
    })
    .strict()

export const PostAvgOrderByAggregateInputSchema: z.ZodType<Prisma.PostAvgOrderByAggregateInput> =
  z
    .object({
      id: z.lazy(() => SortOrderSchema).optional(),
      nbr: z.lazy(() => SortOrderSchema).optional(),
      authorId: z.lazy(() => SortOrderSchema).optional(),
    })
    .strict()

export const PostMaxOrderByAggregateInputSchema: z.ZodType<Prisma.PostMaxOrderByAggregateInput> =
  z
    .object({
      id: z.lazy(() => SortOrderSchema).optional(),
      title: z.lazy(() => SortOrderSchema).optional(),
      contents: z.lazy(() => SortOrderSchema).optional(),
      nbr: z.lazy(() => SortOrderSchema).optional(),
      authorId: z.lazy(() => SortOrderSchema).optional(),
    })
    .strict()

export const PostMinOrderByAggregateInputSchema: z.ZodType<Prisma.PostMinOrderByAggregateInput> =
  z
    .object({
      id: z.lazy(() => SortOrderSchema).optional(),
      title: z.lazy(() => SortOrderSchema).optional(),
      contents: z.lazy(() => SortOrderSchema).optional(),
      nbr: z.lazy(() => SortOrderSchema).optional(),
      authorId: z.lazy(() => SortOrderSchema).optional(),
    })
    .strict()

export const PostSumOrderByAggregateInputSchema: z.ZodType<Prisma.PostSumOrderByAggregateInput> =
  z
    .object({
      id: z.lazy(() => SortOrderSchema).optional(),
      nbr: z.lazy(() => SortOrderSchema).optional(),
      authorId: z.lazy(() => SortOrderSchema).optional(),
    })
    .strict()

export const StringFieldUpdateOperationsInputSchema: z.ZodType<Prisma.StringFieldUpdateOperationsInput> =
  z
    .object({
      set: z.string().optional(),
    })
    .strict()

export const NullableIntFieldUpdateOperationsInputSchema: z.ZodType<Prisma.NullableIntFieldUpdateOperationsInput> =
  z
    .object({
      set: z.number().optional().nullable(),
      increment: z.number().optional(),
      decrement: z.number().optional(),
      multiply: z.number().optional(),
      divide: z.number().optional(),
    })
    .strict()

export const PostCreateNestedManyWithoutAuthorInputSchema: z.ZodType<Prisma.PostCreateNestedManyWithoutAuthorInput> =
  z
    .object({
      create: z
        .union([
          z.lazy(() => PostCreateWithoutAuthorInputSchema),
          z.lazy(() => PostCreateWithoutAuthorInputSchema).array(),
          z.lazy(() => PostUncheckedCreateWithoutAuthorInputSchema),
          z.lazy(() => PostUncheckedCreateWithoutAuthorInputSchema).array(),
        ])
        .optional(),
      connectOrCreate: z
        .union([
          z.lazy(() => PostCreateOrConnectWithoutAuthorInputSchema),
          z.lazy(() => PostCreateOrConnectWithoutAuthorInputSchema).array(),
        ])
        .optional(),
      createMany: z
        .lazy(() => PostCreateManyAuthorInputEnvelopeSchema)
        .optional(),
      connect: z
        .union([
          z.lazy(() => PostWhereUniqueInputSchema),
          z.lazy(() => PostWhereUniqueInputSchema).array(),
        ])
        .optional(),
    })
    .strict()

export const PostUncheckedCreateNestedManyWithoutAuthorInputSchema: z.ZodType<Prisma.PostUncheckedCreateNestedManyWithoutAuthorInput> =
  z
    .object({
      create: z
        .union([
          z.lazy(() => PostCreateWithoutAuthorInputSchema),
          z.lazy(() => PostCreateWithoutAuthorInputSchema).array(),
          z.lazy(() => PostUncheckedCreateWithoutAuthorInputSchema),
          z.lazy(() => PostUncheckedCreateWithoutAuthorInputSchema).array(),
        ])
        .optional(),
      connectOrCreate: z
        .union([
          z.lazy(() => PostCreateOrConnectWithoutAuthorInputSchema),
          z.lazy(() => PostCreateOrConnectWithoutAuthorInputSchema).array(),
        ])
        .optional(),
      createMany: z
        .lazy(() => PostCreateManyAuthorInputEnvelopeSchema)
        .optional(),
      connect: z
        .union([
          z.lazy(() => PostWhereUniqueInputSchema),
          z.lazy(() => PostWhereUniqueInputSchema).array(),
        ])
        .optional(),
    })
    .strict()

export const IntFieldUpdateOperationsInputSchema: z.ZodType<Prisma.IntFieldUpdateOperationsInput> =
  z
    .object({
      set: z.number().optional(),
      increment: z.number().optional(),
      decrement: z.number().optional(),
      multiply: z.number().optional(),
      divide: z.number().optional(),
    })
    .strict()

export const NullableStringFieldUpdateOperationsInputSchema: z.ZodType<Prisma.NullableStringFieldUpdateOperationsInput> =
  z
    .object({
      set: z.string().optional().nullable(),
    })
    .strict()

export const PostUpdateManyWithoutAuthorNestedInputSchema: z.ZodType<Prisma.PostUpdateManyWithoutAuthorNestedInput> =
  z
    .object({
      create: z
        .union([
          z.lazy(() => PostCreateWithoutAuthorInputSchema),
          z.lazy(() => PostCreateWithoutAuthorInputSchema).array(),
          z.lazy(() => PostUncheckedCreateWithoutAuthorInputSchema),
          z.lazy(() => PostUncheckedCreateWithoutAuthorInputSchema).array(),
        ])
        .optional(),
      connectOrCreate: z
        .union([
          z.lazy(() => PostCreateOrConnectWithoutAuthorInputSchema),
          z.lazy(() => PostCreateOrConnectWithoutAuthorInputSchema).array(),
        ])
        .optional(),
      upsert: z
        .union([
          z.lazy(() => PostUpsertWithWhereUniqueWithoutAuthorInputSchema),
          z
            .lazy(() => PostUpsertWithWhereUniqueWithoutAuthorInputSchema)
            .array(),
        ])
        .optional(),
      createMany: z
        .lazy(() => PostCreateManyAuthorInputEnvelopeSchema)
        .optional(),
      set: z
        .union([
          z.lazy(() => PostWhereUniqueInputSchema),
          z.lazy(() => PostWhereUniqueInputSchema).array(),
        ])
        .optional(),
      disconnect: z
        .union([
          z.lazy(() => PostWhereUniqueInputSchema),
          z.lazy(() => PostWhereUniqueInputSchema).array(),
        ])
        .optional(),
      delete: z
        .union([
          z.lazy(() => PostWhereUniqueInputSchema),
          z.lazy(() => PostWhereUniqueInputSchema).array(),
        ])
        .optional(),
      connect: z
        .union([
          z.lazy(() => PostWhereUniqueInputSchema),
          z.lazy(() => PostWhereUniqueInputSchema).array(),
        ])
        .optional(),
      update: z
        .union([
          z.lazy(() => PostUpdateWithWhereUniqueWithoutAuthorInputSchema),
          z
            .lazy(() => PostUpdateWithWhereUniqueWithoutAuthorInputSchema)
            .array(),
        ])
        .optional(),
      updateMany: z
        .union([
          z.lazy(() => PostUpdateManyWithWhereWithoutAuthorInputSchema),
          z.lazy(() => PostUpdateManyWithWhereWithoutAuthorInputSchema).array(),
        ])
        .optional(),
      deleteMany: z
        .union([
          z.lazy(() => PostScalarWhereInputSchema),
          z.lazy(() => PostScalarWhereInputSchema).array(),
        ])
        .optional(),
    })
    .strict()

export const PostUncheckedUpdateManyWithoutAuthorNestedInputSchema: z.ZodType<Prisma.PostUncheckedUpdateManyWithoutAuthorNestedInput> =
  z
    .object({
      create: z
        .union([
          z.lazy(() => PostCreateWithoutAuthorInputSchema),
          z.lazy(() => PostCreateWithoutAuthorInputSchema).array(),
          z.lazy(() => PostUncheckedCreateWithoutAuthorInputSchema),
          z.lazy(() => PostUncheckedCreateWithoutAuthorInputSchema).array(),
        ])
        .optional(),
      connectOrCreate: z
        .union([
          z.lazy(() => PostCreateOrConnectWithoutAuthorInputSchema),
          z.lazy(() => PostCreateOrConnectWithoutAuthorInputSchema).array(),
        ])
        .optional(),
      upsert: z
        .union([
          z.lazy(() => PostUpsertWithWhereUniqueWithoutAuthorInputSchema),
          z
            .lazy(() => PostUpsertWithWhereUniqueWithoutAuthorInputSchema)
            .array(),
        ])
        .optional(),
      createMany: z
        .lazy(() => PostCreateManyAuthorInputEnvelopeSchema)
        .optional(),
      set: z
        .union([
          z.lazy(() => PostWhereUniqueInputSchema),
          z.lazy(() => PostWhereUniqueInputSchema).array(),
        ])
        .optional(),
      disconnect: z
        .union([
          z.lazy(() => PostWhereUniqueInputSchema),
          z.lazy(() => PostWhereUniqueInputSchema).array(),
        ])
        .optional(),
      delete: z
        .union([
          z.lazy(() => PostWhereUniqueInputSchema),
          z.lazy(() => PostWhereUniqueInputSchema).array(),
        ])
        .optional(),
      connect: z
        .union([
          z.lazy(() => PostWhereUniqueInputSchema),
          z.lazy(() => PostWhereUniqueInputSchema).array(),
        ])
        .optional(),
      update: z
        .union([
          z.lazy(() => PostUpdateWithWhereUniqueWithoutAuthorInputSchema),
          z
            .lazy(() => PostUpdateWithWhereUniqueWithoutAuthorInputSchema)
            .array(),
        ])
        .optional(),
      updateMany: z
        .union([
          z.lazy(() => PostUpdateManyWithWhereWithoutAuthorInputSchema),
          z.lazy(() => PostUpdateManyWithWhereWithoutAuthorInputSchema).array(),
        ])
        .optional(),
      deleteMany: z
        .union([
          z.lazy(() => PostScalarWhereInputSchema),
          z.lazy(() => PostScalarWhereInputSchema).array(),
        ])
        .optional(),
    })
    .strict()

export const UserCreateNestedOneWithoutPostsInputSchema: z.ZodType<Prisma.UserCreateNestedOneWithoutPostsInput> =
  z
    .object({
      create: z
        .union([
          z.lazy(() => UserCreateWithoutPostsInputSchema),
          z.lazy(() => UserUncheckedCreateWithoutPostsInputSchema),
        ])
        .optional(),
      connectOrCreate: z
        .lazy(() => UserCreateOrConnectWithoutPostsInputSchema)
        .optional(),
      connect: z.lazy(() => UserWhereUniqueInputSchema).optional(),
    })
    .strict()

export const UserUpdateOneWithoutPostsNestedInputSchema: z.ZodType<Prisma.UserUpdateOneWithoutPostsNestedInput> =
  z
    .object({
      create: z
        .union([
          z.lazy(() => UserCreateWithoutPostsInputSchema),
          z.lazy(() => UserUncheckedCreateWithoutPostsInputSchema),
        ])
        .optional(),
      connectOrCreate: z
        .lazy(() => UserCreateOrConnectWithoutPostsInputSchema)
        .optional(),
      upsert: z.lazy(() => UserUpsertWithoutPostsInputSchema).optional(),
      disconnect: z.boolean().optional(),
      delete: z.boolean().optional(),
      connect: z.lazy(() => UserWhereUniqueInputSchema).optional(),
      update: z
        .union([
          z.lazy(() => UserUpdateWithoutPostsInputSchema),
          z.lazy(() => UserUncheckedUpdateWithoutPostsInputSchema),
        ])
        .optional(),
    })
    .strict()

export const NestedStringFilterSchema: z.ZodType<Prisma.NestedStringFilter> = z
  .object({
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
    not: z
      .union([z.string(), z.lazy(() => NestedStringFilterSchema)])
      .optional(),
  })
  .strict()

export const NestedIntNullableFilterSchema: z.ZodType<Prisma.NestedIntNullableFilter> =
  z
    .object({
      equals: z.number().optional().nullable(),
      in: z.number().array().optional().nullable(),
      notIn: z.number().array().optional().nullable(),
      lt: z.number().optional(),
      lte: z.number().optional(),
      gt: z.number().optional(),
      gte: z.number().optional(),
      not: z
        .union([z.number(), z.lazy(() => NestedIntNullableFilterSchema)])
        .optional()
        .nullable(),
    })
    .strict()

export const NestedStringWithAggregatesFilterSchema: z.ZodType<Prisma.NestedStringWithAggregatesFilter> =
  z
    .object({
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
      not: z
        .union([
          z.string(),
          z.lazy(() => NestedStringWithAggregatesFilterSchema),
        ])
        .optional(),
      _count: z.lazy(() => NestedIntFilterSchema).optional(),
      _min: z.lazy(() => NestedStringFilterSchema).optional(),
      _max: z.lazy(() => NestedStringFilterSchema).optional(),
    })
    .strict()

export const NestedIntFilterSchema: z.ZodType<Prisma.NestedIntFilter> = z
  .object({
    equals: z.number().optional(),
    in: z.number().array().optional(),
    notIn: z.number().array().optional(),
    lt: z.number().optional(),
    lte: z.number().optional(),
    gt: z.number().optional(),
    gte: z.number().optional(),
    not: z.union([z.number(), z.lazy(() => NestedIntFilterSchema)]).optional(),
  })
  .strict()

export const NestedIntNullableWithAggregatesFilterSchema: z.ZodType<Prisma.NestedIntNullableWithAggregatesFilter> =
  z
    .object({
      equals: z.number().optional().nullable(),
      in: z.number().array().optional().nullable(),
      notIn: z.number().array().optional().nullable(),
      lt: z.number().optional(),
      lte: z.number().optional(),
      gt: z.number().optional(),
      gte: z.number().optional(),
      not: z
        .union([
          z.number(),
          z.lazy(() => NestedIntNullableWithAggregatesFilterSchema),
        ])
        .optional()
        .nullable(),
      _count: z.lazy(() => NestedIntNullableFilterSchema).optional(),
      _avg: z.lazy(() => NestedFloatNullableFilterSchema).optional(),
      _sum: z.lazy(() => NestedIntNullableFilterSchema).optional(),
      _min: z.lazy(() => NestedIntNullableFilterSchema).optional(),
      _max: z.lazy(() => NestedIntNullableFilterSchema).optional(),
    })
    .strict()

export const NestedFloatNullableFilterSchema: z.ZodType<Prisma.NestedFloatNullableFilter> =
  z
    .object({
      equals: z.number().optional().nullable(),
      in: z.number().array().optional().nullable(),
      notIn: z.number().array().optional().nullable(),
      lt: z.number().optional(),
      lte: z.number().optional(),
      gt: z.number().optional(),
      gte: z.number().optional(),
      not: z
        .union([z.number(), z.lazy(() => NestedFloatNullableFilterSchema)])
        .optional()
        .nullable(),
    })
    .strict()

export const NestedStringNullableFilterSchema: z.ZodType<Prisma.NestedStringNullableFilter> =
  z
    .object({
      equals: z.string().optional().nullable(),
      in: z.string().array().optional().nullable(),
      notIn: z.string().array().optional().nullable(),
      lt: z.string().optional(),
      lte: z.string().optional(),
      gt: z.string().optional(),
      gte: z.string().optional(),
      contains: z.string().optional(),
      startsWith: z.string().optional(),
      endsWith: z.string().optional(),
      not: z
        .union([z.string(), z.lazy(() => NestedStringNullableFilterSchema)])
        .optional()
        .nullable(),
    })
    .strict()

export const NestedIntWithAggregatesFilterSchema: z.ZodType<Prisma.NestedIntWithAggregatesFilter> =
  z
    .object({
      equals: z.number().optional(),
      in: z.number().array().optional(),
      notIn: z.number().array().optional(),
      lt: z.number().optional(),
      lte: z.number().optional(),
      gt: z.number().optional(),
      gte: z.number().optional(),
      not: z
        .union([z.number(), z.lazy(() => NestedIntWithAggregatesFilterSchema)])
        .optional(),
      _count: z.lazy(() => NestedIntFilterSchema).optional(),
      _avg: z.lazy(() => NestedFloatFilterSchema).optional(),
      _sum: z.lazy(() => NestedIntFilterSchema).optional(),
      _min: z.lazy(() => NestedIntFilterSchema).optional(),
      _max: z.lazy(() => NestedIntFilterSchema).optional(),
    })
    .strict()

export const NestedFloatFilterSchema: z.ZodType<Prisma.NestedFloatFilter> = z
  .object({
    equals: z.number().optional(),
    in: z.number().array().optional(),
    notIn: z.number().array().optional(),
    lt: z.number().optional(),
    lte: z.number().optional(),
    gt: z.number().optional(),
    gte: z.number().optional(),
    not: z
      .union([z.number(), z.lazy(() => NestedFloatFilterSchema)])
      .optional(),
  })
  .strict()

export const NestedStringNullableWithAggregatesFilterSchema: z.ZodType<Prisma.NestedStringNullableWithAggregatesFilter> =
  z
    .object({
      equals: z.string().optional().nullable(),
      in: z.string().array().optional().nullable(),
      notIn: z.string().array().optional().nullable(),
      lt: z.string().optional(),
      lte: z.string().optional(),
      gt: z.string().optional(),
      gte: z.string().optional(),
      contains: z.string().optional(),
      startsWith: z.string().optional(),
      endsWith: z.string().optional(),
      not: z
        .union([
          z.string(),
          z.lazy(() => NestedStringNullableWithAggregatesFilterSchema),
        ])
        .optional()
        .nullable(),
      _count: z.lazy(() => NestedIntNullableFilterSchema).optional(),
      _min: z.lazy(() => NestedStringNullableFilterSchema).optional(),
      _max: z.lazy(() => NestedStringNullableFilterSchema).optional(),
    })
    .strict()

export const PostCreateWithoutAuthorInputSchema: z.ZodType<Prisma.PostCreateWithoutAuthorInput> =
  z
    .object({
      id: z.number(),
      title: z.string(),
      contents: z.string(),
      nbr: z.number().optional().nullable(),
    })
    .strict()

export const PostUncheckedCreateWithoutAuthorInputSchema: z.ZodType<Prisma.PostUncheckedCreateWithoutAuthorInput> =
  z
    .object({
      id: z.number(),
      title: z.string(),
      contents: z.string(),
      nbr: z.number().optional().nullable(),
    })
    .strict()

export const PostCreateOrConnectWithoutAuthorInputSchema: z.ZodType<Prisma.PostCreateOrConnectWithoutAuthorInput> =
  z
    .object({
      where: z.lazy(() => PostWhereUniqueInputSchema),
      create: z.union([
        z.lazy(() => PostCreateWithoutAuthorInputSchema),
        z.lazy(() => PostUncheckedCreateWithoutAuthorInputSchema),
      ]),
    })
    .strict()

export const PostCreateManyAuthorInputEnvelopeSchema: z.ZodType<Prisma.PostCreateManyAuthorInputEnvelope> =
  z
    .object({
      data: z.union([
        z.lazy(() => PostCreateManyAuthorInputSchema),
        z.lazy(() => PostCreateManyAuthorInputSchema).array(),
      ]),
      skipDuplicates: z.boolean().optional(),
    })
    .strict()

export const PostUpsertWithWhereUniqueWithoutAuthorInputSchema: z.ZodType<Prisma.PostUpsertWithWhereUniqueWithoutAuthorInput> =
  z
    .object({
      where: z.lazy(() => PostWhereUniqueInputSchema),
      update: z.union([
        z.lazy(() => PostUpdateWithoutAuthorInputSchema),
        z.lazy(() => PostUncheckedUpdateWithoutAuthorInputSchema),
      ]),
      create: z.union([
        z.lazy(() => PostCreateWithoutAuthorInputSchema),
        z.lazy(() => PostUncheckedCreateWithoutAuthorInputSchema),
      ]),
    })
    .strict()

export const PostUpdateWithWhereUniqueWithoutAuthorInputSchema: z.ZodType<Prisma.PostUpdateWithWhereUniqueWithoutAuthorInput> =
  z
    .object({
      where: z.lazy(() => PostWhereUniqueInputSchema),
      data: z.union([
        z.lazy(() => PostUpdateWithoutAuthorInputSchema),
        z.lazy(() => PostUncheckedUpdateWithoutAuthorInputSchema),
      ]),
    })
    .strict()

export const PostUpdateManyWithWhereWithoutAuthorInputSchema: z.ZodType<Prisma.PostUpdateManyWithWhereWithoutAuthorInput> =
  z
    .object({
      where: z.lazy(() => PostScalarWhereInputSchema),
      data: z.union([
        z.lazy(() => PostUpdateManyMutationInputSchema),
        z.lazy(() => PostUncheckedUpdateManyWithoutPostsInputSchema),
      ]),
    })
    .strict()

export const PostScalarWhereInputSchema: z.ZodType<Prisma.PostScalarWhereInput> =
  z
    .object({
      AND: z
        .union([
          z.lazy(() => PostScalarWhereInputSchema),
          z.lazy(() => PostScalarWhereInputSchema).array(),
        ])
        .optional(),
      OR: z
        .lazy(() => PostScalarWhereInputSchema)
        .array()
        .optional(),
      NOT: z
        .union([
          z.lazy(() => PostScalarWhereInputSchema),
          z.lazy(() => PostScalarWhereInputSchema).array(),
        ])
        .optional(),
      id: z.union([z.lazy(() => IntFilterSchema), z.number()]).optional(),
      title: z.union([z.lazy(() => StringFilterSchema), z.string()]).optional(),
      contents: z
        .union([z.lazy(() => StringFilterSchema), z.string()])
        .optional(),
      nbr: z
        .union([z.lazy(() => IntNullableFilterSchema), z.number()])
        .optional()
        .nullable(),
      authorId: z.union([z.lazy(() => IntFilterSchema), z.number()]).optional(),
    })
    .strict()

export const UserCreateWithoutPostsInputSchema: z.ZodType<Prisma.UserCreateWithoutPostsInput> =
  z
    .object({
      id: z.number(),
      name: z.string().optional().nullable(),
    })
    .strict()

export const UserUncheckedCreateWithoutPostsInputSchema: z.ZodType<Prisma.UserUncheckedCreateWithoutPostsInput> =
  z
    .object({
      id: z.number(),
      name: z.string().optional().nullable(),
    })
    .strict()

export const UserCreateOrConnectWithoutPostsInputSchema: z.ZodType<Prisma.UserCreateOrConnectWithoutPostsInput> =
  z
    .object({
      where: z.lazy(() => UserWhereUniqueInputSchema),
      create: z.union([
        z.lazy(() => UserCreateWithoutPostsInputSchema),
        z.lazy(() => UserUncheckedCreateWithoutPostsInputSchema),
      ]),
    })
    .strict()

export const UserUpsertWithoutPostsInputSchema: z.ZodType<Prisma.UserUpsertWithoutPostsInput> =
  z
    .object({
      update: z.union([
        z.lazy(() => UserUpdateWithoutPostsInputSchema),
        z.lazy(() => UserUncheckedUpdateWithoutPostsInputSchema),
      ]),
      create: z.union([
        z.lazy(() => UserCreateWithoutPostsInputSchema),
        z.lazy(() => UserUncheckedCreateWithoutPostsInputSchema),
      ]),
    })
    .strict()

export const UserUpdateWithoutPostsInputSchema: z.ZodType<Prisma.UserUpdateWithoutPostsInput> =
  z
    .object({
      id: z
        .union([z.number(), z.lazy(() => IntFieldUpdateOperationsInputSchema)])
        .optional(),
      name: z
        .union([
          z.string(),
          z.lazy(() => NullableStringFieldUpdateOperationsInputSchema),
        ])
        .optional()
        .nullable(),
    })
    .strict()

export const UserUncheckedUpdateWithoutPostsInputSchema: z.ZodType<Prisma.UserUncheckedUpdateWithoutPostsInput> =
  z
    .object({
      id: z
        .union([z.number(), z.lazy(() => IntFieldUpdateOperationsInputSchema)])
        .optional(),
      name: z
        .union([
          z.string(),
          z.lazy(() => NullableStringFieldUpdateOperationsInputSchema),
        ])
        .optional()
        .nullable(),
    })
    .strict()

export const PostCreateManyAuthorInputSchema: z.ZodType<Prisma.PostCreateManyAuthorInput> =
  z
    .object({
      id: z.number().int(),
      title: z.string(),
      contents: z.string(),
      nbr: z.number().int().optional().nullable(),
    })
    .strict()

export const PostUpdateWithoutAuthorInputSchema: z.ZodType<Prisma.PostUpdateWithoutAuthorInput> =
  z
    .object({
      id: z
        .union([z.number(), z.lazy(() => IntFieldUpdateOperationsInputSchema)])
        .optional(),
      title: z
        .union([
          z.string(),
          z.lazy(() => StringFieldUpdateOperationsInputSchema),
        ])
        .optional(),
      contents: z
        .union([
          z.string(),
          z.lazy(() => StringFieldUpdateOperationsInputSchema),
        ])
        .optional(),
      nbr: z
        .union([
          z.number(),
          z.lazy(() => NullableIntFieldUpdateOperationsInputSchema),
        ])
        .optional()
        .nullable(),
    })
    .strict()

export const PostUncheckedUpdateWithoutAuthorInputSchema: z.ZodType<Prisma.PostUncheckedUpdateWithoutAuthorInput> =
  z
    .object({
      id: z
        .union([z.number(), z.lazy(() => IntFieldUpdateOperationsInputSchema)])
        .optional(),
      title: z
        .union([
          z.string(),
          z.lazy(() => StringFieldUpdateOperationsInputSchema),
        ])
        .optional(),
      contents: z
        .union([
          z.string(),
          z.lazy(() => StringFieldUpdateOperationsInputSchema),
        ])
        .optional(),
      nbr: z
        .union([
          z.number(),
          z.lazy(() => NullableIntFieldUpdateOperationsInputSchema),
        ])
        .optional()
        .nullable(),
    })
    .strict()

export const PostUncheckedUpdateManyWithoutPostsInputSchema: z.ZodType<Prisma.PostUncheckedUpdateManyWithoutPostsInput> =
  z
    .object({
      id: z
        .union([
          z.number().int(),
          z.lazy(() => IntFieldUpdateOperationsInputSchema),
        ])
        .optional(),
      title: z
        .union([
          z.string(),
          z.lazy(() => StringFieldUpdateOperationsInputSchema),
        ])
        .optional(),
      contents: z
        .union([
          z.string(),
          z.lazy(() => StringFieldUpdateOperationsInputSchema),
        ])
        .optional(),
      nbr: z
        .union([
          z.number().int(),
          z.lazy(() => NullableIntFieldUpdateOperationsInputSchema),
        ])
        .optional()
        .nullable(),
    })
    .strict()

/////////////////////////////////////////
// ARGS
/////////////////////////////////////////

export const itemsFindFirstArgsSchema: z.ZodType<Prisma.itemsFindFirstArgs> = z
  .object({
    select: itemsSelectSchema.optional(),
    where: itemsWhereInputSchema.optional(),
    orderBy: z
      .union([
        itemsOrderByWithRelationInputSchema.array(),
        itemsOrderByWithRelationInputSchema,
      ])
      .optional(),
    cursor: itemsWhereUniqueInputSchema.optional(),
    take: z.number().optional(),
    skip: z.number().optional(),
    distinct: ItemsScalarFieldEnumSchema.array().optional(),
  })
  .strict()

export const itemsFindFirstOrThrowArgsSchema: z.ZodType<Prisma.itemsFindFirstOrThrowArgs> =
  z
    .object({
      select: itemsSelectSchema.optional(),
      where: itemsWhereInputSchema.optional(),
      orderBy: z
        .union([
          itemsOrderByWithRelationInputSchema.array(),
          itemsOrderByWithRelationInputSchema,
        ])
        .optional(),
      cursor: itemsWhereUniqueInputSchema.optional(),
      take: z.number().optional(),
      skip: z.number().optional(),
      distinct: ItemsScalarFieldEnumSchema.array().optional(),
    })
    .strict()

export const itemsFindManyArgsSchema: z.ZodType<Prisma.itemsFindManyArgs> = z
  .object({
    select: itemsSelectSchema.optional(),
    where: itemsWhereInputSchema.optional(),
    orderBy: z
      .union([
        itemsOrderByWithRelationInputSchema.array(),
        itemsOrderByWithRelationInputSchema,
      ])
      .optional(),
    cursor: itemsWhereUniqueInputSchema.optional(),
    take: z.number().optional(),
    skip: z.number().optional(),
    distinct: ItemsScalarFieldEnumSchema.array().optional(),
  })
  .strict()

export const itemsAggregateArgsSchema: z.ZodType<Prisma.ItemsAggregateArgs> = z
  .object({
    where: itemsWhereInputSchema.optional(),
    orderBy: z
      .union([
        itemsOrderByWithRelationInputSchema.array(),
        itemsOrderByWithRelationInputSchema,
      ])
      .optional(),
    cursor: itemsWhereUniqueInputSchema.optional(),
    take: z.number().optional(),
    skip: z.number().optional(),
  })
  .strict()

export const itemsGroupByArgsSchema: z.ZodType<Prisma.ItemsGroupByArgs> = z
  .object({
    where: itemsWhereInputSchema.optional(),
    orderBy: z
      .union([
        itemsOrderByWithAggregationInputSchema.array(),
        itemsOrderByWithAggregationInputSchema,
      ])
      .optional(),
    by: ItemsScalarFieldEnumSchema.array(),
    having: itemsScalarWhereWithAggregatesInputSchema.optional(),
    take: z.number().optional(),
    skip: z.number().optional(),
  })
  .strict()

export const itemsFindUniqueArgsSchema: z.ZodType<Prisma.itemsFindUniqueArgs> =
  z
    .object({
      select: itemsSelectSchema.optional(),
      where: itemsWhereUniqueInputSchema,
    })
    .strict()

export const itemsFindUniqueOrThrowArgsSchema: z.ZodType<Prisma.itemsFindUniqueOrThrowArgs> =
  z
    .object({
      select: itemsSelectSchema.optional(),
      where: itemsWhereUniqueInputSchema,
    })
    .strict()

export const UserFindFirstArgsSchema: z.ZodType<Prisma.UserFindFirstArgs> = z
  .object({
    select: UserSelectSchema.optional(),
    include: UserIncludeSchema.optional(),
    where: UserWhereInputSchema.optional(),
    orderBy: z
      .union([
        UserOrderByWithRelationInputSchema.array(),
        UserOrderByWithRelationInputSchema,
      ])
      .optional(),
    cursor: UserWhereUniqueInputSchema.optional(),
    take: z.number().optional(),
    skip: z.number().optional(),
    distinct: UserScalarFieldEnumSchema.array().optional(),
  })
  .strict()

export const UserFindFirstOrThrowArgsSchema: z.ZodType<Prisma.UserFindFirstOrThrowArgs> =
  z
    .object({
      select: UserSelectSchema.optional(),
      include: UserIncludeSchema.optional(),
      where: UserWhereInputSchema.optional(),
      orderBy: z
        .union([
          UserOrderByWithRelationInputSchema.array(),
          UserOrderByWithRelationInputSchema,
        ])
        .optional(),
      cursor: UserWhereUniqueInputSchema.optional(),
      take: z.number().optional(),
      skip: z.number().optional(),
      distinct: UserScalarFieldEnumSchema.array().optional(),
    })
    .strict()

export const UserFindManyArgsSchema: z.ZodType<Prisma.UserFindManyArgs> = z
  .object({
    select: UserSelectSchema.optional(),
    include: UserIncludeSchema.optional(),
    where: UserWhereInputSchema.optional(),
    orderBy: z
      .union([
        UserOrderByWithRelationInputSchema.array(),
        UserOrderByWithRelationInputSchema,
      ])
      .optional(),
    cursor: UserWhereUniqueInputSchema.optional(),
    take: z.number().optional(),
    skip: z.number().optional(),
    distinct: UserScalarFieldEnumSchema.array().optional(),
  })
  .strict()

export const UserAggregateArgsSchema: z.ZodType<Prisma.UserAggregateArgs> = z
  .object({
    where: UserWhereInputSchema.optional(),
    orderBy: z
      .union([
        UserOrderByWithRelationInputSchema.array(),
        UserOrderByWithRelationInputSchema,
      ])
      .optional(),
    cursor: UserWhereUniqueInputSchema.optional(),
    take: z.number().optional(),
    skip: z.number().optional(),
  })
  .strict()

export const UserGroupByArgsSchema: z.ZodType<Prisma.UserGroupByArgs> = z
  .object({
    where: UserWhereInputSchema.optional(),
    orderBy: z
      .union([
        UserOrderByWithAggregationInputSchema.array(),
        UserOrderByWithAggregationInputSchema,
      ])
      .optional(),
    by: UserScalarFieldEnumSchema.array(),
    having: UserScalarWhereWithAggregatesInputSchema.optional(),
    take: z.number().optional(),
    skip: z.number().optional(),
  })
  .strict()

export const UserFindUniqueArgsSchema: z.ZodType<Prisma.UserFindUniqueArgs> = z
  .object({
    select: UserSelectSchema.optional(),
    include: UserIncludeSchema.optional(),
    where: UserWhereUniqueInputSchema,
  })
  .strict()

export const UserFindUniqueOrThrowArgsSchema: z.ZodType<Prisma.UserFindUniqueOrThrowArgs> =
  z
    .object({
      select: UserSelectSchema.optional(),
      include: UserIncludeSchema.optional(),
      where: UserWhereUniqueInputSchema,
    })
    .strict()

export const PostFindFirstArgsSchema: z.ZodType<Prisma.PostFindFirstArgs> = z
  .object({
    select: PostSelectSchema.optional(),
    include: PostIncludeSchema.optional(),
    where: PostWhereInputSchema.optional(),
    orderBy: z
      .union([
        PostOrderByWithRelationInputSchema.array(),
        PostOrderByWithRelationInputSchema,
      ])
      .optional(),
    cursor: PostWhereUniqueInputSchema.optional(),
    take: z.number().optional(),
    skip: z.number().optional(),
    distinct: PostScalarFieldEnumSchema.array().optional(),
  })
  .strict()

export const PostFindFirstOrThrowArgsSchema: z.ZodType<Prisma.PostFindFirstOrThrowArgs> =
  z
    .object({
      select: PostSelectSchema.optional(),
      include: PostIncludeSchema.optional(),
      where: PostWhereInputSchema.optional(),
      orderBy: z
        .union([
          PostOrderByWithRelationInputSchema.array(),
          PostOrderByWithRelationInputSchema,
        ])
        .optional(),
      cursor: PostWhereUniqueInputSchema.optional(),
      take: z.number().optional(),
      skip: z.number().optional(),
      distinct: PostScalarFieldEnumSchema.array().optional(),
    })
    .strict()

export const PostFindManyArgsSchema: z.ZodType<Prisma.PostFindManyArgs> = z
  .object({
    select: PostSelectSchema.optional(),
    include: PostIncludeSchema.optional(),
    where: PostWhereInputSchema.optional(),
    orderBy: z
      .union([
        PostOrderByWithRelationInputSchema.array(),
        PostOrderByWithRelationInputSchema,
      ])
      .optional(),
    cursor: PostWhereUniqueInputSchema.optional(),
    take: z.number().optional(),
    skip: z.number().optional(),
    distinct: PostScalarFieldEnumSchema.array().optional(),
  })
  .strict()

export const PostAggregateArgsSchema: z.ZodType<Prisma.PostAggregateArgs> = z
  .object({
    where: PostWhereInputSchema.optional(),
    orderBy: z
      .union([
        PostOrderByWithRelationInputSchema.array(),
        PostOrderByWithRelationInputSchema,
      ])
      .optional(),
    cursor: PostWhereUniqueInputSchema.optional(),
    take: z.number().optional(),
    skip: z.number().optional(),
  })
  .strict()

export const PostGroupByArgsSchema: z.ZodType<Prisma.PostGroupByArgs> = z
  .object({
    where: PostWhereInputSchema.optional(),
    orderBy: z
      .union([
        PostOrderByWithAggregationInputSchema.array(),
        PostOrderByWithAggregationInputSchema,
      ])
      .optional(),
    by: PostScalarFieldEnumSchema.array(),
    having: PostScalarWhereWithAggregatesInputSchema.optional(),
    take: z.number().optional(),
    skip: z.number().optional(),
  })
  .strict()

export const PostFindUniqueArgsSchema: z.ZodType<Prisma.PostFindUniqueArgs> = z
  .object({
    select: PostSelectSchema.optional(),
    include: PostIncludeSchema.optional(),
    where: PostWhereUniqueInputSchema,
  })
  .strict()

export const PostFindUniqueOrThrowArgsSchema: z.ZodType<Prisma.PostFindUniqueOrThrowArgs> =
  z
    .object({
      select: PostSelectSchema.optional(),
      include: PostIncludeSchema.optional(),
      where: PostWhereUniqueInputSchema,
    })
    .strict()

export const itemsCreateArgsSchema: z.ZodType<Prisma.itemsCreateArgs> = z
  .object({
    select: itemsSelectSchema.optional(),
    data: z.union([itemsCreateInputSchema, itemsUncheckedCreateInputSchema]),
  })
  .strict()

export const itemsUpsertArgsSchema: z.ZodType<Prisma.itemsUpsertArgs> = z
  .object({
    select: itemsSelectSchema.optional(),
    where: itemsWhereUniqueInputSchema,
    create: z.union([itemsCreateInputSchema, itemsUncheckedCreateInputSchema]),
    update: z.union([itemsUpdateInputSchema, itemsUncheckedUpdateInputSchema]),
  })
  .strict()

export const itemsCreateManyArgsSchema: z.ZodType<Prisma.itemsCreateManyArgs> =
  z
    .object({
      data: z.union([
        itemsCreateManyInputSchema,
        itemsCreateManyInputSchema.array(),
      ]),
      skipDuplicates: z.boolean().optional(),
    })
    .strict()

export const itemsDeleteArgsSchema: z.ZodType<Prisma.itemsDeleteArgs> = z
  .object({
    select: itemsSelectSchema.optional(),
    where: itemsWhereUniqueInputSchema,
  })
  .strict()

export const itemsUpdateArgsSchema: z.ZodType<Prisma.itemsUpdateArgs> = z
  .object({
    select: itemsSelectSchema.optional(),
    data: z.union([itemsUpdateInputSchema, itemsUncheckedUpdateInputSchema]),
    where: itemsWhereUniqueInputSchema,
  })
  .strict()

export const itemsUpdateManyArgsSchema: z.ZodType<Prisma.itemsUpdateManyArgs> =
  z
    .object({
      data: z.union([
        itemsUpdateManyMutationInputSchema,
        itemsUncheckedUpdateManyInputSchema,
      ]),
      where: itemsWhereInputSchema.optional(),
    })
    .strict()

export const itemsDeleteManyArgsSchema: z.ZodType<Prisma.itemsDeleteManyArgs> =
  z
    .object({
      where: itemsWhereInputSchema.optional(),
    })
    .strict()

export const UserCreateArgsSchema: z.ZodType<Prisma.UserCreateArgs> = z
  .object({
    select: UserSelectSchema.optional(),
    include: UserIncludeSchema.optional(),
    data: z.union([UserCreateInputSchema, UserUncheckedCreateInputSchema]),
  })
  .strict()

export const UserUpsertArgsSchema: z.ZodType<Prisma.UserUpsertArgs> = z
  .object({
    select: UserSelectSchema.optional(),
    include: UserIncludeSchema.optional(),
    where: UserWhereUniqueInputSchema,
    create: z.union([UserCreateInputSchema, UserUncheckedCreateInputSchema]),
    update: z.union([UserUpdateInputSchema, UserUncheckedUpdateInputSchema]),
  })
  .strict()

export const UserCreateManyArgsSchema: z.ZodType<Prisma.UserCreateManyArgs> = z
  .object({
    data: z.union([
      UserCreateManyInputSchema,
      UserCreateManyInputSchema.array(),
    ]),
    skipDuplicates: z.boolean().optional(),
  })
  .strict()

export const UserDeleteArgsSchema: z.ZodType<Prisma.UserDeleteArgs> = z
  .object({
    select: UserSelectSchema.optional(),
    include: UserIncludeSchema.optional(),
    where: UserWhereUniqueInputSchema,
  })
  .strict()

export const UserUpdateArgsSchema: z.ZodType<Prisma.UserUpdateArgs> = z
  .object({
    select: UserSelectSchema.optional(),
    include: UserIncludeSchema.optional(),
    data: z.union([UserUpdateInputSchema, UserUncheckedUpdateInputSchema]),
    where: UserWhereUniqueInputSchema,
  })
  .strict()

export const UserUpdateManyArgsSchema: z.ZodType<Prisma.UserUpdateManyArgs> = z
  .object({
    data: z.union([
      UserUpdateManyMutationInputSchema,
      UserUncheckedUpdateManyInputSchema,
    ]),
    where: UserWhereInputSchema.optional(),
  })
  .strict()

export const UserDeleteManyArgsSchema: z.ZodType<Prisma.UserDeleteManyArgs> = z
  .object({
    where: UserWhereInputSchema.optional(),
  })
  .strict()

export const PostCreateArgsSchema: z.ZodType<Prisma.PostCreateArgs> = z
  .object({
    select: PostSelectSchema.optional(),
    include: PostIncludeSchema.optional(),
    data: z.union([PostCreateInputSchema, PostUncheckedCreateInputSchema]),
  })
  .strict()

export const PostUpsertArgsSchema: z.ZodType<Prisma.PostUpsertArgs> = z
  .object({
    select: PostSelectSchema.optional(),
    include: PostIncludeSchema.optional(),
    where: PostWhereUniqueInputSchema,
    create: z.union([PostCreateInputSchema, PostUncheckedCreateInputSchema]),
    update: z.union([PostUpdateInputSchema, PostUncheckedUpdateInputSchema]),
  })
  .strict()

export const PostCreateManyArgsSchema: z.ZodType<Prisma.PostCreateManyArgs> = z
  .object({
    data: z.union([
      PostCreateManyInputSchema,
      PostCreateManyInputSchema.array(),
    ]),
    skipDuplicates: z.boolean().optional(),
  })
  .strict()

export const PostDeleteArgsSchema: z.ZodType<Prisma.PostDeleteArgs> = z
  .object({
    select: PostSelectSchema.optional(),
    include: PostIncludeSchema.optional(),
    where: PostWhereUniqueInputSchema,
  })
  .strict()

export const PostUpdateArgsSchema: z.ZodType<Prisma.PostUpdateArgs> = z
  .object({
    select: PostSelectSchema.optional(),
    include: PostIncludeSchema.optional(),
    data: z.union([PostUpdateInputSchema, PostUncheckedUpdateInputSchema]),
    where: PostWhereUniqueInputSchema,
  })
  .strict()

export const PostUpdateManyArgsSchema: z.ZodType<Prisma.PostUpdateManyArgs> = z
  .object({
    data: z.union([
      PostUpdateManyMutationInputSchema,
      PostUncheckedUpdateManyInputSchema,
    ]),
    where: PostWhereInputSchema.optional(),
  })
  .strict()

export const PostDeleteManyArgsSchema: z.ZodType<Prisma.PostDeleteManyArgs> = z
  .object({
    where: PostWhereInputSchema.optional(),
  })
  .strict()

declare module 'fp-ts/HKT' {
  interface URItoKind<
    A extends
      | Prisma.PostArgs
      | Prisma.UserArgs
      | Prisma.itemsArgs
      | boolean
      | null
      | undefined
  > {
    // (Record<string, any> & Prisma.itemsArgs) -> the record is needed because Prisma.itemsArgs only contains optional fields
    //                                             so an object only extends it if it provides one of those fields.
    //                                             but sometimes we do not provide those fields at all in which case it doesn't extend it
    //                                             therefore if we make it a record it will indeed extend that record
    //  { data: number } extends { foo?: number } ? true : false  -> is false
    //  { data: number } extends (Record<string, any> &{ foo?: number }) ? true : false  -> is true
    itemsGetPayload: A extends
      | boolean
      | null
      | undefined
      | (Record<string, any> & Prisma.itemsArgs)
      ? Prisma.itemsGetPayload<A>
      : never
    UserGetPayload: A extends
      | boolean
      | null
      | undefined
      | (Record<string, any> & Prisma.UserArgs)
      ? Prisma.UserGetPayload<A>
      : never
    PostGetPayload: A extends
      | boolean
      | null
      | undefined
      | (Record<string, any> & Prisma.PostArgs)
      ? Prisma.PostGetPayload<A>
      : never
  }
}

export const tableDescriptions = {
  items: {
    fields: ['value', 'nbr'],
    relations: [],
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
    deleteManySchema: itemsDeleteManyArgsSchema,
  } as TableDescription<
    z.infer<typeof itemsCreateInputSchema>,
    Prisma.itemsCreateArgs['data'],
    Prisma.itemsUpdateArgs['data'],
    Prisma.itemsFindFirstArgs['select'],
    Prisma.itemsFindFirstArgs['where'],
    Prisma.itemsFindUniqueArgs['where'],
    never,
    Prisma.itemsFindFirstArgs['orderBy'],
    Prisma.ItemsScalarFieldEnum,
    'itemsGetPayload'
  >,
  User: {
    fields: ['id', 'name'],
    relations: [new Relation('posts', '', '', 'Post', 'PostToUser', 'many')],
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
    deleteManySchema: UserDeleteManyArgsSchema,
  } as TableDescription<
    z.infer<typeof UserCreateInputSchema>,
    Prisma.UserCreateArgs['data'],
    Prisma.UserUpdateArgs['data'],
    Prisma.UserFindFirstArgs['select'],
    Prisma.UserFindFirstArgs['where'],
    Prisma.UserFindUniqueArgs['where'],
    Omit<Prisma.UserInclude, '_count'>,
    Prisma.UserFindFirstArgs['orderBy'],
    Prisma.UserScalarFieldEnum,
    'UserGetPayload'
  >,
  Post: {
    fields: ['id', 'title', 'contents', 'nbr', 'authorId'],
    relations: [
      new Relation('author', 'authorId', 'id', 'User', 'PostToUser', 'one'),
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
    deleteManySchema: PostDeleteManyArgsSchema,
  } as TableDescription<
    z.infer<typeof PostCreateInputSchema>,
    Prisma.PostCreateArgs['data'],
    Prisma.PostUpdateArgs['data'],
    Prisma.PostFindFirstArgs['select'],
    Prisma.PostFindFirstArgs['where'],
    Prisma.PostFindUniqueArgs['where'],
    Omit<Prisma.PostInclude, '_count'>,
    Prisma.PostFindFirstArgs['orderBy'],
    Prisma.PostScalarFieldEnum,
    'PostGetPayload'
  >,
}

export const dbDescription = new DBDescription(tableDescriptions)
