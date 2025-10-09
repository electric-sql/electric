<script setup>
import Actions from '../Actions.vue'

const actions = [
  {
    href: 'https://pglite.dev',
    text: 'PGlite.dev ↗',
    theme: 'pglite',
  },
  {
    href: 'https://github.com/electric-sql/pglite',
    text: 'GitHub',
  },
]
</script>

<style scoped>
.pglite-strap {
  margin: 50px -400px 60px;
  padding: 90px 400px 80px;

  background: black;

  display: flex;
  flex-direction: row;
  align-items: center;
}

.pglite-color {
  color: var(--pglite-color);
}

.logo {
  flex-basis: 54%;
  text-align: center;
  order: 2;
  display: flex;
  justify-content: center;
  margin-bottom: 30px;
}
.logo img {
  max-width: calc(100px + 6vw);
  margin-right: 10%;
}

.body {
  flex-basis: 46%;
  max-width: 550px;
}

@media (max-width: 959px) {
  .pglite-strap {
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .logo {
    order: 0;
    text-align: center;
  }
  .logo img {
    max-width: calc(60px + 8vw);
    margin-right: 0;
  }
}
</style>

<template>
  <div class="pglite-strap">
    <div class="logo">
      <img src="/img/home/pglite-icon.svg" />
    </div>
    <div class="body">
      <h1>
        <span class="pglite-color">PGlite</span><br />
        Embeddable Postgres
      </h1>
      <p>
        Electric also develops PGlite, a lightweight WASM Postgres with
        <span class="no-wrap">real-time</span>, reactive&nbsp;bindings.
      </p>
      <Actions :actions="actions" />
    </div>
  </div>
</template>
