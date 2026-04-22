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
      <!--
        Header is rendered when EITHER a `title` prop is supplied (the
        original landing-page convention) OR a #title slot is provided.
        The slot form lets callers pass rich HTML (links, no-wrap spans,
        gradient accents) — the homepage sections need this.
      -->
      <div
        v-if="title || $slots.title || $slots.subtitle || $slots.eyebrow"
        class="ea-section-header"
      >
        <div v-if="$slots.eyebrow" class="ea-section-eyebrow mono">
          <slot name="eyebrow" />
        </div>
        <h2 class="ea-section-title">
          <slot name="title">{{ title }}</slot>
        </h2>
        <p
          v-if="subtitle || $slots.subtitle"
          class="ea-section-subtitle"
        >
          <slot name="subtitle">{{ subtitle }}</slot>
        </p>
      </div>
      <slot />
      <div v-if="$slots.actions" class="ea-section-actions">
        <slot name="actions" />
      </div>
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

/* Eyebrow chip — small uppercased mono pill with brand-coloured dot,
   matches the landing-page section-header pattern used on `cloud-home`,
   `streams-home` etc. Caller injects content via the #eyebrow slot;
   we render the dot automatically. */
.ea-section-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ea-text-3);
  padding: 4px 10px;
  background: var(--ea-surface-alt);
  border: 1px solid var(--ea-divider);
  border-radius: 999px;
  margin-bottom: 14px;
}
.ea-section.dark .ea-section-eyebrow {
  background: color-mix(in srgb, var(--ea-surface) 60%, transparent);
}
.ea-section-eyebrow::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
  flex-shrink: 0;
}

.ea-section-title {
  font-size: 28px;
  /* Section / h2 weight reduced from 700 to 600 so the headline-to-section
     hierarchy reads more clearly (hero name 700 → section title 600 →
     tertiary 500/600). */
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.01em;
  color: var(--ea-text-1);
  margin: 0;
  text-wrap: balance;
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

.ea-section-subtitle :deep(a) {
  color: var(--vp-c-brand-1);
  text-decoration: none;
  border-bottom: 1px solid
    color-mix(in srgb, var(--vp-c-brand-1) 35%, transparent);
}
.ea-section-subtitle :deep(a:hover) {
  border-bottom-color: var(--vp-c-brand-1);
}

.ea-section-title :deep(.no-wrap) {
  white-space: nowrap;
}
.ea-section-subtitle :deep(.no-wrap) {
  white-space: nowrap;
}

/*
  Optional CTA row that sits below the section body. Mirrors the
  Actions / VPButton row used at the bottom of every legacy
  homepage Section so callers can opt in via the #actions slot.
*/
.ea-section-actions {
  margin-top: 32px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

@media (max-width: 768px) {
  .ea-section {
    /* Bumped left/right padding from 20 → 24 so content has more
       breathing room from the viewport edge on tablets / large phones. */
    padding: 56px 24px;
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
    /* Bumped left/right padding from 16 → 20 for the same reason. */
    padding: 40px 20px;
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
