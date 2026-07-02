# Replicated-mode image. Build context is the CRATE dir (packages/durable-streams-rust):
#   docker build -f deploy/replicated/Dockerfile -t durable-streams:replicated .
# Same shape as the bench image; no extra features needed (tiering is not
# supported with --durability replicated).
ARG RUST_VERSION=1.86
FROM rust:${RUST_VERSION}-bookworm AS builder
WORKDIR /src
COPY . .
RUN cargo build --release
RUN cp target/release/durable-streams-server /durable-streams-server

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /durable-streams-server /usr/local/bin/durable-streams-server
# 4437 = HTTP (protocol default), 5437 = replication mesh
EXPOSE 4437 5437
ENTRYPOINT ["durable-streams-server"]
