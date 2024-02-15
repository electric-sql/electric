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
    <div v-if="items.length > 0">
      <p v-for="(item, index) in items" :key="index" class="item">
        <code>{{ item.value }}</code>
      </p>
    </div>
    <div v-else>
      No items available.
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, onMounted, ref } from 'vue';
import { LIB_VERSION } from 'electric-sql/version';
import { makeElectricContext, useLiveQuery } from 'electric-sql/vuejs';
import { genUUID, uniqueTabId } from 'electric-sql/util';
import { ElectricDatabase, electrify } from 'electric-sql/wa-sqlite';
import { authToken } from './auth';
import { Electric, Items as Item, schema } from './generated/client';

const { ElectricProvider, useElectric } = makeElectricContext<Electric>();

export default defineComponent({
  setup() {
    const electric = ref<Electric | undefined>(undefined);
    const items = ref<Item[]>([]);

    onMounted(async () => {
      const config = {
        auth: {
          token: authToken(),
        },
        debug: import.meta.env.DEV,
        url: import.meta.env.ELECTRIC_SERVICE,
      };

      const { tabId } = uniqueTabId();
      const scopedDbName = `basic-${LIB_VERSION}-${tabId}.db`;

      const conn = await ElectricDatabase.init(scopedDbName);
      electric.value = await electrify(conn, schema, config);

      await syncItems();
    });

    const { db } = useElectric()!;
    const { results } = useLiveQuery(db.items.liveMany());

    const syncItems = async () => {
      if (electric.value) {
        // Resolves when the shape subscription has been established.
        const shape = await electric.value.items.sync();

        // Resolves when the data has been synced into the local database.
        await shape.synced;
      }
    };

    const addItem = async () => {
      if (electric.value) {
        await electric.value.items.create({
          data: {
            value: genUUID(),
          },
        });
      }
    };

    const clearItems = async () => {
      if (electric.value) {
        await electric.value.items.deleteMany();
      }
    };

    results.subscribe((data) => {
      items.value = data ?? [];
    });

    return {
      items,
      addItem,
      clearItems,
    };
  },
});
</script>

<style scoped>
.controls {
  margin-bottom: 10px;
}
.button {
  margin-right: 10px;
}
.item {
  margin-bottom: 5px;
}
</style>
