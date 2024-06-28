/* eslint-disable @typescript-eslint/no-explicit-any */
type ObjectWithRequiredProperty<T> = T & { isRequired: boolean }

export function getAllBoolCombinations<T extends Record<string, any>>(
  arr: ObjectWithRequiredProperty<T>[]
): ObjectWithRequiredProperty<T>[][] {
  const result: ObjectWithRequiredProperty<T>[][] = []

  function combine(start: number, soFar: ObjectWithRequiredProperty<T>[]) {
    if (soFar.length === arr.length) {
      result.push(soFar.slice())
      return
    }

    // include current element
    combine(start + 1, [...soFar, { ...arr[start], isRequired: true }])

    // exclude current element
    combine(start + 1, [...soFar, { ...arr[start], isRequired: false }])
  }

  combine(0, [])
  return result
}
