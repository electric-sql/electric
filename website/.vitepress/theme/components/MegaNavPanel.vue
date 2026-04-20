<script setup>
defineProps({
  product: { type: Object, default: null },
  resources: { type: Object, default: null },
})

defineEmits(['navigate'])
</script>

<template>
  <div
    class="mega-nav-panel"
    :class="{
      'mega-nav-panel-resources': resources,
      'mega-nav-panel-product': product,
      'mega-nav-panel-2col': product && product.secondary,
    }"
    role="menu"
  >
    <template v-if="product">
      <div
        class="mega-nav-panel-grid"
        :class="{ 'mega-nav-panel-grid-2col': product.secondary }"
      >
        <div class="mega-nav-panel-section">
          <div
            v-if="product.secondary"
            class="mega-nav-panel-heading"
          >
            Learn
          </div>
          <a
            class="mega-nav-panel-item mega-nav-panel-item-brand"
            :href="product.base"
            role="menuitem"
            @click="$emit('navigate')"
          >
            <span class="mega-nav-panel-label">{{ product.homeLabel }}</span>
            <span class="mega-nav-panel-sublabel">{{
              product.homeSublabel
            }}</span>
          </a>
          <template v-if="product.primaryLinks && product.primaryLinks.length">
            <a
              v-for="item in product.primaryLinks"
              :key="item.link"
              class="mega-nav-panel-item"
              :class="item.className"
              :href="item.link"
              role="menuitem"
              @click="$emit('navigate')"
            >
              <span class="mega-nav-panel-label">{{ item.label }}</span>
              <span
                v-if="item.sublabel"
                class="mega-nav-panel-sublabel"
                >{{ item.sublabel }}</span
              >
            </a>
          </template>
          <template v-else>
            <a
              class="mega-nav-panel-item"
              :href="`${product.docsBase}/quickstart`"
              role="menuitem"
              @click="$emit('navigate')"
            >
              <span class="mega-nav-panel-label">Quickstart</span>
              <span class="mega-nav-panel-sublabel">Get up and running fast</span>
            </a>
            <a
              class="mega-nav-panel-item"
              :href="`${product.base}/demos`"
              role="menuitem"
              @click="$emit('navigate')"
            >
              <span class="mega-nav-panel-label">Demos</span>
              <span class="mega-nav-panel-sublabel">Example apps</span>
            </a>
            <a
              class="mega-nav-panel-item"
              :href="product.docsBase"
              role="menuitem"
              @click="$emit('navigate')"
            >
              <span class="mega-nav-panel-label">Docs</span>
              <span class="mega-nav-panel-sublabel">Full documentation</span>
            </a>
          </template>
        </div>
        <div
          v-if="product.secondary"
          class="mega-nav-panel-section mega-nav-panel-secondary"
        >
          <div
            v-if="product.secondary.heading"
            class="mega-nav-panel-heading"
          >
            {{ product.secondary.heading }}
          </div>
          <a
            v-for="item in product.secondary.items"
            :key="item.link"
            class="mega-nav-panel-item mega-nav-panel-item-icon"
            :href="item.link"
            role="menuitem"
            @click="$emit('navigate')"
          >
            <img
              v-if="item.icon"
              :src="item.icon"
              :alt="item.label"
              class="mega-nav-panel-item-img"
            />
            <span class="mega-nav-panel-item-text">
              <span class="mega-nav-panel-label">{{ item.label }}</span>
              <span
                v-if="item.sublabel"
                class="mega-nav-panel-sublabel"
                >{{ item.sublabel }}</span
              >
            </span>
          </a>
        </div>
      </div>
      <div
        v-if="product.extras && product.extras.length"
        class="mega-nav-panel-section mega-nav-panel-extras"
      >
        <a
          v-for="item in product.extras"
          :key="item.link"
          class="mega-nav-panel-item"
          :href="item.link"
          :target="item.external ? '_blank' : undefined"
          :rel="item.external ? 'noopener noreferrer' : undefined"
          role="menuitem"
          @click="$emit('navigate')"
        >
          <span class="mega-nav-panel-label">{{ item.label }}</span>
          <span
            v-if="item.sublabel"
            class="mega-nav-panel-sublabel"
            >{{ item.sublabel }}</span
          >
        </a>
      </div>
    </template>
    <template v-else-if="resources">
      <div class="mega-nav-panel-section mega-nav-panel-cols">
        <div
          v-for="(column, index) in resources.columns"
          :key="index"
          class="mega-nav-panel-col"
          :class="{ 'mega-nav-panel-col-divider': index > 0 }"
        >
          <a
            v-for="link in column"
            :key="link.link"
            class="mega-nav-panel-item"
            :class="link.className"
            :href="link.link"
            role="menuitem"
            @click="$emit('navigate')"
          >
            <span class="mega-nav-panel-label">{{ link.label }}</span>
            <span
              v-if="link.sublabel"
              class="mega-nav-panel-sublabel"
              >{{ link.sublabel }}</span
            >
          </a>
        </div>
      </div>
      <div
        v-if="resources.social && resources.social.length"
        class="mega-nav-panel-section mega-nav-panel-social"
      >
        <a
          v-for="s in resources.social"
          :key="s.link"
          class="mega-nav-panel-social-item"
          :href="s.link"
          target="_blank"
          rel="noopener noreferrer"
          role="menuitem"
          :aria-label="s.label"
          :title="s.label"
          @click="$emit('navigate')"
        >
          <span
            class="mega-nav-social-icon"
            :class="`vpi-social-${s.icon}`"
            aria-hidden="true"
          ></span>
        </a>
      </div>
    </template>
  </div>
</template>
