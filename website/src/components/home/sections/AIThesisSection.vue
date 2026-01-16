<script setup>
import Section from '../Section.vue'

const actions = [
  {
    href: '/sync',
    text: 'Why sync matters',
    theme: 'brand',
  },
  {
    href: '/products',
    text: 'Explore products',
  },
]
</script>

<template>
  <Section :actions="actions">
    <template #title> Build collaborative AI apps </template>
    <template #tagline>
      The new wave of software combines <strong>AI</strong> with
      <strong>team-based&nbsp;collaboration</strong> and
      <strong>fast, modern&nbsp;UX</strong>. These apps need real-time sync,
      durable sessions, and local-first data to&nbsp;deliver.
    </template>
    <div class="thesis-content">
      <blockquote class="thesis-quote">
        "The winners are products that combine AI with team-based collaboration
        and fast, modern UX."
      </blockquote>
    </div>
    <template #outline>
      Electric provides the sync primitives to build them.
    </template>
  </Section>
</template>

<style scoped>
.thesis-content {
  padding: 32px 0;
}

.thesis-quote {
  position: relative;
  padding: 24px 32px;
  margin: 0;
  font-size: 1.25rem;
  font-weight: 500;
  font-style: italic;
  line-height: 1.6;
  color: var(--vp-c-text-1);
  background: linear-gradient(
    135deg,
    rgba(var(--vp-c-brand-1-rgb), 0.1),
    rgba(var(--vp-c-brand-2-rgb), 0.05)
  );
  border-left: 4px solid var(--vp-c-brand-1);
  border-radius: 0 8px 8px 0;
  max-width: 700px;
}

.thesis-quote::before {
  content: '"';
  position: absolute;
  top: -10px;
  left: 16px;
  font-size: 4rem;
  font-style: normal;
  color: var(--vp-c-brand-1);
  opacity: 0.3;
  line-height: 1;
}

@media (max-width: 959px) {
  .thesis-content {
    display: flex;
    justify-content: center;
  }

  .thesis-quote {
    font-size: 1.1rem;
    padding: 20px 24px;
  }
}
</style>
