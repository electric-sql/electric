---
layout: page
title: Blog
description: >-
  The latest news and updates from ElectricSQL.
image: /img/blog/electric-elephant.jpg
sidebar: false
---

<script setup>
import { onMounted } from 'vue'

import { data as posts } from '../data/posts.data.ts'

import BlogPostListing from '../src/components/BlogPostListing.vue'

onMounted(async () => {
  if (typeof window !== 'undefined' && document.querySelector) {
    const githubLinks = document.querySelectorAll(
      '.actions a[href="https://github.com/electric-sql"]'
    )

    let icon = document.querySelector('.actions .vpi-social-github')
    if (!icon) {
      githubLinks.forEach((link) => {
        const icon = document.createElement('span')
        icon.classList.add('vpi-social-github')

        link.prepend(icon)
      })
    }

    const discordLinks = document.querySelectorAll(
      '.actions a[href="https://discord.electric-sql.com"]'
    )

    icon = document.querySelector('.actions .vpi-social-discord')
    if (!icon) {
      discordLinks.forEach((link) => {
        const icon = document.createElement('span')
        icon.classList.add('vpi-social-discord')

        link.prepend(icon)
      })
    }
  }
})
</script>

<style scoped>
  .header {
    text-align: center;
    padding: 0 12px;
  }
  .header img {
    width: 65%;
    max-width: 360px;
    margin: 60px auto 32px;
  }
  @media (max-width: 749px) {
    .header img {
      margin: 54px auto 32px;
    }
  }
  @media (max-width: 549px) {
    .header img {
      margin: 42px auto 24px;
    }
  }
  .header hr {
    margin: 48px 24px 32px;
  }
  p {
    font-size: 18px;
  }
  .listing {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    margin: 24px 48px;
    overflow: hidden;
  }
  @media (max-width: 1049px) {
    .listing {
      grid-template-columns: 1fr 1fr;
    }
  }
  @media (max-width: 949px) {
    .listing {
      gap: 20px;
      margin: 24px 40px;
    }
  }
  @media (max-width: 749px) {
    .listing {
      grid-template-columns: 1fr;
      gap: 18px;
      margin: 20px 32px;
    }
  }
  @media (max-width: 549px) {
    .listing {
      margin: 20px 24px;
    }
  }
  .actions {
    margin-top: 24px;
  }
</style>

<div class="vp-doc">
  <div class="container">
    <main>
      <div class="header">
        <img src="/img/blog/electric-elephant.jpg" />
        <h1>
          ElectricSQL Blog
        </h1>
        <p>
          The latest news and updates from the ElectricSQL&nbsp;project.
        </p>
        <p class="actions cta-actions">
          <div class="action hidden-sm">
            <VPButton
                href="https://discord.electric-sql.com"
                text="Join the Community"
                theme="brand"
            />
          </div>
          <div class="action inline-sm">
            <VPButton
                href="https://discord.electric-sql.com"
                text="Community"
                theme="brand"
            />
          </div>
          <div class="action hidden-sm">
            <VPButton href="https://github.com/electric-sql"
                target="_blank"
                text="Star on GitHub"
                theme="alt"
            />
          </div>
          <div class="action inline-sm">
            <VPButton href="https://github.com/electric-sql"
                target="_blank"
                text="GitHub"
                theme="alt"
            />
          </div>
        </p>
        <hr />
      </div>
      <div class="listing">
        <BlogPostListing v-for="post in posts"
            :key="post.slug"
            :post="post"
        />
      </div>
    </main>
  </div>
</div>
