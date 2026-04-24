<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

/* ManagedCloudStrap — full-bleed band that highlights Electric Cloud
   as the turnkey way to run the stack. Mirrors the visual language of
   NoSilosStrap (eyebrow chip, large title, tagline, CTA row) so the
   homepage reads as a sequence of consistent straps separating the
   product panels and supporting sections. */

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
    :class="['mc-strap', { revealed: isRevealed }]"
  >
    <div class="mc-inner">
      <div class="mc-eyebrow mono">
        <span class="dot"></span>
        Hosted &middot; usage-based &middot; turnkey
      </div>
      <h2 class="mc-title">
        Fully managed&nbsp;cloud
      </h2>
      <p class="mc-tagline">
        Deploy on
        <a href="/cloud">Electric&nbsp;Cloud</a>
        &mdash; a globally distributed
        <span class="no-wrap">data delivery&nbsp;network</span>
        with usage-based pricing.
      </p>
      <div class="mc-actions">
        <VPButton
          tag="a"
          size="medium"
          theme="brand"
          text="Electric Cloud"
          href="/cloud"
        />
        <VPButton
          tag="a"
          size="medium"
          theme="alt"
          text="See pricing"
          href="/pricing"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.mc-strap {
  position: relative;
  padding: 80px 24px;
  background: var(--ea-bg);
  border-bottom: 1px solid var(--ea-divider);
  isolation: isolate;
  overflow: hidden;
}
.mc-strap::before {
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

.mc-inner {
  max-width: 720px;
  margin: 0 auto;
  text-align: center;
  opacity: 0;
  transform: translateY(20px);
  transition:
    opacity 0.6s ease-out,
    transform 0.6s ease-out;
}
.mc-strap.revealed .mc-inner {
  opacity: 1;
  transform: translateY(0);
}

.mc-eyebrow {
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
.mc-eyebrow .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
}

.mc-title {
  font-size: 38px;
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
.mc-tagline {
  font-family: var(--vp-font-family-base);
  font-size: 16px;
  line-height: 1.6;
  color: var(--ea-text-2);
  margin: 14px auto 0;
  max-width: 520px;
}
.mc-tagline a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
  border-bottom: 1px solid
    color-mix(in srgb, var(--vp-c-brand-1) 35%, transparent);
}
.mc-tagline a:hover {
  border-bottom-color: var(--vp-c-brand-1);
}
.mc-tagline :deep(.no-wrap) {
  white-space: nowrap;
}

.mc-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin-top: 28px;
}

@media (max-width: 768px) {
  .mc-strap {
    padding: 64px 20px;
  }
  .mc-title {
    font-size: 30px;
  }
}
@media (max-width: 480px) {
  .mc-strap {
    padding: 48px 16px;
  }
  .mc-title {
    font-size: 26px;
  }
  .mc-actions {
    flex-direction: column;
    align-self: stretch;
    max-width: 280px;
    margin-left: auto;
    margin-right: auto;
  }
}
</style>
