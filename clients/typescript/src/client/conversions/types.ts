export enum PgBasicType {
  PG_BOOL = 'BOOL',
  PG_INT = 'INT',
  PG_INT2 = 'INT2',
  PG_INT4 = 'INT4',
  PG_INT8 = 'INT8',
  PG_INTEGER = 'INTEGER',
  PG_REAL = 'REAL',
  PG_FLOAT4 = 'FLOAT4',
  PG_FLOAT8 = 'FLOAT8',
  PG_TEXT = 'TEXT',
  PG_VARCHAR = 'VARCHAR',
  PG_CHAR = 'CHAR',
  PG_UUID = 'UUID',
  PG_JSON = 'JSON',
  PG_JSONB = 'JSONB',
}

/**
 * Union type of all Pg types that are represented by a `Date` in JS/TS.
 */
export enum PgDateType {
  PG_TIMESTAMP = 'TIMESTAMP',
  PG_TIMESTAMPTZ = 'TIMESTAMPTZ',
  PG_DATE = 'DATE',
  PG_TIME = 'TIME',
  PG_TIMETZ = 'TIMETZ',
}

export type PgType = PgBasicType | PgDateType
