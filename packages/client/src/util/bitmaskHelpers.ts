/**
 * Sets a bit in the mask. Modifies the mask in place.
 *
 * Mask is represented as a Uint8Array, which will be serialized element-by-element as a mask.
 * This means that `indexFromStart` enumerates all bits in the mask in the order they will be serialized:
 *
 * @example
 * setMaskBit(new Uint8Array([0b00000000, 0b00000000]), 0)
 * // => new Uint8Array([0b10000000, 0b00000000])
 *
 * @example
 * setMaskBit(new Uint8Array([0b00000000, 0b00000000]), 8)
 * // => new Uint8Array([0b00000000, 0b10000000])
 *
 * @param array Uint8Array mask
 * @param indexFromStart bit index in the mask
 */

export function setMaskBit(array: Uint8Array, indexFromStart: number): void {
  const byteIndex = Math.floor(indexFromStart / 8)
  const bitIndex = 7 - (indexFromStart % 8)

  const mask = 1 << bitIndex
  array[byteIndex] = array[byteIndex] | mask
}
/**
 * Reads a bit in the mask
 *
 * Mask is represented as a Uint8Array, which will be serialized element-by-element as a mask.
 * This means that `indexFromStart` enumerates all bits in the mask in the order they will be serialized:
 *
 * @example
 * getMaskBit(new Uint8Array([0b10000000, 0b00000000]), 0)
 * // => 1
 *
 * @example
 * getMaskBit(new Uint8Array([0b10000000, 0b00000000]), 8)
 * // => 0
 *
 * @param array Uint8Array mask
 * @param indexFromStart bit index in the mask
 */

export function getMaskBit(array: Uint8Array, indexFromStart: number): 1 | 0 {
  const byteIndex = Math.floor(indexFromStart / 8)
  const bitIndex = 7 - (indexFromStart % 8)

  return ((array[byteIndex] >>> bitIndex) & 1) as 1 | 0
}
