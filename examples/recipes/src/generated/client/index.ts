import { z } from 'zod';
import type { Prisma } from './prismaClient';
import { type TableSchema, DbSchema, Relation, ElectricClient, type HKT } from 'electric-sql/client/model';
import migrations from './migrations';

/////////////////////////////////////////
// HELPER FUNCTIONS
/////////////////////////////////////////

// JSON
//------------------------------------------------------

export type NullableJsonInput = Prisma.JsonValue | null;


export const JsonValue: z.ZodType<Prisma.JsonValue> = z.union([
  z.null(),
  z.string(),
  z.number(),
  z.boolean(),
  z.lazy(() => z.array(JsonValue)),
  z.lazy(() => z.record(JsonValue)),
]);

export type JsonValueType = z.infer<typeof JsonValue>;

export const NullableJsonValue = JsonValue
  .nullable();

export type NullableJsonValueType = z.infer<typeof NullableJsonValue>;

export const InputJsonValue: z.ZodType<Prisma.InputJsonValue> = z.union([
  z.null(),
  z.string(),
  z.number(),
  z.boolean(),
  z.lazy(() => z.array(InputJsonValue.nullable())),
  z.lazy(() => z.record(InputJsonValue.nullable())),
]);

export type InputJsonValueType = z.infer<typeof InputJsonValue>;


/////////////////////////////////////////
// ENUMS
/////////////////////////////////////////

export const Activity_eventsScalarFieldEnumSchema = z.enum(['id','source_user_id','target_user_id','activity_type','timestamp','message','action','read_at']);

export const Background_jobsScalarFieldEnumSchema = z.enum(['id','timestamp','payload','completed','cancelled','progress','result']);

export const Chat_roomScalarFieldEnumSchema = z.enum(['id','timestamp','username','message']);

export const Commerce_ordersScalarFieldEnumSchema = z.enum(['order_id','timestamp','price_amount','price_currency','promo_code','customer_full_name','country','product']);

export const JsonNullValueFilterSchema = z.enum(['DbNull','JsonNull','AnyNull',]);

export const JsonNullValueInputSchema = z.enum(['JsonNull',]);

export const LogsScalarFieldEnumSchema = z.enum(['id','source_id','timestamp','content']);

export const MonitoringScalarFieldEnumSchema = z.enum(['id','timestamp','type','value']);

export const NullableJsonNullValueInputSchema = z.enum(['DbNull','JsonNull',])

export const QueryModeSchema = z.enum(['default','insensitive']);

export const RequestsScalarFieldEnumSchema = z.enum(['id','timestamp','path','method','data','processing','cancelled']);

export const ResponsesScalarFieldEnumSchema = z.enum(['id','timestamp','request_id','status_code','data']);

export const SortOrderSchema = z.enum(['asc','desc']);

export const TransactionIsolationLevelSchema = z.enum(['ReadUncommitted','ReadCommitted','RepeatableRead','Serializable']);
/////////////////////////////////////////
// MODELS
/////////////////////////////////////////

/////////////////////////////////////////
// ACTIVITY EVENTS SCHEMA
/////////////////////////////////////////

export const Activity_eventsSchema = z.object({
  id: z.string().uuid(),
  source_user_id: z.string().uuid(),
  target_user_id: z.string().uuid(),
  activity_type: z.string(),
  timestamp: z.coerce.date(),
  message: z.string(),
  action: z.string().nullable(),
  read_at: z.coerce.date().nullable(),
})

export type Activity_events = z.infer<typeof Activity_eventsSchema>

/////////////////////////////////////////
// BACKGROUND JOBS SCHEMA
/////////////////////////////////////////

export const Background_jobsSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.coerce.date(),
  payload: InputJsonValue,
  completed: z.boolean(),
  cancelled: z.boolean(),
  progress: z.number().or(z.nan()),
  result: NullableJsonValue.optional(),
})

export type Background_jobs = z.infer<typeof Background_jobsSchema>

/////////////////////////////////////////
// CHAT ROOM SCHEMA
/////////////////////////////////////////

export const Chat_roomSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.coerce.date(),
  username: z.string(),
  message: z.string(),
})

export type Chat_room = z.infer<typeof Chat_roomSchema>

/////////////////////////////////////////
// COMMERCE ORDERS SCHEMA
/////////////////////////////////////////

export const Commerce_ordersSchema = z.object({
  order_id: z.string().uuid(),
  timestamp: z.coerce.date(),
  price_amount: z.number().or(z.nan()),
  price_currency: z.string(),
  promo_code: z.string().nullable(),
  customer_full_name: z.string(),
  country: z.string(),
  product: z.string(),
})

export type Commerce_orders = z.infer<typeof Commerce_ordersSchema>

/////////////////////////////////////////
// LOGS SCHEMA
/////////////////////////////////////////

export const LogsSchema = z.object({
  id: z.string().uuid(),
  source_id: z.string().uuid(),
  timestamp: z.coerce.date(),
  content: z.string(),
})

export type Logs = z.infer<typeof LogsSchema>

/////////////////////////////////////////
// MONITORING SCHEMA
/////////////////////////////////////////

export const MonitoringSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.coerce.date(),
  type: z.string(),
  value: z.number().or(z.nan()),
})

export type Monitoring = z.infer<typeof MonitoringSchema>

/////////////////////////////////////////
// REQUESTS SCHEMA
/////////////////////////////////////////

export const RequestsSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.coerce.date(),
  path: z.string(),
  method: z.string(),
  data: NullableJsonValue.optional(),
  processing: z.boolean(),
  cancelled: z.boolean(),
})

export type Requests = z.infer<typeof RequestsSchema>

/////////////////////////////////////////
// RESPONSES SCHEMA
/////////////////////////////////////////

export const ResponsesSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.coerce.date(),
  request_id: z.string().uuid(),
  status_code: z.number().int().gte(-2147483648).lte(2147483647),
  data: NullableJsonValue.optional(),
})

export type Responses = z.infer<typeof ResponsesSchema>

/////////////////////////////////////////
// SELECT & INCLUDE
/////////////////////////////////////////

// ACTIVITY EVENTS
//------------------------------------------------------

export const Activity_eventsSelectSchema: z.ZodType<Prisma.Activity_eventsSelect> = z.object({
  id: z.boolean().optional(),
  source_user_id: z.boolean().optional(),
  target_user_id: z.boolean().optional(),
  activity_type: z.boolean().optional(),
  timestamp: z.boolean().optional(),
  message: z.boolean().optional(),
  action: z.boolean().optional(),
  read_at: z.boolean().optional(),
}).strict()

// BACKGROUND JOBS
//------------------------------------------------------

export const Background_jobsSelectSchema: z.ZodType<Prisma.Background_jobsSelect> = z.object({
  id: z.boolean().optional(),
  timestamp: z.boolean().optional(),
  payload: z.boolean().optional(),
  completed: z.boolean().optional(),
  cancelled: z.boolean().optional(),
  progress: z.boolean().optional(),
  result: z.boolean().optional(),
}).strict()

// CHAT ROOM
//------------------------------------------------------

export const Chat_roomSelectSchema: z.ZodType<Prisma.Chat_roomSelect> = z.object({
  id: z.boolean().optional(),
  timestamp: z.boolean().optional(),
  username: z.boolean().optional(),
  message: z.boolean().optional(),
}).strict()

// COMMERCE ORDERS
//------------------------------------------------------

export const Commerce_ordersSelectSchema: z.ZodType<Prisma.Commerce_ordersSelect> = z.object({
  order_id: z.boolean().optional(),
  timestamp: z.boolean().optional(),
  price_amount: z.boolean().optional(),
  price_currency: z.boolean().optional(),
  promo_code: z.boolean().optional(),
  customer_full_name: z.boolean().optional(),
  country: z.boolean().optional(),
  product: z.boolean().optional(),
}).strict()

// LOGS
//------------------------------------------------------

export const LogsSelectSchema: z.ZodType<Prisma.LogsSelect> = z.object({
  id: z.boolean().optional(),
  source_id: z.boolean().optional(),
  timestamp: z.boolean().optional(),
  content: z.boolean().optional(),
}).strict()

// MONITORING
//------------------------------------------------------

export const MonitoringSelectSchema: z.ZodType<Prisma.MonitoringSelect> = z.object({
  id: z.boolean().optional(),
  timestamp: z.boolean().optional(),
  type: z.boolean().optional(),
  value: z.boolean().optional(),
}).strict()

// REQUESTS
//------------------------------------------------------

export const RequestsIncludeSchema: z.ZodType<Prisma.RequestsInclude> = z.object({
  responses: z.union([z.boolean(),z.lazy(() => ResponsesFindManyArgsSchema)]).optional(),
  _count: z.union([z.boolean(),z.lazy(() => RequestsCountOutputTypeArgsSchema)]).optional(),
}).strict()

export const RequestsArgsSchema: z.ZodType<Prisma.RequestsArgs> = z.object({
  select: z.lazy(() => RequestsSelectSchema).optional(),
  include: z.lazy(() => RequestsIncludeSchema).optional(),
}).strict();

export const RequestsCountOutputTypeArgsSchema: z.ZodType<Prisma.RequestsCountOutputTypeArgs> = z.object({
  select: z.lazy(() => RequestsCountOutputTypeSelectSchema).nullish(),
}).strict();

export const RequestsCountOutputTypeSelectSchema: z.ZodType<Prisma.RequestsCountOutputTypeSelect> = z.object({
  responses: z.boolean().optional(),
}).strict();

export const RequestsSelectSchema: z.ZodType<Prisma.RequestsSelect> = z.object({
  id: z.boolean().optional(),
  timestamp: z.boolean().optional(),
  path: z.boolean().optional(),
  method: z.boolean().optional(),
  data: z.boolean().optional(),
  processing: z.boolean().optional(),
  cancelled: z.boolean().optional(),
  responses: z.union([z.boolean(),z.lazy(() => ResponsesFindManyArgsSchema)]).optional(),
  _count: z.union([z.boolean(),z.lazy(() => RequestsCountOutputTypeArgsSchema)]).optional(),
}).strict()

// RESPONSES
//------------------------------------------------------

export const ResponsesIncludeSchema: z.ZodType<Prisma.ResponsesInclude> = z.object({
  requests: z.union([z.boolean(),z.lazy(() => RequestsArgsSchema)]).optional(),
}).strict()

export const ResponsesArgsSchema: z.ZodType<Prisma.ResponsesArgs> = z.object({
  select: z.lazy(() => ResponsesSelectSchema).optional(),
  include: z.lazy(() => ResponsesIncludeSchema).optional(),
}).strict();

export const ResponsesSelectSchema: z.ZodType<Prisma.ResponsesSelect> = z.object({
  id: z.boolean().optional(),
  timestamp: z.boolean().optional(),
  request_id: z.boolean().optional(),
  status_code: z.boolean().optional(),
  data: z.boolean().optional(),
  requests: z.union([z.boolean(),z.lazy(() => RequestsArgsSchema)]).optional(),
}).strict()


/////////////////////////////////////////
// INPUT TYPES
/////////////////////////////////////////

export const Activity_eventsWhereInputSchema: z.ZodType<Prisma.Activity_eventsWhereInput> = z.object({
  AND: z.union([ z.lazy(() => Activity_eventsWhereInputSchema),z.lazy(() => Activity_eventsWhereInputSchema).array() ]).optional(),
  OR: z.lazy(() => Activity_eventsWhereInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => Activity_eventsWhereInputSchema),z.lazy(() => Activity_eventsWhereInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => UuidFilterSchema),z.string() ]).optional(),
  source_user_id: z.union([ z.lazy(() => UuidFilterSchema),z.string() ]).optional(),
  target_user_id: z.union([ z.lazy(() => UuidFilterSchema),z.string() ]).optional(),
  activity_type: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  timestamp: z.union([ z.lazy(() => DateTimeFilterSchema),z.coerce.date() ]).optional(),
  message: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  action: z.union([ z.lazy(() => StringNullableFilterSchema),z.string() ]).optional().nullable(),
  read_at: z.union([ z.lazy(() => DateTimeNullableFilterSchema),z.coerce.date() ]).optional().nullable(),
}).strict();

export const Activity_eventsOrderByWithRelationInputSchema: z.ZodType<Prisma.Activity_eventsOrderByWithRelationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  source_user_id: z.lazy(() => SortOrderSchema).optional(),
  target_user_id: z.lazy(() => SortOrderSchema).optional(),
  activity_type: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  message: z.lazy(() => SortOrderSchema).optional(),
  action: z.lazy(() => SortOrderSchema).optional(),
  read_at: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const Activity_eventsWhereUniqueInputSchema: z.ZodType<Prisma.Activity_eventsWhereUniqueInput> = z.object({
  id: z.string().uuid().optional()
}).strict();

export const Activity_eventsOrderByWithAggregationInputSchema: z.ZodType<Prisma.Activity_eventsOrderByWithAggregationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  source_user_id: z.lazy(() => SortOrderSchema).optional(),
  target_user_id: z.lazy(() => SortOrderSchema).optional(),
  activity_type: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  message: z.lazy(() => SortOrderSchema).optional(),
  action: z.lazy(() => SortOrderSchema).optional(),
  read_at: z.lazy(() => SortOrderSchema).optional(),
  _count: z.lazy(() => Activity_eventsCountOrderByAggregateInputSchema).optional(),
  _max: z.lazy(() => Activity_eventsMaxOrderByAggregateInputSchema).optional(),
  _min: z.lazy(() => Activity_eventsMinOrderByAggregateInputSchema).optional()
}).strict();

export const Activity_eventsScalarWhereWithAggregatesInputSchema: z.ZodType<Prisma.Activity_eventsScalarWhereWithAggregatesInput> = z.object({
  AND: z.union([ z.lazy(() => Activity_eventsScalarWhereWithAggregatesInputSchema),z.lazy(() => Activity_eventsScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  OR: z.lazy(() => Activity_eventsScalarWhereWithAggregatesInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => Activity_eventsScalarWhereWithAggregatesInputSchema),z.lazy(() => Activity_eventsScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => UuidWithAggregatesFilterSchema),z.string() ]).optional(),
  source_user_id: z.union([ z.lazy(() => UuidWithAggregatesFilterSchema),z.string() ]).optional(),
  target_user_id: z.union([ z.lazy(() => UuidWithAggregatesFilterSchema),z.string() ]).optional(),
  activity_type: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  timestamp: z.union([ z.lazy(() => DateTimeWithAggregatesFilterSchema),z.coerce.date() ]).optional(),
  message: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  action: z.union([ z.lazy(() => StringNullableWithAggregatesFilterSchema),z.string() ]).optional().nullable(),
  read_at: z.union([ z.lazy(() => DateTimeNullableWithAggregatesFilterSchema),z.coerce.date() ]).optional().nullable(),
}).strict();

export const Background_jobsWhereInputSchema: z.ZodType<Prisma.Background_jobsWhereInput> = z.object({
  AND: z.union([ z.lazy(() => Background_jobsWhereInputSchema),z.lazy(() => Background_jobsWhereInputSchema).array() ]).optional(),
  OR: z.lazy(() => Background_jobsWhereInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => Background_jobsWhereInputSchema),z.lazy(() => Background_jobsWhereInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => UuidFilterSchema),z.string() ]).optional(),
  timestamp: z.union([ z.lazy(() => DateTimeFilterSchema),z.coerce.date() ]).optional(),
  payload: z.lazy(() => JsonFilterSchema).optional(),
  completed: z.union([ z.lazy(() => BoolFilterSchema),z.boolean() ]).optional(),
  cancelled: z.union([ z.lazy(() => BoolFilterSchema),z.boolean() ]).optional(),
  progress: z.union([ z.lazy(() => FloatFilterSchema),z.number() ]).optional(),
  result: z.lazy(() => JsonNullableFilterSchema).optional()
}).strict();

export const Background_jobsOrderByWithRelationInputSchema: z.ZodType<Prisma.Background_jobsOrderByWithRelationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  payload: z.lazy(() => SortOrderSchema).optional(),
  completed: z.lazy(() => SortOrderSchema).optional(),
  cancelled: z.lazy(() => SortOrderSchema).optional(),
  progress: z.lazy(() => SortOrderSchema).optional(),
  result: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const Background_jobsWhereUniqueInputSchema: z.ZodType<Prisma.Background_jobsWhereUniqueInput> = z.object({
  id: z.string().uuid().optional()
}).strict();

export const Background_jobsOrderByWithAggregationInputSchema: z.ZodType<Prisma.Background_jobsOrderByWithAggregationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  payload: z.lazy(() => SortOrderSchema).optional(),
  completed: z.lazy(() => SortOrderSchema).optional(),
  cancelled: z.lazy(() => SortOrderSchema).optional(),
  progress: z.lazy(() => SortOrderSchema).optional(),
  result: z.lazy(() => SortOrderSchema).optional(),
  _count: z.lazy(() => Background_jobsCountOrderByAggregateInputSchema).optional(),
  _avg: z.lazy(() => Background_jobsAvgOrderByAggregateInputSchema).optional(),
  _max: z.lazy(() => Background_jobsMaxOrderByAggregateInputSchema).optional(),
  _min: z.lazy(() => Background_jobsMinOrderByAggregateInputSchema).optional(),
  _sum: z.lazy(() => Background_jobsSumOrderByAggregateInputSchema).optional()
}).strict();

export const Background_jobsScalarWhereWithAggregatesInputSchema: z.ZodType<Prisma.Background_jobsScalarWhereWithAggregatesInput> = z.object({
  AND: z.union([ z.lazy(() => Background_jobsScalarWhereWithAggregatesInputSchema),z.lazy(() => Background_jobsScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  OR: z.lazy(() => Background_jobsScalarWhereWithAggregatesInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => Background_jobsScalarWhereWithAggregatesInputSchema),z.lazy(() => Background_jobsScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => UuidWithAggregatesFilterSchema),z.string() ]).optional(),
  timestamp: z.union([ z.lazy(() => DateTimeWithAggregatesFilterSchema),z.coerce.date() ]).optional(),
  payload: z.lazy(() => JsonWithAggregatesFilterSchema).optional(),
  completed: z.union([ z.lazy(() => BoolWithAggregatesFilterSchema),z.boolean() ]).optional(),
  cancelled: z.union([ z.lazy(() => BoolWithAggregatesFilterSchema),z.boolean() ]).optional(),
  progress: z.union([ z.lazy(() => FloatWithAggregatesFilterSchema),z.number() ]).optional(),
  result: z.lazy(() => JsonNullableWithAggregatesFilterSchema).optional()
}).strict();

export const Chat_roomWhereInputSchema: z.ZodType<Prisma.Chat_roomWhereInput> = z.object({
  AND: z.union([ z.lazy(() => Chat_roomWhereInputSchema),z.lazy(() => Chat_roomWhereInputSchema).array() ]).optional(),
  OR: z.lazy(() => Chat_roomWhereInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => Chat_roomWhereInputSchema),z.lazy(() => Chat_roomWhereInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => UuidFilterSchema),z.string() ]).optional(),
  timestamp: z.union([ z.lazy(() => DateTimeFilterSchema),z.coerce.date() ]).optional(),
  username: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  message: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
}).strict();

export const Chat_roomOrderByWithRelationInputSchema: z.ZodType<Prisma.Chat_roomOrderByWithRelationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  username: z.lazy(() => SortOrderSchema).optional(),
  message: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const Chat_roomWhereUniqueInputSchema: z.ZodType<Prisma.Chat_roomWhereUniqueInput> = z.object({
  id: z.string().uuid().optional()
}).strict();

export const Chat_roomOrderByWithAggregationInputSchema: z.ZodType<Prisma.Chat_roomOrderByWithAggregationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  username: z.lazy(() => SortOrderSchema).optional(),
  message: z.lazy(() => SortOrderSchema).optional(),
  _count: z.lazy(() => Chat_roomCountOrderByAggregateInputSchema).optional(),
  _max: z.lazy(() => Chat_roomMaxOrderByAggregateInputSchema).optional(),
  _min: z.lazy(() => Chat_roomMinOrderByAggregateInputSchema).optional()
}).strict();

export const Chat_roomScalarWhereWithAggregatesInputSchema: z.ZodType<Prisma.Chat_roomScalarWhereWithAggregatesInput> = z.object({
  AND: z.union([ z.lazy(() => Chat_roomScalarWhereWithAggregatesInputSchema),z.lazy(() => Chat_roomScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  OR: z.lazy(() => Chat_roomScalarWhereWithAggregatesInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => Chat_roomScalarWhereWithAggregatesInputSchema),z.lazy(() => Chat_roomScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => UuidWithAggregatesFilterSchema),z.string() ]).optional(),
  timestamp: z.union([ z.lazy(() => DateTimeWithAggregatesFilterSchema),z.coerce.date() ]).optional(),
  username: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  message: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
}).strict();

export const Commerce_ordersWhereInputSchema: z.ZodType<Prisma.Commerce_ordersWhereInput> = z.object({
  AND: z.union([ z.lazy(() => Commerce_ordersWhereInputSchema),z.lazy(() => Commerce_ordersWhereInputSchema).array() ]).optional(),
  OR: z.lazy(() => Commerce_ordersWhereInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => Commerce_ordersWhereInputSchema),z.lazy(() => Commerce_ordersWhereInputSchema).array() ]).optional(),
  order_id: z.union([ z.lazy(() => UuidFilterSchema),z.string() ]).optional(),
  timestamp: z.union([ z.lazy(() => DateTimeFilterSchema),z.coerce.date() ]).optional(),
  price_amount: z.union([ z.lazy(() => FloatFilterSchema),z.number() ]).optional(),
  price_currency: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  promo_code: z.union([ z.lazy(() => StringNullableFilterSchema),z.string() ]).optional().nullable(),
  customer_full_name: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  country: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  product: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
}).strict();

export const Commerce_ordersOrderByWithRelationInputSchema: z.ZodType<Prisma.Commerce_ordersOrderByWithRelationInput> = z.object({
  order_id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  price_amount: z.lazy(() => SortOrderSchema).optional(),
  price_currency: z.lazy(() => SortOrderSchema).optional(),
  promo_code: z.lazy(() => SortOrderSchema).optional(),
  customer_full_name: z.lazy(() => SortOrderSchema).optional(),
  country: z.lazy(() => SortOrderSchema).optional(),
  product: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const Commerce_ordersWhereUniqueInputSchema: z.ZodType<Prisma.Commerce_ordersWhereUniqueInput> = z.object({
  order_id: z.string().uuid().optional()
}).strict();

export const Commerce_ordersOrderByWithAggregationInputSchema: z.ZodType<Prisma.Commerce_ordersOrderByWithAggregationInput> = z.object({
  order_id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  price_amount: z.lazy(() => SortOrderSchema).optional(),
  price_currency: z.lazy(() => SortOrderSchema).optional(),
  promo_code: z.lazy(() => SortOrderSchema).optional(),
  customer_full_name: z.lazy(() => SortOrderSchema).optional(),
  country: z.lazy(() => SortOrderSchema).optional(),
  product: z.lazy(() => SortOrderSchema).optional(),
  _count: z.lazy(() => Commerce_ordersCountOrderByAggregateInputSchema).optional(),
  _avg: z.lazy(() => Commerce_ordersAvgOrderByAggregateInputSchema).optional(),
  _max: z.lazy(() => Commerce_ordersMaxOrderByAggregateInputSchema).optional(),
  _min: z.lazy(() => Commerce_ordersMinOrderByAggregateInputSchema).optional(),
  _sum: z.lazy(() => Commerce_ordersSumOrderByAggregateInputSchema).optional()
}).strict();

export const Commerce_ordersScalarWhereWithAggregatesInputSchema: z.ZodType<Prisma.Commerce_ordersScalarWhereWithAggregatesInput> = z.object({
  AND: z.union([ z.lazy(() => Commerce_ordersScalarWhereWithAggregatesInputSchema),z.lazy(() => Commerce_ordersScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  OR: z.lazy(() => Commerce_ordersScalarWhereWithAggregatesInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => Commerce_ordersScalarWhereWithAggregatesInputSchema),z.lazy(() => Commerce_ordersScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  order_id: z.union([ z.lazy(() => UuidWithAggregatesFilterSchema),z.string() ]).optional(),
  timestamp: z.union([ z.lazy(() => DateTimeWithAggregatesFilterSchema),z.coerce.date() ]).optional(),
  price_amount: z.union([ z.lazy(() => FloatWithAggregatesFilterSchema),z.number() ]).optional(),
  price_currency: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  promo_code: z.union([ z.lazy(() => StringNullableWithAggregatesFilterSchema),z.string() ]).optional().nullable(),
  customer_full_name: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  country: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  product: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
}).strict();

export const LogsWhereInputSchema: z.ZodType<Prisma.LogsWhereInput> = z.object({
  AND: z.union([ z.lazy(() => LogsWhereInputSchema),z.lazy(() => LogsWhereInputSchema).array() ]).optional(),
  OR: z.lazy(() => LogsWhereInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => LogsWhereInputSchema),z.lazy(() => LogsWhereInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => UuidFilterSchema),z.string() ]).optional(),
  source_id: z.union([ z.lazy(() => UuidFilterSchema),z.string() ]).optional(),
  timestamp: z.union([ z.lazy(() => DateTimeFilterSchema),z.coerce.date() ]).optional(),
  content: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
}).strict();

export const LogsOrderByWithRelationInputSchema: z.ZodType<Prisma.LogsOrderByWithRelationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  source_id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  content: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const LogsWhereUniqueInputSchema: z.ZodType<Prisma.LogsWhereUniqueInput> = z.object({
  id: z.string().uuid().optional()
}).strict();

export const LogsOrderByWithAggregationInputSchema: z.ZodType<Prisma.LogsOrderByWithAggregationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  source_id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  content: z.lazy(() => SortOrderSchema).optional(),
  _count: z.lazy(() => LogsCountOrderByAggregateInputSchema).optional(),
  _max: z.lazy(() => LogsMaxOrderByAggregateInputSchema).optional(),
  _min: z.lazy(() => LogsMinOrderByAggregateInputSchema).optional()
}).strict();

export const LogsScalarWhereWithAggregatesInputSchema: z.ZodType<Prisma.LogsScalarWhereWithAggregatesInput> = z.object({
  AND: z.union([ z.lazy(() => LogsScalarWhereWithAggregatesInputSchema),z.lazy(() => LogsScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  OR: z.lazy(() => LogsScalarWhereWithAggregatesInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => LogsScalarWhereWithAggregatesInputSchema),z.lazy(() => LogsScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => UuidWithAggregatesFilterSchema),z.string() ]).optional(),
  source_id: z.union([ z.lazy(() => UuidWithAggregatesFilterSchema),z.string() ]).optional(),
  timestamp: z.union([ z.lazy(() => DateTimeWithAggregatesFilterSchema),z.coerce.date() ]).optional(),
  content: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
}).strict();

export const MonitoringWhereInputSchema: z.ZodType<Prisma.MonitoringWhereInput> = z.object({
  AND: z.union([ z.lazy(() => MonitoringWhereInputSchema),z.lazy(() => MonitoringWhereInputSchema).array() ]).optional(),
  OR: z.lazy(() => MonitoringWhereInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => MonitoringWhereInputSchema),z.lazy(() => MonitoringWhereInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => UuidFilterSchema),z.string() ]).optional(),
  timestamp: z.union([ z.lazy(() => DateTimeFilterSchema),z.coerce.date() ]).optional(),
  type: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  value: z.union([ z.lazy(() => FloatFilterSchema),z.number() ]).optional(),
}).strict();

export const MonitoringOrderByWithRelationInputSchema: z.ZodType<Prisma.MonitoringOrderByWithRelationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  type: z.lazy(() => SortOrderSchema).optional(),
  value: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const MonitoringWhereUniqueInputSchema: z.ZodType<Prisma.MonitoringWhereUniqueInput> = z.object({
  id: z.string().uuid().optional()
}).strict();

export const MonitoringOrderByWithAggregationInputSchema: z.ZodType<Prisma.MonitoringOrderByWithAggregationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  type: z.lazy(() => SortOrderSchema).optional(),
  value: z.lazy(() => SortOrderSchema).optional(),
  _count: z.lazy(() => MonitoringCountOrderByAggregateInputSchema).optional(),
  _avg: z.lazy(() => MonitoringAvgOrderByAggregateInputSchema).optional(),
  _max: z.lazy(() => MonitoringMaxOrderByAggregateInputSchema).optional(),
  _min: z.lazy(() => MonitoringMinOrderByAggregateInputSchema).optional(),
  _sum: z.lazy(() => MonitoringSumOrderByAggregateInputSchema).optional()
}).strict();

export const MonitoringScalarWhereWithAggregatesInputSchema: z.ZodType<Prisma.MonitoringScalarWhereWithAggregatesInput> = z.object({
  AND: z.union([ z.lazy(() => MonitoringScalarWhereWithAggregatesInputSchema),z.lazy(() => MonitoringScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  OR: z.lazy(() => MonitoringScalarWhereWithAggregatesInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => MonitoringScalarWhereWithAggregatesInputSchema),z.lazy(() => MonitoringScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => UuidWithAggregatesFilterSchema),z.string() ]).optional(),
  timestamp: z.union([ z.lazy(() => DateTimeWithAggregatesFilterSchema),z.coerce.date() ]).optional(),
  type: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  value: z.union([ z.lazy(() => FloatWithAggregatesFilterSchema),z.number() ]).optional(),
}).strict();

export const RequestsWhereInputSchema: z.ZodType<Prisma.RequestsWhereInput> = z.object({
  AND: z.union([ z.lazy(() => RequestsWhereInputSchema),z.lazy(() => RequestsWhereInputSchema).array() ]).optional(),
  OR: z.lazy(() => RequestsWhereInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => RequestsWhereInputSchema),z.lazy(() => RequestsWhereInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => UuidFilterSchema),z.string() ]).optional(),
  timestamp: z.union([ z.lazy(() => DateTimeFilterSchema),z.coerce.date() ]).optional(),
  path: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  method: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  data: z.lazy(() => JsonNullableFilterSchema).optional(),
  processing: z.union([ z.lazy(() => BoolFilterSchema),z.boolean() ]).optional(),
  cancelled: z.union([ z.lazy(() => BoolFilterSchema),z.boolean() ]).optional(),
  responses: z.lazy(() => ResponsesListRelationFilterSchema).optional()
}).strict();

export const RequestsOrderByWithRelationInputSchema: z.ZodType<Prisma.RequestsOrderByWithRelationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  path: z.lazy(() => SortOrderSchema).optional(),
  method: z.lazy(() => SortOrderSchema).optional(),
  data: z.lazy(() => SortOrderSchema).optional(),
  processing: z.lazy(() => SortOrderSchema).optional(),
  cancelled: z.lazy(() => SortOrderSchema).optional(),
  responses: z.lazy(() => ResponsesOrderByRelationAggregateInputSchema).optional()
}).strict();

export const RequestsWhereUniqueInputSchema: z.ZodType<Prisma.RequestsWhereUniqueInput> = z.object({
  id: z.string().uuid().optional()
}).strict();

export const RequestsOrderByWithAggregationInputSchema: z.ZodType<Prisma.RequestsOrderByWithAggregationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  path: z.lazy(() => SortOrderSchema).optional(),
  method: z.lazy(() => SortOrderSchema).optional(),
  data: z.lazy(() => SortOrderSchema).optional(),
  processing: z.lazy(() => SortOrderSchema).optional(),
  cancelled: z.lazy(() => SortOrderSchema).optional(),
  _count: z.lazy(() => RequestsCountOrderByAggregateInputSchema).optional(),
  _max: z.lazy(() => RequestsMaxOrderByAggregateInputSchema).optional(),
  _min: z.lazy(() => RequestsMinOrderByAggregateInputSchema).optional()
}).strict();

export const RequestsScalarWhereWithAggregatesInputSchema: z.ZodType<Prisma.RequestsScalarWhereWithAggregatesInput> = z.object({
  AND: z.union([ z.lazy(() => RequestsScalarWhereWithAggregatesInputSchema),z.lazy(() => RequestsScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  OR: z.lazy(() => RequestsScalarWhereWithAggregatesInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => RequestsScalarWhereWithAggregatesInputSchema),z.lazy(() => RequestsScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => UuidWithAggregatesFilterSchema),z.string() ]).optional(),
  timestamp: z.union([ z.lazy(() => DateTimeWithAggregatesFilterSchema),z.coerce.date() ]).optional(),
  path: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  method: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  data: z.lazy(() => JsonNullableWithAggregatesFilterSchema).optional(),
  processing: z.union([ z.lazy(() => BoolWithAggregatesFilterSchema),z.boolean() ]).optional(),
  cancelled: z.union([ z.lazy(() => BoolWithAggregatesFilterSchema),z.boolean() ]).optional(),
}).strict();

export const ResponsesWhereInputSchema: z.ZodType<Prisma.ResponsesWhereInput> = z.object({
  AND: z.union([ z.lazy(() => ResponsesWhereInputSchema),z.lazy(() => ResponsesWhereInputSchema).array() ]).optional(),
  OR: z.lazy(() => ResponsesWhereInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => ResponsesWhereInputSchema),z.lazy(() => ResponsesWhereInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => UuidFilterSchema),z.string() ]).optional(),
  timestamp: z.union([ z.lazy(() => DateTimeFilterSchema),z.coerce.date() ]).optional(),
  request_id: z.union([ z.lazy(() => UuidFilterSchema),z.string() ]).optional(),
  status_code: z.union([ z.lazy(() => IntFilterSchema),z.number() ]).optional(),
  data: z.lazy(() => JsonNullableFilterSchema).optional(),
  requests: z.union([ z.lazy(() => RequestsRelationFilterSchema),z.lazy(() => RequestsWhereInputSchema) ]).optional(),
}).strict();

export const ResponsesOrderByWithRelationInputSchema: z.ZodType<Prisma.ResponsesOrderByWithRelationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  request_id: z.lazy(() => SortOrderSchema).optional(),
  status_code: z.lazy(() => SortOrderSchema).optional(),
  data: z.lazy(() => SortOrderSchema).optional(),
  requests: z.lazy(() => RequestsOrderByWithRelationInputSchema).optional()
}).strict();

export const ResponsesWhereUniqueInputSchema: z.ZodType<Prisma.ResponsesWhereUniqueInput> = z.object({
  id: z.string().uuid().optional()
}).strict();

export const ResponsesOrderByWithAggregationInputSchema: z.ZodType<Prisma.ResponsesOrderByWithAggregationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  request_id: z.lazy(() => SortOrderSchema).optional(),
  status_code: z.lazy(() => SortOrderSchema).optional(),
  data: z.lazy(() => SortOrderSchema).optional(),
  _count: z.lazy(() => ResponsesCountOrderByAggregateInputSchema).optional(),
  _avg: z.lazy(() => ResponsesAvgOrderByAggregateInputSchema).optional(),
  _max: z.lazy(() => ResponsesMaxOrderByAggregateInputSchema).optional(),
  _min: z.lazy(() => ResponsesMinOrderByAggregateInputSchema).optional(),
  _sum: z.lazy(() => ResponsesSumOrderByAggregateInputSchema).optional()
}).strict();

export const ResponsesScalarWhereWithAggregatesInputSchema: z.ZodType<Prisma.ResponsesScalarWhereWithAggregatesInput> = z.object({
  AND: z.union([ z.lazy(() => ResponsesScalarWhereWithAggregatesInputSchema),z.lazy(() => ResponsesScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  OR: z.lazy(() => ResponsesScalarWhereWithAggregatesInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => ResponsesScalarWhereWithAggregatesInputSchema),z.lazy(() => ResponsesScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => UuidWithAggregatesFilterSchema),z.string() ]).optional(),
  timestamp: z.union([ z.lazy(() => DateTimeWithAggregatesFilterSchema),z.coerce.date() ]).optional(),
  request_id: z.union([ z.lazy(() => UuidWithAggregatesFilterSchema),z.string() ]).optional(),
  status_code: z.union([ z.lazy(() => IntWithAggregatesFilterSchema),z.number() ]).optional(),
  data: z.lazy(() => JsonNullableWithAggregatesFilterSchema).optional()
}).strict();

export const Activity_eventsCreateInputSchema: z.ZodType<Prisma.Activity_eventsCreateInput> = z.object({
  id: z.string().uuid(),
  source_user_id: z.string().uuid(),
  target_user_id: z.string().uuid(),
  activity_type: z.string(),
  timestamp: z.coerce.date(),
  message: z.string(),
  action: z.string().optional().nullable(),
  read_at: z.coerce.date().optional().nullable()
}).strict();

export const Activity_eventsUncheckedCreateInputSchema: z.ZodType<Prisma.Activity_eventsUncheckedCreateInput> = z.object({
  id: z.string().uuid(),
  source_user_id: z.string().uuid(),
  target_user_id: z.string().uuid(),
  activity_type: z.string(),
  timestamp: z.coerce.date(),
  message: z.string(),
  action: z.string().optional().nullable(),
  read_at: z.coerce.date().optional().nullable()
}).strict();

export const Activity_eventsUpdateInputSchema: z.ZodType<Prisma.Activity_eventsUpdateInput> = z.object({
  id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  source_user_id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  target_user_id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  activity_type: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  message: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  action: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  read_at: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
}).strict();

export const Activity_eventsUncheckedUpdateInputSchema: z.ZodType<Prisma.Activity_eventsUncheckedUpdateInput> = z.object({
  id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  source_user_id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  target_user_id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  activity_type: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  message: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  action: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  read_at: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
}).strict();

export const Activity_eventsCreateManyInputSchema: z.ZodType<Prisma.Activity_eventsCreateManyInput> = z.object({
  id: z.string().uuid(),
  source_user_id: z.string().uuid(),
  target_user_id: z.string().uuid(),
  activity_type: z.string(),
  timestamp: z.coerce.date(),
  message: z.string(),
  action: z.string().optional().nullable(),
  read_at: z.coerce.date().optional().nullable()
}).strict();

export const Activity_eventsUpdateManyMutationInputSchema: z.ZodType<Prisma.Activity_eventsUpdateManyMutationInput> = z.object({
  id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  source_user_id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  target_user_id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  activity_type: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  message: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  action: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  read_at: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
}).strict();

export const Activity_eventsUncheckedUpdateManyInputSchema: z.ZodType<Prisma.Activity_eventsUncheckedUpdateManyInput> = z.object({
  id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  source_user_id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  target_user_id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  activity_type: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  message: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  action: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  read_at: z.union([ z.coerce.date(),z.lazy(() => NullableDateTimeFieldUpdateOperationsInputSchema) ]).optional().nullable(),
}).strict();

export const Background_jobsCreateInputSchema: z.ZodType<Prisma.Background_jobsCreateInput> = z.object({
  id: z.string().uuid(),
  timestamp: z.coerce.date(),
  payload: z.union([ z.lazy(() => JsonNullValueInputSchema),InputJsonValue ]),
  completed: z.boolean(),
  cancelled: z.boolean(),
  progress: z.number().or(z.nan()),
  result: z.union([ z.lazy(() => NullableJsonNullValueInputSchema),InputJsonValue ]).optional(),
}).strict();

export const Background_jobsUncheckedCreateInputSchema: z.ZodType<Prisma.Background_jobsUncheckedCreateInput> = z.object({
  id: z.string().uuid(),
  timestamp: z.coerce.date(),
  payload: z.union([ z.lazy(() => JsonNullValueInputSchema),InputJsonValue ]),
  completed: z.boolean(),
  cancelled: z.boolean(),
  progress: z.number().or(z.nan()),
  result: z.union([ z.lazy(() => NullableJsonNullValueInputSchema),InputJsonValue ]).optional(),
}).strict();

export const Background_jobsUpdateInputSchema: z.ZodType<Prisma.Background_jobsUpdateInput> = z.object({
  id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  payload: z.union([ z.lazy(() => JsonNullValueInputSchema),InputJsonValue ]).optional(),
  completed: z.union([ z.boolean(),z.lazy(() => BoolFieldUpdateOperationsInputSchema) ]).optional(),
  cancelled: z.union([ z.boolean(),z.lazy(() => BoolFieldUpdateOperationsInputSchema) ]).optional(),
  progress: z.union([ z.number().or(z.nan()),z.lazy(() => FloatFieldUpdateOperationsInputSchema) ]).optional(),
  result: z.union([ z.lazy(() => NullableJsonNullValueInputSchema),InputJsonValue ]).optional(),
}).strict();

export const Background_jobsUncheckedUpdateInputSchema: z.ZodType<Prisma.Background_jobsUncheckedUpdateInput> = z.object({
  id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  payload: z.union([ z.lazy(() => JsonNullValueInputSchema),InputJsonValue ]).optional(),
  completed: z.union([ z.boolean(),z.lazy(() => BoolFieldUpdateOperationsInputSchema) ]).optional(),
  cancelled: z.union([ z.boolean(),z.lazy(() => BoolFieldUpdateOperationsInputSchema) ]).optional(),
  progress: z.union([ z.number().or(z.nan()),z.lazy(() => FloatFieldUpdateOperationsInputSchema) ]).optional(),
  result: z.union([ z.lazy(() => NullableJsonNullValueInputSchema),InputJsonValue ]).optional(),
}).strict();

export const Background_jobsCreateManyInputSchema: z.ZodType<Prisma.Background_jobsCreateManyInput> = z.object({
  id: z.string().uuid(),
  timestamp: z.coerce.date(),
  payload: z.union([ z.lazy(() => JsonNullValueInputSchema),InputJsonValue ]),
  completed: z.boolean(),
  cancelled: z.boolean(),
  progress: z.number().or(z.nan()),
  result: z.union([ z.lazy(() => NullableJsonNullValueInputSchema),InputJsonValue ]).optional(),
}).strict();

export const Background_jobsUpdateManyMutationInputSchema: z.ZodType<Prisma.Background_jobsUpdateManyMutationInput> = z.object({
  id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  payload: z.union([ z.lazy(() => JsonNullValueInputSchema),InputJsonValue ]).optional(),
  completed: z.union([ z.boolean(),z.lazy(() => BoolFieldUpdateOperationsInputSchema) ]).optional(),
  cancelled: z.union([ z.boolean(),z.lazy(() => BoolFieldUpdateOperationsInputSchema) ]).optional(),
  progress: z.union([ z.number().or(z.nan()),z.lazy(() => FloatFieldUpdateOperationsInputSchema) ]).optional(),
  result: z.union([ z.lazy(() => NullableJsonNullValueInputSchema),InputJsonValue ]).optional(),
}).strict();

export const Background_jobsUncheckedUpdateManyInputSchema: z.ZodType<Prisma.Background_jobsUncheckedUpdateManyInput> = z.object({
  id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  payload: z.union([ z.lazy(() => JsonNullValueInputSchema),InputJsonValue ]).optional(),
  completed: z.union([ z.boolean(),z.lazy(() => BoolFieldUpdateOperationsInputSchema) ]).optional(),
  cancelled: z.union([ z.boolean(),z.lazy(() => BoolFieldUpdateOperationsInputSchema) ]).optional(),
  progress: z.union([ z.number().or(z.nan()),z.lazy(() => FloatFieldUpdateOperationsInputSchema) ]).optional(),
  result: z.union([ z.lazy(() => NullableJsonNullValueInputSchema),InputJsonValue ]).optional(),
}).strict();

export const Chat_roomCreateInputSchema: z.ZodType<Prisma.Chat_roomCreateInput> = z.object({
  id: z.string().uuid(),
  timestamp: z.coerce.date(),
  username: z.string(),
  message: z.string()
}).strict();

export const Chat_roomUncheckedCreateInputSchema: z.ZodType<Prisma.Chat_roomUncheckedCreateInput> = z.object({
  id: z.string().uuid(),
  timestamp: z.coerce.date(),
  username: z.string(),
  message: z.string()
}).strict();

export const Chat_roomUpdateInputSchema: z.ZodType<Prisma.Chat_roomUpdateInput> = z.object({
  id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  username: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  message: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const Chat_roomUncheckedUpdateInputSchema: z.ZodType<Prisma.Chat_roomUncheckedUpdateInput> = z.object({
  id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  username: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  message: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const Chat_roomCreateManyInputSchema: z.ZodType<Prisma.Chat_roomCreateManyInput> = z.object({
  id: z.string().uuid(),
  timestamp: z.coerce.date(),
  username: z.string(),
  message: z.string()
}).strict();

export const Chat_roomUpdateManyMutationInputSchema: z.ZodType<Prisma.Chat_roomUpdateManyMutationInput> = z.object({
  id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  username: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  message: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const Chat_roomUncheckedUpdateManyInputSchema: z.ZodType<Prisma.Chat_roomUncheckedUpdateManyInput> = z.object({
  id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  username: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  message: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const Commerce_ordersCreateInputSchema: z.ZodType<Prisma.Commerce_ordersCreateInput> = z.object({
  order_id: z.string().uuid(),
  timestamp: z.coerce.date(),
  price_amount: z.number().or(z.nan()),
  price_currency: z.string(),
  promo_code: z.string().optional().nullable(),
  customer_full_name: z.string(),
  country: z.string(),
  product: z.string()
}).strict();

export const Commerce_ordersUncheckedCreateInputSchema: z.ZodType<Prisma.Commerce_ordersUncheckedCreateInput> = z.object({
  order_id: z.string().uuid(),
  timestamp: z.coerce.date(),
  price_amount: z.number().or(z.nan()),
  price_currency: z.string(),
  promo_code: z.string().optional().nullable(),
  customer_full_name: z.string(),
  country: z.string(),
  product: z.string()
}).strict();

export const Commerce_ordersUpdateInputSchema: z.ZodType<Prisma.Commerce_ordersUpdateInput> = z.object({
  order_id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  price_amount: z.union([ z.number().or(z.nan()),z.lazy(() => FloatFieldUpdateOperationsInputSchema) ]).optional(),
  price_currency: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  promo_code: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  customer_full_name: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  country: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  product: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const Commerce_ordersUncheckedUpdateInputSchema: z.ZodType<Prisma.Commerce_ordersUncheckedUpdateInput> = z.object({
  order_id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  price_amount: z.union([ z.number().or(z.nan()),z.lazy(() => FloatFieldUpdateOperationsInputSchema) ]).optional(),
  price_currency: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  promo_code: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  customer_full_name: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  country: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  product: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const Commerce_ordersCreateManyInputSchema: z.ZodType<Prisma.Commerce_ordersCreateManyInput> = z.object({
  order_id: z.string().uuid(),
  timestamp: z.coerce.date(),
  price_amount: z.number().or(z.nan()),
  price_currency: z.string(),
  promo_code: z.string().optional().nullable(),
  customer_full_name: z.string(),
  country: z.string(),
  product: z.string()
}).strict();

export const Commerce_ordersUpdateManyMutationInputSchema: z.ZodType<Prisma.Commerce_ordersUpdateManyMutationInput> = z.object({
  order_id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  price_amount: z.union([ z.number().or(z.nan()),z.lazy(() => FloatFieldUpdateOperationsInputSchema) ]).optional(),
  price_currency: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  promo_code: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  customer_full_name: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  country: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  product: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const Commerce_ordersUncheckedUpdateManyInputSchema: z.ZodType<Prisma.Commerce_ordersUncheckedUpdateManyInput> = z.object({
  order_id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  price_amount: z.union([ z.number().or(z.nan()),z.lazy(() => FloatFieldUpdateOperationsInputSchema) ]).optional(),
  price_currency: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  promo_code: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
  customer_full_name: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  country: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  product: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const LogsCreateInputSchema: z.ZodType<Prisma.LogsCreateInput> = z.object({
  id: z.string().uuid(),
  source_id: z.string().uuid(),
  timestamp: z.coerce.date(),
  content: z.string()
}).strict();

export const LogsUncheckedCreateInputSchema: z.ZodType<Prisma.LogsUncheckedCreateInput> = z.object({
  id: z.string().uuid(),
  source_id: z.string().uuid(),
  timestamp: z.coerce.date(),
  content: z.string()
}).strict();

export const LogsUpdateInputSchema: z.ZodType<Prisma.LogsUpdateInput> = z.object({
  id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  source_id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  content: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const LogsUncheckedUpdateInputSchema: z.ZodType<Prisma.LogsUncheckedUpdateInput> = z.object({
  id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  source_id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  content: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const LogsCreateManyInputSchema: z.ZodType<Prisma.LogsCreateManyInput> = z.object({
  id: z.string().uuid(),
  source_id: z.string().uuid(),
  timestamp: z.coerce.date(),
  content: z.string()
}).strict();

export const LogsUpdateManyMutationInputSchema: z.ZodType<Prisma.LogsUpdateManyMutationInput> = z.object({
  id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  source_id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  content: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const LogsUncheckedUpdateManyInputSchema: z.ZodType<Prisma.LogsUncheckedUpdateManyInput> = z.object({
  id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  source_id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  content: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const MonitoringCreateInputSchema: z.ZodType<Prisma.MonitoringCreateInput> = z.object({
  id: z.string().uuid(),
  timestamp: z.coerce.date(),
  type: z.string(),
  value: z.number().or(z.nan())
}).strict();

export const MonitoringUncheckedCreateInputSchema: z.ZodType<Prisma.MonitoringUncheckedCreateInput> = z.object({
  id: z.string().uuid(),
  timestamp: z.coerce.date(),
  type: z.string(),
  value: z.number().or(z.nan())
}).strict();

export const MonitoringUpdateInputSchema: z.ZodType<Prisma.MonitoringUpdateInput> = z.object({
  id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  type: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  value: z.union([ z.number().or(z.nan()),z.lazy(() => FloatFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const MonitoringUncheckedUpdateInputSchema: z.ZodType<Prisma.MonitoringUncheckedUpdateInput> = z.object({
  id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  type: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  value: z.union([ z.number().or(z.nan()),z.lazy(() => FloatFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const MonitoringCreateManyInputSchema: z.ZodType<Prisma.MonitoringCreateManyInput> = z.object({
  id: z.string().uuid(),
  timestamp: z.coerce.date(),
  type: z.string(),
  value: z.number().or(z.nan())
}).strict();

export const MonitoringUpdateManyMutationInputSchema: z.ZodType<Prisma.MonitoringUpdateManyMutationInput> = z.object({
  id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  type: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  value: z.union([ z.number().or(z.nan()),z.lazy(() => FloatFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const MonitoringUncheckedUpdateManyInputSchema: z.ZodType<Prisma.MonitoringUncheckedUpdateManyInput> = z.object({
  id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  type: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  value: z.union([ z.number().or(z.nan()),z.lazy(() => FloatFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const RequestsCreateInputSchema: z.ZodType<Prisma.RequestsCreateInput> = z.object({
  id: z.string().uuid(),
  timestamp: z.coerce.date(),
  path: z.string(),
  method: z.string(),
  data: z.union([ z.lazy(() => NullableJsonNullValueInputSchema),InputJsonValue ]).optional(),
  processing: z.boolean(),
  cancelled: z.boolean(),
  responses: z.lazy(() => ResponsesCreateNestedManyWithoutRequestsInputSchema).optional()
}).strict();

export const RequestsUncheckedCreateInputSchema: z.ZodType<Prisma.RequestsUncheckedCreateInput> = z.object({
  id: z.string().uuid(),
  timestamp: z.coerce.date(),
  path: z.string(),
  method: z.string(),
  data: z.union([ z.lazy(() => NullableJsonNullValueInputSchema),InputJsonValue ]).optional(),
  processing: z.boolean(),
  cancelled: z.boolean(),
  responses: z.lazy(() => ResponsesUncheckedCreateNestedManyWithoutRequestsInputSchema).optional()
}).strict();

export const RequestsUpdateInputSchema: z.ZodType<Prisma.RequestsUpdateInput> = z.object({
  id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  path: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  method: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  data: z.union([ z.lazy(() => NullableJsonNullValueInputSchema),InputJsonValue ]).optional(),
  processing: z.union([ z.boolean(),z.lazy(() => BoolFieldUpdateOperationsInputSchema) ]).optional(),
  cancelled: z.union([ z.boolean(),z.lazy(() => BoolFieldUpdateOperationsInputSchema) ]).optional(),
  responses: z.lazy(() => ResponsesUpdateManyWithoutRequestsNestedInputSchema).optional()
}).strict();

export const RequestsUncheckedUpdateInputSchema: z.ZodType<Prisma.RequestsUncheckedUpdateInput> = z.object({
  id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  path: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  method: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  data: z.union([ z.lazy(() => NullableJsonNullValueInputSchema),InputJsonValue ]).optional(),
  processing: z.union([ z.boolean(),z.lazy(() => BoolFieldUpdateOperationsInputSchema) ]).optional(),
  cancelled: z.union([ z.boolean(),z.lazy(() => BoolFieldUpdateOperationsInputSchema) ]).optional(),
  responses: z.lazy(() => ResponsesUncheckedUpdateManyWithoutRequestsNestedInputSchema).optional()
}).strict();

export const RequestsCreateManyInputSchema: z.ZodType<Prisma.RequestsCreateManyInput> = z.object({
  id: z.string().uuid(),
  timestamp: z.coerce.date(),
  path: z.string(),
  method: z.string(),
  data: z.union([ z.lazy(() => NullableJsonNullValueInputSchema),InputJsonValue ]).optional(),
  processing: z.boolean(),
  cancelled: z.boolean()
}).strict();

export const RequestsUpdateManyMutationInputSchema: z.ZodType<Prisma.RequestsUpdateManyMutationInput> = z.object({
  id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  path: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  method: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  data: z.union([ z.lazy(() => NullableJsonNullValueInputSchema),InputJsonValue ]).optional(),
  processing: z.union([ z.boolean(),z.lazy(() => BoolFieldUpdateOperationsInputSchema) ]).optional(),
  cancelled: z.union([ z.boolean(),z.lazy(() => BoolFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const RequestsUncheckedUpdateManyInputSchema: z.ZodType<Prisma.RequestsUncheckedUpdateManyInput> = z.object({
  id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  path: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  method: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  data: z.union([ z.lazy(() => NullableJsonNullValueInputSchema),InputJsonValue ]).optional(),
  processing: z.union([ z.boolean(),z.lazy(() => BoolFieldUpdateOperationsInputSchema) ]).optional(),
  cancelled: z.union([ z.boolean(),z.lazy(() => BoolFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const ResponsesCreateInputSchema: z.ZodType<Prisma.ResponsesCreateInput> = z.object({
  id: z.string().uuid(),
  timestamp: z.coerce.date(),
  status_code: z.number().int().gte(-2147483648).lte(2147483647),
  data: z.union([ z.lazy(() => NullableJsonNullValueInputSchema),InputJsonValue ]).optional(),
  requests: z.lazy(() => RequestsCreateNestedOneWithoutResponsesInputSchema)
}).strict();

export const ResponsesUncheckedCreateInputSchema: z.ZodType<Prisma.ResponsesUncheckedCreateInput> = z.object({
  id: z.string().uuid(),
  timestamp: z.coerce.date(),
  request_id: z.string().uuid(),
  status_code: z.number().int().gte(-2147483648).lte(2147483647),
  data: z.union([ z.lazy(() => NullableJsonNullValueInputSchema),InputJsonValue ]).optional(),
}).strict();

export const ResponsesUpdateInputSchema: z.ZodType<Prisma.ResponsesUpdateInput> = z.object({
  id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  status_code: z.union([ z.number().int().gte(-2147483648).lte(2147483647),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  data: z.union([ z.lazy(() => NullableJsonNullValueInputSchema),InputJsonValue ]).optional(),
  requests: z.lazy(() => RequestsUpdateOneRequiredWithoutResponsesNestedInputSchema).optional()
}).strict();

export const ResponsesUncheckedUpdateInputSchema: z.ZodType<Prisma.ResponsesUncheckedUpdateInput> = z.object({
  id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  request_id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  status_code: z.union([ z.number().int().gte(-2147483648).lte(2147483647),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  data: z.union([ z.lazy(() => NullableJsonNullValueInputSchema),InputJsonValue ]).optional(),
}).strict();

export const ResponsesCreateManyInputSchema: z.ZodType<Prisma.ResponsesCreateManyInput> = z.object({
  id: z.string().uuid(),
  timestamp: z.coerce.date(),
  request_id: z.string().uuid(),
  status_code: z.number().int().gte(-2147483648).lte(2147483647),
  data: z.union([ z.lazy(() => NullableJsonNullValueInputSchema),InputJsonValue ]).optional(),
}).strict();

export const ResponsesUpdateManyMutationInputSchema: z.ZodType<Prisma.ResponsesUpdateManyMutationInput> = z.object({
  id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  status_code: z.union([ z.number().int().gte(-2147483648).lte(2147483647),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  data: z.union([ z.lazy(() => NullableJsonNullValueInputSchema),InputJsonValue ]).optional(),
}).strict();

export const ResponsesUncheckedUpdateManyInputSchema: z.ZodType<Prisma.ResponsesUncheckedUpdateManyInput> = z.object({
  id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  request_id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  status_code: z.union([ z.number().int().gte(-2147483648).lte(2147483647),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  data: z.union([ z.lazy(() => NullableJsonNullValueInputSchema),InputJsonValue ]).optional(),
}).strict();

export const UuidFilterSchema: z.ZodType<Prisma.UuidFilter> = z.object({
  equals: z.string().optional(),
  in: z.string().array().optional(),
  notIn: z.string().array().optional(),
  lt: z.string().optional(),
  lte: z.string().optional(),
  gt: z.string().optional(),
  gte: z.string().optional(),
  mode: z.lazy(() => QueryModeSchema).optional(),
  not: z.union([ z.string(),z.lazy(() => NestedUuidFilterSchema) ]).optional(),
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

export const DateTimeFilterSchema: z.ZodType<Prisma.DateTimeFilter> = z.object({
  equals: z.coerce.date().optional(),
  in: z.coerce.date().array().optional(),
  notIn: z.coerce.date().array().optional(),
  lt: z.coerce.date().optional(),
  lte: z.coerce.date().optional(),
  gt: z.coerce.date().optional(),
  gte: z.coerce.date().optional(),
  not: z.union([ z.coerce.date(),z.lazy(() => NestedDateTimeFilterSchema) ]).optional(),
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

export const DateTimeNullableFilterSchema: z.ZodType<Prisma.DateTimeNullableFilter> = z.object({
  equals: z.coerce.date().optional().nullable(),
  in: z.coerce.date().array().optional().nullable(),
  notIn: z.coerce.date().array().optional().nullable(),
  lt: z.coerce.date().optional(),
  lte: z.coerce.date().optional(),
  gt: z.coerce.date().optional(),
  gte: z.coerce.date().optional(),
  not: z.union([ z.coerce.date(),z.lazy(() => NestedDateTimeNullableFilterSchema) ]).optional().nullable(),
}).strict();

export const Activity_eventsCountOrderByAggregateInputSchema: z.ZodType<Prisma.Activity_eventsCountOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  source_user_id: z.lazy(() => SortOrderSchema).optional(),
  target_user_id: z.lazy(() => SortOrderSchema).optional(),
  activity_type: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  message: z.lazy(() => SortOrderSchema).optional(),
  action: z.lazy(() => SortOrderSchema).optional(),
  read_at: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const Activity_eventsMaxOrderByAggregateInputSchema: z.ZodType<Prisma.Activity_eventsMaxOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  source_user_id: z.lazy(() => SortOrderSchema).optional(),
  target_user_id: z.lazy(() => SortOrderSchema).optional(),
  activity_type: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  message: z.lazy(() => SortOrderSchema).optional(),
  action: z.lazy(() => SortOrderSchema).optional(),
  read_at: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const Activity_eventsMinOrderByAggregateInputSchema: z.ZodType<Prisma.Activity_eventsMinOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  source_user_id: z.lazy(() => SortOrderSchema).optional(),
  target_user_id: z.lazy(() => SortOrderSchema).optional(),
  activity_type: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  message: z.lazy(() => SortOrderSchema).optional(),
  action: z.lazy(() => SortOrderSchema).optional(),
  read_at: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const UuidWithAggregatesFilterSchema: z.ZodType<Prisma.UuidWithAggregatesFilter> = z.object({
  equals: z.string().optional(),
  in: z.string().array().optional(),
  notIn: z.string().array().optional(),
  lt: z.string().optional(),
  lte: z.string().optional(),
  gt: z.string().optional(),
  gte: z.string().optional(),
  mode: z.lazy(() => QueryModeSchema).optional(),
  not: z.union([ z.string(),z.lazy(() => NestedUuidWithAggregatesFilterSchema) ]).optional(),
  _count: z.lazy(() => NestedIntFilterSchema).optional(),
  _min: z.lazy(() => NestedStringFilterSchema).optional(),
  _max: z.lazy(() => NestedStringFilterSchema).optional()
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

export const DateTimeWithAggregatesFilterSchema: z.ZodType<Prisma.DateTimeWithAggregatesFilter> = z.object({
  equals: z.coerce.date().optional(),
  in: z.coerce.date().array().optional(),
  notIn: z.coerce.date().array().optional(),
  lt: z.coerce.date().optional(),
  lte: z.coerce.date().optional(),
  gt: z.coerce.date().optional(),
  gte: z.coerce.date().optional(),
  not: z.union([ z.coerce.date(),z.lazy(() => NestedDateTimeWithAggregatesFilterSchema) ]).optional(),
  _count: z.lazy(() => NestedIntFilterSchema).optional(),
  _min: z.lazy(() => NestedDateTimeFilterSchema).optional(),
  _max: z.lazy(() => NestedDateTimeFilterSchema).optional()
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

export const DateTimeNullableWithAggregatesFilterSchema: z.ZodType<Prisma.DateTimeNullableWithAggregatesFilter> = z.object({
  equals: z.coerce.date().optional().nullable(),
  in: z.coerce.date().array().optional().nullable(),
  notIn: z.coerce.date().array().optional().nullable(),
  lt: z.coerce.date().optional(),
  lte: z.coerce.date().optional(),
  gt: z.coerce.date().optional(),
  gte: z.coerce.date().optional(),
  not: z.union([ z.coerce.date(),z.lazy(() => NestedDateTimeNullableWithAggregatesFilterSchema) ]).optional().nullable(),
  _count: z.lazy(() => NestedIntNullableFilterSchema).optional(),
  _min: z.lazy(() => NestedDateTimeNullableFilterSchema).optional(),
  _max: z.lazy(() => NestedDateTimeNullableFilterSchema).optional()
}).strict();

export const JsonFilterSchema: z.ZodType<Prisma.JsonFilter> = z.object({
  equals: z.union([ InputJsonValue,z.lazy(() => JsonNullValueFilterSchema) ]).optional(),
  path: z.string().array().optional(),
  string_contains: z.string().optional(),
  string_starts_with: z.string().optional(),
  string_ends_with: z.string().optional(),
  array_contains: InputJsonValue.optional().nullable(),
  array_starts_with: InputJsonValue.optional().nullable(),
  array_ends_with: InputJsonValue.optional().nullable(),
  lt: InputJsonValue.optional(),
  lte: InputJsonValue.optional(),
  gt: InputJsonValue.optional(),
  gte: InputJsonValue.optional(),
  not: z.union([ InputJsonValue,z.lazy(() => JsonNullValueFilterSchema) ]).optional(),
}).strict();

export const BoolFilterSchema: z.ZodType<Prisma.BoolFilter> = z.object({
  equals: z.boolean().optional(),
  not: z.union([ z.boolean(),z.lazy(() => NestedBoolFilterSchema) ]).optional(),
}).strict();

export const FloatFilterSchema: z.ZodType<Prisma.FloatFilter> = z.object({
  equals: z.number().optional(),
  in: z.number().array().optional(),
  notIn: z.number().array().optional(),
  lt: z.number().optional(),
  lte: z.number().optional(),
  gt: z.number().optional(),
  gte: z.number().optional(),
  not: z.union([ z.number(),z.lazy(() => NestedFloatFilterSchema) ]).optional(),
}).strict();

export const JsonNullableFilterSchema: z.ZodType<Prisma.JsonNullableFilter> = z.object({
  equals: z.union([ InputJsonValue,z.lazy(() => JsonNullValueFilterSchema) ]).optional(),
  path: z.string().array().optional(),
  string_contains: z.string().optional(),
  string_starts_with: z.string().optional(),
  string_ends_with: z.string().optional(),
  array_contains: InputJsonValue.optional().nullable(),
  array_starts_with: InputJsonValue.optional().nullable(),
  array_ends_with: InputJsonValue.optional().nullable(),
  lt: InputJsonValue.optional(),
  lte: InputJsonValue.optional(),
  gt: InputJsonValue.optional(),
  gte: InputJsonValue.optional(),
  not: z.union([ InputJsonValue,z.lazy(() => JsonNullValueFilterSchema) ]).optional(),
}).strict();

export const Background_jobsCountOrderByAggregateInputSchema: z.ZodType<Prisma.Background_jobsCountOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  payload: z.lazy(() => SortOrderSchema).optional(),
  completed: z.lazy(() => SortOrderSchema).optional(),
  cancelled: z.lazy(() => SortOrderSchema).optional(),
  progress: z.lazy(() => SortOrderSchema).optional(),
  result: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const Background_jobsAvgOrderByAggregateInputSchema: z.ZodType<Prisma.Background_jobsAvgOrderByAggregateInput> = z.object({
  progress: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const Background_jobsMaxOrderByAggregateInputSchema: z.ZodType<Prisma.Background_jobsMaxOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  completed: z.lazy(() => SortOrderSchema).optional(),
  cancelled: z.lazy(() => SortOrderSchema).optional(),
  progress: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const Background_jobsMinOrderByAggregateInputSchema: z.ZodType<Prisma.Background_jobsMinOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  completed: z.lazy(() => SortOrderSchema).optional(),
  cancelled: z.lazy(() => SortOrderSchema).optional(),
  progress: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const Background_jobsSumOrderByAggregateInputSchema: z.ZodType<Prisma.Background_jobsSumOrderByAggregateInput> = z.object({
  progress: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const JsonWithAggregatesFilterSchema: z.ZodType<Prisma.JsonWithAggregatesFilter> = z.object({
  equals: z.union([ InputJsonValue,z.lazy(() => JsonNullValueFilterSchema) ]).optional(),
  path: z.string().array().optional(),
  string_contains: z.string().optional(),
  string_starts_with: z.string().optional(),
  string_ends_with: z.string().optional(),
  array_contains: InputJsonValue.optional().nullable(),
  array_starts_with: InputJsonValue.optional().nullable(),
  array_ends_with: InputJsonValue.optional().nullable(),
  lt: InputJsonValue.optional(),
  lte: InputJsonValue.optional(),
  gt: InputJsonValue.optional(),
  gte: InputJsonValue.optional(),
  not: z.union([ InputJsonValue,z.lazy(() => JsonNullValueFilterSchema) ]).optional(),
  _count: z.lazy(() => NestedIntFilterSchema).optional(),
  _min: z.lazy(() => NestedJsonFilterSchema).optional(),
  _max: z.lazy(() => NestedJsonFilterSchema).optional()
}).strict();

export const BoolWithAggregatesFilterSchema: z.ZodType<Prisma.BoolWithAggregatesFilter> = z.object({
  equals: z.boolean().optional(),
  not: z.union([ z.boolean(),z.lazy(() => NestedBoolWithAggregatesFilterSchema) ]).optional(),
  _count: z.lazy(() => NestedIntFilterSchema).optional(),
  _min: z.lazy(() => NestedBoolFilterSchema).optional(),
  _max: z.lazy(() => NestedBoolFilterSchema).optional()
}).strict();

export const FloatWithAggregatesFilterSchema: z.ZodType<Prisma.FloatWithAggregatesFilter> = z.object({
  equals: z.number().optional(),
  in: z.number().array().optional(),
  notIn: z.number().array().optional(),
  lt: z.number().optional(),
  lte: z.number().optional(),
  gt: z.number().optional(),
  gte: z.number().optional(),
  not: z.union([ z.number(),z.lazy(() => NestedFloatWithAggregatesFilterSchema) ]).optional(),
  _count: z.lazy(() => NestedIntFilterSchema).optional(),
  _avg: z.lazy(() => NestedFloatFilterSchema).optional(),
  _sum: z.lazy(() => NestedFloatFilterSchema).optional(),
  _min: z.lazy(() => NestedFloatFilterSchema).optional(),
  _max: z.lazy(() => NestedFloatFilterSchema).optional()
}).strict();

export const JsonNullableWithAggregatesFilterSchema: z.ZodType<Prisma.JsonNullableWithAggregatesFilter> = z.object({
  equals: z.union([ InputJsonValue,z.lazy(() => JsonNullValueFilterSchema) ]).optional(),
  path: z.string().array().optional(),
  string_contains: z.string().optional(),
  string_starts_with: z.string().optional(),
  string_ends_with: z.string().optional(),
  array_contains: InputJsonValue.optional().nullable(),
  array_starts_with: InputJsonValue.optional().nullable(),
  array_ends_with: InputJsonValue.optional().nullable(),
  lt: InputJsonValue.optional(),
  lte: InputJsonValue.optional(),
  gt: InputJsonValue.optional(),
  gte: InputJsonValue.optional(),
  not: z.union([ InputJsonValue,z.lazy(() => JsonNullValueFilterSchema) ]).optional(),
  _count: z.lazy(() => NestedIntNullableFilterSchema).optional(),
  _min: z.lazy(() => NestedJsonNullableFilterSchema).optional(),
  _max: z.lazy(() => NestedJsonNullableFilterSchema).optional()
}).strict();

export const Chat_roomCountOrderByAggregateInputSchema: z.ZodType<Prisma.Chat_roomCountOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  username: z.lazy(() => SortOrderSchema).optional(),
  message: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const Chat_roomMaxOrderByAggregateInputSchema: z.ZodType<Prisma.Chat_roomMaxOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  username: z.lazy(() => SortOrderSchema).optional(),
  message: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const Chat_roomMinOrderByAggregateInputSchema: z.ZodType<Prisma.Chat_roomMinOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  username: z.lazy(() => SortOrderSchema).optional(),
  message: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const Commerce_ordersCountOrderByAggregateInputSchema: z.ZodType<Prisma.Commerce_ordersCountOrderByAggregateInput> = z.object({
  order_id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  price_amount: z.lazy(() => SortOrderSchema).optional(),
  price_currency: z.lazy(() => SortOrderSchema).optional(),
  promo_code: z.lazy(() => SortOrderSchema).optional(),
  customer_full_name: z.lazy(() => SortOrderSchema).optional(),
  country: z.lazy(() => SortOrderSchema).optional(),
  product: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const Commerce_ordersAvgOrderByAggregateInputSchema: z.ZodType<Prisma.Commerce_ordersAvgOrderByAggregateInput> = z.object({
  price_amount: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const Commerce_ordersMaxOrderByAggregateInputSchema: z.ZodType<Prisma.Commerce_ordersMaxOrderByAggregateInput> = z.object({
  order_id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  price_amount: z.lazy(() => SortOrderSchema).optional(),
  price_currency: z.lazy(() => SortOrderSchema).optional(),
  promo_code: z.lazy(() => SortOrderSchema).optional(),
  customer_full_name: z.lazy(() => SortOrderSchema).optional(),
  country: z.lazy(() => SortOrderSchema).optional(),
  product: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const Commerce_ordersMinOrderByAggregateInputSchema: z.ZodType<Prisma.Commerce_ordersMinOrderByAggregateInput> = z.object({
  order_id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  price_amount: z.lazy(() => SortOrderSchema).optional(),
  price_currency: z.lazy(() => SortOrderSchema).optional(),
  promo_code: z.lazy(() => SortOrderSchema).optional(),
  customer_full_name: z.lazy(() => SortOrderSchema).optional(),
  country: z.lazy(() => SortOrderSchema).optional(),
  product: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const Commerce_ordersSumOrderByAggregateInputSchema: z.ZodType<Prisma.Commerce_ordersSumOrderByAggregateInput> = z.object({
  price_amount: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const LogsCountOrderByAggregateInputSchema: z.ZodType<Prisma.LogsCountOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  source_id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  content: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const LogsMaxOrderByAggregateInputSchema: z.ZodType<Prisma.LogsMaxOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  source_id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  content: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const LogsMinOrderByAggregateInputSchema: z.ZodType<Prisma.LogsMinOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  source_id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  content: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const MonitoringCountOrderByAggregateInputSchema: z.ZodType<Prisma.MonitoringCountOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  type: z.lazy(() => SortOrderSchema).optional(),
  value: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const MonitoringAvgOrderByAggregateInputSchema: z.ZodType<Prisma.MonitoringAvgOrderByAggregateInput> = z.object({
  value: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const MonitoringMaxOrderByAggregateInputSchema: z.ZodType<Prisma.MonitoringMaxOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  type: z.lazy(() => SortOrderSchema).optional(),
  value: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const MonitoringMinOrderByAggregateInputSchema: z.ZodType<Prisma.MonitoringMinOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  type: z.lazy(() => SortOrderSchema).optional(),
  value: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const MonitoringSumOrderByAggregateInputSchema: z.ZodType<Prisma.MonitoringSumOrderByAggregateInput> = z.object({
  value: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const ResponsesListRelationFilterSchema: z.ZodType<Prisma.ResponsesListRelationFilter> = z.object({
  every: z.lazy(() => ResponsesWhereInputSchema).optional(),
  some: z.lazy(() => ResponsesWhereInputSchema).optional(),
  none: z.lazy(() => ResponsesWhereInputSchema).optional()
}).strict();

export const ResponsesOrderByRelationAggregateInputSchema: z.ZodType<Prisma.ResponsesOrderByRelationAggregateInput> = z.object({
  _count: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const RequestsCountOrderByAggregateInputSchema: z.ZodType<Prisma.RequestsCountOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  path: z.lazy(() => SortOrderSchema).optional(),
  method: z.lazy(() => SortOrderSchema).optional(),
  data: z.lazy(() => SortOrderSchema).optional(),
  processing: z.lazy(() => SortOrderSchema).optional(),
  cancelled: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const RequestsMaxOrderByAggregateInputSchema: z.ZodType<Prisma.RequestsMaxOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  path: z.lazy(() => SortOrderSchema).optional(),
  method: z.lazy(() => SortOrderSchema).optional(),
  processing: z.lazy(() => SortOrderSchema).optional(),
  cancelled: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const RequestsMinOrderByAggregateInputSchema: z.ZodType<Prisma.RequestsMinOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  path: z.lazy(() => SortOrderSchema).optional(),
  method: z.lazy(() => SortOrderSchema).optional(),
  processing: z.lazy(() => SortOrderSchema).optional(),
  cancelled: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const IntFilterSchema: z.ZodType<Prisma.IntFilter> = z.object({
  equals: z.number().optional(),
  in: z.number().array().optional(),
  notIn: z.number().array().optional(),
  lt: z.number().optional(),
  lte: z.number().optional(),
  gt: z.number().optional(),
  gte: z.number().optional(),
  not: z.union([ z.number(),z.lazy(() => NestedIntFilterSchema) ]).optional(),
}).strict();

export const RequestsRelationFilterSchema: z.ZodType<Prisma.RequestsRelationFilter> = z.object({
  is: z.lazy(() => RequestsWhereInputSchema).optional(),
  isNot: z.lazy(() => RequestsWhereInputSchema).optional()
}).strict();

export const ResponsesCountOrderByAggregateInputSchema: z.ZodType<Prisma.ResponsesCountOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  request_id: z.lazy(() => SortOrderSchema).optional(),
  status_code: z.lazy(() => SortOrderSchema).optional(),
  data: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const ResponsesAvgOrderByAggregateInputSchema: z.ZodType<Prisma.ResponsesAvgOrderByAggregateInput> = z.object({
  status_code: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const ResponsesMaxOrderByAggregateInputSchema: z.ZodType<Prisma.ResponsesMaxOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  request_id: z.lazy(() => SortOrderSchema).optional(),
  status_code: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const ResponsesMinOrderByAggregateInputSchema: z.ZodType<Prisma.ResponsesMinOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  timestamp: z.lazy(() => SortOrderSchema).optional(),
  request_id: z.lazy(() => SortOrderSchema).optional(),
  status_code: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const ResponsesSumOrderByAggregateInputSchema: z.ZodType<Prisma.ResponsesSumOrderByAggregateInput> = z.object({
  status_code: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const IntWithAggregatesFilterSchema: z.ZodType<Prisma.IntWithAggregatesFilter> = z.object({
  equals: z.number().optional(),
  in: z.number().array().optional(),
  notIn: z.number().array().optional(),
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

export const StringFieldUpdateOperationsInputSchema: z.ZodType<Prisma.StringFieldUpdateOperationsInput> = z.object({
  set: z.string().optional()
}).strict();

export const DateTimeFieldUpdateOperationsInputSchema: z.ZodType<Prisma.DateTimeFieldUpdateOperationsInput> = z.object({
  set: z.coerce.date().optional()
}).strict();

export const NullableStringFieldUpdateOperationsInputSchema: z.ZodType<Prisma.NullableStringFieldUpdateOperationsInput> = z.object({
  set: z.string().optional().nullable()
}).strict();

export const NullableDateTimeFieldUpdateOperationsInputSchema: z.ZodType<Prisma.NullableDateTimeFieldUpdateOperationsInput> = z.object({
  set: z.coerce.date().optional().nullable()
}).strict();

export const BoolFieldUpdateOperationsInputSchema: z.ZodType<Prisma.BoolFieldUpdateOperationsInput> = z.object({
  set: z.boolean().optional()
}).strict();

export const FloatFieldUpdateOperationsInputSchema: z.ZodType<Prisma.FloatFieldUpdateOperationsInput> = z.object({
  set: z.number().optional(),
  increment: z.number().optional(),
  decrement: z.number().optional(),
  multiply: z.number().optional(),
  divide: z.number().optional()
}).strict();

export const ResponsesCreateNestedManyWithoutRequestsInputSchema: z.ZodType<Prisma.ResponsesCreateNestedManyWithoutRequestsInput> = z.object({
  create: z.union([ z.lazy(() => ResponsesCreateWithoutRequestsInputSchema),z.lazy(() => ResponsesCreateWithoutRequestsInputSchema).array(),z.lazy(() => ResponsesUncheckedCreateWithoutRequestsInputSchema),z.lazy(() => ResponsesUncheckedCreateWithoutRequestsInputSchema).array() ]).optional(),
  connectOrCreate: z.union([ z.lazy(() => ResponsesCreateOrConnectWithoutRequestsInputSchema),z.lazy(() => ResponsesCreateOrConnectWithoutRequestsInputSchema).array() ]).optional(),
  createMany: z.lazy(() => ResponsesCreateManyRequestsInputEnvelopeSchema).optional(),
  connect: z.union([ z.lazy(() => ResponsesWhereUniqueInputSchema),z.lazy(() => ResponsesWhereUniqueInputSchema).array() ]).optional(),
}).strict();

export const ResponsesUncheckedCreateNestedManyWithoutRequestsInputSchema: z.ZodType<Prisma.ResponsesUncheckedCreateNestedManyWithoutRequestsInput> = z.object({
  create: z.union([ z.lazy(() => ResponsesCreateWithoutRequestsInputSchema),z.lazy(() => ResponsesCreateWithoutRequestsInputSchema).array(),z.lazy(() => ResponsesUncheckedCreateWithoutRequestsInputSchema),z.lazy(() => ResponsesUncheckedCreateWithoutRequestsInputSchema).array() ]).optional(),
  connectOrCreate: z.union([ z.lazy(() => ResponsesCreateOrConnectWithoutRequestsInputSchema),z.lazy(() => ResponsesCreateOrConnectWithoutRequestsInputSchema).array() ]).optional(),
  createMany: z.lazy(() => ResponsesCreateManyRequestsInputEnvelopeSchema).optional(),
  connect: z.union([ z.lazy(() => ResponsesWhereUniqueInputSchema),z.lazy(() => ResponsesWhereUniqueInputSchema).array() ]).optional(),
}).strict();

export const ResponsesUpdateManyWithoutRequestsNestedInputSchema: z.ZodType<Prisma.ResponsesUpdateManyWithoutRequestsNestedInput> = z.object({
  create: z.union([ z.lazy(() => ResponsesCreateWithoutRequestsInputSchema),z.lazy(() => ResponsesCreateWithoutRequestsInputSchema).array(),z.lazy(() => ResponsesUncheckedCreateWithoutRequestsInputSchema),z.lazy(() => ResponsesUncheckedCreateWithoutRequestsInputSchema).array() ]).optional(),
  connectOrCreate: z.union([ z.lazy(() => ResponsesCreateOrConnectWithoutRequestsInputSchema),z.lazy(() => ResponsesCreateOrConnectWithoutRequestsInputSchema).array() ]).optional(),
  upsert: z.union([ z.lazy(() => ResponsesUpsertWithWhereUniqueWithoutRequestsInputSchema),z.lazy(() => ResponsesUpsertWithWhereUniqueWithoutRequestsInputSchema).array() ]).optional(),
  createMany: z.lazy(() => ResponsesCreateManyRequestsInputEnvelopeSchema).optional(),
  set: z.union([ z.lazy(() => ResponsesWhereUniqueInputSchema),z.lazy(() => ResponsesWhereUniqueInputSchema).array() ]).optional(),
  disconnect: z.union([ z.lazy(() => ResponsesWhereUniqueInputSchema),z.lazy(() => ResponsesWhereUniqueInputSchema).array() ]).optional(),
  delete: z.union([ z.lazy(() => ResponsesWhereUniqueInputSchema),z.lazy(() => ResponsesWhereUniqueInputSchema).array() ]).optional(),
  connect: z.union([ z.lazy(() => ResponsesWhereUniqueInputSchema),z.lazy(() => ResponsesWhereUniqueInputSchema).array() ]).optional(),
  update: z.union([ z.lazy(() => ResponsesUpdateWithWhereUniqueWithoutRequestsInputSchema),z.lazy(() => ResponsesUpdateWithWhereUniqueWithoutRequestsInputSchema).array() ]).optional(),
  updateMany: z.union([ z.lazy(() => ResponsesUpdateManyWithWhereWithoutRequestsInputSchema),z.lazy(() => ResponsesUpdateManyWithWhereWithoutRequestsInputSchema).array() ]).optional(),
  deleteMany: z.union([ z.lazy(() => ResponsesScalarWhereInputSchema),z.lazy(() => ResponsesScalarWhereInputSchema).array() ]).optional(),
}).strict();

export const ResponsesUncheckedUpdateManyWithoutRequestsNestedInputSchema: z.ZodType<Prisma.ResponsesUncheckedUpdateManyWithoutRequestsNestedInput> = z.object({
  create: z.union([ z.lazy(() => ResponsesCreateWithoutRequestsInputSchema),z.lazy(() => ResponsesCreateWithoutRequestsInputSchema).array(),z.lazy(() => ResponsesUncheckedCreateWithoutRequestsInputSchema),z.lazy(() => ResponsesUncheckedCreateWithoutRequestsInputSchema).array() ]).optional(),
  connectOrCreate: z.union([ z.lazy(() => ResponsesCreateOrConnectWithoutRequestsInputSchema),z.lazy(() => ResponsesCreateOrConnectWithoutRequestsInputSchema).array() ]).optional(),
  upsert: z.union([ z.lazy(() => ResponsesUpsertWithWhereUniqueWithoutRequestsInputSchema),z.lazy(() => ResponsesUpsertWithWhereUniqueWithoutRequestsInputSchema).array() ]).optional(),
  createMany: z.lazy(() => ResponsesCreateManyRequestsInputEnvelopeSchema).optional(),
  set: z.union([ z.lazy(() => ResponsesWhereUniqueInputSchema),z.lazy(() => ResponsesWhereUniqueInputSchema).array() ]).optional(),
  disconnect: z.union([ z.lazy(() => ResponsesWhereUniqueInputSchema),z.lazy(() => ResponsesWhereUniqueInputSchema).array() ]).optional(),
  delete: z.union([ z.lazy(() => ResponsesWhereUniqueInputSchema),z.lazy(() => ResponsesWhereUniqueInputSchema).array() ]).optional(),
  connect: z.union([ z.lazy(() => ResponsesWhereUniqueInputSchema),z.lazy(() => ResponsesWhereUniqueInputSchema).array() ]).optional(),
  update: z.union([ z.lazy(() => ResponsesUpdateWithWhereUniqueWithoutRequestsInputSchema),z.lazy(() => ResponsesUpdateWithWhereUniqueWithoutRequestsInputSchema).array() ]).optional(),
  updateMany: z.union([ z.lazy(() => ResponsesUpdateManyWithWhereWithoutRequestsInputSchema),z.lazy(() => ResponsesUpdateManyWithWhereWithoutRequestsInputSchema).array() ]).optional(),
  deleteMany: z.union([ z.lazy(() => ResponsesScalarWhereInputSchema),z.lazy(() => ResponsesScalarWhereInputSchema).array() ]).optional(),
}).strict();

export const RequestsCreateNestedOneWithoutResponsesInputSchema: z.ZodType<Prisma.RequestsCreateNestedOneWithoutResponsesInput> = z.object({
  create: z.union([ z.lazy(() => RequestsCreateWithoutResponsesInputSchema),z.lazy(() => RequestsUncheckedCreateWithoutResponsesInputSchema) ]).optional(),
  connectOrCreate: z.lazy(() => RequestsCreateOrConnectWithoutResponsesInputSchema).optional(),
  connect: z.lazy(() => RequestsWhereUniqueInputSchema).optional()
}).strict();

export const IntFieldUpdateOperationsInputSchema: z.ZodType<Prisma.IntFieldUpdateOperationsInput> = z.object({
  set: z.number().optional(),
  increment: z.number().optional(),
  decrement: z.number().optional(),
  multiply: z.number().optional(),
  divide: z.number().optional()
}).strict();

export const RequestsUpdateOneRequiredWithoutResponsesNestedInputSchema: z.ZodType<Prisma.RequestsUpdateOneRequiredWithoutResponsesNestedInput> = z.object({
  create: z.union([ z.lazy(() => RequestsCreateWithoutResponsesInputSchema),z.lazy(() => RequestsUncheckedCreateWithoutResponsesInputSchema) ]).optional(),
  connectOrCreate: z.lazy(() => RequestsCreateOrConnectWithoutResponsesInputSchema).optional(),
  upsert: z.lazy(() => RequestsUpsertWithoutResponsesInputSchema).optional(),
  connect: z.lazy(() => RequestsWhereUniqueInputSchema).optional(),
  update: z.union([ z.lazy(() => RequestsUpdateWithoutResponsesInputSchema),z.lazy(() => RequestsUncheckedUpdateWithoutResponsesInputSchema) ]).optional(),
}).strict();

export const NestedUuidFilterSchema: z.ZodType<Prisma.NestedUuidFilter> = z.object({
  equals: z.string().optional(),
  in: z.string().array().optional(),
  notIn: z.string().array().optional(),
  lt: z.string().optional(),
  lte: z.string().optional(),
  gt: z.string().optional(),
  gte: z.string().optional(),
  not: z.union([ z.string(),z.lazy(() => NestedUuidFilterSchema) ]).optional(),
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

export const NestedDateTimeFilterSchema: z.ZodType<Prisma.NestedDateTimeFilter> = z.object({
  equals: z.coerce.date().optional(),
  in: z.coerce.date().array().optional(),
  notIn: z.coerce.date().array().optional(),
  lt: z.coerce.date().optional(),
  lte: z.coerce.date().optional(),
  gt: z.coerce.date().optional(),
  gte: z.coerce.date().optional(),
  not: z.union([ z.coerce.date(),z.lazy(() => NestedDateTimeFilterSchema) ]).optional(),
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

export const NestedDateTimeNullableFilterSchema: z.ZodType<Prisma.NestedDateTimeNullableFilter> = z.object({
  equals: z.coerce.date().optional().nullable(),
  in: z.coerce.date().array().optional().nullable(),
  notIn: z.coerce.date().array().optional().nullable(),
  lt: z.coerce.date().optional(),
  lte: z.coerce.date().optional(),
  gt: z.coerce.date().optional(),
  gte: z.coerce.date().optional(),
  not: z.union([ z.coerce.date(),z.lazy(() => NestedDateTimeNullableFilterSchema) ]).optional().nullable(),
}).strict();

export const NestedUuidWithAggregatesFilterSchema: z.ZodType<Prisma.NestedUuidWithAggregatesFilter> = z.object({
  equals: z.string().optional(),
  in: z.string().array().optional(),
  notIn: z.string().array().optional(),
  lt: z.string().optional(),
  lte: z.string().optional(),
  gt: z.string().optional(),
  gte: z.string().optional(),
  not: z.union([ z.string(),z.lazy(() => NestedUuidWithAggregatesFilterSchema) ]).optional(),
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

export const NestedDateTimeWithAggregatesFilterSchema: z.ZodType<Prisma.NestedDateTimeWithAggregatesFilter> = z.object({
  equals: z.coerce.date().optional(),
  in: z.coerce.date().array().optional(),
  notIn: z.coerce.date().array().optional(),
  lt: z.coerce.date().optional(),
  lte: z.coerce.date().optional(),
  gt: z.coerce.date().optional(),
  gte: z.coerce.date().optional(),
  not: z.union([ z.coerce.date(),z.lazy(() => NestedDateTimeWithAggregatesFilterSchema) ]).optional(),
  _count: z.lazy(() => NestedIntFilterSchema).optional(),
  _min: z.lazy(() => NestedDateTimeFilterSchema).optional(),
  _max: z.lazy(() => NestedDateTimeFilterSchema).optional()
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

export const NestedDateTimeNullableWithAggregatesFilterSchema: z.ZodType<Prisma.NestedDateTimeNullableWithAggregatesFilter> = z.object({
  equals: z.coerce.date().optional().nullable(),
  in: z.coerce.date().array().optional().nullable(),
  notIn: z.coerce.date().array().optional().nullable(),
  lt: z.coerce.date().optional(),
  lte: z.coerce.date().optional(),
  gt: z.coerce.date().optional(),
  gte: z.coerce.date().optional(),
  not: z.union([ z.coerce.date(),z.lazy(() => NestedDateTimeNullableWithAggregatesFilterSchema) ]).optional().nullable(),
  _count: z.lazy(() => NestedIntNullableFilterSchema).optional(),
  _min: z.lazy(() => NestedDateTimeNullableFilterSchema).optional(),
  _max: z.lazy(() => NestedDateTimeNullableFilterSchema).optional()
}).strict();

export const NestedBoolFilterSchema: z.ZodType<Prisma.NestedBoolFilter> = z.object({
  equals: z.boolean().optional(),
  not: z.union([ z.boolean(),z.lazy(() => NestedBoolFilterSchema) ]).optional(),
}).strict();

export const NestedFloatFilterSchema: z.ZodType<Prisma.NestedFloatFilter> = z.object({
  equals: z.number().optional(),
  in: z.number().array().optional(),
  notIn: z.number().array().optional(),
  lt: z.number().optional(),
  lte: z.number().optional(),
  gt: z.number().optional(),
  gte: z.number().optional(),
  not: z.union([ z.number(),z.lazy(() => NestedFloatFilterSchema) ]).optional(),
}).strict();

export const NestedJsonFilterSchema: z.ZodType<Prisma.NestedJsonFilter> = z.object({
  equals: z.union([ InputJsonValue,z.lazy(() => JsonNullValueFilterSchema) ]).optional(),
  path: z.string().array().optional(),
  string_contains: z.string().optional(),
  string_starts_with: z.string().optional(),
  string_ends_with: z.string().optional(),
  array_contains: InputJsonValue.optional().nullable(),
  array_starts_with: InputJsonValue.optional().nullable(),
  array_ends_with: InputJsonValue.optional().nullable(),
  lt: InputJsonValue.optional(),
  lte: InputJsonValue.optional(),
  gt: InputJsonValue.optional(),
  gte: InputJsonValue.optional(),
  not: z.union([ InputJsonValue,z.lazy(() => JsonNullValueFilterSchema) ]).optional(),
}).strict();

export const NestedBoolWithAggregatesFilterSchema: z.ZodType<Prisma.NestedBoolWithAggregatesFilter> = z.object({
  equals: z.boolean().optional(),
  not: z.union([ z.boolean(),z.lazy(() => NestedBoolWithAggregatesFilterSchema) ]).optional(),
  _count: z.lazy(() => NestedIntFilterSchema).optional(),
  _min: z.lazy(() => NestedBoolFilterSchema).optional(),
  _max: z.lazy(() => NestedBoolFilterSchema).optional()
}).strict();

export const NestedFloatWithAggregatesFilterSchema: z.ZodType<Prisma.NestedFloatWithAggregatesFilter> = z.object({
  equals: z.number().optional(),
  in: z.number().array().optional(),
  notIn: z.number().array().optional(),
  lt: z.number().optional(),
  lte: z.number().optional(),
  gt: z.number().optional(),
  gte: z.number().optional(),
  not: z.union([ z.number(),z.lazy(() => NestedFloatWithAggregatesFilterSchema) ]).optional(),
  _count: z.lazy(() => NestedIntFilterSchema).optional(),
  _avg: z.lazy(() => NestedFloatFilterSchema).optional(),
  _sum: z.lazy(() => NestedFloatFilterSchema).optional(),
  _min: z.lazy(() => NestedFloatFilterSchema).optional(),
  _max: z.lazy(() => NestedFloatFilterSchema).optional()
}).strict();

export const NestedJsonNullableFilterSchema: z.ZodType<Prisma.NestedJsonNullableFilter> = z.object({
  equals: z.union([ InputJsonValue,z.lazy(() => JsonNullValueFilterSchema) ]).optional(),
  path: z.string().array().optional(),
  string_contains: z.string().optional(),
  string_starts_with: z.string().optional(),
  string_ends_with: z.string().optional(),
  array_contains: InputJsonValue.optional().nullable(),
  array_starts_with: InputJsonValue.optional().nullable(),
  array_ends_with: InputJsonValue.optional().nullable(),
  lt: InputJsonValue.optional(),
  lte: InputJsonValue.optional(),
  gt: InputJsonValue.optional(),
  gte: InputJsonValue.optional(),
  not: z.union([ InputJsonValue,z.lazy(() => JsonNullValueFilterSchema) ]).optional(),
}).strict();

export const NestedIntWithAggregatesFilterSchema: z.ZodType<Prisma.NestedIntWithAggregatesFilter> = z.object({
  equals: z.number().optional(),
  in: z.number().array().optional(),
  notIn: z.number().array().optional(),
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

export const ResponsesCreateWithoutRequestsInputSchema: z.ZodType<Prisma.ResponsesCreateWithoutRequestsInput> = z.object({
  id: z.string(),
  timestamp: z.coerce.date(),
  status_code: z.number(),
  data: z.union([ z.lazy(() => NullableJsonNullValueInputSchema),InputJsonValue ]).optional(),
}).strict();

export const ResponsesUncheckedCreateWithoutRequestsInputSchema: z.ZodType<Prisma.ResponsesUncheckedCreateWithoutRequestsInput> = z.object({
  id: z.string(),
  timestamp: z.coerce.date(),
  status_code: z.number(),
  data: z.union([ z.lazy(() => NullableJsonNullValueInputSchema),InputJsonValue ]).optional(),
}).strict();

export const ResponsesCreateOrConnectWithoutRequestsInputSchema: z.ZodType<Prisma.ResponsesCreateOrConnectWithoutRequestsInput> = z.object({
  where: z.lazy(() => ResponsesWhereUniqueInputSchema),
  create: z.union([ z.lazy(() => ResponsesCreateWithoutRequestsInputSchema),z.lazy(() => ResponsesUncheckedCreateWithoutRequestsInputSchema) ]),
}).strict();

export const ResponsesCreateManyRequestsInputEnvelopeSchema: z.ZodType<Prisma.ResponsesCreateManyRequestsInputEnvelope> = z.object({
  data: z.lazy(() => ResponsesCreateManyRequestsInputSchema).array(),
  skipDuplicates: z.boolean().optional()
}).strict();

export const ResponsesUpsertWithWhereUniqueWithoutRequestsInputSchema: z.ZodType<Prisma.ResponsesUpsertWithWhereUniqueWithoutRequestsInput> = z.object({
  where: z.lazy(() => ResponsesWhereUniqueInputSchema),
  update: z.union([ z.lazy(() => ResponsesUpdateWithoutRequestsInputSchema),z.lazy(() => ResponsesUncheckedUpdateWithoutRequestsInputSchema) ]),
  create: z.union([ z.lazy(() => ResponsesCreateWithoutRequestsInputSchema),z.lazy(() => ResponsesUncheckedCreateWithoutRequestsInputSchema) ]),
}).strict();

export const ResponsesUpdateWithWhereUniqueWithoutRequestsInputSchema: z.ZodType<Prisma.ResponsesUpdateWithWhereUniqueWithoutRequestsInput> = z.object({
  where: z.lazy(() => ResponsesWhereUniqueInputSchema),
  data: z.union([ z.lazy(() => ResponsesUpdateWithoutRequestsInputSchema),z.lazy(() => ResponsesUncheckedUpdateWithoutRequestsInputSchema) ]),
}).strict();

export const ResponsesUpdateManyWithWhereWithoutRequestsInputSchema: z.ZodType<Prisma.ResponsesUpdateManyWithWhereWithoutRequestsInput> = z.object({
  where: z.lazy(() => ResponsesScalarWhereInputSchema),
  data: z.union([ z.lazy(() => ResponsesUpdateManyMutationInputSchema),z.lazy(() => ResponsesUncheckedUpdateManyWithoutResponsesInputSchema) ]),
}).strict();

export const ResponsesScalarWhereInputSchema: z.ZodType<Prisma.ResponsesScalarWhereInput> = z.object({
  AND: z.union([ z.lazy(() => ResponsesScalarWhereInputSchema),z.lazy(() => ResponsesScalarWhereInputSchema).array() ]).optional(),
  OR: z.lazy(() => ResponsesScalarWhereInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => ResponsesScalarWhereInputSchema),z.lazy(() => ResponsesScalarWhereInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => UuidFilterSchema),z.string() ]).optional(),
  timestamp: z.union([ z.lazy(() => DateTimeFilterSchema),z.coerce.date() ]).optional(),
  request_id: z.union([ z.lazy(() => UuidFilterSchema),z.string() ]).optional(),
  status_code: z.union([ z.lazy(() => IntFilterSchema),z.number() ]).optional(),
  data: z.lazy(() => JsonNullableFilterSchema).optional()
}).strict();

export const RequestsCreateWithoutResponsesInputSchema: z.ZodType<Prisma.RequestsCreateWithoutResponsesInput> = z.object({
  id: z.string(),
  timestamp: z.coerce.date(),
  path: z.string(),
  method: z.string(),
  data: z.union([ z.lazy(() => NullableJsonNullValueInputSchema),InputJsonValue ]).optional(),
  processing: z.boolean(),
  cancelled: z.boolean()
}).strict();

export const RequestsUncheckedCreateWithoutResponsesInputSchema: z.ZodType<Prisma.RequestsUncheckedCreateWithoutResponsesInput> = z.object({
  id: z.string(),
  timestamp: z.coerce.date(),
  path: z.string(),
  method: z.string(),
  data: z.union([ z.lazy(() => NullableJsonNullValueInputSchema),InputJsonValue ]).optional(),
  processing: z.boolean(),
  cancelled: z.boolean()
}).strict();

export const RequestsCreateOrConnectWithoutResponsesInputSchema: z.ZodType<Prisma.RequestsCreateOrConnectWithoutResponsesInput> = z.object({
  where: z.lazy(() => RequestsWhereUniqueInputSchema),
  create: z.union([ z.lazy(() => RequestsCreateWithoutResponsesInputSchema),z.lazy(() => RequestsUncheckedCreateWithoutResponsesInputSchema) ]),
}).strict();

export const RequestsUpsertWithoutResponsesInputSchema: z.ZodType<Prisma.RequestsUpsertWithoutResponsesInput> = z.object({
  update: z.union([ z.lazy(() => RequestsUpdateWithoutResponsesInputSchema),z.lazy(() => RequestsUncheckedUpdateWithoutResponsesInputSchema) ]),
  create: z.union([ z.lazy(() => RequestsCreateWithoutResponsesInputSchema),z.lazy(() => RequestsUncheckedCreateWithoutResponsesInputSchema) ]),
}).strict();

export const RequestsUpdateWithoutResponsesInputSchema: z.ZodType<Prisma.RequestsUpdateWithoutResponsesInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  path: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  method: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  data: z.union([ z.lazy(() => NullableJsonNullValueInputSchema),InputJsonValue ]).optional(),
  processing: z.union([ z.boolean(),z.lazy(() => BoolFieldUpdateOperationsInputSchema) ]).optional(),
  cancelled: z.union([ z.boolean(),z.lazy(() => BoolFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const RequestsUncheckedUpdateWithoutResponsesInputSchema: z.ZodType<Prisma.RequestsUncheckedUpdateWithoutResponsesInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  path: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  method: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  data: z.union([ z.lazy(() => NullableJsonNullValueInputSchema),InputJsonValue ]).optional(),
  processing: z.union([ z.boolean(),z.lazy(() => BoolFieldUpdateOperationsInputSchema) ]).optional(),
  cancelled: z.union([ z.boolean(),z.lazy(() => BoolFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const ResponsesCreateManyRequestsInputSchema: z.ZodType<Prisma.ResponsesCreateManyRequestsInput> = z.object({
  id: z.string().uuid(),
  timestamp: z.coerce.date(),
  status_code: z.number().int().gte(-2147483648).lte(2147483647),
  data: z.union([ z.lazy(() => NullableJsonNullValueInputSchema),InputJsonValue ]).optional(),
}).strict();

export const ResponsesUpdateWithoutRequestsInputSchema: z.ZodType<Prisma.ResponsesUpdateWithoutRequestsInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  status_code: z.union([ z.number(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  data: z.union([ z.lazy(() => NullableJsonNullValueInputSchema),InputJsonValue ]).optional(),
}).strict();

export const ResponsesUncheckedUpdateWithoutRequestsInputSchema: z.ZodType<Prisma.ResponsesUncheckedUpdateWithoutRequestsInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  status_code: z.union([ z.number(),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  data: z.union([ z.lazy(() => NullableJsonNullValueInputSchema),InputJsonValue ]).optional(),
}).strict();

export const ResponsesUncheckedUpdateManyWithoutResponsesInputSchema: z.ZodType<Prisma.ResponsesUncheckedUpdateManyWithoutResponsesInput> = z.object({
  id: z.union([ z.string().uuid(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  timestamp: z.union([ z.coerce.date(),z.lazy(() => DateTimeFieldUpdateOperationsInputSchema) ]).optional(),
  status_code: z.union([ z.number().int().gte(-2147483648).lte(2147483647),z.lazy(() => IntFieldUpdateOperationsInputSchema) ]).optional(),
  data: z.union([ z.lazy(() => NullableJsonNullValueInputSchema),InputJsonValue ]).optional(),
}).strict();

/////////////////////////////////////////
// ARGS
/////////////////////////////////////////

export const Activity_eventsFindFirstArgsSchema: z.ZodType<Prisma.Activity_eventsFindFirstArgs> = z.object({
  select: Activity_eventsSelectSchema.optional(),
  where: Activity_eventsWhereInputSchema.optional(),
  orderBy: z.union([ Activity_eventsOrderByWithRelationInputSchema.array(),Activity_eventsOrderByWithRelationInputSchema ]).optional(),
  cursor: Activity_eventsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: Activity_eventsScalarFieldEnumSchema.array().optional(),
}).strict() 

export const Activity_eventsFindFirstOrThrowArgsSchema: z.ZodType<Prisma.Activity_eventsFindFirstOrThrowArgs> = z.object({
  select: Activity_eventsSelectSchema.optional(),
  where: Activity_eventsWhereInputSchema.optional(),
  orderBy: z.union([ Activity_eventsOrderByWithRelationInputSchema.array(),Activity_eventsOrderByWithRelationInputSchema ]).optional(),
  cursor: Activity_eventsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: Activity_eventsScalarFieldEnumSchema.array().optional(),
}).strict() 

export const Activity_eventsFindManyArgsSchema: z.ZodType<Prisma.Activity_eventsFindManyArgs> = z.object({
  select: Activity_eventsSelectSchema.optional(),
  where: Activity_eventsWhereInputSchema.optional(),
  orderBy: z.union([ Activity_eventsOrderByWithRelationInputSchema.array(),Activity_eventsOrderByWithRelationInputSchema ]).optional(),
  cursor: Activity_eventsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: Activity_eventsScalarFieldEnumSchema.array().optional(),
}).strict() 

export const Activity_eventsAggregateArgsSchema: z.ZodType<Prisma.Activity_eventsAggregateArgs> = z.object({
  where: Activity_eventsWhereInputSchema.optional(),
  orderBy: z.union([ Activity_eventsOrderByWithRelationInputSchema.array(),Activity_eventsOrderByWithRelationInputSchema ]).optional(),
  cursor: Activity_eventsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict() 

export const Activity_eventsGroupByArgsSchema: z.ZodType<Prisma.Activity_eventsGroupByArgs> = z.object({
  where: Activity_eventsWhereInputSchema.optional(),
  orderBy: z.union([ Activity_eventsOrderByWithAggregationInputSchema.array(),Activity_eventsOrderByWithAggregationInputSchema ]).optional(),
  by: Activity_eventsScalarFieldEnumSchema.array(),
  having: Activity_eventsScalarWhereWithAggregatesInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict() 

export const Activity_eventsFindUniqueArgsSchema: z.ZodType<Prisma.Activity_eventsFindUniqueArgs> = z.object({
  select: Activity_eventsSelectSchema.optional(),
  where: Activity_eventsWhereUniqueInputSchema,
}).strict() 

export const Activity_eventsFindUniqueOrThrowArgsSchema: z.ZodType<Prisma.Activity_eventsFindUniqueOrThrowArgs> = z.object({
  select: Activity_eventsSelectSchema.optional(),
  where: Activity_eventsWhereUniqueInputSchema,
}).strict() 

export const Background_jobsFindFirstArgsSchema: z.ZodType<Prisma.Background_jobsFindFirstArgs> = z.object({
  select: Background_jobsSelectSchema.optional(),
  where: Background_jobsWhereInputSchema.optional(),
  orderBy: z.union([ Background_jobsOrderByWithRelationInputSchema.array(),Background_jobsOrderByWithRelationInputSchema ]).optional(),
  cursor: Background_jobsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: Background_jobsScalarFieldEnumSchema.array().optional(),
}).strict() 

export const Background_jobsFindFirstOrThrowArgsSchema: z.ZodType<Prisma.Background_jobsFindFirstOrThrowArgs> = z.object({
  select: Background_jobsSelectSchema.optional(),
  where: Background_jobsWhereInputSchema.optional(),
  orderBy: z.union([ Background_jobsOrderByWithRelationInputSchema.array(),Background_jobsOrderByWithRelationInputSchema ]).optional(),
  cursor: Background_jobsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: Background_jobsScalarFieldEnumSchema.array().optional(),
}).strict() 

export const Background_jobsFindManyArgsSchema: z.ZodType<Prisma.Background_jobsFindManyArgs> = z.object({
  select: Background_jobsSelectSchema.optional(),
  where: Background_jobsWhereInputSchema.optional(),
  orderBy: z.union([ Background_jobsOrderByWithRelationInputSchema.array(),Background_jobsOrderByWithRelationInputSchema ]).optional(),
  cursor: Background_jobsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: Background_jobsScalarFieldEnumSchema.array().optional(),
}).strict() 

export const Background_jobsAggregateArgsSchema: z.ZodType<Prisma.Background_jobsAggregateArgs> = z.object({
  where: Background_jobsWhereInputSchema.optional(),
  orderBy: z.union([ Background_jobsOrderByWithRelationInputSchema.array(),Background_jobsOrderByWithRelationInputSchema ]).optional(),
  cursor: Background_jobsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict() 

export const Background_jobsGroupByArgsSchema: z.ZodType<Prisma.Background_jobsGroupByArgs> = z.object({
  where: Background_jobsWhereInputSchema.optional(),
  orderBy: z.union([ Background_jobsOrderByWithAggregationInputSchema.array(),Background_jobsOrderByWithAggregationInputSchema ]).optional(),
  by: Background_jobsScalarFieldEnumSchema.array(),
  having: Background_jobsScalarWhereWithAggregatesInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict() 

export const Background_jobsFindUniqueArgsSchema: z.ZodType<Prisma.Background_jobsFindUniqueArgs> = z.object({
  select: Background_jobsSelectSchema.optional(),
  where: Background_jobsWhereUniqueInputSchema,
}).strict() 

export const Background_jobsFindUniqueOrThrowArgsSchema: z.ZodType<Prisma.Background_jobsFindUniqueOrThrowArgs> = z.object({
  select: Background_jobsSelectSchema.optional(),
  where: Background_jobsWhereUniqueInputSchema,
}).strict() 

export const Chat_roomFindFirstArgsSchema: z.ZodType<Prisma.Chat_roomFindFirstArgs> = z.object({
  select: Chat_roomSelectSchema.optional(),
  where: Chat_roomWhereInputSchema.optional(),
  orderBy: z.union([ Chat_roomOrderByWithRelationInputSchema.array(),Chat_roomOrderByWithRelationInputSchema ]).optional(),
  cursor: Chat_roomWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: Chat_roomScalarFieldEnumSchema.array().optional(),
}).strict() 

export const Chat_roomFindFirstOrThrowArgsSchema: z.ZodType<Prisma.Chat_roomFindFirstOrThrowArgs> = z.object({
  select: Chat_roomSelectSchema.optional(),
  where: Chat_roomWhereInputSchema.optional(),
  orderBy: z.union([ Chat_roomOrderByWithRelationInputSchema.array(),Chat_roomOrderByWithRelationInputSchema ]).optional(),
  cursor: Chat_roomWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: Chat_roomScalarFieldEnumSchema.array().optional(),
}).strict() 

export const Chat_roomFindManyArgsSchema: z.ZodType<Prisma.Chat_roomFindManyArgs> = z.object({
  select: Chat_roomSelectSchema.optional(),
  where: Chat_roomWhereInputSchema.optional(),
  orderBy: z.union([ Chat_roomOrderByWithRelationInputSchema.array(),Chat_roomOrderByWithRelationInputSchema ]).optional(),
  cursor: Chat_roomWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: Chat_roomScalarFieldEnumSchema.array().optional(),
}).strict() 

export const Chat_roomAggregateArgsSchema: z.ZodType<Prisma.Chat_roomAggregateArgs> = z.object({
  where: Chat_roomWhereInputSchema.optional(),
  orderBy: z.union([ Chat_roomOrderByWithRelationInputSchema.array(),Chat_roomOrderByWithRelationInputSchema ]).optional(),
  cursor: Chat_roomWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict() 

export const Chat_roomGroupByArgsSchema: z.ZodType<Prisma.Chat_roomGroupByArgs> = z.object({
  where: Chat_roomWhereInputSchema.optional(),
  orderBy: z.union([ Chat_roomOrderByWithAggregationInputSchema.array(),Chat_roomOrderByWithAggregationInputSchema ]).optional(),
  by: Chat_roomScalarFieldEnumSchema.array(),
  having: Chat_roomScalarWhereWithAggregatesInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict() 

export const Chat_roomFindUniqueArgsSchema: z.ZodType<Prisma.Chat_roomFindUniqueArgs> = z.object({
  select: Chat_roomSelectSchema.optional(),
  where: Chat_roomWhereUniqueInputSchema,
}).strict() 

export const Chat_roomFindUniqueOrThrowArgsSchema: z.ZodType<Prisma.Chat_roomFindUniqueOrThrowArgs> = z.object({
  select: Chat_roomSelectSchema.optional(),
  where: Chat_roomWhereUniqueInputSchema,
}).strict() 

export const Commerce_ordersFindFirstArgsSchema: z.ZodType<Prisma.Commerce_ordersFindFirstArgs> = z.object({
  select: Commerce_ordersSelectSchema.optional(),
  where: Commerce_ordersWhereInputSchema.optional(),
  orderBy: z.union([ Commerce_ordersOrderByWithRelationInputSchema.array(),Commerce_ordersOrderByWithRelationInputSchema ]).optional(),
  cursor: Commerce_ordersWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: Commerce_ordersScalarFieldEnumSchema.array().optional(),
}).strict() 

export const Commerce_ordersFindFirstOrThrowArgsSchema: z.ZodType<Prisma.Commerce_ordersFindFirstOrThrowArgs> = z.object({
  select: Commerce_ordersSelectSchema.optional(),
  where: Commerce_ordersWhereInputSchema.optional(),
  orderBy: z.union([ Commerce_ordersOrderByWithRelationInputSchema.array(),Commerce_ordersOrderByWithRelationInputSchema ]).optional(),
  cursor: Commerce_ordersWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: Commerce_ordersScalarFieldEnumSchema.array().optional(),
}).strict() 

export const Commerce_ordersFindManyArgsSchema: z.ZodType<Prisma.Commerce_ordersFindManyArgs> = z.object({
  select: Commerce_ordersSelectSchema.optional(),
  where: Commerce_ordersWhereInputSchema.optional(),
  orderBy: z.union([ Commerce_ordersOrderByWithRelationInputSchema.array(),Commerce_ordersOrderByWithRelationInputSchema ]).optional(),
  cursor: Commerce_ordersWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: Commerce_ordersScalarFieldEnumSchema.array().optional(),
}).strict() 

export const Commerce_ordersAggregateArgsSchema: z.ZodType<Prisma.Commerce_ordersAggregateArgs> = z.object({
  where: Commerce_ordersWhereInputSchema.optional(),
  orderBy: z.union([ Commerce_ordersOrderByWithRelationInputSchema.array(),Commerce_ordersOrderByWithRelationInputSchema ]).optional(),
  cursor: Commerce_ordersWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict() 

export const Commerce_ordersGroupByArgsSchema: z.ZodType<Prisma.Commerce_ordersGroupByArgs> = z.object({
  where: Commerce_ordersWhereInputSchema.optional(),
  orderBy: z.union([ Commerce_ordersOrderByWithAggregationInputSchema.array(),Commerce_ordersOrderByWithAggregationInputSchema ]).optional(),
  by: Commerce_ordersScalarFieldEnumSchema.array(),
  having: Commerce_ordersScalarWhereWithAggregatesInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict() 

export const Commerce_ordersFindUniqueArgsSchema: z.ZodType<Prisma.Commerce_ordersFindUniqueArgs> = z.object({
  select: Commerce_ordersSelectSchema.optional(),
  where: Commerce_ordersWhereUniqueInputSchema,
}).strict() 

export const Commerce_ordersFindUniqueOrThrowArgsSchema: z.ZodType<Prisma.Commerce_ordersFindUniqueOrThrowArgs> = z.object({
  select: Commerce_ordersSelectSchema.optional(),
  where: Commerce_ordersWhereUniqueInputSchema,
}).strict() 

export const LogsFindFirstArgsSchema: z.ZodType<Prisma.LogsFindFirstArgs> = z.object({
  select: LogsSelectSchema.optional(),
  where: LogsWhereInputSchema.optional(),
  orderBy: z.union([ LogsOrderByWithRelationInputSchema.array(),LogsOrderByWithRelationInputSchema ]).optional(),
  cursor: LogsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: LogsScalarFieldEnumSchema.array().optional(),
}).strict() 

export const LogsFindFirstOrThrowArgsSchema: z.ZodType<Prisma.LogsFindFirstOrThrowArgs> = z.object({
  select: LogsSelectSchema.optional(),
  where: LogsWhereInputSchema.optional(),
  orderBy: z.union([ LogsOrderByWithRelationInputSchema.array(),LogsOrderByWithRelationInputSchema ]).optional(),
  cursor: LogsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: LogsScalarFieldEnumSchema.array().optional(),
}).strict() 

export const LogsFindManyArgsSchema: z.ZodType<Prisma.LogsFindManyArgs> = z.object({
  select: LogsSelectSchema.optional(),
  where: LogsWhereInputSchema.optional(),
  orderBy: z.union([ LogsOrderByWithRelationInputSchema.array(),LogsOrderByWithRelationInputSchema ]).optional(),
  cursor: LogsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: LogsScalarFieldEnumSchema.array().optional(),
}).strict() 

export const LogsAggregateArgsSchema: z.ZodType<Prisma.LogsAggregateArgs> = z.object({
  where: LogsWhereInputSchema.optional(),
  orderBy: z.union([ LogsOrderByWithRelationInputSchema.array(),LogsOrderByWithRelationInputSchema ]).optional(),
  cursor: LogsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict() 

export const LogsGroupByArgsSchema: z.ZodType<Prisma.LogsGroupByArgs> = z.object({
  where: LogsWhereInputSchema.optional(),
  orderBy: z.union([ LogsOrderByWithAggregationInputSchema.array(),LogsOrderByWithAggregationInputSchema ]).optional(),
  by: LogsScalarFieldEnumSchema.array(),
  having: LogsScalarWhereWithAggregatesInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict() 

export const LogsFindUniqueArgsSchema: z.ZodType<Prisma.LogsFindUniqueArgs> = z.object({
  select: LogsSelectSchema.optional(),
  where: LogsWhereUniqueInputSchema,
}).strict() 

export const LogsFindUniqueOrThrowArgsSchema: z.ZodType<Prisma.LogsFindUniqueOrThrowArgs> = z.object({
  select: LogsSelectSchema.optional(),
  where: LogsWhereUniqueInputSchema,
}).strict() 

export const MonitoringFindFirstArgsSchema: z.ZodType<Prisma.MonitoringFindFirstArgs> = z.object({
  select: MonitoringSelectSchema.optional(),
  where: MonitoringWhereInputSchema.optional(),
  orderBy: z.union([ MonitoringOrderByWithRelationInputSchema.array(),MonitoringOrderByWithRelationInputSchema ]).optional(),
  cursor: MonitoringWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: MonitoringScalarFieldEnumSchema.array().optional(),
}).strict() 

export const MonitoringFindFirstOrThrowArgsSchema: z.ZodType<Prisma.MonitoringFindFirstOrThrowArgs> = z.object({
  select: MonitoringSelectSchema.optional(),
  where: MonitoringWhereInputSchema.optional(),
  orderBy: z.union([ MonitoringOrderByWithRelationInputSchema.array(),MonitoringOrderByWithRelationInputSchema ]).optional(),
  cursor: MonitoringWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: MonitoringScalarFieldEnumSchema.array().optional(),
}).strict() 

export const MonitoringFindManyArgsSchema: z.ZodType<Prisma.MonitoringFindManyArgs> = z.object({
  select: MonitoringSelectSchema.optional(),
  where: MonitoringWhereInputSchema.optional(),
  orderBy: z.union([ MonitoringOrderByWithRelationInputSchema.array(),MonitoringOrderByWithRelationInputSchema ]).optional(),
  cursor: MonitoringWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: MonitoringScalarFieldEnumSchema.array().optional(),
}).strict() 

export const MonitoringAggregateArgsSchema: z.ZodType<Prisma.MonitoringAggregateArgs> = z.object({
  where: MonitoringWhereInputSchema.optional(),
  orderBy: z.union([ MonitoringOrderByWithRelationInputSchema.array(),MonitoringOrderByWithRelationInputSchema ]).optional(),
  cursor: MonitoringWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict() 

export const MonitoringGroupByArgsSchema: z.ZodType<Prisma.MonitoringGroupByArgs> = z.object({
  where: MonitoringWhereInputSchema.optional(),
  orderBy: z.union([ MonitoringOrderByWithAggregationInputSchema.array(),MonitoringOrderByWithAggregationInputSchema ]).optional(),
  by: MonitoringScalarFieldEnumSchema.array(),
  having: MonitoringScalarWhereWithAggregatesInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict() 

export const MonitoringFindUniqueArgsSchema: z.ZodType<Prisma.MonitoringFindUniqueArgs> = z.object({
  select: MonitoringSelectSchema.optional(),
  where: MonitoringWhereUniqueInputSchema,
}).strict() 

export const MonitoringFindUniqueOrThrowArgsSchema: z.ZodType<Prisma.MonitoringFindUniqueOrThrowArgs> = z.object({
  select: MonitoringSelectSchema.optional(),
  where: MonitoringWhereUniqueInputSchema,
}).strict() 

export const RequestsFindFirstArgsSchema: z.ZodType<Prisma.RequestsFindFirstArgs> = z.object({
  select: RequestsSelectSchema.optional(),
  include: RequestsIncludeSchema.optional(),
  where: RequestsWhereInputSchema.optional(),
  orderBy: z.union([ RequestsOrderByWithRelationInputSchema.array(),RequestsOrderByWithRelationInputSchema ]).optional(),
  cursor: RequestsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: RequestsScalarFieldEnumSchema.array().optional(),
}).strict() as z.ZodType<Prisma.RequestsFindFirstArgs>

export const RequestsFindFirstOrThrowArgsSchema: z.ZodType<Prisma.RequestsFindFirstOrThrowArgs> = z.object({
  select: RequestsSelectSchema.optional(),
  include: RequestsIncludeSchema.optional(),
  where: RequestsWhereInputSchema.optional(),
  orderBy: z.union([ RequestsOrderByWithRelationInputSchema.array(),RequestsOrderByWithRelationInputSchema ]).optional(),
  cursor: RequestsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: RequestsScalarFieldEnumSchema.array().optional(),
}).strict() as z.ZodType<Prisma.RequestsFindFirstOrThrowArgs>

export const RequestsFindManyArgsSchema: z.ZodType<Prisma.RequestsFindManyArgs> = z.object({
  select: RequestsSelectSchema.optional(),
  include: RequestsIncludeSchema.optional(),
  where: RequestsWhereInputSchema.optional(),
  orderBy: z.union([ RequestsOrderByWithRelationInputSchema.array(),RequestsOrderByWithRelationInputSchema ]).optional(),
  cursor: RequestsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: RequestsScalarFieldEnumSchema.array().optional(),
}).strict() as z.ZodType<Prisma.RequestsFindManyArgs>

export const RequestsAggregateArgsSchema: z.ZodType<Prisma.RequestsAggregateArgs> = z.object({
  where: RequestsWhereInputSchema.optional(),
  orderBy: z.union([ RequestsOrderByWithRelationInputSchema.array(),RequestsOrderByWithRelationInputSchema ]).optional(),
  cursor: RequestsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict() as z.ZodType<Prisma.RequestsAggregateArgs>

export const RequestsGroupByArgsSchema: z.ZodType<Prisma.RequestsGroupByArgs> = z.object({
  where: RequestsWhereInputSchema.optional(),
  orderBy: z.union([ RequestsOrderByWithAggregationInputSchema.array(),RequestsOrderByWithAggregationInputSchema ]).optional(),
  by: RequestsScalarFieldEnumSchema.array(),
  having: RequestsScalarWhereWithAggregatesInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict() as z.ZodType<Prisma.RequestsGroupByArgs>

export const RequestsFindUniqueArgsSchema: z.ZodType<Prisma.RequestsFindUniqueArgs> = z.object({
  select: RequestsSelectSchema.optional(),
  include: RequestsIncludeSchema.optional(),
  where: RequestsWhereUniqueInputSchema,
}).strict() as z.ZodType<Prisma.RequestsFindUniqueArgs>

export const RequestsFindUniqueOrThrowArgsSchema: z.ZodType<Prisma.RequestsFindUniqueOrThrowArgs> = z.object({
  select: RequestsSelectSchema.optional(),
  include: RequestsIncludeSchema.optional(),
  where: RequestsWhereUniqueInputSchema,
}).strict() as z.ZodType<Prisma.RequestsFindUniqueOrThrowArgs>

export const ResponsesFindFirstArgsSchema: z.ZodType<Prisma.ResponsesFindFirstArgs> = z.object({
  select: ResponsesSelectSchema.optional(),
  include: ResponsesIncludeSchema.optional(),
  where: ResponsesWhereInputSchema.optional(),
  orderBy: z.union([ ResponsesOrderByWithRelationInputSchema.array(),ResponsesOrderByWithRelationInputSchema ]).optional(),
  cursor: ResponsesWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: ResponsesScalarFieldEnumSchema.array().optional(),
}).strict() as z.ZodType<Prisma.ResponsesFindFirstArgs>

export const ResponsesFindFirstOrThrowArgsSchema: z.ZodType<Prisma.ResponsesFindFirstOrThrowArgs> = z.object({
  select: ResponsesSelectSchema.optional(),
  include: ResponsesIncludeSchema.optional(),
  where: ResponsesWhereInputSchema.optional(),
  orderBy: z.union([ ResponsesOrderByWithRelationInputSchema.array(),ResponsesOrderByWithRelationInputSchema ]).optional(),
  cursor: ResponsesWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: ResponsesScalarFieldEnumSchema.array().optional(),
}).strict() as z.ZodType<Prisma.ResponsesFindFirstOrThrowArgs>

export const ResponsesFindManyArgsSchema: z.ZodType<Prisma.ResponsesFindManyArgs> = z.object({
  select: ResponsesSelectSchema.optional(),
  include: ResponsesIncludeSchema.optional(),
  where: ResponsesWhereInputSchema.optional(),
  orderBy: z.union([ ResponsesOrderByWithRelationInputSchema.array(),ResponsesOrderByWithRelationInputSchema ]).optional(),
  cursor: ResponsesWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: ResponsesScalarFieldEnumSchema.array().optional(),
}).strict() as z.ZodType<Prisma.ResponsesFindManyArgs>

export const ResponsesAggregateArgsSchema: z.ZodType<Prisma.ResponsesAggregateArgs> = z.object({
  where: ResponsesWhereInputSchema.optional(),
  orderBy: z.union([ ResponsesOrderByWithRelationInputSchema.array(),ResponsesOrderByWithRelationInputSchema ]).optional(),
  cursor: ResponsesWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict() as z.ZodType<Prisma.ResponsesAggregateArgs>

export const ResponsesGroupByArgsSchema: z.ZodType<Prisma.ResponsesGroupByArgs> = z.object({
  where: ResponsesWhereInputSchema.optional(),
  orderBy: z.union([ ResponsesOrderByWithAggregationInputSchema.array(),ResponsesOrderByWithAggregationInputSchema ]).optional(),
  by: ResponsesScalarFieldEnumSchema.array(),
  having: ResponsesScalarWhereWithAggregatesInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict() as z.ZodType<Prisma.ResponsesGroupByArgs>

export const ResponsesFindUniqueArgsSchema: z.ZodType<Prisma.ResponsesFindUniqueArgs> = z.object({
  select: ResponsesSelectSchema.optional(),
  include: ResponsesIncludeSchema.optional(),
  where: ResponsesWhereUniqueInputSchema,
}).strict() as z.ZodType<Prisma.ResponsesFindUniqueArgs>

export const ResponsesFindUniqueOrThrowArgsSchema: z.ZodType<Prisma.ResponsesFindUniqueOrThrowArgs> = z.object({
  select: ResponsesSelectSchema.optional(),
  include: ResponsesIncludeSchema.optional(),
  where: ResponsesWhereUniqueInputSchema,
}).strict() as z.ZodType<Prisma.ResponsesFindUniqueOrThrowArgs>

export const Activity_eventsCreateArgsSchema: z.ZodType<Prisma.Activity_eventsCreateArgs> = z.object({
  select: Activity_eventsSelectSchema.optional(),
  data: z.union([ Activity_eventsCreateInputSchema,Activity_eventsUncheckedCreateInputSchema ]),
}).strict() 

export const Activity_eventsUpsertArgsSchema: z.ZodType<Prisma.Activity_eventsUpsertArgs> = z.object({
  select: Activity_eventsSelectSchema.optional(),
  where: Activity_eventsWhereUniqueInputSchema,
  create: z.union([ Activity_eventsCreateInputSchema,Activity_eventsUncheckedCreateInputSchema ]),
  update: z.union([ Activity_eventsUpdateInputSchema,Activity_eventsUncheckedUpdateInputSchema ]),
}).strict() 

export const Activity_eventsCreateManyArgsSchema: z.ZodType<Prisma.Activity_eventsCreateManyArgs> = z.object({
  data: Activity_eventsCreateManyInputSchema.array(),
  skipDuplicates: z.boolean().optional(),
}).strict() 

export const Activity_eventsDeleteArgsSchema: z.ZodType<Prisma.Activity_eventsDeleteArgs> = z.object({
  select: Activity_eventsSelectSchema.optional(),
  where: Activity_eventsWhereUniqueInputSchema,
}).strict() 

export const Activity_eventsUpdateArgsSchema: z.ZodType<Prisma.Activity_eventsUpdateArgs> = z.object({
  select: Activity_eventsSelectSchema.optional(),
  data: z.union([ Activity_eventsUpdateInputSchema,Activity_eventsUncheckedUpdateInputSchema ]),
  where: Activity_eventsWhereUniqueInputSchema,
}).strict() 

export const Activity_eventsUpdateManyArgsSchema: z.ZodType<Prisma.Activity_eventsUpdateManyArgs> = z.object({
  data: z.union([ Activity_eventsUpdateManyMutationInputSchema,Activity_eventsUncheckedUpdateManyInputSchema ]),
  where: Activity_eventsWhereInputSchema.optional(),
}).strict() 

export const Activity_eventsDeleteManyArgsSchema: z.ZodType<Prisma.Activity_eventsDeleteManyArgs> = z.object({
  where: Activity_eventsWhereInputSchema.optional(),
}).strict() 

export const Background_jobsCreateArgsSchema: z.ZodType<Prisma.Background_jobsCreateArgs> = z.object({
  select: Background_jobsSelectSchema.optional(),
  data: z.union([ Background_jobsCreateInputSchema,Background_jobsUncheckedCreateInputSchema ]),
}).strict() 

export const Background_jobsUpsertArgsSchema: z.ZodType<Prisma.Background_jobsUpsertArgs> = z.object({
  select: Background_jobsSelectSchema.optional(),
  where: Background_jobsWhereUniqueInputSchema,
  create: z.union([ Background_jobsCreateInputSchema,Background_jobsUncheckedCreateInputSchema ]),
  update: z.union([ Background_jobsUpdateInputSchema,Background_jobsUncheckedUpdateInputSchema ]),
}).strict() 

export const Background_jobsCreateManyArgsSchema: z.ZodType<Prisma.Background_jobsCreateManyArgs> = z.object({
  data: Background_jobsCreateManyInputSchema.array(),
  skipDuplicates: z.boolean().optional(),
}).strict() 

export const Background_jobsDeleteArgsSchema: z.ZodType<Prisma.Background_jobsDeleteArgs> = z.object({
  select: Background_jobsSelectSchema.optional(),
  where: Background_jobsWhereUniqueInputSchema,
}).strict() 

export const Background_jobsUpdateArgsSchema: z.ZodType<Prisma.Background_jobsUpdateArgs> = z.object({
  select: Background_jobsSelectSchema.optional(),
  data: z.union([ Background_jobsUpdateInputSchema,Background_jobsUncheckedUpdateInputSchema ]),
  where: Background_jobsWhereUniqueInputSchema,
}).strict() 

export const Background_jobsUpdateManyArgsSchema: z.ZodType<Prisma.Background_jobsUpdateManyArgs> = z.object({
  data: z.union([ Background_jobsUpdateManyMutationInputSchema,Background_jobsUncheckedUpdateManyInputSchema ]),
  where: Background_jobsWhereInputSchema.optional(),
}).strict() 

export const Background_jobsDeleteManyArgsSchema: z.ZodType<Prisma.Background_jobsDeleteManyArgs> = z.object({
  where: Background_jobsWhereInputSchema.optional(),
}).strict() 

export const Chat_roomCreateArgsSchema: z.ZodType<Prisma.Chat_roomCreateArgs> = z.object({
  select: Chat_roomSelectSchema.optional(),
  data: z.union([ Chat_roomCreateInputSchema,Chat_roomUncheckedCreateInputSchema ]),
}).strict() 

export const Chat_roomUpsertArgsSchema: z.ZodType<Prisma.Chat_roomUpsertArgs> = z.object({
  select: Chat_roomSelectSchema.optional(),
  where: Chat_roomWhereUniqueInputSchema,
  create: z.union([ Chat_roomCreateInputSchema,Chat_roomUncheckedCreateInputSchema ]),
  update: z.union([ Chat_roomUpdateInputSchema,Chat_roomUncheckedUpdateInputSchema ]),
}).strict() 

export const Chat_roomCreateManyArgsSchema: z.ZodType<Prisma.Chat_roomCreateManyArgs> = z.object({
  data: Chat_roomCreateManyInputSchema.array(),
  skipDuplicates: z.boolean().optional(),
}).strict() 

export const Chat_roomDeleteArgsSchema: z.ZodType<Prisma.Chat_roomDeleteArgs> = z.object({
  select: Chat_roomSelectSchema.optional(),
  where: Chat_roomWhereUniqueInputSchema,
}).strict() 

export const Chat_roomUpdateArgsSchema: z.ZodType<Prisma.Chat_roomUpdateArgs> = z.object({
  select: Chat_roomSelectSchema.optional(),
  data: z.union([ Chat_roomUpdateInputSchema,Chat_roomUncheckedUpdateInputSchema ]),
  where: Chat_roomWhereUniqueInputSchema,
}).strict() 

export const Chat_roomUpdateManyArgsSchema: z.ZodType<Prisma.Chat_roomUpdateManyArgs> = z.object({
  data: z.union([ Chat_roomUpdateManyMutationInputSchema,Chat_roomUncheckedUpdateManyInputSchema ]),
  where: Chat_roomWhereInputSchema.optional(),
}).strict() 

export const Chat_roomDeleteManyArgsSchema: z.ZodType<Prisma.Chat_roomDeleteManyArgs> = z.object({
  where: Chat_roomWhereInputSchema.optional(),
}).strict() 

export const Commerce_ordersCreateArgsSchema: z.ZodType<Prisma.Commerce_ordersCreateArgs> = z.object({
  select: Commerce_ordersSelectSchema.optional(),
  data: z.union([ Commerce_ordersCreateInputSchema,Commerce_ordersUncheckedCreateInputSchema ]),
}).strict() 

export const Commerce_ordersUpsertArgsSchema: z.ZodType<Prisma.Commerce_ordersUpsertArgs> = z.object({
  select: Commerce_ordersSelectSchema.optional(),
  where: Commerce_ordersWhereUniqueInputSchema,
  create: z.union([ Commerce_ordersCreateInputSchema,Commerce_ordersUncheckedCreateInputSchema ]),
  update: z.union([ Commerce_ordersUpdateInputSchema,Commerce_ordersUncheckedUpdateInputSchema ]),
}).strict() 

export const Commerce_ordersCreateManyArgsSchema: z.ZodType<Prisma.Commerce_ordersCreateManyArgs> = z.object({
  data: Commerce_ordersCreateManyInputSchema.array(),
  skipDuplicates: z.boolean().optional(),
}).strict() 

export const Commerce_ordersDeleteArgsSchema: z.ZodType<Prisma.Commerce_ordersDeleteArgs> = z.object({
  select: Commerce_ordersSelectSchema.optional(),
  where: Commerce_ordersWhereUniqueInputSchema,
}).strict() 

export const Commerce_ordersUpdateArgsSchema: z.ZodType<Prisma.Commerce_ordersUpdateArgs> = z.object({
  select: Commerce_ordersSelectSchema.optional(),
  data: z.union([ Commerce_ordersUpdateInputSchema,Commerce_ordersUncheckedUpdateInputSchema ]),
  where: Commerce_ordersWhereUniqueInputSchema,
}).strict() 

export const Commerce_ordersUpdateManyArgsSchema: z.ZodType<Prisma.Commerce_ordersUpdateManyArgs> = z.object({
  data: z.union([ Commerce_ordersUpdateManyMutationInputSchema,Commerce_ordersUncheckedUpdateManyInputSchema ]),
  where: Commerce_ordersWhereInputSchema.optional(),
}).strict() 

export const Commerce_ordersDeleteManyArgsSchema: z.ZodType<Prisma.Commerce_ordersDeleteManyArgs> = z.object({
  where: Commerce_ordersWhereInputSchema.optional(),
}).strict() 

export const LogsCreateArgsSchema: z.ZodType<Prisma.LogsCreateArgs> = z.object({
  select: LogsSelectSchema.optional(),
  data: z.union([ LogsCreateInputSchema,LogsUncheckedCreateInputSchema ]),
}).strict() 

export const LogsUpsertArgsSchema: z.ZodType<Prisma.LogsUpsertArgs> = z.object({
  select: LogsSelectSchema.optional(),
  where: LogsWhereUniqueInputSchema,
  create: z.union([ LogsCreateInputSchema,LogsUncheckedCreateInputSchema ]),
  update: z.union([ LogsUpdateInputSchema,LogsUncheckedUpdateInputSchema ]),
}).strict() 

export const LogsCreateManyArgsSchema: z.ZodType<Prisma.LogsCreateManyArgs> = z.object({
  data: LogsCreateManyInputSchema.array(),
  skipDuplicates: z.boolean().optional(),
}).strict() 

export const LogsDeleteArgsSchema: z.ZodType<Prisma.LogsDeleteArgs> = z.object({
  select: LogsSelectSchema.optional(),
  where: LogsWhereUniqueInputSchema,
}).strict() 

export const LogsUpdateArgsSchema: z.ZodType<Prisma.LogsUpdateArgs> = z.object({
  select: LogsSelectSchema.optional(),
  data: z.union([ LogsUpdateInputSchema,LogsUncheckedUpdateInputSchema ]),
  where: LogsWhereUniqueInputSchema,
}).strict() 

export const LogsUpdateManyArgsSchema: z.ZodType<Prisma.LogsUpdateManyArgs> = z.object({
  data: z.union([ LogsUpdateManyMutationInputSchema,LogsUncheckedUpdateManyInputSchema ]),
  where: LogsWhereInputSchema.optional(),
}).strict() 

export const LogsDeleteManyArgsSchema: z.ZodType<Prisma.LogsDeleteManyArgs> = z.object({
  where: LogsWhereInputSchema.optional(),
}).strict() 

export const MonitoringCreateArgsSchema: z.ZodType<Prisma.MonitoringCreateArgs> = z.object({
  select: MonitoringSelectSchema.optional(),
  data: z.union([ MonitoringCreateInputSchema,MonitoringUncheckedCreateInputSchema ]),
}).strict() 

export const MonitoringUpsertArgsSchema: z.ZodType<Prisma.MonitoringUpsertArgs> = z.object({
  select: MonitoringSelectSchema.optional(),
  where: MonitoringWhereUniqueInputSchema,
  create: z.union([ MonitoringCreateInputSchema,MonitoringUncheckedCreateInputSchema ]),
  update: z.union([ MonitoringUpdateInputSchema,MonitoringUncheckedUpdateInputSchema ]),
}).strict() 

export const MonitoringCreateManyArgsSchema: z.ZodType<Prisma.MonitoringCreateManyArgs> = z.object({
  data: MonitoringCreateManyInputSchema.array(),
  skipDuplicates: z.boolean().optional(),
}).strict() 

export const MonitoringDeleteArgsSchema: z.ZodType<Prisma.MonitoringDeleteArgs> = z.object({
  select: MonitoringSelectSchema.optional(),
  where: MonitoringWhereUniqueInputSchema,
}).strict() 

export const MonitoringUpdateArgsSchema: z.ZodType<Prisma.MonitoringUpdateArgs> = z.object({
  select: MonitoringSelectSchema.optional(),
  data: z.union([ MonitoringUpdateInputSchema,MonitoringUncheckedUpdateInputSchema ]),
  where: MonitoringWhereUniqueInputSchema,
}).strict() 

export const MonitoringUpdateManyArgsSchema: z.ZodType<Prisma.MonitoringUpdateManyArgs> = z.object({
  data: z.union([ MonitoringUpdateManyMutationInputSchema,MonitoringUncheckedUpdateManyInputSchema ]),
  where: MonitoringWhereInputSchema.optional(),
}).strict() 

export const MonitoringDeleteManyArgsSchema: z.ZodType<Prisma.MonitoringDeleteManyArgs> = z.object({
  where: MonitoringWhereInputSchema.optional(),
}).strict() 

export const RequestsCreateArgsSchema: z.ZodType<Prisma.RequestsCreateArgs> = z.object({
  select: RequestsSelectSchema.optional(),
  include: RequestsIncludeSchema.optional(),
  data: z.union([ RequestsCreateInputSchema,RequestsUncheckedCreateInputSchema ]),
}).strict() as z.ZodType<Prisma.RequestsCreateArgs>

export const RequestsUpsertArgsSchema: z.ZodType<Prisma.RequestsUpsertArgs> = z.object({
  select: RequestsSelectSchema.optional(),
  include: RequestsIncludeSchema.optional(),
  where: RequestsWhereUniqueInputSchema,
  create: z.union([ RequestsCreateInputSchema,RequestsUncheckedCreateInputSchema ]),
  update: z.union([ RequestsUpdateInputSchema,RequestsUncheckedUpdateInputSchema ]),
}).strict() as z.ZodType<Prisma.RequestsUpsertArgs>

export const RequestsCreateManyArgsSchema: z.ZodType<Prisma.RequestsCreateManyArgs> = z.object({
  data: RequestsCreateManyInputSchema.array(),
  skipDuplicates: z.boolean().optional(),
}).strict() as z.ZodType<Prisma.RequestsCreateManyArgs>

export const RequestsDeleteArgsSchema: z.ZodType<Prisma.RequestsDeleteArgs> = z.object({
  select: RequestsSelectSchema.optional(),
  include: RequestsIncludeSchema.optional(),
  where: RequestsWhereUniqueInputSchema,
}).strict() as z.ZodType<Prisma.RequestsDeleteArgs>

export const RequestsUpdateArgsSchema: z.ZodType<Prisma.RequestsUpdateArgs> = z.object({
  select: RequestsSelectSchema.optional(),
  include: RequestsIncludeSchema.optional(),
  data: z.union([ RequestsUpdateInputSchema,RequestsUncheckedUpdateInputSchema ]),
  where: RequestsWhereUniqueInputSchema,
}).strict() as z.ZodType<Prisma.RequestsUpdateArgs>

export const RequestsUpdateManyArgsSchema: z.ZodType<Prisma.RequestsUpdateManyArgs> = z.object({
  data: z.union([ RequestsUpdateManyMutationInputSchema,RequestsUncheckedUpdateManyInputSchema ]),
  where: RequestsWhereInputSchema.optional(),
}).strict() as z.ZodType<Prisma.RequestsUpdateManyArgs>

export const RequestsDeleteManyArgsSchema: z.ZodType<Prisma.RequestsDeleteManyArgs> = z.object({
  where: RequestsWhereInputSchema.optional(),
}).strict() as z.ZodType<Prisma.RequestsDeleteManyArgs>

export const ResponsesCreateArgsSchema: z.ZodType<Prisma.ResponsesCreateArgs> = z.object({
  select: ResponsesSelectSchema.optional(),
  include: ResponsesIncludeSchema.optional(),
  data: z.union([ ResponsesCreateInputSchema,ResponsesUncheckedCreateInputSchema ]),
}).strict() as z.ZodType<Prisma.ResponsesCreateArgs>

export const ResponsesUpsertArgsSchema: z.ZodType<Prisma.ResponsesUpsertArgs> = z.object({
  select: ResponsesSelectSchema.optional(),
  include: ResponsesIncludeSchema.optional(),
  where: ResponsesWhereUniqueInputSchema,
  create: z.union([ ResponsesCreateInputSchema,ResponsesUncheckedCreateInputSchema ]),
  update: z.union([ ResponsesUpdateInputSchema,ResponsesUncheckedUpdateInputSchema ]),
}).strict() as z.ZodType<Prisma.ResponsesUpsertArgs>

export const ResponsesCreateManyArgsSchema: z.ZodType<Prisma.ResponsesCreateManyArgs> = z.object({
  data: ResponsesCreateManyInputSchema.array(),
  skipDuplicates: z.boolean().optional(),
}).strict() as z.ZodType<Prisma.ResponsesCreateManyArgs>

export const ResponsesDeleteArgsSchema: z.ZodType<Prisma.ResponsesDeleteArgs> = z.object({
  select: ResponsesSelectSchema.optional(),
  include: ResponsesIncludeSchema.optional(),
  where: ResponsesWhereUniqueInputSchema,
}).strict() as z.ZodType<Prisma.ResponsesDeleteArgs>

export const ResponsesUpdateArgsSchema: z.ZodType<Prisma.ResponsesUpdateArgs> = z.object({
  select: ResponsesSelectSchema.optional(),
  include: ResponsesIncludeSchema.optional(),
  data: z.union([ ResponsesUpdateInputSchema,ResponsesUncheckedUpdateInputSchema ]),
  where: ResponsesWhereUniqueInputSchema,
}).strict() as z.ZodType<Prisma.ResponsesUpdateArgs>

export const ResponsesUpdateManyArgsSchema: z.ZodType<Prisma.ResponsesUpdateManyArgs> = z.object({
  data: z.union([ ResponsesUpdateManyMutationInputSchema,ResponsesUncheckedUpdateManyInputSchema ]),
  where: ResponsesWhereInputSchema.optional(),
}).strict() as z.ZodType<Prisma.ResponsesUpdateManyArgs>

export const ResponsesDeleteManyArgsSchema: z.ZodType<Prisma.ResponsesDeleteManyArgs> = z.object({
  where: ResponsesWhereInputSchema.optional(),
}).strict() as z.ZodType<Prisma.ResponsesDeleteManyArgs>

interface Activity_eventsGetPayload extends HKT {
  readonly _A?: boolean | null | undefined | Prisma.Activity_eventsArgs
  readonly type: Prisma.Activity_eventsGetPayload<this['_A']>
}

interface Background_jobsGetPayload extends HKT {
  readonly _A?: boolean | null | undefined | Prisma.Background_jobsArgs
  readonly type: Prisma.Background_jobsGetPayload<this['_A']>
}

interface Chat_roomGetPayload extends HKT {
  readonly _A?: boolean | null | undefined | Prisma.Chat_roomArgs
  readonly type: Prisma.Chat_roomGetPayload<this['_A']>
}

interface Commerce_ordersGetPayload extends HKT {
  readonly _A?: boolean | null | undefined | Prisma.Commerce_ordersArgs
  readonly type: Prisma.Commerce_ordersGetPayload<this['_A']>
}

interface LogsGetPayload extends HKT {
  readonly _A?: boolean | null | undefined | Prisma.LogsArgs
  readonly type: Prisma.LogsGetPayload<this['_A']>
}

interface MonitoringGetPayload extends HKT {
  readonly _A?: boolean | null | undefined | Prisma.MonitoringArgs
  readonly type: Prisma.MonitoringGetPayload<this['_A']>
}

interface RequestsGetPayload extends HKT {
  readonly _A?: boolean | null | undefined | Prisma.RequestsArgs
  readonly type: Prisma.RequestsGetPayload<this['_A']>
}

interface ResponsesGetPayload extends HKT {
  readonly _A?: boolean | null | undefined | Prisma.ResponsesArgs
  readonly type: Prisma.ResponsesGetPayload<this['_A']>
}

export const tableSchemas = {
  activity_events: {
    fields: new Map([
      [
        "id",
        "UUID"
      ],
      [
        "source_user_id",
        "UUID"
      ],
      [
        "target_user_id",
        "UUID"
      ],
      [
        "activity_type",
        "TEXT"
      ],
      [
        "timestamp",
        "TIMESTAMPTZ"
      ],
      [
        "message",
        "TEXT"
      ],
      [
        "action",
        "TEXT"
      ],
      [
        "read_at",
        "TIMESTAMPTZ"
      ]
    ]),
    relations: [
    ],
    modelSchema: (Activity_eventsCreateInputSchema as any)
      .partial()
      .or((Activity_eventsUncheckedCreateInputSchema as any).partial()),
    createSchema: Activity_eventsCreateArgsSchema,
    createManySchema: Activity_eventsCreateManyArgsSchema,
    findUniqueSchema: Activity_eventsFindUniqueArgsSchema,
    findSchema: Activity_eventsFindFirstArgsSchema,
    updateSchema: Activity_eventsUpdateArgsSchema,
    updateManySchema: Activity_eventsUpdateManyArgsSchema,
    upsertSchema: Activity_eventsUpsertArgsSchema,
    deleteSchema: Activity_eventsDeleteArgsSchema,
    deleteManySchema: Activity_eventsDeleteManyArgsSchema
  } as TableSchema<
    z.infer<typeof Activity_eventsCreateInputSchema>,
    Prisma.Activity_eventsCreateArgs['data'],
    Prisma.Activity_eventsUpdateArgs['data'],
    Prisma.Activity_eventsFindFirstArgs['select'],
    Prisma.Activity_eventsFindFirstArgs['where'],
    Prisma.Activity_eventsFindUniqueArgs['where'],
    never,
    Prisma.Activity_eventsFindFirstArgs['orderBy'],
    Prisma.Activity_eventsScalarFieldEnum,
    Activity_eventsGetPayload
  >,
  background_jobs: {
    fields: new Map([
      [
        "id",
        "UUID"
      ],
      [
        "timestamp",
        "TIMESTAMPTZ"
      ],
      [
        "payload",
        "JSONB"
      ],
      [
        "completed",
        "BOOL"
      ],
      [
        "cancelled",
        "BOOL"
      ],
      [
        "progress",
        "FLOAT4"
      ],
      [
        "result",
        "JSONB"
      ]
    ]),
    relations: [
    ],
    modelSchema: (Background_jobsCreateInputSchema as any)
      .partial()
      .or((Background_jobsUncheckedCreateInputSchema as any).partial()),
    createSchema: Background_jobsCreateArgsSchema,
    createManySchema: Background_jobsCreateManyArgsSchema,
    findUniqueSchema: Background_jobsFindUniqueArgsSchema,
    findSchema: Background_jobsFindFirstArgsSchema,
    updateSchema: Background_jobsUpdateArgsSchema,
    updateManySchema: Background_jobsUpdateManyArgsSchema,
    upsertSchema: Background_jobsUpsertArgsSchema,
    deleteSchema: Background_jobsDeleteArgsSchema,
    deleteManySchema: Background_jobsDeleteManyArgsSchema
  } as TableSchema<
    z.infer<typeof Background_jobsCreateInputSchema>,
    Prisma.Background_jobsCreateArgs['data'],
    Prisma.Background_jobsUpdateArgs['data'],
    Prisma.Background_jobsFindFirstArgs['select'],
    Prisma.Background_jobsFindFirstArgs['where'],
    Prisma.Background_jobsFindUniqueArgs['where'],
    never,
    Prisma.Background_jobsFindFirstArgs['orderBy'],
    Prisma.Background_jobsScalarFieldEnum,
    Background_jobsGetPayload
  >,
  chat_room: {
    fields: new Map([
      [
        "id",
        "UUID"
      ],
      [
        "timestamp",
        "TIMESTAMPTZ"
      ],
      [
        "username",
        "TEXT"
      ],
      [
        "message",
        "TEXT"
      ]
    ]),
    relations: [
    ],
    modelSchema: (Chat_roomCreateInputSchema as any)
      .partial()
      .or((Chat_roomUncheckedCreateInputSchema as any).partial()),
    createSchema: Chat_roomCreateArgsSchema,
    createManySchema: Chat_roomCreateManyArgsSchema,
    findUniqueSchema: Chat_roomFindUniqueArgsSchema,
    findSchema: Chat_roomFindFirstArgsSchema,
    updateSchema: Chat_roomUpdateArgsSchema,
    updateManySchema: Chat_roomUpdateManyArgsSchema,
    upsertSchema: Chat_roomUpsertArgsSchema,
    deleteSchema: Chat_roomDeleteArgsSchema,
    deleteManySchema: Chat_roomDeleteManyArgsSchema
  } as TableSchema<
    z.infer<typeof Chat_roomCreateInputSchema>,
    Prisma.Chat_roomCreateArgs['data'],
    Prisma.Chat_roomUpdateArgs['data'],
    Prisma.Chat_roomFindFirstArgs['select'],
    Prisma.Chat_roomFindFirstArgs['where'],
    Prisma.Chat_roomFindUniqueArgs['where'],
    never,
    Prisma.Chat_roomFindFirstArgs['orderBy'],
    Prisma.Chat_roomScalarFieldEnum,
    Chat_roomGetPayload
  >,
  commerce_orders: {
    fields: new Map([
      [
        "order_id",
        "UUID"
      ],
      [
        "timestamp",
        "TIMESTAMPTZ"
      ],
      [
        "price_amount",
        "FLOAT4"
      ],
      [
        "price_currency",
        "VARCHAR"
      ],
      [
        "promo_code",
        "VARCHAR"
      ],
      [
        "customer_full_name",
        "VARCHAR"
      ],
      [
        "country",
        "VARCHAR"
      ],
      [
        "product",
        "VARCHAR"
      ]
    ]),
    relations: [
    ],
    modelSchema: (Commerce_ordersCreateInputSchema as any)
      .partial()
      .or((Commerce_ordersUncheckedCreateInputSchema as any).partial()),
    createSchema: Commerce_ordersCreateArgsSchema,
    createManySchema: Commerce_ordersCreateManyArgsSchema,
    findUniqueSchema: Commerce_ordersFindUniqueArgsSchema,
    findSchema: Commerce_ordersFindFirstArgsSchema,
    updateSchema: Commerce_ordersUpdateArgsSchema,
    updateManySchema: Commerce_ordersUpdateManyArgsSchema,
    upsertSchema: Commerce_ordersUpsertArgsSchema,
    deleteSchema: Commerce_ordersDeleteArgsSchema,
    deleteManySchema: Commerce_ordersDeleteManyArgsSchema
  } as TableSchema<
    z.infer<typeof Commerce_ordersCreateInputSchema>,
    Prisma.Commerce_ordersCreateArgs['data'],
    Prisma.Commerce_ordersUpdateArgs['data'],
    Prisma.Commerce_ordersFindFirstArgs['select'],
    Prisma.Commerce_ordersFindFirstArgs['where'],
    Prisma.Commerce_ordersFindUniqueArgs['where'],
    never,
    Prisma.Commerce_ordersFindFirstArgs['orderBy'],
    Prisma.Commerce_ordersScalarFieldEnum,
    Commerce_ordersGetPayload
  >,
  logs: {
    fields: new Map([
      [
        "id",
        "UUID"
      ],
      [
        "source_id",
        "UUID"
      ],
      [
        "timestamp",
        "TIMESTAMPTZ"
      ],
      [
        "content",
        "TEXT"
      ]
    ]),
    relations: [
    ],
    modelSchema: (LogsCreateInputSchema as any)
      .partial()
      .or((LogsUncheckedCreateInputSchema as any).partial()),
    createSchema: LogsCreateArgsSchema,
    createManySchema: LogsCreateManyArgsSchema,
    findUniqueSchema: LogsFindUniqueArgsSchema,
    findSchema: LogsFindFirstArgsSchema,
    updateSchema: LogsUpdateArgsSchema,
    updateManySchema: LogsUpdateManyArgsSchema,
    upsertSchema: LogsUpsertArgsSchema,
    deleteSchema: LogsDeleteArgsSchema,
    deleteManySchema: LogsDeleteManyArgsSchema
  } as TableSchema<
    z.infer<typeof LogsCreateInputSchema>,
    Prisma.LogsCreateArgs['data'],
    Prisma.LogsUpdateArgs['data'],
    Prisma.LogsFindFirstArgs['select'],
    Prisma.LogsFindFirstArgs['where'],
    Prisma.LogsFindUniqueArgs['where'],
    never,
    Prisma.LogsFindFirstArgs['orderBy'],
    Prisma.LogsScalarFieldEnum,
    LogsGetPayload
  >,
  monitoring: {
    fields: new Map([
      [
        "id",
        "UUID"
      ],
      [
        "timestamp",
        "TIMESTAMPTZ"
      ],
      [
        "type",
        "TEXT"
      ],
      [
        "value",
        "FLOAT8"
      ]
    ]),
    relations: [
    ],
    modelSchema: (MonitoringCreateInputSchema as any)
      .partial()
      .or((MonitoringUncheckedCreateInputSchema as any).partial()),
    createSchema: MonitoringCreateArgsSchema,
    createManySchema: MonitoringCreateManyArgsSchema,
    findUniqueSchema: MonitoringFindUniqueArgsSchema,
    findSchema: MonitoringFindFirstArgsSchema,
    updateSchema: MonitoringUpdateArgsSchema,
    updateManySchema: MonitoringUpdateManyArgsSchema,
    upsertSchema: MonitoringUpsertArgsSchema,
    deleteSchema: MonitoringDeleteArgsSchema,
    deleteManySchema: MonitoringDeleteManyArgsSchema
  } as TableSchema<
    z.infer<typeof MonitoringCreateInputSchema>,
    Prisma.MonitoringCreateArgs['data'],
    Prisma.MonitoringUpdateArgs['data'],
    Prisma.MonitoringFindFirstArgs['select'],
    Prisma.MonitoringFindFirstArgs['where'],
    Prisma.MonitoringFindUniqueArgs['where'],
    never,
    Prisma.MonitoringFindFirstArgs['orderBy'],
    Prisma.MonitoringScalarFieldEnum,
    MonitoringGetPayload
  >,
  requests: {
    fields: new Map([
      [
        "id",
        "UUID"
      ],
      [
        "timestamp",
        "TIMESTAMPTZ"
      ],
      [
        "path",
        "TEXT"
      ],
      [
        "method",
        "TEXT"
      ],
      [
        "data",
        "JSONB"
      ],
      [
        "processing",
        "BOOL"
      ],
      [
        "cancelled",
        "BOOL"
      ]
    ]),
    relations: [
      new Relation("responses", "", "", "responses", "RequestsToResponses", "many"),
    ],
    modelSchema: (RequestsCreateInputSchema as any)
      .partial()
      .or((RequestsUncheckedCreateInputSchema as any).partial()),
    createSchema: RequestsCreateArgsSchema,
    createManySchema: RequestsCreateManyArgsSchema,
    findUniqueSchema: RequestsFindUniqueArgsSchema,
    findSchema: RequestsFindFirstArgsSchema,
    updateSchema: RequestsUpdateArgsSchema,
    updateManySchema: RequestsUpdateManyArgsSchema,
    upsertSchema: RequestsUpsertArgsSchema,
    deleteSchema: RequestsDeleteArgsSchema,
    deleteManySchema: RequestsDeleteManyArgsSchema
  } as TableSchema<
    z.infer<typeof RequestsCreateInputSchema>,
    Prisma.RequestsCreateArgs['data'],
    Prisma.RequestsUpdateArgs['data'],
    Prisma.RequestsFindFirstArgs['select'],
    Prisma.RequestsFindFirstArgs['where'],
    Prisma.RequestsFindUniqueArgs['where'],
    Omit<Prisma.RequestsInclude, '_count'>,
    Prisma.RequestsFindFirstArgs['orderBy'],
    Prisma.RequestsScalarFieldEnum,
    RequestsGetPayload
  >,
  responses: {
    fields: new Map([
      [
        "id",
        "UUID"
      ],
      [
        "timestamp",
        "TIMESTAMPTZ"
      ],
      [
        "request_id",
        "UUID"
      ],
      [
        "status_code",
        "INT4"
      ],
      [
        "data",
        "JSONB"
      ]
    ]),
    relations: [
      new Relation("requests", "request_id", "id", "requests", "RequestsToResponses", "one"),
    ],
    modelSchema: (ResponsesCreateInputSchema as any)
      .partial()
      .or((ResponsesUncheckedCreateInputSchema as any).partial()),
    createSchema: ResponsesCreateArgsSchema,
    createManySchema: ResponsesCreateManyArgsSchema,
    findUniqueSchema: ResponsesFindUniqueArgsSchema,
    findSchema: ResponsesFindFirstArgsSchema,
    updateSchema: ResponsesUpdateArgsSchema,
    updateManySchema: ResponsesUpdateManyArgsSchema,
    upsertSchema: ResponsesUpsertArgsSchema,
    deleteSchema: ResponsesDeleteArgsSchema,
    deleteManySchema: ResponsesDeleteManyArgsSchema
  } as TableSchema<
    z.infer<typeof ResponsesCreateInputSchema>,
    Prisma.ResponsesCreateArgs['data'],
    Prisma.ResponsesUpdateArgs['data'],
    Prisma.ResponsesFindFirstArgs['select'],
    Prisma.ResponsesFindFirstArgs['where'],
    Prisma.ResponsesFindUniqueArgs['where'],
    Omit<Prisma.ResponsesInclude, '_count'>,
    Prisma.ResponsesFindFirstArgs['orderBy'],
    Prisma.ResponsesScalarFieldEnum,
    ResponsesGetPayload
  >,
}

export const schema = new DbSchema(tableSchemas, migrations)
export type Electric = ElectricClient<typeof schema>
export const JsonNull = { __is_electric_json_null__: true }
