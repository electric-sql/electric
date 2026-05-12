export const DEFAULT_TENANT_ID = `default`

export class UnregisteredTenantError extends Error {
  constructor(
    readonly tenantId: string,
    readonly processName: string
  ) {
    super(
      `tenant "${tenantId}" is not registered on this host for ${processName}`
    )
    this.name = `UnregisteredTenantError`
  }
}

export function isUnregisteredTenantError(
  error: unknown
): error is UnregisteredTenantError {
  return (
    error instanceof UnregisteredTenantError ||
    (typeof error === `object` &&
      error !== null &&
      `name` in error &&
      (error as { name?: unknown }).name === `UnregisteredTenantError`)
  )
}
