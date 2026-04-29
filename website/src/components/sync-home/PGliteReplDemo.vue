<script setup>
// Embedded PGlite REPL — full WASM Postgres running in the page.
// Same pattern as the one used on https://pglite.dev (see
// pglite/docs/components/Repl.vue): boot a PGlite instance, mount the
// `pglite-repl` web component, and run a small typing animation
// pulled from `queries[]` once the input is ready. Animation is
// paused/resumed via IntersectionObserver so it only types when the
// REPL is fully in view.
//
// This component is browser-only (PGlite is WASM + the REPL touches
// the DOM at script-setup time). The call-site must load it with
// VitePress `defineClientComponent` so the module is not executed
// during SSR.

import { ref, watch, onBeforeUnmount } from 'vue'
import '@electric-sql/pglite-repl/webcomponent'
import { defaultDarkThemeInit } from '@electric-sql/pglite-repl/webcomponent'
import { PGlite } from '@electric-sql/pglite'

const pg = new PGlite({
  startParams: [
    ...PGlite.defaultStartParams,
    '-c',
    'application_name=Electric Sync REPL',
  ],
})

const repl = ref(null)

let stopAnimation = false
let isAnimating = false
let observer = null

let pausePromise
let resume

function createPausePromise() {
  pausePromise = new Promise((resolve) => {
    resume = resolve
  })
}

const rootStyle = window.getComputedStyle(document.body)
const codeStyles = Object.fromEntries(
  [
    '--vp-code-line-height',
    '--vp-code-font-size',
    '--vp-code-font-family',
    '--vp-code-block-bg',
    '--vp-code-line-highlight-color',
    '--vp-c-brand-1',
  ].map((prop) => [prop, rootStyle.getPropertyValue(prop)])
)
const theme = defaultDarkThemeInit({
  settings: {
    fontFamily: codeStyles['--vp-code-font-family'],
    background: codeStyles['--vp-code-block-bg'],
    lineHighlight: codeStyles['--vp-code-line-highlight-color'],
    caret: codeStyles['--vp-c-brand-1'],
  },
})

watch(
  () => repl.value,
  async () => {
    if (repl.value && repl.value.shadowRoot) {
      let inputEl
      while (!inputEl) {
        inputEl = repl.value.shadowRoot.querySelector('.cm-content')
        await new Promise((resolve) => setTimeout(resolve, 50))
      }

      const replRootEl = repl.value.shadowRoot.querySelector('.PGliteRepl-root')
      replRootEl.setAttribute('style', `--PGliteRepl-font-size: 13px;`)

      const styleEl = document.createElement('style')
      styleEl.innerHTML = `
        .cm-cursor {
          border-left-width: 0.5em !important;
        }
        .cm-scroller {
          line-height: 1.45 !important;
        }
      `
      repl.value.shadowRoot.insertBefore(
        styleEl,
        repl.value.shadowRoot.firstChild
      )

      inputEl.addEventListener('focus', () => {
        if (!stopAnimation) {
          stopAnimation = true
          inputEl.innerText = ''
        }
      })

      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.intersectionRatio === 1) {
              if (!isAnimating) {
                isAnimating = true
                if (resume) resume()
              }
            } else {
              isAnimating = false
              createPausePromise()
            }
          })
        },
        { threshold: 1.0 }
      )

      observer.observe(repl.value)
      createPausePromise()
      animateInput(inputEl)
    }
  }
)

onBeforeUnmount(() => {
  if (observer) {
    observer.disconnect()
  }
})

const queries = ['SELECT version();', 'SELECT * FROM now();']

async function animateInput(inputEl) {
  await sleep(800)
  for (const query of queries) {
    let value = ''
    for (const c of query) {
      value += c
      if (stopAnimation) {
        return
      }
      if (!isAnimating) {
        await pausePromise
      }
      inputEl.innerText = value
      await sleep(50)
    }
    dispatchEnterEvent(inputEl)
    await sleep(500)
  }
  inputEl.focus()
}

async function sleep(time) {
  return new Promise((resolve) => setTimeout(resolve, time))
}

function dispatchEnterEvent(el) {
  const event = new KeyboardEvent('keydown', {
    code: 'Enter',
    key: 'Enter',
    charCode: 13,
    keyCode: 13,
    view: window,
    bubbles: true,
  })
  el.dispatchEvent(event)
}
</script>

<template>
  <pglite-repl
    ref="repl"
    class="pgrepl"
    :pg="pg"
    :darkTheme="theme"
    theme="dark"
  />
</template>

<style scoped>
.pgrepl {
  display: flex;
  align-items: stretch;
  font-size: 13px;
  width: 100%;
  height: 360px;
}
</style>
