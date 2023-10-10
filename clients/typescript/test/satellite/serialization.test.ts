import { SatRelation_RelationType } from '../../src/_generated/protocol/satellite'
import { serializeRow, deserializeRow } from '../../src/satellite/client'
import test from 'ava'
import { Relation, Record } from '../../src/util/types'
import { DbSchema, TableSchema } from '../../src/client/model/schema'
import { PgBasicType } from '../../src/client/conversions/types'
import { HKT } from '../../src/client/util/hkt'

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
      { name: 'bool1', type: 'BOOL', isNullable: true },
      { name: 'bool2', type: 'BOOL', isNullable: true },
      { name: 'bool3', type: 'BOOL', isNullable: true },
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
          ['bool1', PgBasicType.PG_BOOL],
          ['bool2', PgBasicType.PG_BOOL],
          ['bool3', PgBasicType.PG_BOOL],
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
    bool1: 1,
    bool2: 0,
    bool3: null,
  }

  const s_row = serializeRow(record, rel, dbDescription)
  t.deepEqual(
    s_row.values.map((bytes) => new TextDecoder().decode(bytes)),
    ['Hello', 'World!', '', '1', '-30', '1.0', '-30.3', 't', 'f', '']
  )

  const d_row = deserializeRow(s_row, rel, dbDescription)
  t.deepEqual(record, d_row)
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
