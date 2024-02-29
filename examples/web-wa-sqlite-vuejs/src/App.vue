<script lang="ts" setup>
import logo from './assets/logo.svg'
import ItemsExample from './ItemsExample.vue'
import ElectricProvider from './ElectricProvider.vue'
</script>

<template>
  <div class="App">
    <header class="App-header">
      <img
        :src="logo"
        class="App-logo"
        alt="logo"
      >
      <ElectricProvider>
        <ItemsExample />
      </ElectricProvider>
    </header>
  </div>
</template>

<style>
.App {
  text-align: center;
}

.App-logo {
  height: min(160px, 30vmin);
  pointer-events: none;
  margin-top: min(30px, 5vmin);
  margin-bottom: min(30px, 5vmin);
}

.App-header {
  background-color: #1c1e20;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: top;
  justify-content: top;
  font-size: calc(10px + 2vmin);
  color: white;
}

.App-link {
  color: #61dafb;
}
</style>
