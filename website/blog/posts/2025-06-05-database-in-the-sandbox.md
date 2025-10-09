---
title: Vibe coding with a database in the sandbox
description: >-
  More play less infra. With PGlite you can vibe code with a database built into the sandbox.
excerpt: >-
  More play less infra. With PGlite you can vibe code with a database built into the sandbox.
authors: [thruflo]
image: /img/blog/database-in-the-sandbox/header.jpg
tags: [ai, pglite]
outline: [2, 3]
post: true
bolt_app_slug: sb1-2sqiinaz
---

<style scoped>
  video {
    width: 100%;
    aspect-ratio: 1/1;
  }
</style>

More play less infra. With PGlite you can vibe code with a database in the sandbox.

AI app builders like [Bolt](https://bolt.new), [Lovable](https://lovable.dev) and [Replit](https://replit.com) can generate database-driven apps and run them in a sandboxed dev environment. However, to actually work, these apps need to connect to a database. This breaks the sandbox encapsulation and adds friction to the development experience.

[PGlite](https://pglite.dev) is a Postgres database that runs inside your dev environment. With it, you can one-shot database-driven apps that run without leaving the sandbox. So you can vibe code real apps without even thinking about infra.

> [!Warning] ✨ Try it on Bolt.new
> Copy the one-shot [prompt&nbsp;examples](https://pglite.dev/docs/pglite-socket#llm-usage) from the PGlite docs. Or fork [this&nbsp;Bolt&nbsp;app](https://bolt.new/~/sb1-tgukxuwd).

## More play, less infra

AI app builders like [Bolt](https://bolt.new), [Lovable](https://lovable.dev) and [Replit](https://replit.com) are amazing tools for building apps. They're automating a lot of the drudge and opening up development to a whole new audience of [barefoot developers](https://www.youtube.com/watch?v=qo5m92-9_QI).

Apps tend to be backed by a database. Usually [Postgres](https://www.postgresql.org). So, when an AI app builder generates a new app, it needs to be connected to a database in order to actually work.

For example, here's Bolt.new prompted to create a "wish list" app using Vite and Node.js (about as standard a stack as you can get). It one-shots the code fine but fails to run the app because it doesn't have a database connected:

<figure>
  <video class="w-full" controls
      poster="/videos/blog/database-in-the-sandbox/poster.jpg">
    <source src="/videos/blog/database-in-the-sandbox/bolt-failure.mp4" />
  </video>
</figure>

Bolt literally prints the message:

> To get started, you'll need to have PostgreSQL installed and running with the connection details matching those in the `.env` file.

Which is kinda crazy, right? The whole point of the Bolt developer experience (and the same is true of other platforms like Lovable and Replit) is that it generates the code and runs it for you in a sandboxed development environment in the browser.

Yet to make the most basic functional app work, you need to ... install system packages? Wire up external database connections? This may be fairly simple stuff for experienced developers (but is friction nonetheless) and presents a major barrier to the new audience of barefoot developers who don't know how this stuff works.

### Breaking encapsulation

Now ... there is a solution built into the platforms for this. That is to connect your [Supabase](https://supabase.com) or [Neon](https://neon.com) account, depending on which app builder you're using:

<figure>
  <img src="/img/blog/database-in-the-sandbox/supabase-prompt.png"
      style="max-width: 512px; width: 100%" />
</figure>

Once connected, you can create a database and then wire in the credentials. Sometimes the AI does this for you. In other cases, it writes unhelpful keys into your `.env` file and you have to debug getting the right connection string into your database driver.

So you can make this work. (And it's a [well-trodden path](https://x.com/kiwicopple/status/1862433123192955016)). However, what you _now_ have is a sandboxed development environment that's tied to an external database resource. This creates _even more_ fricition and limits the flexibility of the app builder experience.

For example, using Bolt, you can click a button to fork, aka duplicate, your application:

<figure style="margin-top: 0">
  <img src="/img/blog/database-in-the-sandbox/duplicate.png"
      style="max-width: 560px; width: 100%" />
</figure>

Do you want the fork to connect to the same database instance? Or a different one? If it's the same database, there's no isolation. Bugs in one version of the app will cause bugs in another. Schema changes in one will break the other.

If you're creating the fork to play around and then throw away, you probably want a clean database. But how do you bootstrap that with the same content? How do you clean up the database when you throw away the fork?

This stuff is meant to be simple and automated. But with an external database, it's complex and full of friction.

### Database in the sandbox

What if ... instead of connecting the app to an external database, you could just have the database inside the sandbox?

If you dig into a platform like Bolt, you'll see it runs the full development environment, with both front-end _and_ back-end services, inside a [WebContainer](https://webcontainers.io). What if the database was _also_ able to run inside the WebContainer? Well, with PGlite, it can.

<figure>
  <a href="https://pglite.dev" class="no-visual">
    <img src="/img/blog/database-in-the-sandbox/pglite.png"
        style="border-radius: 16px; width: 100%; max-width: 512px"
    />
  </a>
</figure>

[PGlite](https://pglite.dev) is an embeddable Postgres database that's designed to run inside the web browser. With the recent addition of the new [PGlite Socket](https://pglite.dev/docs/pglite-socket) library, it can now also happily run inside a WebContainer in a way that's compatible with existing Postgres drivers.

The steps to adapting a standard app to use it are simple enough to [one-shot prompt](https://pglite.dev/docs/pglite-socket#llm-usage):

- install the `@electric-sql/pglite` and `@electric-sql/pglite-socket` libraries
- update the Node `package.json` to run the PGLite server
- configure the app to connect to it

With these steps in the prompt, the app just works:

<figure>
  <video class="w-full" controls
      poster="/videos/blog/database-in-the-sandbox/poster.jpg">
    <source src="/videos/blog/database-in-the-sandbox/bolt-success.mp4" />
  </video>
</figure>

The user does not need to think about infra. The database is self-contained inside the sandbox. The code runs first-time. If they fork the app, it works. If they delete the app, the database is deleted with it.

There is no friction. There is no infra. It just works, out of the box.

### Pathway to production

There's nothing in this approach that prevents running against a hosted database in production. The prompt in the example above literally tells the AI to wrap the Postgres config in a conditional that looks a bit like this:

```ts
const sql =
  process.env.NODE_ENV === 'production'
    ? postgres(process.env.DATABASE_URL)
    : postgres({
        host: '/tmp/',
        username: 'postgres',
        password: 'postgres',
        database: 'postgres',
        max: 1,
        connect_timeout: 0,
      })
```

So if you hit "deploy" and run in production, the app automatically connects to a production database on a platform like Supabase or Neon. Which is when you _want_ a proper, external database, because you _need_ that database to be available and durable.

What you don't need is the friction from configuring and managing that kind of infra, before you've even run the code your AI app builder has generated for you.

### Without killing the vibes

When you're vibe-coding, you don't want to think about infra. You want to stay in the zone, iterating and expressing yourself.

That means having a database inside your sandbox. No glue, no friction, no external services, no free-tier limits. Just part of the runtime. Forkable, disposable, unlimited and zero cost. For the user, for the platform and for the infra provider.

This is the future of AI app building. Vibe coding with a database in the sandbox. Unlocked by [PGlite](https://pglite.dev).

> [!Warning] ✨ Try it on Bolt.new
> Copy the one-shot [prompt&nbsp;examples](https://pglite.dev/docs/pglite-socket#llm-usage) from the PGlite docs. Or fork [this&nbsp;Bolt&nbsp;app](https://bolt.new/~/sb1-tgukxuwd).
