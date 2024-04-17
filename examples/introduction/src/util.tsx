type RetVal<T> = {
  elapsed: number
  result: T
}

export const timeResolution = async <T,>(
  promise: Promise<T>,
): Promise<RetVal<T>> => {
  const t1 = Date.now()

  const result = await promise

  const t2 = Date.now()
  const elapsed = Math.round(t2 - t1)

  return {
    elapsed,
    result,
  }
}
