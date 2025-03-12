<script setup>
  import Backer from '../Backer.vue'
  import Section from '../Section.vue'

  import { data } from '../../../../data/team.data.ts'

  const backers = []

  function select(slug) {
    const angel = data.angels.find(angel => angel.slug == slug)

    if (!angel) {
      return
    }

    backers.push(angel)
  }

  select('copple')
  select('spencer')
  select('jordan')
  select('monica')
  select('adam')
  select('pvh')
  select('jose')
  select('chris')

  const actions = [
    {
      href: '/about/team',
      text: 'Team',
      theme: 'brand'
    },
    {
      href: '/about/team#investors',
      text: 'Investors'
    }
  ]
</script>

<style scoped>
  .backers {
    display: flex;
    flex-direction: row;
    flex: auto;
    cols: 8;
  }
</style>

<template>
  <Section :actions="actions">
    <template #title>
      Backed by industry insiders
    </template>
    <template #tagline>
      Built by
      <a href="/about/team">
        world experts</a>.
      Backed by the
      <a href="/about/team#investors">
        world's leading database and devtools founders</a>.
    </template>
    <div class="backers">
      <Backer :backer="backer" :key="backer.slug" v-for="backer in backers" />
    </div>
  </Section>
</template>