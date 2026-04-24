<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

/* AgentsCTAStrap — final full-bleed strap on the homepage. Drives
   readers towards the Electric Agents landing page and quickstart so
   the page closes with a single, focused next step. Visual language
   matches the other straps (NoSilosStrap, ManagedCloudStrap) for
   consistency, but with a slightly more emphatic gradient to mark
   the page-close. */

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
    :class="['ac-strap', { revealed: isRevealed }]"
  >
    <div class="ac-inner">
      <div class="ac-eyebrow mono">
        <span class="dot"></span>
        Build with&nbsp;Electric
      </div>
      <h2 class="ac-title">
        Bring your agents&nbsp;online
      </h2>
      <div class="ac-actions">
        <VPButton
          tag="a"
          size="medium"
          theme="brand"
          text="Electric Agents"
          href="/agents"
        />
        <VPButton
          tag="a"
          size="medium"
          theme="alt"
          text="Quickstart"
          href="/docs/agents/quickstart"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.ac-strap {
  position: relative;
  padding: 96px 24px;
  background: var(--ea-surface-alt);
  border-bottom: 1px solid var(--ea-divider);
  isolation: isolate;
  overflow: hidden;
}
.ac-strap::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(
    ellipse 80% 100% at 50% 50%,
    color-mix(in srgb, var(--vp-c-brand-1) 9%, transparent) 0%,
    transparent 60%
  );
  z-index: -1;
  opacity: 0.85;
}

.ac-inner {
  max-width: 720px;
  margin: 0 auto;
  text-align: center;
  opacity: 0;
  transform: translateY(20px);
  transition:
    opacity 0.6s ease-out,
    transform 0.6s ease-out;
}
.ac-strap.revealed .ac-inner {
  opacity: 1;
  transform: translateY(0);
}

.ac-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ea-text-3);
  padding: 4px 10px;
  background: var(--ea-surface);
  border: 1px solid var(--ea-divider);
  border-radius: 999px;
  margin-bottom: 22px;
}
.ac-eyebrow .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
}

.ac-title {
  font-size: 42px;
  font-weight: 600;
  line-height: 1.12;
  letter-spacing: -0.015em;
  color: var(--ea-text-1);
  margin: 0;
  max-width: 620px;
  margin-left: auto;
  margin-right: auto;
  text-wrap: balance;
}
.ac-tagline {
  font-family: var(--vp-font-family-base);
  font-size: 17px;
  line-height: 1.6;
  color: var(--ea-text-2);
  margin: 16px auto 0;
  max-width: 520px;
}
.ac-tagline a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
  border-bottom: 1px solid
    color-mix(in srgb, var(--vp-c-brand-1) 35%, transparent);
}
.ac-tagline a:hover {
  border-bottom-color: var(--vp-c-brand-1);
}

.ac-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin-top: 32px;
}

@media (max-width: 768px) {
  .ac-strap {
    padding: 72px 20px;
  }
  .ac-title {
    font-size: 32px;
  }
  .ac-tagline {
    font-size: 15px;
  }
}
@media (max-width: 480px) {
  .ac-strap {
    padding: 56px 16px;
  }
  .ac-title {
    font-size: 26px;
  }
  .ac-actions {
    flex-direction: column;
    align-self: stretch;
    max-width: 280px;
    margin-left: auto;
    margin-right: auto;
  }
}
</style>
