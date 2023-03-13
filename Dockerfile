ARG RUNNER_IMAGE="${RUNNER_IMAGE}"
FROM ${RUNNER_IMAGE}

WORKDIR "/app"
RUN chown nobody /app

COPY _build_in_docker/_build/prod/rel/electric ./

VOLUME ./offset_storage_data.dat

ENTRYPOINT /app/bin/electric start
