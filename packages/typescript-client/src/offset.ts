import { Offset } from './types'

type ComparableOffset = [number, number]

/**
 * Compares two offsets and returns appropriate number for sorting
 * comparisons
 *
 * @param offsetA
 * @param offsetB
 * @returns -1 if offsetA < offsetB, 1 if offsetA > offsetB, 0 if equal
 */
export function compareOffset(offsetA: Offset, offsetB: Offset): 1 | 0 | -1 {
  const [oAx, oAy] = splitOffset(offsetA)
  const [oBx, oBy] = splitOffset(offsetB)
  if (oAx > oBx) return 1
  if (oAx < oBx) return -1
  if (oAy > oBy) return 1
  if (oAy < oBy) return -1
  return 0
}

function splitOffset(offset: Offset): ComparableOffset {
  if (offset === `-1`) return [-1, -1]
  return offset.split(`_`).map(Number) as ComparableOffset
}
