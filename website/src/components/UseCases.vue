<script setup>
const { cases } = defineProps(['cases'])
</script>

<style>
  .use-cases {
    text-align: center;
    margin: 32px 0 -64px;
  }
  .use-cases .case {
    display: inline-flex;
    flex-direction: row;
    justify-content: center;
    align-items: center;
    margin: 15px 0;
    gap: 24px;

    border: 1px solid var(--vp-c-bg-soft);
    border-radius: 12px;
    background-color: var(--vp-c-bg-soft);
    transition: border-color 0.25s, background-color 0.25s;
    padding: 12px;
  }
  .use-cases .case:hover {
    border-color: var(--ddn-color);
  }
  @media (min-width: 560px) {
    .use-cases .case {
      padding: 14px 24px;
    }
  }
  @media (min-width: 760px) {
    .use-cases .case {
      padding: 18px 36px;
    }
  }
  @media (min-width: 1024px) {
    .use-cases .case {
      padding: 24px 48px;
    }
  }

  .use-cases .case-image {
    width: 30vw;
    max-width: 320px;
    min-width: 180px;
  }
  .use-cases .case-image img {
    width: 100%;
    filter: drop-shadow(1px 2px calc(2px + 0.5vw) var(--vp-c-indigo-1));
  }
  .use-cases .case-content {
    width: 40vw;
    max-width: 460px;
    min-width: 180px;
    text-align: left;
  }
  .use-cases .case-content h3 {
    border: none;
    margin-top: 12px;
    padding-top: 0;
    font-size: 24px;
  }
  .use-cases .case-content p,
  .use-cases .case-content ul {
    font-weight: 550;
    font-size: 15px;
    color: var(--vp-c-text-2);
    line-height: 26px;
  }
  .use-cases .case-content ul.benefits {
    margin-bottom: 14px;
  }
  .use-cases .case-content .benefits li + li {
    margin-top: 4px;
  }
  @media (max-width: 759px) {
    .use-cases .case {
      flex-direction: column;
    }
    .use-cases .case-image {
      width: 50vw;
      max-width: none;
      min-width: none;
    }
    .use-cases .case-content {
      width: 100%;
      max-width: 400px;
      min-width: none;
      text-align: center;
    }
    .use-cases .case-content h3 {
      margin-top: -12px;
    }
    .use-cases .case-content p,
    .use-cases .case-content ul {
      font-size: 14.5px;
      line-height: 24px;
    }
    .use-cases .case-content ul.benefits {
      margin-bottom: 28px;
    }
  }
  @media (max-width: 559px) {
    .use-cases .case-content p,
    .use-cases .case-content ul {
      font-size: 14px;
    }
  }
</style>

<template>
  <div class="use-cases">
    <a v-for="(item, index) in cases"
        :key="item.id"
        class="case no-visual"
        :href="item.link">
      <div class="case-image">
        <img :src="item.image" />
      </div>
      <div class="case-content">
        <h3>
          Solves {{ item.solves }}
        </h3>
        <p>
          {{ item.description }}
        </p>
        <ul class="benefits">
          <li v-for="(benefit, index) in item.benefits" :key="index">
            {{ benefit }}
          </li>
        </ul>
      </div>
    </a>
  </div>
</template>