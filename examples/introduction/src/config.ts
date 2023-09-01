// @ts-nocheck
export const BACKEND_URL: string = __BACKEND_URL__
export const SANITISED_DATABASE_URL: string = __SANITISED_DATABASE_URL__
export const DEBUG_MODE: boolean = __DEBUG_MODE__
export const ELECTRIC_URL: string = __ELECTRIC_URL__

// Verify that the database URL does not contain credentials.
if (SANITISED_DATABASE_URL.includes('@')) {
  throw new Error('DO NOT include user credentials in your `SANITISED_DATABASE_URL`!')
}

/* Call this in the browser to get the debug mode, optionally overriding
 * the env var with a `debug=true` query param.
 */
export const debugMode = (): boolean => {
  const search = window.location.search
  const params = new URLSearchParams(search)

  if (params.get('debug') === 'true') {
    return true
  }

  return DEBUG_MODE
}
