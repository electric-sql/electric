export function bigIntMax(...args: Array<bigint | number>): bigint {
  return BigInt(args.reduce((m, e) => (e > m ? e : m)))
}

export function bigIntMin(...args: Array<bigint | number>): bigint {
  return BigInt(args.reduce((m, e) => (e < m ? e : m)))
}

export function bigIntCompare(a: bigint, b: bigint): 1 | -1 | 0 {
  return a > b ? 1 : a < b ? -1 : 0
}
