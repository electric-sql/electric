<script setup>
import { onMounted, useTemplateRef } from 'vue'

const { actions, isStrap } = defineProps(['actions', 'isStrap'])
const section = useTemplateRef('section')

const expandedActions =
  actions !== undefined
    ? actions.map((action) => {
        const defaultTarget = action.href.startsWith('http')
          ? '_blank'
          : '_self'
        const defaultTheme = 'alt'

        const target = action.target || defaultTarget
        const theme = action.theme || defaultTheme

        const key = `${action.href}-${action.text}`

        return { ...action, key, target, theme }
      })
    : []

onMounted(() => {
  if (typeof window !== 'undefined' && document.querySelector) {
    section.value
      .querySelectorAll('a[href^="https://github.com"]')
      .forEach((link) => {
        if (!link.querySelector('.vpi-social-github')) {
          const icon = document.createElement('span')
          icon.classList.add('vpi-social-github')

          link.prepend(icon)
        }
      })
  }
})
</script>

<style scoped>
.cta-actions {
  justify-content: left;
  margin-top: 24px;
}

@media (max-width: 959px) {
  .cta-actions {
    justify-content: center;
  }
  /*.cta-actions.is-strap {
      justify-content: left;
    }*/
}
</style>

<template>
  <div
    v-if="actions"
    ref="section"
    :class="`actions cta-actions ${isStrap ? 'is-strap' : ''}`"
  >
    <div
      class="action"
      v-for="{ href, key, target, text, theme } in expandedActions"
    >
      <VPButton
        :href="href"
        :key="key"
        :target="target"
        :text="text"
        :theme="theme"
      />
    </div>
  </div>
</template>
