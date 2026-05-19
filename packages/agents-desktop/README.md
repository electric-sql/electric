# Electric Agents Desktop

Desktop app for Electric Agents, built with Electron.

## Development

### Prerequisites

- An agents-server running locally (e.g. at `http://localhost:4437`)

### Running the dev server

```bash
pnpm dev
```

This starts both the UI dev server (with HMR) and the Electron main process.
For a local unauthenticated agents-server, desktop defaults the pull-wake
runner owner to the same `system:dev-local` principal that agents-server uses in
dev fallback mode.

### Environment variables

| Variable                                     | Default                         | Description                                                                                                                                                                  |
| -------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ELECTRIC_DESKTOP_PRINCIPAL`                 | _(none)_                        | Sets the `electric-principal` header on all requests to the agents-server. Usually unnecessary for local development because agents-server falls back to `system:dev-local`. |
| `ELECTRIC_DESKTOP_PULL_WAKE_OWNER_PRINCIPAL` | `/principal/system%3Adev-local` | Override the `owner_principal` used when registering the pull-wake runner. When `ELECTRIC_DESKTOP_PRINCIPAL` is set, this is derived from it automatically.                  |
| `ELECTRIC_DESKTOP_PULL_WAKE_RUNNER_ID`       | _(auto-generated)_              | Fixed runner ID for the pull-wake runner.                                                                                                                                    |
| `ELECTRIC_DESKTOP_PULL_WAKE_REGISTER_RUNNER` | `true`                          | Set to `false` to skip runner registration (runner must already exist on the server).                                                                                        |

### Settings

Desktop settings are stored at:

- **macOS**: `~/Library/Application Support/Electric Agents/settings.json`
- **Linux**: `~/.config/Electric Agents/settings.json`

You can configure servers, per-server headers, and working directory here. In most cases, the env vars above are sufficient for local dev.
