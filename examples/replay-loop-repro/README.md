# Replay Mode Infinite Loop Bug Reproduction

This is a minimal app to reproduce the replay mode infinite loop bug in the Electric TypeScript client.

## The Bug

When a page is refreshed within 60 seconds of syncing a shape, the client may enter an infinite loop that:

- Consumes 100% CPU
- Freezes the browser UI
- Makes rapid HTTP requests (from cache)
- Never exits

See the full analysis: [replay-mode-infinite-loop-bug.md](../../packages/typescript-client/docs/replay-mode-infinite-loop-bug.md)

## How to Reproduce

### 1. Install dependencies

```bash
cd examples/replay-loop-repro
pnpm install
```

### 2. Start the dev server

```bash
pnpm dev
```

### 3. Open the app

Navigate to http://localhost:5555

### 4. Configure

Enter your Electric Cloud connection details:

- **Electric URL**: Your Electric Cloud API URL (e.g., `https://api.electric-sql.cloud/v1/shape`)
- **Table name**: A table in your database (preferably one with **static data** that doesn't change often)
- **Source ID**: Your Electric Cloud source ID
- **Source Secret**: Your Electric Cloud source secret

### 5. Trigger the bug

1. Click "Start Sync" - the initial sync should complete successfully
2. **Refresh the page within 60 seconds**
3. Watch the request counter - if it starts climbing rapidly, the bug has been triggered
4. The status will turn red when rapid requests are detected

## What to Look For

**Successful sync (no bug):**

- Request counter shows a reasonable number (e.g., 1-10)
- Status shows "Synced Successfully"
- Rows synced shows your data count

**Bug triggered:**

- Request counter climbs rapidly (100+ in seconds)
- Status turns red: "INFINITE LOOP DETECTED!"
- Browser may become unresponsive
- DevTools network tab may freeze

## Breaking the Loop

Click "Clear Electric localStorage & Reload" to clear the replay mode state and break the loop.

## Conditions That Increase Likelihood

The bug is most likely to trigger when:

- Using Electric Cloud (CDN caching enabled)
- Syncing a **static shape** (data that doesn't change)
- Refreshing quickly after initial sync

The bug is less likely with:

- Active shapes (frequent writes)
- Direct connection to Electric (no CDN)
- Waiting >60 seconds between page loads
