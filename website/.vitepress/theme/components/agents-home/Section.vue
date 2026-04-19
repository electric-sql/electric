<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue"

defineProps<{
  id?: string
  title?: string
  subtitle?: string
  dark?: boolean
  narrow?: boolean
}>()

const sectionRef = ref<HTMLElement>()
const isRevealed = ref(false)
let observer: IntersectionObserver | null = null

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

<template>
  <section
    ref="sectionRef"
    :id="id"
    class="ea-section"
    :class="{ dark, narrow, revealed: isRevealed }"
  >
    <div class="ea-section-inner">
      <div v-if="title" class="ea-section-header">
        <h2 class="ea-section-title">{{ title }}</h2>
        <p v-if="subtitle" class="ea-section-subtitle">{{ subtitle }}</p>
      </div>
      <slot />
    </div>
  </section>
</template>

<style scoped>
.ea-section {
  padding: 80px 24px;
  border-bottom: 1px solid var(--ea-divider);
}

.ea-section.dark {
  background: var(--ea-surface-alt);
}

.ea-section-inner {
  max-width: 1152px;
  margin: 0 auto;
  opacity: 0;
  transform: translateY(24px);
  transition: opacity 0.6s ease-out, transform 0.6s ease-out;
}

.ea-section.revealed .ea-section-inner {
  opacity: 1;
  transform: translateY(0);
}

.ea-section.narrow .ea-section-inner {
  max-width: 860px;
}

.ea-section-header {
  margin-bottom: 40px;
}

.ea-section-title {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.3;
  color: var(--ea-text-1);
  margin: 0;
}

.ea-section-subtitle {
  font-family: var(--vp-font-family-base);
  font-size: 17px;
  line-height: 1.6;
  color: var(--ea-text-2);
  margin: 12px 0 0;
  max-width: 640px;
  text-wrap: pretty;
}

@media (max-width: 768px) {
  .ea-section {
    padding: 56px 20px;
  }
  .ea-section-title {
    font-size: 22px;
  }
  .ea-section-subtitle {
    font-size: 15px;
  }
  .ea-section-header {
    margin-bottom: 28px;
  }
}

@media (max-width: 480px) {
  .ea-section {
    padding: 40px 16px;
  }
  .ea-section-title {
    font-size: 20px;
  }
  .ea-section-subtitle {
    font-size: 14px;
  }
  .ea-section-header {
    margin-bottom: 24px;
  }
}
</style>
