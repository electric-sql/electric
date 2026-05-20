---
'@electric-ax/agents-runtime': patch
---

The built-in `bash` tool now spawns children with a filtered subset of the parent environment instead of `{...process.env}`. The default allowlist covers shell/locale/temp/XDG basics, terminal hints (`COLORTERM`, `NO_COLOR`, `FORCE_COLOR`, `CI`), proxy vars (`HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` + lowercase), TLS roots (`NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `SSL_CERT_DIR`), and Windows essentials (`SYSTEMROOT`, `COMSPEC`, `WINDIR`, `APPDATA`, `LOCALAPPDATA`, `USERPROFILE`). Keeps `git`, `npm`, `pnpm`, and most CLI tools functional across dev, CI, and corporate-proxy environments without leaking API keys.

**Breaking:** anything that relied on env-supplied credentials reaching bash via `process.env` — `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GITHUB_TOKEN`, `BRAVE_SEARCH_API_KEY`, custom secrets — silently stops working. Mitigation: pass `allowedEnvKeys: ['GITHUB_TOKEN', ...]` to `createBashTool`. The list extends the safe defaults; it cannot shrink them.
