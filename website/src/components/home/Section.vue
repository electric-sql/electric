<script setup>
  import Actions from './Actions.vue'

  const { actions } = defineProps(['actions'])
</script>

<style scoped>
  .page-section {
    padding: 40px 0;
  }
  .page-section:first-child {
    padding-top: 60px;
  }
  .section-body {
    margin: 24px 0;
  }
</style>

<template>
  <div class="page-section">
    <slot name="override-section-head">
      <div class="section-head">
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
      <p>
        <slot name="outline" />
      </p>
    </div>
    <div v-if="$slots.outbody">
      <div class="section-body">
        <slot name="outbody" />
      </div>
    </div>
    <Actions :actions="actions" />
  </div>
</template>