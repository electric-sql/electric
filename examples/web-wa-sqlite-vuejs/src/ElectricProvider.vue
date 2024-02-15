<script lang="ts">
import { computed, defineComponent, onMounted, shallowRef } from 'vue';
import { LIB_VERSION } from 'electric-sql/version';
import { uniqueTabId } from 'electric-sql/util';
import { ElectricDatabase, electrify } from 'electric-sql/wa-sqlite';
import { authToken } from './auth';
import { provideElectric } from './electric'
import { Electric, schema } from './generated/client';


export default defineComponent({
  setup() {
    
    const electricRef = shallowRef<Electric>()
    const showChild = computed(() => electricRef.value !== undefined)

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
      const electric = await electrify(conn, schema, config);

      // Resolves when the shape subscription has been established.
      const shape = await electric.db.items.sync();

      // Resolves when the data has been synced into the local database.
      await shape.synced;
      electricRef.value = electric
      
    });

    provideElectric(electricRef)
    return { showChild };
  },
});
</script>

<template>
  <div v-if="showChild">
    <slot />
  </div>
</template>

