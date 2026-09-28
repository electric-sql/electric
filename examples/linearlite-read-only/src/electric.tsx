export const baseUrl = import.meta.env.VITE_ELECTRIC_URL
  ? new URL(import.meta.env.VITE_ELECTRIC_URL).origin
  : `http://localhost:3000`
