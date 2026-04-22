<script setup>
import EaSection from '../../agents-home/Section.vue'
import Backer from '../Backer.vue'

import { data } from '../../../../data/team.data.ts'

const backers = []

function select(slug) {
  const angel = data.angels.find((angel) => angel.slug == slug)

  if (!angel) {
    return
  }

  backers.push(angel)
}

// Order leads with Paul (Supabase) as the most recognisable
// Postgres-platform backer, then runs through the AI / agent
// adjacent names (Mehdi at DeepMind, José behind Elixir/Phoenix)
// and the rest of the database / devtools cohort. Spencer sits at
// the end near Chris so the row closes on the more general
// distributed-systems crowd rather than leading with it.
select('copple')
select('mehdi')
select('jose')
select('jordan')
select('monica')
select('sriram')
select('adam')
select('chris')
select('spencer')
</script>

<template>
  <EaSection>
    <template #title> Backed by industry&nbsp;insiders </template>
    <template #subtitle>
      Built by
      <a href="/about/team">devtools and database experts</a>. Backed by
      <a href="/about/team#investors">industry leading founders</a>.
    </template>
    <div class="backers">
      <Backer :backer="backer" :key="backer.slug" v-for="backer in backers" />
    </div>
    <template #actions>
      <VPButton
        tag="a"
        size="medium"
        theme="brand"
        text="Team"
        href="/about/team"
      />
      <VPButton
        tag="a"
        size="medium"
        theme="alt"
        text="Investors"
        href="/about/team#investors"
      />
    </template>
  </EaSection>
</template>

<style scoped>
.backers {
  display: grid;
  /* Grid widened from 8 → 9 columns to make room for an additional
     backer (Mehdi / DeepMind) without dropping anyone or wrapping
     to a second row. Faces step down a touch in size as a result,
     which the user has explicitly OK'd. */
  grid-template-columns: repeat(9, minmax(0, 1fr));
  gap: 14px;
  margin: 8px 0px;
  overflow: hidden;
}
@media (max-width: 1149px) {
  .backers {
    gap: 12px;
  }
}
@media (max-width: 1099px) {
  .backers {
    gap: 10px;
  }
}
@media (max-width: 1055px) {
  .backers {
    gap: 9px;
  }
}
@media (max-width: 1009px) {
  .backers {
    gap: 8px;
  }
}
@media (max-width: 959px) {
  .backers {
    /* 9 backers laid out 5 + 4 at the tablet break-point so the row
       balances visually and we don't leave a single orphan in the
       last row. */
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 20px;

    max-width: 760px;
    margin-left: auto;
    margin-right: auto;
  }
}
@media (max-width: 766px) {
  .backers {
    gap: 16px;
  }
}
@media (max-width: 549px) {
  /* 9 backers → 3-up keeps three clean rows of three at every
     phone width; we deliberately skip the 2-up step that would
     leave an orphan in the bottom row. */
  .backers {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 20px;
  }
}
@media (max-width: 449px) {
  .backers {
    gap: 16px;
  }
}
</style>
