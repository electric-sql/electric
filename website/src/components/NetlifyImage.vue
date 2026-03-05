<script setup>
import { computed } from 'vue'

const props = defineProps({
  src: { type: String, required: true },
  width: { type: Number, required: true },
  height: { type: Number, required: true },
  alt: { type: String, default: '' },
})

const isDev = import.meta.env.DEV

const breakpoints = [320, 640, 960, 1280, 1920]

const netlifyUrl = (url, w) => {
  return `/.netlify/images?url=${encodeURIComponent(url)}&w=${w}`
}

const srcset = computed(() => {
  if (isDev) return undefined

  return breakpoints
    .filter((bp) => bp <= props.width * 2)
    .map((bp) => `${netlifyUrl(props.src, bp)} ${bp}w`)
    .join(', ')
})

const sizes = computed(() => {
  return `(max-width: ${props.width}px) 100vw, ${props.width}px`
})

const imgSrc = computed(() => {
  if (isDev) return props.src
  return netlifyUrl(props.src, props.width)
})
</script>

<template>
  <img
    :src="imgSrc"
    :srcset="srcset"
    :sizes="sizes"
    :width="width"
    :height="height"
    :alt="alt"
    loading="lazy"
    decoding="async"
  />
</template>
