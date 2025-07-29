import "dotenv/config"
import { defineConfig } from "drizzle-kit"

export default defineConfig({
  out: `./src/db/out`,
  schema: `./src/db/schema.ts`,
  dialect: `postgresql`,
  casing: `snake_case`,
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
})
