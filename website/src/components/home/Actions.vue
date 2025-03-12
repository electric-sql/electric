<script setup>
  import { onMounted, useTemplateRef } from 'vue'

  const { actions } = defineProps(['actions'])
  const section = useTemplateRef('section')

  const expandedActions = actions !== undefined
    ? actions.map(action => {
      const target = action.target || '_self'
      const theme = action.theme || 'alt'

      const key = `${action.href}-${action.text}`

      return {...action, key, target, theme}
    })
    : []

  onMounted(() => {
    if (typeof window !== 'undefined' && document.querySelector) {
      section.value.querySelectorAll('a[href^="https://github.com"]').forEach((link) => {
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
  }
</style>

<template>
  <div v-if="actions" class="actions cta-actions text-left" ref="section">
    <div class="action" v-for="({href, key, target, text, theme}) in expandedActions">
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