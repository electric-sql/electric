#!/bin/bash

# This script runs the demo using this tauri example
# This script is necessary because there are many external tools that this demo depends on

set -e

# Clone the sources
git_clone() {
    git clone --depth 1 -b tauri-example-postgres git@github.com:electric-sql/electric.git
    mkdir -p electric/examples/tauri-postgres/db/data/
    #TODO: We need to get the issues.json with embeddings here.
    ln -s $(PWD)/db/data/issues.json $(PWD)/electric/examples/tauri-postgres/db/data/issues.json
    cd electric/clients/typescript && pnpm install && pnpm build
    cd ../../generator/ && pnpm install && pnpm build
    cd ../examples/tauri-postgres/
    mkdir -p src-tauri/crates/ && cd src-tauri/crates/
    git clone https://github.com/pepperoni21/ollama-rs # Solves a bug where in Cargo.toml `git` would still not work as expected
    cd ../..
    pnpm install && pnpm run myreset
}

# Install ollama
install_ollama() {
    echo "Installing ollama"
    wget https://github.com/jmorganca/ollama/releases/download/v0.1.20/ollama-darwin
    chmod +x ollama-darwin
}

start_ollama() {
    nohup ollama-darwin serve 2>/dev/null 1>&2 &
    disown
}

stop_ollama() {
    killall ollama
}

# Install postgres
install_postgres() {
    echo "Installing postgres"

    wget https://get.enterprisedb.com/postgresql/postgresql-15.5-1-osx-binaries.zip
    unzip postgresql-15.5-1-osx-binaries.zip
    mkdir -p ~/Library/Caches/pg-embed/darwin/arm64v8/
    mv pgsql ~/Library/Caches/pg-embed/darwin/arm64v8/15.5.1

    git clone --branch v0.5.1 https://github.com/pgvector/pgvector.git
    cd pgvector
    make
    PG_CONFIG=/Users/iib/Library/Caches/pg-embed/darwin/arm64v8/15.5.1/bin/pg_config make install
    cd ..
}

# Build the Tauri app
build_the_app() {
    # We assume we are in the correct directory
    pnpm tauri build # This also installs the app
}

run_the_demo() {
    echo "Not implemented"
}

install_ollama
install_postgres
git_clone
build_the_app
run_the_demo
