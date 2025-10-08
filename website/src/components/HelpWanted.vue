<script setup>
const { issue } = defineProps(["issue"])

const issueUrl = `https://github.com/electric-sql/electric/issues/${issue}`
</script>

<template>
  <h2>
    Help wanted
    <a
      href="https://github.com/electric-sql/electric/labels/good%20first%20issue"
      class="no-visual"
    >
      <Badge type="tip" text="Good first issue" />
    </a>
  </h2>
  <p>
    We have
    <a :href="issueUrl"> <slot name="thing">an open GitHub issue</slot></a>
    <slot name="doing"> tracking this </slot>
    if you'd like to contribute
    <slot></slot>
  </p>
  <p>
    Please
    <a :href="issueUrl"> <slot name="engage">leave a comment</slot></a>
    or
    <a href="https://discord.electric-sql.com"> ask on Discord</a>
    if you'd like any pointers or to discuss how best to approach this.
  </p>
</template>
