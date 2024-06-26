import { SatRelation_RelationType } from '../../src/_generated/protocol/satellite'
import { serializeRow, deserializeRow } from '../../src/satellite/client'
import { TestFn, ExecutionContext } from 'ava'
import { Relation, DbRecord } from '../../src/util/types'
import { DbSchema, TableSchema } from '../../src/client/model/schema'
import { PgBasicType } from '../../src/client/conversions/types'
import { HKT } from '../../src/client/util/hkt'
import { DatabaseAdapter as DatabaseAdapterInterface } from '../../src/electric/adapter'
import { inferRelationsFromDb } from '../../src/util/relations'
import { SatelliteOpts } from '../../src/satellite/config'
import { QueryBuilder } from '../../src/migrators/query-builder'
import { TypeDecoder, TypeEncoder } from '../../src/util/encoders'

export type ContextType = {
  dialect: 'SQLite' | 'Postgres'
  encoder: TypeEncoder
  decoder: TypeDecoder
  setup: SetupFn
}

type MaybePromise<T> = T | Promise<T>
export type SetupFn = (
  t: ExecutionContext<unknown>
) => MaybePromise<[DatabaseAdapterInterface, QueryBuilder, SatelliteOpts]>

export const serializationTests = (test: TestFn<ContextType>) => {
  test('serialize/deserialize row data', async (t) => {
    const { encoder, decoder, dialect } = t.context
    const rel: Relation = {
      id: 1,
      schema: 'schema',
      table: 'table',
      tableType: SatRelation_RelationType.TABLE,
      columns: [
        { name: 'name1', type: 'TEXT', isNullable: true },
        { name: 'name2', type: 'TEXT', isNullable: true },
        { name: 'name3', type: 'TEXT', isNullable: true },
        { name: 'blob1', type: 'BYTEA', isNullable: true },
        { name: 'blob2', type: 'BYTEA', isNullable: true },
        { name: 'blob3', type: 'BYTEA', isNullable: true },
        { name: 'int1', type: 'INTEGER', isNullable: true },
        { name: 'int2', type: 'INTEGER', isNullable: true },
        { name: 'bigint1', type: 'INT8', isNullable: true },
        { name: 'bigint2', type: 'INT8', isNullable: true },
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
          fields: {
            name1: PgBasicType.PG_TEXT,
            name2: PgBasicType.PG_TEXT,
            name3: PgBasicType.PG_TEXT,
            blob1: PgBasicType.PG_BYTEA,
            blob2: PgBasicType.PG_BYTEA,
            blob3: PgBasicType.PG_BYTEA,
            int1: PgBasicType.PG_INTEGER,
            int2: PgBasicType.PG_INTEGER,
            bigint1: PgBasicType.PG_INT8,
            bigint2: PgBasicType.PG_INT8,
            float1: PgBasicType.PG_REAL,
            float2: PgBasicType.PG_FLOAT4,
            float3: PgBasicType.PG_FLOAT8,
            bool1: PgBasicType.PG_BOOL,
            bool2: PgBasicType.PG_BOOL,
            bool3: PgBasicType.PG_BOOL,
            // enum types are transformed to text type by our generator
            enum1: PgBasicType.PG_TEXT,
            enum2: PgBasicType.PG_TEXT,
          },
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
      [],
      []
    )

    const record: DbRecord = {
      name1: 'Hello',
      name2: 'World!',
      name3: null,
      blob1: new Uint8Array([1, 15, 255, 145]),
      blob2: new Uint8Array([]),
      blob3: null,
      int1: 1,
      int2: -30,
      bigint1: '31447483647',
      bigint2: null,
      float1: 1.0,
      float2: -30.3,
      float3: 5e234,
      bool1: dialect === 'SQLite' ? 1 : true,
      bool2: dialect === 'SQLite' ? 0 : false,
      bool3: null,
      enum1: 'red',
      enum2: null,
    }

    const recordKeys = Object.keys(record)

    const s_row = serializeRow(record, rel, dbDescription, encoder)
    t.deepEqual(
      s_row.values.map((bytes, idx) =>
        recordKeys[idx].startsWith('blob')
          ? 'blob'
          : new TextDecoder().decode(bytes)
      ),
      [
        'Hello',
        'World!',
        '',
        'blob',
        'blob',
        'blob',
        '1',
        '-30',
        '31447483647',
        '',
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

    const d_row = deserializeRow(s_row, rel, dbDescription, decoder)
    t.deepEqual(d_row, record)

    // Test edge cases for floats such as NaN, Infinity, -Infinity
    const record2: DbRecord = {
      name1: 'Edge cases for Floats',
      name2: null,
      name3: null,
      blob1: new Uint8Array([0, 1, 255, 245]),
      blob2: new Uint8Array([]),
      blob3: null,
      int1: null,
      int2: null,
      bigint1: null,
      bigint2: null,
      float1: NaN,
      float2: Infinity,
      float3: -Infinity,
      bool1: null,
      bool2: null,
      bool3: null,
      enum1: 'red',
      enum2: null,
    }
    const recordKeys2 = Object.keys(record2)

    const s_row2 = serializeRow(record2, rel, dbDescription, encoder)
    t.deepEqual(
      s_row2.values.map((bytes, idx) =>
        recordKeys2[idx].startsWith('blob')
          ? 'blob'
          : new TextDecoder().decode(bytes)
      ),
      [
        'Edge cases for Floats',
        '',
        '',
        'blob',
        'blob',
        'blob',
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

    const d_row2 = deserializeRow(s_row2, rel, dbDescription, decoder)
    t.deepEqual(d_row2, {
      ...record2,
      float1: 'NaN', // SQLite does not support NaN so we deserialise it into the string 'NaN'
    })
  })

  test('Null mask uses bits as if they were a list', async (t) => {
    const { encoder } = t.context
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
          fields: {
            bit0: PgBasicType.PG_TEXT,
            bit1: PgBasicType.PG_TEXT,
            bit2: PgBasicType.PG_TEXT,
            bit3: PgBasicType.PG_TEXT,
            bit4: PgBasicType.PG_TEXT,
            bit5: PgBasicType.PG_TEXT,
            bit6: PgBasicType.PG_TEXT,
            bit7: PgBasicType.PG_TEXT,
            bit8: PgBasicType.PG_TEXT,
          },
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
      [],
      []
    )

    const record: DbRecord = {
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
    const s_row = serializeRow(record, rel, dbDescription, encoder)

    const mask = [...s_row.nullsBitmask].map((x) => x.toString(2)).join('')

    t.is(mask, '1101000010000000')
  })

  test(`Prioritize PG types in the schema before inferred SQLite types`, async (t) => {
    const { encoder, decoder, dialect } = t.context
    const [adapter, builder, defaults] = await t.context.setup(t)

    await adapter.run({
      sql: 'CREATE TABLE bools (id INTEGER PRIMARY KEY, b INTEGER)',
    })

    const sqliteInferredRelations = await inferRelationsFromDb(
      adapter,
      defaults,
      builder
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
          fields: {
            id: PgBasicType.PG_INTEGER,
            b: PgBasicType.PG_BOOL,
          },
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
      [],
      []
    )

    const satOpRow = serializeRow(
      { id: 5, b: dialect === 'SQLite' ? 1 : true },
      boolsInferredRelation,
      boolsDbDescription,
      encoder
    )

    // Encoded values ["5", "t"]
    t.deepEqual(satOpRow.values, [
      new Uint8Array(['5'.charCodeAt(0)]),
      new Uint8Array(['t'.charCodeAt(0)]),
    ])

    const deserializedRow = deserializeRow(
      satOpRow,
      boolsInferredRelation,
      boolsDbDescription,
      decoder
    )

    t.deepEqual(deserializedRow, { id: 5, b: dialect === 'SQLite' ? 1 : true })
  })

  test(`Use incoming Relation types if not found in the schema`, async (t) => {
    const { encoder, decoder } = t.context
    const [adapter, builder, defaults] = await t.context.setup(t)

    const inferredRelations = await inferRelationsFromDb(
      adapter,
      defaults,
      builder
    )
    // Empty database
    t.is(Object.keys(inferredRelations).length, 0)

    // Empty Db schema
    const testDbDescription = new DbSchema({}, [], [])

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

    const satOpRow = serializeRow(
      row,
      newTableRelation,
      testDbDescription,
      encoder
    )

    t.deepEqual(
      satOpRow.values.map((bytes) => new TextDecoder().decode(bytes)),
      ['6', 'red']
    )

    const deserializedRow = deserializeRow(
      satOpRow,
      newTableRelation,
      testDbDescription,
      decoder
    )

    t.deepEqual(deserializedRow, row)
  })
}
