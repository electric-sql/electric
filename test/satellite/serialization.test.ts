import {
  SatRelation_RelationType,
} from '../../src/_generated/proto/satellite';
import { serializeRow, deserializeRow } from '../../src/satellite/client';
import test from 'ava'
import { Relation } from '../../src/util/types';

test("serialize/deserialize row data", async t => {
  const rel: Relation = {
    id: 1,
    schema: 'schema',
    table: 'table',
    tableType: SatRelation_RelationType.TABLE,
    columns: [
      { name: 'name1', type: 'TEXT' },
      { name: 'name2', type: 'TEXT' },
      { name: 'name3', type: 'TEXT' }
  ]}

  const record: Record = {name1: "Hello", 'name2': "World!", 'name3': null }
  const s_row = serializeRow(record, rel)
  const d_row = deserializeRow(s_row, rel)

  t.deepEqual(record, d_row)
})
