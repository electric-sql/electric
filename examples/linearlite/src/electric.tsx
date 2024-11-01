export const baseUrl = import.meta.env.VITE_ELECTRIC_URL ? new URL(import.meta.env.VITE_ELECTRIC_URL).origin : `http://localhost:3000`
export const token = import.meta.env.VITE_ELECTRIC_TOKEN ?? ``
export const databaseId = import.meta.env.VITE_DATABASE_ID ?? ``
