ARG ELIXIR_VERSION=1.19.1
ARG OTP_VERSION=28.1.1
ARG DEBIAN_VERSION=bookworm-20251020-slim

ARG BUILDER_IMAGE="hexpm/elixir:${ELIXIR_VERSION}-erlang-${OTP_VERSION}-debian-${DEBIAN_VERSION}"
ARG RUNNER_IMAGE="debian:${DEBIAN_VERSION}"
ARG MIX_TARGET=application

FROM ${BUILDER_IMAGE} AS builder
LABEL maintainer="info@electric-sql.com"

RUN apt-get update -y && \
  apt-get install -y build-essential git curl && \
  apt-get clean && \
  rm -f /var/lib/apt/lists/*_*

RUN mix local.hex --force && mix local.rebar --force

ARG MIX_ENV=prod
ARG ELECTRIC_VERSION
ARG MIX_TARGET

WORKDIR /app

COPY mix.* /app/
RUN mix deps.get
RUN MIX_OS_DEPS_COMPILE_PARTITION_COUNT=4 mix deps.compile

# These are ordered by change frequency, with the least frequently changing dir first.
COPY rel /app/rel
COPY lib /app/lib/

COPY package.json /app/
COPY config/config.exs /app/config/

RUN mix compile
RUN mix sentry.package_source_code

COPY config/runtime.exs /app/config/

RUN mix release

RUN ls -l /app/_build

FROM ${RUNNER_IMAGE} AS runner_setup

RUN apt-get update -y && \
  apt-get install -y libstdc++6 openssl libncurses5 locales ca-certificates curl && \
  apt-get clean && \
  rm -f /var/lib/apt/lists/*_*

# Set the locale
RUN sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && locale-gen

ENV LANG=en_US.UTF-8 \
  LANGUAGE=en_US:en \
  LC_ALL=en_US.UTF-8 \
  MIX_ENV=prod \
  MIX_TARGET=application

WORKDIR "/app"

RUN chown nobody /app

FROM runner_setup AS runner

ARG MIX_TARGET
ARG RELEASE_NAME=electric


COPY --from=builder "/app/_build/${MIX_TARGET}_prod/rel/${RELEASE_NAME}" ./

RUN mv /app/bin/${RELEASE_NAME} /app/bin/entrypoint

HEALTHCHECK --start-period=10s CMD curl --fail http://localhost:${ELECTRIC_PORT-3000}/v1/health || exit 1

ENTRYPOINT ["/app/bin/entrypoint"]

CMD ["start"]
