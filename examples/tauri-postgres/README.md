<a href="https://electric-sql.com/blog/2024/01/25/local-first-ai-with-tauri-postgres-pgvector-llama">
  ![](./public/header.jpg)
</a>

# ElectricSQL - Local AI in Tauri Example

This is an example of a local AI application, built using ElectricSQL, with Postgres, pgvector and llama2 running inside the backend of a Tauri app.

It's designed to showcase an open source stack for running retrieval-augmented generation (RAG) inside a local desktop app &mdash; without leaking any prompt or context data to the cloud. With Electric as the sync layer controlling the shape of the knowledge base available to the AI on the local device.

There are a number of notable features of the example to highlight:

1. it embeds and runs Postgres inside the Rust backend of a Tauri app
2. it demonstrates active-active sync between Postgres in the cloud and Postgres as embedded local database in the app (usually Electric syncs between Postgres in the cloud and SQLite in the app)

3. it compiles Postgres with the [pgvector](https://github.com/pgvector/pgvector) extension and syncs vector embeddings; this effectively integrates a vector database into the relational data model and supports vector similarity search on the device; note that embeddings can be generated locally or in the cloud, to support purely local or hybrid architectures
4. it compiles [fastembed-rs](https://github.com/Anush008/fastembed-rs) into the Tauri backend for local vectorisation
5. it compiles https://ai.meta.com/llama/ using [Ollama](https://ollama.ai) into the Tauri backend, a highly capable local LLM model with as large context window that supports retrieval-augmented generation (RAG)

The demo app itself is a variation of [Electric's LinearLite example](https://electric-sql.com/docs/examples/linear-lite). This is a [Linear](https://linear.app) clone, originally derived from the excellent clone of the Linear UI built by Tuan Nguyen [@tuan3w](https://github.com/tuan3w). This demo extends LinearLite with vector search and a chat interface to ask questions about the issues, which are seeded with issues from the React project's GitHub Issues tracker.

For more information, see the blog post write up here: [Local AI with Postgres, pgvector and llama2, inside a Tauri app with ElectricSQL](https://electric-sql.com/blog/2024/01/25/local-first-ai-with-tauri-postgres-pgvector-llama).

## Prereqs

You need Docker, Docker Compose v2, Nodejs >= 16.14 and pnpm.

## Install

Clone this repo and change directory into this folder:

```sh
git clone https://github.com/electric-sql/electric
```

Build the Electric generator and client library:

```sh
pnpm install
cd clients/typescript && pnpm build
cd ../../generator && pnpm build
```

Change directory into this folder:

```sh
cd ../examples/tauri-postgres
```

Install the dependencies:

```shell
pnpm install
```

## Additional dependencies

The example supports compilation for macOS and Linux. We provide shell scripts to setup the third party libraries and software that the app needs, according to your platform:

For macOS:

```shell
bash install-darwin.sh
```

For linux:
```shell
bash install-linux.sh
```

This will take up a few hundreds megabytes of space, during the installation, because the macOS postgres and the linux ollama download is large.

## Backend

Start Postgres and Electric as normal using Docker (see [running the examples](https://electric-sql.com/docs/examples/notes/running) for more options):

```shell
pnpm run backend:up
# Or `npm run backend:start` to foreground
```

Note that, if useful, you can connect to Postgres using:

```shell
pnpm run db:psql
```

The [database schema](https://electric-sql.com/docs/usage/data-modelling) for this example is in `db/migrations/create_tables.sql`.
You can apply it with:

```shell
pnpm run db:migrate
```

## Client

Generate your [type-safe client](https://electric-sql.com/docs/usage/data-access/client):

```shell
pnpm run client:generate
```

## Run

The app is a Tauri application. To run it:

```bash
pnpm tauri dev
```

and to build a distributable package:

```bash
pnpm tauri build
```
