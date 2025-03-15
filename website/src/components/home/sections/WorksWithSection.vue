<script setup>
  import Section from '../Section.vue'

  const actions = [
    {
      href: '/docs/quickstart',
      text: 'Quickstart',
      theme: 'brand'
    },
    {
      href: '/docs/tutorial',
      text: 'Tutorial'
    }
  ]
</script>

<template>
  <Section :actions="actions" :wideSectionHead="true">
    <template #title>
      With your existing stack
    </template>
    <template #override-tagline>
      <p>
        Electric works with
        <a href="/docs/guides/deployment#_1-running-postgres">
          any Postgres</a>,
        <a href="/docs/guides/deployment#data-model-compatibility">
          any data model</a> and
        <a href="/docs/integrations">
          any web framework</a>
        that speaks
        <a href="/docs/guides/client-development">
          HTTP and JSON</a>.
      </p>
      <p>
        And it syncs data out of Postgres into anything you like, from a
        <a href="/docs/integrations/react">
          Javascript state variable</a>
        to a
        <a href="/product/pglite">
          local SQL database</a>.
      </p>
    </template>
    <ul>
      <li>
        your database
      </li>
      <li>
        your stack
      </li>
      <li>
        your app
      </li>
    </ul>
    <template #outline>
      So you can adopt sync incrementally, one route at a time, into both greenfield and brownfield applications.
    </template>
    <template #outbody>
      ... Supabase, Neon, Phoenix, Next.js, TanStack, React ...
    </template>
  </Section>
</template>