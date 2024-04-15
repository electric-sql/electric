---
title: Documentation
displayed_sidebar: docsSidebar
pagination_next: intro/local-first
sidebar_label: " "
---

import useBaseUrl from '@docusaurus/useBaseUrl'

# Documentation

Welcome to the ElectricSQL developer documentation.

ElectricSQL is a [local-first software platform](./reference/local-first.md). Use it to build super fast, collaborative, offline-capable apps directly on Postgres.

## New to ElectricSQL?

If you’re new to ElectricSQL, start with the <DocPageLink path="intro/local-first" />, an interactive demo and tutorial introducing local-first development and the ElectricSQL system.

<div className="tile my-6 overflow-hidden">
  <div className="relative -mx-20 sm:-mx-6">
    <a href="/docs/intro/local-first" className="no-visual">
      <img src={useBaseUrl('/img/home/intro.svg')}
          className="w-full"
      />
    </a>
  </div>
  <div className="px-3 md:px-4">
    <a href="/docs/intro/local-first"
        className="button button--outline w-full mt-2">
      Start with the Introduction &raquo;
    </a>
  </div>
</div>

Or for the fastest way to start coding, jump in with the <DocPageLink path="quickstart" /> guide.

<div className="tile my-6 overflow-hidden">
  <div className="-m-8 relative">
    <a href="/docs/quickstart" className="no-visual">
      <video className="w-full mx-auto"
          autoPlay={true} loop muted playsInline>
        <source src={useBaseUrl('/videos/quickstart-desktop.mp4')} />
      </video>
    </a>
  </div>
  <div className="px-3 md:px-4">
    <a href="/docs/quickstart"
        className="relative button button--outline w-full sm:-mt-4">
      Jump into the code &raquo;
    </a>
  </div>
</div>

## Example apps

See the [example applications](./top-level-listings/examples.md) for reference code and to see what you can build with Electric:

<div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
  <div className="tile">
    <div className="px-3 md:px-4">
      <a href="/docs/examples/basic">
        <img src={useBaseUrl('/img/examples/basic.svg')} loading="lazy"
            className="mt-2 -mb-1 sm:mt-3 sm:-mb-2 md:mt-4 w-8 sm:w-9 md:w-10"
        />
        <h3>
          Basic items
        </h3>
        <p className="text-small mb-2">
          Minimal demo app showing how to create and remove items
          from a list.
        </p>
      </a>
    </div>
  </div>
  <div className="tile">
    <div className="px-3 md:px-4">
      <a href="/docs/examples/linear-lite">
        <img src={useBaseUrl('/img/examples/linear-lite.svg')} loading="lazy"
            className="mt-2 -mb-1 sm:mt-3 sm:-mb-2 md:mt-4 w-8 sm:w-9 md:w-10"
        />
        <h3>
          LinearLite
        </h3>
        <p className="text-small mb-2">
          Local-first project management app, based on a simplified
          Linear clone.
        </p>
      </a>
    </div>
  </div>
</div>

## More details

See the <DocPageLink path="usage" /> and <DocPageLink path="integrations" /> guides, the <DocPageLink path="api" /> docs and the <DocPageLink path="reference" /> section:

<div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
  <div className="tile">
    <div className="px-3 md:px-4">
      <a href="/docs/usage">
        <h3>
          Usage guide
        </h3>
        <p className="text-small mb-2">
          How to use ElectricSQL.
        </p>
      </a>
    </div>
  </div>
  <div className="tile">
    <div className="px-3 md:px-4">
      <a href="/docs/integrations">
        <h3>
          Integrations
        </h3>
        <p className="text-small mb-2">
          Integrate ElectricSQL with your stack.
        </p>
      </a>
    </div>
  </div>
  <div className="tile">
    <div className="px-3 md:px-4">
      <a href="/docs/api">
        <h3>
          API docs
        </h3>
        <p className="text-small mb-2">
          Normative API docs.
        </p>
      </a>
    </div>
  </div>
  <div className="tile">
    <div className="px-3 md:px-4">
      <a href="/docs/reference">
        <h3>
          Reference
        </h3>
        <p className="text-small mb-2">
          About the ElectricSQL system.
        </p>
      </a>
    </div>
  </div>
</div>

## Source code

ElectricSQL is an open source project at [github.com/electric-sql/electric](https://github.com/electric-sql/electric). Check out the source code and development in progress there.

## Support

See the [Community](/about/community) page for information on support and events, including our [community Discord](https://discord.electric-sql.com) where you can ask questions and get support.
