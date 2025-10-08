<script setup>
import Actions from "./Actions.vue"

const { actions } = defineProps(["actions"])
</script>

<style scoped>
.cta-strap {
  margin: 50px -400px 60px;
  padding: 90px 400px 80px;

  background: var(--vp-sidebar-bg-color);
}
.cta-strap:last-child {
  margin-bottom: 0px;
}

@media (max-width: 959px) {
  .cta-strap {
    text-align: center;
  }
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
    <Actions :actions="actions" :isStrap="true" />
  </div>
</template>
