import { SatRelation_RelationType } from '../../src/_generated/protocol/satellite'
import { serializeRow, deserializeRow } from '../../src/satellite/client'
import test from 'ava'
import { Relation, Record } from '../../src/util/types'

test('serialize/deserialize row data', async (t) => {
  const rel: Relation = {
    id: 1,
    schema: 'schema',
    table: 'table',
    tableType: SatRelation_RelationType.TABLE,
    columns: [
      { name: 'name1', type: 'TEXT' },
      { name: 'name2', type: 'TEXT' },
      { name: 'name3', type: 'TEXT' },
      { name: 'int1', type: 'INTEGER' },
      { name: 'int2', type: 'INTEGER' },
      { name: 'float1', type: 'FLOAT4' },
      { name: 'float2', type: 'FLOAT4' },
    ],
  }

  const record: Record = {
    name1: 'Hello',
    name2: 'World!',
    name3: null,
    int1: 1,
    int2: -30,
    float1: 1.1,
    float2: -30.3,
  }
  const s_row = serializeRow(record, rel)
  const d_row = deserializeRow(s_row, rel)

  t.deepEqual(record, d_row)
})

test('Null mask uses bits as if they were a list', async (t) => {
  const rel: Relation = {
    id: 1,
    schema: 'schema',
    table: 'table',
    tableType: SatRelation_RelationType.TABLE,
    columns: [
      { name: 'bit0', type: 'TEXT' },
      { name: 'bit1', type: 'TEXT' },
      { name: 'bit2', type: 'TEXT' },
      { name: 'bit3', type: 'TEXT' },
      { name: 'bit4', type: 'TEXT' },
      { name: 'bit5', type: 'TEXT' },
      { name: 'bit6', type: 'TEXT' },
      { name: 'bit7', type: 'TEXT' },
      { name: 'bit8', type: 'TEXT' },
    ],
  }

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
  const s_row = serializeRow(record, rel)

  const mask = [...s_row.nullsBitmask].map((x) => x.toString(2)).join('')

  t.is(mask, '1101000010000000')
})
