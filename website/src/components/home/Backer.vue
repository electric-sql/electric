<script setup>
import Card from './Card.vue'

const { backer } = defineProps(['backer'])

const { image, name, profile_uri, short_bio } = backer
</script>

<style scoped>
.backer {
  margin-bottom: 8px;
}
.backer .image {
  width: 100%;

  position: relative;
  display: block;

  border-radius: 12px;
  background-color: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);

  overflow: hidden;
}
.backer .backer-name {
  margin: 10px 0 5px 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--vp-c-text-1);
  line-height: 21px;
}
.backer .backer-bio {
  margin: 0 !important;
  font-size: 13px;
  font-weight: 450;
  color: var(--vp-c-text-2);
  line-height: 19px;
}
@media (max-width: 1149px) {
  .backer .backer-name {
    font-size: 13.5px;
  }
  .backer .backer-bio {
    font-size: 12.75px;
  }
}
@media (max-width: 1099px) {
  .backer .backer-bio {
    font-size: 12.5px;
    letter-spacing: -0.1px;
  }
}
@media (max-width: 1055px) {
  .backer .backer-bio {
    font-size: 12px;
    letter-spacing: -0.2px;
  }
}
@media (max-width: 1009px) {
  .backer .backer-bio {
    letter-spacing: -0.3px;
  }
}
@media (max-width: 959px) {
  .backer .backer-name {
    font-size: 14px;
    letter-spacing: 0;
  }
  .backer .backer-bio {
    font-size: 13px;
    letter-spacing: 0;
  }
}
@media (max-width: 449px) {
  .backer .backer-name {
    font-size: 13px;
  }
  .backer .backer-bio {
    font-size: 12px;
  }
}
@media (max-width: 399px) {
  .backer .backer-name {
    font-size: 14px;
  }
  .backer .backer-bio {
    font-size: 13px;
  }
}
</style>

<template>
  <a :href="profile_uri" class="backer no-visual">
    <div class="image">
      <img :src="image" alt="" />
    </div>
    <p class="backer-name">
      {{ name }}
    </p>
    <p class="backer-bio">
      {{ short_bio }}
    </p>
  </a>
</template>
