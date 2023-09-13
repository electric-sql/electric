/**
 * Chunk an array based on the value returned by a mapping function.
 *
 * Returns an iterable, that yields pairs with first value being the
 * return of the mapper function, and the second value being the chunk
 *
 * @param arr array to be chunked
 * @param mapper mapping function designating the chunk "key"
 * @returns an iterable with pairs of chunk "keys" and chunks themselves.
 */
export function chunkBy<T, K>(
  arr: T[],
  mapper: (elem: T, idx: number, arr: T[]) => K
): Iterable<[K, T[]]> {
  return {
    *[Symbol.iterator]() {
      if (arr.length === 0) return

      let currentChunkValue: K = mapper(arr[0], 0, arr)
      let newChunkValue: K
      let currentChunk: T[] = [arr[0]]

      for (let idx = 1; idx < arr.length; ++idx) {
        newChunkValue = mapper(arr[idx], idx, arr)
        if (currentChunkValue === newChunkValue) {
          // Still the same chunk, expand it
          currentChunk.push(arr[idx])
          currentChunkValue = newChunkValue
        } else {
          // Chunk boundary crossed, yield the current chunk and start the new one
          yield [currentChunkValue, currentChunk]
          currentChunkValue = newChunkValue
          currentChunk = [arr[idx]]
        }
      }

      // Yield the last chunk we've been building up in the loop
      yield [currentChunkValue, currentChunk]
    },
  }
}
