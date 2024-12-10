export const ELECTRIC_URL =
  import.meta.env.VITE_ELECTRIC_URL || 'http://localhost:3000'

export const envParams: { database_id?: string; token?: string } =
  import.meta.env.VITE_ELECTRIC_TOKEN &&
  import.meta.env.VITE_ELECTRIC_DATABASE_ID
    ? {
        database_id: import.meta.env.VITE_ELECTRIC_DATABASE_ID,
        token: import.meta.env.VITE_ELECTRIC_TOKEN,
      }
    : {}
