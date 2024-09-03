---
title: Team
description: >-
  Meet the team behind ElectricSQL.
outline: deep
---

<script setup>
import TeamMembers from '../src/components/TeamMembers.vue'
import { data } from '../data/team.data.ts'

const { advisors, angels, team, vcs } = data
</script>

<style scoped>
  .vp-doc h3 {
    margin-bottom: 1rem;
  }
</style>

<!--
> [!INFO] We're hiring!
> See the [jobs page](/about/jobs) for active roles.
-->

# Team

## Core team

<TeamMembers :items="team" />

## Advisors

<TeamMembers :items="advisors" />

## Investors

### Angels

<TeamMembers :items="angels" />

### VCs

<TeamMembers :items="vcs" />