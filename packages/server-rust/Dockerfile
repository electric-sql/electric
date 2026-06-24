# syntax=docker/dockerfile:1
#
# Built multi-arch (linux/amd64 + linux/arm64) natively per arch by
# .github/workflows/docker_multiarch_image.yml — the build context is the repo
# root and this Dockerfile is `packages/server-rust/Dockerfile`.

# ---- build stage: compile the release binary (glibc, matches the runtime) ----
FROM rust:1-bookworm AS build
WORKDIR /app
# Copy only what the build needs (no target/, no npm/) so we don't depend on a
# .dockerignore at the shared repo root.
COPY packages/server-rust/Cargo.toml packages/server-rust/Cargo.lock ./
COPY packages/server-rust/src ./src
# Default features only (no `tier`/`telemetry`) — minimal image, matching the
# conformance matrix. To ship S3 tiering, add `--features tier` here AND
# `ca-certificates` to the runtime stage.
RUN cargo build --release --locked

# ---- runtime stage: distroless (glibc cc), no shell / package manager ----
FROM gcr.io/distroless/cc-debian12 AS runtime
COPY --from=build /app/target/release/durable-streams-server /usr/local/bin/durable-streams-server
# Protocol default port (PROTOCOL.md §13.1); override with `--port`.
EXPOSE 4437
ENTRYPOINT ["/usr/local/bin/durable-streams-server"]
# Bind all interfaces by default (the binary defaults to 127.0.0.1, unreachable
# from outside the container). Override by passing your own args. For persistence,
# mount a volume and add `--data-dir /your/path` (default is an ephemeral tmp dir).
CMD ["--host", "0.0.0.0"]
