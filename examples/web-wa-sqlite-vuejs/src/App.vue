<script lang="ts">
import { defineComponent } from 'vue';
import logo from './assets/logo.svg';
import './App.css';
import './style.css';
import ItemsExample from './ItemsExample.vue';
import ElectricProvider from './ElectricProvider.vue'

export default defineComponent({
  name: 'App',
  components: {
    ElectricProvider,
    ItemsExample,
  },
  data() {
    return {
      logo: logo,
    };
  },
});
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

<style src="./App.css" />
