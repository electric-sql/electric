<script setup>
import Card from './Card.vue'
import { data as products } from '../../../data/products.data.ts'

const { productPage } = defineProps({
  productPage: {
    type: Boolean,
    default: false
  }
})
</script>

<template>
  <div class="products-grid" :class="{ 'product-page': productPage }">
    <div v-for="product in products" :key="product.slug" class="product-card">
      <Card
        :href="product.href"
        :icon="product.icon"
        :title="product.title">
        <template v-if="productPage">
          <p class="body-p"><span v-html="product.body" />. <span class="detail" v-html="`${product.detail}.`" /></p>
        </template>
        <template v-else>
          <p class="body-p" v-html="product.body" />
          <hr />
          <p class="detail-p" v-html="product.detail" />
        </template>
      </Card>
    </div>
  </div>
</template>

<style scoped>
.products-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 24px;
  margin: 32px 0px 40px;
}
.products-grid.product-page {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.products-grid.product-page .body-p {
  max-width: 450px;
  padding-bottom: 8px;
}
.products-grid.product-page :deep(.no-wrap),
.products-grid.product-page :deep(.no-wrap-xs),
.products-grid.product-page :deep(.no-wrap-sm),
.products-grid.product-page :deep(.no-wrap-md) {
  white-space: normal;
}
@media (max-width: 559px) {
  .products-grid.product-page {
    grid-template-columns: 1fr;
    gap: 20px;
  }
  .products-grid.product-page .detail {
    display: none;
  }
}
.products-grid .body-p {
  margin-top: 8px !important;
  color: var(--vp-c-text-2);
  font-size: 14.25px;
  font-weight: 500;
  max-width: none;
}
.products-grid hr {
  margin: 8px 0 10px;
}
.products-grid .detail-p {
  color: var(--vp-c-text-3);
  font-size: 13px;
  font-weight: 450;
}
.products-grid :deep(.card .icon img) {
  width: calc(40px + 1.5vw);
  height: calc(40px + 1.5vw);
  min-width: 50px;
  min-height: 50px;
  margin: -4px -2px;
}

.products-grid :deep(.breaker) {
  display: inline;
}


@media (min-width: 1149px) {
  .products-grid:not(.product-page) :deep(.icon),
  .products-grid:not(.product-page) :deep(.body) {
    margin: 0 calc(-15px + 1vw);
  }
}

@media (max-width: 1149px) {
  .products-grid:not(.product-page) {
    grid-template-columns: repeat(2, 1fr);
    gap: 24px;
  }
}

@media (max-width: 930px) {
  .products-grid:not(.product-page) :deep(.breaker) {
    display: block;
  }
  .products-grid:not(.product-page) hr,
  .products-grid:not(.product-page) .detail-p {
    display: none;
  }
}

@media (max-width: 559px) {
  .products-grid:not(.product-page) {
    margin: 32px 0px 40px;
    gap: 20px;
    grid-template-columns: 1fr;
  }

  .products-grid:not(.product-page) .product-card {
    position: relative;
    display: block;
    width: 100%;
    margin: 0 auto;
  }

  .products-grid:not(.product-page) :deep(.breaker) {
    display: inline;
  }
}
@media (max-width: 429px) {
  .products-grid:not(.product-page) :deep(.breaker) {
    display: block;
  }
}
</style>
