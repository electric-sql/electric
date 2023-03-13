ARG ELIXIR_VERSION=1.13.4
ARG OTP_VERSION=24.3
ARG DEBIAN_VERSION=bullseye-20210902-slim

ARG BUILDER_IMAGE="hexpm/elixir:${ELIXIR_VERSION}-erlang-${OTP_VERSION}-debian-${DEBIAN_VERSION}"
ARG RUNNER_IMAGE="debian:${DEBIAN_VERSION}"

FROM ${BUILDER_IMAGE} AS builder
LABEL maintainer="dev@vaxine.io"

RUN apt-get update -y && \
    apt-get install -y build-essential git curl && \
    apt-get clean && \
    rm -f /var/lib/apt/lists/*_*

ENV MIX_ENV=prod
ENV MIX_HOME=/app
ENV HEX_HOME=/app/.hex

WORKDIR /app
COPY mix.*    /app/
COPY Makefile /app/
COPY _build_in_docker/.hex     /app/.hex
COPY _build_in_docker/archives /app/archives
COPY _build_in_docker/deps     /app/deps/
COPY _build_in_docker/_build   /app/_build
COPY _build_in_docker/rebar    /app/rebar
COPY _build_in_docker/rebar3   /app/rebar3
COPY config /app/config/
COPY lib    /app/lib/

ARG ELECTRIC_VERSION=local
RUN make compile release

FROM ${RUNNER_IMAGE} AS runner_setup

RUN apt-get update -y && \
    apt-get install -y libstdc++6 openssl libncurses5 locales && \
    apt-get clean && \
    rm -f /var/lib/apt/lists/*_*

# Set the locale
RUN sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && locale-gen

ENV LANG en_US.UTF-8
ENV LANGUAGE en_US:en
ENV LC_ALL en_US.UTF-8

WORKDIR "/app"
RUN chown nobody /app

FROM runner_setup AS runner

## Vaxine configuration via environment variables
COPY --from=builder /app/_build/prod/rel/electric ./

VOLUME ./offset_storage_data.dat

ENTRYPOINT /app/bin/electric start
