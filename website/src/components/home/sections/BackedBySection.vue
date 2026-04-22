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

select('copple')
select('spencer')
select('jordan')
select('monica')
select('sriram')
select('pvh')
select('chris')
select('jose')
select('adam')
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
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 16px;
  margin: 8px 0px;
  overflow: hidden;
}
@media (max-width: 1149px) {
  .backers {
    gap: 14px;
  }
}
@media (max-width: 1099px) {
  .backers {
    gap: 12px;
  }
}
@media (max-width: 1055px) {
  .backers {
    gap: 10px;
  }
}
@media (max-width: 1009px) {
  .backers {
    gap: 8px;
  }
}
@media (max-width: 959px) {
  .backers {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 24px;

    max-width: 700px;
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
@media (max-width: 399px) {
  .backers {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }
}
</style>
