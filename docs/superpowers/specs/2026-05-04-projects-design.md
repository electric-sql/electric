# Projects Design

Projects associate agent sessions with a working directory so that horton (and other agents) operate in the right folder. Sessions are grouped by project in the sidebar.

## Data Model

```typescript
interface Project {
  id: string // nanoid(8)
  name: string
  path: string // absolute folder path — becomes the session's cwd
  createdAt: number // ms since epoch
}
```

Stored as a JSON array in `<env-paths('electric-agents').data>/projects.json`.

Uses the `env-paths` npm package to resolve the OS-standard data directory:

- macOS: `~/Library/Application Support/electric-agents/projects.json`
- Linux: `~/.local/share/electric-agents/projects.json`

## Server API

All routes live under `/_electric/projects`.

| Method   | Path                       | Body               | Returns               | Notes                                 |
| -------- | -------------------------- | ------------------ | --------------------- | ------------------------------------- |
| `GET`    | `/_electric/projects`      | —                  | `Project[]`           | List all projects                     |
| `POST`   | `/_electric/projects`      | `{ name, path }`   | `Project`             | Validates path exists on disk         |
| `PATCH`  | `/_electric/projects/:id`  | `{ name?, path? }` | `Project`             | Validates path if provided            |
| `DELETE` | `/_electric/projects/:id`  | —                  | `204`                 | Does not delete sessions              |
| `POST`   | `/_electric/validate-path` | `{ path }`         | `{ valid, resolved }` | Resolves symlinks, checks isDirectory |

## Spawn Flow

When a project is selected:

1. UI passes `tags: { project: projectId }` (for sidebar grouping) **and** `args: { workingDirectory: project.path }` to the spawn request.
2. Horton's handler reads `args.workingDirectory` and uses it instead of the global cwd from bootstrap.
3. If no project is selected, no `workingDirectory` arg is passed and the global cwd is used as today.

### Horton changes

`registerHorton` currently receives a single `workingDirectory` at registration time. The handler needs to check `args.workingDirectory` first:

```typescript
const cwd = (args.workingDirectory as string) || registrationCwd
```

The `creation_schema` for horton should add `workingDirectory` as an optional string property so the server accepts it in spawn args.

## UI

### NewSessionPage

Centered hero layout inspired by Codex:

```
        Let's build
    durable-streams  ^
```

- The project name is displayed as an inline dropdown trigger below the heading text.
- If no project is selected, shows "Select a project ^" (or similar placeholder).
- Clicking opens a popover with:
  - "Select your project" header
  - List of existing projects (folder icon + name, checkmark on active)
  - "Add new project" row at the bottom (opens inline form with name + path inputs)
- The chat composer sits below, same as today.

### Sidebar

No changes needed — the existing `groupByProject` function already groups by `tags.project` and matches against the project list. It just needs to fetch projects from the API instead of localStorage.

### Data fetching

Replace the `useProjects` localStorage hook with one that:

- Fetches projects from `GET /_electric/projects` on mount
- Exposes `createProject`, `deleteProject`, `renameProject` that call the server API and refetch
- Keeps `activeProjectId` in localStorage (UI-only preference)

## File changes

### `packages/agents-server`

- Add `env-paths` dependency
- New file: project store (read/write the JSON file)
- New file: project API routes (CRUD + validate-path)
- Wire routes into the server

### `packages/agents-server-ui`

- Rewrite `useProjects` hook to use server API instead of localStorage
- Update `ProjectPicker` in `NewSessionPage` to include path input with validation
- No sidebar changes needed

### `packages/agents`

- Update horton's `creation_schema` to include optional `workingDirectory` string
- Update horton's handler to prefer `args.workingDirectory` over the global cwd
