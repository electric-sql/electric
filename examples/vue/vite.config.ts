import { resolve } from "path"
import { defineConfig } from "vite"
import vue from "@vitejs/plugin-vue"
import pg from "pg"

function maintainersApi() {
  const pool = new pg.Pool({
    connectionString: `postgresql://postgres:password@localhost:54321/electric`,
  })

  return {
    name: `maintainers-api`,
    configureServer(server) {
      server.middlewares.use(`/api/maintainers`, async (req, res) => {
        if (req.method !== `POST`) {
          res.statusCode = 405
          res.end(`Method not allowed`)
          return
        }

        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk)
        const body = JSON.parse(Buffer.concat(chunks).toString())

        try {
          await pool.query(
            `INSERT INTO maintainers (id, github, name, role, location, avatar_url, contributions)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (github) DO NOTHING`,
            [
              body.id,
              body.github,
              body.name,
              body.role,
              body.location,
              body.avatar_url,
              body.contributions,
            ]
          )
          res.statusCode = 200
          res.setHeader(`Content-Type`, `application/json`)
          res.end(JSON.stringify({ ok: true }))
        } catch (e) {
          res.statusCode = 500
          res.setHeader(`Content-Type`, `application/json`)
          res.end(JSON.stringify({ error: (e as Error).message }))
        }
      })
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue(), maintainersApi()],
  resolve: {
    alias: {
      "@electric-sql/vue": resolve(
        __dirname,
        `../../packages/vue-composables/src/index.ts`
      ),
      "@electric-sql/client": resolve(
        __dirname,
        `../../packages/typescript-client/src/index.ts`
      ),
    },
  },
})
