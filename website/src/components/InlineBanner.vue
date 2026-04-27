<script setup>
import { computed, useSlots } from 'vue'

const props = defineProps({
  title: {
    type: String,
    required: true,
  },
  severity: {
    type: String,
    default: 'info',
    validator: (value) => ['info', 'warning', 'error'].includes(value),
  },
})

const slots = useSlots()
const hasActions = computed(() => slots.default !== undefined)
</script>

<template>
  <div
    class="inline-banner"
    :class="`severity-${props.severity}`"
    :role="props.severity === 'error' ? 'alert' : 'status'"
  >
    <div class="inline-banner__icon" aria-hidden="true">
      <svg
        v-if="props.severity === 'error'"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5" />
        <path
          d="M5.25 5.25L10.75 10.75M10.75 5.25L5.25 10.75"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
        />
      </svg>
      <svg
        v-else-if="props.severity === 'warning'"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M7.13 2.26a1 1 0 0 1 1.74 0l5.14 9.34A1 1 0 0 1 13.14 13H2.86a1 1 0 0 1-.87-1.4l5.14-9.34Z"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linejoin="round"
        />
        <path
          d="M8 5.5V8.5M8 11.25H8.01"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
        />
      </svg>
      <svg
        v-else
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5" />
        <path
          d="M8 7V11M8 4.75H8.01"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
        />
      </svg>
    </div>
    <div class="inline-banner__body">
      <p class="inline-banner__title">
        {{ props.title }}
      </p>
      <div v-if="hasActions" class="inline-banner__actions">
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
.inline-banner {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin: 24px 0 28px;
  padding: 14px 16px;
  border: 1px solid var(--inline-banner-border);
  border-radius: 12px;
  background: var(--inline-banner-bg);
  color: var(--inline-banner-color);
}

.severity-info {
  --inline-banner-bg: rgba(126, 120, 219, 0.14);
  --inline-banner-border: rgba(153, 143, 231, 0.42);
  --inline-banner-color: var(--vp-c-text-1);
  --inline-banner-accent: var(--vp-c-indigo-1);
}

.severity-warning {
  --inline-banner-bg: rgba(246, 183, 77, 0.12);
  --inline-banner-border: rgba(246, 183, 77, 0.34);
  --inline-banner-color: var(--vp-c-text-1);
  --inline-banner-accent: #f6d17b;
}

.severity-error {
  --inline-banner-bg: rgba(246, 102, 102, 0.12);
  --inline-banner-border: rgba(246, 102, 102, 0.34);
  --inline-banner-color: var(--vp-c-text-1);
  --inline-banner-accent: #ff9a9a;
}

.inline-banner__icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  margin-top: 1px;
  color: var(--inline-banner-accent);
}

.inline-banner__icon svg {
  display: block;
  width: 100%;
  height: 100%;
}

.inline-banner__body {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  align-items: center;
  min-width: 0;
}

.inline-banner__title {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
  font-weight: 600;
  color: var(--inline-banner-color);
}

.inline-banner__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  align-items: center;
}

.inline-banner__actions :deep(a) {
  font-size: 13px;
  line-height: 1.5;
  font-weight: 600;
  color: var(--inline-banner-accent);
  text-decoration: none;
  transition: color 0.2s ease;
  white-space: nowrap;
}

.inline-banner__actions :deep(a:hover) {
  color: var(--vp-c-text-1);
}

.inline-banner__actions :deep(a + a) {
  position: relative;
  padding-left: 14px;
}

.inline-banner__actions :deep(a + a)::before {
  content: '•';
  position: absolute;
  left: 0;
  color: var(--vp-c-text-3);
}

@media (max-width: 559px) {
  .inline-banner {
    margin: 20px 0 24px;
    padding: 12px 14px;
  }

  .inline-banner__title {
    font-size: 13.5px;
  }

  .inline-banner__actions :deep(a) {
    white-space: normal;
  }
}
</style>
