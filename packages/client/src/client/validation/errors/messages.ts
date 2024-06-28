export const _NOT_UNIQUE_ =
  'Provided input is not unique, query has several results.'
export function _RECORD_NOT_FOUND_(operationType: string) {
  return `${operationType} failed because the record was not found.`
}
