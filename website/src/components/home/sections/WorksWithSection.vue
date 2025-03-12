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
  <Section :actions="actions">
    <template #title>
      With your existing stack
    </template>
    <template #tagline>
      Works with
      <a href="/docs/guides/deployment#_1-running-postgres">
        any standard Postgres</a>,
      <a href="/docs/guides/deployment#data-model-compatibility">
        any data model</a>,
      <a href="/docs/integrations">
        any web framework</a>
      that speaks
      <a href="/docs/guides/client-development">
        HTTP and JSON</a>.
      Syncs into anything, from a
      <a href="/docs/api/clients/typescript#how-to-use">
        JS object</a>
      to a
      <a href="/product/pglite">
        local database</a>.
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
      So you can add realtime sync to your existing stack,
      platform and framework of choice.
    </template>
    <template #outbody>
      ... Supabase, Neon, Phoenix, Next.js, TanStack, React ...
    </template>
  </Section>
</template>