type RetVal = {
  elapsed: number,
  result: any
}

export const timeResolution = async (promise: Promise<any>): Promise<RetVal> => {
  const t1 = Date.now()

  const result = await promise

  const t2 = Date.now()
  const elapsed = Math.round(t2 - t1)

  return {
    elapsed,
    result
  }
}
