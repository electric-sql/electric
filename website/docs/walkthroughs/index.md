---
title: Walkthrough tutorials
description: >-
  Walkthrough the steps to create a sync stack application with Electric.
  Using your choice of tech, including Typescript, Elixir, Python,
  TanStack, Yjs and PGlite.
outline: deep
image: /img/tutorials/sync-busters.jpg
---

<script setup>
  import SyncBuster from '../../src/components/SyncBuster.vue'
</script>

<style scoped>
  .sync-busters {
    display: grid;
    grid-template-columns: 1fr;
    gap: 24px;
    margin: 32px 0px 40px;
    overflow: hidden;
  }
  @media (max-width: 959px) {
    .sync-busters {
      gap: 22px;
    }
  }
  @media (max-width: 518px) {
    .sync-busters {
      margin: 32px 0px 40px;
      gap: 20px;
      grid-template-columns: 1fr;
    }
  }
  .sync-busters :deep(h3) {
    font-size: 21px;
    margin: 6px 0 12px 0;
  }
  .sync-busters :deep(p) {
    font-size: 15px;
    color: var(--vp-c-text-2);
  }
</style>

# Walkthrough tutorials

Walkthrough the steps to build an application with Electric. Using your choice of stack, including [Typescript](#), [Elixir/Phoenix](#), [TanStack](#), [Python](#), [PGlite](#) and [Yjs](#).

## Who you gonna call? Sync busters!

<img src="/img/tutorials/sync-busters.png" style="margin-bottom: 24px" />

Electric is designed to be [composable](/#works-with-section) and to work [with your existing stack](/blog/2024/11/21/local-first-with-your-existing-api). When you build on Electric, you can make your own technology choices.

So, rather than just one walkthrough tutorial, we've made four, that illustrate four different example stacks, chosen to match the choices of our resident sync busters.

<div class="sync-busters">
  <SyncBuster slug="kyle" :stack="['TypeScript', 'Hono', 'TanStack']">
    <h3>
      Kyle's stack &mdash;
      <span class="no-wrap">
        all in on Typescript</span>
    </h3>
    <p>
      Kyle likes a lightweight web stack with end-to-end type safety.
      He&nbsp;also gets things done fast with vibe&nbsp;coding.
    </p>
  </SyncBuster>

  <SyncBuster slug="james" :stack="['Elixir', 'Phoenix', 'TanStack']">
    <h3>
      James' stack &mdash;
      <span class="no-wrap">
        Phoenix &amp; TanStack</span>
    </h3>
    <p>
      James likes a functional programming language with mature
      tooling and a batteries-included web&nbsp;framework.
    </p>
  </SyncBuster>

  <SyncBuster slug="sam" :stack="['Python', 'Django', 'PGlite']">
    <h3>
      Sam's stack &mdash;
      <span class="no-wrap">
        Python &amp; PGlite</span>
    </h3>
    <p>
      Sam is British, so he likes
      <a href="https://www.youtube.com/watch?v=oaCheNXdz8A&t=51s">
        asking Bob for a P please</a>.
      Hence&nbsp;coding in Python and syncing into a PGlite&nbsp;database.
    </p>
  </SyncBuster>

  <SyncBuster slug="valter" :stack="['React', 'Yjs']">
    <h3>
      Valter's stack &mdash;
      <span class="no-wrap">
        Yjs</span>
    </h3>
    <p>
      Valter is a database PHD who
      <a href="/blog/2022/05/03/introducing-rich-crdts">
        invented rich-CRDTs</a>.
      He&nbsp;likes conflict-free algorithms, so his stack is based on&nbsp;Yjs.
    </p>
  </SyncBuster>
</div>
