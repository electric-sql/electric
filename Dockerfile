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

WORKDIR /app
COPY Makefile /app/
RUN make build_tools

COPY mix.*  /app/
RUN make deps
COPY config /app/config/
COPY lib    /app/lib/
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
COPY --from=builder --chown=nobody:root /app/_build/prod/rel/electric ./

VOLUME ./vx_pg_offset_storage_prod.dat

USER nobody
ENTRYPOINT /app/bin/electric start
