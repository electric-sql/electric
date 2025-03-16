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
  <Section :actions="actions" :wideSectionHead="false">
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
        <span class="hidden-lg">
          that speaks
          <a href="/docs/guides/client-development">
            HTTP and JSON</a></span>.
        And it syncs data
        <span class="hidden-lg">
          out of Postgres</span>
        into anything
        <span class="hidden-lg">
          you like, </span>
        from a
        <a href="/docs/integrations/react">
          <span class="hidden-lg">
            Javascript</span>
          state variable</a>
        to a
        <a href="/product/pglite">
          local
          <span class="hidden-lg">
            SQL</span>
          database</a>.
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