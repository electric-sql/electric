// not the most precise JSON type
// but good enough for serialising/deserialising
type JSON = string | number | boolean | Array<any> | Record<string, any>

export function serialiseJSON(v: JSON): string {
  if (isJsonNull(v)) {
    // user provided the special Prisma.JsonNull value
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
    typeof v === 'object' &&
    !Array.isArray(v) &&
    v !== null &&
    Object.hasOwn(v, '__is_electric_json_null__') &&
    v['__is_electric_json_null__']
  )
}

// TODO: do not use prisma's json null value
//       but define our own
//       and modify the generator to accept ours
//       then we no longer have to pass it all the way through until here
