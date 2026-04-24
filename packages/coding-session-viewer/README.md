# coding-session-viewer

Standalone viewer for an Electric Agents `coding-session` entity. Streams
normalized events from the entity's durable stream and lets viewers post
prompts to the entity's inbox.

## Local dev

```bash
pnpm --filter @electric-ax/coding-session-viewer dev
# http://localhost:5174
```

Paste your agents-server URL (e.g. `http://localhost:4437`) and an entity
URL (e.g. `/coding-session/<nanoid>`) into the landing form, or pass
them directly:

```
http://localhost:5174/?server=http://localhost:4437&entity=/coding-session/<id>
```

## Demo deploy — viewer on Cloudflare, agents-server via ngrok

1. **Expose your agents-server** to the public internet:

   ```bash
   ngrok http 4437
   ```

   Note the `https://<slug>.ngrok-free.app` URL.

2. **Deploy the viewer** to Cloudflare (one-time `wrangler login` first):

   ```bash
   pnpm --filter @electric-ax/coding-session-viewer cf:deploy
   ```

   Deploys to `https://coding-session-viewer.<your-subdomain>.workers.dev`.

3. **Share the URL**:
   ```
   https://coding-session-viewer.<your-subdomain>.workers.dev/?server=https://<ngrok>.ngrok-free.app&entity=/coding-session/<id>
   ```

### Gotchas

- **CORS**: the agents-server must allow cross-origin requests from your
  CF origin. If it doesn't, the viewer can read the entity record but
  the durable-stream subscription will fail silently in the browser
  console. Fix on the server side.
- **Auth**: free-tier ngrok rotates URLs on restart; paid / reserved
  domains survive. The server running in `ELECTRIC_INSECURE=true` mode
  has no auth — don't leave the ngrok tunnel open unattended.
- **localStorage**: the viewer remembers the last `server` URL. Clear
  it in DevTools → Application if a stale ngrok hostname gets stuck.

## Custom domain

Uncomment the `[[routes]]` block in `wrangler.toml`, set the pattern,
and redeploy.
