/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SERVER_URL: string
  readonly VITE_ELECTRIC_URL: string
  readonly VITE_ELECTRIC_DATABASE_ID: string
  readonly VITE_ELECTRIC_TOKEN: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
