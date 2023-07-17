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

export const CommentScalarFieldEnumSchema = z.enum(['id','body','username','issue_id','created_at']);

export const IssueScalarFieldEnumSchema = z.enum(['id','title','description','priority','status','modified','created','kanbanorder','username']);

export const QueryModeSchema = z.enum(['default','insensitive']);

export const SortOrderSchema = z.enum(['asc','desc']);

export const TransactionIsolationLevelSchema = z.enum(['ReadUncommitted','ReadCommitted','RepeatableRead','Serializable']);

export const UserScalarFieldEnumSchema = z.enum(['username','avatar']);
/////////////////////////////////////////
// MODELS
/////////////////////////////////////////

/////////////////////////////////////////
// COMMENT SCHEMA
/////////////////////////////////////////

export const commentSchema = z.object({
  id: z.string(),
  body: z.string(),
  username: z.string(),
  issue_id: z.string(),
  created_at: z.string(),
})

export type comment = z.infer<typeof commentSchema>

/////////////////////////////////////////
// ISSUE SCHEMA
/////////////////////////////////////////

export const issueSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  priority: z.string(),
  status: z.string(),
  modified: z.string(),
  created: z.string(),
  kanbanorder: z.string(),
  username: z.string(),
})

export type issue = z.infer<typeof issueSchema>

/////////////////////////////////////////
// USER SCHEMA
/////////////////////////////////////////

export const userSchema = z.object({
  username: z.string(),
  avatar: z.string().nullable(),
})

export type user = z.infer<typeof userSchema>

/////////////////////////////////////////
// SELECT & INCLUDE
/////////////////////////////////////////

// COMMENT
//------------------------------------------------------

export const commentIncludeSchema: z.ZodType<Prisma.commentInclude> = z.object({
  user: z.union([z.boolean(),z.lazy(() => userArgsSchema)]).optional(),
  issue: z.union([z.boolean(),z.lazy(() => issueArgsSchema)]).optional(),
}).strict()

export const commentArgsSchema: z.ZodType<Prisma.commentArgs> = z.object({
  select: z.lazy(() => commentSelectSchema).optional(),
  include: z.lazy(() => commentIncludeSchema).optional(),
}).strict();

export const commentSelectSchema: z.ZodType<Prisma.commentSelect> = z.object({
  id: z.boolean().optional(),
  body: z.boolean().optional(),
  username: z.boolean().optional(),
  issue_id: z.boolean().optional(),
  created_at: z.boolean().optional(),
  user: z.union([z.boolean(),z.lazy(() => userArgsSchema)]).optional(),
  issue: z.union([z.boolean(),z.lazy(() => issueArgsSchema)]).optional(),
}).strict()

// ISSUE
//------------------------------------------------------

export const issueIncludeSchema: z.ZodType<Prisma.issueInclude> = z.object({
  comment: z.union([z.boolean(),z.lazy(() => commentFindManyArgsSchema)]).optional(),
  _count: z.union([z.boolean(),z.lazy(() => IssueCountOutputTypeArgsSchema)]).optional(),
}).strict()

export const issueArgsSchema: z.ZodType<Prisma.issueArgs> = z.object({
  select: z.lazy(() => issueSelectSchema).optional(),
  include: z.lazy(() => issueIncludeSchema).optional(),
}).strict();

export const issueCountOutputTypeArgsSchema: z.ZodType<Prisma.issueCountOutputTypeArgs> = z.object({
  select: z.lazy(() => issueCountOutputTypeSelectSchema).nullish(),
}).strict();

export const issueCountOutputTypeSelectSchema: z.ZodType<Prisma.issueCountOutputTypeSelect> = z.object({
  comment: z.boolean().optional(),
}).strict();

export const issueSelectSchema: z.ZodType<Prisma.issueSelect> = z.object({
  id: z.boolean().optional(),
  title: z.boolean().optional(),
  description: z.boolean().optional(),
  priority: z.boolean().optional(),
  status: z.boolean().optional(),
  modified: z.boolean().optional(),
  created: z.boolean().optional(),
  kanbanorder: z.boolean().optional(),
  username: z.boolean().optional(),
  comment: z.union([z.boolean(),z.lazy(() => commentFindManyArgsSchema)]).optional(),
  _count: z.union([z.boolean(),z.lazy(() => IssueCountOutputTypeArgsSchema)]).optional(),
}).strict()

// USER
//------------------------------------------------------

export const userIncludeSchema: z.ZodType<Prisma.userInclude> = z.object({
  comment: z.union([z.boolean(),z.lazy(() => commentFindManyArgsSchema)]).optional(),
  _count: z.union([z.boolean(),z.lazy(() => UserCountOutputTypeArgsSchema)]).optional(),
}).strict()

export const userArgsSchema: z.ZodType<Prisma.userArgs> = z.object({
  select: z.lazy(() => userSelectSchema).optional(),
  include: z.lazy(() => userIncludeSchema).optional(),
}).strict();

export const userCountOutputTypeArgsSchema: z.ZodType<Prisma.userCountOutputTypeArgs> = z.object({
  select: z.lazy(() => userCountOutputTypeSelectSchema).nullish(),
}).strict();

export const userCountOutputTypeSelectSchema: z.ZodType<Prisma.userCountOutputTypeSelect> = z.object({
  comment: z.boolean().optional(),
}).strict();

export const userSelectSchema: z.ZodType<Prisma.userSelect> = z.object({
  username: z.boolean().optional(),
  avatar: z.boolean().optional(),
  comment: z.union([z.boolean(),z.lazy(() => commentFindManyArgsSchema)]).optional(),
  _count: z.union([z.boolean(),z.lazy(() => UserCountOutputTypeArgsSchema)]).optional(),
}).strict()


/////////////////////////////////////////
// INPUT TYPES
/////////////////////////////////////////

export const commentWhereInputSchema: z.ZodType<Prisma.commentWhereInput> = z.object({
  AND: z.union([ z.lazy(() => commentWhereInputSchema),z.lazy(() => commentWhereInputSchema).array() ]).optional(),
  OR: z.lazy(() => commentWhereInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => commentWhereInputSchema),z.lazy(() => commentWhereInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  body: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  username: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  issue_id: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  created_at: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  user: z.union([ z.lazy(() => UserRelationFilterSchema),z.lazy(() => userWhereInputSchema) ]).optional(),
  issue: z.union([ z.lazy(() => IssueRelationFilterSchema),z.lazy(() => issueWhereInputSchema) ]).optional(),
}).strict();

export const commentOrderByWithRelationInputSchema: z.ZodType<Prisma.commentOrderByWithRelationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  body: z.lazy(() => SortOrderSchema).optional(),
  username: z.lazy(() => SortOrderSchema).optional(),
  issue_id: z.lazy(() => SortOrderSchema).optional(),
  created_at: z.lazy(() => SortOrderSchema).optional(),
  user: z.lazy(() => userOrderByWithRelationInputSchema).optional(),
  issue: z.lazy(() => issueOrderByWithRelationInputSchema).optional()
}).strict();

export const commentWhereUniqueInputSchema: z.ZodType<Prisma.commentWhereUniqueInput> = z.object({
  id: z.string().optional()
}).strict();

export const commentOrderByWithAggregationInputSchema: z.ZodType<Prisma.commentOrderByWithAggregationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  body: z.lazy(() => SortOrderSchema).optional(),
  username: z.lazy(() => SortOrderSchema).optional(),
  issue_id: z.lazy(() => SortOrderSchema).optional(),
  created_at: z.lazy(() => SortOrderSchema).optional(),
  _count: z.lazy(() => commentCountOrderByAggregateInputSchema).optional(),
  _max: z.lazy(() => commentMaxOrderByAggregateInputSchema).optional(),
  _min: z.lazy(() => commentMinOrderByAggregateInputSchema).optional()
}).strict();

export const commentScalarWhereWithAggregatesInputSchema: z.ZodType<Prisma.commentScalarWhereWithAggregatesInput> = z.object({
  AND: z.union([ z.lazy(() => commentScalarWhereWithAggregatesInputSchema),z.lazy(() => commentScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  OR: z.lazy(() => commentScalarWhereWithAggregatesInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => commentScalarWhereWithAggregatesInputSchema),z.lazy(() => commentScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  body: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  username: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  issue_id: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  created_at: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
}).strict();

export const issueWhereInputSchema: z.ZodType<Prisma.issueWhereInput> = z.object({
  AND: z.union([ z.lazy(() => issueWhereInputSchema),z.lazy(() => issueWhereInputSchema).array() ]).optional(),
  OR: z.lazy(() => issueWhereInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => issueWhereInputSchema),z.lazy(() => issueWhereInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  title: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  description: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  priority: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  status: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  modified: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  created: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  kanbanorder: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  username: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  comment: z.lazy(() => CommentListRelationFilterSchema).optional()
}).strict();

export const issueOrderByWithRelationInputSchema: z.ZodType<Prisma.issueOrderByWithRelationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  title: z.lazy(() => SortOrderSchema).optional(),
  description: z.lazy(() => SortOrderSchema).optional(),
  priority: z.lazy(() => SortOrderSchema).optional(),
  status: z.lazy(() => SortOrderSchema).optional(),
  modified: z.lazy(() => SortOrderSchema).optional(),
  created: z.lazy(() => SortOrderSchema).optional(),
  kanbanorder: z.lazy(() => SortOrderSchema).optional(),
  username: z.lazy(() => SortOrderSchema).optional(),
  comment: z.lazy(() => commentOrderByRelationAggregateInputSchema).optional()
}).strict();

export const issueWhereUniqueInputSchema: z.ZodType<Prisma.issueWhereUniqueInput> = z.object({
  id: z.string().optional()
}).strict();

export const issueOrderByWithAggregationInputSchema: z.ZodType<Prisma.issueOrderByWithAggregationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  title: z.lazy(() => SortOrderSchema).optional(),
  description: z.lazy(() => SortOrderSchema).optional(),
  priority: z.lazy(() => SortOrderSchema).optional(),
  status: z.lazy(() => SortOrderSchema).optional(),
  modified: z.lazy(() => SortOrderSchema).optional(),
  created: z.lazy(() => SortOrderSchema).optional(),
  kanbanorder: z.lazy(() => SortOrderSchema).optional(),
  username: z.lazy(() => SortOrderSchema).optional(),
  _count: z.lazy(() => issueCountOrderByAggregateInputSchema).optional(),
  _max: z.lazy(() => issueMaxOrderByAggregateInputSchema).optional(),
  _min: z.lazy(() => issueMinOrderByAggregateInputSchema).optional()
}).strict();

export const issueScalarWhereWithAggregatesInputSchema: z.ZodType<Prisma.issueScalarWhereWithAggregatesInput> = z.object({
  AND: z.union([ z.lazy(() => issueScalarWhereWithAggregatesInputSchema),z.lazy(() => issueScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  OR: z.lazy(() => issueScalarWhereWithAggregatesInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => issueScalarWhereWithAggregatesInputSchema),z.lazy(() => issueScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  title: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  description: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  priority: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  status: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  modified: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  created: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  kanbanorder: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  username: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
}).strict();

export const userWhereInputSchema: z.ZodType<Prisma.userWhereInput> = z.object({
  AND: z.union([ z.lazy(() => userWhereInputSchema),z.lazy(() => userWhereInputSchema).array() ]).optional(),
  OR: z.lazy(() => userWhereInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => userWhereInputSchema),z.lazy(() => userWhereInputSchema).array() ]).optional(),
  username: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  avatar: z.union([ z.lazy(() => StringNullableFilterSchema),z.string() ]).optional().nullable(),
  comment: z.lazy(() => CommentListRelationFilterSchema).optional()
}).strict();

export const userOrderByWithRelationInputSchema: z.ZodType<Prisma.userOrderByWithRelationInput> = z.object({
  username: z.lazy(() => SortOrderSchema).optional(),
  avatar: z.lazy(() => SortOrderSchema).optional(),
  comment: z.lazy(() => commentOrderByRelationAggregateInputSchema).optional()
}).strict();

export const userWhereUniqueInputSchema: z.ZodType<Prisma.userWhereUniqueInput> = z.object({
  username: z.string().optional()
}).strict();

export const userOrderByWithAggregationInputSchema: z.ZodType<Prisma.userOrderByWithAggregationInput> = z.object({
  username: z.lazy(() => SortOrderSchema).optional(),
  avatar: z.lazy(() => SortOrderSchema).optional(),
  _count: z.lazy(() => userCountOrderByAggregateInputSchema).optional(),
  _max: z.lazy(() => userMaxOrderByAggregateInputSchema).optional(),
  _min: z.lazy(() => userMinOrderByAggregateInputSchema).optional()
}).strict();

export const userScalarWhereWithAggregatesInputSchema: z.ZodType<Prisma.userScalarWhereWithAggregatesInput> = z.object({
  AND: z.union([ z.lazy(() => userScalarWhereWithAggregatesInputSchema),z.lazy(() => userScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  OR: z.lazy(() => userScalarWhereWithAggregatesInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => userScalarWhereWithAggregatesInputSchema),z.lazy(() => userScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  username: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  avatar: z.union([ z.lazy(() => StringNullableWithAggregatesFilterSchema),z.string() ]).optional().nullable(),
}).strict();

export const commentCreateInputSchema: z.ZodType<Prisma.commentCreateInput> = z.object({
  id: z.string(),
  body: z.string(),
  created_at: z.string(),
  user: z.lazy(() => userCreateNestedOneWithoutCommentInputSchema),
  issue: z.lazy(() => issueCreateNestedOneWithoutCommentInputSchema)
}).strict();

export const commentUncheckedCreateInputSchema: z.ZodType<Prisma.commentUncheckedCreateInput> = z.object({
  id: z.string(),
  body: z.string(),
  username: z.string(),
  issue_id: z.string(),
  created_at: z.string()
}).strict();

export const commentUpdateInputSchema: z.ZodType<Prisma.commentUpdateInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  body: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  created_at: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  user: z.lazy(() => userUpdateOneRequiredWithoutCommentNestedInputSchema).optional(),
  issue: z.lazy(() => issueUpdateOneRequiredWithoutCommentNestedInputSchema).optional()
}).strict();

export const commentUncheckedUpdateInputSchema: z.ZodType<Prisma.commentUncheckedUpdateInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  body: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  username: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  issue_id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  created_at: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const commentCreateManyInputSchema: z.ZodType<Prisma.commentCreateManyInput> = z.object({
  id: z.string(),
  body: z.string(),
  username: z.string(),
  issue_id: z.string(),
  created_at: z.string()
}).strict();

export const commentUpdateManyMutationInputSchema: z.ZodType<Prisma.commentUpdateManyMutationInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  body: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  created_at: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const commentUncheckedUpdateManyInputSchema: z.ZodType<Prisma.commentUncheckedUpdateManyInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  body: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  username: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  issue_id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  created_at: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const issueCreateInputSchema: z.ZodType<Prisma.issueCreateInput> = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  priority: z.string(),
  status: z.string(),
  modified: z.string(),
  created: z.string(),
  kanbanorder: z.string(),
  username: z.string(),
  comment: z.lazy(() => commentCreateNestedManyWithoutIssueInputSchema).optional()
}).strict();

export const issueUncheckedCreateInputSchema: z.ZodType<Prisma.issueUncheckedCreateInput> = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  priority: z.string(),
  status: z.string(),
  modified: z.string(),
  created: z.string(),
  kanbanorder: z.string(),
  username: z.string(),
  comment: z.lazy(() => commentUncheckedCreateNestedManyWithoutIssueInputSchema).optional()
}).strict();

export const issueUpdateInputSchema: z.ZodType<Prisma.issueUpdateInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  title: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  description: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  priority: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  status: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  modified: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  created: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  kanbanorder: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  username: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  comment: z.lazy(() => commentUpdateManyWithoutIssueNestedInputSchema).optional()
}).strict();

export const issueUncheckedUpdateInputSchema: z.ZodType<Prisma.issueUncheckedUpdateInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  title: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  description: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  priority: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  status: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  modified: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  created: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  kanbanorder: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  username: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  comment: z.lazy(() => commentUncheckedUpdateManyWithoutIssueNestedInputSchema).optional()
}).strict();

export const issueCreateManyInputSchema: z.ZodType<Prisma.issueCreateManyInput> = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  priority: z.string(),
  status: z.string(),
  modified: z.string(),
  created: z.string(),
  kanbanorder: z.string(),
  username: z.string()
}).strict();

export const issueUpdateManyMutationInputSchema: z.ZodType<Prisma.issueUpdateManyMutationInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  title: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  description: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  priority: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  status: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  modified: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  created: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  kanbanorder: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  username: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const issueUncheckedUpdateManyInputSchema: z.ZodType<Prisma.issueUncheckedUpdateManyInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  title: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  description: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  priority: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  status: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  modified: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  created: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  kanbanorder: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  username: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const userCreateInputSchema: z.ZodType<Prisma.userCreateInput> = z.object({
  username: z.string(),
  avatar: z.string().optional().nullable(),
  comment: z.lazy(() => commentCreateNestedManyWithoutUserInputSchema).optional()
}).strict();

export const userUncheckedCreateInputSchema: z.ZodType<Prisma.userUncheckedCreateInput> = z.object({
  username: z.string(),
  avatar: z.string().optional().nullable(),
  comment: z.lazy(() => commentUncheckedCreateNestedManyWithoutUserInputSchema).optional()
}).strict();

export const userUpdateInputSchema: z.ZodType<Prisma.userUpdateInput> = z.object({
  username: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  avatar: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  comment: z.lazy(() => commentUpdateManyWithoutUserNestedInputSchema).optional()
}).strict();

export const userUncheckedUpdateInputSchema: z.ZodType<Prisma.userUncheckedUpdateInput> = z.object({
  username: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  avatar: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  comment: z.lazy(() => commentUncheckedUpdateManyWithoutUserNestedInputSchema).optional()
}).strict();

export const userCreateManyInputSchema: z.ZodType<Prisma.userCreateManyInput> = z.object({
  username: z.string(),
  avatar: z.string().optional().nullable()
}).strict();

export const userUpdateManyMutationInputSchema: z.ZodType<Prisma.userUpdateManyMutationInput> = z.object({
  username: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  avatar: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
}).strict();

export const userUncheckedUpdateManyInputSchema: z.ZodType<Prisma.userUncheckedUpdateManyInput> = z.object({
  username: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  avatar: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
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

export const UserRelationFilterSchema: z.ZodType<Prisma.UserRelationFilter> = z.object({
  is: z.lazy(() => userWhereInputSchema).optional(),
  isNot: z.lazy(() => userWhereInputSchema).optional()
}).strict();

export const IssueRelationFilterSchema: z.ZodType<Prisma.IssueRelationFilter> = z.object({
  is: z.lazy(() => issueWhereInputSchema).optional(),
  isNot: z.lazy(() => issueWhereInputSchema).optional()
}).strict();

export const commentCountOrderByAggregateInputSchema: z.ZodType<Prisma.commentCountOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  body: z.lazy(() => SortOrderSchema).optional(),
  username: z.lazy(() => SortOrderSchema).optional(),
  issue_id: z.lazy(() => SortOrderSchema).optional(),
  created_at: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const commentMaxOrderByAggregateInputSchema: z.ZodType<Prisma.commentMaxOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  body: z.lazy(() => SortOrderSchema).optional(),
  username: z.lazy(() => SortOrderSchema).optional(),
  issue_id: z.lazy(() => SortOrderSchema).optional(),
  created_at: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const commentMinOrderByAggregateInputSchema: z.ZodType<Prisma.commentMinOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  body: z.lazy(() => SortOrderSchema).optional(),
  username: z.lazy(() => SortOrderSchema).optional(),
  issue_id: z.lazy(() => SortOrderSchema).optional(),
  created_at: z.lazy(() => SortOrderSchema).optional()
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

export const CommentListRelationFilterSchema: z.ZodType<Prisma.CommentListRelationFilter> = z.object({
  every: z.lazy(() => commentWhereInputSchema).optional(),
  some: z.lazy(() => commentWhereInputSchema).optional(),
  none: z.lazy(() => commentWhereInputSchema).optional()
}).strict();

export const commentOrderByRelationAggregateInputSchema: z.ZodType<Prisma.commentOrderByRelationAggregateInput> = z.object({
  _count: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const issueCountOrderByAggregateInputSchema: z.ZodType<Prisma.issueCountOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  title: z.lazy(() => SortOrderSchema).optional(),
  description: z.lazy(() => SortOrderSchema).optional(),
  priority: z.lazy(() => SortOrderSchema).optional(),
  status: z.lazy(() => SortOrderSchema).optional(),
  modified: z.lazy(() => SortOrderSchema).optional(),
  created: z.lazy(() => SortOrderSchema).optional(),
  kanbanorder: z.lazy(() => SortOrderSchema).optional(),
  username: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const issueMaxOrderByAggregateInputSchema: z.ZodType<Prisma.issueMaxOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  title: z.lazy(() => SortOrderSchema).optional(),
  description: z.lazy(() => SortOrderSchema).optional(),
  priority: z.lazy(() => SortOrderSchema).optional(),
  status: z.lazy(() => SortOrderSchema).optional(),
  modified: z.lazy(() => SortOrderSchema).optional(),
  created: z.lazy(() => SortOrderSchema).optional(),
  kanbanorder: z.lazy(() => SortOrderSchema).optional(),
  username: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const issueMinOrderByAggregateInputSchema: z.ZodType<Prisma.issueMinOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  title: z.lazy(() => SortOrderSchema).optional(),
  description: z.lazy(() => SortOrderSchema).optional(),
  priority: z.lazy(() => SortOrderSchema).optional(),
  status: z.lazy(() => SortOrderSchema).optional(),
  modified: z.lazy(() => SortOrderSchema).optional(),
  created: z.lazy(() => SortOrderSchema).optional(),
  kanbanorder: z.lazy(() => SortOrderSchema).optional(),
  username: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const StringNullableFilterSchema: z.ZodType<Prisma.StringNullableFilter> = z.object({
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
  not: z.union([ z.string(),z.lazy(() => NestedStringNullableFilterSchema) ]).optional().nullable(),
}).strict();

export const userCountOrderByAggregateInputSchema: z.ZodType<Prisma.userCountOrderByAggregateInput> = z.object({
  username: z.lazy(() => SortOrderSchema).optional(),
  avatar: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const userMaxOrderByAggregateInputSchema: z.ZodType<Prisma.userMaxOrderByAggregateInput> = z.object({
  username: z.lazy(() => SortOrderSchema).optional(),
  avatar: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const userMinOrderByAggregateInputSchema: z.ZodType<Prisma.userMinOrderByAggregateInput> = z.object({
  username: z.lazy(() => SortOrderSchema).optional(),
  avatar: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const StringNullableWithAggregatesFilterSchema: z.ZodType<Prisma.StringNullableWithAggregatesFilter> = z.object({
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
  not: z.union([ z.string(),z.lazy(() => NestedStringNullableWithAggregatesFilterSchema) ]).optional().nullable(),
  _count: z.lazy(() => NestedIntNullableFilterSchema).optional(),
  _min: z.lazy(() => NestedStringNullableFilterSchema).optional(),
  _max: z.lazy(() => NestedStringNullableFilterSchema).optional()
}).strict();

export const userCreateNestedOneWithoutCommentInputSchema: z.ZodType<Prisma.userCreateNestedOneWithoutCommentInput> = z.object({
  create: z.union([ z.lazy(() => userCreateWithoutCommentInputSchema),z.lazy(() => userUncheckedCreateWithoutCommentInputSchema) ]).optional(),
  connectOrCreate: z.lazy(() => userCreateOrConnectWithoutCommentInputSchema).optional(),
  connect: z.lazy(() => userWhereUniqueInputSchema).optional()
}).strict();

export const issueCreateNestedOneWithoutCommentInputSchema: z.ZodType<Prisma.issueCreateNestedOneWithoutCommentInput> = z.object({
  create: z.union([ z.lazy(() => issueCreateWithoutCommentInputSchema),z.lazy(() => issueUncheckedCreateWithoutCommentInputSchema) ]).optional(),
  connectOrCreate: z.lazy(() => issueCreateOrConnectWithoutCommentInputSchema).optional(),
  connect: z.lazy(() => issueWhereUniqueInputSchema).optional()
}).strict();

export const StringFieldUpdateOperationsInputSchema: z.ZodType<Prisma.StringFieldUpdateOperationsInput> = z.object({
  set: z.string().optional()
}).strict();

export const userUpdateOneRequiredWithoutCommentNestedInputSchema: z.ZodType<Prisma.userUpdateOneRequiredWithoutCommentNestedInput> = z.object({
  create: z.union([ z.lazy(() => userCreateWithoutCommentInputSchema),z.lazy(() => userUncheckedCreateWithoutCommentInputSchema) ]).optional(),
  connectOrCreate: z.lazy(() => userCreateOrConnectWithoutCommentInputSchema).optional(),
  upsert: z.lazy(() => userUpsertWithoutCommentInputSchema).optional(),
  connect: z.lazy(() => userWhereUniqueInputSchema).optional(),
  update: z.union([ z.lazy(() => userUpdateWithoutCommentInputSchema),z.lazy(() => userUncheckedUpdateWithoutCommentInputSchema) ]).optional(),
}).strict();

export const issueUpdateOneRequiredWithoutCommentNestedInputSchema: z.ZodType<Prisma.issueUpdateOneRequiredWithoutCommentNestedInput> = z.object({
  create: z.union([ z.lazy(() => issueCreateWithoutCommentInputSchema),z.lazy(() => issueUncheckedCreateWithoutCommentInputSchema) ]).optional(),
  connectOrCreate: z.lazy(() => issueCreateOrConnectWithoutCommentInputSchema).optional(),
  upsert: z.lazy(() => issueUpsertWithoutCommentInputSchema).optional(),
  connect: z.lazy(() => issueWhereUniqueInputSchema).optional(),
  update: z.union([ z.lazy(() => issueUpdateWithoutCommentInputSchema),z.lazy(() => issueUncheckedUpdateWithoutCommentInputSchema) ]).optional(),
}).strict();

export const commentCreateNestedManyWithoutIssueInputSchema: z.ZodType<Prisma.commentCreateNestedManyWithoutIssueInput> = z.object({
  create: z.union([ z.lazy(() => commentCreateWithoutIssueInputSchema),z.lazy(() => commentCreateWithoutIssueInputSchema).array(),z.lazy(() => commentUncheckedCreateWithoutIssueInputSchema),z.lazy(() => commentUncheckedCreateWithoutIssueInputSchema).array() ]).optional(),
  connectOrCreate: z.union([ z.lazy(() => commentCreateOrConnectWithoutIssueInputSchema),z.lazy(() => commentCreateOrConnectWithoutIssueInputSchema).array() ]).optional(),
  createMany: z.lazy(() => commentCreateManyIssueInputEnvelopeSchema).optional(),
  connect: z.union([ z.lazy(() => commentWhereUniqueInputSchema),z.lazy(() => commentWhereUniqueInputSchema).array() ]).optional(),
}).strict();

export const commentUncheckedCreateNestedManyWithoutIssueInputSchema: z.ZodType<Prisma.commentUncheckedCreateNestedManyWithoutIssueInput> = z.object({
  create: z.union([ z.lazy(() => commentCreateWithoutIssueInputSchema),z.lazy(() => commentCreateWithoutIssueInputSchema).array(),z.lazy(() => commentUncheckedCreateWithoutIssueInputSchema),z.lazy(() => commentUncheckedCreateWithoutIssueInputSchema).array() ]).optional(),
  connectOrCreate: z.union([ z.lazy(() => commentCreateOrConnectWithoutIssueInputSchema),z.lazy(() => commentCreateOrConnectWithoutIssueInputSchema).array() ]).optional(),
  createMany: z.lazy(() => commentCreateManyIssueInputEnvelopeSchema).optional(),
  connect: z.union([ z.lazy(() => commentWhereUniqueInputSchema),z.lazy(() => commentWhereUniqueInputSchema).array() ]).optional(),
}).strict();

export const commentUpdateManyWithoutIssueNestedInputSchema: z.ZodType<Prisma.commentUpdateManyWithoutIssueNestedInput> = z.object({
  create: z.union([ z.lazy(() => commentCreateWithoutIssueInputSchema),z.lazy(() => commentCreateWithoutIssueInputSchema).array(),z.lazy(() => commentUncheckedCreateWithoutIssueInputSchema),z.lazy(() => commentUncheckedCreateWithoutIssueInputSchema).array() ]).optional(),
  connectOrCreate: z.union([ z.lazy(() => commentCreateOrConnectWithoutIssueInputSchema),z.lazy(() => commentCreateOrConnectWithoutIssueInputSchema).array() ]).optional(),
  upsert: z.union([ z.lazy(() => commentUpsertWithWhereUniqueWithoutIssueInputSchema),z.lazy(() => commentUpsertWithWhereUniqueWithoutIssueInputSchema).array() ]).optional(),
  createMany: z.lazy(() => commentCreateManyIssueInputEnvelopeSchema).optional(),
  set: z.union([ z.lazy(() => commentWhereUniqueInputSchema),z.lazy(() => commentWhereUniqueInputSchema).array() ]).optional(),
  disconnect: z.union([ z.lazy(() => commentWhereUniqueInputSchema),z.lazy(() => commentWhereUniqueInputSchema).array() ]).optional(),
  delete: z.union([ z.lazy(() => commentWhereUniqueInputSchema),z.lazy(() => commentWhereUniqueInputSchema).array() ]).optional(),
  connect: z.union([ z.lazy(() => commentWhereUniqueInputSchema),z.lazy(() => commentWhereUniqueInputSchema).array() ]).optional(),
  update: z.union([ z.lazy(() => commentUpdateWithWhereUniqueWithoutIssueInputSchema),z.lazy(() => commentUpdateWithWhereUniqueWithoutIssueInputSchema).array() ]).optional(),
  updateMany: z.union([ z.lazy(() => commentUpdateManyWithWhereWithoutIssueInputSchema),z.lazy(() => commentUpdateManyWithWhereWithoutIssueInputSchema).array() ]).optional(),
  deleteMany: z.union([ z.lazy(() => commentScalarWhereInputSchema),z.lazy(() => commentScalarWhereInputSchema).array() ]).optional(),
}).strict();

export const commentUncheckedUpdateManyWithoutIssueNestedInputSchema: z.ZodType<Prisma.commentUncheckedUpdateManyWithoutIssueNestedInput> = z.object({
  create: z.union([ z.lazy(() => commentCreateWithoutIssueInputSchema),z.lazy(() => commentCreateWithoutIssueInputSchema).array(),z.lazy(() => commentUncheckedCreateWithoutIssueInputSchema),z.lazy(() => commentUncheckedCreateWithoutIssueInputSchema).array() ]).optional(),
  connectOrCreate: z.union([ z.lazy(() => commentCreateOrConnectWithoutIssueInputSchema),z.lazy(() => commentCreateOrConnectWithoutIssueInputSchema).array() ]).optional(),
  upsert: z.union([ z.lazy(() => commentUpsertWithWhereUniqueWithoutIssueInputSchema),z.lazy(() => commentUpsertWithWhereUniqueWithoutIssueInputSchema).array() ]).optional(),
  createMany: z.lazy(() => commentCreateManyIssueInputEnvelopeSchema).optional(),
  set: z.union([ z.lazy(() => commentWhereUniqueInputSchema),z.lazy(() => commentWhereUniqueInputSchema).array() ]).optional(),
  disconnect: z.union([ z.lazy(() => commentWhereUniqueInputSchema),z.lazy(() => commentWhereUniqueInputSchema).array() ]).optional(),
  delete: z.union([ z.lazy(() => commentWhereUniqueInputSchema),z.lazy(() => commentWhereUniqueInputSchema).array() ]).optional(),
  connect: z.union([ z.lazy(() => commentWhereUniqueInputSchema),z.lazy(() => commentWhereUniqueInputSchema).array() ]).optional(),
  update: z.union([ z.lazy(() => commentUpdateWithWhereUniqueWithoutIssueInputSchema),z.lazy(() => commentUpdateWithWhereUniqueWithoutIssueInputSchema).array() ]).optional(),
  updateMany: z.union([ z.lazy(() => commentUpdateManyWithWhereWithoutIssueInputSchema),z.lazy(() => commentUpdateManyWithWhereWithoutIssueInputSchema).array() ]).optional(),
  deleteMany: z.union([ z.lazy(() => commentScalarWhereInputSchema),z.lazy(() => commentScalarWhereInputSchema).array() ]).optional(),
}).strict();

export const commentCreateNestedManyWithoutUserInputSchema: z.ZodType<Prisma.commentCreateNestedManyWithoutUserInput> = z.object({
  create: z.union([ z.lazy(() => commentCreateWithoutUserInputSchema),z.lazy(() => commentCreateWithoutUserInputSchema).array(),z.lazy(() => commentUncheckedCreateWithoutUserInputSchema),z.lazy(() => commentUncheckedCreateWithoutUserInputSchema).array() ]).optional(),
  connectOrCreate: z.union([ z.lazy(() => commentCreateOrConnectWithoutUserInputSchema),z.lazy(() => commentCreateOrConnectWithoutUserInputSchema).array() ]).optional(),
  createMany: z.lazy(() => commentCreateManyUserInputEnvelopeSchema).optional(),
  connect: z.union([ z.lazy(() => commentWhereUniqueInputSchema),z.lazy(() => commentWhereUniqueInputSchema).array() ]).optional(),
}).strict();

export const commentUncheckedCreateNestedManyWithoutUserInputSchema: z.ZodType<Prisma.commentUncheckedCreateNestedManyWithoutUserInput> = z.object({
  create: z.union([ z.lazy(() => commentCreateWithoutUserInputSchema),z.lazy(() => commentCreateWithoutUserInputSchema).array(),z.lazy(() => commentUncheckedCreateWithoutUserInputSchema),z.lazy(() => commentUncheckedCreateWithoutUserInputSchema).array() ]).optional(),
  connectOrCreate: z.union([ z.lazy(() => commentCreateOrConnectWithoutUserInputSchema),z.lazy(() => commentCreateOrConnectWithoutUserInputSchema).array() ]).optional(),
  createMany: z.lazy(() => commentCreateManyUserInputEnvelopeSchema).optional(),
  connect: z.union([ z.lazy(() => commentWhereUniqueInputSchema),z.lazy(() => commentWhereUniqueInputSchema).array() ]).optional(),
}).strict();

export const NullableStringFieldUpdateOperationsInputSchema: z.ZodType<Prisma.NullableStringFieldUpdateOperationsInput> = z.object({
  set: z.string().optional().nullable()
}).strict();

export const commentUpdateManyWithoutUserNestedInputSchema: z.ZodType<Prisma.commentUpdateManyWithoutUserNestedInput> = z.object({
  create: z.union([ z.lazy(() => commentCreateWithoutUserInputSchema),z.lazy(() => commentCreateWithoutUserInputSchema).array(),z.lazy(() => commentUncheckedCreateWithoutUserInputSchema),z.lazy(() => commentUncheckedCreateWithoutUserInputSchema).array() ]).optional(),
  connectOrCreate: z.union([ z.lazy(() => commentCreateOrConnectWithoutUserInputSchema),z.lazy(() => commentCreateOrConnectWithoutUserInputSchema).array() ]).optional(),
  upsert: z.union([ z.lazy(() => commentUpsertWithWhereUniqueWithoutUserInputSchema),z.lazy(() => commentUpsertWithWhereUniqueWithoutUserInputSchema).array() ]).optional(),
  createMany: z.lazy(() => commentCreateManyUserInputEnvelopeSchema).optional(),
  set: z.union([ z.lazy(() => commentWhereUniqueInputSchema),z.lazy(() => commentWhereUniqueInputSchema).array() ]).optional(),
  disconnect: z.union([ z.lazy(() => commentWhereUniqueInputSchema),z.lazy(() => commentWhereUniqueInputSchema).array() ]).optional(),
  delete: z.union([ z.lazy(() => commentWhereUniqueInputSchema),z.lazy(() => commentWhereUniqueInputSchema).array() ]).optional(),
  connect: z.union([ z.lazy(() => commentWhereUniqueInputSchema),z.lazy(() => commentWhereUniqueInputSchema).array() ]).optional(),
  update: z.union([ z.lazy(() => commentUpdateWithWhereUniqueWithoutUserInputSchema),z.lazy(() => commentUpdateWithWhereUniqueWithoutUserInputSchema).array() ]).optional(),
  updateMany: z.union([ z.lazy(() => commentUpdateManyWithWhereWithoutUserInputSchema),z.lazy(() => commentUpdateManyWithWhereWithoutUserInputSchema).array() ]).optional(),
  deleteMany: z.union([ z.lazy(() => commentScalarWhereInputSchema),z.lazy(() => commentScalarWhereInputSchema).array() ]).optional(),
}).strict();

export const commentUncheckedUpdateManyWithoutUserNestedInputSchema: z.ZodType<Prisma.commentUncheckedUpdateManyWithoutUserNestedInput> = z.object({
  create: z.union([ z.lazy(() => commentCreateWithoutUserInputSchema),z.lazy(() => commentCreateWithoutUserInputSchema).array(),z.lazy(() => commentUncheckedCreateWithoutUserInputSchema),z.lazy(() => commentUncheckedCreateWithoutUserInputSchema).array() ]).optional(),
  connectOrCreate: z.union([ z.lazy(() => commentCreateOrConnectWithoutUserInputSchema),z.lazy(() => commentCreateOrConnectWithoutUserInputSchema).array() ]).optional(),
  upsert: z.union([ z.lazy(() => commentUpsertWithWhereUniqueWithoutUserInputSchema),z.lazy(() => commentUpsertWithWhereUniqueWithoutUserInputSchema).array() ]).optional(),
  createMany: z.lazy(() => commentCreateManyUserInputEnvelopeSchema).optional(),
  set: z.union([ z.lazy(() => commentWhereUniqueInputSchema),z.lazy(() => commentWhereUniqueInputSchema).array() ]).optional(),
  disconnect: z.union([ z.lazy(() => commentWhereUniqueInputSchema),z.lazy(() => commentWhereUniqueInputSchema).array() ]).optional(),
  delete: z.union([ z.lazy(() => commentWhereUniqueInputSchema),z.lazy(() => commentWhereUniqueInputSchema).array() ]).optional(),
  connect: z.union([ z.lazy(() => commentWhereUniqueInputSchema),z.lazy(() => commentWhereUniqueInputSchema).array() ]).optional(),
  update: z.union([ z.lazy(() => commentUpdateWithWhereUniqueWithoutUserInputSchema),z.lazy(() => commentUpdateWithWhereUniqueWithoutUserInputSchema).array() ]).optional(),
  updateMany: z.union([ z.lazy(() => commentUpdateManyWithWhereWithoutUserInputSchema),z.lazy(() => commentUpdateManyWithWhereWithoutUserInputSchema).array() ]).optional(),
  deleteMany: z.union([ z.lazy(() => commentScalarWhereInputSchema),z.lazy(() => commentScalarWhereInputSchema).array() ]).optional(),
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

export const NestedStringNullableFilterSchema: z.ZodType<Prisma.NestedStringNullableFilter> = z.object({
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
  not: z.union([ z.string(),z.lazy(() => NestedStringNullableFilterSchema) ]).optional().nullable(),
}).strict();

export const NestedStringNullableWithAggregatesFilterSchema: z.ZodType<Prisma.NestedStringNullableWithAggregatesFilter> = z.object({
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
  not: z.union([ z.string(),z.lazy(() => NestedStringNullableWithAggregatesFilterSchema) ]).optional().nullable(),
  _count: z.lazy(() => NestedIntNullableFilterSchema).optional(),
  _min: z.lazy(() => NestedStringNullableFilterSchema).optional(),
  _max: z.lazy(() => NestedStringNullableFilterSchema).optional()
}).strict();

export const NestedIntNullableFilterSchema: z.ZodType<Prisma.NestedIntNullableFilter> = z.object({
  equals: z.number().optional().nullable(),
  in: z.number().array().optional().nullable(),
  notIn: z.number().array().optional().nullable(),
  lt: z.number().optional(),
  lte: z.number().optional(),
  gt: z.number().optional(),
  gte: z.number().optional(),
  not: z.union([ z.number(),z.lazy(() => NestedIntNullableFilterSchema) ]).optional().nullable(),
}).strict();

export const userCreateWithoutCommentInputSchema: z.ZodType<Prisma.userCreateWithoutCommentInput> = z.object({
  username: z.string(),
  avatar: z.string().optional().nullable()
}).strict();

export const userUncheckedCreateWithoutCommentInputSchema: z.ZodType<Prisma.userUncheckedCreateWithoutCommentInput> = z.object({
  username: z.string(),
  avatar: z.string().optional().nullable()
}).strict();

export const userCreateOrConnectWithoutCommentInputSchema: z.ZodType<Prisma.userCreateOrConnectWithoutCommentInput> = z.object({
  where: z.lazy(() => userWhereUniqueInputSchema),
  create: z.union([ z.lazy(() => userCreateWithoutCommentInputSchema),z.lazy(() => userUncheckedCreateWithoutCommentInputSchema) ]),
}).strict();

export const issueCreateWithoutCommentInputSchema: z.ZodType<Prisma.issueCreateWithoutCommentInput> = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  priority: z.string(),
  status: z.string(),
  modified: z.string(),
  created: z.string(),
  kanbanorder: z.string(),
  username: z.string()
}).strict();

export const issueUncheckedCreateWithoutCommentInputSchema: z.ZodType<Prisma.issueUncheckedCreateWithoutCommentInput> = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  priority: z.string(),
  status: z.string(),
  modified: z.string(),
  created: z.string(),
  kanbanorder: z.string(),
  username: z.string()
}).strict();

export const issueCreateOrConnectWithoutCommentInputSchema: z.ZodType<Prisma.issueCreateOrConnectWithoutCommentInput> = z.object({
  where: z.lazy(() => issueWhereUniqueInputSchema),
  create: z.union([ z.lazy(() => issueCreateWithoutCommentInputSchema),z.lazy(() => issueUncheckedCreateWithoutCommentInputSchema) ]),
}).strict();

export const userUpsertWithoutCommentInputSchema: z.ZodType<Prisma.userUpsertWithoutCommentInput> = z.object({
  update: z.union([ z.lazy(() => userUpdateWithoutCommentInputSchema),z.lazy(() => userUncheckedUpdateWithoutCommentInputSchema) ]),
  create: z.union([ z.lazy(() => userCreateWithoutCommentInputSchema),z.lazy(() => userUncheckedCreateWithoutCommentInputSchema) ]),
}).strict();

export const userUpdateWithoutCommentInputSchema: z.ZodType<Prisma.userUpdateWithoutCommentInput> = z.object({
  username: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  avatar: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
}).strict();

export const userUncheckedUpdateWithoutCommentInputSchema: z.ZodType<Prisma.userUncheckedUpdateWithoutCommentInput> = z.object({
  username: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  avatar: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
}).strict();

export const issueUpsertWithoutCommentInputSchema: z.ZodType<Prisma.issueUpsertWithoutCommentInput> = z.object({
  update: z.union([ z.lazy(() => issueUpdateWithoutCommentInputSchema),z.lazy(() => issueUncheckedUpdateWithoutCommentInputSchema) ]),
  create: z.union([ z.lazy(() => issueCreateWithoutCommentInputSchema),z.lazy(() => issueUncheckedCreateWithoutCommentInputSchema) ]),
}).strict();

export const issueUpdateWithoutCommentInputSchema: z.ZodType<Prisma.issueUpdateWithoutCommentInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  title: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  description: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  priority: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  status: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  modified: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  created: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  kanbanorder: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  username: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const issueUncheckedUpdateWithoutCommentInputSchema: z.ZodType<Prisma.issueUncheckedUpdateWithoutCommentInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  title: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  description: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  priority: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  status: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  modified: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  created: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  kanbanorder: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  username: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const commentCreateWithoutIssueInputSchema: z.ZodType<Prisma.commentCreateWithoutIssueInput> = z.object({
  id: z.string(),
  body: z.string(),
  created_at: z.string(),
  user: z.lazy(() => userCreateNestedOneWithoutCommentInputSchema)
}).strict();

export const commentUncheckedCreateWithoutIssueInputSchema: z.ZodType<Prisma.commentUncheckedCreateWithoutIssueInput> = z.object({
  id: z.string(),
  body: z.string(),
  username: z.string(),
  created_at: z.string()
}).strict();

export const commentCreateOrConnectWithoutIssueInputSchema: z.ZodType<Prisma.commentCreateOrConnectWithoutIssueInput> = z.object({
  where: z.lazy(() => commentWhereUniqueInputSchema),
  create: z.union([ z.lazy(() => commentCreateWithoutIssueInputSchema),z.lazy(() => commentUncheckedCreateWithoutIssueInputSchema) ]),
}).strict();

export const commentCreateManyIssueInputEnvelopeSchema: z.ZodType<Prisma.commentCreateManyIssueInputEnvelope> = z.object({
  data: z.union([ z.lazy(() => commentCreateManyIssueInputSchema),z.lazy(() => commentCreateManyIssueInputSchema).array() ]),
  skipDuplicates: z.boolean().optional()
}).strict();

export const commentUpsertWithWhereUniqueWithoutIssueInputSchema: z.ZodType<Prisma.commentUpsertWithWhereUniqueWithoutIssueInput> = z.object({
  where: z.lazy(() => commentWhereUniqueInputSchema),
  update: z.union([ z.lazy(() => commentUpdateWithoutIssueInputSchema),z.lazy(() => commentUncheckedUpdateWithoutIssueInputSchema) ]),
  create: z.union([ z.lazy(() => commentCreateWithoutIssueInputSchema),z.lazy(() => commentUncheckedCreateWithoutIssueInputSchema) ]),
}).strict();

export const commentUpdateWithWhereUniqueWithoutIssueInputSchema: z.ZodType<Prisma.commentUpdateWithWhereUniqueWithoutIssueInput> = z.object({
  where: z.lazy(() => commentWhereUniqueInputSchema),
  data: z.union([ z.lazy(() => commentUpdateWithoutIssueInputSchema),z.lazy(() => commentUncheckedUpdateWithoutIssueInputSchema) ]),
}).strict();

export const commentUpdateManyWithWhereWithoutIssueInputSchema: z.ZodType<Prisma.commentUpdateManyWithWhereWithoutIssueInput> = z.object({
  where: z.lazy(() => commentScalarWhereInputSchema),
  data: z.union([ z.lazy(() => commentUpdateManyMutationInputSchema),z.lazy(() => commentUncheckedUpdateManyWithoutCommentInputSchema) ]),
}).strict();

export const commentScalarWhereInputSchema: z.ZodType<Prisma.commentScalarWhereInput> = z.object({
  AND: z.union([ z.lazy(() => commentScalarWhereInputSchema),z.lazy(() => commentScalarWhereInputSchema).array() ]).optional(),
  OR: z.lazy(() => commentScalarWhereInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => commentScalarWhereInputSchema),z.lazy(() => commentScalarWhereInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  body: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  username: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  issue_id: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  created_at: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
}).strict();

export const commentCreateWithoutUserInputSchema: z.ZodType<Prisma.commentCreateWithoutUserInput> = z.object({
  id: z.string(),
  body: z.string(),
  created_at: z.string(),
  issue: z.lazy(() => issueCreateNestedOneWithoutCommentInputSchema)
}).strict();

export const commentUncheckedCreateWithoutUserInputSchema: z.ZodType<Prisma.commentUncheckedCreateWithoutUserInput> = z.object({
  id: z.string(),
  body: z.string(),
  issue_id: z.string(),
  created_at: z.string()
}).strict();

export const commentCreateOrConnectWithoutUserInputSchema: z.ZodType<Prisma.commentCreateOrConnectWithoutUserInput> = z.object({
  where: z.lazy(() => commentWhereUniqueInputSchema),
  create: z.union([ z.lazy(() => commentCreateWithoutUserInputSchema),z.lazy(() => commentUncheckedCreateWithoutUserInputSchema) ]),
}).strict();

export const commentCreateManyUserInputEnvelopeSchema: z.ZodType<Prisma.commentCreateManyUserInputEnvelope> = z.object({
  data: z.union([ z.lazy(() => commentCreateManyUserInputSchema),z.lazy(() => commentCreateManyUserInputSchema).array() ]),
  skipDuplicates: z.boolean().optional()
}).strict();

export const commentUpsertWithWhereUniqueWithoutUserInputSchema: z.ZodType<Prisma.commentUpsertWithWhereUniqueWithoutUserInput> = z.object({
  where: z.lazy(() => commentWhereUniqueInputSchema),
  update: z.union([ z.lazy(() => commentUpdateWithoutUserInputSchema),z.lazy(() => commentUncheckedUpdateWithoutUserInputSchema) ]),
  create: z.union([ z.lazy(() => commentCreateWithoutUserInputSchema),z.lazy(() => commentUncheckedCreateWithoutUserInputSchema) ]),
}).strict();

export const commentUpdateWithWhereUniqueWithoutUserInputSchema: z.ZodType<Prisma.commentUpdateWithWhereUniqueWithoutUserInput> = z.object({
  where: z.lazy(() => commentWhereUniqueInputSchema),
  data: z.union([ z.lazy(() => commentUpdateWithoutUserInputSchema),z.lazy(() => commentUncheckedUpdateWithoutUserInputSchema) ]),
}).strict();

export const commentUpdateManyWithWhereWithoutUserInputSchema: z.ZodType<Prisma.commentUpdateManyWithWhereWithoutUserInput> = z.object({
  where: z.lazy(() => commentScalarWhereInputSchema),
  data: z.union([ z.lazy(() => commentUpdateManyMutationInputSchema),z.lazy(() => commentUncheckedUpdateManyWithoutCommentInputSchema) ]),
}).strict();

export const commentCreateManyIssueInputSchema: z.ZodType<Prisma.commentCreateManyIssueInput> = z.object({
  id: z.string(),
  body: z.string(),
  username: z.string(),
  created_at: z.string()
}).strict();

export const commentUpdateWithoutIssueInputSchema: z.ZodType<Prisma.commentUpdateWithoutIssueInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  body: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  created_at: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  user: z.lazy(() => userUpdateOneRequiredWithoutCommentNestedInputSchema).optional()
}).strict();

export const commentUncheckedUpdateWithoutIssueInputSchema: z.ZodType<Prisma.commentUncheckedUpdateWithoutIssueInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  body: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  username: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  created_at: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const commentUncheckedUpdateManyWithoutCommentInputSchema: z.ZodType<Prisma.commentUncheckedUpdateManyWithoutCommentInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  body: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  username: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  created_at: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const commentCreateManyUserInputSchema: z.ZodType<Prisma.commentCreateManyUserInput> = z.object({
  id: z.string(),
  body: z.string(),
  issue_id: z.string(),
  created_at: z.string()
}).strict();

export const commentUpdateWithoutUserInputSchema: z.ZodType<Prisma.commentUpdateWithoutUserInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  body: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  created_at: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  issue: z.lazy(() => issueUpdateOneRequiredWithoutCommentNestedInputSchema).optional()
}).strict();

export const commentUncheckedUpdateWithoutUserInputSchema: z.ZodType<Prisma.commentUncheckedUpdateWithoutUserInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  body: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  issue_id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  created_at: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

/////////////////////////////////////////
// ARGS
/////////////////////////////////////////

export const commentFindFirstArgsSchema: z.ZodType<Prisma.commentFindFirstArgs> = z.object({
  select: commentSelectSchema.optional(),
  include: commentIncludeSchema.optional(),
  where: commentWhereInputSchema.optional(),
  orderBy: z.union([ commentOrderByWithRelationInputSchema.array(),commentOrderByWithRelationInputSchema ]).optional(),
  cursor: commentWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: CommentScalarFieldEnumSchema.array().optional(),
}).strict()

export const commentFindFirstOrThrowArgsSchema: z.ZodType<Prisma.commentFindFirstOrThrowArgs> = z.object({
  select: commentSelectSchema.optional(),
  include: commentIncludeSchema.optional(),
  where: commentWhereInputSchema.optional(),
  orderBy: z.union([ commentOrderByWithRelationInputSchema.array(),commentOrderByWithRelationInputSchema ]).optional(),
  cursor: commentWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: CommentScalarFieldEnumSchema.array().optional(),
}).strict()

export const commentFindManyArgsSchema: z.ZodType<Prisma.commentFindManyArgs> = z.object({
  select: commentSelectSchema.optional(),
  include: commentIncludeSchema.optional(),
  where: commentWhereInputSchema.optional(),
  orderBy: z.union([ commentOrderByWithRelationInputSchema.array(),commentOrderByWithRelationInputSchema ]).optional(),
  cursor: commentWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: CommentScalarFieldEnumSchema.array().optional(),
}).strict()

export const commentAggregateArgsSchema: z.ZodType<Prisma.commentAggregateArgs> = z.object({
  where: commentWhereInputSchema.optional(),
  orderBy: z.union([ commentOrderByWithRelationInputSchema.array(),commentOrderByWithRelationInputSchema ]).optional(),
  cursor: commentWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict()

export const commentGroupByArgsSchema: z.ZodType<Prisma.commentGroupByArgs> = z.object({
  where: commentWhereInputSchema.optional(),
  orderBy: z.union([ commentOrderByWithAggregationInputSchema.array(),commentOrderByWithAggregationInputSchema ]).optional(),
  by: CommentScalarFieldEnumSchema.array(),
  having: commentScalarWhereWithAggregatesInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict()

export const commentFindUniqueArgsSchema: z.ZodType<Prisma.commentFindUniqueArgs> = z.object({
  select: commentSelectSchema.optional(),
  include: commentIncludeSchema.optional(),
  where: commentWhereUniqueInputSchema,
}).strict()

export const commentFindUniqueOrThrowArgsSchema: z.ZodType<Prisma.commentFindUniqueOrThrowArgs> = z.object({
  select: commentSelectSchema.optional(),
  include: commentIncludeSchema.optional(),
  where: commentWhereUniqueInputSchema,
}).strict()

export const issueFindFirstArgsSchema: z.ZodType<Prisma.issueFindFirstArgs> = z.object({
  select: issueSelectSchema.optional(),
  include: issueIncludeSchema.optional(),
  where: issueWhereInputSchema.optional(),
  orderBy: z.union([ issueOrderByWithRelationInputSchema.array(),issueOrderByWithRelationInputSchema ]).optional(),
  cursor: issueWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: IssueScalarFieldEnumSchema.array().optional(),
}).strict()

export const issueFindFirstOrThrowArgsSchema: z.ZodType<Prisma.issueFindFirstOrThrowArgs> = z.object({
  select: issueSelectSchema.optional(),
  include: issueIncludeSchema.optional(),
  where: issueWhereInputSchema.optional(),
  orderBy: z.union([ issueOrderByWithRelationInputSchema.array(),issueOrderByWithRelationInputSchema ]).optional(),
  cursor: issueWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: IssueScalarFieldEnumSchema.array().optional(),
}).strict()

export const issueFindManyArgsSchema: z.ZodType<Prisma.issueFindManyArgs> = z.object({
  select: issueSelectSchema.optional(),
  include: issueIncludeSchema.optional(),
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
  include: issueIncludeSchema.optional(),
  where: issueWhereUniqueInputSchema,
}).strict()

export const issueFindUniqueOrThrowArgsSchema: z.ZodType<Prisma.issueFindUniqueOrThrowArgs> = z.object({
  select: issueSelectSchema.optional(),
  include: issueIncludeSchema.optional(),
  where: issueWhereUniqueInputSchema,
}).strict()

export const userFindFirstArgsSchema: z.ZodType<Prisma.userFindFirstArgs> = z.object({
  select: userSelectSchema.optional(),
  include: userIncludeSchema.optional(),
  where: userWhereInputSchema.optional(),
  orderBy: z.union([ userOrderByWithRelationInputSchema.array(),userOrderByWithRelationInputSchema ]).optional(),
  cursor: userWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: UserScalarFieldEnumSchema.array().optional(),
}).strict()

export const userFindFirstOrThrowArgsSchema: z.ZodType<Prisma.userFindFirstOrThrowArgs> = z.object({
  select: userSelectSchema.optional(),
  include: userIncludeSchema.optional(),
  where: userWhereInputSchema.optional(),
  orderBy: z.union([ userOrderByWithRelationInputSchema.array(),userOrderByWithRelationInputSchema ]).optional(),
  cursor: userWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: UserScalarFieldEnumSchema.array().optional(),
}).strict()

export const userFindManyArgsSchema: z.ZodType<Prisma.userFindManyArgs> = z.object({
  select: userSelectSchema.optional(),
  include: userIncludeSchema.optional(),
  where: userWhereInputSchema.optional(),
  orderBy: z.union([ userOrderByWithRelationInputSchema.array(),userOrderByWithRelationInputSchema ]).optional(),
  cursor: userWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: UserScalarFieldEnumSchema.array().optional(),
}).strict()

export const userAggregateArgsSchema: z.ZodType<Prisma.userAggregateArgs> = z.object({
  where: userWhereInputSchema.optional(),
  orderBy: z.union([ userOrderByWithRelationInputSchema.array(),userOrderByWithRelationInputSchema ]).optional(),
  cursor: userWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict()

export const userGroupByArgsSchema: z.ZodType<Prisma.userGroupByArgs> = z.object({
  where: userWhereInputSchema.optional(),
  orderBy: z.union([ userOrderByWithAggregationInputSchema.array(),userOrderByWithAggregationInputSchema ]).optional(),
  by: UserScalarFieldEnumSchema.array(),
  having: userScalarWhereWithAggregatesInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict()

export const userFindUniqueArgsSchema: z.ZodType<Prisma.userFindUniqueArgs> = z.object({
  select: userSelectSchema.optional(),
  include: userIncludeSchema.optional(),
  where: userWhereUniqueInputSchema,
}).strict()

export const userFindUniqueOrThrowArgsSchema: z.ZodType<Prisma.userFindUniqueOrThrowArgs> = z.object({
  select: userSelectSchema.optional(),
  include: userIncludeSchema.optional(),
  where: userWhereUniqueInputSchema,
}).strict()

export const commentCreateArgsSchema: z.ZodType<Prisma.commentCreateArgs> = z.object({
  select: commentSelectSchema.optional(),
  include: commentIncludeSchema.optional(),
  data: z.union([ commentCreateInputSchema,commentUncheckedCreateInputSchema ]),
}).strict()

export const commentUpsertArgsSchema: z.ZodType<Prisma.commentUpsertArgs> = z.object({
  select: commentSelectSchema.optional(),
  include: commentIncludeSchema.optional(),
  where: commentWhereUniqueInputSchema,
  create: z.union([ commentCreateInputSchema,commentUncheckedCreateInputSchema ]),
  update: z.union([ commentUpdateInputSchema,commentUncheckedUpdateInputSchema ]),
}).strict()

export const commentCreateManyArgsSchema: z.ZodType<Prisma.commentCreateManyArgs> = z.object({
  data: z.union([ commentCreateManyInputSchema,commentCreateManyInputSchema.array() ]),
  skipDuplicates: z.boolean().optional(),
}).strict()

export const commentDeleteArgsSchema: z.ZodType<Prisma.commentDeleteArgs> = z.object({
  select: commentSelectSchema.optional(),
  include: commentIncludeSchema.optional(),
  where: commentWhereUniqueInputSchema,
}).strict()

export const commentUpdateArgsSchema: z.ZodType<Prisma.commentUpdateArgs> = z.object({
  select: commentSelectSchema.optional(),
  include: commentIncludeSchema.optional(),
  data: z.union([ commentUpdateInputSchema,commentUncheckedUpdateInputSchema ]),
  where: commentWhereUniqueInputSchema,
}).strict()

export const commentUpdateManyArgsSchema: z.ZodType<Prisma.commentUpdateManyArgs> = z.object({
  data: z.union([ commentUpdateManyMutationInputSchema,commentUncheckedUpdateManyInputSchema ]),
  where: commentWhereInputSchema.optional(),
}).strict()

export const commentDeleteManyArgsSchema: z.ZodType<Prisma.commentDeleteManyArgs> = z.object({
  where: commentWhereInputSchema.optional(),
}).strict()

export const issueCreateArgsSchema: z.ZodType<Prisma.issueCreateArgs> = z.object({
  select: issueSelectSchema.optional(),
  include: issueIncludeSchema.optional(),
  data: z.union([ issueCreateInputSchema,issueUncheckedCreateInputSchema ]),
}).strict()

export const issueUpsertArgsSchema: z.ZodType<Prisma.issueUpsertArgs> = z.object({
  select: issueSelectSchema.optional(),
  include: issueIncludeSchema.optional(),
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
  include: issueIncludeSchema.optional(),
  where: issueWhereUniqueInputSchema,
}).strict()

export const issueUpdateArgsSchema: z.ZodType<Prisma.issueUpdateArgs> = z.object({
  select: issueSelectSchema.optional(),
  include: issueIncludeSchema.optional(),
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

export const userCreateArgsSchema: z.ZodType<Prisma.userCreateArgs> = z.object({
  select: userSelectSchema.optional(),
  include: userIncludeSchema.optional(),
  data: z.union([ userCreateInputSchema,userUncheckedCreateInputSchema ]),
}).strict()

export const userUpsertArgsSchema: z.ZodType<Prisma.userUpsertArgs> = z.object({
  select: userSelectSchema.optional(),
  include: userIncludeSchema.optional(),
  where: userWhereUniqueInputSchema,
  create: z.union([ userCreateInputSchema,userUncheckedCreateInputSchema ]),
  update: z.union([ userUpdateInputSchema,userUncheckedUpdateInputSchema ]),
}).strict()

export const userCreateManyArgsSchema: z.ZodType<Prisma.userCreateManyArgs> = z.object({
  data: z.union([ userCreateManyInputSchema,userCreateManyInputSchema.array() ]),
  skipDuplicates: z.boolean().optional(),
}).strict()

export const userDeleteArgsSchema: z.ZodType<Prisma.userDeleteArgs> = z.object({
  select: userSelectSchema.optional(),
  include: userIncludeSchema.optional(),
  where: userWhereUniqueInputSchema,
}).strict()

export const userUpdateArgsSchema: z.ZodType<Prisma.userUpdateArgs> = z.object({
  select: userSelectSchema.optional(),
  include: userIncludeSchema.optional(),
  data: z.union([ userUpdateInputSchema,userUncheckedUpdateInputSchema ]),
  where: userWhereUniqueInputSchema,
}).strict()

export const userUpdateManyArgsSchema: z.ZodType<Prisma.userUpdateManyArgs> = z.object({
  data: z.union([ userUpdateManyMutationInputSchema,userUncheckedUpdateManyInputSchema ]),
  where: userWhereInputSchema.optional(),
}).strict()

export const userDeleteManyArgsSchema: z.ZodType<Prisma.userDeleteManyArgs> = z.object({
  where: userWhereInputSchema.optional(),
}).strict()

interface commentGetPayload extends HKT {
  readonly _A?: boolean | null | undefined | Prisma.commentArgs
  readonly type: Prisma.commentGetPayload<this['_A']>
}

interface issueGetPayload extends HKT {
  readonly _A?: boolean | null | undefined | Prisma.issueArgs
  readonly type: Prisma.issueGetPayload<this['_A']>
}

interface userGetPayload extends HKT {
  readonly _A?: boolean | null | undefined | Prisma.userArgs
  readonly type: Prisma.userGetPayload<this['_A']>
}

export const tableSchemas = {
  comment: {
    fields: ["id","body","username","issue_id","created_at"],
    relations: [
      new Relation("user", "username", "username", "user", "commentTouser", "one"),
      new Relation("issue", "issue_id", "id", "issue", "commentToissue", "one"),
    ],
    modelSchema: (commentCreateInputSchema as any)
      .partial()
      .or((commentUncheckedCreateInputSchema as any).partial()),
    createSchema: commentCreateArgsSchema,
    createManySchema: commentCreateManyArgsSchema,
    findUniqueSchema: commentFindUniqueArgsSchema,
    findSchema: commentFindFirstArgsSchema,
    updateSchema: commentUpdateArgsSchema,
    updateManySchema: commentUpdateManyArgsSchema,
    upsertSchema: commentUpsertArgsSchema,
    deleteSchema: commentDeleteArgsSchema,
    deleteManySchema: commentDeleteManyArgsSchema
  } as TableSchema<
    z.infer<typeof commentCreateInputSchema>,
    Prisma.commentCreateArgs['data'],
    Prisma.commentUpdateArgs['data'],
    Prisma.commentFindFirstArgs['select'],
    Prisma.commentFindFirstArgs['where'],
    Prisma.commentFindUniqueArgs['where'],
    Omit<Prisma.commentInclude, '_count'>,
    Prisma.commentFindFirstArgs['orderBy'],
    Prisma.CommentScalarFieldEnum,
    commentGetPayload
  >,
  issue: {
    fields: ["id","title","description","priority","status","modified","created","kanbanorder","username"],
    relations: [
      new Relation("comment", "", "", "comment", "commentToissue", "many"),
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
    Omit<Prisma.issueInclude, '_count'>,
    Prisma.issueFindFirstArgs['orderBy'],
    Prisma.IssueScalarFieldEnum,
    issueGetPayload
  >,
  user: {
    fields: ["username","avatar"],
    relations: [
      new Relation("comment", "", "", "comment", "commentTouser", "many"),
    ],
    modelSchema: (userCreateInputSchema as any)
      .partial()
      .or((userUncheckedCreateInputSchema as any).partial()),
    createSchema: userCreateArgsSchema,
    createManySchema: userCreateManyArgsSchema,
    findUniqueSchema: userFindUniqueArgsSchema,
    findSchema: userFindFirstArgsSchema,
    updateSchema: userUpdateArgsSchema,
    updateManySchema: userUpdateManyArgsSchema,
    upsertSchema: userUpsertArgsSchema,
    deleteSchema: userDeleteArgsSchema,
    deleteManySchema: userDeleteManyArgsSchema
  } as TableSchema<
    z.infer<typeof userCreateInputSchema>,
    Prisma.userCreateArgs['data'],
    Prisma.userUpdateArgs['data'],
    Prisma.userFindFirstArgs['select'],
    Prisma.userFindFirstArgs['where'],
    Prisma.userFindUniqueArgs['where'],
    Omit<Prisma.userInclude, '_count'>,
    Prisma.userFindFirstArgs['orderBy'],
    Prisma.UserScalarFieldEnum,
    userGetPayload
  >,
}

export const schema = new DbSchema(tableSchemas, migrations)
export type Electric = ElectricClient<typeof schema>
