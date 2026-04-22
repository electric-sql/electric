---
title: Team
description: >-
  Meet the team, advisors and investors behind ElectricSQL.
image: /img/about/team.jpg
outline: deep
---

<script setup>
import TeamMembers from '../src/components/TeamMembers.vue'
import AngelsGrid from '../src/components/AngelsGrid.vue'
import VCsGrid from '../src/components/VCsGrid.vue'
import { data } from '../data/team.data.ts'

const { advisors, angels, team, vcs } = data
</script>

<style scoped>
  .vp-doc h3 {
    margin-bottom: 1rem;
  }
</style>

# Team

## Core team

<TeamMembers :items="team" />

## Advisors

<TeamMembers :items="advisors" />

## Investors

### Angels

<AngelsGrid :items="angels" />

### VCs

<VCsGrid :items="vcs" />
