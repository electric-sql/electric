<template>
  <div class="banner">
    <div class="container">
      <div>
        <a href="#"
          >✨ Durable Streams <span class="hidden-xs">are</span> now
          <span class="hidden-sm">available</span> on Electric&nbsp;Cloud</a
        >
      </div>
    </div>
  </div>
</template>

<style scoped>
.banner {
  color: var(--vp-c-text-1);
  border-bottom: 1px solid var(--vp-c-indigo-2);
  font-weight: 500;

  padding: 22px 20px 17px;
  margin-bottom: 2px;

  font-size: 15px;
  text-align: center;
}
.banner a {
  padding: 18px 24px;
}
.banner a:hover {
  color: var(--vp-c-indigo-1);
}
@media (max-width: 559px) {
  .banner {
    font-size: 14.75px;
  }
  .banner a {
    padding: 18px;
  }
}
@media (max-width: 449px) {
  .banner {
    font-size: 14px;
  }
  .banner a {
    padding: 18px 0px;
  }
}
</style>
<style>
.nav-relative .VPNav {
  position: relative !important;
}
</style>
