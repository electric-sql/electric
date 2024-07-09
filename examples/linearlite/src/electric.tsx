// import.meta.env is a special object that Vite provides for accessing
// environment variables at build time and runtime.
// They are replaced at build time with the actual values.
// https://vitejs.dev/guide/env-and-mode.html
const DEV_MODE = import.meta.env.DEV
const DEBUG_ENV = import.meta.env.DEBUG

const searchParams = new URLSearchParams(window.location.search)
const debugParam = searchParams.get('debug')

// DEBUG defaults to true in dev mode, false in prod mode
export const DEBUG = debugParam ? debugParam === 'true' : DEV_MODE || DEBUG_ENV

export const baseUrl = import.meta.env.ELECTRIC_URL ?? `http://localhost:3000`
