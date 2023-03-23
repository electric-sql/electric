/**
 * @param f Function that is applied to every element of the array. This function must call the provided continuation when it is done processing the element.
 * @param xs The array to loop over.
 */
export function forEachCont<T>(
  f: (x: T, cont: () => void) => void,
  xs: Array<T>
) {
  if (xs.length === 0) {
    return
  } else {
    const [x, ...rest] = xs
    f(x, () => {
      forEachCont(f, rest)
    })
  }
}

/**
 * @param f Function that is applied to every element of the array with the current value of the accumulator. This function must call the provided continuation with the new accumulator.
 * @param acc Initial value of the accumulator.
 * @param xs The array to reduce.
 */
export function reduceCont<T, Acc>(
  f: (x: T, acc: Acc, cont: (acc: Acc) => void) => void,
  acc: Acc,
  xs: Array<T>
) {
  if (xs.length === 0) {
    return acc
  } else {
    const [x, ...rest] = xs
    f(x, acc, (acc: Acc) => {
      reduceCont(f, acc, rest)
    })
  }
}
