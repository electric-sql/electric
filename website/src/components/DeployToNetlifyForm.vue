<script setup>
import { useTemplateRef } from "vue"

const { repo } = defineProps(["repo"])
const electricUrl = defineModel()
const form = useTemplateRef("form")
</script>

<template>
  <!--
    We use a form and a link because we want to:

    1. validate
    2. open in a new tab

    It's a hack but it works.
  -->
  <form method="GET" target="_blank" ref="form">
    <p>
      <label for="url"> <code>ELECTRIC_URL</code>: </label>
      <br />
      <input
        v-model="electricUrl"
        type="url"
        name="url"
        style="
          border: 1px solid #333;
          border-radius: 8px;
          padding: 6px 12px;
          margin: 4px 0px 8px;
          width: 80%;
          font-size: 15px;
          background: rga(22 22 24);
        "
        placeholder="https://my-electric.example.com"
        pattern="^https:\/\/.*"
        required
      />
      <br />
      <small style="margin: -2px 0 2px 2px; display: block">
        required, must start with <code>https://</code>.
      </small>
    </p>
  </form>
  <p>
    <a
      :href="`https://app.netlify.com/start/deploy?repository=https://github.com/${repo}#VITE_ELECTRIC_URL=${electricUrl}`"
      target="_blank"
      @click="
        (event) => {
          if (!electricUrl || !electricUrl.startsWith('https://')) {
            event.preventDefault()

            form.reportValidity()
          }
        }
      "
    >
      <img src="https://www.netlify.com/img/deploy/button.svg" />
    </a>
  </p>
</template>
