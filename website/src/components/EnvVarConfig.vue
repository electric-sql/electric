<script setup>
import { defineProps, withDefaults } from 'vue'

const props = defineProps({
  name: {
    type: String,
    required: true,
  },
  description: {
    type: [String, Object], // Accepts both string and other components
    required: false,
  },
  optional: {
    type: Boolean,
    default: false,
  },
  required: {
    type: Boolean,
    default: false,
  },
  defaultValue: {
    type: String,
    default: undefined,
  },
  example: {
    type: String,
    required: true,
  },
})

// Error handling
if (!(props.required || props.optional || props.defaultValue !== undefined)) {
  throw new Error('Must have a defaultValue if not required')
}
</script>

<style>
.envVarConfigDescription {
  width: 100%;
}
.envVarConfigDescription p {
  line-height: 22px;
}
.envVarConfigDescription p:first-child {
  margin-top: 0;
}
.envVarConfigDescription p:last-child {
  margin-bottom: 0;
}
.envVarConfig code {
  word-break: break-all;
}
</style>

<template>
  <table :class="['table', 'envVarConfig']">
    <tbody>
      <tr>
        <td>Variable</td>
        <td>
          <code>{{ name }}</code>
          <Badge v-if="required" type="warning" text="required" />
          <Badge v-if="optional" type="info" text="optional" />
        </td>
      </tr>
      <tr v-if="defaultValue">
        <td>Default</td>
        <td>
          <code>{{ defaultValue }}</code>
        </td>
      </tr>
      <tr>
        <td>Description</td>
        <td class="envVarConfigDescription">
          <slot></slot>
        </td>
      </tr>
      <tr>
        <td>Example</td>
        <td>
          <code>{{ name }}={{ example }}</code>
        </td>
      </tr>
    </tbody>
  </table>
</template>
