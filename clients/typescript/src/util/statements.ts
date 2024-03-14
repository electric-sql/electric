export function isInsertUpdateOrDeleteStatement(stmt: string) {
  return /^\s*(insert|update|delete)/i.test(stmt)
}
