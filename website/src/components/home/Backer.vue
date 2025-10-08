<script setup>
import Card from "./Card.vue"

const { backer } = defineProps(["backer"])

const { image, name, profile_uri, short_bio } = backer
</script>

<style scoped>
.backer {
  margin-bottom: 8px;
}
.backer:nth-child(8) {
  display: none;
}
.backer .image {
  width: 100%;

  position: relative;
  display: block;

  border-radius: 12px;
  background-color: var(--vp-c-bg-soft);
  border: 1px solid rgba(42, 44, 52, 0.5);

  overflow: hidden;
}
.backer h5 {
  margin: 10px 0 5px 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--vp-c-text-1);
  line-height: 21px;
}
.backer h6 {
  margin: 0 !important;
  font-size: 13px;
  font-weight: 450;
  color: var(--vp-c-text-2);
  line-height: 19px;
}
@media (max-width: 1149px) {
  .backer h5 {
    font-size: 13.5px;
  }
  .backer h6 {
    font-size: 12.75px;
  }
}
@media (max-width: 1099px) {
  .backer h6 {
    font-size: 12.5px;
    letter-spacing: -0.1px;
  }
}
@media (max-width: 1055px) {
  .backer h6 {
    font-size: 12px;
    letter-spacing: -0.2px;
  }
}
@media (max-width: 1009px) {
  .backer h6 {
    letter-spacing: -0.3px;
  }
}
@media (max-width: 959px) {
  .backer h5 {
    font-size: 14px;
    letter-spacing: 0;
  }
  .backer h6 {
    font-size: 13px;
    letter-spacing: 0;
  }
}
@media (max-width: 549px) {
  .backer:nth-child(8) {
    display: block;
  }
}
@media (max-width: 449px) {
  .backer h5 {
    font-size: 13px;
  }
  .backer h6 {
    font-size: 12px;
  }
}
@media (max-width: 399px) {
  .backer h5 {
    font-size: 14px;
  }
  .backer h6 {
    font-size: 13px;
  }
  .backer:nth-child(8) {
    display: none;
  }
}
</style>

<template>
  <a :href="profile_uri" class="backer no-visual">
    <div class="image">
      <img :src="image" />
    </div>
    <h5>
      {{ name }}
    </h5>
    <h6>
      {{ short_bio }}
    </h6>
  </a>
</template>
