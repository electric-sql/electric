export const ELECTRIC_URL =
  import.meta.env.VITE_ELECTRIC_URL || 'http://localhost:3000'

export const envParams: { source_id?: string; source_secret?: string } =
  import.meta.env.VITE_ELECTRIC_SOURCE_SECRET &&
  import.meta.env.VITE_ELECTRIC_SOURCE_ID
    ? {
        source_id: import.meta.env.VITE_ELECTRIC_SOURCE_ID,
        source_secret: import.meta.env.VITE_ELECTRIC_SOURCE_SECRET,
      }
    : {}
