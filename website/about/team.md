---
title: Team
description: >-
  Meet the team behind ElectricSQL.
---

<script setup>
import TeamMembers from '../.vitepress/theme/TeamMembers.vue'
import { data } from '../data/team.data.ts'

const { advisors, investors, team } = data
</script>

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

<TeamMembers :items="investors" />
