<style scoped>
  .quote {

  }
  figcaption {
    text-align: left;
    margin-left: 0;
  }
</style>

<template>
  <figure class="quote">
    <blockquote>
      <slot name="quote" />
    </blockquote>
    <figcaption>
      <slot name="attribution" />
    </figcaption>
  </figure>
</template>