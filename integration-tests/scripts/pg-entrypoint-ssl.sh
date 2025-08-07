#!/bin/bash

# Use this script to override the default entrypoint of the postgres Docker image.

# Here we copy the read-only private key file to a location inside the Docker container and
# change its mode and owner to ensure that Postgres accepts it.

set -e

cp /etc/server.* /var/lib/postgresql/

# Postgres requires the key file to have the same owning user as itself
chmod 600 /var/lib/postgresql/server.key
chown postgres:postgres /var/lib/postgresql/server.key

# Run the base entrypoint
docker-entrypoint.sh "$@"
