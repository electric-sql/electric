/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ELECTRIC_API_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.css' {
  const content: string
  export default content
}

declare module '@radix-ui/themes/styles.css'
