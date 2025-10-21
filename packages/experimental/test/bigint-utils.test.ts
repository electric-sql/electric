import { describe, expect, it } from "vitest"
import { bigIntCompare, bigIntMax, bigIntMin } from "../src/bigint-utils"

// Number of args where destructuring them would cause a stack overflow
const STACK_LIMIT_ARG_DESTRUCTURE_NUM = 150000

describe("bigIntMax", () => {
  it("should return the maximum of bigint and number arguments as a bigint", () => {
    expect(bigIntMax([BigInt(1), BigInt(2), BigInt(3)])).toBe(BigInt(3))
    expect(bigIntMax([5, 10, 2])).toBe(BigInt(10))
    expect(bigIntMax([BigInt(1), 2, BigInt(3), 4])).toBe(BigInt(4))
  })

  it("should return the only element as a bigint when there is one argument", () => {
    expect(bigIntMax([BigInt(42)])).toBe(BigInt(42))
    expect(bigIntMax([99])).toBe(BigInt(99))
  })

  it("should handle negative numbers and bigints", () => {
    expect(bigIntMax([BigInt(-10), BigInt(-5), BigInt(-1)])).toBe(BigInt(-1))
    expect(bigIntMax([-100, -50, -10])).toBe(BigInt(-10))
  })

  it("should handle very large number of comparisons", () => {
    const largeArray = Array.from(
      { length: STACK_LIMIT_ARG_DESTRUCTURE_NUM },
      (_, idx) => BigInt(idx)
    )

    expect(bigIntMax(largeArray)).toBe(
      BigInt(STACK_LIMIT_ARG_DESTRUCTURE_NUM - 1)
    )
  })
})

describe("bigIntMin", () => {
  it("should return the minimum of bigint and number arguments as a bigint", () => {
    expect(bigIntMin([BigInt(1), BigInt(2), BigInt(3)])).toBe(BigInt(1))
    expect(bigIntMin([5, 10, 2])).toBe(BigInt(2))
    expect(bigIntMin([BigInt(1), 2, BigInt(3), 4])).toBe(BigInt(1))
  })

  it("should return the only element as a bigint when there is one argument", () => {
    expect(bigIntMin([BigInt(42)])).toBe(BigInt(42))
    expect(bigIntMin([99])).toBe(BigInt(99))
  })

  it("should handle negative numbers and bigints", () => {
    expect(bigIntMin([BigInt(-10), BigInt(-5), BigInt(-1)])).toBe(BigInt(-10))
    expect(bigIntMin([-100, -50, -10])).toBe(BigInt(-100))
  })

  it("should handle very large number of comparisons", () => {
    const largeArray = Array.from(
      { length: STACK_LIMIT_ARG_DESTRUCTURE_NUM },
      (_, idx) => BigInt(idx)
    )
    expect(bigIntMin(largeArray)).toBe(BigInt(0))
  })
})

describe("bigIntCompare", () => {
  it("should return 1 when the first bigint is greater than the second", () => {
    expect(bigIntCompare(BigInt(5), BigInt(3))).toBe(1)
    expect(bigIntCompare(BigInt(100), BigInt(99))).toBe(1)
  })

  it("should return -1 when the first bigint is less than the second", () => {
    expect(bigIntCompare(BigInt(3), BigInt(5))).toBe(-1)
    expect(bigIntCompare(BigInt(99), BigInt(100))).toBe(-1)
  })

  it("should return 0 when both bigints are equal", () => {
    expect(bigIntCompare(BigInt(42), BigInt(42))).toBe(0)
    expect(bigIntCompare(BigInt(0), BigInt(0))).toBe(0)
  })
})
