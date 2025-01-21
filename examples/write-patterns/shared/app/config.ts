export const ELECTRIC_URL =
  import.meta.env.VITE_ELECTRIC_URL || 'http://localhost:3000'

export const envParams: { source_id?: string; token?: string } =
  import.meta.env.VITE_ELECTRIC_TOKEN &&
  import.meta.env.VITE_ELECTRIC_DATABASE_ID
    ? {
        source_id: import.meta.env.VITE_ELECTRIC_DATABASE_ID,
        token: import.meta.env.VITE_ELECTRIC_TOKEN,
      }
    : {}
