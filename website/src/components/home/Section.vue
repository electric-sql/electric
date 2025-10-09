<script setup>
import Actions from './Actions.vue'

const { actions, wideSectionHead } = defineProps(['actions', 'wideSectionHead'])
</script>

<style scoped>
.page-section {
  padding: 40px 0;
}
.page-section:first-child {
  padding-top: 60px;
}
.section-head {
  max-width: 725px;
}
.section-head.wide-section-head {
  max-width: 900px;
}
.section-head :deep(h1) {
  margin-bottom: 16px;
}
.page-section :deep(p) {
  margin: 10px 0 !important;

  color: var(--vp-c-text-2);
  font-weight: 500;
}
.section-body {
  margin: 24px 0;
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
</style>

<style>
@media (min-width: 399px) {
  .page-section p a {
    white-space: nowrap;
  }
}
</style>

<template>
  <div class="page-section">
    <slot name="override-section-head">
      <div
        :class="`section-head ${wideSectionHead ? 'wide-section-head' : ''}`"
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
    <div v-if="$slots.outline">
      <div class="section-outline">
        <p>
          <slot name="outline" />
        </p>
      </div>
    </div>
    <div v-if="$slots.outbody">
      <div class="section-body">
        <slot name="outbody" />
      </div>
    </div>
    <Actions :actions="actions" />
  </div>
</template>
