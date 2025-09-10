export const LIVE_CACHE_BUSTER_HEADER = `electric-cursor`
export const SHAPE_HANDLE_HEADER = `electric-handle`
export const CHUNK_LAST_OFFSET_HEADER = `electric-offset`
export const SHAPE_SCHEMA_HEADER = `electric-schema`
export const CHUNK_UP_TO_DATE_HEADER = `electric-up-to-date`
export const COLUMNS_QUERY_PARAM = `columns`
export const LIVE_CACHE_BUSTER_QUERY_PARAM = `cursor`
export const EXPIRED_HANDLE_QUERY_PARAM = `expired_handle`
export const SHAPE_HANDLE_QUERY_PARAM = `handle`
export const LIVE_QUERY_PARAM = `live`
export const OFFSET_QUERY_PARAM = `offset`
export const TABLE_QUERY_PARAM = `table`
export const WHERE_QUERY_PARAM = `where`
export const REPLICA_PARAM = `replica`
export const WHERE_PARAMS_PARAM = `params`
export const EXPERIMENTAL_LIVE_SSE_QUERY_PARAM = `experimental_live_sse`
export const FORCE_DISCONNECT_AND_REFRESH = `force-disconnect-and-refresh`
export const PAUSE_STREAM = `pause-stream`

// Query parameters that should be passed through when proxying Electric requests
export const ELECTRIC_PROTOCOL_QUERY_PARAMS: Array<string> = [
  LIVE_QUERY_PARAM,
  SHAPE_HANDLE_QUERY_PARAM,
  OFFSET_QUERY_PARAM,
  LIVE_CACHE_BUSTER_QUERY_PARAM,
  EXPIRED_HANDLE_QUERY_PARAM,
]
