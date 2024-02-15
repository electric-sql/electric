<template>
  <div class="App">
    <header class="App-header">
      <img :src="logo" class="App-logo" alt="logo" />
      <Example />
    </header>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import logo from './assets/logo.svg';
import './App.css';
import './style.css';
import Example from './Example.vue';

export default defineComponent({
  name: 'App',
  components: {
    Example,
  },
  data() {
    return {
      logo: logo,
    };
  },
});
</script>
