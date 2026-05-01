FROM node:22-bookworm-slim

# Install OS deps: git (claude needs it), curl (claude installer occasionally probes), bash, ca-certs.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        bash \
        tini \
    && rm -rf /var/lib/apt/lists/*

# Non-root user for the agent. Claude's home is needed for ~/.claude transcript dir.
# node:22-bookworm-slim ships with a pre-existing `node` user at UID 1000; remove it first.
RUN userdel -r node 2>/dev/null || true \
    && useradd -m -s /bin/bash -u 1000 agent

# Install the Claude + Codex CLIs globally. Pin recent versions; bump later.
RUN npm install -g @anthropic-ai/claude-code@latest @openai/codex@^0.128.0 \
    && claude --version \
    && codex --version

# Workspace mount point. The provider attaches a volume here.
RUN mkdir -p /workspace \
    && chown agent:agent /workspace

USER agent
WORKDIR /workspace

COPY --chown=agent:agent docker/entrypoint.sh /home/agent/entrypoint.sh
RUN chmod +x /home/agent/entrypoint.sh

ENTRYPOINT ["/usr/bin/tini", "--", "/home/agent/entrypoint.sh"]
