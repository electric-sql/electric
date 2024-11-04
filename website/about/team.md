---
title: Team
description: >-
  Meet the team behind ElectricSQL.
outline: deep
---

<script setup>
import TeamMembers from '../src/components/TeamMembers.vue'
import { data } from '../data/team.data.ts'
import { data as activeJobs } from '../data/activeJobs.data.ts'

const { advisors, angels, team, vcs } = data

const currentlyHiring = activeJobs.length > 0
</script>

<style scoped>
  .vp-doc h3 {
    margin-bottom: 1rem;
  }
</style>

# Team

<div v-if="currentlyHiring">

> [!TIP] We're hiring!
> See the [jobs page](/about/jobs/) for active roles.

</div>

## Core team

<TeamMembers :items="team" />

## Advisors

<TeamMembers :items="advisors" />

## Investors

### Angels

<TeamMembers :items="angels" />

### VCs

<TeamMembers :items="vcs" />