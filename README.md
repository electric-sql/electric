<p align="center">
  <a href="https://electric-sql.com" target="_blank">
    <picture>
      <source media="(prefers-color-scheme: dark)"
          srcset="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-light-trans.svg"
      />
      <source media="(prefers-color-scheme: light)"
          srcset="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-black.svg"
      />
      <img alt="ElectricSQL logo"
          src="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-black.svg"
      />
    </picture>
  </a>
</p>

<p align="center">
  Local-first software platform for developing web and mobile apps with instant reactivity, realtime multi-user collaboration and conflict-free offline. From the inventors of CRDTs. Based on standard open source Postgres and SQLite.
</p>

<p align="center">
  <a href="https://github.com/electric-sql/electric/stargazers/"><img src="https://img.shields.io/github/stars/electric-sql/electric?style=social&label=Star&maxAge=2592000" /></a>
  <a href="https://github.com/electric-sql/electric/actions"><img src="https://github.com/electric-sql/electric/workflows/CI/badge.svg" alt="CI"></a>
  <a href="https://github.com/electric-sql/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-green" alt="License - Apache 2.0"></a>
  <a href="https://electric-sql.com/docs/reference/limitations"><img src="https://img.shields.io/badge/status-alpha-orange" alt="Status - Alpha"></a>
  <a href="https://discord.gg/B7kHGwDcbj"><img src="https://img.shields.io/discord/933657521581858818?color=5969EA&label=discord" alt="Chat - Discord"></a>
  <a href="https://twitter.com/ElectricSQL" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow @ElectricSQL"></a>
  <a href="https://fosstodon.org/@electric" target="_blank"><img src="https://img.shields.io/mastodon/follow/109599644322136925.svg?domain=https%3A%2F%2Ffosstodon.org"></a>
</p>

<p align="center">
  <table class="foo">
    <tr>
      <td><a href="https://youtu.be/_U5Z8AQy0hc" target="_blank"><img src="https://img.youtube.com/vi/_U5Z8AQy0hc/maxresdefault.jpg" style="max-width: 50%"></a></td>
      <td><a href="https://youtu.be/UNiYlPoeElE" target="_blank"><img src="https://img.youtube.com/vi/UNiYlPoeElE/maxresdefault.jpg" style="max-width: 100%"></a></td>
    </tr>
  </table>
</p>

# Quick links

- [Documentation](https://electric-sql.com/docs)
- [Technical intro](https://electric-sql.com/docs/overview/technical-intro)
- [Quickstart](https://electric-sql.com/docs/usage/quickstart)
- [Examples](https://github.com/electric-sql/examples)
- [FAQs](https://electric-sql.com/docs/overview/faqs)

# What is ElectricSQL?

ElectricSQL is a local-first software platform that makes it easy to develop high-quality, modern apps with instant reactivity, realtime multi-user collaboration and conflict-free offline support.

[Local-first](https://www.inkandswitch.com/local-first/) is a new development paradigm where your app code talks directly to an embedded local database and data syncs in the background via active-active database replication. Because the app code talks directly to a local database, apps feel instant. Because data syncs in the background via active-active replication it naturally supports multi-user collaboration and conflict-free offline.

# How do I use it?

ElectricSQL gives you instant local-first for your Postgres. Think of it like "Hasura for local-first". Drop ElectricSQL onto an existing Postgres-based system and you get instant local-first data synced into your apps.

ElectricSQL then provides a whole developer experience for you to control what data syncs where and to work with it locally in your app code. See the [Documentation](https://electric-sql.com/docs) and the [Quickstart guide](https://electric-sql.com/docs/usage/quickstart) to get started.

# Repo structure

This is the main repository for the ElectricSQL source code. Key components include:

- [clients/typescript](https://github.com/electric-sql/electric/tree/main/clients/typescript) &mdash; Typescript client that provides SQLite driver adapters, reactivity and
- [components/electric](https://github.com/electric-sql/electric/tree/main/components/electric) &mdash; Elixir sync service that manages active-active replication between Postgres and SQLite
- [generator](https://github.com/electric-sql/electric/tree/main/generator) &mdash; Prisma generator that creates the type safe data access library
- [local-stack](https://github.com/electric-sql/electric/tree/main/local-stack) &mdash; Docker Compose stack to run the backend services locally
- [protocol/satellite.proto](https://github.com/electric-sql/electric/tree/main/protocol/satellite.proto) &mdash; Protocol Buffers definition of the Satellite replication protocol

See the Makefiles for test and build instructions and the [e2e](https://github.com/electric-sql/electric/tree/main/e2e) folder for integration tests.

# Team

ElectricSQL was founded by [@thruflo](https://github.com/thruflo) and [@balegas](https://github.com/balegas), under the guidance of:

- [Marc Shapiro](https://lip6.fr/Marc.Shapiro) and [Nuno Preguiça](https://asc.di.fct.unl.pt/~nmp), the co-inventors of CRDTs
- [@bieniusa](https://linkedin.com/in/annette-bieniusa-b0807b145), the lead developer of [AntidoteDB](https://www.antidotedb.eu)
- [@josevalim](https://www.linkedin.com/in/josevalim), the creator of the [Elixir](https://elixir-lang.org) programming language

See the [Team](https://electric-sql.com/about/team) and [Literature](https://electric-sql.com/docs/reference/literature) pages for more details.

# Contributing

See the [Community Guidelines](https://github.com/electric-sql/electric/blob/main/CODE_OF_CONDUCT.md) including the [Guide to Contributing](https://github.com/electric-sql/electric/blob/main/CONTRIBUTING.md) and [Contributor License Agreement](https://github.com/electric-sql/electric/blob/main/CLA.md).

# Support

We have an [open community Discord](https://discord.gg/B7kHGwDcbj). Come and say hello and let us know if you have any questions or need any help getting things running.

It's also super helpful if you leave the project a star here at the [top of the page☝️](#start-of-content)
