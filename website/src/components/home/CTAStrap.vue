<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import Actions from './Actions.vue'

const { actions, light } = defineProps(['actions', 'light'])

const stripRef = ref()
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
    { threshold: 0.1 }
  )
  if (stripRef.value) observer.observe(stripRef.value)
})

onUnmounted(() => {
  observer?.disconnect()
})
</script>

<style scoped>
/* CTA strap is a full-bleed coloured band used for "marketing" calls to action.
   Same outer-full-bleed / inner-max-width pattern as the landing pages so it
   reaches the viewport edges naturally. */
.cta-strap {
  position: relative;
  padding: 80px 24px;
  background: var(--vp-sidebar-bg-color);
  border-bottom: 1px solid var(--vp-c-divider);
}
/* `light` lets a strap opt back into the page background so adjacent
   sections can alternate cleanly. */
.cta-strap.light {
  background: var(--vp-c-bg);
}

.cta-inner {
  max-width: 1152px;
  margin: 0 auto;
  opacity: 0;
  transform: translateY(20px);
  transition:
    opacity 0.6s ease-out,
    transform 0.6s ease-out;
}
.cta-strap.revealed .cta-inner {
  opacity: 1;
  transform: translateY(0);
}

.cta-head {
  max-width: 860px;
}
.cta-head :deep(h1),
.cta-head :deep(h2) {
  font-size: 34px;
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.015em;
  color: var(--vp-c-text-1);
  margin: 0 0 14px 0;
  text-wrap: balance;
}
.cta-head :deep(p) {
  font-family: var(--vp-font-family-base);
  font-size: 17px;
  line-height: 1.6;
  color: var(--vp-c-text-2);
  margin: 0 0 24px 0;
  font-weight: 500;
  max-width: 640px;
  text-wrap: pretty;
}

@media (max-width: 959px) {
  .cta-strap {
    text-align: center;
  }
  .cta-head {
    margin-left: auto;
    margin-right: auto;
  }
  .cta-head :deep(p) {
    margin-left: auto;
    margin-right: auto;
  }
}

@media (max-width: 768px) {
  .cta-strap {
    padding: 64px 20px;
  }
  .cta-head :deep(h1),
  .cta-head :deep(h2) {
    font-size: 26px;
  }
  .cta-head :deep(p) {
    font-size: 15px;
  }
}

@media (max-width: 480px) {
  .cta-strap {
    padding: 48px 16px;
  }
  .cta-head :deep(h1),
  .cta-head :deep(h2) {
    font-size: 22px;
  }
}
</style>

<template>
  <section
    ref="stripRef"
    :class="['cta-strap', { revealed: isRevealed, light: light }]"
  >
    <div class="cta-inner">
      <div class="cta-head">
        <h1>
          <slot name="title" />
        </h1>
        <p>
          <slot name="tagline" />
        </p>
      </div>
      <Actions :actions="actions" :isStrap="true" />
    </div>
  </section>
</template>
