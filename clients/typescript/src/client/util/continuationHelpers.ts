/**
 * @param f Function that is applied to every element of the array. This function must call the provided continuation when it is done processing the element.
 * @param xs The array to loop over.
 * @param cont Continuation that is called when `forEachCont` finished processing every element of the array.
 */
export function forEach<T>(
  f: (x: T, cont: () => void) => void,
  xs: Array<T>,
  cont: () => void
) {
  if (xs.length === 0) {
    cont()
  } else {
    const [x, ...rest] = xs
    f(x, () => {
      forEach(f, rest, cont)
    })
  }
}
