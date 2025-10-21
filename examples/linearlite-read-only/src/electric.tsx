export const baseUrl = import.meta.env.VITE_ELECTRIC_URL
  ? new URL(import.meta.env.VITE_ELECTRIC_URL).origin
  : "http://localhost:3000"
export const secret = import.meta.env.VITE_ELECTRIC_SOURCE_SECRET ?? ""
export const source_id = import.meta.env.VITE_ELECTRIC_SOURCE_ID ?? ""
