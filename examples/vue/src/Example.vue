<script setup lang="ts">
import { useShape } from "@electric-sql/vue"

type Item = { id: string }

const baseUrl = import.meta.env.ELECTRIC_URL ?? `http://localhost:3000`

const shape = useShape<Item>({
  url: `${baseUrl}/v1/shape`,
  params: {
    table: `items`,
  },
})

const formatSyncTime = () => {
  if (!shape.lastSyncedAt) return ''
  return new Date(shape.lastSyncedAt).toLocaleTimeString()
}
</script>

<template>
  <div>
    <div v-if="shape.isLoading" class="sync-status">Syncing...</div>
    <div v-else class="sync-status">Last synced: {{ formatSyncTime() }}</div>

    <div class="items-container">
      <p v-for="(item) in shape.data" :key="item.id">
        <code>{{ item.id }}</code>
      </p>
    </div>
  </div>
</template>

<style scoped>
.sync-status {
  font-size: 14px;
  margin-bottom: 16px;
  color: #aaa;
}

.items-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
}

.item {
  display: block;
  line-height: 1.3;
  text-align: center;
  vertical-align: middle;
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