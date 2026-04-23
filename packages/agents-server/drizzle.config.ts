import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: `./src/db/schema.ts`,
  out: `./drizzle`,
  dialect: `postgresql`,
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      `postgres://electric_agents:electric_agents@localhost:5432/electric_agents`,
  },
})
