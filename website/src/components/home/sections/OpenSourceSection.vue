<script setup>
  import { onMounted, useTemplateRef } from 'vue'
  import reloadRepoCards from '../../../../src/lib/repo-card'
  import Section from '../Section.vue'

  const actions = [
    {
      href: 'https://discord.electric-sql.com',
      text: 'Join the Discord',
      theme: 'brand'
    },
    {
      href: 'https://github.com/electric-sql/electric',
      text: 'Star on GitHub'
    }
  ]

  const cards = useTemplateRef('cards')

  onMounted(() => {
    if (typeof window !== 'undefined' && document.querySelector) {
      reloadRepoCards(cards.value)
    }
  })
</script>

<style scoped>
  .community-widgets {
    padding: 12px 0 24px;
    display: flex;
    flex-direction: row;
    gap: 40px;
  }
  .discord,
  .github {
    flex: 1 1 0px;
  }
  .github {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .repo {
    width: 100%;
  }
  .repo img {
    width: 100%;
    max-width: 440px;
  }
  @media (max-width: 767px) {
    .community-widgets {
      flex-direction: column;
    }
    .discord {
      order: 2;
    }
  }
</style>

<template>
  <Section :actions="actions">
    <template #title>
      Fully open source
    </template>
    <template #tagline>
      With a thriving
      <a href="https://discord.electric-sql.com">
        open source community</a>
      and over
      <span class="no-wrap-xs">
        600,000
        <span class="no-wrap">
          downloads a week</span></span>.
    </template>
    <div class="community-widgets">
      <div class="discord">
        <iframe src="https://discord.com/widget?id=933657521581858818&theme=dark"
            width="350"
            height="350"
            sandbox="allow-popups allow-same-origin allow-popups-to-escape-sandbox allow-scripts"
            style="width: 100%; border: 1px solid rgba(48, 54, 61, 0.5)">
        </iframe>
      </div>
      <div class="github" ref="cards">
        <div class="repo">
          <a href="https://github.com/electric-sql/electric" class="no-visual">
            <div class="repo-card" data-repo="electric-sql/electric"></div>
          </a>
        </div>
        <div class="repo">
          <a href="https://github.com/electric-sql/pglite" class="no-visual">
            <div class="repo-card" data-repo="electric-sql/pglite"></div>
          </a>
        </div>
      </div>
    </div>
  </Section>
</template>