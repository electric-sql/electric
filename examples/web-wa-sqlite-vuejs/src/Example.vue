
<script lang="ts">
import { defineComponent, toRaw } from 'vue';
import { useLiveQuery } from 'electric-sql/vuejs';
import { genUUID } from 'electric-sql/util';
import { injectElectric } from './electric';

export default defineComponent({
  setup() {
    const { db } = toRaw(injectElectric()!.value)
    const { results: items } = useLiveQuery(db.items.liveMany())
  
    const addItem = () => db.items.create({
        data: { value: genUUID() },
      });

    const clearItems = () => db.items.deleteMany();
      
    return {
      items,
      addItem,
      clearItems,
    };
  },
});
</script>

<template>
  <div>
    <div class="controls">
      <button class="button" @click="addItem">
        Add
      </button>
      <button class="button" @click="clearItems">
        Clear
      </button>
    </div>
    <div v-if="items && items.length > 0">
      <p v-for="(item, index) in items" :key="index" class="item">
        <code>{{ item.value }}</code>
      </p>
    </div>
    <div v-else>
      No items available.
    </div>
  </div>
</template>

<style src="./Example.css" />
