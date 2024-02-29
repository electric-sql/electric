<script lang="ts" setup>
import { useLiveQuery } from 'electric-sql/vuejs'
import { genUUID } from 'electric-sql/util'
import { injectElectric } from './electric'

const { db } = injectElectric()!
const { results: items } = useLiveQuery(db.items.liveMany())

const addItem = () => db.items.create({ data: { value: genUUID() } })

const clearItems = () => db.items.deleteMany()
</script>

<template>
  <div>
    <div class="controls">
      <button
        class="button"
        @click="addItem"
      >
        Add
      </button>
      <button
        class="button"
        @click="clearItems"
      >
        Clear
      </button>
    </div>
    <div v-if="items && items.length > 0">
      <p
        v-for="(item, index) in items"
        :key="index"
        class="item"
      >
        <code>{{ item.value }}</code>
      </p>
    </div>
    <div v-else>
      No items available.
    </div>
  </div>
</template>

<style>
.controls {
  margin-bottom: 1.5rem;
}

.button {
  display: inline-block;
  line-height: 1.3;
  text-align: center;
  text-decoration: none;
  vertical-align: middle;
  cursor: pointer;
  user-select: none;
  width: calc(15vw + 100px);
  margin-right: 0.5rem !important;
  margin-left: 0.5rem !important;
  border-radius: 32px;
  text-shadow: 2px 6px 20px rgba(0, 0, 0, 0.4);
  box-shadow: rgba(0, 0, 0, 0.5) 1px 2px 8px 0px;
  background: #1e2123;
  border: 2px solid #229089;
  color: #f9fdff;
  font-size: 16px;
  font-weight: 500;
  padding: 10px 18px;
}

.item {
  display: block;
  line-height: 1.3;
  text-align: center;
  width: calc(30vw - 1.5rem + 200px);
  margin-right: auto;
  margin-left: auto;
  border-radius: 32px;
  border: 1.5px solid #bbb;
  box-shadow: rgba(0, 0, 0, 0.3) 1px 2px 8px 0px;
  color: #f9fdff;
  font-size: 13px;
  padding: 10px 18px;
}
</style>
