/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SERVER_URL: string
  readonly VITE_ELECTRIC_URL: string
  readonly VITE_ELECTRIC_SOURCE_SECRET: string
  readonly VITE_ELECTRIC_SOURCE_ID: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
