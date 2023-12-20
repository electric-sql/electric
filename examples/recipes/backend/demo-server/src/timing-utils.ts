/**
 * Runs specified callback every baseIntervalMs with a variation in timing
 * of magnitude +-variationMs
 */
export function runOnInterval (
  callback: () => void,
  baseIntervalMs: number = 500,
  variationMs: number = 0
): void {
  const runner = (): void => {
    setTimeout(
      () => {
        callback()
        runner()
      },
      baseIntervalMs + variationMs * (2 * Math.random() - 1)
    )
  }
  runner()
}



/**
 * Wait for specified amount of time
 */
export function wait (timeInMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, timeInMs))
}
