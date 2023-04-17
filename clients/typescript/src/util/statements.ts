export function isInsertUpdateOrDeleteStatement(sql: string) {
  const tpe = sql.toLowerCase().trimStart()
  return (
    tpe.startsWith('insert') ||
    tpe.startsWith('update') ||
    tpe.startsWith('delete')
  )
}
