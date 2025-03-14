<script setup>
  import Actions from '../Actions.vue'

  const actions = [
    {
      href: 'https://pglite.dev',
      text: 'PGlite.dev ↗',
      theme: 'pglite'
    },
    {
      href: 'https://github.com/electric-sql/pglite',
      text: 'GitHub'
    }
  ]
</script>

<style scoped>
  .pglite-strap {
    margin: 40px -400px;
    padding: 80px 400px;

    background: black;

    display: flex;
    flex-direction: row;
    align-items: center;
  }

  .pglite-color {
    color: var(--pglite-color);
  }

  .logo {
    flex-basis: 55%;
    text-align: center;
    order: 2;
    display: flex;
    justify-content: center;
    margin-bottom: 30px;
  }
  .logo img {
    max-width: 200px;
  }

  .body {
    flex-basis: 45%;
  }

  @media (max-width: 959px) {
    .pglite-strap {
      flex-direction: column;
      align-items: start;
    }
    .logo {
      order: 0;
      text-align: left;
    }
    .logo img {
      max-width: calc(70px + 8vw);
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
        Electric also develops PGlite, a lightweight WASM Postgres with real-time, reactive bindings.
      </p>
      <Actions :actions="actions" />
    </div>
  </div>
</template>
