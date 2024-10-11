/// <reference types="vite/client" />
  interface ImportMetaEnv {
    readonly VITE_ELECTRIC_URL: string
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv
  }