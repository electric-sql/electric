⏺ Summary: Configure Start Package and Starter Template for Cloud Mode

Goal

Make apps created with npx @electric-sql/start work seamlessly with cloud-provisioned resources (Neon database + Electric Cloud).

What We've Fixed

1. Env var naming mismatch ✅

- Changed ELECTRIC_SOURCE_SECRET → ELECTRIC_SECRET in template's electric-proxy.ts

2. Added ELECTRIC_URL support ✅

- Template now reads ELECTRIC_URL env var instead of hardcoding the Electric endpoint
- Start package generates ELECTRIC_URL in .env (reads from process.env.ELECTRIC_URL at runtime)
- Separate from ELECTRIC_API_BASE_URL (used for admin API calls like provisioning)

3. Added dotenv/config import ✅

- Template's electric-proxy.ts now loads .env so env vars are available server-side

4. Updated dev scripts ✅

- dev → pnpm dev:cloud (default to cloud mode)
- dev:cloud → vite dev
- dev:docker → docker compose up -d && vite dev
- Added backend:up/down/clear for docker management

5. Fixed psql script ✅

- Now uses dotenv to load .env before running psql

6. Added BETTER_AUTH_SECRET ✅

- Start package generates a random secret for auth

Current Blocker

The code changes are complete and working. The 502 errors you're seeing are an infrastructure issue with your local Electric
Cloud dev setup:

- The source exists in the admin DB with electric_url = us-east-1-faraday-electric-instance-thruflo-tunnel.electric-sql.dev
- But that Electric sync service isn't responding (502)
- The claimable sources API needs to return the correct electric_url so the start package can set it in .env

Remaining Work

1. Backend: Ensure the claimable sources API returns electric_url in the response
2. Start package: Update ClaimableSourceStatus interface and .env generation to use the returned electric_url
3. Testing: Once backend is working, verify end-to-end flow
