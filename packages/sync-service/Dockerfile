ARG ELIXIR_VERSION=1.17.0
ARG OTP_VERSION=27.0
ARG DEBIAN_VERSION=bookworm-20240513-slim

ARG BUILDER_IMAGE="hexpm/elixir:${ELIXIR_VERSION}-erlang-${OTP_VERSION}-debian-${DEBIAN_VERSION}"
ARG RUNNER_IMAGE="debian:${DEBIAN_VERSION}"

FROM ${BUILDER_IMAGE} AS builder
LABEL maintainer="info@electric-sql.com"

RUN apt-get update -y && \
    apt-get install -y build-essential git curl && \
    apt-get clean && \
    rm -f /var/lib/apt/lists/*_*

RUN mix local.hex --force && mix local.rebar --force

ENV MIX_ENV=prod

WORKDIR /app

COPY mix.* /app/
RUN mix deps.get
RUN mix deps.compile

# These are ordered by change frequency, with the least frequently changing dir first.
COPY rel /app/rel
COPY lib /app/lib/

COPY package.json /app/
COPY config/*runtime.exs /app/config/

ARG ELECTRIC_VERSION=local
RUN MIX_ENV="prod" mix compile
RUN MIX_ENV="prod" mix release

FROM ${RUNNER_IMAGE} AS runner_setup

RUN apt-get update -y && \
    apt-get install -y libstdc++6 openssl libncurses5 locales ca-certificates && \
    apt-get clean && \
    rm -f /var/lib/apt/lists/*_*

# Set the locale
RUN sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && locale-gen

ENV LANG=en_US.UTF-8
ENV LANGUAGE=en_US:en
ENV LC_ALL=en_US.UTF-8

WORKDIR "/app"
RUN chown nobody /app

FROM runner_setup AS runner

ARG RELEASE_NAME=electric
## Vaxine configuration via environment variables
COPY --from=builder /app/_build/prod/rel/${RELEASE_NAME} ./
RUN mv /app/bin/${RELEASE_NAME} /app/bin/entrypoint

ENTRYPOINT ["/app/bin/entrypoint"]
CMD ["start"]
