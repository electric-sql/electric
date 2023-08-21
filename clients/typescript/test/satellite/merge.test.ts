import test from 'ava'
import { mergeEntries } from '../../src/satellite/merge'
import { OplogEntry, primaryKeyToStr } from '../../src/satellite/oplog'

test('merging entries: local no-op updates should cancel incoming delete', (t) => {
  const pk = primaryKeyToStr({ id: 1 })

  const local: OplogEntry[] = [
    {
      rowid: 0,
      namespace: 'main',
      tablename: 'public',
      optype: 'UPDATE',
      timestamp: '1970-01-02T03:46:41.000Z', // 100001000 as a unix timestamp
      primaryKey: pk,
      newRow: JSON.stringify({ id: 1 }),
      oldRow: undefined,
      clearTags: JSON.stringify(['common@100000000']),
    },
  ]

  const remote: OplogEntry[] = [
    {
      rowid: 0,
      namespace: 'main',
      tablename: 'public',
      optype: 'DELETE',
      timestamp: '1970-01-02T03:46:42.000Z', // 100002000 as a unix timestamp
      primaryKey: pk,
      oldRow: JSON.stringify({ id: 1, value: 'TEST' }),
      clearTags: JSON.stringify(['common@100000000']),
    },
  ]

  const merged = mergeEntries('local', local, 'remote', remote)

  // Merge should resolve into the UPSERT for this row, since the remote DELETE didn't observe this local update
  t.like(merged, { 'main.public': { [pk]: { optype: 'UPSERT' } } })
  t.deepEqual(merged['main.public'][pk].tags, ['local@100001000'])
})
