<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

/* NoSilosStrap — full-bleed transition band that sits between the
   product panels and the supporting sections. Lifted to the same
   visual language as the landing-page CTA panels: --ea- tokens, mono
   eyebrow chip with a brand dot, large 800-weight title with an
   optional gradient accent, and the standard VPButton row. */

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

<template>
  <section
    ref="stripRef"
    :class="['ns-strap', { revealed: isRevealed }]"
  >
    <div class="ns-inner">
      <div class="ns-eyebrow mono">
        <span class="dot"></span>
        Open protocol &middot; Apache&nbsp;2.0 &middot; just&nbsp;HTTP
      </div>
      <h2 class="ns-title">
        No&nbsp;siloes. No&nbsp;black&nbsp;boxes.
      </h2>
      <p class="ns-tagline">
        Just sync, solved, with
        <a href="/docs/api/http">standard&nbsp;web&nbsp;tech</a>.
      </p>
      <div class="ns-actions">
        <VPButton
          tag="a"
          size="medium"
          theme="brand"
          text="Get started"
          href="/docs/quickstart"
        />
        <VPButton
          tag="a"
          size="medium"
          theme="alt"
          text="Read the Docs"
          href="/docs/intro"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.ns-strap {
  position: relative;
  padding: 80px 24px;
  background: var(--ea-bg);
  border-bottom: 1px solid var(--ea-divider);
  isolation: isolate;
  overflow: hidden;
}
.ns-strap::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(
    ellipse 70% 90% at 50% 0%,
    color-mix(in srgb, var(--vp-c-brand-1) 6%, transparent) 0%,
    transparent 55%
  );
  z-index: -1;
  opacity: 0.7;
}

.ns-inner {
  max-width: 720px;
  margin: 0 auto;
  text-align: center;
  opacity: 0;
  transform: translateY(20px);
  transition:
    opacity 0.6s ease-out,
    transform 0.6s ease-out;
}
.ns-strap.revealed .ns-inner {
  opacity: 1;
  transform: translateY(0);
}

.ns-eyebrow {
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
  margin-bottom: 22px;
}
.ns-eyebrow .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
}

.ns-title {
  font-size: 38px;
  /* Strap heading sits a step under the page hero in the type
     hierarchy: hero names stay at 700, every other section/strap
     title (here, ManagedCloud, AgentsCTA, MidPage, BottomCta,
     CTAStrap, Section, HomeProduct…) renders at 600 so the
     hero remains the dominant on-page H1. */
  font-weight: 600;
  line-height: 1.15;
  letter-spacing: -0.015em;
  color: var(--ea-text-1);
  margin: 0;
  max-width: 560px;
  margin-left: auto;
  margin-right: auto;
  text-wrap: balance;
}
.ns-tagline {
  font-family: var(--vp-font-family-base);
  font-size: 16px;
  line-height: 1.6;
  color: var(--ea-text-2);
  margin: 14px auto 0;
  max-width: 460px;
}
.ns-tagline a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
  border-bottom: 1px solid
    color-mix(in srgb, var(--vp-c-brand-1) 35%, transparent);
}
.ns-tagline a:hover {
  border-bottom-color: var(--vp-c-brand-1);
}

.ns-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin-top: 28px;
}

@media (max-width: 768px) {
  .ns-strap {
    padding: 64px 20px;
  }
  .ns-title {
    font-size: 30px;
  }
}
@media (max-width: 480px) {
  .ns-strap {
    padding: 48px 16px;
  }
  .ns-title {
    font-size: 26px;
  }
  .ns-actions {
    flex-direction: column;
    align-self: stretch;
    max-width: 280px;
    margin-left: auto;
    margin-right: auto;
  }
}
</style>
