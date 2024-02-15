<script lang="ts">
import { defineComponent } from 'vue';
import logo from './assets/logo.svg';
import './App.css';
import './style.css';
import Example from './Example.vue';
import ElectricProvider from './ElectricProvider.vue'

export default defineComponent({
  name: 'App',
  components: {
    ElectricProvider,
    Example,
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
        <Example />
      </ElectricProvider>
    </header>
  </div>
</template>

<style src="./App.css" />
