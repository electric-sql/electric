/**
 * Wrap an async action so re-invocations are dropped while a prior call is
 * still in flight (e.g. to stop a button firing a duplicate fork). The guard
 * is synchronous, so it holds on the very next click before any re-render;
 * `onPendingChange` mirrors the in-flight flag out to a React `setState`.
 */
export function singleFlight(
  fn: () => unknown,
  onPendingChange?: (pending: boolean) => void
): { invoke: () => void; isPending: () => boolean } {
  let pending = false
  const update = (next: boolean): void => {
    if (pending === next) return
    pending = next
    onPendingChange?.(next)
  }
  return {
    isPending: () => pending,
    invoke: () => {
      if (pending) return
      update(true)
      try {
        const result = fn()
        Promise.resolve(result).then(
          () => update(false),
          () => update(false)
        )
      } catch {
        // Synchronous throw: the action never went in flight, so clear
        // immediately rather than latching the trigger forever.
        update(false)
      }
    },
  }
}
