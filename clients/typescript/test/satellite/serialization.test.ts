import { SatRelation_RelationType } from '../../src/_generated/protocol/satellite'
import { serializeRow, deserializeRow } from '../../src/satellite/client'
import test from 'ava'
import { Relation, Record } from '../../src/util/types'
import { DbSchema, TableSchema } from '../../src/client/model/schema'
import { PgBasicType } from '../../src/client/conversions/types'
import { HKT } from '../../src/client/util/hkt'
import Database from 'better-sqlite3'
import { DatabaseAdapter } from '../../src/drivers/better-sqlite3'
import { inferRelationsFromSQLite } from '../../src/util/relations'
import { satelliteDefaults } from '../../src/satellite/config'

test('serialize/deserialize row data', async (t) => {
  const rel: Relation = {
    id: 1,
    schema: 'schema',
    table: 'table',
    tableType: SatRelation_RelationType.TABLE,
    columns: [
      { name: 'name1', type: 'TEXT', isNullable: true },
      { name: 'name2', type: 'TEXT', isNullable: true },
      { name: 'name3', type: 'TEXT', isNullable: true },
      { name: 'int1', type: 'INTEGER', isNullable: true },
      { name: 'int2', type: 'INTEGER', isNullable: true },
      { name: 'float1', type: 'REAL', isNullable: true },
      { name: 'float2', type: 'FLOAT4', isNullable: true },
      { name: 'float3', type: 'FLOAT8', isNullable: true },
      { name: 'bool1', type: 'BOOL', isNullable: true },
      { name: 'bool2', type: 'BOOL', isNullable: true },
      { name: 'bool3', type: 'BOOL', isNullable: true },
      // bundled migrations contain type 'TEXT' for enums
      { name: 'enum1', type: 'TEXT', isNullable: true },
      { name: 'enum2', type: 'TEXT', isNullable: true },
    ],
  }

  const dbDescription = new DbSchema(
    {
      table: {
        fields: new Map([
          ['name1', PgBasicType.PG_TEXT],
          ['name2', PgBasicType.PG_TEXT],
          ['name3', PgBasicType.PG_TEXT],
          ['int1', PgBasicType.PG_INTEGER],
          ['int2', PgBasicType.PG_INTEGER],
          ['float1', PgBasicType.PG_REAL],
          ['float2', PgBasicType.PG_FLOAT4],
          ['float3', PgBasicType.PG_FLOAT8],
          ['bool1', PgBasicType.PG_BOOL],
          ['bool2', PgBasicType.PG_BOOL],
          ['bool3', PgBasicType.PG_BOOL],
          // enum types are transformed to text type by our generator
          ['enum1', PgBasicType.PG_TEXT],
          ['enum2', PgBasicType.PG_TEXT],
        ]),
        relations: [],
      } as unknown as TableSchema<
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        HKT
      >,
    },
    []
  )

  const record: Record = {
    name1: 'Hello',
    name2: 'World!',
    name3: null,
    int1: 1,
    int2: -30,
    float1: 1.0,
    float2: -30.3,
    float3: 5e234,
    bool1: 1,
    bool2: 0,
    bool3: null,
    enum1: 'red',
    enum2: null,
  }

  const s_row = serializeRow(record, rel, dbDescription)
  t.deepEqual(
    s_row.values.map((bytes) => new TextDecoder().decode(bytes)),
    [
      'Hello',
      'World!',
      '',
      '1',
      '-30',
      '1',
      '-30.3',
      '5e+234',
      't',
      'f',
      '',
      'red',
      '',
    ]
  )

  const d_row = deserializeRow(s_row, rel, dbDescription)
  t.deepEqual(d_row, record)

  // Test edge cases for floats such as NaN, Infinity, -Infinity
  const record2: Record = {
    name1: 'Edge cases for Floats',
    name2: null,
    name3: null,
    int1: null,
    int2: null,
    float1: NaN,
    float2: Infinity,
    float3: -Infinity,
    bool1: null,
    bool2: null,
    bool3: null,
    enum1: 'red',
    enum2: null,
  }

  const s_row2 = serializeRow(record2, rel, dbDescription)
  t.deepEqual(
    s_row2.values.map((bytes) => new TextDecoder().decode(bytes)),
    [
      'Edge cases for Floats',
      '',
      '',
      '',
      '',
      'NaN',
      'Infinity',
      '-Infinity',
      '',
      '',
      '',
      'red',
      '',
    ]
  )

  const d_row2 = deserializeRow(s_row2, rel, dbDescription)
  t.deepEqual(d_row2, {
    ...record2,
    float1: 'NaN', // SQLite does not support NaN so we deserialise it into the string 'NaN'
  })
})

test('Null mask uses bits as if they were a list', async (t) => {
  const rel: Relation = {
    id: 1,
    schema: 'schema',
    table: 'table',
    tableType: SatRelation_RelationType.TABLE,
    columns: [
      { name: 'bit0', type: 'TEXT', isNullable: true },
      { name: 'bit1', type: 'TEXT', isNullable: true },
      { name: 'bit2', type: 'TEXT', isNullable: true },
      { name: 'bit3', type: 'TEXT', isNullable: true },
      { name: 'bit4', type: 'TEXT', isNullable: true },
      { name: 'bit5', type: 'TEXT', isNullable: true },
      { name: 'bit6', type: 'TEXT', isNullable: true },
      { name: 'bit7', type: 'TEXT', isNullable: true },
      { name: 'bit8', type: 'TEXT', isNullable: true },
    ],
  }

  const dbDescription = new DbSchema(
    {
      table: {
        fields: new Map([
          ['bit0', PgBasicType.PG_TEXT],
          ['bit1', PgBasicType.PG_TEXT],
          ['bit2', PgBasicType.PG_TEXT],
          ['bit3', PgBasicType.PG_TEXT],
          ['bit4', PgBasicType.PG_TEXT],
          ['bit5', PgBasicType.PG_TEXT],
          ['bit6', PgBasicType.PG_TEXT],
          ['bit7', PgBasicType.PG_TEXT],
          ['bit8', PgBasicType.PG_TEXT],
        ]),
        relations: [],
      } as unknown as TableSchema<
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        HKT
      >,
    },
    []
  )

  const record: Record = {
    bit0: null,
    bit1: null,
    bit2: 'Filled',
    bit3: null,
    bit4: 'Filled',
    bit5: 'Filled',
    bit6: 'Filled',
    bit7: 'Filled',
    bit8: null,
  }
  const s_row = serializeRow(record, rel, dbDescription)

  const mask = [...s_row.nullsBitmask].map((x) => x.toString(2)).join('')

  t.is(mask, '1101000010000000')
})

test('Prioritize PG types in the schema before inferred SQLite types', async (t) => {
  const db = new Database(':memory:')
  t.teardown(() => db.close())

  const adapter = new DatabaseAdapter(db)
  await adapter.run({
    sql: 'CREATE TABLE bools (id INTEGER PRIMARY KEY, b INTEGER)',
  })

  const sqliteInferredRelations = await inferRelationsFromSQLite(
    adapter,
    satelliteDefaults
  )
  const boolsInferredRelation = sqliteInferredRelations['bools']

  // Inferred types only support SQLite types, so the bool column is INTEGER
  const boolColumn = boolsInferredRelation.columns[1]
  t.is(boolColumn.name, 'b')
  t.is(boolColumn.type, 'INTEGER')

  // Db schema holds the correct Postgres types
  const boolsDbDescription = new DbSchema(
    {
      bools: {
        fields: new Map([
          ['id', PgBasicType.PG_INTEGER],
          ['b', PgBasicType.PG_BOOL],
        ]),
        relations: [],
      } as unknown as TableSchema<
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        HKT
      >,
    },
    []
  )

  const satOpRow = serializeRow(
    { id: 5, b: 1 },
    boolsInferredRelation,
    boolsDbDescription
  )

  // Encoded values ["5", "t"]
  t.deepEqual(satOpRow.values, [
    new Uint8Array(['5'.charCodeAt(0)]),
    new Uint8Array(['t'.charCodeAt(0)]),
  ])

  const deserializedRow = deserializeRow(
    satOpRow,
    boolsInferredRelation,
    boolsDbDescription
  )

  t.deepEqual(deserializedRow, { id: 5, b: 1 })
})

test('Use incoming Relation types if not found in the schema', async (t) => {
  const db = new Database(':memory:')
  t.teardown(() => db.close())

  const adapter = new DatabaseAdapter(db)

  const sqliteInferredRelations = await inferRelationsFromSQLite(
    adapter,
    satelliteDefaults
  )
  // Empty database
  t.is(Object.keys(sqliteInferredRelations).length, 0)

  // Empty Db schema
  const testDbDescription = new DbSchema({}, [])

  const newTableRelation: Relation = {
    id: 1,
    schema: 'schema',
    table: 'new_table',
    tableType: SatRelation_RelationType.TABLE,
    columns: [
      { name: 'value', type: 'INTEGER', isNullable: true },
      { name: 'color', type: 'COLOR', isNullable: true }, // at runtime, incoming SatRelation messages contain the name of the enum type
    ],
  }

  const row = {
    value: 6,
    color: 'red',
  }

  const satOpRow = serializeRow(row, newTableRelation, testDbDescription)

  t.deepEqual(
    satOpRow.values.map((bytes) => new TextDecoder().decode(bytes)),
    ['6', 'red']
  )

  const deserializedRow = deserializeRow(
    satOpRow,
    newTableRelation,
    testDbDescription
  )

  t.deepEqual(deserializedRow, row)
})
