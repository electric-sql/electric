ARG BUILDER_IMAGE="europe-docker.pkg.dev/vaxine/ci/electric-builder:latest"
ARG RUNNER_IMAGE="europe-docker.pkg.dev/vaxine/ci/electric-runner:latest"

FROM ${BUILDER_IMAGE} AS builder

WORKDIR /app
COPY Makefile /app/

COPY mix.*  /app/
COPY deps /app/deps/
RUN make deps
COPY config /app/config/
COPY lib    /app/lib/

ARG ELECTRIC_VERSION=local
RUN make compile release

FROM ${RUNNER_IMAGE} AS runner_setup

WORKDIR "/app"
RUN chown nobody /app

FROM runner_setup AS runner

## Vaxine configuration via environment variables
COPY --from=builder --chown=nobody:root /app/_build/prod/rel/electric ./

VOLUME ./offset_storage_data.dat

USER nobody
ENTRYPOINT /app/bin/electric start
