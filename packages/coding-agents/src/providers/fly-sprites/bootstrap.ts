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

# Sprites' default Ubuntu image preinstalls Claude CLI and OpenAI Codex
# (per https://docs.sprites.dev/working-with-sprites). We only need to
# install opencode-ai, which isn't preinstalled. Pin matches the
# local-docker bake (packages/coding-agents/docker/Dockerfile).
#
# --prefix=/usr/local routes the binary into /usr/local/bin, which is
# already on PATH. The default npm prefix points at the nvm install
# dir under /.sprite/languages/.../bin — NOT on PATH, which would
# leave opencode unreachable after install.
npm install -g --prefix=/usr/local opencode-ai@1.14.31

# Sanity-check that the preinstalled CLIs are actually present.
claude --version >/dev/null
codex --version >/dev/null
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
