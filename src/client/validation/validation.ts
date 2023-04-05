import * as z from 'zod'

export function validate<I>(i: I, schema: z.ZodTypeAny): I {
  const parsedObject = schema.parse(i)

  function deepOmit(obj: Record<string, any>) {
    Object.keys(obj).map((key) => {
      const v = obj[key]
      if (v === undefined) delete obj[key]
      else if (typeof v === 'object' && !Array.isArray(v) && v !== null)
        deepOmit(v)
    })
  }

  // Zod allows users to pass `undefined` as the value for optional fields.
  // However, `undefined` is not a valid SQL value and squel.js will not turn `undefined` into `NULL`.
  // Hence, we have to do an additional pass over the `parsedObject` to remove fields whose value is `undefined`.
  deepOmit(parsedObject) as I
  return parsedObject
}
