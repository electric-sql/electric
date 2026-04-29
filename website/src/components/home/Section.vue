<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import Actions from './Actions.vue'

const { actions, dark, wideSectionHead, narrow, id } = defineProps([
  'actions',
  'dark',
  'wideSectionHead',
  'narrow',
  'id',
])

const sectionRef = ref()
const isRevealed = ref(false)
let observer = null

onMounted(() => {
  observer = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) {
        isRevealed.value = true
        observer?.disconnect()
      }
    },
    { threshold: 0.08 }
  )
  if (sectionRef.value) observer.observe(sectionRef.value)
})

onUnmounted(() => {
  observer?.disconnect()
})
</script>

<style scoped>
/* Section is the workhorse for grouped homepage blocks. Layout pattern matches
   the agents/streams/sync landing pages: each section is full-bleed (no outer
   max-width), with an inner container that re-establishes the centred
   max-width gutter. The `dark` variant just sets a background colour and so
   stretches all the way to the viewport edges naturally. */
.page-section {
  position: relative;
  padding: 80px 24px;
  /* Hairline matches the agents / streams / sync landing pages — every
     section / strap on the homepage carries one below it, forming a
     continuous chain of dividers down the page. */
  border-bottom: 1px solid var(--vp-c-divider);
}
/* `alt` (not `dark` — that name collides with VitePress's global dark-mode
   class and would cascade dark-mode styling onto child elements). */
.page-section.alt {
  background: var(--vp-sidebar-bg-color);
}

.section-inner {
  max-width: 1152px;
  margin: 0 auto;
  opacity: 0;
  transform: translateY(20px);
  transition:
    opacity 0.6s ease-out,
    transform 0.6s ease-out;
}
.page-section.narrow .section-inner {
  max-width: 860px;
}
.page-section.revealed .section-inner {
  opacity: 1;
  transform: translateY(0);
}

.section-head {
  max-width: 725px;
  margin-bottom: 32px;
}
.section-head.wide-section-head {
  max-width: 900px;
}
.section-head :deep(h1),
.section-head :deep(h2) {
  font-size: 30px;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.01em;
  color: var(--vp-c-text-1);
  margin: 0 0 14px 0;
  text-wrap: balance;
}
.section-head :deep(p) {
  font-family: var(--vp-font-family-base);
  font-size: 17px;
  line-height: 1.6;
  color: var(--vp-c-text-2);
  margin: 0;
  font-weight: 500;
  max-width: 640px;
  text-wrap: pretty;
}

.section-body :deep(p) {
  margin: 10px 0;
  color: var(--vp-c-text-2);
  font-weight: 500;
}

.section-body {
  margin-top: 8px;
}

.section-outline {
  margin-top: 32px;
  max-width: 725px;
}
.section-outline :deep(p) {
  font-size: 16px;
  line-height: 1.6;
  color: var(--vp-c-text-2);
  margin: 0;
}

@media (max-width: 959px) {
  .section-head,
  .section-outline {
    text-align: center;
    max-width: 600px;
    margin-left: auto;
    margin-right: auto;
  }
  .section-head.wide-section-head {
    max-width: 600px;
  }
}

@media (max-width: 768px) {
  .page-section {
    padding: 56px 20px;
  }
  .section-head :deep(h1),
  .section-head :deep(h2) {
    font-size: 24px;
  }
  .section-head :deep(p) {
    font-size: 15px;
  }
  .section-head {
    margin-bottom: 24px;
  }
}

@media (max-width: 480px) {
  .page-section {
    padding: 40px 16px;
  }
  .section-head :deep(h1),
  .section-head :deep(h2) {
    font-size: 22px;
  }
}
</style>

<style>
@media (min-width: 399px) {
  .page-section p a {
    white-space: nowrap;
  }
}
</style>

<template>
  <section
    ref="sectionRef"
    :id="id"
    :class="[
      'page-section',
      { alt: dark, narrow: narrow, revealed: isRevealed },
    ]"
  >
    <div class="section-inner">
      <slot name="override-section-head">
        <div
          :class="['section-head', { 'wide-section-head': wideSectionHead }]"
        >
          <slot name="override-title">
            <h1>
              <slot name="title" />
            </h1>
          </slot>
          <slot name="override-tagline">
            <p>
              <slot name="tagline" />
            </p>
          </slot>
        </div>
      </slot>
      <div class="section-body">
        <slot></slot>
      </div>
      <div v-if="$slots.outline" class="section-outline">
        <p>
          <slot name="outline" />
        </p>
      </div>
      <div v-if="$slots.outbody" class="section-body">
        <slot name="outbody" />
      </div>
      <Actions :actions="actions" />
    </div>
  </section>
</template>
