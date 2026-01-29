<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { VPButton } from 'vitepress/theme-without-fonts'
import { data as initialStarCounts } from '../../data/count.data.ts'
import { getStarCount } from '../lib/star-count.ts'

const props = defineProps<{
  repo: string
  text?: string
  theme?: string
}>()

const buttonRef = ref<HTMLElement | null>(null)

const formatStarCount = (count: number) => {
  return `<span class="muted">(</span><span> ☆ </span><span>${Math.round(count / 100) / 10}k</span><span> </span><span class="muted">)</span>`
}

const updateButtonContent = (count: number) => {
  if (!buttonRef.value) return

  const link = buttonRef.value.querySelector('a')
  if (!link) return

  link.innerHTML = `<span class="vpi-social-github"></span>${props.text || 'GitHub'}&nbsp;<span class="count">${formatStarCount(count)}</span>`
}

onMounted(async () => {
  const initialCount = initialStarCounts[props.repo]

  if (initialCount) {
    updateButtonContent(initialCount)
  }

  if (typeof window !== 'undefined') {
    const count = await getStarCount(props.repo, initialCount || 0)
    updateButtonContent(count)
  }
})
</script>

<template>
  <span ref="buttonRef" class="github-button-wrapper">
    <VPButton
      :href="`https://github.com/${repo}`"
      :text="text || 'GitHub'"
      :theme="theme || 'alt'"
      target="_blank"
    />
  </span>
</template>

<style>
.github-button-wrapper .VPButton {
  display: inline-flex;
  align-items: center;
}

.github-button-wrapper .vpi-social-github {
  display: inline-block;
  width: 1.25rem;
  height: 1.25rem;
  margin-right: 0.35rem;
  background-color: currentColor;
  -webkit-mask-image: var(--icon);
  mask-image: var(--icon);
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-size: 100% 100%;
  mask-size: 100% 100%;
}

.github-button-wrapper .count {
  white-space: nowrap;
}

.github-button-wrapper .count .muted {
  opacity: 0.5;
}
</style>
