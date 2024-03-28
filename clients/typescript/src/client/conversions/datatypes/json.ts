// not the most precise JSON type

import { isObject } from '../../../util'

// but good enough for serialising/deserialising
type JSON = string | number | boolean | Array<any> | Record<string, any>

export function serialiseJSON(v: JSON): string {
  if (isJsonNull(v)) {
    // user provided the special `JsonNull` value
    // to indicate a JSON null value rather than a DB NULL
    return JSON.stringify(null)
  }
  return JSON.stringify(v)
}

export function deserialiseJSON(v: string): JSON {
  if (v === JSON.stringify(null)) return { __is_electric_json_null__: true }
  return JSON.parse(v)
}

function isJsonNull(v: JSON): boolean {
  return (
    isObject(v) &&
    Object.hasOwn(v, '__is_electric_json_null__') &&
    (v as Record<string, any>)['__is_electric_json_null__']
  )
}
