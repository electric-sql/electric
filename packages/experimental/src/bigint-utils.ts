export function bigIntMax(nums: Array<bigint | number>): bigint {
  return BigInt(nums.reduce((m, e) => (e > m ? e : m)))
}

export function bigIntMin(nums: Array<bigint | number>): bigint {
  return BigInt(nums.reduce((m, e) => (e < m ? e : m)))
}

export function bigIntCompare(a: bigint, b: bigint): 1 | -1 | 0 {
  return a > b ? 1 : a < b ? -1 : 0
}
