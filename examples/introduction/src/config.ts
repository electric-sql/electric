// Commented out dummy values - the regular ones are injected by Webpack
// for the website build but the source repo uses Vite as its build tool
// const __BACKEND_URL__ = 'http://localhost:40001'
// const __DEBUG_MODE__ = true
// const __ELECTRIC_URL__ = 'ws://localhost:5133'
// const __SANITISED_DATABASE_URL__ = 'dummy'

// @ts-expect-error - injected by webpack
export const BACKEND_URL: string = __BACKEND_URL__
// @ts-expect-error - injected by webpack
export const SANITISED_DATABASE_URL: string = __SANITISED_DATABASE_URL__
// @ts-expect-error - injected by webpack
export const DEBUG_MODE: boolean = __DEBUG_MODE__
// @ts-expect-error - injected by webpack
export const ELECTRIC_URL: string = __ELECTRIC_URL__

// Verify that the database URL does not contain credentials.
if (SANITISED_DATABASE_URL.includes('@')) {
  throw new Error(
    'DO NOT include user credentials in your `SANITISED_DATABASE_URL`!'
  )
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
