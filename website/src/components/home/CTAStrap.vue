<script setup>
  import Actions from './Actions.vue'

  const { actions } = defineProps(['actions'])
</script>

<style scoped>
  .cta-strap {
    margin: 40px -400px;
    padding: 80px 400px;

    background: var(--vp-sidebar-bg-color);
  }
  .cta-strap:last-child {
    margin-bottom: 0px;
  }
</style>

<template>
  <div class="cta-strap">
    <div class="section-head">
      <h1>
        <slot name="title" />
      </h1>
      <p>
        <slot name="tagline" />
      </p>
    </div>
    <Actions :actions="actions" />
  </div>
</template>