export { parseTableNames } from '@electric-sql/drivers/util'

const dangerousKeywords = [
  'add',
  'alter',
  'commit',
  'create',
  'delete',
  'drop',
  'exec',
  'insert',
  'select into',
  'set',
  'truncate',
  'update',
]

const dangerousKeywordsExp = new RegExp(
  dangerousKeywords.map((keyword) => `\\b${keyword}\\b`).join('|'),
  'imu'
)

// XXX ideally this could be schema aware to know about dangerous
// stored functions. But it's not the end of the world if we miss
// some updates as the user can notify manually and the satellite
// still picks up the changes via polling.
//
// XXX it's also possible to implement this per statement using
// https://www.sqlite.org/c3ref/stmt_readonly.html
export const isPotentiallyDangerous = (stmt: string): boolean => {
  return dangerousKeywordsExp.test(stmt)
}
