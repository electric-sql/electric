<script setup>
import { useRoute, onContentUpdated } from 'vitepress';
import { computed, ref } from 'vue';
import { useData } from 'vitepress';
import { useSidebar } from 'vitepress/theme';
import { getHeaders } from 'vitepress/dist/client/theme-default/composables/outline';
import VPDocFooter from 'vitepress/dist/client/theme-default/components/VPDocFooter.vue';
import VPLocalNavOutlineDropdown from 'vitepress/dist/client/theme-default/components/VPLocalNavOutlineDropdown.vue';

const { theme, frontmatter } = useData();
const route = useRoute();
const { hasSidebar, hasAside, leftAside } = useSidebar();

const headers = ref([]);

onContentUpdated(() => {
	headers.value = getHeaders(frontmatter.value.outline ?? theme.value.outline);
});
</script>

<template>
  <div
    class="VPDoc"
    :class="{ 'has-sidebar': hasSidebar, 'has-aside': hasAside }"
  >
      <div :class="['sticky-header-container', headerClass]" >
      <div class="title-container">
        <img :src="frontmatter.image" class="icon" />
        <h1 :class="[frontmatter.titleClass]">
          {{ frontmatter.title}}
        </h1>
      </div>
        <VPLocalNavOutlineDropdown :headers="headers" :navHeight="64" />
    </div>
    <div class="container">
      <div class="content">
        <div class="content-container">
          <main class="main">
            <Content
              class="vp-doc"
              :class="[
                theme.externalLinkIcon && 'external-link-icon-enabled'
              ]"
            />
          </main>
          <VPDocFooter />
        </div>
      </div>
    </div>
  </div>
</template>

<style>
.VPContent:has(.sticky-header-container) {
  position: absolute;
}

</style>

<style scoped>


.VPDoc {
  padding: 32px 24px 96px;
  width: 100%;
}

.sticky-header-container {
  position: sticky;
  top: var(--vp-nav-height);
  z-index: 20;
  margin: -32px -24px 32px -24px;
}

@media (min-width: 768px) {
  .VPDoc {
    padding: 48px 32px 128px;
  }
  
  .sticky-header-container {
    margin: -48px -32px 48px -32px;
  }
}

@media (min-width: 960px) {
  .VPDoc {
    padding: 48px 32px 0;
  }
  
  .sticky-header-container {
    margin: -48px -32px 48px -32px;
  }

  .VPDoc:not(.has-sidebar) .container {
    display: flex;
    justify-content: center;
    max-width: 992px;
  }

  .VPDoc:not(.has-sidebar) .content {
    max-width: 752px;
  }
}

@media (min-width: 1280px) {
  .VPDoc .container {
    display: flex;
    justify-content: center;
  }

  .VPDoc .aside {
    display: block;
  }
}

.container {
  margin: 0 auto;
  width: 100%;
}

.aside {
  position: relative;
  display: none;
  order: 2;
  flex-grow: 1;
  padding-left: 32px;
  width: 100%;
  max-width: 256px;
}

.left-aside {
  order: 1;
  padding-left: unset;
  padding-right: 32px;
}

.aside-container {
  position: fixed;
  top: 0;
  padding-top: calc(var(--vp-nav-height) + var(--vp-layout-top-height, 0px) + var(--vp-doc-top-height, 0px) + 48px);
  width: 224px;
  height: 100vh;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: none;
}

.aside-container::-webkit-scrollbar {
  display: none;
}

.aside-curtain {
  position: fixed;
  bottom: 0;
  z-index: 10;
  width: 224px;
  height: 32px;
  background: linear-gradient(transparent, var(--vp-c-bg) 70%);
}

.aside-content {
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - (var(--vp-nav-height) + var(--vp-layout-top-height, 0px) + 48px));
  padding-bottom: 32px;
}

.content {
  position: relative;
  margin: 0 auto;
  width: 100%;
}

@media (min-width: 960px) {
  .content {
    padding: 0 32px 128px;
  }
}

@media (min-width: 1280px) {
  .content {
    order: 1;
    margin: 0;
    min-width: 640px;
  }
}

.content-container {
  margin: 0 auto;
  max-width: 688px;
}

.main {
  display: block;
}

.vp-doc {
  min-height: 250px;
  padding: 32px 0;
}


.sticky-header-container{
  position: sticky;
  top: var(--vp-nav-height);
  display: flex;
  align-items: center;
  justify-content: space-between !important;
  gap: 16px;
  padding: 16px 240px;
  background: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-divider);
  z-index: 20;

  .title-container {
    display: flex;
    gap: .2em;
    flex-direction: row;
    align-items: center;
    font-size: 56px;

  }

  h1 {
    font-size: .9em;
    font-weight: 600;
    color: var(--vp-c-text-1);
    margin: 0;
    line-height: 1.25em;
  }


  .icon {
    width: 1em;
    height: 1em;
    flex-shrink: 0;
  }
}


</style>


