<script setup>
  const { contribute, issue } = defineProps(['contribute', 'issue'])

  console.log(issue)
  console.log(contribute)

  const issueUrl = `https://github.com/electric-sql/electric/issues/${issue}`

  console.log(issueUrl)
</script>

<template>
  <h2>
    Help wanted
    <a href="https://github.com/electric-sql/electric/labels/good%20first%20issue"
        class="no-visual">
      <Badge type="tip" text="Good first issue" />
    </a>
  </h2>
  <p>
    We have an
    <a :href="issueUrl">
      open GitHub issue</a>
    tracking this if you'd like to contribute {{ contribute }}.
  </p>
  <p>
    Please
    <a :href="issueUrl">
      leave a comment</a>
    or
    <a href="https://discord.electric-sql.com">
      ask on Discord</a>
    if you'd like any pointers or to discuss how best to approach this.
  </p>
</template>
