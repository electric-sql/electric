// @ts-nocheck
export const BACKEND_URL: string = __BACKEND_URL__
export const SANITISED_DATABASE_URL: string = __SANITISED_DATABASE_URL__
export const DEBUG_MODE: boolean = __DEBUG_MODE__
export const ELECTRIC_URL: string = __ELECTRIC_URL__

// Verify that the database URL does not contain credentials.
if (SANITISED_DATABASE_URL.includes('@')) {
  throw new Error('DO NOT include user credentials in your `SANITISED_DATABASE_URL`!')
}