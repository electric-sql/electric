/**
 * Per-sprite bootstrap script. Idempotent — checks for a marker file
 * before doing anything. Run via the exec WebSocket once on first
 * sprite start. Subsequent prompts (and wakes from auto-sleep) skip
 * the install entirely.
 *
 * Pin parity: opencode-ai@1.14.31 must match
 * packages/coding-agents/docker/Dockerfile. The conformance suite
 * catches drift if these diverge.
 */
export const BOOTSTRAP_SCRIPT = `#!/bin/sh
set -e

# Skip if already bootstrapped.
[ -f /opt/electric-ax/.bootstrapped ] && exit 0

# Verify preinstalled CLIs (sanity).
claude --version >/dev/null && codex --version >/dev/null

# Install opencode-ai. Pinned to match the local-docker bake.
npm install -g opencode-ai@1.14.31
opencode --version >/dev/null

# Workspace mount point.
mkdir -p /work

# Per-instance env file (slice C₁ pattern).
mkdir -p /run/agent
touch /run/agent.env
chmod 600 /run/agent.env

# Mark complete.
mkdir -p /opt/electric-ax
touch /opt/electric-ax/.bootstrapped
echo "bootstrap complete"
`
