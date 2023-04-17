export const ensurePromise = <T extends Promise<any>>(candidate: T): T => {
  if (candidate instanceof Promise) {
    return candidate
  }

  throw new Error(`
    Expecting promises to be enabled.

    ElectricSQL does not support disabling promises
    after electrifying your database client.
  `)
}
