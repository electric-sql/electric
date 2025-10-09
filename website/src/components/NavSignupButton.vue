<script setup>
const { screenMenu } = defineProps(['screenMenu'])

const classes = ['nav-item VPNavBarMenuLink VPNavBarCTA']
const extraClasses = [screenMenu ? 'is-mobile' : '']
</script>

<template>
  <div :class="[...classes, ...extraClasses]">
    <div class="cta-lg">
      <VPButton
        href="https://dashboard.electric-sql.cloud/"
        theme="brand"
        text="Sign-up to Cloud"
      />
    </div>
    <div class="cta-md">
      <VPButton
        href="https://dashboard.electric-sql.cloud/"
        theme="brand"
        text="Sign-up"
      />
    </div>
    <div class="cta-sm">
      <VPButton
        href="https://dashboard.electric-sql.cloud/"
        theme="brand"
        text="Sign-up to Cloud"
      />
    </div>
  </div>
</template>

<style scoped>
.cta-lg {
  display: none;
}
.cta-md {
  display: none;
}
.cta-sm {
  display: block;
}
@media (min-width: 768px) {
  .cta-sm {
    display: none;
  }
  .cta-md {
    display: block;
  }
}
@media (min-width: 1270px) {
  .cta-md {
    display: none;
  }
  .cta-lg {
    display: block;
  }
}
.nav-item {
  top: 14px;
  display: flex;
  align-items: center;
}
.nav-item .VPButton {
  line-height: 35px;
  padding: 0 17px;
  font-weight: 550;
}
@media (min-width: 768px) {
  @media (max-width: 959px) {
    .nav-item .VPButton {
      line-height: 32px !important;
      padding: 0 14px;
      font-weight: 500;
    }
  }
}
@media (max-width: 767px) {
  .nav-item .VPButton {
    padding: 0 32px;
  }
}
</style>
